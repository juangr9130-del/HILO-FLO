// ===== pantalla de velocidades ================================================
//
// La usan las DOS interfaces: el modulo demo (que edita el catalogo en el
// navegador) y el modulo instalado (que lo edita contra la API). Lo unico que
// cambia entre las dos es de donde salen los datos y a donde van los cambios,
// y eso se inyecta.

/**
 * Rendimiento en kg/h a partir de la velocidad y el diametro.
 *
 * Es la misma formula de motor/rendimiento.js, repetida aqui porque la
 * interfaz del modulo instalado no carga el motor (vive en el servidor) y
 * necesita recalcular el renglon en cada tecla, sin ir a preguntar.
 * Hay una prueba que verifica que las dos den lo mismo; si alguien cambia
 * una, truena.
 */
function kgHoraDeVelocidad(mmS, diametroMm, eficiencia = 1) {
  const pesoLineal = (Math.PI / 4) * diametroMm ** 2 * 1e-6 * 7850;
  return ((mmS * 3600) / 1000) * pesoLineal * eficiencia;
}

/**
 * Monta la pantalla de velocidades.
 *
 * @param {object} api
 *   datos()            -> {documento, eficiencia, resumen, grupos}
 *   guardar(clave,mmS) -> guarda un ajuste
 *   quitar(clave)      -> regresa ese punto al valor del documento
 *   restablecer()      -> regresa todos
 *   revisar(clave,mmS) -> motivo del rechazo, o null
 *   alCambiar()        -> se llama despues de cada cambio aceptado
 */
function montarCatalogo(api) {
  const $ = (id) => document.getElementById(id);
  const num = (v, d = 0) =>
    (v ?? 0).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

  let vista = null; // lo ultimo que devolvio datos()
  let lineaElegida = null;
  let varianteElegida = null;

  async function refrescar() {
    vista = await api.datos();
    pintar();
  }

  function pintar() {
    if (!vista) return;
    $('doc-catalogo').textContent = vista.documento;

    const r = vista.resumen;
    $('resumen-ajustes').textContent = r.total
      ? `${r.total} ${r.total === 1 ? 'valor ajustado' : 'valores ajustados'} respecto al documento`
      : 'sin cambios respecto al documento';
    $('restablecer-todo').hidden = r.total === 0;

    const ajustadasPorLinea = new Map(r.lineas.map((l) => [l.linea, l.puntos]));
    const lineas = [...new Set(vista.grupos.map((g) => g.linea))];
    if (!lineas.includes(lineaElegida)) lineaElegida = lineas[0];

    $('selector-lineas').innerHTML = lineas
      .map((l) => {
        const n = ajustadasPorLinea.get(l) ?? 0;
        return `<button data-linea="${l}" aria-pressed="${l === lineaElegida}">
          ${l}${n ? ` <span class="marca">${n}</span>` : ''}
        </button>`;
      })
      .join('');
    for (const b of $('selector-lineas').querySelectorAll('button')) {
      b.addEventListener('click', () => {
        lineaElegida = b.dataset.linea;
        varianteElegida = null;
        pintar();
      });
    }

    const deLinea = vista.grupos.filter((g) => g.linea === lineaElegida);
    if (!deLinea.some((g) => g.clave === varianteElegida)) {
      varianteElegida = deLinea[0]?.clave ?? null;
    }

    // Solo ITW-2 e ITW-10 tienen variantes; para las demas sobra el selector.
    $('selector-variantes').innerHTML =
      deLinea.length > 1
        ? deLinea
            .map(
              (g) => `<button data-variante="${g.clave}" aria-pressed="${g.clave === varianteElegida}">
                ${g.variante}
              </button>`,
            )
            .join('')
        : '';
    for (const b of $('selector-variantes').querySelectorAll('button')) {
      b.addEventListener('click', () => {
        varianteElegida = b.dataset.variante;
        pintar();
      });
    }

    pintarTabla(deLinea.find((g) => g.clave === varianteElegida));
  }

  function pintarTabla(grupo) {
    if (!grupo) return ($('tabla-velocidades').innerHTML = '');

    $('tabla-velocidades').innerHTML = `
      <tr>
        <th>Ø mm</th>
        <th style="width:120px">Velocidad mm/s</th>
        <th style="width:130px">Rendimiento kg/h</th>
        <th style="width:200px">Documento</th>
      </tr>
      ${grupo.puntos.map((p) => renglon(p)).join('')}`;

    for (const input of $('tabla-velocidades').querySelectorAll('input.velocidad')) {
      input.addEventListener('input', () => editar(input, grupo));
      input.addEventListener('blur', () => {
        if (input.classList.contains('invalida')) pintar();
      });
    }
    conectarDeshacer($('tabla-velocidades'));
  }

  function renglon(p) {
    return `<tr data-clave="${p.clave}">
      <td class="num">${num(p.diametroMm, 2)}</td>
      <td><input class="velocidad ${p.ajustado ? 'ajustada' : ''}" type="number"
                 step="1" min="1" value="${p.mmS}" data-clave="${p.clave}"></td>
      <td class="num" data-kgh>${num(p.kgHora, 1)}</td>
      <td class="original">${documento(p)}</td>
    </tr>`;
  }

  function documento(p) {
    return p.ajustado
      ? `${num(p.mmSOriginal)} mm/s · <button class="deshacer" data-clave="${p.clave}">regresar</button>`
      : '—';
  }

  function conectarDeshacer(raiz) {
    for (const b of raiz.querySelectorAll('button.deshacer')) {
      if (b.dataset.conectado) continue;
      b.dataset.conectado = '1';
      b.addEventListener('click', async () => {
        await api.quitar(b.dataset.clave);
        api.alCambiar?.();
        await refrescar();
      });
    }
  }

  /**
   * Se edita mientras se escribe: el kg/h del renglon se recalcula al
   * instante, que es lo que hace util la pantalla. Lo que no se puede
   * guardar se marca en rojo y no toca el catalogo.
   */
  async function editar(input, grupo) {
    const clave = input.dataset.clave;
    const motivo = api.revisar(clave, input.value);
    input.classList.toggle('invalida', Boolean(motivo));
    input.title = motivo ?? '';
    if (motivo) return;

    const mmS = Number(input.value);
    const punto = grupo.puntos.find((p) => p.clave === clave);
    const original = punto.mmSOriginal;
    const ajustado = mmS !== original;

    const fila = input.closest('tr');
    fila.querySelector('[data-kgh]').textContent = num(
      kgHoraDeVelocidad(mmS, punto.diametroMm, vista.eficiencia ?? 1),
      1,
    );
    input.classList.toggle('ajustada', ajustado);
    fila.querySelector('.original').innerHTML = documento({ ...punto, mmS, ajustado });
    conectarDeshacer(fila);

    // El grupo en memoria se actualiza para no tener que repintar todo en
    // cada tecla; el resumen si se refresca, que es barato.
    punto.mmS = mmS;
    punto.ajustado = ajustado;

    if (ajustado) await api.guardar(clave, mmS);
    else await api.quitar(clave);
    api.alCambiar?.();
    await actualizarResumen();
  }

  async function actualizarResumen() {
    const { resumen } = await api.datos();
    vista.resumen = resumen;
    $('resumen-ajustes').textContent = resumen.total
      ? `${resumen.total} ${resumen.total === 1 ? 'valor ajustado' : 'valores ajustados'} respecto al documento`
      : 'sin cambios respecto al documento';
    $('restablecer-todo').hidden = resumen.total === 0;
  }

  $('restablecer-todo').addEventListener('click', async () => {
    const n = vista?.resumen.total ?? 0;
    if (!n) return;
    if (!confirm(`¿Regresar los ${n} valores ajustados a los del documento?`)) return;
    await api.restablecer();
    api.alCambiar?.();
    await refrescar();
  });

  return { refrescar };
}
