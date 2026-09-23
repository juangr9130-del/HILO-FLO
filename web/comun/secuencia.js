// ===== resecuenciar una línea =================================================
//
// Lo que el programador puede hacer a mano con la hoja de corridas: arrastrar
// una corrida a otro lugar, o partirla en dos. Aquí vive la aritmética de qué
// cuesta cada acomodo, y el consejo de cuál ordena mejor.
//
// Es la MISMA regla de cobro que motor/programa.js:evaluarLinea, repetida aquí
// porque el módulo instalado no carga el motor (vive en el servidor) y tiene
// que recalcular el reloj en cada arrastre, sin ir a preguntar. Hay una prueba
// que compara las dos contra las mismas corridas; si alguien cambia una,
// truena.
//
// Nada de esto toca el análisis: es el acomodo dentro de una línea, no a qué
// línea va cada rollo.

/**
 * Cuánto cuesta ese acomodo, y a qué hora cae cada cosa.
 *
 * Se recorre rollo por rollo y no corrida por corrida porque los dos costos
 * caen en distinto lugar: el cambio de medida sólo en el primer rollo de la
 * corrida (si cambió el diámetro respecto de lo que corría antes), y el cambio
 * de rollo en todos menos el primero de la línea.
 *
 * @param {object[]} secuencia  corridas en el orden a evaluar
 * @param {object} reglas  {minutosCambio, minutosCambioRollo}
 * @returns {{corridas, cierreH, horasProduccion, horasCambio, cambios, cambiosRollo}}
 */
function evaluarSecuencia(secuencia, { minutosCambio = 30, minutosCambioRollo = 20 } = {}) {
  let reloj = 0;
  let diametroPrevio = null;
  let horasProduccion = 0;
  let horasCambio = 0;
  let cambios = 0;
  let cambiosRollo = 0;

  const corridas = secuencia.map((c, i) => {
    if (c.sinReceta) return { ...c, n: i + 1, inicioH: reloj, finH: reloj, horasCambio: 0 };

    const arranque = reloj;
    let cambioCorrida = 0;
    const detalle = c.detalle.map((r, j) => {
      const hayPrevio = diametroPrevio !== null;
      const cambiaMedida = hayPrevio && diametroPrevio !== c.diametroMm && j === 0;
      const h =
        (hayPrevio ? minutosCambioRollo / 60 : 0) + (cambiaMedida ? minutosCambio / 60 : 0);
      if (hayPrevio) cambiosRollo += 1;
      if (cambiaMedida) cambios += 1;
      cambioCorrida += h;
      horasCambio += h;
      reloj += h;
      diametroPrevio = c.diametroMm;

      const desde = reloj;
      const produccion = c.kgHora ? r.kg / c.kgHora : 0;
      reloj += produccion;
      horasProduccion += produccion;
      return { ...r, inicioH: redondear2(desde), finH: redondear2(reloj) };
    });

    return {
      ...c,
      n: i + 1,
      detalle,
      horasCambio: redondear2(cambioCorrida),
      horasProduccion: redondear2(detalle.reduce((t, r) => t + (r.finH - r.inicioH), 0)),
      inicioH: redondear2(arranque),
      finH: redondear2(reloj),
    };
  });

  return {
    corridas,
    cierreH: redondear2(reloj),
    horasProduccion: redondear2(horasProduccion),
    horasCambio: redondear2(horasCambio),
    cambios,
    cambiosRollo,
  };
}

function redondear2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * El acomodo que menos cambios de medida deja: por diámetro.
 *
 * Agrupar los diámetros iguales deja exactamente (diámetros distintos − 1)
 * cambios, que es el mínimo posible: cualquier acomodo tiene que visitar cada
 * diámetro y cada salto entre dos distintos cuesta un cambio. Ordenar de menor
 * a mayor es una forma de agruparlos, y de paso deja la línea subiendo de
 * medida, que es como se trabaja.
 *
 * Las corridas sin receta se van al final: no consumen reloj y estorban menos
 * ahí.
 */
function ordenSugerido(secuencia) {
  return [...secuencia].sort((a, b) => {
    if (a.sinReceta !== b.sinReceta) return a.sinReceta ? 1 : -1;
    return a.diametroMm - b.diametroMm || String(a.parte).localeCompare(String(b.parte));
  });
}

/**
 * El consejo para una línea, o null si no hay nada que ganar.
 *
 * Es CONSEJO y no se aplica solo: el orden puede responder a un compromiso con
 * el cliente, a material que aún no llega o a algo que el módulo no ve. Quien
 * decide es el programador.
 */
function consejoDeOrden(secuencia, reglas) {
  if (secuencia.length < 3) return null;
  const hoy = evaluarSecuencia(secuencia, reglas);
  const sugerido = ordenSugerido(secuencia);
  const mejor = evaluarSecuencia(sugerido, reglas);

  const evitables = hoy.cambios - mejor.cambios;
  if (evitables < 1) return null;

  return {
    evitables,
    horas: redondear2(hoy.cierreH - mejor.cierreH),
    cambiosHoy: hoy.cambios,
    cambiosSugerido: mejor.cambios,
    sugerido,
    // Los saltos que se evitan, para poder senalarlos en la tabla.
    saltos: saltosDeMedida(secuencia),
  };
}

/** Las corridas que arrancan con un cambio de medida hacia ATRAS en diametro,
 *  que son las que rompen la progresion y saltan a la vista. */
function saltosDeMedida(secuencia) {
  const fuera = [];
  const corribles = secuencia.filter((c) => !c.sinReceta);
  for (let i = 1; i < corribles.length; i++) {
    const previo = corribles[i - 1].diametroMm;
    const actual = corribles[i].diametroMm;
    if (actual === previo) continue;
    // Un salto "hacia atras" es el que obliga a regresar de medida despues de
    // haber subido: es el sintoma de que el orden no esta agrupado.
    const siguiente = corribles[i + 1]?.diametroMm;
    if (siguiente !== undefined && (actual - previo) * (siguiente - actual) < 0) {
      fuera.push(corribles[i].n);
    }
  }
  return fuera;
}

/**
 * Partir una corrida en dos por el rollo `enRollo` (1 = después del primero).
 *
 * La segunda mitad queda pegada a la primera, así que por sí sola no cambia
 * nada: sirve para después arrastrar una de las dos a otro lugar.
 */
function partirCorrida(secuencia, n, enRollo) {
  const i = secuencia.findIndex((c) => c.n === n);
  if (i < 0) return secuencia;
  const c = secuencia[i];
  if (!(enRollo >= 1 && enRollo < c.detalle.length)) return secuencia;

  const trozo = (detalle) => ({
    ...c,
    detalle,
    rollos: detalle.length,
    kg: detalle.reduce((t, r) => t + r.kg, 0),
  });
  return [
    ...secuencia.slice(0, i),
    trozo(c.detalle.slice(0, enRollo)),
    trozo(c.detalle.slice(enRollo)),
    ...secuencia.slice(i + 1),
  ];
}

/** Mover la corrida de la posición `desde` a la posición `hacia`. */
function moverCorrida(secuencia, desde, hacia) {
  if (desde === hacia || desde < 0 || desde >= secuencia.length) return secuencia;
  const copia = [...secuencia];
  const [c] = copia.splice(desde, 1);
  copia.splice(Math.max(0, Math.min(copia.length, hacia)), 0, c);
  return copia;
}
