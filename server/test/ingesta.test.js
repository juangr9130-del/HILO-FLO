import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineaAWorkCenter, workCenterALinea } from '../src/motor/modelos.js';
import { leerVelocidades } from '../src/ingesta/parametros.js';
import { diametroDe, esSlm, gradoDe, leerPrograma, winderDe } from '../src/ingesta/schedule.js';
import { crearSchedule, crearWi } from './fixtures.js';

async function carpeta(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hiloflo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// --- equivalencia work center <-> linea -----------------------------------

test('work center y linea van y vienen', () => {
  for (const [wc, l] of [['BB001', 'ITW-1'], ['BB010', 'ITW-10'], ['BB014', 'ITW-14']]) {
    assert.equal(workCenterALinea(wc), l);
    assert.equal(lineaAWorkCenter(l), wc);
  }
});

test('un work center desconocido se deja tal cual', () => {
  assert.equal(workCenterALinea('OTRO'), 'OTRO');
});

// --- interpretacion de la descripcion del material ------------------------

test('el diametro sale de la descripcion', () => {
  const casos = [
    ['CSW,14.70mm HT HT 1950-2000 MPa', 14.7],
    ['CSW, 7,92 1450-1610 SAE1065 half SID', 7.92],
    ['CSW,13,10 SLM2025 SLM 54SiCr6', 13.1],
    ['CSW,18,90 C2 54SiCr6', 18.9],
    ['CSW, 15.09 SAE1065 CL2 1340-1500 MPa SID', 15.09],
  ];
  for (const [desc, esperado] of casos) assert.equal(diametroDe(desc), esperado);
});

test('ignora numeros que no son diametro', () => {
  // 1950-2000 MPa no debe confundirse con un diametro
  assert.equal(diametroDe('CSW HT 1950-2000 MPa'), null);
});

test('el grado distingue 1065 del resto', () => {
  assert.equal(gradoDe('CSW, 7,92 1450-1610 SAE1065 half SID'), '1065');
  assert.equal(gradoDe('CSW,18,90 C2 54SiCr6'), '9254');
});

test('SLM solo como palabra completa', () => {
  assert.equal(esSlm('CSW,13,10 SLM2025 SLM 54SiCr6'), true);
  assert.equal(esSlm('CSW,14.70mm HT HT 1950-2000 MPa'), false);
});

test('el devanador se lee de las notas, o queda sin anotar', () => {
  assert.equal(winderDe('usar DEM pan winder'), 'DEM');
  assert.equal(winderDe('corrio con Neturen winder'), 'NETUREN');
  // null es "no lo anotaron", no "uso Neturen": lo resuelve el deber ser
  // y lo reporta el aviso.
  assert.equal(winderDe('sin nota'), null);
});

// --- lectura del WI -------------------------------------------------------

const VELOCIDADES = {
  // 3=ITW-2 Neturen, 5=ITW-2 DEM 1065, 7=ITW-5/6, 9=ITW-7/8/9,
  // 10=ITW-10 NON SLM, 11=ITW-10 SLM, 16=ITW-14
  14.7: { 3: 275, 5: 450, 9: 200, 10: 190, 11: 150 },
  14.75: { 3: 270, 7: 140, 9: 198 },
  20.0: { 16: 117 },
};

test('expande las columnas agrupadas a una linea cada una', async (t) => {
  const wi = await crearWi(join(await carpeta(t), 'wi.xlsx'), VELOCIDADES);
  const lineas = new Set((await leerVelocidades(wi)).map((p) => p.linea));
  for (const l of ['ITW-7', 'ITW-8', 'ITW-9', 'ITW-5', 'ITW-6']) assert.ok(lineas.has(l), l);
});

test('las lineas de una misma columna comparten velocidad', async (t) => {
  const wi = await crearWi(join(await carpeta(t), 'wi.xlsx'), VELOCIDADES);
  const puntos = await leerVelocidades(wi);
  for (const l of ['ITW-7', 'ITW-8', 'ITW-9']) {
    const p = puntos.find((x) => x.linea === l && x.diametroMm === 14.7);
    assert.equal(p.mmS, 200);
  }
});

test('marca los discriminantes de ITW-2 e ITW-10', async (t) => {
  const wi = await crearWi(join(await carpeta(t), 'wi.xlsx'), VELOCIDADES);
  const por = new Map((await leerVelocidades(wi)).map((p) => [`${p.linea}#${p.mmS}`, p]));
  assert.equal(por.get('ITW-2#275').winder, 'NETUREN');
  assert.equal(por.get('ITW-2#450').winder, 'DEM');
  assert.equal(por.get('ITW-2#450').grado, '1065');
  assert.equal(por.get('ITW-10#190').slm, false);
  assert.equal(por.get('ITW-10#150').slm, true);
});

test('celda vacia significa que la linea no corre ese diametro', async (t) => {
  const wi = await crearWi(join(await carpeta(t), 'wi.xlsx'), VELOCIDADES);
  const itw14 = (await leerVelocidades(wi)).filter((p) => p.linea === 'ITW-14');
  assert.deepEqual(itw14.map((p) => p.diametroMm), [20.0]);
});

test('redondea el ruido de punto flotante del diametro', async (t) => {
  const wi = await crearWi(join(await carpeta(t), 'ruido.xlsx'), { 6.25000000000001: { 3: 275 } });
  assert.equal((await leerVelocidades(wi))[0].diametroMm, 6.25);
});

test('ignora numeros fuera del rango de diametro', async (t) => {
  const wi = await crearWi(join(await carpeta(t), 'fuera.xlsx'), { 14.7: { 3: 275 }, 1950: { 3: 999 } });
  const ds = new Set((await leerVelocidades(wi)).map((p) => p.diametroMm));
  assert.deepEqual([...ds], [14.7]);
});

test('falla si la hoja no trae velocidades', async (t) => {
  const wi = await crearWi(join(await carpeta(t), 'vacio.xlsx'), {});
  await assert.rejects(() => leerVelocidades(wi), /no se encontro ninguna velocidad/);
});

// --- lectura del schedule -------------------------------------------------

const RENGLONES = [
  ['BB001', '14703', 'CSW,14.70mm HT 1950-2000 MPa', null, '600001', 2300],
  ['BB001', '14703', 'CSW,14.70mm HT 1950-2000 MPa', null, '600002', 2498],
  ['BB007', '91944287', 'CSW, 15.09 SAE1065 CL2 SID', null, '600003', 1916],
  ['BB010', '13103', 'CSW,13,10 SLM2025 SLM 54SiCr6', null, '600004', 2300],
  ['BB002', '12403', 'CSW,12,40 HT', 'use DEM pan winder', '600005', 2300],
  // subtotal de bloque y gran total: se ignoran
  ['BB010', 'nan', 'nan', null, '0', 4600],
  ['nan', 'nan', 'nan', null, '0', 11314],
];

test('lee solo las ordenes reales, sin subtotales', async (t) => {
  const sch = await crearSchedule(join(await carpeta(t), 's.xlsx'), RENGLONES);
  const p = await leerPrograma(sch);
  assert.equal(p.length, 5);
  assert.equal(p.kilogramos, 11314);
});

test('asigna la linea desde el work center', async (t) => {
  const sch = await crearSchedule(join(await carpeta(t), 's.xlsx'), RENGLONES);
  const p = await leerPrograma(sch);
  assert.deepEqual(p.lineasUsadas(), ['ITW-1', 'ITW-2', 'ITW-7', 'ITW-10']);
  assert.deepEqual(p.deLinea('ITW-1').map((o) => o.id), ['600001', '600002']);
});

test('marca grado, SLM y devanador', async (t) => {
  const sch = await crearSchedule(join(await carpeta(t), 's.xlsx'), RENGLONES);
  const por = new Map((await leerPrograma(sch)).ordenes.map((o) => [o.id, o]));
  assert.equal(por.get('600003').grupoGrado, '1065');
  assert.equal(por.get('600004').slm, true);
  assert.equal(por.get('600005').winder, 'DEM');
  assert.equal(por.get('600001').slm, false);
  assert.equal(por.get('600001').winder, null);
});

test('la secuencia respeta el orden del archivo', async (t) => {
  const sch = await crearSchedule(join(await carpeta(t), 's.xlsx'), RENGLONES);
  const p = await leerPrograma(sch);
  assert.deepEqual(p.deLinea('ITW-1').map((o) => o.secuencia), [1, 2]);
});

test('falla si el archivo no trae ordenes', async (t) => {
  const sch = await crearSchedule(join(await carpeta(t), 'vacio.xlsx'), []);
  await assert.rejects(() => leerPrograma(sch), /no se leyo ninguna orden/);
});
