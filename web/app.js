/**
 * Pantalla de HILO-FLO.
 *
 * No calcula nada: el backend manda el paquete ya resuelto y aqui solo se
 * dibuja. Asi el mismo folio se vuelve a pintar identico meses despues.
 */

const $ = (id) => document.getElementById(id);
const num = (v, d = 0) =>
  (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

let paquete = null;

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function arrancar() {
  try {
    const estado = await (await fetch('/api/estado')).json();
    $('usuario').textContent = estado.usuario?.demo
      ? 'demo mode'
      : (estado.usuario?.nombre ?? estado.usuario?.numeroEmpleado ?? '');
    await catalogo.refrescar();
    await reglas.refrescar();
    await pintarEstadoRecetas();
    await pintarHistorial();
    actualizarTabs();
    abrirPanel('carga');
  } catch (e) {
    mostrarError(`Could not reach the module: ${e.message}`);
  }
}

function revisarListo() {
  $('analizar').disabled = !$('archivo-schedule').files.length;
}

/** El catalogo ya viene dentro del modulo: aqui solo se resume su estado. */
async function pintarEstadoRecetas() {
  const v = await (await fetch('/api/velocidades')).json();
  const lineas = new Set(v.grupos.map((g) => g.linea)).size;
  const puntos = v.grupos.reduce((t, g) => t + g.puntos.length, 0);
  $('estado-recetas').textContent =
    `${num(puntos)} line speeds from ${v.documento}, ${lineas} lines. Already built into the module` +
    (v.resumen.total
      ? `, with ${v.resumen.total} ${v.resumen.total === 1 ? 'value adjusted' : 'values adjusted'}.`
      : '.');
}

// La pantalla de velocidades es la misma que usa el modulo demo
// (comun/pantalla-catalogo.js); aqui se le conecta la API.
const catalogo = montarCatalogo({
  datos: () => fetch('/api/velocidades').then((r) => r.json()),
  revisar: (clave, mmS) => {
    const v = Number(mmS);
    if (!Number.isFinite(v)) return 'the speed has to be a number';
    if (v <= 0) return 'the speed has to be greater than zero';
    if (v > 2000) return 'that speed is out of range (2000 mm/s max)';
    return null;
  },
  guardar: (clave, mmS) =>
    fetch(`/api/velocidades/${encodeURIComponent(clave)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mmS }),
    }),
  quitar: (clave) =>
    fetch(`/api/velocidades/${encodeURIComponent(clave)}`, { method: 'DELETE' }),
  restablecer: () => fetch('/api/velocidades', { method: 'DELETE' }),
  alCambiar: () => {
    marcarProgramaDesactualizado();
    pintarEstadoRecetas();
  },
});

$('ir-velocidades').addEventListener('click', () => abrirPanel('velocidades'));

// Las reglas del reajuste: la misma pantalla del demo, conectada a la API.
const reglas = montarReglas({
  datos: () => fetch('/api/reglas').then((r) => r.json()),
  guardar: (clave, valor) =>
    fetch(`/api/reglas/${encodeURIComponent(clave)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor }),
    }),
  quitar: (clave) => fetch(`/api/reglas/${encodeURIComponent(clave)}`, { method: 'DELETE' }),
  rangos: () => fetch('/api/rangos').then((r) => r.json()),
  restricciones: () => fetch('/api/restricciones').then((r) => r.json()),
  guardarRango: (linea, [min, max]) =>
    fetch(`/api/rangos/${encodeURIComponent(linea)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ min, max }),
    }),
  quitarRango: (linea) => fetch(`/api/rangos/${encodeURIComponent(linea)}`, { method: 'DELETE' }),
  alCambiar: () => marcarProgramaDesactualizado(),
  hayPrograma: () => Boolean(paquete),
  reanalizar: async () => {
    const r = await fetch(`/api/programas/${paquete.folio}/reanalizar`, { method: 'POST' });
    if (!r.ok) return mostrarError((await r.json()).error);
    await mostrar(await r.json());
    await pintarHistorial();
  },
});

/** Un folio se calculo con las velocidades de ese momento: si cambian, deja
 *  de reflejar la realidad y hay que volver a analizar. */
function marcarProgramaDesactualizado() {
  analisis.marcarDesactualizado();
}

const historial = montarHistorial({
  listar: () => fetch('/api/programas').then((r) => r.json()),
  abrir: async (folio) => {
    const r = await fetch(`/api/programas/${folio}`);
    if (r.ok) mostrar(await r.json());
  },
  borrar: async (folio) => {
    const r = await fetch(`/api/programas/${folio}`, { method: 'DELETE' });
    if (!r.ok) mostrarError((await r.json()).error);
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

async function pintarHistorial() {
  await historial.refrescar();
}

// ---------------------------------------------------------------------------
// Carga de archivos
// ---------------------------------------------------------------------------

$('archivo-schedule').addEventListener('change', () => {
  $('paso-schedule').classList.toggle('listo', $('archivo-schedule').files.length > 0);
  revisarListo();
});

$('analizar').addEventListener('click', async () => {
  const archivo = $('archivo-schedule').files[0];
  if (!archivo) return;
  $('analizar').disabled = true;
  $('progreso').textContent = 'Analyzing… this takes a few seconds.';
  ocultarError();

  const datos = new FormData();
  datos.append('archivo', archivo);
  const r = await fetch('/api/programas', { method: 'POST', body: datos });
  $('progreso').textContent = '';
  $('analizar').disabled = false;

  if (!r.ok) return mostrarError((await r.json()).error);
  await mostrar(await r.json());
  await pintarHistorial();
});

// ---------------------------------------------------------------------------
// Pintado
// ---------------------------------------------------------------------------

async function mostrar(p) {
  paquete = p;
  $('folio').hidden = false;
  $('folio').textContent = p.folio;
  await analisis.mostrar(p);
  actualizarTabs();
  abrirPanel('programacion');
}

// El pintado del análisis vive en comun/pantalla-analisis.js: lo comparten
// las dos interfaces. Aquí sólo se le inyecta lo que el módulo instalado
// hace distinto.

const analisis = montarAnalisis({
  marcarMovimiento: (id, aceptado) =>
    fetch(`/api/programas/${paquete.folio}/movimientos/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aceptado }),
    }),
  obtenerMatriz: async (p) => {
    const r = await fetch(`/api/programas/${p.folio}/rendimiento`);
    return r.ok ? r.json() : { lineas: [], filas: [] };
  },
});

// El archivo lo arma el servidor: ahí vive el estado de qué consejos aceptó
// el programador, que puede haber cambiado después de guardar el folio.
$('exportar').addEventListener('click', () => {
  if (!paquete) return;
  window.location.href = `/api/programas/${paquete.folio}/excel`;
});

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

$('tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-panel]');
  if (b) abrirPanel(b.dataset.panel);
});

function abrirPanel(nombre) {
  for (const b of $('tabs').querySelectorAll('button')) {
    b.setAttribute('aria-selected', String(b.dataset.panel === nombre));
  }
  for (const p of ['programacion', 'corridas', 'analisis', 'rendimiento', 'reglas', 'velocidades']) {
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

// ---------- Hoja de corridas ----------
// Trae su propio selector de vista: el tablero y la hoja son dos lecturas
// distintas del mismo folio y el programador las cruza.

$('corridas-actual').addEventListener('click', () => cambiarVistaCorridas('actual'));
$('corridas-propuesto').addEventListener('click', () => cambiarVistaCorridas('propuesto'));
$('corridas-linea').addEventListener('change', (ev) => analisis.filtrarLinea(ev.target.value));

function cambiarVistaCorridas(cual) {
  $('corridas-actual').setAttribute('aria-pressed', String(cual === 'actual'));
  $('corridas-propuesto').setAttribute('aria-pressed', String(cual === 'propuesto'));
  analisis.cambiarVistaCorridas(cual);
}

$('hoja-corridas').addEventListener('click', (ev) => {
  const fila = ev.target.closest('tr.corrida');
  if (fila) analisis.alternarCorrida(fila.dataset.corrida);
});

function mostrarError(mensaje) {
  $('error').textContent = mensaje;
  $('error').hidden = false;
}
function ocultarError() {
  $('error').hidden = true;
}

arrancar();
