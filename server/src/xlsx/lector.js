/**
 * Lector de .xlsx sin dependencias.
 *
 * Un .xlsx es un ZIP con XML adentro. Para el modulo demo, que corre como un
 * solo archivo HTML en el navegador, no se puede depender de una libreria de
 * CDN: en la red de planta suele estar bloqueada. Aqui se descomprime con
 * DecompressionStream, que ya trae el navegador (y Node 18+), y se parsea el
 * XML con DOMParser.
 *
 * Solo lee lo que este modulo necesita: valores de celda de una hoja. No
 * entiende estilos, formulas, fechas ni ZIP64 — para eso esta exceljs del
 * lado del servidor.
 */

import { ErrorDeDatos } from '../errores.js';

const FIRMA_EOCD = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

/** Abre el ZIP y devuelve un mapa nombre -> Uint8Array con los bytes crudos. */
export async function abrirZip(buffer) {
  const datos = new Uint8Array(buffer);
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);

  const eocd = buscarEocd(vista, datos.length);
  if (eocd === -1) throw new ErrorDeDatos('this does not look like an .xlsx file (end of ZIP not found)');

  const entradas = vista.getUint16(eocd + 10, true);
  let cursor = vista.getUint32(eocd + 16, true);
  const archivos = new Map();

  for (let i = 0; i < entradas; i++) {
    if (vista.getUint32(cursor, true) !== FIRMA_CENTRAL) break;
    const metodo = vista.getUint16(cursor + 10, true);
    const comprimido = vista.getUint32(cursor + 20, true);
    const largoNombre = vista.getUint16(cursor + 28, true);
    const largoExtra = vista.getUint16(cursor + 30, true);
    const largoComentario = vista.getUint16(cursor + 32, true);
    const offsetLocal = vista.getUint32(cursor + 42, true);
    const nombre = new TextDecoder().decode(datos.subarray(cursor + 46, cursor + 46 + largoNombre));

    if (comprimido === 0xffffffff || offsetLocal === 0xffffffff) {
      throw new ErrorDeDatos('this .xlsx uses ZIP64, which this reader does not support');
    }
    archivos.set(nombre, { metodo, comprimido, offsetLocal });
    cursor += 46 + largoNombre + largoExtra + largoComentario;
  }

  const resultado = new Map();
  for (const [nombre, e] of archivos) {
    if (vista.getUint32(e.offsetLocal, true) !== FIRMA_LOCAL) continue;
    // El encabezado local repite los largos y puede diferir del central.
    const largoNombre = vista.getUint16(e.offsetLocal + 26, true);
    const largoExtra = vista.getUint16(e.offsetLocal + 28, true);
    const inicio = e.offsetLocal + 30 + largoNombre + largoExtra;
    const crudo = datos.subarray(inicio, inicio + e.comprimido);
    resultado.set(nombre, e.metodo === 0 ? crudo : await inflar(crudo));
  }
  return resultado;
}

/** El EOCD vive al final, pero puede traer comentario: se busca hacia atras. */
function buscarEocd(vista, largo) {
  const minimo = Math.max(0, largo - 0xffff - 22);
  for (let i = largo - 22; i >= minimo; i--) {
    if (vista.getUint32(i, true) === FIRMA_EOCD) return i;
  }
  return -1;
}

async function inflar(bytes) {
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Bytes -> string. Se llama asi y no 'texto' porque ingesta/comun.js ya
 *  usa ese nombre para otra cosa, y los dos se inlinean juntos en el demo. */
function decodificar(bytes) {
  return new TextDecoder().decode(bytes);
}

/** DOMParser en el navegador; en Node se inyecta uno equivalente. */
let parsear = (xml) => new DOMParser().parseFromString(xml, 'application/xml');

export function usarParser(fn) {
  parsear = fn;
}

/** 'BC' -> 54 (1-based, igual que exceljs). */
export function columnaANumero(letras) {
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

/**
 * Lee una hoja y devuelve sus filas como arreglos indexados por columna.
 *
 * @returns {{nombres: string[], filas: Map<number, Map<number, string|number>>}}
 */
export async function leerHoja(buffer, nombreHoja = null) {
  const zip = await abrirZip(buffer);

  const libro = parsear(decodificar(zip.get('xl/workbook.xml')));
  const rels = parsear(decodificar(zip.get('xl/_rels/workbook.xml.rels')));

  const destinos = new Map();
  for (const r of rels.getElementsByTagName('Relationship')) {
    destinos.set(r.getAttribute('Id'), r.getAttribute('Target').replace(/^\/?xl\//, ''));
  }

  const hojas = [...libro.getElementsByTagName('sheet')].map((s) => ({
    nombre: s.getAttribute('name'),
    ruta: destinos.get(s.getAttribute('r:id') ?? s.getAttributeNS?.(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id',
    )),
  }));
  const nombres = hojas.map((h) => h.nombre);

  const elegida = nombreHoja
    ? hojas.find((h) => h.nombre === nombreHoja || h.nombre.trim() === nombreHoja.trim())
    : hojas[0];
  if (!elegida) throw new ErrorDeDatos(`the file has no sheet named "${nombreHoja}"`);

  const compartidas = leerCompartidas(zip, parsear);
  const xml = zip.get(`xl/${elegida.ruta}`);
  if (!xml) throw new ErrorDeDatos(`sheet ${elegida.nombre} was not found inside the file`);

  const doc = parsear(decodificar(xml));
  const filas = new Map();

  for (const fila of doc.getElementsByTagName('row')) {
    const numeroFila = Number(fila.getAttribute('r'));
    const celdas = new Map();
    for (const celda of fila.getElementsByTagName('c')) {
      const ref = celda.getAttribute('r') ?? '';
      const columna = columnaANumero(ref.replace(/\d+/g, ''));
      const valor = valorDeCelda(celda, compartidas);
      if (valor !== null) celdas.set(columna, valor);
    }
    if (celdas.size) filas.set(numeroFila, celdas);
  }

  propagarCombinadas(doc, filas);
  return { nombres, hoja: elegida.nombre, filas };
}

/**
 * En una celda combinada el valor vive solo en la esquina superior izquierda;
 * el resto del rango esta vacio en el archivo. Se copia a todo el rango para
 * que el lector se comporte igual que exceljs del lado del servidor: si los
 * dos entornos no ven lo mismo, un parser que funciona en uno falla en el
 * otro y cuesta mucho darse cuenta.
 */
function propagarCombinadas(doc, filas) {
  for (const m of doc.getElementsByTagName('mergeCell')) {
    const rango = m.getAttribute('ref') ?? '';
    const [desde, hasta] = rango.split(':');
    if (!desde || !hasta) continue;

    const f1 = Number(desde.replace(/\D/g, ''));
    const f2 = Number(hasta.replace(/\D/g, ''));
    const c1 = columnaANumero(desde.replace(/\d+/g, ''));
    const c2 = columnaANumero(hasta.replace(/\d+/g, ''));

    const ancla = filas.get(f1)?.get(c1);
    if (ancla === undefined) continue;

    for (let f = f1; f <= f2; f++) {
      if (!filas.has(f)) filas.set(f, new Map());
      const celdas = filas.get(f);
      for (let c = c1; c <= c2; c++) if (!celdas.has(c)) celdas.set(c, ancla);
    }
  }
}

function leerCompartidas(zip, parsear) {
  const bytes = zip.get('xl/sharedStrings.xml');
  if (!bytes) return [];
  const doc = parsear(decodificar(bytes));
  return [...doc.getElementsByTagName('si')].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''),
  );
}

function valorDeCelda(celda, compartidas) {
  const tipo = celda.getAttribute('t');
  if (tipo === 'inlineStr') {
    const is = celda.getElementsByTagName('is')[0];
    return is ? [...is.getElementsByTagName('t')].map((t) => t.textContent).join('') : null;
  }
  const v = celda.getElementsByTagName('v')[0];
  if (!v) return null;
  const bruto = v.textContent;
  if (tipo === 's') return compartidas[Number(bruto)] ?? null;
  if (tipo === 'e') return null; // #REF!, #VALUE!, ...
  if (tipo === 'str') return bruto;
  if (tipo === 'b') return bruto === '1';
  const n = Number(bruto);
  return Number.isFinite(n) ? n : bruto;
}
