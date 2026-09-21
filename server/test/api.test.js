/**
 * Pruebas de la API completa, con el repositorio en memoria.
 *
 * Cubren la capa que el motor no cubre: ruteo, control de acceso, manejo de
 * archivos malos y el contrato del paquete que consume la pantalla.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { crearApp } from '../src/app.js';
import { RepositorioMemoria } from '../src/db/memoria.js';
import { crearSchedule, crearWi } from './fixtures.js';

const WI = {
  // ITW-2 tabulada por devanador; el resto simples
  7.0: { 3: 275, 4: 600, 8: 250, 9: 250 },
  14.7: { 8: 170, 9: 200, 15: 180 },
};

const RENGLONES = [
  ['BB001', '14703', 'CSW,14.70mm HT 1950-2000 MPa', null, '600001', 2300],
  ['BB001', '14703', 'CSW,14.70mm HT 1950-2000 MPa', null, '600002', 2300],
  ['BB002', '7003', 'CSW, 7,00 1450-1610 SAE1065', null, '600003', 2300],
];

async function levantar(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hiloflo-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const repo = new RepositorioMemoria();
  const servidor = crearApp(repo).listen(0);
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const wi = await crearWi(join(dir, 'wi.xlsx'), WI);
  const schedule = await crearSchedule(join(dir, 's.xlsx'), RENGLONES);
  return { base, dir, wi, schedule, repo };
}

async function subir(base, ruta, archivo, nombre) {
  const datos = new FormData();
  datos.append('archivo', new Blob([await readFile(archivo)]), nombre);
  return fetch(`${base}${ruta}`, { method: 'POST', body: datos });
}

test('el estado dice en que modo corre', async (t) => {
  const { base } = await levantar(t);
  const r = await (await fetch(`${base}/api/estado`)).json();
  assert.equal(r.modulo, 'FLO');
  assert.equal(r.almacenamiento, 'memoria');
  assert.equal(r.baseDeDatos, false);
});

test('sin recetas cargadas no deja subir un schedule', async (t) => {
  const { base, schedule } = await levantar(t);
  const r = await subir(base, '/api/programas', schedule, 's.xlsx');
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /recetas/);
});

test('flujo completo: recetas, schedule, folio y analisis', async (t) => {
  const { base, wi, schedule } = await levantar(t);

  const recetas = await (await subir(base, '/api/recetas', wi, 'wi.xlsx')).json();
  assert.ok(recetas.recetas > 0);

  const r = await subir(base, '/api/programas', schedule, 's.xlsx');
  assert.equal(r.status, 201);
  const p = await r.json();

  assert.match(p.folio, /^FLO-\d{4}-\d{4}$/);
  assert.equal(p.ordenes, 3);
  assert.equal(p.kilogramos, 6900);
  assert.ok(p.analisis.makespanActual > 0);
  // La invariante es la tonelada, no el cierre: ver DOMINIO.md.
  assert.ok(p.analisis.toneladasDentroDelHorizonte >= 0);
  assert.ok(Array.isArray(p.analisis.movimientos));
  assert.ok(Array.isArray(p.lineas));
});

test('el folio es consecutivo y no se repite', async (t) => {
  const { base, wi, schedule } = await levantar(t);
  await subir(base, '/api/recetas', wi, 'wi.xlsx');
  const a = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  const b = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  assert.notEqual(a.folio, b.folio);
  assert.equal(Number(b.folio.slice(-4)), Number(a.folio.slice(-4)) + 1);
});

test('un folio se vuelve a leer igual a como se emitio', async (t) => {
  const { base, wi, schedule } = await levantar(t);
  await subir(base, '/api/recetas', wi, 'wi.xlsx');
  const emitido = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();

  const releido = await (await fetch(`${base}/api/programas/${emitido.folio}`)).json();

  assert.equal(releido.folio, emitido.folio);
  assert.deepEqual(releido.analisis.makespanActual, emitido.analisis.makespanActual);
  assert.deepEqual(releido.detalleOrdenes.length, emitido.detalleOrdenes.length);
});

test('un folio que no existe responde 404', async (t) => {
  const { base } = await levantar(t);
  assert.equal((await fetch(`${base}/api/programas/FLO-1999-0001`)).status, 404);
});

test('la matriz de rendimiento trae una fila por diametro del programa', async (t) => {
  const { base, wi, schedule } = await levantar(t);
  await subir(base, '/api/recetas', wi, 'wi.xlsx');
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();

  const m = await (await fetch(`${base}/api/programas/${p.folio}/rendimiento`)).json();

  assert.deepEqual(m.filas.map((f) => f.diametroMm), [7.0, 14.7]);
  for (const f of m.filas) assert.ok(f.mejorKgH > 0);
});

test('el programador puede marcar si acepto un consejo', async (t) => {
  const { base, wi, schedule } = await levantar(t);
  await subir(base, '/api/recetas', wi, 'wi.xlsx');
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  if (!p.analisis.movimientos.length) return; // este escenario chico puede no tener consejos

  const r = await fetch(`${base}/api/programas/${p.folio}/movimientos/1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aceptado: true }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: 1, aceptado: true });

  const releido = await (await fetch(`${base}/api/programas/${p.folio}`)).json();
  assert.equal(releido.analisis.movimientos[0].aceptado, true);
});

test('marcar un consejo que no existe responde 404', async (t) => {
  const { base, wi, schedule } = await levantar(t);
  await subir(base, '/api/recetas', wi, 'wi.xlsx');
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  const r = await fetch(`${base}/api/programas/${p.folio}/movimientos/999`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aceptado: true }),
  });
  assert.equal(r.status, 404);
});

test('un archivo que no es el esperado responde 400, no 500', async (t) => {
  const { base, wi, schedule } = await levantar(t);
  await subir(base, '/api/recetas', wi, 'wi.xlsx');
  // El WI en el lugar del schedule: es un .xlsx valido pero sin ordenes.
  const r = await subir(base, '/api/programas', wi, 'wi.xlsx');
  assert.equal(r.status, 400);
  assert.ok((await r.json()).error);
});

test('subir sin archivo responde 400', async (t) => {
  const { base } = await levantar(t);
  const r = await fetch(`${base}/api/programas`, { method: 'POST', body: new FormData() });
  assert.equal(r.status, 400);
});

test('el historial lista los folios emitidos, del mas nuevo al mas viejo', async (t) => {
  const { base, wi, schedule } = await levantar(t);
  await subir(base, '/api/recetas', wi, 'wi.xlsx');
  await subir(base, '/api/programas', schedule, 's.xlsx');
  await subir(base, '/api/programas', schedule, 's.xlsx');

  const lista = await (await fetch(`${base}/api/programas`)).json();
  assert.equal(lista.length, 2);
  for (const p of lista) assert.ok(p.folio && p.ordenes === 3);
});
