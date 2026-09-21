/**
 * La hoja de corridas: el schedule visto como lo ve el de piso.
 *
 * El analisis contesta "que conviene mover". Esto contesta la otra pregunta,
 * la que se hace todos los dias: que corre cada linea, en que orden, a que
 * hora empieza, a que hora acaba y con cuantos rollos.
 *
 * Una CORRIDA es un bloque de rollos seguidos del mismo numero de parte en
 * la misma linea, igual que en HILO. El schedule de Florence trae un renglon
 * por rollo (~2.3 t cada uno), asi que los rollos de la corrida son los
 * renglones que se juntaron.
 *
 * El reloj se arma acumulando lo que ya calculo el motor. El cambio de medida
 * se cobra ANTES de la corrida que lo provoca, que es como pasa en la linea:
 * primero se ajusta, luego se corre.
 */

import { lineaAWorkCenter } from '../motor/modelos.js';
import { redondear } from '../util/numeros.js';

/**
 * La fecha que trae el nombre del archivo (Schedule_8200_09-17-2026.xlsx).
 *
 * El schedule no trae columna de fecha, asi que el nombre es lo unico que
 * dice de que semana es. Si no se puede leer se regresa null y la pantalla
 * ensena horas corridas en vez de fecha y hora.
 */
export function inicioDelPrograma(archivo) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(String(archivo ?? ''));
  if (!m) return null;
  const [, mes, dia, anio] = m.map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  // Medianoche en UTC a proposito: la pantalla formatea con los getters UTC
  // y asi el mismo folio se lee igual en Florence que en Mexico.
  return new Date(Date.UTC(anio, mes - 1, dia)).toISOString();
}

/** Los rollos seguidos del mismo numero de parte son una corrida. */
function agrupar(corridas) {
  const bloques = [];
  for (const c of corridas) {
    const parte = c.orden.material || c.orden.descripcion;
    const ultimo = bloques.at(-1);
    if (ultimo && ultimo.parte === parte && ultimo.diametroMm === c.orden.diametroMm) {
      ultimo.rollos.push(c);
    } else {
      bloques.push({ parte, diametroMm: c.orden.diametroMm, rollos: [c] });
    }
  }
  return bloques;
}

/**
 * Arma la hoja de una evaluacion.
 *
 * @param {Evaluacion} evaluacion  lo que ya calculo el motor
 * @returns {object[]} una entrada por linea, en el orden del catalogo
 */
export function hojaDeCorridas(evaluacion) {
  const hoja = [];

  for (const clave of evaluacion.clavesOrdenadas()) {
    const r = evaluacion.lineas.get(clave);
    const horizonte = r.linea.horasDisponibles;
    let reloj = 0;
    let numero = 0;

    const corridas = agrupar(r.corridas).map((b) => {
      numero += 1;
      // El cambio lo trae el primer rollo del bloque: es el unico que pudo
      // haber cambiado de medida respecto de lo que corria antes.
      const horasCambio = b.rollos.reduce((t, c) => t + c.horasCambio, 0);
      const arranque = reloj;
      reloj += horasCambio;

      const rollos = b.rollos.map((c) => {
        const desde = reloj;
        reloj += c.horasProduccion;
        return {
          orden: c.orden.id,
          kg: redondear(c.orden.kilogramos, 0),
          kgHora: c.kgHora === null ? null : redondear(c.kgHora, 0),
          inicioH: redondear(desde, 2),
          finH: redondear(reloj, 2),
          // Lo que no cabe en el horizonte no sale esta semana, aunque este
          // programado. Se marca en vez de esconderlo.
          completo: c.completa,
          sinReceta: c.sinReceta,
        };
      });

      const kg = b.rollos.reduce((t, c) => t + c.orden.kilogramos, 0);
      const horasProduccion = b.rollos.reduce((t, c) => t + c.horasProduccion, 0);
      const primera = b.rollos[0].orden;

      return {
        n: numero,
        parte: b.parte,
        descripcion: primera.descripcion,
        diametroMm: b.diametroMm,
        grupoGrado: primera.grupoGrado,
        slm: primera.slm,
        winder: primera.winder,
        rollos: rollos.length,
        kg: redondear(kg, 0),
        kgHora: b.rollos[0].kgHora === null ? null : redondear(b.rollos[0].kgHora, 0),
        horasCambio: redondear(horasCambio, 2),
        horasProduccion: redondear(horasProduccion, 2),
        inicioH: redondear(arranque, 2),
        finH: redondear(reloj, 2),
        // Una corrida sin receta no consume reloj: la linea no la puede correr.
        sinReceta: b.rollos.every((c) => c.sinReceta),
        dentroDelHorizonte: reloj <= horizonte + 1e-6,
        detalle: rollos,
      };
    });

    hoja.push({
      linea: clave,
      workCenter: lineaAWorkCenter(clave),
      activa: r.linea.activa,
      horasDisponibles: horizonte,
      corridas: corridas.length,
      rollos: r.corridas.length,
      kg: redondear(r.kgProgramados, 0),
      horas: redondear(r.horasRequeridas, 2),
      cierreH: redondear(reloj, 2),
      secuencia: corridas,
    });
  }

  return hoja;
}
