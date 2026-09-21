/**
 * La forma en que los parsers ven una hoja de Excel, sea quien sea que la
 * haya leido.
 *
 *   { nombres, hoja, filas: Map<numeroFila, Map<numeroColumna, valor>> }
 *
 * Hay dos lectores: exceljs del lado del servidor (ingesta/excel.js) y el
 * propio de xlsx/lector.js para el modulo demo, que corre en el navegador
 * sin dependencias. Los dos producen esta misma forma, asi que la
 * interpretacion del WI y del schedule se escribe UNA vez y sirve en los dos
 * lados.
 *
 * Este archivo no importa nada a proposito: se inlinea tal cual en el HTML
 * del demo.
 */

/** Valor de una celda, o null. */
export function celda(filas, numeroFila, numeroColumna) {
  return filas.get(numeroFila)?.get(numeroColumna) ?? null;
}

/** Los numeros de fila presentes, en orden. */
export function numerosDeFila(filas) {
  return [...filas.keys()].sort((a, b) => a - b);
}
