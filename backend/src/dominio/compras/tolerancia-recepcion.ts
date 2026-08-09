/**
 * ¿CUÁNDO SE CONSIDERA SURTIDO un renglón de orden de compra? (§Post-F9.19)
 *
 * Reglas dictadas por Daniel (7-ago-2026):
 *
 *  1. *"Se debe de marcar como recibido si se recibe lo mismo que está en la OC. Si en la OC lleva
 *     cardigan, se debe de recibir el cardigan."* → el renglón se cierra contra lo que la OC PIDIÓ,
 *     **cuerpo y complemento**. Si la OC no pide complemento, no hay nada que esperar por ese lado
 *     (*"no siempre lleva cardigan"*).
 *  2. *"En telas nunca se recibe la cantidad exacta que se pide. Si se piden 400 kilos, el proveedor
 *     puede entregar +/− 5%."* → exigir la cantidad EXACTA dejaría toda OC de tela en
 *     `recibida_parcial` para siempre. Así que en TELA el renglón se cierra dentro de una **banda de
 *     tolerancia del 5% por debajo** de lo pedido (por arriba nunca estorba: recibir más ya cumple).
 *
 * **Lo que NO hace todavía** (segunda etapa, decidida así por Daniel: *"lo podemos hacer en una
 * segunda etapa… ahorita ya quiero terminar con eso"*): **autorizar** una recepción cuya diferencia
 * pase del 5%. Hoy una diferencia mayor simplemente NO cierra el renglón (queda `recibida_parcial`,
 * visible en el tablero de compras); no se bloquea ni se pide permiso a nadie.
 *
 * En AVÍOS y líneas libres NO hay banda: son piezas contadas, y ahí lo pedido sí llega exacto. La
 * única tolerancia es el ruido de redondeo decimal.
 */

/** Tolerancia por redondeo decimal (las cantidades se guardan con 4 decimales). */
export const TOLERANCIA_REDONDEO = 1e-6;

/**
 * Fracción de MENOS que se acepta en TELA para dar un renglón por surtido (5%: *"si se piden 400
 * kilos, el proveedor puede entregar +/− 5%"*). La segunda etapa usará el mismo número para pedir
 * autorización cuando la diferencia lo pase.
 */
export const TOLERANCIA_TELA = 0.05;

/** Lo que la OC pidió en un renglón y lo que se ha recibido contra él. */
export interface RenglonSurtido {
  /** Cantidad pedida del CUERPO. */
  pedido: number;
  /** Σ recibido del cuerpo (unidad de consumo), de todas las recepciones activas. */
  recibido: number;
  /** Cantidad pedida del COMPLEMENTO (Cardigan), o `null` si esa tela no lo lleva. */
  pedidoComplemento?: number | null;
  /** Σ recibido del complemento. */
  recibidoComplemento?: number;
  /** ¿El renglón es de TELA? Solo la tela tiene banda de tolerancia. */
  esTela: boolean;
}

/**
 * Mínimo que hay que recibir para dar por surtida una cantidad pedida: lo pedido completo en avíos y
 * líneas libres, o lo pedido menos la banda del 5% en tela.
 */
export function minimoParaSurtir(pedido: number, esTela: boolean): number {
  return esTela ? pedido * (1 - TOLERANCIA_TELA) : pedido;
}

/**
 * ¿El renglón quedó SURTIDO? Se cierra cuando el cuerpo alcanza su mínimo Y —solo si la OC pidió
 * complemento— el complemento alcanza el suyo. Un renglón de cantidad pedida 0 (borde) se considera
 * surtido: no hay nada que esperar.
 */
export function renglonSurtido(renglon: RenglonSurtido): boolean {
  const cuerpoOk =
    renglon.recibido + TOLERANCIA_REDONDEO >= minimoParaSurtir(renglon.pedido, renglon.esTela);
  if (!cuerpoOk) {
    return false;
  }
  const pedidoComplemento = renglon.pedidoComplemento ?? 0;
  if (pedidoComplemento <= 0) {
    return true; // esta tela no lleva complemento (o no es tela): nada que esperar
  }
  return (
    (renglon.recibidoComplemento ?? 0) + TOLERANCIA_REDONDEO >=
    minimoParaSurtir(pedidoComplemento, renglon.esTela)
  );
}

/**
 * Cuánto FALTA por recibir de un renglón (cuerpo + complemento), en unidades. Cero cuando el renglón
 * ya quedó surtido — dentro de la banda de tolerancia lo que falte deja de contar como faltante, que
 * es justo lo que Daniel pidió: *"la cantidad que se recibe nunca va a coincidir exacto con la OC"*.
 */
export function faltantePorRecibir(renglon: RenglonSurtido): {
  cuerpo: number;
  complemento: number;
} {
  if (renglonSurtido(renglon)) {
    return { cuerpo: 0, complemento: 0 };
  }
  const pedidoComplemento = renglon.pedidoComplemento ?? 0;
  return {
    cuerpo: Math.max(0, renglon.pedido - renglon.recibido),
    complemento: Math.max(0, pedidoComplemento - (renglon.recibidoComplemento ?? 0)),
  };
}
