/**
 * Lector del WI-FLO-CSW-P-526 "ITW Process Parameters".
 *
 * De ese documento solo interesa la tabla "ITW Line Speed [mm/s]": el
 * diametro de alambre estirado en la columna A y la velocidad de cada linea
 * en las columnas C..P.
 *
 * La tabla viene partida en varios bloques (por el salto de pagina del
 * documento) pero el acomodo de columnas se repite identico en todos, asi
 * que se recorre la hoja completa y se toma cualquier renglon cuya columna A
 * sea numerica y caiga en el rango plausible de diametro.
 *
 * Acomodo de columnas (confirmado en los 8 bloques del documento):
 *
 *     C   ITW-2   devanador Neturen
 *     D   ITW-2   devanador DEM, grado 9254
 *     E   ITW-2   devanador DEM, grado 1065
 *     F   ITW-3
 *     G   ITW-5 y ITW-6
 *     H   ITW-1
 *     I   ITW-7, ITW-8 y ITW-9
 *     J   ITW-10  NON SLM
 *     K   ITW-10  SLM
 *     L   ITW-4
 *     M   ITW-11
 *     N   ITW-12
 *     O   ITW-13
 *     P   ITW-14
 */

import { DIAMETRO_MAX, DIAMETRO_MIN, PuntoVelocidad } from '../motor/modelos.js';
import { celda, numerosDeFila } from './hoja.js';
import { ErrorDeDatos } from '../errores.js';
import { redondear } from '../util/numeros.js';

export const HOJA_WI = 'Anlagen - Setup ';

/** columna -> { lineas, winder, grado, slm } */
export const COLUMNAS = new Map([
  [3, { lineas: ['ITW-2'], winder: 'NETUREN', grado: null, slm: null }],
  [4, { lineas: ['ITW-2'], winder: 'DEM', grado: '9254', slm: null }],
  [5, { lineas: ['ITW-2'], winder: 'DEM', grado: '1065', slm: null }],
  [6, { lineas: ['ITW-3'], winder: null, grado: null, slm: null }],
  [7, { lineas: ['ITW-5', 'ITW-6'], winder: null, grado: null, slm: null }],
  [8, { lineas: ['ITW-1'], winder: null, grado: null, slm: null }],
  [9, { lineas: ['ITW-7', 'ITW-8', 'ITW-9'], winder: null, grado: null, slm: null }],
  [10, { lineas: ['ITW-10'], winder: null, grado: null, slm: false }],
  [11, { lineas: ['ITW-10'], winder: null, grado: null, slm: true }],
  [12, { lineas: ['ITW-4'], winder: null, grado: null, slm: null }],
  [13, { lineas: ['ITW-11'], winder: null, grado: null, slm: null }],
  [14, { lineas: ['ITW-12'], winder: null, grado: null, slm: null }],
  [15, { lineas: ['ITW-13'], winder: null, grado: null, slm: null }],
  [16, { lineas: ['ITW-14'], winder: null, grado: null, slm: null }],
]);

/** El diametro de la columna A trae ruido de punto flotante (6.25000000000001). */
export const DECIMALES_DIAMETRO = 2;


/**
 * Interpreta una hoja ya leida.
 *
 * Es puro: no sabe de archivos ni de exceljs, asi que corre igual en el
 * servidor y en el navegador. Ver ingesta/hoja.js.
 */
export function interpretarVelocidades({ filas }) {
  const puntos = [];

  for (const numeroFila of numerosDeFila(filas)) {
    const bruto = celda(filas, numeroFila, 1);
    if (typeof bruto !== 'number') continue;
    const diametroMm = redondear(bruto, DECIMALES_DIAMETRO);
    if (diametroMm < DIAMETRO_MIN || diametroMm > DIAMETRO_MAX) continue;

    for (const [columna, { lineas, winder, grado, slm }] of COLUMNAS) {
      const velocidad = celda(filas, numeroFila, columna);
      // Celda vacia = esa linea no corre ese diametro.
      if (typeof velocidad !== 'number' || velocidad <= 0) continue;
      for (const linea of lineas) {
        puntos.push(new PuntoVelocidad({ linea, diametroMm, mmS: velocidad, winder, grado, slm }));
      }
    }
  }

  if (!puntos.length) {
    throw new ErrorDeDatos(
      'no line speeds were found in the WI; check that the sheet is the ITW Line Speed one',
    );
  }
  return puntos;
}

