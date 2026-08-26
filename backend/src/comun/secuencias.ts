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
 * Reserva un BLOQUE de `n` folios CONSECUTIVOS de la secuencia `clave` de la empresa, de forma
 * ATÓMICA (A3), en una sola sentencia. Devuelve el ÚLTIMO folio del bloque; los folios reservados
 * son `[ultimo − n + 1 … ultimo]`. Es la versión "en masa" de {@link siguienteFolio}: el mismo
 * `INSERT … ON CONFLICT … DO UPDATE SET valor = valor + n RETURNING valor`, pero avanzando la
 * secuencia de golpe. Como es una sola sentencia atómica a nivel de fila, N llamadas concurrentes
 * SIEMPRE reciben bloques DISJUNTOS (el segundo espera el candado de la fila hasta el commit del
 * primero). Pensada para el ETL de aperturas (F9-E6), que inserta muchos movimientos por
 * `createMany` con su folio pre-asignado en un solo `INSERT` — sin N round-trips a la secuencia.
 *
 * Debe correr en la MISMA transacción que el `createMany` de los documentos que usan esos folios:
 * así "bloque reservado" y "documentos creados" son un solo hecho atómico (si la tx aborta, la
 * secuencia se revierte también → sin folios quemados; en un reintento se re-reserva el mismo bloque).
 *
 * @param tx        transacción activa (de `enTransaccion`).
 * @param idEmpresa empresa dueña de la numeración (A9).
 * @param clave     serie a incrementar (`"movimiento-tercero"`, …).
 * @param n         cantidad de folios a reservar (entero ≥ 1).
 * @returns el ÚLTIMO folio del bloque (los folios son `ultimo − n + 1 … ultimo`).
 */
export async function reservarBloqueFolios(
  tx: Tx,
  idEmpresa: number,
  clave: string,
  n: number,
): Promise<bigint> {
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) {
    throw new ErrorValidacion(`idEmpresa inválido para la secuencia: ${String(idEmpresa)}.`);
  }
  if (!PATRON_CLAVE_SECUENCIA.test(clave)) {
    throw new ErrorValidacion(
      `Clave de secuencia inválida: "${clave}". Usa minúsculas, dígitos y guiones (ej. "nota-salida").`,
    );
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new ErrorValidacion(`Cantidad de folios inválida para el bloque: ${String(n)}.`);
  }

  const cantidad = BigInt(n);
  const filas = await tx.$queryRaw<{ valor: bigint }[]>`
    INSERT INTO "secuencias" ("id_empresa", "clave", "valor")
    VALUES (${idEmpresa}, ${clave}, ${cantidad})
    ON CONFLICT ("id_empresa", "clave")
    DO UPDATE SET "valor" = "secuencias"."valor" + ${cantidad}
    RETURNING "valor"
  `;
  const fila = filas[0];
  if (fila === undefined) {
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

/**
 * Igual que {@link siguienteFolio} pero para una serie **GLOBAL**, sin empresa (tabla
 * `secuencias_globales`). Existe porque los CATÁLOGOS GLOBALES (ADR-0007) numeran fuera de
 * cualquier empresa: el código de DESARROLLO de un modelo (`CYA-26-71-001`) cae en
 * `Modelo.codigoDesarrollo`, que es único GLOBAL — si el contador colgara de la empresa, dos
 * empresas desarrollando para el mismo cliente sacarían el MISMO código y una chocaría contra el
 * unique. Misma sentencia atómica (`INSERT … ON CONFLICT … DO UPDATE … RETURNING`), mismas
 * garantías: N llamadas concurrentes devuelven N valores distintos, y un rollback deja hueco pero
 * jamás un duplicado.
 *
 * ⭐ **El PISO (V1-E7h).** Una serie global puede nacer cuando su universo YA tiene números usados
 * —el consecutivo de desarrollo de un cliente+año que viene del criterio anterior— y una secuencia
 * que arranca en 1 volvería a repartir números viejos. `piso` es el **último número ya usado** que
 * el llamador conoce: el folio devuelto es `max(valorDeLaSecuencia, piso) + 1`. Dos propiedades lo
 * hacen seguro y son las que NO se pueden romper:
 *
 *  1. **MONÓTONO** — `GREATEST` sólo puede ADELANTAR la secuencia, jamás retrocederla. Un `piso`
 *     viejo o pequeño (o `0`) es inofensivo: manda el valor de la fila. Por eso el llamador puede
 *     recalcularlo en cada alta sin miedo a re-repartir números ya entregados.
 *  2. **ATÓMICO (A3)** — el piso entra COMO PARÁMETRO de la MISMA sentencia que incrementa; no hay
 *     "leer y luego escribir". Dos altas simultáneas con el mismo `piso` siguen esperándose en el
 *     candado de la fila y sacan números DISTINTOS (la segunda ve el valor ya subido por la
 *     primera y le suma 1). Lo que NO se puede hacer nunca es calcular el máximo, decidir en JS y
 *     escribirlo con un `UPDATE … SET valor = …`: eso es `Max()+1` disfrazado y sí se duplica.
 *
 * Los `::bigint` son deliberados: `GREATEST` es polimórfica y sin el cast Postgres no puede inferir
 * el tipo del parámetro en la sentencia preparada.
 *
 * @param tx    transacción activa (de `enTransaccion`) — el folio se reserva con el documento.
 * @param clave serie a incrementar (p. ej. `"modelo-desarrollo-12-2026"`, la del consecutivo de
 *              DESARROLLO de un cliente en un año — V1-E7a: sin el par concepto+género).
 * @param piso  último número YA usado que el llamador conoce (default `0` = la serie manda sola).
 * @returns el folio asignado.
 */
export async function siguienteFolioGlobal(
  tx: Tx,
  clave: string,
  piso: bigint | number = 0,
): Promise<bigint> {
  if (!PATRON_CLAVE_SECUENCIA.test(clave)) {
    throw new ErrorValidacion(
      `Clave de secuencia global inválida: "${clave}". Usa minúsculas, dígitos y guiones.`,
    );
  }
  const desde = BigInt(piso);
  if (desde < 0n) {
    throw new ErrorValidacion(`Piso de secuencia inválido (negativo): ${String(desde)}.`);
  }
  const filas = await tx.$queryRaw<{ valor: bigint }[]>`
    INSERT INTO "secuencias_globales" ("clave", "valor")
    VALUES (${clave}, ${desde}::bigint + 1)
    ON CONFLICT ("clave")
    DO UPDATE SET "valor" = GREATEST("secuencias_globales"."valor", ${desde}::bigint) + 1
    RETURNING "valor"
  `;
  const fila = filas[0];
  if (fila === undefined) {
    throw new Error(`La secuencia global ${clave} no devolvió valor.`);
  }
  return fila.valor;
}
