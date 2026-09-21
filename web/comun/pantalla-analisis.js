// ===== pantalla de análisis ===================================================
//
// La usan las DOS interfaces: el módulo demo y el instalado. Vivía duplicada
// en las dos y ya costó un bug (pintarAvisos declarado dos veces).
//
// Es una fábrica y no un puñado de funciones sueltas porque el estado
// (qué folio se está viendo, si se está viendo el programa actual o el
// reajustado) tiene que vivir aquí. Cuando lo leía de variables globales
// funcionaba en el demo, donde todo se concatena en un solo ámbito, y
// fallaba en el módulo instalado, donde app.js es un módulo ES y sus
// variables no salen de él.
//
// Cada interfaz le inyecta lo que hace distinto:
//   marcarMovimiento(id, aceptado)  guardar que el programador aceptó un consejo
//   obtenerMatriz(paquete)          la matriz kg/h, que el demo calcula y el
//                                   instalado le pide a la API

function montarAnalisis(api = {}) {
  const $ = (id) => document.getElementById(id);
  const num = (v, d = 0) =>
    (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  let paquete = null;
  let vista = 'actual';
  let programaDesactualizado = false;

  /**
   * Los cuatro numeros de arriba.
   *
   * El tercero se llamaba "Extra output" y se leia como si el programa
   * produjera mas. No es asi: el reajuste no crea tonelada, mueve trabajo.
   * Este programa hace la misma tonelada antes y despues, solo que termina
   * antes; lo que se gana es CAPACIDAD, y solo se vuelve tonelada real si hay
   * ordenes que adelantar. El rotulo y el pie ahora lo dicen.
   */
  function pintarKpis() {
    const a = paquete.analisis;
    const gana = a.toneladasIncremento > 0.05;
    const ahorro = a.makespanActual - a.makespanPropuesto;
    const bloques = [
      kpi('Finishes today in', num(a.makespanActual, 1), 'h', `how long ${a.cuelloDeBotella} takes`, 'malo'),
      kpi('Rebalanced', num(a.makespanPropuesto, 1), 'h',
          `${num(ahorro, 1)} h earlier · same ${num(a.toneladasActuales, 1)} t`, gana ? 'bueno' : ''),
      kpi('Capacity freed up', `+${num(a.toneladasIncremento, 1)}`, 't',
          `fits in the ${num(ahorro, 1)} h — needs orders to pull in`, gana ? 'bueno' : ''),
      kpi('Orders to move', num(a.ordenesMovidas), `of ${num(paquete.ordenes)}`,
          `${a.movimientos.length} moves`, ''),
    ].join('');
    $('kpis-programacion').innerHTML = bloques;
    $('kpis-analisis').innerHTML = bloques;
    pintarAvisos(a.avisos ?? []);
  }

  /**
   * De dónde sale la productividad, en tarjetas.
   *
   * Las horas de una línea son horas de corrida más horas de cambio y nada
   * más, así que el ahorro se parte en esas dos sin contar nada dos veces:
   *
   *   corrida ahorrada  = la misma tonelada a un ritmo mejor
   *   cambio ahorrado   = cambios de medida evitados x el estándar
   *   --------------------------------------------------------
   *   horas ahorradas   = lo que se libera en toda la planta
   *
   * Cada renglón se traduce a tonelada al ritmo YA rebalanceado, que es lo
   * que la planta produciría si esas horas se llenaran con más material.
   *
   * Ojo con confundirla con "Capacity freed up" de arriba: aquélla es hueco
   * de calendario en las líneas que acaban antes, ésta es tiempo que deja de
   * gastarse. No se suman.
   */
  function pintarGanancia() {
    const a = paquete.analisis;
    const caja = $('ganancia');
    if (!caja) return;

    // Los folios viejos se guardaron sin este desglose: mejor no dibujar la
    // tarjeta que dibujarla en ceros.
    if (a.horasAhorradas === undefined) {
      caja.closest('.tarjeta').hidden = true;
      return;
    }
    caja.closest('.tarjeta').hidden = false;

    const horasAntes = a.horasProduccionActual + a.horasCambioActual;
    const horasDespues = a.horasProduccionPropuesto + a.horasCambioPropuesto;
    const gana = a.toneladasPorTiempo > 0.05;
    const min = paquete.supuestos?.minutosCambio ?? 30;
    const signo = (v, d = 1) => `${v > 0 ? '+' : ''}${num(v, d)}`;

    caja.innerHTML = [
      kpi('Hours recovered', num(a.horasAhorradas, 1), 'h',
          `${num(horasAntes, 0)} → ${num(horasDespues, 0)} h added up over every line`,
          gana ? 'bueno' : ''),
      kpi('Worth in product', signo(a.toneladasPorTiempo), 't',
          `${num(a.horasAhorradas, 1)} h × ${num(a.ritmoPropuesto, 0)} kg/h plant average`,
          gana ? 'bueno' : ''),
      kpi('From a faster mix', signo(a.toneladasPorRitmo), 't',
          `${signo(a.ritmoCambioPct)}% rate · ${num(a.ritmoActual, 0)} → ${num(a.ritmoPropuesto, 0)} kg/h · ${num(a.horasProduccionAhorradas, 1)} h`,
          ''),
      kpi('From fewer changeovers', signo(a.toneladasPorCambios), 't',
          `${a.cambiosEvitados} fewer size changes (${a.cambiosActual} → ${a.cambiosPropuesto}) × ${num(min, 0)} min`,
          ''),
    ].join('');

    $('nota-ganancia').innerHTML =
      `The last two cards add up to the second one: a line's hours are run time plus ` +
      `changeover time and nothing else, so nothing is counted twice. ` +
      `Tons are what those freed hours would make at the rebalanced plant rate — ` +
      `you still need orders to fill them. ` +
      `This is <b>not</b> the same as <b>Capacity freed up</b> above: that one is idle ` +
      `calendar time on the lines that finish early, this one is time the plant stops ` +
      `spending. Don't add them together.`;
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
        With these ${a.movimientos.length} moves it finishes in
        <b>${num(a.makespanPropuesto, 1)} h</b> — <b>${num(a.makespanActual - a.makespanPropuesto, 1)} h earlier</b>.
        <div style="color:var(--texto-tenue);margin-top:6px">
          The program still makes the same <b>${num(a.toneladasActuales, 1)} t</b>: rebalancing moves
          work between lines, it does not create tonnage. What it creates is room — in the
          <b>${num(a.makespanActual, 1)} h</b> the plant is already committing to this program,
          <b>${num(a.factorProduccion, 2)}×</b> the work would fit, which is
          <b style="color:var(--verde)">+${num(a.toneladasIncremento, 1)} t</b> if there are orders
          to pull in from next week. If there aren't, the gain is simply finishing earlier.
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
        api.marcarMovimiento?.(Number(fila.dataset.id), aceptado);
      });
    }
  }

  /**
   * Carga por linea, antes y despues.
   *
   * Cada magnitud va en dos columnas en vez de "35 -> 34" en una sola: asi se
   * puede leer la columna de abajo hacia arriba y comparar entre lineas, que es
   * lo que hace el programador.
   *
   * El renglon de totales no es adorno. Ordenes y toneladas tienen que salir
   * identicas antes y despues -- si no, el reajuste perdio trabajo por el
   * camino -- y las horas totales apenas se mueven mientras el cierre baja
   * mucho, que es justo lo que significa balancear.
   */
  function pintarTablaLineas() {
    const filas = paquete.lineas.filter((l) => l.activa || l.actual.ordenes);

    const total = filas.reduce(
      (t, l) => ({
        ordenesAntes: t.ordenesAntes + l.actual.ordenes,
        ordenesDespues: t.ordenesDespues + l.propuesto.ordenes,
        kgAntes: t.kgAntes + l.actual.kg,
        kgDespues: t.kgDespues + l.propuesto.kg,
        horasAntes: t.horasAntes + l.actual.horas,
        horasDespues: t.horasDespues + l.propuesto.horas,
        disponibles: t.disponibles + l.horasDisponibles,
      }),
      { ordenesAntes: 0, ordenesDespues: 0, kgAntes: 0, kgDespues: 0,
        horasAntes: 0, horasDespues: 0, disponibles: 0 },
    );

    $('tabla-lineas').innerHTML = `
      <tr>
        <th rowspan="2">Line</th>
        <th colspan="2" class="grupo">Orders</th>
        <th colspan="3" class="grupo">Tons</th>
        <th colspan="3" class="grupo">Hours</th>
        <th colspan="2" class="grupo">Utilization</th>
      </tr>
      <tr>
        <th class="sub">Before</th><th class="sub">After</th>
        <th class="sub">Before</th><th class="sub">After</th><th class="sub">+/−</th>
        <th class="sub">Before</th><th class="sub">After</th><th class="sub">+/−</th>
        <th class="sub">Before</th><th class="sub">After</th>
      </tr>
      ${filas.map((l) => renglonCarga(l)).join('')}
      <tr class="totales">
        <td>All lines</td>
        <td class="num">${num(total.ordenesAntes)}</td>
        <td class="num">${num(total.ordenesDespues)}</td>
        <td class="num">${num(total.kgAntes / 1000, 1)}</td>
        <td class="num">${num(total.kgDespues / 1000, 1)}</td>
        <td class="num">${deltaToneladas((total.kgDespues - total.kgAntes) / 1000)}</td>
        <td class="num">${num(total.horasAntes, 1)}</td>
        <td class="num">${num(total.horasDespues, 1)}</td>
        <td class="num" style="color:${colorDelta(total.horasDespues - total.horasAntes)}">
          ${delta(total.horasDespues - total.horasAntes)}
        </td>
        <td class="num">${num(utilizacion(total.horasAntes, total.disponibles), 0)}%</td>
        <td class="num">${num(utilizacion(total.horasDespues, total.disponibles), 0)}%</td>
      </tr>`;

    pintarNotaLineas(total);
  }

  /**
   * El renglón de totales se puede leer al revés si no se explica: la
   * utilización TOTAL baja y eso parece malo. No lo es. Sale la misma
   * tonelada en menos horas-línea, y sobre todo el programa cierra mucho
   * antes — que es un máximo y no una suma, y por eso no aparece en la tabla.
   */
  function pintarNotaLineas(total) {
    const nota = $('nota-lineas');
    if (!nota) return;
    const a = paquete.analisis;
    const iguales =
      total.ordenesAntes === total.ordenesDespues &&
      Math.abs(total.kgAntes - total.kgDespues) < 1;

    nota.innerHTML =
      (iguales
        ? '<b>Orders and tons are identical before and after</b> — rebalancing moves work between lines, it never drops any. '
        : '<b>Careful: orders or tons do not match before and after.</b> ') +
      `Total hours barely move (${num(total.horasAntes, 1)} h → ${num(total.horasDespues, 1)} h). ` +
      `What drops is the <b>finish time: ${num(a.makespanActual, 1)} h → ${num(a.makespanPropuesto, 1)} h</b>, ` +
      'because the program ends when its busiest line ends, not when the hours add up. ' +
      `The <b>+${num(a.toneladasIncremento, 1)} t</b> on the cards above is not extra output from ` +
      'this program — it is what would fit in the time that frees up.';
  }

  function renglonCarga(l) {
    const dh = l.propuesto.horas - l.actual.horas;
    const dt = (l.propuesto.kg - l.actual.kg) / 1000;
    return `<tr>
      <td><b>${l.linea}</b> <span style="color:var(--texto-tenue)">${l.workCenter}</span></td>
      <td class="num">${l.actual.ordenes}</td>
      <td class="num ${l.propuesto.ordenes !== l.actual.ordenes ? 'cambio' : ''}">${l.propuesto.ordenes}</td>
      <td class="num">${num(l.actual.kg / 1000, 1)}</td>
      <td class="num">${num(l.propuesto.kg / 1000, 1)}</td>
      <td class="num">${deltaToneladas(dt)}</td>
      <td class="num">${num(l.actual.horas, 1)}</td>
      <td class="num">${num(l.propuesto.horas, 1)}</td>
      <td class="num" style="color:${colorDelta(dh)}">${delta(dh)}</td>
      <td class="num">${num(l.actual.utilizacion, 0)}%</td>
      <td class="num">${num(l.propuesto.utilizacion, 0)}%</td>
    </tr>`;
  }

  /**
   * Toneladas que la linea gana o pierde en el reparto. Azul y no verde/rojo
   * a proposito: que una linea ceda tonelada no es malo, es el reajuste
   * haciendo su trabajo. Lo verde y lo rojo se reserva para las horas.
   */
  function deltaToneladas(t) {
    if (Math.abs(t) < 0.05) return '<span style="color:var(--texto-tenue)">—</span>';
    const color = t > 0 ? 'var(--azul-claro)' : 'var(--gris)';
    return `<span style="color:${color};font-weight:600">${t > 0 ? '+' : '−'}${num(Math.abs(t), 1)}</span>`;
  }

  function delta(h) {
    return Math.abs(h) < 0.05 ? '—' : `${h < 0 ? '−' : '+'}${num(Math.abs(h), 1)} h`;
  }

  function colorDelta(h) {
    if (h < -0.05) return 'var(--verde)';
    if (h > 0.05) return 'var(--rojo)';
    return 'var(--texto-tenue)';
  }

  function utilizacion(horas, disponibles) {
    return disponibles > 0 ? (horas / disponibles) * 100 : 0;
  }

  /**
   * Output por linea: a que kg/h corre cada una segun la mezcla de diametros
   * que le toca, antes y despues.
   *
   * Es la pregunta natural -- "si rebalanceamos, cuanto sube la
   * productividad" -- y la respuesta suele sorprender: el ritmo apenas se
   * mueve. Alguna linea incluso baja a proposito, porque absorbe alambre mas
   * delgado para descargar a la que estaba frenando todo el programa. Por eso
   * la tabla muestra tambien la mezcla: sin ella un -12% parece un error.
   */
  function pintarTablaRitmo() {
    const a = paquete.analisis;
    const tarjeta = $('tabla-ritmo')?.closest('.tarjeta');
    if (!tarjeta) return;

    // Un folio analizado con una version anterior no trae estos campos. Se
    // esconde la tarjeta en vez de pintar ceros, que es lo que hacia antes y
    // se lee como si la planta corriera a 0 kg/h.
    if (!a.ritmoActual) {
      tarjeta.hidden = true;
      return;
    }
    tarjeta.hidden = false;

    const filas = paquete.lineas.filter((l) => l.actual.ordenes || l.propuesto.ordenes);

    $('resumen-ritmo').textContent =
      `plant average ${num(a.ritmoActual)} → ${num(a.ritmoPropuesto)} kg/h ` +
      `(${a.ritmoCambioPct >= 0 ? '+' : ''}${num(a.ritmoCambioPct, 1)}%)`;

    $('tabla-ritmo').innerHTML = `
      <tr>
        <th rowspan="2">Line</th>
        <th colspan="3" class="grupo">Output kg/h</th>
        <th colspan="2" class="grupo">Diameters run</th>
      </tr>
      <tr>
        <th class="sub">Before</th><th class="sub">After</th>
        <th class="sub">+/− · tons in ${num(a.makespanPropuesto, 1)} h</th>
        <th class="sub">Before</th><th class="sub">After</th>
      </tr>
      ${filas.map((l) => renglonRitmo(l, a.makespanPropuesto)).join('')}
      <tr class="totales">
        <td>Plant average</td>
        <td class="num">${num(a.ritmoActual)}</td>
        <td class="num">${num(a.ritmoPropuesto)}</td>
        <td class="num" style="color:${a.ritmoCambioPct >= 0 ? 'var(--verde)' : 'var(--rojo)'}">
          ${a.ritmoCambioPct >= 0 ? '+' : ''}${num(a.ritmoCambioPct, 1)}% ·
          ${deltaToneladas(((a.ritmoPropuesto - a.ritmoActual) * a.makespanPropuesto) / 1000)} t
        </td>
        <td class="num" colspan="2"></td>
      </tr>`;

    pintarNotaRitmo();
  }

  /**
   * @param ventana  horas en que cierra el programa reajustado. El cambio de
   *   ritmo se expresa tambien en toneladas sobre esa ventana, porque un
   *   "+7.2%" no le dice nada a nadie y "+7.2 t" si.
   */
  function renglonRitmo(l, ventana) {
    const antes = l.actual.kgHora;
    const despues = l.propuesto.kgHora;
    const pct = antes > 0 ? (despues / antes - 1) * 100 : 0;
    const toneladas = ((despues - antes) * ventana) / 1000;
    const color = pct > 0.05 ? 'var(--verde)' : pct < -0.05 ? 'var(--rojo)' : 'var(--texto-tenue)';
    return `<tr>
      <td><b>${l.linea}</b> <span style="color:var(--texto-tenue)">${l.workCenter}</span></td>
      <td class="num">${antes ? num(antes) : '—'}</td>
      <td class="num">${despues ? num(despues) : '—'}</td>
      <td class="num" style="color:${color}">${
        Math.abs(pct) < 0.05
          ? '—'
          : `${pct > 0 ? '+' : ''}${num(pct, 1)}% · ${deltaToneladas(toneladas)} t`
      }</td>
      <td class="mezcla">${mezcla(l.actual.diametros)}</td>
      <td class="mezcla">${mezcla(l.propuesto.diametros)}</td>
    </tr>`;
  }

  /** "6 · 14.50–15.09 mm" — cuántas medidas y en qué rango. */
  function mezcla(diametros) {
    if (!diametros?.length) return '—';
    const min = num(diametros[0], 2);
    const max = num(diametros[diametros.length - 1], 2);
    const rango = min === max ? `${min} mm` : `${min}–${max} mm`;
    return `<span class="cuantas">${diametros.length}</span> · ${rango}`;
  }

  /**
   * Sin esta nota la tabla se malinterpreta al derecho y al reves: se espera
   * que el ritmo suba mucho (sube 2%) y una linea que baja parece un error.
   */
  function pintarNotaRitmo() {
    const nota = $('nota-ritmo');
    if (!nota) return;
    const a = paquete.analisis;
    const peor = paquete.lineas
      .filter((l) => l.actual.kgHora && l.propuesto.kgHora)
      .map((l) => ({ l, pct: (l.propuesto.kgHora / l.actual.kgHora - 1) * 100 }))
      .sort((x, y) => x.pct - y.pct)[0];

    const bajan =
      peor && peor.pct < -1
        ? `Some lines get <b>slower</b> on purpose — ${peor.l.linea} drops ${num(Math.abs(peor.pct), 1)}% ` +
          'because it takes on thinner wire so the bottleneck line stops holding everyone back. ' +
          'A line running fewer kg/h is fine if it lets the plant finish sooner. '
        : '';

    nota.innerHTML =
      `Rebalancing barely changes how fast the lines run: the plant average goes from ` +
      `<b>${num(a.ritmoActual)}</b> to <b>${num(a.ritmoPropuesto)} kg/h</b>, just ` +
      `<b>${a.ritmoCambioPct >= 0 ? '+' : ''}${num(a.ritmoCambioPct, 1)}%</b>. ` +
      bajan +
      `<br>Almost all of the gain comes from <b>not leaving lines idle</b>, not from running faster: ` +
      `just spreading today's hours evenly, without moving a single order to a faster line, would ` +
      `already finish in <b>${num(a.cierreSoloBalance, 1)} h</b> instead of ${num(a.makespanActual, 1)} h. ` +
      `That is the real lever.`;
  }

  /**
   * La matriz kg/h. Recibe los datos ya armados porque cada interfaz los
   * consigue distinto: el demo la calcula en el navegador y el modulo
   * instalado la pide a la API.
   */
  function pintarMatrizRendimiento({ lineas: claves, filas }) {
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

  return {
    /** Pinta un folio completo. */
    async mostrar(p) {
      paquete = p;
      programaDesactualizado = false;
      pintarKpis();
      pintarGanancia();
      pintarTablero();
      pintarConsejos();
      pintarTablaLineas();
      pintarTablaRitmo();
      if (api.obtenerMatriz) pintarMatrizRendimiento(await api.obtenerMatriz(paquete));
    },

    /** 'actual' | 'propuesto' */
    cambiarVista(cual) {
      vista = cual;
      pintarTablero();
    },

    /** Cambiaron las velocidades: lo que se está viendo ya no corresponde. */
    marcarDesactualizado() {
      if (!paquete) return;
      programaDesactualizado = true;
      pintarAvisos(paquete.analisis.avisos ?? []);
    },

    get paquete() {
      return paquete;
    },
  };
}
