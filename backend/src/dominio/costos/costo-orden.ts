/**
 * COSTO REAL por orden (F7-E1; doc 06-Costos-y-EDR §3; DECISIONES.md D1/D2). Toda la lógica vive AQUÍ
 * (A1); las rutas solo validan permiso + Zod y delegan.
 *
 * Dos juegos de componentes (doc 06 §3):
 *  • TEÓRICO (`*Calc`) — calculado en vivo de la receta `paraCosto` × precios VIGENTES (costo ACTUAL,
 *    D1), referido a las piezas CORTADAS (la producción):
 *      telaPorPrenda   = Σ ( ModeloTela.consumoPorPrenda × Tela.precioSugerido )   [paraCosto]
 *      aviosPorPrenda  = Σ ( ModeloAvio.consumoPorPrenda × Avio.precioReferencia ) [paraCosto]
 *      procesosPorPrenda = (maquilaOrd ?? modelo.maquilaBase) + (aplicacionOrd ?? 0) + Σ bordados
 *      tela/avios/procesos (TOTALES) = por-prenda × cortado
 *    La REGALÍA NO entra (D2): va sobre la venta (lista de precios).
 *  • GUARDADO (`*Cost`) — lo que el usuario confirma o AJUSTA; `costoTotal` = Σ de los GUARDADOS
 *    (`telaCost + procesosCost + aviosCost + otros`). Es el dinero REAL.
 *
 * Costo unitario = `costoTotal` ÷ base de prorrateo (D2; default `cortado` = piezas cortadas). Cambiar
 * la base cambia el unitario porque el total es fijo y el divisor varía.
 *
 * Innegociables: A1, A2 (guardar es transacción), A4 (`costos.ver`/`costos.capturar`), A7 (Bitácora,
 * módulo financiero), A9 (empresa activa). Importes en `null` sin `consultas.ver-importes`. Una orden
 * marcada `noCostear` NO se puede costear (se rechaza con mensaje claro).
 */
import type {
  CostoOrdenGuardarCuerpo,
  CostoOrdenSalida,
  ListaCostosPagina,
  ListaCostosQuery,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import { esquemaCostoOrdenGuardarCuerpo, esquemaListaCostosQuery } from '../../contrato/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { armarBusqueda } from '../produccion/ordenes.js';

import {
  cantidadDeBase,
  cantidadesDeOrden,
  cantidadesDeOrdenes,
  type CantidadesOrden,
} from './cantidades.js';

/** Cliente de LECTURA. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Nº de un `Decimal` opcional (null → 0). */
function num(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : d.toNumber();
}

/** `select` de la orden con su receta paraCosto (precios vigentes) y su costo guardado. */
const seleccionOrdenCosto = {
  id: true,
  folio: true,
  idEmpresa: true,
  idModelo: true,
  idCliente: true,
  noCostear: true,
  maquilaOrd: true,
  aplicacionOrd: true,
  cliente: { select: { nombre: true } },
  modelo: {
    select: {
      codigo: true,
      descripcion: true,
      maquilaBase: true,
      telas: {
        where: { paraCosto: true },
        select: { consumoPorPrenda: true, tela: { select: { precioSugerido: true } } },
      },
      avios: {
        where: { paraCosto: true },
        select: { consumoPorPrenda: true, avio: { select: { precioReferencia: true } } },
      },
      bordados: { select: { precio: true, bordado: { select: { precio: true } } } },
    },
  },
  costoOrden: true,
} satisfies Prisma.OrdenSelect;

type OrdenConCosto = Prisma.OrdenGetPayload<{ select: typeof seleccionOrdenCosto }>;

/** Costo TEÓRICO por prenda (los tres componentes), determinista sobre la receta paraCosto. */
export interface TeoricoPorPrenda {
  tela: number;
  avios: number;
  procesos: number;
}

/** Calcula el costo teórico POR PRENDA de una orden (receta × precios vigentes + procesos). */
export function teoricoPorPrenda(orden: OrdenConCosto): TeoricoPorPrenda {
  const tela = orden.modelo.telas.reduce(
    (s, t) => s + num(t.consumoPorPrenda) * num(t.tela.precioSugerido),
    0,
  );
  const avios = orden.modelo.avios.reduce(
    (s, a) => s + num(a.consumoPorPrenda) * num(a.avio.precioReferencia),
    0,
  );
  const bordado = orden.modelo.bordados.reduce(
    (s, b) => s + (b.precio == null ? num(b.bordado.precio) : b.precio.toNumber()),
    0,
  );
  // Maquila de la ORDEN (fallback a la base del modelo) + estampado/aplicación + bordados.
  const maquila =
    orden.maquilaOrd == null ? num(orden.modelo.maquilaBase) : orden.maquilaOrd.toNumber();
  const aplicacion = num(orden.aplicacionOrd);
  const procesos = maquila + aplicacion + bordado;
  return { tela, avios, procesos };
}

/** Proyecta una orden + sus cantidades + su costo a la forma del contrato (ocultando importes). */
function aCostoOrdenSalida(
  orden: OrdenConCosto,
  cant: CantidadesOrden,
  verImportes: boolean,
): CostoOrdenSalida {
  // Sin `consultas.ver-importes` TODO importe va a null; con él se redondea (o null si es nulo real).
  const money = (v: number | null): number | null =>
    verImportes ? (v === null ? null : redondear2(v)) : null;

  const pp = teoricoPorPrenda(orden);
  const cortado = cant.cortado;
  const teoTela = pp.tela * cortado;
  const teoAvios = pp.avios * cortado;
  const teoProcesos = pp.procesos * cortado;
  const teoTotal = teoTela + teoAvios + teoProcesos;

  const g = orden.costoOrden;
  const guardado = g
    ? {
        telaCalc: money(g.telaCalc == null ? null : g.telaCalc.toNumber()),
        telaCost: money(g.telaCost == null ? null : g.telaCost.toNumber()),
        procesosCalc: money(g.procesosCalc == null ? null : g.procesosCalc.toNumber()),
        procesosCost: money(g.procesosCost == null ? null : g.procesosCost.toNumber()),
        aviosCalc: money(g.aviosCalc == null ? null : g.aviosCalc.toNumber()),
        aviosCost: money(g.aviosCost == null ? null : g.aviosCost.toNumber()),
        otros: money(g.otros == null ? null : g.otros.toNumber()),
        descOtros: g.descOtros,
        costoTotal: money(g.costoTotal == null ? null : g.costoTotal.toNumber()),
        baseProrrateo: g.baseProrrateo,
        observaciones: g.observaciones,
        creadoEn: g.creadoEn.toISOString(),
        modificadoEn: g.modificadoEn.toISOString(),
      }
    : null;

  // Costo unitario: del guardado (total ÷ base guardada) o, si aún no se costea, del teórico ÷ cortado.
  const base = g ? g.baseProrrateo : 'cortado';
  const cantidadBase = cantidadDeBase(cant, base);
  const totalParaUnit = g ? (g.costoTotal == null ? null : g.costoTotal.toNumber()) : teoTotal;
  const unitarioCrudo =
    totalParaUnit === null || cantidadBase <= 0 ? null : totalParaUnit / cantidadBase;

  return {
    idOrden: orden.id,
    folio: Number(orden.folio),
    idModelo: orden.idModelo,
    codigoModelo: orden.modelo.codigo,
    descripcionModelo: orden.modelo.descripcion,
    idCliente: orden.idCliente,
    cliente: orden.cliente.nombre,
    noCostear: orden.noCostear,
    cantidades: {
      pedido: cant.pedido,
      cortado: cant.cortado,
      recibido: cant.recibido,
      vendido: cant.vendido,
    },
    teorico: {
      telaPorPrenda: money(pp.tela),
      aviosPorPrenda: money(pp.avios),
      procesosPorPrenda: money(pp.procesos),
      tela: money(teoTela),
      avios: money(teoAvios),
      procesos: money(teoProcesos),
      total: money(teoTotal),
    },
    guardado,
    unitario: {
      base,
      cantidadBase,
      costoUnitario: money(unitarioCrudo),
    },
  };
}

/** Obtiene una orden de la empresa activa con su receta+costo, o lanza `ErrorNoEncontrado`. */
async function ordenConCosto(
  sesion: SesionUsuario,
  idOrden: number,
  cliente: ClienteLectura,
): Promise<OrdenConCosto> {
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: seleccionOrdenCosto,
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return orden;
}

/**
 * COSTO de una orden (A4 `costos.ver`, A9): el teórico en vivo + el guardado (o null) + las
 * cantidades derivadas + el costo unitario. Importes en `null` sin `consultas.ver-importes`.
 */
export async function obtenerCostoOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<CostoOrdenSalida> {
  verificarPermiso(sesion, 'costos.ver');
  const cliente = clienteLectura(bd);
  const orden = await ordenConCosto(sesion, idOrden, cliente);
  const cant = await cantidadesDeOrden(idOrden, bd);
  return aCostoOrdenSalida(orden, cant, tienePermiso(sesion, 'consultas.ver-importes'));
}

/**
 * GUARDA (crea o ajusta) el costo de una orden (A4 `costos.capturar`, A2 transacción, A7 Bitácora).
 * Congela el TEÓRICO al momento (`*Calc`), toma los GUARDADOS del cuerpo (los que no vengan caen al
 * teórico), arma `costoTotal` = Σ guardados y persiste. RECHAZA si la orden está marcada `noCostear`.
 */
export async function guardarCostoOrden(
  sesion: SesionUsuario,
  idOrden: number,
  cuerpo: z.input<typeof esquemaCostoOrdenGuardarCuerpo>,
  bd?: ContextoBd,
): Promise<CostoOrdenSalida> {
  verificarPermiso(sesion, 'costos.capturar');
  const datos: CostoOrdenGuardarCuerpo = validarEntrada(esquemaCostoOrdenGuardarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
      select: seleccionOrdenCosto,
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }
    if (orden.noCostear) {
      throw new ErrorConflicto(
        'Esta orden está marcada como "no costear": no se puede capturar su costo.',
      );
    }

    // Teórico congelado (× cortado) al momento de guardar (usa la MISMA transacción, A2).
    const cant = await cantidadesDeOrden(idOrden, { tx });
    const pp = teoricoPorPrenda(orden);
    const telaCalc = redondear2(pp.tela * cant.cortado);
    const procesosCalc = redondear2(pp.procesos * cant.cortado);
    const aviosCalc = redondear2(pp.avios * cant.cortado);

    // Guardados: los del cuerpo; si un componente no vino (undefined), cae al teórico congelado.
    const telaCost = datos.telaCost === undefined ? telaCalc : datos.telaCost;
    const procesosCost = datos.procesosCost === undefined ? procesosCalc : datos.procesosCost;
    const aviosCost = datos.aviosCost === undefined ? aviosCalc : datos.aviosCost;
    const otros = datos.otros ?? null;

    const costoTotal = redondear2(
      (telaCost ?? 0) + (procesosCost ?? 0) + (aviosCost ?? 0) + (otros ?? 0),
    );

    const comunes = {
      telaCalc: new Prisma.Decimal(telaCalc),
      procesosCalc: new Prisma.Decimal(procesosCalc),
      aviosCalc: new Prisma.Decimal(aviosCalc),
      telaCost: telaCost === null ? null : new Prisma.Decimal(telaCost),
      procesosCost: procesosCost === null ? null : new Prisma.Decimal(procesosCost),
      aviosCost: aviosCost === null ? null : new Prisma.Decimal(aviosCost),
      otros: otros === null ? null : new Prisma.Decimal(otros),
      descOtros: datos.descOtros ?? null,
      costoTotal: new Prisma.Decimal(costoTotal),
      baseProrrateo: datos.baseProrrateo,
      observaciones: datos.observaciones ?? null,
    };

    const yaExiste = orden.costoOrden !== null;
    await tx.costoOrden.upsert({
      where: { idOrden },
      create: {
        idOrden,
        idEmpresa: orden.idEmpresa,
        ...comunes,
        ...datosCreacion(sesion),
      },
      update: { ...comunes, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'CostoOrden',
      idEntidad: idOrden,
      accion: yaExiste ? 'MODIFICAR' : 'CREAR',
      datos: {
        telaCost,
        procesosCost,
        aviosCost,
        otros,
        costoTotal,
        baseProrrateo: datos.baseProrrateo,
      },
    });
  }, bd);

  return obtenerCostoOrden(sesion, idOrden, bd);
}

/**
 * LISTA DE COSTOS (ex `ListaCostos`): órdenes YA costeadas de la empresa activa (A9), con su costo
 * total y unitario. Filtros por modelo/cliente + búsqueda (folio/modelo/cliente/referencia D7). Solo
 * lectura (`costos.ver`). Importes en `null` sin `consultas.ver-importes`. Paginación de SERVIDOR.
 */
export async function listarCostos(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaListaCostosQuery> = {},
  bd?: ContextoBd,
): Promise<ListaCostosPagina> {
  verificarPermiso(sesion, 'costos.ver');
  const filtros: ListaCostosQuery = validarEntrada(esquemaListaCostosQuery, parametros);
  const cliente = clienteLectura(bd);
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const where: Prisma.CostoOrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    orden: {
      ...(filtros.idModelo === undefined ? {} : { idModelo: filtros.idModelo }),
      ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
      ...armarBusqueda(filtros.busqueda),
    },
  };

  const orderBy: Prisma.CostoOrdenOrderByWithRelationInput =
    filtros.ordenarPor === 'costoTotal'
      ? { costoTotal: filtros.direccion }
      : filtros.ordenarPor === 'fecha'
        ? { orden: { fecha: filtros.direccion } }
        : { orden: { folio: filtros.direccion } };

  const [total, filas] = await Promise.all([
    cliente.costoOrden.count({ where }),
    cliente.costoOrden.findMany({
      where,
      orderBy,
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
      select: {
        idOrden: true,
        costoTotal: true,
        baseProrrateo: true,
        orden: {
          select: {
            folio: true,
            fecha: true,
            idModelo: true,
            modelo: { select: { codigo: true } },
            idCliente: true,
            cliente: { select: { nombre: true } },
          },
        },
      },
    }),
  ]);

  const cant = await cantidadesDeOrdenes(
    filas.map((f) => f.idOrden),
    bd,
  );
  const money = (v: number | null): number | null =>
    verImportes ? (v === null ? null : redondear2(v)) : null;

  const datos = filas.map((f) => {
    const c = cant.get(f.idOrden) ?? { pedido: 0, cortado: 0, recibido: 0, vendido: 0 };
    const cantidadBase = cantidadDeBase(c, f.baseProrrateo);
    const total = f.costoTotal == null ? null : f.costoTotal.toNumber();
    const unit = total === null || cantidadBase <= 0 ? null : total / cantidadBase;
    return {
      idOrden: f.idOrden,
      folio: Number(f.orden.folio),
      idModelo: f.orden.idModelo,
      codigoModelo: f.orden.modelo.codigo,
      idCliente: f.orden.idCliente,
      cliente: f.orden.cliente.nombre,
      fecha: f.orden.fecha === null ? null : f.orden.fecha.toISOString().slice(0, 10),
      cortado: c.cortado,
      costoTotal: money(total),
      costoUnitario: money(unit),
      baseProrrateo: f.baseProrrateo,
    };
  });

  return {
    datos,
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}
