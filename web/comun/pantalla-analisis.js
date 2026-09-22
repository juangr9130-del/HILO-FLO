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
    // Los dos objetivos ganan cosas distintas, asi que las tarjetas tienen
    // que decir cosas distintas. Con 'rendimiento' el cierre casi no se
    // mueve a proposito: dejar ahi "0.5 h earlier / +4.1 t" escondia una
    // ganancia real de 67 h y 59 t que la pestana de abajo si mostraba.
    const bloques = (paquete.supuestos?.objetivo === 'rendimiento'
      ? kpisRendimiento(a)
      : kpisCalendario(a)
    ).join('');
    $('kpis-programacion').innerHTML = bloques;
    $('kpis-analisis').innerHTML = bloques;
    pintarAvisos(a.avisos ?? []);
  }

  /** Lo que gana el objetivo de rendimiento: la misma tonelada en menos horas. */
  function kpisRendimiento(a) {
    const gana = a.horasAhorradas > 0.05;
    return [
      kpi('Plant rate', num(a.ritmoPropuesto, 0), 'kg/h',
          `${num(a.ritmoActual, 0)} kg/h today · ${a.ritmoCambioPct > 0 ? '+' : ''}${num(a.ritmoCambioPct, 1)}%`,
          gana ? 'bueno' : ''),
      kpi('Line hours saved', num(a.horasAhorradas, 1), 'h',
          `${num(a.horasTotalesActual, 0)} → ${num(a.horasTotalesPropuesto, 0)} h · same ${num(a.toneladasActuales, 1)} t`,
          gana ? 'bueno' : ''),
      kpi('Worth in product', `+${num(a.toneladasPorTiempo, 1)}`, 't',
          `what those hours make at ${num(a.ritmoPropuesto, 0)} kg/h`, gana ? 'bueno' : ''),
      kpi('Orders to move', num(a.ordenesMovidas), `of ${num(paquete.ordenes)}`,
          `${a.movimientos.length} moves · none to a slower line`, ''),
    ];
  }

  /** Lo que gana el objetivo de calendario: cerrar antes. */
  function kpisCalendario(a) {
    const gana = a.toneladasIncremento > 0.05;
    const ahorro = a.makespanActual - a.makespanPropuesto;
    return [
      kpi('Finishes today in', num(a.makespanActual, 1), 'h', `how long ${a.cuelloDeBotella} takes`, 'malo'),
      kpi('Rebalanced', num(a.makespanPropuesto, 1), 'h',
          `${num(ahorro, 1)} h earlier · same ${num(a.toneladasActuales, 1)} t`, gana ? 'bueno' : ''),
      kpi('Capacity freed up', `+${num(a.toneladasIncremento, 1)}`, 't',
          `fits in the ${num(ahorro, 1)} h — needs orders to pull in`, gana ? 'bueno' : ''),
      kpi('Orders to move', num(a.ordenesMovidas), `of ${num(paquete.ordenes)}`,
          `${a.movimientos.length} moves`, ''),
    ];
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

    // Con 'rendimiento' las dos primeras ya estan en las tarjetas de arriba;
    // repetirlas aqui solo hace ruido. Lo que esta pantalla aporta es el
    // desglose: cuanto es mezcla y cuanto es cambios.
    const rendimiento = paquete.supuestos?.objetivo === 'rendimiento';
    const totales = [
      kpi('Hours recovered', num(a.horasAhorradas, 1), 'h',
          `${num(horasAntes, 0)} → ${num(horasDespues, 0)} h added up over every line`,
          gana ? 'bueno' : ''),
      kpi('Worth in product', signo(a.toneladasPorTiempo), 't',
          `${num(a.horasAhorradas, 1)} h × ${num(a.ritmoPropuesto, 0)} kg/h plant average`,
          gana ? 'bueno' : ''),
    ];
    const partes = [
      kpi('From a faster mix', signo(a.toneladasPorRitmo), 't',
          `${signo(a.ritmoCambioPct)}% rate · ${num(a.ritmoActual, 0)} → ${num(a.ritmoPropuesto, 0)} kg/h · ${num(a.horasProduccionAhorradas, 1)} h`,
          ''),
      kpi('From fewer changeovers', signo(a.toneladasPorCambios), 't',
          `${a.cambiosEvitados} fewer size changes (${a.cambiosActual} → ${a.cambiosPropuesto}) × ${num(min, 0)} min`,
          ''),
    ];
    caja.innerHTML = (rendimiento ? partes : [...totales, ...partes]).join('');

    const suman = rendimiento
      ? `These two add up to the <b>+${num(a.toneladasPorTiempo, 1)} t</b> above: `
      : 'The last two cards add up to the second one: ';
    const contraste = rendimiento
      ? ''
      : `This is <b>not</b> the same as <b>Capacity freed up</b> above: that one is idle ` +
        `calendar time on the lines that finish early, this one is time the plant stops ` +
        `spending. Don't add them together.`;

    $('nota-ganancia').innerHTML =
      suman +
      `a line's hours are run time plus changeover time and nothing else, so nothing is ` +
      `counted twice. Tons are what those freed hours would make at the rebalanced plant ` +
      `rate — you still need orders to fill them. ` +
      contraste;
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
    const pintores = {
      devanador_no_indicado: pintarAvisoDevanador,
      tope_alcanzado: pintarAvisoTope,
    };
    $('avisos').innerHTML = desactualizado + avisos
      .map((av) => (pintores[av.tipo] ?? pintarAvisoSinReceta)(av))
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

  function pintarAvisoTope(av) {
    const una = av.lineas.length === 1;
    return `<div class="aviso nota">
      <strong>${una ? 'One line' : `${av.lineas.length} lines`} hit the
      ±${num(av.tope)} coil limit, so some improvements were held back.</strong>
      There was material that runs faster elsewhere, but moving it would have pulled
      ${una ? 'that line' : 'those lines'} further than ±${num(av.tope)} coils from what
      you scheduled.
      <div style="margin-top:5px;color:var(--texto-tenue)">
        ${av.lineas.map((l) => `${l.linea}: ${l.cambio > 0 ? '+' : ''}${num(l.cambio)} coils (${l.ordenes} total)`).join(' · ')}
      </div>
      <div style="margin-top:5px">
        If ${una ? 'that line' : 'any of those lines'} can take a bigger change this week,
        raise the limit and the module will take those moves.
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

  // =========================================================================
  // Hoja de corridas
  // =========================================================================
  //
  // La otra pregunta del programador. El análisis contesta qué conviene
  // mover; esto contesta qué corre cada línea, en qué orden, a qué hora y
  // con cuántos rollos — lo que se imprime y se baja a piso.
  //
  // Nada se calcula aquí: el reloj viene resuelto en el paquete para que el
  // mismo folio se vuelva a pintar idéntico meses después.

  let vistaCorridas = 'actual';
  let lineaCorridas = '';
  const corridasAbiertas = new Set();

  const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /**
   * Hora del programa -> fecha y hora de reloj.
   *
   * El schedule de SAP no trae columna de fecha: lo único que dice de qué
   * semana es, es el nombre del archivo. Si no se pudo leer, se enseña la
   * hora corrida ("14.6 h"), que es honesto y sigue sirviendo para ordenar.
   *
   * Se formatea con los getters UTC a propósito: el ancla se guardó en UTC y
   * así el folio se lee igual en Florence que en México.
   */
  function reloj(horas) {
    const ancla = paquete?.inicioPrograma;
    if (!ancla) return `${num(horas, 1)} h`;
    const d = new Date(new Date(ancla).getTime() + horas * 3600000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} · ${hh}:${mm}`;
  }

  function hojaActiva() {
    const c = paquete?.corridas;
    if (!c) return null;
    return vistaCorridas === 'propuesto' ? c.propuesto : c.actual;
  }

  /** Las órdenes por id, para colgarle al rollo su PO y sus notas. */
  function ordenesPorId() {
    if (!paquete.__porId) {
      paquete.__porId = new Map((paquete.detalleOrdenes ?? []).map((o) => [o.id, o]));
    }
    return paquete.__porId;
  }

  function pintarHojaCorridas() {
    const caja = $('hoja-corridas');
    if (!caja) return;
    const hoja = hojaActiva();

    // Los folios guardados antes de que existiera esta pantalla no la traen.
    if (!hoja) {
      caja.innerHTML =
        `<div class="aviso nota">This ticket was analyzed before the run sheet
         existed, so it has no schedule stored. Upload the program again to get it.</div>`;
      return;
    }

    const conCarga = hoja.filter((l) => l.rollos > 0);
    llenarSelectorLineas(conCarga);

    const mostradas = lineaCorridas ? conCarga.filter((l) => l.linea === lineaCorridas) : conCarga;
    caja.innerHTML = mostradas.length
      ? mostradas.map(tarjetaLinea).join('')
      : `<div class="aviso nota">Nothing scheduled on that line.</div>`;
  }

  function llenarSelectorLineas(lineas) {
    const sel = $('corridas-linea');
    if (!sel) return;
    const claves = lineas.map((l) => l.linea);
    // Una línea puede quedarse sin carga al cambiar de vista: si la que
    // estaba elegida ya no existe, se regresa a "todas" en vez de dejar la
    // pantalla en blanco.
    if (lineaCorridas && !claves.includes(lineaCorridas)) lineaCorridas = '';
    sel.innerHTML =
      `<option value="">All lines (${claves.length})</option>` +
      lineas
        .map((l) => `<option value="${l.linea}">${l.linea} — ${l.corridas} runs, ${num(l.kg / 1000, 1)} t</option>`)
        .join('');
    sel.value = lineaCorridas;
  }

  function tarjetaLinea(l) {
    const sobregiro = l.cierreH > l.horasDisponibles + 1e-6;
    return `<div class="tarjeta">
      <h2>${l.linea}
        <small>${l.workCenter} · ${l.corridas} runs · ${num(l.rollos)} coils · ${num(l.kg / 1000, 1)} t</small>
        <span class="cierre${sobregiro ? ' sobregiro' : ''}">
          ${reloj(0)} → ${reloj(l.cierreH)} · ${num(l.horas, 1)} h
          ${sobregiro ? `· ${num(l.cierreH - l.horasDisponibles, 1)} h past the ${num(l.horasDisponibles)} h horizon` : ''}
        </span>
      </h2>
      <div class="cuerpo" style="padding:0"><div class="scroll">
        <table class="hoja">
          <thead><tr>
            <th>#</th><th>Part</th><th>Description</th><th class="n">Ø mm</th>
            <th class="n">Coils</th><th class="n">Tons</th><th class="n">kg/h</th>
            <th class="n">Setup</th><th>Start</th><th>End</th><th class="n">Hours</th>
          </tr></thead>
          <tbody>${l.secuencia.map((c) => renglonCorrida(l, c)).join('')}</tbody>
        </table>
      </div></div>
    </div>`;
  }

  function renglonCorrida(l, c) {
    const clave = `${l.linea}#${c.n}`;
    const abierta = corridasAbiertas.has(clave);
    const fuera = !c.dentroDelHorizonte;
    const clases = ['corrida', abierta ? 'abierta' : '', fuera ? 'fuera' : '', c.sinReceta ? 'sin-receta' : '']
      .filter(Boolean)
      .join(' ');

    const marcas = [
      c.slm ? '<span class="marca">SLM</span>' : '',
      c.winder ? `<span class="marca">${c.winder}</span>` : '',
      c.sinReceta ? '<span class="marca mala">no recipe</span>' : '',
      fuera && !c.sinReceta ? '<span class="marca mala">past horizon</span>' : '',
    ].join('');

    return `<tr class="${clases}" data-corrida="${clave}">
        <td class="n">${c.n}</td>
        <td><b>${c.parte}</b></td>
        <td class="desc">${c.descripcion}${marcas}</td>
        <td class="n">${num(c.diametroMm, 2)}</td>
        <td class="n">${c.rollos}</td>
        <td class="n">${num(c.kg / 1000, 1)}</td>
        <td class="n">${c.kgHora === null ? '—' : num(c.kgHora)}</td>
        <td class="n">${c.horasCambio > 0 ? `${num(c.horasCambio * 60)} min` : '—'}</td>
        <td>${c.sinReceta ? '—' : reloj(c.inicioH)}</td>
        <td>${c.sinReceta ? '—' : reloj(c.finH)}</td>
        <td class="n">${num(c.horasProduccion + c.horasCambio, 1)}</td>
      </tr>
      <tr class="rollos" data-de="${clave}"${abierta ? '' : ' hidden'}>
        <td colspan="11">${tablaRollos(c)}</td>
      </tr>`;
  }

  function tablaRollos(c) {
    const por = ordenesPorId();
    return `<table class="rollos">
      <thead><tr>
        <th class="izq">Order</th><th class="n">kg</th>
        <th class="izq">Start</th><th class="izq">End</th>
        <th class="izq">Customer PO</th><th class="izq">Notes</th>
      </tr></thead>
      <tbody>${c.detalle
        .map((r) => {
          const o = por.get(r.orden);
          const parcial = !r.completo && !r.sinReceta;
          return `<tr${parcial ? ' class="fuera"' : ''}>
            <td class="izq">${r.orden}</td>
            <td class="n">${num(r.kg)}${parcial ? ' <span class="marca mala">does not fit</span>' : ''}</td>
            <td class="izq">${r.sinReceta ? '—' : reloj(r.inicioH)}</td>
            <td class="izq">${r.sinReceta ? '—' : reloj(r.finH)}</td>
            <td class="izq">${o?.clientePo || '—'}</td>
            <td class="izq notas">${o?.notas || ''}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table>`;
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

  /**
   * El párrafo que explica de qué se trata la lista de movimientos.
   *
   * Cambia con el objetivo, igual que las tarjetas: con 'rendimiento' el
   * cierre casi no se mueve a propósito, así que abrir con "termina 0.5 h
   * antes" haría ver la propuesta como si no sirviera de nada.
   */
  function encabezadoConsejos(a) {
    if (paquete.supuestos?.objetivo === 'rendimiento') {
      return `Today the plant spends <b>${num(a.horasTotalesActual, 0)} line-hours</b> on these
        <b>${num(a.toneladasActuales, 1)} t</b>. With these ${a.movimientos.length} moves it spends
        <b>${num(a.horasTotalesPropuesto, 0)} h</b> — <b>${num(a.horasAhorradas, 1)} h less</b> for
        the same tonnage, because every coil ends up on a line that runs it faster.
        <div style="color:var(--texto-tenue);margin-top:6px">
          <b>No coil is moved to a slower line.</b> Those hours are worth
          <b style="color:var(--verde)">+${num(a.toneladasPorTiempo, 1)} t</b> if you have orders to
          fill them with. The program does <b>not</b> finish earlier: evening out the lines would
          take mixing in slower runs, and that is the trade this objective refuses to make.
        </div>`;
    }
    return `Today the program finishes in <b>${num(a.makespanActual, 1)} h</b>, which is how long
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
      </div>`;
  }

  function pintarConsejos() {
    const a = paquete.analisis;
    if (!a.movimientos.length) {
      $('consejos').innerHTML =
        '<div class="vacio">The program is already balanced with the available line speeds. Nothing to move.</div>';
      return;
    }

    $('consejos').innerHTML =
      `<div class="cuerpo" style="border-bottom:1px solid var(--borde)">${encabezadoConsejos(a)}</div>` +
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
        revisarExportar();
      });
    }
    revisarExportar();
  }

  /**
   * El boton de exportar.
   *
   * Solo se prende cuando hay al menos un consejo aceptado: el archivo lleva
   * los movimientos que el programador MARCO, asi que sin nada marcado saldria
   * identico al que subio y no tendria caso mandarlo por correo.
   */
  function revisarExportar() {
    const boton = $('exportar');
    if (!boton) return;
    const aceptados = (paquete?.analisis.movimientos ?? []).filter((m) => m.aceptado === true);
    boton.disabled = aceptados.length === 0;
    boton.textContent = aceptados.length
      ? `Export to Excel (${aceptados.length} ${aceptados.length === 1 ? 'move' : 'moves'})`
      : 'Export to Excel';
    boton.title = aceptados.length
      ? 'The schedule in the same format you uploaded, with the accepted moves applied'
      : 'Mark at least one move as "Will do" first';
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
      // Un folio nuevo no hereda lo que estaba desplegado del anterior.
      corridasAbiertas.clear();
      lineaCorridas = '';
      pintarHojaCorridas();
      if (api.obtenerMatriz) pintarMatrizRendimiento(await api.obtenerMatriz(paquete));
    },

    /** 'actual' | 'propuesto' */
    cambiarVista(cual) {
      vista = cual;
      pintarTablero();
    },

    /** La hoja de corridas trae su propio selector: son dos lecturas
     *  distintas y el programador suele querer verlas cruzadas. */
    cambiarVistaCorridas(cual) {
      vistaCorridas = cual;
      corridasAbiertas.clear();
      pintarHojaCorridas();
    },

    filtrarLinea(clave) {
      lineaCorridas = clave;
      pintarHojaCorridas();
    },

    /** Desplegar o cerrar los rollos de una corrida. */
    alternarCorrida(clave) {
      const fila = document.querySelector(`tr.rollos[data-de="${CSS.escape(clave)}"]`);
      if (!fila) return;
      const abrir = fila.hidden;
      fila.hidden = !abrir;
      fila.previousElementSibling?.classList.toggle('abierta', abrir);
      if (abrir) corridasAbiertas.add(clave);
      else corridasAbiertas.delete(clave);
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

    /** Vuelve a evaluar si se puede exportar (tras reabrir un folio). */
    revisarExportar,
  };
}
