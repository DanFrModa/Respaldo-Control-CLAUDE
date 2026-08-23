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
 * Convierte una fila de Prisma al JSON del campo `datos` de la bitácora SIN perder información: un
 * `antes` mutilado no serviría para reconstruir lo borrado (D3).
 *
 *  • `Prisma.Decimal` → NÚMERO (importes legibles y comparables, no cadenas).
 *  • `Date` → ISO 8601.
 *  • `BigInt` → cadena (los folios no caben en un `number` sin riesgo).
 *  • `undefined` dentro de un objeto → se OMITE (igual que `JSON.stringify`), para que el llamador
 *    pueda podar campos que no quiere en la bitácora.
 *
 * ⚠️ POR QUÉ SE RECORRE A MANO Y NO CON EL `replacer` DE `JSON.stringify`: el replacer recibe el
 * valor DESPUÉS de que `JSON.stringify` llamó a su `toJSON()`. `Prisma.Decimal` y `Date` TIENEN
 * `toJSON`, así que al replacer le llegaba ya una cadena y las ramas de Decimal/Date eran CÓDIGO
 * MUERTO: los importes terminaban en la bitácora como `"40"` en vez de `40`. Recorriendo el objeto
 * antes de serializar, la conversión sí ocurre.
 */
export function aJsonBitacora(fila: unknown): Prisma.InputJsonValue {
  return normalizarJson(fila) as Prisma.InputJsonValue;
}

/** Recorre el valor convirtiendo Decimal/Date/BigInt ANTES de que intervenga `JSON.stringify`. */
function normalizarJson(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'bigint') return valor.toString();
  // ⚠️ EL FILTRO DE `object` VA ANTES QUE CUALQUIER INSPECCIÓN DE PROPIEDADES. `esDecimal` usa el
  // operador `in`, que sobre un PRIMITIVO no devuelve `false`: LANZA `TypeError`. Con el orden
  // invertido, `aJsonBitacora` reventaba con cualquier fila de Prisma (todas traen `id: number`),
  // y con ella la operación entera. Los primitivos (number/string/boolean) se devuelven tal cual.
  if (typeof valor !== 'object') return valor;
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map((elemento) => normalizarJson(elemento));
  if (esDecimal(valor)) return Number(valor.toString());

  const salida: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(valor)) {
    if (v === undefined) continue;
    salida[clave] = normalizarJson(v);
  }
  return salida;
}

/**
 * ¿El valor es un `Prisma.Decimal`? Se detecta por FORMA (`toFixed`); los internos `d`/`s`/`e` no
 * son estables entre versiones, y es lo único disponible sin importar el runtime de Prisma aquí.
 * SOLO se puede llamar con un `object` ya comprobado (ver el aviso de `normalizarJson`).
 */
function esDecimal(valor: object): valor is { toFixed: () => string; toString: () => string } {
  return 'toFixed' in valor && typeof valor.toFixed === 'function';
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
