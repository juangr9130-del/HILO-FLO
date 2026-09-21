# HILO-FLO

Apoyo a la programación de las líneas **ITW** (*Induction Tempered Wire*) de
Mubea Florence.

Toma los dos archivos que hoy ya existen en planta —el WI de parámetros de
proceso y el production schedule de SAP— y responde tres preguntas que hoy
nadie tiene contestadas en un solo lugar:

1. **¿Cuántos kg/h da cada diámetro en cada línea?** El WI da velocidad en
   mm/s; el rendimiento en kilogramos nunca se calcula.
2. **¿Cómo queda cargada cada línea con el schedule actual?** Horas de
   corrida, horas de cambio de medida, utilización y qué se queda fuera del
   horizonte.
3. **¿Dónde hay área de oportunidad?** Qué órdenes conviene mover de una
   línea a otra, y cuántas toneladas u horas de línea se ganan con cada
   movimiento.

La idea es la misma que HILO en México, aterrizada a la realidad de Florence.

## Instalación

```bash
pip install -r requirements-dev.txt
```

## Uso

Deja los dos Excel en `data/entrada/` (esa carpeta no se versiona: son datos
de planta) y corre:

```bash
python -m hiloflo.cli \
    --parametros data/entrada/WI-FLO-CSW-P-526_ITW_Process_Parameters.xlsx \
    --schedule   data/entrada/Schedule_8200_09-17-2026.xlsx \
    --exportar   data/salida
```

Imprime en pantalla la carga por línea, los avisos y las áreas de
oportunidad, y con `--exportar` deja cuatro CSV listos para abrir en Excel:

| archivo | qué trae |
|---|---|
| `rendimiento_kg_h.csv` | matriz diámetro × línea con el kg/h de cada combinación y cuál es la línea más rápida |
| `evaluacion_lineas.csv` | kg, horas de corrida, horas de cambio y utilización por línea |
| `movimientos_propuestos.csv` | las reasignaciones sugeridas, con folios y horas liberadas |
| `schedule_propuesto.csv` | el schedule ya con los movimientos aplicados |

Opciones útiles:

```
--horas 144            horas disponibles por línea en el horizonte
--eficiencia 1.0       eficiencia operativa (1.0 = velocidad de receta tal cual)
--minutos-cambio 45    costo de un cambio de medida
--itw15                simula ITW-15 ya instalada, para ver qué se le pasaría
--catalogo lineas.csv  horas/eficiencia/cambio distintos por línea
--detalle-recetas      rango de diámetro que cubre cada línea
```

## Cómo sale el kg/h

El WI da la velocidad de línea en mm/s por diámetro de alambre estirado. Como
el alambre es sólido y el temple no cambia la sección:

```
área (mm²)  = π/4 · d²
peso lineal = área · densidad          (7 850 kg/m³ para acero de resorte)
kg/h        = velocidad(mm/s) · 3600/1000 · peso lineal · eficiencia
```

Ejemplo: 170 mm/s de alambre de 14.70 mm ≈ **815 kg/h**.

## Estructura

```
src/hiloflo/
  modelos.py      Línea, Orden, Programa, PuntoVelocidad
  parametros.py   lector del WI-FLO-CSW-P-526 (velocidades)
  schedule.py     lector del production schedule de SAP
  rendimiento.py  mm/s + diámetro -> kg/h, y la matriz de compatibilidad
  catalogo.py     horas, eficiencia y cambio de medida por línea
  programa.py     evaluación del schedule línea por línea
  optimizador.py  búsqueda de áreas de oportunidad
  reportes.py     salidas en CSV
  cli.py          línea de comandos
```

## Documentación

- [`docs/DOMINIO.md`](docs/DOMINIO.md) — cómo está armado cada archivo de
  planta y cómo se interpreta.
- [`docs/SUPUESTOS.md`](docs/SUPUESTOS.md) — lo que se dio por hecho y lo que
  falta confirmar con Florence.

## Pruebas

```bash
python -m pytest
```

Las pruebas arman sus propios Excel de juguete con el mismo acomodo que los
de planta, así que corren sin necesidad de los documentos reales.
