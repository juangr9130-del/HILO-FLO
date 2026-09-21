import test from 'node:test';
import assert from 'node:assert/strict';

import { TablaVelocidades } from '../src/motor/rendimiento.js';
import { evaluarPrograma } from '../src/motor/programa.js';
import { avisoDevanador, avisoSinReceta, reunirAvisos } from '../src/servicio/avisos.js';
import { linea, orden, programa, punto } from './ayudas.js';

// ITW-2 se tabula por devanador; ITW-1 no depende de el.
const tabla = () =>
  new TablaVelocidades([
    punto('ITW-2', 7.0, 275, { winder: 'NETUREN' }),
    punto('ITW-2', 7.0, 600, { winder: 'DEM', grado: '9254' }),
    punto('ITW-1', 7.0, 250),
    punto('ITW-1', 20.0, 100),
  ]);

const lineas = () => [linea('ITW-1', { horasDisponibles: 500 }), linea('ITW-2', { horasDisponibles: 500 })];

function avisar(p) {
  const ls = lineas();
  const t = tabla();
  return avisoDevanador(p, ls, t, evaluarPrograma(p, ls, t));
}

test('avisa cuando el schedule no anota el devanador', () => {
  const a = avisar(programa([orden('A', 7.0, 6000, 'ITW-2')]));
  assert.equal(a.tipo, 'devanador_no_indicado');
  assert.equal(a.ordenes, 1);
  assert.equal(a.asumido, 'DEM');
  assert.deepEqual(a.folios, ['A']);
});

test('no avisa si el schedule si lo anota', () => {
  assert.equal(avisar(programa([orden('A', 7.0, 6000, 'ITW-2', { winder: 'DEM' })])), null);
  assert.equal(avisar(programa([orden('A', 7.0, 6000, 'ITW-2', { winder: 'NETUREN' })])), null);
});

test('no avisa por lineas cuya receta no depende del devanador', () => {
  assert.equal(avisar(programa([orden('A', 7.0, 6000, 'ITW-1')])), null);
});

test('el aviso cuantifica lo que costaria haber corrido con el otro', () => {
  const a = avisar(programa([orden('A', 7.0, 6000, 'ITW-2')]));
  // 600 mm/s asumido contra 275 real: el cierre se recorre bastante.
  assert.ok(a.cierreSiAlterno > a.cierreAsumido, 'el alterno debe ser mas lento');
  assert.ok(a.horasDeMas > 0);
  assert.match(a.mensaje, /standard/);
});

test('el aviso agrupa por linea', () => {
  const a = avisar(
    programa([
      orden('A', 7.0, 3000, 'ITW-2', { secuencia: 1 }),
      orden('B', 7.0, 3000, 'ITW-2', { secuencia: 2 }),
    ]),
  );
  assert.deepEqual(a.lineas, [{ linea: 'ITW-2', ordenes: 2, kilogramos: 6000 }]);
});

test('avisa de las ordenes sin receta para su diametro', () => {
  const ls = lineas();
  const t = tabla();
  const p = programa([orden('A', 20.0, 5000, 'ITW-2')]); // ITW-2 no corre 20 mm
  const a = avisoSinReceta(evaluarPrograma(p, ls, t));
  assert.equal(a.tipo, 'sin_receta');
  assert.equal(a.severidad, 'error');
  assert.equal(a.kilogramos, 5000);
});

test('los avisos salen del mas grave al menos grave', () => {
  const ls = lineas();
  const t = tabla();
  const p = programa([
    orden('A', 7.0, 3000, 'ITW-2', { secuencia: 1 }), // sin devanador anotado
    orden('B', 20.0, 3000, 'ITW-2', { secuencia: 2 }), // sin receta
  ]);
  const avisos = reunirAvisos(p, ls, t, evaluarPrograma(p, ls, t));
  assert.deepEqual(avisos.map((a) => a.severidad), ['error', 'nota']);
});
