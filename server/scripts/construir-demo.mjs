/**
 * Genera web/hiloflo-demo.html: un solo archivo que se abre en el navegador,
 * sin servidor, sin base de datos y sin internet.
 *
 * El motor NO se copia a mano. Se arma desde las mismas fuentes que usa el
 * modulo de produccion, quitando los import/export y concatenando. Asi no
 * hay dos motores que se desincronicen, que es justo el problema que ya
 * costo una vez cuando el motor estaba en Python y en JavaScript.
 *
 *   npm run demo
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..');
const WEB = join(RAIZ, '..', 'web');

/** En orden de dependencia. Ninguno de estos toca exceljs, mssql ni express. */
const FUENTES = [
  'src/util/numeros.js',
  'src/motor/modelos.js',
  'src/motor/rendimiento.js',
  'src/motor/programa.js',
  'src/motor/optimizador.js',
  'src/catalogo/velocidades.js',
  'src/catalogo/velocidades-catalogo.js',
  'src/ingesta/comun.js',
  'src/ingesta/hoja.js',
  'src/ingesta/parametros.js',
  'src/ingesta/schedule.js',
  'src/xlsx/lector.js',
  'src/servicio/avisos.js',
  'src/servicio/analisis.js',
];

/** Quita los import/export para que los modulos vivan en un solo ambito. */
function aplanar(codigo) {
  return codigo
    // import ... from '...';  (una o varias lineas)
    .replace(/^import\s+[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    .replace(/^import\s+'[^']+';\s*$/gm, '')
    // export { a, b };  (reexportaciones: sobran al aplanar)
    .replace(/^export\s*\{[^}]*\};\s*$/gm, '')
    // export const / function / class  ->  const / function / class
    .replace(/^export\s+(?=(const|let|function|class|async))/gm, '')
    .trim();
}

/**
 * Al concatenar, dos declaraciones con el mismo nombre se pisan en silencio.
 * Mejor que la compilacion truene aqui que perseguir el bug en el navegador.
 */
function revisarDuplicados(porArchivo) {
  const vistos = new Map();
  const choques = [];
  for (const [archivo, codigo] of porArchivo) {
    for (const m of codigo.matchAll(/^(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)) {
      const nombre = m[1];
      if (vistos.has(nombre)) choques.push(`${nombre} (${vistos.get(nombre)} y ${archivo})`);
      else vistos.set(nombre, archivo);
    }
  }
  if (choques.length) {
    throw new Error(
      'nombres duplicados al aplanar los modulos:\n  - ' + choques.join('\n  - ') +
      '\nRenombra uno de los dos: al concatenar viven en el mismo ambito.',
    );
  }
  return vistos.size;
}

const porArchivo = [];
for (const ruta of FUENTES) {
  porArchivo.push([ruta, aplanar(await readFile(join(RAIZ, ruta), 'utf8'))]);
}

const estilos = await readFile(join(WEB, 'estilos.css'), 'utf8');
const plantilla = await readFile(join(WEB, 'demo', 'plantilla.html'), 'utf8');
const pantallaCatalogo = await readFile(join(WEB, 'comun', 'pantalla-catalogo.js'), 'utf8');
const interfaz = [pantallaCatalogo, await readFile(join(WEB, 'demo', 'interfaz.js'), 'utf8')].join('\n\n');

// La interfaz entra al MISMO ambito que el motor, asi que tambien se revisa.
// Aqui choco una vez avisoSinReceta (dominio) contra avisoSinReceta (pintado)
// y la version de pintado gano en silencio.
const simbolos = revisarDuplicados([...porArchivo, ['web/demo/interfaz.js', interfaz]]);

const motor = porArchivo
  .map(([ruta, codigo]) => `// ===== ${ruta} ${'='.repeat(Math.max(0, 62 - ruta.length))}\n\n${codigo}`)
  .join('\n\n');

const html = plantilla
  .replace('/*{ESTILOS}*/', () => estilos)
  .replace('/*{MOTOR}*/', () => motor)
  .replace('/*{INTERFAZ}*/', () => interfaz);

const destino = join(WEB, 'hiloflo-demo.html');
await writeFile(destino, html);

const kb = (html.length / 1024).toFixed(0);
console.log(`web/hiloflo-demo.html  ${kb} KB`);
console.log(`  ${FUENTES.length} modulos, ${simbolos} simbolos, sin dependencias externas`);
