/**
 * SALDO de un maquilero (F6-E4; doc 07-EsMa §1, ex `EsMa_SaldosMaq`). El saldo NUNCA se persiste: es
 * la VISTA DERIVADA por suma (D3 extendido a saldos, 07 §6.2). Fórmula EXACTA del viejo con "ceronulo"
 * (nulos = 0):
 *
 *   saldo = Σ(cantidadReal × precioReal de cargos VALIDADOS no sin-costo)
 *         + Σ abonos − Σ pagos − Σ descuentos
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
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Redondeo monetario a 2 decimales (evita artefactos de coma flotante en las sumas de productos). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cláusula `where` de facturación para un segmento (o `{}` si no se segmenta). */
function conFacturaWhere(segmento: 'con' | 'sin' | undefined): { conFactura?: boolean } {
  if (segmento === undefined) {
    return {};
  }
  return { conFactura: segmento === 'con' };
}

/**
 * Calcula el SALDO derivado de un maquilero de la empresa activa (A9). Permiso `esma.ver-pagos`.
 * Devuelve el desglose (cargos/abonos/pagos/descuentos) + el saldo; todo en null si se ocultan importes.
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

  const factura = conFacturaWhere(filtros.conFactura);

  // Cargos: Σ cantidadReal × precioReal (validados, no sin-costo). Se suman los productos en JS.
  const cargos = await cliente.esMaCargo.findMany({
    where: { idEmpresa, idMaquilero, estado: 'validado', sinCosto: false, ...factura },
    select: { cantidadReal: true, precioReal: true },
  });
  const totalCargos = redondear2(
    cargos.reduce(
      (s, c) => s + (c.cantidadReal?.toNumber() ?? 0) * (c.precioReal?.toNumber() ?? 0),
      0,
    ),
  );

  // Abonos / pagos / descuentos: Σ monto (aggregate).
  const [abonos, pagos, descuentos] = await Promise.all([
    cliente.abonoMaquilero.aggregate({
      where: { idEmpresa, idMaquilero, ...factura },
      _sum: { monto: true },
    }),
    cliente.pagoMaquilero.aggregate({
      where: { idEmpresa, idMaquilero, ...factura },
      _sum: { monto: true },
    }),
    cliente.descuentoMaquilero.aggregate({
      where: { idEmpresa, idMaquilero, ...factura },
      _sum: { monto: true },
    }),
  ]);
  const totalAbonos = redondear2(abonos._sum.monto?.toNumber() ?? 0);
  const totalPagos = redondear2(pagos._sum.monto?.toNumber() ?? 0);
  const totalDescuentos = redondear2(descuentos._sum.monto?.toNumber() ?? 0);
  const saldo = redondear2(totalCargos + totalAbonos - totalPagos - totalDescuentos);

  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const oculto = <T>(valor: T): T | null => (puedeVerImportes ? valor : null);

  return {
    idMaquilero,
    maquilero: maquilero.nombre,
    conFactura: filtros.conFactura ?? null,
    totalCargos: oculto(totalCargos),
    totalAbonos: oculto(totalAbonos),
    totalPagos: oculto(totalPagos),
    totalDescuentos: oculto(totalDescuentos),
    saldo: oculto(saldo),
  };
}
