/**
 * Loader de ROLES por usuario de la Ruta Crítica (F5-E7, Pieza B).
 *
 * `Usuarios.csv` (137; 23 con `IdRC_TipoUsuarios`) → `UsuarioRol` (RBAC único, A4). Cada `RC_TipoUsuarios`
 * del viejo casa por NOMBRE con un `Rol` funcional de v2 (los sembró F5-E1); el rol se ASIGNA de forma
 * ADITIVA al usuario v2 correspondiente (no borra sus roles previos), vía `asignarRolUsuarioMigrado` (A1).
 *
 * ⚠️ DEPENDENCIA CRUZADA CON F9 (la migración de usuarios). Los 137 usuarios del viejo NO están migrados
 * a v2 todavía (eso es F9): hoy en v2 solo existe `admin` (+ los que se hayan creado a mano). Por eso
 * este loader NO crea usuarios v2 (no es su etapa): solo casa cada usuario del viejo contra un usuario v2
 * EXISTENTE por su login (`Usuarios.Usuario` ↔ `Usuario.username`, normalizado a minúsculas). Si el
 * usuario v2 existe, se le asigna el rol; si NO existe todavía, se LISTA en el cuadre como
 * "UsuarioRol PENDIENTE hasta la migración de usuarios (F9)". Cuando F9 migre los usuarios, basta
 * RE-CORRER este ETL para materializar esas asignaciones (es idempotente). Sin esto, la Bandeja de E5
 * queda vacía para usuarios reales.
 *
 * También se LISTAN los usuarios ACTIVOS del viejo SIN `IdRC_TipoUsuarios` (no tendrán responsabilidad
 * por proceso en la RC) — dato para Daniel/Gabriel, no se "arregla".
 */
import { asignarRolUsuarioMigrado } from '../../src/dominio/ruta-critica/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearBandera, parsearTexto } from '../comun/valores.js';

import { cargarRolesPorNombre } from './comun.js';

/** Resultado del loader de roles por usuario. */
export interface ResultadoUsuariosRoles {
  /** Usuarios del viejo con `IdRC_TipoUsuarios` (esperado 23). */
  conTipo: number;
  /** Asignaciones MATERIALIZADAS: el usuario v2 existe y se le insertó el rol (en esta corrida o ya). */
  casadosV2: number;
  /** Roles realmente INSERTADOS en ESTA corrida (idempotencia: 0 en re-corridas). */
  insertados: number;
  /** Usuarios con tipo cuyo usuario v2 NO existe aún → PENDIENTES hasta F9. */
  pendientesF9: number;
  /** Usuarios con tipo cuyo `RC_TipoUsuarios` no casó a un Rol de v2. */
  sinRolEquivalente: number;
  /** Usuarios ACTIVOS del viejo SIN `IdRC_TipoUsuarios` (no tendrán responsabilidad RC). */
  activosSinTipo: number;
}

/** Normaliza un login para casar `Usuarios.Usuario` ↔ `Usuario.username` (minúsculas, recortado). */
function normalizarLogin(v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim().toLowerCase();
  return t === '' ? null : t;
}

export async function cargarUsuariosRoles(
  sesion: SesionUsuario,
  cliente: PrismaClient,
  reporte: Reporte,
): Promise<ResultadoUsuariosRoles> {
  const bd: ContextoBd = { cliente };
  const resultado: ResultadoUsuariosRoles = {
    conTipo: 0,
    casadosV2: 0,
    insertados: 0,
    pendientesF9: 0,
    sinRolEquivalente: 0,
    activosSinTipo: 0,
  };

  // RC_TipoUsuarios: IdRC_TipoUsuarios → nombre del rol funcional.
  const nombreTipoPorId = new Map<string, string>();
  for (const f of leerCsv('RC_TipoUsuarios.csv')) {
    const idTipo = (f.IdRC_TipoUsuarios ?? '').trim();
    const nombre = parsearTexto(f.NombreTipoUsuario);
    if (idTipo !== '' && nombre !== null) nombreTipoPorId.set(idTipo, nombre);
  }

  // Rol.nombre → id (RBAC único, A4).
  const rolPorNombre = await cargarRolesPorNombre(cliente);

  // Usuarios v2 EXISTENTES por username (normalizado). Hoy típicamente solo `admin`.
  const usuariosV2 = await cliente.usuario.findMany({ select: { id: true, username: true } });
  const idUsuarioV2PorLogin = new Map<string, string>();
  for (const u of usuariosV2) {
    const login = normalizarLogin(u.username);
    if (login !== null) idUsuarioV2PorLogin.set(login, u.id);
  }

  for (const f of leerCsv('Usuarios.csv')) {
    const idTipo = (f.IdRC_TipoUsuarios ?? '').trim();
    const tieneTipo = idTipo !== '' && idTipo !== '0';
    const activo = parsearBandera(f.Activo);
    const login = normalizarLogin(parsearTexto(f.Usuario));

    if (!tieneTipo) {
      if (activo) {
        resultado.activosSinTipo += 1;
        reporte.agregar(
          'Usuario ACTIVO del viejo SIN tipo RC (no tendrá responsabilidad por proceso)',
          `IdUsuarios=${(f.IdUsuarios ?? '').trim()} usuario="${login ?? '?'}"`,
        );
      }
      continue;
    }

    resultado.conTipo += 1;

    const nombreRol = nombreTipoPorId.get(idTipo);
    const idRol = nombreRol === undefined ? undefined : rolPorNombre.get(nombreRol);
    if (idRol === undefined) {
      resultado.sinRolEquivalente += 1;
      reporte.agregar(
        'Usuario con tipo RC sin Rol equivalente en v2 (no se pudo asignar)',
        `IdUsuarios=${(f.IdUsuarios ?? '').trim()} usuario="${login ?? '?'}" IdRC_TipoUsuarios=${idTipo}` +
          (nombreRol === undefined ? '' : ` tipo="${nombreRol}"`),
      );
      continue;
    }

    const idUsuarioV2 = login === null ? undefined : idUsuarioV2PorLogin.get(login);
    if (idUsuarioV2 === undefined) {
      // El usuario v2 aún NO existe (se migra en F9). Se LISTA como pendiente; re-correr el ETL tras F9
      // materializa la asignación (idempotente).
      resultado.pendientesF9 += 1;
      reporte.agregar(
        'UsuarioRol PENDIENTE hasta la migración de usuarios (F9): usuario v2 inexistente',
        `IdUsuarios=${(f.IdUsuarios ?? '').trim()} usuario="${login ?? '?'}" rol="${nombreRol ?? '?'}"`,
      );
      continue;
    }

    const inserto = await intentarCrear(reporte, 'UsuarioRol', login ?? '?', () =>
      asignarRolUsuarioMigrado(sesion, idUsuarioV2, idRol, bd),
    );
    if (inserto === null) continue;
    resultado.casadosV2 += 1;
    if (inserto) resultado.insertados += 1;
  }

  return resultado;
}
