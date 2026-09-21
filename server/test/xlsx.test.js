/**
 * El lector propio (el que usa el modulo demo en el navegador, sin
 * dependencias) tiene que dar exactamente lo mismo que exceljs.
 *
 * Si los dos no ven igual, un parser que funciona en el servidor falla en el
 * navegador y cuesta mucho darse cuenta. Por eso se comparan los dos caminos
 * completos, no solo la lectura de celdas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

import { leerHoja, usarParser, columnaANumero } from '../src/xlsx/lector.js';
import { cargarConExcelJs } from '../src/ingesta/excel.js';
import { interpretarVelocidades } from '../src/ingesta/parametros.js';
import { interpretarPrograma } from '../src/ingesta/schedule.js';
import { leerPrograma, leerVelocidades } from '../src/ingesta/servidor.js';
import { crearSchedule, crearWi } from './fixtures.js';

usarParser((xml) => new DOMParser().parseFromString(xml, 'text/xml'));

const VELOCIDADES = {
  7.0: { 3: 275, 4: 600, 8: 250, 9: 250 },
  14.7: { 8: 170, 9: 200, 15: 180 },
  14.75: { 8: 168 },
};

const RENGLONES = [
  ['BB001', '14703', 'CSW,14.70mm HT 1950-2000 MPa', null, '600001', 2300],
  ['BB002', '7003', 'CSW, 7,00 1450-1610 SAE1065', 'use DEM pan winder', '600002', 1916],
  ['BB010', '13103', 'CSW,13,10 SLM2025 SLM 54SiCr6', null, '600003', 2498],
  ['BB010', 'nan', 'nan', null, '0', 2498],
];

async function carpeta(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hiloflo-xlsx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('columnaANumero traduce las letras de columna', () => {
  assert.equal(columnaANumero('A'), 1);
  assert.equal(columnaANumero('P'), 16);
  assert.equal(columnaANumero('AA'), 27);
  assert.equal(columnaANumero('BC'), 55);
});

test('el lector propio ve las mismas celdas que exceljs', async (t) => {
  const dir = await carpeta(t);
  const wi = await crearWi(join(dir, 'wi.xlsx'), VELOCIDADES);

  const mio = await leerHoja(await readFile(wi));
  const deExcelJs = await cargarConExcelJs(wi);

  for (const [numeroFila, celdas] of deExcelJs.filas) {
    for (const [numeroColumna, valor] of celdas) {
      assert.deepEqual(
        mio.filas.get(numeroFila)?.get(numeroColumna) ?? null,
        valor,
        `celda fila ${numeroFila} columna ${numeroColumna}`,
      );
    }
  }
});

test('el WI da las mismas velocidades por los dos caminos', async (t) => {
  const dir = await carpeta(t);
  const wi = await crearWi(join(dir, 'wi.xlsx'), VELOCIDADES);

  const porServidor = await leerVelocidades(wi);
  const porNavegador = interpretarVelocidades(await leerHoja(await readFile(wi)));

  assert.equal(porNavegador.length, porServidor.length);
  assert.deepEqual(
    porNavegador.map((p) => [p.linea, p.diametroMm, p.mmS, p.winder, p.grado, p.slm]),
    porServidor.map((p) => [p.linea, p.diametroMm, p.mmS, p.winder, p.grado, p.slm]),
  );
});

test('el schedule da las mismas ordenes por los dos caminos', async (t) => {
  const dir = await carpeta(t);
  const sch = await crearSchedule(join(dir, 's.xlsx'), RENGLONES);

  const porServidor = await leerPrograma(sch);
  const porNavegador = interpretarPrograma(await leerHoja(await readFile(sch)));

  assert.equal(porNavegador.length, porServidor.length);
  assert.equal(porNavegador.kilogramos, porServidor.kilogramos);
  assert.deepEqual(
    porNavegador.ordenes.map((o) => [o.id, o.linea, o.diametroMm, o.kilogramos, o.grupoGrado, o.slm, o.winder]),
    porServidor.ordenes.map((o) => [o.id, o.linea, o.diametroMm, o.kilogramos, o.grupoGrado, o.slm, o.winder]),
  );
});

test('el lector nombra las hojas del libro', async (t) => {
  const dir = await carpeta(t);
  const sch = await crearSchedule(join(dir, 's.xlsx'), RENGLONES);
  const { nombres, hoja } = await leerHoja(await readFile(sch));
  assert.deepEqual(nombres, ['Sheet1']);
  assert.equal(hoja, 'Sheet1');
});

test('pedir una hoja que no existe falla claro', async (t) => {
  const dir = await carpeta(t);
  const sch = await crearSchedule(join(dir, 's.xlsx'), RENGLONES);
  const bytes = await readFile(sch);
  await assert.rejects(() => leerHoja(bytes, 'No existe'), /no tiene la hoja/);
});

test('un archivo que no es .xlsx falla claro', async () => {
  await assert.rejects(
    () => leerHoja(new TextEncoder().encode('esto no es un zip').buffer),
    /no parece un \.xlsx/,
  );
});
