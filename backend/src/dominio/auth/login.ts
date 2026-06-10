/**
 * Lógica de negocio del inicio de sesión: bloqueo por intentos fallidos (A1).
 *
 * Reproduce el procedimiento `Verif` del sistema viejo (doc funcional
 * `00-Arranque-Login-y-Menu.md` §1.1), modernizado:
 *
 *  1. Antes de verificar la contraseña se revisa el estado de la cuenta:
 *     - inexistente → no se revela (se deja que el motor de auth conteste
 *       "credenciales inválidas"; no se filtra qué usuarios existen);
 *     - desactivada (`activo = false`) → no entra;
 *     - bloqueada (`bloqueado = true`, equivalente a `CantBloq >= 5`) → no entra,
 *       con el mensaje claro en español. El desbloqueo es manual por un
 *       administrador (`desbloquearUsuario` en `dominio/admin/usuarios.ts`).
 *  2. Contraseña incorrecta → `intentosFallidos`+1; al llegar a {@link MAX_INTENTOS}
 *     la cuenta queda bloqueada (paridad exacta con `CantBloq >= 5`).
 *  3. Contraseña correcta → `intentosFallidos = 0` y se registra el acceso
 *     (bitácora `OTRO`, sucesora de `UsuariosLog`, A7).
 *
 * Esta lógica vive en el dominio (A1) y la invocan los hooks de better-auth
 * (`src/auth`): el motor de autenticación verifica la contraseña, pero el
 * bloqueo —regla de negocio— lo decide el servidor aquí. Los campos
 * `intentosFallidos`/`bloqueado`/`activo` son del modelo `Usuario`.
 */
import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorBloqueado } from '../../comun/errores.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

/**
 * Intentos fallidos consecutivos que bloquean la cuenta. Paridad con el sistema
 * viejo: `CantBloq >= 5` (doc 00 §1.1). El 5º intento fallido deja `bloqueado`.
 */
export const MAX_INTENTOS = 5;

/** Mensaje EXACTO de cuenta bloqueada (doc 00 §1.1, adaptado a v2 sin nombre propio). */
export const MENSAJE_BLOQUEADO = 'Estás bloqueado. Contacta al administrador.';

/** Mensaje de cuenta desactivada (no es un bloqueo por intentos: es baja administrativa). */
export const MENSAJE_DESACTIVADO = 'Tu cuenta está desactivada. Contacta al administrador.';

/** Resultado de evaluar si la cuenta puede siquiera intentar el inicio de sesión. */
export type EvaluacionPrevia =
  | { estado: 'permitido'; idUsuario: string }
  /** El usuario no existe: NO se revela (se deja que auth conteste genérico). */
  | { estado: 'desconocido' };

/**
 * Decide si una cuenta puede intentar iniciar sesión, ANTES de verificar la
 * contraseña (orden del sistema viejo: el bloqueo manda sobre la clave).
 *
 * - Usuario inexistente → `{ estado: 'desconocido' }` (no se filtra existencia).
 * - Cuenta desactivada o bloqueada → lanza `ErrorBloqueado` (la ruta/hook lo
 *   traduce a 403 con el mensaje en español).
 *
 * @param username nombre de usuario normalizado a minúsculas (como lo guarda el
 *                 plugin username de better-auth).
 */
export async function evaluarAccesoPrevio(
  username: string,
  bd?: ContextoBd,
): Promise<EvaluacionPrevia> {
  const usuario = await clienteLectura(bd).usuario.findUnique({
    where: { username },
    select: { id: true, activo: true, bloqueado: true },
  });

  if (usuario === null) {
    return { estado: 'desconocido' };
  }
  if (!usuario.activo) {
    throw new ErrorBloqueado(MENSAJE_DESACTIVADO);
  }
  if (usuario.bloqueado) {
    throw new ErrorBloqueado(MENSAJE_BLOQUEADO);
  }
  return { estado: 'permitido', idUsuario: usuario.id };
}

/** Estado de la cuenta tras registrar un intento fallido. */
export interface ResultadoIntentoFallido {
  /** Intentos fallidos acumulados después de este. */
  intentosFallidos: number;
  /** `true` si este intento dejó la cuenta bloqueada. */
  bloqueado: boolean;
}

/**
 * Registra un intento de inicio de sesión FALLIDO (contraseña incorrecta):
 * incrementa `intentosFallidos` y, al alcanzar {@link MAX_INTENTOS}, bloquea la
 * cuenta (`bloqueado = true`). Todo en una transacción (A2). Si el usuario no
 * existe es un no-op (no se crean usuarios fantasma ni se revela su ausencia).
 *
 * @returns el estado resultante, o `null` si el usuario no existe.
 */
export async function registrarIntentoFallido(
  username: string,
  bd?: ContextoBd,
): Promise<ResultadoIntentoFallido | null> {
  return enTransaccion(async (tx) => {
    const usuario = await tx.usuario.findUnique({
      where: { username },
      select: { id: true, intentosFallidos: true, bloqueado: true },
    });
    if (usuario === null) {
      return null;
    }

    const intentosFallidos = usuario.intentosFallidos + 1;
    const bloqueado = usuario.bloqueado || intentosFallidos >= MAX_INTENTOS;

    await tx.usuario.update({
      where: { id: usuario.id },
      data: { intentosFallidos, bloqueado },
    });

    // Solo se registra en bitácora la TRANSICIÓN a bloqueado (evento relevante);
    // los intentos sueltos no inundan el log (A7).
    if (bloqueado && !usuario.bloqueado) {
      await registrarBitacora(tx, null, {
        entidad: 'Usuario',
        idEntidad: usuario.id,
        accion: 'OTRO',
        datos: { evento: 'bloqueo-por-intentos', intentosFallidos },
      });
    }

    return { intentosFallidos, bloqueado };
  }, bd);
}

/**
 * Registra un inicio de sesión EXITOSO: reinicia `intentosFallidos = 0` y deja
 * constancia del acceso en la bitácora (sucesora de `UsuariosLog`, A7). Se llama
 * después de que el motor de autenticación validó la contraseña.
 */
export async function registrarAccesoExitoso(idUsuario: string, bd?: ContextoBd): Promise<void> {
  await enTransaccion(async (tx) => {
    await tx.usuario.update({
      where: { id: idUsuario },
      data: { intentosFallidos: 0 },
    });
    await registrarBitacora(tx, null, {
      entidad: 'Usuario',
      idEntidad: idUsuario,
      accion: 'OTRO',
      datos: { evento: 'inicio-sesion' },
    });
  }, bd);
}
