import { chromium } from 'playwright';
import path from 'node:path';
const XLSX = path.resolve('../data/entrada/Schedule_8200_09-17-2026.xlsx');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function probar(url, etiqueta, tiro) {
  const pg = await (await b.newContext({ viewport: { width: 1400, height: 1100 } })).newPage();
  const errores = [];
  pg.on('console', (m) => { if (m.type()==='error' && !/CERT_AUTHORITY|404/.test(m.text())) errores.push(m.text()); });
  pg.on('pageerror', (e) => errores.push(e.message));
  await pg.goto(url);
  await pg.setInputFiles('#archivo-schedule', XLSX);
  await pg.click('#analizar');
  await pg.waitForSelector('#kpis-programacion .kpi', { state:'attached', timeout: 180000 });
  await pg.waitForTimeout(400);

  console.log(`\n=== ${etiqueta} ===`);
  const kpi = () => pg.$eval('#kpis-programacion', e => e.textContent.replace(/\s+/g,' ').trim().slice(0, 150));
  console.log('con ±5 :', await kpi());

  await pg.click('button[data-panel="reglas"]');
  await pg.waitForTimeout(300);
  console.log('reglas:', (await pg.$$eval('.regla label', n=>n.map(e=>e.textContent.trim()))).join(' | '));
  console.log('pie   :', await pg.$eval('#pie-reglas', e => e.textContent.replace(/\s+/g,' ').trim()));

  // valor fuera de rango: se tiene que rechazar
  await pg.fill('#regla-topeOrdenes', '0');
  await pg.dispatchEvent('#regla-topeOrdenes', 'change');
  await pg.waitForTimeout(250);
  console.log('con 0 :', await pg.$eval('#error-topeOrdenes', e => e.hidden ? '(sin error!)' : e.textContent.trim()));

  // ahora ±3 y reanalizar
  await pg.fill('#regla-topeOrdenes', '3');
  await pg.dispatchEvent('#regla-topeOrdenes', 'change');
  await pg.waitForTimeout(300);
  console.log('marcada:', await pg.$eval('.regla.cambiada label', e => e.textContent.trim()));
  console.log('pie   :', await pg.$eval('#pie-reglas', e => e.textContent.replace(/\s+/g,' ').trim()));

  await pg.click('#reanalizar');
  await pg.waitForFunction(() => !document.getElementById('reanalizar') || document.getElementById('reanalizar').textContent !== 'Re-analyzing…', { timeout: 180000 });
  await pg.waitForTimeout(600);
  await pg.click('button[data-panel="programacion"]');
  await pg.waitForTimeout(300);
  console.log('con ±3 :', await kpi());
  console.log('folio  :', await pg.$eval('#folio', e => e.textContent.trim()));
  await pg.click('button[data-panel="reglas"]');
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: tiro, clip: { x: 0, y: 120, width: 1400, height: 800 } });
  console.log('errores:', errores.length ? errores : 'ninguno');
  await pg.close();
}

await probar(`file://${path.resolve('../web/hiloflo-demo.html')}`, 'demo', '/tmp/reglas.png');
await probar('http://localhost:3108/', 'instalado', '/tmp/reglas-inst.png');
await b.close();
