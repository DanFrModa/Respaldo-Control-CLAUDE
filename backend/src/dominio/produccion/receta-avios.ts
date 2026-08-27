/**
 * Cálculo PURO del REQUERIDO de un avío de la receta (R18) — ÚNICA fuente de verdad compartida entre
 * la explosión MRP (`compras/mrp.ts`) y la habilitación/surtido (`produccion/habilitacion-orden.ts`).
 * Se extrae aquí (DEBE-2 del review de R6) para que la regla de Daniel NO viva duplicada y no
 * pueda derivar entre módulos.
 *
 * Regla R18: si el avío NO se consume por talla → `consumoPorPrenda × totalPiezas`. Si SÍ → Σ(medida
 * de la talla × piezas de esa talla en la orden); las tallas presentes en la orden SIN medida
 * capturada caen a `consumoPorPrenda` y se reportan en `tallasSinMedida` para que el llamador
 * avise (§Post-F9.64: **avisa, NO bloquea** — bloquear pararía la talla de última hora, que es
 * producción legítima). Lo usan el MRP (`compras/mrp.ts`) y la habilitación
 * (`produccion/habilitacion-orden.ts`), cada uno pintando el aviso donde le toca.
 *
 * ⚠️ **Sólo cuentan las tallas que la orden REALMENTE pide** (piezas > 0, D4): una talla con cero
 * piezas no se va a producir, así que ni suma al requerido ni "le falta" medida. Antes se colaba
 * en `tallasSinMedida` y el aviso señalaba tallas que nadie iba a cortar.
 *
 * Es una función pura sin BD: toma sólo los campos mínimos del BOM (no el `select` pesado del MRP).
 */
import type { Prisma } from '../../datos/index.js';

import type { RequeridoContradictorio } from '../catalogos/unidades-avio.js';
import { num } from '../costos/decimales.js';

/** Lo MÍNIMO de un renglón `ModeloAvio` para calcular el requerido R18 (sin acoplar al select). */
export interface AvioRecetaR18 {
  /** Consumo por prenda (fallback cuando no hay medida por talla). */
  consumoPorPrenda: Prisma.Decimal;
  /** ¿El avío maneja medida por talla? */
  consumoPorTalla: boolean;
  /** Medidas por talla (si `consumoPorTalla`). */
  tallas: { idTalla: number; consumo: Prisma.Decimal }[];
}

/** Resultado del cálculo: el requerido + las tallas que cayeron al consumo por prenda (para avisos). */
export interface RequeridoAvioResultado {
  requerido: number;
  /** idTalla de las tallas de la orden SIN medida capturada (usaron `consumoPorPrenda`). */
  tallasSinMedida: number[];
  /**
   * ⭐⭐ **V1-E8c (§Post-F9.126) — EL MISMO REQUERIDO, ABIERTO POR TALLA.** Es la base del desglose
   * por MEDIDA de la orden de compra: quien llama agrupa estas tallas por la `AvioMedida` que cada
   * una tiene amarrada (`OrdenAvioTalla.idAvioMedida`) y obtiene *"de la de 53 cm, 1,200"*.
   *
   * 🔴 Sale de AQUÍ y no de una cuenta paralela **a propósito**: es la MISMA regla R18 abierta, así
   * que el desglose no puede decir un total distinto del renglón. Una segunda cuenta sería una
   * segunda verdad — y la primera vez que se hizo una cuenta aparte con las medidas de un avío
   * salieron los 133,095 cierres que Daniel cazó (§Post-F9.105).
   *
   * ⚠️ **LA MEDIDA NO ENTRA EN LA MULTIPLICACIÓN.** Cada talla aporta `consumo de la talla ×
   * piezas de la talla`; el NÚMERO de la medida (el 53 de *53 cm*) no se usa jamás para multiplicar.
   *
   * ⚠️ Σ `porTalla` = `requerido` **cuando `totalPiezas` = Σ de `piezasPorTalla`**, que es como lo
   * llama el MRP (y también la habilitación). Si el llamador pasa un `totalPiezas` que no cuadra con
   * su mapa de tallas, el `requerido` sigue el contrato de siempre (`consumoPorPrenda × totalPiezas`)
   * y el desglose describe el mapa: son dos preguntas distintas y ninguna se falsea para cuadrar.
   * Sólo trae tallas con piezas > 0 (una talla que nadie va a cortar no lleva avíos).
   */
  porTalla: { idTalla: number; requerido: number }[];
}

/**
 * Requerido de un avío (R18). `piezasPorTalla` = piezas de la orden agrupadas por talla. Devuelve el
 * requerido y las tallas sin medida (el llamador arma el aviso si le interesa).
 */
export function requeridoAvioReceta(
  avio: AvioRecetaR18,
  totalPiezas: number,
  piezasPorTalla: ReadonlyMap<number, number>,
): RequeridoAvioResultado {
  const consumoPorPrenda = num(avio.consumoPorPrenda);
  if (!avio.consumoPorTalla) {
    // ⭐⭐ V1-E8c: aunque el consumo NO sea por talla, el desglose por talla existe — cada prenda
    // gasta lo mismo, pero **de qué MEDIDA** depende de la talla (el cierre de la S no es el de la
    // XL). Sin este brazo, un cierre con medidas amarradas y consumo plano (1 pza por prenda, el
    // caso normal) saldría a la OC sin desglose: justo lo que Daniel reportó.
    return {
      requerido: consumoPorPrenda * totalPiezas,
      tallasSinMedida: [],
      porTalla: [...piezasPorTalla]
        .filter(([, piezas]) => piezas > 0)
        .map(([idTalla, piezas]) => ({ idTalla, requerido: consumoPorPrenda * piezas })),
    };
  }
  const medidaPorTalla = new Map(avio.tallas.map((t) => [t.idTalla, num(t.consumo)]));
  let requerido = 0;
  const tallasSinMedida: number[] = [];
  const porTalla: { idTalla: number; requerido: number }[] = [];
  for (const [idTalla, piezas] of piezasPorTalla) {
    // Talla que la orden no pide (0 piezas): no aporta al requerido y NO le falta medida.
    if (piezas <= 0) continue;
    const medida = medidaPorTalla.get(idTalla);
    const deLaTalla = (medida ?? consumoPorPrenda) * piezas;
    if (medida === undefined) tallasSinMedida.push(idTalla);
    requerido += deLaTalla;
    porTalla.push({ idTalla, requerido: deLaTalla });
  }
  return { requerido, tallasSinMedida, porTalla };
}

/**
 * ⭐⭐ **§Post-F9.105 — CUÁNTO SE ESTÁ PIDIENDO DE MÁS** cuando un avío **por medida** arrastra el
 * `consumoPorTalla` encendido de una captura vieja (el cierre de 53 cm capturado como cantidad:
 * requerido 53× inflado). Devuelve los DOS requeridos —el de hoy y el que saldría normalizado—
 * para que el aviso pueda decir la magnitud y no sólo *"hay una contradicción"*.
 *
 * ⚠️ **Calcula, NO corrige.** El requerido que devuelve `requeridoAvioReceta` sigue siendo el de la
 * bandera guardada: apagarla en una LECTURA sería el cambio callado que D3 prohíbe. La bandera se
 * apaga cuando una PERSONA lo pide —el botón «Corregir» del renglón (`corregirCapturaAvio`, V1-E8h
 * §Post-F9.130), o cualquier guardado del renglón—, nunca cuando alguien lo mira.
 *
 * ⚠️ **El llamador decide si hay contradicción**: "es por medida" sale de un solo hecho —¿el avío
 * tiene ≥1 medida ACTIVA en su catálogo?— que vive en la BD y no en este módulo puro. Aquí sólo se
 * comprueba lo otro: que la bandera esté encendida. Sin bandera no hay nada que comparar → `null`.
 *
 * Las dos mitades del aviso viven separadas a propósito: la CUENTA aquí (con la regla R18, que es
 * de este módulo) y el TEXTO en `catalogos/unidades-avio.ts` (que es de quien define la diferencia
 * entre *cuánto gastas* y *qué medida pides*).
 */
export function requeridoContradictorioPorMedida(
  avio: AvioRecetaR18,
  totalPiezas: number,
  piezasPorTalla: ReadonlyMap<number, number>,
  unidad: string | null = null,
): RequeridoContradictorio | null {
  if (!avio.consumoPorTalla) return null;
  const hoy = requeridoAvioReceta(avio, totalPiezas, piezasPorTalla).requerido;
  // El "normalizado" NO se re-implementa (`consumoPorPrenda × piezas` escrito a mano sería una
  // segunda definición del requerido): se pide a la MISMA función con la bandera apagada.
  const normalizado = requeridoAvioReceta(
    { ...avio, consumoPorTalla: false },
    totalPiezas,
    piezasPorTalla,
  ).requerido;
  return { hoy, normalizado, unidad };
}
