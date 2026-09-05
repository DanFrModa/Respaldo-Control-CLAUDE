/**
 * ¿QUÉ CUENTA POR PAGAR NACE CUANDO ENTRA MERCANCÍA DE UN PROVEEDOR? — **fuente única** (fila 0.129).
 *
 * Daniel (§Post-F9.192, 4-sep-2026): *"la persona que recibe (a partir de una OC) mete las cantidades
 * y precios… **es la misma entrada que se ocupa tanto para inventario como para su estado de
 * cuenta**"* y *"lo ideal es recibir con la factura. Pero si no fuera el caso, está bien dejarla como
 * pendiente. Todo se recibe a partir de la OC. **Tanto telas como avíos**"*.
 *
 * ## Por qué existe este módulo
 *
 * La regla ya estaba escrita —y bien— dentro de `inventarios/entradas-tela.ts`, que es la puerta por
 * la que entra la TELA. Cuando los AVÍOS tuvieron que hacer nacer la misma deuda
 * (`compras/recepciones.ts`), había dos caminos: copiarla o compartirla. Copiada, el día que Daniel
 * cambie de opinión sobre cuándo nace la deuda habría que acordarse de los DOS sitios — y el segundo
 * es justo el que nadie recuerda. Así que la decisión se extrajo TAL CUAL (los cuatro casos y el
 * cerrojo del RFC, sin tocar una coma de su comportamiento) y las dos puertas la llaman.
 *
 * ## Los CUATRO casos (no cambian: son los mismos de §Post-F9.21/§Post-F9.22)
 *
 *  • **Proveedor que FACTURA, con su CFDI ya sellado** → cargo **FISCAL** por el TOTAL del
 *    comprobante (con impuestos — NO la suma de renglones, que va sin IVA), respaldado con el XML.
 *  • **Proveedor que FACTURA, sin CFDI todavía** (llegó con remisión y la factura viene después) →
 *    NO se inventa cargo: se registrará con la factura, que es la que trae el importe bueno. La
 *    entrada queda como *factura pendiente*.
 *  • **Proveedor que NO factura** (`solo_sin`) → nunca va a haber CFDI, así que esperar la factura
 *    sería no registrarle NUNCA la deuda. El cargo nace **NO FISCAL** por lo capturado a mano. Sin
 *    IVA que sumar, esa suma ES lo que se le debe.
 *  • **Proveedor sin la modalidad definida** (los migrados de Access) → se trata como los que
 *    facturan: se espera su CFDI. Nada se inventa sobre un dato que nadie capturó.
 *
 * ⭐ FILA 0.124 — la pregunta se contesta en UN solo campo: `Proveedor.modalidadFacturacion`, vía
 * `emiteFactura()`. La casilla `Proveedor.factura` quedó retirada como verdad y no se lee desde
 * aquí ni desde ninguna otra puerta.
 *
 * Devuelve `null` cuando no hay nada que cobrar. En particular, una entrada sin precios da importe 0
 * y NO genera cargo: registrar una deuda de cero sería ruido, y el motor de terceros exige importe
 * ≥ 0.01. Queda visible en el documento (los renglones sin precio se ven), no callado.
 *
 * ⚠️ **ESTO NO ESCRIBE NADA.** Devuelve el ALTA que el llamador le pasa a
 * `registrarMovimientoTerceroInterno` DENTRO de su propia transacción (A2): así el cargo y el
 * movimiento de inventario son un solo hecho, o no son.
 */
import type { z } from 'zod';

import type { ClaseDeudaRecepcion, esquemaMovimientoTerceroCrear } from '../../contrato/index.js';
import type { ModalidadFacturacion } from '../../datos/index.js';
import { ErrorValidacion } from '../../comun/errores.js';

import { normalizarRfc } from './cfdi/parser-cfdi.js';
import { emiteFactura, exigirRfcDelProveedor } from './facturacion-proveedor.js';

/** Origen del cargo de CxP que nace al confirmar una entrada de mercancía (§Post-F9.21). */
export const ORIGEN_FACTURA_PROVEEDOR = 'factura_proveedor';

/** Discriminador de la operación ligada al cargo: la ENTRADA DE TELA por factura/remisión. */
export const REF_ENTRADA_TELA = 'entrada-tela';

/**
 * Discriminador de la operación ligada al cargo: la RECEPCIÓN de avíos contra una OC (fila 0.129).
 * Es lo que hace la deuda idempotente y reversible: una recepción = a lo sumo un movimiento de
 * tercero, y el reverso lo encuentra por `refTipo` + `refId` para cancelarlo.
 */
export const REF_RECEPCION_COMPRA = 'recepcion-compra';

/**
 * Lo que el cálculo necesita saber del PROVEEDOR. Quien contesta *"¿este proveedor factura?"* es
 * `modalidadFacturacion`, y **sólo ella** desde la fila 0.124: la casilla `Proveedor.factura` quedó
 * retirada como verdad porque la misma pregunta se contestaba en dos campos que nada ataba (un
 * `factura=false` + `solo_con` partía los pagos del proveedor en dos según la puerta por la que
 * entraran). Aquí se recibe la modalidad TAL CUAL y la interpreta `emiteFactura`.
 */
export interface ProveedorDelCargo {
  /** Id del proveedor: es el tercero al que se le va a deber. */
  id: number;
  nombre: string;
  rfc: string | null;
  /**
   * Cómo factura (`solo_con`/`solo_sin`/`ambos`, F6-E4 decisión (h); obligatoria en el alta desde
   * la fila 0.110). NULL = proveedor migrado de Access al que nadie se lo preguntó (REGLA 0-B).
   */
  modalidadFacturacion: ModalidadFacturacion | null;
}

/** El CFDI ya sellado en el documento, cuando lo hay (sólo la entrada de tela lee XML hoy). */
export interface SelloDelCargo {
  uuid: string;
  /** TOTAL del comprobante (CON impuestos): es lo que se le debe, no la suma de renglones. */
  total: number;
  /** RFC del EMISOR. Si falta, el cargo fiscal NO se deja nacer (falla cerrado). */
  rfc: string | null;
  /** Archivo R2 del XML, si se guardó. */
  idArchivo: string | null;
}

/** Todo lo que hace falta para decidir el cargo de UNA entrada de mercancía. */
export interface EntradaQueGeneraCargo {
  proveedor: ProveedorDelCargo;
  /** Fecha del documento en `YYYY-MM-DD` (la del movimiento de cuenta corriente). */
  fecha: string;
  /** Discriminador de la operación: {@link REF_ENTRADA_TELA} / {@link REF_RECEPCION_COMPRA}. */
  refTipo: string;
  /** Id de esa operación (la entrada o la recepción que ya existe en ESTA transacción). */
  refId: number;
  /** Folio del documento, para que el movimiento diga de dónde salió. */
  folio: number;
  /** Número del documento del proveedor (factura/remisión). */
  numeroDocumento: string;
  /**
   * Cómo se llama el documento, en singular y con mayúscula inicial: `'Entrada de tela'`,
   * `'Recepción de compra'`. Se usa tal cual en las observaciones del movimiento y, con la inicial
   * en minúscula, dentro de los mensajes de error.
   */
  etiqueta: string;
  /** CFDI sellado en el documento, si lo hay. Sin él se cae a los casos 2/3/4. */
  cfdi?: SelloDelCargo | null;
  /**
   * Importe capturado a mano (Σ cantidad × precio de los renglones), SIN redondear: el redondeo a
   * centavos lo hace esta función, en un solo lugar. Sólo se usa en el caso del proveedor que NO
   * factura (con CFDI manda el total del comprobante).
   */
  importeCapturado: number;
}

/** El alta de movimiento de terceros que hay que registrar, o `null` si no nace ninguno. */
export type CargoDeEntrada = z.input<typeof esquemaMovimientoTerceroCrear>;

/** La etiqueta como se lee DENTRO de una frase ("la entrada de tela 5 trae…"). */
function enFrase(etiqueta: string): string {
  return etiqueta.charAt(0).toLowerCase() + etiqueta.slice(1);
}

/**
 * Decide el cargo de cuenta por pagar que nace de una entrada de mercancía. Ver el TSDoc del módulo
 * para los cuatro casos. Lanza `ErrorValidacion` sólo en el camino FISCAL, cuando el CFDI y el
 * proveedor no cuadran (ver los cerrojos de abajo).
 */
export function cargoDeEntradaDeProveedor(entrada: EntradaQueGeneraCargo): CargoDeEntrada | null {
  const { proveedor, folio, numeroDocumento, etiqueta } = entrada;
  const comun = {
    tipoTercero: 'proveedor',
    idTercero: proveedor.id,
    fecha: entrada.fecha,
    origen: ORIGEN_FACTURA_PROVEEDOR,
    refTipo: entrada.refTipo,
    refId: entrada.refId,
  } as const;

  const cfdi = entrada.cfdi ?? null;
  if (cfdi !== null) {
    // ÚLTIMO CERROJO antes de escribir un cargo FISCAL (A4, deny-by-default): el cargo viaja con el
    // RFC del EMISOR como `rfcTercero`, así que el proveedor al que se le va a deber tiene que ser
    // ese mismo. Las puertas de captura ya lo exigen (`sellarCfdiEnEntrada` al subir el XML y
    // `exigirSelloCompatibleConProveedor` al editar el borrador); esto es la red por si mañana
    // apareciera un tercer camino que selle un CFDI — un cargo fiscal a nombre de quien no facturó
    // no se puede corregir: el UUID queda consumido para siempre.
    // Y la red FALLA CERRADA (revisión del 11-ago-2026): si el cargo es fiscal pero no se sabe QUÉ
    // RFC lo emitió, no hay nada que comparar — y una comprobación que no puede comprobar no debe
    // dejar pasar (A4, deny-by-default).
    if (cfdi.rfc === null) {
      throw new ErrorValidacion(
        `La ${enFrase(etiqueta)} ${String(folio)} trae el total de la factura (UUID ${cfdi.uuid}) ` +
          `pero no el RFC de quien la emitió: no se puede confirmar un cargo fiscal sin saber a ` +
          `nombre de quién nace. Vuelve a subir el XML de la factura en el borrador.`,
      );
    }
    const rfcProveedor = exigirRfcDelProveedor(
      proveedor,
      `confirmar la ${enFrase(etiqueta)} con su factura (CFDI)`,
    );
    if (normalizarRfc(rfcProveedor) !== normalizarRfc(cfdi.rfc)) {
      throw new ErrorValidacion(
        `La factura de esta ${enFrase(etiqueta)} la emitió el RFC ${cfdi.rfc}, pero el documento ` +
          `está a nombre del proveedor "${proveedor.nombre}" (RFC ${rfcProveedor}): ` +
          `la cuenta por pagar nacería a nombre de quien no facturó.`,
      );
    }
    return {
      ...comun,
      importe: cfdi.total,
      esFiscal: true,
      uuidCfdi: cfdi.uuid,
      // El RFC del EMISOR viaja al cargo igual que en una importación de CFDI de F9: es lo que el
      // reporte fiscal del contador imprime. Sin él, la misma factura se veía distinta según por
      // dónde hubiera entrado (con RFC desde Finanzas, con "—" desde el almacén de telas). Aquí ya
      // no puede faltar: el cerrojo de arriba truena si es null.
      rfcTercero: cfdi.rfc,
      ...(cfdi.idArchivo === null ? {} : { idArchivoCfdi: cfdi.idArchivo }),
      observaciones: `${etiqueta} ${String(folio)} · factura ${numeroDocumento}`,
    };
  }

  // ⭐⭐ LA DECISIÓN (fila 0.124: UNA sola pregunta). `emiteFactura` devuelve `false` SÓLO con
  // `solo_sin` — el único proveedor del que nunca va a llegar un CFDI, y por tanto el único al que
  // hay que registrarle la deuda ahora o no registrársela nunca. Con `true` (`solo_con`/`ambos`) y
  // con `null` (migrado, nadie lo definió) se espera el comprobante: no se inventa un importe sin
  // impuestos ni se decide por quien no capturó nada.
  if (emiteFactura(proveedor.modalidadFacturacion) !== false) {
    return null;
  }

  // Se redondea a centavos: el importe vive en DECIMAL(14,2) y cantidad×precio puede traer cola.
  const aPagar = Math.round(entrada.importeCapturado * 100) / 100;
  if (aPagar < 0.01) return null;

  return {
    ...comun,
    importe: aPagar,
    esFiscal: false,
    observaciones:
      `${etiqueta} ${String(folio)} · ${numeroDocumento} · ` +
      `proveedor sin factura (importe capturado a mano)`,
  };
}

/**
 * Cómo quedó la DEUDA de una entrada ya guardada, para que la pantalla lo diga sin volver a
 * calcular la regla (A1). Se lee de los HECHOS, no de la modalidad del proveedor: o hay un cargo, o
 * no lo hay (con una excepción: la recepción que nació de una entrada de tela, cuya deuda vive en
 * ese otro documento). Las clases y su significado están documentadas en el contrato
 * (`CLASES_DEUDA_RECEPCION`, `contrato/esquemas/recepcion.ts`), que es de donde las lee la UI.
 */
export function claseDeDeuda(datos: {
  hayCargo: boolean;
  importe: number;
  /** ¿La generó una entrada de tela por factura? Entonces su deuda vive allá (§Post-F9.14). */
  deEntradaTela?: boolean;
  /** ¿La entrada se reversó/canceló? Entonces ya no se debe nada por ella. */
  anulada?: boolean;
  /** ¿El cargo que nació está CANCELADO (por el reverso, o a mano en Finanzas)? Idem. */
  cargoCancelado?: boolean;
}): ClaseDeudaRecepcion {
  // Lo PRIMERO: si el hecho se deshizo, no hay deuda que anunciar — aunque el cargo exista (queda
  // como traza, D3) y aunque el importe siga a la vista. Antes esto lo decidía la pantalla, y por
  // eso el API contestaba `cargo-no-fiscal` de una recepción ya reversada.
  if (datos.anulada === true || datos.cargoCancelado === true) return 'cancelada';
  if (datos.deEntradaTela === true) return 'en-entrada-de-tela';
  if (datos.hayCargo) return 'cargo-no-fiscal';
  return Math.round(datos.importe * 100) / 100 < 0.01 ? 'sin-importe' : 'factura-pendiente';
}
