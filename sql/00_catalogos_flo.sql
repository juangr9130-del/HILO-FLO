/* ==========================================================================
   HILO-FLO — delta a catalogos-core para la planta de Florence

   Florence corre la MISMA arquitectura de la plataforma Mubea (un proceso
   PM2 por modulo, catalogos cat_*, tablas propias con prefijo de modulo,
   login por cookie httpOnly con JWT) pero es OTRA PLANTA: otros empleados,
   otras lineas, otra red. Por eso NO comparte la base fisica con CSW —
   levanta su propia instancia de Plant_Platform con el mismo esquema.

   Este archivo es solo lo que cambia respecto a
   Plant_Platform/sql/00_catalogos_compartidos.sql:

     1. cat_linea acepta el area 'ITW' (las 14 lineas de temple de Florence,
        mas la 15 por instalarse).
     2. rol_modulo_acceso acepta el modulo 'FLO'.

   Todo lo demas (cat_empleados, cat_usuarios, cat_rol, cat_equipo_turno...)
   se crea igual que en CSW, con los datos de Florence.
   ========================================================================== */

USE Plant_Platform;
GO

/* ---------- 1. Area ITW en el catalogo de lineas ---------- */
-- En CSW el CHECK es ('HL','DL'). Florence agrega 'ITW'.
ALTER TABLE cat_linea DROP CONSTRAINT CK_cat_linea_area;
GO
ALTER TABLE cat_linea ADD CONSTRAINT CK_cat_linea_area
    CHECK (area IN ('HL', 'DL', 'ITW'));
GO

-- Las 14 lineas instaladas. ITW-15 entra desactivada: esta por instalarse, y
-- asi se puede simular su arranque sin que el optimizador le mande carga.
INSERT INTO cat_linea (codigo, area, activo) VALUES
    ('ITW-1',  'ITW', 1), ('ITW-2',  'ITW', 1), ('ITW-3',  'ITW', 1),
    ('ITW-4',  'ITW', 1), ('ITW-5',  'ITW', 1), ('ITW-6',  'ITW', 1),
    ('ITW-7',  'ITW', 1), ('ITW-8',  'ITW', 1), ('ITW-9',  'ITW', 1),
    ('ITW-10', 'ITW', 1), ('ITW-11', 'ITW', 1), ('ITW-12', 'ITW', 1),
    ('ITW-13', 'ITW', 1), ('ITW-14', 'ITW', 1),
    ('ITW-15', 'ITW', 0);
GO

/* ---------- 2. El modulo FLO en el control de acceso ---------- */
ALTER TABLE rol_modulo_acceso DROP CONSTRAINT CK_rol_modulo_acceso_modulo;
GO
ALTER TABLE rol_modulo_acceso ADD CONSTRAINT CK_rol_modulo_acceso_modulo
    CHECK (modulo IN ('HILO', 'HORA', 'MTTO', 'AUTO', 'FLO'));
GO

-- Quien entra a HILO-FLO. El programador es el usuario principal: es su
-- herramienta de trabajo. Produccion y administrador ven todo; calidad y
-- supervisor solo consultan.
INSERT INTO rol_modulo_acceso (rol_id, modulo, puede_acceder)
SELECT rol_id, 'FLO', 1 FROM cat_rol
WHERE nombre IN ('programador', 'supervisor', 'produccion', 'administrador', 'calidad');
GO
