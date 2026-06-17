/**
 * Folios de negocio por secuencia atómica (MEJORAS A3).
 *
 * El sistema viejo numeraba con `Max()+1` sobre la tabla (doc funcional
 * 02-Pedidos §6.1): dos capturas simultáneas podían sacar el MISMO folio y
 * pisarse. Aquí cada folio sale de la tabla `Secuencia` (una fila por
 * empresa+clave, PLANMAESTRO §4: "secuencias por empresa — nunca Max()+1")
 * con un `INSERT … ON CONFLICT … DO UPDATE … RETURNING` de Postgres: una sola
 * sentencia atómica a nivel de fila, por lo que N llamadas concurrentes
 * SIEMPRE devuelven N valores distintos y consecutivos (el segundo en llegar
 * espera el candado de la fila hasta que el primero commitea).
 *
 * Se usa SQL crudo y no `upsert` de Prisma porque el upsert solo es atómico
 * cuando Prisma puede delegarlo a la base (depende de heurísticas internas);
 * para folios la atomicidad no puede depender de una heurística.
 */
import { ErrorValidacion } from './errores.js';
import type { Tx } from './transaccion.js';

/**
 * Claves de secuencia válidas: minúsculas, dígitos y guiones (ej. `"orden"`,
 * `"nota-salida"`, `"orden-compra"`). Restringirlas evita que un typo de
 * mayúsculas/acentos parta una numeración en dos series.
 */
const PATRON_CLAVE_SECUENCIA = /^[a-z][a-z0-9-]{0,49}$/;

/**
 * Devuelve el siguiente folio de la secuencia `clave` de la empresa, de forma
 * ATÓMICA y dentro de la transacción del llamador (A3, doc 02 §6.1).
 *
 * La primera llamada de una empresa+clave crea la secuencia y devuelve `1n`;
 * las siguientes incrementan de uno en uno sin huecos NI duplicados bajo
 * concurrencia. El folio queda reservado solo si la transacción commitea
 * (un rollback puede dejar huecos — aceptable y preferible a duplicados).
 *
 * Exigir `tx` por tipo obliga a tomar el folio en la MISMA transacción que
 * inserta el documento que lo usa: así "folio asignado" y "documento creado"
 * son un solo hecho atómico.
 *
 * ⚠️ Para evitar interbloqueos, una transacción no debe pedir folios de DOS
 * claves distintas en órdenes distintos; lo normal es un folio por operación.
 *
 * @param tx        transacción activa (de `enTransaccion`).
 * @param idEmpresa empresa dueña de la numeración (multi-empresa, A9).
 * @param clave     serie a incrementar (`"orden"`, `"nota-salida"`, …).
 * @returns el folio asignado (BIGINT de Postgres → `bigint`).
 *
 * @example
 * const folio = await siguienteFolio(tx, sesion.idEmpresaActiva, "orden");
 */
export async function siguienteFolio(tx: Tx, idEmpresa: number, clave: string): Promise<bigint> {
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) {
    throw new ErrorValidacion(`idEmpresa inválido para la secuencia: ${String(idEmpresa)}.`);
  }
  if (!PATRON_CLAVE_SECUENCIA.test(clave)) {
    throw new ErrorValidacion(
      `Clave de secuencia inválida: "${clave}". Usa minúsculas, dígitos y guiones (ej. "nota-salida").`,
    );
  }

  // Nombres FÍSICOS de src/datos (modelo `Secuencia` @@map("secuencias")).
  const filas = await tx.$queryRaw<{ valor: bigint }[]>`
    INSERT INTO "secuencias" ("id_empresa", "clave", "valor")
    VALUES (${idEmpresa}, ${clave}, 1)
    ON CONFLICT ("id_empresa", "clave")
    DO UPDATE SET "valor" = "secuencias"."valor" + 1
    RETURNING "valor"
  `;
  const fila = filas[0];
  if (fila === undefined) {
    // RETURNING de un INSERT/UPDATE exitoso siempre trae una fila; si no, algo
    // muy raro pasó en la base y NO hay folio confiable que devolver.
    throw new Error(`La secuencia ${clave} (empresa ${String(idEmpresa)}) no devolvió valor.`);
  }
  return fila.valor;
}

/**
 * SIEMBRA el valor ACTUAL de una secuencia para que el SIGUIENTE folio sea `valorActual + 1`
 * (MIGRACIÓN — F2-E5). Tras migrar el histórico (que preserva los folios viejos con un valor
 * EXPLÍCITO, sin pasar por `siguienteFolio`), hay que dejar la secuencia "adelantada" al
 * máximo folio migrado de cada empresa, o la primera captura nueva chocaría contra el unique
 * `(idEmpresa, folio)`.
 *
 * Es IDEMPOTENTE y MONÓTONO: nunca RETROCEDE la secuencia. Pone `valor = max(valorActual,
 * valorExistente)` — así re-correr el ETL no la baja, y si captura ya avanzó la serie por
 * encima del histórico, no la pisa. `valorActual` es el MÁXIMO folio ya migrado (un folio nuevo
 * será `valorActual + 1`).
 *
 * Usa SQL crudo (mismo criterio que `siguienteFolio`: la atomicidad no depende de heurísticas
 * del upsert de Prisma). Exige `tx` por tipo (debe correr en la transacción/cliente del ETL).
 *
 * @param tx          transacción/cliente activo.
 * @param idEmpresa   empresa dueña de la numeración (A9).
 * @param clave       serie a sembrar (`"pedido"`, `"orden"`).
 * @param valorActual máximo folio YA usado (el siguiente será `valorActual + 1`). ≥0.
 */
export async function sembrarSecuencia(
  tx: Tx,
  idEmpresa: number,
  clave: string,
  valorActual: bigint | number,
): Promise<void> {
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) {
    throw new ErrorValidacion(`idEmpresa inválido para la secuencia: ${String(idEmpresa)}.`);
  }
  if (!PATRON_CLAVE_SECUENCIA.test(clave)) {
    throw new ErrorValidacion(
      `Clave de secuencia inválida: "${clave}". Usa minúsculas, dígitos y guiones (ej. "nota-salida").`,
    );
  }
  const valor = BigInt(valorActual);
  if (valor < 0n) {
    throw new ErrorValidacion(`Valor de secuencia inválido (negativo): ${String(valor)}.`);
  }

  // INSERT con el valor sembrado; si ya existe, lo SUBE al máximo (nunca lo baja: GREATEST).
  await tx.$executeRaw`
    INSERT INTO "secuencias" ("id_empresa", "clave", "valor")
    VALUES (${idEmpresa}, ${clave}, ${valor})
    ON CONFLICT ("id_empresa", "clave")
    DO UPDATE SET "valor" = GREATEST("secuencias"."valor", ${valor})
  `;
}
