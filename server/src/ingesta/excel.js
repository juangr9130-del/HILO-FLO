/**
 * Carga de hojas con exceljs. Solo del lado del servidor: el modulo demo usa
 * xlsx/lector.js, que no depende de nada.
 */

import ExcelJS from 'exceljs';
import { valorCelda } from './comun.js';
import { ErrorDeDatos } from '../errores.js';

/** Carga una hoja y la entrega en la forma de ingesta/hoja.js. */
export async function cargarConExcelJs(rutaOBuffer, { hoja = null, preferida = null } = {}) {
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(rutaOBuffer)) await wb.xlsx.load(rutaOBuffer);
  else await wb.xlsx.readFile(rutaOBuffer);

  const ws = elegirHoja(wb, hoja, preferida);
  const filas = new Map();
  ws.eachRow({ includeEmpty: false }, (fila, numeroFila) => {
    const celdas = new Map();
    fila.eachCell({ includeEmpty: false }, (c, numeroColumna) => {
      const v = valorCelda(c);
      if (v !== null) celdas.set(numeroColumna, v);
    });
    if (celdas.size) filas.set(numeroFila, celdas);
  });

  return { nombres: wb.worksheets.map((w) => w.name), hoja: ws.name, filas };
}

function elegirHoja(wb, hoja, preferida) {
  if (hoja) {
    const elegida = wb.getWorksheet(hoja);
    if (!elegida) throw new ErrorDeDatos(`the file has no sheet named "${hoja}"`);
    return elegida;
  }
  if (preferida) {
    // El nombre de la hoja del WI trae un espacio al final en el documento
    // original; se compara sin espacios por si lo corrigen.
    const objetivo = preferida.trim().toLowerCase();
    const encontrada = wb.worksheets.find((w) => w.name.trim().toLowerCase() === objetivo);
    if (encontrada) return encontrada;
  }
  if (!wb.worksheets.length) throw new ErrorDeDatos('the file has no readable sheet');
  return wb.worksheets[0];
}
