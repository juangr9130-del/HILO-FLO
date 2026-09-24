/**
 * Las restricciones por atributo del rollo (small ID, top down, SLM).
 *
 * Lo que mas se cuida aqui es la PRECEDENCIA. Las reglas que dio el
 * programador se contradicen para un tipo de rollo -- los "top down" son
 * tambien SID, y top down dice "solo ITW-2" mientras small ID dice "nunca
 * ITW-2" -- y sin embargo esos rollos ya corren en ITW-2 hoy. Si la
 * precedencia se invierte, el modulo declara imposible lo que la planta hace
 * todos los dias.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESTRICCIONES,
  lineaPermitida,
  restriccionesDe,
  restriccionesParaPantalla,
  restriccionesVigentes,
  revisarRestriccion,
} from '../src/catalogo/restricciones.js';
import { esSid, esTopDown } from '../src/ingesta/schedule.js';
import { orden } from './ayudas.js';

const V = restriccionesVigentes();
const rollo = (extra) => orden('O', 10, 2300, 'ITW-1', extra);

test('se leen los atributos como vienen escritos en el schedule', () => {
  // SID aparece de las dos maneras y a veces en las notas, no en la
  // descripcion. Y "top down" casi nunca viene como TDC: en el schedule del
  // 17/09 son 3 con la sigla y 20 con las palabras.
  assert.equal(esSid('CSW,9,53 1655-1828 54SiCr6 half SID'), true);
  assert.equal(esSid('CSW,9,40 1655-1827 54SiCr6 SID half'), true);
  assert.equal(esSid('CSW,14.70mm HT HT 1950-2000 MPa'), false);
  assert.equal(esSid('consider'), false, 'SID tiene que ir suelto, no dentro de otra palabra');

  assert.equal(esTopDown('CSW,7,70 54SiCr6 SID half TDC'), true);
  assert.equal(esTopDown('91921122 IDC MINNEAPOLIS SID HALF TOP DOWN 1500MM'), true);
  assert.equal(esTopDown('TOPDOWN'), true);
  assert.equal(esTopDown('CSW,14.70mm HT'), false);
});

test('un SOLO amarra el rollo a sus lineas', () => {
  const slm = rollo({ slm: true });
  assert.equal(lineaPermitida(V, 'ITW-4', slm), true);
  assert.equal(lineaPermitida(V, 'ITW-10', slm), true);
  assert.equal(lineaPermitida(V, 'ITW-1', slm), false);
});

test('un NUNCA saca al rollo de sus lineas', () => {
  const sid = rollo({ sid: true });
  for (const l of ['ITW-2', 'ITW-4', 'ITW-10', 'ITW-11']) {
    assert.equal(lineaPermitida(V, l, sid), false, `${l} no debe aceptar small ID`);
  }
  assert.equal(lineaPermitida(V, 'ITW-1', sid), true);
});

test('SOLO le gana a NUNCA: un top down que ademas es SID si corre en ITW-2', () => {
  // Es el caso real: los 20 rollos top down del schedule del 17/09 son todos
  // SID y todos estan en ITW-2. Con la precedencia al reves no habria ninguna
  // linea donde ponerlos.
  const td = rollo({ topDown: true, sid: true });
  assert.equal(lineaPermitida(V, 'ITW-2', td), true);
  assert.equal(lineaPermitida(V, 'ITW-1', td), false, 'top down solo corre en ITW-2');
});

test('lo que se explica en pantalla es la regla que de verdad aplico', () => {
  const td = rollo({ topDown: true, sid: true });
  const dichas = restriccionesDe(V, td).map((r) => r.clave);
  // El NUNCA quedo sin efecto: decirlo confundiria al programador.
  assert.deepEqual(dichas, ['topDown']);

  assert.deepEqual(restriccionesDe(V, rollo({ sid: true })).map((r) => r.clave), ['sid']);
  assert.deepEqual(restriccionesDe(V, rollo({})).map((r) => r.clave), []);
});

test('un rollo sin atributos corre donde sea', () => {
  const normal = rollo({});
  for (const r of RESTRICCIONES) {
    for (const l of r.lineas) assert.equal(lineaPermitida(V, l, normal), true);
  }
});

test('se puede corregir en que lineas aplica una restriccion', () => {
  const ajustado = restriccionesVigentes(new Map([['slm', ['ITW-4']]]));
  const slm = rollo({ slm: true });
  assert.equal(lineaPermitida(ajustado, 'ITW-10', slm), false, 'ya no incluye ITW-10');
  assert.equal(lineaPermitida(ajustado, 'ITW-4', slm), true);

  const p = restriccionesParaPantalla(new Map([['slm', ['ITW-4']]]));
  assert.equal(p.find((r) => r.clave === 'slm').cambiada, true);
  assert.equal(p.filter((r) => r.cambiada).length, 1);
});

test('se rechaza una lista de lineas que no se sostiene', () => {
  assert.equal(revisarRestriccion('slm', ['ITW-4', 'ITW-10']), null);
  assert.ok(revisarRestriccion('slm', []), 'sin lineas la restriccion no significa nada');
  assert.ok(revisarRestriccion('slm', ['HTL-4']));
  assert.ok(revisarRestriccion('noExiste', ['ITW-4']));
});
