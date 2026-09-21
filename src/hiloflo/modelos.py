"""Modelo de dominio de HILO-FLO (Mubea Florence, lineas ITW).

Vocabulario de planta:
  ITW      Induction Tempered Wire: las lineas de temple por induccion.
  Linea    ITW-1 .. ITW-14 (la 15 esta por instalarse). En SAP son los
           work centers BB001 .. BB014.
  Orden    un renglon del production schedule: N kg de un alambre de cierto
           diametro, ya asignado a un work center.
  Programa el conjunto de ordenes del horizonte que se esta programando.

La velocidad de linea viene en mm/s por diametro de alambre estirado
(WI-FLO-CSW-P-526), y de ahi sale el rendimiento en kg/h.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import Iterable

# --------------------------------------------------------------------------
# Equivalencia work center SAP <-> linea ITW
# --------------------------------------------------------------------------

def work_center_a_linea(work_center: str) -> str:
    """BB001 -> ITW-1. Si no reconoce el patron, regresa el texto tal cual."""
    m = re.fullmatch(r"\s*BB0*(\d+)\s*", str(work_center), re.I)
    return f"ITW-{int(m.group(1))}" if m else str(work_center).strip()


def linea_a_work_center(linea: str) -> str:
    """ITW-1 -> BB001."""
    m = re.fullmatch(r"\s*ITW[-\s]?(\d+)\s*", str(linea), re.I)
    return f"BB{int(m.group(1)):03d}" if m else str(linea).strip()


# --------------------------------------------------------------------------
# Catalogo de lineas
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Linea:
    """Una linea de temple por induccion."""

    clave: str  # "ITW-1"
    horas_disponibles: float = 0.0
    eficiencia: float = 1.0  # castiga la velocidad teorica de la receta
    minutos_cambio: float = 0.0  # cambio de medida / receta
    activa: bool = True  # ITW-15 sigue por instalarse

    def __post_init__(self) -> None:
        if not 0 < self.eficiencia <= 1:
            raise ValueError(f"{self.clave}: eficiencia debe estar en (0, 1]")
        if self.horas_disponibles < 0:
            raise ValueError(f"{self.clave}: horas_disponibles no puede ser negativa")

    @property
    def work_center(self) -> str:
        return linea_a_work_center(self.clave)


# --------------------------------------------------------------------------
# Velocidades de receta
# --------------------------------------------------------------------------


# Devanador que corre la linea cuando el schedule no indica otra cosa. El WI
# solo tabula el DEM para ITW-2, y su nota dice que el schedule lo marca en
# la seccion de notas; sin esa marca, corre el Neturen.
WINDER_PREDETERMINADO = "NETUREN"


@dataclass(frozen=True)
class PuntoVelocidad:
    """Una celda de la tabla ITW Line Speed del WI-FLO-CSW-P-526.

    Los campos ``winder``, ``grado`` y ``slm`` son los discriminantes que
    trae el documento: ITW-2 se tabula por devanador (Neturen / DEM) y por
    grado (9254 vs 1065); ITW-10 se tabula por SLM / NON SLM. ``None``
    significa "aplica a cualquiera".
    """

    linea: str
    diametro_mm: float
    mm_s: float
    winder: str | None = None  # "NETUREN" | "DEM"
    grado: str | None = None  # "9254" | "1065"
    slm: bool | None = None

    def __post_init__(self) -> None:
        if self.mm_s <= 0:
            raise ValueError(f"{self.linea}@{self.diametro_mm}: mm_s debe ser > 0")
        if self.diametro_mm <= 0:
            raise ValueError(f"{self.linea}: diametro_mm debe ser > 0")

    def aplica_a(self, orden: "Orden") -> bool:
        """True si esta receta es usable para la orden."""
        if self.winder is not None:
            # Sin devanador indicado en el schedule, solo aplica la receta del
            # devanador de planta; tomar la del DEM inflaria el rendimiento.
            esperado = orden.winder or WINDER_PREDETERMINADO
            if self.winder != esperado:
                return False
        if self.grado is not None and self.grado != orden.grupo_grado:
            return False
        if self.slm is not None and self.slm != orden.slm:
            return False
        return True

    @property
    def especificidad(self) -> int:
        """Cuantos discriminantes fija. Gana la receta mas especifica."""
        return sum(x is not None for x in (self.winder, self.grado, self.slm))


# --------------------------------------------------------------------------
# Ordenes y programa
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Orden:
    """Un renglon del production schedule."""

    id: str  # numero de orden SAP
    diametro_mm: float
    kilogramos: float
    linea: str  # "ITW-7"
    material: str = ""  # numero de material SAP
    descripcion: str = ""
    grupo_grado: str = "9254"  # "9254" (incluye 54SiCr6/60SiCr) o "1065"
    slm: bool = False
    winder: str | None = None  # "DEM" si el schedule lo indica en notas
    secuencia: int = 0
    notas: str = ""
    cliente_po: str = ""
    fijo: bool = False  # el optimizador no lo puede mover

    def __post_init__(self) -> None:
        if self.kilogramos <= 0:
            raise ValueError(f"orden {self.id}: kilogramos debe ser > 0")
        if self.diametro_mm <= 0:
            raise ValueError(f"orden {self.id}: diametro_mm debe ser > 0")

    @property
    def medida(self) -> str:
        """Etiqueta legible del diametro, para agrupar y reportar."""
        return f"{self.diametro_mm:.2f}"

    def mover_a(self, linea: str, secuencia: int | None = None) -> "Orden":
        return replace(
            self,
            linea=linea,
            secuencia=self.secuencia if secuencia is None else secuencia,
        )


@dataclass
class Programa:
    """El production schedule del horizonte."""

    ordenes: list[Orden] = field(default_factory=list)
    horizonte: str = ""

    def __iter__(self):
        return iter(self.ordenes)

    def __len__(self) -> int:
        return len(self.ordenes)

    @property
    def kilogramos(self) -> float:
        return sum(o.kilogramos for o in self.ordenes)

    def de_linea(self, linea: str) -> list[Orden]:
        """Ordenes de una linea, en la secuencia en que estan programadas."""
        return sorted(
            (o for o in self.ordenes if o.linea == linea),
            key=lambda o: (o.secuencia, o.id),
        )

    def lineas_usadas(self) -> list[str]:
        return sorted({o.linea for o in self.ordenes})

    def reemplazar(self, ordenes: Iterable[Orden]) -> "Programa":
        return Programa(ordenes=list(ordenes), horizonte=self.horizonte)

    def con_orden(self, orden: Orden) -> "Programa":
        """Copia del programa sustituyendo la orden con el mismo id."""
        return self.reemplazar(
            orden if o.id == orden.id else o for o in self.ordenes
        )
