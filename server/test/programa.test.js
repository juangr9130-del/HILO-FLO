import test from 'node:test';
import assert from 'node:assert/strict';

import { TablaVelocidades, kgHora } from '../src/motor/rendimiento.js';
import { evaluarPrograma } from '../src/motor/programa.js';
import { linea, orden, programa, punto } from './ayudas.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

const tabla = () =>
  new TablaVelocidades([
    punto('ITW-1', 14.7, 170),
    punto('ITW-1', 12.5, 200),
    punto('ITW-7', 14.7, 200),
    punto('ITW-13', 20.0, 100),
  ]);

test('horas y kilos cuando todo cabe', () => {
  const lineas = [linea('ITW-1', { horasDisponibles: 24 })];
  const p = programa([orden('A', 14.7, 2300, 'ITW-1')]);

  const r = evaluarPrograma(p, lineas, tabla()).lineas.get('ITW-1');

  cerca(r.horasProduccion, 2300 / kgHora(170, 14.7));
  cerca(r.kgProducibles, 2300);
  assert.equal(r.horasSobregiro, 0);
  assert.ok(r.horasOciosas > 0);
});

test('recorta los kilos que no caben en el horizonte', () => {
  const lineas = [linea('ITW-1', { horasDisponibles: 1 })];
  const p = programa([orden('A', 14.7, 100000, 'ITW-1')]);

  const r = evaluarPrograma(p, lineas, tabla()).lineas.get('ITW-1');

  cerca(r.kgProgramados, 100000);
  cerca(r.kgProducibles, kgHora(170, 14.7)); // 1 h de corrida
  assert.ok(r.horasSobregiro > 0);
});

test('cobra el cambio de medida solo al cambiar de diametro', () => {
  const lineas = [linea('ITW-1', { horasDisponibles: 100, minutosCambio: 60 })];
  const p = programa([
    orden('A', 14.7, 2300, 'ITW-1', { secuencia: 1 }),
    orden('B', 14.7, 2300, 'ITW-1', { secuencia: 2 }), // mismo diametro
    orden('C', 12.5, 2300, 'ITW-1', { secuencia: 3 }), // cambia
  ]);

  const r = evaluarPrograma(p, lineas, tabla()).lineas.get('ITW-1');

  assert.equal(r.cambios, 1);
  cerca(r.horasCambio, 1);
});

test('la secuencia manda sobre el orden de la lista', () => {
  const lineas = [linea('ITW-1', { horasDisponibles: 100, minutosCambio: 60 })];
  const p = programa([
    orden('A', 14.7, 2300, 'ITW-1', { secuencia: 1 }),
    orden('C', 12.5, 2300, 'ITW-1', { secuencia: 3 }),
    orden('B', 14.7, 2300, 'ITW-1', { secuencia: 2 }),
  ]);
  assert.equal(evaluarPrograma(p, lineas, tabla()).lineas.get('ITW-1').cambios, 1);
});

test('reporta una orden en linea sin receta', () => {
  const lineas = [linea('ITW-13', { horasDisponibles: 24 })];
  const p = programa([orden('A', 14.7, 2300, 'ITW-13')]);

  const ev = evaluarPrograma(p, lineas, tabla());

  assert.deepEqual(ev.sinReceta.map((o) => o.id), ['A']);
  assert.equal(ev.kgProducibles, 0);
  assert.equal(ev.lineas.get('ITW-13').horasRequeridas, 0);
});

test('falla si el schedule usa una linea fuera del catalogo', () => {
  const p = programa([orden('A', 14.7, 2300, 'ITW-99')]);
  assert.throws(
    () => evaluarPrograma(p, [linea('ITW-1', { horasDisponibles: 24 })], tabla()),
    /ITW-99/,
  );
});

test('el makespan es la linea mas cargada', () => {
  const lineas = [linea('ITW-1', { horasDisponibles: 100 }), linea('ITW-7', { horasDisponibles: 100 })];
  const p = programa([
    orden('A', 14.7, 20000, 'ITW-1'),
    orden('B', 14.7, 2300, 'ITW-7'),
  ]);

  const ev = evaluarPrograma(p, lineas, tabla());

  assert.equal(ev.lineaMasCargada, 'ITW-1');
  cerca(ev.makespan, ev.lineas.get('ITW-1').horasRequeridas);
});

test('totales suman todas las lineas', () => {
  const lineas = [linea('ITW-1', { horasDisponibles: 100 }), linea('ITW-7', { horasDisponibles: 100 })];
  const p = programa([orden('A', 14.7, 2300, 'ITW-1'), orden('B', 14.7, 2300, 'ITW-7')]);

  const ev = evaluarPrograma(p, lineas, tabla());

  cerca(ev.kgProgramados, 4600);
  cerca(ev.toneladasProducibles, 4.6);
  cerca(ev.kgNoProducibles, 0);
});

test('la linea mas rapida tarda menos', () => {
  const lineas = [linea('ITW-1', { horasDisponibles: 100 }), linea('ITW-7', { horasDisponibles: 100 })];
  const p = programa([orden('A', 14.7, 2300, 'ITW-1'), orden('B', 14.7, 2300, 'ITW-7')]);
  const ev = evaluarPrograma(p, lineas, tabla());
  assert.ok(
    ev.lineas.get('ITW-7').horasProduccion < ev.lineas.get('ITW-1').horasProduccion,
  );
});
