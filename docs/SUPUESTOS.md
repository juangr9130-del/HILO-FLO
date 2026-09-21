# Supuestos y preguntas abiertas

Todo lo de esta lista se resolvió con un criterio razonable para poder
avanzar, pero **necesita confirmación de Florence**. Están ordenadas por
cuánto mueven el resultado.

## 1. Horas disponibles, eficiencia y cambio de medida

Ninguno de los dos Excel trae estos tres datos, y son los que más mueven la
aritmética. Hoy se corre con:

| parámetro | valor supuesto | dónde se cambia |
|---|---|---|
| horas disponibles por línea | 144 h (6 días × 24 h) | `FLO_HORAS` / `flo_parametro_linea` |
| eficiencia operativa | **desactivada (100 %)** | `FLO_EFICIENCIA` |
| minutos por cambio de medida | 45 min | `FLO_MINUTOS_CAMBIO` |

La eficiencia está **apagada a propósito**: por ahora el análisis se hace
contra la velocidad de receta tal cual. Cuando haya un OEE medido se prende.

El tiempo de cambio de medida resultó **poco sensible**: entre 0 y 90 minutos
el incremento de producción calculado se mueve menos de 1 %. No es urgente
afinarlo.

**Preguntas:**
- ¿Cuántos turnos por semana corre cada línea? ¿Todas igual?
- ¿Cuánto tarda de verdad un cambio de medida? ¿Depende del salto de
  diámetro o del cambio de bobina de calentamiento?

Para dar valores distintos por línea se captura en `flo_parametro_linea`:

```sql
UPDATE flo_parametro_linea
   SET horas_disponibles = 120, minutos_cambio = 60
 WHERE linea_id = (SELECT linea_id FROM cat_linea WHERE codigo = 'ITW-2');
```

## 2. Densidad del acero

Se usa **7 850 kg/m³** para todos los grados (9254, 54SiCr6, 60SiCr7,
SAE1065). La diferencia real entre grados es de décimas de porcentaje, pero
si Florence maneja un valor propio para el cálculo de peso de rollo, conviene
usar ese mismo para que los números cuadren contra SAP.

**Pregunta:** ¿con qué densidad calculan ustedes el peso del rollo?

## 3. Rango de diámetros por línea — RESUELTO

La tabla de bobinas de calentamiento y la de velocidades no coinciden en qué
línea corre qué diámetro (por ejemplo ITW-3 aparece hasta 18.50 mm en una y
hasta 14.45 mm en la otra).

**Confirmado con Florence:** manda la **tabla de velocidades**. Si un diámetro
no trae velocidad en una línea es porque en la práctica ahí casi no se corre,
aunque el rango de la bobina lo permita. El código ya se comporta así: celda
vacía = esa línea no es candidata para esa orden.

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

**Es el supuesto que más mueve el resultado.** Sobre el programa del 17/09,
ITW-2 es el cuello de botella de toda la planta: carga 65 t a 390 kg/h cuando
el promedio de las otras 13 líneas es de 848 kg/h, y por eso el programa
cierra en 167 h. Con devanador DEM ese cuello se reduce y el incremento de
producción calculado baja de **+760 t a +400 t**.

**Pregunta:** ¿cómo se decide en el piso qué devanador usa ITW-2? ¿Queda
registrado en algún lado? Y sobre todo: **¿por qué ITW-2 trae 65 t cargadas
si es la línea más lenta para esos diámetros?**

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
