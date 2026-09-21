# Cómo encaja HILO-FLO en la plataforma Mubea

HILO-FLO es un módulo más de la plataforma, con el mismo contrato que
HILO / HORA / MTTO / AUTO. Este documento sólo dice **en qué se apega y en
qué se aparta**; la fuente de verdad de las decisiones de plataforma es
`Plant_Platform/docs/ARQUITECTURA_PLATAFORMA.md`.

## Lo que se respeta tal cual

| Tema | Cómo queda en FLO |
|---|---|
| Proceso | **Un proceso PM2 propio** (`ecosystem.config.cjs`, `pm2 start`). No comparte backend con ningún otro módulo: reiniciar FLO no tumba a HILO. |
| Base de datos | `Plant_Platform`, misma convención `snake_case`. |
| Prefijo de tabla | `flo_` para lo propio, `cat_` para lo compartido. Ninguna tabla `cat_` se duplica ni se cachea localmente. |
| Sesión | Cookie `httpOnly` con JWT firmado con el `JWT_SECRET` compartido. El módulo lo verifica localmente, sin consultar a nadie. |
| Acceso | `cat_rol` + `rol_modulo_acceso` con el módulo `'FLO'`. **Defensa en el propio backend**, no sólo en el ruteo: `exigirAcceso` rechaza por rol aunque alguien llegue a la URL por su cuenta. |
| Idioma de la UI | **Inglés**, a diferencia de los módulos de CSW. Florence está en Kentucky. El código y la documentación siguen en español. |
| UI | `#1B3A66` azul de header y marca; `#CC5500` **sólo** en botón de acción primaria y tab activo. Estatus verde `#2F8F5B`, azul `#2A6DB0`, ámbar `#C98A12`, rojo `#C23B2E`, gris `#6B7785`. `Barlow Condensed` para títulos y números, `Public Sans` para cuerpo. |
| Tarjeta KPI | **Bloque sólido**, nunca tarjeta blanca con acento. Azul marino cuando la métrica es neutra (órdenes a mover); semántico cuando tiene dimensión de bien/mal (rojo el cierre de hoy, verde el reajustado). |

## Lo que se aparta, y por qué

### 1. Florence levanta su propia instancia de `Plant_Platform`

Misma arquitectura y mismo esquema, **base física distinta**. No es una
decisión de diseño sino un hecho: Florence es otra planta. Otros empleados,
otro catálogo de líneas, otra red, otro SAP. Compartir la base con CSW
mezclaría dos plantillas de personal en `cat_empleados` y dos catálogos de
líneas en `cat_linea` sin que ningún módulo lo pida.

Lo único que cambia del `catalogos-core` de CSW son dos `CHECK`
(`sql/00_catalogos_flo.sql`):

- `cat_linea.area` acepta `'ITW'` además de `'HL'`/`'DL'`;
- `rol_modulo_acceso.modulo` acepta `'FLO'`.

**Si Florence y CSW van a compartir instancia**, hay que agregar una
columna `planta` a `cat_linea`, `cat_empleados` y `cat_usuarios`, y
filtrarla en todas las consultas. Es más trabajo y más riesgo; se hace sólo
si alguien lo pide explícitamente.

### 2. Las recetas se guardan en mm/s, no en kg/h

El módulo HILO de CSW tiene `hilo_rendimiento (linea_id, diametro, kg_hora)`.
FLO guarda `flo_velocidad (linea_id, diametro_mm, mm_s, ...)` y deriva el
kg/h en la vista `vw_flo_rendimiento`.

La razón es que **el kg/h no existe en ningún documento de Florence**: el
WI-FLO-CSW-P-526 emite velocidad de línea en mm/s. Guardar el kg/h calculado
lo desincronizaría en cuanto cambie la velocidad o la eficiencia. Se deriva
siempre de la geometría del alambre, así que corregir una velocidad
recalcula el rendimiento solo.

Las recetas además se discriminan por devanador, grado y SLM, cosa que
`hilo_rendimiento` no necesita — ver `docs/DOMINIO.md`.

### 3. El catálogo de velocidades viaja dentro del módulo

`server/src/catalogo/velocidades.js` trae las 3 282 velocidades del WI, en
17 series (ITW-2 tiene tres variantes por devanador y grado, ITW-10 dos por
SLM). Lo genera `scripts/generar-catalogo.mjs` una vez por revisión del
documento; no se edita a mano.

Al arrancar contra SQL Server, `flo_velocidad` se siembra de ahí si está
vacía. De ese momento en adelante **manda la base**: la siembra es
idempotente y no pisa lo que planta haya ajustado.

`flo_velocidad` guarda `mm_s` (lo vigente) y `mm_s_documento` (lo que dice el
WI). Guardar los dos permite tres cosas que un solo valor no da: ver qué se
apartó y por cuánto (`vw_flo_velocidad_ajustada`), regresar a lo del
documento con un clic, y no perder las correcciones de planta cuando salga
una revisión nueva.

En el módulo demo el mismo catálogo vive dentro del HTML y los ajustes se
guardan en el navegador, pero el modelo es idéntico: semilla fija más
ajustes encima.

### 4. La interfaz va en inglés, el código en español

Los módulos de CSW tienen la interfaz en español porque los usa personal de
la planta de México. FLO la tiene en inglés porque la usa el programador de
Florence, Kentucky.

Eso alcanza a todo lo que el usuario lee, y algunas de esas cadenas nacen
lejos de la pantalla: el texto del consejo lo arma `optimizador.js`, los
avisos `avisos.js`, y los errores de archivo mal formado los lanzan los
lectores. Todos están en inglés, con un comentario que dice por qué.

Una consecuencia concreta: el ruteo de errores **no puede depender del texto
del mensaje**. Antes la API decidía si responder 400 o 500 con una expresión
regular sobre el mensaje en español; al traducir, un archivo malo empezó a
responder 500. Ahora se distingue por tipo (`ErrorDeDatos`), que no depende
del idioma.

### 5. El módulo arranca sin base de datos

Sin `DB_SERVER`, FLO levanta con un repositorio en memoria (`modo demo`).
Sirve para revisar la pantalla con los Excel reales sin montar SQL Server.
Pierde todo al reiniciar y lo dice en el arranque y en `/api/estado`.

## Estructura

```
sql/
  00_catalogos_flo.sql    delta a catalogos-core (area ITW, módulo FLO)
  01_flo.sql              tablas del módulo

server/                   el proceso PM2
  src/motor/              el algoritmo, sin nada de IO
    modelos.js            Linea, Orden, PuntoVelocidad, Programa
    rendimiento.js        mm/s + diámetro -> kg/h, matriz de compatibilidad
    programa.js           evaluación del schedule línea por línea
    optimizador.js        búsqueda de áreas de oportunidad
  src/ingesta/            interpretación de los dos Excel
    hoja.js               la forma en que los parsers ven una hoja
    parametros.js         el WI (puro)
    schedule.js           el schedule de SAP (puro)
    excel.js              carga con exceljs (sólo servidor)
    servidor.js           junta el cargador con los intérpretes
  src/xlsx/lector.js      lector de .xlsx sin dependencias (para el demo)
  src/servicio/           orquestación y el paquete que consume la pantalla
  src/db/                 SQL Server y el repositorio en memoria
  src/rutas/              la API
  src/catalogo/           las velocidades del WI, dentro del módulo
  scripts/                generadores del catálogo y del módulo demo
  test/                   pruebas

web/                      la pantalla (HTML/CSS/JS, sin framework)
  comun/                  lo que comparten las dos interfaces
  demo/                   plantilla e interfaz del archivo suelto
  hiloflo-demo.html       generado: no se edita a mano
```

`src/motor/` no importa nada de Express, de mssql ni de exceljs. Se puede
probar sin levantar nada, que es lo que hacen las pruebas.

### Un solo motor, dos entornos

El módulo demo (`web/hiloflo-demo.html`) corre en el navegador sin nada
instalado, pero **no es una maqueta aparte**: se genera concatenando las
mismas fuentes del motor con `npm run demo`. Ya costó una vez tener dos
implementaciones del mismo algoritmo, cuando el motor estaba en Python y en
JavaScript, y no se va a repetir.

Lo único que cambia entre los dos entornos es quién lee el Excel: exceljs en
el servidor, `src/xlsx/lector.js` en el navegador. Los dos entregan la misma
forma (`src/ingesta/hoja.js`) y hay una prueba que verifica que ven lo mismo
celda por celda.

El generador **se detiene** si dos módulos declaran el mismo nombre: al
concatenar viven en el mismo ámbito y uno pisaría al otro en silencio. Ya
pasó con `avisoSinReceta`, que existía en el dominio y en el pintado.

La pantalla de Velocidades tampoco está dos veces: vive en
`web/comun/pantalla-catalogo.js` y las dos interfaces le inyectan de dónde
salen los datos (local en el demo, la API en el instalado). Lo único que sí
se repite es la fórmula del kg/h, porque la interfaz del módulo instalado no
carga el motor y necesita recalcular el renglón en cada tecla — y hay una
prueba que truena si las dos dejan de coincidir.

## API

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/estado` | modo de almacenamiento, sesión y supuestos vigentes |
| `GET` | `/api/velocidades` | el catálogo con su kg/h y qué se apartó del documento |
| `PUT` | `/api/velocidades/:clave` | ajusta una velocidad |
| `DELETE` | `/api/velocidades/:clave` | regresa ese punto al valor del documento |
| `DELETE` | `/api/velocidades` | regresa todos |
| `GET` | `/api/programas` | historial de folios |
| `POST` | `/api/programas` | **sube el schedule, emite folio y devuelve el análisis** |
| `GET` | `/api/programas/:folio` | vuelve a pintar un folio anterior |
| `GET` | `/api/programas/:folio/rendimiento` | matriz kg/h por diámetro y línea |
| `POST` | `/api/programas/:folio/movimientos/:id` | el programador marca si aceptó el consejo |

Escribir (ajustar velocidades o cargar un schedule) exige rol `programador`,
`produccion` o `administrador`. Leer lo permite además `supervisor` y
`calidad`.

## El folio

Cada carga del schedule recibe un folio `FLO-<año>-<consecutivo>`
(`FLO-2026-0007`). Un programa subido **nunca se sobreescribe**: si hay que
corregirlo se sube otro y sale un folio nuevo. Así el análisis queda anclado
a lo que de verdad se cargó ese día, con los supuestos con los que se corrió.

El consecutivo sale de `MAX(folio)` del año, no de un contador aparte, para
que no se desincronice si alguien borra un renglón.

## Pendientes de despliegue

- **Las tipografías se cargan hoy de Google Fonts.** En la red de planta eso
  puede estar bloqueado. Antes de producción conviene servir los `.woff2` de
  Barlow Condensed y Public Sans desde el propio módulo.
- Confirmar con TI el puerto (hoy `3005`) y que el launcher apunte ahí.
- Sembrar `cat_empleados` / `cat_usuarios` con la plantilla de Florence.
- `cat_usuarios.pin` en texto plano es un pendiente heredado de la
  plataforma: migrar a hash antes de que FLO autentique contra esa tabla.
