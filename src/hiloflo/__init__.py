"""HILO-FLO: apoyo a la programacion de las lineas ITW de Mubea Florence.

Toma el WI-FLO-CSW-P-526 (velocidades de receta en mm/s por diametro) y el
production schedule de SAP, calcula el rendimiento en kg/h de cada orden en
cada linea, y propone reasignaciones que aumenten la tonelada del horizonte.
"""

from .modelos import (
    Linea,
    Orden,
    Programa,
    PuntoVelocidad,
    linea_a_work_center,
    work_center_a_linea,
)
from .rendimiento import (
    DENSIDAD_ACERO,
    TablaVelocidades,
    area_mm2,
    kg_hora,
    peso_lineal_kg_m,
)
from .catalogo import catalogo_predeterminado, escribir_catalogo, leer_catalogo
from .parametros import leer_velocidades
from .schedule import leer_programa
from .programa import Corrida, Evaluacion, ResultadoLinea, evaluar_programa
from .optimizador import Oportunidad, Propuesta, buscar_oportunidades

__version__ = "0.1.0"

__all__ = [
    "Linea",
    "Orden",
    "Programa",
    "PuntoVelocidad",
    "linea_a_work_center",
    "work_center_a_linea",
    "DENSIDAD_ACERO",
    "TablaVelocidades",
    "area_mm2",
    "kg_hora",
    "peso_lineal_kg_m",
    "catalogo_predeterminado",
    "escribir_catalogo",
    "leer_catalogo",
    "leer_velocidades",
    "leer_programa",
    "Corrida",
    "Evaluacion",
    "ResultadoLinea",
    "evaluar_programa",
    "Oportunidad",
    "Propuesta",
    "buscar_oportunidades",
    "__version__",
]
