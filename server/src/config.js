/**
 * Configuracion por variables de entorno, igual que el resto de la
 * plataforma (cadena de conexion y JWT_SECRET compartido entre modulos).
 */

export const config = {
  puerto: Number(process.env.FLO_PUERTO ?? 3005),
  modulo: 'FLO',

  // Mismo secreto que los demas modulos: la cookie de sesion se emite en
  // cualquier puerta y todos la verifican localmente, sin consultarse entre si.
  jwtSecret: process.env.JWT_SECRET ?? '',
  cookie: process.env.FLO_COOKIE ?? 'mubea_sesion',

  // Roles que pueden entrar al modulo. En produccion manda rol_modulo_acceso
  // (cacheado en memoria); esta lista es el respaldo si la tabla no responde.
  rolesPermitidos: (process.env.FLO_ROLES ?? 'programador,supervisor,produccion,administrador,calidad')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean),

  db: {
    server: process.env.DB_SERVER ?? '',
    database: process.env.DB_DATABASE ?? 'Plant_Platform',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
    },
  },

  // Supuestos por omision mientras Florence no confirme los suyos.
  // Ver docs/SUPUESTOS.md.
  horasDisponibles: Number(process.env.FLO_HORAS ?? 144),
  eficiencia: Number(process.env.FLO_EFICIENCIA ?? 1),
  minutosCambio: Number(process.env.FLO_MINUTOS_CAMBIO ?? 45),
  maxMovimientos: Number(process.env.FLO_MAX_MOVIMIENTOS ?? 400),
};

/** Sin cadena de conexion el modulo arranca en memoria (modo demo). */
export function hayBaseDeDatos() {
  return Boolean(config.db.server && config.db.database);
}
