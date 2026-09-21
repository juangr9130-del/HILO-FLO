// ===== historial de programas ================================================
//
// La lista de folios anteriores, con el boton de borrar. La usan las dos
// interfaces; cada una le inyecta de donde sale la lista y que significa
// borrar (en el demo se va del navegador, en el modulo instalado se marca
// como descartado y deja de listarse).

/**
 * @param {object} api
 *   listar()        -> [{folio, archivo, cargadoEn, ordenes, kilogramos, analisis}]
 *   abrir(folio)    -> muestra ese folio
 *   borrar(folio)   -> lo quita de la lista
 *   alBorrar(folio) -> se llama despues, por si era el que se estaba viendo
 */
function montarHistorial(api) {
  const $ = (id) => document.getElementById(id);
  const num = (v, d = 0) =>
    (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  async function refrescar() {
    const lista = await api.listar();
    const caja = $('historial');
    if (!caja) return;

    if (!lista.length) {
      caja.innerHTML = '';
      return;
    }

    caja.innerHTML = `
      <div class="barra">
        <h3 style="font-size:15px;color:var(--azul);margin:0">Previous programs</h3>
        <span class="relleno"></span>
        <button class="borrar" data-borrar-todo>Delete all ${lista.length}</button>
      </div>
      <table>
        <tr>
          <th>Ticket</th><th>File</th><th>Orders</th><th>Tons</th>
          <th>Opportunity</th><th></th>
        </tr>
        ${lista.map((p) => renglon(p)).join('')}
      </table>`;

    for (const a of caja.querySelectorAll('a[data-folio]')) {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        api.abrir(a.dataset.folio);
      });
    }
    for (const b of caja.querySelectorAll('button[data-borrar]')) {
      b.addEventListener('click', () => borrar(b.dataset.borrar));
    }
    caja.querySelector('button[data-borrar-todo]')
      ?.addEventListener('click', () => borrarTodos(lista));
  }

  function renglon(p) {
    // Un folio de una version anterior puede no traer el analisis completo.
    // Se lista igual, pero marcado, para que se pueda borrar.
    const t = p.analisis?.toneladasIncremento ?? p.toneladasIncremento;
    const oportunidad =
      t === undefined || t === null
        ? '<span style="color:var(--ambar)">older version</span>'
        : `<span style="color:var(--verde)">+${num(t, 1)} t</span>`;
    return `<tr>
      <td><a href="#" data-folio="${p.folio}">${p.folio}</a></td>
      <td style="text-align:left;color:var(--texto-tenue)">${p.archivo ?? ''}</td>
      <td class="num">${num(p.ordenes)}</td>
      <td class="num">${num((p.kilogramos ?? 0) / 1000, 1)}</td>
      <td class="num">${oportunidad}</td>
      <td style="text-align:right">
        <button class="borrar" data-borrar="${p.folio}" title="Delete this ticket">Delete</button>
      </td>
    </tr>`;
  }

  async function borrar(folio) {
    if (!confirm(`Delete ticket ${folio}? This cannot be undone.`)) return;
    await api.borrar(folio);
    api.alBorrar?.(folio);
    await refrescar();
  }

  /** Vaciar la lista de un golpe. Un folio se repone volviendo a subir el
   *  schedule, asi que no vale la pena hacerlo folio por folio. */
  async function borrarTodos(lista) {
    if (!confirm(`Delete all ${lista.length} tickets? This cannot be undone.`)) return;
    for (const p of lista) {
      await api.borrar(p.folio);
      api.alBorrar?.(p.folio);
    }
    await refrescar();
  }

  return { refrescar };
}
