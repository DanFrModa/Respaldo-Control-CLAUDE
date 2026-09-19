/**
 * Contexto de los tests de INTEGRACIÓN (`*.int.test.ts`).
 *
 * Los tests corren contra el Postgres efímero de testcontainers que levanta
 * `entorno-global.ts` (PLANMAESTRO §9.2: "integración contra Postgres
 * efímero" — JAMÁS contra la base compartida de desarrollo) con las
 * migraciones reales de `backend/prisma` aplicadas. Aquí viven el cliente y el
 * seed PROPIO de pruebas: cada archivo limpia la base y siembra exactamente
 * lo que necesita.
 */
import { CATALOGO_PERMISOS } from '../contrato/index.js';
import { crearClientePrisma, type Empresa, type PrismaClient } from '../datos/index.js';
import { inject } from 'vitest';

/** Cliente Prisma contra el Postgres efímero (uno por archivo de pruebas). */
export function clientePruebas(): PrismaClient {
  return crearClientePrisma(inject('urlBaseDatosPruebas'));
}

/**
 * Deja la base VACÍA (borra todas las tablas de la app y reinicia TODAS sus secuencias). Se corre
 * en `beforeEach`: cada test parte de cero y ningún test depende de los datos de otro.
 *
 * ⚠️ **Las SECUENCIAS son parte de «partir de cero», no un detalle.** Si una secuencia no se
 * reinicia, sobrevive y sigue creciendo durante TODA la corrida: un valor que aislado sale `1` sale
 * `68` en la suite completa, y una prueba que lo dé por hecho pasa sola y falla en CI. Ya pasó. Por
 * eso se reinician **todas** las de `public`, sin distinguir si pertenecen a una columna
 * (`SERIAL`/`autoincrement()`) o son independientes (`CREATE SEQUENCE` + `nextval()`): el borrado
 * por `DELETE` no reinicia ninguna, así que el barrido las cubre a las dos por igual. Antes había
 * que separarlas porque `TRUNCATE … RESTART IDENTITY` sólo alcanzaba a las primeras — de paso, eso
 * deja resuelto para siempre el agujero que ese comentario documentaba.
 *
 * ## Por qué `DELETE` y no `TRUNCATE`
 *
 * **Medido el 18-sep-2026 EN LA MÁQUINA DE LA SESIÓN —que NO es el runner del CI—,** contra un
 * PostgreSQL 16 local levantado con `initdb`/`pg_ctl` (ajustes de fábrica, `fsync=on`) con las
 * migraciones reales aplicadas; base vacía, **30 iteraciones por variante y 4 rondas**, cronometrando
 * la función ENTERA (consultas de catálogo incluidas):
 *
 * | limpieza de las 178 tablas + 155 secuencias | p50 |
 * |---|---|
 * | `TRUNCATE … RESTART IDENTITY CASCADE` (lo que había) | **986-1129 ms** |
 * | `DELETE` de las 178 + `ALTER SEQUENCE … RESTART` de las 155 | **57-115 ms** |
 *
 * Sólo la sentencia de borrado, sin el catálogo: **644-653 ms** el `TRUNCATE` contra **34-35 ms** el
 * lote de `DELETE` ⇒ el `TRUNCATE` **era el 98 %** del coste, y las dos consultas de catálogo son
 * ruido (2-6 ms).
 *
 * Importa porque esto corre **antes de cada prueba de integración** (~3,877 por corrida), así que
 * era el grueso del paso `Tests` del CI (fila 0.208 de `HOJA-DE-RUTA.md`). ⚠️ **El ahorro en el
 * runner NO está medido aquí**: esta máquina no es el runner, y la primera corrida del CI con este
 * cambio es la primera medición real.
 *
 * ## Lo que se descartó (medido el 18-sep-2026 en esta misma máquina)
 *
 *  • **Mover la limpieza a `beforeAll`** (limpiar una vez por archivo): **rompe 16 de 20 pruebas** de
 *    `cliente-departamentos.int.test.ts` —38 menciones de `ErrorConflicto`, `EXIT=1`— porque cada
 *    prueba recrea su fixture y choca contra el índice único. No es quitar una línea: es reescribir
 *    las pruebas y perder el aislamiento que esta función existe para dar.
 *  • **Truncar sólo las tablas «sucias»** que delate `pg_stat_user_tables`. Se descarta por diseño,
 *    no por velocidad: haría que la limpieza dependa de unas ESTADÍSTICAS que cualquiera puede poner
 *    a cero desde otra sesión (`pg_stat_reset()`), y entonces **no limpiaría nada sin avisar** — un
 *    fallo mudo de la misma familia que este archivo intenta evitar, a cambio de unas decenas de ms
 *    sobre una limpieza que ya baja de 100. ⚠️ **Y se dice hasta dónde llega lo medido:** venía
 *    apuntado que esa vía rompía «las mismas 16/20» porque tras un `pg_stat_reset()` la consulta
 *    devuelve 0 tablas; **aquí NO se reprodujo** —sobre PostgreSQL 16, tras `pg_stat_reset()` y un
 *    `INSERT`, la consulta devuelve **1**—, así que ese mecanismo queda como **no verificado**, no
 *    como medición.
 *
 * ## Cuándo `DELETE` NO equivaldría a `TRUNCATE` (condiciones conocidas)
 *
 *  • **Si alguna tabla llegara a tener MUCHAS filas al limpiar.** `TRUNCATE` es O(1) por tabla y
 *    `DELETE` es O(filas). Aquí gana `DELETE` porque las pruebas dejan decenas de filas, no millones;
 *    el día que una prueba siembre cientos de miles, hay que volver a medir. Lo que sí se comprobó es
 *    que **no se degrada con el uso**: 400 limpiezas seguidas, p50 por bloques de 100 de
 *    **95.3 · 99.5 · 97.5 · 87.5 ms** — plano, o sea que las tuplas muertas no se acumulan.
 *  • **Si algún día hubiera TRIGGERS de usuario.** `session_replication_role = replica` los apaga
 *    (salvo los marcados `ENABLE ALWAYS`). Hoy la base tiene **0 triggers de usuario** y 1,472
 *    internos —los de las claves foráneas, que son justo los que queremos saltar— ⇒ hoy no apaga
 *    ninguna lógica de negocio. Si mañana se crea un trigger de usuario, esto hay que revisarlo.
 *  • **`session_replication_role` pide superusuario.** El Postgres de `testcontainers` da uno, así
 *    que en pruebas no es problema; contra una base ajena, sí lo sería.
 *  • **Las vistas materializadas no las tocaba `TRUNCATE` ni las toca esto** (`pg_tables` no las
 *    lista): hay 7 y siguen exactamente igual que antes.
 *
 * ## El cuidado peligroso: `session_replication_role` SIEMPRE vuelve a su sitio
 *
 * Si la sesión se quedara en `replica`, las pruebas siguientes **dejarían de comprobar las claves
 * foráneas** sin avisar: la suite entera se volvería adorno. Por eso el cambio de rol es
 * `SET **LOCAL**`, que PostgreSQL revierte al terminar la transacción —al `COMMIT` y también al
 * `ROLLBACK` si el borrado revienta a media lista—. No hay `try/finally` que pueda fallar, ni un
 * `SET` suelto que se quede pegado a una conexión del pool y reaparezca en otra prueba. Lo cubren
 * las pruebas de `contexto.int.test.ts`, que se vieron morir con sus mutaciones.
 */
export async function limpiarBaseDatos(cliente: PrismaClient): Promise<void> {
  const tablas = await cliente.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tablas.length === 0) {
    return;
  }
  // TODAS las secuencias de `public`: el `DELETE` no reinicia ninguna (ver arriba).
  const secuencias = await cliente.$queryRaw<{ nombre: string }[]>`
    SELECT c.relname AS nombre
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S' AND n.nspname = 'public'
  `;

  // Un solo lote, un solo viaje a la base. El orden de las tablas es el del catálogo —arbitrario
  // respecto de las claves foráneas, comprobado: devuelve al hijo antes que al padre—, así que lo
  // único que evita el 23503 es el `session_replication_role`.
  const lote = [
    `SET LOCAL session_replication_role = replica`,
    ...tablas.map((t) => `DELETE FROM "${t.tablename}"`),
    ...secuencias.map((s) => `ALTER SEQUENCE "${s.nombre}" RESTART`),
  ].join(';\n');

  // ⚠️ LA TRANSACCIÓN EXPLÍCITA ES UN CINTURÓN PARA EL FUTURO, y hoy no se nota: un lote
  // multi-sentencia ya viaja envuelto en la transacción IMPLÍCITA de PostgreSQL, así que el
  // `SET LOCAL` queda acotado igual sin este `$transaction` ⇒ **quitarlo es una mutación que
  // SOBREVIVE** (medido el 18-sep-2026: `EXIT=0`, 5/5 pruebas de `contexto.int.test.ts` en verde).
  // Se deja puesto por lo que HABILITA, no porque tape un fallo mudo — y la diferencia importa:
  //  • SIN él, partir el lote en varias llamadas **rompe, y a gritos**: los `DELETE` chocarían
  //    contra las claves foráneas y la suite se llenaría de `23503` (es lo que enseñó quitar el
  //    `SET`: 429 pruebas rojas en cinco archivos del dominio). Ruidoso, nunca silencioso.
  //  • CON él, partir el lote **sigue siendo correcto**. Eso es lo que compra: que un refactor
  //    futuro no tenga que volver a razonar sobre hasta dónde alcanza el ajuste.
  // 📌 Y el caso que SÍ sería mudo —quitarle el `LOCAL`— no lo tapa esto, lo caza la prueba «tras
  // una limpieza NORMAL la sesión queda en `origin`». Un `SET LOCAL` suelto fuera de transacción
  // tampoco se pega a ninguna conexión: PostgreSQL avisa (`WARNING: SET LOCAL can only be used in
  // transaction blocks`) y deja el ajuste en `origin`.
  // El `timeout` es holgado a propósito: el default de Prisma (5 s) convertiría un runner lento en
  // un fallo desconcertante, y el techo real es el `hookTimeout` de `vitest.config.ts` (180 s).
  await cliente.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(lote);
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

/** Siembra el catálogo de permisos de `src/contrato` en la tabla `permisos`. */
export async function sembrarPermisos(cliente: PrismaClient): Promise<void> {
  await cliente.permiso.createMany({
    data: CATALOGO_PERMISOS.map((permiso) => ({
      clave: permiso.clave,
      descripcion: permiso.descripcion,
      modulo: permiso.modulo,
    })),
    skipDuplicates: true,
  });
}

/** Crea una empresa de prueba activa. */
export async function crearEmpresaPrueba(
  cliente: PrismaClient,
  nombre = 'FR Moda de Prueba',
): Promise<Empresa> {
  return cliente.empresa.create({
    data: { nombre, paraIpt: true, paraEdr: true, favorita: false },
  });
}

/**
 * Crea un TIPO DE ARTE del catálogo único (`TipoProceso` con `esArte`, V1-E3f §Post-F9.58) y
 * devuelve su id. Como `limpiarBaseDatos` vacía todo antes de cada test, el arte necesita su tipo
 * sembrado a mano: esto lo deja en UNA línea en vez de repetir el `create` en cada archivo.
 *
 * Los defaults son los del seed real para «bordado» (el tipo de arte que usa puntadas). El
 * `codigo` es único global, así que un archivo que necesite dos tipos les pasa códigos distintos.
 */
export async function crearTipoArtePrueba(
  cliente: PrismaClient,
  codigo = 'bordado',
  opciones: { nombre?: string; usaPuntadas?: boolean } = {},
): Promise<number> {
  const tipo = await cliente.tipoProceso.create({
    data: {
      codigo,
      nombre: opciones.nombre ?? 'Bordado',
      esArte: true,
      usaPuntadas: opciones.usaPuntadas ?? codigo === 'bordado',
    },
    select: { id: true },
  });
  return tipo.id;
}
