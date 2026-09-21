/**
 * Arranque del modulo HILO-FLO.
 *
 * Un proceso PM2 por modulo, igual que HILO/HORA/MTTO/AUTO. Sin cadena de
 * conexion arranca en modo demo (todo en memoria), util para revisar la
 * pantalla con archivos reales sin montar SQL Server.
 */

import { config, hayBaseDeDatos } from './config.js';
import { crearApp } from './app.js';
import { RepositorioMemoria } from './db/memoria.js';
import { hayAutenticacion } from './auth.js';

async function repositorio() {
  if (!hayBaseDeDatos()) return new RepositorioMemoria();
  const { conectar, RepositorioSql } = await import('./db/sqlserver.js');
  const repo = new RepositorioSql(await conectar());
  // El catalogo de velocidades viene dentro del modulo; la base lo recibe la
  // primera vez y de ahi en adelante manda ella, con lo que planta ajuste.
  const siembra = await repo.sembrarVelocidades();
  if (siembra.sembrados) console.log(`[FLO] catalogo sembrado: ${siembra.sembrados} velocidades`);
  if (siembra.sinLinea?.length) {
    console.warn(`[FLO] AVISO: lineas del catalogo que no estan en cat_linea: ${siembra.sinLinea.join(', ')}`);
  }
  return repo;
}

const repo = await repositorio();
const app = crearApp(repo);

app.listen(config.puerto, () => {
  console.log(`[FLO] escuchando en :${config.puerto}`);
  console.log(`[FLO] almacenamiento: ${repo.modo}`);
  if (!hayAutenticacion()) {
    console.warn('[FLO] AVISO: sin JWT_SECRET el modulo corre sin sesion (solo desarrollo).');
  }
  if (!hayBaseDeDatos()) {
    console.warn('[FLO] AVISO: sin DB_SERVER los folios y analisis se pierden al reiniciar.');
  }
});
