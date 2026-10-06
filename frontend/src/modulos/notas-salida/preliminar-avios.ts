import type { HabilitacionAvio } from '@/api/tipos';
import { hayStockDeAvio, type StockDeAvios } from '../inventarios/stock-avios';
import { aNumero, type RenglonNotaCaptura } from './captura';
import { aSurtirDefault } from './habilitacion-piezas';

/** Lo que queda por surtir por debajo de esto ya es cero (la falta viene del servidor en flotante). */
const TOLERANCIA = 1e-6;

/**
 * ⭐⭐ FILA 0.220 — EL PRELIMINAR DE «TRAER AVÍOS DE LA ORDEN».
 *
 * Nace del repaso de Inventarios de DANIEL (punto 07b), confirmado por él:
 *
 * > *«Al traer los avíos de la OP, estaría bien ver un preliminar y seleccionar qué avíos son los
 * > que se van a mandar (obviamente tendría que validar que sólo te ofrezca los que ya se
 * > recibieron en almacén).»*
 *
 * Se apoya en la fila 0.216, que ya dejaba fuera de la precarga lo que no hay en el almacén origen.
 * Lo que agrega es el paso de en medio: en vez de meter de golpe todo lo que hay, se enseña la
 * lista completa de la receta y quien captura escoge qué se manda.
 *
 * Funciones PURAS (A1): no deciden nada del negocio que no decida ya el servidor. La existencia
 * sólo evita llegar hasta la guarda del dominio, que sigue intacta al confirmar la nota.
 */

/** Un renglón del preliminar: un avío de la receta de la orden con lo que hay de él. */
export interface FilaPreliminarAvio {
  idAvio: number;
  clave: string;
  descripcion: string;
  unidad: string | null;
  /**
   * Cantidad que se propone mandar: la **FALTA** de la orden (requerido − enviado en notas
   * CONFIRMADAS, la misma cifra que propone el panel de habilitación) **menos lo que ESTA nota ya
   * lleva** de esa orden y ese avío. Nunca negativa. ⭐ Fila 0.220: antes se proponía el requerido
   * completo, y una OP surtida a medias —o traída dos veces a la misma nota— volvía a pedirlo entero.
   */
  cantidad: number;
  /** Lo que ESTA nota ya lleva de este avío para esta orden (sus renglones, en vivo). */
  enEstaNota: number;
  /** ¿La orden ya tiene surtido todo lo que su receta pide de este avío (falta ≤ 0)? */
  yaSurtido: boolean;
  /** ¿Le falta a la orden, pero lo que falta ya va completo en ESTA nota? */
  yaEnNota: boolean;
  /**
   * Existencia del avío en el almacén origen, o `null` cuando **no se sabe** (el mapa de stock es
   * `undefined`). Con el stock conocido, un avío que no aparece cuenta como cero: nunca entró ahí.
   */
  existencia: number | null;
  /**
   * ¿Se puede marcar? Sólo si **queda algo que proponer** (ni ya surtido ni ya en esta nota) y
   * {@link hayStockDeAvio} lo deja: la MISMA regla de las filas 0.216 y 0.233 (con existencia > 0
   * sí, con cero no, y cuando no se sabe, sí — bloquear sería inventar un cero).
   */
  seleccionable: boolean;
}

/**
 * Lo que ESTA nota ya lleva de cada avío para UNA orden: Σ de las cantidades de sus renglones de
 * avío de esa orden (los del editor, tal como están ahora). Un renglón sin avío o sin cantidad no
 * suma nada.
 */
export function cantidadEnNotaPorAvio(
  renglones: readonly RenglonNotaCaptura[],
  idOrden: number,
): Map<number, number> {
  const mapa = new Map<number, number>();
  for (const r of renglones) {
    if (r.tipo !== 'avio' || r.idOrden !== idOrden || r.idAvio === null) continue;
    mapa.set(r.idAvio, (mapa.get(r.idAvio) ?? 0) + aNumero(r.cantidad));
  }
  return mapa;
}

/**
 * Las filas del preliminar: TODOS los avíos de la receta de la orden (los extras no, igual que en
 * la 0.216: no son de la receta), cada uno con lo que queda por proponer, su existencia y si se
 * puede marcar.
 *
 * 🔑 Los que no tienen existencia **se incluyen**, no se esconden: Daniel quiere que se vea que
 * faltan, porque la receta los pide y alguien tiene que ir a comprarlos.
 */
export function filasPreliminar(
  avios: readonly HabilitacionAvio[],
  stock: StockDeAvios,
  enNota: ReadonlyMap<number, number> = new Map(),
): FilaPreliminarAvio[] {
  return avios
    .filter((a) => !a.esExtra)
    .map((a) => {
      const falta = aSurtirDefault(a);
      const enEstaNota = enNota.get(a.idAvio) ?? 0;
      const yaSurtido = falta <= TOLERANCIA;
      const resto = falta - enEstaNota;
      const yaEnNota = !yaSurtido && resto <= TOLERANCIA;
      return {
        idAvio: a.idAvio,
        clave: a.clave,
        descripcion: a.descripcion,
        unidad: a.unidad,
        cantidad: yaSurtido || yaEnNota ? 0 : resto,
        enEstaNota,
        yaSurtido,
        yaEnNota,
        existencia: stock === undefined ? null : (stock.get(a.idAvio)?.existencia ?? 0),
        seleccionable: !yaSurtido && !yaEnNota && hayStockDeAvio(stock, a.idAvio),
      };
    });
}

/**
 * Los que quedan por proponer pero **no hay** en el almacén: los que alguien tiene que ir a comprar.
 * Es la ÚNICA fuente del aviso «sin existencia», el del preliminar y el que sale al confirmar: lo ya
 * surtido o lo que ya va en esta nota no es un faltante.
 */
export function faltantesSinExistencia(filas: readonly FilaPreliminarAvio[]): FilaPreliminarAvio[] {
  return filas.filter((f) => !f.yaSurtido && !f.yaEnNota && !f.seleccionable);
}

/**
 * Lo que viene marcado al abrir: **los que quedan por proponer y TIENEN existencia**, para que el
 * camino rápido siga siendo un clic (abrir y confirmar = lo mismo que traía la 0.216).
 *
 * ⚠️ Los de existencia **desconocida** se pueden marcar, pero NO vienen marcados: marcarlos solos
 * sería traer de golpe lo que no se sabe si hay, que es justo el defecto de la 0.216.
 */
export function seleccionInicial(filas: readonly FilaPreliminarAvio[]): Set<number> {
  return new Set(
    filas
      .filter((f) => f.seleccionable && f.existencia !== null && f.existencia > 0)
      .map((f) => f.idAvio),
  );
}

/**
 * Lo que entra a la nota al confirmar: los MARCADOS que además se pueden marcar con los datos de
 * ese momento. El segundo filtro no sobra: si la existencia o la habilitación cambian con el
 * preliminar abierto, un avío que se marcó puede dejar de poder mandarse, y no debe colarse.
 */
export function aviosAEnviar(
  filas: readonly FilaPreliminarAvio[],
  marcados: ReadonlySet<number>,
): FilaPreliminarAvio[] {
  return filas.filter((f) => f.seleccionable && marcados.has(f.idAvio));
}
