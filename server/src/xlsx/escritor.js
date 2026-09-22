/**
 * Escritor de .xlsx sin dependencias, hermano de lector.js.
 *
 * El servidor podria usar exceljs, pero el modulo demo corre en el navegador
 * sin nada instalado, y el archivo que sale de los dos tiene que ser
 * identico: es el que el programador manda por correo. Un solo escritor.
 *
 * Un .xlsx es un ZIP de XML. Se guarda SIN COMPRIMIR (metodo STORED): es
 * valido, Excel lo abre igual, y ahorra tener que implementar deflate o
 * depender de CompressionStream, que no esta en todos lados. Un schedule de
 * 500 renglones pesa unos 200 KB asi, que para adjuntar a un correo sobra.
 *
 * Los textos van como inlineStr y no en la tabla de cadenas compartidas:
 * mas bytes, pero nada de indices que mantener cuadrados.
 */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);

/** & < > " ' dentro de un valor XML. */
export function escapar(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Excel no abre el archivo si trae caracteres de control; el schedule de
    // SAP a veces los arrastra en las notas.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/** Numero de columna (1) -> letra (A). */
export function letraColumna(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - r - 1) / 26;
  }
  return s;
}

function celdaXml(valor, fila, columna, estilo) {
  const ref = `${letraColumna(columna)}${fila}`;
  const s = estilo ? ` s="${estilo}"` : '';
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`;
}

/**
 * Una hoja.
 *
 * @param {object} hoja
 *   nombre    como aparece en la pestana
 *   filas     [[valor, ...], ...]; null o '' deja la celda vacia
 *   estilos   [[indice, ...], ...] paralelo a filas, opcional
 *   anchos    ancho de cada columna en caracteres, opcional
 *   combinar  ['A1:I1', ...], opcional
 */
function hojaXml({ filas, estilos = [], anchos = [], combinar = [] }) {
  const cols = anchos.length
    ? `<cols>${anchos
        .map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${a}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  const cuerpo = filas
    .map((fila, i) => {
      const n = i + 1;
      const celdas = fila
        .map((v, j) => celdaXml(v, n, j + 1, estilos[i]?.[j]))
        .join('');
      return `<row r="${n}">${celdas}</row>`;
    })
    .join('');
  const fusiones = combinar.length
    ? `<mergeCells count="${combinar.length}">${combinar.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${cuerpo}</sheetData>${fusiones}</worksheet>`;
}

/**
 * Los cuatro estilos que usa el modulo. El indice es la posicion en cellXfs:
 *   0 normal   1 titulo   2 encabezado   3 total   4 resaltado (movido)
 */
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF1B3A66"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1B3A66"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDEBD9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF1B3A66"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export const ESTILO = { NORMAL: 0, TITULO: 1, ENCABEZADO: 2, TOTAL: 3, MOVIDO: 4 };

/**
 * Arma el .xlsx.
 *
 * @param {object[]} hojas  ver hojaXml
 * @returns {Uint8Array} el archivo listo para descargar o mandar
 */
export function construirXlsx(hojas) {
  const n = hojas.length;
  const archivos = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${hojas.map((h, i) => `<sheet name="${escapar(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', ESTILOS],
    ...hojas.map((h, i) => [`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h)]),
  ];

  return empaquetarZip(archivos.map(([nombre, texto]) => [nombre, utf8(texto)]));
}

/** ZIP con entradas STORED. Suficiente para lo que Excel necesita. */
function empaquetarZip(entradas) {
  const locales = [];
  const central = [];
  let offset = 0;

  for (const [nombre, datos] of entradas) {
    const n = utf8(nombre);
    const crc = crc32(datos);
    const local = new Uint8Array(30 + n.length + datos.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true); // version necesaria
    v.setUint16(8, 0, true); // metodo 0 = STORED
    v.setUint32(14, crc, true);
    v.setUint32(18, datos.length, true);
    v.setUint32(22, datos.length, true);
    v.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(datos, 30 + n.length);
    locales.push(local);

    const dir = new Uint8Array(46 + n.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, 0, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, datos.length, true);
    dv.setUint32(24, datos.length, true);
    dv.setUint16(28, n.length, true);
    dv.setUint32(42, offset, true);
    dir.set(n, 46);
    central.push(dir);

    offset += local.length;
  }

  const tamCentral = central.reduce((t, c) => t + c.length, 0);
  const fin = new Uint8Array(22);
  const fv = new DataView(fin.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, entradas.length, true);
  fv.setUint16(10, entradas.length, true);
  fv.setUint32(12, tamCentral, true);
  fv.setUint32(16, offset, true);

  const total = offset + tamCentral + 22;
  const salida = new Uint8Array(total);
  let p = 0;
  for (const b of locales) { salida.set(b, p); p += b.length; }
  for (const b of central) { salida.set(b, p); p += b.length; }
  salida.set(fin, p);
  return salida;
}
