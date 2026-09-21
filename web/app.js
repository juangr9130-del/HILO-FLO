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

/** Un folio se calculo con las velocidades de ese momento: si cambian, deja
 *  de reflejar la realidad y hay que volver a analizar. */
function marcarProgramaDesactualizado() {
  analisis.marcarDesactualizado();
}

async function pintarHistorial() {
  const lista = await (await fetch('/api/programas')).json();
  if (!lista.length) return ($('historial').innerHTML = '');
  $('historial').innerHTML = `
    <h3 style="font-size:15px;color:var(--azul);margin:0 0 8px">Previous programs</h3>
    <table>
      <tr><th>Ticket</th><th>File</th><th>Orders</th><th>Tons</th><th>Opportunity</th></tr>
      ${lista
        .map(
          (p) => `<tr>
            <td><a href="#" data-folio="${p.folio}">${p.folio}</a></td>
            <td style="text-align:left;color:var(--texto-tenue)">${p.archivo ?? ''}</td>
            <td class="num">${num(p.ordenes)}</td>
            <td class="num">${num((p.kilogramos ?? 0) / 1000, 1)}</td>
            <td class="num" style="color:var(--verde)">+${num(p.toneladasIncremento, 1)} t</td>
          </tr>`,
        )
        .join('')}
    </table>`;
  $('historial').querySelectorAll('a[data-folio]').forEach((a) =>
    a.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const r = await fetch(`/api/programas/${a.dataset.folio}`);
      if (r.ok) mostrar(await r.json());
    }),
  );
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
  mostrar(await r.json());
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

arrancar();
