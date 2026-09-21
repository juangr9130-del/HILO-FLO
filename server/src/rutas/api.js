/** API del modulo HILO-FLO. */

import { Router } from 'express';
import multer from 'multer';

import { config, hayBaseDeDatos } from '../config.js';
import { exigirAcceso, exigirEscritura, hayAutenticacion } from '../auth.js';
import {
  ErrorDeDatos,
  analizar,
  empaquetar,
  matrizRendimiento,
  puntosDesdeFilas,
} from '../servicio/analisis.js';
import { leerPrograma, leerVelocidades } from '../ingesta/servidor.js';

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

  /* ---------- Recetas (el WI de parametros de proceso) ---------- */

  api.post('/recetas', exigirEscritura, subida.single('archivo'), async (req, res, siguiente) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Falta el archivo del WI.' });
      const puntos = await leerVelocidades(req.file.buffer);
      const guardado = await repo.guardarVelocidades({
        puntos,
        documento: 'WI-FLO-CSW-P-526',
        archivo: req.file.originalname,
      });
      res.json({
        recetas: puntos.length,
        lineas: [...new Set(puntos.map((p) => p.linea))].length,
        diametros: [...new Set(puntos.map((p) => p.diametroMm))].length,
        cargadoEn: guardado.cargadoEn,
      });
    } catch (e) {
      siguiente(e);
    }
  });

  api.get('/recetas', async (req, res, siguiente) => {
    try {
      const v = await repo.leerVelocidades();
      if (!v) return res.status(404).json({ error: 'Todavia no se ha cargado el WI de recetas.' });
      const puntos = v.puntos ?? puntosDesdeFilas(v.filas);
      res.json({
        recetas: puntos.length,
        documento: v.documento ?? 'WI-FLO-CSW-P-526',
        cargadoEn: v.cargadoEn ?? null,
        lineas: [...new Set(puntos.map((p) => p.linea))],
      });
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
      if (!req.file) return res.status(400).json({ error: 'Falta el archivo del schedule.' });

      const guardadas = await repo.leerVelocidades();
      if (!guardadas) {
        return res.status(409).json({
          error: 'Primero hay que cargar el WI de recetas: sin velocidades no se puede calcular nada.',
        });
      }
      const puntos = guardadas.puntos ?? puntosDesdeFilas(guardadas.filas);

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
      if (!p) return res.status(404).json({ error: `No existe el folio ${req.params.folio}.` });
      res.json(p);
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
      if (!m) return res.status(404).json({ error: 'No existe ese movimiento.' });
      res.json(m);
    } catch (e) {
      siguiente(e);
    }
  });

  /* ---------- Matriz de rendimiento ---------- */

  api.get('/programas/:folio/rendimiento', async (req, res, siguiente) => {
    try {
      const p = await repo.leerPrograma(req.params.folio);
      if (!p) return res.status(404).json({ error: `No existe el folio ${req.params.folio}.` });
      const guardadas = await repo.leerVelocidades();
      const puntos = guardadas.puntos ?? puntosDesdeFilas(guardadas.filas);
      const { catalogoLineas } = await import('../servicio/analisis.js');
      const { TablaVelocidades } = await import('../motor/rendimiento.js');
      const { Programa, Orden } = await import('../motor/modelos.js');
      const lineas = catalogoLineas(p.supuestos);
      const tabla = new TablaVelocidades(puntos, lineas);
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
  const esDeDatos =
    err instanceof ErrorDeDatos ||
    /no se leyo ninguna orden|no se encontro ninguna velocidad|columnas obligatorias|hoja legible/.test(
      err.message ?? '',
    );
  if (esDeDatos) return res.status(400).json({ error: err.message });
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo pasa de 10 MB.' });
  }
  console.error('[FLO]', err);
  res.status(500).json({ error: 'Error interno del modulo.' });
}
