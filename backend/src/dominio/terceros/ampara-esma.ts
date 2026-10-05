/**
 * ⭐⭐ FILA 0.252 — EL COMPROBANTE DE UNA DEUDA QUE VIVE EN EsMa. La definición ÚNICA de qué
 * movimiento del motor de terceros SUMA al saldo y cuál sólo lo AMPARA.
 *
 * DANIEL (5-oct-2026): *«Se valida la recepción en EsMa. Ahí se sube a su estado de cuenta lo que
 * debemos de pagar. Y de ahí confirmamos con él los montos para que haga su factura. Sí pueden
 * facturar cosas adicionales a la maquila (transporte, corte, o cualquier otro concepto de
 * reparaciones, etc).»* Y sobre lo adicional: *«Se captura como cargo adicional»* (el «abono» de
 * EsMa, que suma a la deuda del maquilero).
 *
 * ⇒ Para un proveedor de rubro MAQUILA, **EsMa es el único libro de la deuda**. Su CFDI no crea
 * deuda: es el COMPROBANTE fiscal de lo que EsMa ya le debe. Hasta la 0.252 el importador lo
 * registraba como un cargo más del motor y el saldo del maquilero salía al DOBLE (un recibo de
 * $11,600 + su factura de $11,600 = $23,200), y la corrida —que al maquilero le paga en EsMa— nunca
 * bajaba el cargo del motor.
 *
 * ## Las tres piezas, y por qué viven juntas
 *
 *  • **quién se marca** ({@link debeAmpararEsMa}): la factura o nota de crédito de un proveedor de
 *    rubro maquila SIN orden de compra. La aplican el motor ({@link reglaDeMaquilaDelMotor}, para
 *    toda alta: CFDI, ruta genérica, CxP) y el ETL de apertura (`terceros/migracion.ts`), que
 *    inserta por lotes sin pasar por el alta. Con OC es
 *    una compra de material (el caso mixto, <1 % según Daniel: *«Lo meteríamos como cargo
 *    adicional. No tiene caso hacer todo el desarrollo para 50 metros de elástico»*), y se queda
 *    como deuda del motor, igual que hasta hoy;
 *  • **el filtro de Prisma** ({@link SUMA_AL_SALDO}) para las sumas que van por el cliente;
 *  • **el mismo filtro en SQL crudo** ({@link SQL_SUMA_AL_SALDO}) para los agregados con `GROUP BY`.
 *
 * Si cada suma escribiera su propio `ampara_esma = false`, bastaría que una se quedara atrás para
 * que la bandeja dijera una cosa y el estado de cuenta otra — exactamente el defecto que esta fila
 * viene a cerrar, en otra forma.
 *
 * ## La marca se GUARDA, no se deriva
 *
 * El rubro sale de los ROLES del proveedor, y los roles cambian. Si la marca se calculara en vivo,
 * quitarle a alguien el rol de maquila convertiría de golpe todas sus facturas pasadas en deuda.
 * Se decide UNA vez, al dar de alta, y el inverso de una cancelación la COPIA (si no, el inverso
 * restaría del saldo un cargo que nunca sumó).
 */
import { Prisma, type OrigenMovimientoTercero } from '../../datos/index.js';

import { ErrorValidacion } from '../../comun/errores.js';
import type { ClienteLectura, Tx } from '../../comun/transaccion.js';
import { rubroDeProveedor } from '../pagos/beneficiarios.js';

/**
 * Filtro de Prisma: «el movimiento SUMA al saldo». Se esparce en el `where` de toda suma de saldo,
 * aging o días vencidos del motor. **No** se usa en los listados (estado de cuenta, reporte del
 * contador): ahí el comprobante se VE, sólo que no cuenta.
 */
export const SUMA_AL_SALDO = {
  amparaEsMa: false,
} as const satisfies Prisma.MovimientoTerceroWhereInput;

/**
 * El MISMO filtro, en SQL crudo, para los agregados sobre `movimientos_tercero`. Va atado al alias
 * **`m`**, que es el que usan todos los agregados del motor (`cxp.ts`, `dias-vencidos.ts`,
 * `reportes-fiscales.ts`); una consulta con otro alias no lo puede usar sin cambiarlo aquí.
 */
export const SQL_SUMA_AL_SALDO = Prisma.sql`NOT m."ampara_esma"`;

/** Orígenes que un CFDI de proveedor puede tener (`origenDeTipoComprobante`). */
const ORIGENES_COMPROBANTE: readonly OrigenMovimientoTercero[] = [
  'factura_proveedor',
  'nota_credito',
];

/**
 * ¿Este CFDI de proveedor AMPARA deuda de EsMa? Pieza pura: sí cuando es factura o nota de crédito,
 * va SIN liga a una operación de compra (`refTipo` ausente) y el proveedor es de rubro maquila (tiene
 * un rol de EsMa, la misma frontera que la corrida usa para pagarle en EsMa).
 */
export function debeAmpararEsMa(datos: {
  origen: OrigenMovimientoTercero;
  refTipo: string | null | undefined;
  codigosDeRol: readonly string[];
}): boolean {
  return (
    ORIGENES_COMPROBANTE.includes(datos.origen) &&
    (datos.refTipo === undefined || datos.refTipo === null) &&
    rubroDeProveedor(datos.codigosDeRol) === 'maquila'
  );
}

/** Los códigos de rol de UN proveedor (en la transacción del llamador, si la hay). */
export async function rolesDeProveedor(tx: ClienteLectura, idProveedor: number): Promise<string[]> {
  const filas = await tx.proveedorRol.findMany({
    where: { idProveedor },
    select: { rol: { select: { codigo: true } } },
  });
  return filas.map((f) => f.rol.codigo);
}

/** ¿El proveedor es de rubro maquila (tiene algún rol de EsMa)? En la tx del llamador, si la hay. */
export async function esProveedorDeMaquila(
  tx: ClienteLectura,
  idProveedor: number,
): Promise<boolean> {
  return rubroDeProveedor(await rolesDeProveedor(tx, idProveedor)) === 'maquila';
}

/**
 * Fila 0.252 — el rechazo de un movimiento MANUAL a un maquilero en el motor. Se exporta para que las
 * pruebas lo pinen por su texto completo.
 */
export const MENSAJE_MAQUILA_SE_CAPTURA_EN_ESMA =
  'Este proveedor es de maquila: sus cargos adicionales, pagos y descuentos se capturan en su ' +
  'estado de cuenta de EsMa (la corrida le paga allí). Capturados aquí quedarían en un libro ' +
  'aparte que nunca se salda, y su deuda contada en dos lados.';

/**
 * Orígenes que a un maquilero NO se le capturan en el motor, porque su deuda vive en EsMa:
 *  • `entrada_sin_factura` — lo adicional que cobre (transporte, corte, reparaciones) es un CARGO
 *    ADICIONAL de EsMa (Daniel, 5-oct-2026); en el motor no se pagaría nunca;
 *  • `pago`, `abono`, `descuento` — se le paga y se le descuenta en EsMa; en el motor dejarían un
 *    saldo negativo permanente, porque no hay cargo del motor contra el cual netear.
 * La factura y la nota de crédito NO están aquí: ésas entran, como comprobante ({@link debeAmpararEsMa}).
 */
const ORIGENES_SOLO_EN_ESMA: readonly OrigenMovimientoTercero[] = [
  'entrada_sin_factura',
  'pago',
  'abono',
  'descuento',
];

/** ¿Este alta a un proveedor es un movimiento que, si es maquilero, va en EsMa? Pieza pura. */
export function esMovimientoManualAMaquila(datos: {
  origen: OrigenMovimientoTercero;
  codigosDeRol: readonly string[];
}): boolean {
  return (
    ORIGENES_SOLO_EN_ESMA.includes(datos.origen) &&
    rubroDeProveedor(datos.codigosDeRol) === 'maquila'
  );
}

/** Lo que el dominio (nunca el API) le dice al motor sobre la regla de maquila de un alta. */
export interface OpcionesReglaMaquila {
  /**
   * La marca ya decidida por el llamador, que manda sobre la derivación. La usa la CORRECCIÓN de un
   * movimiento (fila 0.145): el renglón corregido conserva el significado del original aunque los
   * roles del proveedor hayan cambiado desde entonces (la marca se GUARDA, no se re-deriva).
   */
  amparaEsMa?: boolean;
  /**
   * El pago lo ejecuta la CORRIDA a partir de un renglón ya capturado en la sección «proveedores»
   * (`pagos/corrida.ts`). El libro de ese renglón se decidió —y se congeló— al capturarlo, con los
   * roles de ese momento; si después le agregaron un rol de maquila, la guarda NO revoca esa
   * decisión al cerrar la corrida (tumbaría el cierre entero). Es la única exención, y vale SÓLO
   * para `origen = 'pago'`: con cualquier otro origen la guarda aplica igual.
   */
  pagoDeRenglonCongelado?: boolean;
}

/**
 * ⭐ LA REGLA DE MAQUILA DEL MOTOR, en el punto común de las altas del motor
 * (`registrarMovimientoTerceroInterno`): la ruta genérica `POST /api/terceros/movimientos`, la de
 * CxP, el importador de CFDI, las recepciones y entradas de tela, la corrida y la corrección pasan
 * por aquí. Dentro de la transacción del alta (A2):
 *
 *  • rechaza los movimientos que a un maquilero se le capturan en EsMa
 *    ({@link esMovimientoManualAMaquila});
 *  • devuelve la marca `amparaEsMa` ({@link debeAmpararEsMa}) — o la que el llamador ya decidió.
 *
 * ⚠️ **Los caminos que NO pasan por aquí, y cómo quedan:**
 *  • el ETL de apertura (`terceros/migracion.ts::insertarAperturasMigradas`) inserta por lotes sin el
 *    alta del motor: aplica la MISMA `debeAmpararEsMa` por su cuenta (sólo la marca; el histórico no
 *    se rechaza, REGLA 0-B);
 *  • el inverso de una cancelación se crea directo y COPIA la marca del original.
 *
 * Un cliente nunca se toca: ni se marca ni se rechaza (los roles son de proveedor).
 */
export async function reglaDeMaquilaDelMotor(
  tx: Tx,
  alta: {
    tipoTercero: 'proveedor' | 'cliente';
    idTercero: number;
    origen: OrigenMovimientoTercero;
    refTipo: string | undefined;
  },
  opciones: OpcionesReglaMaquila = {},
): Promise<boolean> {
  if (alta.tipoTercero !== 'proveedor') {
    return opciones.amparaEsMa ?? false;
  }
  const codigosDeRol = await rolesDeProveedor(tx, alta.idTercero);
  // Las recepciones y entradas de tela cargan como `factura_proveedor` CON `refTipo`
  // (`cargo-de-entrada.ts`): el caso mixto nunca llega a esta guarda.
  // La exención de la corrida vale SÓLO para un `pago` (es lo único que la corrida ejecuta en CxP):
  // pasada con otro origen, la guarda aplica igual.
  const exento = opciones.pagoDeRenglonCongelado === true && alta.origen === 'pago';
  if (!exento && esMovimientoManualAMaquila({ origen: alta.origen, codigosDeRol })) {
    throw new ErrorValidacion(MENSAJE_MAQUILA_SE_CAPTURA_EN_ESMA);
  }
  return (
    opciones.amparaEsMa ??
    debeAmpararEsMa({ origen: alta.origen, refTipo: alta.refTipo, codigosDeRol })
  );
}
