"""Linea de comandos de HILO-FLO.

    python -m hiloflo.cli \
        --parametros WI-FLO-CSW-P-526_ITW_Process_Parameters.xlsx \
        --schedule   Schedule_8200_09-17-2026.xlsx
"""

from __future__ import annotations

import argparse
import sys

from .catalogo import (
    EFICIENCIA,
    HORAS_SEMANA,
    MINUTOS_CAMBIO,
    catalogo_predeterminado,
    leer_catalogo,
)
from .optimizador import buscar_oportunidades
from .parametros import leer_velocidades
from .programa import evaluar_programa
from .rendimiento import TablaVelocidades
from .reportes import exportar_todo
from .schedule import leer_programa


def construir_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="hiloflo",
        description=(
            "Evalua el production schedule de las lineas ITW y propone "
            "reasignaciones que aumenten la tonelada."
        ),
    )
    p.add_argument("--parametros", required=True, help="WI-FLO-CSW-P-526 (.xlsx)")
    p.add_argument("--schedule", required=True, help="production schedule (.xlsx)")
    p.add_argument("--catalogo", help="CSV de lineas; si falta se usan supuestos")
    p.add_argument("--hoja-parametros", default=None)
    p.add_argument("--hoja-schedule", default=None)
    p.add_argument("--horas", type=float, default=HORAS_SEMANA)
    p.add_argument("--eficiencia", type=float, default=EFICIENCIA)
    p.add_argument("--minutos-cambio", type=float, default=MINUTOS_CAMBIO)
    p.add_argument(
        "--itw15",
        action="store_true",
        help="simula ITW-15 ya instalada y disponible",
    )
    p.add_argument("--max-movimientos", type=int, default=40)
    p.add_argument("--sin-permutas", action="store_true")
    p.add_argument(
        "--exportar",
        metavar="CARPETA",
        help="escribe los CSV de rendimiento, evaluacion y propuesta",
    )
    p.add_argument(
        "--detalle-recetas",
        action="store_true",
        help="imprime el rango de diametro y el kg/h tipico de cada linea",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = construir_parser().parse_args(argv)

    if args.catalogo:
        lineas = leer_catalogo(args.catalogo)
    else:
        lineas = catalogo_predeterminado(
            horas_disponibles=args.horas,
            eficiencia=args.eficiencia,
            minutos_cambio=args.minutos_cambio,
            itw15_activa=args.itw15,
        )

    velocidades = leer_velocidades(args.parametros, args.hoja_parametros)
    tabla = TablaVelocidades.construir(velocidades, lineas)
    programa = leer_programa(args.schedule, args.hoja_schedule)

    print(
        f"Lineas: {len(lineas)} | Recetas de velocidad: {len(tabla)} | "
        f"Ordenes: {len(programa)} | {programa.kilogramos / 1000:,.1f} t programadas"
    )
    if not args.catalogo:
        print(
            f"Supuestos (pendientes de confirmar): {args.horas:,.0f} h/linea, "
            f"eficiencia {args.eficiencia:.0%}, "
            f"cambio de medida {args.minutos_cambio:,.0f} min."
        )
    print()

    if args.detalle_recetas:
        _imprimir_recetas(tabla)
        print()

    evaluacion = evaluar_programa(programa, lineas, tabla)
    print("SCHEDULE ACTUAL")
    print(evaluacion.resumen())

    sin_receta = evaluacion.sin_receta
    if sin_receta:
        kg = sum(o.kilogramos for o in sin_receta)
        print(
            f"\nAVISO - {len(sin_receta)} ordenes ({kg:,.0f} kg) estan en una "
            "linea que no tiene receta para ese diametro:"
        )
        for orden in sin_receta[:15]:
            print(
                f"  {orden.id}  {orden.diametro_mm:6.2f} mm  "
                f"{orden.kilogramos:>8,.0f} kg  en {orden.linea}"
            )
        if len(sin_receta) > 15:
            print(f"  ... y {len(sin_receta) - 15} mas")

    propuesta = buscar_oportunidades(
        programa,
        lineas,
        tabla,
        max_movimientos=args.max_movimientos,
        permitir_permutas=not args.sin_permutas,
    )
    print("\nAREAS DE OPORTUNIDAD")
    print(propuesta.resumen())

    if propuesta.agrupadas() or propuesta.permutas:
        print("\nSCHEDULE PROPUESTO")
        print(propuesta.evaluacion_propuesta.resumen())

    if args.exportar:
        archivos = exportar_todo(
            args.exportar, tabla, programa, evaluacion, propuesta
        )
        print("\nCSV generados:")
        for archivo in archivos:
            print(f"  {archivo}")

    return 0


def _imprimir_recetas(tabla: TablaVelocidades) -> None:
    print(f"{'LINEA':<9}{'DIAM MIN':>10}{'DIAM MAX':>10}{'RECETAS':>10}")
    for linea in tabla.lineas:
        rango = tabla.rango_de(linea)
        if rango is None:
            continue
        minimo, maximo = rango
        print(
            f"{linea:<9}{minimo:>10.2f}{maximo:>10.2f}"
            f"{len(tabla.diametros_de(linea)):>10}"
        )


if __name__ == "__main__":
    raise SystemExit(main())
