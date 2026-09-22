/**
 * Las reglas del reajuste como catalogo editable.
 *
 * Lo que se cuida: que un valor guardado de mas o de una version anterior no
 * tumbe el analisis, y que cambiar una regla de verdad cambie el resultado --
 * si no, la pantalla seria decorativa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { REGLAS, reglasParaPantalla, reglasVigentes, resumenReglas, revisarRegla } from '../src/servicio/reglas.js';
import { analizar, SUPUESTOS } from '../src/servicio/analisis.js';
import { orden, programa, punto } from './ayudas.js';

test('cada regla trae lo que la pantalla necesita para pintarla y validarla', () => {
  for (const r of REGLAS) {
    assert.ok(r.clave && r.etiqueta && r.ayuda, `${r.clave}: le falta etiqueta o ayuda`);
    assert.ok(['numero', 'opcion', 'bandera'].includes(r.tipo), `${r.clave}: tipo ${r.tipo}`);
    if (r.tipo === 'numero') {
      assert.ok(Number.isFinite(r.min) && Number.isFinite(r.max), `${r.clave}: sin rango`);
    }
    if (r.tipo === 'opcion') assert.ok(r.opciones.length >= 2, `${r.clave}: sin opciones`);
    // Toda regla tiene que existir en los supuestos, o cambiarla no haria nada.
    assert.ok(r.clave in SUPUESTOS, `${r.clave} no es un supuesto del analisis`);
  }
});

test('se rechaza lo que no cabe', () => {
  assert.equal(revisarRegla('topeOrdenes', 5), null);
  assert.ok(revisarRegla('topeOrdenes', 0));
  assert.ok(revisarRegla('topeOrdenes', 2.5));
  assert.ok(revisarRegla('topeOrdenes', 'cinco'));
  assert.ok(revisarRegla('objetivo', 'otra cosa'));
  assert.equal(revisarRegla('objetivo', 'calendario'), null);
  assert.ok(revisarRegla('itw15Activa', 'si'));
  assert.equal(revisarRegla('itw15Activa', true), null);
  assert.ok(revisarRegla('noExiste', 1));
});

test('un valor guardado invalido se ignora en vez de tumbar el analisis', () => {
  // Puede venir de una version anterior con otro rango, o de una edicion a
  // mano en la base. Que el modulo no arranque por eso seria peor.
  const v = reglasVigentes({ topeOrdenes: -3, objetivo: 'inventado', basura: 9 });
  assert.equal(v.topeOrdenes, SUPUESTOS.topeOrdenes);
  assert.equal(v.objetivo, SUPUESTOS.objetivo);
  assert.equal(v.basura, undefined);
});

test('la pantalla marca cuales se apartaron del valor de fabrica', () => {
  const p = reglasParaPantalla({ topeOrdenes: 3 });
  const tope = p.find((r) => r.clave === 'topeOrdenes');
  assert.equal(tope.valor, 3);
  assert.equal(tope.predeterminado, SUPUESTOS.topeOrdenes);
  assert.equal(tope.cambiada, true);
  assert.equal(p.filter((r) => r.cambiada).length, 1);
  assert.equal(resumenReglas({ topeOrdenes: 3 }), 1);
  assert.equal(resumenReglas({}), 0);
});

test('cambiar el tope cambia de verdad lo que el analisis propone', () => {
  // La prueba que hace honesta a la pantalla: si esto pasara igual con
  // cualquier tope, editarlo seria decorativo.
  const puntos = [punto('ITW-1', 14.7, 100), punto('ITW-7', 14.7, 200)];
  const ordenes = Array.from({ length: 10 }, (_, i) =>
    orden(`O${i}`, 14.7, 3000, 'ITW-1', { secuencia: i }),
  );

  const movidas = (tope) =>
    analizar(programa(ordenes), puntos, reglasVigentes({ topeOrdenes: tope }))
      .propuesta.agrupadas()
      .reduce((t, g) => t + g.ordenes.length, 0);

  assert.ok(movidas(2) < movidas(5), `±2 movio ${movidas(2)} y ±5 movio ${movidas(5)}`);
  assert.ok(movidas(5) <= movidas(9));
});
