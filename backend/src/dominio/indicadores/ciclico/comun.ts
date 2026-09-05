/**
 * Piezas COMPARTIDAS por el motor del cíclico y sus tres adaptadores (fila 0.099). Viven aquí y no
 * en `inventario-ciclico.ts` para que los adaptadores no tengan que importar al motor (importación
 * circular) sólo para resolver un tipo de movimiento o una fecha.
 */
import { ErrorValidacion } from '../../../comun/errores.js';
import type { Tx } from '../../../comun/transaccion.js';

/** Tipo de movimiento del ajuste con existencia FALTANTE (real > teórico → entra). */
export const COD_AJUSTE_ENTRADA = 'ajuste-ciclico-entrada';
/** Tipo de movimiento del ajuste con existencia SOBRANTE (real < teórico → sale). */
export const COD_AJUSTE_SALIDA = 'ajuste-ciclico-salida';

/**
 * Resuelve un tipo de movimiento por su `codigo`, exigiéndolo activo. Los dos tipos del cíclico son
 * GENÉRICOS: el encabezado del kardex es el mismo para PT, tela y avío (ADR-0010 §2), así que las
 * tres dimensiones ajustan con `ajuste-ciclico-entrada`/`-salida` y no hace falta sembrar ninguno.
 */
export async function tipoPorCodigo(tx: Tx, codigo: string): Promise<{ id: number; nombre: string }> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { codigo },
    select: { id: true, nombre: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion(
      `Falta el tipo de movimiento "${codigo}" en el catálogo (re-sembrar con SEED_ON_START).`,
    );
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return { id: tipo.id, nombre: tipo.nombre };
}

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
export function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Fecha de HOY como `YYYY-MM-DD` (UTC). */
export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}
