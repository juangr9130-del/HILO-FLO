/**
 * Repositorio en memoria — modo demo.
 *
 * Se usa cuando el modulo arranca sin cadena de conexion: sirve para ver la
 * pantalla y validar el algoritmo con archivos reales sin montar SQL Server.
 * Pierde todo al reiniciar; el folio se reinicia con el proceso.
 */

export class RepositorioMemoria {
  constructor() {
    this.programas = new Map(); // folio -> registro
    this.ajustes = new Map(); // clave de punto -> mm/s
    this.consecutivo = 0;
    this.modo = 'memoria';
  }

  async siguienteFolio(anio = new Date().getFullYear()) {
    this.consecutivo += 1;
    return `FLO-${anio}-${String(this.consecutivo).padStart(4, '0')}`;
  }

  /** Los ajustes de velocidad encima de la semilla que trae el modulo. */
  async leerAjustes() {
    return this.ajustes;
  }

  // --- reglas del reajuste ---
  // Solo se guarda lo que se aparta del valor de fabrica: un objeto vacio
  // significa "todo por omision".

  async leerReglas() {
    return { ...(this.reglas ?? {}) };
  }

  async guardarRegla(clave, valor) {
    this.reglas = { ...(this.reglas ?? {}), [clave]: valor };
    return { clave, valor };
  }

  async leerRangos() {
    return new Map(this.rangos ?? []);
  }

  async guardarRango(linea, rango) {
    this.rangos = new Map(this.rangos ?? []);
    this.rangos.set(linea, rango);
    return { linea, rango };
  }

  async quitarRango(linea) {
    if (!this.rangos?.has(linea)) return null;
    this.rangos.delete(linea);
    return { linea };
  }

  async quitarRegla(clave) {
    if (!this.reglas || !(clave in this.reglas)) return null;
    const { [clave]: fuera, ...resto } = this.reglas;
    this.reglas = resto;
    return { clave };
  }

  async guardarAjuste(clave, mmS) {
    this.ajustes.set(clave, mmS);
    return { clave, mmS };
  }

  async quitarAjuste(clave) {
    return this.ajustes.delete(clave) ? { clave } : null;
  }

  async quitarTodosLosAjustes() {
    const n = this.ajustes.size;
    this.ajustes.clear();
    return n;
  }

  async guardarPrograma(registro) {
    this.programas.set(registro.folio, registro);
    return registro;
  }

  async leerPrograma(folio) {
    return this.programas.get(folio) ?? null;
  }

  async borrarPrograma(folio) {
    return this.programas.delete(folio) ? { folio } : null;
  }

  async listarProgramas() {
    return [...this.programas.values()]
      .map(({ folio, archivo, cargadoEn, cargadoPor, ordenes, kilogramos, analisis }) => ({
        folio,
        archivo,
        cargadoEn,
        cargadoPor,
        ordenes,
        kilogramos,
        // La cifra titular depende del objetivo con que se corrio el folio.
        toneladasGanadas: analisis?.toneladasGanadas ?? analisis?.toneladasIncremento ?? 0,
        objetivo: analisis?.objetivo ?? null,
      }))
      .sort((a, b) => String(b.cargadoEn).localeCompare(String(a.cargadoEn)));
  }

  /** Misma firma y misma respuesta que RepositorioSql: la pantalla identifica
   *  el consejo por su lugar en la lista, no por un id de tabla. */
  async marcarMovimiento(folio, ordenSugerencia, aceptado) {
    const p = this.programas.get(folio);
    const m = p?.analisis?.movimientos?.find((x) => x.id === ordenSugerencia);
    if (!m) return null;
    m.aceptado = aceptado;
    return { id: m.id, aceptado };
  }

  /** Lo que el programador decidio de cada consejo. Lo usa la exportacion. */
  async leerMovimientos(folio) {
    const p = this.programas.get(folio);
    const decisiones = new Map();
    for (const m of p?.analisis?.movimientos ?? []) {
      if (m.aceptado !== null && m.aceptado !== undefined) decisiones.set(m.id, m.aceptado);
    }
    return decisiones;
  }
}
