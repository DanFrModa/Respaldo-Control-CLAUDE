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
  if (!avio.consumoPorTalla) {
    return { requerido: num(avio.consumoPorPrenda) * totalPiezas, tallasSinMedida: [] };
  }
  const medidaPorTalla = new Map(avio.tallas.map((t) => [t.idTalla, num(t.consumo)]));
  const consumoPorPrenda = num(avio.consumoPorPrenda);
  let requerido = 0;
  const tallasSinMedida: number[] = [];
  for (const [idTalla, piezas] of piezasPorTalla) {
    // Talla que la orden no pide (0 piezas): no aporta al requerido y NO le falta medida.
    if (piezas <= 0) continue;
    const medida = medidaPorTalla.get(idTalla);
    if (medida !== undefined) {
      requerido += medida * piezas;
    } else {
      requerido += consumoPorPrenda * piezas;
      tallasSinMedida.push(idTalla);
    }
  }
  return { requerido, tallasSinMedida };
}

/**
 * ⭐⭐ **§Post-F9.105 — CUÁNTO SE ESTÁ PIDIENDO DE MÁS** cuando un avío **por medida** arrastra el
 * `consumoPorTalla` encendido de una captura vieja (el cierre de 53 cm capturado como cantidad:
 * requerido 53× inflado). Devuelve los DOS requeridos —el de hoy y el que saldría normalizado—
 * para que el aviso pueda decir la magnitud y no sólo *"hay una contradicción"*.
 *
 * ⚠️ **Calcula, NO corrige.** El requerido que devuelve `requeridoAvioReceta` sigue siendo el de la
 * bandera guardada: apagarla en una LECTURA sería el cambio callado que D3 prohíbe. La bandera se
 * apaga cuando alguien guarda el renglón (`receta-orden.ts`), no cuando alguien lo mira.
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
