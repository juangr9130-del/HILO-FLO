/**
 * Genera src/catalogo/velocidades.js a partir del WI-FLO-CSW-P-526.
 *
 *   node scripts/generar-catalogo.mjs <ruta-del-WI.xlsx>
 *
 * Se corre UNA VEZ por revision del documento, no en cada arranque. El
 * catalogo generado es la semilla: de ahi en adelante los valores se editan
 * desde la pantalla de Velocidades y los cambios se guardan como ajustes
 * encima de esta semilla, para que siempre se pueda ver que se aparto del
 * documento y volver a el.
 *
 * Formato compacto a proposito: 3,282 puntos como objetos sueltos pesarian
 * ~200 KB y el modulo demo viaja como un solo archivo.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leerVelocidades } from '../src/ingesta/servidor.js';
import { compararLineas } from '../src/motor/modelos.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(aqui, '..', 'src', 'catalogo', 'velocidades.js');

const ruta = process.argv[2];
if (!ruta) {
  console.error('uso: node scripts/generar-catalogo.mjs <ruta-del-WI.xlsx>');
  process.exit(1);
}

const puntos = await leerVelocidades(ruta);

// Una serie por combinacion de discriminantes: ITW-2 tiene tres (devanador y
// grado), ITW-10 dos (SLM), y las demas una sola.
const series = new Map();
for (const p of puntos) {
  const clave = `${p.linea}|${p.winder ?? ''}|${p.grado ?? ''}|${p.slm === null ? '' : p.slm}`;
  if (!series.has(clave)) {
    series.set(clave, { linea: p.linea, winder: p.winder, grado: p.grado, slm: p.slm, puntos: [] });
  }
  series.get(clave).puntos.push([p.diametroMm, p.mmS]);
}

const ordenadas = [...series.values()].sort(
  (a, b) =>
    compararLineas(a.linea, b.linea) ||
    String(a.winder).localeCompare(String(b.winder)) ||
    String(a.grado).localeCompare(String(b.grado)),
);
for (const s of ordenadas) s.puntos.sort((a, b) => a[0] - b[0]);

const cuerpo = ordenadas
  .map((s) => {
    const cab = `    linea: '${s.linea}', winder: ${lit(s.winder)}, grado: ${lit(s.grado)}, slm: ${lit(s.slm)},`;
    const pts = s.puntos.map(([d, v]) => `[${d}, ${v}]`);
    // Se parten en renglones de ~8 para que el diff sea legible cuando
    // cambie una revision del documento.
    const lineas = [];
    for (let i = 0; i < pts.length; i += 8) lineas.push('      ' + pts.slice(i, i + 8).join(', '));
    return `  {\n${cab}\n    puntos: [\n${lineas.join(',\n')},\n    ],\n  },`;
  })
  .join('\n');

const archivo = `/**
 * Catalogo de velocidades de receta de las lineas ITW.
 *
 * GENERADO por scripts/generar-catalogo.mjs desde el WI-FLO-CSW-P-526.
 * No se edita a mano: los cambios del dia a dia se hacen desde la pantalla
 * de Velocidades y se guardan como ajustes encima de esta semilla. Para una
 * revision nueva del documento se vuelve a correr el generador.
 *
 * Cada serie es una combinacion de discriminantes. ITW-2 tiene tres (por
 * devanador y grado), ITW-10 dos (por SLM) y las demas lineas una sola.
 * null significa "aplica a cualquiera".
 *
 * Cada punto es [diametro_mm, mm_s]. El rendimiento en kg/h NO se guarda:
 * sale de la velocidad y de la geometria del alambre, asi que cambiar una
 * velocidad aqui recalcula el kg/h solo.
 */

export const DOCUMENTO = 'WI-FLO-CSW-P-526';

export const SERIES = [
${cuerpo}
];

/** Total de puntos del catalogo, para verificar de un vistazo. */
export const PUNTOS = ${puntos.length};
`;

function lit(v) {
  return v === null ? 'null' : typeof v === 'boolean' ? String(v) : `'${v}'`;
}

await writeFile(DESTINO, archivo);
console.log(`src/catalogo/velocidades.js`);
console.log(`  ${ordenadas.length} series, ${puntos.length} puntos, ${(archivo.length / 1024).toFixed(0)} KB`);
