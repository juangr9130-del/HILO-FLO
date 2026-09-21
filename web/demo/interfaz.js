// ===== interfaz del demo ======================================================
//
// Lo mismo que hace web/app.js, pero sin servidor: el analisis corre aqui
// mismo con el motor inlineado arriba.

const $ = (id) => document.getElementById(id);
const num = (v, d = 0) =>
  (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const LLAVE = 'hiloflo.demo.v1';

let paquete = null;
let vista = 'actual';
let estado = cargarEstado();

// Los ajustes de velocidad viven encima de la semilla del WI. Ver
// catalogo/velocidades-catalogo.js.
let ajustes = new Map(Object.entries(estado.ajustes ?? {}));
let programaDesactualizado = false;

/** Los puntos que consume el motor, ya con los ajustes aplicados. */
function recetasVigentes() {
  return puntosDelMotor(ajustes);
}

// --- persistencia en el navegador -------------------------------------------
// Es lo unico que reemplaza a SQL Server aqui. Puede fallar (modo incognito,
// cuota llena), y si falla el demo sigue funcionando en memoria.

function cargarEstado() {
  try {
    return JSON.parse(localStorage.getItem(LLAVE)) ?? { consecutivo: 0, programas: [], ajustes: {} };
  } catch {
    return { consecutivo: 0, programas: [], ajustes: {} };
  }
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

    estado.programas.unshift(nuevo);
    estado.programas = estado.programas.slice(0, 5);
    programaDesactualizado = false;
    guardarEstado();
    mostrar(nuevo);
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

function pintarHistorial() {
  if (!estado.programas.length) return ($('historial').innerHTML = '');
  $('historial').innerHTML = `
    <h3 style="font-size:15px;color:var(--azul);margin:0 0 8px">Previous programs</h3>
    <table>
      <tr><th>Ticket</th><th>File</th><th>Orders</th><th>Tons</th><th>Opportunity</th></tr>
      ${estado.programas
        .map(
          (p) => `<tr>
            <td><a href="#" data-folio="${p.folio}">${p.folio}</a></td>
            <td style="text-align:left;color:var(--texto-tenue)">${p.archivo ?? ''}</td>
            <td class="num">${num(p.ordenes)}</td>
            <td class="num">${num(p.kilogramos / 1000, 1)}</td>
            <td class="num" style="color:var(--verde)">+${num(p.analisis.toneladasIncremento, 1)} t</td>
          </tr>`,
        )
        .join('')}
    </table>`;
  for (const a of $('historial').querySelectorAll('a[data-folio]')) {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const p = estado.programas.find((x) => x.folio === a.dataset.folio);
      if (p) mostrar(p);
    });
  }
}

// --- pintado -----------------------------------------------------------------

function mostrar(p) {
  paquete = p;
  $('folio').hidden = false;
  $('folio').textContent = p.folio;
  pintarKpis();
  pintarTablero();
  pintarConsejos();
  pintarTablaLineas();
  pintarRendimiento();
  actualizarTabs();
  abrirPanel('programacion');
}

function pintarKpis() {
  const a = paquete.analisis;
  const gana = a.toneladasIncremento > 0.05;
  const bloques = [
    kpi('Finishes today in', num(a.makespanActual, 1), 'h', `how long ${a.cuelloDeBotella} takes`, 'malo'),
    kpi('Rebalanced', num(a.makespanPropuesto, 1), 'h',
        `${num(a.makespanActual - a.makespanPropuesto, 1)} h earlier`, gana ? 'bueno' : ''),
    kpi('Extra output', `+${num(a.toneladasIncremento, 1)}`, 't',
        `on top of the program's ${num(a.toneladasActuales, 1)} t`, gana ? 'bueno' : ''),
    kpi('Orders to move', num(a.ordenesMovidas), `of ${num(paquete.ordenes)}`,
        `${a.movimientos.length} moves`, ''),
  ].join('');
  $('kpis-programacion').innerHTML = bloques;
  $('kpis-analisis').innerHTML = bloques;
  pintarAvisos(a.avisos ?? []);
}

function kpi(etiqueta, valor, unidad, pie, clase) {
  return `<div class="kpi ${clase}">
    <div class="etiqueta">${etiqueta}</div>
    <div class="valor">${valor}<small>${unidad}</small></div>
    <div class="pie">${pie}</div>
  </div>`;
}

function pintarAvisos(avisos) {
  const desactualizado = programaDesactualizado
    ? `<div class="aviso nota">
         <strong>You changed line speeds after analyzing ticket ${paquete.folio}.</strong>
         What you see was calculated with the old ones. Upload the schedule again so
         the analysis uses the new speeds.
       </div>`
    : '';
  $('avisos').innerHTML = desactualizado + avisos
    .map((av) => (av.tipo === 'devanador_no_indicado' ? pintarAvisoDevanador(av) : pintarAvisoSinReceta(av)))
    .join('');
}

function pintarAvisoDevanador(av) {
  const recorre = av.cierreSiAlterno - av.cierreAsumido;
  return `<div class="aviso nota">
    <strong>${av.ordenes} orders (${num(av.kilogramos)} kg) have no winder noted in the schedule.</strong>
    They were calculated with the <b>${av.asumido}</b> winder, which is the standard.
    If they actually ran on the ${av.alterno} winder, the program does not finish in
    <b>${num(av.cierreAsumido, 1)} h</b> but in <b>${num(av.cierreSiAlterno, 1)} h</b>
    ${recorre > 0.05 ? `— <b>${num(recorre, 1)} h more</b>` : ''}.
    <div style="margin-top:5px;color:var(--texto-tenue)">
      ${av.lineas.map((l) => `${l.linea}: ${l.ordenes} orders, ${num(l.kilogramos)} kg`).join(' · ')}
    </div>
  </div>`;
}

function pintarAvisoSinReceta(av) {
  const d = av.detalle;
  return `<div class="aviso error">
    <strong>${av.ordenes} orders (${num(av.kilogramos)} kg) are on a line with no speed for that diameter.</strong>
    They are left out of every total:
    ${d.slice(0, 6).map((o) => `${o.orden} (${num(o.diametroMm, 2)} mm on ${o.linea})`).join(', ')}${d.length > 6 ? `, and ${d.length - 6} more` : ''}.
  </div>`;
}

function pintarTablero() {
  const propuesta = vista === 'propuesto';
  $('leyenda-tablero').textContent = propuesta
    ? 'how each line would look after moving the orders'
    : 'how each line is scheduled today';

  const tope = Math.max(...paquete.lineas.map((l) => Math.max(l.actual.horas, l.propuesto.horas)), 1);

  $('tablero').innerHTML = paquete.lineas
    .map((l) => {
      const d = propuesta ? l.propuesto : l.actual;
      const esCuello = !propuesta && l.linea === paquete.analisis.cuelloDeBotella;
      const delta = l.propuesto.horas - l.actual.horas;
      const corridas = propuesta
        ? paquete.lineas
            .flatMap((otra) => otra.corridas.map((c) => ({ ...c, origen: otra.linea })))
            .filter((c) => c.lineaPropuesta === l.linea)
        : l.corridas;

      return `<div class="linea ${l.activa ? '' : 'inactiva'}">
        <div class="rotulo">
          <div class="clave">${l.linea}</div>
          <div class="wc">${l.workCenter}${l.activa ? '' : ' · not installed yet'}</div>
        </div>
        <div class="contenido">
          <div class="barra ${esCuello ? 'cuello' : ''} ${propuesta ? 'propuesta' : ''}">
            <i class="corrida" style="width:${(d.horasProduccion / tope) * 100}%"></i>
            <i class="cambio" style="width:${(d.horasCambio / tope) * 100}%"></i>
          </div>
          <div class="horas">
            <b>${num(d.horas, 1)} h</b> · ${num(d.kg)} kg · ${d.ordenes} orders
            ${d.cambios ? ` · ${d.cambios} size changes` : ''}
            ${esCuello ? ' · <span style="color:var(--rojo);font-weight:600">bottleneck</span>' : ''}
            ${propuesta && Math.abs(delta) > 0.05
              ? ` · <span class="${delta < 0 ? 'baja' : 'sube'}">${delta < 0 ? '−' : '+'}${num(Math.abs(delta), 1)} h</span>`
              : ''}
          </div>
          <div class="corridas">${corridas.map((c) => rollo(c, l.linea, propuesta)).join('')}</div>
        </div>
      </div>`;
    })
    .join('');
}

function rollo(c, clave, propuesta) {
  let clase = '';
  let marca = '';
  if (propuesta && c.origen && c.origen !== clave) {
    clase = 'entra';
    marca = ` <span class="destino">← ${c.origen}</span>`;
  } else if (!propuesta && c.movida) {
    clase = 'sale';
    marca = ` <span class="destino">→ ${c.lineaPropuesta}</span>`;
  }
  if (c.sinReceta) clase = 'sin-receta';
  const t = c.sinReceta ? 'no speed' : `${num(c.horas, 1)} h`;
  return `<span class="rollo ${clase}" title="${c.orden} · ${c.descripcion ?? ''}">
    <span class="d">${num(c.diametroMm, 2)}</span> · ${num(c.kilogramos)} kg · ${t}${marca}
  </span>`;
}

function pintarConsejos() {
  const a = paquete.analisis;
  if (!a.movimientos.length) {
    $('consejos').innerHTML =
      '<div class="vacio">The program is already balanced with the available line speeds. Nothing to move.</div>';
    return;
  }

  $('consejos').innerHTML =
    `<div class="cuerpo" style="border-bottom:1px solid var(--borde)">
      Today the program finishes in <b>${num(a.makespanActual, 1)} h</b>, which is how long
      <b>${a.cuelloDeBotella}</b> takes; the other lines finish earlier and sit idle.
      With these ${a.movimientos.length} moves it finishes in <b>${num(a.makespanPropuesto, 1)} h</b>,
      and the same calendar fits <b>${num(a.factorProduccion, 2)}×</b> today's tonnage:
      <b style="color:var(--verde)">+${num(a.toneladasIncremento, 1)} t</b>.
      <div style="color:var(--texto-tenue);margin-top:6px">
        That increase assumes there is work to fill the hours it frees up.
        If there isn't, the gain is finishing the program earlier.
      </div>
    </div>` +
    a.movimientos
      .map(
        (m) => `<div class="consejo" data-id="${m.id}" data-aceptado="${m.aceptado ?? ''}">
          <span class="indice">${m.id}</span>
          <span class="detalle">
            <div class="mover">
              Move <b>${m.ordenes} ${m.ordenes === 1 ? 'order' : 'orders'} of ${num(m.diametroMm, 2)} mm</b>
              from <b>${m.origen}</b><span class="flecha">→</span><b>${m.destino}</b>
            </div>
            <div class="meta">
              ${num(m.kilogramos)} kg ·
              ${num(m.horasOrigen, 1)} h on ${m.origen} vs ${num(m.horasDestino, 1)} h on ${m.destino}
            </div>
            <div class="folios">SAP orders: ${m.folios.join(', ')}</div>
          </span>
          <span class="ganancia">${m.horasLiberadas >= 0 ? '−' : '+'}${num(Math.abs(m.horasLiberadas), 1)} h</span>
          <span class="acciones">
            <button class="secundario" data-accion="si">Will do</button>
            <button class="secundario" data-accion="no">Not applicable</button>
          </span>
        </div>`,
      )
      .join('');

  for (const b of $('consejos').querySelectorAll('button[data-accion]')) {
    b.addEventListener('click', () => {
      const fila = b.closest('.consejo');
      const aceptado = b.dataset.accion === 'si';
      fila.dataset.aceptado = String(aceptado);
      const m = paquete.analisis.movimientos.find((x) => x.id === Number(fila.dataset.id));
      if (m) m.aceptado = aceptado;
      guardarEstado();
    });
  }
}

function pintarTablaLineas() {
  const filas = paquete.lineas.filter((l) => l.activa || l.actual.ordenes);
  $('tabla-lineas').innerHTML = `
    <tr>
      <th>Line</th><th>Orders</th><th>Tons</th>
      <th>Hours today</th><th>Hours rebalanced</th><th>Change</th><th>Utilization</th>
    </tr>
    ${filas
      .map((l) => {
        const delta = l.propuesto.horas - l.actual.horas;
        const color = delta < -0.05 ? 'var(--verde)' : delta > 0.05 ? 'var(--rojo)' : 'var(--texto-tenue)';
        return `<tr>
          <td><b>${l.linea}</b> <span style="color:var(--texto-tenue)">${l.workCenter}</span></td>
          <td class="num">${l.actual.ordenes} → ${l.propuesto.ordenes}</td>
          <td class="num">${num(l.actual.kg / 1000, 1)} → ${num(l.propuesto.kg / 1000, 1)}</td>
          <td class="num">${num(l.actual.horas, 1)}</td>
          <td class="num">${num(l.propuesto.horas, 1)}</td>
          <td class="num" style="color:${color}">${delta < 0 ? '−' : '+'}${num(Math.abs(delta), 1)} h</td>
          <td class="num">${num(l.propuesto.utilizacion, 0)}%</td>
        </tr>`;
      })
      .join('')}`;
}

function pintarRendimiento() {
  const lineas = catalogoLineas(paquete.supuestos);
  const tabla = new TablaVelocidades(recetasVigentes(), lineas);
  const programa = new Programa(paquete.detalleOrdenes.map((o) => new Orden(o)));
  const { lineas: claves, filas } = matrizRendimiento(tabla, programa);

  $('tabla-rendimiento').innerHTML = `
    <tr><th>Ø mm</th>${claves.map((l) => `<th>${l}</th>`).join('')}<th>Fastest</th></tr>
    ${filas
      .map(
        (f) => `<tr>
          <td class="num">${num(f.diametroMm, 2)}</td>
          ${claves
            .map((l) => {
              const v = f.celdas[l];
              if (v === null || v === undefined) return '<td class="vacia">—</td>';
              const esMejor = f.mejorKgH > 0 && Math.abs(v - f.mejorKgH) < 0.05;
              return `<td class="num ${esMejor ? 'mejor' : ''}">${num(v)}</td>`;
            })
            .join('')}
          <td style="text-align:left;color:var(--verde);font-weight:600">${empatadas(f, claves)}</td>
        </tr>`,
      )
      .join('')}`;
}

/** Todas las lineas que empatan como la mas rapida de ese diametro. */
function empatadas(fila, claves) {
  if (!fila.mejorKgH) return '—';
  const iguales = claves.filter(
    (l) => fila.celdas[l] !== null && Math.abs(fila.celdas[l] - fila.mejorKgH) < 0.05,
  );
  return iguales.length <= 3 ? iguales.join(', ') : `${iguales.length} lines`;
}


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
  if (!paquete) return;
  programaDesactualizado = true;
  pintarAvisos(paquete.analisis.avisos ?? []);
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
  vista = cual;
  $('ver-actual').setAttribute('aria-pressed', String(cual === 'actual'));
  $('ver-propuesto').setAttribute('aria-pressed', String(cual === 'propuesto'));
  pintarTablero();
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
