/**
 * ⭐ LOS RENGLONES-PACK DE UNA OC DE C&A — de la vista previa a la matriz de la OP (§Post-F9.10).
 *
 * POR QUÉ EXISTE. C&A pide varios **tendidos** en una misma OC: el pack A con una corrida de tallas,
 * el pack B con otra. Este módulo convierte esos renglones-pack en los renglones que se persisten
 * como matriz de la OP.
 *
 * ## Lo que este módulo YA NO hace, y por qué importa (§Post-F9.129 → §Post-F9.10)
 *
 * Hasta la v0.087 se llamaba `fusion-packs-cya.ts` y **sumaba todos los packs en UNA sola corrida**:
 * la OP nacía con un único renglón de color y el desglose por tendido sólo sobrevivía en el jsonb
 * `Orden.packsCliente`. Eso fue el arreglo de §Post-F9.129 a un problema anterior —la letra iba
 * DENTRO del nombre del color (`Negro A`, `Negro B`), fabricando un color de catálogo por pack y
 * partiendo las compras de una misma orden en tantos pedazos como tendidos—, pero pagaba un precio: **el tendido dejaba de
 * existir para el corte y para la entrega a maquila**, que es justo donde Daniel dijo que tenía que
 * viajar (*«Creo que sí es importante que viaje el pack al menos en el corte, entrega a maquila…»*).
 *
 * Desde que el PACK es campo propio de `OrdenLinea` (v0.087, llave `@@unique([idOrden, idColor,
 * pack])`), **cada pack se persiste como su propio renglón** y las dos cosas se cumplen a la vez:
 * un solo `Color` en el catálogo —*«Me gusta que exista un solo Negro»*— y el tendido en su campo.
 *
 * 🔑 EL DESGLOSE SIGUE SIENDO IMPRESCINDIBLE DENTRO DE CADA PACK. Lo que aquí se funde ya no son
 * los packs entre sí, sino las **tallas repetidas de UN MISMO pack**:
 *
 * ⚠️ LA NORMALIZACIÓN DE LA ETIQUETA DE TALLA NO ES COSMÉTICA. `resolverOCrearTalla` resuelve la
 * talla sin distinguir mayúsculas ni espacios de sobra: `"CH"`, `"ch"` y `" CH "` son la MISMA talla
 * del catálogo. Si un pack la escribe de dos formas y no se funden aquí, el renglón acabaría con la
 * misma `idTalla` dos veces y `sincronizarMatriz` abortaría la importación entera con "Una talla no
 * puede aparecer dos veces en el mismo color".
 *
 * ⚠️ Y LA SEGUNDA RED, QUE ANTES ERA GRATIS: dos renglones-pack con la MISMA letra. Mientras todo
 * se fundía en uno, dos "A" eran inofensivos; ahora serían dos renglones de `(idOrden, idColor,
 * 'A')` y `sincronizarMatriz` abortaría la importación entera con "Un mismo color y pack no pueden
 * aparecer dos veces en la misma orden" (y, si esa comprobación se le escapara, el `@@unique` de la
 * tabla). Por eso el agrupado es **por pack**, no una simple proyección renglón a renglón.
 *
 * POR QUÉ NO AGRUPA POR COLOR. Cada PDF de C&A es UNA OC, y una OC trae UN color genérico
 * (`RenglonPdfCyaParseado.colorGenerico`) y UN pantone. Los packs son subdivisiones de ESE color, no
 * colores distintos. Una OC, un color, N tendidos.
 */
import { normalizarPack } from '../produccion/packs.js';

/** Un renglón-PACK tal como llega del PDF o de la edición del usuario en la vista previa. */
export interface RenglonPackCya {
  /** Letra del pack (A/B/C…) o null si la OC trae un solo pack. Ya NO viaja al nombre del color. */
  letra: string | null;
  tallas: { talla: string; cantidad: number }[];
}

/** Un renglón de la matriz de la OP: su pack (vacío = sin pack) y su corrida ya consolidada. */
export interface RenglonMatrizCya {
  /** Pack / tendido del renglón, ya normalizado. CADENA VACÍA = la OC trae un solo tendido. */
  pack: string;
  tallas: { talla: string; cantidad: number }[];
}

/** Clave de fusión de una talla: la misma con la que `resolverOCrearTalla` la busca en el catálogo. */
function claveTalla(etiqueta: string): string {
  return etiqueta.trim().toLowerCase();
}

/**
 * Agrupa los renglones-pack de UNA OC en los renglones de la matriz de su OP: **uno por pack**.
 *
 * Dentro de cada pack suma las cantidades talla por talla, conserva el orden de PRIMERA aparición
 * (así la matriz se lee igual que el papel) y descarta las tallas cuyo total queda en 0 —una talla
 * que el pack dejó vacía no genera celda—. La etiqueta que sobrevive es la de la primera aparición,
 * ya recortada; las variantes de mayúsculas/espacios se suman a ella.
 *
 * Los packs salen en orden de primera aparición, y **un pack que quedó entero en 0 no genera
 * renglón**: así el usuario "integra" un pack en otro moviendo sus números en la vista previa, tal
 * como podía hacerlo antes.
 *
 * 🔑 El pack se normaliza con `normalizarPack`, la MISMA función que usa el dominio de producción
 * para decidir si dos celdas son del mismo tendido. Si aquí se agrupara con otra idea de "el mismo
 * pack" que la de allá, la importación podría crear dos renglones que el corte considera uno solo.
 */
export function agruparPacksEnRenglones(filas: readonly RenglonPackCya[]): RenglonMatrizCya[] {
  const porPack = new Map<string, Map<string, { talla: string; cantidad: number }>>();
  for (const fila of filas) {
    const pack = normalizarPack(fila.letra);
    const tallas = porPack.get(pack) ?? new Map<string, { talla: string; cantidad: number }>();
    porPack.set(pack, tallas);
    for (const celda of fila.tallas) {
      const etiqueta = celda.talla.trim();
      if (etiqueta === '') continue;
      const clave = claveTalla(etiqueta);
      const acumulada = tallas.get(clave);
      if (acumulada === undefined) {
        tallas.set(clave, { talla: etiqueta, cantidad: celda.cantidad });
      } else {
        acumulada.cantidad += celda.cantidad;
      }
    }
  }
  const renglones: RenglonMatrizCya[] = [];
  for (const [pack, tallas] of porPack) {
    const corrida = [...tallas.values()].filter((c) => c.cantidad > 0);
    if (corrida.length > 0) {
      renglones.push({ pack, tallas: corrida });
    }
  }
  return renglones;
}
