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
    this.velocidades = null; // { puntos, documento, cargadoEn }
    this.consecutivo = 0;
    this.modo = 'memoria';
  }

  async siguienteFolio(anio = new Date().getFullYear()) {
    this.consecutivo += 1;
    return `FLO-${anio}-${String(this.consecutivo).padStart(4, '0')}`;
  }

  async guardarVelocidades({ puntos, documento, archivo }) {
    this.velocidades = { puntos, documento, archivo, cargadoEn: new Date().toISOString() };
    return this.velocidades;
  }

  async leerVelocidades() {
    return this.velocidades;
  }

  async guardarPrograma(registro) {
    this.programas.set(registro.folio, registro);
    return registro;
  }

  async leerPrograma(folio) {
    return this.programas.get(folio) ?? null;
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
        toneladasIncremento: analisis?.toneladasIncremento ?? 0,
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
}
