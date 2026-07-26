/**
 * Auditoría uniforme (MEJORAS A7).
 *
 * Dos capas, ambas obligatorias en los servicios que escriben:
 *
 * 1. **Campos de auditoría en la entidad** (`creadoPorId` / `modificadoPorId`;
 *    `creadoEn` / `modificadoEn` los pone la base) — quién tocó el registro
 *    por última vez. Se pueblan con `datosCreacion` / `datosModificacion`.
 * 2. **`Bitacora`** — historial de QUIÉN hizo QUÉ y CUÁNDO sobre lo crítico
 *    (doc funcional 10 §6.5: extender `UsuariosLog` a un log de cambios por
 *    entidad). Se escribe con `registrarBitacora` SIEMPRE dentro de la misma
 *    transacción que el cambio: o quedan los dos, o ninguno (A2/A7) — una
 *    bitácora que puede mentir no sirve para auditar.
 */
import type { AccionBitacora, Prisma } from '../datos/index.js';

import type { SesionUsuario } from './permisos.js';
import type { Tx } from './transaccion.js';

/** Campos de auditoría para un `create` (quién lo creó; también es el último que lo tocó). */
export function datosCreacion(sesion: SesionUsuario): {
  creadoPorId: string;
  modificadoPorId: string;
} {
  return { creadoPorId: sesion.id, modificadoPorId: sesion.id };
}

/** Campos de auditoría para un `update` (`modificadoEn` lo pone la base con @updatedAt). */
export function datosModificacion(sesion: SesionUsuario): { modificadoPorId: string } {
  return { modificadoPorId: sesion.id };
}

/** Qué registrar en la bitácora. */
export interface EntradaBitacora {
  /** Entidad afectada, en singular y como se llama el modelo (ej. `"Almacen"`). */
  entidad: string;
  /** Id del registro afectado (se guarda como texto para servir a toda entidad). */
  idEntidad: string | number | bigint;
  /** Qué se hizo: CREAR | MODIFICAR | DESACTIVAR | CANCELAR | OTRO. */
  accion: AccionBitacora;
  /**
   * Detalle serializable del cambio (campos modificados, valores nuevos…).
   * NUNCA incluir secretos (contraseñas, hashes, tokens).
   */
  datos?: Prisma.InputJsonValue;
}

/**
 * Inserta un renglón de bitácora EN LA TRANSACCIÓN del cambio (A7).
 *
 * Exigir `tx` por tipo hace imposible registrar bitácora "después, fuera de la
 * transacción": si el cambio se revierte, su bitácora se revierte con él.
 *
 * @param tx     transacción activa donde ocurrió el cambio.
 * @param sesion quién opera; `null` solo para procesos de sistema (jobs, ETL).
 *
 * @example
 * await registrarBitacora(tx, sesion, {
 *   entidad: "Almacen",
 *   idEntidad: almacen.id,
 *   accion: "CREAR",
 *   datos: { nombre: almacen.nombre, tipo: almacen.tipo },
 * });
 */
export async function registrarBitacora(
  tx: Tx,
  sesion: SesionUsuario | null,
  entrada: EntradaBitacora,
): Promise<void> {
  await tx.bitacora.create({
    data: {
      entidad: entrada.entidad,
      idEntidad: String(entrada.idEntidad),
      accion: entrada.accion,
      // `datos` solo se incluye si vino (exactOptionalPropertyTypes: Prisma no
      // acepta `undefined` explícito en un campo JSON opcional).
      ...(entrada.datos === undefined ? {} : { datos: entrada.datos }),
      idUsuario: sesion?.id ?? null,
    },
  });
}

/**
 * Inserta VARIOS renglones de bitácora de una sola vez, en la misma transacción (A7).
 *
 * Mismo contrato que {@link registrarBitacora}, pero con un `createMany`: lo usan las operaciones
 * que cambian N registros críticos de golpe (p. ej. completar las órdenes de un modelo al que se le
 * capturó su receta), donde un `create` por renglón sería un N+1 dentro de la transacción. No hacer
 * bitácora "porque son muchos" NO es opción: la entidad crítica la exige una por una.
 */
export async function registrarBitacoraLote(
  tx: Tx,
  sesion: SesionUsuario | null,
  entradas: EntradaBitacora[],
): Promise<void> {
  if (entradas.length === 0) return;
  await tx.bitacora.createMany({
    data: entradas.map((entrada) => ({
      entidad: entrada.entidad,
      idEntidad: String(entrada.idEntidad),
      accion: entrada.accion,
      ...(entrada.datos === undefined ? {} : { datos: entrada.datos }),
      idUsuario: sesion?.id ?? null,
    })),
  });
}
