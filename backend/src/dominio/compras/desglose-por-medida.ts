/**
 * ⭐⭐ **EL DESGLOSE POR MEDIDA DE UN AVÍO** (V1-E8c, `DECISIONES.md` §Post-F9.126) — funciones
 * PURAS, sin BD.
 *
 * Daniel, probando en vivo: *"Le había puesto que **el cierre lo tengo que comprar por medidas**. Y
 * al hacer la OC **no me aparece cantidad por medida… sólo veo un solo renglón**"*. Y el caso
 * completo: *"cada color es diferente y **cada color tiene cantidades por medida** de acuerdo a lo
 * que nos pide por talla el cliente en cada OP… Esto mismo pasa en **jaretas, cintas palmita**"*.
 *
 * ## 🔴 La regla que decide qué vive dónde
 *
 * **Lo que parte el RENGLÓN es lo que se recibe por separado. Lo que sólo hay que decirle al
 * proveedor va en la TABLITA.**
 *  • El **COLOR** parte el renglón: se recibe por color, el kardex entra por color y
 *    `comprometido-en-oc.ts` netea por renglón. Eso vive en `mrp.ts` y en las columnas de identidad.
 *  • La **MEDIDA** va aquí, en una tablita bajo el renglón: **no se recibe por medida** (llegan
 *    "3,200 cierres" y el proveedor los mandó cortados según el desglose). Es información PARA ÉL.
 *
 * ## ⚠️ La medida NO multiplica nunca
 *
 * La cantidad de una medida sale de **cuántas prendas la llevan** —piezas de la talla × consumo por
 * prenda—, jamás del NÚMERO de la medida. Leer el `50` de *"50 cm"* como si fuera consumo es de
 * donde salieron los **133,095** cierres que Daniel cazó (§Post-F9.105). Por eso las cantidades no
 * se calculan aquí: llegan ya abiertas por talla desde la ÚNICA regla R18
 * (`produccion/receta-avios.ts`), y este módulo sólo las **agrupa**.
 *
 * ## Un solo precio para todo el renglón
 *
 * Se desglosan **cantidades**, no precios (§Post-F9.113): el importe del renglón sigue siendo
 * `cantidad × precio` y cuadra sin excepciones. Aquí no hay ni un campo de dinero, y es a propósito.
 */
import { redondearCantidadCompra, repartirEntreOrdenes } from './reparto-ordenes.js';

/**
 * Etiqueta de la cubeta de las tallas **sin medida amarrada**. No se calla ni se reparte entre las
 * demás: si la receta no dice qué medida lleva la M, el papel del proveedor tiene que enseñar ese
 * hueco (D3 — nada se omite en silencio) en vez de repartirlo y fingir que está resuelto.
 */
export const ETIQUETA_SIN_MEDIDA = 'Sin medida';

/**
 * Orden de despliegue de la cubeta "Sin medida": SIEMPRE al final. Es un número grande y no un
 * `Infinity` porque acaba en `OrdenCompraLineaMedida.orden`, que es una columna `INTEGER`.
 */
export const ORDEN_SIN_MEDIDA = 1_000_000;

/** La medida que una talla tiene amarrada en la receta de la orden (`OrdenAvioTalla.idAvioMedida`). */
export interface MedidaDeTalla {
  idAvioMedida: number;
  /** Etiqueta del catálogo ("53 cm"). */
  etiqueta: string;
  /** `AvioMedida.orden` — el orden de despliegue que el catálogo del avío ya define. */
  orden: number;
}

/** Un renglón del desglose: cuánto se pide de esa medida. */
export interface DesgloseMedida {
  /** Medida del catálogo, o `null` = la cubeta {@link ETIQUETA_SIN_MEDIDA}. */
  idAvioMedida: number | null;
  /** Etiqueta congelada, tal como se va a guardar y a imprimir. */
  etiqueta: string;
  cantidad: number;
  orden: number;
}

/**
 * Agrupa el requerido ABIERTO POR TALLA en el desglose POR MEDIDA.
 *
 * 🔴 **Devuelve `[]` cuando NINGUNA talla tiene medida amarrada**, y eso no es un detalle: significa
 * *"este avío no se compra por medida"*. Sin ese corte, cada rollo de elástico y cada bolsa de botón
 * saldría con una tablita de una sola fila que dice *"Sin medida: todo"* — ruido en el papel del
 * proveedor justo donde la etapa vino a poner información.
 *
 * @param porTalla el requerido por talla que devolvió la regla R18 (`requeridoAvioReceta`).
 * @param medidaDeTalla qué `AvioMedida` lleva cada talla en la receta de ESTA orden.
 * @returns un renglón por medida, ordenado por el catálogo del avío y con "Sin medida" al final.
 */
export function desglosarPorMedida(
  porTalla: readonly { idTalla: number; requerido: number }[],
  medidaDeTalla: ReadonlyMap<number, MedidaDeTalla>,
): DesgloseMedida[] {
  const conMedida = porTalla.some((t) => medidaDeTalla.has(t.idTalla));
  if (!conMedida) return [];

  const cubetas = new Map<string, DesgloseMedida>();
  for (const t of porTalla) {
    const medida = medidaDeTalla.get(t.idTalla);
    const etiqueta = medida?.etiqueta ?? ETIQUETA_SIN_MEDIDA;
    const previa = cubetas.get(etiqueta);
    if (previa === undefined) {
      cubetas.set(etiqueta, {
        idAvioMedida: medida?.idAvioMedida ?? null,
        etiqueta,
        cantidad: t.requerido,
        orden: medida?.orden ?? ORDEN_SIN_MEDIDA,
      });
    } else {
      previa.cantidad += t.requerido;
    }
  }
  return ordenarDesglose([...cubetas.values()]);
}

/** Orden estable: el del catálogo del avío, con "Sin medida" al final y la etiqueta desempatando. */
function ordenarDesglose(filas: DesgloseMedida[]): DesgloseMedida[] {
  return filas.sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

/**
 * ⭐ **LA SUMA DEL DESGLOSE CIERRA CONTRA LA CANTIDAD DEL RENGLÓN — SIEMPRE.**
 *
 * Reparte `total` entre las medidas **en proporción a lo que cada una requiere**, con la MISMA
 * función que reparte una compra entre las OP (`repartirEntreOrdenes`): la última absorbe el residuo
 * del redondeo, así que Σ = `total` EXACTAMENTE, a la escala en la que la columna lo guarda.
 *
 * 🔴 Hace falta porque el total del renglón **no siempre es el requerido**: se le resta lo que ya
 * está en otra OC (§Post-F9.85) y el comprador lo puede editar antes de generar (§Post-F9.94). Un
 * desglose que siguiera diciendo el requerido viejo contradiría a su propio renglón — y un documento
 * que no cuadra consigo mismo es peor que uno sin desglose.
 *
 * `bases` vacío ⇒ `[]`: sin desglose no hay nada que repartir (el renglón vale por sí solo).
 */
export function repartirDesglose(
  bases: readonly DesgloseMedida[],
  total: number,
): DesgloseMedida[] {
  if (bases.length === 0) return [];
  const partes = repartirEntreOrdenes(
    bases.map((b) => b.cantidad),
    total,
  );
  return bases.map((b, i) => ({ ...b, cantidad: partes[i] ?? 0 }));
}

/**
 * Funde varios desgloses en uno solo, sumando por etiqueta. Lo usan las dos vistas que agrupan: el
 * renglón de la revisión previa (Σ de las líneas de sus OP) y el impreso del proveedor
 * (§Post-F9.102 — él ve una cantidad por color+medida, **no el reparto interno por OP**).
 *
 * ⚠️ Se redondea a la escala de la columna en CADA suma, como el resto de las cantidades de compra:
 * sumar decimales en coma flotante deja polvo, y ese polvo se imprimiría tal cual en el papel.
 */
export function sumarDesgloses(partes: readonly (readonly DesgloseMedida[])[]): DesgloseMedida[] {
  const cubetas = new Map<string, DesgloseMedida>();
  for (const desglose of partes) {
    for (const m of desglose) {
      const previa = cubetas.get(m.etiqueta);
      if (previa === undefined) {
        cubetas.set(m.etiqueta, { ...m, cantidad: redondearCantidadCompra(m.cantidad) });
      } else {
        previa.cantidad = redondearCantidadCompra(previa.cantidad + m.cantidad);
      }
    }
  }
  return ordenarDesglose([...cubetas.values()]);
}

/**
 * Texto de una sola línea con el desglose, para el papel del proveedor y para los avisos:
 * `53 cm: 1,200 · 60 cm: 800`. Vacío ⇒ cadena vacía (quien la pinta decide si esconde el bloque).
 */
export function textoDesglose(desglose: readonly DesgloseMedida[]): string {
  return desglose.map((m) => `${m.etiqueta}: ${m.cantidad.toLocaleString('es-MX')}`).join(' · ');
}
