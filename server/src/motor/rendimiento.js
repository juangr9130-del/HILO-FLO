/**
 * Rendimiento: de mm/s de receta a kilogramos por hora.
 *
 * El WI-FLO-CSW-P-526 da la velocidad de linea en mm/s por diametro de
 * alambre estirado. Como el alambre es solido y el temple no cambia la
 * seccion, el rendimiento masico sale directo de la geometria:
 *
 *     area (mm2)  = pi/4 * d^2
 *     peso lineal = area * densidad
 *     kg/h        = velocidad(mm/s) * 3600/1000 * peso lineal * eficiencia
 *
 * Ejemplo: 170 mm/s de alambre de 14.70 mm -> ~815 kg/h.
 */

import { compararLineas } from './modelos.js';

/** Acero de resorte (9254 / 54SiCr6 / 60SiCr7 / SAE1065). kg/m3. */
export const DENSIDAD_ACERO = 7850;

/** Tolerancia al buscar el diametro en la tabla (mm). La reticula del WI es
 *  de 0.05 mm, asi que 0.30 mm cubre de sobra cualquier redondeo. */
export const TOLERANCIA_MM = 0.3;

/** Seccion transversal del alambre. */
export function areaMm2(diametroMm) {
  if (!(diametroMm > 0)) throw new Error('el diametro debe ser positivo');
  return (Math.PI / 4) * diametroMm ** 2;
}

/** Kilogramos por metro de alambre. */
export function pesoLinealKgM(diametroMm, densidadKgM3 = DENSIDAD_ACERO) {
  return areaMm2(diametroMm) * 1e-6 * densidadKgM3;
}

/** Rendimiento masico de una linea corriendo esa receta. */
export function kgHora(mmS, diametroMm, { eficiencia = 1, densidadKgM3 = DENSIDAD_ACERO } = {}) {
  if (mmS < 0) throw new Error('la velocidad no puede ser negativa');
  const metrosHora = (mmS * 3600) / 1000;
  return metrosHora * pesoLinealKgM(diametroMm, densidadKgM3) * eficiencia;
}

/**
 * Las recetas del WI, consultables por linea y orden.
 *
 * Es tambien la matriz de compatibilidad: si una linea no tiene receta para
 * el diametro de una orden, esa linea no la puede correr.
 */
export class TablaVelocidades {
  /**
   * @param {PuntoVelocidad[]} puntos
   * @param {Linea[]} lineas  de aqui sale la eficiencia de cada linea
   * @param {{densidadKgM3?:number, politica?:'arriba'|'cercano', toleranciaMm?:number}} opciones
   *   politica: como resolver un diametro que no cae exacto en la reticula.
   *     'arriba'  -> punto tabulado inmediato superior (conservador: a mayor
   *                  diametro, menor velocidad)
   *     'cercano' -> el punto tabulado mas cercano
   */
  constructor(puntos, lineas = [], opciones = {}) {
    const { densidadKgM3 = DENSIDAD_ACERO, politica = 'arriba', toleranciaMm = TOLERANCIA_MM } =
      opciones;
    this.puntos = puntos;
    this.densidadKgM3 = densidadKgM3;
    this.politica = politica;
    this.toleranciaMm = toleranciaMm;
    this.eficiencias = new Map(lineas.map((l) => [l.clave, l.eficiencia]));

    this.porLinea = new Map();
    for (const p of puntos) {
      if (!this.porLinea.has(p.linea)) this.porLinea.set(p.linea, []);
      this.porLinea.get(p.linea).push(p);
    }
    for (const lista of this.porLinea.values()) lista.sort((a, b) => a.diametroMm - b.diametroMm);

    // El optimizador consulta la misma combinacion miles de veces; sin
    // memoria, cada consulta recorre las ~260 recetas de la linea.
    this._cacheReceta = new Map();
    this._cacheKgHora = new Map();
  }

  get lineas() {
    return [...this.porLinea.keys()].sort(compararLineas);
  }

  get size() {
    return this.puntos.length;
  }

  diametrosDe(linea) {
    return [...new Set((this.porLinea.get(linea) ?? []).map((p) => p.diametroMm))].sort(
      (a, b) => a - b,
    );
  }

  rangoDe(linea) {
    const ds = this.diametrosDe(linea);
    return ds.length ? [ds[0], ds[ds.length - 1]] : null;
  }

  /** La receta que aplica a esa orden en esa linea, o null. */
  receta(linea, orden) {
    const clave = `${linea}#${orden.firma}`;
    if (this._cacheReceta.has(clave)) return this._cacheReceta.get(clave);
    const receta = this._buscarReceta(linea, orden);
    this._cacheReceta.set(clave, receta);
    return receta;
  }

  _buscarReceta(linea, orden) {
    const candidatos = (this.porLinea.get(linea) ?? []).filter((p) => p.aplicaA(orden));
    if (!candidatos.length) return null;
    const diametro = this._resolverDiametro(candidatos, orden.diametroMm);
    if (diametro === null) return null;
    // De los puntos de ese diametro gana el mas especifico y, a igualdad,
    // el mas lento (criterio conservador).
    return candidatos
      .filter((p) => p.diametroMm === diametro)
      .sort((a, b) => b.especificidad - a.especificidad || a.mmS - b.mmS)[0];
  }

  _resolverDiametro(candidatos, diametroMm) {
    const disponibles = [...new Set(candidatos.map((p) => p.diametroMm))].sort((a, b) => a - b);
    const exacto = disponibles.find((d) => Math.abs(d - diametroMm) < 1e-9);
    if (exacto !== undefined) return exacto;
    if (this.politica === 'arriba') {
      const arriba = disponibles.filter((d) => d >= diametroMm);
      if (arriba.length && arriba[0] - diametroMm <= this.toleranciaMm) return arriba[0];
    }
    const cercano = disponibles.reduce((mejor, d) =>
      Math.abs(d - diametroMm) < Math.abs(mejor - diametroMm) ? d : mejor,
    );
    return Math.abs(cercano - diametroMm) <= this.toleranciaMm ? cercano : null;
  }

  mmS(linea, orden) {
    return this.receta(linea, orden)?.mmS ?? null;
  }

  /** Rendimiento de esa orden en esa linea, ya con eficiencia. */
  kgHora(linea, orden) {
    const clave = `${linea}#${orden.firma}`;
    if (this._cacheKgHora.has(clave)) return this._cacheKgHora.get(clave);
    const receta = this.receta(linea, orden);
    const valor =
      receta === null
        ? null
        : kgHora(receta.mmS, orden.diametroMm, {
            eficiencia: this.eficiencias.get(linea) ?? 1,
            densidadKgM3: this.densidadKgM3,
          });
    this._cacheKgHora.set(clave, valor);
    return valor;
  }

  puedeCorrer(linea, orden) {
    return this.receta(linea, orden) !== null;
  }

  /** Lineas capaces de correr la orden, de la mas rapida a la mas lenta. */
  lineasPara(orden) {
    const capaces = [];
    for (const linea of this.porLinea.keys()) {
      const kgh = this.kgHora(linea, orden);
      if (kgh) capaces.push([linea, kgh]);
    }
    capaces.sort((a, b) => b[1] - a[1] || compararLineas(a[0], b[0]));
    return capaces.map(([l]) => l);
  }

  horasPara(linea, orden) {
    const kgh = this.kgHora(linea, orden);
    return kgh ? orden.kilogramos / kgh : null;
  }
}
