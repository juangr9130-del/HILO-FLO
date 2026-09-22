/* ==========================================================================
   HILO-FLO — tablas del modulo

   Modulo de la plataforma Mubea para la programacion de las lineas ITW
   (Induction Tempered Wire) de Florence. Prefijo de tabla: flo_.

   Tres grupos:

     RECETAS     flo_velocidad, flo_parametro_linea
                 Lo que la planta puede hacer. Se carga del
                 WI-FLO-CSW-P-526 y casi no cambia.

     PROGRAMA    flo_programa, flo_programa_orden
                 Cada carga del production schedule de SAP, con su FOLIO.
                 Es el registro historico: un folio nunca se sobreescribe.

     ANALISIS    flo_analisis, flo_analisis_linea, flo_movimiento
                 El resultado de correr el algoritmo sobre un folio. Se
                 guarda para poder comparar despues lo que se recomendo
                 contra lo que de verdad se hizo.

   Equivalencia con CSW: flo_velocidad + el calculo de kg/h cumplen el mismo
   papel que hilo_rendimiento (linea_id, diametro, kg_hora) del modulo HILO.
   Aqui no se guarda el kg/h sino la velocidad de receta en mm/s, porque es
   el dato que emite el documento de proceso; el kg/h se deriva de la
   geometria del alambre (ver vw_flo_rendimiento).
   ========================================================================== */

USE Plant_Platform;
GO

/* ==========================================================================
   RECETAS
   ========================================================================== */

/* Parametros de operacion de cada linea.
   Ninguno de estos tres viene en los Excel de planta — se capturan aqui.
   Mientras Florence no confirme los suyos, el modulo corre con los valores
   por omision documentados en docs/SUPUESTOS.md. */
CREATE TABLE flo_parametro_linea (
    linea_id            SMALLINT      NOT NULL PRIMARY KEY,
    horas_disponibles   DECIMAL(6,2)  NOT NULL,          -- por horizonte de programacion
    eficiencia          DECIMAL(5,4)  NOT NULL DEFAULT 1, -- 1 = velocidad de receta tal cual
    minutos_cambio      DECIMAL(6,2)  NOT NULL DEFAULT 0, -- costo de un cambio de medida
    CONSTRAINT FK_flo_parametro_linea FOREIGN KEY (linea_id) REFERENCES cat_linea(linea_id),
    CONSTRAINT CK_flo_parametro_eficiencia CHECK (eficiencia > 0 AND eficiencia <= 1),
    CONSTRAINT CK_flo_parametro_horas CHECK (horas_disponibles >= 0)
);
GO

/* El catalogo de velocidades de receta.

   Se siembra al arrancar desde el catalogo que trae el propio modulo
   (server/src/catalogo/velocidades.js, generado del WI). De ahi en adelante
   se edita desde la pantalla de Velocidades: no hay que volver a cargar el
   Excel para corregir un valor.

   mm_s es el valor vigente y mm_s_documento el que trae el WI. Guardar los
   dos permite ver que se aparto del documento y por cuanto, regresar a el
   con un clic, y sobre todo no perder las correcciones de planta cuando
   salga una revision nueva del documento.

   El rendimiento en kg/h NO se guarda: sale de mm_s y de la geometria del
   alambre (ver vw_flo_rendimiento), asi que cambiar la velocidad lo
   recalcula solo.

   Es tambien la MATRIZ DE COMPATIBILIDAD: si una linea no tiene renglon para
   un diametro, no lo corre. Confirmado con Florence: una celda vacia en el
   WI significa que ese diametro casi no se corre en esa linea, aunque el
   rango de la bobina de calentamiento lo permitiera.

   winder / grado / slm son los discriminantes que trae el documento:
     - ITW-2  se tabula por devanador (Neturen / DEM) y por grado (9254/1065)
     - ITW-10 se tabula por SLM / NON SLM
   NULL significa "aplica a cualquiera". */
CREATE TABLE flo_velocidad (
    velocidad_id    INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
    linea_id        SMALLINT      NOT NULL,
    diametro_mm     DECIMAL(6,2)  NOT NULL,   -- diametro de alambre estirado
    mm_s            DECIMAL(8,2)  NOT NULL,   -- velocidad vigente
    mm_s_documento  DECIMAL(8,2)  NOT NULL,   -- la del WI, para poder regresar
    winder          VARCHAR(10)   NULL,       -- 'NETUREN' | 'DEM' | NULL
    grado           VARCHAR(10)   NULL,       -- '9254' | '1065' | NULL
    slm             BIT           NULL,       -- NULL = aplica a ambos
    documento       VARCHAR(40)   NOT NULL DEFAULT 'WI-FLO-CSW-P-526',
    cargado_en      DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
    ajustado_en     DATETIME2(0)  NULL,       -- cuando se aparto del documento
    ajustado_por    NVARCHAR(20)  NULL,       -- numero de empleado
    CONSTRAINT FK_flo_velocidad_linea FOREIGN KEY (linea_id) REFERENCES cat_linea(linea_id),
    CONSTRAINT FK_flo_velocidad_usuario FOREIGN KEY (ajustado_por) REFERENCES cat_empleados(numero_empleado),
    CONSTRAINT CK_flo_velocidad_mm_s CHECK (mm_s > 0 AND mm_s <= 2000),
    CONSTRAINT CK_flo_velocidad_documento CHECK (mm_s_documento > 0),
    CONSTRAINT CK_flo_velocidad_diametro CHECK (diametro_mm > 0),
    CONSTRAINT CK_flo_velocidad_winder CHECK (winder IS NULL OR winder IN ('NETUREN', 'DEM')),
    CONSTRAINT UQ_flo_velocidad UNIQUE (linea_id, diametro_mm, winder, grado, slm)
);
GO
CREATE INDEX IX_flo_velocidad_diametro ON flo_velocidad (diametro_mm, linea_id);
GO

/* Lo que se aparto del documento, para revisarlo de un vistazo. */
CREATE VIEW vw_flo_velocidad_ajustada AS
SELECT l.codigo AS linea, v.diametro_mm, v.winder, v.grado, v.slm,
       v.mm_s_documento, v.mm_s,
       CAST(v.mm_s - v.mm_s_documento AS DECIMAL(8,2)) AS diferencia,
       v.ajustado_en, v.ajustado_por
FROM flo_velocidad v
JOIN cat_linea l ON l.linea_id = v.linea_id
WHERE v.mm_s <> v.mm_s_documento;
GO

/* El rendimiento en kg/h no se almacena: se deriva. El alambre es solido y
   el temple por induccion no cambia la seccion, asi que

       kg/h = mm_s * 3.6 * (pi/4 * d^2) * densidad_kg_m3 * 1e-6 * eficiencia

   Guardarlo duplicado se desincronizaria en cuanto cambie la eficiencia de
   una linea. La densidad del acero de resorte es 7850 kg/m3. */
CREATE VIEW vw_flo_rendimiento AS
SELECT
    v.velocidad_id,
    v.linea_id,
    l.codigo               AS linea,
    v.diametro_mm,
    v.mm_s,
    v.winder,
    v.grado,
    v.slm,
    CAST(
        v.mm_s * 3.6
        * (PI() / 4.0 * POWER(CAST(v.diametro_mm AS FLOAT), 2)) * 1e-6 * 7850.0
        * ISNULL(p.eficiencia, 1)
    AS DECIMAL(10,2))      AS kg_hora
FROM flo_velocidad v
JOIN cat_linea l            ON l.linea_id = v.linea_id
LEFT JOIN flo_parametro_linea p ON p.linea_id = v.linea_id;
GO

/* ==========================================================================
   PROGRAMA
   ========================================================================== */

/* Cada carga del production schedule. El FOLIO es lo que el programador ve y
   cita ("el analisis del folio FLO-2026-0007"): un programa subido nunca se
   sobreescribe, se sube uno nuevo. */
/* ---------- Reglas del reajuste ----------
   Viven en la base y no en el codigo: el programador las cambia desde la
   pantalla. Solo se guarda lo que se aparta del valor de fabrica, asi que
   una tabla vacia significa "todo por omision". */
CREATE TABLE flo_regla (
    clave            NVARCHAR(40)  NOT NULL PRIMARY KEY,
    valor            NVARCHAR(100) NOT NULL,  -- se guarda como texto y el servicio lo interpreta
    cambiada_en      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    cambiada_por     NVARCHAR(20)  NULL,
    CONSTRAINT FK_flo_regla_usuario FOREIGN KEY (cambiada_por) REFERENCES cat_empleados(numero_empleado)
);
GO

CREATE TABLE flo_programa (
    programa_id         INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
    folio               VARCHAR(20)   NOT NULL,   -- 'FLO-2026-0007'
    archivo_nombre      NVARCHAR(260) NOT NULL,
    fecha_schedule      DATE          NULL,       -- la que trae el nombre/encabezado del archivo
    cargado_en          DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
    cargado_por         NVARCHAR(20)  NULL,       -- numero de empleado
    ordenes             INT           NOT NULL DEFAULT 0,
    kilogramos          DECIMAL(12,2) NOT NULL DEFAULT 0,
    estatus             VARCHAR(20)   NOT NULL DEFAULT 'analizado',
    CONSTRAINT UQ_flo_programa_folio UNIQUE (folio),
    CONSTRAINT FK_flo_programa_usuario FOREIGN KEY (cargado_por) REFERENCES cat_empleados(numero_empleado),
    CONSTRAINT CK_flo_programa_estatus CHECK (estatus IN ('analizado', 'aplicado', 'descartado'))
);
GO

/* Una orden de SAP dentro de un programa.

   linea_id es donde la puso el programador (viene del work center del
   schedule: BB007 -> ITW-7). linea_propuesta_id es donde el algoritmo
   sugiere ponerla; iguales = el algoritmo no la movio.

   diametro_mm, grupo_grado, slm y winder NO vienen en columnas propias del
   schedule: se interpretan de la descripcion del material y de las notas
   (ver docs/DOMINIO.md). Se guardan ya resueltos para que el analisis sea
   reproducible aunque despues cambie el parser. */
CREATE TABLE flo_programa_orden (
    orden_id            BIGINT        NOT NULL IDENTITY(1,1) PRIMARY KEY,
    programa_id         INT           NOT NULL,
    orden_sap           NVARCHAR(30)  NOT NULL,
    material            NVARCHAR(50)  NULL,
    descripcion         NVARCHAR(200) NOT NULL,
    diametro_mm         DECIMAL(6,2)  NOT NULL,
    kilogramos          DECIMAL(10,2) NOT NULL,
    grupo_grado         VARCHAR(10)   NOT NULL DEFAULT '9254',
    slm                 BIT           NOT NULL DEFAULT 0,
    winder              VARCHAR(10)   NULL,
    linea_id            SMALLINT      NOT NULL,   -- como la programo el programador
    secuencia           INT           NOT NULL,
    linea_propuesta_id  SMALLINT      NULL,       -- como la sugiere el algoritmo
    fijo                BIT           NOT NULL DEFAULT 0,  -- el algoritmo no la puede mover
    notas               NVARCHAR(500) NULL,
    cliente_po          NVARCHAR(50)  NULL,
    CONSTRAINT FK_flo_orden_programa FOREIGN KEY (programa_id) REFERENCES flo_programa(programa_id),
    CONSTRAINT FK_flo_orden_linea FOREIGN KEY (linea_id) REFERENCES cat_linea(linea_id),
    CONSTRAINT FK_flo_orden_linea_propuesta FOREIGN KEY (linea_propuesta_id) REFERENCES cat_linea(linea_id),
    CONSTRAINT CK_flo_orden_kg CHECK (kilogramos > 0),
    CONSTRAINT CK_flo_orden_diametro CHECK (diametro_mm > 0)
);
GO
CREATE INDEX IX_flo_orden_programa ON flo_programa_orden (programa_id, linea_id, secuencia);
GO

/* ==========================================================================
   ANALISIS
   ========================================================================== */

/* El resultado de correr el algoritmo sobre un programa.

   El numero que le importa al programador es el par
   (makespan_actual_h, makespan_propuesto_h): el programa cierra cuando
   termina su linea mas cargada, asi que bajar ese numero es lo que de
   verdad sube la produccion. toneladas_incremento es esa mejora expresada
   en tonelada dentro del mismo calendario.

   Se guardan tambien los supuestos con los que se corrio: sin ellos, dos
   analisis del mismo folio no son comparables. */
CREATE TABLE flo_analisis (
    analisis_id             INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
    programa_id             INT           NOT NULL,
    corrido_en              DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
    -- supuestos
    horas_disponibles       DECIMAL(6,2)  NOT NULL,
    eficiencia              DECIMAL(5,4)  NOT NULL,
    minutos_cambio          DECIMAL(6,2)  NOT NULL,
    -- resultado
    makespan_actual_h       DECIMAL(8,2)  NOT NULL,
    makespan_propuesto_h    DECIMAL(8,2)  NOT NULL,
    cuello_botella_id       SMALLINT      NULL,   -- la linea que define el cierre hoy
    horas_totales_actual    DECIMAL(10,2) NOT NULL,
    horas_totales_propuesto DECIMAL(10,2) NOT NULL,
    factor_produccion       DECIMAL(6,3)  NOT NULL,  -- makespan_actual / makespan_propuesto
    toneladas_incremento    DECIMAL(10,2) NOT NULL,
    ordenes_movidas         INT           NOT NULL DEFAULT 0,
    /* Instantanea exacta de lo que se le mostro al programador ese dia.

       Las columnas de arriba y las dos tablas que siguen son la version
       consultable (para BI, para cruzar folios, para sacar promedios). Esta
       columna es la version fiel: el mismo JSON que consumio la pantalla,
       con el detalle por corrida y los avisos, que no se normalizan porque
       nadie los va a consultar por SQL.

       Es duplicacion a proposito. Sin ella, repintar un folio de hace tres
       meses obligaria a recalcularlo, y el resultado ya no seria el que se
       vio: las recetas o los parametros de linea pudieron cambiar desde
       entonces. Un folio tiene que poder defenderse tal como se emitio. */
    paquete                 NVARCHAR(MAX) NULL,
    CONSTRAINT FK_flo_analisis_programa FOREIGN KEY (programa_id) REFERENCES flo_programa(programa_id),
    CONSTRAINT FK_flo_analisis_cuello FOREIGN KEY (cuello_botella_id) REFERENCES cat_linea(linea_id)
);
GO

/* La carga de cada linea, antes y despues. Es lo que pinta la pantalla de
   programacion y las barras de utilizacion. */
CREATE TABLE flo_analisis_linea (
    analisis_id             INT           NOT NULL,
    linea_id                SMALLINT      NOT NULL,
    ordenes_actual          INT           NOT NULL DEFAULT 0,
    kg_actual               DECIMAL(12,2) NOT NULL DEFAULT 0,
    horas_actual            DECIMAL(8,2)  NOT NULL DEFAULT 0,
    horas_cambio_actual     DECIMAL(8,2)  NOT NULL DEFAULT 0,
    ordenes_propuesto       INT           NOT NULL DEFAULT 0,
    kg_propuesto            DECIMAL(12,2) NOT NULL DEFAULT 0,
    horas_propuesto         DECIMAL(8,2)  NOT NULL DEFAULT 0,
    horas_cambio_propuesto  DECIMAL(8,2)  NOT NULL DEFAULT 0,
    CONSTRAINT PK_flo_analisis_linea PRIMARY KEY (analisis_id, linea_id),
    CONSTRAINT FK_flo_analisis_linea_analisis FOREIGN KEY (analisis_id) REFERENCES flo_analisis(analisis_id),
    CONSTRAINT FK_flo_analisis_linea_linea FOREIGN KEY (linea_id) REFERENCES cat_linea(linea_id)
);
GO

/* Los consejos concretos: "pasa las 13 ordenes de 17.50 mm de ITW-12 a
   ITW-13". Un renglon por grupo (origen, destino, diametro), no por orden —
   el programador no mueve rollos de uno en uno.

   aceptado deja registrar que hizo el programador con cada consejo, que es
   lo que despues permite medir si el modulo sirvio de algo. */
CREATE TABLE flo_movimiento (
    movimiento_id       INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
    analisis_id         INT           NOT NULL,
    orden_sugerencia    SMALLINT      NOT NULL,   -- 1 = la de mayor impacto
    origen_id           SMALLINT      NOT NULL,
    destino_id          SMALLINT      NOT NULL,
    diametro_mm         DECIMAL(6,2)  NOT NULL,
    ordenes             INT           NOT NULL,
    kilogramos          DECIMAL(12,2) NOT NULL,
    horas_origen        DECIMAL(8,2)  NOT NULL,
    horas_destino       DECIMAL(8,2)  NOT NULL,
    horas_liberadas     DECIMAL(8,2)  NOT NULL,   -- horas_origen - horas_destino
    folios_sap          NVARCHAR(MAX) NULL,       -- lista separada por coma
    aceptado            BIT           NULL,       -- NULL = el programador no ha dicho
    CONSTRAINT FK_flo_movimiento_analisis FOREIGN KEY (analisis_id) REFERENCES flo_analisis(analisis_id),
    CONSTRAINT FK_flo_movimiento_origen FOREIGN KEY (origen_id) REFERENCES cat_linea(linea_id),
    CONSTRAINT FK_flo_movimiento_destino FOREIGN KEY (destino_id) REFERENCES cat_linea(linea_id),
    CONSTRAINT CK_flo_movimiento_distinto CHECK (origen_id <> destino_id)
);
GO
CREATE INDEX IX_flo_movimiento_analisis ON flo_movimiento (analisis_id, orden_sugerencia);
GO

/* ==========================================================================
   Semilla de parametros — supuestos por omision (ver docs/SUPUESTOS.md)
   ========================================================================== */
-- Eficiencia en 1: por ahora el analisis corre contra la velocidad de receta
-- tal cual. Se sube a un OEE real cuando Florence lo mida.
INSERT INTO flo_parametro_linea (linea_id, horas_disponibles, eficiencia, minutos_cambio)
SELECT linea_id, 144, 1, 45 FROM cat_linea WHERE area = 'ITW';
GO
