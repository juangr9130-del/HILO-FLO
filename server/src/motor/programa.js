/**
 * Evaluacion del production schedule.
 *
 * Dado el schedule que armo el programador (que ordenes van en que linea y
 * en que orden), calcula por linea: horas de corrida, horas de cambio de
 * medida, utilizacion contra las horas disponibles y cuantos kilogramos
 * alcanzan a salir dentro del horizonte.
 */

import { compararLineas } from './modelos.js';
import { ErrorDeDatos } from '../errores.js';

/** Como le fue a una orden en la linea donde esta programada. */
export class Corrida {
  constructor(orden, kgHora, horasProduccion, horasCambio, kgProducibles) {
    this.orden = orden;
    this.kgHora = kgHora;
    this.horasProduccion = horasProduccion;
    this.horasCambio = horasCambio;
    this.kgProducibles = kgProducibles;
  }

  get completa() {
    return this.kgProducibles >= this.orden.kilogramos - 1e-6;
  }

  get sinReceta() {
    return this.kgHora === null;
  }
}

export class ResultadoLinea {
  constructor(linea, corridas = []) {
    this.linea = linea;
    this.corridas = corridas;
  }

  get kgProgramados() {
    return this.corridas.reduce((t, c) => t + c.orden.kilogramos, 0);
  }
  get kgProducibles() {
    return this.corridas.reduce((t, c) => t + c.kgProducibles, 0);
  }
  get horasProduccion() {
    return this.corridas.reduce((t, c) => t + c.horasProduccion, 0);
  }
  get horasCambio() {
    return this.corridas.reduce((t, c) => t + c.horasCambio, 0);
  }
  get horasRequeridas() {
    return this.horasProduccion + this.horasCambio;
  }
  get horasOciosas() {
    return Math.max(0, this.linea.horasDisponibles - this.horasRequeridas);
  }
  get horasSobregiro() {
    return Math.max(0, this.horasRequeridas - this.linea.horasDisponibles);
  }
  get utilizacion() {
    return this.linea.horasDisponibles > 0 ? this.horasRequeridas / this.linea.horasDisponibles : 0;
  }
  get cambios() {
    return this.corridas.filter((c) => c.horasCambio > 0).length;
  }
  get sinReceta() {
    return this.corridas.filter((c) => c.sinReceta).map((c) => c.orden);
  }
}

export class Evaluacion {
  constructor(lineas = new Map()) {
    this.lineas = lineas;
  }

  get kgProgramados() {
    return [...this.lineas.values()].reduce((t, r) => t + r.kgProgramados, 0);
  }
  get kgProducibles() {
    return [...this.lineas.values()].reduce((t, r) => t + r.kgProducibles, 0);
  }
  get toneladasProducibles() {
    return this.kgProducibles / 1000;
  }
  get kgNoProducibles() {
    return this.kgProgramados - this.kgProducibles;
  }
  get horasRequeridas() {
    return [...this.lineas.values()].reduce((t, r) => t + r.horasRequeridas, 0);
  }
  get horasOciosas() {
    return [...this.lineas.values()].reduce((t, r) => t + r.horasOciosas, 0);
  }
  get sinReceta() {
    return [...this.lineas.values()].flatMap((r) => r.sinReceta);
  }

  /** Horas de la linea mas cargada: cuando cierra el programa. */
  get makespan() {
    let max = 0;
    for (const r of this.lineas.values()) max = Math.max(max, r.horasRequeridas);
    return max;
  }

  /** La linea que define el cierre del programa. */
  get lineaMasCargada() {
    let clave = null;
    let max = -1;
    for (const [c, r] of this.lineas) {
      if (r.horasRequeridas > max) {
        max = r.horasRequeridas;
        clave = c;
      }
    }
    return clave;
  }

  clavesOrdenadas() {
    return [...this.lineas.keys()].sort(compararLineas);
  }
}

/** Corre la secuencia de la linea consumiendo sus horas disponibles. */
export function evaluarLinea(linea, ordenes, tabla) {
  const resultado = new ResultadoLinea(linea, []);
  let restantes = linea.horasDisponibles;
  let diametroPrevio = null;

  for (const orden of ordenes) {
    const kgh = tabla.kgHora(linea.clave, orden);
    if (kgh === null) {
      // La linea no tiene receta para ese diametro: se reporta aparte y no
      // consume horas.
      resultado.corridas.push(new Corrida(orden, null, 0, 0, 0));
      continue;
    }

    const cambia = diametroPrevio !== null && diametroPrevio !== orden.diametroMm;
    const horasCambio = cambia ? linea.minutosCambio / 60 : 0;
    const horasProduccion = orden.kilogramos / kgh;
    diametroPrevio = orden.diametroMm;

    // Cuanto alcanza a salir con las horas que quedan.
    const disponibles = Math.max(0, restantes - horasCambio);
    const kgProducibles = Math.min(orden.kilogramos, disponibles * kgh);
    restantes = Math.max(0, restantes - horasCambio - horasProduccion);

    resultado.corridas.push(new Corrida(orden, kgh, horasProduccion, horasCambio, kgProducibles));
  }

  return resultado;
}

/** Evalua el schedule completo, linea por linea. */
export function evaluarPrograma(programa, lineas, tabla) {
  const porClave = new Map(lineas.map((l) => [l.clave, l]));
  const desconocidas = programa.lineasUsadas().filter((l) => !porClave.has(l));
  if (desconocidas.length) {
    throw new ErrorDeDatos(
      `the schedule uses lines that are not in the catalog: ${desconocidas.join(', ')}`,
    );
  }

  const evaluacion = new Evaluacion(new Map());
  for (const linea of lineas) {
    evaluacion.lineas.set(linea.clave, evaluarLinea(linea, programa.deLinea(linea.clave), tabla));
  }
  return evaluacion;
}
