"""Lector del production schedule (Schedule_8200_<fecha>.xlsx).

La hoja "Sheet1" trae el volcado de SAP: una orden por renglon, ya
asignada a un work center (BB001..BB014 = ITW-1..ITW-14).

    Work Center | Material Number | Material Description | Important Notes
    Order | PO Printed | Drawn | Operation Quantity (MEINH) | Customer PO

El diametro no viene en columna propia: va dentro de la descripcion
("CSW,14.70mm HT HT 1950-2000 MPa", "CSW, 7,92 1450-1610 SAE1065 half SID"),
con coma o punto decimal. De ahi se saca tambien el grado y la marca SLM.

Cada bloque de work center cierra con un renglon de subtotal (material
"nan" y orden "0") y el archivo cierra con el gran total; ambos se ignoran.
"""

from __future__ import annotations

import re
from pathlib import Path

from .modelos import Orden, Programa, work_center_a_linea

HOJA_PREDETERMINADA = "Sheet1"

FILA_ENCABEZADOS = 2

# Diametro dentro de la descripcion: 1 o 2 enteros y 1 o 2 decimales.
RE_DIAMETRO = re.compile(r"(\d{1,2}[.,]\d{1,2})\s*(?:mm)?", re.I)

# Rango plausible de diametro de alambre estirado (mm). Descarta falsos
# positivos como el rango de resistencia "1950-2000 MPa".
DIAMETRO_MIN = 4.0
DIAMETRO_MAX = 30.0

# Grados que el WI tabula aparte en ITW-2. Todo lo demas cae en "9254".
GRADO_1065 = ("1065",)

ALIAS = {
    "work center": "work_center",
    "material number": "material",
    "material description": "descripcion",
    "important notes": "notas",
    "order": "orden",
    "operation quantity (meinh)": "cantidad",
    "customer po": "cliente_po",
}


def leer_programa(
    ruta: str | Path, hoja: str | None = None, horizonte: str = ""
) -> Programa:
    """Lee el schedule y devuelve el programa con sus ordenes."""
    ruta = Path(ruta)
    if not ruta.exists():
        raise FileNotFoundError(f"no existe el archivo: {ruta}")

    try:
        from openpyxl import load_workbook
    except ImportError as exc:  # pragma: no cover - depende del entorno
        raise ImportError(
            "se requiere openpyxl para leer el schedule "
            "(pip install -r requirements.txt)"
        ) from exc

    wb = load_workbook(ruta, data_only=True)
    ws = wb[hoja] if hoja else wb[
        HOJA_PREDETERMINADA if HOJA_PREDETERMINADA in wb.sheetnames
        else wb.sheetnames[0]
    ]

    columnas = _mapear_columnas(ws)
    ordenes: list[Orden] = []
    secuencias: dict[str, int] = {}

    for fila in range(FILA_ENCABEZADOS + 1, ws.max_row + 1):
        datos = {
            nombre: ws.cell(fila, col).value for nombre, col in columnas.items()
        }
        work_center = _texto(datos.get("work_center"))
        descripcion = _texto(datos.get("descripcion"))
        cantidad = _numero(datos.get("cantidad"))

        if not work_center or not descripcion or not cantidad or cantidad <= 0:
            continue  # renglones de subtotal y gran total

        diametro = diametro_de(descripcion)
        if diametro is None:
            continue

        linea = work_center_a_linea(work_center)
        secuencias[linea] = secuencias.get(linea, 0) + 1
        notas = _texto(datos.get("notas"))

        ordenes.append(
            Orden(
                id=_texto(datos.get("orden")) or f"{linea}-{secuencias[linea]:03d}",
                diametro_mm=diametro,
                kilogramos=cantidad,
                linea=linea,
                material=_texto(datos.get("material")),
                descripcion=descripcion,
                grupo_grado=grado_de(descripcion),
                slm=es_slm(descripcion),
                winder=winder_de(f"{descripcion} {notas}"),
                secuencia=secuencias[linea],
                notas=notas,
                cliente_po=_texto(datos.get("cliente_po")),
            )
        )

    if not ordenes:
        raise ValueError(
            f"no se leyo ninguna orden de {ruta.name}; "
            "revisa la hoja y los encabezados"
        )
    return Programa(ordenes=ordenes, horizonte=horizonte or ruta.stem)


# --------------------------------------------------------------------------
# Interpretacion de la descripcion del material
# --------------------------------------------------------------------------


def diametro_de(descripcion: str) -> float | None:
    """Primer numero de la descripcion que sea un diametro plausible."""
    for bruto in RE_DIAMETRO.findall(descripcion):
        valor = float(bruto.replace(",", "."))
        if DIAMETRO_MIN <= valor <= DIAMETRO_MAX:
            return round(valor, 2)
    return None


def grado_de(descripcion: str) -> str:
    """Grupo de grado tal como lo discrimina el WI: "1065" o "9254"."""
    texto = descripcion.upper()
    return "1065" if any(g in texto for g in GRADO_1065) else "9254"


def es_slm(descripcion: str) -> bool:
    """SLM (Super Low Modulus) cambia la receta de ITW-10."""
    return re.search(r"\bSLM\b", descripcion.upper()) is not None


def winder_de(texto: str) -> str | None:
    """El schedule marca en notas el uso del devanador DEM (aplica a ITW-2)."""
    return "DEM" if re.search(r"\bDEM\b", texto.upper()) else None


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------


def _mapear_columnas(ws) -> dict[str, int]:
    """Encabezado -> numero de columna, tolerante a mayusculas y espacios."""
    columnas: dict[str, int] = {}
    for col in range(1, ws.max_column + 1):
        encabezado = _texto(ws.cell(FILA_ENCABEZADOS, col).value).lower()
        if encabezado in ALIAS:
            columnas[ALIAS[encabezado]] = col
    faltantes = {"work_center", "descripcion", "cantidad"} - set(columnas)
    if faltantes:
        raise ValueError(
            "al schedule le faltan columnas obligatorias: "
            + ", ".join(sorted(faltantes))
        )
    return columnas


def _texto(valor) -> str:
    if valor is None:
        return ""
    texto = str(valor).strip()
    return "" if texto.lower() == "nan" else texto


def _numero(valor) -> float | None:
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).strip().replace(",", "")
    try:
        return float(texto)
    except ValueError:
        return None
