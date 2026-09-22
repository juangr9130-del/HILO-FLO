// ===== pantalla de reglas =====================================================
//
// Las reglas del reajuste, editables desde el programa. La usan las DOS
// interfaces; cada una inyecta de dónde salen los valores y a dónde van los
// cambios, igual que la pantalla de velocidades.
//
// Cambiar una regla NO reanaliza solo: el folio que se está viendo se calculó
// con las reglas de ese momento y tiene que seguir cuadrando. Se marca como
// desactualizado y el programador decide cuándo volver a correr.

function montarReglas(api = {}) {
  const $ = (id) => document.getElementById(id);
  const num = (v, d = 0) =>
    (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  let reglas = [];
  let sucio = false;

  async function refrescar() {
    reglas = await api.datos();
    pintar();
  }

  function pintar() {
    const caja = $('reglas');
    if (!caja) return;
    caja.innerHTML = reglas.map(campo).join('');

    for (const e of caja.querySelectorAll('[data-regla]')) {
      e.addEventListener('change', () => cambiar(e));
    }
    caja.querySelectorAll('button[data-restablecer]').forEach((b) => {
      b.addEventListener('click', () => restablecer(b.dataset.restablecer));
    });
    pintarPie();
  }

  function campo(r) {
    const cambiada = r.cambiada
      ? `<button class="borrar" data-restablecer="${r.clave}" title="Back to ${valorLegible(r, r.predeterminado)}">Reset</button>`
      : '';
    return `<div class="regla${r.cambiada ? ' cambiada' : ''}">
      <div class="mando">
        <label for="regla-${r.clave}">${r.etiqueta}</label>
        ${control(r)}
        ${r.unidad ? `<span class="unidad">${r.unidad}</span>` : ''}
        ${cambiada}
      </div>
      <p class="ayuda">${r.ayuda}</p>
      <p class="error" id="error-${r.clave}" hidden></p>
    </div>`;
  }

  function control(r) {
    const id = `regla-${r.clave}`;
    if (r.tipo === 'opcion') {
      return `<select id="${id}" data-regla="${r.clave}">
        ${r.opciones.map((o) => `<option value="${o.valor}"${o.valor === r.valor ? ' selected' : ''}>${o.etiqueta}</option>`).join('')}
      </select>`;
    }
    if (r.tipo === 'bandera') {
      return `<label class="interruptor"><input type="checkbox" id="${id}" data-regla="${r.clave}"${r.valor ? ' checked' : ''}> <span>${r.valor ? 'Yes' : 'No'}</span></label>`;
    }
    return `<input type="number" id="${id}" data-regla="${r.clave}" value="${r.valor}"
              min="${r.min}" max="${r.max}" step="${r.paso ?? (r.entero ? 1 : 'any')}">`;
  }

  function valorLegible(r, v) {
    if (r.tipo === 'bandera') return v ? 'Yes' : 'No';
    if (r.tipo === 'opcion') return r.opciones.find((o) => o.valor === v)?.etiqueta ?? v;
    return `${num(v, Number.isInteger(v) ? 0 : 2)}${r.unidad ? ` ${r.unidad}` : ''}`;
  }

  async function cambiar(elemento) {
    const clave = elemento.dataset.regla;
    const r = reglas.find((x) => x.clave === clave);
    const valor =
      r.tipo === 'bandera'
        ? elemento.checked
        : r.tipo === 'opcion'
          ? elemento.value
          : Number(elemento.value);

    const error = $(`error-${clave}`);
    const motivo = revisar(r, valor);
    if (motivo) {
      // No se guarda y el valor se queda a la vista para corregirlo: borrarlo
      // obligaría a volver a escribirlo entero.
      error.textContent = `Not saved: ${motivo}.`;
      error.hidden = false;
      return;
    }
    error.hidden = true;

    // El servidor vuelve a validar por su cuenta. Si rechaza algo que aquí
    // pasó, se dice: quedarse callado dejaría la pantalla mostrando un valor
    // que no se guardó.
    const r2 = await api.guardar(clave, valor);
    if (r2 && r2.ok === false) {
      error.textContent = (await r2.json().catch(() => ({}))).error ?? 'The rule was not saved.';
      error.hidden = false;
    }
    sucio = true;
    await refrescar();
    api.alCambiar?.();
  }

  /**
   * Motivo por el que un valor no se acepta, o null.
   *
   * Sale de los metadatos que la regla ya trae (tipo, rango, opciones), no de
   * una copia de las reglas: así el módulo instalado no necesita el catálogo
   * del servidor en el navegador y no hay dos definiciones que desincronizar.
   * La validación que manda sigue siendo la del servicio.
   */
  function revisar(r, valor) {
    if (r.tipo === 'opcion') {
      return r.opciones.some((o) => o.valor === valor) ? null : 'that is not one of the options';
    }
    if (r.tipo === 'bandera') return typeof valor === 'boolean' ? null : 'that has to be yes or no';
    if (!Number.isFinite(valor)) return 'that has to be a number';
    if (r.entero && !Number.isInteger(valor)) return 'that has to be a whole number';
    if (valor < r.min || valor > r.max) return `that is out of range (${r.min} to ${r.max})`;
    return null;
  }

  async function restablecer(clave) {
    await api.quitar(clave);
    sucio = true;
    await refrescar();
    api.alCambiar?.();
  }

  function pintarPie() {
    const pie = $('pie-reglas');
    if (!pie) return;
    const cambiadas = reglas.filter((r) => r.cambiada).length;
    const boton = api.reanalizar
      ? `<button class="primario" id="reanalizar"${api.hayPrograma?.() ? '' : ' disabled'}>Re-analyze with these rules</button>`
      : '';
    pie.innerHTML = `
      <div class="controles">
        <span class="rotulo">${
          cambiadas
            ? `${cambiadas} ${cambiadas === 1 ? 'rule differs' : 'rules differ'} from the defaults.`
            : 'All rules are at their default.'
        }${sucio ? ' The ticket on screen was calculated with the previous ones.' : ''}</span>
        <span class="relleno"></span>
        ${boton}
      </div>`;
    const b = $('reanalizar');
    if (b) {
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Re-analyzing…';
        try {
          await api.reanalizar();
          sucio = false;
        } finally {
          pintarPie();
        }
      });
    }
  }

  return { refrescar, marcarLimpio: () => { sucio = false; pintarPie(); } };
}
