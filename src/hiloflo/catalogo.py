"""Catalogo de lineas.

Ni el WI de parametros ni el schedule traen las horas disponibles, la
eficiencia real ni el tiempo de cambio de medida de cada linea. Mientras
Florence no nos pase esos numeros, se trabaja con un catalogo por omision
y se sobreescribe con un CSV cuando se tengan los datos buenos.
"""

from __future__ import annotations

import csv
from pathlib import Path

from .modelos import Linea

# Lineas instaladas hoy en Florence.
LINEAS_INSTALADAS = tuple(f"ITW-{n}" for n in range(1, 15))

# ITW-15 esta por instalarse: entra al catalogo desactivada, para poder
# simular su arranque sin que el optimizador le mande carga todavia.
LINEA_POR_INSTALAR = "ITW-15"

# Supuestos por omision. PENDIENTES DE CONFIRMAR CON PLANTA.
HORAS_SEMANA = 144.0  # 6 dias x 24 h
# Eficiencia desactivada a proposito: por ahora el analisis se hace contra la
# velocidad de receta tal cual, sin castigarla. Cuando planta nos de un OEE
# medido se sube aqui o por linea en el catalogo CSV.
EFICIENCIA = 1.0
MINUTOS_CAMBIO = 45.0


def catalogo_predeterminado(
    *,
    horas_disponibles: float = HORAS_SEMANA,
    eficiencia: float = EFICIENCIA,
    minutos_cambio: float = MINUTOS_CAMBIO,
    incluir_itw15: bool = True,
    itw15_activa: bool = False,
) -> list[Linea]:
    """Catalogo ITW-1..ITW-14 (mas ITW-15 desactivada) con los mismos supuestos."""
    lineas = [
        Linea(
            clave=clave,
            horas_disponibles=horas_disponibles,
            eficiencia=eficiencia,
            minutos_cambio=minutos_cambio,
        )
        for clave in LINEAS_INSTALADAS
    ]
    if incluir_itw15:
        lineas.append(
            Linea(
                clave=LINEA_POR_INSTALAR,
                horas_disponibles=horas_disponibles,
                eficiencia=eficiencia,
                minutos_cambio=minutos_cambio,
                activa=itw15_activa,
            )
        )
    return lineas


def leer_catalogo(ruta: str | Path) -> list[Linea]:
    """Lee el catalogo de un CSV con columnas:

        linea,horas_disponibles,eficiencia,minutos_cambio,activa
    """
    ruta = Path(ruta)
    if not ruta.exists():
        raise FileNotFoundError(f"no existe el catalogo: {ruta}")

    lineas = []
    with ruta.open(newline="", encoding="utf-8-sig") as f:
        for fila in csv.DictReader(f):
            clave = (fila.get("linea") or "").strip()
            if not clave:
                continue
            lineas.append(
                Linea(
                    clave=clave,
                    horas_disponibles=float(fila.get("horas_disponibles") or 0),
                    eficiencia=_eficiencia(fila.get("eficiencia")),
                    minutos_cambio=float(fila.get("minutos_cambio") or 0),
                    activa=_booleano(fila.get("activa")),
                )
            )
    if not lineas:
        raise ValueError(f"el catalogo {ruta.name} no trae ninguna linea")
    return lineas


def escribir_catalogo(lineas: list[Linea], ruta: str | Path) -> Path:
    """Vuelca el catalogo a CSV para que planta lo edite."""
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            ["linea", "horas_disponibles", "eficiencia", "minutos_cambio", "activa"]
        )
        for l in lineas:
            w.writerow(
                [
                    l.clave,
                    l.horas_disponibles,
                    l.eficiencia,
                    l.minutos_cambio,
                    "si" if l.activa else "no",
                ]
            )
    return ruta


def _eficiencia(valor) -> float:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return 1.0
    if numero <= 0:
        return 1.0
    return numero / 100.0 if numero > 1 else numero


def _booleano(valor) -> bool:
    if valor is None or str(valor).strip() == "":
        return True
    return str(valor).strip().lower() in {"si", "sí", "s", "true", "1", "x", "yes"}
