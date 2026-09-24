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

  let rangos = [];
  let restricciones = [];

  async function refrescar() {
    reglas = await api.datos();
    rangos = (await api.rangos?.()) ?? [];
    restricciones = (await api.restricciones?.()) ?? [];
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
    pintarRangos();
    pintarRestricciones();
    pintarPie();
  }

  /**
   * Los rangos de diámetro que piso dio para cada línea.
   *
   * Va aquí y no en la pantalla de velocidades porque son cosas distintas: la
   * velocidad dice qué tan rápido corre un diámetro, el rango dice en cuáles
   * la línea corre BIEN. Una línea puede tener velocidad tabulada para un
   * diámetro y aun así no ser buena para él.
   */
  function pintarRangos() {
    const caja = $('rangos');
    if (!caja) return;
    if (!rangos.length) {
      caja.innerHTML = '';
      return;
    }
    const respeta = reglas.find((r) => r.clave === 'respetarRangos')?.valor;
    caja.innerHTML = `
      <div class="tarjeta${respeta ? '' : ' apagada'}">
        <h2>Diameter range per line <small>what the floor says each line runs well</small></h2>
        <div class="cuerpo" style="padding:0"><div class="scroll">
          <table>
            <thead><tr>
              <th>Line</th><th class="n">From (mm)</th><th class="n">To (mm)</th><th></th>
            </tr></thead>
            <tbody>${rangos.map(renglonRango).join('')}</tbody>
          </table>
        </div></div>
        <p class="nota-tabla">${
          respeta
            ? 'No coil is moved to a line outside its range. What is already scheduled outside one is reported, not moved.'
            : 'These ranges are <b>not being applied</b> — turn on the rule above to use them.'
        }</p>
      </div>`;

    for (const e of caja.querySelectorAll('input[data-rango]')) {
      e.addEventListener('change', () => cambiarRango(e.dataset.rango));
    }
    caja.querySelectorAll('button[data-quitar-rango]').forEach((b) => {
      b.addEventListener('click', async () => {
        await api.quitarRango(b.dataset.quitarRango);
        sucio = true;
        await refrescar();
        api.alCambiar?.();
      });
    });
  }

  /**
   * Qué tipos de rollo puede correr cada línea.
   *
   * No se pueden apagar como los rangos: el rango es una preferencia de piso,
   * esto es lo que la línea puede o no puede correr. Se muestran con la frase
   * original del programador para que se pueda cotejar contra su correo.
   */
  function pintarRestricciones() {
    const caja = $('restricciones');
    if (!caja) return;
    if (!restricciones.length) {
      caja.innerHTML = '';
      return;
    }
    caja.innerHTML = `
      <div class="tarjeta">
        <h2>Which lines can run which coils <small>from the scheduler, always applied</small></h2>
        <div class="cuerpo" style="padding:0"><div class="scroll">
          <table>
            <thead><tr>
              <th>Coil type</th><th></th><th>Lines</th><th>As it was given to us</th>
            </tr></thead>
            <tbody>${restricciones
              .map(
                (r) => `<tr${r.cambiada ? ' class="cambiado"' : ''}>
                  <td><b>${r.etiqueta}</b></td>
                  <td class="modo">${r.modo === 'solo' ? 'only on' : 'never on'}</td>
                  <td>${r.lineas.join(', ')}</td>
                  <td class="fuente">${r.fuente}</td>
                </tr>`,
              )
              .join('')}</tbody>
          </table>
        </div></div>
        <p class="nota-tabla">
          <b>"Only on" wins over "never on".</b> The top down coils are also small ID, so
          the two rules together would leave them nowhere — and they already run on ITW-2
          every day. A rule that names the few lines that <i>can</i> do something beats a
          general "not here".
        </p>
      </div>`;
  }

  function renglonRango(r) {
    return `<tr${r.cambiado ? ' class="cambiado"' : ''}>
      <td>${r.linea}</td>
      <td class="n"><input type="number" step="0.01" min="0" max="40"
            data-rango="${r.linea}" data-lado="min" value="${r.min}"></td>
      <td class="n"><input type="number" step="0.01" min="0" max="40"
            data-rango="${r.linea}" data-lado="max" value="${r.max}"></td>
      <td style="text-align:right">${
        r.cambiado
          ? `<button class="borrar" data-quitar-rango="${r.linea}" title="Back to ${r.minSemilla}–${r.maxSemilla} mm">Reset</button>`
          : ''
      }</td>
    </tr>`;
  }

  async function cambiarRango(linea) {
    const caja = $('rangos');
    const lo = Number(caja.querySelector(`input[data-rango="${linea}"][data-lado="min"]`).value);
    const hi = Number(caja.querySelector(`input[data-rango="${linea}"][data-lado="max"]`).value);
    const r = await api.guardarRango(linea, [lo, hi]);
    if (r && r.ok === false) {
      // El servicio es el que manda: si rechaza, se vuelve a pintar con lo
      // que de verdad quedó guardado en vez de dejar el número a medias.
      const e = $('error-respetarRangos');
      if (e) {
        e.textContent = (await r.json().catch(() => ({}))).error ?? 'The range was not saved.';
        e.hidden = false;
      }
    }
    sucio = true;
    await refrescar();
    api.alCambiar?.();
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
