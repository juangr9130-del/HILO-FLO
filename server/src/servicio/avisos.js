/**
 * Avisos del analisis: lo que el programador tiene que saber del archivo que
 * subio, aunque no impida calcular.
 *
 * Cada aviso trae su impacto cuantificado. Un aviso que solo dice "ojo con
 * esto" se ignora a la tercera vez; uno que dice "esto te cuesta 35 horas de
 * cierre" se atiende.
 */

import { Orden, Programa, WINDER_ALTERNO, WINDER_PREDETERMINADO } from '../motor/modelos.js';
import { evaluarPrograma } from '../motor/programa.js';

/**
 * Ordenes que corren en una linea cuya receta depende del devanador, pero
 * cuyo schedule no anoto cual se uso.
 *
 * Se calcularon con el deber ser (DEM). El aviso dice cuanto se recorreria
 * el cierre del programa si en realidad hubieran corrido con el otro.
 */
export function avisoDevanador(programa, lineas, tabla, evaluacion) {
  const dependeDelDevanador = new Set(
    tabla.puntos.filter((p) => p.winder !== null).map((p) => p.linea),
  );

  const sinAnotar = programa.ordenes.filter(
    (o) => o.winder === null && dependeDelDevanador.has(o.linea),
  );
  if (!sinAnotar.length) return null;

  // Que pasaria si de verdad hubieran corrido con el otro devanador.
  const ids = new Set(sinAnotar.map((o) => o.id));
  const alterno = programa.reemplazar(
    programa.ordenes.map((o) => (ids.has(o.id) ? new Orden({ ...o, winder: WINDER_ALTERNO }) : o)),
  );
  const evAlterno = evaluarPrograma(alterno, lineas, tabla);

  const porLinea = new Map();
  for (const o of sinAnotar) {
    const g = porLinea.get(o.linea) ?? { ordenes: 0, kilogramos: 0 };
    g.ordenes += 1;
    g.kilogramos += o.kilogramos;
    porLinea.set(o.linea, g);
  }

  return {
    tipo: 'devanador_no_indicado',
    severidad: 'nota',
    ordenes: sinAnotar.length,
    kilogramos: Math.round(sinAnotar.reduce((t, o) => t + o.kilogramos, 0)),
    asumido: WINDER_PREDETERMINADO,
    alterno: WINDER_ALTERNO,
    lineas: [...porLinea].map(([linea, g]) => ({ linea, ...g })),
    folios: sinAnotar.slice(0, 20).map((o) => o.id),
    cierreAsumido: redondear(evaluacion.makespan, 2),
    cierreSiAlterno: redondear(evAlterno.makespan, 2),
    horasDeMas: redondear(evAlterno.horasRequeridas - evaluacion.horasRequeridas, 2),
    mensaje:
      `${sinAnotar.length} órdenes no traen anotado el devanador en las notas del schedule. ` +
      `Se calcularon con ${WINDER_PREDETERMINADO}, que es el deber ser. ` +
      `Si en realidad corrieron con ${WINDER_ALTERNO}, el programa no cierra en ` +
      `${redondear(evaluacion.makespan, 1)} h sino en ${redondear(evAlterno.makespan, 1)} h.`,
  };
}

/** Ordenes programadas en una linea que no tiene receta para ese diametro. */
export function avisoSinReceta(evaluacion) {
  const sinReceta = evaluacion.sinReceta;
  if (!sinReceta.length) return null;
  return {
    tipo: 'sin_receta',
    severidad: 'error',
    ordenes: sinReceta.length,
    kilogramos: Math.round(sinReceta.reduce((t, o) => t + o.kilogramos, 0)),
    detalle: sinReceta.map((o) => ({
      orden: o.id,
      linea: o.linea,
      diametroMm: o.diametroMm,
      kilogramos: o.kilogramos,
    })),
    mensaje:
      `${sinReceta.length} órdenes están en una línea que no tiene receta para ese diámetro. ` +
      'No se les puede calcular tiempo ni rendimiento, así que quedan fuera de todos los totales.',
  };
}

/** Todos los avisos aplicables, de mayor a menor severidad. */
export function reunirAvisos(programa, lineas, tabla, evaluacion) {
  const orden = { error: 0, nota: 1 };
  return [avisoSinReceta(evaluacion), avisoDevanador(programa, lineas, tabla, evaluacion)]
    .filter(Boolean)
    .sort((a, b) => orden[a.severidad] - orden[b.severidad]);
}

function redondear(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
