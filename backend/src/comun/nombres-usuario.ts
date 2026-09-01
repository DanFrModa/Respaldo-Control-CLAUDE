/**
 * Resolución EN BLOQUE del nombre de un usuario a partir de su id (V1 · «los nombres, en vez de los
 * ids»).
 *
 * ## Por qué existe
 *
 * Varias tablas guardan QUIÉN hizo algo como un `String` suelto —`OrdenComentario.idUsuario`,
 * `HitoOrden.registradoPorId`, `Archivo.subidoPorId`, `Desarrollo.apagadoPorId`,
 * `NegociacionEvento.registradoPorId`, `Bitacora.idUsuario`— **sin FK física al usuario**, porque son
 * registros INMUTABLES: la historia no puede quedar atada al ciclo de vida de una cuenta (D3). Como
 * no hay FK, el nombre **no viaja por `include`**: hay que ir por él a propósito.
 *
 * Este módulo es el ÚNICO sitio del que se leen NOMBRES PARA MOSTRAR. El bloque estaba copiado a
 * mano **seis** veces —`admin/bitacora.ts`, `desarrollo/negociacion.ts`, `produccion/precios-orden.ts`
 * (¡con este mismo nombre de función!), `produccion/etapas.ts` (`nombresDeCaptura`),
 * `ruta-critica/rutaOrden.ts` (`nombresCapturadores`, más una copia inline del lector) y
 * `calidad/impresos/impreso-auditoria.ts` (las dos mitades inline)—; todas se plegaron aquí. Es el
 * patrón «embudo» del proyecto: una función canónica que resuelve por dentro, para que quien escriba
 * código nuevo quede cubierto por omisión.
 *
 * ⚠️ **Las tres consultas de usuarios que NO son esto y no deben plegarse aquí** (son otra pregunta,
 * no «cómo se llama este id»):
 *  • `admin/usuarios.ts` — el CRUD del catálogo: pagina, ordena y proyecta el usuario entero.
 *  • `ruta-critica/analisisRc.ts` y `ruta-critica/bandeja.ts` — la POBLACIÓN del equipo de la RC:
 *    filtran `activo: true` + rol responsable de un proceso activo, y traen roles/username. Ahí el
 *    filtro `activo` es correcto porque se pregunta «¿a quién le puedo asignar trabajo HOY?», no
 *    «¿quién escribió esto?».
 *
 * ## Las dos reglas que no se negocian
 *
 * 1. **Nunca N+1.** Se resuelve el lote entero de UNA consulta (`id IN (...)`), en el servidor. El
 *    cliente no puede hacerlo: no tiene de dónde sacar el nombre. Un listado paginado resuelve la
 *    página COMPLETA de una sola vez, no una consulta por renglón.
 * 2. **El id que no resuelve devuelve `null`, y el renglón se sigue viendo.** Nunca se filtra, se
 *    esconde ni se deja el renglón en blanco: dar de baja a alguien NO borra la historia (D3). La UI
 *    cae al id crudo o a un guion, pero el comentario/hito/adjunto sigue ahí.
 *
 * ⚠️ **NO se filtra por `activo`.** `Usuario` es de borrado SUAVE: quien se va se desactiva, jamás se
 * borra. Un usuario dado de baja SIGUE resolviendo, y su nombre se sigue pintando en la historia que
 * escribió — que es justo lo que D3 quiere. El `null` es para el id que de verdad no existe (un id
 * traído por un ETL, o una cuenta purgada), no para el que está inactivo.
 */

import type { Tx } from './transaccion.js';

/** Lo mínimo que necesita este módulo de un cliente Prisma (sirve `PrismaClient` y una `Tx`). */
export type ClienteUsuarios = Pick<Tx, 'usuario'>;

/**
 * Resuelve, de UNA consulta, el nombre de un lote de usuarios. Ignora los `null`/`undefined` y los
 * repetidos; si no queda ningún id que buscar, NO consulta la base.
 *
 * Devuelve un mapa `id → nombre` con SOLO los que existen: el que no está simplemente no aparece
 * (léelo con {@link nombreDeUsuario}, que ya devuelve `null` en ese caso).
 */
export async function nombresDeUsuarios(
  cliente: ClienteUsuarios,
  ids: Iterable<string | null | undefined>,
): Promise<ReadonlyMap<string, string>> {
  const unicos = [...new Set(ids)].filter((id): id is string => id !== null && id !== undefined);
  if (unicos.length === 0) return new Map();
  const usuarios = await cliente.usuario.findMany({
    where: { id: { in: unicos } },
    select: { id: true, nombre: true },
  });
  return new Map(usuarios.map((u) => [u.id, u.nombre]));
}

/**
 * Lee el nombre de un id contra el mapa de {@link nombresDeUsuarios}. Devuelve `null` cuando el id
 * es `null` **o cuando no resolvió** — las dos cosas son «no hay nombre que pintar», y la UI las
 * trata igual (cae al id crudo, o a un guion).
 *
 * Está aparte a propósito: el `?? null` es exactamente el paso que se olvida al copiar el bloque a
 * mano, y era el que convertía un usuario inexistente en un `undefined` que rompe el contrato.
 */
export function nombreDeUsuario(
  nombrePorId: ReadonlyMap<string, string>,
  id: string | null | undefined,
): string | null {
  if (id === null || id === undefined) return null;
  return nombrePorId.get(id) ?? null;
}
