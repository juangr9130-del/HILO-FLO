import pytest

from hiloflo.parametros import leer_velocidades

from .fixtures import crear_wi


@pytest.fixture
def wi(tmp_path):
    # columnas: 3=ITW-2 Neturen, 5=ITW-2 DEM 1065, 7=ITW-5/6, 9=ITW-7/8/9,
    #           10=ITW-10 NON SLM, 11=ITW-10 SLM, 16=ITW-14
    return crear_wi(
        tmp_path / "wi.xlsx",
        {
            14.70: {3: 275, 5: 450, 9: 200, 10: 190, 11: 150},
            14.75: {3: 270, 7: 140, 9: 198},
            20.00: {16: 117},
        },
    )


def test_expande_las_columnas_agrupadas(wi):
    puntos = leer_velocidades(wi)
    lineas = {p.linea for p in puntos}
    # la columna de ITW-7/8/9 se abre en tres lineas
    assert {"ITW-7", "ITW-8", "ITW-9"} <= lineas
    # y la de ITW-5/6 en dos
    assert {"ITW-5", "ITW-6"} <= lineas


def test_misma_velocidad_para_las_lineas_de_una_columna(wi):
    puntos = leer_velocidades(wi)
    agrupadas = {
        (p.linea, p.diametro_mm): p.mm_s
        for p in puntos
        if p.linea in {"ITW-7", "ITW-8", "ITW-9"}
    }
    assert agrupadas[("ITW-7", 14.70)] == 200
    assert agrupadas[("ITW-8", 14.70)] == 200
    assert agrupadas[("ITW-9", 14.70)] == 200


def test_marca_los_discriminantes_de_itw2_e_itw10(wi):
    puntos = {(p.linea, p.mm_s): p for p in leer_velocidades(wi)}
    assert puntos[("ITW-2", 275)].winder == "NETUREN"
    assert puntos[("ITW-2", 450)].winder == "DEM"
    assert puntos[("ITW-2", 450)].grado == "1065"
    assert puntos[("ITW-10", 190)].slm is False
    assert puntos[("ITW-10", 150)].slm is True


def test_celda_vacia_significa_que_la_linea_no_corre_ese_diametro(wi):
    puntos = leer_velocidades(wi)
    itw14 = {p.diametro_mm for p in puntos if p.linea == "ITW-14"}
    assert itw14 == {20.00}


def test_redondea_el_ruido_de_punto_flotante(tmp_path):
    wi = crear_wi(tmp_path / "ruido.xlsx", {6.25000000000001: {3: 275}})
    assert leer_velocidades(wi)[0].diametro_mm == 6.25


def test_ignora_numeros_fuera_del_rango_de_diametro(tmp_path):
    wi = crear_wi(tmp_path / "fuera.xlsx", {14.70: {3: 275}, 1950.0: {3: 999}})
    diametros = {p.diametro_mm for p in leer_velocidades(wi)}
    assert diametros == {14.70}


def test_falla_si_la_hoja_no_trae_velocidades(tmp_path):
    wi = crear_wi(tmp_path / "vacio.xlsx", {})
    with pytest.raises(ValueError, match="no se encontro ninguna velocidad"):
        leer_velocidades(wi)


def test_falla_si_no_existe_el_archivo(tmp_path):
    with pytest.raises(FileNotFoundError):
        leer_velocidades(tmp_path / "no-existe.xlsx")
