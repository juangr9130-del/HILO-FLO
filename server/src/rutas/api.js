/** API del modulo HILO-FLO. */

import { Router } from 'express';
import multer from 'multer';

import { config, hayBaseDeDatos } from '../config.js';
import { exigirAcceso, exigirEscritura, hayAutenticacion } from '../auth.js';
import { analizar, empaquetar, matrizRendimiento } from '../servicio/analisis.js';
import { ErrorDeDatos } from '../errores.js';
import { reglasParaPantalla, reglasVigentes, revisarRegla } from '../servicio/reglas.js';
import { rangosParaPantalla, revisarRango } from '../catalogo/rangos.js';
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

  /* ---------- Reglas del reajuste ---------- */

  // Viven en la base, no en el codigo: el programador las cambia desde su
  // pantalla y el siguiente analisis las usa.

  api.get('/reglas', async (req, res, siguiente) => {
    try {
      res.json(reglasParaPantalla(await repo.leerReglas()));
    } catch (e) {
      siguiente(e);
    }
  });

  api.put('/reglas/:clave', exigirEscritura, async (req, res, siguiente) => {
    try {
      const { clave } = req.params;
      const valor = req.body?.valor;
      const motivo = revisarRegla(clave, valor);
      if (motivo) return res.status(400).json({ error: `Not saved: ${motivo}.` });
      res.json(await repo.guardarRegla(clave, valor, req.usuario?.numeroEmpleado ?? null));
    } catch (e) {
      siguiente(e);
    }
  });

  api.delete('/reglas/:clave', exigirEscritura, async (req, res, siguiente) => {
    try {
      const quitada = await repo.quitarRegla(req.params.clave);
      if (!quitada) return res.status(404).json({ error: 'That rule is already at its default.' });
      res.json(quitada);
    } catch (e) {
      siguiente(e);
    }
  });

  /* ---------- Rango de diametros por linea ---------- */

  api.get('/rangos', async (req, res, siguiente) => {
    try {
      res.json(rangosParaPantalla(await repo.leerRangos()));
    } catch (e) {
      siguiente(e);
    }
  });

  api.put('/rangos/:linea', exigirEscritura, async (req, res, siguiente) => {
    try {
      const rango = [Number(req.body?.min), Number(req.body?.max)];
      const motivo = revisarRango(rango);
      if (motivo) return res.status(400).json({ error: `Not saved: ${motivo}.` });
      const guardado = await repo.guardarRango(
        req.params.linea,
        rango,
        req.usuario?.numeroEmpleado ?? null,
      );
      if (!guardado) return res.status(404).json({ error: 'That line is not in the catalog.' });
      res.json(guardado);
    } catch (e) {
      siguiente(e);
    }
  });

  api.delete('/rangos/:linea', exigirEscritura, async (req, res, siguiente) => {
    try {
      const quitado = await repo.quitarRango(req.params.linea);
      if (!quitado) return res.status(404).json({ error: 'That line is already at its default.' });
      res.json(quitado);
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

      // Las reglas que el programador dejo guardadas mandan sobre la
      // configuracion del proceso; el cuerpo de la peticion solo sobre ellas.
      const supuestos = reglasVigentes(await repo.leerReglas());
      supuestos.rangos = await repo.leerRangos();
      if (req.body.horas) supuestos.horasDisponibles = Number(req.body.horas);
      if (req.body.eficiencia) supuestos.eficiencia = Number(req.body.eficiencia);
      if (req.body.minutosCambio) supuestos.minutosCambio = Number(req.body.minutosCambio);
      if (req.body.itw15) supuestos.itw15Activa = req.body.itw15 === 'true';

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

  /**
   * Volver a correr un folio con las reglas de hoy.
   *
   * Sale un folio NUEVO y el anterior se queda: son dos analisis con reglas
   * distintas, y poder compararlos es justo lo que se quiere. No hace falta
   * volver a subir el Excel porque el folio guarda sus ordenes.
   */
  api.post('/programas/:folio/reanalizar', exigirEscritura, async (req, res, siguiente) => {
    try {
      const previo = await repo.leerPrograma(req.params.folio);
      if (!previo) return res.status(404).json({ error: `Ticket ${req.params.folio} does not exist.` });

      const { Programa, Orden } = await import('../motor/modelos.js');
      const supuestos = reglasVigentes(await repo.leerReglas());
      supuestos.rangos = await repo.leerRangos();
      const programa = new Programa(previo.detalleOrdenes.map((o) => new Orden(o)));
      const paquete = empaquetar({
        folio: await repo.siguienteFolio(),
        archivo: previo.archivo,
        cargadoPor: req.usuario?.numeroEmpleado ?? null,
        supuestos,
        ...analizar(programa, puntosDelMotor(await repo.leerAjustes()), supuestos),
      });

      await repo.guardarPrograma(paquete);
      res.status(201).json(paquete);
    } catch (e) {
      siguiente(e);
    }
  });

  /* ---------- Exportar a Excel ---------- */

  /**
   * El schedule reajustado, para mandarlo por correo.
   *
   * El estado de cada consejo (aceptado / no aplica) vive en la base, no en
   * el paquete guardado, asi que se vuelve a pegar aqui antes de exportar:
   * el archivo tiene que reflejar lo que el programador decidio, aunque haya
   * decidido despues de que se guardo el folio.
   */
  api.get('/programas/:folio/excel', async (req, res, siguiente) => {
    try {
      const p = await repo.leerPrograma(req.params.folio);
      if (!p) return res.status(404).json({ error: `Ticket ${req.params.folio} does not exist.` });

      const decisiones = await repo.leerMovimientos?.(req.params.folio);
      if (decisiones) {
        for (const m of p.analisis.movimientos) {
          if (decisiones.has(m.id)) m.aceptado = decisiones.get(m.id);
        }
      }

      const { exportarPrograma, nombreArchivo } = await import('../servicio/exportar.js');
      const bytes = exportarPrograma(p);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(p)}"`);
      res.send(Buffer.from(bytes));
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
