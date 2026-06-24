/**
 * Resolución del catálogo `TipoProceso` para el ETL de producción (F3-E6). Los flujos M (costura) y
 * A (estampado) del viejo mapean a los `TipoProceso` sembrados con esos `codigo` (seed F3-E1). El
 * código es la clave estable; aquí solo se LEE (el ETL no crea tipos de proceso).
 */
import type { PrismaClient } from '../../src/datos/index.js';

/** Devuelve el id del `TipoProceso` por su `codigo`, o `null` si no existe (el loader lo reporta). */
export async function resolverTipoProceso(
  cliente: PrismaClient,
  codigo: string,
): Promise<number | null> {
  const tipo = await cliente.tipoProceso.findUnique({ where: { codigo }, select: { id: true } });
  return tipo?.id ?? null;
}
