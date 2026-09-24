/**
 * En que lineas puede correr un rollo segun sus atributos.
 *
 * Son OTRA cosa que el rango de diametros: el rango dice en que medidas una
 * linea corre bien, esto dice que tipos de rollo puede o no puede correr,
 * independientemente de la medida. Las dio el programador de Florence por
 * correo (John Pitts, "RE: Francisco Contact").
 *
 * Dos modos:
 *
 *   SOLO   ese tipo de rollo unicamente corre en esas lineas.
 *   NUNCA  ese tipo de rollo no corre en esas lineas.
 *
 * PRECEDENCIA: SOLO le gana a NUNCA, y es lo que resuelve el unico choque que
 * traen las reglas. Los 20 rollos "top down" del schedule del 17/09 son
 * tambien SID: top down dice "solo en ITW-2" y small ID dice "nunca en ITW-2",
 * asi que juntos no dejarian ninguna linea. Y sin embargo esos 20 rollos YA
 * corren en ITW-2 hoy, o sea que en la practica manda el "solo". Un "solo" es
 * una capacidad que unas pocas lineas tienen; un "nunca" es una preferencia
 * general, y lo especifico gana.
 *
 * Las reglas de DIAMETRO del mismo correo no viven aqui, viven en rangos.js,
 * que es donde ya se decide por medida:
 *
 *   "solo HTL 13 corre arriba de 19.5 mm"  -> ya se cumple: ninguna otra
 *      linea tiene rango arriba de 19.5.
 *   "nada arriba de 14.4 en HTL 5 y 6"     -> bajo el maximo de esas dos a
 *      14.4, y CONTRADICE el papel de piso (5 llegaba a 15.50 y 6 a 16.00).
 *      Ver rangos.js.
 */

/** @type {{clave, etiqueta, modo, lineas, atributo}[]} */
export const RESTRICCIONES = [
  {
    clave: 'topDown',
    etiqueta: 'Top down coils',
    modo: 'solo',
    lineas: ['ITW-2'],
    atributo: (o) => Boolean(o.topDown),
    fuente: 'Top Down coils can only be ran on HTL 2',
  },
  {
    clave: 'slm',
    etiqueta: 'SLM coils',
    modo: 'solo',
    lineas: ['ITW-4', 'ITW-10'],
    atributo: (o) => Boolean(o.slm),
    fuente: "SLM coils can only run on HTL's 4 and 10",
  },
  {
    clave: 'sid',
    etiqueta: 'Small ID coils',
    modo: 'nunca',
    lineas: ['ITW-2', 'ITW-4', 'ITW-10', 'ITW-11'],
    atributo: (o) => Boolean(o.sid),
    fuente: "Small ID coils cannot run on HTL's 2, 4, 10, or 11",
  },
];

const POR_RESTRICCION = new Map(RESTRICCIONES.map((r) => [r.clave, r]));

/** Las restricciones con las lineas que planta haya corregido. */
export function restriccionesVigentes(ajustes = new Map()) {
  return RESTRICCIONES.map((r) => {
    const a = ajustes instanceof Map ? ajustes.get(r.clave) : ajustes?.[r.clave];
    return Array.isArray(a) && a.length ? { ...r, lineas: [...a] } : r;
  });
}

/**
 * ¿Ese rollo puede correr en esa linea?
 *
 * Se resuelve en dos pasos para que SOLO le gane a NUNCA: primero se arma el
 * conjunto permitido con los SOLO que apliquen, y despues los NUNCA recortan
 * -- pero solo si al recortar queda algo. Si un NUNCA vaciara el conjunto, se
 * ignora: la capacidad especifica manda sobre la preferencia general.
 */
export function lineaPermitida(restricciones, linea, orden) {
  const solos = restricciones.filter((r) => r.modo === 'solo' && r.atributo(orden));
  for (const r of solos) {
    if (!r.lineas.includes(linea)) return false;
  }

  const nunca = restricciones.filter((r) => r.modo === 'nunca' && r.atributo(orden));
  if (!nunca.length) return true;
  if (solos.length) return true; // el SOLO ya decidio; el NUNCA no lo recorta mas
  return !nunca.some((r) => r.lineas.includes(linea));
}

/** Las restricciones que ese rollo activa, para poder explicarlo en pantalla. */
export function restriccionesDe(restricciones, orden) {
  const solos = restricciones.filter((r) => r.modo === 'solo' && r.atributo(orden));
  const nunca = restricciones.filter((r) => r.modo === 'nunca' && r.atributo(orden));
  // Si hay un SOLO, el NUNCA quedo sin efecto y decirlo confundiria.
  return solos.length ? solos : nunca;
}

/** Lo que pinta la pantalla. */
export function restriccionesParaPantalla(ajustes = new Map()) {
  return restriccionesVigentes(ajustes).map((r) => {
    const semilla = POR_RESTRICCION.get(r.clave).lineas;
    return {
      clave: r.clave,
      etiqueta: r.etiqueta,
      modo: r.modo,
      lineas: r.lineas,
      semilla,
      fuente: r.fuente,
      cambiada: r.lineas.join(',') !== semilla.join(','),
    };
  });
}

/** Motivo por el que una lista de lineas no se acepta, o null. */
export function revisarRestriccion(clave, lineas) {
  if (!POR_RESTRICCION.has(clave)) return 'that restriction does not exist';
  if (!Array.isArray(lineas) || !lineas.length) return 'pick at least one line';
  if (lineas.some((l) => !/^ITW-\d+$/.test(String(l)))) return 'those are not line codes';
  return null;
}
