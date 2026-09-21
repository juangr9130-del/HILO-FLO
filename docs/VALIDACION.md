# Qué falta para validar

Dos cosas distintas, con dueños distintos. Ninguna depende de la otra.

- **Validar los números** — que el modelo se parezca a la planta. Lo contesta
  Florence con datos de producción. Sin esto, el módulo calcula muy rápido
  algo que nadie sabe si es cierto.
- **Validar el software** — que aguante en producción. Lo contesta TI con un
  SQL Server. Hoy el módulo nunca ha tocado una base real.

---

## Parte 1 — Validar los números

### 1.1 El backtest: una semana cerrada

Es la prueba que más vale, y es barata. Se toma **una semana ya terminada**,
se le da al módulo el schedule tal como se cargó ese lunes, y se compara lo
que predijo contra lo que de verdad pasó.

Lo que hace falta, por cada orden de esa semana:

| dato | de dónde | para qué |
|---|---|---|
| línea donde corrió | SAP / SCADA | ver si corrió donde estaba programada |
| kg producidos | SAP (confirmación) | contra los kg programados |
| hora de inicio y fin de la corrida | SCADA | **el dato clave**: da las horas reales |
| paros de esa corrida | SCADA / captura | separar tiempo de corrida de tiempo muerto |

Con eso salen las tres comparaciones que importan:

1. **kg/h real contra kg/h calculado**, por línea y diámetro. Valida de un
   golpe toda la cadena: velocidad de receta → geometría → rendimiento. Si
   el error es parejo (ej. el real es 85 % del calculado en todas las
   líneas), eso es la eficiencia y se captura y ya. Si es disparejo, hay
   algo del proceso que el modelo no está viendo.
2. **Horas por línea reales contra predichas.** Valida además el tiempo de
   cambio de medida.
3. **¿La línea más cargada fue la que el módulo dijo?** Es lo único que
   sostiene el número de toneladas. Si el cuello de botella real de esa
   semana fue otro, el modelo está mal en lo que más importa.

Cuando el kg/h real no coincida con el calculado en alguna línea, la
corrección se captura en la pantalla de **Velocidades** y queda registrada
contra el valor del documento. No hace falta tocar código ni volver a cargar
el WI.

**Basta una semana para saber si vamos bien o mal. Tres semanas dan la
eficiencia con confianza.**

### 1.2 Confirmar los tres supuestos que quedan

Ver [`SUPUESTOS.md`](SUPUESTOS.md). Sólo dos mueven el resultado:

- **Horas disponibles por línea.** Hoy son 144 h parejas para las catorce.
  Si alguna corre menos turnos, el balanceo está resolviendo un problema
  que no existe.
- **Minutos por cambio de medida.** Hoy son 45. Ya se midió la sensibilidad:
  entre 0 y 90 minutos el resultado se mueve menos de 1 %. **No es urgente.**
- **Eficiencia.** Apagada a propósito. El backtest la da medida, así que no
  hay que adivinarla.

### 1.3 La prueba de cara

**Para esto no hay que esperar a TI.** `web/hiloflo-demo.html` es un solo
archivo que se abre con doble clic: sin servidor, sin base y sin internet.
Corre el mismo motor que el módulo instalado, y **las velocidades ya vienen
dentro**, así que lo único que hay que tener a la mano es el schedule.

Sentar al programador frente a la pantalla de Programación con un schedule
suyo y preguntarle: **¿esto se parece a tu semana?** No a ver si le gustan
los consejos — a ver si el tablero refleja lo que él sabe que pasa. Si dice
"esa línea nunca corre esa medida" o "eso no tarda tanto", eso es una
restricción real que el modelo no tiene, y vale más que cualquier prueba
automática.

### 1.4 El piloto

Aplicar **dos o tres** movimientos de los que propone, no los veinte, en una
semana real. Medir las toneladas de esa semana contra el promedio de las
anteriores.

Es la única validación que convence a alguien que no va a leer este
documento. Y con el botón de *Lo hago / No aplica* ya queda registrado qué
se aceptó, así que la comparación sale sola.

---

## Parte 2 — Validar el software

### 2.1 Lo que ya está probado

- **79 pruebas automáticas** (`cd server && npm test`), que cubren el motor
  completo, la lectura de los dos Excel, los avisos y la API entera.
- **Corrido punto a punto con los archivos reales** de Florence: 3 282
  recetas, 472 órdenes, folio emitido y análisis completo en 3 segundos.
- **El motor se portó de Python a JavaScript** y se verificó que reproduce
  exactamente los mismos números que la versión original.

### 2.2 Lo que NO está probado, y hay que probar

Esto es lo que falta de verdad:

- **El módulo nunca ha tocado un SQL Server.** Los dos scripts de `sql/` no
  se han ejecutado una sola vez. Todo lo probado corre con el repositorio en
  memoria. Es el hueco más grande.
  - Correr `00_catalogos_flo.sql` y `01_flo.sql` en una base limpia.
  - Subir un schedule, apagar el módulo, prenderlo y volver a abrir el folio:
    tiene que pintarse idéntico.
  - **Ya apareció un defecto por aquí** que sólo una base real habría
    encontrado: los dos repositorios devolvían formas distintas, así que un
    folio histórico se rompía en SQL Server y funcionaba en memoria. Ya está
    corregido, pero es la prueba de que esta parte no se puede dar por
    buena sin ejecutarla.
- **La sesión nunca se ha probado con un JWT real.** Hace falta un token
  emitido por otro módulo de la plataforma para confirmar que `JWT_SECRET`
  y el nombre de la cookie coinciden, y que el rechazo por rol funciona.
- **Dos cargas simultáneas.** El folio sale de `MAX(folio)` del año y el
  `INSERT` viene después. Si dos personas suben un schedule en el mismo
  segundo, el segundo choca contra la restricción de unicidad. Hoy respondería
  con un error 500. Hay que probarlo y decidir si se reintenta o se deja así:
  con un solo programador puede que nunca pase.
- **Las tipografías se cargan de Google Fonts.** En la red de planta
  probablemente esté bloqueado. Hay que abrir la pantalla desde una máquina
  de piso y ver si se ven bien; si no, servir los `.woff2` desde el módulo.
- **La pantalla sólo se ha visto en Chromium a 1440 px.** Falta verla en el
  navegador y en el monitor que de verdad usa el programador. El módulo demo
  sirve justo para eso, sin montar nada.
- **El módulo demo usa `DecompressionStream` para abrir el .xlsx**, que
  existe en Chrome y Edge modernos pero no en navegadores viejos. Si la
  máquina del programador trae algo antiguo, hay que verlo: el archivo avisa
  con un error claro, no se queda callado.

### 2.3 Lo que conviene probar aunque no sea urgente

- Un schedule con formato distinto al del 17/09 (otra semana, otro layout de
  columnas) para ver si el lector aguanta o hay que ajustar los alias.
- Una revisión del WI con diámetros nuevos.
- Un schedule vacío, uno con basura, uno de 5 MB.

---

## Orden sugerido

1. **Sentar al programador frente al módulo demo** (§1.3). Es lo único que
   se puede hacer hoy mismo, cuesta media hora y puede tirar supuestos que
   costarían semanas de backtest.
2. **Pedir los datos de una semana cerrada** (§1.1). Es lo que más tarda en
   conseguirse y lo que más vale, así que se pide temprano y mientras llega
   se avanza en lo demás.
3. **Montar el SQL Server** (§2.2) y correr el módulo de verdad contra él.
4. **Correr el backtest** cuando lleguen los datos.
5. **Piloto de dos o tres movimientos** (§1.4).

Los pasos 1 y 2 son independientes: uno es de planta y el otro de TI, y se
pueden ir en paralelo.
