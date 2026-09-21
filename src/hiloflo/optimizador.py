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

# El objetivo es lexicografico, en tres niveles:
#
#   1. la tonelada que sale dentro del horizonte          (PESO_KG)
#   2. el cierre del programa, o sea la linea mas cargada (PESO_MAKESPAN)
#   3. las horas-linea totales                            (peso 1)
#
# El nivel 2 es el que balancea. Sin el, la busqueda vacia las lineas lentas
# hacia las rapidas y deja a las primeras ociosas: baja las horas totales pero
# el programa sigue cerrando cuando termina la linea mas cargada, asi que no
# se produce ni un kilo mas. Lo que de verdad destraba la produccion es que
# el material que sale de una linea lo levante otra, y eso es exactamente lo
# que premia minimizar la linea mas cargada.
#
# Con kilos del orden de 1e6, cierre del orden de 1e2 y horas totales del
# orden de 1e3, estos pesos mantienen el orden entre los tres niveles.
PESO_KG = 1000.0
PESO_MAKESPAN = 100.0


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
    def makespan_original(self) -> float:
        return _makespan(self.evaluacion_original)

    @property
    def makespan_propuesto(self) -> float:
        return _makespan(self.evaluacion_propuesta)

    @property
    def factor_de_produccion(self) -> float:
        """Cuantas veces mas rapido cierra el programa reajustado.

        En el mismo tiempo de calendario que hoy ocupa la linea mas cargada,
        la planta saca este multiplo de la tonelada actual.
        """
        if self.makespan_propuesto <= 0:
            return 1.0
        return self.makespan_original / self.makespan_propuesto

    @property
    def toneladas_por_balanceo(self) -> float:
        """Tonelada extra que cabe en el mismo calendario, al balancear."""
        actuales = self.programa_original.kilogramos / 1000.0
        return actuales * (self.factor_de_produccion - 1.0)

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
    def makespan_original(self) -> float:
        return _makespan(self.evaluacion_original)

    @property
    def makespan_propuesto(self) -> float:
        return _makespan(self.evaluacion_propuesta)

    @property
    def factor_de_produccion(self) -> float:
        """Cuantas veces mas rapido cierra el programa reajustado.

        En el mismo tiempo de calendario que hoy ocupa la linea mas cargada,
        la planta saca este multiplo de la tonelada actual.
        """
        if self.makespan_propuesto <= 0:
            return 1.0
        return self.makespan_original / self.makespan_propuesto

    @property
    def toneladas_por_balanceo(self) -> float:
        """Tonelada extra que cabe en el mismo calendario, al balancear."""
        actuales = self.programa_original.kilogramos / 1000.0
        return actuales * (self.factor_de_produccion - 1.0)

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
                "Sin areas de oportunidad: el programa ya esta balanceado con "
                "las recetas disponibles."
            )
        cuello = self._linea_mas_cargada(self.evaluacion_original)
        actuales = self.programa_original.kilogramos / 1000.0
        lineas = [
            f"Hoy el programa cierra en {self.makespan_original:,.1f} h, que es "
            f"lo que tarda {cuello}; las demas lineas acaban antes y esperan.",
            f"Reajustado cierra en {self.makespan_propuesto:,.1f} h "
            f"({self.makespan_original - self.makespan_propuesto:,.1f} h antes).",
            "",
            f"En el mismo calendario caben {self.factor_de_produccion:,.2f}x las "
            f"toneladas de hoy:",
            f"  {actuales:,.1f} t  ->  "
            f"{actuales * self.factor_de_produccion:,.1f} t"
            f"   (+{self.toneladas_por_balanceo:,.1f} t)",
            "",
            "  Ese incremento supone que haya carga con que llenar las horas que",
            "  se liberan. Si no la hay, la ganancia es cerrar el programa antes.",
        ]
        if self.delta_kg >= 1:
            lineas += [
                "",
                f"Ademas salen {self.delta_toneladas:,.2f} t mas dentro del "
                "horizonte que hoy no alcanzaban a producirse.",
            ]

        agrupadas = self.agrupadas()
        permutas = self.permutas
        movidas = sum(len(g.ordenes) for g in agrupadas) + 2 * len(permutas)
        lineas += [
            "",
            f"{len(agrupadas) + len(permutas)} movimientos, {movidas} de "
            f"{len(self.programa_original)} ordenes:",
            "",
        ]
        lineas += [f"  {n}. {g.describir()}" for n, g in enumerate(agrupadas, 1)]
        lineas += [
            f"  {n}. {o.describir()}"
            for n, o in enumerate(permutas, len(agrupadas) + 1)
        ]
        return "\n".join(lineas)

    @staticmethod
    def _linea_mas_cargada(evaluacion: Evaluacion) -> str:
        return max(
            evaluacion.lineas.items(),
            key=lambda par: par[1].horas_requeridas,
            default=("?", None),
        )[0]


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
    def _puntaje(valor: dict[str, tuple[float, float]]) -> float:
        """Puntaje global. El makespan obliga a mirar todas las lineas, no
        solo las dos que toca el movimiento."""
        kg = sum(v[0] for v in valor.values())
        horas = [v[1] for v in valor.values()]
        return kg * PESO_KG - max(horas) * PESO_MAKESPAN - sum(horas)

    @property
    def total_kg(self) -> float:
        return sum(kg for kg, _ in self.valor.values())

    @property
    def total_horas(self) -> float:
        return sum(horas for _, horas in self.valor.values())

    @property
    def makespan(self) -> float:
        """Horas de la linea mas cargada: cuando cierra el programa."""
        return max(horas for _, horas in self.valor.values())

    def _delta(
        self, claves: tuple[str, ...], nuevos: tuple[list[Orden], ...]
    ) -> tuple[float, float, float]:
        """(puntaje, delta_kg, delta_horas) de sustituir esas lineas."""
        candidato = dict(self.valor)
        for clave, ordenes in zip(claves, nuevos):
            candidato[clave] = self._valor(clave, ordenes)
        puntaje = self._puntaje(candidato) - self._puntaje(self.valor)
        delta_kg = sum(candidato[c][0] - self.valor[c][0] for c in claves)
        delta_horas = sum(self.valor[c][1] - candidato[c][1] for c in claves)
        return puntaje, delta_kg, delta_horas

    def delta_mover(self, orden: Orden, destino: str):
        origen = orden.linea
        sin_orden = [o for o in self.asignacion[origen] if o.id != orden.id]
        con_orden = _insertar(self.asignacion[destino], orden.mover_a(destino))
        return self._delta((origen, destino), (sin_orden, con_orden)), {
            origen: sin_orden,
            destino: con_orden,
        }

    def delta_mover_bloque(self, ordenes: list[Orden], destino: str):
        """Pasa de golpe todas las ordenes de un diametro a otra linea."""
        origen = ordenes[0].linea
        ids = {o.id for o in ordenes}
        sin_bloque = [o for o in self.asignacion[origen] if o.id not in ids]
        con_bloque = list(self.asignacion[destino])
        for orden in ordenes:
            con_bloque = _insertar(con_bloque, orden.mover_a(destino))
        return self._delta((origen, destino), (sin_bloque, con_bloque)), {
            origen: sin_bloque,
            destino: con_bloque,
        }

    def bloques(self) -> list[list[Orden]]:
        """Las ordenes movibles de cada linea, agrupadas por diametro."""
        grupos: list[list[Orden]] = []
        for ordenes in self.asignacion.values():
            por_diametro: dict[float, list[Orden]] = {}
            for orden in ordenes:
                if not orden.fijo:
                    por_diametro.setdefault(orden.diametro_mm, []).append(orden)
            grupos.extend(por_diametro.values())
        return grupos

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

    # Jugada 1: mover de golpe todas las ordenes de un diametro. Es la jugada
    # que mas rinde: el cambio de medida en la linea destino se paga una sola
    # vez y se reparte entre todo el bloque, mientras que moviendo orden por
    # orden la primera carga con el cambio completo y casi nunca sale positiva.
    for bloque in estado.bloques():
        if len(bloque) < 2:
            continue  # de una sola orden ya se encarga la jugada 2
        for destino in estado.tabla.lineas_para(bloque[0]):
            if destino == bloque[0].linea or destino not in destinos_validos:
                continue
            (puntaje, delta_kg, delta_horas), cambios = estado.delta_mover_bloque(
                bloque, destino
            )
            if puntaje > mejor_puntaje:
                mejor_puntaje = puntaje
                mejor = (
                    Oportunidad(
                        "MOVER",
                        list(bloque),
                        [bloque[0].linea],
                        [destino],
                        delta_kg,
                        delta_horas,
                    ),
                    cambios,
                )

    # Jugada 2: mover una sola orden a otra linea con receta.
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


def _makespan(evaluacion: Evaluacion) -> float:
    """Horas de la linea mas cargada: cuando cierra el programa."""
    return max(
        (r.horas_requeridas for r in evaluacion.lineas.values()), default=0.0
    )


def _puntaje_minimo(umbral_kg: float, umbral_horas: float) -> float:
    """Piso del puntaje: se acepta una jugada que gane tonelada o que, sin
    perderla, libere horas suficientes."""
    return min(umbral_kg * PESO_KG, umbral_horas)
