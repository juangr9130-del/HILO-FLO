/**
 * Genera archivos .xlsx minimos con el mismo acomodo que los de planta, para
 * que los tests no dependan de los documentos reales de Florence.
 */
import ExcelJS from 'exceljs';
import { COLUMNAS, HOJA_WI } from '../src/ingesta/parametros.js';

/** WI de juguete: { diametro: { columna: mmS } }. */
export async function crearWi(ruta, velocidades) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(HOJA_WI);

  ws.getCell('A1').value = 'ITW Line Speed\n[mm/s]';
  ws.getCell('A2').value = 'Drawn Wire Rod Ø\n[mm]';
  for (const [columna, { lineas }] of COLUMNAS) ws.getRow(2).getCell(columna).value = lineas.join('/');

  let fila = 3;
  for (const diametro of Object.keys(velocidades).map(Number).sort((a, b) => a - b)) {
    ws.getRow(fila).getCell(1).value = diametro;
    for (const [columna, mmS] of Object.entries(velocidades[diametro])) {
      ws.getRow(fila).getCell(Number(columna)).value = mmS;
    }
    fila++;
  }
  await wb.xlsx.writeFile(ruta);
  return ruta;
}

const ENCABEZADOS = [
  'Work Center',
  'Material Number',
  'Material Description',
  'Important Notes',
  'Order',
  'PO Printed Yes/No',
  'Drawn Yes/No',
  'Operation Quantity (MEINH)',
  'Customer PO',
];

/** Schedule de juguete. Cada renglon: [wc, material, descripcion, notas, orden, kg]. */
export async function crearSchedule(ruta, renglones) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  ws.getCell('A1').value = 'CSW Production Schedule (prueba)';
  ENCABEZADOS.forEach((e, i) => (ws.getRow(2).getCell(i + 1).value = e));

  renglones.forEach(([wc, material, descripcion, notas, orden, kg], i) => {
    const fila = ws.getRow(3 + i);
    fila.getCell(1).value = wc;
    fila.getCell(2).value = material;
    fila.getCell(3).value = descripcion;
    fila.getCell(4).value = notas;
    fila.getCell(5).value = orden;
    fila.getCell(8).value = kg;
  });
  await wb.xlsx.writeFile(ruta);
  return ruta;
}
