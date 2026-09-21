import math

import pytest

from hiloflo.modelos import Linea, Orden, PuntoVelocidad
from hiloflo.rendimiento import (
    DENSIDAD_ACERO,
    TablaVelocidades,
    area_mm2,
    kg_hora,
    peso_lineal_kg_m,
)


def orden(diametro=14.70, **kwargs):
    base = dict(id="X", diametro_mm=diametro, kilogramos=2300.0, linea="ITW-1")
    base.update(kwargs)
    return Orden(**base)


def test_area_mm2():
    assert area_mm2(10) == pytest.approx(math.pi * 25)


def test_peso_lineal_de_alambre_de_14_7_mm():
    # pi/4 * 14.7^2 = 169.7 mm2 -> 169.7e-6 m2 * 7850 kg/m3
    assert peso_lineal_kg_m(14.70) == pytest.approx(1.3322, rel=1e-3)


def test_kg_hora_valor_de_referencia():
    # 170 mm/s de alambre de 14.70 mm ~ 815 kg/h
    assert kg_hora(170, 14.70) == pytest.approx(815.3, rel=1e-3)


def test_kg_hora_escala_con_el_cuadrado_del_diametro():
    assert kg_hora(100, 20) == pytest.approx(4 * kg_hora(100, 10))


def test_kg_hora_aplica_eficiencia():
    assert kg_hora(170, 14.70, eficiencia=0.85) == pytest.approx(
        0.85 * kg_hora(170, 14.70)
    )


def test_densidad_configurable():
    assert kg_hora(100, 10, densidad_kg_m3=DENSIDAD_ACERO * 2) == pytest.approx(
        2 * kg_hora(100, 10)
    )


def test_kg_hora_rechaza_diametro_invalido():
    with pytest.raises(ValueError):
        kg_hora(100, 0)


# --------------------------------------------------------------------------
# TablaVelocidades
# --------------------------------------------------------------------------


@pytest.fixture
def tabla():
    puntos = [
        PuntoVelocidad("ITW-1", 14.70, 170),
        PuntoVelocidad("ITW-1", 14.75, 168),
        PuntoVelocidad("ITW-7", 14.70, 200),
        PuntoVelocidad("ITW-13", 20.00, 100),
        # ITW-10 se tabula aparte por SLM
        PuntoVelocidad("ITW-10", 14.70, 190, slm=False),
        PuntoVelocidad("ITW-10", 14.70, 150, slm=True),
        # ITW-2 se tabula por devanador y grado
        PuntoVelocidad("ITW-2", 14.70, 275, winder="NETUREN"),
        PuntoVelocidad("ITW-2", 14.70, 375, winder="DEM", grado="9254"),
        PuntoVelocidad("ITW-2", 14.70, 450, winder="DEM", grado="1065"),
    ]
    lineas = [Linea("ITW-1", eficiencia=0.85), Linea("ITW-7")]
    return TablaVelocidades.construir(puntos, lineas)


def test_kg_hora_usa_la_eficiencia_de_la_linea(tabla):
    assert tabla.kg_hora("ITW-1", orden()) == pytest.approx(
        kg_hora(170, 14.70, eficiencia=0.85)
    )
    assert tabla.kg_hora("ITW-7", orden()) == pytest.approx(kg_hora(200, 14.70))


def test_linea_sin_receta_para_el_diametro(tabla):
    assert tabla.kg_hora("ITW-13", orden(14.70)) is None
    assert not tabla.puede_correr("ITW-13", orden(14.70))


def test_diametro_fuera_de_reticula_sube_al_punto_tabulado(tabla):
    # 14.72 no esta tabulado: con politica "arriba" cae en 14.75 (mas lento)
    assert tabla.receta("ITW-1", orden(14.72)).diametro_mm == 14.75


def test_diametro_lejos_de_la_reticula_no_tiene_receta(tabla):
    assert tabla.receta("ITW-1", orden(16.00)) is None


def test_slm_elige_la_receta_correcta(tabla):
    assert tabla.mm_s("ITW-10", orden(slm=False)) == 190
    assert tabla.mm_s("ITW-10", orden(slm=True)) == 150


def test_devanador_y_grado_eligen_la_receta_de_itw2(tabla):
    assert tabla.mm_s("ITW-2", orden(winder="NETUREN")) == 275
    assert tabla.mm_s("ITW-2", orden(winder="DEM", grupo_grado="9254")) == 375
    assert tabla.mm_s("ITW-2", orden(winder="DEM", grupo_grado="1065")) == 450


def test_sin_devanador_indicado_gana_la_receta_mas_conservadora(tabla):
    # El schedule no marco DEM: se queda con la mas lenta de las aplicables.
    assert tabla.mm_s("ITW-2", orden(winder=None, grupo_grado="9254")) == 275


def test_lineas_para_ordena_de_mas_rapida_a_mas_lenta(tabla):
    capaces = tabla.lineas_para(orden(14.70))
    assert capaces[0] == "ITW-2"  # 275 mm/s
    assert "ITW-13" not in capaces
    rendimientos = [tabla.kg_hora(l, orden(14.70)) for l in capaces]
    assert rendimientos == sorted(rendimientos, reverse=True)


def test_horas_para(tabla):
    kgh = tabla.kg_hora("ITW-7", orden())
    assert tabla.horas_para("ITW-7", orden()) == pytest.approx(2300.0 / kgh)
    assert tabla.horas_para("ITW-13", orden()) is None


def test_rango_de_linea(tabla):
    assert tabla.rango_de("ITW-1") == (14.70, 14.75)
    assert tabla.rango_de("ITW-99") is None


def test_la_cache_no_cambia_el_resultado(tabla):
    primera = tabla.kg_hora("ITW-1", orden())
    segunda = tabla.kg_hora("ITW-1", orden())
    assert primera == segunda
    # Dos ordenes distintas con la misma firma comparten entrada de cache
    assert tabla.kg_hora("ITW-1", orden(id="Y")) == primera
