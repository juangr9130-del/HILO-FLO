/**
 * El .xlsx que se manda por correo.
 *
 * La prueba que de verdad importa es la de IDA Y VUELTA: lo que sale se tiene
 * que poder volver a leer con el mismo lector que lee el schedule de SAP. Si
 * eso se cumple, el archivo abre en Excel y se puede resubir al modulo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analizar, empaquetar, SUPUESTOS } from '../src/servicio/analisis.js';
import { exportarPrograma, movimientosAceptados, nombreArchivo } from '../src/servicio/exportar.js';
import { leerPrograma } from '../src/ingesta/servidor.js';
import { lineaAWorkCenter } from '../src/motor/modelos.js';
import { orden, programa, punto } from './ayudas.js';

// ITW-1 es lenta y ITW-7 el doble de rapida para 14.7 mm, asi que hay algo
// que mover y el movimiento se acepta a mano.
const puntos = [punto('ITW-1', 14.7, 100), punto('ITW-7', 14.7, 200)];

function paqueteConMovimientos() {
  const ordenes = [1, 2, 3, 4, 5, 6].map((n) =>
    orden(`O${n}`, 14.7, 3000, 'ITW-1', {
      secuencia: n,
      material: `P${n}`,
      descripcion: `CSW,14.70mm HT & "test" <n${n}>`,
      clientePo: `PO-${n}`,
      notas: n === 1 ? 'SAME HEAT REQUIRED' : '',
    }),
  );
  const prog = programa(ordenes);
  // Sin el rango de piso: estas ordenes son sinteticas (14.7 mm de ITW-1 a
  // ITW-7) y caerian fuera del rango real de ITW-7. Lo que se prueba aqui es
  // el archivo que sale, no a donde se puede mover.
  const sup = { ...SUPUESTOS, objetivo: 'rendimiento', topeOrdenes: 99, respetarRangos: false };
  return empaquetar({
    folio: 'FLO-2026-0001',
    archivo: 'Schedule_8200_09-17-2026.xlsx',
    supuestos: sup,
    ...analizar(prog, puntos, sup),
  });
}

async function leerDeVuelta(bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'flo-'));
  const ruta = join(dir, 'salida.xlsx');
  await writeFile(ruta, bytes);
  return leerPrograma(ruta);
}

test('lo exportado se vuelve a leer con el lector del schedule', async () => {
  const p = paqueteConMovimientos();
  assert.ok(p.analisis.movimientos.length > 0, 'el caso de prueba tiene que proponer algo');
  p.analisis.movimientos[0].aceptado = true;

  const releido = await leerDeVuelta(exportarPrograma(p));

  assert.equal(releido.length, p.ordenes, 'se perdieron o sobraron ordenes al ida y vuelta');
  assert.equal(Math.round(releido.kilogramos), Math.round(p.kilogramos));
});

test('solo se mueven las ordenes de un movimiento ACEPTADO', async () => {
  const p = paqueteConMovimientos();
  const m = p.analisis.movimientos[0];

  // Sin aceptar nada, el archivo sale igual que entro.
  const sinAceptar = await leerDeVuelta(exportarPrograma(p));
  for (const o of sinAceptar.ordenes) assert.equal(o.linea, 'ITW-1');

  // Aceptado, esas ordenes salen en su linea nueva y las demas no se tocan.
  m.aceptado = true;
  const movidas = new Set(m.folios.map(String));
  const conAceptado = await leerDeVuelta(exportarPrograma(p));
  for (const o of conAceptado.ordenes) {
    assert.equal(o.linea, movidas.has(String(o.id)) ? m.destino : 'ITW-1', `orden ${o.id}`);
  }
});

test('un consejo rechazado no mueve nada', async () => {
  const p = paqueteConMovimientos();
  p.analisis.movimientos[0].aceptado = false;
  assert.equal(movimientosAceptados(p).size, 0);
  const releido = await leerDeVuelta(exportarPrograma(p));
  for (const o of releido.ordenes) assert.equal(o.linea, 'ITW-1');
});

test('se conservan notas, PO y descripcion con caracteres que rompen XML', async () => {
  const p = paqueteConMovimientos();
  p.analisis.movimientos[0].aceptado = true;
  const releido = await leerDeVuelta(exportarPrograma(p));

  const o1 = releido.ordenes.find((o) => o.id === 'O1');
  assert.equal(o1.notas, 'SAME HEAT REQUIRED');
  assert.equal(o1.clientePo, 'PO-1');
  assert.ok(o1.descripcion.includes('& "test" <n1>'), `la descripcion llego como: ${o1.descripcion}`);
});

test('el work center del archivo es el de la linea nueva', async () => {
  const p = paqueteConMovimientos();
  const m = p.analisis.movimientos[0];
  m.aceptado = true;
  const releido = await leerDeVuelta(exportarPrograma(p));
  const movida = releido.ordenes.find((o) => m.folios.map(String).includes(String(o.id)));
  assert.equal(lineaAWorkCenter(movida.linea), lineaAWorkCenter(m.destino));
});

test('el nombre del archivo dice de que folio salio', () => {
  const p = paqueteConMovimientos();
  assert.equal(nombreArchivo(p), 'Schedule_8200_09-17-2026_FLO-2026-0001_rebalanced.xlsx');
});

test('el archivo es un zip valido con las partes que Excel pide', async () => {
  const p = paqueteConMovimientos();
  p.analisis.movimientos[0].aceptado = true;
  const bytes = exportarPrograma(p);

  // Firma de ZIP local y de fin de directorio central: si alguna se rompe,
  // el archivo no abre en ningun lado y el error es de los dificiles.
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'no empieza como ZIP');
  const fin = bytes.slice(-22, -18);
  assert.deepEqual([...fin], [0x50, 0x4b, 0x05, 0x06], 'no cierra el directorio central');

  // Y las partes que Excel exige, por nombre.
  const texto = new TextDecoder('latin1').decode(bytes);
  for (const parte of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml',
  ]) {
    assert.ok(texto.includes(parte), `falta ${parte}`);
  }
});
