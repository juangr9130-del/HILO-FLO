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

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..');
const WEB = join(RAIZ, '..', 'web');

/** En orden de dependencia. Ninguno de estos toca exceljs, mssql ni express. */
const FUENTES = [
  'src/errores.js',
  'src/util/numeros.js',
  'src/motor/modelos.js',
  'src/motor/rendimiento.js',
  'src/motor/programa.js',
  'src/motor/optimizador.js',
  'src/catalogo/velocidades.js',
  'src/catalogo/velocidades-catalogo.js',
  'src/catalogo/rangos.js',
  'src/catalogo/restricciones.js',
  'src/ingesta/comun.js',
  'src/ingesta/hoja.js',
  'src/ingesta/parametros.js',
  'src/ingesta/schedule.js',
  'src/xlsx/lector.js',
  'src/xlsx/escritor.js',
  'src/servicio/avisos.js',
  'src/servicio/corridas.js',
  'src/servicio/analisis.js',
  'src/servicio/exportar.js',
  'src/servicio/reglas.js',
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
function revisarDuplicados(porArchivo, vistos = new Map()) {
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

/**
 * Lo que un modulo importa de otro modulo del motor.
 *
 * Sirve para cachar el olvido contrario al duplicado: agregar un archivo
 * nuevo, importarlo desde otro que si esta en FUENTES y no agregarlo aqui.
 * Al aplanar, el import desaparece sin dejar rastro y el demo truena hasta
 * que alguien lo abre en el navegador. Paso con corridas.js.
 */
function importados(codigo) {
  const nombres = [];
  for (const m of codigo.matchAll(/^import\s+([\s\S]*?)\s+from\s+'(\.[^']+)';/gm)) {
    const clausula = m[1].trim();
    const llaves = /\{([\s\S]*)\}/.exec(clausula);
    if (!llaves) {
      throw new Error(
        `${clausula} importa de ${m[2]} sin llaves; el demo solo sabe aplanar imports con nombre.`,
      );
    }
    for (const parte of llaves[1].split(',')) {
      const local = parte.trim().split(/\s+as\s+/).pop().trim();
      if (local) nombres.push(local);
    }
  }
  return nombres;
}

/**
 * Dos reglas de primer nivel para la misma clase.
 *
 * Es la version CSS del simbolo duplicado, y pega igual de feo: .barra ya era
 * la barrita de 8 px del tablero (con height fija y overflow:hidden) cuando
 * se reuso el nombre para una barra de controles. Los controles quedaron
 * recortados a 8 px de alto y se veian cortados a la mitad en dos pantallas.
 *
 * Solo se miran las reglas pegadas al margen, que son las de las secciones.
 * Una redefinicion dentro de @media va indentada y no cuenta, porque ahi si
 * es a proposito.
 */
function revisarClasesRepetidas(css) {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const duenas = new Map();
  const choques = [];
  for (const m of limpio.matchAll(/^([^{}@\n][^{}\n]*)\{/gm)) {
    for (const parte of m[1].split(',')) {
      const clase = /^\.([a-z][\w-]*)\s*$/.exec(parte.trim());
      if (!clase) continue;
      const linea = limpio.slice(0, m.index).split('\n').length;
      if (duenas.has(clase[1])) choques.push(`.${clase[1]} (lineas ${duenas.get(clase[1])} y ${linea})`);
      else duenas.set(clase[1], linea);
    }
  }
  if (choques.length) {
    throw new Error(
      'clases de CSS con dos reglas propias:\n  - ' + choques.join('\n  - ') +
      '\nUna pisa a la otra. Renombra la nueva o junta las dos reglas.',
    );
  }
}

/** Todo lo que se importa tiene que quedar declarado en el paquete. */
function revisarFaltantes(pedidos, declarados) {
  const faltan = [...new Set([...pedidos].filter((n) => !declarados.has(n)))];
  if (faltan.length) {
    throw new Error(
      'estos simbolos se importan pero no quedaron en el demo:\n  - ' + faltan.join('\n  - ') +
      '\nProbablemente falta agregar su archivo a FUENTES en este script.',
    );
  }
}

const porArchivo = [];
const pedidos = [];
for (const ruta of FUENTES) {
  const crudo = await readFile(join(RAIZ, ruta), 'utf8');
  pedidos.push(...importados(crudo));
  porArchivo.push([ruta, aplanar(crudo)]);
}

const estilos = await readFile(join(WEB, 'estilos.css'), 'utf8');
const plantilla = await readFile(join(WEB, 'demo', 'plantilla.html'), 'utf8');
const comun = await Promise.all(
  ['secuencia.js', 'pantalla-analisis.js', 'pantalla-catalogo.js', 'pantalla-historial.js', 'pantalla-reglas.js'].map((f) => readFile(join(WEB, 'comun', f), 'utf8')),
);
const interfaz = [...comun, await readFile(join(WEB, 'demo', 'interfaz.js'), 'utf8')].join('\n\n');

// La interfaz entra al MISMO ambito que el motor, asi que tambien se revisa.
// Aqui choco una vez avisoSinReceta (dominio) contra avisoSinReceta (pintado)
// y la version de pintado gano en silencio.
const declarados = new Map();
const simbolos = revisarDuplicados([...porArchivo, ['web/demo/interfaz.js', interfaz]], declarados);
revisarFaltantes(pedidos, declarados);
revisarClasesRepetidas(estilos);

const motor = porArchivo
  .map(([ruta, codigo]) => `// ===== ${ruta} ${'='.repeat(Math.max(0, 62 - ruta.length))}\n\n${codigo}`)
  .join('\n\n');

/**
 * La huella de la forma del paquete.
 *
 * El demo guarda los folios en el navegador y tiene que tirar los que se
 * guardaron con una forma vieja. Ese numero se subia a mano y dos veces se
 * olvido: quedaron folios pintando ceros y folios sin hoja de corridas.
 *
 * Aqui sale solo. Se toman los archivos que DECIDEN la forma del paquete y
 * los que la LEEN: si cambia cualquiera, la huella cambia y lo guardado se
 * descarta. Cuesta un schedule que volver a subir, que son segundos; el bug
 * contrario cuesta creerle a una pantalla en ceros.
 */
const huella = createHash('sha256');
for (const [ruta, codigo] of porArchivo) {
  if (/servicio|motor/.test(ruta)) huella.update(`${ruta}\n${codigo}\n`);
}
huella.update(comun[0]); // pantalla-analisis.js, la que lee el paquete
const version = huella.digest('hex').slice(0, 12);

// Si alguien le pone un valor a mano, la huella deja de aplicarse en
// silencio y volvemos al bug que esto vino a matar.
if (!interfaz.includes("'{VERSION}'")) {
  throw new Error(
    "la interfaz ya no trae el marcador '{VERSION}' en VERSION_PAQUETE.\n" +
    'Sin el, el demo no descarta los folios guardados con una forma vieja.',
  );
}

const html = plantilla
  .replace('/*{ESTILOS}*/', () => estilos)
  .replace('/*{MOTOR}*/', () => motor)
  .replace('/*{INTERFAZ}*/', () => interfaz)
  .replace("'{VERSION}'", () => JSON.stringify(version));

const destino = join(WEB, 'hiloflo-demo.html');
await writeFile(destino, html);

const kb = (html.length / 1024).toFixed(0);
console.log(`web/hiloflo-demo.html  ${kb} KB`);
console.log(`  ${FUENTES.length} modulos, ${simbolos} simbolos, sin dependencias externas`);
console.log(`  forma del paquete ${version}`);
