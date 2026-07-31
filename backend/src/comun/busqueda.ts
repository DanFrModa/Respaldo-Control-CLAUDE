/**
 * Búsqueda por NOMBRE sin acentos ni mayúsculas (rediseño R2, §4.4.1: teclear "oscar" debe
 * encontrar a "Óscar Jiménez"). El `contains mode: 'insensitive'` de Prisma (ILIKE) ignora
 * mayúsculas pero NO acentos, así que los typeaheads de proveedores/clientes se quedaban vacíos
 * justo en el caso que pidió Daniel. Aquí se resuelve con la extensión contrib `unaccent`
 * (migración `20260707140000_r2_unaccent`): un pre-filtro de IDS por SQL crudo PARAMETRIZADO que
 * se compone con el resto del `where` de Prisma (activos, roles, paginación intactos).
 *
 * Alcance deliberado (decisión del lead, R2): SOLO proveedores y clientes — los catálogos que
 * alimentan los typeaheads y filtros nuevos. Son chicos (≤2k filas): el seq scan basta, sin
 * índice funcional. Generalizarlo a otras búsquedas es mejora futura.
 */
import { Prisma, type PrismaClient } from '../datos/index.js';

import type { Tx } from './transaccion.js';

/** Tablas habilitadas (whitelist: el identificador NO se parametriza — jamás texto del usuario). */
const TABLAS_NOMBRE = {
  proveedor: 'proveedores',
  cliente: 'clientes',
} as const;

/** Tabla con búsqueda por nombre sin acentos. */
export type TablaNombreSinAcentos = keyof typeof TABLAS_NOMBRE;

/** Escapa los comodines de LIKE (`%`, `_`, `\`) del texto del usuario (el escape default es `\`). */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`);
}

/**
 * IDs de la tabla cuyo `nombre` CONTIENE `busqueda`, ignorando acentos Y mayúsculas
 * (`unaccent(lower(...))` en ambos lados). El texto viaja PARAMETRIZADO (sin inyección) y con
 * sus comodines escapados. Devuelve la lista para componer `id: { in: ids }` con el resto del
 * filtro Prisma — lista vacía = ninguna coincidencia (la página sale vacía sola).
 */
export async function idsPorNombreSinAcentos(
  cliente: Tx | PrismaClient,
  tabla: TablaNombreSinAcentos,
  busqueda: string,
): Promise<number[]> {
  const patron = `%${escaparLike(busqueda)}%`;
  const filas = await cliente.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM ${Prisma.raw(`"${TABLAS_NOMBRE[tabla]}"`)} WHERE unaccent(lower(nombre)) LIKE unaccent(lower(${patron}))`,
  );
  return filas.map((fila) => fila.id);
}
