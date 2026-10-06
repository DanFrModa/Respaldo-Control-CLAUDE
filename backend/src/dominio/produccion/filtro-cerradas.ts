/**
 * ⭐ 0.227 (§Post-F9.244, etapa 2) — EL FILTRO DE ÓRDENES CERRADAS DE LOS LISTADOS, en UN solo lugar.
 *
 * Daniel: *«todas las pantallas donde sean de meter información, ya no deberían aparecer esas
 * órdenes»* + *«no quisiera que las órdenes sean invisibles: deberán poderse consultar todo lo que ha
 * pasado»*. Por eso el corte es por ACCIÓN y el default es **`incluir`**: el listado se comporta como
 * siempre para quien no pide otra cosa (toda pantalla de CONSULTA), y sólo el selector de una CAPTURA
 * pide `ocultar` —con su interruptor «Mostrar cerradas» en la pantalla—.
 *
 * `solo` existe para el AVISO: si la búsqueda de abiertas sale vacía pero lo buscado SÍ existe
 * cerrado, la pantalla lo dice en vez de un «no hay coincidencias» mudo (el precedente del 26-jul-2026
 * en `SelectorOrden.tsx`, cuando filtrar por estado dejó órdenes inoperables sin explicación).
 *
 * 🔑 El criterio es **`cerradaEn`** —la verdad autoritativa del cierre (`cierre-orden.ts`)—, nunca el
 * `estado`, que es sólo su espejo visible. Así el filtro no se contradice con la guarda del servidor
 * (`exigirOrdenesAbiertas`), que también lee `cerradaEn`.
 *
 * ⚠️ Es un filtro de LISTADO, no una llave: la guarda que impide capturar sobre una cerrada sigue
 * siendo la del dominio (etapa 1). Esto sólo decide qué se OFRECE.
 */
import type { FiltroCerradas } from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';

/** El `where` de Prisma que aplica el filtro de cerradas (vacío = sin filtro). */
export function filtroOrdenesCerradas(cerradas: FiltroCerradas): Prisma.OrdenWhereInput {
  switch (cerradas) {
    case 'ocultar':
      return { cerradaEn: null };
    case 'solo':
      return { cerradaEn: { not: null } };
    case 'incluir':
      return {};
  }
}
