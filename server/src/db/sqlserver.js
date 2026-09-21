/**
 * Repositorio sobre SQL Server (base Plant_Platform de Florence).
 *
 * Mismas operaciones que RepositorioMemoria; el servicio no sabe cual de los
 * dos tiene enfrente.
 */

import sql from 'mssql';
import { config } from '../config.js';

let pool = null;

export async function conectar() {
  if (pool) return pool;
  pool = await new sql.ConnectionPool({
    server: config.db.server,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    options: config.db.options,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  }).connect();
  return pool;
}

export class RepositorioSql {
  constructor(pool) {
    this.pool = pool;
    this.modo = 'sqlserver';
    this._lineaId = null;
  }

  /** codigo de linea ('ITW-7') -> linea_id. Se cachea: cat_linea casi no cambia. */
  async lineaId() {
    if (this._lineaId) return this._lineaId;
    const r = await this.pool.request().query(
      `SELECT linea_id, codigo FROM cat_linea WHERE area = 'ITW'`,
    );
    this._lineaId = new Map(r.recordset.map((f) => [f.codigo, f.linea_id]));
    return this._lineaId;
  }

  /**
   * Folio consecutivo del año. Se toma el maximo ya emitido en vez de un
   * contador aparte, para que no se desincronice si alguien borra un renglon.
   */
  async siguienteFolio(anio = new Date().getFullYear()) {
    const r = await this.pool
      .request()
      .input('prefijo', sql.VarChar(20), `FLO-${anio}-%`)
      .query(
        `SELECT MAX(CAST(RIGHT(folio, 4) AS INT)) AS ultimo
           FROM flo_programa WHERE folio LIKE @prefijo`,
      );
    const siguiente = (r.recordset[0]?.ultimo ?? 0) + 1;
    return `FLO-${anio}-${String(siguiente).padStart(4, '0')}`;
  }

  /** Reemplaza la tabla de recetas completa: el WI se carga entero, no por partes. */
  async guardarVelocidades({ puntos, documento, archivo }) {
    const lineas = await this.lineaId();
    const tx = new sql.Transaction(this.pool);
    await tx.begin();
    try {
      await new sql.Request(tx).query('DELETE FROM flo_velocidad');
      const tabla = new sql.Table('flo_velocidad');
      tabla.columns.add('linea_id', sql.SmallInt, { nullable: false });
      tabla.columns.add('diametro_mm', sql.Decimal(6, 2), { nullable: false });
      tabla.columns.add('mm_s', sql.Decimal(8, 2), { nullable: false });
      tabla.columns.add('winder', sql.VarChar(10), { nullable: true });
      tabla.columns.add('grado', sql.VarChar(10), { nullable: true });
      tabla.columns.add('slm', sql.Bit, { nullable: true });
      tabla.columns.add('documento', sql.VarChar(40), { nullable: false });
      for (const p of puntos) {
        const id = lineas.get(p.linea);
        if (!id) continue; // linea que no esta en cat_linea: se ignora y se reporta arriba
        tabla.rows.add(id, p.diametroMm, p.mmS, p.winder, p.grado, p.slm, documento);
      }
      await new sql.Request(tx).bulk(tabla);
      await tx.commit();
      return { puntos: puntos.length, documento, archivo, cargadoEn: new Date().toISOString() };
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }

  async leerVelocidades() {
    const r = await this.pool.request().query(
      `SELECT l.codigo AS linea, v.diametro_mm, v.mm_s, v.winder, v.grado, v.slm
         FROM flo_velocidad v JOIN cat_linea l ON l.linea_id = v.linea_id`,
    );
    if (!r.recordset.length) return null;
    return {
      filas: r.recordset.map((f) => ({
        linea: f.linea,
        diametroMm: Number(f.diametro_mm),
        mmS: Number(f.mm_s),
        winder: f.winder,
        grado: f.grado,
        slm: f.slm === null ? null : Boolean(f.slm),
      })),
    };
  }

  /** Guarda programa + ordenes + analisis + movimientos en una sola transaccion. */
  async guardarPrograma(registro) {
    const lineas = await this.lineaId();
    const idDe = (codigo) => lineas.get(codigo) ?? null;
    const tx = new sql.Transaction(this.pool);
    await tx.begin();
    try {
      const prog = await new sql.Request(tx)
        .input('folio', sql.VarChar(20), registro.folio)
        .input('archivo', sql.NVarChar(260), registro.archivo)
        .input('cargado_por', sql.NVarChar(20), registro.cargadoPor ?? null)
        .input('ordenes', sql.Int, registro.ordenes)
        .input('kilogramos', sql.Decimal(12, 2), registro.kilogramos)
        .query(
          `INSERT INTO flo_programa (folio, archivo_nombre, cargado_por, ordenes, kilogramos)
           OUTPUT INSERTED.programa_id
           VALUES (@folio, @archivo, @cargado_por, @ordenes, @kilogramos)`,
        );
      const programaId = prog.recordset[0].programa_id;

      const tOrdenes = new sql.Table('flo_programa_orden');
      for (const [nombre, tipo] of [
        ['programa_id', sql.Int],
        ['orden_sap', sql.NVarChar(30)],
        ['material', sql.NVarChar(50)],
        ['descripcion', sql.NVarChar(200)],
        ['diametro_mm', sql.Decimal(6, 2)],
        ['kilogramos', sql.Decimal(10, 2)],
        ['grupo_grado', sql.VarChar(10)],
        ['slm', sql.Bit],
        ['winder', sql.VarChar(10)],
        ['linea_id', sql.SmallInt],
        ['secuencia', sql.Int],
        ['linea_propuesta_id', sql.SmallInt],
        ['notas', sql.NVarChar(500)],
        ['cliente_po', sql.NVarChar(50)],
      ]) {
        tOrdenes.columns.add(nombre, tipo, { nullable: true });
      }
      for (const o of registro.detalleOrdenes) {
        tOrdenes.rows.add(
          programaId, o.id, o.material, o.descripcion, o.diametroMm, o.kilogramos,
          o.grupoGrado, o.slm, o.winder, idDe(o.linea), o.secuencia,
          idDe(o.lineaPropuesta), o.notas, o.clientePo,
        );
      }
      await new sql.Request(tx).bulk(tOrdenes);

      const a = registro.analisis;
      const an = await new sql.Request(tx)
        .input('programa_id', sql.Int, programaId)
        .input('horas', sql.Decimal(6, 2), a.supuestos.horasDisponibles)
        .input('eficiencia', sql.Decimal(5, 4), a.supuestos.eficiencia)
        .input('minutos', sql.Decimal(6, 2), a.supuestos.minutosCambio)
        .input('ms_actual', sql.Decimal(8, 2), a.makespanActual)
        .input('ms_prop', sql.Decimal(8, 2), a.makespanPropuesto)
        .input('cuello', sql.SmallInt, idDe(a.cuelloDeBotella))
        .input('ht_actual', sql.Decimal(10, 2), a.horasTotalesActual)
        .input('ht_prop', sql.Decimal(10, 2), a.horasTotalesPropuesto)
        .input('factor', sql.Decimal(6, 3), a.factorProduccion)
        .input('toneladas', sql.Decimal(10, 2), a.toneladasIncremento)
        .input('movidas', sql.Int, a.ordenesMovidas)
        .input('paquete', sql.NVarChar(sql.MAX), JSON.stringify(registro))
        .query(
          `INSERT INTO flo_analisis
             (programa_id, horas_disponibles, eficiencia, minutos_cambio,
              makespan_actual_h, makespan_propuesto_h, cuello_botella_id,
              horas_totales_actual, horas_totales_propuesto,
              factor_produccion, toneladas_incremento, ordenes_movidas, paquete)
           OUTPUT INSERTED.analisis_id
           VALUES (@programa_id, @horas, @eficiencia, @minutos, @ms_actual, @ms_prop,
                   @cuello, @ht_actual, @ht_prop, @factor, @toneladas, @movidas, @paquete)`,
        );
      const analisisId = an.recordset[0].analisis_id;

      const tLineas = new sql.Table('flo_analisis_linea');
      for (const [nombre, tipo] of [
        ['analisis_id', sql.Int], ['linea_id', sql.SmallInt],
        ['ordenes_actual', sql.Int], ['kg_actual', sql.Decimal(12, 2)],
        ['horas_actual', sql.Decimal(8, 2)], ['horas_cambio_actual', sql.Decimal(8, 2)],
        ['ordenes_propuesto', sql.Int], ['kg_propuesto', sql.Decimal(12, 2)],
        ['horas_propuesto', sql.Decimal(8, 2)], ['horas_cambio_propuesto', sql.Decimal(8, 2)],
      ]) {
        tLineas.columns.add(nombre, tipo, { nullable: true });
      }
      for (const l of a.lineas) {
        tLineas.rows.add(
          analisisId, idDe(l.linea), l.actual.ordenes, l.actual.kg, l.actual.horas,
          l.actual.horasCambio, l.propuesto.ordenes, l.propuesto.kg,
          l.propuesto.horas, l.propuesto.horasCambio,
        );
      }
      await new sql.Request(tx).bulk(tLineas);

      for (const [i, m] of a.movimientos.entries()) {
        await new sql.Request(tx)
          .input('analisis_id', sql.Int, analisisId)
          .input('orden', sql.SmallInt, i + 1)
          .input('origen', sql.SmallInt, idDe(m.origen))
          .input('destino', sql.SmallInt, idDe(m.destino))
          .input('diametro', sql.Decimal(6, 2), m.diametroMm)
          .input('ordenes', sql.Int, m.ordenes)
          .input('kg', sql.Decimal(12, 2), m.kilogramos)
          .input('h_origen', sql.Decimal(8, 2), m.horasOrigen)
          .input('h_destino', sql.Decimal(8, 2), m.horasDestino)
          .input('h_libres', sql.Decimal(8, 2), m.horasLiberadas)
          .input('folios', sql.NVarChar(sql.MAX), m.folios.join(', '))
          .query(
            `INSERT INTO flo_movimiento
               (analisis_id, orden_sugerencia, origen_id, destino_id, diametro_mm,
                ordenes, kilogramos, horas_origen, horas_destino, horas_liberadas, folios_sap)
             VALUES (@analisis_id, @orden, @origen, @destino, @diametro,
                     @ordenes, @kg, @h_origen, @h_destino, @h_libres, @folios)`,
          );
      }

      await tx.commit();
      return { ...registro, programaId, analisisId };
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }

  /**
   * Devuelve exactamente el mismo paquete que RepositorioMemoria, para que
   * la pantalla no tenga que saber cual de los dos tiene detras.
   *
   * Sale de la instantanea guardada en flo_analisis.paquete, no de
   * recalcular: un folio se repinta como se emitio, aunque las recetas o los
   * parametros de linea hayan cambiado desde entonces.
   *
   * Lo unico que se superpone encima son las marcas de aceptado, porque esas
   * son anotaciones posteriores del programador y no parte del analisis
   * original.
   */
  async leerPrograma(folio) {
    const r = await this.pool
      .request()
      .input('folio', sql.VarChar(20), folio)
      .query(
        `SELECT TOP 1 a.analisis_id, a.paquete
           FROM flo_programa p
           JOIN flo_analisis a ON a.programa_id = p.programa_id
          WHERE p.folio = @folio
          ORDER BY a.analisis_id DESC`,
      );
    const fila = r.recordset[0];
    if (!fila?.paquete) return null;

    const paquete = JSON.parse(fila.paquete);

    const marcas = await this.pool
      .request()
      .input('analisis_id', sql.Int, fila.analisis_id)
      .query(
        `SELECT orden_sugerencia, aceptado FROM flo_movimiento
          WHERE analisis_id = @analisis_id AND aceptado IS NOT NULL`,
      );
    const porOrden = new Map(
      marcas.recordset.map((m) => [m.orden_sugerencia, Boolean(m.aceptado)]),
    );
    for (const m of paquete.analisis?.movimientos ?? []) {
      if (porOrden.has(m.id)) m.aceptado = porOrden.get(m.id);
    }
    return paquete;
  }

  async listarProgramas() {
    const r = await this.pool.request().query(
      `SELECT TOP 50 p.folio, p.archivo_nombre AS archivo, p.cargado_en AS cargadoEn,
              p.cargado_por AS cargadoPor, p.ordenes, p.kilogramos,
              a.toneladas_incremento AS toneladasIncremento
         FROM flo_programa p
         LEFT JOIN flo_analisis a ON a.programa_id = p.programa_id
        ORDER BY p.cargado_en DESC`,
    );
    return r.recordset;
  }

  /**
   * La pantalla identifica cada consejo por su lugar en la lista (1 = el de
   * mayor impacto), no por el IDENTITY de la tabla, que no conoce. Por eso
   * se busca por folio + orden_sugerencia.
   */
  async marcarMovimiento(folio, ordenSugerencia, aceptado) {
    const r = await this.pool
      .request()
      .input('folio', sql.VarChar(20), folio)
      .input('orden', sql.SmallInt, ordenSugerencia)
      .input('aceptado', sql.Bit, aceptado)
      .query(
        `UPDATE m SET aceptado = @aceptado
           OUTPUT INSERTED.movimiento_id, INSERTED.orden_sugerencia, INSERTED.aceptado
           FROM flo_movimiento m
           JOIN flo_analisis a ON a.analisis_id = m.analisis_id
           JOIN flo_programa p ON p.programa_id = a.programa_id
          WHERE p.folio = @folio AND m.orden_sugerencia = @orden`,
      );
    const fila = r.recordset[0];
    return fila ? { id: fila.orden_sugerencia, aceptado: Boolean(fila.aceptado) } : null;
  }
}
