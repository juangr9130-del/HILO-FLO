# Contrato de datos

Lo que el programa espera encontrar en cada archivo. Si Florence cambia el
formato, esto es lo que hay que ajustar.

## WI de parámetros de proceso

- **Hoja:** `Anlagen - Setup ` (con el espacio al final; también se acepta sin
  él). Se puede forzar otra con `--hoja-parametros`.
- **Columna A:** diámetro de alambre estirado, numérico, entre 4 y 30 mm.
- **Columnas C a P:** velocidad en mm/s. El mapa columna → línea está en
  `src/hiloflo/parametros.py::COLUMNAS`.
- Celda vacía o no numérica = esa línea no corre ese diámetro.
- Los encabezados repetidos de cada bloque se ignoran solos, porque su
  columna A no es numérica.

**Si se agregan columnas o se mueve una línea de lugar, hay que actualizar
`COLUMNAS`.** Es el único punto del código que depende de la posición.

## Production schedule

- **Hoja:** `Sheet1` (o la primera). Se puede forzar con `--hoja-schedule`.
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

## Catálogo de líneas (opcional)

CSV con estas columnas:

```csv
linea,horas_disponibles,eficiencia,minutos_cambio,activa
ITW-1,144,0.88,45,si
ITW-15,144,0.85,45,no
```

- `eficiencia` acepta fracción (`0.88`) o porcentaje (`88`).
- `activa` en `no` deja la línea en el reporte pero impide que el optimizador
  le mande carga. Así está ITW-15 por omisión.

Sin este archivo se usan los supuestos de `src/hiloflo/catalogo.py`, que
están documentados en [`SUPUESTOS.md`](SUPUESTOS.md).
