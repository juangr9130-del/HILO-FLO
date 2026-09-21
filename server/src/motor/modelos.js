/**
 * Modelo de dominio de HILO-FLO (Mubea Florence, lineas ITW).
 *
 * Vocabulario de planta:
 *   ITW      Induction Tempered Wire: las lineas de temple por induccion.
 *   Linea    ITW-1 .. ITW-14 (la 15 esta por instalarse). En SAP son los
 *            work centers BB001 .. BB014.
 *   Orden    un renglon del production schedule: N kg de un alambre de cierto
 *            diametro, ya asignado a un work center.
 *   Programa el conjunto de ordenes del horizonte que se esta programando.
 */

/**
 * Rango plausible de diametro de alambre estirado en las lineas ITW (mm).
 *
 * Lo usan los dos lectores: en el WI descarta renglones de encabezado que
 * traen numeros en la columna A, y en el schedule evita confundir el rango
 * de resistencia ("1950-2000 MPa") con un diametro.
 */
export const DIAMETRO_MIN = 4;
export const DIAMETRO_MAX = 30;

/**
 * Devanador que se asume cuando el schedule no indica cual se uso.
 *
 * El deber ser en Florence es el DEM, confirmado con planta, asi que es lo
 * que se calcula por omision. El WI dice que el schedule marca el DEM en la
 * seccion de notas, pero en la practica casi nunca lo anota: tomar esa
 * ausencia como "corrio con Neturen" subestimaria el rendimiento de ITW-2
 * hasta a la mitad (2.18x de diferencia a 5.72 mm).
 *
 * Que no venga anotado no se ignora: el analisis levanta un aviso con las
 * ordenes afectadas y con lo que costaria el cierre del programa si de
 * verdad hubieran corrido con Neturen. Ver servicio/analisis.js.
 */
export const WINDER_PREDETERMINADO = 'DEM';

/** El otro devanador. El schedule lo puede indicar explicitamente para
 *  registrar la excepcion al deber ser. */
export const WINDER_ALTERNO = 'NETUREN';

/** BB001 -> ITW-1. Si no reconoce el patron, regresa el texto tal cual. */
export function workCenterALinea(workCenter) {
  const m = /^\s*BB0*(\d+)\s*$/i.exec(String(workCenter ?? ''));
  return m ? `ITW-${Number(m[1])}` : String(workCenter ?? '').trim();
}

/** ITW-1 -> BB001. */
export function lineaAWorkCenter(linea) {
  const m = /^\s*ITW[-\s]?(\d+)\s*$/i.exec(String(linea ?? ''));
  return m ? `BB${String(Number(m[1])).padStart(3, '0')}` : String(linea ?? '').trim();
}

/** Ordena ITW-2 antes que ITW-10 (numerico, no alfabetico). */
export function ordenNatural(linea) {
  const m = /(\d+)/.exec(linea ?? '');
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export function compararLineas(a, b) {
  return ordenNatural(a) - ordenNatural(b) || String(a).localeCompare(String(b));
}

/** Una linea de temple por induccion. */
export class Linea {
  constructor({
    clave,
    horasDisponibles = 0,
    eficiencia = 1,
    minutosCambio = 0,
    activa = true,
  }) {
    if (!(eficiencia > 0 && eficiencia <= 1)) {
      throw new Error(`${clave}: eficiencia debe estar en (0, 1]`);
    }
    if (horasDisponibles < 0) {
      throw new Error(`${clave}: horasDisponibles no puede ser negativa`);
    }
    this.clave = clave;
    this.horasDisponibles = horasDisponibles;
    this.eficiencia = eficiencia;
    this.minutosCambio = minutosCambio;
    this.activa = activa;
    Object.freeze(this);
  }

  get workCenter() {
    return lineaAWorkCenter(this.clave);
  }
}

/**
 * Una celda de la tabla ITW Line Speed del WI-FLO-CSW-P-526.
 *
 * `winder`, `grado` y `slm` son los discriminantes que trae el documento:
 * ITW-2 se tabula por devanador (Neturen / DEM) y por grado (9254 vs 1065);
 * ITW-10 se tabula por SLM / NON SLM. `null` significa "aplica a cualquiera".
 */
export class PuntoVelocidad {
  constructor({ linea, diametroMm, mmS, winder = null, grado = null, slm = null }) {
    if (!(mmS > 0)) throw new Error(`${linea}@${diametroMm}: mmS debe ser > 0`);
    if (!(diametroMm > 0)) throw new Error(`${linea}: diametroMm debe ser > 0`);
    this.linea = linea;
    this.diametroMm = diametroMm;
    this.mmS = mmS;
    this.winder = winder;
    this.grado = grado;
    this.slm = slm;
    Object.freeze(this);
  }

  /** True si esta receta es usable para la orden. */
  /**
   * True si esta receta es usable para la orden.
   *
   * @param orden
   * @param winderEsperado  devanador que se exige; null acepta cualquiera.
   *   Lo decide TablaVelocidades, no la receta: primero se busca con el
   *   deber ser y solo si ese diametro no esta tabulado se reintenta
   *   abierto, para no perder una orden por un hueco del documento.
   */
  aplicaA(orden, winderEsperado = undefined) {
    const esperado =
      winderEsperado === undefined ? (orden.winder ?? WINDER_PREDETERMINADO) : winderEsperado;
    if (this.winder !== null && esperado !== null && this.winder !== esperado) return false;
    if (this.grado !== null && this.grado !== orden.grupoGrado) return false;
    if (this.slm !== null && this.slm !== orden.slm) return false;
    return true;
  }


  /** Cuantos discriminantes fija. Gana la receta mas especifica. */
  get especificidad() {
    return [this.winder, this.grado, this.slm].filter((x) => x !== null).length;
  }
}

/** Un renglon del production schedule. */
export class Orden {
  constructor({
    id,
    diametroMm,
    kilogramos,
    linea,
    material = '',
    descripcion = '',
    grupoGrado = '9254',
    slm = false,
    winder = null,
    secuencia = 0,
    notas = '',
    clientePo = '',
    fijo = false,
  }) {
    if (!(kilogramos > 0)) throw new Error(`orden ${id}: kilogramos debe ser > 0`);
    if (!(diametroMm > 0)) throw new Error(`orden ${id}: diametroMm debe ser > 0`);
    this.id = id;
    this.diametroMm = diametroMm;
    this.kilogramos = kilogramos;
    this.linea = linea;
    this.material = material;
    this.descripcion = descripcion;
    this.grupoGrado = grupoGrado;
    this.slm = slm;
    this.winder = winder;
    this.secuencia = secuencia;
    this.notas = notas;
    this.clientePo = clientePo;
    this.fijo = fijo;
    Object.freeze(this);
  }

  /** Etiqueta legible del diametro, para agrupar y reportar. */
  get medida() {
    return this.diametroMm.toFixed(2);
  }

  /** Lo unico de la orden que cambia la receta y el rendimiento. */
  get firma() {
    return `${this.diametroMm}|${this.grupoGrado}|${this.slm}|${this.winder}`;
  }

  moverA(linea, secuencia = null) {
    return new Orden({
      ...this,
      linea,
      secuencia: secuencia === null ? this.secuencia : secuencia,
    });
  }
}

/** El production schedule del horizonte. */
export class Programa {
  constructor(ordenes = [], horizonte = '') {
    this.ordenes = ordenes;
    this.horizonte = horizonte;
  }

  get length() {
    return this.ordenes.length;
  }

  get kilogramos() {
    return this.ordenes.reduce((t, o) => t + o.kilogramos, 0);
  }

  /** Ordenes de una linea, en la secuencia en que estan programadas. */
  deLinea(linea) {
    return this.ordenes
      .filter((o) => o.linea === linea)
      .sort((a, b) => a.secuencia - b.secuencia || String(a.id).localeCompare(String(b.id)));
  }

  lineasUsadas() {
    return [...new Set(this.ordenes.map((o) => o.linea))].sort(compararLineas);
  }

  reemplazar(ordenes) {
    return new Programa([...ordenes], this.horizonte);
  }
}
