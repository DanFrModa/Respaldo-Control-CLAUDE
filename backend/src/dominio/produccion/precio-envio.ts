/**
 * El PRECIO DE MAQUILA de una orden con un maquilero en un proceso — UNA sola regla para todo lo que
 * lo necesita (fila 0.218, §Post-F9.243).
 *
 * El precio se pacta al MANDAR la prenda al maquilero: vive en el `precioPactado` del ENVÍO. Daniel,
 * textual: *«no me debe de preguntar el precio del recibo. Eso está en la salida de maquila»*. Por eso
 * el recibo ya no lo pide: lo HEREDA de aquí; el cierre de la orden con el maquilero (que propone
 * el cobro de lo que no regresó) lo toma de aquí; y la VISTA PREVIA de ese cierre en el WIP
 * (`wip.ts`, que necesita el de TODOS los maquileros de un proceso a la vez) usa la variante en lote
 * {@link preciosDelEnvioPorMaquilero}. Tres lectores, una regla — si un día cambia el criterio (p.
 * ej. qué envío manda cuando hay dos con precios distintos), cambia para los tres: el filtro y el
 * orden viven UNA vez, abajo.
 *
 * La regla:
 *  - Si se nombra un envío concreto (`idEtapaEnvio`, la liga del recibo), es el precio de ESE envío,
 *    siempre que sea de la misma orden+proceso+maquilero y esté vivo.
 *  - Si no, el del envío VIVO MÁS RECIENTE de esa orden+proceso+maquilero que traiga precio
 *    (fecha y, a igual fecha, el último capturado: id mayor).
 *  - Un envío CANCELADO no presta su precio: cancelar es decir que ese envío no pasó.
 *  - `null` cuando ningún envío lo trae (el histórico migrado: 1,309 envíos sin precio). **No se
 *    inventa un precio** (REGLA 0-B: lo viejo se tolera, no se compensa); quien lo lea decide qué
 *    hacer con el hueco.
 */
import { TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';

import type { ClienteLectura } from '../../comun/transaccion.js';

/** Los envíos que PUEDEN prestar su precio: vivos, de maquila y con precio. */
function enviosConPrecio(idOrden: number, idTipoProceso: number): Prisma.EtapaMovimientoWhereInput {
  return {
    idOrden,
    idTipoProceso,
    tipo: TipoEtapaMovimiento.envio_maquila,
    canceladoEn: null,
    precioPactado: { not: null },
  };
}

/** Cuál manda entre varios: el más reciente por fecha y, a igual fecha, el último capturado. */
const MAS_RECIENTE_PRIMERO: Prisma.EtapaMovimientoOrderByWithRelationInput[] = [
  { fecha: 'desc' },
  { id: 'desc' },
];

/** Orden + proceso + maquilero, y opcionalmente el envío concreto al que se liga. */
export interface FiltroPrecioEnvio {
  idOrden: number;
  idTipoProceso: number;
  idMaquilero: number;
  /** El envío concreto (la liga del recibo). Si se omite, manda el envío vivo más reciente. */
  idEtapaEnvio?: number | undefined;
}

/** El `precioPactado` del envío que manda según la regla de arriba, o `null` si no hay. */
export async function precioDelEnvio(
  cliente: ClienteLectura,
  filtro: FiltroPrecioEnvio,
): Promise<number | null> {
  const envio = await cliente.etapaMovimiento.findFirst({
    where: {
      ...enviosConPrecio(filtro.idOrden, filtro.idTipoProceso),
      ...(filtro.idEtapaEnvio === undefined ? {} : { id: filtro.idEtapaEnvio }),
      idTercero: filtro.idMaquilero,
    },
    orderBy: MAS_RECIENTE_PRIMERO,
    select: { precioPactado: true },
  });
  return envio?.precioPactado == null ? null : envio.precioPactado.toNumber();
}

/**
 * La MISMA regla, en LOTE: el precio de CADA maquilero de un proceso de la orden, en UNA consulta
 * (la vista previa del cierre en el WIP los pinta todos a la vez; llamar a {@link precioDelEnvio}
 * por maquilero sería N+1). El primero que aparece por maquilero es el que manda, porque la consulta
 * viene ordenada con el mismo {@link MAS_RECIENTE_PRIMERO}. Un maquilero sin envío con precio no
 * aparece en el mapa (= `null` para quien lo lea).
 */
export async function preciosDelEnvioPorMaquilero(
  cliente: ClienteLectura,
  filtro: { idOrden: number; idTipoProceso: number },
): Promise<Map<number, number>> {
  const envios = await cliente.etapaMovimiento.findMany({
    where: { ...enviosConPrecio(filtro.idOrden, filtro.idTipoProceso), idTercero: { not: null } },
    orderBy: MAS_RECIENTE_PRIMERO,
    select: { idTercero: true, precioPactado: true },
  });
  const precios = new Map<number, number>();
  for (const e of envios) {
    if (e.idTercero === null || e.precioPactado === null || precios.has(e.idTercero)) continue;
    precios.set(e.idTercero, e.precioPactado.toNumber());
  }
  return precios;
}
