import { chromium } from 'playwright';
import path from 'node:path';
import { cargarConExcelJs } from './src/ingesta/excel.js';
import { leerPrograma } from './src/ingesta/servidor.js';

const XLSX = path.resolve('../data/entrada/Schedule_8200_09-17-2026.xlsx');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function probar(url, etiqueta, destino) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errores = [];
  pg.on('console', (m) => { if (m.type()==='error' && !/CERT_AUTHORITY|404/.test(m.text())) errores.push(m.text()); });
  pg.on('pageerror', (e) => errores.push(e.message));
  await pg.goto(url);
  await pg.setInputFiles('#archivo-schedule', XLSX);
  await pg.click('#analizar');
  await pg.waitForSelector('#consejos .consejo', { state: 'attached', timeout: 180000 });
  await pg.click('button[data-panel="analisis"]');
  await pg.waitForTimeout(300);

  console.log(`\n=== ${etiqueta} ===`);
  console.log('boton antes de aceptar:', await pg.$eval('#exportar', e => `"${e.textContent.trim()}" disabled=${e.disabled}`));

  // aceptar los tres primeros consejos
  const botones = await pg.$$('#consejos .consejo button[data-accion="si"]');
  for (const bt of botones.slice(0, 3)) await bt.click();
  await pg.waitForTimeout(300);
  console.log('boton tras aceptar 3:', await pg.$eval('#exportar', e => `"${e.textContent.trim()}" disabled=${e.disabled}`));

  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.click('#exportar')]);
  await dl.saveAs(destino);
  console.log('descargado:', dl.suggestedFilename());
  console.log('errores:', errores.length ? errores : 'ninguno');
  await ctx.close();
  return destino;
}

const original = await leerPrograma(XLSX);
const rutas = [];
rutas.push(await probar(`file://${path.resolve('../web/hiloflo-demo.html')}`, 'demo', '/tmp/x-demo.xlsx'));
rutas.push(await probar('http://localhost:3107/', 'instalado', '/tmp/x-inst.xlsx'));

for (const r of rutas) {
  const { nombres } = await cargarConExcelJs(r, { hoja: 'Sheet1' });
  const re = await leerPrograma(r);
  const movidas = re.ordenes.filter((o) => {
    const orig = original.ordenes.find((x) => x.id === o.id);
    return orig && orig.linea !== o.linea;
  });
  console.log(`\n${r}: hojas ${JSON.stringify(nombres)} | ${re.length} ordenes (orig ${original.length}) | ${Math.round(re.kilogramos)} kg (orig ${Math.round(original.kilogramos)}) | ${movidas.length} ordenes movidas`);
}
await b.close();
