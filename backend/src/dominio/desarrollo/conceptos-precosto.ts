/**
 * Los CÓDIGOS de los conceptos de costo que el PRECOSTO trata de forma especial, en UN SOLO SITIO
 * (§Post-F9.210, fila 0.152). Antes vivían repartidos: la lista de anclas en `precostos.ts` y **su
 * espejo tecleado a mano en el frontend** (`DialogoPrecosto.tsx`), que es exactamente la forma de
 * que las dos dejen de decir lo mismo sin que nadie se entere.
 *
 * Módulo PURO (sin Prisma, sin sesión): sólo reglas sobre un `ConceptoCosto.codigo`. Lo consumen
 * el dominio del precosto y la proyección del catálogo de conceptos — y desde ahí viajan al
 * frontend como BANDERAS en el contrato ({@link banderasDelConcepto}), para que la pantalla no
 * necesite ninguna copia de esta lista.
 */
import type { InsumoDeCatalogo } from '../../contrato/esquemas/concepto-costo.js';

/** Concepto de la TELA: su insumo sale del catálogo de telas (§Post-F9.210·12). */
export const CONCEPTO_TELA = 'tela';
/** Concepto de los AVÍOS: su insumo sale del catálogo de avíos (§Post-F9.210·12). */
export const CONCEPTO_AVIOS = 'avios';
/** Maquila/costura: costo fijo por prenda. */
export const CONCEPTO_MAQUILA = 'maquila';
/** Corte (rediseño R5, B8): costo fijo por prenda, separado de la costura. */
export const CONCEPTO_CORTE = 'corte';
/**
 * Empaque (V1-E8w, §Post-F9.153). Vive en su propia constante porque **tres** reglas distintas lo
 * miran: el ancla fija, el "sólo precio" de aquí abajo y el contenido mínimo para congelar
 * (`exigirCostoCongelable`) — esta última existe justamente porque el empaque es la única de las
 * tres anclas que nace con un valor **puesto por el sistema**, no capturado por nadie.
 */
export const CONCEPTO_EMPAQUE = 'empaque';

/**
 * Códigos de los conceptos ANCLA fijos (rediseño R5 + V1-E8w): un renglón `manual` por prenda,
 * ÚNICO, que se EDITA pero NO se elimina ni se agrega dos veces — maquila/costura, corte y empaque.
 */
export const CONCEPTOS_ANCLA = [CONCEPTO_MAQUILA, CONCEPTO_CORTE, CONCEPTO_EMPAQUE] as const;

/**
 * ⭐ Conceptos que llevan **SÓLO PRECIO, NO CANTIDAD** (§Post-F9.210·3, Daniel 7-sep-2026: *"Solo
 * debe de llevar el precio. **no la cantidad**"*). Costear el corte de una prenda es un monto por
 * prenda; multiplicarlo por un "consumo" no significa nada, y la casilla se pintaba igual.
 *
 * ⚠️ Hoy son LOS MISMOS TRES que {@link CONCEPTOS_ANCLA}, y aun así es una lista aparte **a
 * propósito**: contestan preguntas distintas ("¿se puede duplicar/borrar?" vs. "¿lleva cantidad?").
 * Se arman con las mismas constantes, así que ningún código se teclea dos veces; si mañana nace una
 * cuarta ancla que sí lleve cantidad, se agrega a una y no a la otra sin tocar nada más.
 */
export const CONCEPTOS_SOLO_PRECIO = [CONCEPTO_CORTE, CONCEPTO_MAQUILA, CONCEPTO_EMPAQUE] as const;

/**
 * De qué CATÁLOGO tiene que salir el insumo de un concepto (§Post-F9.210·12, Daniel: *"toda la
 * información debe de venir desde la receta… no sé por qué en el precosteo hay espacio para meter
 * otra tela que no viene de un catálogo"*). `null` = concepto de costo abierto (corte, maquila,
 * empaque, fletes, muestras…), donde el texto libre **es el punto** y se conserva.
 */
const CATALOGO_POR_CONCEPTO: ReadonlyMap<string, InsumoDeCatalogo> = new Map([
  [CONCEPTO_TELA, 'tela'],
  [CONCEPTO_AVIOS, 'avio'],
]);

/** ¿Es un concepto ANCLA (único por precosto, no eliminable)? */
export function esConceptoAncla(codigo: string): boolean {
  return (CONCEPTOS_ANCLA as readonly string[]).includes(codigo);
}

/** ¿Este concepto lleva SÓLO precio (sin cantidad)? Ver {@link CONCEPTOS_SOLO_PRECIO}. */
export function esConceptoSoloPrecio(codigo: string): boolean {
  return (CONCEPTOS_SOLO_PRECIO as readonly string[]).includes(codigo);
}

/**
 * Catálogo del que DEBE salir el insumo de este concepto, o `null` si es un concepto de costo
 * abierto. El material libre del precosteo se acabó: para tela y avío se exige el catálogo, y el
 * texto suelto vive sólo en la mesa de negociación (donde sigue la jareta estimada, §Post-F9.139).
 */
export function insumoDeCatalogoDelConcepto(codigo: string): InsumoDeCatalogo | null {
  return CATALOGO_POR_CONCEPTO.get(codigo) ?? null;
}

/**
 * Las tres banderas de un concepto, tal como viajan en el contrato. Existe para que la PANTALLA no
 * tenga que conocer ningún código: pregunta por banderas, no por nombres.
 */
export function banderasDelConcepto(codigo: string): {
  anclaFija: boolean;
  soloPrecio: boolean;
  insumoCatalogo: InsumoDeCatalogo | null;
} {
  return {
    anclaFija: esConceptoAncla(codigo),
    soloPrecio: esConceptoSoloPrecio(codigo),
    insumoCatalogo: insumoDeCatalogoDelConcepto(codigo),
  };
}
