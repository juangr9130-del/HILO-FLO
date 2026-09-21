import test from 'node:test';
import assert from 'node:assert/strict';

import { Orden } from '../src/motor/modelos.js';
import {
  DENSIDAD_ACERO,
  TablaVelocidades,
  areaMm2,
  kgHora,
  pesoLinealKgM,
} from '../src/motor/rendimiento.js';
import { linea, punto } from './ayudas.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

function o(diametroMm = 14.7, extra = {}) {
  return new Orden({ id: 'X', diametroMm, kilogramos: 2300, linea: 'ITW-1', ...extra });
}

test('area de la seccion del alambre', () => {
  cerca(areaMm2(10), (Math.PI / 4) * 100);
});

test('peso lineal de alambre de 14.70 mm', () => {
  // pi/4 * 14.7^2 = 169.7 mm2 -> 169.7e-6 m2 * 7850 kg/m3
  cerca(pesoLinealKgM(14.7), 1.3323, 1e-3);
});

test('valor de referencia: 170 mm/s de 14.70 mm son ~815 kg/h', () => {
  cerca(kgHora(170, 14.7), 815.4, 1e-3);
});

test('el rendimiento escala con el cuadrado del diametro', () => {
  cerca(kgHora(100, 20), 4 * kgHora(100, 10));
});

test('la eficiencia castiga proporcionalmente', () => {
  cerca(kgHora(170, 14.7, { eficiencia: 0.85 }), 0.85 * kgHora(170, 14.7));
});

test('la densidad es configurable', () => {
  cerca(kgHora(100, 10, { densidadKgM3: DENSIDAD_ACERO * 2 }), 2 * kgHora(100, 10));
});

test('rechaza un diametro invalido', () => {
  assert.throws(() => kgHora(100, 0));
});

function tabla() {
  return new TablaVelocidades(
    [
      punto('ITW-1', 14.7, 170),
      punto('ITW-1', 14.75, 168),
      punto('ITW-7', 14.7, 200),
      punto('ITW-13', 20.0, 100),
      // ITW-10 se tabula aparte por SLM
      punto('ITW-10', 14.7, 190, { slm: false }),
      punto('ITW-10', 14.7, 150, { slm: true }),
      // ITW-2 se tabula por devanador y grado
      punto('ITW-2', 14.7, 275, { winder: 'NETUREN' }),
      punto('ITW-2', 14.7, 375, { winder: 'DEM', grado: '9254' }),
      punto('ITW-2', 14.7, 450, { winder: 'DEM', grado: '1065' }),
    ],
    [linea('ITW-1', { eficiencia: 0.85 }), linea('ITW-7')],
  );
}

test('usa la eficiencia de cada linea', () => {
  cerca(tabla().kgHora('ITW-1', o()), kgHora(170, 14.7, { eficiencia: 0.85 }));
  cerca(tabla().kgHora('ITW-7', o()), kgHora(200, 14.7));
});

test('una linea sin receta para el diametro no lo puede correr', () => {
  assert.equal(tabla().kgHora('ITW-13', o(14.7)), null);
  assert.equal(tabla().puedeCorrer('ITW-13', o(14.7)), false);
});

test('un diametro fuera de reticula sube al punto tabulado superior', () => {
  // 14.72 no esta tabulado: con politica "arriba" cae en 14.75 (mas lento)
  assert.equal(tabla().receta('ITW-1', o(14.72)).diametroMm, 14.75);
});

test('un diametro lejos de la reticula no tiene receta', () => {
  assert.equal(tabla().receta('ITW-1', o(16.0)), null);
});

test('SLM elige la receta correcta en ITW-10', () => {
  assert.equal(tabla().mmS('ITW-10', o(14.7, { slm: false })), 190);
  assert.equal(tabla().mmS('ITW-10', o(14.7, { slm: true })), 150);
});

test('devanador y grado eligen la receta de ITW-2', () => {
  assert.equal(tabla().mmS('ITW-2', o(14.7, { winder: 'NETUREN' })), 275);
  assert.equal(tabla().mmS('ITW-2', o(14.7, { winder: 'DEM', grupoGrado: '9254' })), 375);
  assert.equal(tabla().mmS('ITW-2', o(14.7, { winder: 'DEM', grupoGrado: '1065' })), 450);
});

test('sin devanador indicado se asume el DEM, que es el deber ser', () => {
  // El schedule casi nunca lo anota; asumir Neturen subestimaria ITW-2.
  // Que no venga anotado lo levanta el aviso, no la tabla de recetas.
  assert.equal(tabla().mmS('ITW-2', o(14.7, { winder: null, grupoGrado: '9254' })), 375);
  assert.equal(tabla().mmS('ITW-2', o(14.7, { winder: null, grupoGrado: '1065' })), 450);
});

test('el schedule puede registrar la excepcion al deber ser', () => {
  assert.equal(tabla().mmS('ITW-2', o(14.7, { winder: 'NETUREN' })), 275);
});

test('lineasPara ordena de la mas rapida a la mas lenta', () => {
  const t = tabla();
  const capaces = t.lineasPara(o(14.7));
  assert.equal(capaces[0], 'ITW-2'); // 275 mm/s
  assert.ok(!capaces.includes('ITW-13'));
  const rend = capaces.map((l) => t.kgHora(l, o(14.7)));
  assert.deepEqual(rend, [...rend].sort((a, b) => b - a));
});

test('horasPara', () => {
  const t = tabla();
  cerca(t.horasPara('ITW-7', o()), 2300 / t.kgHora('ITW-7', o()));
  assert.equal(t.horasPara('ITW-13', o()), null);
});

test('rango de diametro de una linea', () => {
  assert.deepEqual(tabla().rangoDe('ITW-1'), [14.7, 14.75]);
  assert.equal(tabla().rangoDe('ITW-99'), null);
});

test('la cache no cambia el resultado', () => {
  const t = tabla();
  const primera = t.kgHora('ITW-1', o());
  assert.equal(t.kgHora('ITW-1', o()), primera);
  // Dos ordenes distintas con la misma firma comparten entrada de cache
  assert.equal(t.kgHora('ITW-1', o(14.7, { id: 'Y' })), primera);
});
