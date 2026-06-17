/**
 * Tipos de movimiento de inventario — consulta de SOLO LECTURA (F3-E1; ex `IPT_TiposMov`,
 * doc 04-Inventarios §A.2).
 *
 * Catálogo administrable por seed (los 19 tipos con su dirección); en F3-E1 solo se EXPONE para
 * que las pantallas de movimientos de E3 lo listen. No hay alta/edición por API todavía (el ABM
 * fino se difiere, mismo criterio que otros catálogos selector). Permiso `inventario-pt.ver`.
 */
import { DIRECCIONES_MOVIMIENTO } from '../../contrato/index.js';
import type { Prisma, TipoMovimientoInventario } from '../../datos/index.js';
import { z } from 'zod';

import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/**
 * Parámetros del listado de tipos de movimiento (ya coaccionados): la ruta REST coacciona el
 * querystring con `esquemaTiposMovimientoQuery` (stringbool) y entrega banderas booleanas; este
 * esquema re-valida la forma de DOMINIO (igual patrón que `esquemaListarAlmacenes`).
 */
export const esquemaListarTiposMovimiento = z.object({
  incluirInactivos: z.boolean().default(false),
  direccion: z.enum(DIRECCIONES_MOVIMIENTO).optional(),
});

/** Parámetros del listado de tipos de movimiento. */
export type ParametrosListarTiposMovimiento = z.input<typeof esquemaListarTiposMovimiento>;

/**
 * Lista los tipos de movimiento de inventario (lista simple ordenada por id, como el viejo
 * IPT_TiposMov). Por defecto solo activos; opcionalmente filtra por dirección.
 */
export async function listarTiposMovimiento(
  sesion: SesionUsuario,
  parametros: ParametrosListarTiposMovimiento = {},
  bd?: ContextoBd,
): Promise<TipoMovimientoInventario[]> {
  verificarPermiso(sesion, 'inventario-pt.ver');
  const filtros = validarEntrada(esquemaListarTiposMovimiento, parametros);

  const where: Prisma.TipoMovimientoInventarioWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.direccion === undefined ? {} : { direccion: filtros.direccion }),
  };

  return clienteLectura(bd).tipoMovimientoInventario.findMany({
    where,
    orderBy: { id: 'asc' },
  });
}
