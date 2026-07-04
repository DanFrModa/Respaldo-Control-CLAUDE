/**
 * Cantidades DERIVADAS de una orden que sirven de BASE DE PRORRATEO del costeo (F7-E1; D2/D3/D4).
 * Todas se calculan por SUMA DIRECTA de `EtapaMovimientoDet` (etapas vivas, canceladas excluidas) —
 * NUNCA por un acumulador ni una columna (D3). Es el mismo criterio que el tablero WIP (F3-E5).
 *
 *  • pedido   = Σ de la matriz `OrdenLineaTalla` (lo pedido).
 *  • cortado  = Σ etapas `corte`                          (= `CantCorte` del viejo → base default).
 *  • recibido = Σ recibos de procesos que meten a PT (costura, `generaEntradaPt`) — prenda terminada.
 *  • vendido  = Σ etapas `entrega_cliente`.
 *
 * Se reusa en el costeo de una orden (obtener/guardar) y en la lista de costos (unitario por fila).
 */
import { TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';

/** Cliente de LECTURA (sin transacción). */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Cantidades derivadas de una orden (base del prorrateo del costo unitario). */
export interface CantidadesOrden {
  pedido: number;
  cortado: number;
  recibido: number;
  vendido: number;
}

/** Cantidades en cero (para una orden sin matriz ni etapas). */
export function cantidadesVacias(): CantidadesOrden {
  return { pedido: 0, cortado: 0, recibido: 0, vendido: 0 };
}

/** Elige la cantidad de la base de prorrateo pedida. */
export function cantidadDeBase(
  c: CantidadesOrden,
  base: 'cortado' | 'recibido' | 'vendido',
): number {
  return base === 'cortado' ? c.cortado : base === 'recibido' ? c.recibido : c.vendido;
}

/** Σ de una etapa (por tipo, opcionalmente solo procesos que meten a PT) para UNA orden. */
async function totalEtapa(
  cliente: ClienteLectura,
  idOrden: number,
  tipo: TipoEtapaMovimiento,
  soloEntradaPt = false,
): Promise<number> {
  const where: Prisma.EtapaMovimientoDetWhereInput = {
    etapaMov: {
      idOrden,
      tipo,
      canceladoEn: null,
      ...(soloEntradaPt ? { tipoProceso: { generaEntradaPt: true } } : {}),
    },
  };
  const agregado = await cliente.etapaMovimientoDet.aggregate({ where, _sum: { cantidad: true } });
  return agregado._sum.cantidad ?? 0;
}

/** Σ de la matriz pedida (`OrdenLineaTalla`) de UNA orden. */
async function totalPedido(cliente: ClienteLectura, idOrden: number): Promise<number> {
  const agregado = await cliente.ordenLineaTalla.aggregate({
    where: { ordenLinea: { idOrden } },
    _sum: { cantidad: true },
  });
  return agregado._sum.cantidad ?? 0;
}

/** Cantidades derivadas de UNA orden (pedido/cortado/recibido/vendido). */
export async function cantidadesDeOrden(
  idOrden: number,
  bd?: ContextoBd,
): Promise<CantidadesOrden> {
  const cliente = clienteLectura(bd);
  const [pedido, cortado, recibido, vendido] = await Promise.all([
    totalPedido(cliente, idOrden),
    totalEtapa(cliente, idOrden, TipoEtapaMovimiento.corte),
    totalEtapa(cliente, idOrden, TipoEtapaMovimiento.recibo_maquila, true),
    totalEtapa(cliente, idOrden, TipoEtapaMovimiento.entrega_cliente),
  ]);
  return { pedido, cortado, recibido, vendido };
}

/**
 * Cantidades derivadas de un CONJUNTO de órdenes en pocas consultas agregadas (no N+1), para la lista
 * de costos. Devuelve `idOrden → CantidadesOrden` (las órdenes sin etapas quedan en 0).
 */
export async function cantidadesDeOrdenes(
  idsOrden: number[],
  bd?: ContextoBd,
): Promise<Map<number, CantidadesOrden>> {
  const resultado = new Map<number, CantidadesOrden>();
  if (idsOrden.length === 0) {
    return resultado;
  }
  const cliente = clienteLectura(bd);

  // Σ por etapa agrupando por (idEtapaMov) y luego reagrupando por orden — mismo patrón que WIP.
  const sumaPorOrden = async (
    tipo: TipoEtapaMovimiento,
    soloEntradaPt = false,
  ): Promise<Map<number, number>> => {
    const filas = await cliente.etapaMovimientoDet.groupBy({
      by: ['idEtapaMov'],
      where: {
        etapaMov: {
          idOrden: { in: idsOrden },
          tipo,
          canceladoEn: null,
          ...(soloEntradaPt ? { tipoProceso: { generaEntradaPt: true } } : {}),
        },
      },
      _sum: { cantidad: true },
    });
    const etapas = await cliente.etapaMovimiento.findMany({
      where: { id: { in: filas.map((f) => f.idEtapaMov) } },
      select: { id: true, idOrden: true },
    });
    const ordenPorEtapa = new Map(etapas.map((e) => [e.id, e.idOrden]));
    const acum = new Map<number, number>();
    for (const f of filas) {
      const idOrden = ordenPorEtapa.get(f.idEtapaMov);
      if (idOrden === undefined) continue;
      acum.set(idOrden, (acum.get(idOrden) ?? 0) + (f._sum.cantidad ?? 0));
    }
    return acum;
  };

  const pedidoFilas = await cliente.ordenLineaTalla.groupBy({
    by: ['idOrdenLinea'],
    where: { ordenLinea: { idOrden: { in: idsOrden } } },
    _sum: { cantidad: true },
  });
  const renglones = await cliente.ordenLinea.findMany({
    where: { idOrden: { in: idsOrden } },
    select: { id: true, idOrden: true },
  });
  const ordenPorRenglon = new Map(renglones.map((r) => [r.id, r.idOrden]));
  const pedido = new Map<number, number>();
  for (const f of pedidoFilas) {
    const idOrden = ordenPorRenglon.get(f.idOrdenLinea);
    if (idOrden === undefined) continue;
    pedido.set(idOrden, (pedido.get(idOrden) ?? 0) + (f._sum.cantidad ?? 0));
  }

  const [cortado, recibido, vendido] = await Promise.all([
    sumaPorOrden(TipoEtapaMovimiento.corte),
    sumaPorOrden(TipoEtapaMovimiento.recibo_maquila, true),
    sumaPorOrden(TipoEtapaMovimiento.entrega_cliente),
  ]);

  for (const id of idsOrden) {
    resultado.set(id, {
      pedido: pedido.get(id) ?? 0,
      cortado: cortado.get(id) ?? 0,
      recibido: recibido.get(id) ?? 0,
      vendido: vendido.get(id) ?? 0,
    });
  }
  return resultado;
}
