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
- **horas de cambio** = dos costos que se **suman**:
  - **cambio de rollo**: cargar el siguiente cuesta aunque sea la misma medida
    y el mismo número de parte. Se cobra entre cada dos rollos, nunca en el
    primero de la línea (no hay nada antes que quitar).
  - **cambio de medida**: además hay que ajustar la línea cuando el diámetro
    cambia respecto a la orden anterior.

  Un rollo que además cambia de diámetro cuesta los dos. Con los estándares de
  Florence (20 y 30 min), el cambio de rollo resultó ser **el grueso**: sobre
  el schedule del 17/09 son 458 cambios de rollo contra 76 de medida, o sea
  **152.7 h contra 38 h**. La utilización promedio pasa de 66 % a 73.5 %
- se van consumiendo las horas disponibles del horizonte; lo que ya no cabe
  se reporta como kilogramos no producibles

## La hoja de corridas

El análisis contesta *qué conviene mover*. La hoja de corridas contesta la
otra pregunta, la de todos los días: **qué corre cada línea, en qué orden, a
qué hora y con cuántos rollos**. Es lo que se baja a piso.

Una **corrida** es un bloque de rollos seguidos del mismo número de parte en
la misma línea, igual que en HILO. El schedule de Florence trae **un renglón
por rollo** (~2.3 t cada uno; las notas confirman «Full coils must be under
2600 kgs»), así que los rollos de la corrida son los renglones que se
juntaron. Volver al mismo número de parte más adelante **abre una corrida
nueva**: si el programador intercaló otra parte, la línea corre dos bloques
y eso es lo que tiene que ver.

El reloj se arma acumulando lo que ya calculó el motor, sin recalcular nada.
El cambio de medida se cobra **antes** de la corrida que lo provoca, que es
como pasa en la línea: primero se ajusta, luego se corre.

**La fecha sale del nombre del archivo** (`Schedule_8200_09-17-2026.xlsx`),
porque el schedule no trae columna de fecha: es lo único que dice de qué
semana es. Si no se puede leer, la pantalla enseña horas corridas («14.6 h»)
en vez de fecha y hora, que es honesto y sigue sirviendo para ordenar.

Lo que no cabe en el horizonte se **marca**, no se esconde: la corrida sale
en rojo con «past horizon» y el rollo que se parte a la mitad dice «does not
fit». Una corrida sin receta no consume reloj (la línea no la puede correr)
pero también aparece.

### El rollo que va corriendo

La hoja de corridas trae una casilla por rollo. Al marcar el que una línea
**trae corriendo ahora**, el reloj de esa línea se ancla a la hora real: ese
rollo empieza en ese momento y todo lo que sigue se recorre igual, así que el
encabezado deja de decir cuánto dura la línea y pasa a decir **a qué hora
acaba contando desde ahora**. Los rollos anteriores se pintan apagados y el
marcado en verde.

Cada línea lleva el suyo: las catorce corren a la vez y van a distinto ritmo.
Marcar otro rollo reemplaza al anterior, que es lo que pasa cuando la línea
avanza.

Se asume que el rollo marcado **apenas empieza**. Si ya va a la mitad, el
pronóstico se pasa por lo que le falta a ese rollo (~1–3 h). Es a propósito:
pedir el porcentaje de avance sería más exacto y mucho más fastidioso de
capturar a cada rato.

Esa marca vive en el navegador y **no en el folio**: es estado de piso, cambia
cada par de horas, y el folio es el registro de lo que se analizó ese día. Se
guarda por folio, así que sobrevive a recargar la página.

## Cómo se buscan las áreas de oportunidad

Búsqueda local sobre el schedule que ya armó el programador. En cada vuelta
se prueban tres jugadas y se toma la mejor:

- **MOVER BLOQUE**: pasar de golpe todas las órdenes de un diámetro a otra
  línea. Es la jugada que más rinde, porque el cambio de medida en la línea
  destino se paga una sola vez y se reparte entre todo el bloque. Moviendo
  orden por orden, la primera carga con el cambio completo y casi nunca sale
  positiva, así que la búsqueda se atora antes de tiempo.
- **MOVER**: pasar una sola orden a otra línea que tenga receta para ese
  diámetro.
- **PERMUTAR**: intercambiar dos órdenes entre sus líneas. Sólo se explora
  desde líneas saturadas, que es donde están los kilos que se quedan fuera.

### El objetivo: balancear, no vaciar

El objetivo es **lexicográfico en tres niveles**:

1. la tonelada que sale dentro del horizonte;
2. **el cierre del programa**, es decir las horas de la línea más cargada;
3. las horas-línea totales.

El nivel 2 es el que balancea, y es el importante. Sin él, la búsqueda vacía
las líneas lentas hacia las rápidas: baja las horas totales, pero deja líneas
paradas y **el programa sigue cerrando cuando termina la línea más cargada**,
así que no se produce ni un kilo más. Lo que de verdad destraba la producción
es que el material que sale de una línea lo levante otra.

Por eso el número que importa no es "cuántas horas se ahorran" sino **en
cuánto cierra el programa**. Si hoy cierra en 167 h porque una línea va
sobrecargada y balanceado cierra en 98 h, en el mismo calendario caben 1.70
veces las toneladas.

**La invariante real es una sola: un movimiento nunca se acepta si cuesta
tonelada.** El cierre sólo desempata entre movimientos que empatan en
tonelada.

No es lo mismo que decir "nunca atrasa el cierre", y la diferencia importa.
Si una orden está programada en una línea sin receta para su diámetro, hoy
no se produce: mueve 2.3 t que valían cero, aunque la línea que la reciba
tarde más y el programa cierre después. El nivel 1 manda sobre el 2 a
propósito — producir vale más que cerrar temprano.

Cuando todas las órdenes ya se producen, que es el caso normal, la tonelada
no cambia y entonces sí: el reajuste nunca atrasa el cierre.

Lo que se reporta es el **neto** entre el schedule original y el propuesto,
no la bitácora de jugadas: la búsqueda local a veces mueve una orden y
después la regresa, y esos viajes de ida y vuelta no le sirven a nadie.

Al insertar una orden en su nueva línea se coloca junto a las del mismo
diámetro, para no pagar un cambio de medida de más.
