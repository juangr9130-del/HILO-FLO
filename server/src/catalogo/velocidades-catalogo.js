/**
 * El catalogo de velocidades como lo ve el resto del modulo.
 *
 * La semilla (catalogo/velocidades.js) viene del WI y no se toca. Encima de
 * ella viven los AJUSTES: los valores que planta decidio cambiar. Guardarlos
 * aparte, en vez de sobreescribir la semilla, tiene dos ventajas concretas:
 *
 *   - siempre se ve que se aparto del documento y por cuanto, y se puede
 *     regresar al valor del WI con un clic;
 *   - cuando salga una revision nueva del WI se regenera la semilla sin
 *     perder lo que planta ya habia corregido.
 *
 * El rendimiento en kg/h no se guarda en ningun lado: sale de la velocidad y
 * de la geometria del alambre, asi que cambiar una velocidad lo recalcula.
 */

import { PuntoVelocidad } from '../motor/modelos.js';
import { kgHora } from '../motor/rendimiento.js';
import { DOCUMENTO, SERIES } from './velocidades.js';

export { DOCUMENTO };

/** Identifica un punto del catalogo de forma estable. */
export function clavePunto({ linea, winder, grado, slm, diametroMm }) {
  return `${linea}|${winder ?? ''}|${grado ?? ''}|${slm === null || slm === undefined ? '' : slm}|${diametroMm}`;
}

/**
 * La semilla expandida a puntos sueltos, con su clave.
 * @returns {{clave, linea, winder, grado, slm, diametroMm, mmS}[]}
 */
export function semilla() {
  const puntos = [];
  for (const serie of SERIES) {
    for (const [diametroMm, mmS] of serie.puntos) {
      const p = {
        linea: serie.linea,
        winder: serie.winder,
        grado: serie.grado,
        slm: serie.slm,
        diametroMm,
        mmS,
      };
      puntos.push({ ...p, clave: clavePunto(p) });
    }
  }
  return puntos;
}

/**
 * El catalogo vigente: la semilla con los ajustes aplicados.
 *
 * @param {Map<string, number>|object} ajustes  clave -> mm/s
 */
export function catalogoVigente(ajustes = new Map()) {
  const mapa = ajustes instanceof Map ? ajustes : new Map(Object.entries(ajustes ?? {}));
  return semilla().map((p) => {
    const ajustado = mapa.get(p.clave);
    return ajustado === undefined || ajustado === p.mmS
      ? { ...p, mmSOriginal: p.mmS, ajustado: false }
      : { ...p, mmS: ajustado, mmSOriginal: p.mmS, ajustado: true };
  });
}

/** Los puntos que consume el motor. */
export function puntosDelMotor(ajustes) {
  return catalogoVigente(ajustes).map(
    (p) =>
      new PuntoVelocidad({
        linea: p.linea,
        diametroMm: p.diametroMm,
        mmS: p.mmS,
        winder: p.winder,
        grado: p.grado,
        slm: p.slm,
      }),
  );
}

/**
 * El catalogo listo para pintar la pantalla de Velocidades.
 *
 * Se agrupa por linea y por variante (devanador/grado/SLM), que es como lo
 * lee el programador: "ITW-2 con devanador DEM, grado 1065".
 */
export function catalogoParaPantalla(ajustes, { eficiencia = 1 } = {}) {
  const grupos = new Map();

  for (const p of catalogoVigente(ajustes)) {
    const claveGrupo = `${p.linea}|${p.winder ?? ''}|${p.grado ?? ''}|${p.slm === null ? '' : p.slm}`;
    if (!grupos.has(claveGrupo)) {
      grupos.set(claveGrupo, {
        clave: claveGrupo,
        linea: p.linea,
        winder: p.winder,
        grado: p.grado,
        slm: p.slm,
        variante: nombreVariante(p),
        puntos: [],
      });
    }
    grupos.get(claveGrupo).puntos.push({
      clave: p.clave,
      diametroMm: p.diametroMm,
      mmS: p.mmS,
      mmSOriginal: p.mmSOriginal,
      ajustado: p.ajustado,
      kgHora: Math.round(kgHora(p.mmS, p.diametroMm, { eficiencia }) * 10) / 10,
    });
  }

  return [...grupos.values()];
}

/** "DEM winder · grade 1065", o cadena vacia si la linea no se discrimina.
 *  En ingles: se pinta en la pantalla de Line Speeds. */
export function nombreVariante({ winder, grado, slm }) {
  const partes = [];
  if (winder) partes.push(`${winder === 'DEM' ? 'DEM' : 'Neturen'} winder`);
  if (grado) partes.push(`grade ${grado}`);
  if (slm !== null && slm !== undefined) partes.push(slm ? 'SLM' : 'NON SLM');
  return partes.join(' · ');
}

/** Cuantos valores se apartaron del documento, y en que lineas. */
export function resumenAjustes(ajustes) {
  const cambiados = catalogoVigente(ajustes).filter((p) => p.ajustado);
  const porLinea = new Map();
  for (const p of cambiados) porLinea.set(p.linea, (porLinea.get(p.linea) ?? 0) + 1);
  return {
    total: cambiados.length,
    lineas: [...porLinea].map(([linea, puntos]) => ({ linea, puntos })),
  };
}

/**
 * Valida un ajuste antes de guardarlo.
 * @returns {string|null} el motivo del rechazo, o null si es valido.
 */
export function revisarAjuste(clave, mmS) {
  if (!clavesValidas().has(clave)) return 'that point is not in the catalog';
  const valor = Number(mmS);
  if (!Number.isFinite(valor)) return 'the speed has to be a number';
  if (valor <= 0) return 'the speed has to be greater than zero';
  // El WI va de 40 a 600 mm/s; un cero de mas suele ser un dedazo, no una receta.
  if (valor > 2000) return 'that speed is out of range (2000 mm/s max)';
  return null;
}

let _claves = null;
function clavesValidas() {
  if (!_claves) _claves = new Set(semilla().map((p) => p.clave));
  return _claves;
}
