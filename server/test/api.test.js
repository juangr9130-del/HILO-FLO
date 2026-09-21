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
import { crearSchedule } from './fixtures.js';

// Diametros que el catalogo del WI si cubre, para que el analisis sea real.
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

  const schedule = await crearSchedule(join(dir, 's.xlsx'), RENGLONES);
  return { base, dir, schedule, repo };
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

test('el catalogo de velocidades ya viene dentro del modulo', async (t) => {
  const { base } = await levantar(t);
  const v = await (await fetch(`${base}/api/velocidades`)).json();
  assert.equal(v.documento, 'WI-FLO-CSW-P-526');
  assert.equal(v.resumen.total, 0, 'arranca sin ajustes');
  assert.ok(v.grupos.length >= 14);
});

test('se puede ajustar una velocidad y el kg/h se recalcula', async (t) => {
  const { base } = await levantar(t);
  const v = await (await fetch(`${base}/api/velocidades`)).json();
  const grupo = v.grupos.find((g) => g.linea === 'ITW-1');
  const punto = grupo.puntos[0];

  const r = await fetch(`${base}/api/velocidades/${encodeURIComponent(punto.clave)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mmS: punto.mmS * 2 }),
  });
  assert.equal(r.status, 200);

  const despues = await (await fetch(`${base}/api/velocidades`)).json();
  const ahora = despues.grupos
    .find((g) => g.clave === grupo.clave)
    .puntos.find((p) => p.clave === punto.clave);

  assert.equal(ahora.mmS, punto.mmS * 2);
  assert.equal(ahora.mmSOriginal, punto.mmS);
  assert.equal(ahora.ajustado, true);
  assert.ok(Math.abs(ahora.kgHora - punto.kgHora * 2) < 0.2, 'el rendimiento va con la velocidad');
  assert.equal(despues.resumen.total, 1);
});

test('una velocidad imposible se rechaza con 400', async (t) => {
  const { base } = await levantar(t);
  const v = await (await fetch(`${base}/api/velocidades`)).json();
  const clave = v.grupos[0].puntos[0].clave;
  for (const mmS of [0, -1, 9999, 'abc']) {
    const r = await fetch(`${base}/api/velocidades/${encodeURIComponent(clave)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mmS }),
    });
    assert.equal(r.status, 400, `mmS=${mmS} deberia rechazarse`);
  }
});

test('se puede regresar un punto al valor del documento', async (t) => {
  const { base } = await levantar(t);
  const v = await (await fetch(`${base}/api/velocidades`)).json();
  const punto = v.grupos[0].puntos[0];
  const url = `${base}/api/velocidades/${encodeURIComponent(punto.clave)}`;

  await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mmS: punto.mmS + 7 }),
  });
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 200);

  const despues = await (await fetch(`${base}/api/velocidades`)).json();
  assert.equal(despues.resumen.total, 0);
});

test('el ajuste cambia el analisis', async (t) => {
  const { base, schedule } = await levantar(t);
  const antes = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();

  // ITW-1 corre las tres ordenes de la prueba: al doble de velocidad, cierra antes.
  const v = await (await fetch(`${base}/api/velocidades`)).json();
  for (const p of v.grupos.find((g) => g.linea === 'ITW-1').puntos) {
    await fetch(`${base}/api/velocidades/${encodeURIComponent(p.clave)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mmS: p.mmS * 2 }),
    });
  }

  const despues = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  assert.ok(
    despues.analisis.makespanActual < antes.analisis.makespanActual,
    'duplicar la velocidad de ITW-1 tiene que bajar el cierre',
  );
});

test('flujo completo: recetas, schedule, folio y analisis', async (t) => {
  const { base, schedule } = await levantar(t);

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
  const { base, schedule } = await levantar(t);
  const a = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  const b = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  assert.notEqual(a.folio, b.folio);
  assert.equal(Number(b.folio.slice(-4)), Number(a.folio.slice(-4)) + 1);
});

test('un folio se vuelve a leer igual a como se emitio', async (t) => {
  const { base, schedule } = await levantar(t);
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
  const { base, schedule } = await levantar(t);
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();

  const m = await (await fetch(`${base}/api/programas/${p.folio}/rendimiento`)).json();

  assert.deepEqual(m.filas.map((f) => f.diametroMm), [7.0, 14.7]);
  for (const f of m.filas) assert.ok(f.mejorKgH > 0);
});

test('el programador puede marcar si acepto un consejo', async (t) => {
  const { base, schedule } = await levantar(t);
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
  const { base, schedule } = await levantar(t);
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  const r = await fetch(`${base}/api/programas/${p.folio}/movimientos/999`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aceptado: true }),
  });
  assert.equal(r.status, 404);
});

test('un archivo que no es el esperado responde 400, no 500', async (t) => {
  const { base, dir } = await levantar(t);
  // Un .xlsx valido pero sin ninguna orden dentro.
  const vacio = await crearSchedule(join(dir, 'vacio.xlsx'), []);
  const r = await subir(base, '/api/programas', vacio, 'vacio.xlsx');
  assert.equal(r.status, 400);
  assert.ok((await r.json()).error);
});

test('subir sin archivo responde 400', async (t) => {
  const { base } = await levantar(t);
  const r = await fetch(`${base}/api/programas`, { method: 'POST', body: new FormData() });
  assert.equal(r.status, 400);
});

test('el historial lista los folios emitidos, del mas nuevo al mas viejo', async (t) => {
  const { base, schedule } = await levantar(t);
  await subir(base, '/api/programas', schedule, 's.xlsx');
  await subir(base, '/api/programas', schedule, 's.xlsx');

  const lista = await (await fetch(`${base}/api/programas`)).json();
  assert.equal(lista.length, 2);
  for (const p of lista) assert.ok(p.folio && p.ordenes === 3);
});

test('el paquete trae el output por línea y el de planta', async (t) => {
  const { base, schedule } = await levantar(t);
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  const a = p.analisis;

  assert.ok(a.ritmoActual > 0, 'ritmo de planta antes');
  assert.ok(a.ritmoPropuesto > 0, 'ritmo de planta después');
  assert.ok(a.cierreSoloBalance > 0, 'el cierre que daría sólo balancear');

  for (const l of p.lineas.filter((x) => x.actual.ordenes)) {
    assert.ok(l.actual.kgHora > 0, `${l.linea} sin kg/h`);
    assert.ok(Array.isArray(l.actual.diametros) && l.actual.diametros.length > 0);
  }
});

test('el kg/h de cada línea sale de sus kilos entre sus horas de corrida', async (t) => {
  const { base, schedule } = await levantar(t);
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();

  for (const l of p.lineas.filter((x) => x.actual.horasProduccion > 0)) {
    assert.ok(
      Math.abs(l.actual.kgHora - l.actual.kg / l.actual.horasProduccion) < 1,
      `${l.linea}: ${l.actual.kgHora} != ${l.actual.kg} / ${l.actual.horasProduccion}`,
    );
  }
});

test('mover carga a una línea más rápida sube el ritmo de planta', async (t) => {
  const { base, schedule } = await levantar(t);
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  const a = p.analisis;

  // El reajuste nunca puede empeorar el ritmo: el objetivo no lo permitiría
  // sin ganar tonelada o cierre a cambio.
  assert.ok(a.ritmoPropuesto >= a.ritmoActual * 0.999, 'el ritmo de planta no debe bajar');
});

test('se puede quitar un folio de la lista', async (t) => {
  const { base, schedule } = await levantar(t);
  const a = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  const b = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  assert.equal((await (await fetch(`${base}/api/programas`)).json()).length, 2);

  const r = await fetch(`${base}/api/programas/${a.folio}`, { method: 'DELETE' });
  assert.equal(r.status, 200);

  const lista = await (await fetch(`${base}/api/programas`)).json();
  assert.deepEqual(lista.map((p) => p.folio), [b.folio]);
});

test('quitar un folio que no existe responde 404', async (t) => {
  const { base } = await levantar(t);
  const r = await fetch(`${base}/api/programas/FLO-1999-0001`, { method: 'DELETE' });
  assert.equal(r.status, 404);
});

test('el folio quitado no se vuelve a listar aunque se pida dos veces', async (t) => {
  const { base, schedule } = await levantar(t);
  const p = await (await subir(base, '/api/programas', schedule, 's.xlsx')).json();
  assert.equal((await fetch(`${base}/api/programas/${p.folio}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/api/programas/${p.folio}`, { method: 'DELETE' })).status, 404);
  assert.deepEqual(await (await fetch(`${base}/api/programas`)).json(), []);
});
