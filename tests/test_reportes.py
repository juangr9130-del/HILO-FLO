import csv

import pytest

from hiloflo.modelos import Linea, Orden, Programa, PuntoVelocidad
from hiloflo.optimizador import buscar_oportunidades
from hiloflo.programa import evaluar_programa
from hiloflo.rendimiento import TablaVelocidades
from hiloflo.reportes import exportar_todo


@pytest.fixture
def escenario():
    tabla = TablaVelocidades.construir(
        [
            PuntoVelocidad("ITW-1", 14.70, 100),
            PuntoVelocidad("ITW-7", 14.70, 200),
            PuntoVelocidad("ITW-13", 20.00, 100),
        ]
    )
    lineas = [
        Linea("ITW-1", horas_disponibles=100),
        Linea("ITW-7", horas_disponibles=100),
        Linea("ITW-13", horas_disponibles=100),
    ]
    programa = Programa(
        [
            Orden("A", 14.70, 5000, "ITW-1", secuencia=1),
            Orden("B", 20.00, 3000, "ITW-13", secuencia=1),
        ]
    )
    evaluacion = evaluar_programa(programa, lineas, tabla)
    propuesta = buscar_oportunidades(programa, lineas, tabla)
    return tabla, programa, evaluacion, propuesta


def leer(ruta):
    with open(ruta, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_exporta_los_cuatro_csv(tmp_path, escenario):
    archivos = exportar_todo(tmp_path, *escenario)
    assert [a.name for a in archivos] == [
        "rendimiento_kg_h.csv",
        "evaluacion_lineas.csv",
        "movimientos_propuestos.csv",
        "schedule_propuesto.csv",
    ]
    assert all(a.exists() for a in archivos)


def test_matriz_deja_vacia_la_linea_sin_receta(tmp_path, escenario):
    exportar_todo(tmp_path, *escenario)
    filas = {f["diametro_mm"]: f for f in leer(tmp_path / "rendimiento_kg_h.csv")}
    assert filas["14.70"]["ITW-13"] == ""  # ITW-13 no corre 14.70 mm
    assert float(filas["14.70"]["ITW-7"]) > float(filas["14.70"]["ITW-1"])


def test_matriz_marca_la_mejor_linea(tmp_path, escenario):
    exportar_todo(tmp_path, *escenario)
    filas = {f["diametro_mm"]: f for f in leer(tmp_path / "rendimiento_kg_h.csv")}
    assert filas["14.70"]["mejor_linea"] == "ITW-7"


def test_schedule_propuesto_marca_las_ordenes_movidas(tmp_path, escenario):
    exportar_todo(tmp_path, *escenario)
    filas = {f["orden"]: f for f in leer(tmp_path / "schedule_propuesto.csv")}
    assert filas["A"]["movida"] == "si"
    assert filas["A"]["linea_original"] == "ITW-1"
    assert filas["A"]["linea"] == "ITW-7"
    assert filas["B"]["movida"] == "no"


def test_movimientos_traen_los_folios(tmp_path, escenario):
    exportar_todo(tmp_path, *escenario)
    filas = leer(tmp_path / "movimientos_propuestos.csv")
    assert len(filas) == 1
    assert filas[0]["folios"] == "A"
    assert float(filas[0]["horas_liberadas"]) > 0
