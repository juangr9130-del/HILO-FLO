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
  assert.match(grupos[0].describir(), new RegExp(`${grupos[0].ordenes.length} orders`));
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

// ---------------------------------------------------------------------------
// Objetivo de rendimiento, con techo y tope de rollos
// ---------------------------------------------------------------------------

/** kg/h de esa orden en esa linea, para comparar origen contra destino. */
const ritmo = (t, linea, orden) => t.kgHora(linea, orden);

test('rendimiento nunca manda material a una linea mas lenta', () => {
  // ITW-1 (100 mm/s) e ITW-7 (200) para 14.7 mm. Todo empieza en ITW-7, que
  // es la rapida: el objetivo de calendario querria devolver carga a ITW-1
  // para emparejar, y eso corre el material a la mitad de velocidad.
  const p = programa([1, 2, 3, 4].map((n) => orden(`A${n}`, 14.7, 3000, 'ITW-7', { secuencia: n })));
  const t = tabla();

  const propuesta = buscarOportunidades(p, lineas(), t, { objetivo: 'rendimiento' });

  for (const o of propuesta.programaPropuesto.ordenes) {
    const original = p.ordenes.find((x) => x.id === o.id);
    if (o.linea === original.linea) continue;
    assert.ok(
      ritmo(t, o.linea, o) >= ritmo(t, original.linea, original),
      `${o.id}: ${original.linea} (${ritmo(t, original.linea, original)}) -> ${o.linea} (${ritmo(t, o.linea, o)})`,
    );
  }
});

test('calendario si puede mandarlo a una linea mas lenta, y por eso empareja', () => {
  // El mismo caso con el otro objetivo: reparte entre las dos lineas aunque
  // ITW-1 sea la mitad de rapida, porque cierra antes. Es el intercambio que
  // Florence tiene que elegir, y las dos ramas siguen vivas.
  const p = programa([1, 2, 3, 4].map((n) => orden(`A${n}`, 14.7, 3000, 'ITW-7', { secuencia: n })));

  const propuesta = buscarOportunidades(p, lineas(), tabla(), { objetivo: 'calendario' });
  const r = propuesta.evaluacionPropuesta.lineas;

  assert.ok(r.get('ITW-1').horasRequeridas > 0, 'calendario debe repartir hacia ITW-1');
});

// Lineas con horizonte holgado: asi nada se queda fuera y el tope se prueba
// solo, sin que la excepcion de "rescatar tonelada" lo pase por encima.
const lineasHolgadas = () => [
  linea('ITW-1', { horasDisponibles: 300 }),
  linea('ITW-7', { horasDisponibles: 300 }),
  linea('ITW-13', { horasDisponibles: 300 }),
];

/** 8 ordenes de 6 t en ITW-1: 12.5 h cada una, 100 h en total. */
const ochoEnItw1 = () =>
  programa(
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => orden(`A${n}`, 14.7, 6000, 'ITW-1', { secuencia: n })),
  );

test('el tope impide dejar una linea sin trabajo', () => {
  const p = ochoEnItw1();

  // Sin tope, las ocho se van a ITW-7 (el doble de rapida) y ITW-1 queda vacia.
  const sinTope = buscarOportunidades(p, lineasHolgadas(), tabla(), { objetivo: 'rendimiento' });
  assert.equal(
    sinTope.evaluacionPropuesta.lineas.get('ITW-1').corridas.length,
    0,
    'sin tope, el rendimiento puro vacia la linea lenta',
  );

  // Con tope de 5 rollos ITW-1 no puede soltar mas de cinco.
  const conTope = buscarOportunidades(p, lineasHolgadas(), tabla(), {
    objetivo: 'rendimiento',
    topeOrdenes: 5,
  });
  const r = conTope.evaluacionPropuesta.lineas.get('ITW-1');
  assert.ok(r.corridas.length >= 3, `ITW-1 quedo con ${r.corridas.length} de 8, solto mas de 5`);
});

test('el tope se mide contra el schedule ORIGINAL, no contra la vuelta anterior', () => {
  // Si se midiera contra el paso anterior, la busqueda se alejaria de a
  // cinco rollos por vuelta y el tope no valdria nada.
  const p = ochoEnItw1();
  const propuesta = buscarOportunidades(p, lineasHolgadas(), tabla(), {
    objetivo: 'rendimiento',
    topeOrdenes: 2,
  });
  for (const [clave, r] of propuesta.evaluacionPropuesta.lineas) {
    const antes = propuesta.evaluacionOriginal.lineas.get(clave);
    assert.ok(
      Math.abs(r.corridas.length - antes.corridas.length) <= 2,
      `${clave} cambio ${r.corridas.length - antes.corridas.length} rollos con tope 2`,
    );
  }
});

test('el tope se reporta para que el programador sepa donde se freno', () => {
  const propuesta = buscarOportunidades(ochoEnItw1(), lineasHolgadas(), tabla(), {
    objetivo: 'rendimiento',
    topeOrdenes: 3,
  });
  // ITW-1 suelta tres e ITW-7 recibe tres: las dos quedan pegadas al tope.
  assert.deepEqual(propuesta.lineasEnElTope().sort(), ['ITW-1', 'ITW-7']);
});

test('rescatar tonelada gana sobre el tope', () => {
  // Si la linea se pasa del horizonte, ese material NO SE PRODUCE. Sacarlo
  // vale mas que respetar el tope, y el tope no debe estorbarlo.
  const cortas = [linea('ITW-1', { horasDisponibles: 40 }), linea('ITW-7', { horasDisponibles: 300 })];
  const propuesta = buscarOportunidades(ochoEnItw1(), cortas, tabla(), {
    objetivo: 'rendimiento',
    topeOrdenes: 1,
  });
  const kg = (ev) => [...ev.lineas.values()].reduce((t, r) => t + r.kgProducibles, 0);
  assert.ok(
    kg(propuesta.evaluacionPropuesta) > kg(propuesta.evaluacionOriginal),
    'el tope no debe impedir rescatar tonelada que hoy se pierde',
  );
});

test('el techo sale del programa original, no de un supuesto', () => {
  // ITW-7 ya corre 4 ordenes; el techo es lo que la linea mas cargada lleva
  // hoy, asi que ninguna linea puede terminar por encima de eso.
  const p = programa([
    ...[1, 2, 3].map((n) => orden(`A${n}`, 14.7, 3000, 'ITW-1', { secuencia: n })),
    ...[1, 2].map((n) => orden(`B${n}`, 14.7, 3000, 'ITW-7', { secuencia: n + 10 })),
  ]);
  const inicial = buscarOportunidades(p, lineas(), tabla(), { objetivo: 'rendimiento' });
  const techo = inicial.evaluacionOriginal.makespan;

  for (const [clave, r] of inicial.evaluacionPropuesta.lineas) {
    assert.ok(
      r.horasRequeridas <= techo + 1e-6,
      `${clave} quedo en ${r.horasRequeridas} h, arriba del techo de ${techo}`,
    );
  }
});

test('rendimiento nunca pierde tonelada contra el schedule original', () => {
  const propuesta = buscarOportunidades(ochoEnItw1(), lineasHolgadas(), tabla(), {
    objetivo: 'rendimiento',
    topeOrdenes: 5,
  });
  const kg = (ev) => [...ev.lineas.values()].reduce((t, r) => t + r.kgProducibles, 0);
  assert.ok(kg(propuesta.evaluacionPropuesta) >= kg(propuesta.evaluacionOriginal) - 1e-6);
});
