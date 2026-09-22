/**
 * Las reglas del reajuste, como catalogo editable.
 *
 * Igual que las velocidades: viven DENTRO del programa y el programador las
 * cambia desde la pantalla, sin que nadie toque codigo. Antes estaban
 * clavadas en SUPUESTOS y cada vez que Florence queria probar otro valor
 * habia que recompilar.
 *
 * Cada regla trae su explicacion porque el que la mueve no es quien la
 * escribio: si no dice que compra y que cuesta, se mueve a ciegas.
 */

import { SUPUESTOS } from './analisis.js';

/** @type {{clave: string, etiqueta: string, ayuda: string, tipo: string}[]} */
export const REGLAS = [
  {
    clave: 'objetivo',
    etiqueta: 'What the rebalance optimizes',
    tipo: 'opcion',
    opciones: [
      { valor: 'rendimiento', etiqueta: 'Throughput — same tons in fewer line hours' },
      { valor: 'calendario', etiqueta: 'Calendar — finish the program earlier' },
    ],
    ayuda:
      'Throughput never moves a coil to a line that runs it slower, but the program ' +
      'does not finish earlier. Calendar evens out the lines so the program closes ' +
      'sooner, and to do that it sometimes runs material slower. You cannot have both.',
  },
  {
    clave: 'topeOrdenes',
    etiqueta: 'Most a line may change',
    unidad: 'coils',
    tipo: 'numero',
    min: 1,
    max: 200,
    entero: true,
    ayuda:
      'How far a line may drift from what you scheduled. Lower means fewer coils to ' +
      'review and an easier change to defend; higher finds more. Without it the ' +
      'search empties the slow lines. Only applies to the throughput objective.',
  },
  {
    clave: 'horasDisponibles',
    etiqueta: 'Hours available per line',
    unidad: 'h',
    tipo: 'numero',
    min: 1,
    max: 336,
    ayuda:
      'The horizon: past this, a line stops producing. 144 h is 6 days × 24 h and is ' +
      'a placeholder — nobody has measured it per line yet, so treat it with care.',
  },
  {
    clave: 'minutosCambio',
    etiqueta: 'Size changeover',
    unidad: 'min',
    tipo: 'numero',
    min: 0,
    max: 480,
    ayuda:
      'Charged whenever the diameter changes between two consecutive orders on a line. ' +
      'The result barely moves between 0 and 90 min, so this is not a sensitive number.',
  },
  {
    clave: 'eficiencia',
    etiqueta: 'Operating efficiency',
    tipo: 'numero',
    min: 0.1,
    max: 1,
    paso: 0.01,
    ayuda:
      'Turned off (1.00) on purpose: for now the analysis runs against recipe speed as ' +
      'it is. Lower it once there is a measured OEE and every kg/h drops accordingly.',
  },
  {
    clave: 'itw15Activa',
    etiqueta: 'ITW-15 is installed',
    tipo: 'bandera',
    ayuda:
      'ITW-15 is not installed yet, so it is excluded. Turn it on to see what the ' +
      'program would look like with it running.',
  },
];

const PORCLAVE = new Map(REGLAS.map((r) => [r.clave, r]));

/**
 * Motivo por el que un valor no se acepta, o null si esta bien.
 *
 * Se revisa en los dos lados: la pantalla para avisar mientras se escribe, y
 * el servicio antes de guardar. Una pantalla no es una validacion.
 */
export function revisarRegla(clave, valor) {
  const r = PORCLAVE.get(clave);
  if (!r) return 'that rule does not exist';

  if (r.tipo === 'opcion') {
    return r.opciones.some((o) => o.valor === valor) ? null : 'that is not one of the options';
  }
  if (r.tipo === 'bandera') {
    return typeof valor === 'boolean' ? null : 'that has to be yes or no';
  }

  const v = Number(valor);
  if (!Number.isFinite(v)) return 'that has to be a number';
  if (r.entero && !Number.isInteger(v)) return 'that has to be a whole number';
  if (v < r.min || v > r.max) return `that is out of range (${r.min} to ${r.max})`;
  return null;
}

/**
 * Los supuestos con que se corre, ya con lo que el programador cambio.
 *
 * Un valor guardado que ya no pasa la revision se IGNORA en vez de tumbar el
 * analisis: puede venir de una version anterior con otro rango.
 */
export function reglasVigentes(guardadas = {}) {
  const vigentes = { ...SUPUESTOS };
  for (const [clave, valor] of Object.entries(guardadas ?? {})) {
    if (!PORCLAVE.has(clave)) continue;
    if (revisarRegla(clave, valor)) continue;
    vigentes[clave] = PORCLAVE.get(clave).tipo === 'numero' ? Number(valor) : valor;
  }
  return vigentes;
}

/** Lo que pinta la pantalla: cada regla con su valor y si esta cambiada. */
export function reglasParaPantalla(guardadas = {}) {
  const vigentes = reglasVigentes(guardadas);
  return REGLAS.map((r) => ({
    ...r,
    valor: vigentes[r.clave] ?? SUPUESTOS[r.clave],
    predeterminado: SUPUESTOS[r.clave],
    cambiada: vigentes[r.clave] !== SUPUESTOS[r.clave],
  }));
}

/** Cuantas reglas se apartaron del valor de fabrica. */
export function resumenReglas(guardadas = {}) {
  return reglasParaPantalla(guardadas).filter((r) => r.cambiada).length;
}
