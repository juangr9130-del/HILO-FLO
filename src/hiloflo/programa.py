"""Evaluacion del production schedule.

Dado el schedule que armo el programador (que ordenes van en que linea y
en que orden), calcula por linea: horas de corrida, horas de cambio de
medida, utilizacion contra las horas disponibles y cuantos kilogramos
alcanzan a salir dentro del horizonte.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .modelos import Linea, Orden, Programa
from .rendimiento import TablaVelocidades


@dataclass
class Corrida:
    """Como le fue a una orden en la linea donde esta programada."""

    orden: Orden
    kg_hora: float | None
    horas_produccion: float
    horas_cambio: float
    kg_producibles: float

    @property
    def completa(self) -> bool:
        return self.kg_producibles >= self.orden.kilogramos - 1e-6

    @property
    def sin_receta(self) -> bool:
        return self.kg_hora is None


@dataclass
class ResultadoLinea:
    linea: Linea
    corridas: list[Corrida] = field(default_factory=list)

    @property
    def kg_programados(self) -> float:
        return sum(c.orden.kilogramos for c in self.corridas)

    @property
    def kg_producibles(self) -> float:
        return sum(c.kg_producibles for c in self.corridas)

    @property
    def horas_produccion(self) -> float:
        return sum(c.horas_produccion for c in self.corridas)

    @property
    def horas_cambio(self) -> float:
        return sum(c.horas_cambio for c in self.corridas)

    @property
    def horas_requeridas(self) -> float:
        return self.horas_produccion + self.horas_cambio

    @property
    def horas_ociosas(self) -> float:
        return max(0.0, self.linea.horas_disponibles - self.horas_requeridas)

    @property
    def horas_sobregiro(self) -> float:
        return max(0.0, self.horas_requeridas - self.linea.horas_disponibles)

    @property
    def utilizacion(self) -> float:
        if self.linea.horas_disponibles <= 0:
            return 0.0
        return self.horas_requeridas / self.linea.horas_disponibles

    @property
    def cambios(self) -> int:
        return sum(1 for c in self.corridas if c.horas_cambio > 0)

    @property
    def sin_receta(self) -> list[Orden]:
        return [c.orden for c in self.corridas if c.sin_receta]


@dataclass
class Evaluacion:
    lineas: dict[str, ResultadoLinea] = field(default_factory=dict)

    @property
    def kg_programados(self) -> float:
        return sum(r.kg_programados for r in self.lineas.values())

    @property
    def kg_producibles(self) -> float:
        return sum(r.kg_producibles for r in self.lineas.values())

    @property
    def toneladas_producibles(self) -> float:
        return self.kg_producibles / 1000.0

    @property
    def kg_no_producibles(self) -> float:
        return self.kg_programados - self.kg_producibles

    @property
    def horas_requeridas(self) -> float:
        return sum(r.horas_requeridas for r in self.lineas.values())

    @property
    def horas_ociosas(self) -> float:
        return sum(r.horas_ociosas for r in self.lineas.values())

    @property
    def sin_receta(self) -> list[Orden]:
        return [o for r in self.lineas.values() for o in r.sin_receta]

    def resumen(self) -> str:
        filas = [
            f"{'LINEA':<9}{'KG PROG':>11}{'KG PROD':>11}{'HRS PROD':>10}"
            f"{'HRS CBIO':>10}{'HRS DISP':>10}{'UTIL':>7}"
        ]
        for clave in sorted(self.lineas, key=_orden_natural):
            r = self.lineas[clave]
            filas.append(
                f"{clave:<9}{r.kg_programados:>11,.0f}{r.kg_producibles:>11,.0f}"
                f"{r.horas_produccion:>10,.1f}{r.horas_cambio:>10,.1f}"
                f"{r.linea.horas_disponibles:>10,.1f}{r.utilizacion * 100:>6,.0f}%"
            )
        filas.append("-" * 68)
        filas.append(
            f"{'TOTAL':<9}{self.kg_programados:>11,.0f}"
            f"{self.kg_producibles:>11,.0f}{self.horas_requeridas:>20,.1f}"
        )
        return "\n".join(filas)


def _orden_natural(linea: str) -> tuple:
    import re

    m = re.search(r"(\d+)", linea)
    return (0, int(m.group(1))) if m else (1, linea)


def evaluar_linea(
    linea: Linea, ordenes: list[Orden], tabla: TablaVelocidades
) -> ResultadoLinea:
    """Corre la secuencia de la linea consumiendo sus horas disponibles."""
    resultado = ResultadoLinea(linea=linea)
    restantes = linea.horas_disponibles
    diametro_previo: float | None = None

    for orden in ordenes:
        kgh = tabla.kg_hora(linea.clave, orden)
        if kgh is None:
            # La linea no tiene receta para ese diametro: se reporta aparte
            # y no consume horas.
            resultado.corridas.append(Corrida(orden, None, 0.0, 0.0, 0.0))
            continue

        cambia = diametro_previo is not None and diametro_previo != orden.diametro_mm
        horas_cambio = linea.minutos_cambio / 60.0 if cambia else 0.0
        horas_produccion = orden.kilogramos / kgh
        diametro_previo = orden.diametro_mm

        # Cuanto alcanza a salir con las horas que quedan.
        disponibles = max(0.0, restantes - horas_cambio)
        kg_producibles = min(orden.kilogramos, disponibles * kgh)
        restantes = max(0.0, restantes - horas_cambio - horas_produccion)

        resultado.corridas.append(
            Corrida(orden, kgh, horas_produccion, horas_cambio, kg_producibles)
        )

    return resultado


def evaluar_programa(
    programa: Programa, lineas: list[Linea], tabla: TablaVelocidades
) -> Evaluacion:
    """Evalua el schedule completo, linea por linea."""
    por_clave = {l.clave: l for l in lineas}
    desconocidas = sorted(set(programa.lineas_usadas()) - set(por_clave))
    if desconocidas:
        raise KeyError(
            "el schedule usa lineas que no estan en el catalogo: "
            + ", ".join(desconocidas)
        )

    evaluacion = Evaluacion()
    for linea in lineas:
        evaluacion.lineas[linea.clave] = evaluar_linea(
            linea, programa.de_linea(linea.clave), tabla
        )
    return evaluacion
