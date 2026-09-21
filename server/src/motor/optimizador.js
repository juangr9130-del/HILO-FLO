/**
 * Busqueda de areas de oportunidad en el production schedule.
 *
 * No reescribe el schedule por su cuenta: propone movimientos concretos
 * ("mueve estas ordenes de ITW-12 a ITW-13") con lo que cada uno gana, para
 * que el programador decida.
 *
 * Estrategia: busqueda local sobre el schedule que ya armo el programador.
 * En cada vuelta se prueban tres jugadas y se toma la mejor:
 *
 *   MOVER BLOQUE  pasar de golpe todas las ordenes de un diametro a otra
 *                 linea. Es la que mas rinde: el cambio de medida en el
 *                 destino se paga una sola vez y se reparte entre todo el
 *                 bloque, mientras que moviendo orden por orden la primera
 *                 carga con el cambio completo y casi nunca sale positiva.
 *   MOVER         pasar una sola orden a otra linea con receta.
 *   PERMUTAR      intercambiar dos ordenes entre sus lineas.
 */

import { compararLineas } from './modelos.js';
import { evaluarLinea, evaluarPrograma } from './programa.js';

/** Mejora minima (kg) para que valga la pena proponer un movimiento. */
export const UMBRAL_KG = 50;

/** Mejora minima (horas) cuando el movimiento no cambia la tonelada pero si
 *  libera capacidad. */
export const UMBRAL_HORAS = 0.5;

/**
 * El objetivo es lexicografico, en tres niveles:
 *
 *   1. la tonelada que sale dentro del horizonte          (PESO_KG)
 *   2. el cierre del programa, o sea la linea mas cargada (PESO_MAKESPAN)
 *   3. las horas-linea totales                            (peso 1)
 *
 * El nivel 2 es el que balancea. Sin el, la busqueda vacia las lineas lentas
 * hacia las rapidas y deja a las primeras ociosas: baja las horas totales
 * pero el programa sigue cerrando cuando termina la linea mas cargada, asi
 * que no se produce ni un kilo mas. Lo que de verdad destraba la produccion
 * es que el material que sale de una linea lo levante otra, y eso es
 * exactamente lo que premia minimizar la linea mas cargada.
 */
export const PESO_KG = 1000;
export const PESO_MAKESPAN = 100;

/**
 * Varias ordenes del mismo diametro que van de la misma linea a la misma.
 * El programador no mueve rollos de uno en uno: le sirve mas leer "pasa las
 * 13 ordenes de 17.50 mm de ITW-12 a ITW-13" que trece renglones iguales.
 */
export class MovimientoAgrupado {
  constructor({ origen, destino, diametroMm, ordenes, horasOrigen, horasDestino }) {
    this.origen = origen;
    this.destino = destino;
    this.diametroMm = diametroMm;
    this.ordenes = ordenes;
    this.horasOrigen = horasOrigen;
    this.horasDestino = horasDestino;
  }

  get kilogramos() {
    return this.ordenes.reduce((t, o) => t + o.kilogramos, 0);
  }

  /** Horas de corrida que se ahorran. Negativo = el movimiento cuesta horas,
   *  y se justifica por la tonelada que destraba en el origen. */
  get horasLiberadas() {
    return this.horasOrigen - this.horasDestino;
  }

  get folios() {
    return this.ordenes.map((o) => o.id);
  }

  describir() {
    const n = this.ordenes.length;
    const plural = n === 1 ? 'orden' : 'ordenes';
    const h = this.horasLiberadas;
    let efecto;
    if (h >= 0.05) efecto = `ahorra ${h.toFixed(1)} h de corrida`;
    else if (h <= -0.05)
      efecto = `cuesta ${Math.abs(h).toFixed(1)} h de corrida, pero destraba ${this.origen}`;
    else efecto = 'mismo tiempo de corrida, reparte carga';
    return (
      `${this.origen} -> ${this.destino}: ${n} ${plural} de ` +
      `${this.diametroMm.toFixed(2)} mm (${Math.round(this.kilogramos).toLocaleString('es-MX')} kg). ${efecto}`
    );
  }
}

/** Resultado completo de la busqueda. */
export class Propuesta {
  constructor({
    programaOriginal,
    programaPropuesto,
    evaluacionOriginal,
    evaluacionPropuesta,
    tabla,
  }) {
    this.programaOriginal = programaOriginal;
    this.programaPropuesto = programaPropuesto;
    this.evaluacionOriginal = evaluacionOriginal;
    this.evaluacionPropuesta = evaluacionPropuesta;
    this.tabla = tabla;
  }

  get deltaKg() {
    return this.evaluacionPropuesta.kgProducibles - this.evaluacionOriginal.kgProducibles;
  }
  get deltaToneladas() {
    return this.deltaKg / 1000;
  }
  get makespanOriginal() {
    return this.evaluacionOriginal.makespan;
  }
  get makespanPropuesto() {
    return this.evaluacionPropuesta.makespan;
  }
  get cuelloDeBotella() {
    return this.evaluacionOriginal.lineaMasCargada;
  }

  /** Cuantas veces mas rapido cierra el programa reajustado. En el mismo
   *  tiempo de calendario que hoy ocupa la linea mas cargada, la planta saca
   *  este multiplo de la tonelada actual. */
  get factorDeProduccion() {
    return this.makespanPropuesto > 0 ? this.makespanOriginal / this.makespanPropuesto : 1;
  }

  /** Tonelada extra que cabe en el mismo calendario, al balancear. */
  get toneladasPorBalanceo() {
    return (this.programaOriginal.kilogramos / 1000) * (this.factorDeProduccion - 1);
  }

  get horasLiberadas() {
    return this.evaluacionOriginal.horasRequeridas - this.evaluacionPropuesta.horasRequeridas;
  }

  /**
   * Los cambios NETOS entre el schedule original y el propuesto.
   *
   * Se saca del diff de los dos schedules y no de la bitacora de jugadas: la
   * busqueda local a veces mueve una orden y despues la regresa, y esos
   * viajes de ida y vuelta no le sirven de nada al programador.
   */
  agrupadas() {
    const destinoDe = new Map(this.programaPropuesto.ordenes.map((o) => [o.id, o.linea]));
    const indice = new Map();

    for (const orden of this.programaOriginal.ordenes) {
      const destino = destinoDe.get(orden.id);
      if (destino === undefined || destino === orden.linea) continue;
      const clave = `${orden.linea}|${destino}|${orden.diametroMm}`;
      let grupo = indice.get(clave);
      if (!grupo) {
        grupo = new MovimientoAgrupado({
          origen: orden.linea,
          destino,
          diametroMm: orden.diametroMm,
          ordenes: [],
          horasOrigen: 0,
          horasDestino: 0,
        });
        indice.set(clave, grupo);
      }
      grupo.ordenes.push(orden);
      grupo.horasOrigen += this._horas(orden.linea, orden);
      grupo.horasDestino += this._horas(destino, orden);
    }

    return [...indice.values()].sort(
      (a, b) => b.horasLiberadas - a.horasLiberadas || b.kilogramos - a.kilogramos,
    );
  }

  /** Horas de corrida de esa orden en esa linea (0 si no hay receta). */
  _horas(linea, orden) {
    const kgh = this.tabla.kgHora(linea, orden);
    return kgh ? orden.kilogramos / kgh : 0;
  }
}

// ---------------------------------------------------------------------------
// Estado con evaluacion incremental
// ---------------------------------------------------------------------------

/**
 * Asignacion linea -> secuencia de ordenes, con el valor de cada linea.
 *
 * De cada linea se guarda el par [kg producibles, horas requeridas]. El
 * puntaje que se maximiza es lexicografico segun los pesos de arriba.
 *
 * La evaluacion es incremental: un movimiento solo toca dos lineas, asi que
 * solo esas dos se vuelven a calcular. Sin eso, un schedule de ~500 ordenes
 * sobre 14 lineas no termina en tiempo util. El makespan es un maximo sobre
 * todas las lineas y no una suma, pero sale de recorrer un mapa de 15
 * entradas, que no cuesta nada.
 */
class Estado {
  constructor(programa, lineas, tabla) {
    this.lineas = new Map(lineas.map((l) => [l.clave, l]));
    this.tabla = tabla;
    this.asignacion = new Map(lineas.map((l) => [l.clave, programa.deLinea(l.clave)]));
    this.valor = new Map();
    for (const [clave, ordenes] of this.asignacion) {
      this.valor.set(clave, this._valor(clave, ordenes));
    }
  }

  _valor(clave, ordenes) {
    const r = evaluarLinea(this.lineas.get(clave), ordenes, this.tabla);
    return [r.kgProducibles, r.horasRequeridas];
  }

  static _puntaje(valor) {
    let kg = 0;
    let suma = 0;
    let max = 0;
    for (const [k, h] of valor.values()) {
      kg += k;
      suma += h;
      if (h > max) max = h;
    }
    return kg * PESO_KG - max * PESO_MAKESPAN - suma;
  }

  /** [puntaje, deltaKg, deltaHoras] de sustituir esas lineas. */
  _delta(claves, nuevos) {
    const candidato = new Map(this.valor);
    claves.forEach((clave, i) => candidato.set(clave, this._valor(clave, nuevos[i])));
    const puntaje = Estado._puntaje(candidato) - Estado._puntaje(this.valor);
    let deltaKg = 0;
    let deltaHoras = 0;
    for (const clave of claves) {
      deltaKg += candidato.get(clave)[0] - this.valor.get(clave)[0];
      deltaHoras += this.valor.get(clave)[1] - candidato.get(clave)[1];
    }
    return [puntaje, deltaKg, deltaHoras];
  }

  deltaMover(orden, destino) {
    const origen = orden.linea;
    const sinOrden = this.asignacion.get(origen).filter((o) => o.id !== orden.id);
    const conOrden = insertar(this.asignacion.get(destino), orden.moverA(destino));
    return [this._delta([origen, destino], [sinOrden, conOrden]), new Map([[origen, sinOrden], [destino, conOrden]])];
  }

  /** Pasa de golpe todas las ordenes de un diametro a otra linea. */
  deltaMoverBloque(ordenes, destino) {
    const origen = ordenes[0].linea;
    const ids = new Set(ordenes.map((o) => o.id));
    const sinBloque = this.asignacion.get(origen).filter((o) => !ids.has(o.id));
    let conBloque = this.asignacion.get(destino);
    for (const orden of ordenes) conBloque = insertar(conBloque, orden.moverA(destino));
    return [
      this._delta([origen, destino], [sinBloque, conBloque]),
      new Map([[origen, sinBloque], [destino, conBloque]]),
    ];
  }

  deltaPermutar(a, b) {
    const la = a.linea;
    const lb = b.linea;
    const nuevaA = insertar(this.asignacion.get(la).filter((o) => o.id !== a.id), b.moverA(la));
    const nuevaB = insertar(this.asignacion.get(lb).filter((o) => o.id !== b.id), a.moverA(lb));
    return [this._delta([la, lb], [nuevaA, nuevaB]), new Map([[la, nuevaA], [lb, nuevaB]])];
  }

  /** Las ordenes movibles de cada linea, agrupadas por diametro. */
  bloques() {
    const grupos = [];
    for (const ordenes of this.asignacion.values()) {
      const porDiametro = new Map();
      for (const orden of ordenes) {
        if (orden.fijo) continue;
        if (!porDiametro.has(orden.diametroMm)) porDiametro.set(orden.diametroMm, []);
        porDiametro.get(orden.diametroMm).push(orden);
      }
      grupos.push(...porDiametro.values());
    }
    return grupos;
  }

  /** Lineas que no alcanzan a sacar todo lo que tienen programado. */
  saturadas() {
    const saturadas = new Set();
    for (const [clave, ordenes] of this.asignacion) {
      const r = evaluarLinea(this.lineas.get(clave), ordenes, this.tabla);
      if (r.horasSobregiro > 0 || r.sinReceta.length) saturadas.add(clave);
    }
    return saturadas;
  }

  aplicar(clave, ordenes) {
    this.asignacion.set(clave, resecuenciar(ordenes));
    this.valor.set(clave, this._valor(clave, this.asignacion.get(clave)));
  }

  aPrograma(programa) {
    return programa.reemplazar([...this.asignacion.values()].flat());
  }
}

/** Mete la orden junto a las del mismo diametro para no pagar un cambio de
 *  medida de mas; si no hay, la deja al final. */
function insertar(ordenes, nueva) {
  let posicion = ordenes.length;
  for (let i = ordenes.length - 1; i >= 0; i--) {
    if (ordenes[i].diametroMm === nueva.diametroMm) {
      posicion = i + 1;
      break;
    }
  }
  return [...ordenes.slice(0, posicion), nueva, ...ordenes.slice(posicion)];
}

function resecuenciar(ordenes) {
  return ordenes.map((o, i) => o.moverA(o.linea, i + 1));
}

// ---------------------------------------------------------------------------
// Busqueda
// ---------------------------------------------------------------------------

/** Busca reasignaciones de ordenes que aumenten la produccion del horizonte. */
export function buscarOportunidades(
  programa,
  lineas,
  tabla,
  { maxMovimientos = 400, permitirPermutas = true, umbralKg = UMBRAL_KG, umbralHoras = UMBRAL_HORAS } = {},
) {
  const evaluacionInicial = evaluarPrograma(programa, lineas, tabla);
  const estado = new Estado(programa, lineas, tabla);
  const destinosValidos = new Set(lineas.filter((l) => l.activa).map((l) => l.clave));

  for (let i = 0; i < maxMovimientos; i++) {
    const mejor = mejorJugada(estado, destinosValidos, umbralKg, umbralHoras, permitirPermutas);
    if (!mejor) break;
    for (const [clave, ordenes] of mejor) estado.aplicar(clave, ordenes);
  }

  const propuesto = estado.aPrograma(programa);
  return new Propuesta({
    programaOriginal: programa,
    programaPropuesto: propuesto,
    evaluacionOriginal: evaluacionInicial,
    evaluacionPropuesta: evaluarPrograma(propuesto, lineas, tabla),
    tabla,
  });
}

/** La jugada que mas sube el puntaje, o null si ninguna vale la pena. */
function mejorJugada(estado, destinosValidos, umbralKg, umbralHoras, permitirPermutas) {
  let mejorPuntaje = Math.min(umbralKg * PESO_KG, umbralHoras);
  let mejor = null;

  const movibles = [...estado.asignacion.values()].flat().filter((o) => !o.fijo);

  // Jugada 1: mover de golpe todas las ordenes de un diametro.
  for (const bloque of estado.bloques()) {
    if (bloque.length < 2) continue; // de una sola se encarga la jugada 2
    for (const destino of estado.tabla.lineasPara(bloque[0])) {
      if (destino === bloque[0].linea || !destinosValidos.has(destino)) continue;
      const [[puntaje], cambios] = estado.deltaMoverBloque(bloque, destino);
      if (puntaje > mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = cambios;
      }
    }
  }

  // Jugada 2: mover una sola orden.
  for (const orden of movibles) {
    for (const destino of estado.tabla.lineasPara(orden)) {
      if (destino === orden.linea || !destinosValidos.has(destino)) continue;
      const [[puntaje], cambios] = estado.deltaMover(orden, destino);
      if (puntaje > mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = cambios;
      }
    }
  }

  // Jugada 3: permutar dos ordenes. Solo se explora desde las lineas
  // saturadas, que es donde estan los kilos que se quedan fuera del
  // horizonte; barrer todos los pares seria cuadratico sobre ~500 ordenes.
  if (permitirPermutas) {
    const saturadas = estado.saturadas();
    if (saturadas.size) {
      for (const a of movibles.filter((o) => saturadas.has(o.linea))) {
        for (const b of movibles) {
          if (a.linea === b.linea || a.id === b.id) continue;
          if (a.diametroMm === b.diametroMm) continue; // permutar iguales no cambia nada
          if (!estado.tabla.puedeCorrer(b.linea, a)) continue;
          if (!estado.tabla.puedeCorrer(a.linea, b)) continue;
          const [[puntaje], cambios] = estado.deltaPermutar(a, b);
          if (puntaje > mejorPuntaje) {
            mejorPuntaje = puntaje;
            mejor = cambios;
          }
        }
      }
    }
  }

  return mejor;
}

export { compararLineas };
