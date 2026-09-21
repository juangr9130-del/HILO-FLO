"""Salidas en CSV para que planta las abra en Excel.

    rendimiento_kg_h.csv      matriz diametro x linea con el kg/h de cada
                              combinacion (lo que hoy no existe en ningun lado)
    evaluacion_lineas.csv     carga, horas y utilizacion de cada linea
    movimientos_propuestos.csv  las reasignaciones sugeridas
    schedule_propuesto.csv    el schedule ya con los movimientos aplicados
"""

from __future__ import annotations

import csv
from pathlib import Path

from .modelos import Orden, Programa
from .optimizador import Propuesta
from .programa import Evaluacion
from .rendimiento import TablaVelocidades


def diametros_del_programa(programa: Programa) -> list[float]:
    return sorted({o.diametro_mm for o in programa.ordenes})


def matriz_rendimiento(
    tabla: TablaVelocidades,
    programa: Programa,
    ruta: str | Path,
) -> Path:
    """kg/h de cada diametro del schedule en cada linea.

    La celda vacia significa que la linea no tiene receta para ese diametro,
    es decir que no lo puede correr.
    """
    ruta = _preparar(ruta)
    lineas = tabla.lineas
    # Una orden por diametro basta para consultar: el rendimiento depende del
    # diametro y de los discriminantes, no de los kilos.
    representantes: dict[float, Orden] = {}
    for orden in programa.ordenes:
        representantes.setdefault(orden.diametro_mm, orden)

    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["diametro_mm"] + lineas + ["mejor_linea", "mejor_kg_h"])
        for diametro in sorted(representantes):
            orden = representantes[diametro]
            celdas = []
            mejor_linea, mejor_kgh = "", 0.0
            for linea in lineas:
                kgh = tabla.kg_hora(linea, orden)
                celdas.append(f"{kgh:.1f}" if kgh else "")
                if kgh and kgh > mejor_kgh:
                    mejor_linea, mejor_kgh = linea, kgh
            w.writerow(
                [f"{diametro:.2f}"]
                + celdas
                + [mejor_linea, f"{mejor_kgh:.1f}" if mejor_kgh else ""]
            )
    return ruta


def evaluacion_lineas(evaluacion: Evaluacion, ruta: str | Path) -> Path:
    ruta = _preparar(ruta)
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "linea",
                "ordenes",
                "kg_programados",
                "kg_producibles",
                "horas_produccion",
                "horas_cambio",
                "cambios_de_medida",
                "horas_disponibles",
                "utilizacion_pct",
                "horas_ociosas",
                "horas_sobregiro",
            ]
        )
        for clave in sorted(evaluacion.lineas, key=_natural):
            r = evaluacion.lineas[clave]
            w.writerow(
                [
                    clave,
                    len(r.corridas),
                    f"{r.kg_programados:.0f}",
                    f"{r.kg_producibles:.0f}",
                    f"{r.horas_produccion:.2f}",
                    f"{r.horas_cambio:.2f}",
                    r.cambios,
                    f"{r.linea.horas_disponibles:.1f}",
                    f"{r.utilizacion * 100:.1f}",
                    f"{r.horas_ociosas:.2f}",
                    f"{r.horas_sobregiro:.2f}",
                ]
            )
    return ruta


def movimientos_propuestos(propuesta: Propuesta, ruta: str | Path) -> Path:
    ruta = _preparar(ruta)
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "origen",
                "destino",
                "diametro_mm",
                "ordenes",
                "kilogramos",
                "horas_en_origen",
                "horas_en_destino",
                "horas_liberadas",
                "folios",
            ]
        )
        for g in propuesta.agrupadas():
            w.writerow(
                [
                    g.origen,
                    g.destino,
                    f"{g.diametro_mm:.2f}",
                    len(g.ordenes),
                    f"{g.kilogramos:.0f}",
                    f"{g.horas_origen:.2f}",
                    f"{g.horas_destino:.2f}",
                    f"{g.horas_liberadas:.2f}",
                    g.ids(),
                ]
            )
    return ruta


def schedule_propuesto(propuesta: Propuesta, ruta: str | Path) -> Path:
    ruta = _preparar(ruta)
    origen_de = {o.id: o.linea for o in propuesta.programa_original}
    ordenes = sorted(
        propuesta.programa_propuesto.ordenes,
        key=lambda o: (_natural(o.linea), o.secuencia),
    )
    with ruta.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "linea",
                "work_center",
                "secuencia",
                "orden",
                "material",
                "descripcion",
                "diametro_mm",
                "kilogramos",
                "linea_original",
                "movida",
            ]
        )
        for o in ordenes:
            original = origen_de.get(o.id, o.linea)
            w.writerow(
                [
                    o.linea,
                    _work_center(o.linea),
                    o.secuencia,
                    o.id,
                    o.material,
                    o.descripcion,
                    f"{o.diametro_mm:.2f}",
                    f"{o.kilogramos:.0f}",
                    original,
                    "si" if original != o.linea else "no",
                ]
            )
    return ruta


def exportar_todo(
    carpeta: str | Path,
    tabla: TablaVelocidades,
    programa: Programa,
    evaluacion: Evaluacion,
    propuesta: Propuesta,
) -> list[Path]:
    carpeta = Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True)
    return [
        matriz_rendimiento(tabla, programa, carpeta / "rendimiento_kg_h.csv"),
        evaluacion_lineas(evaluacion, carpeta / "evaluacion_lineas.csv"),
        movimientos_propuestos(propuesta, carpeta / "movimientos_propuestos.csv"),
        schedule_propuesto(propuesta, carpeta / "schedule_propuesto.csv"),
    ]


def _preparar(ruta: str | Path) -> Path:
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    return ruta


def _work_center(linea: str) -> str:
    from .modelos import linea_a_work_center

    return linea_a_work_center(linea)


def _natural(linea: str):
    import re

    m = re.search(r"(\d+)", linea)
    return (0, int(m.group(1))) if m else (1, linea)
