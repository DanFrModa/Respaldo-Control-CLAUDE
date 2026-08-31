/**
 * ⭐ V1-E9b (§Post-F9.135 / §Post-F9.167) — **LA RECETA COMPARTIDA**: de QUIÉN es la receta que
 * lee un modelo.
 *
 * La regla cabe en una línea, y es toda la etapa:
 *
 * ```
 * idModeloDeLaReceta(modelo) = modelo.idModeloDesarrollo ?? modelo.id
 * ```
 *
 * Un modelo de PRODUCCIÓN nacido de un desarrollo (V1-E9a, `derivarModeloDeProduccion`) **no copia
 * la receta: apunta a la de su padre**. Los otros —todo lo migrado del Access, lo capturado a mano
 * y los propios modelos de desarrollo— llevan la columna en `NULL`, que significa *«la receta es la
 * mía»* y **es exactamente la conducta de hoy**. Por eso el vínculo nació sin backfill (REGLA 0-B):
 * `NULL` no es un dato que falte, es la respuesta correcta.
 *
 * 🔑 **Por qué la igualdad es ESTRUCTURAL y no vigilada.** Daniel preguntó *«¿cómo controlas que
 * los cuatro lleven lo mismo?»*. Con cuatro copias no se controla: se vigila, y tarde o temprano
 * divergen. Con **una sola receta** que los cuatro leen, la pregunta desaparece.
 *
 * ---
 * ## Las TRES formas del resolver (§Post-F9.167 punto 1)
 *
 * El resolver no tiene una sola forma, y confundirlas es como se cuelan los defectos SILENCIOSOS:
 *
 *  1. **POR FILA** — {@link resolverIdRecetaDeModelo}: *«dame el id de la receta de este modelo»*.
 *     Es la que usan las tres lecturas canónicas (`leerTelasBom`, `leerAviosBom`,
 *     `leerArtesModelo`) y toda lectura que recibe UN `idModelo`.
 *
 *  2. **EN LOTE** — {@link resolverRepartoDeRecetas} + {@link repartirFilasDeReceta}: una consulta
 *     `where: { idModelo: { in: […] } }` sobre una página entera de modelos. Aquí **no basta con
 *     resolver**: hay que saber DEVOLVERLE cada fila al modelo que la pidió, porque varios hijos
 *     pueden compartir un mismo padre. Sin el mapa inverso, el hijo sale **sin tela principal en el
 *     listado, en silencio**.
 *
 *  3. **POR `include` ANIDADO** — {@link injertarRecetaCompartida}: `modelo.findUnique({ include:
 *     { telas, avios: { tallas }, artes } })`. Trae la receta **por NOMBRE DE RELACIÓN, sin nombrar
 *     jamás la tabla**, y por eso fue invisible al conteo del plan. 🔴 Es la forma por la que pasa
 *     **el precosto**: si se hubiera quedado fuera, un modelo hijo habría cotizado con la **receta
 *     vacía** —sólo maquila, corte y empaque— *sin lanzar y sin verse raro*, y de ese número sale el
 *     precio que se le dice al cliente en la cara.
 *
 * ⭐ Este error **ya había pasado en el mismo repo, en la otra dirección**: el guardián
 * `receta-embudo.test.ts` existe porque la escritura ANIDADA también era invisible. Su gemelo para
 * las lecturas es `receta-compartida-guardian.test.ts`.
 *
 * ---
 * ## Dos propiedades de las que depende todo lo de arriba
 *
 * **IDEMPOTENCIA.** Resolver dos veces da lo mismo que resolver una: un modelo de DESARROLLO nunca
 * lleva la columna (lo prohíbe el CHECK `modelos_linaje_desarrollo_solo_produccion_check`) y el
 * único escritor exige que el padre sea de desarrollo ⇒ **no hay cadenas**, así que
 * `receta(receta(x)) = receta(x)`. Gracias a eso una lectura canónica puede resolver por dentro sin
 * que importe si el llamador ya resolvió.
 *
 * **NO HAY CICLOS.** El CHECK `modelos_linaje_desarrollo_no_es_si_mismo_check` impide que un modelo
 * sea su propio padre, y la ausencia de cadenas impide cualquier ciclo más largo.
 */
import type { PrismaClient } from '../../datos/index.js';
import type { Tx } from '../../comun/transaccion.js';

/** Cualquier cliente con el que se puede LEER (dentro o fuera de transacción). */
type Lector = Tx | PrismaClient;

/**
 * La forma MÍNIMA con la que se pregunta de quién es la receta de un modelo. Es a propósito un
 * `interface` estructural y no `Modelo`: así la puede satisfacer lo mismo una fila completa que un
 * `select` de dos columnas, y nadie tiene que traerse el modelo entero para preguntar.
 */
export interface LinajeDeReceta {
  id: number;
  /** `null` = *«la receta es la mía»* (V1-E9a). */
  idModeloDesarrollo: number | null;
}

/**
 * El `select` de Prisma con lo mínimo que {@link idModeloDeLaReceta} necesita. Vive aquí para que
 * una lectura nueva no tenga que adivinar qué columnas pedir.
 */
export const SELECT_LINAJE_RECETA = { id: true, idModeloDesarrollo: true } as const;

/**
 * ⭐ **LA REGLA**, en una función PURA: de qué modelo es la receta de éste.
 *
 * Pura a propósito —no toca la base— para que la regla se pueda probar sola, mutar sola y leerse de
 * un vistazo. Las variantes que sí consultan ({@link resolverIdRecetaDeModelo},
 * {@link resolverRepartoDeRecetas}) se apoyan todas en ella y ninguna la re-implementa.
 */
export function idModeloDeLaReceta(modelo: LinajeDeReceta): number {
  return modelo.idModeloDesarrollo ?? modelo.id;
}

/**
 * FORMA 1 — **por fila**: el id del modelo del que hay que leer la receta de `idModelo`.
 *
 * Si el modelo no existe devuelve el id tal cual: **no es esta función quien decide si un modelo
 * existe**. Lanzar aquí convertiría el resolver en una guarda encubierta y le cambiaría el error a
 * lecturas que hoy devuelven una lista vacía con toda razón (un modelo recién borrado, un id
 * inventado en un GET). Quien necesite existencia usa `exigirModelo`.
 */
export async function resolverIdRecetaDeModelo(lector: Lector, idModelo: number): Promise<number> {
  const modelo = await lector.modelo.findUnique({
    where: { id: idModelo },
    select: SELECT_LINAJE_RECETA,
  });
  return modelo === null ? idModelo : idModeloDeLaReceta(modelo);
}

/**
 * FORMA 2 — **en lote**: quién lee la receta de quién, para una página entera de modelos.
 *
 * `idsDeReceta` son los ids DISTINTOS que hay que consultar (van directos a un
 * `where: { idModelo: { in: … } }`); `recetaDe` traduce de modelo a receta, y {@link
 * repartirFilasDeReceta} hace el camino de vuelta —el que se olvida— para devolverle a cada modelo
 * las filas que le tocan.
 */
export interface RepartoDeRecetas {
  /** Ids DISTINTOS de las recetas a leer (ya resueltos, sin repetir, en orden estable). */
  idsDeReceta: number[];
  /** De qué modelo es la receta de `idModelo` (identidad si no se conoce su linaje). */
  recetaDe(idModelo: number): number;
}

/**
 * FORMA 2, la parte PURA: arma el reparto a partir de los linajes ya leídos.
 *
 * Se separa de la consulta a propósito — quien ya tiene los modelos en la mano (el listado los
 * acaba de leer con todo y `idModeloDesarrollo`) **no debe volver a la base** sólo para resolver.
 */
export function repartoDeRecetas(modelos: readonly LinajeDeReceta[]): RepartoDeRecetas {
  const porModelo = new Map<number, number>();
  for (const m of modelos) {
    porModelo.set(m.id, idModeloDeLaReceta(m));
  }
  return {
    // `Set` conserva el orden de inserción ⇒ el `in` sale determinista (y las pruebas, estables).
    idsDeReceta: [...new Set(porModelo.values())],
    recetaDe: (idModelo: number): number => porModelo.get(idModelo) ?? idModelo,
  };
}

/**
 * FORMA 2, la parte que consulta: lee el linaje de esos ids y arma el reparto. Para quien tiene los
 * ids pero no las filas.
 */
export async function resolverRepartoDeRecetas(
  lector: Lector,
  idsModelo: readonly number[],
): Promise<RepartoDeRecetas> {
  if (idsModelo.length === 0) {
    return repartoDeRecetas([]);
  }
  const filas = await lector.modelo.findMany({
    where: { id: { in: [...idsModelo] } },
    select: SELECT_LINAJE_RECETA,
  });
  // Los ids que no existen entran como identidad: el reparto describe lo que se pidió, no lo que
  // la base tiene (misma razón que en `resolverIdRecetaDeModelo`).
  const linajes = new Map(filas.map((f) => [f.id, f]));
  return repartoDeRecetas(
    idsModelo.map((id) => linajes.get(id) ?? { id, idModeloDesarrollo: null }),
  );
}

/**
 * FORMA 2, el CAMINO DE VUELTA (PURA) — el que se olvida y deja al hijo vacío en silencio.
 *
 * Dadas las filas leídas de las recetas (cada una sabe de qué `idModelo` de RECETA salió), devuelve
 * un mapa **por modelo que las pidió**: un padre con cuatro hijos reparte las MISMAS filas a los
 * cuatro. Sin esto, un `Map` armado por `fila.idModelo` sólo tendría al padre y los hijos saldrían
 * sin nada.
 */
export function repartirFilasDeReceta<T>(
  reparto: RepartoDeRecetas,
  idsModelo: readonly number[],
  filas: readonly T[],
  idModeloDeLaFila: (fila: T) => number,
): Map<number, T[]> {
  const porReceta = new Map<number, T[]>();
  for (const fila of filas) {
    const clave = idModeloDeLaFila(fila);
    const lista = porReceta.get(clave);
    if (lista === undefined) porReceta.set(clave, [fila]);
    else lista.push(fila);
  }
  const porModelo = new Map<number, T[]>();
  for (const id of idsModelo) {
    porModelo.set(id, porReceta.get(reparto.recetaDe(id)) ?? []);
  }
  return porModelo;
}

/**
 * FORMA 3 — la que el plan no vio: un modelo traído con la receta colgando por `include`.
 *
 * Las tres relaciones son las que componen la receta en cualquiera de los dos `include` del
 * sistema (`costos/pre-costo.ts` → `incluirReceta`, `desarrollo/precostos.ts` → `incluirBomModelo`).
 * `avios` trae dentro sus `tallas` (= `ModeloAvioTalla`, las medidas por talla R18), así que
 * injertar `avios` cubre las medidas **sin nombrarlas**: son parte de la misma fila.
 */
export interface ModeloConRecetaAnidada extends LinajeDeReceta {
  telas: unknown[];
  avios: unknown[];
  artes: unknown[];
}

/**
 * FORMA 3, la parte PURA: reemplaza en un modelo su receta por la del modelo que se la presta.
 *
 * Lo que NO se toca es todo lo demás: el hijo conserva su código, su descripción, su maquila y su
 * corte —su FICHA es suya—; lo único que viene del padre es la receta. Un hijo cuyo padre no venga
 * en `padres` se devuelve **tal cual** en vez de vaciarse: la FK es `RESTRICT`, así que eso no puede
 * pasar por datos, y si pasara por un filtro mal escrito es mejor enseñar la receta propia que
 * fabricar un precosto vacío — que es justo el defecto que esta etapa vino a evitar.
 */
export function injertarRecetaDeUno<M extends ModeloConRecetaAnidada>(
  modelo: M,
  padre: M | null | undefined,
): M {
  if (modelo.idModeloDesarrollo === null || padre === undefined || padre === null) {
    return modelo;
  }
  return { ...modelo, telas: padre.telas, avios: padre.avios, artes: padre.artes };
}

/** FORMA 3, la parte PURA en LOTE: {@link injertarRecetaDeUno} para una página entera. */
export function injertarRecetaCompartida<M extends ModeloConRecetaAnidada>(
  modelos: readonly M[],
  padres: readonly M[],
): M[] {
  const porId = new Map(padres.map((p) => [p.id, p]));
  return modelos.map((m) =>
    injertarRecetaDeUno(m, m.idModeloDesarrollo === null ? null : porId.get(m.idModeloDesarrollo)),
  );
}

/**
 * FORMA 3 completa: injerta la receta de los padres leyéndolos **en UNA sola consulta** para todos
 * los hijos de la página (nada de N+1).
 *
 * El llamador pasa el LECTOR de padres en vez del `include`, y eso es lo que hace que los tipos
 * cuadren solos: al ser el MISMO `include` con el que se leyeron los hijos, `M` es idéntico en las
 * dos patas y no hace falta ni un `as`. Si algún día los dos `include` divergen, esto **no
 * compila** — que es exactamente el aviso que se quiere.
 */
export async function conRecetaCompartida<M extends ModeloConRecetaAnidada>(
  modelos: readonly M[],
  leerPadres: (idsPadre: number[]) => Promise<M[]>,
): Promise<M[]> {
  const idsPadre = [
    ...new Set(modelos.map((m) => m.idModeloDesarrollo).filter((id): id is number => id !== null)),
  ];
  if (idsPadre.length === 0) {
    return [...modelos];
  }
  return injertarRecetaCompartida(modelos, await leerPadres(idsPadre));
}

/**
 * FORMA 3 para UN modelo: la que usan el precosto de la ficha y el del desarrollo, que leen un
 * `findUnique`. Sin padre que consultar (`idModeloDesarrollo === null`) **no toca la base**.
 */
export async function conRecetaCompartidaDeUno<M extends ModeloConRecetaAnidada>(
  modelo: M,
  leerPadre: (idPadre: number) => Promise<M | null>,
): Promise<M> {
  const idPadre = modelo.idModeloDesarrollo;
  if (idPadre === null) {
    return modelo;
  }
  return injertarRecetaDeUno(modelo, await leerPadre(idPadre));
}
