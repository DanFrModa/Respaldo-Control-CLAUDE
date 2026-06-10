/**
 * Paginación estándar de listados.
 *
 * TODOS los listados de dominio paginan en servidor con esta misma forma
 * (PLANMAESTRO §8.5: convenciones únicas definidas en F0): mismo esquema de
 * entrada, misma forma de respuesta. Las rutas REST reutilizan estos esquemas
 * en su entrada (E3) y las tablas de la UI (TanStack Table) consumen
 * `Pagina<T>` directo.
 */
import * as z from 'zod';

/** Parámetros de paginación que acepta todo listado (con defaults y topes). */
export const esquemaPaginacion = z.object({
  /** Página 1-based. */
  pagina: z.number().int().min(1).default(1),
  /** Renglones por página (tope 100: nadie lee más y protege la base). */
  porPagina: z.number().int().min(1).max(100).default(20),
});

export type Paginacion = z.output<typeof esquemaPaginacion>;

/** Respuesta estándar de un listado paginado. */
export interface Pagina<T> {
  /** Renglones de la página solicitada. */
  datos: T[];
  /** Total de renglones que cumplen el filtro (para pintar el paginador). */
  total: number;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
}

/** Convierte la paginación en `skip`/`take` de Prisma. */
export function rangoPrisma(paginacion: Paginacion): { skip: number; take: number } {
  return {
    skip: (paginacion.pagina - 1) * paginacion.porPagina,
    take: paginacion.porPagina,
  };
}

/** Arma la respuesta estándar a partir de los renglones y el total. */
export function armarPagina<T>(datos: T[], total: number, paginacion: Paginacion): Pagina<T> {
  return {
    datos,
    total,
    pagina: paginacion.pagina,
    porPagina: paginacion.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / paginacion.porPagina)),
  };
}
