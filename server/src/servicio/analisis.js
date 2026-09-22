/**
 * El servicio: junta las recetas, el schedule y el algoritmo, y arma el
 * paquete que consume la pantalla de programacion.
 */

import { Linea, PuntoVelocidad, lineaAWorkCenter } from '../motor/modelos.js';
import { TablaVelocidades } from '../motor/rendimiento.js';
import { evaluarPrograma } from '../motor/programa.js';
import { buscarOportunidades } from '../motor/optimizador.js';
import { reunirAvisos } from './avisos.js';
import { hojaDeCorridas, inicioDelPrograma } from './corridas.js';
import { ErrorDeDatos } from '../errores.js';
import { redondear } from '../util/numeros.js';

/** Las 14 lineas instaladas mas ITW-15, que esta por instalarse. */
export const LINEAS_INSTALADAS = Array.from({ length: 14 }, (_, i) => `ITW-${i + 1}`);
export const LINEA_POR_INSTALAR = 'ITW-15';

/** Supuestos por omision. El servidor los sobreescribe con su configuracion
 *  y el modulo demo los usa tal cual. Ver docs/SUPUESTOS.md. */
export const SUPUESTOS = {
  horasDisponibles: 144,
  eficiencia: 1,
  minutosCambio: 30,
  maxMovimientos: 400,

  /**
   * Que busca el reajuste. Ver docs/SUPUESTOS.md, seccion 2d-E.
   *
   *   'rendimiento' la misma tonelada en menos horas de maquina. Nunca manda
   *                 material a una linea mas lenta, pero no cierra antes.
   *   'calendario'  cierra el programa lo antes posible. Empareja las lineas,
   *                 y para emparejar a veces corre material mas lento.
   *
   * Florence eligio probar 'rendimiento'. Regresar al anterior es cambiar
   * este valor a 'calendario': el otro objetivo sigue vivo y con pruebas.
   */
  objetivo: 'rendimiento',

  /**
   * Cuantos rollos se puede apartar una linea de lo que trae el schedule.
   *
   * Sin freno, 'rendimiento' vacia las lineas lentas: sobre el schedule del
   * 17/09 dejaba ITW-3 con UN rollo y 2.8 h, y eso no se puede proponer.
   *
   * Hubo antes un piso de 60 h de trabajo por linea. Se reemplazo por esto a
   * peticion de Florence, y la medicion le dio la razon: el rollo es la
   * unidad en la que el programador piensa, con tope 5 el piso ya no cambiaba
   * ni un movimiento, y ademas limita el CAMBIO -- que es lo que le cuesta
   * defender -- en vez de limitar el resultado.
   */
  topeOrdenes: 5,
};

export function catalogoLineas({
  horasDisponibles = SUPUESTOS.horasDisponibles,
  eficiencia = SUPUESTOS.eficiencia,
  minutosCambio = SUPUESTOS.minutosCambio,
  itw15Activa = false,
} = {}) {
  const lineas = LINEAS_INSTALADAS.map(
    (clave) => new Linea({ clave, horasDisponibles, eficiencia, minutosCambio }),
  );
  lineas.push(
    new Linea({
      clave: LINEA_POR_INSTALAR,
      horasDisponibles,
      eficiencia,
      minutosCambio,
      activa: itw15Activa,
    }),
  );
  return lineas;
}

/** Recetas guardadas -> objetos del motor. */
export function puntosDesdeFilas(filas) {
  return filas.map((f) => new PuntoVelocidad(f));
}

/**
 * Corre el analisis completo de un schedule ya leido.
 *
 * Recibe el programa, no el archivo: asi el mismo servicio sirve al servidor
 * (que lee con exceljs) y al modulo demo (que lee en el navegador).
 *
 * @param {Programa} programa  las ordenes del schedule
 * @param {PuntoVelocidad[]} puntos  las recetas del WI
 * @param {object} supuestos  horas, eficiencia, minutos de cambio
 */
export function analizar(programa, puntos, supuestos = {}) {
  const lineas = catalogoLineas(supuestos);
  const tabla = new TablaVelocidades(puntos, lineas);

  const desconocidas = programa.lineasUsadas().filter(
    (l) => !lineas.some((x) => x.clave === l),
  );
  if (desconocidas.length) {
    throw new ErrorDeDatos(
      `the schedule has work centers that map to no ITW line: ${desconocidas.join(', ')}`,
    );
  }

  const evaluacion = evaluarPrograma(programa, lineas, tabla);
  const propuesta = buscarOportunidades(programa, lineas, tabla, {
    maxMovimientos: supuestos.maxMovimientos ?? SUPUESTOS.maxMovimientos,
    objetivo: supuestos.objetivo ?? SUPUESTOS.objetivo,
    topeOrdenes: supuestos.topeOrdenes ?? SUPUESTOS.topeOrdenes,
  });

  return { programa, lineas, tabla, evaluacion, propuesta };
}



/**
 * Arma el JSON que pinta la pantalla.
 *
 * Es deliberadamente "plano": la pantalla no vuelve a calcular nada, solo
 * dibuja. Asi el mismo paquete se puede guardar en flo_analisis y volver a
 * pintar identico meses despues.
 */
export function empaquetar({ folio, archivo, cargadoPor, programa, lineas, tabla, evaluacion, propuesta, supuestos }) {
  const ev2 = propuesta.evaluacionPropuesta;
  const lineaPropuestaDe = new Map(propuesta.programaPropuesto.ordenes.map((o) => [o.id, o.linea]));

  const detalleLineas = lineas.map((l) => {
    const a = evaluacion.lineas.get(l.clave);
    const b = ev2.lineas.get(l.clave);
    return {
      linea: l.clave,
      workCenter: lineaAWorkCenter(l.clave),
      activa: l.activa,
      horasDisponibles: l.horasDisponibles,
      actual: resumenLinea(a),
      propuesto: resumenLinea(b),
      corridas: a.corridas.map((c) => ({
        orden: c.orden.id,
        diametroMm: c.orden.diametroMm,
        kilogramos: c.orden.kilogramos,
        descripcion: c.orden.descripcion,
        kgHora: c.kgHora === null ? null : redondear(c.kgHora, 1),
        horas: redondear(c.horasProduccion, 2),
        horasCambio: redondear(c.horasCambio, 2),
        sinReceta: c.sinReceta,
        lineaPropuesta: lineaPropuestaDe.get(c.orden.id) ?? l.clave,
        movida: (lineaPropuestaDe.get(c.orden.id) ?? l.clave) !== l.clave,
      })),
    };
  });

  const objetivo = supuestos.objetivo ?? SUPUESTOS.objetivo;
  const prod = productividad(evaluacion, ev2, propuesta);

  const movimientos = propuesta.agrupadas().map((g, i) => ({
    id: i + 1,
    origen: g.origen,
    destino: g.destino,
    diametroMm: g.diametroMm,
    ordenes: g.ordenes.length,
    kilogramos: redondear(g.kilogramos, 0),
    horasOrigen: redondear(g.horasOrigen, 2),
    horasDestino: redondear(g.horasDestino, 2),
    horasLiberadas: redondear(g.horasLiberadas, 2),
    folios: g.folios,
    consejo: g.describir(),
    aceptado: null,
  }));

  return {
    folio,
    archivo,
    cargadoPor: cargadoPor ?? null,
    cargadoEn: new Date().toISOString(),
    ordenes: programa.length,
    kilogramos: redondear(programa.kilogramos, 0),
    supuestos,
    recetas: tabla.size,
    analisis: {
      supuestos,
      makespanActual: redondear(propuesta.makespanOriginal, 2),
      makespanPropuesto: redondear(propuesta.makespanPropuesto, 2),
      cuelloDeBotella: propuesta.cuelloDeBotella,
      horasTotalesActual: redondear(evaluacion.horasRequeridas, 2),
      horasTotalesPropuesto: redondear(ev2.horasRequeridas, 2),
      factorProduccion: redondear(propuesta.factorDeProduccion, 3),
      toneladasActuales: redondear(programa.kilogramos / 1000, 1),
      toneladasIncremento: redondear(propuesta.toneladasPorBalanceo, 1),
      toneladasDentroDelHorizonte: redondear(propuesta.deltaToneladas, 2),
      ordenesMovidas: movimientos.reduce((t, m) => t + m.ordenes, 0),
      ...prod,
      // La cifra TITULAR: la que resume el folio en un renglon del historial.
      // Cada objetivo gana algo distinto, asi que no puede ser siempre la
      // misma. Con 'rendimiento' el cierre casi no se mueve a proposito, y
      // toneladasIncremento salia en +4.1 t mientras el analisis decia +59.2.
      toneladasGanadas:
        objetivo === 'rendimiento' ? prod.toneladasPorTiempo : redondear(propuesta.toneladasPorBalanceo, 1),
      objetivo,
      avisos: reunirAvisos(programa, lineas, tabla, evaluacion, propuesta),
      sinReceta: evaluacion.sinReceta.map((o) => ({
        orden: o.id,
        linea: o.linea,
        diametroMm: o.diametroMm,
        kilogramos: o.kilogramos,
      })),
      lineas: detalleLineas.map(({ linea, actual, propuesto }) => ({ linea, actual, propuesto })),
      movimientos,
    },
    lineas: detalleLineas,
    // La hoja de corridas: el mismo schedule visto por linea, con reloj y
    // rollos. No la calcula la pantalla para que el folio se vuelva a pintar
    // identico meses despues.
    inicioPrograma: inicioDelPrograma(archivo),
    corridas: {
      actual: hojaDeCorridas(evaluacion),
      propuesto: hojaDeCorridas(ev2),
    },
    detalleOrdenes: programa.ordenes.map((o) => ({
      ...o,
      lineaPropuesta: lineaPropuestaDe.get(o.id) ?? o.linea,
    })),
  };
}

/**
 * Las dos causas de la oportunidad, que se confunden facil:
 *
 *   RITMO    cada linea corre su mezcla de diametros a cierto kg/h. Mover
 *            ordenes a lineas mas rapidas sube el ritmo promedio de la planta.
 *   BALANCE  el programa cierra cuando termina su linea mas cargada, asi que
 *            repartir la carga evita que las demas se queden paradas.
 *
 * No se reparten en una suma a proposito. Se intento y da cero por ritmo, lo
 * que se lee como un error cuando en realidad es el hallazgo: con el schedule
 * del 17/09 el ritmo sube 2.1% y el cierre baja 27%, asi que practicamente
 * toda la ganancia es balance. Se publican los dos numeros por separado, mas
 * el cierre que se alcanzaria balanceando SIN mover nada a una linea mas
 * rapida, que es la vara para comparar.
 *
 * Aparte va el TIEMPO GANADO, que si suma exacto. Las horas de una linea son
 * horas de corrida mas horas de cambio y nada mas, asi que el ahorro total se
 * parte en esas dos y no hay forma de contar doble:
 *
 *   horas de corrida ahorradas  = mismos kg a un ritmo mejor
 *   horas de cambio ahorradas   = cambios de medida evitados x el estandar
 *   ------------------------------------------------------------------
 *   horas ahorradas             = lo que se libera en toda la planta
 *
 * Cada renglon se pasa a toneladas al ritmo de la planta ya rebalanceada:
 * es lo que esas horas producirian si se llenaran con mas material.
 */
function productividad(evaluacion, ev2, propuesta) {
  const totales = (ev) => {
    let kg = 0;
    let produccion = 0;
    let cambio = 0;
    let cambios = 0;
    for (const r of ev.lineas.values()) {
      kg += r.kgProgramados;
      produccion += r.horasProduccion;
      cambio += r.horasCambio;
      cambios += r.cambios;
    }
    return { kg, produccion, cambio, cambios, ritmo: produccion > 0 ? kg / produccion : 0 };
  };

  const a = totales(evaluacion);
  const d = totales(ev2);

  // El mejor cierre posible sin cambiar una sola hora de corrida: repartir
  // las horas de hoy en partes iguales entre las lineas disponibles.
  const activas = [...evaluacion.lineas.values()].filter((r) => r.linea.activa).length;

  // Toneladas equivalentes: la hora liberada vale lo que la planta produce en
  // una hora DESPUES del rebalanceo. Se usa el ritmo nuevo y no el viejo para
  // no inflar la cifra con un ritmo que ya no aplica.
  const enToneladas = (horas) => (horas * d.ritmo) / 1000;
  const horasProduccionAhorradas = a.produccion - d.produccion;
  const horasCambioAhorradas = a.cambio - d.cambio;

  return {
    ritmoActual: redondear(a.ritmo, 1),
    ritmoPropuesto: redondear(d.ritmo, 1),
    ritmoCambioPct: a.ritmo > 0 ? redondear((d.ritmo / a.ritmo - 1) * 100, 1) : 0,
    cierreSoloBalance: activas > 0 ? redondear(evaluacion.horasRequeridas / activas, 2) : 0,

    horasProduccionActual: redondear(a.produccion, 1),
    horasProduccionPropuesto: redondear(d.produccion, 1),
    horasProduccionAhorradas: redondear(horasProduccionAhorradas, 1),
    horasCambioActual: redondear(a.cambio, 1),
    horasCambioPropuesto: redondear(d.cambio, 1),
    horasCambioAhorradas: redondear(horasCambioAhorradas, 1),
    horasAhorradas: redondear(horasProduccionAhorradas + horasCambioAhorradas, 1),
    cambiosActual: a.cambios,
    cambiosPropuesto: d.cambios,
    cambiosEvitados: a.cambios - d.cambios,

    toneladasPorRitmo: redondear(enToneladas(horasProduccionAhorradas), 1),
    toneladasPorCambios: redondear(enToneladas(horasCambioAhorradas), 1),
    toneladasPorTiempo: redondear(
      enToneladas(horasProduccionAhorradas + horasCambioAhorradas),
      1,
    ),
  };
}

function resumenLinea(r) {
  const diametros = [...new Set(r.corridas.map((c) => c.orden.diametroMm))].sort((a, b) => a - b);
  return {
    ordenes: r.corridas.length,
    kg: redondear(r.kgProgramados, 0),
    kgProducibles: redondear(r.kgProducibles, 0),
    horas: redondear(r.horasRequeridas, 2),
    horasProduccion: redondear(r.horasProduccion, 2),
    horasCambio: redondear(r.horasCambio, 2),
    cambios: r.cambios,
    utilizacion: redondear(r.utilizacion * 100, 1),
    // El ritmo de la linea segun la mezcla de diametros que le toca. Es lo
    // que cambia el rebalanceo cuando mueve una orden a otra linea, y no
    // siempre para arriba: una linea puede quedar mas lenta a proposito, si
    // con eso descarga a la que estaba frenando todo el programa.
    kgHora: r.horasProduccion > 0 ? redondear(r.kgProgramados / r.horasProduccion, 1) : 0,
    diametros,
  };
}


/** Matriz diametro x linea con el kg/h de cada combinacion. */
export function matrizRendimiento(tabla, programa) {
  const representantes = new Map();
  for (const o of programa.ordenes) if (!representantes.has(o.diametroMm)) representantes.set(o.diametroMm, o);
  const lineas = tabla.lineas;

  const filas = [...representantes.keys()]
    .sort((a, b) => a - b)
    .map((diametroMm) => {
      const orden = representantes.get(diametroMm);
      const celdas = {};
      let mejorLinea = null;
      let mejorKgH = 0;
      for (const l of lineas) {
        const kgh = tabla.kgHora(l, orden);
        celdas[l] = kgh === null ? null : Math.round(kgh * 10) / 10;
        if (kgh && kgh > mejorKgH) {
          mejorKgH = kgh;
          mejorLinea = l;
        }
      }
      return { diametroMm, celdas, mejorLinea, mejorKgH: Math.round(mejorKgH * 10) / 10 };
    });

  return { lineas, filas };
}

