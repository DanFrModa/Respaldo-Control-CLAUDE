/**
 * Decisiones PURAS de la migración (F1-E6), extraídas de los loaders para poder probarlas sin
 * BD. No tocan Prisma ni CSV: solo transforman datos ya parseados.
 */

/**
 * Decide a dónde va el precio histórico de un avío según haya o no match de proveedor
 * (ADR-0009, decisión 3 — el precio NO se pierde):
 *  • CON match → renglón `AvioProveedor` con ese `precio` (y SIN `precioReferencia`).
 *  • SIN match → el `precio` va a `Avio.precioReferencia` (fallback).
 *  • precio `null` → no se fija nada (ni renglón con precio, ni referencia).
 */
export function decidirPrecioAvio(
  idProveedor: number | undefined,
  precio: number | null,
): {
  proveedor: { idProveedor: number; precio?: number } | null;
  precioReferencia: number | undefined;
} {
  const p = precio === null ? undefined : Math.max(0, precio);
  if (idProveedor !== undefined) {
    return {
      proveedor: { idProveedor, ...(p === undefined ? {} : { precio: p }) },
      precioReferencia: undefined,
    };
  }
  // Sin match: el precio (si lo hay) se conserva como referencia.
  return { proveedor: null, precioReferencia: p };
}

/**
 * Resultado del cruce de unificación Telas ↔ TelasDis por nombre normalizado (ADR-0009 no
 * fija la llave; se usa el nombre). Devuelve, para una lista de nombres normalizados de cada
 * fuente, qué hace match y qué queda sin mapear EN AMBOS SENTIDOS (§7: reportar, no arreglar).
 */
export interface CruceTelas {
  /** Nombres (normalizados) presentes en AMBAS fuentes (se unifican en una Tela). */
  enComun: string[];
  /** Nombres en `Telas` SIN equivalente en `TelasDis` (la mayoría; normal). */
  soloTelas: string[];
  /** Nombres en `TelasDis` SIN equivalente en `Telas` (se crean como Tela propia). */
  soloTelasDis: string[];
}

/** Cruza dos conjuntos de nombres normalizados (Telas vs TelasDis) para el reporte. */
export function cruzarTelas(
  nombresTelas: Iterable<string>,
  nombresTelasDis: Iterable<string>,
): CruceTelas {
  const setTelas = new Set(nombresTelas);
  const setDis = new Set(nombresTelasDis);
  const enComun: string[] = [];
  const soloTelas: string[] = [];
  const soloTelasDis: string[] = [];
  for (const n of setTelas) {
    (setDis.has(n) ? enComun : soloTelas).push(n);
  }
  for (const n of setDis) {
    if (!setTelas.has(n)) {
      soloTelasDis.push(n);
    }
  }
  return { enComun, soloTelas, soloTelasDis };
}
