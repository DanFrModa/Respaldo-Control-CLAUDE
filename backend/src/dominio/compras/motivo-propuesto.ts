/**
 * ⭐ Fila 0.231 (§Post-F9.245(b) + §Post-F9.277) — **¿LA OC QUE SALE DE LA EXPLOSIÓN ES DEL
 * SOBRE-CORTE?** Regla PURA (sin base de datos) para poder medirla caso por caso.
 *
 * Daniel planteó el sobre-corte como *«una segunda pasada después de cortar»* que pide exactamente
 * la diferencia (fila 0.232). Esa segunda pasada se reconoce por tres hechos de CADA línea que se va
 * a escribir:
 *  1. **es un AVÍO** — el sobre-corte sube la base de los avíos, no la de la tela (default de la
 *     0.232: *«la tela ya salió antes de cortar»*); una tela en la segunda pasada es un faltante
 *     normal, no material del extra;
 *  2. **su orden se cortó de más** (`piezasSobreCorte > 0` en el snapshot que se va a comprar);
 *  3. **lo que ya estaba comprado CUBRÍA LO PEDIDO** ({@link cubriaLoPedido}) — o sea que lo que
 *     falta hoy es, en cantidad, el extra del corte y nada más.
 *
 * 🔴 **La 3 se mide POR CANTIDAD, no por «ya había OC»** (corrección del reviewer de la 0.231, H1).
 * `piezasSobreCorte` se queda fijo para siempre, así que con sólo «ya había OC» cualquier compra
 * posterior de esa orden salía como sobre-corte: una primera compra CORTA (500 de 600 botones) hacía
 * pasar por extra los 100 que faltaban de lo pedido; y una receta corregida después de cortar (6 → 8
 * por prenda, fila 0.257) hacía pasar por extra la corrección entera. Ninguno de los dos es sobrecosto
 * del corte. Si lo comprado no llegaba a lo pedido, la línea es compra normal (y la OC, mixta o normal).
 *
 * El resultado:
 *  • TODAS las líneas cumplen ⇒ `'sobre-corte'` (la OC nace con ese motivo propuesto);
 *  • NINGUNA ⇒ `null` (compra normal, sin aviso);
 *  • ALGUNAS ⇒ `'mixto'`: el sistema no adivina — nace sin motivo y la previa lo avisa, porque
 *    etiquetar toda la OC como sobre-corte inflaría el sobrecosto, y no etiquetarla lo escondería.
 */
import { requeridoAvioReceta, type AvioRecetaR18 } from '../produccion/receta-avios.js';
import { claveMaterial } from './comprometido-en-oc.js';

export type PropuestaDeMotivo = 'sobre-corte' | 'mixto' | null;

/** Lo que la regla necesita saber de cada línea que SE VA A ESCRIBIR en la OC. */
export interface LineaParaMotivo {
  tipo: 'tela' | 'avio';
  /** ¿La orden de la línea trae sobre-corte en su snapshot (`piezasSobreCorte > 0`)? */
  ordenConSobreCorte: boolean;
  /** ¿Lo que esa orden ya tenía comprado de ese material cubría lo PEDIDO? ({@link cubriaLoPedido}) */
  cubriaLoPedido: boolean;
}

/**
 * Tolerancia por renglón del snapshot al comparar lo comprado contra lo pedido. **Por qué existe y
 * por qué es ésta:** la necesidad pedida se calcula EXACTA (sin redondear), pero lo comprado vive a
 * 2 decimales (`redondearCantidadCompra`, columna `Decimal(14,2)`): cada renglón del snapshot (uno
 * por color) se redondea por su cuenta antes de pasar a la OC —hasta medio centavo cada uno, y el
 * pendiente de cada renglón vuelve a redondearse al sumarse en la línea— y el reparto entre OP deja
 * el residuo de 0.01 en la última. Medido: no hay redondeo a paquete ni a entero en la explosión
 * (ningún `ceil`). La cota es un centavo por renglón más uno por el reparto; NO cubre ninguna
 * diferencia de escala (desde la corrección H5 la necesidad ya no se escala, se calcula), así que
 * más tolerancia convertiría en «extra» una compra que de verdad se quedó corta.
 */
export const TOLERANCIA_POR_RENGLON = 0.01;

/** Lo que una orden ya tenía de UN material, y lo que la receta le pide A LO PEDIDO. */
export interface CoberturaDeMaterial {
  /** Σ requerido del snapshot (a la base CON el sobre-corte). */
  requerido: number;
  /** Σ a comprar del snapshot (= requerido − lo que cubre el stock, en los genéricos). */
  aComprar: number;
  /**
   * El requerido EXACTO a la matriz PEDIDA (sin el sobre-corte), con la MISMA regla R18 que la
   * explosión ({@link requeridoPedidoDelAvio}). `null` = no se pudo calcular (no hay renglón de
   * receta): entonces no se puede afirmar que lo comprado cubría nada.
   */
  requeridoPedido: number | null;
  /** Lo que ya estaba resuelto ANTES de esta compra: en OC viva + dado por cubierto. */
  yaComprado: number;
  /** Renglones del snapshot de ese material en esa orden (uno por color): base de la tolerancia. */
  renglones: number;
}

/**
 * ⭐ ¿Lo que ya estaba comprado cubría la necesidad A LO PEDIDO? Pura.
 *
 * Necesidad pedida = `requeridoPedido − stock`, con `stock = requerido − aComprar` (lo que el neteo
 * de genéricos ya tomó del almacén; 0 en los no genéricos). «Ya comprado» = en OC viva + dado por
 * cubierto: el MISMO criterio único con el que el plan decide qué falta (§Post-F9.99), para que una
 * marca «con esto queda cubierto» no convierta el resto en «normal».
 *
 * 🔴 **H5 del reviewer: la necesidad es EXACTA, no una regla de tres.** Hasta la 2ª vuelta se
 * escalaba `requerido × pedidas / base`, y con consumo distinto por talla eso falla justo en el caso
 * principal: el corte de más en la talla de consumo MAYOR sobrestimaba lo pedido (la OC de pura
 * segunda pasada salía mixta, o normal sin aviso) y en la talla MENOR lo subestimaba (una compra
 * corta pasaba por sobre-corte).
 */
export function cubriaLoPedido(c: CoberturaDeMaterial): boolean {
  if (c.requeridoPedido === null) return false;
  const stock = Math.max(0, c.requerido - c.aComprar);
  const necesidadPedida = Math.max(0, c.requeridoPedido - stock);
  const tolerancia = TOLERANCIA_POR_RENGLON * (c.renglones + 1);
  return c.yaComprado + tolerancia >= necesidadPedida;
}

/**
 * ⭐ H5 — **EL REQUERIDO DE UN AVÍO A LA MATRIZ PEDIDA**, con la MISMA función que la explosión
 * (`requeridoAvioReceta`, R18) y no con una copia. Se calcula a nivel ORDEN (todas sus tallas
 * sumadas) y no color por color como la explosión, y da lo MISMO: la regla es aditiva por talla
 * (Σ consumo_talla × piezas_talla, o consumo × total sin consumo por talla), así que sumar los
 * colores antes o después no cambia el resultado. Por la misma razón no le afectan los PACKS (dos
 * renglones del mismo color) ni los colores FUSIONADOS: la matriz pedida por talla es la misma.
 */
export function requeridoPedidoDelAvio(
  receta: AvioRecetaR18,
  pedidasPorTalla: ReadonlyMap<number, number>,
): number {
  let total = 0;
  for (const piezas of pedidasPorTalla.values()) total += piezas;
  return requeridoAvioReceta(receta, total, pedidasPorTalla).requerido;
}

/** Lo mínimo de un renglón del snapshot de la explosión (`RequerimientoOrden`) para la regla. */
export interface RenglonDelSnapshot {
  idOrden: number;
  idTela: number | null;
  idAvio: number | null;
  cantidadRequerida: { toString(): string } | number;
  cantidadAComprar: { toString(): string } | number;
}

/** Lo que el snapshot pide de UN material en UNA orden, con sus renglones de color sumados. */
export type SnapshotDeMaterial = Pick<CoberturaDeMaterial, 'requerido' | 'aComprar' | 'renglones'>;

/** Llave (orden, material) — el material con la `claveMaterial` de `comprometido-en-oc.ts`. */
export function llaveOrdenMaterial(idOrden: number, claveDelMaterial: string): string {
  return `${String(idOrden)}|${claveDelMaterial}`;
}

/**
 * Suma el snapshot por (orden, material): requerido y a comprar se SUMAN entre los renglones de
 * color (como suma lo comprado en la OC) y se CUENTAN los renglones (cada uno aporta su centavo de
 * redondeo a la tolerancia).
 */
export function snapshotPorMaterial(
  filas: readonly RenglonDelSnapshot[],
): Map<string, SnapshotDeMaterial> {
  const salida = new Map<string, SnapshotDeMaterial>();
  for (const f of filas) {
    const llave = llaveOrdenMaterial(f.idOrden, claveMaterial(f));
    const previo = salida.get(llave);
    salida.set(llave, {
      requerido: (previo?.requerido ?? 0) + Number(f.cantidadRequerida),
      aComprar: (previo?.aComprar ?? 0) + Number(f.cantidadAComprar),
      renglones: (previo?.renglones ?? 0) + 1,
    });
  }
  return salida;
}

/** Lo mínimo de una OC del plan para saber qué líneas va a escribir (forma de `PlanProveedor`). */
export interface OcDelPlanParaMotivo {
  renglones: readonly {
    tipo: 'tela' | 'avio';
    idMaterial: number;
    porOrden: readonly { idOrden: number; seEscribe: boolean }[];
  }[];
}

/**
 * Las líneas de una OC del plan, en la forma que pide {@link propuestaDeMotivo}. 🔴 **Sólo las que
 * SE ESCRIBEN** (`seEscribe`): una línea que se queda en cero no compra nada, y dejarla votar podría
 * convertir una OC del extra en «mixta» (o al revés) por material que nunca se pide.
 *
 * @param cubria ¿lo que esa orden ya tenía de ese material cubría lo pedido? (lo responde quien
 *   llama con {@link cubriaLoPedido} sobre el snapshot, `comprometidoEnOc` y lo dado por cubierto).
 */
export function lineasParaMotivo(
  oc: OcDelPlanParaMotivo,
  ordenesConSobreCorte: ReadonlySet<number>,
  cubria: (idOrden: number, tipo: 'tela' | 'avio', idMaterial: number) => boolean,
): LineaParaMotivo[] {
  return oc.renglones.flatMap((r) =>
    r.porOrden
      .filter((l) => l.seEscribe)
      .map((l) => ({
        tipo: r.tipo,
        ordenConSobreCorte: ordenesConSobreCorte.has(l.idOrden),
        cubriaLoPedido: cubria(l.idOrden, r.tipo, r.idMaterial),
      })),
  );
}

/** Decide la propuesta de motivo de UNA OC (un proveedor) a partir de sus líneas. */
export function propuestaDeMotivo(lineas: readonly LineaParaMotivo[]): PropuestaDeMotivo {
  const delExtra = lineas.filter(
    (l) => l.tipo === 'avio' && l.ordenConSobreCorte && l.cubriaLoPedido,
  ).length;
  // Sin líneas del extra (incluida la OC vacía) no hay nada que proponer.
  if (delExtra === 0) return null;
  return delExtra === lineas.length ? 'sobre-corte' : 'mixto';
}

/**
 * El aviso de la previa para una OC mixta. NO bloquea: el comprador puede generar así (nace como
 * compra normal) o elegir el motivo en la previa.
 */
export function avisoDeSobreCorteMixto(proveedor: string): string {
  return (
    `La compra a ${proveedor} junta material del sobre-corte (avíos cuya compra ya cubría lo ` +
    `pedido y ahora se piden de más) con material que todavía faltaba de lo pedido: nace como ` +
    `compra normal, sin motivo. Si es una compra extra, elígele el motivo antes de generar.`
  );
}
