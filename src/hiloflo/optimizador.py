"""Busqueda de areas de oportunidad en el production schedule.

No reescribe el schedule por su cuenta: propone movimientos concretos
("mueve esta orden de ITW-5 a ITW-9") con la tonelada extra que cada uno
genera, para que el programador decida.

Estrategia: busqueda local sobre el schedule que ya armo el programador.
En cada vuelta prueba dos jugadas y se queda con la mejor:

  MOVER     pasar una orden completa a otra linea con receta para ese
            diametro.
  PERMUTAR  intercambiar dos ordenes entre sus lineas (sirve cuando las dos
            lineas estan llenas y solo conviene cruzarlas).

Se detiene cuando ninguna jugada mejora los kilogramos producibles.

La evaluacion es incremental: un movimiento solo toca dos lineas, asi que
solo esas dos se vuelven a calcular. Sin eso, un schedule de ~500 ordenes
sobre 14 lineas no termina en tiempo util.
"""

from __future__ import annotations

from dataclasses import dataclass

from .modelos import Linea, Orden, Programa
from .programa import Evaluacion, evaluar_linea, evaluar_programa
from .rendimiento import TablaVelocidades

# Mejora minima (kg) para que valga la pena proponer un movimiento.
UMBRAL_KG = 50.0

# Mejora minima (horas) cuando el movimiento no cambia la tonelada pero si
# libera capacidad.
UMBRAL_HORAS = 0.5

# El objetivo es lexicografico: primero la tonelada que sale en el horizonte
# y, a igualdad, las horas que se liberan. Con kilos del orden de 1e5 y horas
# del orden de 1e2, este peso deja la tonelada siempre por encima.
PESO_KG = 1000.0


@dataclass
class Oportunidad:
    """Un movimiento propuesto y lo que gana."""

    tipo: str  # "MOVER" | "PERMUTAR"
    ordenes: list[Orden]
    origen: list[str]
    destino: list[str]
    delta_kg: float
    delta_horas: float = 0.0  # positivo = horas liberadas

    @property
    def delta_toneladas(self) -> float:
        return self.delta_kg / 1000.0

    @property
    def ganancia(self) -> str:
        partes = []
        if abs(self.delta_kg) >= 1:
            partes.append(f"+{self.delta_toneladas:,.2f} t")
        if abs(self.delta_horas) >= 0.05:
            partes.append(f"libera {self.delta_horas:,.1f} h")
        return " y ".join(partes) if partes else "sin cambio"

    def describir(self) -> str:
        if self.tipo == "MOVER":
            o = self.ordenes[0]
            return (
                f"Mover la orden {o.id} ({o.kilogramos:,.0f} kg de "
                f"{o.diametro_mm:.2f} mm) de {self.origen[0]} a "
                f"{self.destino[0]}: {self.ganancia}"
            )
        a, b = self.ordenes
        return (
            f"Permutar {a.id} ({a.diametro_mm:.2f} mm, {self.origen[0]}) con "
            f"{b.id} ({b.diametro_mm:.2f} mm, {self.origen[1]}): {self.ganancia}"
        )


@dataclass
class MovimientoAgrupado:
    """Varias ordenes del mismo diametro que van de la misma linea a la misma.

    El programador no mueve rollos de uno en uno: le sirve mas leer "pasa las
    13 ordenes de 17.50 mm de ITW-12 a ITW-13" que trece renglones iguales.
    """

    origen: str
    destino: str
    diametro_mm: float
    ordenes: list[Orden]
    horas_origen: float  # horas de corrida que costaban en la linea de origen
    horas_destino: float  # horas que cuestan en la de destino

    @property
    def kilogramos(self) -> float:
        return sum(o.kilogramos for o in self.ordenes)

    @property
    def horas_liberadas(self) -> float:
        """Horas de corrida que se ahorran. Negativo = el movimiento cuesta
        horas, y se justifica por la tonelada que destraba en el origen."""
        return self.horas_origen - self.horas_destino

    def describir(self) -> str:
        n = len(self.ordenes)
        plural = "orden" if n == 1 else "ordenes"
        horas = self.horas_liberadas
        if horas >= 0.05:
            efecto = f"ahorra {horas:,.1f} h de corrida"
        elif horas <= -0.05:
            efecto = (
                f"cuesta {abs(horas):,.1f} h de corrida, pero destraba "
                f"{self.origen}"
            )
        else:
            efecto = "mismo tiempo de corrida, reparte carga"
        return (
            f"{self.origen} -> {self.destino}: {n} {plural} de "
            f"{self.diametro_mm:.2f} mm ({self.kilogramos:,.0f} kg). {efecto}"
        )

    def ids(self) -> str:
        return ", ".join(o.id for o in self.ordenes)


@dataclass
class Propuesta:
    """Resultado completo de la busqueda."""

    programa_original: Programa
    programa_propuesto: Programa
    evaluacion_original: Evaluacion
    evaluacion_propuesta: Evaluacion
    oportunidades: list[Oportunidad]
    _tabla: TablaVelocidades | None = None

    @property
    def delta_kg(self) -> float:
        return (
            self.evaluacion_propuesta.kg_producibles
            - self.evaluacion_original.kg_producibles
        )

    @property
    def delta_toneladas(self) -> float:
        return self.delta_kg / 1000.0

    @property
    def horas_liberadas(self) -> float:
        return (
            self.evaluacion_original.horas_requeridas
            - self.evaluacion_propuesta.horas_requeridas
        )

    @property
    def toneladas_de_horas_liberadas(self) -> float:
        """Las horas liberadas valuadas al rendimiento promedio del schedule.

        Es la tonelada extra que cabria en esas horas si se les carga trabajo
        del mismo perfil que ya corre la planta.
        """
        horas = self.evaluacion_propuesta.horas_requeridas
        if horas <= 0:
            return 0.0
        kg_por_hora = self.evaluacion_propuesta.kg_producibles / horas
        return self.horas_liberadas * kg_por_hora / 1000.0

    def agrupadas(self) -> list[MovimientoAgrupado]:
        """Los cambios NETOS entre el schedule original y el propuesto.

        Se saca del diff de los dos schedules y no de la bitacora de jugadas:
        la busqueda local a veces mueve una orden y despues la regresa, y esos
        viajes de ida y vuelta no le sirven de nada al programador.
        """
        destino_de = {o.id: o.linea for o in self.programa_propuesto.ordenes}
        indice: dict[tuple[str, str, float], MovimientoAgrupado] = {}

        for orden in self.programa_original.ordenes:
            destino = destino_de.get(orden.id)
            if destino is None or destino == orden.linea:
                continue
            clave = (orden.linea, destino, orden.diametro_mm)
            grupo = indice.get(clave)
            if grupo is None:
                grupo = MovimientoAgrupado(
                    origen=orden.linea,
                    destino=destino,
                    diametro_mm=orden.diametro_mm,
                    ordenes=[],
                    horas_origen=0.0,
                    horas_destino=0.0,
                )
                indice[clave] = grupo
            grupo.ordenes.append(orden)
            grupo.horas_origen += self._horas(orden.linea, orden)
            grupo.horas_destino += self._horas(destino, orden)

        grupos = list(indice.values())
        grupos.sort(key=lambda g: (-g.horas_liberadas, -g.kilogramos))
        return grupos

    def _horas(self, linea: str, orden: Orden) -> float:
        """Horas de corrida de esa orden en esa linea (0 si no hay receta)."""
        resultado = self.evaluacion_original.lineas.get(linea)
        kgh = None
        if resultado is not None:
            for corrida in resultado.corridas:
                if corrida.orden.id == orden.id and corrida.kg_hora:
                    kgh = corrida.kg_hora
                    break
        if kgh is None:
            kgh = self._tabla_kg_hora(linea, orden)
        return orden.kilogramos / kgh if kgh else 0.0

    def _tabla_kg_hora(self, linea: str, orden: Orden) -> float | None:
        if self._tabla is None:
            return None
        return self._tabla.kg_hora(linea, orden)

    @property
    def permutas(self) -> list[Oportunidad]:
        return [o for o in self.oportunidades if o.tipo == "PERMUTAR"]

    def resumen(self) -> str:
        if not self.agrupadas() and not self.permutas:
            return (
                "Sin areas de oportunidad: el schedule ya aprovecha las lineas "
                "con las recetas disponibles."
            )
        base = self.evaluacion_original.toneladas_producibles
        lineas = [f"Sobre las {base:,.2f} t del schedule actual:"]
        if abs(self.delta_kg) >= 1:
            pct = (self.delta_kg / (base * 1000.0) * 100.0) if base else 0.0
            lineas.append(
                f"  - salen {self.delta_toneladas:,.2f} t mas dentro del "
                f"horizonte (+{pct:,.1f}%)"
            )
        if self.horas_liberadas >= 0.05:
            lineas.append(
                f"  - se liberan {self.horas_liberadas:,.1f} h de linea, que al "
                f"rendimiento promedio del schedule valen "
                f"{self.toneladas_de_horas_liberadas:,.2f} t adicionales"
            )
        agrupadas = self.agrupadas()
        permutas = self.permutas
        total = len(agrupadas) + len(permutas)
        lineas += ["", f"{total} movimientos propuestos:", ""]
        lineas += [f"  {n}. {g.describir()}" for n, g in enumerate(agrupadas, 1)]
        lineas += [
            f"  {n}. {o.describir()}"
            for n, o in enumerate(permutas, len(agrupadas) + 1)
        ]
        return "\n".join(lineas)


# --------------------------------------------------------------------------
# Estado con evaluacion incremental
# --------------------------------------------------------------------------


class _Estado:
    """Asignacion linea -> secuencia de ordenes, con el valor de cada linea.

    De cada linea se guarda el par (kg producibles, horas requeridas). El
    puntaje que se maximiza es lexicografico: la tonelada manda y las horas
    liberadas desempatan.
    """

    def __init__(
        self, programa: Programa, lineas: list[Linea], tabla: TablaVelocidades
    ) -> None:
        self.lineas = {l.clave: l for l in lineas}
        self.tabla = tabla
        self.asignacion = {
            l.clave: list(programa.de_linea(l.clave)) for l in lineas
        }
        self.valor = {c: self._valor(c, self.asignacion[c]) for c in self.asignacion}

    def _valor(self, clave: str, ordenes: list[Orden]) -> tuple[float, float]:
        resultado = evaluar_linea(self.lineas[clave], ordenes, self.tabla)
        return resultado.kg_producibles, resultado.horas_requeridas

    @staticmethod
    def _puntaje(valor: tuple[float, float]) -> float:
        kg, horas = valor
        return kg * PESO_KG - horas

    @property
    def total_kg(self) -> float:
        return sum(kg for kg, _ in self.valor.values())

    @property
    def total_horas(self) -> float:
        return sum(horas for _, horas in self.valor.values())

    def _delta(
        self, claves: tuple[str, ...], nuevos: tuple[list[Orden], ...]
    ) -> tuple[float, float, float]:
        """(puntaje, delta_kg, delta_horas) de sustituir esas lineas."""
        puntaje = delta_kg = delta_horas = 0.0
        for clave, ordenes in zip(claves, nuevos):
            antes = self.valor[clave]
            ahora = self._valor(clave, ordenes)
            puntaje += self._puntaje(ahora) - self._puntaje(antes)
            delta_kg += ahora[0] - antes[0]
            delta_horas += antes[1] - ahora[1]  # positivo = horas liberadas
        return puntaje, delta_kg, delta_horas

    def delta_mover(self, orden: Orden, destino: str):
        origen = orden.linea
        sin_orden = [o for o in self.asignacion[origen] if o.id != orden.id]
        con_orden = _insertar(self.asignacion[destino], orden.mover_a(destino))
        return self._delta((origen, destino), (sin_orden, con_orden)), {
            origen: sin_orden,
            destino: con_orden,
        }

    def delta_permutar(self, a: Orden, b: Orden):
        la, lb = a.linea, b.linea
        nueva_a = _insertar(
            [o for o in self.asignacion[la] if o.id != a.id], b.mover_a(la)
        )
        nueva_b = _insertar(
            [o for o in self.asignacion[lb] if o.id != b.id], a.mover_a(lb)
        )
        return self._delta((la, lb), (nueva_a, nueva_b)), {la: nueva_a, lb: nueva_b}

    def aplicar(self, clave: str, ordenes: list[Orden]) -> None:
        self.asignacion[clave] = _resecuenciar(ordenes)
        self.valor[clave] = self._valor(clave, self.asignacion[clave])

    def saturadas(self) -> set[str]:
        """Lineas que no alcanzan a sacar todo lo que tienen programado."""
        saturadas = set()
        for clave, ordenes in self.asignacion.items():
            resultado = evaluar_linea(self.lineas[clave], ordenes, self.tabla)
            if resultado.horas_sobregiro > 0 or resultado.sin_receta:
                saturadas.add(clave)
        return saturadas

    def a_programa(self, horizonte: str) -> Programa:
        return Programa(
            ordenes=[o for lista in self.asignacion.values() for o in lista],
            horizonte=horizonte,
        )


def _insertar(ordenes: list[Orden], nueva: Orden) -> list[Orden]:
    """Mete la orden junto a las del mismo diametro para no pagar un cambio
    de medida de mas; si no hay, la deja al final."""
    posicion = len(ordenes)
    for i in range(len(ordenes) - 1, -1, -1):
        if ordenes[i].diametro_mm == nueva.diametro_mm:
            posicion = i + 1
            break
    return ordenes[:posicion] + [nueva] + ordenes[posicion:]


def _resecuenciar(ordenes: list[Orden]) -> list[Orden]:
    return [o.mover_a(o.linea, n) for n, o in enumerate(ordenes, 1)]


# --------------------------------------------------------------------------
# Busqueda
# --------------------------------------------------------------------------


def buscar_oportunidades(
    programa: Programa,
    lineas: list[Linea],
    tabla: TablaVelocidades,
    *,
    max_movimientos: int = 40,
    permitir_permutas: bool = True,
    umbral_kg: float = UMBRAL_KG,
    umbral_horas: float = UMBRAL_HORAS,
) -> Propuesta:
    """Busca reasignaciones de ordenes que aumenten la tonelada del horizonte."""
    evaluacion_inicial = evaluar_programa(programa, lineas, tabla)
    estado = _Estado(programa, lineas, tabla)
    destinos_validos = {l.clave for l in lineas if l.activa}
    oportunidades: list[Oportunidad] = []

    for _ in range(max_movimientos):
        mejor = _mejor_jugada(
            estado, destinos_validos, umbral_kg, umbral_horas, permitir_permutas
        )
        if mejor is None:
            break
        oportunidad, cambios = mejor
        for clave, ordenes in cambios.items():
            estado.aplicar(clave, ordenes)
        oportunidades.append(oportunidad)

    propuesto = estado.a_programa(programa.horizonte)
    return Propuesta(
        programa_original=programa,
        programa_propuesto=propuesto,
        evaluacion_original=evaluacion_inicial,
        evaluacion_propuesta=evaluar_programa(propuesto, lineas, tabla),
        oportunidades=oportunidades,
        _tabla=tabla,
    )


def _mejor_jugada(
    estado: _Estado,
    destinos_validos: set[str],
    umbral_kg: float,
    umbral_horas: float,
    permitir_permutas: bool,
) -> tuple[Oportunidad, dict[str, list[Orden]]] | None:
    """La jugada que mas sube el puntaje, o None si ninguna vale la pena."""
    mejor_puntaje = _puntaje_minimo(umbral_kg, umbral_horas)
    mejor: tuple[Oportunidad, dict[str, list[Orden]]] | None = None

    movibles = [
        o for lista in estado.asignacion.values() for o in lista if not o.fijo
    ]

    # Jugada 1: mover una orden a otra linea con receta.
    for orden in movibles:
        for destino in estado.tabla.lineas_para(orden):
            if destino == orden.linea or destino not in destinos_validos:
                continue
            (puntaje, delta_kg, delta_horas), cambios = estado.delta_mover(
                orden, destino
            )
            if puntaje > mejor_puntaje:
                mejor_puntaje = puntaje
                mejor = (
                    Oportunidad(
                        "MOVER",
                        [orden],
                        [orden.linea],
                        [destino],
                        delta_kg,
                        delta_horas,
                    ),
                    cambios,
                )

    # Jugada 2: permutar dos ordenes. Solo se explora desde las lineas
    # saturadas, que es donde estan los kilos que se quedan fuera del
    # horizonte; barrer todos los pares seria cuadratico sobre ~500 ordenes.
    if permitir_permutas:
        saturadas = estado.saturadas()
        if saturadas:
            for a in (o for o in movibles if o.linea in saturadas):
                for b in movibles:
                    if a.linea == b.linea or a.id == b.id:
                        continue
                    if a.diametro_mm == b.diametro_mm:
                        continue  # permutar iguales no cambia nada
                    if not estado.tabla.puede_correr(b.linea, a):
                        continue
                    if not estado.tabla.puede_correr(a.linea, b):
                        continue
                    (puntaje, delta_kg, delta_horas), cambios = (
                        estado.delta_permutar(a, b)
                    )
                    if puntaje > mejor_puntaje:
                        mejor_puntaje = puntaje
                        mejor = (
                            Oportunidad(
                                "PERMUTAR",
                                [a, b],
                                [a.linea, b.linea],
                                [b.linea, a.linea],
                                delta_kg,
                                delta_horas,
                            ),
                            cambios,
                        )

    return mejor


def _puntaje_minimo(umbral_kg: float, umbral_horas: float) -> float:
    """Piso del puntaje: se acepta una jugada que gane tonelada o que, sin
    perderla, libere horas suficientes."""
    return min(umbral_kg * PESO_KG, umbral_horas)
