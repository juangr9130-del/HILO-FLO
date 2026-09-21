/** Fabricas cortas para los tests. */
import { Linea, Orden, PuntoVelocidad, Programa } from '../src/motor/modelos.js';

export function linea(clave, extra = {}) {
  return new Linea({ clave, horasDisponibles: 100, ...extra });
}

export function orden(id, diametroMm, kilogramos, claveLinea, extra = {}) {
  return new Orden({ id, diametroMm, kilogramos, linea: claveLinea, secuencia: 1, ...extra });
}

export function punto(claveLinea, diametroMm, mmS, extra = {}) {
  return new PuntoVelocidad({ linea: claveLinea, diametroMm, mmS, ...extra });
}

export function programa(ordenes) {
  return new Programa(ordenes);
}
