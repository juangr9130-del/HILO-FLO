/**
 * El rango de diametros que piso dice que cada linea corre bien.
 *
 * Lo que se cuida es que el rango frene A DONDE se mueve material pero no
 * reproche lo que ya esta programado: sacar una orden que el programador puso
 * a proposito seria imponerle un cambio que no pidio.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { RANGOS, dentroDelRango, rangosParaPantalla, rangosVigentes, revisarRango } from '../src/catalogo/rangos.js';
import { analizar, empaquetar, SUPUESTOS } from '../src/servicio/analisis.js';
import { orden, programa, punto } from './ayudas.js';

test('los rangos de piso cubren las catorce lineas instaladas', () => {
  assert.equal(RANGOS.size, 14);
  for (const [linea, [lo, hi]] of RANGOS) {
    assert.ok(lo > 0 && hi > lo, `${linea}: rango ${lo}-${hi}`);
  }
  // ITW-15 no esta instalada y piso no le dio rango: no se le inventa uno.
  assert.equal(RANGOS.has('ITW-15'), false);
});

test('se rechaza un rango que no se sostiene', () => {
  assert.equal(revisarRango([11, 15.4]), null);
  assert.ok(revisarRango([15, 11]), 'el minimo no puede ser mayor que el maximo');
  assert.ok(revisarRango([0, 15]));
  assert.ok(revisarRango([11, 99]));
  assert.ok(revisarRango([11]));
  assert.ok(revisarRango('11-15'));
});

test('un ajuste invalido se ignora y queda el rango de piso', () => {
  const v = rangosVigentes(new Map([['ITW-1', [20, 5]]]));
  assert.deepEqual(v.get('ITW-1'), RANGOS.get('ITW-1'));

  const bueno = rangosVigentes(new Map([['ITW-1', [12, 16]]]));
  assert.deepEqual(bueno.get('ITW-1'), [12, 16]);
});

test('la pantalla marca el rango que se corrigio', () => {
  const p = rangosParaPantalla(new Map([['ITW-1', [12, 16]]]));
  const uno = p.find((r) => r.linea === 'ITW-1');
  assert.equal(uno.cambiado, true);
  assert.deepEqual([uno.minSemilla, uno.maxSemilla], RANGOS.get('ITW-1'));
  assert.equal(p.filter((r) => r.cambiado).length, 1);
});

// ITW-2 corre 5–12 mm; ITW-1 corre 11–15.40. Un diametro de 8 mm sólo cabe
// en ITW-2, aunque la tabla de velocidades permita las dos.
const puntos = [punto('ITW-2', 8, 100), punto('ITW-1', 8, 400)];
const ordenes = [1, 2, 3, 4].map((n) => orden(`O${n}`, 8, 3000, 'ITW-2', { secuencia: n }));

test('el rango impide mandar material a una linea que no lo corre bien', () => {
  const sup = { ...SUPUESTOS, respetarRangos: true };
  const { propuesta } = analizar(programa(ordenes), puntos, sup);

  // ITW-1 es 4x mas rapida, asi que sin el rango se llevaria todo.
  assert.equal(propuesta.agrupadas().length, 0, '8 mm no debe ir a ITW-1 (corre 11–15.40)');

  const libre = analizar(programa(ordenes), puntos, { ...sup, respetarRangos: false });
  assert.ok(libre.propuesta.agrupadas().length > 0, 'sin el rango si se mueve');
});

test('lo que ya esta programado fuera de rango se avisa, no se mueve', () => {
  // 8 mm en ITW-1, que corre 11–15.40: fuera de rango desde el schedule.
  const fuera = programa([orden('X', 8, 3000, 'ITW-1', { secuencia: 1 })]);
  const sup = { ...SUPUESTOS, respetarRangos: true };
  const p = empaquetar({
    folio: 'T',
    archivo: 't.xlsx',
    supuestos: sup,
    ...analizar(fuera, puntos, sup),
  });

  const aviso = p.analisis.avisos.find((a) => a.tipo === 'fuera_de_rango');
  assert.ok(aviso, 'tiene que levantarse el aviso');
  assert.equal(aviso.ordenes, 1);
  assert.equal(aviso.lineas[0].linea, 'ITW-1');
  assert.deepEqual([aviso.lineas[0].min, aviso.lineas[0].max], RANGOS.get('ITW-1'));

  // Y sigue en su linea: el aviso informa, no reasigna.
  assert.equal(p.detalleOrdenes[0].lineaPropuesta, 'ITW-1');
});

test('sin el rango prendido no se avisa nada', () => {
  const fuera = programa([orden('X', 8, 3000, 'ITW-1', { secuencia: 1 })]);
  const sup = { ...SUPUESTOS, respetarRangos: false };
  const p = empaquetar({ folio: 'T', archivo: 't.xlsx', supuestos: sup, ...analizar(fuera, puntos, sup) });
  assert.equal(p.analisis.avisos.some((a) => a.tipo === 'fuera_de_rango'), false);
});

test('dentroDelRango no estorba a una linea sin rango', () => {
  // ITW-15 no tiene rango: mientras no lo tenga, no se le frena nada.
  assert.equal(dentroDelRango(rangosVigentes(), 'ITW-15', 9.99), true);
});
