/**
 * El servicio: junta las recetas, el schedule y el algoritmo, y arma el
 * paquete que consume la pantalla de programacion.
 */

import { Linea, PuntoVelocidad, lineaAWorkCenter } from '../motor/modelos.js';
import { TablaVelocidades } from '../motor/rendimiento.js';
import { evaluarPrograma } from '../motor/programa.js';
import { buscarOportunidades } from '../motor/optimizador.js';
import { leerVelocidades } from '../ingesta/parametros.js';
import { leerPrograma } from '../ingesta/schedule.js';
import { config } from '../config.js';
import { reunirAvisos } from './avisos.js';

/** Las 14 lineas instaladas mas ITW-15, que esta por instalarse. */
export const LINEAS_INSTALADAS = Array.from({ length: 14 }, (_, i) => `ITW-${i + 1}`);
export const LINEA_POR_INSTALAR = 'ITW-15';

export function catalogoLineas({
  horasDisponibles = config.horasDisponibles,
  eficiencia = config.eficiencia,
  minutosCambio = config.minutosCambio,
  itw15Activa = false,
} = {}) {
  const lineas = LINEAS_INSTALADAS.map(
    (clave) => new Linea({ clave, horasDisponibles, eficiencia, minutosCambio }),
  );
  lineas.push(
    new Linea({
      clave: LINEA_POR_INSTALAR,
      horasDisponibles,
      eficiencia,
      minutosCambio,
      activa: itw15Activa,
    }),
  );
  return lineas;
}

/** Recetas guardadas -> objetos del motor. */
export function puntosDesdeFilas(filas) {
  return filas.map((f) => new PuntoVelocidad(f));
}

/**
 * Corre el analisis completo de un schedule.
 *
 * @param {Buffer} bufferSchedule  el .xlsx que subio el programador
 * @param {PuntoVelocidad[]} puntos  las recetas del WI
 * @param {object} supuestos  horas, eficiencia, minutos de cambio
 */
export async function analizar(bufferSchedule, puntos, supuestos = {}) {
  const lineas = catalogoLineas(supuestos);
  const tabla = new TablaVelocidades(puntos, lineas);
  const programa = await leerPrograma(bufferSchedule);

  const desconocidas = programa.lineasUsadas().filter(
    (l) => !lineas.some((x) => x.clave === l),
  );
  if (desconocidas.length) {
    throw new ErrorDeDatos(
      `el schedule trae work centers que no corresponden a ninguna linea ITW: ${desconocidas.join(', ')}`,
    );
  }

  const evaluacion = evaluarPrograma(programa, lineas, tabla);
  const propuesta = buscarOportunidades(programa, lineas, tabla, {
    maxMovimientos: config.maxMovimientos,
  });

  return { programa, lineas, tabla, evaluacion, propuesta };
}

/** Error de datos del archivo, no del servidor: se responde 400, no 500. */
export class ErrorDeDatos extends Error {}

/**
 * Arma el JSON que pinta la pantalla.
 *
 * Es deliberadamente "plano": la pantalla no vuelve a calcular nada, solo
 * dibuja. Asi el mismo paquete se puede guardar en flo_analisis y volver a
 * pintar identico meses despues.
 */
export function empaquetar({ folio, archivo, cargadoPor, programa, lineas, tabla, evaluacion, propuesta, supuestos }) {
  const ev2 = propuesta.evaluacionPropuesta;
  const lineaPropuestaDe = new Map(propuesta.programaPropuesto.ordenes.map((o) => [o.id, o.linea]));

  const detalleLineas = lineas.map((l) => {
    const a = evaluacion.lineas.get(l.clave);
    const b = ev2.lineas.get(l.clave);
    return {
      linea: l.clave,
      workCenter: lineaAWorkCenter(l.clave),
      activa: l.activa,
      horasDisponibles: l.horasDisponibles,
      actual: resumenLinea(a),
      propuesto: resumenLinea(b),
      corridas: a.corridas.map((c) => ({
        orden: c.orden.id,
        diametroMm: c.orden.diametroMm,
        kilogramos: c.orden.kilogramos,
        descripcion: c.orden.descripcion,
        kgHora: c.kgHora === null ? null : redondear(c.kgHora, 1),
        horas: redondear(c.horasProduccion, 2),
        horasCambio: redondear(c.horasCambio, 2),
        sinReceta: c.sinReceta,
        lineaPropuesta: lineaPropuestaDe.get(c.orden.id) ?? l.clave,
        movida: (lineaPropuestaDe.get(c.orden.id) ?? l.clave) !== l.clave,
      })),
    };
  });

  const movimientos = propuesta.agrupadas().map((g, i) => ({
    id: i + 1,
    origen: g.origen,
    destino: g.destino,
    diametroMm: g.diametroMm,
    ordenes: g.ordenes.length,
    kilogramos: redondear(g.kilogramos, 0),
    horasOrigen: redondear(g.horasOrigen, 2),
    horasDestino: redondear(g.horasDestino, 2),
    horasLiberadas: redondear(g.horasLiberadas, 2),
    folios: g.folios,
    consejo: g.describir(),
    aceptado: null,
  }));

  return {
    folio,
    archivo,
    cargadoPor: cargadoPor ?? null,
    cargadoEn: new Date().toISOString(),
    ordenes: programa.length,
    kilogramos: redondear(programa.kilogramos, 0),
    supuestos,
    recetas: tabla.size,
    analisis: {
      supuestos,
      makespanActual: redondear(propuesta.makespanOriginal, 2),
      makespanPropuesto: redondear(propuesta.makespanPropuesto, 2),
      cuelloDeBotella: propuesta.cuelloDeBotella,
      horasTotalesActual: redondear(evaluacion.horasRequeridas, 2),
      horasTotalesPropuesto: redondear(ev2.horasRequeridas, 2),
      factorProduccion: redondear(propuesta.factorDeProduccion, 3),
      toneladasActuales: redondear(programa.kilogramos / 1000, 1),
      toneladasIncremento: redondear(propuesta.toneladasPorBalanceo, 1),
      toneladasDentroDelHorizonte: redondear(propuesta.deltaToneladas, 2),
      ordenesMovidas: movimientos.reduce((t, m) => t + m.ordenes, 0),
      avisos: reunirAvisos(programa, lineas, tabla, evaluacion),
      sinReceta: evaluacion.sinReceta.map((o) => ({
        orden: o.id,
        linea: o.linea,
        diametroMm: o.diametroMm,
        kilogramos: o.kilogramos,
      })),
      lineas: detalleLineas.map(({ linea, actual, propuesto }) => ({ linea, actual, propuesto })),
      movimientos,
    },
    lineas: detalleLineas,
    detalleOrdenes: programa.ordenes.map((o) => ({
      ...o,
      lineaPropuesta: lineaPropuestaDe.get(o.id) ?? o.linea,
    })),
  };
}

function resumenLinea(r) {
  return {
    ordenes: r.corridas.length,
    kg: redondear(r.kgProgramados, 0),
    kgProducibles: redondear(r.kgProducibles, 0),
    horas: redondear(r.horasRequeridas, 2),
    horasProduccion: redondear(r.horasProduccion, 2),
    horasCambio: redondear(r.horasCambio, 2),
    cambios: r.cambios,
    utilizacion: redondear(r.utilizacion * 100, 1),
  };
}

function redondear(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/** Matriz diametro x linea con el kg/h de cada combinacion. */
export function matrizRendimiento(tabla, programa) {
  const representantes = new Map();
  for (const o of programa.ordenes) if (!representantes.has(o.diametroMm)) representantes.set(o.diametroMm, o);
  const lineas = tabla.lineas;

  const filas = [...representantes.keys()]
    .sort((a, b) => a - b)
    .map((diametroMm) => {
      const orden = representantes.get(diametroMm);
      const celdas = {};
      let mejorLinea = null;
      let mejorKgH = 0;
      for (const l of lineas) {
        const kgh = tabla.kgHora(l, orden);
        celdas[l] = kgh === null ? null : Math.round(kgh * 10) / 10;
        if (kgh && kgh > mejorKgH) {
          mejorKgH = kgh;
          mejorLinea = l;
        }
      }
      return { diametroMm, celdas, mejorLinea, mejorKgH: Math.round(mejorKgH * 10) / 10 };
    });

  return { lineas, filas };
}

export { leerVelocidades };
