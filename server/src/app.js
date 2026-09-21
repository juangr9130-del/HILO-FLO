/** La app Express del modulo. Se separa del arranque para poder probarla. */

import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { sesion } from './auth.js';
import { crearApi, manejadorDeErrores } from './rutas/api.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const WEB = join(aqui, '..', '..', 'web');

export function crearApp(repo) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(sesion);
  app.use('/api', crearApi(repo));
  app.use(express.static(WEB));
  app.use(manejadorDeErrores);
  return app;
}
