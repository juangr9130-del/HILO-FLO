/**
 * La hoja de corridas: el reloj por linea.
 *
 * Lo que se cuida es que el reloj CUADRE con lo que ya calculo el motor. Si
 * la hoja dice una hora de cierre y el analisis dice otra, el programador
 * tiene dos verdades y ninguna le sirve.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluarPrograma } from '../src/motor/programa.js';
import { TablaVelocidades } from '../src/motor/rendimiento.js';
import { hojaDeCorridas, inicioDelPrograma } from '../src/servicio/corridas.js';
import { linea, orden, programa, punto } from './ayudas.js';

const puntos = [punto('ITW-1', 10, 200), punto('ITW-1', 12, 100)];

function hoja(ordenes, extraLinea = {}) {
  const lineas = [linea('ITW-1', { minutosCambio: 30, ...extraLinea })];
  const tabla = new TablaVelocidades(puntos, lineas);
  const ev = evaluarPrograma(programa(ordenes), lineas, tabla);
  return { hoja: hojaDeCorridas(ev), ev };
}

test('los rollos seguidos del mismo numero de parte son una corrida', () => {
  const { hoja: h } = hoja([
    orden('A1', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 1 }),
    orden('A2', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 2 }),
    orden('B1', 12, 2000, 'ITW-1', { material: 'P12', secuencia: 3 }),
  ]);
  const l = h.find((x) => x.linea === 'ITW-1');

  assert.equal(l.corridas, 2);
  assert.equal(l.rollos, 3);
  assert.equal(l.secuencia[0].rollos, 2);
  assert.equal(l.secuencia[0].parte, 'P10');
  assert.equal(l.secuencia[1].rollos, 1);
});

test('volver al mismo numero de parte abre una corrida nueva', () => {
  // No se juntan a la fuerza: si el programador intercalo otra parte, la
  // linea corre tres bloques y eso es lo que tiene que ver.
  const { hoja: h } = hoja([
    orden('A1', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 1 }),
    orden('B1', 12, 2000, 'ITW-1', { material: 'P12', secuencia: 2 }),
    orden('A2', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 3 }),
  ]);
  assert.equal(h.find((x) => x.linea === 'ITW-1').corridas, 3);
});

test('el reloj no deja huecos ni encima', () => {
  const { hoja: h } = hoja([
    orden('A1', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 1 }),
    orden('B1', 12, 2000, 'ITW-1', { material: 'P12', secuencia: 2 }),
    orden('C1', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 3 }),
  ]);
  const l = h.find((x) => x.linea === 'ITW-1');

  let reloj = 0;
  for (const c of l.secuencia) {
    // El cambio se cobra ANTES de la corrida: arranca donde acabo la previa
    // y la produccion empieza pasado el cambio.
    assert.equal(c.inicioH, Number(reloj.toFixed(2)), `corrida ${c.n} no arranca donde acabo la anterior`);
    assert.ok(c.detalle[0].inicioH >= c.inicioH - 1e-9);
    for (const r of c.detalle) {
      assert.ok(r.finH >= r.inicioH, 'un rollo no puede acabar antes de empezar');
    }
    assert.equal(c.detalle.at(-1).finH, c.finH, `corrida ${c.n}: el ultimo rollo no cierra la corrida`);
    reloj = c.finH;
  }
});

test('el cierre de la hoja es el mismo que el del motor', () => {
  const ordenes = [];
  for (let i = 0; i < 6; i++) {
    ordenes.push(
      orden(`O${i}`, i % 2 === 0 ? 10 : 12, 2000, 'ITW-1', {
        material: `P${i % 2}`,
        secuencia: i,
      }),
    );
  }
  const { hoja: h, ev } = hoja(ordenes);
  const l = h.find((x) => x.linea === 'ITW-1');

  assert.equal(l.cierreH, Number(ev.lineas.get('ITW-1').horasRequeridas.toFixed(2)));
  assert.equal(l.horas, l.cierreH);
});

test('lo que no cabe en el horizonte se marca, no se esconde', () => {
  const { hoja: h } = hoja(
    [
      orden('A1', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 1 }),
      orden('A2', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 2 }),
    ],
    { horasDisponibles: 1 },
  );
  const l = h.find((x) => x.linea === 'ITW-1');

  assert.equal(l.rollos, 2, 'los rollos que no caben siguen apareciendo');
  assert.equal(l.secuencia[0].dentroDelHorizonte, false);
  assert.ok(l.secuencia[0].detalle.some((r) => !r.completo));
});

test('una corrida sin receta no consume reloj pero si aparece', () => {
  const { hoja: h } = hoja([
    orden('X1', 25, 2000, 'ITW-1', { material: 'PX', secuencia: 1 }),
    orden('A1', 10, 2000, 'ITW-1', { material: 'P10', secuencia: 2 }),
  ]);
  const l = h.find((x) => x.linea === 'ITW-1');

  assert.equal(l.corridas, 2);
  assert.equal(l.secuencia[0].sinReceta, true);
  assert.equal(l.secuencia[0].finH, l.secuencia[0].inicioH);
  assert.equal(l.secuencia[1].inicioH, 0, 'la que si tiene receta arranca en cero');
});

test('la fecha sale del nombre del archivo, y null si no se puede leer', () => {
  assert.equal(inicioDelPrograma('Schedule_8200_09-17-2026.xlsx'), '2026-09-17T00:00:00.000Z');
  assert.equal(inicioDelPrograma('Schedule_8200.xlsx'), null);
  assert.equal(inicioDelPrograma('Schedule_8200_13-40-2026.xlsx'), null);
  assert.equal(inicioDelPrograma(null), null);
});
