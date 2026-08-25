/**
 * Guard anti-lockout del RBAC: **el sistema nunca puede quedarse sin ningún
 * usuario ACTIVO capaz de administrarlo.**
 *
 * Es una invariante GLOBAL, no una regla sobre una persona: da lo mismo si el
 * cambio te lo haces a ti mismo o a otro — lo que se protege es que quede al
 * menos un administrador vivo. Sin ella el sistema se cierra por dentro y ya no
 * hay pantalla que lo abra (habría que entrar a la base de datos a mano).
 *
 * ## Las dos capacidades de gobierno
 *
 * `usuarios.administrar` (dar de alta gente, roles, activar/desactivar) y
 * `roles.administrar` (qué permisos otorga cada rol). Cada una se protege por
 * separado: perder cualquiera de las dos deja el sistema a medio administrar y
 * no hay forma de recuperarla desde dentro.
 *
 * ## Las cuatro puertas que llevan al mismo precipicio
 *
 * | Puerta | Dónde | Cómo pierde la capacidad |
 * |---|---|---|
 * | Quitarle el ROL a un usuario | `actualizarUsuario` (y su atajo `asignarRoles`) | se queda sin el rol que se la daba |
 * | DESACTIVAR a un usuario | `actualizarUsuario` / `desactivarUsuario` | un usuario inactivo no tiene permisos |
 * | BLOQUEAR a un usuario | `actualizarUsuario` | un usuario bloqueado tampoco (ver `cargarPermisosDeUsuario`) |
 * | Quitarle el PERMISO al rol, o borrar el rol | `asignarPermisos` / `eliminarRol` | el rol deja de otorgarla |
 *
 * Las cuatro cuentan **usuarios**, nunca roles: un rol administrador "huérfano"
 * (con la clave pero sin nadie que lo tenga) no rescata a nadie.
 *
 * ## Por qué UN SOLO lock, de clave CONSTANTE, compartido por todas
 *
 * El conteo tiene que ser consistente frente a operaciones concurrentes, y bajo
 * `READ COMMITTED` no lo es: cada transacción no ve los cambios no comiteados de
 * la otra. Write-skew de manual — dos ediciones simultáneas, cada una viendo al
 * administrador que la otra está quitando, ambas concluyen "aún queda uno" y
 * ambas commitean → cero administradores.
 *
 * Y el skew CRUZA los módulos: quitarle el rol a Daniel (`UsuarioRol`, desde
 * usuarios) y quitarle el permiso al rol de Aurora (`RolPermiso`, desde roles)
 * alimentan el MISMO conteo. Por eso el lock es uno solo y su clave es
 * CONSTANTE: no lleva el id del usuario ni el del rol, porque dos operaciones
 * sobre sujetos DISTINTOS también tienen que serializarse entre sí.
 *
 * Forma de UN argumento `pg_advisory_xact_lock(bigint)`: ocupa un espacio de
 * locks distinto al de dos enteros que usa el kardex, así que no puede colisionar
 * con ningún otro lock del sistema. Es transaccional: se libera solo al terminar
 * la transacción, no hay que soltarlo a mano.
 */
import { ErrorConflicto } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';

/**
 * Las claves de permiso que gobiernan el propio sistema de seguridad. Perder
 * cualquiera de las dos es irreversible desde la aplicación.
 */
export const CLAVES_GOBIERNO = ['usuarios.administrar', 'roles.administrar'] as const;

/** Una de las dos capacidades de gobierno. */
export type ClaveGobierno = (typeof CLAVES_GOBIERNO)[number];

/** Cómo se nombra cada capacidad en el mensaje que lee la persona (no la clave técnica). */
const CAPACIDAD: Record<ClaveGobierno, string> = {
  'usuarios.administrar': 'administrar usuarios y accesos',
  'roles.administrar': 'administrar roles y permisos',
};

/**
 * Clave CONSTANTE del advisory lock que serializa entre sí TODAS las operaciones
 * que pueden retirar una capacidad de gobierno (las cuatro puertas de arriba).
 * El valor es un discriminador arbitrario y único de este guard ("ROLES_A" en
 * hex, heredado de cuando el guard vivía solo en `roles.ts`).
 */
const CLAVE_LOCK_GUARD_ADMIN = 0x524f4c45535f41n;

/**
 * Toma el advisory lock del guard. Se llama al ENTRAR a la operación, ANTES de
 * leer/contar/mutar nada: si se tomara después del conteo no serviría de nada.
 * Es reentrante (tomarlo dos veces en la misma transacción es inofensivo).
 */
export async function bloquearGuardAdministradores(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAVE_LOCK_GUARD_ADMIN}::bigint)`;
}

/** A quién NO contar: el sujeto que está perdiendo la capacidad en esta operación. */
export interface ExclusionGuard {
  /** Usuario que pierde la capacidad (se le quita el rol, se desactiva o se bloquea). */
  idUsuario?: string;
  /** Rol que deja de otorgarla (se le quita el permiso o se borra el rol). */
  idRol?: number;
}

/**
 * Cuántos usuarios quedarían con la capacidad `clave` DESPUÉS del cambio.
 *
 * Cuenta el estado POSTERIOR excluyendo al sujeto que la pierde, no el estado
 * previo — contar antes del cambio siempre daría "sí queda uno" (él mismo). Debe
 * llamarse BAJO el lock ({@link bloquearGuardAdministradores}).
 *
 * Un usuario cuenta solo si está ACTIVO y NO BLOQUEADO, exactamente el mismo
 * criterio con el que `cargarPermisosDeUsuario` arma los permisos de la sesión:
 * un administrador apagado o trabado no puede administrar nada, así que no
 * rescata a nadie.
 */
export async function contarAdministradoresActivos(
  tx: Tx,
  clave: ClaveGobierno,
  excluir: ExclusionGuard = {},
): Promise<number> {
  return tx.usuario.count({
    where: {
      activo: true,
      bloqueado: false,
      ...(excluir.idUsuario === undefined ? {} : { id: { not: excluir.idUsuario } }),
      roles: {
        some: {
          ...(excluir.idRol === undefined ? {} : { idRol: { not: excluir.idRol } }),
          rol: { permisos: { some: { permiso: { clave } } } },
        },
      },
    },
  });
}

/**
 * Exige que, tras el cambio, siga habiendo al menos un usuario activo con la
 * capacidad `clave`; si no, `ErrorConflicto` (409) y la transacción hace rollback.
 *
 * El mensaje dice la SALIDA, no solo el "no": nombra al sujeto que es el último
 * camino y explica que primero hay que darle esa capacidad a alguien más. Un
 * "no puedes" sin salida obliga a adivinar.
 *
 * @param sujeto Cómo nombrar al que pierde la capacidad, ya redactado y
 *   entrecomillado (p. ej. `el usuario "daniel"` o `el rol "Administrador"`).
 */
export async function exigirQuedaAdministrador(
  tx: Tx,
  clave: ClaveGobierno,
  excluir: ExclusionGuard,
  sujeto: string,
): Promise<void> {
  const restantes = await contarAdministradoresActivos(tx, clave, excluir);
  if (restantes > 0) {
    return;
  }
  throw new ErrorConflicto(
    `No puedes dejar al sistema sin nadie que pueda ${CAPACIDAD[clave]}: ${sujeto} es el último ` +
      `camino a ese permiso. Primero nombra a otro administrador —dale a alguien más, activo y no ` +
      `bloqueado, un rol con el permiso «${clave}»— y luego repite este cambio.`,
  );
}
