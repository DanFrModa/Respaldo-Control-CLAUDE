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
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import {
  algunRolOtorga,
  bloquearGuardAdministradores,
  CLAVES_GOBIERNO,
  contarAdministradoresActivos,
  type ClaveGobierno,
} from '../admin/guard-administradores.js';

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
  /**
   * `true` si este intento DEBÍA bloquear pero no se bloqueó por ser esta persona
   * el último administrador vivo (ver {@link claveQueQuedariaHuerfana}). Los
   * intentos siguen contando y quedan a la vista; lo que no ocurre es el bloqueo.
   */
  bloqueoOmitidoPorUltimoAdministrador?: boolean;
}

/** Lo que hace falta saber del usuario para decidir el bloqueo. */
interface UsuarioParaBloqueo {
  id: string;
  activo: boolean;
  bloqueado: boolean;
  intentosFallidos: number;
  roles: { idRol: number }[];
}

/** Lee el estado del usuario relevante para el bloqueo por intentos. */
async function leerParaBloqueo(tx: Tx, username: string): Promise<UsuarioParaBloqueo | null> {
  return tx.usuario.findUnique({
    where: { username },
    select: {
      id: true,
      activo: true,
      bloqueado: true,
      intentosFallidos: true,
      roles: { select: { idRol: true } },
    },
  });
}

/**
 * ⚠️ **QUINTA PUERTA del guard anti-lockout** (`dominio/admin/guard-administradores.ts`).
 *
 * El bloqueo por intentos escribe la MISMA columna `bloqueado` que el guard
 * protege en `actualizarUsuario`, pero por un camino que no dispara ningún
 * administrador: **el propio dueño tecleando mal su contraseña cinco veces**. Un
 * usuario bloqueado se queda sin permisos (`cargarPermisosDeUsuario` devuelve el
 * set vacío), así que bloquear al ÚNICO administrador cierra el ERP por dentro:
 * nadie más tiene `usuarios.administrar` para desbloquearlo, y re-correr el seed
 * tampoco lo rescata (su `upsert` del admin no toca `bloqueado`). Solo se sale
 * entrando a la base de datos a mano.
 *
 * Devuelve la capacidad de gobierno que quedaría huérfana si se bloqueara a esta
 * persona, o `null` si bloquearla no deja al sistema sin administradores.
 *
 * **Sobre el riesgo de seguridad — es una decisión consciente:** al último
 * administrador vivo no se le bloquea la cuenta por intentos fallidos. NO queda
 * indefenso: la contraseña sigue haciendo falta y el rate-limit de login sigue
 * puesto (`AUTH_LOGIN_RATE_MAX`, `src/auth/config.ts`), que es la defensa real
 * contra la fuerza bruta — el bloqueo por intentos nunca lo fue, porque cualquiera
 * que sepa un username puede dispararlo contra su dueño. La alternativa es un ERP
 * capaz de auto-inutilizarse con cinco tecleos mal dados.
 *
 * Debe llamarse BAJO el lock del guard: el conteo tiene que ser consistente
 * frente a las otras cuatro puertas (un `actualizarUsuario` concurrente podría
 * estar contando a esta persona como la administradora que sí queda).
 */
async function claveQueQuedariaHuerfana(
  tx: Tx,
  usuario: UsuarioParaBloqueo,
): Promise<ClaveGobierno | null> {
  // Alguien ya apagado no cuenta como administrador vivo: bloquearlo no quita nada.
  if (!usuario.activo) {
    return null;
  }
  const idsRoles = usuario.roles.map((rol) => rol.idRol);
  for (const clave of CLAVES_GOBIERNO) {
    if (!(await algunRolOtorga(tx, idsRoles, clave))) {
      continue;
    }
    if ((await contarAdministradoresActivos(tx, clave, { idUsuario: usuario.id })) === 0) {
      return clave;
    }
  }
  return null;
}

/**
 * Registra un intento de inicio de sesión FALLIDO (contraseña incorrecta):
 * incrementa `intentosFallidos` y, al alcanzar {@link MAX_INTENTOS}, bloquea la
 * cuenta (`bloqueado = true`). Todo en una transacción (A2). Si el usuario no
 * existe es un no-op (no se crean usuarios fantasma ni se revela su ausencia).
 *
 * ⚠️ Con UNA excepción, la quinta puerta del guard anti-lockout: si bloquear esta
 * cuenta dejaría al sistema sin ningún administrador vivo, **los intentos suben
 * pero la cuenta NO se bloquea**, y queda constancia en bitácora de que no se
 * bloqueó y por qué. Ver {@link claveQueQuedariaHuerfana} para el razonamiento
 * completo, incluido el porqué esto no abre un agujero de seguridad.
 *
 * @returns el estado resultante, o `null` si el usuario no existe.
 */
export async function registrarIntentoFallido(
  username: string,
  bd?: ContextoBd,
): Promise<ResultadoIntentoFallido | null> {
  return enTransaccion(async (tx) => {
    // Lectura RÁPIDA sin lock: la enorme mayoría de los intentos fallidos no
    // transiciona a bloqueado y no tiene por qué serializarse con nada.
    let usuario = await leerParaBloqueo(tx, username);
    if (usuario === null) {
      return null;
    }

    if (!usuario.bloqueado && usuario.intentosFallidos + 1 >= MAX_INTENTOS) {
      // Este intento SÍ va a bloquear: a partir de aquí el estado tiene que ser el
      // de bajo el lock del guard anti-lockout, y hay que RE-LEER — entre la
      // lectura rápida y el lock alguien pudo cambiarle los roles o el estado, y
      // decidir con datos viejos es justo el write-skew que el lock cierra.
      await bloquearGuardAdministradores(tx);
      usuario = await leerParaBloqueo(tx, username);
      if (usuario === null) {
        return null;
      }
    }

    const intentosFallidos = usuario.intentosFallidos + 1;
    const transiciona = !usuario.bloqueado && intentosFallidos >= MAX_INTENTOS;
    // Quinta puerta del guard: no se bloquea al último administrador vivo.
    const claveHuerfana = transiciona ? await claveQueQuedariaHuerfana(tx, usuario) : null;
    const bloqueado = usuario.bloqueado || (transiciona && claveHuerfana === null);

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

    // El bloqueo OMITIDO también se registra: es un evento de seguridad que hay
    // que poder auditar después ("por qué esta cuenta nunca se bloqueó").
    if (claveHuerfana !== null) {
      await registrarBitacora(tx, null, {
        entidad: 'Usuario',
        idEntidad: usuario.id,
        accion: 'OTRO',
        datos: {
          evento: 'bloqueo-omitido-ultimo-administrador',
          motivo: `Bloquear esta cuenta dejaría al sistema sin nadie con «${claveHuerfana}».`,
          clave: claveHuerfana,
          intentosFallidos,
        },
      });
    }

    return {
      intentosFallidos,
      bloqueado,
      ...(claveHuerfana === null ? {} : { bloqueoOmitidoPorUltimoAdministrador: true }),
    };
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
