/**
 * Lector del production schedule (Schedule_8200_<fecha>.xlsx).
 *
 * La hoja "Sheet1" trae el volcado de SAP: una orden por renglon, ya
 * asignada a un work center (BB001..BB014 = ITW-1..ITW-14).
 *
 *   Work Center | Material Number | Material Description | Important Notes
 *   Order | PO Printed | Drawn | Operation Quantity (MEINH) | Customer PO
 *
 * El diametro no viene en columna propia: va dentro de la descripcion
 * ("CSW,14.70mm HT HT 1950-2000 MPa", "CSW, 7,92 1450-1610 SAE1065 half SID"),
 * con coma o punto decimal. De ahi se saca tambien el grado y la marca SLM.
 *
 * Cada bloque de work center cierra con un renglon de subtotal (material
 * "nan" y orden "0") y el archivo cierra con el gran total; ambos se ignoran.
 *
 * La hoja HEATLINE_SCHEDULE (el tablero visual por turnos) no se lee: viene
 * con formulas rotas (#REF!) y la asignacion completa ya esta en Sheet1.
 */

import { DIAMETRO_MAX, DIAMETRO_MIN, Orden, Programa, workCenterALinea } from '../motor/modelos.js';
import { numero, texto } from './comun.js';
import { celda, numerosDeFila } from './hoja.js';

export const HOJA_SCHEDULE = 'Sheet1';
export const FILA_ENCABEZADOS = 2;

/** Diametro dentro de la descripcion: 1 o 2 enteros y 1 o 2 decimales. */
const RE_DIAMETRO = /(\d{1,2}[.,]\d{1,2})\s*(?:mm)?/gi;


/** encabezado normalizado -> campo */
const ALIAS = new Map([
  ['work center', 'workCenter'],
  ['material number', 'material'],
  ['material description', 'descripcion'],
  ['important notes', 'notas'],
  ['order', 'orden'],
  ['operation quantity (meinh)', 'cantidad'],
  ['customer po', 'clientePo'],
]);

const OBLIGATORIAS = ['workCenter', 'descripcion', 'cantidad'];

// --------------------------------------------------------------------------
// Interpretacion de la descripcion del material
// --------------------------------------------------------------------------

/** Primer numero de la descripcion que sea un diametro plausible. */
export function diametroDe(descripcion) {
  for (const m of String(descripcion).matchAll(RE_DIAMETRO)) {
    const valor = Number(m[1].replace(',', '.'));
    if (valor >= DIAMETRO_MIN && valor <= DIAMETRO_MAX) return Math.round(valor * 100) / 100;
  }
  return null;
}

/** Grupo de grado tal como lo discrimina el WI: "1065" o "9254". */
export function gradoDe(descripcion) {
  return String(descripcion).toUpperCase().includes('1065') ? '1065' : '9254';
}

/** SLM (Super Low Modulus) cambia la receta de ITW-10. */
export function esSlm(descripcion) {
  return /\bSLM\b/.test(String(descripcion).toUpperCase());
}

/**
 * Devanador que indica el schedule, o null si no dice nada.
 *
 * El WI pide que se anote el DEM en notas. Se lee tambien el Neturen para
 * que se pueda registrar la excepcion al deber ser, que es el DEM.
 *
 * null NO significa Neturen: significa "no lo anotaron". Quien decide que
 * hacer con eso es la tabla de recetas (asume el deber ser) y el analisis
 * (levanta el aviso).
 */
export function winderDe(txt) {
  const T = String(txt).toUpperCase();
  if (/\bDEM\b/.test(T)) return 'DEM';
  if (/\bNETUREN\b/.test(T)) return 'NETUREN';
  return null;
}

// --------------------------------------------------------------------------
// Lectura
// --------------------------------------------------------------------------

function mapearColumnas(filas) {
  const columnas = new Map();
  for (const [numeroColumna, valor] of filas.get(FILA_ENCABEZADOS) ?? new Map()) {
    const encabezado = texto(valor).toLowerCase();
    if (ALIAS.has(encabezado)) columnas.set(ALIAS.get(encabezado), numeroColumna);
  }
  const faltantes = OBLIGATORIAS.filter((c) => !columnas.has(c));
  if (faltantes.length) {
    throw new Error(`al schedule le faltan columnas obligatorias: ${faltantes.join(', ')}`);
  }
  return columnas;
}

/**
 * Interpreta una hoja ya leida.
 *
 * Es puro: no sabe de archivos ni de exceljs, asi que corre igual en el
 * servidor y en el navegador. Ver ingesta/hoja.js.
 */
export function interpretarPrograma({ filas }, horizonte = '') {
  const columnas = mapearColumnas(filas);
  const leer = (numeroFila, campo) =>
    columnas.has(campo) ? celda(filas, numeroFila, columnas.get(campo)) : null;

  const ordenes = [];
  const secuencias = new Map();

  for (const numeroFila of numerosDeFila(filas)) {
    if (numeroFila <= FILA_ENCABEZADOS) continue;

    const workCenter = texto(leer(numeroFila, 'workCenter'));
    const descripcion = texto(leer(numeroFila, 'descripcion'));
    const cantidad = numero(leer(numeroFila, 'cantidad'));

    // Renglones de subtotal y gran total.
    if (!workCenter || !descripcion || !cantidad || cantidad <= 0) continue;

    const diametroMm = diametroDe(descripcion);
    if (diametroMm === null) continue;

    const linea = workCenterALinea(workCenter);
    const secuencia = (secuencias.get(linea) ?? 0) + 1;
    secuencias.set(linea, secuencia);
    const notas = texto(leer(numeroFila, 'notas'));

    ordenes.push(
      new Orden({
        id: texto(leer(numeroFila, 'orden')) || `${linea}-${String(secuencia).padStart(3, '0')}`,
        diametroMm,
        kilogramos: cantidad,
        linea,
        material: texto(leer(numeroFila, 'material')),
        descripcion,
        grupoGrado: gradoDe(descripcion),
        slm: esSlm(descripcion),
        winder: winderDe(`${descripcion} ${notas}`),
        secuencia,
        notas,
        clientePo: texto(leer(numeroFila, 'clientePo')),
      }),
    );
  }

  if (!ordenes.length) {
    throw new Error('no se leyo ninguna orden del schedule; revisa la hoja y los encabezados');
  }
  return new Programa(ordenes, horizonte);
}
