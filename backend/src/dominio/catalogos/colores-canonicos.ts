/**
 * ⭐⭐ **EL COLOR QUE DE VERDAD MANDA — resolver el CANÓNICO de UNO o de MUCHOS** (fila 0.159).
 *
 * ## De dónde sale este archivo
 *
 * La fusión de colores deja RASTRO (`Color.idFusionadoEn`, V1-E8s §Post-F9.143) y `colorCanonico`
 * ya sabía seguirlo… **de uno en uno**. Eso alcanzaba para el importador de OC (un color por
 * renglón del papel) pero **no** para quien tiene que comparar colores entre documentos: la
 * explosión de materiales mira la matriz color×talla entera, cruza sus renglones contra las líneas
 * de las órdenes de compra y agrupa por *(material, color)*. Resolver el rastro fila por fila ahí
 * serían N consultas dentro de un bucle; por eso la versión de LOTE vive aquí.
 *
 * 🔴 **Y por qué hace falta resolver, en una frase:** la fila 0.159 dejó de reescribir las
 * ÓRDENES al fusionar (`OrdenLinea` guarda lo que el cliente pidió, D7/D3), así que después de una
 * fusión conviven en el sistema el id ABSORBIDO —en todo lo ya asentado— y el CANÓNICO —en todo lo
 * nuevo—. Los dos nombran el mismo color real. Quien compare los dos números en crudo verá dos
 * colores donde hay uno, y comprará dos veces lo mismo. Resolver por el canónico es lo que vuelve
 * a juntarlos **sin tocar un solo dato guardado**.
 *
 * ⚠️ **Dónde NO se resuelve, y es a propósito**: dentro de UNA orden todo cuelga de su propia
 * matriz (`OrdenLinea.idColor`) —el corte, el envío, el recibo, la entrega, el kardex de PT—, así
 * que esos módulos comparan el id de la orden contra el id de sus propios movimientos y son
 * coherentes entre sí sin ayuda. Meter el canónico ahí no arreglaría nada y rompería esa
 * coherencia. La lista completa de quién resuelve y quién no vive en `DECISIONES.md` §Post-F9.222.
 *
 * ## Rendimiento
 *
 * El recorrido va **por niveles y por lotes** (`id in (…)`): 1 consulta de arranque + 1 por eslabón
 * de la cadena más larga, nunca 1 por fila. Las cadenas reales tienen uno o dos eslabones
 * («Blanco Hueso Pantone …» → «Blanco Hueso»). Es el mismo diseño que `sinonimosDeDepartamentos`.
 */
import type { Tx } from '../../comun/transaccion.js';

import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';

/**
 * Tope de saltos al seguir la cadena de fusiones. Una cadena real tiene 1 o 2 eslabones ("Negro A" →
 * "Negro"); 20 es holgadísimo (medido: una cadena legítima de cuatro resuelve en milisegundos).
 *
 * ⚠️ Es el **PARACAÍDAS, no la solución**. La fuente conocida de un anillo es el **backfill** de la
 * migración `20260829120000_a_donde_se_fue_el_color`, que lo reconstruye a partir de la bitácora — y
 * **esa migración lo rompe ella misma**, que es donde de verdad se arregla. Esto queda por si un día
 * otro dato viejo dejara uno: mejor un error con nombre que un ciclo infinito.
 */
const MAX_SALTOS_FUSION = 20;

/** Lo mínimo que hay que saber de un color para decidir si se puede usar. */
export interface ColorCanonico {
  id: number;
  nombre: string;
  activo: boolean;
}

/** Fila mínima del catálogo para caminar el rastro de la fusión. */
interface NodoColor extends ColorCanonico {
  idFusionadoEn: number | null;
}

const SELECCION_NODO = { id: true, nombre: true, activo: true, idFusionadoEn: true } as const;

/**
 * El resultado de resolver un puñado de colores: **id tal como está guardado → color CANÓNICO**.
 * Los ids que no existen en el catálogo simplemente NO aparecen (ver {@link idCanonico}).
 */
export type MapaColoresCanonicos = ReadonlyMap<number, ColorCanonico>;

/**
 * El id canónico de `idColor` según el mapa, o **el mismo id** si el mapa no sabe de él.
 *
 * 🔑 El *fallback* al mismo id no es pereza, es la regla que hace segura toda esta etapa: cuando el
 * rastro NO está —que es el 100 % de los colores que nunca se fusionaron— el sistema se comporta
 * EXACTAMENTE igual que antes. `null` (renglón sin color) sigue siendo `null`.
 */
export function idCanonico(mapa: MapaColoresCanonicos, idColor: number): number;
export function idCanonico(mapa: MapaColoresCanonicos, idColor: number | null): number | null;
export function idCanonico(mapa: MapaColoresCanonicos, idColor: number | null): number | null {
  if (idColor === null) return null;
  return mapa.get(idColor)?.id ?? idColor;
}

/**
 * Carga por LOTES todos los nodos que hacen falta para resolver `ids`: los propios y, nivel a
 * nivel, aquellos a los que apunta el rastro de los que están apagados.
 */
async function cargarNodos(
  tx: Pick<Tx, 'color'>,
  ids: readonly number[],
): Promise<Map<number, NodoColor>> {
  const cache = new Map<number, NodoColor>();
  let frontera = [...new Set(ids)];

  // `<=` y no `<`: el nivel 0 es la carga de los propios ids, así que con el tope en 20 se pueden
  // seguir 20 saltos de rastro — el mismo número que promete {@link MAX_SALTOS_FUSION}.
  for (let nivel = 0; nivel <= MAX_SALTOS_FUSION && frontera.length > 0; nivel++) {
    const filas: NodoColor[] = await tx.color.findMany({
      where: { id: { in: frontera } },
      select: SELECCION_NODO,
    });
    for (const fila of filas) cache.set(fila.id, fila);
    // Sólo se sigue el rastro de los APAGADOS: un color activo ya es usable y ahí para la caminata
    // (ver {@link caminarHastaElCanonico}). El filtro `!cache.has` es lo que corta un anillo.
    frontera = [
      ...new Set(
        filas
          .filter((f) => !f.activo && f.idFusionadoEn !== null)
          .map((f) => f.idFusionadoEn as number)
          .filter((id) => !cache.has(id)),
      ),
    ];
  }
  return cache;
}

/**
 * La caminata, EN MEMORIA, desde un color hasta su canónico. Es la ÚNICA implementación de la
 * regla: la usan tanto {@link colorCanonico} (uno) como {@link resolverColoresCanonicos} (muchos),
 * para que no puedan contestar distinto.
 *
 * **La regla, en una línea:** *un color absorbido nunca revive; el canónico sí puede.* La caminata
 * para en cuanto el color está ACTIVO (ya es usable) o ya no tiene rastro (nadie se lo llevó: si
 * está apagado, lo apagó su dueño, y reactivarlo no deshace ninguna fusión).
 */
function caminarHastaElCanonico(cache: Map<number, NodoColor>, inicio: NodoColor): ColorCanonico {
  let actual = inicio;
  const vistos = new Set<number>([actual.id]);

  while (!actual.activo && actual.idFusionadoEn !== null) {
    const siguiente = cache.get(actual.idFusionadoEn);
    if (siguiente === undefined) {
      break; // el canónico ya no existe (no debería: la FK es Restrict) → se queda en éste
    }
    if (vistos.has(siguiente.id) || vistos.size > MAX_SALTOS_FUSION) {
      throw new ErrorConflicto(
        `La cadena de fusiones del color "${actual.nombre}" no termina (más de ` +
          `${String(MAX_SALTOS_FUSION)} saltos): hay colores fusionados en círculo. ` +
          `Reactiva uno de ellos para romper la cadena.`,
      );
    }
    vistos.add(siguiente.id);
    actual = siguiente;
  }

  return { id: actual.id, nombre: actual.nombre, activo: actual.activo };
}

/**
 * ⭐ **RESUELVE MUCHOS DE UN VIAJE.** Devuelve, para cada id pedido que exista, el color CANÓNICO al
 * que lleva su rastro (o él mismo si nunca lo absorbieron). Los ids inexistentes se **omiten**: quien
 * los pasó los sacó de una llave foránea, así que no puede faltar ninguno de verdad, y hacer fallar
 * una explosión entera por un id fantasma sería peor que devolverlo tal cual ({@link idCanonico}).
 *
 * No verifica permiso: es un ayudante de lectura interno y quien lo llama ya pasó su propio gate.
 * Pide `Pick<Tx, 'color'>` (lo ÚNICO que toca) para poder usarse también desde una lectura suelta y
 * poder probarse contra un catálogo falso en memoria, sin Postgres.
 */
export async function resolverColoresCanonicos(
  tx: Pick<Tx, 'color'>,
  ids: Iterable<number | null | undefined>,
): Promise<MapaColoresCanonicos> {
  const pedidos = [...new Set([...ids].filter((id): id is number => id != null))];
  const mapa = new Map<number, ColorCanonico>();
  if (pedidos.length === 0) return mapa;

  const cache = await cargarNodos(tx, pedidos);
  for (const id of pedidos) {
    const nodo = cache.get(id);
    if (nodo === undefined) continue; // id fantasma: se omite y `idCanonico` lo devuelve tal cual
    mapa.set(id, caminarHastaElCanonico(cache, nodo));
  }
  return mapa;
}

/**
 * ⭐ V1-E8s (§Post-F9.143) — sigue el rastro `idFusionadoEn` hasta el color CANÓNICO: el que de
 * verdad sobrevivió a la(s) fusión(es). Devuelve el mismo color si nunca lo absorbieron.
 *
 * **PARA QUÉ EXISTE.** La fusión retira al absorbido apagándolo (borrado suave, D3), así que quien
 * después se topa con ese nombre —el importador de OC de C&A— sólo veía "un color apagado" y lo
 * RESUCITABA: deshacía la limpieza de Daniel y, como ese camino AMARRA el id a la matriz color×talla
 * de la OP, el revivido volvía a acumular referencias. Con el rastro hay a dónde mandarlo.
 *
 * Un color ACTIVO se devuelve tal cual aunque conserve rastro: reactivar a mano es deshacer la
 * fusión, y `actualizarColor` limpia el rastro al hacerlo — pero si por lo que sea quedara uno
 * colgando, gana lo que se ve (está activo), no la historia.
 *
 * Es un ayudante INTERNO de la misma transacción (no verifica permiso): quien lo llama ya pasó su
 * propio gate — `fusionarColores` por `colores.administrar`, el importador por `ordenes.administrar`.
 *
 * @throws `ErrorNoEncontrado` si `idColor` no existe (a diferencia del de lote, que lo omite: aquí
 *   el id lo eligió una persona y callarlo escondería el error de captura).
 */
export async function colorCanonico(
  tx: Pick<Tx, 'color'>,
  idColor: number,
): Promise<ColorCanonico> {
  const cache = await cargarNodos(tx, [idColor]);
  const primero = cache.get(idColor);
  if (primero === undefined) {
    throw new ErrorNoEncontrado('Color', idColor);
  }
  return caminarHastaElCanonico(cache, primero);
}

/**
 * ⭐⭐ **PONE LA MATRIZ DE UNA ORDEN EN ESPACIO CANÓNICO** (fila 0.159, §Post-F9.222).
 *
 * Sustituye en cada renglón el color guardado por su CANÓNICO —id **y** nombre— sin tocar la base.
 * Es lo que hace que la explosión de materiales y la pantalla de *«¿de qué color se compra la
 * tela?»* vean UN color donde la orden tiene dos duplicados: los renglones colapsan solos al
 * agruparse por `idColor`, así que las piezas se suman y se pide **un** renglón de compra en vez de
 * dos.
 *
 * ⚠️ **El nombre viaja con el id, y no es cosmético:** si se cambiara el id y se dejara el nombre
 * viejo, la pantalla diría *«Blanco Hueso Pantone 14-0002 Tcx Pumice Stone»* sobre un renglón que ya
 * es del canónico *«Blanco Hueso»*, y el aviso de *«falta decir de qué color va esta tela»*
 * nombraría un color que ya no se puede elegir.
 *
 * ⚠️ **NO se guarda nada**: la matriz sigue diciendo en la base lo que el cliente pidió (D7/D3).
 * Sin fusiones de por medio devuelve los MISMOS objetos (no copias), así que el camino normal ni se
 * entera de esta fila.
 */
export function canonizarLineasDeColor<T extends { idColor: number; color: { nombre: string } }>(
  lineas: readonly T[],
  mapa: MapaColoresCanonicos,
): T[] {
  return lineas.map((linea) => {
    const canonico = mapa.get(linea.idColor);
    if (canonico === undefined || canonico.id === linea.idColor) return linea;
    // La forma no cambia: sólo el CONTENIDO de `idColor` y de `color.nombre`. Todo lo demás del
    // renglón (las tallas, el pantone, el pack) viaja intacto por el spread.
    return {
      ...linea,
      idColor: canonico.id,
      color: { ...linea.color, nombre: canonico.nombre },
    };
  });
}
