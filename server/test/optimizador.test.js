import test from 'node:test';
import assert from 'node:assert/strict';

import { TablaVelocidades } from '../src/motor/rendimiento.js';
import { buscarOportunidades } from '../src/motor/optimizador.js';
import { linea, orden, programa, punto } from './ayudas.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

// ITW-7 es el doble de rapida que ITW-1 para el mismo diametro.
const tabla = () =>
  new TablaVelocidades([
    punto('ITW-1', 14.7, 100),
    punto('ITW-7', 14.7, 200),
    punto('ITW-1', 12.5, 150),
    punto('ITW-13', 20.0, 100),
  ]);

const lineas = () => [linea('ITW-1'), linea('ITW-7'), linea('ITW-13')];

test('mueve carga hacia la linea mas rapida', () => {
  const p = programa([orden('A', 14.7, 5000, 'ITW-1')]);

  const propuesta = buscarOportunidades(p, lineas(), tabla());
  const grupos = propuesta.agrupadas();

  assert.equal(grupos.length, 1);
  assert.deepEqual([grupos[0].origen, grupos[0].destino], ['ITW-1', 'ITW-7']);
  assert.ok(grupos[0].horasLiberadas > 0);
});

test('no propone nada si ya esta en la mejor linea', () => {
  const p = programa([orden('A', 14.7, 5000, 'ITW-7')]);
  assert.deepEqual(buscarOportunidades(p, lineas(), tabla()).agrupadas(), []);
});

test('respeta las ordenes fijas', () => {
  const p = programa([orden('A', 14.7, 5000, 'ITW-1', { fijo: true })]);
  assert.deepEqual(buscarOportunidades(p, lineas(), tabla()).agrupadas(), []);
});

test('no manda carga a una linea inactiva', () => {
  const ls = [linea('ITW-1'), linea('ITW-7', { activa: false })];
  const p = programa([orden('A', 14.7, 5000, 'ITW-1')]);
  assert.deepEqual(buscarOportunidades(p, ls, tabla()).agrupadas(), []);
});

test('no mueve a una linea sin receta para el diametro', () => {
  // Solo ITW-1 tiene receta de 12.50 mm.
  const p = programa([orden('A', 12.5, 5000, 'ITW-1')]);
  assert.deepEqual(buscarOportunidades(p, lineas(), tabla()).agrupadas(), []);
});

test('agrupa las ordenes que se mueven juntas', () => {
  const p = programa([1, 2, 3].map((n) => orden(`A${n}`, 14.7, 3000, 'ITW-1', { secuencia: n })));

  const grupos = buscarOportunidades(p, lineas(), tabla()).agrupadas();

  assert.equal(grupos.length, 1);
  assert.ok(grupos[0].ordenes.length >= 2);
  assert.deepEqual([grupos[0].origen, grupos[0].destino], ['ITW-1', 'ITW-7']);
  assert.match(grupos[0].describir(), new RegExp(`${grupos[0].ordenes.length} ordenes`));
});

test('balancea en vez de vaciar la linea lenta', () => {
  // ITW-7 es el doble de rapida, pero mandarle las tres ordenes deja a ITW-1
  // parada y el programa cierra mas tarde que repartiendolas.
  const p = programa([1, 2, 3].map((n) => orden(`A${n}`, 14.7, 3000, 'ITW-1', { secuencia: n })));

  const propuesta = buscarOportunidades(p, lineas(), tabla());
  const r = propuesta.evaluacionPropuesta.lineas;

  assert.ok(r.get('ITW-1').horasRequeridas > 0, 'ITW-1 no debe quedar vacia');
  assert.ok(r.get('ITW-7').horasRequeridas > 0);

  const todoAItw7 = 9000 / tabla().kgHora('ITW-7', p.ordenes[0]);
  assert.ok(propuesta.makespanPropuesto < todoAItw7);
});

test('el reajuste nunca atrasa el cierre del programa', () => {
  const p = programa([
    orden('A', 14.7, 9000, 'ITW-1', { secuencia: 1 }),
    orden('B', 14.7, 3000, 'ITW-1', { secuencia: 2 }),
    orden('C', 20.0, 4000, 'ITW-13', { secuencia: 1 }),
  ]);

  const propuesta = buscarOportunidades(p, lineas(), tabla());

  assert.ok(propuesta.makespanPropuesto <= propuesta.makespanOriginal);
  assert.ok(propuesta.factorDeProduccion >= 1);
});

test('el neto no reporta viajes de ida y vuelta', () => {
  const p = programa([
    orden('A', 14.7, 5000, 'ITW-1'),
    orden('B', 14.7, 5000, 'ITW-7'),
  ]);

  const propuesta = buscarOportunidades(p, lineas(), tabla());
  const origenDe = new Map(propuesta.programaOriginal.ordenes.map((o) => [o.id, o.linea]));

  for (const grupo of propuesta.agrupadas()) {
    for (const o of grupo.ordenes) {
      assert.notEqual(origenDe.get(o.id), grupo.destino);
    }
  }
});

test('el schedule propuesto conserva todas las ordenes', () => {
  const p = programa([
    orden('A', 14.7, 5000, 'ITW-1', { secuencia: 1 }),
    orden('B', 14.7, 3000, 'ITW-1', { secuencia: 2 }),
    orden('C', 12.5, 2000, 'ITW-1', { secuencia: 3 }),
  ]);

  const propuesta = buscarOportunidades(p, lineas(), tabla());

  assert.deepEqual(
    new Set(propuesta.programaPropuesto.ordenes.map((o) => o.id)),
    new Set(['A', 'B', 'C']),
  );
  cerca(propuesta.programaPropuesto.kilogramos, p.kilogramos);
});

test('la propuesta nunca empeora el schedule', () => {
  const p = programa([
    orden('A', 14.7, 9000, 'ITW-1', { secuencia: 1 }),
    orden('B', 14.7, 9000, 'ITW-1', { secuencia: 2 }),
  ]);

  const propuesta = buscarOportunidades(p, lineas(), tabla());

  assert.ok(propuesta.deltaKg >= 0);
  assert.ok(propuesta.makespanPropuesto <= propuesta.makespanOriginal);
});
