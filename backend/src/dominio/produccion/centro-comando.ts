/**
 * CENTRO DE COMANDO de Órdenes — rediseño R2 (§4.2 del plan, brecha B2): la consulta de LA
 * pantalla principal de la operación. Una fila por orden con las 13 columnas del proto: empresa ·
 * No. OP · modelo · pedido del cliente (D7) · cant. ordenada · cant. cortada · maquilero (+n) ·
 * estampador · pedido interno `-F` · OC de tela · mes de entrega · cliente.
 *
 * Innegociables aplicados:
 *  • A1 — TODOS los agregados los deriva el servidor (Σ cortado de F3, maquileros distintos, OC de
 *    tela ligada); el front solo pinta. Filtros/orden/paginación EN SERVIDOR (lección F5-E7:
 *    jamás pivotar en el cliente).
 *  • A4 — permiso existente `ordenes.ver` (es una consulta del módulo Órdenes).
 *  • A9 — SIEMPRE por la empresa activa de la sesión. El filtro `idEmpresa` del proto se acepta
 *    por paridad, pero un id distinto de la activa devuelve página VACÍA (una orden de otra
 *    empresa no existe para esta sesión).
 *
 * Sin N+1: por página se hacen consultas AGREGADAS por lote de ids (Σ ordenada, Σ cortada, envíos
 * vivos, OC de tela) — número FIJO de viajes por página, nunca un await por fila.
 *
 * Semántica de las columnas derivadas (fiel al proto + doc 03-Produccion):
 *  • `cantCortada` = Σ de `EtapaMovimientoDet` de cortes VIVOS (canceladas fuera, F3-E2).
 *  • `maquilero` = el del PRIMER envío de COSTURA vivo (folio más antiguo); si la orden aún no
 *    tiene envíos, el maquilero ASIGNADO del encabezado (F2). `numMaquileros` = terceros
 *    DISTINTOS con envíos de costura vivos (badge ×2 si >1). Costura = `TipoProceso.generaEntradaPt`
 *    (el discriminador real de F3-E4: solo el recibo de costura entra a PT).
 *  • `estampador` = primer proveedor de APLICACIÓN (envío vivo con proceso que NO genera entrada
 *    PT: estampado/bordado/lavado/aplicación).
 *  • `ocTelaFolio` = folio de la OC DE TELA ligada a la orden por línea (R7:
 *    `OrdenCompraLinea.idOrden` con `idTela` — la liga que el MRP genera), la más reciente cuyo
 *    documento NO esté en borrador ni cancelado ("¿ya compramos la tela?"). Null = falta.
 *  • `mesEntrega` = mes (1-12) de `fechaEntrega`, de CUALQUIER año (tabs del proto).
 */
import { z } from 'zod';

import type { OrdenCentroFila, OrdenesCentroPagina } from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';

import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Paginacion,
} from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { totalesPorOrden } from './consultas.js';
import { requisitosOrden } from './requisitos-orden.js';

/**
 * Parámetros EN DOMINIO (tipos nativos; la ruta coacciona la querystring — mismo patrón que
 * `esquemaConsultaOrdenesDominio`).
 */
const esquemaCentroDominio = esquemaPaginacion.extend({
  porPagina: z.number().int().min(1).max(100).default(50),
  busqueda: z.string().trim().max(200).optional(),
  idCliente: z.number().int().positive().optional(),
  idMaquilero: z.number().int().positive().optional(),
  idEstampador: z.number().int().positive().optional(),
  idEmpresa: z.number().int().positive().optional(),
  ocTela: z.enum(['con', 'sin']).optional(),
  mesEntrega: z.number().int().min(1).max(12).optional(),
  incluirCanceladas: z.boolean().default(false),
  ordenarPor: z.enum(['folio', 'fecha', 'fechaEntrega', 'creadoEn']).default('folio'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

/** Parámetros que acepta `centroComandoOrdenes` (forma nativa, no la de la URL). */
export type ParametrosCentroComando = z.input<typeof esquemaCentroDominio>;

/** Condición "la orden tiene OC de TELA viva" (liga por línea R7; borrador/cancelada no cuentan). */
const CONDICION_OC_TELA = {
  ordenCompraLineas: {
    some: {
      idTela: { not: null },
      ordenCompra: { estatus: { notIn: ['borrador', 'cancelada'] } },
    },
  },
} satisfies Prisma.OrdenWhereInput;

/**
 * Búsqueda libre del centro: folio OP (si es entero), código de modelo o pedido del cliente
 * (CUALQUIER valor de `OrdenReferencia`, D7). Deliberadamente SIN nombre de cliente (el proto
 * busca "OP, modelo o pedido del cliente"; para el cliente está su select).
 */
function busquedaCentro(busqueda: string | undefined): Prisma.OrdenWhereInput {
  if (busqueda === undefined || busqueda === '') {
    return {};
  }
  const or: Prisma.OrdenWhereInput[] = [
    { modelo: { codigo: { contains: busqueda, mode: 'insensitive' } } },
    { referencias: { some: { valor: { contains: busqueda, mode: 'insensitive' } } } },
  ];
  if (/^\d+$/.test(busqueda)) {
    try {
      or.push({ folio: BigInt(busqueda) });
    } catch {
      // Un número más largo que bigint no es un folio; se ignora.
    }
  }
  return { OR: or };
}

/** Página vacía con la forma estándar (para el caso A9: idEmpresa ≠ empresa activa). */
function paginaVacia(paginacion: Paginacion): OrdenesCentroPagina {
  return armarPagina<OrdenCentroFila>([], 0, paginacion);
}

/**
 * CONSULTA del centro de comando (permiso `ordenes.ver`): filtros/orden/paginación en servidor y
 * las 13 columnas agregadas por lote (sin N+1). Ver el encabezado del módulo para la semántica.
 */
export async function centroComandoOrdenes(
  sesion: SesionUsuario,
  parametros: ParametrosCentroComando = {},
  bd?: ContextoBd,
): Promise<OrdenesCentroPagina> {
  verificarPermiso(sesion, 'ordenes.ver');
  const filtros = validarEntrada(esquemaCentroDominio, parametros);
  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };

  // A9: el filtro de empresa del proto se honra solo si coincide con la activa.
  if (filtros.idEmpresa !== undefined && filtros.idEmpresa !== sesion.idEmpresaActiva) {
    return paginaVacia(paginacion);
  }

  const cliente = clienteLectura(bd);

  // Filtro por MES de entrega (tabs): EXTRACT(MONTH) no existe en el where de Prisma; se
  // pre-resuelven los ids del mes (solo de la empresa activa) y se intersectan. El volumen es
  // acotado (ids enteros de un mes) y mantiene el resto del filtro componible.
  let idsDelMes: number[] | undefined;
  if (filtros.mesEntrega !== undefined) {
    const filas = await cliente.$queryRaw<{ id: number }[]>`
      SELECT id FROM ordenes
      WHERE id_empresa = ${sesion.idEmpresaActiva}
        AND fecha_entrega IS NOT NULL
        AND EXTRACT(MONTH FROM fecha_entrega) = ${filtros.mesEntrega}`;
    idsDelMes = filas.map((f) => f.id);
    if (idsDelMes.length === 0) {
      return paginaVacia(paginacion);
    }
  }

  // Costura vs aplicación se discrimina por `TipoProceso.generaEntradaPt` (ver encabezado).
  // Las condiciones compuestas van en un arreglo AND (varias generan su propio `OR`/`NOT` y un
  // spread plano las pisaría entre sí).
  const condiciones: Prisma.OrdenWhereInput[] = [];
  if (filtros.idMaquilero !== undefined) {
    condiciones.push({
      OR: [
        { idMaquilero: filtros.idMaquilero },
        {
          etapasMovimiento: {
            some: {
              tipo: 'envio_maquila',
              canceladoEn: null,
              idTercero: filtros.idMaquilero,
              tipoProceso: { generaEntradaPt: true },
            },
          },
        },
      ],
    });
  }
  if (filtros.idEstampador !== undefined) {
    condiciones.push({
      etapasMovimiento: {
        some: {
          tipo: 'envio_maquila',
          canceladoEn: null,
          idTercero: filtros.idEstampador,
          tipoProceso: { generaEntradaPt: false },
        },
      },
    });
  }
  if (filtros.ocTela !== undefined) {
    condiciones.push(filtros.ocTela === 'con' ? CONDICION_OC_TELA : { NOT: CONDICION_OC_TELA });
  }
  const busqueda = busquedaCentro(filtros.busqueda);
  if (busqueda.OR !== undefined) {
    condiciones.push(busqueda);
  }

  const where: Prisma.OrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.incluirCanceladas ? {} : { estado: { not: 'cancelada' } }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(idsDelMes === undefined ? {} : { id: { in: idsDelMes } }),
    ...(condiciones.length === 0 ? {} : { AND: condiciones }),
  };

  const [total, filas] = await Promise.all([
    cliente.orden.count({ where }),
    cliente.orden.findMany({
      where,
      orderBy: [{ [filtros.ordenarPor]: filtros.direccion }, { id: 'desc' }],
      select: {
        id: true,
        folio: true,
        estado: true,
        idEmpresa: true,
        empresa: { select: { nombre: true } },
        idModelo: true,
        modelo: {
          select: {
            codigo: true,
            descripcion: true,
            // Insumos de la regla de "orden completa" (`requisitos-orden.ts`): la bandera "lleva
            // arte" + la receta de avíos de producción y el arte del BOM. Dos conteos en la misma
            // consulta, sin traer las recetas.
            llevaArte: true,
            _count: { select: { avios: { where: { paraProduccion: true } }, artes: true } },
          },
        },
        // Renglones de la matriz: el requisito "tallas" es por RENGLONES, no por piezas (una
        // matriz capturada en ceros ya cuenta como capturada).
        _count: { select: { lineas: true } },
        idMaquilero: true,
        maquilero: { select: { nombre: true } },
        fechaEntrega: true,
        idCliente: true,
        cliente: { select: { nombre: true } },
        pedidoLinea: { select: { pedido: { select: { id: true, folio: true } } } },
        // Pedido del cliente (D7): la PRIMERA referencia capturada (el "monarch" del viejo).
        referencias: { orderBy: { id: 'asc' }, take: 1, select: { valor: true } },
      },
      ...rangoPrisma(paginacion),
    }),
  ]);

  const ids = filas.map((f) => f.id);

  // Agregados POR LOTE de la página (número fijo de viajes; jamás un await por fila).
  const [ordenadas, cortes, envios, lineasOcTela] = await Promise.all([
    totalesPorOrden(cliente, ids),
    ids.length === 0
      ? Promise.resolve([])
      : cliente.etapaMovimiento.findMany({
          where: { idOrden: { in: ids }, tipo: 'corte', canceladoEn: null },
          select: { idOrden: true, detalles: { select: { cantidad: true } } },
        }),
    ids.length === 0
      ? Promise.resolve([])
      : cliente.etapaMovimiento.findMany({
          where: { idOrden: { in: ids }, tipo: 'envio_maquila', canceladoEn: null },
          orderBy: { folio: 'asc' },
          select: {
            idOrden: true,
            idTercero: true,
            tercero: { select: { nombre: true } },
            tipoProceso: { select: { generaEntradaPt: true } },
          },
        }),
    ids.length === 0
      ? Promise.resolve([])
      : cliente.ordenCompraLinea.findMany({
          where: {
            idOrden: { in: ids },
            idTela: { not: null },
            ordenCompra: { estatus: { notIn: ['borrador', 'cancelada'] } },
          },
          orderBy: { idOrdenCompra: 'desc' },
          select: {
            idOrden: true,
            idOrdenCompra: true,
            ordenCompra: { select: { numCompra: true } },
          },
        }),
  ]);

  // Σ cortado por orden.
  const cortadaPorOrden = new Map<number, number>();
  for (const corte of cortes) {
    const suma = corte.detalles.reduce((s, d) => s + d.cantidad, 0);
    cortadaPorOrden.set(corte.idOrden, (cortadaPorOrden.get(corte.idOrden) ?? 0) + suma);
  }

  // Envíos vivos por orden: primer maquilero de costura + terceros distintos, primer aplicador.
  interface EnvioAgregado {
    maquilero: { id: number; nombre: string } | null;
    terceroSet: Set<number>;
    estampador: { id: number; nombre: string } | null;
  }
  const enviosPorOrden = new Map<number, EnvioAgregado>();
  for (const envio of envios) {
    if (envio.idTercero === null) continue;
    const agregado = enviosPorOrden.get(envio.idOrden) ?? {
      maquilero: null,
      terceroSet: new Set<number>(),
      estampador: null,
    };
    const esCostura = envio.tipoProceso?.generaEntradaPt === true;
    if (esCostura) {
      agregado.terceroSet.add(envio.idTercero);
      if (agregado.maquilero === null) {
        agregado.maquilero = { id: envio.idTercero, nombre: envio.tercero?.nombre ?? '' };
      }
    } else if (agregado.estampador === null) {
      agregado.estampador = { id: envio.idTercero, nombre: envio.tercero?.nombre ?? '' };
    }
    enviosPorOrden.set(envio.idOrden, agregado);
  }

  // OC de tela por orden: el orderBy desc deja PRIMERO la más reciente; solo se toma esa.
  const ocPorOrden = new Map<number, { id: number; folio: number }>();
  for (const linea of lineasOcTela) {
    if (linea.idOrden === null || ocPorOrden.has(linea.idOrden)) continue;
    ocPorOrden.set(linea.idOrden, {
      id: linea.idOrdenCompra,
      folio: Number(linea.ordenCompra.numCompra),
    });
  }

  const datos: OrdenCentroFila[] = filas.map((fila) => {
    const envio = enviosPorOrden.get(fila.id);
    const oc = ocPorOrden.get(fila.id);
    // Maquilero mostrado: al que SE MANDÓ (primer envío costura vivo); sin envíos, el asignado.
    const maquilero =
      envio?.maquilero ??
      (fila.idMaquilero === null || fila.maquilero === null
        ? null
        : { id: fila.idMaquilero, nombre: fila.maquilero.nombre });
    return {
      id: fila.id,
      folio: Number(fila.folio),
      estado: fila.estado,
      idEmpresa: fila.idEmpresa,
      empresa: fila.empresa.nombre,
      idModelo: fila.idModelo,
      codigoModelo: fila.modelo.codigo,
      descripcionModelo: fila.modelo.descripcion,
      pedidoCliente: fila.referencias[0]?.valor ?? null,
      cantOrdenada: ordenadas.get(fila.id) ?? 0,
      cantCortada: cortadaPorOrden.get(fila.id) ?? 0,
      idMaquilero: maquilero?.id ?? null,
      maquilero: maquilero?.nombre ?? null,
      numMaquileros: envio?.terceroSet.size ?? 0,
      idEstampador: envio?.estampador?.id ?? null,
      estampador: envio?.estampador?.nombre ?? null,
      idPedido: fila.pedidoLinea?.pedido.id ?? null,
      folioPedido: fila.pedidoLinea === null ? null : Number(fila.pedidoLinea.pedido.folio),
      idOcTela: oc?.id ?? null,
      ocTelaFolio: oc?.folio ?? null,
      fechaEntrega:
        fila.fechaEntrega === null ? null : fila.fechaEntrega.toISOString().slice(0, 10),
      mesEntrega: fila.fechaEntrega === null ? null : fila.fechaEntrega.getUTCMonth() + 1,
      idCliente: fila.idCliente,
      cliente: fila.cliente.nombre,
      // Transparencia del estado (Daniel 26-jul-2026): qué le falta para estar completa. Una
      // orden CANCELADA no "debe" nada (su estado no lo manda la regla), así que no lista nada.
      faltantes:
        fila.estado === 'cancelada'
          ? []
          : requisitosOrden({
              renglonesMatriz: fila._count.lineas,
              aviosProduccion: fila.modelo._count.avios,
              artesModelo: fila.modelo._count.artes,
              llevaArte: fila.modelo.llevaArte,
            }).faltantes,
    };
  });

  return armarPagina(datos, total, paginacion);
}
