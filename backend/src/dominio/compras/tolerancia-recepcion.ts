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
 *     `recibida_parcial` para siempre. El renglón se cierra dentro de una **banda de tolerancia por
 *     debajo** de lo pedido (por arriba nunca estorba: recibir más ya cumple).
 *  3. *"En avíos también puede haber una diferencia."* → la banda **NO es exclusiva de la tela**: lo
 *     que llega nunca cuadra al gramo ni a la pieza. Lo que sí es distinto por material es CUÁNTA
 *     diferencia es normal, y por eso la banda vive en una constante por tipo (hoy 5% en las dos,
 *     el único número que Daniel puso; cambiar una NO toca la otra).
 *
 * **Lo que NO hace todavía** (segunda etapa, decidida así por Daniel: *"lo podemos hacer en una
 * segunda etapa… ahorita ya quiero terminar con eso"*): **autorizar** una recepción cuya diferencia
 * pase de la banda. Hoy una diferencia mayor simplemente NO cierra el renglón (queda
 * `recibida_parcial`, visible en el tablero de compras); no se bloquea ni se pide permiso a nadie.
 *
 * Lo que SÍ está desde antes, y es la otra mitad de la petición (*"siempre debe de haber un campo
 * para definir lo que se recibe realmente"*): la cantidad recibida **siempre se captura** —
 * `recibirCompra` para avíos y la factura de `entradas-tela` para telas— y **nunca se asume igual a
 * la pedida**; el dominio no la rechaza por diferir, ni por arriba ni por abajo.
 */

/** Tolerancia por redondeo decimal (las cantidades se guardan con 4 decimales). */
export const TOLERANCIA_REDONDEO = 1e-6;

/**
 * Fracción de MENOS que se acepta para dar un renglón por surtido, POR TIPO de material.
 *
 * Las dos valen 5% —el único número que Daniel dio (*"el proveedor puede entregar +/− 5%"*)— pero
 * viven separadas a propósito: si mañana resulta que en piezas contadas se tolera menos que en kilos
 * de tela, se cambia una sin tocar la otra. La segunda etapa (autorizar diferencias mayores) usará
 * estos mismos números.
 */
export const TOLERANCIA_POR_TIPO = {
  /** Telas: se compran por peso/metraje y el proveedor entrega ±5%. */
  tela: 0.05,
  /** Avíos y líneas libres: *"en avíos también puede haber una diferencia"*. */
  avio: 0.05,
} as const;

/** Tipo de material del renglón, para elegir su banda. */
export type TipoRenglonCompra = keyof typeof TOLERANCIA_POR_TIPO;

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
  /** Tipo del renglón: elige la banda. Los renglones libres van como `avio`. */
  tipo: TipoRenglonCompra;
}

/**
 * Mínimo que hay que recibir para dar por surtida una cantidad pedida: lo pedido menos la banda de
 * su tipo de material.
 */
export function minimoParaSurtir(pedido: number, tipo: TipoRenglonCompra): number {
  return pedido * (1 - TOLERANCIA_POR_TIPO[tipo]);
}

/**
 * ¿El renglón quedó SURTIDO? Se cierra cuando el cuerpo alcanza su mínimo Y —solo si la OC pidió
 * complemento— el complemento alcanza el suyo. Un renglón de cantidad pedida 0 (borde) se considera
 * surtido: no hay nada que esperar.
 */
export function renglonSurtido(renglon: RenglonSurtido): boolean {
  const cuerpoOk =
    renglon.recibido + TOLERANCIA_REDONDEO >= minimoParaSurtir(renglon.pedido, renglon.tipo);
  if (!cuerpoOk) {
    return false;
  }
  const pedidoComplemento = renglon.pedidoComplemento ?? 0;
  if (pedidoComplemento <= 0) {
    return true; // esta tela no lleva complemento (o no es tela): nada que esperar
  }
  return (
    (renglon.recibidoComplemento ?? 0) + TOLERANCIA_REDONDEO >=
    minimoParaSurtir(pedidoComplemento, renglon.tipo)
  );
}

/**
 * Cuánto FALTA por recibir de un renglón (cuerpo + complemento), en unidades. Cero cuando el renglón
 * ya quedó surtido — dentro de la banda lo que falte deja de contar como faltante, que es justo lo
 * que Daniel pidió: *"la cantidad que se recibe nunca va a coincidir exacto con la OC"*.
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
