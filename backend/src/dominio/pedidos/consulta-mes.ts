/**
 * Consulta PEDIDOS POR MES (rediseño R3, B6 — proto §4.1 `vPedidos`): la pantalla de Pedidos
 * nueva. Una fila AGRUPADA por pedido `-F` (cliente, vigencia, chip de OC del cliente, totales)
 * con sus renglones/modelos (cantidad · precio · importe · No. orden · corte), más la BARRA DE
 * TOTALES del filtro COMPLETO. TODO se agrega EN EL SERVIDOR (A1; lección F5-E7).
 *
 * Semántica (fiel al proto + decisiones de esta fase, documentadas):
 *  • Tabs de MES = mes de ENTREGA del pedido (`fechaHasta ?? fechaDe`); un pedido SIN ventana de
 *    entrega cae al mes de su `fechaPedido` (o de su captura) para que NINGÚN pedido quede
 *    inalcanzable bajo el filtro de año. `EXTRACT(MONTH/YEAR)` no existe en el where de Prisma: se
 *    pre-resuelven los ids por SQL crudo PARAMETRIZADO (mismo patrón que el mes del centro R2).
 *  • Estatus del pedido: Cancelado (`pedCancelado`) > Entregado (`entregadoTienda`) > Vigente.
 *  • `idOrden`/`folioOrden` del renglón = su OP VIVA más reciente (mayor folio); `numOrdenes`
 *    cuenta las vivas (resurtidos). `cortado` = Σ de `EtapaMovimientoDet` de cortes VIVOS (F3-E2,
 *    canceladas fuera) de TODAS las OPs vivas del renglón — misma semántica que el centro R2.
 *  • IMPORTES null sin `pedidos.importes` (ocultamiento server-side, doc 02 §3) — también en la
 *    barra de totales.
 *  • A9: el filtro `idEmpresa` del proto se honra solo si coincide con la activa (página vacía si
 *    no) — paridad con `centroComandoOrdenes`.
 *
 * Sin N+1: por página son consultas AGREGADAS por lote de ids (órdenes vivas + cortes); los
 * totales del filtro completo son 2 agregados SQL sobre los ids que cumplen el filtro.
 */
import { z } from 'zod';

import type {
  PedidoMesFila,
  PedidoMesRenglon,
  PedidosPorMesSalida,
  PedidosPorMesTotales,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/**
 * Parámetros EN DOMINIO (tipos nativos; la ruta coacciona la querystring — mismo patrón que
 * `esquemaCentroDominio` del centro R2).
 */
const esquemaConsultaMesDominio = z.object({
  anio: z.number().int().min(2000).max(2100).optional(),
  mes: z.number().int().min(1).max(12).optional(),
  idCliente: z.number().int().positive().optional(),
  idEmpresa: z.number().int().positive().optional(),
  estatus: z.enum(['vigentes', 'entregados', 'cancelados', 'todos']).default('vigentes'),
  pagina: z.number().int().min(1).default(1),
  porPagina: z.number().int().min(1).max(100).default(50),
});

/** Parámetros que acepta `pedidosPorMes` (forma nativa, no la de la URL). */
export type ParametrosPedidosPorMes = z.input<typeof esquemaConsultaMesDominio>;

/** Convierte un `DateTime @db.Date` a `YYYY-MM-DD`, o `null`. */
function aFechaIso(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** Respuesta vacía con la forma estándar (caso A9: idEmpresa ≠ empresa activa). */
function respuestaVacia(pagina: number, porPagina: number): PedidosPorMesSalida {
  return {
    datos: [],
    totales: { pedidos: 0, ordenes: 0, piezas: 0, cortado: 0, avancePct: 0, importe: 0 },
    total: 0,
    pagina,
    porPagina,
    totalPaginas: 1,
  };
}

/**
 * CONSULTA de pedidos por mes (permiso `pedidos.ver`): filas agrupadas pedido→renglones con
 * paginación en servidor + totales del filtro completo. Ver el encabezado para la semántica.
 */
export async function pedidosPorMes(
  sesion: SesionUsuario,
  parametros: ParametrosPedidosPorMes = {},
  bd?: ContextoBd,
): Promise<PedidosPorMesSalida> {
  verificarPermiso(sesion, 'pedidos.ver');
  const filtros = validarEntrada(esquemaConsultaMesDominio, parametros);
  const puedeVerImportes = tienePermiso(sesion, 'pedidos.importes');

  // A9: el filtro de empresa del proto se honra solo si coincide con la activa.
  if (filtros.idEmpresa !== undefined && filtros.idEmpresa !== sesion.idEmpresaActiva) {
    return respuestaVacia(filtros.pagina, filtros.porPagina);
  }

  const cliente = clienteLectura(bd);

  // Pre-filtro por mes/año de ENTREGA (`fechaHasta ?? fechaDe`; sin ventana cae a la fecha del
  // pedido o de su captura) por SQL crudo parametrizado.
  let idsDeEntrega: number[] | undefined;
  if (filtros.mes !== undefined || filtros.anio !== undefined) {
    const fechaEntrega = Prisma.sql`COALESCE(fecha_hasta, fecha_de, fecha_pedido, creado_en)`;
    const condiciones = [Prisma.sql`id_empresa = ${sesion.idEmpresaActiva}`];
    if (filtros.mes !== undefined) {
      condiciones.push(Prisma.sql`EXTRACT(MONTH FROM ${fechaEntrega}) = ${filtros.mes}`);
    }
    if (filtros.anio !== undefined) {
      condiciones.push(Prisma.sql`EXTRACT(YEAR FROM ${fechaEntrega}) = ${filtros.anio}`);
    }
    const filas = await cliente.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM pedidos WHERE ${Prisma.join(condiciones, ' AND ')}`,
    );
    idsDeEntrega = filas.map((f) => f.id);
    if (idsDeEntrega.length === 0) {
      return respuestaVacia(filtros.pagina, filtros.porPagina);
    }
  }

  const where: Prisma.PedidoWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(idsDeEntrega === undefined ? {} : { id: { in: idsDeEntrega } }),
    ...(filtros.estatus === 'vigentes'
      ? { pedCancelado: false, entregadoTienda: false }
      : filtros.estatus === 'entregados'
        ? { pedCancelado: false, entregadoTienda: true }
        : filtros.estatus === 'cancelados'
          ? { pedCancelado: true }
          : {}),
  };

  // Ids del filtro COMPLETO (para la barra de totales) + la página de pedidos.
  const [idsFiltro, pagina] = await Promise.all([
    cliente.pedido.findMany({ where, select: { id: true } }),
    cliente.pedido.findMany({
      where,
      orderBy: [{ folio: 'desc' }, { id: 'desc' }],
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
      select: {
        id: true,
        folio: true,
        idEmpresa: true,
        empresa: { select: { nombre: true } },
        idCliente: true,
        cliente: { select: { nombre: true } },
        ocCliente: true,
        fechaDe: true,
        fechaHasta: true,
        pedCancelado: true,
        entregadoTienda: true,
        lineas: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            idModelo: true,
            cantidadPedida: true,
            precio: true,
            idDesarrollo: true,
            modelo: {
              select: { codigo: true, descripcion: true, numeroProduccion: true },
            },
            desarrollo: { select: { numeroCliente: true } },
          },
        },
      },
    }),
  ]);
  const total = idsFiltro.length;
  const idsTodos = idsFiltro.map((p) => p.id);

  // ── Agregados de la PÁGINA por lote (órdenes vivas + cortado), sin N+1 ─────────────
  const idsLineaPagina = pagina.flatMap((p) => p.lineas.map((l) => l.id));
  const ordenesVivas =
    idsLineaPagina.length === 0
      ? []
      : await cliente.orden.findMany({
          where: { idPedidoLinea: { in: idsLineaPagina }, estado: { not: 'cancelada' } },
          orderBy: { folio: 'asc' },
          select: { id: true, folio: true, idPedidoLinea: true },
        });
  const idsOrdenPagina = ordenesVivas.map((o) => o.id);
  const cortes =
    idsOrdenPagina.length === 0
      ? []
      : await cliente.etapaMovimiento.findMany({
          where: { idOrden: { in: idsOrdenPagina }, tipo: 'corte', canceladoEn: null },
          select: { idOrden: true, detalles: { select: { cantidad: true } } },
        });

  // Σ cortado por orden → por renglón; órdenes por renglón (la más reciente = mayor folio).
  const cortadoPorOrden = new Map<number, number>();
  for (const corte of cortes) {
    const suma = corte.detalles.reduce((s, d) => s + d.cantidad, 0);
    cortadoPorOrden.set(corte.idOrden, (cortadoPorOrden.get(corte.idOrden) ?? 0) + suma);
  }
  interface OrdenesDeLinea {
    ultima: { id: number; folio: number } | null;
    numOrdenes: number;
    cortado: number;
  }
  const ordenesPorLinea = new Map<number, OrdenesDeLinea>();
  for (const orden of ordenesVivas) {
    if (orden.idPedidoLinea === null) continue;
    const agregado = ordenesPorLinea.get(orden.idPedidoLinea) ?? {
      ultima: null,
      numOrdenes: 0,
      cortado: 0,
    };
    agregado.numOrdenes += 1;
    agregado.cortado += cortadoPorOrden.get(orden.id) ?? 0;
    // El orderBy folio asc deja al FINAL la más reciente: basta con pisar en cada vuelta.
    agregado.ultima = { id: orden.id, folio: Number(orden.folio) };
    ordenesPorLinea.set(orden.idPedidoLinea, agregado);
  }

  // ── Totales del filtro COMPLETO (2 agregados SQL sobre los ids del filtro) ─────────
  let totales: PedidosPorMesTotales = {
    pedidos: total,
    ordenes: 0,
    piezas: 0,
    cortado: 0,
    avancePct: 0,
    importe: puedeVerImportes ? 0 : null,
  };
  if (idsTodos.length > 0) {
    const [piezasImporte, ordenesCortado] = await Promise.all([
      cliente.$queryRaw<{ piezas: number; importe: number }[]>(
        Prisma.sql`SELECT COALESCE(SUM(cantidad_pedida), 0)::int AS piezas,
                          COALESCE(SUM(cantidad_pedida * precio), 0)::float AS importe
                   FROM pedido_linea WHERE id_pedido = ANY(${idsTodos})`,
      ),
      cliente.$queryRaw<{ ordenes: number; cortado: number }[]>(
        Prisma.sql`SELECT COUNT(DISTINCT o.id)::int AS ordenes,
                          COALESCE(SUM(d.cantidad), 0)::int AS cortado
                   FROM pedido_linea pl
                   JOIN ordenes o ON o.id_pedido_linea = pl.id AND o.estado <> 'cancelada'
                   LEFT JOIN etapa_movimiento em
                     ON em.id_orden = o.id AND em.tipo = 'corte' AND em.cancelado_en IS NULL
                   LEFT JOIN etapa_movimiento_det d ON d.id_etapa_mov = em.id
                   WHERE pl.id_pedido = ANY(${idsTodos})`,
      ),
    ]);
    const piezas = piezasImporte[0]?.piezas ?? 0;
    const cortado = ordenesCortado[0]?.cortado ?? 0;
    totales = {
      pedidos: total,
      ordenes: ordenesCortado[0]?.ordenes ?? 0,
      piezas,
      cortado,
      avancePct: piezas > 0 ? Math.round((cortado / piezas) * 100) : 0,
      importe: puedeVerImportes ? (piezasImporte[0]?.importe ?? 0) : null,
    };
  }

  // ── Proyección de la página ─────────────────────────────────────────────────────────
  const datos: PedidoMesFila[] = pagina.map((pedido) => {
    let cantidadTotal = 0;
    let cortadoTotal = 0;
    let importeTotal = 0;
    const renglones: PedidoMesRenglon[] = pedido.lineas.map((linea) => {
      const ordenes = ordenesPorLinea.get(linea.id);
      const precio = linea.precio.toNumber();
      const importe = linea.cantidadPedida * precio;
      cantidadTotal += linea.cantidadPedida;
      cortadoTotal += ordenes?.cortado ?? 0;
      importeTotal += importe;
      return {
        id: linea.id,
        idModelo: linea.idModelo,
        codigoModelo: linea.modelo.codigo,
        descripcionModelo: linea.modelo.descripcion,
        idDesarrollo: linea.idDesarrollo,
        numeroCliente: linea.desarrollo?.numeroCliente ?? null,
        numeroProduccion: linea.modelo.numeroProduccion,
        cantidad: linea.cantidadPedida,
        precio: puedeVerImportes ? precio : null,
        importe: puedeVerImportes ? importe : null,
        idOrden: ordenes?.ultima?.id ?? null,
        folioOrden: ordenes?.ultima?.folio ?? null,
        numOrdenes: ordenes?.numOrdenes ?? 0,
        cortado: ordenes?.cortado ?? 0,
      };
    });
    return {
      id: pedido.id,
      folio: Number(pedido.folio),
      idEmpresa: pedido.idEmpresa,
      empresa: pedido.empresa.nombre,
      idCliente: pedido.idCliente,
      cliente: pedido.cliente.nombre,
      ocCliente: pedido.ocCliente,
      fechaDe: aFechaIso(pedido.fechaDe),
      fechaHasta: aFechaIso(pedido.fechaHasta),
      estatus: pedido.pedCancelado
        ? ('cancelado' as const)
        : pedido.entregadoTienda
          ? ('entregado' as const)
          : ('vigente' as const),
      cantidadTotal,
      cortadoTotal,
      importeTotal: puedeVerImportes ? importeTotal : null,
      renglones,
    };
  });

  return {
    datos,
    totales,
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}
