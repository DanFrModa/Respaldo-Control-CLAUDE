/**
 * ServicioReportesFiscales — REPORTES FISCALES para el contador (Módulo 14, F9-E5; D12/R13; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2/§3.2/§8). CONTROL no lleva contabilidad:
 * entrega DATOS limpios (la VISTA FISCAL del libro de terceros de E1), no pólizas. Toda la lógica vive
 * aquí (A1); las rutas delegan. Es LECTURA pura sobre `movimientos_tercero` (no muta nada).
 *
 * QUÉ es "fiscal": un movimiento del MOTOR con `esFiscal=true`. NO incluye EsMa — un cargo de maquila
 * "con factura" (F6) NO es un CFDI (no tiene UUID/RFC/XML); su faceta fiscal aparece cuando su CFDI se
 * importa (E3), lo que crea un movimiento `factura_proveedor` en el motor. Así el reporte del contador
 * = exactamente los renglones CFDI del motor, ni uno de EsMa.
 *
 * QUÉ se expone: folio, fecha, tercero + RFC, origen, UUID, presencia de XML (idArchivoCfdi) y el TOTAL
 * (`monto`, con signo). El DESGLOSE de impuestos (base/IVA/retenciones) NO se persiste en el movimiento
 * — vive en el XML; leerlo sería otra lectura, fuera del alcance de E5 (nota en el contrato).
 *
 * Permiso `terceros.fiscal` (A4) para TODO — es su propósito (el reporte del contador). Empresa activa
 * (A9). Los importes se ocultan (null) sin `consultas.ver-importes`.
 */
import {
  esquemaReporteFiscalQuery,
  esquemaSaludFiscalQuery,
  type ReporteFiscalQuery,
  type ReporteFiscalFila,
  type ReporteFiscalSalida,
  type SaludFiscalQuery,
  type SaldoFiscalTercero,
  type SaludFiscalSalida,
} from '../../../contrato/index.js';
import type { z } from 'zod';

import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { validarEntrada } from '../../../comun/validacion.js';
import { Prisma } from '../../../datos/index.js';

/** Redondeo monetario a 2 decimales; normaliza el cero negativo (-0 → 0). */
function redondear2(n: number): number {
  const r = Math.round(n * 100) / 100;
  // `redondear2(-abonosNeg)` con la suma de abonos VACÍA (tras excluir cancelaciones) da -0: un
  // artefacto que rompe el `toBe(0)` estricto y no debe salir del dominio. `r === 0` cubre ±0.
  return r === 0 ? 0 : r;
}

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** `include` para proyectar el nombre del tercero de un movimiento. */
const incluirTercero = {
  cliente: { select: { nombre: true } },
  proveedor: { select: { nombre: true } },
} satisfies Prisma.MovimientoTerceroInclude;

/** Rango sobre la columna `fecha` (@db.Date) del motor, inclusivo en ambos extremos (Prisma where). */
function rangoFecha(
  desde: string | undefined,
  hasta: string | undefined,
): Prisma.MovimientoTerceroWhereInput {
  if (desde === undefined && hasta === undefined) {
    return {};
  }
  return {
    fecha: {
      ...(desde === undefined ? {} : { gte: aDateColumna(desde) }),
      ...(hasta === undefined ? {} : { lte: aDateColumna(hasta) }),
    },
  };
}

/** Filtro por un tercero concreto (idCliente/idProveedor). El contrato garantiza tipoTercero si hay id. */
function terceroWhere(filtros: ReporteFiscalQuery): Prisma.MovimientoTerceroWhereInput {
  if (filtros.idTercero === undefined || filtros.tipoTercero === undefined) {
    return {};
  }
  return filtros.tipoTercero === 'cliente'
    ? { idCliente: filtros.idTercero }
    : { idProveedor: filtros.idTercero };
}

// ── Reporte fiscal por periodo (movimientos fiscales paginados + totales) ────────────────────────────

/**
 * Reporte fiscal del contador: los movimientos `esFiscal=true` del libro de terceros que cumplen el
 * filtro (periodo, tercero, tipo cargo/abono, con/sin CFDI), paginados, + los TOTALES del periodo
 * (sobre TODO el filtro, no la página). Permiso `terceros.fiscal` (A4). Empresa activa (A9). Importes
 * ocultables. Orden determinista: fecha desc, luego id desc.
 */
export async function reporteFiscal(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaReporteFiscalQuery> = {},
  bd?: ContextoBd,
): Promise<ReporteFiscalSalida> {
  verificarPermiso(sesion, 'terceros.fiscal');
  const filtros: ReporteFiscalQuery = validarEntrada(esquemaReporteFiscalQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const oculto = (v: number): number | null => (puedeVerImportes ? v : null);

  const where: Prisma.MovimientoTerceroWhereInput = {
    idEmpresa,
    esFiscal: true,
    ...(filtros.tipoTercero === undefined ? {} : { tipoTercero: filtros.tipoTercero }),
    ...terceroWhere(filtros),
    ...(filtros.cfdi === 'con'
      ? { uuidCfdi: { not: null } }
      : filtros.cfdi === 'sin'
        ? { uuidCfdi: null }
        : {}),
    ...(filtros.tipo === 'cargos'
      ? { monto: { gt: 0 } }
      : filtros.tipo === 'abonos'
        ? { monto: { lt: 0 } }
        : {}),
    ...rangoFecha(filtros.desde, filtros.hasta),
  };

  const inicio = (filtros.pagina - 1) * filtros.porPagina;
  // Las CANCELACIONES (el INVERSO —sin UUID/XML— y su ORIGINAL marcado `cancelado`) se anulan entre sí:
  // el neto no cambia si se quitan, pero SÍ inflan los brutos, porque el inverso es un cargo/abono
  // espejo (fantasma). Los EXCLUYO de las AGREGACIONES de importes (cargos/abonos/neto) para que
  // reflejen solo el CFDI VIVO. Excluir SOLO el inverso rompería el neto (dejaría el original colgando),
  // por eso salen AMBOS. La LISTA (filas/total/movimientos) SÍ los muestra: es el rastro de auditoría
  // (D3) y cada renglón trae sus banderas `cancelado`/`esInverso`.
  const soloVivos = { idMovimientoInverso: null, cancelado: false } as const;
  // Totales: cargos (Σ monto>0) y abonos (Σ monto<0) sobre el filtro, ya sin cancelaciones. Se combinan
  // por `AND` para NO pisar un posible filtro de `tipo` (que ya fija `monto`): si `tipo=cargos`, abonos=0.
  const [total, filasBd, aggCargos, aggAbonos] = await Promise.all([
    cliente.movimientoTercero.count({ where }),
    cliente.movimientoTercero.findMany({
      where,
      include: incluirTercero,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      skip: inicio,
      take: filtros.porPagina,
    }),
    cliente.movimientoTercero.aggregate({
      where: { AND: [where, { ...soloVivos, monto: { gt: 0 } }] },
      _sum: { monto: true },
    }),
    cliente.movimientoTercero.aggregate({
      where: { AND: [where, { ...soloVivos, monto: { lt: 0 } }] },
      _sum: { monto: true },
    }),
  ]);

  const cargos = redondear2(aggCargos._sum.monto?.toNumber() ?? 0);
  const abonosNeg = redondear2(aggAbonos._sum.monto?.toNumber() ?? 0);
  const neto = redondear2(cargos + abonosNeg);

  const filas: ReporteFiscalFila[] = filasBd.map((m) => {
    const monto = m.monto.toNumber();
    return {
      id: m.id,
      folio: Number(m.folio),
      fecha: m.fecha.toISOString().slice(0, 10),
      tipoTercero: m.tipoTercero,
      idTercero: m.idCliente ?? m.idProveedor ?? 0,
      tercero: m.cliente?.nombre ?? m.proveedor?.nombre ?? '',
      rfcTercero: m.rfcTercero,
      origen: m.origen,
      uuidCfdi: m.uuidCfdi,
      tieneXml: m.idArchivoCfdi !== null,
      monto: oculto(redondear2(monto)),
      esCargo: monto > 0,
      cancelado: m.cancelado,
      esInverso: m.idMovimientoInverso !== null,
    };
  });

  return {
    desde: filtros.desde ?? null,
    hasta: filtros.hasta ?? null,
    filas,
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
    totales: {
      cargos: oculto(cargos),
      abonos: oculto(redondear2(-abonosNeg)),
      neto: oculto(neto),
      movimientos: total,
    },
  };
}

// ── Tablero de "salud fiscal" (conciliación consolidada + saldos por tercero) ────────────────────────

/** Fila CRUDA del agregado SQL de saldos fiscales por tercero. */
interface FilaSaldoFiscalCruda {
  tipoTercero: 'cliente' | 'proveedor';
  idTercero: number;
  tercero: string;
  rfc: string | null;
  saldoFiscal: Prisma.Decimal;
  movimientos: number;
}

/** Rango sobre `m.fecha` como fragmentos de SQL crudo (para el agregado de saldos). */
function condicionesFecha(desde: string | undefined, hasta: string | undefined): Prisma.Sql[] {
  const cond: Prisma.Sql[] = [];
  if (desde !== undefined) {
    cond.push(Prisma.sql`m.fecha >= ${aDateColumna(desde)}`);
  }
  if (hasta !== undefined) {
    cond.push(Prisma.sql`m.fecha <= ${aDateColumna(hasta)}`);
  }
  return cond;
}

/**
 * TABLERO de salud fiscal (A1): la conciliación consolidada (cuántos movimientos fiscales tienen
 * CFDI/UUID, cuántos su XML en R2, cuántos están pendientes) + los saldos fiscales por tercero
 * (agregados en el servidor). `pctConciliado` = con UUID ÷ total (null si no hay fiscales). Permiso
 * `terceros.fiscal` (A4). Empresa activa (A9). Importes ocultables.
 */
export async function saludFiscal(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaSaludFiscalQuery> = {},
  bd?: ContextoBd,
): Promise<SaludFiscalSalida> {
  verificarPermiso(sesion, 'terceros.fiscal');
  const filtros: SaludFiscalQuery = validarEntrada(esquemaSaludFiscalQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const oculto = (v: number): number | null => (puedeVerImportes ? v : null);

  // Conciliación y saldos cuentan solo el CFDI VIVO: se EXCLUYEN los movimientos de cancelación —el
  // INVERSO (fiscal pero sin UUID/XML → contaría como "sin CFDI/sin XML" fantasma y hundiría el
  // pctConciliado) y su ORIGINAL cancelado (su CFDI ya no vale)—. Ambos se anulan en el saldo, así que
  // sacarlos deja los saldos correctos y limpia los conteos.
  const baseFiscal: Prisma.MovimientoTerceroWhereInput = {
    idEmpresa,
    esFiscal: true,
    idMovimientoInverso: null,
    cancelado: false,
    ...rangoFecha(filtros.desde, filtros.hasta),
  };

  const [totalFiscales, conCfdi, conXml] = await Promise.all([
    cliente.movimientoTercero.count({ where: baseFiscal }),
    cliente.movimientoTercero.count({ where: { ...baseFiscal, uuidCfdi: { not: null } } }),
    cliente.movimientoTercero.count({ where: { ...baseFiscal, idArchivoCfdi: { not: null } } }),
  ]);

  // Saldos fiscales por tercero (Σ monto de los movimientos fiscales), con nombre y RFC del catálogo.
  const condiciones = [
    Prisma.sql`m.id_empresa = ${idEmpresa}`,
    Prisma.sql`m.es_fiscal = true`,
    // Mismo filtro que los conteos: fuera inversos de cancelación y originales cancelados.
    Prisma.sql`m.id_movimiento_inverso IS NULL`,
    Prisma.sql`m.cancelado = false`,
    ...condicionesFecha(filtros.desde, filtros.hasta),
  ];
  const whereSql = Prisma.join(condiciones, ' AND ');
  const crudas = await cliente.$queryRaw<FilaSaldoFiscalCruda[]>(Prisma.sql`
    SELECT
      m.tipo_tercero                       AS "tipoTercero",
      COALESCE(m.id_cliente, m.id_proveedor) AS "idTercero",
      COALESCE(c.nombre, p.nombre)         AS "tercero",
      COALESCE(c.rfc, p.rfc)               AS "rfc",
      SUM(m.monto)::numeric                AS "saldoFiscal",
      COUNT(*)::int                        AS "movimientos"
    FROM movimientos_tercero m
    LEFT JOIN clientes c    ON c.id = m.id_cliente
    LEFT JOIN proveedores p ON p.id = m.id_proveedor
    WHERE ${whereSql}
    GROUP BY m.tipo_tercero, COALESCE(m.id_cliente, m.id_proveedor),
             COALESCE(c.nombre, p.nombre), COALESCE(c.rfc, p.rfc)
  `);

  const saldos: SaldoFiscalTercero[] = crudas
    .map((f) => ({ ...f, saldoNum: redondear2(f.saldoFiscal.toNumber()) }))
    .sort(
      (a, b) =>
        Math.abs(b.saldoNum) - Math.abs(a.saldoNum) || a.tercero.localeCompare(b.tercero, 'es'),
    )
    .map((f) => ({
      tipoTercero: f.tipoTercero,
      idTercero: f.idTercero,
      tercero: f.tercero,
      rfc: f.rfc,
      saldoFiscal: oculto(f.saldoNum),
      movimientos: f.movimientos,
    }));

  return {
    desde: filtros.desde ?? null,
    hasta: filtros.hasta ?? null,
    totalFiscales,
    conCfdi,
    sinCfdi: totalFiscales - conCfdi,
    conXml,
    sinXml: totalFiscales - conXml,
    pctConciliado: totalFiscales === 0 ? null : Math.round((conCfdi / totalFiscales) * 100),
    saldos,
  };
}
