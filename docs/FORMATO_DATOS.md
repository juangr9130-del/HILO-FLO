# Contrato de datos

Lo que el programa espera encontrar en cada archivo. Si Florence cambia el
formato, esto es lo que hay que ajustar.

## WI de parámetros de proceso

- **Hoja:** `Anlagen - Setup ` (con el espacio al final; también se acepta sin
  él). 
- **Columna A:** diámetro de alambre estirado, numérico, entre 4 y 30 mm.
- **Columnas C a P:** velocidad en mm/s. El mapa columna → línea está en
  `server/src/ingesta/parametros.js` (constante `COLUMNAS`).
- Celda vacía o no numérica = esa línea no corre ese diámetro.
- Los encabezados repetidos de cada bloque se ignoran solos, porque su
  columna A no es numérica.

**Si se agregan columnas o se mueve una línea de lugar, hay que actualizar
`COLUMNAS`.** Es el único punto del código que depende de la posición.

## Production schedule

- **Hoja:** `Sheet1` (o la primera). 
- **Encabezados en la fila 2**, con estos nombres exactos (no distingue
  mayúsculas):

| encabezado | obligatorio | uso |
|---|---|---|
| `Work Center` | sí | línea asignada (`BB007` → `ITW-7`) |
| `Material Description` | sí | de aquí salen diámetro, grado y SLM |
| `Operation Quantity (MEINH)` | sí | kilogramos |
| `Order` | no | folio; si falta se genera uno |
| `Material Number` | no | informativo |
| `Important Notes` | no | de aquí sale la marca de devanador DEM |
| `Customer PO` | no | informativo |

- Renglones sin work center, sin descripción o sin cantidad se ignoran: así
  se saltan los subtotales y el gran total.

## Catálogo de líneas

Ya no es un CSV: vive en `cat_linea` (las 14 líneas ITW más la 15
desactivada) y `flo_parametro_linea` (horas, eficiencia y minutos de
cambio de cada una). Los crea `sql/00_catalogos_flo.sql` y
`sql/01_flo.sql`.

`cat_linea.activo = 0` deja la línea visible en el tablero pero impide que
el algoritmo le mande carga. Así está ITW-15, que sigue por instalarse.

Los supuestos por omisión están documentados en [`SUPUESTOS.md`](SUPUESTOS.md).
