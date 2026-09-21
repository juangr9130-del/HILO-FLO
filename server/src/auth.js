/**
 * Sesion de la plataforma.
 *
 * Cookie httpOnly con un JWT firmado con el secreto compartido (JWT_SECRET,
 * misma variable en los cuatro modulos). Cada backend verifica el token
 * localmente, sin consultar a otro proceso — coherente con "un PM2 por
 * modulo".
 *
 * Defensa en el propio modulo, no solo en el ruteo: que a alguien no le
 * demos el link no basta, este backend rechaza por rol en su propio codigo.
 */

import jwt from 'jsonwebtoken';
import { config } from './config.js';

/** Sin JWT_SECRET el modulo corre abierto (modo demo, solo para desarrollo). */
export function hayAutenticacion() {
  return Boolean(config.jwtSecret);
}

export function verificar(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function sesion(req, _res, siguiente) {
  req.usuario = null;
  if (!hayAutenticacion()) {
    req.usuario = { numeroEmpleado: 'demo', rol: 'administrador', demo: true };
    return siguiente();
  }
  const token = req.cookies?.[config.cookie];
  if (token) {
    try {
      const payload = verificar(token);
      req.usuario = {
        numeroEmpleado: payload.numero_empleado ?? payload.sub ?? null,
        rol: payload.rol ?? null,
        nombre: payload.nombre ?? null,
      };
    } catch {
      req.usuario = null; // token vencido o mal firmado: se trata como sin sesion
    }
  }
  siguiente();
}

/** Exige sesion valida y rol con acceso al modulo FLO. */
export function exigirAcceso(req, res, siguiente) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'Sesion requerida.' });
  }
  if (!req.usuario.demo && !config.rolesPermitidos.includes(req.usuario.rol)) {
    return res.status(403).json({
      error: `El rol "${req.usuario.rol}" no tiene acceso a HILO-FLO.`,
    });
  }
  siguiente();
}

/** Solo quien programa puede cargar un schedule o cambiar las recetas. */
export function exigirEscritura(req, res, siguiente) {
  const permitidos = ['programador', 'produccion', 'administrador'];
  if (!req.usuario?.demo && !permitidos.includes(req.usuario?.rol)) {
    return res.status(403).json({
      error: 'Solo el programador puede cargar programas o recetas.',
    });
  }
  siguiente();
}
