/**
 * ⭐⭐ **«¿ESTA ORDEN YA TIENE VIDA?» — LA PREGUNTA, EN UN SOLO LUGAR** (fila 0.150).
 *
 * DANIEL, probando el flujo real: *«¿Qué pasa si me cancelan un pedido, pero la OC ya está
 * producida? **No quiero que se borren las OP en ese caso.** Pero si no hay nada comprado ni
 * producido y borra el pedido está bien cancelar en cascada.»*
 *
 * Hasta esta fila el sistema hacía justo lo contrario: `cancelarPedido` sólo miraba dos cosas —el
 * pedido ya cancelado y la orden CERRADA— y con la casilla de cascada marcada **cancelaba una OP
 * aunque ya estuviera cortada, enviada, comprada y auditada**. La cancelación es suave (D3), así
 * que no se pierde el dato; pero la orden desaparece de los tableros, del WIP y del MRP, y el piso
 * se queda sin la OP con la que está trabajando.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## 🔑 POR QUÉ ESTA FUNCIÓN Y NO `tieneActividadProduccion` A SECAS
 *
 * `tieneActividadProduccion` ({@link requisitos-orden.ts}) ya contestaba una pregunta parecida —y
 * por eso esta fila la **exportó y la reusa** en vez de escribir una cuarta copia del mismo
 * `count`—, pero contesta OTRA pregunta: *«¿puedo degradar el semáforo de completa a capturada?»*,
 * y para eso le basta con mirar `EtapaMovimiento`. No ve compras, ni tela surtida, ni notas de
 * salida, ni cierres de maquila, ni EsMa, ni costo, ni EDR. Copiar ese criterio aquí habría dejado
 * pasar —sin avisar— el pedido cuya tela ya se compró y se surtió: exactamente el caso de Daniel.
 *
 * Es la misma lección que `compras/comprometido-en-oc.ts` dejó escrita: **dos preguntas parecidas
 * llevan dos criterios distintos, cada uno escrito donde se usa** — y el que es más amplio REUSA al
 * más estrecho como una señal más, en vez de duplicarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⚖️ QUÉ CUENTA COMO VIDA — y qué NO, con su razón
 *
 * **CUENTA** (ver {@link SENALES_EN_ORDEN}): la orden cerrada · la receta liberada o reabierta ·
 * etapas vivas (corte/envío/recibo/entrega/empaque) · cierres de maquila no deshechos · cargos EsMa
 * no cancelados · notas de salida vivas (que son también el camino del kardex de AVÍOS) · compras
 * comprometidas · kardex de PT y de TELA vivos · procesos de ruta crítica ya capturados · hitos
 * vivos · auditorías no canceladas · costo guardado · renglones de EDR.
 *
 * **NO cuenta**, y cada exclusión tiene su porqué:
 *  • **`RequerimientoOrden`** (el snapshot del MRP): `mrp.ts` lo borra entero y lo recrea en cada
 *    explosión. Es un DERIVADO regenerable, no un hecho que alguien haya provocado.
 *  • **`RutaOrden` por estar generada**: mismo patrón (`rutaOrden.ts` regenera la ruta). Lo que SÍ
 *    es un hecho es `fechaReal` —alguien capturó ese proceso—, y el propio módulo la conserva a
 *    través del borrado, señal de que ése es el dato que vale.
 *  • **`OrdenTela` / `OrdenAvio` / `OrdenArte`** (la receta CONGELADA): nace con la orden por copia
 *    del BOM del modelo. Existir no es actividad; lo que sí lo es —que alguien la FIRMARA— viaja en
 *    `recetaLiberadaEn`.
 *  • **Etapas CANCELADAS**: ya lo decidió `requisitos-orden.ts` (*«esa actividad se deshizo»*), y
 *    aquí se aplica el mismo criterio a TODAS las familias: cancelado, deshecho o reversado = no
 *    cuenta.
 *  • **OC en BORRADOR**: ⭐ decidido por DANIEL el 7-sep-2026, textual: *«no cuenta como
 *    comprado»*. Por eso se usa {@link ESTATUS_OC_COMPROMETIDA} (autorizada + recibidas) y NO
 *    `ESTATUS_OC_QUE_CUBREN` (que sí incluye el borrador, porque contesta la otra pregunta: *«¿hace
 *    falta volver a comprar esto?»*). Un borrador no compromete a nadie frente al proveedor.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## 🔴 LAS DOS TRAMPAS QUE DEJAN LA GUARDA COJA (medidas, no supuestas)
 *
 * **1. Al kardex se llega por TRES caminos distintos, no por una columna.**
 *    – PT: `MovimientoDetPt.idOrden` (columna real, con FK).
 *    – TELA: **no hay columna**. La salida a orden se marca con la referencia polimórfica
 *      `origenTipo = 'salida-tela-orden'` + `origenId = String(idOrden)` — ⚠️ `origenId` es
 *      **TEXTO** (ADR-0010 §1), así que se compara contra `String(id)`, nunca contra el número.
 *    – AVÍOS: por la **nota de salida** (`NotaSalidaLinea.idOrden`), que es quien genera el
 *      movimiento al confirmarse.
 *    Mirar sólo el camino obvio deja pasar un pedido cuya tela ya se surtió.
 *
 * **2. Cancelar un movimiento NO borra su rastro: lo DUPLICA.** `cancelarMovimientoPt`
 *    (`comun/kardex.ts`) crea el inverso **copiando `idOrden` del detalle original** (para
 *    neutralizar el mismo bucket). Un `count` pelón sobre `MovimientoDetPt.idOrden` **nunca da
 *    cero**, ni cuando toda la actividad se deshizo: la guarda bloquearía PARA SIEMPRE una orden
 *    limpia. Por eso los dos lados se descartan **por el encabezado**:
 *      – el original anulado → tiene inverso (`anuladoPor` no vacío);
 *      – el inverso mismo → apunta a su original (`idMovimientoInverso` no nulo).
 *    Lo mismo vale para la TELA con `cancelarMovimientoMaterial`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A9: **a propósito NO se filtra por empresa.** La pregunta es *«¿alguien ya movió esta orden?»* y
 * cualquier movimiento cuenta; un filtro de empresa sólo podría ESCONDER actividad, que es el lado
 * en el que esta guarda no puede equivocarse. La orden ya viene acotada por su pedido (A9).
 */
import { ESTATUS_OC_COMPROMETIDA } from '../compras/comprometido-en-oc.js';
import { ORIGEN } from '../../comun/origenes.js';
import type { Tx } from '../../comun/transaccion.js';
import { tieneActividadProduccion } from './requisitos-orden.js';

/** Cada FAMILIA de señal que hace que una orden «tenga vida». */
export type SenalActividadOrden =
  | 'cerrada'
  | 'receta-liberada'
  | 'receta-abierta'
  | 'produccion'
  | 'cierre-maquila'
  | 'esma'
  | 'notas-salida'
  | 'compras'
  | 'kardex-pt'
  | 'kardex-tela'
  | 'ruta-critica'
  | 'hitos'
  | 'auditorias'
  | 'costo'
  | 'edr';

/**
 * Cómo se NOMBRA cada señal en un mensaje al usuario. En lenguaje de negocio: quien lee esto está
 * decidiendo si va a Órdenes a cancelar una OP a mano, no depurando el esquema.
 */
export const ETIQUETA_SENAL_ACTIVIDAD: Record<SenalActividadOrden, string> = {
  cerrada: 'está CERRADA',
  'receta-liberada': 'su receta ya está liberada',
  'receta-abierta': 'su receta se abrió para corregir',
  produccion: 'ya tiene producción capturada (corte, envío, recibo o entrega)',
  'cierre-maquila': 'ya se cerró con un maquilero',
  esma: 'ya tiene cargos de maquila',
  'notas-salida': 'ya tiene notas de salida de material',
  compras: 'ya tiene material comprado',
  'kardex-pt': 'ya movió inventario de producto terminado',
  'kardex-tela': 'ya se le surtió tela',
  'ruta-critica': 'ya tiene procesos capturados en su ruta crítica',
  hitos: 'ya tiene hitos registrados',
  auditorias: 'ya tiene auditorías de calidad',
  costo: 'ya tiene su costo guardado',
  edr: 'ya aparece en un estado de resultados',
};

/**
 * ORDEN en que se evalúan y se nombran las señales: de la más elocuente para quien lee («ya tiene
 * producción capturada») a la más administrativa. Es una constante y no el orden de un `Object.keys`
 * para que el mensaje sea ESTABLE (dos ejecuciones iguales dicen lo mismo, en el mismo orden).
 */
const SENALES_EN_ORDEN: readonly SenalActividadOrden[] = [
  'produccion',
  'kardex-pt',
  'kardex-tela',
  'notas-salida',
  'compras',
  'cierre-maquila',
  'esma',
  'auditorias',
  'ruta-critica',
  'hitos',
  'costo',
  'edr',
  'cerrada',
  'receta-liberada',
  'receta-abierta',
];

/**
 * Lo que la ORDEN misma ya contesta, sin una consulta extra. Las tres columnas viajan en la fila
 * que el llamador ya leyó (`cancelarPedido` las trae en su `select`), así que preguntarlas es
 * GRATIS: pedirlas por parámetro —en vez de re-leer la orden aquí— evita una consulta por orden.
 */
export interface OrdenParaActividad {
  id: number;
  /** Sello de «esta orden está cerrada» (la verdad autoritativa; el `estado` es su espejo). */
  cerradaEn: Date | null;
  /** Desarrollo firmó la receta congelada de ESTA orden por completo. */
  recetaLiberadaEn: Date | null;
  /** La receta liberada se volvió a abrir para corregir (otro acto de una persona). */
  recetaAbiertaEn: Date | null;
}

/**
 * ⭐ LA FUNCIÓN. Devuelve TODAS las señales de vida de UNA orden, en el orden de
 * {@link SENALES_EN_ORDEN}. Arreglo vacío = la orden está limpia y se puede cancelar en cascada
 * sin quitarle nada a nadie.
 *
 * Es una LECTURA (no escribe), pero recibe `tx` a propósito: sus llamadores la usan **dentro** de
 * la transacción que va a cancelar, después de tomar el bloqueo de la orden, para que nada se cuele
 * entre la comprobación y el `update` (A2).
 *
 * ⚠️ Es POR ORDEN, no por lote: así puede REUSAR `tieneActividadProduccion` tal cual (una función
 * de una orden) en vez de re-escribir su `count` agrupado, que es justo la duplicación que esta
 * fila vino a pagar. Sus llamadores cancelan «una orden a la vez» —ya lo hacían— y un pedido tiene
 * un puñado de OPs, así que el costo es un puñado de `count` por orden, todos en paralelo.
 */
export async function senalesDeActividadOrden(
  tx: Tx,
  orden: OrdenParaActividad,
): Promise<SenalActividadOrden[]> {
  const idOrden = orden.id;

  const [
    produccion,
    cierreMaquila,
    esma,
    notasSalida,
    lineasCompra,
    ligasCompra,
    kardexPt,
    kardexTela,
    rutaCritica,
    hitos,
    auditorias,
    costo,
    edr,
  ] = await Promise.all([
    // ⭐ REUSO, no copia: la MISMA función que protege el des-completar (`requisitos-orden.ts`).
    tieneActividadProduccion(tx, idOrden),
    tx.cierreMaquilaOrden.count({ where: { idOrden, deshechoEn: null } }),
    tx.esMaCargo.count({ where: { idOrden, estado: { not: 'cancelado' } } }),
    // Las notas VIVAS. Es también el camino del kardex de AVÍOS: el descuento del avío nace al
    // confirmar la nota, y cuelga de este mismo renglón.
    tx.notaSalidaLinea.count({ where: { idOrden, notaSalida: { canceladaEn: null } } }),
    // COMPRAS por los dos caminos: el renglón que nombra la orden y la liga OC↔orden (que el
    // esquema declara derivada de los renglones, pero se mira igual: nunca de menos).
    tx.ordenCompraLinea.count({
      where: { idOrden, ordenCompra: { estatus: { in: [...ESTATUS_OC_COMPROMETIDA] } } },
    }),
    tx.ordenCompraOrden.count({
      where: { idOrden, ordenCompra: { estatus: { in: [...ESTATUS_OC_COMPROMETIDA] } } },
    }),
    // 🔴 TRAMPA 2: se descartan por el ENCABEZADO tanto el original anulado (`anuladoPor` no
    // vacío) como el propio inverso (`idMovimientoInverso` no nulo), que hereda el `idOrden`.
    tx.movimientoDetPt.count({
      where: { idOrden, movimiento: { idMovimientoInverso: null, anuladoPor: { none: {} } } },
    }),
    // 🔴 TRAMPA 1: la tela NO tiene columna de orden — se llega por la referencia polimórfica, y
    // `origenId` es TEXTO. Mismo descarte de anulados que arriba.
    tx.movimiento.count({
      where: {
        origenTipo: ORIGEN.salidaTelaOrden,
        origenId: String(idOrden),
        idMovimientoInverso: null,
        anuladoPor: { none: {} },
      },
    }),
    // De la RC sólo cuenta lo CAPTURADO: la ruta generada se borra y se regenera.
    tx.rutaOrden.count({ where: { idOrden, fechaReal: { not: null } } }),
    tx.hitoOrden.count({ where: { idOrden, canceladoEn: null } }),
    tx.auditoria.count({ where: { idOrden, cancelada: false } }),
    tx.costoOrden.count({ where: { idOrden } }),
    tx.edrLinea.count({ where: { idOrden } }),
  ]);

  const encendidas: Record<SenalActividadOrden, boolean> = {
    cerrada: orden.cerradaEn !== null,
    'receta-liberada': orden.recetaLiberadaEn !== null,
    'receta-abierta': orden.recetaAbiertaEn !== null,
    produccion,
    'cierre-maquila': cierreMaquila > 0,
    esma: esma > 0,
    'notas-salida': notasSalida > 0,
    compras: lineasCompra > 0 || ligasCompra > 0,
    'kardex-pt': kardexPt > 0,
    'kardex-tela': kardexTela > 0,
    'ruta-critica': rutaCritica > 0,
    hitos: hitos > 0,
    auditorias: auditorias > 0,
    costo: costo > 0,
    edr: edr > 0,
  };

  return SENALES_EN_ORDEN.filter((s) => encendidas[s]);
}

/**
 * Las señales de una orden en UNA frase de negocio: `"ya tiene producción capturada (corte, envío,
 * recibo o entrega) y ya se le surtió tela"`. Cadena vacía si no hay ninguna (el llamador no
 * debería llegar aquí en ese caso).
 *
 * Vive junto a la regla —y no en quien redacta el mensaje— para que TODA pantalla que nombre estas
 * señales las diga igual. Las etiquetas salen de {@link ETIQUETA_SENAL_ACTIVIDAD}, así que el texto
 * sigue a la regla y no al revés.
 */
export function textoSenalesActividad(senales: readonly SenalActividadOrden[]): string {
  if (senales.length === 0) return '';
  const etiquetas = senales.map((s) => ETIQUETA_SENAL_ACTIVIDAD[s]);
  const ultima = etiquetas.pop() as string;
  return etiquetas.length === 0 ? ultima : `${etiquetas.join(', ')} y ${ultima}`;
}
