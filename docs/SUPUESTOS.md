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
| minutos por cambio de medida | 30 min | `SUPUESTOS.minutosCambio` |
| minutos por cambio de rollo | 20 min | `SUPUESTOS.minutosCambioRollo` |
| objetivo del reajuste | `rendimiento` | `SUPUESTOS.objetivo` |
| tope de cambio por línea | ±5 rollos | `SUPUESTOS.topeOrdenes` |

**Las 144 h son relleno, y Florence lo confirmó**: se pusieron porque no
había forma de ver las horas programadas por línea, no porque se hayan
medido. Por eso el objetivo de rendimiento **no las usa como techo** — usa
lo que la línea más cargada ya corre en el programa (ver sección 2d).

La eficiencia está **apagada a propósito**: por ahora el análisis se hace
contra la velocidad de receta tal cual. Cuando haya un OEE medido se prende.

Los **30 minutos** del cambio de medida y los **20 del cambio de rollo** son
los estándares que dio Florence. **Se suman**: un rollo que además cambia de
diámetro cuesta 50 min.

El cambio de rollo resultó ser **el grueso del tiempo perdido**, que no era
obvio: se cobra entre cada dos rollos aunque no cambie nada, y hay 458 de
ésos contra 76 cambios de medida. Son **152.7 h contra 38 h** sobre el
schedule del 17/09, y suben la utilización promedio de la planta de 66 % a
73.5 %.

**Pendiente de confirmar:** que los dos se sumen. Si los 30 minutos del ajuste
de medida ya incluyen quitar y poner el rollo, entonces no se suman y hay que
cobrar 30, no 50. Aquí se suman porque es lo que describió Florence («agregar
20 minutos en el cambio de rollo») y porque HILO en México ya los maneja como
dos parámetros distintos. El tiempo de cambio
resultó además **poco sensible**: entre 0 y 90 minutos el incremento de
producción calculado se mueve menos de 1 %.

El cambio se cobra cuando **cambia el diámetro** entre dos órdenes seguidas de
la misma línea, no cuando cambia el número de parte. En el schedule del 17/09
da casi lo mismo —75 números de parte contra 66 diámetros, prácticamente uno
por diámetro— pero el diámetro es lo que obliga al ajuste de la línea, así que
es lo que se cobra. Si en Florence un cambio de parte dentro del mismo diámetro
también para la línea, hay que decirlo y se cambia el criterio.

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

## 2b. Las velocidades se corrigen sin tocar código

Las 3 282 velocidades del WI viven dentro del módulo como catálogo. Si planta
detecta que alguna no refleja lo que la línea de verdad corre, se cambia en
la pantalla de **Velocidades** y el rendimiento en kg/h se recalcula solo.

Cada valor editado queda marcado contra el del documento, se puede regresar
con un clic, y `vw_flo_velocidad_ajustada` lista todo lo que se apartó. Eso
además sirve de bitácora: si al hacer el backtest (ver `VALIDACION.md`) el
kg/h real no coincide con el calculado en una línea, ahí es donde se corrige
y queda registro de por qué.

## 2c. De dónde viene realmente la oportunidad — BALANCE, no ritmo

La intuición dice que rebalancear sube la productividad porque las órdenes
se van a líneas más rápidas. Con el schedule del 17/09 eso es casi falso, y
vale la pena tenerlo claro antes de prometer nada.

| | antes | después |
|---|---|---|
| ritmo de planta | 840 kg/h | 856 kg/h (**+2.0 %**) |
| cierre del programa | 129.6 h | 95.2 h (**−27 %**) |

**Sólo repartir las horas de hoy en partes iguales, sin mover una sola orden
a una línea más rápida, ya cerraría en 94.9 h.** Es decir: prácticamente toda
la ganancia viene de que ninguna línea se quede parada esperando, no de que
las líneas corran más rápido.

Eso tiene una consecuencia que sorprende en la pantalla de *Output per line*:
**algunas líneas quedan más lentas a propósito**. ITW-8 baja 11.8 % porque
absorbe alambre de 9.53 mm para descargar a ITW-2, que era la que frenaba
todo el programa. Una línea con menos kg/h está bien si con eso la planta
cierra antes; optimizar el kg/h línea por línea sería optimizar lo que no es.

## 2d. Las asunciones del rebalanceo, explícitas

Esta sección existe porque Florence pidió que quedaran claras antes de
avanzar. Cada punto dice **qué asume el módulo, qué tan firme es y qué pasa
si está mal**.

### A. Un rollo puede ir a cualquier línea que tenga velocidad para ese diámetro — FIRME

**Confirmado con Florence:** lo que amarra un rollo a una línea son los
rangos de diámetro que históricamente ha corrido, y eso es exactamente lo
que la tabla de velocidades registra. Celda vacía = ahí no se corre.

Es la asunción más fuerte del modelo y es la correcta. El módulo **no** sabe
de herramental, colada o cliente (ver sección 7); si alguna de ésas amarra de
verdad, hay que capturarla.

### B. La carga de ITW-2 no es una decisión, es un punto ciego — FIRME

Había supuesto que ITW-2 llega al 90 % porque el programador lo quiere así.
**Es falso, y Florence lo corrigió:** el programador arma el programa por
requerimiento —los resortes que necesita— y **no ve cuántas horas lleva
programadas por línea**. Cuando le faltan rollos, agrega más en la siguiente
revisión.

ITW-2 acumula horas porque *ahí los rollos duran más*: es la línea más lenta
de la planta (517 kg/h de promedio contra 1 111 de ITW-13), así que los
mismos rollos comen más horas sin que nadie lo decidiera.

**Esto es lo que justifica el rebalanceo.** Si la carga de ITW-2 fuera
intencional, mover ese material sería pasar por encima del programador. No lo
es: es el efecto de un dato que hoy no tiene a la vista, y que el módulo le da.

### C. Nada se queda fuera del horizonte — VERIFICADO, y cambia la lectura

Sobre el schedule del 17/09: **programado 1 084.4 t, producible 1 084.4 t.**
Ni un kilo se queda fuera. ITW-2 al 90 % **cabe** en las 144 h.

Consecuencia que hay que tener presente: **el rebalanceo no rescata tonelada**,
sólo comprime el calendario. La ganancia es terminar antes, no producir más.
Si todo cabe en la semana de todos modos, hay que preguntarse cuánto vale
terminar antes (ver la decisión pendiente abajo).

### D. Las 144 h son parejas para las 14 líneas — SIN VERIFICAR

Es un supuesto plano: 6 días × 24 h para todas. Florence confirma que **el
programador tampoco lo sabe**, así que no hay de dónde contrastarlo hoy.

Si alguna línea corre menos turnos, su utilización real es más alta que la
que muestra el módulo y su capacidad libre es menor. ITW-14 aparece al 47 %:
puede ser que esté floja, o puede ser que corra menos turnos. **No lo
sabemos, y es lo que más conviene averiguar.**

### E. El objetivo es el CALENDARIO, no el rendimiento — ES UNA DECISIÓN, no un hecho

Ésta es la asunción menos obvia y la que más mueve lo que el módulo
recomienda. El optimizador minimiza, en este orden:

1. tonelada que se queda fuera del horizonte (hoy no muerde: es cero)
2. **cuándo cierra la línea más cargada** ← manda en la práctica
3. horas totales de planta

El nivel 2 es lo que empareja las líneas. Y tiene una consecuencia incómoda:
**para emparejar, a veces hay que mandar material a una línea más lenta.**

Sobre el schedule del 17/09, de los 19 movimientos propuestos:

| | movimientos | tonelada |
|---|---|---|
| a una línea **más rápida** | 11 | 92.5 t |
| prácticamente igual | 4 | — |
| a una línea **más lenta** | **4** | **20.7 t** |

El peor es ITW-7 → ITW-6 a 16.30 mm: de 849 a **525 kg/h**, un 38 % menos.

Se intentó prohibirlo —«nunca mandes material a una línea más lenta»— y
**rompió el balanceo**: la prueba `balancea en vez de vaciar la linea lenta`
falla, porque emparejar ITW-1 contra ITW-7 requiere precisamente devolver
carga a la línea lenta. No es un error del código: **los dos objetivos son
incompatibles y hay que elegir uno.**

Medida la alternativa sobre el mismo schedule —mover un rollo **sólo** si
corre más rápido en otra línea, con el horizonte como límite y sin importar
el balance:

| objetivo | rollos a mover | horas de corrida ganadas | movimientos a línea más lenta |
|---|---|---|---|
| calendario (**hoy**) | 69 | 24.7 h | **4** |
| rendimiento | 98 | **63.0 h** | **0** |

El de rendimiento gana más del doble de horas y no degrada ningún material,
pero deja la línea más cargada en 143.9 h — pegada al horizonte de 144 h,
que es justo el supuesto sin verificar de la sección D.

### La decisión de Florence: RENDIMIENTO, con tope de ±5 rollos

Florence eligió el objetivo de **rendimiento**. Se implementó como opción
conmutable: el objetivo de calendario sigue vivo y con sus pruebas, y regresar
es cambiar `SUPUESTOS.objetivo` a `'calendario'`.

El objetivo de rendimiento viene con **dos límites**, sin los cuales no se
debe usar.

**Techo = lo que la línea más cargada YA corre hoy** (129.6 h en el schedule
del 17/09). No es un supuesto: si ITW-2 corre esas horas esta semana, son
demostrablemente factibles. Se usa esto y **no las 144 h**, porque Florence
confirmó que ese 144 es relleno — se puso porque no había forma de ver las
horas por línea, no porque se haya medido.

**Tope = ±5 rollos por línea** respecto de lo que el programador escribió.
Sin freno, el objetivo de rendimiento vacía las líneas lentas: sobre el 17/09
dejaba **una línea con UN rollo**.

Primero se probó un **piso de 60 h de trabajo por línea**, y se reemplazó por
el tope a petición de Florence. La medición le dio la razón:

- **con tope de 5, el piso ya no cambiaba ni un movimiento** — una línea que
  no puede soltar más de 5 rollos no se queda vacía sola, así que el piso
  sobraba;
- el **rollo es la unidad en la que el programador piensa** y en la que tiene
  que defender el cambio, no la hora;
- el tope limita el **cambio**, que es lo que cuesta vender en piso; el piso
  limitaba el **resultado**, que es más difícil de juzgar.

Resultado sobre el schedule del 17/09:

| | calendario | **rendimiento ±5** | rendimiento ±10 | rendimiento sin tope |
|---|---|---|---|---|
| rollos a mover | 69 en 19 movs | **44 en 12 movs** | 84 en 15 | 185 en 28 |
| horas de planta ganadas | 25.7 h | **26.2 h** | 46.2 h | 91.4 h |
| toneladas | 22.0 t | **22.4 t** | 40.1 t | 82.3 t |
| ritmo de planta | 856 kg/h | **856 kg/h** | 869 kg/h | 901 kg/h |
| movimientos a línea más lenta | **4** | **0** | 0 | 0 |
| cambio máximo en una línea | ±12 rollos | **±5** | ±10 | ±32 |
| línea más floja queda con | 21 rollos | **28 rollos** | 23 | **1 rollo** |

Lo que compra el ±5 contra el objetivo viejo: **la misma tonelada (22.4 contra
22.0 t) con mucho menos movimiento** — 44 rollos en vez de 69, ninguna línea
cambia más de 5 — y **sin degradar un solo rollo**, contra los 4 movimientos
a línea más lenta que hacía el de calendario. Lo que cuesta: el programa ya no
cierra antes (129.3 h contra 95.2 h).

Subir el tope compra más: con ±10 son 40.1 t. Es la perilla a mover cuando
Florence vea qué tanto cambio aguanta el piso de verdad.

Cuando el tope frena una mejora, la pantalla lo dice con las líneas y cuántos
rollos cambiaron. Si esa semana alguna aguanta más, se sube el tope y se toma
la mejora.

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

**Ojo con qué significa el incremento.** El reajuste **no produce más
tonelada**: el programa hace las mismas 1 084 t antes y después. Lo que cambia
es que cierra antes, y esa capacidad liberada valdría esas toneladas **sólo si
hay órdenes que adelantar**. Si no las hay, la ganancia es terminar antes.

*(La tabla de abajo se midió con el cambio de medida en 45 min, antes de que
Florence diera el estándar de 30. Con 30 min el escenario vigente cierra en
**129.6 h → 95.2 h** y la capacidad liberada es **+391 t**. Los otros tres
escenarios no se volvieron a medir: sirven para comparar entre sí, no como
cifra final.)*

| escenario | cierre | capacidad liberada |
|---|---|---|
| **Deber ser (DEM), el delgado se puede repartir** | **132.1 h → 96.5 h** | **+400 t** |
| Deber ser (DEM), el delgado amarrado a ITW-2 | 132.1 h → 97.1 h | +391 t |
| Si corrieran con Neturen, delgado repartido | 167.1 h → 98.2 h | +760 t |
| Si corrieran con Neturen, delgado amarrado | 167.1 h → 128.4 h | +327 t |

Con el DEM ya confirmado como deber ser (sección 5b), **el escenario vigente
es el primero: +400 t**. Los dos de Neturen quedan como referencia de lo que
mediría el aviso si resultara que no lo están usando.

Nótese que con DEM la concentración del delgado en ITW-2 casi deja de
importar (+400 contra +391 t): con el devanador correcto, ITW-2 corre el
delgado lo bastante rápido como para que repartirlo ya no sea la palanca.
La pregunta de abajo sigue valiendo la pena, pero dejó de ser la más cara.

## 5b. Devanador de ITW-2 — RESUELTO

**Confirmado con Florence: el deber ser es el devanador DEM.** Es lo que el
módulo calcula por omisión.

El WI pide que el schedule anote el uso del DEM en las notas, pero en la
práctica casi nunca se anota: en el schedule del 17/09 **ninguna de las 29
órdenes de ITW-2 lo menciona**. Tomar esa ausencia como "corrió con
Neturen" subestimaría el rendimiento de ITW-2 hasta a la mitad.

| Ø mm | Neturen | DEM | factor |
|---|---|---|---|
| 5.72 | 275 | 600 | **2.18×** |
| 7.19 | 275 | 478 | **1.74×** |
| 6.65 / 7.70 / 7.92 | 275 | 375 | 1.36× |
| 9.40 en adelante | 275 → 170 | igual | 1.00× |

**Que no venga anotado no se ignora: levanta un aviso**, con las órdenes
afectadas y con lo que costaría si de verdad hubieran corrido con Neturen.
Sobre el schedule del 17/09 el aviso dice:

> 29 órdenes (65 130 kg) no traen anotado el devanador. Se calcularon con
> DEM, que es el deber ser. Si en realidad corrieron con Neturen, el
> programa no cierra en 129.6 h sino en 164.6 h — 35.1 h más.

El schedule puede registrar la excepción escribiendo `Neturen` en las notas,
igual que escribe `DEM`. Si lo hace, el módulo usa esa receta y no avisa.

### Lo que cambió en los números

Con el DEM como deber ser, la línea base del programa del 17/09 pasa de
167.1 h a **132.1 h de cierre**, y el incremento por balanceo de +760 t a
**+400 t** (con el cambio en 45 min; hoy, con 30 min, son 129.6 h y +391 t). No es que la oportunidad se haya encogido: es que una parte de
lo que parecía oportunidad era en realidad un supuesto equivocado sobre
cómo corre ITW-2 hoy.

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
