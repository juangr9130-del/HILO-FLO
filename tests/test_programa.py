import pytest

from hiloflo.modelos import Linea, Orden, Programa, PuntoVelocidad
from hiloflo.programa import evaluar_programa
from hiloflo.rendimiento import TablaVelocidades, kg_hora


@pytest.fixture
def tabla():
    return TablaVelocidades.construir(
        [
            PuntoVelocidad("ITW-1", 14.70, 170),
            PuntoVelocidad("ITW-1", 12.50, 200),
            PuntoVelocidad("ITW-7", 14.70, 200),
            PuntoVelocidad("ITW-13", 20.00, 100),
        ]
    )


def kgh(mm_s, diametro):
    return kg_hora(mm_s, diametro)


def test_horas_y_kilos_cuando_todo_cabe(tabla):
    lineas = [Linea("ITW-1", horas_disponibles=24)]
    programa = Programa([Orden("A", 14.70, 2300, "ITW-1", secuencia=1)])

    r = evaluar_programa(programa, lineas, tabla).lineas["ITW-1"]

    assert r.horas_produccion == pytest.approx(2300 / kgh(170, 14.70))
    assert r.kg_producibles == pytest.approx(2300)
    assert r.horas_sobregiro == 0
    assert r.horas_ociosas > 0


def test_recorta_los_kilos_que_no_caben_en_el_horizonte(tabla):
    lineas = [Linea("ITW-1", horas_disponibles=1)]
    programa = Programa([Orden("A", 14.70, 100000, "ITW-1", secuencia=1)])

    r = evaluar_programa(programa, lineas, tabla).lineas["ITW-1"]

    assert r.kg_programados == pytest.approx(100000)
    assert r.kg_producibles == pytest.approx(kgh(170, 14.70))  # 1 h de corrida
    assert r.horas_sobregiro > 0


def test_cobra_el_cambio_de_medida_solo_al_cambiar_de_diametro(tabla):
    lineas = [Linea("ITW-1", horas_disponibles=100, minutos_cambio=60)]
    programa = Programa(
        [
            Orden("A", 14.70, 2300, "ITW-1", secuencia=1),
            Orden("B", 14.70, 2300, "ITW-1", secuencia=2),  # mismo diametro
            Orden("C", 12.50, 2300, "ITW-1", secuencia=3),  # cambia
        ]
    )

    r = evaluar_programa(programa, lineas, tabla).lineas["ITW-1"]

    assert r.cambios == 1
    assert r.horas_cambio == pytest.approx(1.0)


def test_la_secuencia_manda_sobre_el_orden_de_la_lista(tabla):
    lineas = [Linea("ITW-1", horas_disponibles=100, minutos_cambio=60)]
    # Intercalado en la lista, pero la secuencia los agrupa por diametro
    programa = Programa(
        [
            Orden("A", 14.70, 2300, "ITW-1", secuencia=1),
            Orden("C", 12.50, 2300, "ITW-1", secuencia=3),
            Orden("B", 14.70, 2300, "ITW-1", secuencia=2),
        ]
    )
    assert evaluar_programa(programa, lineas, tabla).lineas["ITW-1"].cambios == 1


def test_reporta_orden_en_linea_sin_receta(tabla):
    lineas = [Linea("ITW-13", horas_disponibles=24)]
    programa = Programa([Orden("A", 14.70, 2300, "ITW-13", secuencia=1)])

    evaluacion = evaluar_programa(programa, lineas, tabla)

    assert [o.id for o in evaluacion.sin_receta] == ["A"]
    assert evaluacion.kg_producibles == 0
    assert evaluacion.lineas["ITW-13"].horas_requeridas == 0


def test_falla_si_el_schedule_usa_una_linea_fuera_del_catalogo(tabla):
    programa = Programa([Orden("A", 14.70, 2300, "ITW-99", secuencia=1)])
    with pytest.raises(KeyError, match="ITW-99"):
        evaluar_programa(programa, [Linea("ITW-1", horas_disponibles=24)], tabla)


def test_totales_suman_todas_las_lineas(tabla):
    lineas = [
        Linea("ITW-1", horas_disponibles=100),
        Linea("ITW-7", horas_disponibles=100),
    ]
    programa = Programa(
        [
            Orden("A", 14.70, 2300, "ITW-1", secuencia=1),
            Orden("B", 14.70, 2300, "ITW-7", secuencia=1),
        ]
    )

    evaluacion = evaluar_programa(programa, lineas, tabla)

    assert evaluacion.kg_programados == pytest.approx(4600)
    assert evaluacion.toneladas_producibles == pytest.approx(4.6)
    assert evaluacion.kg_no_producibles == pytest.approx(0)
    assert "ITW-1" in evaluacion.resumen() and "TOTAL" in evaluacion.resumen()


def test_linea_mas_rapida_tarda_menos(tabla):
    lineas = [
        Linea("ITW-1", horas_disponibles=100),
        Linea("ITW-7", horas_disponibles=100),
    ]
    programa = Programa(
        [
            Orden("A", 14.70, 2300, "ITW-1", secuencia=1),
            Orden("B", 14.70, 2300, "ITW-7", secuencia=1),
        ]
    )
    evaluacion = evaluar_programa(programa, lineas, tabla)
    assert (
        evaluacion.lineas["ITW-7"].horas_produccion
        < evaluacion.lineas["ITW-1"].horas_produccion
    )
