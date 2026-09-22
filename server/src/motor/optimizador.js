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
 * Hay DOS objetivos posibles y no se puede tener los dos. Se eligen con
 * `objetivo` (ver docs/SUPUESTOS.md, seccion 2d-E).
 *
 * CALENDARIO -- lexicografico en tres niveles:
 *
 *   1. la tonelada que sale dentro del horizonte          (PESO_KG)
 *   2. el cierre del programa, o sea la linea mas cargada (PESO_MAKESPAN)
 *   3. las horas-linea totales                            (peso 1)
 *
 * El nivel 2 es el que balancea, y es el que cierra el programa antes. Su
 * costo: para emparejar hay que mandar material a lineas MAS LENTAS. Sobre
 * el schedule del 17/09, 4 de 19 movimientos lo hacen, el peor de 849 a 525
 * kg/h. No es un error, es el objetivo funcionando.
 *
 * RENDIMIENTO -- dos niveles:
 *
 *   1. la tonelada que sale dentro del horizonte          (PESO_KG)
 *   2. las horas-linea totales                            (peso 1)
 *
 * Sin el makespan, la busqueda solo acepta un movimiento si la misma
 * tonelada sale en menos horas de maquina. Nunca degrada material. A cambio
 * no empareja, asi que el programa no cierra antes.
 *
 * Sin frenos ese objetivo vacia las lineas lentas: sobre el 17/09 dejaba
 * ITW-3 con UN rollo y 2.8 h. Por eso RENDIMIENTO viene con dos limites
 * (ver `Limites`), sin los cuales no se debe usar.
 */
export const PESO_KG = 1000;
export const PESO_MAKESPAN = 100;
export const OBJETIVOS = ['rendimiento', 'calendario'];

/**
 * Los dos limites del objetivo de rendimiento.
 *
 * TECHO: ninguna linea recibe mas alla de lo que la mas cargada YA corre en
 * el programa original. No es un supuesto: si hoy ITW-2 corre 129.6 h, esas
 * horas son demostrablemente factibles. Se usa esto y no las 144 h del
 * horizonte porque Florence confirmo que ese 144 es un relleno -- se puso
 * porque no habia forma de ver las horas por linea, no porque se haya medido.
 *
 * PISO: ninguna linea baja de estas horas de trabajo. Una linea con dos
 * rollos esta apagada en los hechos, y eso no se puede proponer. El numero
 * lo da planta; 60 h es lo que eligio Florence para probar.
 */
export class Limites {
  constructor({ techo = Infinity, topeOrdenes = Infinity } = {}) {
    this.techo = techo;
    this.topeOrdenes = topeOrdenes;
  }

  /**
   * Cuanto se puede apartar una linea de las ordenes que traia.
   *
   * Es el limite en las unidades del programador: "que ninguna linea cambie
   * mas de N rollos respecto a lo que yo programe". Reemplaza a un piso en
   * horas que hubo antes: se midio que con un tope de 5 el piso ya no
   * cambiaba nada -- una linea que no puede perder mas de 5 rollos no se
   * queda vacia sola -- y ademas el rollo es la unidad en la que el
   * programador piensa.
   */
  aguantaCarga(ordenesAntes, ordenesDespues) {
    return Math.abs(ordenesDespues - ordenesAntes) <= this.topeOrdenes;
  }

  /**
   * @param {number} horasDestino horas de la linea que recibe material
   * @param {number} deltaKg      tonelada que el movimiento rescata
   */
  permite(horasDestino, deltaKg) {
    // Rescatar tonelada que hoy no se produce gana sobre el techo: correr
    // algo tarde es mejor que no correrlo.
    if (deltaKg > 1e-6) return true;
    return horasDestino <= this.techo + 1e-6;
  }
}

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

  /** El texto va en ingles: lo lee el programador de Florence. */
  describir() {
    const n = this.ordenes.length;
    const plural = n === 1 ? 'order' : 'orders';
    const h = this.horasLiberadas;
    let efecto;
    if (h >= 0.05) efecto = `saves ${h.toFixed(1)} h of run time`;
    else if (h <= -0.05)
      efecto = `costs ${Math.abs(h).toFixed(1)} h of run time, but unblocks ${this.origen}`;
    else efecto = 'same run time, spreads the load';
    return (
      `${this.origen} -> ${this.destino}: ${n} ${plural} of ` +
      `${this.diametroMm.toFixed(2)} mm (${Math.round(this.kilogramos).toLocaleString('en-US')} kg). ${efecto}`
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
    objetivo = 'calendario',
    limites = new Limites(),
  }) {
    this.programaOriginal = programaOriginal;
    this.programaPropuesto = programaPropuesto;
    this.evaluacionOriginal = evaluacionOriginal;
    this.evaluacionPropuesta = evaluacionPropuesta;
    this.tabla = tabla;
    this.objetivo = objetivo;
    this.limites = limites;
  }

  /**
   * Las lineas que se toparon con el limite de rollos.
   *
   * Ahi habia material que corria mas rapido en otro lado, pero moverlo
   * apartaba la linea mas de lo permitido respecto de lo que el programador
   * escribio. Tiene que verlo: es decision suya y no del algoritmo, y si esa
   * semana esa linea si aguanta mas cambio, sube el tope y se queda con la
   * mejora.
   */
  lineasEnElTope() {
    if (!Number.isFinite(this.limites.topeOrdenes)) return [];
    const topadas = [];
    for (const [clave, r] of this.evaluacionPropuesta.lineas) {
      const antes = this.evaluacionOriginal.lineas.get(clave);
      if (!antes) continue;
      if (Math.abs(r.corridas.length - antes.corridas.length) >= this.limites.topeOrdenes) {
        topadas.push(clave);
      }
    }
    return topadas;
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
  constructor(programa, lineas, tabla, { objetivo = 'calendario', limites = new Limites() } = {}) {
    this.lineas = new Map(lineas.map((l) => [l.clave, l]));
    this.tabla = tabla;
    this.objetivo = objetivo;
    this.limites = limites;
    this.asignacion = new Map(lineas.map((l) => [l.clave, programa.deLinea(l.clave)]));
    // Cuantas ordenes traia cada linea: el tope se mide contra ESTO y no
    // contra la vuelta anterior, si no la busqueda se aleja de a poquito.
    this.ordenesIniciales = new Map(lineas.map((l) => [l.clave, programa.deLinea(l.clave).length]));
    this.valor = new Map();
    for (const [clave, ordenes] of this.asignacion) {
      this.valor.set(clave, this._valor(clave, ordenes));
    }
  }

  _valor(clave, ordenes) {
    const r = evaluarLinea(this.lineas.get(clave), ordenes, this.tabla);
    return [r.kgProducibles, r.horasRequeridas];
  }

  static _puntaje(valor, objetivo) {
    let kg = 0;
    let suma = 0;
    let max = 0;
    for (const [k, h] of valor.values()) {
      kg += k;
      suma += h;
      if (h > max) max = h;
    }
    // El objetivo de rendimiento simplemente no mira el makespan. Lo que
    // queda -- tonelada primero, horas de maquina despues -- es exactamente
    // "la misma tonelada en menos horas".
    const peso = objetivo === 'rendimiento' ? 0 : PESO_MAKESPAN;
    return kg * PESO_KG - max * peso - suma;
  }

  /** [puntaje, deltaKg, deltaHoras, dentroDeLimites] de sustituir esas lineas. */
  _delta(claves, nuevos) {
    const candidato = new Map(this.valor);
    claves.forEach((clave, i) => candidato.set(clave, this._valor(clave, nuevos[i])));
    const puntaje =
      Estado._puntaje(candidato, this.objetivo) - Estado._puntaje(this.valor, this.objetivo);
    let deltaKg = 0;
    let deltaHoras = 0;
    for (const clave of claves) {
      deltaKg += candidato.get(clave)[0] - this.valor.get(clave)[0];
      deltaHoras += this.valor.get(clave)[1] - candidato.get(clave)[1];
    }

    // Los limites se revisan linea por linea: una permuta mueve material en
    // los dos sentidos y cada lado tiene que aguantar el techo y el tope.
    let dentro = true;
    claves.forEach((clave, i) => {
      const despues = candidato.get(clave)[1];
      if (despues > this.valor.get(clave)[1] && !this.limites.permite(despues, deltaKg)) {
        dentro = false;
      }
      if (
        deltaKg <= 1e-6 &&
        !this.limites.aguantaCarga(this.ordenesIniciales.get(clave), nuevos[i].length)
      ) {
        dentro = false;
      }
    });
    return [puntaje, deltaKg, deltaHoras, dentro];
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
  {
    maxMovimientos = 400,
    permitirPermutas = true,
    umbralKg = UMBRAL_KG,
    umbralHoras = UMBRAL_HORAS,
    objetivo = 'calendario',
    topeOrdenes = Infinity,
  } = {},
) {
  const evaluacionInicial = evaluarPrograma(programa, lineas, tabla);

  // El techo sale del programa original, no de un supuesto: la linea mas
  // cargada de hoy demuestra que esas horas se pueden correr.
  const limites =
    objetivo === 'rendimiento'
      ? new Limites({ techo: evaluacionInicial.makespan, topeOrdenes })
      : new Limites();
  const estado = new Estado(programa, lineas, tabla, { objetivo, limites });
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
    objetivo,
    limites,
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
      const [[puntaje, , , dentro], cambios] = estado.deltaMoverBloque(bloque, destino);
      if (puntaje > mejorPuntaje && dentro) {
        mejorPuntaje = puntaje;
        mejor = cambios;
      }
    }
  }

  // Jugada 2: mover una sola orden.
  for (const orden of movibles) {
    for (const destino of estado.tabla.lineasPara(orden)) {
      if (destino === orden.linea || !destinosValidos.has(destino)) continue;
      const [[puntaje, , , dentro], cambios] = estado.deltaMover(orden, destino);
      if (puntaje > mejorPuntaje && dentro) {
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
          const [[puntaje, , , dentro], cambios] = estado.deltaPermutar(a, b);
          if (puntaje > mejorPuntaje && dentro) {
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
