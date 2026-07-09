/**
 * ESTADO DE RESULTADOS (EDR — Módulo 6, F7-E2; doc `06-Costos-y-EDR.md` §4 y §7.4; DECISIONES.md
 * D1/D2). Toda la lógica vive AQUÍ (A1); las rutas solo validan permiso + Zod y delegan.
 *
 * El EDR es el P&L MENSUAL, GENERADO automáticamente y valuado SIEMPRE a COSTO ACTUAL (D1): el costo
 * NUNCA se congela en la línea; se recalcula desde `CostoOrden` al leer. La columna `costoHistorico`
 * es solo-informativa (la llena el ETL de E6, doc 06 §7.4).
 *
 * ⚠️ CONSOLIDADO, no por empresa activa: a diferencia de casi todo el sistema, el EDR NO se acota a
 * `sesion.idEmpresaActiva`. El encabezado `Edr` es GLOBAL por mes; abarca TODAS las empresas con
 * `Empresa.paraEdr = true` y los cortes por empresa/cliente se DERIVAN de las líneas (D2 #6). Se
 * EXCLUYEN las órdenes `noCostear = true`. Los gastos/intereses/bonificaciones/otros son GLOBALES del
 * mes (no hay tabla de gastos por empresa, D2 #6).
 *
 * Ventas desde la FACTURACIÓN real (D2 #5): el precio manda de lo facturado. Como Finanzas/CFDI aún
 * no existe, `generarEdrMes` PRE-PROPONE las líneas desde las ENTREGAS A CLIENTE del mes (F3, comodín)
 * y el usuario AJUSTA el precio a lo realmente facturado. Fórmula del resultado (doc 06 §4):
 *   Resultado = Ventas − Costo − Gastos − Intereses + Bonificaciones + Otros   (Bonificaciones SUMA)
 *
 * Innegociables: A1 (lógica aquí), A2 (generar/ajustar en transacción), A4 (`edr.ver`/`edr.capturar`),
 * A7 (Bitácora, módulo financiero). NO se ocultan importes por `consultas.ver-importes`: todo el EDR
 * es financiero, se protege entero con `edr.ver`.
 */
import {
  esquemaEdrGenerarCuerpo,
  esquemaEdrEncabezadoCuerpo,
  esquemaEdrLineaAjustarCuerpo,
  esquemaEdrLineaManualCuerpo,
  esquemaEdrLineasQuery,
  esquemaEdrPorMesQuery,
  esquemaEdrPorAnioQuery,
  type EdrCalculado,
  type EdrCorteSalida,
  type EdrLineaSalida,
  type EdrLineasSalida,
  type EdrPorAnioSalida,
  type EdrPorMesSalida,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { cantidadDeBase, cantidadesDeOrdenes, cantidadesVacias } from '../costos/cantidades.js';

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Nº de un `Decimal` (null → 0). */
function num(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : d.toNumber();
}

/** Totales que alimentan la fórmula del resultado. */
export interface TotalesEdr {
  ventas: number;
  costo: number;
  gastos: number;
  intereses: number;
  bonificaciones: number;
  otros: number;
}

/**
 * Fórmula LEGACY del resultado del EDR (doc 06-Costos-y-EDR §4, consulta `EdoResultTotales`):
 *   Resultado = Ventas − Costo − Gastos − Intereses + Bonificaciones + Otros
 * Bonificaciones SUMA; Otros es SIGNADO (± al resultado). Pura (sin BD) para poder unit-testearla.
 */
export function resultadoEdr(t: TotalesEdr): number {
  return redondear2(t.ventas - t.costo - t.gastos - t.intereses + t.bonificaciones + t.otros);
}

// ── Fuente de ventas: entregas a cliente del mes ──────────────────────────────────────────────────

/** Una venta agregada por orden en el mes (fuente de una línea `automatica`). */
interface FilaVenta {
  idOrden: number;
  idEmpresa: number;
  idModelo: number;
  idCliente: number;
  precio: number;
  cantVendida: number;
}

/**
 * VENTAS del mes = Σ de las etapas `entrega_cliente` VIVAS (canceladas fuera), por orden, SOLO de
 * empresas `paraEdr=true` y órdenes `noCostear=false` (doc 06 §4, D1/D2). El `precio` inicial es el
 * del renglón de pedido (`Orden.idPedidoLinea → PedidoLinea.precio`, puede ser NULL → 0; el usuario lo
 * ajusta a lo facturado). Filtro por mes con EXTRACT (mismo criterio que `margenes.ts`, sin ambigüedad
 * de zona horaria). SQL agregado (permitido para reportes) — NUNCA N+1.
 */
async function ventasDelMes(tx: Tx, anio: number, mes: number): Promise<FilaVenta[]> {
  return tx.$queryRaw<FilaVenta[]>(Prisma.sql`
    SELECT o."id"                         AS "idOrden",
           o."id_empresa"                 AS "idEmpresa",
           o."id_modelo"                  AS "idModelo",
           o."id_cliente"                 AS "idCliente",
           COALESCE(pl."precio", 0)::float8 AS "precio",
           COALESCE(SUM(d."cantidad"), 0)::int AS "cantVendida"
    FROM "etapa_movimiento" e
    JOIN "ordenes" o        ON o."id" = e."id_orden"
    JOIN "empresas" emp     ON emp."id" = o."id_empresa"
    LEFT JOIN "pedido_linea" pl ON pl."id" = o."id_pedido_linea"
    JOIN "etapa_movimiento_det" d ON d."id_etapa_mov" = e."id"
    WHERE e."tipo" = 'entrega_cliente'
      AND e."cancelado_en" IS NULL
      AND EXTRACT(YEAR FROM e."fecha") = ${anio}
      AND EXTRACT(MONTH FROM e."fecha") = ${mes}
      AND o."no_costear" = FALSE
      AND emp."para_edr" = TRUE
    GROUP BY o."id", o."id_empresa", o."id_modelo", o."id_cliente", pl."precio"
    HAVING COALESCE(SUM(d."cantidad"), 0) > 0
  `);
}

// ── Costo ACTUAL por línea ─────────────────────────────────────────────────────────────────────────

/** Costo actual de una línea (unitario + total; `sinCosto` marca las que hay que revisar). */
interface CostoLinea {
  costoUnit: number | null;
  costoActual: number;
  sinCosto: boolean;
}

/** Línea mínima que necesita el cálculo de costo. */
interface LineaParaCosto {
  id: number;
  idOrden: number | null;
  cantVendida: number;
}

/**
 * Calcula el COSTO ACTUAL (D1) de un conjunto de líneas en pocas consultas (no N+1): el costo unitario
 * de una orden = `CostoOrden.costoTotal ÷ cantidadDeBase(cantidades, base)` (base guardada en el costo,
 * default `cortado`), y el de la línea = unitario × cantVendida. Las líneas SIN orden, sin `CostoOrden`,
 * sin `costoTotal` o con base 0 quedan `sinCosto` (costo 0) para que el usuario las revise.
 */
async function costoActualPorLinea(
  lineas: LineaParaCosto[],
  bd?: ContextoBd,
): Promise<Map<number, CostoLinea>> {
  const resultado = new Map<number, CostoLinea>();
  const idsOrden = [
    ...new Set(lineas.filter((l) => l.idOrden !== null).map((l) => l.idOrden as number)),
  ];
  const cant = await cantidadesDeOrdenes(idsOrden, bd);
  const cliente = clienteLectura(bd);
  const costos =
    idsOrden.length === 0
      ? []
      : await cliente.costoOrden.findMany({
          where: { idOrden: { in: idsOrden } },
          select: { idOrden: true, costoTotal: true, baseProrrateo: true },
        });
  const costoPorOrden = new Map(costos.map((c) => [c.idOrden, c]));

  const sinCosto = (id: number): void => {
    resultado.set(id, { costoUnit: null, costoActual: 0, sinCosto: true });
  };

  for (const l of lineas) {
    if (l.idOrden === null) {
      sinCosto(l.id);
      continue;
    }
    const co = costoPorOrden.get(l.idOrden);
    if (co === undefined || co.costoTotal === null) {
      sinCosto(l.id);
      continue;
    }
    const base = cantidadDeBase(cant.get(l.idOrden) ?? cantidadesVacias(), co.baseProrrateo);
    if (base <= 0) {
      sinCosto(l.id);
      continue;
    }
    const costoUnit = redondear2(co.costoTotal.toNumber() / base);
    resultado.set(l.id, {
      costoUnit,
      costoActual: redondear2(costoUnit * l.cantVendida),
      sinCosto: false,
    });
  }
  return resultado;
}

// ── Proyección de una línea ─────────────────────────────────────────────────────────────────────────

/** `include` para proyectar una línea del EDR con sus nombres legibles. */
const incluirLinea = {
  empresa: { select: { nombre: true } },
  cliente: { select: { nombre: true } },
  modelo: { select: { codigo: true } },
  orden: { select: { folio: true } },
} satisfies Prisma.EdrLineaInclude;

type LineaConNombres = Prisma.EdrLineaGetPayload<{ include: typeof incluirLinea }>;

/** Proyecta una línea (con nombres + costo actual) a la forma del contrato. */
function aLineaSalida(l: LineaConNombres, costo: CostoLinea): EdrLineaSalida {
  return {
    id: l.id,
    idEdr: l.idEdr,
    idOrden: l.idOrden,
    folioOrden: l.orden === null ? null : Number(l.orden.folio),
    idEmpresa: l.idEmpresa,
    empresa: l.empresa.nombre,
    idCliente: l.idCliente,
    cliente: l.cliente?.nombre ?? null,
    idModelo: l.idModelo,
    modelo: l.modelo?.codigo ?? null,
    descripcion: l.descripcion,
    cantVendida: l.cantVendida,
    precioVenta: num(l.precioVenta),
    importe: redondear2(num(l.precioVenta) * l.cantVendida),
    costoUnitActual: costo.costoUnit,
    costoActual: costo.costoActual,
    sinCosto: costo.sinCosto,
    costoHistorico: l.costoHistorico === null ? null : num(l.costoHistorico),
    origen: l.origen,
  };
}

// ── GENERAR / RECONCILIAR el mes ─────────────────────────────────────────────────────────────────────

/**
 * GENERA (o RE-GENERA) el EDR de un mes (A4 `edr.capturar`, A2 transacción, A7 Bitácora). IDEMPOTENTE
 * y re-ejecutable: crea el encabezado `Edr(anio,mes)` si no existe (nunca pisa sus gastos) y RECONCILIA
 * las líneas contra las entregas actuales:
 *  • las líneas `automatica` se re-proponen: se ACTUALIZAN las de órdenes que siguen con ventas, se
 *    CREAN las nuevas y se ELIMINAN las HUÉRFANAS (órdenes cuyas entregas ya no existen/se cancelaron);
 *  • las líneas `ajustada` y `manual` NUNCA se tocan ni se borran.
 * Escritura por LOTES (createMany/deleteMany); las actualizaciones son de la intersección acotada (las
 * órdenes del mes que ya tenían línea automática). Devuelve el EDR calculado.
 */
export async function generarEdrMes(
  sesion: SesionUsuario,
  anioIn: number,
  mesIn: number,
  bd?: ContextoBd,
): Promise<EdrCalculado> {
  verificarPermiso(sesion, 'edr.capturar');
  const { anio, mes } = validarEntrada(esquemaEdrGenerarCuerpo, { anio: anioIn, mes: mesIn });

  const idEdr = await enTransaccion(async (tx) => {
    // Encabezado del mes: crea si no existe, sin pisar sus gastos al re-generar (solo toca auditoría).
    const edr = await tx.edr.upsert({
      where: { anio_mes: { anio, mes } },
      create: { anio, mes, ...datosCreacion(sesion) },
      update: { ...datosModificacion(sesion) },
      select: { id: true },
    });

    const fuente = await ventasDelMes(tx, anio, mes);

    // Líneas existentes: respeta ajustada/manual; reconcilia las automáticas.
    const existentes = await tx.edrLinea.findMany({
      where: { idEdr: edr.id },
      select: { id: true, idOrden: true, origen: true },
    });
    const ordenesProtegidas = new Set<number>(); // órdenes con línea ajustada (no tocar)
    const automaticaPorOrden = new Map<number, number>(); // idOrden → idLínea automática
    for (const l of existentes) {
      if (l.idOrden === null) continue; // manuales (idOrden NULL): no chocan con la fuente
      if (l.origen === 'automatica') automaticaPorOrden.set(l.idOrden, l.id);
      else ordenesProtegidas.add(l.idOrden); // ajustada
    }

    const aCrear: FilaVenta[] = [];
    const aActualizar: { id: number; v: FilaVenta }[] = [];
    const ordenesFuente = new Set<number>();
    for (const v of fuente) {
      ordenesFuente.add(v.idOrden);
      if (ordenesProtegidas.has(v.idOrden)) continue; // el usuario ya la ajustó: intacta
      const idLineaAuto = automaticaPorOrden.get(v.idOrden);
      if (idLineaAuto === undefined) aCrear.push(v);
      else aActualizar.push({ id: idLineaAuto, v });
    }
    // Automáticas huérfanas: su orden ya no vende en el mes → se eliminan.
    const idsHuerfanas: number[] = [];
    for (const [idOrden, idLinea] of automaticaPorOrden) {
      if (!ordenesFuente.has(idOrden)) idsHuerfanas.push(idLinea);
    }

    if (idsHuerfanas.length > 0) {
      await tx.edrLinea.deleteMany({ where: { id: { in: idsHuerfanas } } });
    }
    if (aCrear.length > 0) {
      await tx.edrLinea.createMany({
        data: aCrear.map((v) => ({
          idEdr: edr.id,
          idOrden: v.idOrden,
          idEmpresa: v.idEmpresa,
          idCliente: v.idCliente,
          idModelo: v.idModelo,
          cantVendida: v.cantVendida,
          precioVenta: new Prisma.Decimal(v.precio),
          origen: 'automatica' as const,
          ...datosCreacion(sesion),
        })),
      });
    }
    // Actualización de la intersección (órdenes del mes con línea automática previa). El costo NUNCA
    // se guarda aquí (D1); el precio se refresca al del pedido (la línea aún no fue ajustada).
    for (const { id, v } of aActualizar) {
      await tx.edrLinea.update({
        where: { id },
        data: {
          idEmpresa: v.idEmpresa,
          idCliente: v.idCliente,
          idModelo: v.idModelo,
          cantVendida: v.cantVendida,
          precioVenta: new Prisma.Decimal(v.precio),
          ...datosModificacion(sesion),
        },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Edr',
      idEntidad: edr.id,
      accion: existentes.length === 0 ? 'CREAR' : 'MODIFICAR',
      datos: {
        anio,
        mes,
        creadas: aCrear.length,
        actualizadas: aActualizar.length,
        eliminadas: idsHuerfanas.length,
      },
    });

    return edr.id;
  }, bd);

  return calcularEdr(sesion, idEdr, bd);
}

// ── CALCULAR (leer con costo actual + cortes) ─────────────────────────────────────────────────────────

/** Suma acumulada de un corte (empresa o cliente). */
interface AcumCorte {
  nombre: string;
  ventas: number;
  costo: number;
}

/** Ordena y redondea un mapa de cortes a la forma del contrato. */
function cortesSalida(mapa: Map<number, AcumCorte>): EdrCorteSalida[] {
  return [...mapa.entries()]
    .map(([id, a]) => ({
      id,
      nombre: a.nombre,
      ventas: redondear2(a.ventas),
      costo: redondear2(a.costo),
      utilidadBruta: redondear2(a.ventas - a.costo),
    }))
    .sort((a, b) => b.ventas - a.ventas || a.nombre.localeCompare(b.nombre));
}

/**
 * EDR CALCULADO de un mes (A4 `edr.ver`): encabezado + totales a COSTO ACTUAL (D1) + cortes por empresa
 * y por cliente derivados de las líneas. `resultado` con la fórmula legacy (Bonificaciones SUMA).
 */
export async function calcularEdr(
  sesion: SesionUsuario,
  idEdr: number,
  bd?: ContextoBd,
): Promise<EdrCalculado> {
  verificarPermiso(sesion, 'edr.ver');
  const cliente = clienteLectura(bd);
  const edr = await cliente.edr.findUnique({ where: { id: idEdr } });
  if (edr === null) {
    throw new ErrorNoEncontrado('Edr', idEdr);
  }

  const lineas = await cliente.edrLinea.findMany({
    where: { idEdr },
    include: incluirLinea,
    orderBy: [{ idEmpresa: 'asc' }, { idCliente: 'asc' }, { id: 'asc' }],
  });
  const costos = await costoActualPorLinea(lineas, bd);

  let ventas = 0;
  let costo = 0;
  let piezas = 0;
  let lineasSinCosto = 0;
  const porEmpresa = new Map<number, AcumCorte>();
  const porCliente = new Map<number, AcumCorte>();

  for (const l of lineas) {
    const c = costos.get(l.id) ?? { costoUnit: null, costoActual: 0, sinCosto: true };
    const importe = num(l.precioVenta) * l.cantVendida;
    ventas += importe;
    costo += c.costoActual;
    piezas += l.cantVendida;
    if (c.sinCosto) lineasSinCosto += 1;

    const e = porEmpresa.get(l.idEmpresa) ?? { nombre: l.empresa.nombre, ventas: 0, costo: 0 };
    e.ventas += importe;
    e.costo += c.costoActual;
    porEmpresa.set(l.idEmpresa, e);

    if (l.idCliente !== null) {
      const cl = porCliente.get(l.idCliente) ?? {
        nombre: l.cliente?.nombre ?? `Cliente ${l.idCliente}`,
        ventas: 0,
        costo: 0,
      };
      cl.ventas += importe;
      cl.costo += c.costoActual;
      porCliente.set(l.idCliente, cl);
    }
  }

  ventas = redondear2(ventas);
  costo = redondear2(costo);
  const gastos = num(edr.gastos);
  const intereses = num(edr.intereses);
  const bonificaciones = num(edr.bonificaciones);
  const otros = num(edr.otros);
  const resultado = resultadoEdr({ ventas, costo, gastos, intereses, bonificaciones, otros });

  return {
    encabezado: aEncabezadoSalida(edr),
    ventas,
    costo,
    utilidadBruta: redondear2(ventas - costo),
    gastos,
    intereses,
    bonificaciones,
    otros,
    resultado,
    totalPiezas: piezas,
    totalLineas: lineas.length,
    lineasSinCosto,
    cortesEmpresa: cortesSalida(porEmpresa),
    cortesCliente: cortesSalida(porCliente),
  };
}

/** Proyecta el encabezado de un `Edr` a la forma del contrato. */
function aEncabezadoSalida(edr: {
  id: number;
  anio: number;
  mes: number;
  gastos: Prisma.Decimal;
  intereses: Prisma.Decimal;
  bonificaciones: Prisma.Decimal;
  otros: Prisma.Decimal;
  descOtros: string | null;
  observaciones: string | null;
  creadoEn: Date;
  modificadoEn: Date;
}): EdrCalculado['encabezado'] {
  return {
    id: edr.id,
    anio: edr.anio,
    mes: edr.mes,
    gastos: num(edr.gastos),
    intereses: num(edr.intereses),
    bonificaciones: num(edr.bonificaciones),
    otros: num(edr.otros),
    descOtros: edr.descOtros,
    observaciones: edr.observaciones,
    creadoEn: edr.creadoEn.toISOString(),
    modificadoEn: edr.modificadoEn.toISOString(),
  };
}

// ── CONSULTAS: conciliación de líneas + por mes + por año ─────────────────────────────────────────────

/**
 * CONCILIACIÓN: las líneas del EDR de un mes con su costo ACTUAL, filtrables por empresa/cliente/modelo/
 * origen (A4 `edr.ver`). Ordenadas de forma determinista (empresa→cliente→id). El costo se recalcula
 * (D1); las líneas `sinCosto` quedan marcadas para revisión.
 */
export async function listarLineasEdr(
  sesion: SesionUsuario,
  idEdr: number,
  parametros: z.input<typeof esquemaEdrLineasQuery> = {},
  bd?: ContextoBd,
): Promise<EdrLineasSalida> {
  verificarPermiso(sesion, 'edr.ver');
  const filtros = validarEntrada(esquemaEdrLineasQuery, parametros);
  const cliente = clienteLectura(bd);

  const edr = await cliente.edr.findUnique({
    where: { id: idEdr },
    select: { id: true, anio: true, mes: true },
  });
  if (edr === null) {
    throw new ErrorNoEncontrado('Edr', idEdr);
  }

  const where: Prisma.EdrLineaWhereInput = {
    idEdr,
    ...(filtros.idEmpresa === undefined ? {} : { idEmpresa: filtros.idEmpresa }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(filtros.idModelo === undefined ? {} : { idModelo: filtros.idModelo }),
    ...(filtros.origen === undefined ? {} : { origen: filtros.origen }),
  };

  const lineas = await cliente.edrLinea.findMany({
    where,
    include: incluirLinea,
    orderBy: [{ idEmpresa: 'asc' }, { idCliente: 'asc' }, { id: 'asc' }],
  });
  const costos = await costoActualPorLinea(lineas, bd);

  const salida = lineas.map((l) =>
    aLineaSalida(l, costos.get(l.id) ?? { costoUnit: null, costoActual: 0, sinCosto: true }),
  );
  const totalVentas = redondear2(salida.reduce((s, l) => s + l.importe, 0));
  const totalCosto = redondear2(salida.reduce((s, l) => s + l.costoActual, 0));
  const totalPiezas = salida.reduce((s, l) => s + l.cantVendida, 0);

  return {
    idEdr: edr.id,
    anio: edr.anio,
    mes: edr.mes,
    lineas: salida,
    totalPiezas,
    totalVentas,
    totalCosto,
  };
}

/** EDR de un mes (o `existe:false` si aún no se generó). A4 `edr.ver`. */
export async function edrPorMes(
  sesion: SesionUsuario,
  anioIn: number,
  mesIn: number,
  bd?: ContextoBd,
): Promise<EdrPorMesSalida> {
  verificarPermiso(sesion, 'edr.ver');
  const { anio, mes } = validarEntrada(esquemaEdrPorMesQuery, { anio: anioIn, mes: mesIn });
  const cliente = clienteLectura(bd);
  const edr = await cliente.edr.findUnique({
    where: { anio_mes: { anio, mes } },
    select: { id: true },
  });
  if (edr === null) {
    return { existe: false, anio, mes, edr: null };
  }
  return { existe: true, anio, mes, edr: await calcularEdr(sesion, edr.id, bd) };
}

/**
 * COMPARATIVO ANUAL del EDR (A4 `edr.ver`): los meses del año ya generados con su ventas/costo/resultado
 * (a costo ACTUAL, D1) + el corte por empresa del año. Calcula el costo de TODAS las líneas del año en
 * UN lote (no N+1 por mes).
 */
export async function edrPorAnio(
  sesion: SesionUsuario,
  anioIn: number,
  bd?: ContextoBd,
): Promise<EdrPorAnioSalida> {
  verificarPermiso(sesion, 'edr.ver');
  const { anio } = validarEntrada(esquemaEdrPorAnioQuery, { anio: anioIn });
  const cliente = clienteLectura(bd);

  const edrs = await cliente.edr.findMany({ where: { anio }, orderBy: { mes: 'asc' } });
  if (edrs.length === 0) {
    return { anio, meses: [], porEmpresa: [], totalVentas: 0, totalCosto: 0, totalResultado: 0 };
  }

  const idsEdr = edrs.map((e) => e.id);
  const lineas = await cliente.edrLinea.findMany({
    where: { idEdr: { in: idsEdr } },
    include: { empresa: { select: { nombre: true } } },
  });
  const costos = await costoActualPorLinea(lineas, bd);

  // Acumuladores por mes (idEdr) y por empresa (año).
  const porMes = new Map<number, { ventas: number; costo: number }>();
  const porEmpresa = new Map<number, AcumCorte>();
  for (const l of lineas) {
    const c = costos.get(l.id) ?? { costoUnit: null, costoActual: 0, sinCosto: true };
    const importe = num(l.precioVenta) * l.cantVendida;
    const m = porMes.get(l.idEdr) ?? { ventas: 0, costo: 0 };
    m.ventas += importe;
    m.costo += c.costoActual;
    porMes.set(l.idEdr, m);
    const e = porEmpresa.get(l.idEmpresa) ?? { nombre: l.empresa.nombre, ventas: 0, costo: 0 };
    e.ventas += importe;
    e.costo += c.costoActual;
    porEmpresa.set(l.idEmpresa, e);
  }

  let totalVentas = 0;
  let totalCosto = 0;
  let totalResultado = 0;
  const meses = edrs.map((edr) => {
    const acum = porMes.get(edr.id) ?? { ventas: 0, costo: 0 };
    const ventas = redondear2(acum.ventas);
    const costo = redondear2(acum.costo);
    const gastos = num(edr.gastos);
    const intereses = num(edr.intereses);
    const bonificaciones = num(edr.bonificaciones);
    const otros = num(edr.otros);
    const resultado = resultadoEdr({ ventas, costo, gastos, intereses, bonificaciones, otros });
    totalVentas += ventas;
    totalCosto += costo;
    totalResultado += resultado;
    return {
      mes: edr.mes,
      idEdr: edr.id,
      ventas,
      costo,
      gastos,
      intereses,
      bonificaciones,
      otros,
      resultado,
    };
  });

  return {
    anio,
    meses,
    porEmpresa: [...porEmpresa.entries()]
      .map(([idEmpresa, a]) => ({
        idEmpresa,
        empresa: a.nombre,
        ventas: redondear2(a.ventas),
        costo: redondear2(a.costo),
        utilidadBruta: redondear2(a.ventas - a.costo),
      }))
      .sort((a, b) => b.ventas - a.ventas || a.empresa.localeCompare(b.empresa)),
    totalVentas: redondear2(totalVentas),
    totalCosto: redondear2(totalCosto),
    totalResultado: redondear2(totalResultado),
  };
}

// ── MUTACIONES de líneas y encabezado ─────────────────────────────────────────────────────────────────

/** Re-lee y proyecta una línea del EDR (con su costo actual). */
async function proyectarLinea(idLinea: number, bd?: ContextoBd): Promise<EdrLineaSalida> {
  const linea = await clienteLectura(bd).edrLinea.findUnique({
    where: { id: idLinea },
    include: incluirLinea,
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('EdrLinea', idLinea);
  }
  const costos = await costoActualPorLinea([linea], bd);
  return aLineaSalida(
    linea,
    costos.get(linea.id) ?? { costoUnit: null, costoActual: 0, sinCosto: true },
  );
}

/**
 * AJUSTA la cantidad/precio FACTURADO de una línea (A4 `edr.capturar`, A2, A7). Una línea `automatica`
 * pasa a `ajustada` (ya no la reconcilia el generador); una `manual` sigue `manual`. El costo NO se
 * toca (D1: es actual). Devuelve la línea proyectada.
 */
export async function ajustarLineaEdr(
  sesion: SesionUsuario,
  idLinea: number,
  cuerpo: z.input<typeof esquemaEdrLineaAjustarCuerpo>,
  bd?: ContextoBd,
): Promise<EdrLineaSalida> {
  verificarPermiso(sesion, 'edr.capturar');
  const datos = validarEntrada(esquemaEdrLineaAjustarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const linea = await tx.edrLinea.findUnique({
      where: { id: idLinea },
      select: { id: true, origen: true },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('EdrLinea', idLinea);
    }
    const nuevoOrigen = linea.origen === 'automatica' ? ('ajustada' as const) : linea.origen;
    await tx.edrLinea.update({
      where: { id: idLinea },
      data: {
        cantVendida: datos.cantVendida,
        precioVenta: new Prisma.Decimal(datos.precioVenta),
        origen: nuevoOrigen,
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'EdrLinea',
      idEntidad: idLinea,
      accion: 'MODIFICAR',
      datos: {
        cantVendida: datos.cantVendida,
        precioVenta: datos.precioVenta,
        origen: nuevoOrigen,
      },
    });
  }, bd);

  return proyectarLinea(idLinea, bd);
}

/**
 * AGREGA una línea MANUAL (sin orden) a un EDR (A4 `edr.capturar`, A2, A7). Exige empresa `paraEdr` +
 * cliente; el modelo es opcional. Origen `manual`, costo 0 (sin orden → sin costo actual). Devuelve la
 * línea proyectada.
 */
export async function agregarLineaManual(
  sesion: SesionUsuario,
  idEdr: number,
  cuerpo: z.input<typeof esquemaEdrLineaManualCuerpo>,
  bd?: ContextoBd,
): Promise<EdrLineaSalida> {
  verificarPermiso(sesion, 'edr.capturar');
  const datos = validarEntrada(esquemaEdrLineaManualCuerpo, cuerpo);

  const idLinea = await enTransaccion(async (tx) => {
    const edr = await tx.edr.findUnique({ where: { id: idEdr }, select: { id: true } });
    if (edr === null) {
      throw new ErrorNoEncontrado('Edr', idEdr);
    }
    const empresa = await tx.empresa.findUnique({
      where: { id: datos.idEmpresa },
      select: { id: true, paraEdr: true },
    });
    if (empresa === null || !empresa.paraEdr) {
      throw new ErrorValidacion(
        'La empresa de la línea debe existir y participar en el estado de resultados (paraEdr).',
      );
    }
    const cliente = await tx.cliente.findUnique({
      where: { id: datos.idCliente },
      select: { id: true },
    });
    if (cliente === null) {
      throw new ErrorValidacion('El cliente de la línea no existe.');
    }
    if (datos.idModelo !== undefined) {
      const modelo = await tx.modelo.findUnique({
        where: { id: datos.idModelo },
        select: { id: true },
      });
      if (modelo === null) {
        throw new ErrorValidacion('El modelo de la línea no existe.');
      }
    }

    const linea = await tx.edrLinea.create({
      data: {
        idEdr,
        idOrden: null,
        idEmpresa: datos.idEmpresa,
        idCliente: datos.idCliente,
        idModelo: datos.idModelo ?? null,
        descripcion: datos.descripcion ?? null,
        cantVendida: datos.cantVendida,
        precioVenta: new Prisma.Decimal(datos.precioVenta),
        origen: 'manual',
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'EdrLinea',
      idEntidad: linea.id,
      accion: 'CREAR',
      datos: {
        idEdr,
        idEmpresa: datos.idEmpresa,
        idCliente: datos.idCliente,
        cantVendida: datos.cantVendida,
        precioVenta: datos.precioVenta,
        origen: 'manual',
      },
    });
    return linea.id;
  }, bd);

  return proyectarLinea(idLinea, bd);
}

/**
 * ELIMINA una línea MANUAL (A4 `edr.capturar`, A2, A7). Solo borra líneas `manual` (rechaza automáticas/
 * ajustadas): una manual no tiene efectos derivados (ni kardex ni costo guardado), así que su BORRADO
 * DURO es seguro; las automáticas se van por reconciliación y las ajustadas se conservan como historial.
 */
export async function eliminarLineaManual(
  sesion: SesionUsuario,
  idLinea: number,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'edr.capturar');

  await enTransaccion(async (tx) => {
    const linea = await tx.edrLinea.findUnique({
      where: { id: idLinea },
      select: { id: true, idEdr: true, origen: true },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('EdrLinea', idLinea);
    }
    if (linea.origen !== 'manual') {
      throw new ErrorConflicto(
        'Solo se pueden eliminar líneas manuales; las automáticas/ajustadas no se borran.',
      );
    }
    await tx.edrLinea.delete({ where: { id: idLinea } });
    await registrarBitacora(tx, sesion, {
      entidad: 'EdrLinea',
      idEntidad: idLinea,
      accion: 'OTRO',
      datos: { eliminada: true, idEdr: linea.idEdr, origen: 'manual' },
    });
  }, bd);
}

/**
 * ACTUALIZA el ENCABEZADO GLOBAL del mes (gastos/intereses/bonificaciones/otros/descOtros/observaciones)
 * (A4 `edr.capturar`, A2, A7). Solo pisa lo que venga en el cuerpo. Devuelve el EDR recalculado.
 */
export async function actualizarEncabezado(
  sesion: SesionUsuario,
  idEdr: number,
  cuerpo: z.input<typeof esquemaEdrEncabezadoCuerpo>,
  bd?: ContextoBd,
): Promise<EdrCalculado> {
  verificarPermiso(sesion, 'edr.capturar');
  const datos = validarEntrada(esquemaEdrEncabezadoCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const edr = await tx.edr.findUnique({ where: { id: idEdr }, select: { id: true } });
    if (edr === null) {
      throw new ErrorNoEncontrado('Edr', idEdr);
    }
    await tx.edr.update({
      where: { id: idEdr },
      data: {
        ...(datos.gastos === undefined ? {} : { gastos: new Prisma.Decimal(datos.gastos) }),
        ...(datos.intereses === undefined
          ? {}
          : { intereses: new Prisma.Decimal(datos.intereses) }),
        ...(datos.bonificaciones === undefined
          ? {}
          : { bonificaciones: new Prisma.Decimal(datos.bonificaciones) }),
        ...(datos.otros === undefined ? {} : { otros: new Prisma.Decimal(datos.otros) }),
        ...(datos.descOtros === undefined ? {} : { descOtros: datos.descOtros }),
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Edr',
      idEntidad: idEdr,
      accion: 'MODIFICAR',
      datos: {
        gastos: datos.gastos,
        intereses: datos.intereses,
        bonificaciones: datos.bonificaciones,
        otros: datos.otros,
      },
    });
  }, bd);

  return calcularEdr(sesion, idEdr, bd);
}
