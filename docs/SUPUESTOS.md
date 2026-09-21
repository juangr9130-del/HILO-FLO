# Supuestos y preguntas abiertas

Todo lo de esta lista se resolvió con un criterio razonable para poder
avanzar, pero **necesita confirmación de Florence**. Están ordenadas por
cuánto mueven el resultado.

## 1. Horas disponibles, eficiencia y cambio de medida

Ninguno de los dos Excel trae estos tres datos, y son los que más mueven la
aritmética. Hoy se corre con:

| parámetro | valor supuesto | dónde se cambia |
|---|---|---|
| horas disponibles por línea | 144 h (6 días × 24 h) | `--horas` |
| eficiencia operativa | 85 % | `--eficiencia` |
| minutos por cambio de medida | 45 min | `--minutos-cambio` |

**Preguntas:**
- ¿Cuántos turnos por semana corre cada línea? ¿Todas igual?
- ¿Hay un OEE o una eficiencia por línea ya medida?
- ¿Cuánto tarda de verdad un cambio de medida? ¿Depende del salto de
  diámetro o del cambio de bobina de calentamiento?

Con `--catalogo lineas.csv` se pueden dar valores distintos por línea:

```csv
linea,horas_disponibles,eficiencia,minutos_cambio,activa
ITW-1,144,0.88,45,si
ITW-2,120,0.82,60,si
```

## 2. Densidad del acero

Se usa **7 850 kg/m³** para todos los grados (9254, 54SiCr6, 60SiCr7,
SAE1065). La diferencia real entre grados es de décimas de porcentaje, pero
si Florence maneja un valor propio para el cálculo de peso de rollo, conviene
usar ese mismo para que los números cuadren contra SAP.

**Pregunta:** ¿con qué densidad calculan ustedes el peso del rollo?

## 3. Discrepancia entre las dos tablas del WI

La tabla de bobinas de calentamiento (*Heating Coils & Glass Tubes*, filas
39–69) y la tabla de velocidades **no dicen lo mismo** sobre qué línea corre
qué diámetro:

| línea | según bobinas | según velocidades |
|---|---|---|
| ITW-3 | 5.54 – 18.50 mm | 5.49 – **14.45** mm |
| ITW-5, ITW-6 | 5.54 – 18.50 mm | **11.50** – 18.05 mm |
| ITW-10 | **11.5** – 18.0 mm | **5.49** – 18.55 mm |

Hoy manda la **tabla de velocidades**, porque es la que trae el dato que
necesitamos y porque una celda vacía es una señal explícita. Pero esto cambia
a qué líneas puede proponerse mover una orden.

**Pregunta:** ¿cuál de las dos refleja lo que la línea realmente puede correr
hoy? Si ITW-3 sí corre hasta 18.5 mm, nos estamos perdiendo movimientos.

## 4. Grado del material cuando la descripción no lo dice

De las 472 órdenes del schedule del 17/09, **241 no nombran el grado** (son
descripciones tipo `CSW,14.70mm HT 1950-2000 MPa`). Se asignan al grupo
`9254`, que es el que aplica a todo lo que no es SAE1065.

Esto **sólo importa en ITW-2**, que es la única línea donde el WI tabula
9254 y 1065 por separado (y sólo con devanador DEM). En el resto de las
líneas no cambia nada.

**Pregunta:** ¿hay forma de sacar el grado del número de material, o del
maestro de materiales de SAP, en vez de adivinarlo de la descripción?

## 5. Devanador DEM

El WI dice que el schedule marca el uso del devanador DEM en la sección de
notas. En el schedule del 17/09 **ninguna orden lo menciona**, así que todas
las de ITW-2 se están calculando con la receta del devanador Neturen
(275 mm/s), que es la más lenta de las tres.

Si en la práctica ITW-2 corre con DEM seguido, su rendimiento real es bastante
mayor que el que estamos calculando.

**Pregunta:** ¿cómo se decide en el piso qué devanador usa ITW-2? ¿Queda
registrado en algún lado?

## 6. Diámetro: ¿estirado o terminado?

La tabla de velocidades está indexada por **diámetro de alambre estirado**
(*Drawn Wire Rod Ø*). Del schedule se saca el diámetro que aparece en la
descripción del material, que entendemos es el mismo (el temple por inducción
no cambia la sección).

**Pregunta:** ¿es correcto, o hay algún proceso entre el estirado y el ITW
que cambie el diámetro?

## 7. Restricciones que el modelo todavía no considera

El optimizador hoy sólo respeta compatibilidad línea–diámetro y horas
disponibles. **No sabe** de:

- **Fechas compromiso.** Mover una orden a una línea más rápida podría
  atrasarla si esa línea ya trae cola. Hace falta la fecha de cada orden.
- **Notas de la orden.** Hay restricciones reales escritas en texto libre:
  `SAME HEAT REQUIRED`, `Full coils must be under 2600 kgs`,
  `SID FULL Coils 1413 +/-25`. Algunas amarran órdenes a una misma colada o
  a un mismo rollo.
- **Material disponible.** Si el alambre estirado para una orden está físicamente
  junto a una línea, moverla cuesta manejo.
- **Herramental.** El WI dice que ciertas líneas usan bobinas de un número
  fijo de vueltas (15, 22 o 25). Cambiar de familia de diámetro puede exigir
  cambio de bobina, que seguramente cuesta más que un cambio de medida normal.
- **Calidad.** La nota 3 del WI permite al operador bajar la velocidad si no
  se alcanza la resistencia objetivo. Eso es rendimiento real por debajo del
  de receta, y es justamente lo que la eficiencia por línea debería capturar.

**Pregunta:** ¿cuáles de estas son las que de verdad le amarran las manos al
programador? Esas son las que conviene modelar primero; el resto sólo agrega
ruido.

## 8. Alcance de la comparación con SAP

El schedule del 17/09 trae 472 órdenes y **1 084 t**. Con los supuestos
actuales, las 14 líneas requieren ~1 576 h de las 2 016 h disponibles (78 %
de utilización promedio).

**Pregunta:** ¿ese 78 % se parece a lo que ven en planta? Si la realidad es
que andan al 95 %, alguno de los supuestos de arriba está mal y conviene
corregirlo antes de creerle a las propuestas de movimiento.
