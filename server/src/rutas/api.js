/** API del modulo HILO-FLO. */

import { Router } from 'express';
import multer from 'multer';

import { config, hayBaseDeDatos } from '../config.js';
import { exigirAcceso, exigirEscritura, hayAutenticacion } from '../auth.js';
import { analizar, empaquetar, matrizRendimiento } from '../servicio/analisis.js';
import { ErrorDeDatos } from '../errores.js';
import { leerPrograma } from '../ingesta/servidor.js';
import {
  DOCUMENTO,
  catalogoParaPantalla,
  puntosDelMotor,
  resumenAjustes,
  revisarAjuste,
} from '../catalogo/velocidades-catalogo.js';

// Los dos Excel de planta pesan ~100 KB; 10 MB deja margen de sobra y evita
// que una subida equivocada tumbe el proceso.
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function crearApi(repo) {
  const api = Router();

  api.get('/estado', (req, res) => {
    res.json({
      modulo: config.modulo,
      almacenamiento: repo.modo,
      documento: DOCUMENTO,
      autenticacion: hayAutenticacion(),
      baseDeDatos: hayBaseDeDatos(),
      usuario: req.usuario,
      supuestos: {
        horasDisponibles: config.horasDisponibles,
        eficiencia: config.eficiencia,
        minutosCambio: config.minutosCambio,
      },
    });
  });

  api.use(exigirAcceso);

  /* ---------- Catalogo de velocidades ---------- */

  // Las velocidades vienen dentro del modulo, generadas del WI. No hay que
  // cargar el Excel: lo que se necesita es poder corregir un valor.

  api.get('/velocidades', async (req, res, siguiente) => {
    try {
      const ajustes = await repo.leerAjustes();
      res.json({
        documento: DOCUMENTO,
        eficiencia: config.eficiencia,
        resumen: resumenAjustes(ajustes),
        grupos: catalogoParaPantalla(ajustes, { eficiencia: config.eficiencia }),
      });
    } catch (e) {
      siguiente(e);
    }
  });

  api.put('/velocidades/:clave', exigirEscritura, async (req, res, siguiente) => {
    try {
      const { clave } = req.params;
      const motivo = revisarAjuste(clave, req.body?.mmS);
      if (motivo) return res.status(400).json({ error: `Not saved: ${motivo}.` });

      const guardado = await repo.guardarAjuste(
        clave,
        Number(req.body.mmS),
        req.usuario?.numeroEmpleado ?? null,
      );
      if (!guardado) return res.status(404).json({ error: 'That point is not in the catalog.' });
      res.json(guardado);
    } catch (e) {
      siguiente(e);
    }
  });

  api.delete('/velocidades/:clave', exigirEscritura, async (req, res, siguiente) => {
    try {
      const quitado = await repo.quitarAjuste(req.params.clave);
      if (!quitado) return res.status(404).json({ error: 'That point has no adjustment.' });
      res.json(quitado);
    } catch (e) {
      siguiente(e);
    }
  });

  api.delete('/velocidades', exigirEscritura, async (req, res, siguiente) => {
    try {
      res.json({ restablecidos: await repo.quitarTodosLosAjustes() });
    } catch (e) {
      siguiente(e);
    }
  });

  /* ---------- Programas ---------- */

  api.get('/programas', async (req, res, siguiente) => {
    try {
      res.json(await repo.listarProgramas());
    } catch (e) {
      siguiente(e);
    }
  });

  api.post('/programas', exigirEscritura, subida.single('archivo'), async (req, res, siguiente) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'The schedule file is missing.' });

      const puntos = puntosDelMotor(await repo.leerAjustes());

      const supuestos = {
        horasDisponibles: Number(req.body.horas ?? config.horasDisponibles),
        eficiencia: Number(req.body.eficiencia ?? config.eficiencia),
        minutosCambio: Number(req.body.minutosCambio ?? config.minutosCambio),
        itw15Activa: req.body.itw15 === 'true',
      };

      const programa = await leerPrograma(req.file.buffer);
      const resultado = analizar(programa, puntos, supuestos);
      const folio = await repo.siguienteFolio();
      const paquete = empaquetar({
        folio,
        archivo: req.file.originalname,
        cargadoPor: req.usuario?.numeroEmpleado ?? null,
        supuestos,
        ...resultado,
      });

      await repo.guardarPrograma(paquete);
      res.status(201).json(paquete);
    } catch (e) {
      siguiente(e);
    }
  });

  api.get('/programas/:folio', async (req, res, siguiente) => {
    try {
      const p = await repo.leerPrograma(req.params.folio);
      if (!p) return res.status(404).json({ error: `Ticket ${req.params.folio} does not exist.` });
      res.json(p);
    } catch (e) {
      siguiente(e);
    }
  });

  api.delete('/programas/:folio', exigirEscritura, async (req, res, siguiente) => {
    try {
      const borrado = await repo.borrarPrograma(req.params.folio);
      if (!borrado) {
        return res.status(404).json({ error: `Ticket ${req.params.folio} does not exist.` });
      }
      res.json(borrado);
    } catch (e) {
      siguiente(e);
    }
  });

  api.post('/programas/:folio/movimientos/:id', async (req, res, siguiente) => {
    try {
      const m = await repo.marcarMovimiento(
        req.params.folio,
        Number(req.params.id),
        Boolean(req.body?.aceptado),
      );
      if (!m) return res.status(404).json({ error: 'That move does not exist.' });
      res.json(m);
    } catch (e) {
      siguiente(e);
    }
  });

  /* ---------- Matriz de rendimiento ---------- */

  api.get('/programas/:folio/rendimiento', async (req, res, siguiente) => {
    try {
      const p = await repo.leerPrograma(req.params.folio);
      if (!p) return res.status(404).json({ error: `Ticket ${req.params.folio} does not exist.` });
      const { catalogoLineas } = await import('../servicio/analisis.js');
      const { TablaVelocidades } = await import('../motor/rendimiento.js');
      const { Programa, Orden } = await import('../motor/modelos.js');
      const lineas = catalogoLineas(p.supuestos);
      const tabla = new TablaVelocidades(puntosDelMotor(await repo.leerAjustes()), lineas);
      const programa = new Programa(p.detalleOrdenes.map((o) => new Orden(o)));
      res.json(matrizRendimiento(tabla, programa));
    } catch (e) {
      siguiente(e);
    }
  });

  return api;
}

/** Un archivo mal formado es error del usuario (400), no del servidor (500). */
export function manejadorDeErrores(err, _req, res, _siguiente) {
  // Por tipo, no por el texto del mensaje: el texto esta en ingles porque lo
  // lee el programador, y amarrar el ruteo al idioma ya rompio una vez.
  if (err instanceof ErrorDeDatos) return res.status(400).json({ error: err.message });
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'The file is over 10 MB.' });
  }
  console.error('[FLO]', err);
  res.status(500).json({ error: 'Internal module error.' });
}
