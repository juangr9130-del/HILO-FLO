import pytest

from hiloflo.modelos import Linea, Orden, Programa, PuntoVelocidad
from hiloflo.optimizador import buscar_oportunidades
from hiloflo.rendimiento import TablaVelocidades


@pytest.fixture
def tabla():
    # ITW-7 es el doble de rapida que ITW-1 para el mismo diametro.
    return TablaVelocidades.construir(
        [
            PuntoVelocidad("ITW-1", 14.70, 100),
            PuntoVelocidad("ITW-7", 14.70, 200),
            PuntoVelocidad("ITW-1", 12.50, 150),
            PuntoVelocidad("ITW-13", 20.00, 100),
        ]
    )


@pytest.fixture
def lineas():
    return [
        Linea("ITW-1", horas_disponibles=100),
        Linea("ITW-7", horas_disponibles=100),
        Linea("ITW-13", horas_disponibles=100),
    ]


def test_mueve_a_la_linea_mas_rapida(tabla, lineas):
    programa = Programa([Orden("A", 14.70, 5000, "ITW-1", secuencia=1)])

    propuesta = buscar_oportunidades(programa, lineas, tabla)

    grupos = propuesta.agrupadas()
    assert len(grupos) == 1
    assert (grupos[0].origen, grupos[0].destino) == ("ITW-1", "ITW-7")
    assert grupos[0].horas_liberadas > 0
    assert propuesta.horas_liberadas > 0


def test_no_propone_nada_si_ya_esta_en_la_mejor_linea(tabla, lineas):
    programa = Programa([Orden("A", 14.70, 5000, "ITW-7", secuencia=1)])

    propuesta = buscar_oportunidades(programa, lineas, tabla)

    assert propuesta.agrupadas() == []
    assert "Sin areas de oportunidad" in propuesta.resumen()


def test_respeta_las_ordenes_fijas(tabla, lineas):
    programa = Programa([Orden("A", 14.70, 5000, "ITW-1", secuencia=1, fijo=True)])

    propuesta = buscar_oportunidades(programa, lineas, tabla)

    assert propuesta.agrupadas() == []


def test_no_manda_carga_a_una_linea_inactiva(tabla):
    lineas = [
        Linea("ITW-1", horas_disponibles=100),
        Linea("ITW-7", horas_disponibles=100, activa=False),
    ]
    programa = Programa([Orden("A", 14.70, 5000, "ITW-1", secuencia=1)])

    assert buscar_oportunidades(programa, lineas, tabla).agrupadas() == []


def test_no_mueve_a_una_linea_sin_receta_para_el_diametro(tabla, lineas):
    programa = Programa([Orden("A", 12.50, 5000, "ITW-1", secuencia=1)])

    propuesta = buscar_oportunidades(programa, lineas, tabla)

    # Solo ITW-1 tiene receta de 12.50 mm: no hay a donde moverla.
    assert propuesta.agrupadas() == []


def test_agrupa_varias_ordenes_del_mismo_diametro(tabla, lineas):
    programa = Programa(
        [
            Orden(f"A{n}", 14.70, 3000, "ITW-1", secuencia=n)
            for n in range(1, 4)
        ]
    )

    grupos = buscar_oportunidades(programa, lineas, tabla).agrupadas()

    assert len(grupos) == 1
    assert len(grupos[0].ordenes) == 3
    assert grupos[0].kilogramos == pytest.approx(9000)
    assert "3 ordenes" in grupos[0].describir()


def test_el_neto_no_reporta_viajes_de_ida_y_vuelta(tabla, lineas):
    """El diff contra el schedule propuesto no puede contener una orden que
    termino en la linea donde empezo."""
    programa = Programa(
        [
            Orden("A", 14.70, 5000, "ITW-1", secuencia=1),
            Orden("B", 14.70, 5000, "ITW-7", secuencia=1),
        ]
    )

    propuesta = buscar_oportunidades(programa, lineas, tabla)

    origen_de = {o.id: o.linea for o in propuesta.programa_original}
    for grupo in propuesta.agrupadas():
        for orden in grupo.ordenes:
            assert origen_de[orden.id] != grupo.destino


def test_el_schedule_propuesto_conserva_todas_las_ordenes(tabla, lineas):
    programa = Programa(
        [
            Orden("A", 14.70, 5000, "ITW-1", secuencia=1),
            Orden("B", 14.70, 3000, "ITW-1", secuencia=2),
            Orden("C", 12.50, 2000, "ITW-1", secuencia=3),
        ]
    )

    propuesta = buscar_oportunidades(programa, lineas, tabla)

    assert {o.id for o in propuesta.programa_propuesto} == {"A", "B", "C"}
    assert propuesta.programa_propuesto.kilogramos == pytest.approx(
        programa.kilogramos
    )


def test_la_propuesta_nunca_empeora_el_schedule(tabla, lineas):
    programa = Programa(
        [
            Orden("A", 14.70, 9000, "ITW-1", secuencia=1),
            Orden("B", 14.70, 9000, "ITW-1", secuencia=2),
        ]
    )

    propuesta = buscar_oportunidades(programa, lineas, tabla)

    assert propuesta.delta_kg >= 0
    assert propuesta.horas_liberadas >= 0


def test_desempata_por_horas_cuando_la_tonelada_no_cambia(tabla, lineas):
    """Con horizonte de sobra la tonelada no cambia; la mejora son las horas."""
    programa = Programa([Orden("A", 14.70, 5000, "ITW-1", secuencia=1)])

    propuesta = buscar_oportunidades(programa, lineas, tabla)

    assert propuesta.delta_kg == pytest.approx(0)
    assert propuesta.horas_liberadas > 0
    assert "se liberan" in propuesta.resumen()
