/**
 * Lectura de los dos Excel de planta desde el servidor.
 *
 * Junta el cargador de exceljs con los interpretes puros. El modulo demo hace
 * lo mismo en el navegador con xlsx/lector.js y los MISMOS interpretes.
 */

import { cargarConExcelJs } from './excel.js';
import { HOJA_WI, interpretarVelocidades } from './parametros.js';
import { HOJA_SCHEDULE, interpretarPrograma } from './schedule.js';

/** Lee el WI-FLO-CSW-P-526 desde un archivo o un buffer. */
export async function leerVelocidades(rutaOBuffer, hoja = null) {
  return interpretarVelocidades(await cargarConExcelJs(rutaOBuffer, { hoja, preferida: HOJA_WI }));
}

/** Lee el production schedule desde un archivo o un buffer. */
export async function leerPrograma(rutaOBuffer, { hoja = null, horizonte = '' } = {}) {
  return interpretarPrograma(
    await cargarConExcelJs(rutaOBuffer, { hoja, preferida: HOJA_SCHEDULE }),
    horizonte,
  );
}
