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
  const minutos = SUPUESTOS.minutosCambio;

  assert.equal(a.cambiosEvitados, a.cambiosActual - a.cambiosPropuesto);
  assert.ok(
    Math.abs(a.horasCambioAhorradas - (a.cambiosEvitados * minutos) / 60) <= 0.1,
    `${a.cambiosEvitados} cambios a ${minutos} min no dan ${a.horasCambioAhorradas} h`,
  );
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
