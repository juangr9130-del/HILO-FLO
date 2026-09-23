/**
 * La aritmetica de resecuenciar, que vive en la interfaz.
 *
 * Es la misma regla de cobro que motor/programa.js, repetida en el navegador
 * porque el modulo instalado no carga el motor y tiene que recalcular el reloj
 * en cada arrastre. La prueba que importa es la ANTIDERIVA: las dos tienen que
 * dar lo mismo sobre las mismas corridas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluarLinea } from '../src/motor/programa.js';
import { TablaVelocidades } from '../src/motor/rendimiento.js';
import { hojaDeCorridas } from '../src/servicio/corridas.js';
import { evaluarPrograma } from '../src/motor/programa.js';
import { linea, orden, programa, punto } from './ayudas.js';

/** Carga las funciones de web/comun/secuencia.js en este proceso. */
async function cargarInterfaz() {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const fuente = await readFile(join(aqui, '..', '..', 'web', 'comun', 'secuencia.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  return new Function(
    `${fuente}; return { evaluarSecuencia, ordenSugerido, consejoDeOrden, partirCorrida, moverCorrida };`,
  )();
}

const REGLAS = { minutosCambio: 30, minutosCambioRollo: 20 };

/** Una linea con varias medidas desordenadas, como las del schedule real. */
function caso(medidas) {
  const puntos = [...new Set(medidas)].map((d) => punto('ITW-1', d, 150));
  const ordenes = medidas.flatMap((d, i) => [
    orden(`A${i}`, d, 2300, 'ITW-1', { secuencia: i * 2, material: `P${d}` }),
    orden(`B${i}`, d, 2300, 'ITW-1', { secuencia: i * 2 + 1, material: `P${d}` }),
  ]);
  const lineas = [linea('ITW-1', { horasDisponibles: 1000, ...REGLAS })];
  const tabla = new TablaVelocidades(puntos, lineas);
  const hoja = hojaDeCorridas(evaluarPrograma(programa(ordenes), lineas, tabla));
  return { secuencia: hoja[0].secuencia, lineas, tabla, ordenes };
}

test('la interfaz cobra igual que el motor', async () => {
  const { evaluarSecuencia } = await cargarInterfaz();
  const { secuencia, lineas, tabla, ordenes } = caso([14.7, 14.8, 14.5, 15.09, 14.9, 14.7, 14.6]);

  const delMotor = evaluarLinea(lineas[0], ordenes, tabla);
  const deLaInterfaz = evaluarSecuencia(secuencia, REGLAS);

  assert.ok(
    Math.abs(deLaInterfaz.cierreH - delMotor.horasRequeridas) < 0.02,
    `interfaz ${deLaInterfaz.cierreH} h, motor ${delMotor.horasRequeridas} h`,
  );
  assert.equal(deLaInterfaz.cambios, delMotor.cambios, 'cambios de medida');
  assert.equal(deLaInterfaz.cambiosRollo, delMotor.cambiosRollo, 'cambios de rollo');
});

test('reordenar por diametro deja el minimo de cambios posible', async () => {
  const { evaluarSecuencia, ordenSugerido } = await cargarInterfaz();
  const medidas = [14.7, 14.8, 14.5, 15.09, 14.9, 14.7, 14.6];
  const { secuencia } = caso(medidas);

  const sugerido = evaluarSecuencia(ordenSugerido(secuencia), REGLAS);
  // El minimo es visitar cada diametro distinto una vez: uno menos que la
  // cantidad de diametros. Ningun acomodo puede bajar de ahi.
  assert.equal(sugerido.cambios, new Set(medidas).size - 1);
  assert.ok(sugerido.cambios < evaluarSecuencia(secuencia, REGLAS).cambios);
});

test('el consejo dice cuantos cambios se evitan y cuanto vale', async () => {
  const { consejoDeOrden } = await cargarInterfaz();
  const { secuencia } = caso([14.7, 14.8, 14.5, 15.09, 14.9, 14.7, 14.6]);
  const c = consejoDeOrden(secuencia, REGLAS);

  assert.ok(c, 'con ese desorden tiene que haber consejo');
  assert.equal(c.evitables, c.cambiosHoy - c.cambiosSugerido);
  assert.ok(Math.abs(c.horas - (c.evitables * REGLAS.minutosCambio) / 60) < 0.02);
  assert.equal(c.sugerido.length, secuencia.length, 'el consejo no pierde corridas');
});

test('no hay consejo cuando el orden ya esta agrupado', async () => {
  const { consejoDeOrden } = await cargarInterfaz();
  const { secuencia } = caso([14.5, 14.6, 14.7, 14.8, 14.9]);
  assert.equal(consejoDeOrden(secuencia, REGLAS), null);
});

test('partir una corrida conserva los rollos y los kilos', async () => {
  const { partirCorrida, evaluarSecuencia } = await cargarInterfaz();
  const { secuencia } = caso([14.7, 14.8, 14.5]);
  const antes = evaluarSecuencia(secuencia, REGLAS);

  const partida = partirCorrida(secuencia, 1, 1);
  assert.equal(partida.length, secuencia.length + 1);

  const rollos = (s) => s.reduce((t, c) => t + c.detalle.length, 0);
  const kilos = (s) => s.reduce((t, c) => t + c.detalle.reduce((u, r) => u + r.kg, 0), 0);
  assert.equal(rollos(partida), rollos(secuencia));
  assert.equal(kilos(partida), kilos(secuencia));

  // Partir sin mover nada no cambia el reloj: las dos mitades siguen pegadas.
  assert.ok(Math.abs(evaluarSecuencia(partida, REGLAS).cierreH - antes.cierreH) < 1e-9);
});

test('no se parte por un rollo que no existe', async () => {
  const { partirCorrida } = await cargarInterfaz();
  const { secuencia } = caso([14.7, 14.8]);
  assert.equal(partirCorrida(secuencia, 1, 0).length, secuencia.length);
  assert.equal(partirCorrida(secuencia, 1, 99).length, secuencia.length);
  assert.equal(partirCorrida(secuencia, 99, 1).length, secuencia.length);
});

test('mover una corrida no pierde ninguna', async () => {
  const { moverCorrida } = await cargarInterfaz();
  const { secuencia } = caso([14.7, 14.8, 14.5, 15.09]);
  const movida = moverCorrida(secuencia, 3, 0);

  assert.equal(movida.length, secuencia.length);
  assert.equal(movida[0].parte, secuencia[3].parte);
  assert.deepEqual(
    [...movida].map((c) => c.parte).sort(),
    [...secuencia].map((c) => c.parte).sort(),
  );
});
