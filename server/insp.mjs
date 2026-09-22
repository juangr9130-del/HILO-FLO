import { cargarConExcelJs } from './src/ingesta/excel.js';
const { filas, hoja, nombres } = await cargarConExcelJs('../data/entrada/Schedule_8200_09-17-2026.xlsx', { hoja: 'Sheet1' });
console.log('hojas:', nombres, '| leida:', hoja, '| filas:', Math.max(...filas.keys()));
for (const n of [1,2,3,4,5]) {
  const f = filas.get(n);
  console.log(n, f ? JSON.stringify([...f.entries()].map(([c,v]) => `${c}=${String(v).slice(0,30)}`)) : '(vacia)');
}
// ultimas filas (subtotales)
const max = Math.max(...filas.keys());
for (const n of [max-1, max]) {
  const f = filas.get(n);
  console.log(n, f ? JSON.stringify([...f.entries()].map(([c,v]) => `${c}=${String(v).slice(0,30)}`)) : '(vacia)');
}
