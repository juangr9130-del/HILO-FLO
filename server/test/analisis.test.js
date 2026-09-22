/**
 * El desglose de productividad que leen las tarjetas.
 *
 * Lo que se cuida aqui es que las cifras SUMEN. Las horas de una linea son
 * horas de corrida mas horas de cambio y nada mas, asi que si "de ritmo" y
 * "de cambios" no dan exactamente el total, o le estamos inventando una
 * tonelada al programador o se la estamos escondiendo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { analizar, empaquetar, SUPUESTOS } from '../src/servicio/analisis.js';
import { orden, programa, punto } from './ayudas.js';

// La ITW-1 es el doble de rapida que la ITW-2 en las dos medidas, y todo
// esta cargado en la ITW-2: hay algo que mover y el ritmo tiene de donde
// subir. Se alternan diametros para que tambien haya cambios que evitar.
const puntos = [
  punto('ITW-1', 10, 300),
  punto('ITW-1', 12, 300),
  punto('ITW-2', 10, 120),
  punto('ITW-2', 12, 120),
];

function paqueteDePrueba() {
  const ordenes = [];
  for (let i = 0; i < 10; i++) {
    ordenes.push(orden(`O${i}`, i % 2 === 0 ? 10 : 12, 6000, 'ITW-2', { secuencia: i }));
  }
  const prog = programa(ordenes);
  const r = analizar(prog, puntos, SUPUESTOS);
  return empaquetar({
    folio: 'FLO-TEST',
    archivo: 'prueba.xlsx',
    supuestos: SUPUESTOS,
    ...r,
  });
}

test('el desglose de horas ahorradas suma exacto', () => {
  const a = paqueteDePrueba().analisis;

  assert.equal(
    a.horasAhorradas,
    Number((a.horasProduccionAhorradas + a.horasCambioAhorradas).toFixed(1)),
    'ritmo + cambios tiene que dar el total de horas',
  );
  assert.equal(
    a.horasProduccionAhorradas,
    Number((a.horasProduccionActual - a.horasProduccionPropuesto).toFixed(1)),
  );
  assert.equal(
    a.horasCambioAhorradas,
    Number((a.horasCambioActual - a.horasCambioPropuesto).toFixed(1)),
  );
});

test('las toneladas del desglose salen del ritmo ya rebalanceado', () => {
  const a = paqueteDePrueba().analisis;

  const esperado = (horas) => Number(((horas * a.ritmoPropuesto) / 1000).toFixed(1));

  // Se compara contra las cifras REDONDEADAS que se publican, asi que el
  // margen tiene que cubrir tres redondeos: el de la tonelada de cada lado
  // (+-0.05) y el del ritmo (+-0.05 kg/h sobre las horas que se multiplican).
  // Con 0.1 pelado fallaba por 1e-15, que es ruido de punto flotante y no un
  // error de la aritmetica.
  const margen = (horas) => 0.1 + horas * 0.00005 + 1e-9;
  const cuadra = (valor, horas) =>
    assert.ok(
      Math.abs(valor - esperado(horas)) <= margen(horas),
      `${valor} != ${esperado(horas)} para ${horas} h`,
    );

  cuadra(a.toneladasPorRitmo, a.horasProduccionAhorradas);
  cuadra(a.toneladasPorCambios, a.horasCambioAhorradas);
  // Las tres cifras se redondean por separado antes de publicarse, asi que
  // la suma de las dos parciales puede quedar a un redondeo de la total.
  assert.ok(
    Math.abs(a.toneladasPorTiempo - (a.toneladasPorRitmo + a.toneladasPorCambios)) <= 0.15,
    `${a.toneladasPorRitmo} + ${a.toneladasPorCambios} != ${a.toneladasPorTiempo}`,
  );
});

test('los cambios evitados cuadran con las horas de cambio', () => {
  const a = paqueteDePrueba().analisis;

  assert.equal(a.cambiosEvitados, a.cambiosActual - a.cambiosPropuesto);

  // Las horas de cambio son DOS costos que se suman: el de medida, que se
  // cobra cuando cambia el diametro, y el de rollo, que se cobra entre cada
  // dos rollos aunque no cambie nada. Si la cuenta no cierra, una de las dos
  // se esta perdiendo o contando dos veces.
  const rolloEvitados = a.cambiosRolloActual - a.cambiosRolloPropuesto;
  const esperado =
    (a.cambiosEvitados * SUPUESTOS.minutosCambio +
      rolloEvitados * SUPUESTOS.minutosCambioRollo) /
    60;
  assert.ok(
    Math.abs(a.horasCambioAhorradas - esperado) <= 0.1,
    `${a.cambiosEvitados} de medida y ${rolloEvitados} de rollo dan ${esperado} h, no ${a.horasCambioAhorradas}`,
  );
});

test('el cambio de rollo se cobra entre rollos aunque no cambie la medida', () => {
  // Tres rollos del MISMO diametro y el mismo numero de parte en una linea:
  // cero cambios de medida, pero dos cambios de rollo.
  const sup = { ...SUPUESTOS, minutosCambio: 30, minutosCambioRollo: 20 };
  const prog = programa(
    [1, 2, 3].map((i) => orden(`O${i}`, 10, 6000, 'ITW-2', { secuencia: i, material: 'P' })),
  );
  const { evaluacion } = analizar(prog, puntos, sup);
  const r = evaluacion.lineas.get('ITW-2');

  assert.equal(r.cambios, 0, 'no hubo cambio de medida');
  assert.equal(r.cambiosRollo, 2, 'tres rollos son dos cambios de rollo');
  assert.ok(Math.abs(r.horasCambio - (2 * 20) / 60) < 1e-6, `${r.horasCambio} h de cambio`);
});

test('cuando ademas cambia la medida, los dos costos se suman', () => {
  const sup = { ...SUPUESTOS, minutosCambio: 30, minutosCambioRollo: 20 };
  const prog = programa([
    orden('A', 10, 6000, 'ITW-2', { secuencia: 1 }),
    orden('B', 12, 6000, 'ITW-2', { secuencia: 2 }),
  ]);
  const r = analizar(prog, puntos, sup).evaluacion.lineas.get('ITW-2');

  assert.equal(r.cambios, 1);
  assert.equal(r.cambiosRollo, 1);
  assert.ok(Math.abs(r.horasCambio - 50 / 60) < 1e-6, `deberian ser 50 min, son ${r.horasCambio * 60}`);
});

test('el desglose nunca reporta una perdida como ganancia', () => {
  const a = paqueteDePrueba().analisis;
  // El optimizador puede gastar horas de cambio para rescatar tonelada, pero
  // no puede terminar peor en total sin que la tarjeta lo diga.
  assert.equal(Math.sign(a.toneladasPorTiempo), Math.sign(a.horasAhorradas));
});

test('la hoja de corridas no pierde ni inventa rollos', () => {
  const p = paqueteDePrueba();
  const rollos = (hoja) => hoja.reduce((t, l) => t + l.rollos, 0);

  // El schedule de Florence trae un renglon por rollo, asi que la hoja tiene
  // que cuadrar contra el programa en las dos vistas. Si el rebalanceo
  // perdiera uno, el de piso correria de menos sin que nada lo avisara.
  assert.equal(rollos(p.corridas.actual), p.ordenes);
  assert.equal(rollos(p.corridas.propuesto), p.ordenes);
});

test('la cifra titular del folio corresponde al objetivo con que se corrio', () => {
  // El historial resume cada folio en un numero. Con 'calendario' ese numero
  // es la capacidad que libera cerrar antes; con 'rendimiento' el cierre casi
  // no se mueve a proposito, asi que ese mismo numero sale ridiculo y lo que
  // vale es la tonelada del tiempo de maquina ganado.
  for (const objetivo of ['calendario', 'rendimiento']) {
    const sup = { ...SUPUESTOS, objetivo };
    const prog = programa(
      Array.from({ length: 10 }, (_, i) =>
        orden(`O${i}`, i % 2 === 0 ? 10 : 12, 6000, 'ITW-2', { secuencia: i }),
      ),
    );
    const a = empaquetar({
      folio: 'FLO-TEST',
      archivo: 'prueba.xlsx',
      supuestos: sup,
      ...analizar(prog, puntos, sup),
    }).analisis;

    assert.equal(a.objetivo, objetivo);
    assert.equal(
      a.toneladasGanadas,
      objetivo === 'rendimiento' ? a.toneladasPorTiempo : a.toneladasIncremento,
      `con ${objetivo} la cifra titular no es la que corresponde`,
    );
  }
});
