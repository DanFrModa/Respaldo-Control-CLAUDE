/**
 * ServicioCxC — CUENTAS POR COBRAR de clientes (Módulo 14, F9-E4; D12/D15/R10/R12; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2/§3.1). CxC es un USO del MOTOR de cuenta
 * corriente de terceros (F9-E1): NO reimplementa el saldo ni la cancelación — COMPONE sobre
 * `dominio/terceros/cuenta-terceros.ts`. Es el ESPEJO de CxP (F9-E2), más simple: los clientes NO
 * maquilan, así que NO hay convivencia EsMa ni cubeta "maquila". Toda la lógica de negocio vive aquí
 * (A1); las rutas delegan.
 *
 * COMPOSICIÓN (sin duplicar el motor):
 *  • Altas/cancelaciones → delegan a `registrarMovimientoTercero`/`cancelarMovimientoTercero` (mismo
 *    folio A3, mismo signo por origen, misma bitácora A7, misma transacción A2, mismo inverso D3).
 *  • Estado de cuenta → delega a `estadoDeCuentaTercero('cliente', …)`.
 *  • La ANTIGÜEDAD (aging) y el RESUMEN de la bandeja se calculan EN EL SERVIDOR (A1) con un agregado
 *    directo sobre `movimientos_tercero` + la pieza pura de `../aging-comun.ts` (compartida con CxP).
 *
 * PERMISOS (A4, deny-by-default): CxC añade su propia capa `cxc.ver` (consultas) / `cxc.administrar`
 * (capturas/cancelaciones). Al delegar al motor se exige ADEMÁS `terceros.ver`/`.administrar` — DEFENSA
 * EN PROFUNDIDAD (ambos permisos se reparten a los MISMOS roles en el seed, todo falla CERRADO). La
 * vista `fiscal` exige, además, `terceros.fiscal` (motor). Empresa activa (A9). Los importes se ocultan
 * (null) sin `consultas.ver-importes`.
 */
import {
  esquemaMovimientoCxcCrear,
  esquemaBandejaCxcQuery,
  type DatosMovimientoCxcCrear,
  type BandejaCxcQuery,
  type BandejaCxcSalida,
  type BandejaCxcFila,
  type ResumenCxcSalida,
  type MovimientoTerceroSalida,
  type EstadoCuentaTerceroSalida,
  type DatosMovimientoTerceroCancelar,
} from '../../../contrato/index.js';
import type { z } from 'zod';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { validarEntrada } from '../../../comun/validacion.js';
import { Prisma } from '../../../datos/index.js';

import {
  registrarMovimientoTercero,
  cancelarMovimientoTercero,
  estadoDeCuentaTercero,
} from '../cuenta-terceros.js';
import { leerLimitesAging } from '../config-aging.js';
import { type LimitesAging } from '../aging-comun.js';
import { netearCubetas, type CubetasAging, type CubetasBrutas } from './aging.js';

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ¿Un saldo es distinto de cero? (tolerancia de medio centavo para el ruido de coma flotante). */
function tieneSaldo(saldo: number): boolean {
  return Math.abs(saldo) >= 0.005;
}

/** Quita acentos y pasa a minúsculas para comparar (misma norma que el combobox del frontend). */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Alta de un movimiento de CxC (por cliente) ──────────────────────────────────────────────────────

/**
 * Registra un movimiento de CxC para un CLIENTE (cobro/abono/descuento/nota de crédito/cargo sin
 * factura). Fija `tipoTercero='cliente'` y delega al motor (A2/A3/A7). Permiso `cxc.administrar` (+
 * `terceros.administrar` del motor, defensa en profundidad). Empresa activa (A9).
 */
export async function registrarMovimientoCxc(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: z.input<typeof esquemaMovimientoCxcCrear>,
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  verificarPermiso(sesion, 'cxc.administrar');
  const datos: DatosMovimientoCxcCrear = validarEntrada(esquemaMovimientoCxcCrear, entrada);

  return registrarMovimientoTercero(
    sesion,
    {
      tipoTercero: 'cliente',
      idTercero: idCliente,
      fecha: datos.fecha,
      origen: datos.origen,
      importe: datos.importe,
      esFiscal: datos.esFiscal,
      ...(datos.refTipo === undefined ? {} : { refTipo: datos.refTipo }),
      ...(datos.refId === undefined ? {} : { refId: datos.refId }),
      ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
    },
    bd,
  );
}

// ── Cancelación (inverso auditado, delega al motor) ─────────────────────────────────────────────────

/**
 * Cancela un movimiento de CxC por su INVERSO auditado (D3/A7). Verifica que el movimiento sea de un
 * CLIENTE (la ruta de CxC no cancela movimientos de CxP) y delega al motor. Permiso `cxc.administrar`
 * (+ `terceros.administrar`). Empresa activa (A9).
 */
export async function cancelarMovimientoCxc(
  sesion: SesionUsuario,
  id: number,
  cuerpo: DatosMovimientoTerceroCancelar,
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  verificarPermiso(sesion, 'cxc.administrar');
  const cliente = clienteLectura(bd);
  const mov = await cliente.movimientoTercero.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    select: { tipoTercero: true },
  });
  if (mov === null || mov.tipoTercero !== 'cliente') {
    throw new ErrorNoEncontrado('MovimientoTercero', id);
  }
  return cancelarMovimientoTercero(sesion, id, cuerpo, bd);
}

// ── Estado de cuenta del cliente (delega al motor, con permiso de CxC) ───────────────────────────────

/**
 * Estado de cuenta de un CLIENTE (saldo + movimientos paginados). Delega al motor `estadoDeCuentaTercero`
 * (para un cliente no hay convivencia EsMa: solo el motor). Permiso `cxc.ver` (+ `terceros.ver`; la
 * vista `fiscal` exige además `terceros.fiscal`, lo valida el motor). Empresa activa (A9).
 */
export async function estadoCuentaClienteCxc(
  sesion: SesionUsuario,
  idCliente: number,
  parametros: Parameters<typeof estadoDeCuentaTercero>[3] = {},
  bd?: ContextoBd,
): Promise<EstadoCuentaTerceroSalida> {
  verificarPermiso(sesion, 'cxc.ver');
  return estadoDeCuentaTercero(sesion, 'cliente', idCliente, parametros, bd);
}

// ── Bandeja "por cobrar" + resumen (aging server-side, A1) ──────────────────────────────────────────

/** Fila CRUDA del agregado SQL del motor (subtotales en `numeric` → Decimal, cero-drift vs el detalle). */
interface FilaAgregadoCxcCruda {
  idCliente: number;
  cliente: string;
  diasCredito: number;
  corriente: Prisma.Decimal;
  d1a30: Prisma.Decimal;
  d31a60: Prisma.Decimal;
  mas60: Prisma.Decimal;
  creditos: Prisma.Decimal;
}

/** Fila del agregado del motor ya convertida a number (el netting/redondeo se hace en JS). */
interface FilaAgregadoCxc {
  idCliente: number;
  cliente: string;
  diasCredito: number;
  corriente: number;
  d1a30: number;
  d31a60: number;
  mas60: number;
  creditos: number;
}

/** Fila ya neteada: aging (4 cubetas) + saldo. Antes de ocultar importes. */
interface FilaNeta extends CubetasAging {
  idCliente: number;
  cliente: string;
  diasCredito: number;
  /** Saldo = corriente + d1a30 + d31a60 + mas60. */
  saldo: number;
}

/**
 * Agrega, por cliente, sus movimientos del motor en las cuatro cubetas de aging (BRUTAS) + los créditos,
 * por la empresa activa (A9). Cubetas por días de atraso sobre `fecha_vencimiento` (`CURRENT_DATE −
 * fecha_vencimiento`); los límites llegan como parámetro (F9-E5/D15d: configurables por empresa,
 * `leerLimitesAging`). Filtrar por `id_cliente IS NOT NULL` equivale a `tipo_tercero='cliente'`
 * (CHECK de exclusividad D15a) y evita castear el enum en crudo. Los subtotales viajan en `::numeric`
 * (Decimal) para CERO-DRIFT contra el `saldo` del detalle (que suma `monto` Decimal vía Prisma `_sum`).
 */
async function agregarPorCliente(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  limites: LimitesAging,
): Promise<FilaAgregadoCxc[]> {
  const { d30, d60 } = limites;
  const crudas = await cliente.$queryRaw<FilaAgregadoCxcCruda[]>(Prisma.sql`
    SELECT
      m.id_cliente AS "idCliente",
      c.nombre     AS "cliente",
      COALESCE(c.dias_credito, 0)::int AS "diasCredito",
      COALESCE(SUM(m.monto) FILTER (
        WHERE m.monto > 0 AND (m.fecha_vencimiento IS NULL OR CURRENT_DATE - m.fecha_vencimiento <= 0)
      ), 0)::numeric AS "corriente",
      COALESCE(SUM(m.monto) FILTER (
        WHERE m.monto > 0 AND CURRENT_DATE - m.fecha_vencimiento BETWEEN 1 AND ${d30}
      ), 0)::numeric AS "d1a30",
      COALESCE(SUM(m.monto) FILTER (
        WHERE m.monto > 0 AND CURRENT_DATE - m.fecha_vencimiento BETWEEN ${d30 + 1} AND ${d60}
      ), 0)::numeric AS "d31a60",
      COALESCE(SUM(m.monto) FILTER (
        WHERE m.monto > 0 AND CURRENT_DATE - m.fecha_vencimiento > ${d60}
      ), 0)::numeric AS "mas60",
      COALESCE(-SUM(m.monto) FILTER (WHERE m.monto < 0), 0)::numeric AS "creditos"
    FROM movimientos_tercero m
    JOIN clientes c ON c.id = m.id_cliente
    WHERE m.id_empresa = ${idEmpresa} AND m.id_cliente IS NOT NULL
    GROUP BY m.id_cliente, c.nombre, c.dias_credito
  `);
  return crudas.map((f) => ({
    idCliente: f.idCliente,
    cliente: f.cliente,
    diasCredito: f.diasCredito,
    corriente: redondear2(f.corriente.toNumber()),
    d1a30: redondear2(f.d1a30.toNumber()),
    d31a60: redondear2(f.d31a60.toNumber()),
    mas60: redondear2(f.mas60.toNumber()),
    creditos: redondear2(f.creditos.toNumber()),
  }));
}

/** Netea una fila cruda del motor (aging + saldo). */
function netearFila(f: FilaAgregadoCxc): FilaNeta {
  const brutas: CubetasBrutas = {
    corriente: f.corriente,
    d1a30: f.d1a30,
    d31a60: f.d31a60,
    mas60: f.mas60,
    creditos: f.creditos,
  };
  const c = netearCubetas(brutas);
  const saldo = redondear2(c.corriente + c.d1a30 + c.d31a60 + c.mas60);
  return {
    idCliente: f.idCliente,
    cliente: f.cliente,
    diasCredito: f.diasCredito,
    corriente: c.corriente,
    d1a30: c.d1a30,
    d31a60: c.d31a60,
    mas60: c.mas60,
    saldo,
  };
}

/**
 * Resumen (KPIs) sobre TODOS los clientes con saldo ≠ 0 (independiente de página/filtro/búsqueda).
 * `carteraTotal` = Σ saldo → el activo por cobrar. `vencido` = Σ de las tres cubetas vencidas. El
 * `alCorrientePct = (cartera − vencido) ÷ cartera` sobre TODA la cartera (a diferencia de CxP no hay
 * maquila sin clasificar). Sin cartera (`cartera ≈ 0`) → el % es `null` ("—"), NUNCA 100%.
 */
function calcularResumen(
  conSaldo: FilaNeta[],
  oculto: (v: number) => number | null,
): ResumenCxcSalida {
  const carteraTotal = redondear2(conSaldo.reduce((s, f) => s + f.saldo, 0));
  const vencido = redondear2(conSaldo.reduce((s, f) => s + f.d1a30 + f.d31a60 + f.mas60, 0));
  const alCorrientePct =
    Math.abs(carteraTotal) < 0.005
      ? null
      : Math.min(100, Math.max(0, Math.round(((carteraTotal - vencido) / carteraTotal) * 100)));
  return {
    carteraTotal: oculto(carteraTotal),
    vencido: oculto(vencido),
    alCorrientePct,
    clientesConSaldo: conSaldo.length,
  };
}

/**
 * BANDEJA "por cobrar": los clientes con su saldo por cobrar y su antigüedad (aging), + el resumen
 * (KPIs) de la cartera. La agregación y el aging son SERVER-SIDE (A1): la pantalla solo pinta escalares.
 * El resumen se calcula sobre TODA la cartera con saldo (no la página). Permiso `cxc.ver`. Empresa
 * activa (A9). Importes ocultables (`consultas.ver-importes`); el aging igual se ordena por el saldo
 * real (el ocultamiento solo afecta la salida, no el cálculo).
 */
export async function bandejaPorCobrar(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaBandejaCxcQuery> = {},
  bd?: ContextoBd,
): Promise<BandejaCxcSalida> {
  verificarPermiso(sesion, 'cxc.ver');
  const filtros: BandejaCxcQuery = validarEntrada(esquemaBandejaCxcQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const oculto = (v: number): number | null => (puedeVerImportes ? v : null);

  // Límites de aging vigentes de la empresa (F9-E5/D15d: configurables); default 30/60.
  const limites = await leerLimitesAging(cliente, idEmpresa);
  const crudas = await agregarPorCliente(cliente, idEmpresa, limites);
  const netas = crudas.map(netearFila);
  const conSaldo = netas.filter((f) => tieneSaldo(f.saldo));
  const resumen = calcularResumen(conSaldo, oculto);

  // Universo de la tabla según el chip; la búsqueda NO afecta al resumen (KPIs de toda la cartera).
  let base = filtros.filtro === 'todos' ? netas : conSaldo;
  if (filtros.busqueda !== undefined && filtros.busqueda !== '') {
    const q = normalizar(filtros.busqueda);
    base = base.filter((f) => normalizar(f.cliente).includes(q));
  }
  // Orden estable: mayor saldo primero, luego por nombre (determinista).
  base.sort((a, b) => b.saldo - a.saldo || a.cliente.localeCompare(b.cliente, 'es'));

  const total = base.length;
  const inicio = (filtros.pagina - 1) * filtros.porPagina;
  const pagina = base.slice(inicio, inicio + filtros.porPagina);

  const filas: BandejaCxcFila[] = pagina.map((f) => ({
    idCliente: f.idCliente,
    cliente: f.cliente,
    diasCredito: f.diasCredito,
    saldo: oculto(f.saldo),
    corriente: oculto(f.corriente),
    d1a30: oculto(f.d1a30),
    d31a60: oculto(f.d31a60),
    mas60: oculto(f.mas60),
  }));

  return {
    filas,
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
    resumen,
    limitesAging: { limite1: limites.d30, limite2: limites.d60 },
  };
}
