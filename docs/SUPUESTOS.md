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

## 5. Por qué ITW-2 es el cuello de botella — lo que sí sabemos y lo que no

Sobre el programa del 17/09, ITW-2 define el cierre de toda la planta:
159.6 h de corrida contra un promedio de ~99 h. Vale la pena ser preciso
sobre por qué, porque de aquí sale el número de toneladas.

### No es que esté mal cargada

Una primera lectura dijo que ITW-2 "carga 65 t al ritmo más lento de la
planta" (390 kg/h contra 848 kg/h de las otras trece). **Esa lectura es
engañosa y se corrigió.** Desglosando su carga contra el WI:

| Ø mm | kg | kg/h ITW-2 | mejor alternativa | ¿ITW-2 es la mejor? |
|---|---|---|---|---|
| 5.72 – 9.53 | 44 430 | 200 – 554 | ITW-1 (182 – 504) | **sí, en los 7 diámetros** |
| 11.20 – 12.40 | 20 700 | 508 – 640 | ITW-1 (696 – 853) | no |

En **68 % de su tonelada, ITW-2 es la línea más rápida de la planta**. Su
promedio de 390 kg/h no es un problema de asignación: es un efecto de
mezcla. El alambre delgado da pocos kg/h **en cualquier línea**, porque la
sección es chica — 5.72 mm da 200 kg/h en la mejor línea, 12.70 mm da 895.
Concentrar el delgado en una sola línea la vuelve el cuello de botella sin
importar cuál sea.

Lo único genuinamente mal puesto son los 20.7 t de 11.20–12.40 mm, donde
ITW-1 corre ~1.5× más rápido. Son 8.9 h de las 159.6.

### El dato que sí llama la atención

**Las 44.4 t de alambre ≤ 9.53 mm del programa completo están en ITW-2. Las
20 órdenes. Ninguna otra línea tiene una sola.**

Eso no parece casualidad: parece una regla que alguien sigue. Pero el WI sí
tabula velocidad para esos diámetros en ITW-1, ITW-3, ITW-7, ITW-8, ITW-9 e
ITW-10. O la regla responde a algo que el WI no captura (herramental,
devanador, calidad), o es una costumbre heredada de que ITW-2 es la más
rápida por hora en delgado.

**Es la pregunta más cara del proyecto**, porque decide el número:

| escenario | cierre | incremento |
|---|---|---|
| El delgado se puede repartir | 167.1 h → 98.2 h | **+760 t** |
| El delgado se queda en ITW-2 | 167.1 h → 128.4 h | **+327 t** |
| ITW-2 con devanador DEM | 132.1 h → 96.5 h | **+400 t** |
| DEM y el delgado amarrado | 132.1 h → 97.1 h | **+391 t** |

## 5b. Devanador DEM

El WI dice que el schedule marca el uso del devanador DEM en la sección de
notas. En el schedule del 17/09 **ninguna orden lo menciona**, así que todo
ITW-2 se calcula con la receta Neturen, la más lenta de las tres.

La diferencia no es pareja: pega justo donde ITW-2 carga su tonelada.

| Ø mm | Neturen | DEM | factor |
|---|---|---|---|
| 5.72 | 275 | 600 | **2.18×** |
| 7.19 | 275 | 478 | **1.74×** |
| 6.65 / 7.70 / 7.92 | 275 | 375 | 1.36× |
| 9.40 en adelante | 275 → 170 | igual | 1.00× |

**Pregunta:** ¿cómo se decide en el piso qué devanador usa ITW-2? ¿Queda
registrado en algún lado, o es algo que el operador escoge?

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
