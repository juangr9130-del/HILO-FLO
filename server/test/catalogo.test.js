import test from 'node:test';
import assert from 'node:assert/strict';

import {
  catalogoParaPantalla,
  catalogoVigente,
  clavePunto,
  nombreVariante,
  puntosDelMotor,
  resumenAjustes,
  revisarAjuste,
  semilla,
} from '../src/catalogo/velocidades-catalogo.js';
import { PUNTOS } from '../src/catalogo/velocidades.js';
import { kgHora } from '../src/motor/rendimiento.js';

test('la semilla trae todos los puntos del WI', () => {
  assert.equal(semilla().length, PUNTOS);
  assert.equal(semilla().length, 3282);
});

test('las claves de los puntos son unicas', () => {
  const claves = new Set(semilla().map((p) => p.clave));
  assert.equal(claves.size, PUNTOS);
});

test('sin ajustes, el catalogo vigente es la semilla', () => {
  const vigente = catalogoVigente();
  assert.equal(vigente.length, PUNTOS);
  assert.ok(vigente.every((p) => !p.ajustado && p.mmS === p.mmSOriginal));
});

test('un ajuste cambia el valor y deja ver el original', () => {
  const punto = semilla()[0];
  const vigente = catalogoVigente(new Map([[punto.clave, 321]]));
  const cambiado = vigente.find((p) => p.clave === punto.clave);

  assert.equal(cambiado.mmS, 321);
  assert.equal(cambiado.mmSOriginal, punto.mmS);
  assert.equal(cambiado.ajustado, true);
});

test('un ajuste igual al del documento no cuenta como ajuste', () => {
  const punto = semilla()[0];
  const vigente = catalogoVigente(new Map([[punto.clave, punto.mmS]]));
  assert.equal(vigente.find((p) => p.clave === punto.clave).ajustado, false);
});

test('el resumen dice cuantos valores se apartaron y de que lineas', () => {
  const puntos = semilla();
  const deItw1 = puntos.filter((p) => p.linea === 'ITW-1').slice(0, 2);
  const deItw13 = puntos.filter((p) => p.linea === 'ITW-13').slice(0, 1);
  const ajustes = new Map([...deItw1, ...deItw13].map((p) => [p.clave, p.mmS + 10]));

  const r = resumenAjustes(ajustes);

  assert.equal(r.total, 3);
  assert.deepEqual(
    r.lineas.sort((a, b) => a.linea.localeCompare(b.linea)),
    [{ linea: 'ITW-1', puntos: 2 }, { linea: 'ITW-13', puntos: 1 }],
  );
});

test('el motor recibe los puntos ya ajustados', () => {
  const punto = semilla().find((p) => p.linea === 'ITW-1');
  const puntos = puntosDelMotor(new Map([[punto.clave, 111]]));
  const encontrado = puntos.find(
    (p) => p.linea === punto.linea && p.diametroMm === punto.diametroMm,
  );
  assert.equal(encontrado.mmS, 111);
});

test('el kg/h se deriva de la velocidad, no se guarda', () => {
  const punto = semilla().find((p) => p.linea === 'ITW-1');
  const grupos = catalogoParaPantalla(new Map([[punto.clave, 200]]));
  const fila = grupos
    .find((g) => g.linea === 'ITW-1')
    .puntos.find((p) => p.clave === punto.clave);

  assert.equal(fila.mmS, 200);
  assert.equal(
    fila.kgHora,
    Math.round(kgHora(200, punto.diametroMm) * 10) / 10,
    'cambiar la velocidad tiene que recalcular el rendimiento',
  );
});

test('la eficiencia se aplica al kg/h de la pantalla', () => {
  const completo = catalogoParaPantalla(new Map())[0].puntos[0];
  const castigado = catalogoParaPantalla(new Map(), { eficiencia: 0.5 })[0].puntos[0];
  assert.ok(Math.abs(castigado.kgHora - completo.kgHora / 2) < 0.2);
});

test('las variantes se nombran como las lee el programador', () => {
  assert.equal(nombreVariante({ winder: 'DEM', grado: '1065', slm: null }), 'devanador DEM · grado 1065');
  assert.equal(nombreVariante({ winder: null, grado: null, slm: true }), 'SLM');
  assert.equal(nombreVariante({ winder: null, grado: null, slm: false }), 'NON SLM');
  assert.equal(nombreVariante({ winder: null, grado: null, slm: null }), '');
});

test('ITW-2 tiene tres variantes e ITW-10 dos', () => {
  const grupos = catalogoParaPantalla(new Map());
  assert.equal(grupos.filter((g) => g.linea === 'ITW-2').length, 3);
  assert.equal(grupos.filter((g) => g.linea === 'ITW-10').length, 2);
  assert.equal(grupos.filter((g) => g.linea === 'ITW-13').length, 1);
});

test('revisarAjuste rechaza lo que no tiene sentido', () => {
  const clave = semilla()[0].clave;
  assert.equal(revisarAjuste(clave, 300), null);
  assert.match(revisarAjuste('no-existe', 300), /no existe/);
  assert.match(revisarAjuste(clave, 0), /mayor que cero/);
  assert.match(revisarAjuste(clave, -5), /mayor que cero/);
  assert.match(revisarAjuste(clave, 'abc'), /numero/);
  assert.match(revisarAjuste(clave, 5000), /fuera de rango/);
});

test('clavePunto distingue las variantes de la misma linea y diametro', () => {
  const base = { linea: 'ITW-2', diametroMm: 7.0 };
  const a = clavePunto({ ...base, winder: 'NETUREN', grado: null, slm: null });
  const b = clavePunto({ ...base, winder: 'DEM', grado: '9254', slm: null });
  const c = clavePunto({ ...base, winder: 'DEM', grado: '1065', slm: null });
  assert.equal(new Set([a, b, c]).size, 3);
});

test('la formula de kg/h de la interfaz no se despega de la del motor', async () => {
  // La pantalla de velocidades recalcula el renglon en cada tecla sin ir al
  // servidor, asi que repite la formula. Si alguien cambia una de las dos,
  // esta prueba truena.
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const aqui = dirname(fileURLToPath(import.meta.url));
  const fuente = await readFile(
    join(aqui, '..', '..', 'web', 'comun', 'pantalla-catalogo.js'),
    'utf8',
  );

  const cuerpo = fuente.slice(
    fuente.indexOf('function kgHoraDeVelocidad'),
    fuente.indexOf('/**', fuente.indexOf('function kgHoraDeVelocidad')),
  );
  // eslint-disable-next-line no-new-func
  const deLaInterfaz = new Function(`${cuerpo}; return kgHoraDeVelocidad;`)();

  for (const [mmS, d, ef] of [[170, 14.7, 1], [600, 5.49, 1], [100, 23, 0.85], [275, 7.92, 0.5]]) {
    assert.ok(
      Math.abs(deLaInterfaz(mmS, d, ef) - kgHora(mmS, d, { eficiencia: ef })) < 1e-9,
      `${mmS} mm/s de ${d} mm con eficiencia ${ef}`,
    );
  }
});
