import { chromium } from 'playwright';
import path from 'node:path';
const XLSX = path.resolve('../data/entrada/Schedule_8200_09-17-2026.xlsx');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function probar(url, etiqueta, tiro) {
  const pg = await (await b.newContext({ viewport: { width: 1350, height: 1100 } })).newPage();
  const errores = [];
  pg.on('console', (m) => { if (m.type()==='error' && !/CERT_AUTHORITY|404/.test(m.text())) errores.push(m.text()); });
  pg.on('pageerror', (e) => errores.push(e.message));
  await pg.goto(url);
  await pg.setInputFiles('#archivo-schedule', XLSX);
  await pg.click('#analizar');
  await pg.waitForSelector('#kpis-programacion .kpi', { state:'attached', timeout: 180000 });
  await pg.waitForTimeout(400);
  console.log(`\n=== ${etiqueta} ===`);
  for (const a of await pg.$$eval('#avisos .aviso', n=>n.map(e=>e.textContent.replace(/\s+/g,' ').trim())))
    if (/range/.test(a)) console.log('aviso:', a.slice(0, 260));

  await pg.click('button[data-panel="reglas"]');
  await pg.waitForTimeout(400);
  console.log('lineas en la tabla:', await pg.$$eval('#rangos tbody tr', n=>n.length));
  console.log('ITW-1:', await pg.$eval('#rangos input[data-rango="ITW-1"][data-lado="min"]', e=>e.value),
              '-', await pg.$eval('#rangos input[data-rango="ITW-1"][data-lado="max"]', e=>e.value));

  // rango invalido: el minimo por encima del maximo
  await pg.fill('#rangos input[data-rango="ITW-1"][data-lado="min"]', '20');
  await pg.dispatchEvent('#rangos input[data-rango="ITW-1"][data-lado="min"]', 'change');
  await pg.waitForTimeout(400);
  console.log('tras poner min 20 (max 15.4):', await pg.$eval('#rangos input[data-rango="ITW-1"][data-lado="min"]', e=>e.value), '<- se rechazo y volvio');

  // uno valido
  await pg.fill('#rangos input[data-rango="ITW-1"][data-lado="max"]', '16');
  await pg.dispatchEvent('#rangos input[data-rango="ITW-1"][data-lado="max"]', 'change');
  await pg.waitForTimeout(400);
  console.log('marcado como cambiado:', await pg.$$eval('#rangos tr.cambiado td:first-child', n=>n.map(e=>e.textContent.trim())));
  await pg.click('#rangos button[data-quitar-rango="ITW-1"]');
  await pg.waitForTimeout(400);
  console.log('tras Reset:', await pg.$eval('#rangos input[data-rango="ITW-1"][data-lado="max"]', e=>e.value));
  await pg.screenshot({ path: tiro, clip: { x:0, y:120, width:1350, height:760 } });
  console.log('errores:', errores.length ? errores : 'ninguno');
  await pg.close();
}
await probar(`file://${path.resolve('../web/hiloflo-demo.html')}`, 'demo', '/tmp/rangos.png');
await probar('http://localhost:3109/', 'instalado', '/tmp/rangos-inst.png');
await b.close();
