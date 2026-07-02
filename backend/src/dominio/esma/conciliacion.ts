/**
 * CONCILIACIÓN EsMa vs RECIBOS (F6-E4; doc 07-EsMa §6, ex `EsMaRecibosSemCon`/`...Est` con su
 * `CuantasFaltan` — aquí UNIFICADO por `idTipoProceso`, sin el par duplicado /Est). Cuadra, por
 * periodo + orden + maquilero + proceso, lo RECIBIDO (producción F3: piezas de los recibos vivos)
 * contra lo CARGADO a EsMa (Σ cantidadReal de los cargos validados):
 *  • `faltantePorCargar = recibido − cargado` (>0 = se recibió pero aún no se cargó/validó a EsMa);
 *  • `cargosSinRecibo`   = cargos sin `idEtapaRecibo` (histórico/manual) — candidatos a revisión.
 *
 * Es una consulta de solo lectura (agregación en servidor, A1/§1 permite SQL de reporte; aquí basta
 * agrupar en memoria). Devuelve CANTIDADES (piezas), no importes → no se ocultan por `ver-importes`.
 * Permiso `esma.ver-pagos` (ver estado de cuenta). A9 por empresa activa.
 */
import {
  esquemaConciliacionQuery,
  type ConciliacionQuery,
  type ConciliacionSalida,
} from '../../contrato/index.js';
import { TipoEtapaMovimiento } from '../../datos/index.js';
import type { z } from 'zod';

import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Clave de grupo orden+maquilero+proceso. */
function claveGrupo(
  idOrden: number,
  idMaquilero: number | null,
  idTipoProceso: number | null,
): string {
  return `${idOrden}:${idMaquilero ?? 'sin'}:${idTipoProceso ?? 'sin'}`;
}

/**
 * Cuadra recibido vs cargado del periodo (por orden+maquilero+proceso) y lista los cargos sin recibo.
 * `desde`/`hasta` filtran por la FECHA de los recibos; `idMaquilero` acota a un maquilero.
 */
export async function conciliarEsMa(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaConciliacionQuery> = {},
  bd?: ContextoBd,
): Promise<ConciliacionSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const filtros: ConciliacionQuery = validarEntrada(esquemaConciliacionQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const rangoFecha =
    filtros.desde === undefined && filtros.hasta === undefined
      ? {}
      : {
          fecha: {
            ...(filtros.desde === undefined ? {} : { gte: aDateColumna(filtros.desde) }),
            ...(filtros.hasta === undefined ? {} : { lte: aDateColumna(filtros.hasta) }),
          },
        };

  // (1) RECIBIDO: recibos vivos del periodo, con su detalle (piezas) por orden+maquilero+proceso.
  const recibos = await cliente.etapaMovimiento.findMany({
    where: {
      idEmpresa,
      tipo: TipoEtapaMovimiento.recibo_maquila,
      canceladoEn: null,
      ...(filtros.idMaquilero === undefined ? {} : { idTercero: filtros.idMaquilero }),
      ...rangoFecha,
    },
    select: {
      idOrden: true,
      idTercero: true,
      idTipoProceso: true,
      orden: { select: { folio: true } },
      tercero: { select: { nombre: true } },
      tipoProceso: { select: { nombre: true } },
      detalles: { select: { cantidad: true } },
    },
  });

  interface Grupo {
    idOrden: number;
    folioOrden: number;
    idMaquilero: number | null;
    maquilero: string;
    idTipoProceso: number | null;
    tipoProceso: string;
    recibido: number;
    cargado: number;
  }
  const grupos = new Map<string, Grupo>();
  const idsOrden = new Set<number>();
  for (const r of recibos) {
    idsOrden.add(r.idOrden);
    const clave = claveGrupo(r.idOrden, r.idTercero, r.idTipoProceso);
    const recibido = r.detalles.reduce((s, d) => s + d.cantidad, 0);
    const g = grupos.get(clave) ?? {
      idOrden: r.idOrden,
      folioOrden: Number(r.orden.folio),
      idMaquilero: r.idTercero,
      maquilero: r.tercero?.nombre ?? 'Sin asignar',
      idTipoProceso: r.idTipoProceso,
      tipoProceso: r.tipoProceso?.nombre ?? '',
      recibido: 0,
      cargado: 0,
    };
    g.recibido += recibido;
    grupos.set(clave, g);
  }

  // (2) CARGADO: Σ cantidadReal de los cargos VALIDADOS de esas órdenes (mismo grupo), + opcional maquilero.
  if (idsOrden.size > 0) {
    const cargos = await cliente.esMaCargo.findMany({
      where: {
        idEmpresa,
        estado: 'validado',
        idOrden: { in: [...idsOrden] },
        ...(filtros.idMaquilero === undefined ? {} : { idMaquilero: filtros.idMaquilero }),
      },
      select: { idOrden: true, idMaquilero: true, idTipoProceso: true, cantidadReal: true },
    });
    for (const c of cargos) {
      const clave = claveGrupo(c.idOrden, c.idMaquilero, c.idTipoProceso);
      const g = grupos.get(clave);
      if (g !== undefined) {
        g.cargado += c.cantidadReal?.toNumber() ?? 0;
      }
    }
  }

  // (2b) CONTEXTO de la orden para el add-on de E5: cortado + entregado (F3/wip) y estatus "pagada".
  //      Son datos POR ORDEN (se repiten en cada fila de la misma orden). Solo lectura, en cantidades.
  const cortadoPorOrden = new Map<number, number>();
  const entregadoPorOrden = new Map<number, number>();
  const pagadaPorOrden = new Map<number, boolean>();
  if (idsOrden.size > 0) {
    const [etapas, ordenes] = await Promise.all([
      cliente.etapaMovimiento.findMany({
        where: {
          idEmpresa,
          canceladoEn: null,
          idOrden: { in: [...idsOrden] },
          tipo: { in: [TipoEtapaMovimiento.corte, TipoEtapaMovimiento.entrega_cliente] },
        },
        select: { idOrden: true, tipo: true, detalles: { select: { cantidad: true } } },
      }),
      cliente.orden.findMany({
        where: { id: { in: [...idsOrden] } },
        select: { id: true, pagada: true },
      }),
    ]);
    for (const e of etapas) {
      const suma = e.detalles.reduce((s, d) => s + d.cantidad, 0);
      const destino = e.tipo === TipoEtapaMovimiento.corte ? cortadoPorOrden : entregadoPorOrden;
      destino.set(e.idOrden, (destino.get(e.idOrden) ?? 0) + suma);
    }
    for (const o of ordenes) {
      pagadaPorOrden.set(o.id, o.pagada ?? false);
    }
  }

  const filasBase = [...grupos.values()]
    .map((g) => ({
      idOrden: g.idOrden,
      folioOrden: g.folioOrden,
      idMaquilero: g.idMaquilero,
      maquilero: g.maquilero,
      idTipoProceso: g.idTipoProceso,
      tipoProceso: g.tipoProceso,
      recibido: g.recibido,
      cargado: g.cargado,
      faltantePorCargar: g.recibido - g.cargado,
      cortado: cortadoPorOrden.get(g.idOrden) ?? 0,
      entregado: entregadoPorOrden.get(g.idOrden) ?? 0,
      pagada: pagadaPorOrden.get(g.idOrden) ?? false,
    }))
    .sort((a, b) => a.folioOrden - b.folioOrden || a.maquilero.localeCompare(b.maquilero, 'es'));

  // Filtro por estatus de pago (E5 add-on): "pagadas" / "no-pagadas" / "todas" (default).
  const filas =
    filtros.pagadas === 'pagadas'
      ? filasBase.filter((f) => f.pagada)
      : filtros.pagadas === 'no-pagadas'
        ? filasBase.filter((f) => !f.pagada)
        : filasBase;

  // (3) CARGOS SIN RECIBO ligado (histórico/manual). Filtra por creadoEn en el periodo si se dio.
  const rangoCreado =
    filtros.desde === undefined && filtros.hasta === undefined
      ? {}
      : {
          creadoEn: {
            ...(filtros.desde === undefined ? {} : { gte: aDateColumna(filtros.desde) }),
            ...(filtros.hasta === undefined
              ? {}
              : { lt: new Date(aDateColumna(filtros.hasta).getTime() + 86_400_000) }),
          },
        };
  const sinRecibo = await cliente.esMaCargo.findMany({
    where: {
      idEmpresa,
      idEtapaRecibo: null,
      estado: { not: 'cancelado' },
      ...(filtros.idMaquilero === undefined ? {} : { idMaquilero: filtros.idMaquilero }),
      ...rangoCreado,
    },
    select: {
      id: true,
      idOrden: true,
      idMaquilero: true,
      idTipoProceso: true,
      cantidadReal: true,
      orden: { select: { folio: true } },
      maquilero: { select: { nombre: true } },
      tipoProceso: { select: { nombre: true } },
    },
    orderBy: { id: 'asc' },
  });
  const cargosSinRecibo = sinRecibo.map((c) => ({
    idCargo: c.id,
    idOrden: c.idOrden,
    folioOrden: Number(c.orden.folio),
    idMaquilero: c.idMaquilero,
    maquilero: c.maquilero.nombre,
    idTipoProceso: c.idTipoProceso,
    tipoProceso: c.tipoProceso.nombre,
    cantidad: c.cantidadReal?.toNumber() ?? null,
  }));

  const totales = filas.reduce(
    (acc, f) => ({
      recibido: acc.recibido + f.recibido,
      cargado: acc.cargado + f.cargado,
      faltantePorCargar: acc.faltantePorCargar + f.faltantePorCargar,
      numCargosSinRecibo: acc.numCargosSinRecibo,
    }),
    { recibido: 0, cargado: 0, faltantePorCargar: 0, numCargosSinRecibo: cargosSinRecibo.length },
  );

  return {
    desde: filtros.desde ?? null,
    hasta: filtros.hasta ?? null,
    filas,
    cargosSinRecibo,
    totales,
  };
}
