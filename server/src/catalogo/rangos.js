/**
 * El rango de diametros que cada linea corre MEJOR, segun piso.
 *
 * Ojo con la diferencia contra la tabla de velocidades, porque son dos cosas
 * distintas y es facil confundirlas:
 *
 *   TABLA DE VELOCIDADES  que diametros PUEDE correr la linea. Sale del WI.
 *   RANGO DE PISO         en cuales corre BIEN. Sale de la experiencia.
 *
 * El rango es mucho mas estrecho: entre 23% y 73% de los diametros tabulados
 * caen dentro. Y sin embargo el schedule del 17/09 ya casi lo respeta -- solo
 * 7 de 472 rollos quedan fuera, y por decimas de milimetro -- lo que dice que
 * el programador ya sigue esta regla aunque no estuviera escrita.
 *
 * Por eso se usa para frenar A DONDE se mueve material, no para reprobar lo
 * que ya esta programado: lo que ya corre fuera de rango se avisa y se deja,
 * que sacarlo seria imponerle al programador un cambio que el no pidio.
 */

/** Lo que entrego piso, en mm. Cada linea: [minimo, maximo]. */
export const RANGOS = new Map([
  ['ITW-1', [11.0, 15.4]],
  ['ITW-2', [5.0, 12.0]],
  ['ITW-3', [9.0, 13.5]],
  ['ITW-4', [10.0, 13.5]],
  ['ITW-5', [12.0, 15.5]],
  ['ITW-6', [13.0, 16.0]],
  ['ITW-7', [15.0, 18.0]],
  ['ITW-8', [15.0, 18.0]],
  ['ITW-9', [13.0, 16.0]],
  ['ITW-10', [13.0, 16.0]],
  ['ITW-11', [11.0, 14.5]],
  ['ITW-12', [16.5, 18.5]],
  ['ITW-13', [18.0, 22.1]],
  ['ITW-14', [17.5, 19.5]],
]);

/** ITW-15 no esta instalada y piso no le dio rango: no se le inventa uno. */
export function rangoSemilla(linea) {
  return RANGOS.get(linea) ?? null;
}

/** Los rangos con lo que planta haya corregido encima. */
export function rangosVigentes(ajustes = new Map()) {
  const vigentes = new Map();
  for (const [linea, rango] of RANGOS) {
    const a = ajustes instanceof Map ? ajustes.get(linea) : ajustes?.[linea];
    vigentes.set(linea, revisarRango(a) === null && a ? [Number(a[0]), Number(a[1])] : rango);
  }
  return vigentes;
}

/** Motivo por el que un rango no se acepta, o null. */
export function revisarRango(rango) {
  if (!Array.isArray(rango) || rango.length !== 2) return 'the range needs a minimum and a maximum';
  const [lo, hi] = rango.map(Number);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 'both have to be numbers';
  if (lo <= 0 || hi <= 0) return 'both have to be greater than zero';
  if (lo >= hi) return 'the minimum has to be below the maximum';
  if (hi > 40) return 'that is out of range (40 mm max)';
  return null;
}

/** ¿Esa linea corre bien ese diametro? Sin rango, no se estorba. */
export function dentroDelRango(vigentes, linea, diametroMm) {
  const r = vigentes.get(linea);
  if (!r) return true;
  return diametroMm >= r[0] - 1e-9 && diametroMm <= r[1] + 1e-9;
}

/** Lo que pinta la pantalla: cada linea con su rango y si se corrigio. */
export function rangosParaPantalla(ajustes = new Map()) {
  const vigentes = rangosVigentes(ajustes);
  return [...RANGOS.keys()].map((linea) => {
    const semilla = RANGOS.get(linea);
    const v = vigentes.get(linea);
    return {
      linea,
      min: v[0],
      max: v[1],
      minSemilla: semilla[0],
      maxSemilla: semilla[1],
      cambiado: v[0] !== semilla[0] || v[1] !== semilla[1],
    };
  });
}
