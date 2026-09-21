// ===== interfaz del demo ======================================================
//
// Lo mismo que hace web/app.js, pero sin servidor: el analisis corre aqui
// mismo con el motor inlineado arriba.

const $ = (id) => document.getElementById(id);
const num = (v, d = 0) =>
  (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const LLAVE = 'hiloflo.demo.v1';

/**
 * Version de la forma del paquete que se guarda en el navegador.
 *
 * Se sube cada vez que el analisis agrega campos. Los folios guardados con
 * una version anterior no los traen, y al abrirlos la pantalla pintaba ceros
 * -- "plant average 0 kg/h" -- como si la planta estuviera parada. Ahora se
 * descartan al arrancar; los ajustes del catalogo no, que cuestan mas de
 * reponer que volver a subir un schedule.
 */
const VERSION_PAQUETE = 2;

let paquete = null;
let estado = cargarEstado();

// Los ajustes de velocidad viven encima de la semilla del WI. Ver
// catalogo/velocidades-catalogo.js.
let ajustes = new Map(Object.entries(estado.ajustes ?? {}));

/** Los puntos que consume el motor, ya con los ajustes aplicados. */
function recetasVigentes() {
  return puntosDelMotor(ajustes);
}

// --- persistencia en el navegador -------------------------------------------
// Es lo unico que reemplaza a SQL Server aqui. Puede fallar (modo incognito,
// cuota llena), y si falla el demo sigue funcionando en memoria.

function cargarEstado() {
  const vacio = { consecutivo: 0, programas: [], ajustes: {} };
  let guardado;
  try {
    guardado = JSON.parse(localStorage.getItem(LLAVE)) ?? vacio;
  } catch {
    return vacio;
  }
  return {
    ...vacio,
    ...guardado,
    programas: (guardado.programas ?? []).filter((p) => p.version === VERSION_PAQUETE),
  };
}

function guardarEstado() {
  estado.ajustes = Object.fromEntries(ajustes);
  try {
    localStorage.setItem(LLAVE, JSON.stringify(estado));
  } catch {
    // Cuota llena: se tiran los folios mas viejos y se reintenta una vez. Los
    // ajustes del catalogo NO se tiran: cuestan mas de reponer que un folio.
    estado.programas = estado.programas.slice(0, 2);
    try {
      localStorage.setItem(LLAVE, JSON.stringify(estado));
    } catch {
      /* el demo sigue con lo que trae en memoria */
    }
  }
}

function siguienteFolio() {
  estado.consecutivo += 1;
  return `FLO-${new Date().getFullYear()}-${String(estado.consecutivo).padStart(4, '0')}`;
}

// --- carga del schedule -----------------------------------------------------

const leerArchivo = (archivo) => archivo.arrayBuffer();

$('archivo-schedule').addEventListener('change', () => {
  $('paso-schedule').classList.toggle('listo', $('archivo-schedule').files.length > 0);
  revisarListo();
});

$('analizar').addEventListener('click', async () => {
  const archivo = $('archivo-schedule').files[0];
  if (!archivo) return;
  ocultarError();
  $('analizar').disabled = true;
  $('progreso').textContent = 'Analyzing… this takes a few seconds.';
  // Un respiro para que el navegador pinte el mensaje antes de bloquearse.
  await new Promise((r) => setTimeout(r, 30));

  try {
    const hoja = await leerHoja(await leerArchivo(archivo), HOJA_SCHEDULE);
    const programa = interpretarPrograma(hoja);
    const supuestos = { ...SUPUESTOS };
    const resultado = analizar(programa, recetasVigentes(), supuestos);

    const nuevo = empaquetar({
      folio: siguienteFolio(),
      archivo: archivo.name,
      cargadoPor: null,
      supuestos,
      ...resultado,
    });

    nuevo.version = VERSION_PAQUETE;
    estado.programas.unshift(nuevo);
    estado.programas = estado.programas.slice(0, 5);
    guardarEstado();
    pintarHistorial();
    await mostrar(nuevo);
  } catch (e) {
    mostrarError(e.message);
  } finally {
    $('analizar').disabled = false;
    $('progreso').textContent = '';
  }
});

function pintarEstadoRecetas() {
  const puntos = recetasVigentes();
  const lineas = new Set(puntos.map((p) => p.linea)).size;
  const r = resumenAjustes(ajustes);
  $('estado-recetas').textContent =
    `${num(puntos.length)} line speeds from ${DOCUMENTO}, ${lineas} lines. Already built into the app` +
    (r.total ? `, with ${r.total} ${r.total === 1 ? 'value adjusted' : 'values adjusted'}.` : '.');
}

function revisarListo() {
  $('analizar').disabled = !$('archivo-schedule').files.length;
}

const historial = montarHistorial({
  listar: async () => estado.programas,
  abrir: (folio) => {
    const p = estado.programas.find((x) => x.folio === folio);
    if (p) mostrar(p);
  },
  borrar: async (folio) => {
    estado.programas = estado.programas.filter((p) => p.folio !== folio);
    guardarEstado();
  },
  alBorrar: (folio) => {
    // Si era el que se estaba viendo, no tiene caso dejar las pantallas.
    if (paquete?.folio !== folio) return;
    paquete = null;
    $('folio').hidden = true;
    actualizarTabs();
    abrirPanel('carga');
  },
});

function pintarHistorial() {
  historial.refrescar();
}

// --- pintado -----------------------------------------------------------------

async function mostrar(p) {
  paquete = p;
  $('folio').hidden = false;
  $('folio').textContent = p.folio;
  await analisis.mostrar(p);
  actualizarTabs();
  abrirPanel('programacion');
}

// El pintado del analisis vive en comun/pantalla-analisis.js: lo comparten
// las dos interfaces. Aqui solo se le inyecta lo que el demo hace distinto.

const analisis = montarAnalisis({
  marcarMovimiento: () => guardarEstado(),
  obtenerMatriz: (p) => {
    const lineas = catalogoLineas(p.supuestos);
    const tabla = new TablaVelocidades(recetasVigentes(), lineas);
    const programa = new Programa(p.detalleOrdenes.map((o) => new Orden(o)));
    return matrizRendimiento(tabla, programa);
  },
});

// --- catalogo de velocidades -------------------------------------------------
// La pantalla es la misma que usa el modulo instalado (comun/pantalla-catalogo.js);
// aqui solo se le dice de donde salen los datos y a donde van los cambios.

$('ir-velocidades').addEventListener('click', () => abrirPanel('velocidades'));

const catalogo = montarCatalogo({
  datos: async () => ({
    documento: DOCUMENTO,
    eficiencia: SUPUESTOS.eficiencia,
    resumen: resumenAjustes(ajustes),
    grupos: catalogoParaPantalla(ajustes, { eficiencia: SUPUESTOS.eficiencia }),
  }),
  revisar: (clave, mmS) => revisarAjuste(clave, mmS),
  guardar: async (clave, mmS) => {
    ajustes.set(clave, mmS);
    guardarEstado();
  },
  quitar: async (clave) => {
    ajustes.delete(clave);
    guardarEstado();
  },
  restablecer: async () => {
    ajustes = new Map();
    guardarEstado();
  },
  alCambiar: () => {
    marcarProgramaDesactualizado();
    pintarEstadoRecetas();
  },
});

function pintarCatalogo() {
  catalogo.refrescar();
}

/** Un folio se calculo con las velocidades de ese momento: si cambian, deja
 *  de reflejar la realidad y hay que volver a analizar. */
function marcarProgramaDesactualizado() {
  analisis.marcarDesactualizado();
}

// --- navegacion --------------------------------------------------------------

$('tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-panel]');
  if (b) abrirPanel(b.dataset.panel);
});

function abrirPanel(nombre) {
  for (const b of $('tabs').querySelectorAll('button')) {
    b.setAttribute('aria-selected', String(b.dataset.panel === nombre));
  }
  for (const p of ['programacion', 'analisis', 'rendimiento', 'velocidades']) {
    $(`panel-${p}`).hidden = p !== nombre;
  }
  $('carga').hidden = nombre !== 'carga';
}

/** Las pantallas que necesitan un programa no se ofrecen hasta que haya uno. */
function actualizarTabs() {
  for (const b of $('tabs').querySelectorAll('button[data-requiere-programa]')) {
    b.hidden = !paquete;
  }
}

$('ver-actual').addEventListener('click', () => cambiarVista('actual'));
$('ver-propuesto').addEventListener('click', () => cambiarVista('propuesto'));

function cambiarVista(cual) {
  $('ver-actual').setAttribute('aria-pressed', String(cual === 'actual'));
  $('ver-propuesto').setAttribute('aria-pressed', String(cual === 'propuesto'));
  analisis.cambiarVista(cual);
}

function mostrarError(mensaje) {
  $('error').textContent = mensaje;
  $('error').hidden = false;
}
function ocultarError() {
  $('error').hidden = true;
}

// --- arranque ----------------------------------------------------------------

pintarEstadoRecetas();
pintarCatalogo();
pintarHistorial();
actualizarTabs();
abrirPanel('carga');
