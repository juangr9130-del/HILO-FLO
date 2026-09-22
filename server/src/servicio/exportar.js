/**
 * El schedule reajustado, de vuelta en Excel.
 *
 * El analisis no sirve de nada si se queda en la pantalla: el programador
 * tiene que mandarlo por correo y que del otro lado lo lean sin explicaciones.
 * Por eso la hoja principal sale con EL MISMO formato que entro -- mismo
 * titulo, mismos nueve encabezados, mismos subtotales por work center -- y lo
 * unico que cambia es el work center de las ordenes cuyo movimiento se
 * ACEPTO. Asi el archivo se puede volver a subir al modulo, o pegar en SAP,
 * sin traducir nada.
 *
 * Lo que se agrega va DESPUES de la novena columna, para no correr las que ya
 * existian, y en una segunda hoja con el resumen. Un lector que solo conozca
 * el formato de SAP ignora lo de mas y sigue funcionando.
 *
 * Solo se aplican los movimientos aceptados. Un consejo que el programador no
 * marco no se toca: el archivo tiene que reflejar lo que EL decidio, no lo
 * que el algoritmo propuso.
 */

import { construirXlsx, ESTILO } from '../xlsx/escritor.js';
import { lineaAWorkCenter } from '../motor/modelos.js';
import { redondear } from '../util/numeros.js';

/** Los nueve encabezados del schedule de SAP, en su orden. */
export const ENCABEZADOS = [
  'Work Center',
  'Material Number',
  'Material Description',
  'Important Notes',
  'Order',
  'PO Printed Yes/No',
  'Drawn Yes/No',
  'Operation Quantity (MEINH)',
  'Customer PO',
];

/** Lo que el modulo agrega al final, para que el cambio se explique solo. */
export const ENCABEZADOS_EXTRA = ['Previous Work Center', 'Change', 'Reason'];

/**
 * Las ordenes que de verdad se mueven: solo las de movimientos aceptados.
 *
 * @returns {Map<string, {destino: string, movimiento: object}>} por id de orden
 */
export function movimientosAceptados(paquete) {
  const porOrden = new Map();
  for (const m of paquete.analisis.movimientos) {
    if (m.aceptado !== true) continue;
    for (const folio of m.folios) porOrden.set(String(folio), { destino: m.destino, movimiento: m });
  }
  return porOrden;
}

/**
 * Texto corto que explica por que se movio esa orden.
 *
 * El kg/h sale de los kilos y las horas que ya trae el movimiento, para no
 * volver a consultar la tabla de recetas desde aqui: el paquete tiene que
 * bastarse solo, que es lo que permite reexportar un folio viejo.
 */
function motivo(m) {
  const origen = m.horasOrigen > 0 ? m.kilogramos / m.horasOrigen : 0;
  const destino = m.horasDestino > 0 ? m.kilogramos / m.horasDestino : 0;
  if (!origen || !destino) return `Rebalanced from ${m.origen} to ${m.destino}`;
  const pct = redondear((destino / origen - 1) * 100, 0);
  return `${Math.round(origen)} to ${Math.round(destino)} kg/h (${pct > 0 ? '+' : ''}${pct}%)`;
}

/**
 * La hoja principal: el schedule con los movimientos aceptados aplicados.
 *
 * Se reagrupa por work center, porque de eso vive el formato: SAP entrega un
 * bloque por linea con su subtotal. Una orden movida aparece en el bloque de
 * su linea NUEVA, que es donde la va a buscar quien lea el archivo.
 */
function hojaSchedule(paquete, aceptados) {
  const filas = [];
  const estilos = [];
  const titulo = `CSW Production Schedule — ticket ${paquete.folio}`;

  filas.push([titulo]);
  estilos.push([ESTILO.TITULO]);
  filas.push([...ENCABEZADOS, ...ENCABEZADOS_EXTRA]);
  estilos.push(new Array(ENCABEZADOS.length + ENCABEZADOS_EXTRA.length).fill(ESTILO.ENCABEZADO));

  // Cada orden a su work center final
  const porLinea = new Map();
  for (const o of paquete.detalleOrdenes) {
    const mov = aceptados.get(String(o.id));
    const linea = mov ? mov.destino : o.linea;
    if (!porLinea.has(linea)) porLinea.set(linea, []);
    porLinea.get(linea).push({ orden: o, mov });
  }

  const claves = [...porLinea.keys()].sort(
    (a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')),
  );

  let granTotal = 0;
  for (const linea of claves) {
    const wc = lineaAWorkCenter(linea);
    let subtotal = 0;
    for (const { orden: o, mov } of porLinea.get(linea)) {
      subtotal += o.kilogramos;
      filas.push([
        wc,
        o.material ?? '',
        o.descripcion ?? '',
        o.notas ?? '',
        o.id,
        '',
        '',
        o.kilogramos,
        o.clientePo ?? '',
        mov ? lineaAWorkCenter(mov.movimiento.origen) : '',
        mov ? 'MOVED' : '',
        mov ? motivo(mov.movimiento) : '',
      ]);
      // El renglon movido se resalta: quien recibe el correo tiene que ver
      // de un vistazo que cambio y que no.
      estilos.push(mov ? new Array(12).fill(ESTILO.MOVIDO) : []);
    }
    // Subtotal del bloque, igual que lo entrega SAP.
    filas.push([wc, 'nan', 'nan', '', 0, '', '', redondear(subtotal, 0), '']);
    estilos.push(new Array(9).fill(ESTILO.TOTAL));
    granTotal += subtotal;
  }

  filas.push(['nan', 'nan', 'nan', '', 0, '', '', redondear(granTotal, 0), '']);
  estilos.push(new Array(9).fill(ESTILO.TOTAL));

  return {
    nombre: 'Sheet1',
    filas,
    estilos,
    anchos: [12, 14, 40, 44, 12, 16, 14, 22, 14, 18, 10, 26],
    combinar: ['A1:I1'],
  };
}

/** La segunda hoja: que se decidio, cuanto se gana y con que supuestos. */
function hojaResumen(paquete, aceptados) {
  const a = paquete.analisis;
  const filas = [];
  const estilos = [];
  const seccion = (t) => { filas.push([t]); estilos.push([ESTILO.TITULO]); };
  const par = (k, v) => { filas.push([k, v]); estilos.push([]); };

  seccion(`HILO-FLO — ticket ${paquete.folio}`);
  par('Source file', paquete.archivo ?? '');
  par('Analyzed', paquete.cargadoEn ?? '');
  par('Orders', paquete.ordenes);
  par('Tons', a.toneladasActuales);
  filas.push([]); estilos.push([]);

  seccion('What this rebalance gains');
  par('Plant rate now (kg/h)', a.ritmoActual);
  par('Plant rate rebalanced (kg/h)', a.ritmoPropuesto);
  par('Line hours saved', a.horasAhorradas);
  par('Worth in product (t)', a.toneladasPorTiempo);
  par('Program finishes in (h)', a.makespanPropuesto);
  filas.push([]); estilos.push([]);

  seccion('Assumptions');
  par('Objective', a.objetivo ?? paquete.supuestos?.objetivo ?? '');
  par('Hours available per line', paquete.supuestos?.horasDisponibles ?? '');
  par('Changeover (min)', paquete.supuestos?.minutosCambio ?? '');
  par('Max change per line (coils)', paquete.supuestos?.topeOrdenes ?? '');
  par('Line speeds', `${paquete.recetas ?? ''} recipes`);
  filas.push([]); estilos.push([]);

  seccion('Moves');
  filas.push(['#', 'From', 'To', 'Ø mm', 'Coils', 'kg', 'Hours freed', 'Decision']);
  estilos.push(new Array(8).fill(ESTILO.ENCABEZADO));
  for (const m of a.movimientos) {
    filas.push([
      m.id,
      m.origen,
      m.destino,
      m.diametroMm,
      m.ordenes,
      m.kilogramos,
      m.horasLiberadas,
      m.aceptado === true ? 'ACCEPTED' : m.aceptado === false ? 'not applicable' : 'not decided',
    ]);
    estilos.push(m.aceptado === true ? new Array(8).fill(ESTILO.MOVIDO) : []);
  }
  filas.push([]); estilos.push([]);
  par('Coils actually moved in this file', [...aceptados.keys()].length);

  return { nombre: 'Summary', filas, estilos, anchos: [30, 18, 12, 10, 10, 12, 14, 16] };
}

/** Nombre del archivo que se descarga. */
export function nombreArchivo(paquete) {
  const base = String(paquete.archivo ?? 'schedule').replace(/\.[^.]+$/, '');
  return `${base}_${paquete.folio}_rebalanced.xlsx`;
}

/**
 * El .xlsx completo.
 *
 * @param {object} paquete  el folio tal como lo pinta la pantalla
 * @returns {Uint8Array}
 */
export function exportarPrograma(paquete) {
  const aceptados = movimientosAceptados(paquete);
  return construirXlsx([hojaSchedule(paquete, aceptados), hojaResumen(paquete, aceptados)]);
}
