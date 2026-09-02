/**
 * ⭐ UN COLOR, UN RENGLÓN — la fusión de los renglones-PACK de una OC de C&A (§Post-F9.129).
 *
 * POR QUÉ EXISTE. C&A pide varios **tendidos** en una misma OC: el pack A con una corrida de tallas,
 * el pack B con otra. Hasta hoy el importador de PDF copiaba la maña del sistema viejo y metía el
 * pack DENTRO del nombre del color: `Negro A`, `Negro B` — un renglón de matriz (y un COLOR nuevo del
 * catálogo) por cada pack. Daniel: *«Negro A y Negro B es lo mismo. Solo cambia la distribución del
 * empaque. Pero no tiene sentido separar las compras para cada renglón: veo demasiados registros.»*
 * Aguas abajo TODO agrupa por color (explosión/MRP, órdenes de compra, inventario, recepción), así
 * que dos colores partían las compras de una misma orden en dos.
 *
 * QUÉ HACE. Suma los renglones-pack talla por talla en UNA sola corrida, que es la que se persiste
 * como el único renglón de color de la OP. El desglose por pack NO se pierde: se guarda completo y
 * aparte en `Orden.packsCliente` (jsonb), que es la base del futuro módulo de EMPAQUE.
 *
 * POR QUÉ DEVUELVE UNA SOLA CORRIDA Y NO UN AGRUPADO POR COLOR. Cada PDF de C&A es UNA OC, y una OC
 * trae UN color genérico (`RenglonPdfCyaParseado.colorGenerico`) y UN pantone. Los packs son
 * subdivisiones de ESE color, no colores distintos: al quitarles la letra todos caen en el mismo
 * `Color`. Un `group by` sobre esa clave sólo podría producir un grupo — sería una rama que ninguna
 * prueba puede poner en rojo. Se prefiere decir la verdad estructural: una OC, un renglón.
 *
 * 🔴 POR QUÉ SE SIGUE FUSIONANDO — Y OJO, LA RAZÓN VIEJA YA NO ES CIERTA (§Post-F9.10, 2-sep-2026).
 * Este párrafo decía que se fusionaba porque `sincronizarMatriz` impone `@@unique([idOrden, idColor])`
 * y rechaza dos renglones del mismo color. **Eso dejó de ser verdad**: desde que el PACK es campo
 * propio, la llave es `@@unique([idOrden, idColor, pack])` (`schema.prisma`) y `sincronizarMatriz`
 * **YA ACEPTA** dos renglones del mismo color con packs distintos — su mensaje de duplicado es hoy
 * condicional ("Un mismo color y pack no pueden aparecer dos veces…" cuando la orden maneja packs).
 *
 * ⚠️ Entonces, ¿por qué sigue fusionando este módulo? **Sólo porque el importador todavía NO se
 * cableó al campo nuevo.** No es una decisión de diseño ni una restricción del dominio: es trabajo
 * pendiente de §Post-F9.10, cuyo alcance incluye el importador de PDF (`DECISIONES.md`). Cuando se
 * cablee, este módulo debe **desaparecer** y cada renglón-pack persistirse como su propio
 * `OrdenLinea` con su `pack` — que es justo lo que Daniel pidió: *«un solo Negro»*, con el tendido
 * en su propio campo.
 *
 * 🚫 Mientras tanto, **NO quites la fusión sin cablear el importador en la misma jugada**: sin ella,
 * dos packs con la misma talla llegarían a `sincronizarMatriz` como dos renglones del MISMO color y
 * el MISMO pack vacío, que sí sigue siendo un duplicado prohibido, y reventaría la importación.
 *
 * ⚠️ LA NORMALIZACIÓN DE LA ETIQUETA DE TALLA NO ES COSMÉTICA. `resolverOCrearTalla` resuelve la
 * talla sin distinguir mayúsculas ni espacios de sobra: `"CH"`, `"ch"` y `" CH "` son la MISMA talla
 * del catálogo. Si dos packs la escriben distinto y no se funden aquí, el renglón acabaría con la
 * misma `idTalla` dos veces y `sincronizarMatriz` abortaría la importación entera con "Una talla no
 * puede aparecer dos veces en el mismo color".
 */

/** Un renglón-PACK tal como llega del PDF o de la edición del usuario en la vista previa. */
export interface RenglonPackCya {
  /** Letra del pack (A/B/C…) o null si la OC trae un solo pack. Ya NO viaja al nombre del color. */
  letra: string | null;
  tallas: { talla: string; cantidad: number }[];
}

/** Clave de fusión de una talla: la misma con la que `resolverOCrearTalla` la busca en el catálogo. */
function claveTalla(etiqueta: string): string {
  return etiqueta.trim().toLowerCase();
}

/**
 * Funde los renglones-pack de UNA OC en la corrida del único renglón de color de la OP: suma las
 * cantidades talla por talla, conserva el orden de PRIMERA aparición (así la matriz se lee igual que
 * el papel) y descarta las tallas cuyo total queda en 0 (una talla que todos los packs dejaron
 * vacía no genera celda, como antes tampoco la generaba pack por pack).
 *
 * La etiqueta que sobrevive es la de la primera aparición, ya recortada; las variantes de
 * mayúsculas/espacios de los packs siguientes se suman a ella.
 */
export function fusionarPacksEnUnaCorrida(
  filas: RenglonPackCya[],
): { talla: string; cantidad: number }[] {
  const porTalla = new Map<string, { talla: string; cantidad: number }>();
  for (const fila of filas) {
    for (const celda of fila.tallas) {
      const etiqueta = celda.talla.trim();
      if (etiqueta === '') continue;
      const clave = claveTalla(etiqueta);
      const acumulada = porTalla.get(clave);
      if (acumulada === undefined) {
        porTalla.set(clave, { talla: etiqueta, cantidad: celda.cantidad });
      } else {
        acumulada.cantidad += celda.cantidad;
      }
    }
  }
  return [...porTalla.values()].filter((c) => c.cantidad > 0);
}
