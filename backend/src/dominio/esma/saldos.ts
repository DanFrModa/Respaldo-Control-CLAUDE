/**
 * SALDO de un maquilero (F6-E4; doc 07-EsMa §1, ex `EsMa_SaldosMaq`). El saldo NUNCA se persiste: es
 * la VISTA DERIVADA por suma (D3 extendido a saldos, 07 §6.2). Fórmula EXACTA del viejo con "ceronulo"
 * (nulos = 0):
 *
 *   saldo = Σ(cantidadReal × precioReal de cargos VALIDADOS no sin-costo)
 *         + Σ abonos − Σ pagos − Σ descuentos   ← los tres, sólo los REVISADOS
 *
 * ⭐ El criterio de cada concepto (qué renglones cuentan) NO se escribe aquí: sale de
 * `formula-saldo.ts`, la definición ÚNICA que comparten esta implementación con Prisma y las dos
 * de SQL crudo de `saldos-todos.ts`. Ver ahí el porqué (fila 0.115: el estado de revisión sólo
 * mandaba en los cargos, y la fórmula estaba triplicada).
 *
 * Lo capturado y aún NO revisado no suma, pero tampoco se pierde de vista: viaja aparte en
 * `pendiente` (desglose + neto con el mismo signo del saldo). Desde la fila 0.111 eso incluye los
 * CARGOS `propuesto` —los recibos que esperan validación—, cuyo importe se DERIVA con la regla única
 * de `cargo-propuesto.ts` porque no está persistido.
 *
 * Segmentable por facturación (decisión (h)): con `conFactura = 'con' | 'sin'` cuadra solo ese
 * segmento (para el proveedor "ambos" → dos estados de cuenta, E5). Los movimientos con `conFactura`
 * NULL (sin definir) NO entran en ningún segmento.
 *
 * Innegociables: A1 (lógica aquí), A4 (`esma.ver-pagos`: ver estado de cuenta), A9 (empresa activa),
 * D3 (saldo derivado). Los IMPORTES se ocultan (todo en null) si falta `consultas.ver-importes`.
 */
import { esquemaSaldoQuery, type SaldoQuery, type SaldoSalida } from '../../contrato/index.js';
import type { z } from 'zod';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import type { PrismaClient } from '../../datos/index.js';
import { validarEntrada } from '../../comun/validacion.js';

import { SELECT_VALUACION_PROPUESTA, valuarCargoPropuesto } from './cargo-propuesto.js';
import {
  armarPendiente,
  pendienteParaSalida,
  redondear2,
  saldoDeTotales,
  WHERE_CUENTA_ABONO,
  WHERE_CUENTA_CARGO,
  WHERE_CUENTA_DESCUENTO,
  WHERE_CUENTA_PAGO,
  WHERE_PENDIENTE_ABONO,
  WHERE_PENDIENTE_CARGO,
  WHERE_PENDIENTE_DESCUENTO,
  WHERE_PENDIENTE_PAGO,
  whereSegmentoFactura,
  type PendienteRevision,
  type SegmentoFactura,
  type WhereSegmentoFactura,
} from './formula-saldo.js';

/**
 * Cláusula `where` de facturación para un segmento (o `{}` si no se segmenta) — pedida a la
 * definición ÚNICA (`formula-saldo.ts` §segmento): «sin factura» = `false` **o** sin definir. Aquí
 * decía `= false`, que dejaba fuera lo migrado sin definir (ver el TSDoc de la definición).
 */
function conFacturaWhere(segmento: SegmentoFactura | undefined): WhereSegmentoFactura {
  return whereSegmentoFactura(segmento);
}

/** Desglose crudo del saldo de un maquilero (sin ocultar importes ni verificar permiso). */
export interface SaldoMaquileroCalculado {
  totalCargos: number;
  totalAbonos: number;
  totalPagos: number;
  totalDescuentos: number;
  saldo: number;
  /** Lo capturado que AÚN espera revisión: no entra al saldo, pero se ve (no desaparece sin más). */
  pendiente: PendienteRevision;
}

/**
 * Cálculo PURO del saldo de un maquilero por SUMA de movimientos (misma fórmula del viejo, D3):
 * `saldo = Σcargos(validados no sin-costo) + Σabonos − Σpagos − Σdescuentos`, **los tres planos sólo
 * si están revisados** (criterio de `formula-saldo.ts`), segmentable por facturación. Devuelve además
 * el bloque `pendiente` con lo capturado que todavía espera revisión.
 *
 * NO verifica permiso ni oculta importes ni valida que el proveedor exista: es la pieza reutilizable
 * — `saldoDeMaquilero` la envuelve con permiso/existencia/ocultamiento, y la CONVIVENCIA de F9-E1
 * (`dominio/terceros/convivencia-esma.ts`) la reusa TAL CUAL para el aporte EsMa del saldo del
 * proveedor. Reusarla (en vez de replicar el SQL) es la GARANTÍA de la no-regresión.
 */
export async function calcularSaldoMaquilero(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  idMaquilero: number,
  conFactura: 'con' | 'sin' | undefined,
): Promise<SaldoMaquileroCalculado> {
  const factura = conFacturaWhere(conFactura);
  const base = { idEmpresa, idMaquilero, ...factura };

  // Cargos: Σ cantidadReal × precioReal (los que cuentan, según la definición única). Se suman los
  // productos en JS porque no hay columna de importe: el cargo guarda cantidad y precio por separado.
  const cargos = await cliente.esMaCargo.findMany({
    where: { ...base, ...WHERE_CUENTA_CARGO },
    select: { cantidadReal: true, precioReal: true },
  });
  const totalCargos = redondear2(
    cargos.reduce(
      (s, c) => s + (c.cantidadReal?.toNumber() ?? 0) * (c.precioReal?.toNumber() ?? 0),
      0,
    ),
  );

  // ⭐ Cargos PROPUESTOS: los recibos que esperan validación (V1, fila 0.111). No suman al saldo,
  // pero son partidas esperando una decisión y su importe se DERIVA con la regla única de
  // `cargo-propuesto.ts` (cantidad del recibo × precio de la orden). El criterio de QUÉ cargo está
  // pendiente sale, como los otros tres, de la definición única.
  const cargosPropuestos = await cliente.esMaCargo.findMany({
    where: { ...base, ...WHERE_PENDIENTE_CARGO },
    select: SELECT_VALUACION_PROPUESTA,
  });
  const valuados = cargosPropuestos.map(valuarCargoPropuesto);

  // Abonos / pagos / descuentos: Σ monto de los REVISADOS (al saldo) y de los CAPTURADOS (pendiente).
  const [abonos, pagos, descuentos, abonosPend, pagosPend, descuentosPend] = await Promise.all([
    cliente.abonoMaquilero.aggregate({
      where: { ...base, ...WHERE_CUENTA_ABONO },
      _sum: { monto: true },
    }),
    cliente.pagoMaquilero.aggregate({
      where: { ...base, ...WHERE_CUENTA_PAGO },
      _sum: { monto: true },
    }),
    cliente.descuentoMaquilero.aggregate({
      where: { ...base, ...WHERE_CUENTA_DESCUENTO },
      _sum: { monto: true },
    }),
    // El pendiente pide TAMBIÉN el conteo: los importes pueden netear cero (el ETL carga montos
    // negativos a propósito) y aun así haber partidas esperando decisión.
    cliente.abonoMaquilero.aggregate({
      where: { ...base, ...WHERE_PENDIENTE_ABONO },
      _sum: { monto: true },
      _count: { _all: true },
    }),
    cliente.pagoMaquilero.aggregate({
      where: { ...base, ...WHERE_PENDIENTE_PAGO },
      _sum: { monto: true },
      _count: { _all: true },
    }),
    cliente.descuentoMaquilero.aggregate({
      where: { ...base, ...WHERE_PENDIENTE_DESCUENTO },
      _sum: { monto: true },
      _count: { _all: true },
    }),
  ]);
  const totales = {
    totalCargos,
    totalAbonos: redondear2(abonos._sum.monto?.toNumber() ?? 0),
    totalPagos: redondear2(pagos._sum.monto?.toNumber() ?? 0),
    totalDescuentos: redondear2(descuentos._sum.monto?.toNumber() ?? 0),
  };
  const pendiente = armarPendiente({
    abonos: abonosPend._sum.monto?.toNumber() ?? 0,
    pagos: pagosPend._sum.monto?.toNumber() ?? 0,
    descuentos: descuentosPend._sum.monto?.toNumber() ?? 0,
    // Los que NO se pueden valuar aportan 0 al importe (nunca un precio inventado) y se cuentan aparte.
    cargos: valuados.reduce((s, v) => s + (v.importe ?? 0), 0),
    partidasPlanas: abonosPend._count._all + pagosPend._count._all + descuentosPend._count._all,
    cargosPartidas: valuados.length,
    cargosSinPrecio: valuados.filter((v) => v.precio === null).length,
  });

  return { ...totales, saldo: saldoDeTotales(totales), pendiente };
}

/**
 * Calcula el SALDO derivado de un maquilero de la empresa activa (A9). Permiso `esma.ver-pagos`.
 * Devuelve el desglose (cargos/abonos/pagos/descuentos) + el saldo + lo `pendienteRevision` (lo
 * capturado que aún no suma); todo en null si se ocultan importes.
 */
export async function saldoDeMaquilero(
  sesion: SesionUsuario,
  idMaquilero: number,
  parametros: z.input<typeof esquemaSaldoQuery> = {},
  bd?: ContextoBd,
): Promise<SaldoSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const filtros: SaldoQuery = validarEntrada(esquemaSaldoQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const maquilero = await cliente.proveedor.findUnique({
    where: { id: idMaquilero },
    select: { nombre: true },
  });
  if (maquilero === null) {
    throw new ErrorNoEncontrado('Proveedor', idMaquilero);
  }

  const desglose = await calcularSaldoMaquilero(
    cliente,
    idEmpresa,
    idMaquilero,
    filtros.conFactura,
  );

  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const oculto = <T>(valor: T): T | null => (puedeVerImportes ? valor : null);

  return {
    idMaquilero,
    maquilero: maquilero.nombre,
    conFactura: filtros.conFactura ?? null,
    totalCargos: oculto(desglose.totalCargos),
    totalAbonos: oculto(desglose.totalAbonos),
    totalPagos: oculto(desglose.totalPagos),
    totalDescuentos: oculto(desglose.totalDescuentos),
    saldo: oculto(desglose.saldo),
    // El CONTEO no se oculta (no es un importe): la regla vive en `pendienteParaSalida`.
    pendienteRevision: pendienteParaSalida(desglose.pendiente, puedeVerImportes),
  };
}
