# El dominio, y cómo se lee cada archivo

## Las líneas

Florence tiene **14 líneas ITW** instaladas (ITW-1 … ITW-14) y la **ITW-15**
por instalarse. En SAP son los work centers **BB001 … BB014**, con
correspondencia directa: `BB007 → ITW-7`.

Por fabricante y velocidad el WI las agrupa así:

| grupo | líneas |
|---|---|
| Neturen Slow | ITW-2, ITW-3, ITW-5, ITW-6 |
| Neturen Fast | ITW-1, ITW-7, ITW-8, ITW-9, ITW-10 |
| Mubea | ITW-4, ITW-11, ITW-12, ITW-13, ITW-14 |

## Archivo 1 — `WI-FLO-CSW-P-526_ITW Process Parameters`

Hoja `Anlagen - Setup `. El documento trae varias tablas (flujos de temple,
tensiones, bobinas de calentamiento); de todas ellas **sólo se usa la tabla
`ITW Line Speed [mm/s]`**.

Esa tabla viene **partida en 8 bloques** por el salto de página del
documento, pero el acomodo de columnas se repite idéntico en todos. Por eso
el lector recorre la hoja completa y toma cualquier renglón cuya columna A
sea un número entre 4 y 30 mm.

- Columna A: **diámetro de alambre estirado**, en pasos de 0.05 mm,
  de 5.49 a 23.00 mm. Trae ruido de punto flotante (`6.25000000000001`) y se
  redondea a 2 decimales.
- Columnas C…P: la velocidad en mm/s de cada línea.

| col | línea(s) | discriminante |
|---|---|---|
| C | ITW-2 | devanador Neturen |
| D | ITW-2 | devanador DEM, grado 9254 |
| E | ITW-2 | devanador DEM, grado 1065 |
| F | ITW-3 | |
| G | ITW-5, ITW-6 | |
| H | ITW-1 | |
| I | ITW-7, ITW-8, ITW-9 | |
| J | ITW-10 | NON SLM |
| K | ITW-10 | SLM |
| L | ITW-4 | |
| M | ITW-11 | |
| N | ITW-12 | |
| O | ITW-13 | |
| P | ITW-14 | |

**Una celda vacía significa que esa línea no corre ese diámetro.** La tabla
es, además de las velocidades, la matriz de compatibilidad línea–diámetro.

Rangos que resultan:

| línea | diámetro mín | diámetro máx |
|---|---|---|
| ITW-1, ITW-7, ITW-8, ITW-9, ITW-10 | 5.49 | 18.55 |
| ITW-2 | 5.49 | 14.50 |
| ITW-3 | 5.49 | 14.45 |
| ITW-4, ITW-11 | 10.30 | 18.05 |
| ITW-5, ITW-6 | 11.50 | 18.05 |
| ITW-12 | 15.60 | 21.05 |
| ITW-13, ITW-14 | 15.40 | 23.00 |

## Archivo 2 — `Schedule_8200_<fecha>.xlsx`

Hoja `Sheet1`: el volcado de SAP, una orden por renglón, **ya asignada a un
work center**.

```
Work Center | Material Number | Material Description | Important Notes
Order | PO Printed | Drawn | Operation Quantity (MEINH) | Customer PO
```

- **El diámetro no viene en columna propia**: va dentro de la descripción
  (`CSW,14.70mm HT 1950-2000 MPa`, `CSW, 7,92 1450-1610 SAE1065 half SID`),
  con coma o con punto decimal. Se toma el primer número de la descripción
  que caiga entre 4 y 30 mm, lo cual descarta los rangos de resistencia
  (`1950-2000 MPa`).
- **Grado**: si la descripción dice `1065`, va al grupo `1065`; todo lo demás
  (54SiCr6, 60SiCr7, 9254) cae en el grupo `9254`. La distinción sólo cambia
  la receta en ITW-2.
- **SLM**: se detecta como palabra completa en la descripción. Sólo cambia la
  receta en ITW-10.
- **Devanador DEM**: el propio WI dice que *"Production schedule will indicate
  the use of DEM pan winder in the notes section"*. Se busca `DEM` en
  descripción y notas; sin esa marca se usa la receta del devanador Neturen.
- Cada bloque de work center cierra con un renglón de subtotal (material
  `nan`, orden `0`) y el archivo cierra con el gran total. Ambos se ignoran.

La hoja `HEATLINE_SCHEDULE` es el tablero visual por turnos de 2 h. **No se
lee**: viene con fórmulas rotas (`#REF!`) y la información de asignación ya
está completa en `Sheet1`.

## Del mm/s al kg/h

El alambre es sólido y el temple por inducción no cambia la sección, así que
el rendimiento másico sale de la geometría:

```
área (mm²)  = π/4 · d²
peso lineal = área · 1e-6 · densidad      densidad = 7 850 kg/m³
kg/h        = mm_s · 3600/1000 · peso lineal · eficiencia_de_línea
```

Diámetros del schedule que no caen exactos en la retícula de 0.05 mm (por
ejemplo 14.27, 15.88) se resuelven **subiendo al punto tabulado inmediato
superior**, que es el criterio conservador: a mayor diámetro, menor
velocidad. La tolerancia es de 0.30 mm; más allá de eso se considera que no
hay receta.

## Cómo se evalúa el schedule

Por cada línea, en la secuencia en que están programadas sus órdenes:

- **horas de corrida** = kg / (kg/h)
- **horas de cambio** = un cambio de medida cada vez que el diámetro cambia
  respecto a la orden anterior
- se van consumiendo las horas disponibles del horizonte; lo que ya no cabe
  se reporta como kilogramos no producibles

## Cómo se buscan las áreas de oportunidad

Búsqueda local sobre el schedule que ya armó el programador. En cada vuelta
se prueban dos jugadas y se toma la mejor:

- **MOVER**: pasar una orden a otra línea que tenga receta para ese diámetro.
- **PERMUTAR**: intercambiar dos órdenes entre sus líneas. Sólo se explora
  desde líneas saturadas, que es donde están los kilos que se quedan fuera.

El objetivo es **lexicográfico**: primero la tonelada que sale dentro del
horizonte y, a igualdad de tonelada, las horas de línea que se liberan. Un
movimiento nunca se acepta si cuesta tonelada.

Lo que se reporta es el **neto** entre el schedule original y el propuesto,
no la bitácora de jugadas: la búsqueda local a veces mueve una orden y
después la regresa, y esos viajes de ida y vuelta no le sirven a nadie.

Al insertar una orden en su nueva línea se coloca junto a las del mismo
diámetro, para no pagar un cambio de medida de más.
