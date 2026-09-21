import pytest

from hiloflo.modelos import linea_a_work_center, work_center_a_linea
from hiloflo.schedule import diametro_de, es_slm, grado_de, leer_programa, winder_de

from .fixtures import crear_schedule


# --------------------------------------------------------------------------
# Equivalencia work center <-> linea
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "work_center,linea",
    [("BB001", "ITW-1"), ("BB010", "ITW-10"), ("BB014", "ITW-14")],
)
def test_work_center_y_linea_van_y_vienen(work_center, linea):
    assert work_center_a_linea(work_center) == linea
    assert linea_a_work_center(linea) == work_center


def test_work_center_desconocido_se_deja_tal_cual():
    assert work_center_a_linea("OTRO") == "OTRO"


# --------------------------------------------------------------------------
# Interpretacion de la descripcion del material
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "descripcion,esperado",
    [
        ("CSW,14.70mm HT HT 1950-2000 MPa", 14.70),
        ("CSW, 7,92 1450-1610 SAE1065 half SID", 7.92),
        ("CSW,13,10 SLM2025 SLM 54SiCr6", 13.10),
        ("CSW,18,90 C2 54SiCr6", 18.90),
        ("CSW, 15.09 SAE1065 CL2 1340-1500 MPa SID", 15.09),
    ],
)
def test_diametro_sale_de_la_descripcion(descripcion, esperado):
    assert diametro_de(descripcion) == esperado


def test_ignora_numeros_que_no_son_diametro():
    # 1950-2000 MPa no debe confundirse con un diametro
    assert diametro_de("CSW HT 1950-2000 MPa") is None


def test_grado_distingue_1065_del_resto():
    assert grado_de("CSW, 7,92 1450-1610 SAE1065 half SID") == "1065"
    assert grado_de("CSW,18,90 C2 54SiCr6") == "9254"


def test_slm_solo_como_palabra_completa():
    assert es_slm("CSW,13,10 SLM2025 SLM 54SiCr6")
    assert not es_slm("CSW,14.70mm HT HT 1950-2000 MPa")


def test_winder_dem_se_lee_de_las_notas():
    assert winder_de("usar DEM pan winder") == "DEM"
    assert winder_de("sin nota") is None


# --------------------------------------------------------------------------
# Lectura del archivo
# --------------------------------------------------------------------------


@pytest.fixture
def schedule(tmp_path):
    return crear_schedule(
        tmp_path / "schedule.xlsx",
        [
            ("BB001", "14703", "CSW,14.70mm HT 1950-2000 MPa", None, "600001", 2300),
            ("BB001", "14703", "CSW,14.70mm HT 1950-2000 MPa", None, "600002", 2498),
            ("BB007", "91944287", "CSW, 15.09 SAE1065 CL2 SID", None, "600003", 1916),
            ("BB010", "13103", "CSW,13,10 SLM2025 SLM 54SiCr6", None, "600004", 2300),
            ("BB002", "12403", "CSW,12,40 HT", "use DEM pan winder", "600005", 2300),
            # subtotal de bloque y gran total: se ignoran
            ("BB010", "nan", "nan", None, "0", 4600),
            ("nan", "nan", "nan", None, "0", 11314),
        ],
    )


def test_lee_solo_las_ordenes_reales(schedule):
    programa = leer_programa(schedule)
    assert len(programa) == 5
    assert programa.kilogramos == pytest.approx(11314)


def test_asigna_la_linea_desde_el_work_center(schedule):
    programa = leer_programa(schedule)
    assert programa.lineas_usadas() == ["ITW-1", "ITW-10", "ITW-2", "ITW-7"]
    assert [o.id for o in programa.de_linea("ITW-1")] == ["600001", "600002"]


def test_marca_grado_slm_y_devanador(schedule):
    por_id = {o.id: o for o in leer_programa(schedule)}
    assert por_id["600003"].grupo_grado == "1065"
    assert por_id["600004"].slm is True
    assert por_id["600005"].winder == "DEM"
    assert por_id["600001"].slm is False
    assert por_id["600001"].winder is None


def test_secuencia_respeta_el_orden_del_archivo(schedule):
    programa = leer_programa(schedule)
    assert [o.secuencia for o in programa.de_linea("ITW-1")] == [1, 2]


def test_falla_si_el_archivo_no_trae_ordenes(tmp_path):
    vacio = crear_schedule(tmp_path / "vacio.xlsx", [])
    with pytest.raises(ValueError, match="no se leyo ninguna orden"):
        leer_programa(vacio)


def test_falla_si_no_existe_el_archivo(tmp_path):
    with pytest.raises(FileNotFoundError):
        leer_programa(tmp_path / "no-existe.xlsx")
