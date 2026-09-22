import { analizar, empaquetar, SUPUESTOS } from './src/servicio/analisis.js';
import { exportarPrograma, nombreArchivo } from './src/servicio/exportar.js';
import { puntosDelMotor } from './src/catalogo/velocidades-catalogo.js';
import { leerPrograma } from './src/ingesta/servidor.js';
import { cargarConExcelJs } from './src/ingesta/excel.js';
import { writeFile } from 'node:fs/promises';

const prog = await leerPrograma('../data/entrada/Schedule_8200_09-17-2026.xlsx');
const p = empaquetar({ folio:'FLO-2026-0001', archivo:'Schedule_8200_09-17-2026.xlsx', supuestos:SUPUESTOS,
  ...analizar(prog, puntosDelMotor(), SUPUESTOS) });
// aceptar los primeros 6 de 12
p.analisis.movimientos.slice(0,6).forEach(m => { m.aceptado = true; });
p.analisis.movimientos.slice(6).forEach(m => { m.aceptado = false; });

const bytes = exportarPrograma(p);
const ruta = `/tmp/${nombreArchivo(p)}`;
await writeFile(ruta, bytes);
console.log(`${ruta}  ${(bytes.length/1024).toFixed(0)} KB`);

// abrirlo con exceljs = lo que hara Excel
const { nombres, filas } = await cargarConExcelJs(ruta, { hoja: 'Sheet1' });
console.log('hojas:', nombres, '| filas:', Math.max(...filas.keys()));
for (const n of [1,2,3]) console.log(n, JSON.stringify([...filas.get(n).entries()].map(([c,v])=>`${c}=${String(v).slice(0,26)}`)));
// un renglon movido
for (const [n, f] of filas) { if (f.get(11) === 'MOVED') { console.log('movido:', JSON.stringify([...f.entries()].map(([c,v])=>`${c}=${String(v).slice(0,30)}`))); break; } }
const { filas: res } = await cargarConExcelJs(ruta, { hoja: 'Summary' });
console.log('\nSummary:');
for (const n of [1,2,3,4,5,8,9,10,11,12]) { const f = res.get(n); if (f) console.log(' ', [...f.values()].join(' | ')); }

// y que se vuelva a leer con el lector del modulo
const re = await leerPrograma(ruta);
console.log(`\nrelectura: ${re.length} ordenes, ${Math.round(re.kilogramos)} kg (original ${prog.length}, ${Math.round(prog.kilogramos)})`);
