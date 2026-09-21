"""Rendimiento: de mm/s de receta a kilogramos por hora.

El WI-FLO-CSW-P-526 da la velocidad de linea en mm/s por diametro de
alambre estirado. Como el alambre es sólido y el temple no cambia la
seccion, el rendimiento masico sale directo de la geometria:

    area (mm2)      = pi/4 * d^2
    peso lineal     = area * densidad
    kg/h            = velocidad(mm/s) * 3600 * peso_lineal * eficiencia

Ejemplo: 170 mm/s de alambre de 14.70 mm -> ~815 kg/h.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Literal

from .modelos import Linea, Orden, PuntoVelocidad

# Acero de resorte (9254 / 54SiCr6 / 60SiCr7 / SAE1065). kg/m3.
DENSIDAD_ACERO = 7850.0

# Como resolver un diametro que no cae exacto en la retícula de la receta.
#   "arriba"  -> toma el punto tabulado inmediato superior (conservador:
#                a mayor diametro, menor velocidad)
#   "cercano" -> toma el punto tabulado mas cercano
Politica = Literal["arriba", "cercano"]

# Tolerancia al buscar el diametro en la tabla (mm). La retícula del WI es
# de 0.05 mm, asi que 0.30 mm cubre de sobra cualquier redondeo del schedule.
TOLERANCIA_MM = 0.30


def area_mm2(diametro_mm: float) -> float:
    """Seccion transversal del alambre."""
    if diametro_mm <= 0:
        raise ValueError("el diametro debe ser positivo")
    return math.pi / 4.0 * diametro_mm**2


def peso_lineal_kg_m(
    diametro_mm: float, densidad_kg_m3: float = DENSIDAD_ACERO
) -> float:
    """Kilogramos por metro de alambre."""
    # mm2 -> m2 son 1e-6
    return area_mm2(diametro_mm) * 1e-6 * densidad_kg_m3


def kg_hora(
    mm_s: float,
    diametro_mm: float,
    *,
    eficiencia: float = 1.0,
    densidad_kg_m3: float = DENSIDAD_ACERO,
) -> float:
    """Rendimiento masico de una linea corriendo esa receta."""
    if mm_s < 0:
        raise ValueError("la velocidad no puede ser negativa")
    metros_hora = mm_s * 3600.0 / 1000.0
    return metros_hora * peso_lineal_kg_m(diametro_mm, densidad_kg_m3) * eficiencia


@dataclass
class TablaVelocidades:
    """Las recetas del WI-FLO-CSW-P-526, consultables por linea y orden.

    Es tambien la matriz de compatibilidad: si una linea no tiene receta
    para el diametro de una orden, esa linea no puede correrla.
    """

    puntos: list[PuntoVelocidad]
    eficiencias: dict[str, float]
    densidad_kg_m3: float = DENSIDAD_ACERO
    politica: Politica = "arriba"
    tolerancia_mm: float = TOLERANCIA_MM
    _por_linea: dict[str, list[PuntoVelocidad]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        indice: dict[str, list[PuntoVelocidad]] = {}
        for p in self.puntos:
            indice.setdefault(p.linea, []).append(p)
        for lista in indice.values():
            lista.sort(key=lambda p: p.diametro_mm)
        self._por_linea = indice
        # El optimizador consulta la misma combinacion miles de veces; sin
        # memoria, cada consulta recorre las ~260 recetas de la linea.
        self._cache_receta: dict[tuple, PuntoVelocidad | None] = {}
        self._cache_kg_hora: dict[tuple, float | None] = {}

    @staticmethod
    def _firma(orden: Orden) -> tuple:
        """Lo unico de la orden que cambia la receta y el rendimiento."""
        return (orden.diametro_mm, orden.grupo_grado, orden.slm, orden.winder)

    # -- construccion -------------------------------------------------

    @classmethod
    def construir(
        cls,
        puntos: Iterable[PuntoVelocidad],
        lineas: Iterable[Linea] | None = None,
        **kwargs,
    ) -> "TablaVelocidades":
        eficiencias = {l.clave: l.eficiencia for l in (lineas or [])}
        return cls(puntos=list(puntos), eficiencias=eficiencias, **kwargs)

    # -- consulta -----------------------------------------------------

    @property
    def lineas(self) -> list[str]:
        return sorted(self._por_linea, key=_orden_natural)

    def diametros_de(self, linea: str) -> list[float]:
        return sorted({p.diametro_mm for p in self._por_linea.get(linea, ())})

    def rango_de(self, linea: str) -> tuple[float, float] | None:
        ds = self.diametros_de(linea)
        return (ds[0], ds[-1]) if ds else None

    def receta(self, linea: str, orden: Orden) -> PuntoVelocidad | None:
        """La receta que aplica a esa orden en esa linea, o None."""
        clave = (linea, self._firma(orden))
        if clave in self._cache_receta:
            return self._cache_receta[clave]
        receta = self._buscar_receta(linea, orden)
        self._cache_receta[clave] = receta
        return receta

    def _buscar_receta(self, linea: str, orden: Orden) -> PuntoVelocidad | None:
        candidatos = [
            p for p in self._por_linea.get(linea, ()) if p.aplica_a(orden)
        ]
        if not candidatos:
            return None
        diametro = self._resolver_diametro(candidatos, orden.diametro_mm)
        if diametro is None:
            return None
        # De los puntos de ese diametro gana el mas especifico y, a igualdad,
        # el mas lento (criterio conservador).
        en_diametro = [p for p in candidatos if p.diametro_mm == diametro]
        en_diametro.sort(key=lambda p: (-p.especificidad, p.mm_s))
        return en_diametro[0]

    def _resolver_diametro(
        self, candidatos: list[PuntoVelocidad], diametro_mm: float
    ) -> float | None:
        disponibles = sorted({p.diametro_mm for p in candidatos})
        exactos = [d for d in disponibles if abs(d - diametro_mm) < 1e-9]
        if exactos:
            return exactos[0]
        if self.politica == "arriba":
            arriba = [d for d in disponibles if d >= diametro_mm]
            if arriba and arriba[0] - diametro_mm <= self.tolerancia_mm:
                return arriba[0]
        cercano = min(disponibles, key=lambda d: abs(d - diametro_mm))
        if abs(cercano - diametro_mm) <= self.tolerancia_mm:
            return cercano
        return None

    def mm_s(self, linea: str, orden: Orden) -> float | None:
        receta = self.receta(linea, orden)
        return receta.mm_s if receta else None

    def kg_hora(self, linea: str, orden: Orden) -> float | None:
        """Rendimiento de esa orden en esa linea, ya con eficiencia."""
        clave = (linea, self._firma(orden))
        if clave in self._cache_kg_hora:
            return self._cache_kg_hora[clave]
        valor = self._calcular_kg_hora(linea, orden)
        self._cache_kg_hora[clave] = valor
        return valor

    def _calcular_kg_hora(self, linea: str, orden: Orden) -> float | None:
        receta = self.receta(linea, orden)
        if receta is None:
            return None
        return kg_hora(
            receta.mm_s,
            orden.diametro_mm,
            eficiencia=self.eficiencias.get(linea, 1.0),
            densidad_kg_m3=self.densidad_kg_m3,
        )

    def puede_correr(self, linea: str, orden: Orden) -> bool:
        return self.receta(linea, orden) is not None

    def lineas_para(self, orden: Orden) -> list[str]:
        """Lineas capaces de correr la orden, de la mas rapida a la mas lenta."""
        capaces = []
        for linea in self._por_linea:
            kgh = self.kg_hora(linea, orden)
            if kgh:
                capaces.append((linea, kgh))
        capaces.sort(key=lambda par: (-par[1], _orden_natural(par[0])))
        return [l for l, _ in capaces]

    def horas_para(self, linea: str, orden: Orden) -> float | None:
        kgh = self.kg_hora(linea, orden)
        return None if not kgh else orden.kilogramos / kgh

    def __len__(self) -> int:
        return len(self.puntos)


def _orden_natural(linea: str) -> tuple:
    """Ordena ITW-2 antes que ITW-10."""
    import re

    m = re.search(r"(\d+)", linea)
    return (0, int(m.group(1))) if m else (1, linea)
