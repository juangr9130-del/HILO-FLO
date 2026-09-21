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
lo desincronizaría en cuanto cambie la eficiencia de una línea. La vista lo
recalcula siempre desde la geometría del alambre.

Las recetas además se discriminan por devanador, grado y SLM, cosa que
`hilo_rendimiento` no necesita — ver `docs/DOMINIO.md`.

### 3. El módulo arranca sin base de datos

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
  src/ingesta/            lectura de los dos Excel de planta
  src/servicio/           orquestación y el paquete que consume la pantalla
  src/db/                 SQL Server y el repositorio en memoria
  src/rutas/              la API
  test/                   pruebas del motor y de la ingesta

web/                      la pantalla (HTML/CSS/JS, sin framework)
```

`src/motor/` no importa nada de Express, de mssql ni de exceljs. Se puede
probar sin levantar nada, que es lo que hacen las pruebas.

## API

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/estado` | modo de almacenamiento, sesión y supuestos vigentes |
| `POST` | `/api/recetas` | carga el WI de parámetros; reemplaza la tabla completa |
| `GET` | `/api/recetas` | qué recetas hay cargadas |
| `GET` | `/api/programas` | historial de folios |
| `POST` | `/api/programas` | **sube el schedule, emite folio y devuelve el análisis** |
| `GET` | `/api/programas/:folio` | vuelve a pintar un folio anterior |
| `GET` | `/api/programas/:folio/rendimiento` | matriz kg/h por diámetro y línea |
| `POST` | `/api/programas/:folio/movimientos/:id` | el programador marca si aceptó el consejo |

Escribir (cargar recetas o un schedule) exige rol `programador`,
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
