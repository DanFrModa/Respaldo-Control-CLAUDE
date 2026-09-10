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
 *
 * ---
 * ## Y LA OTRA MITAD: quién puede **ESCRIBIRLA** (pieza B)
 *
 * Todo lo de arriba es de LECTURA. La escritura **no se resuelve: se BLOQUEA**
 * ({@link exigirRecetaPropia}). Resolverla reescribiría en silencio la receta del desarrollo y la
 * de los hermanos desde el hijo de un solo color; el porqué, con las palabras de Daniel, está en
 * esa función. La única escritura que sí resuelve es la MARCA DE AGUA
 * (`revision-modelo.ts` → `tocarModeloPorCambioDeReceta`), que no escribe la receta sino el hecho
 * de que cambió.
 */
import type { PrismaClient } from '../../datos/index.js';
import type { Tx } from '../../comun/transaccion.js';

import { ErrorValidacion } from '../../comun/errores.js';

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

// ── ⭐⭐ LA OTRA MITAD DE LA REGLA: QUIÉN PUEDE **ESCRIBIR** LA RECETA ──────────────────────────

/**
 * ⭐⭐ V1-E9b pieza B — **UN MODELO QUE COMPARTE LA RECETA NO LA EDITA: LA MIRA.**
 *
 * Lanza si `idModelo` es un HIJO del linaje 1:N (lleva `idModeloDesarrollo`), y no hace nada en
 * cualquier otro caso — que es el 100 % de los modelos de hoy (REGLA 0-B: la columna nace en NULL
 * y sin backfill, y NULL significa *«la receta es la mía»*).
 *
 * ---
 * ## 🔴 POR QUÉ SE BLOQUEA Y **NO** SE RESUELVE, que es toda la decisión de esta pieza
 *
 * A las LECTURAS se les mete el resolver (`idModelo → idModeloDeLaReceta`) y quedan bien: el hijo
 * enseña la receta de su padre. La tentación es hacer lo mismo con las escrituras — y sería **el
 * defecto con otro nombre**: guardar la receta parado en el hijo del color café **reescribiría la
 * del desarrollo y la de los tres hermanos**, sin decirlo. El síntoma que llegaría es *«cambié un
 * cierre sólo en la café y se le cambió a los cuatro colores»*, con los cuatro precostos movidos ⇒
 * **precio equivocado al cliente**. Un `update` silencioso sobre cuatro modelos es exactamente lo
 * que la receta compartida vino a EVITAR, no a facilitar.
 *
 * **La dirección la dio Daniel y no hay que volver a preguntarla** (§Post-F9.135):
 *  • p.5 — la receta la mueve *«quien sea responsable de definir y aprobar las recetas»* ⇒ se edita
 *    **en el modelo de desarrollo**, que es donde vive.
 *  • p.4 — *«puede pasar que una OP del grupo se le cambie algún avío… se debe de poder hacer, pero
 *    advirtiendo de la diferencia»* ⇒ la divergencia **por color** vive **en la OP** (que lleva su
 *    receta congelada y editable, `produccion/receta-orden.ts`), no en el modelo.
 *
 * ⇒ El bloqueo no le quita nada a nadie: manda al sitio donde el cambio SÍ significa lo que el
 * usuario quiere. Por eso el mensaje nombra al modelo de desarrollo y a la orden, en vez de ser un
 * "no se puede" a secas.
 *
 * ## ⚠️ La ÚNICA escritura que sí resuelve, y por qué no está aquí
 *
 * `tocarModeloPorCambioDeReceta` (`revision-modelo.ts`) — la MARCA DE AGUA. No escribe la receta:
 * escribe *«la receta cambió»*, y ese hecho es del modelo **dueño** de la receta. Sellado en el
 * hijo, el aviso *«tu precio está sobre un costo viejo»* (`desarrollo/costo-viejo.ts`) **nunca
 * saldría**, porque lo lee por el padre (`listas-precios.ts`), y la cotización seguiría con el
 * precio viejo **sin alarma**. Ver la nota de esa función.
 *
 * ## 🔑 Y por qué el `if` está escrito al revés que en `esVersionDeModelo`
 *
 * Aquí la rama que **ABRE** (deja escribir) es `idModeloDesarrollo === null`, así que es ella la
 * que tiene que exigir conocimiento positivo: lo que no se sabe —una clave ausente, un `undefined`
 * de un objeto armado a mano— cae del lado de BLOQUEAR. Un bloqueo de más es ruidoso e inofensivo;
 * una escritura de más se lleva por delante la receta de cuatro modelos en silencio. En
 * `esVersionDeModelo` (`revision-modelo.ts`) el reparto es el opuesto —ahí la rama que abre la
 * compuerta es la del hijo— y por eso allá se pregunta `typeof === 'number'`. **Mismo principio,
 * operadores distintos:** no se copian el uno del otro.
 *
 * ⚠️ Que el modelo NO EXISTA no lo decide esta función (mismo criterio que
 * {@link resolverIdRecetaDeModelo}): sale sin lanzar y quien llamó —que siempre exige el modelo, el
 * arte o el renglón del BOM— da su propio 404. Convertirla en una guarda de existencia le cambiaría
 * el error a media docena de puertas.
 */
export async function exigirRecetaPropia(lector: Lector, idModelo: number): Promise<void> {
  const modelo = await lector.modelo.findUnique({
    where: { id: idModelo },
    select: {
      codigo: true,
      idModeloDesarrollo: true,
      modeloDesarrollo: { select: { codigo: true } },
    },
  });
  if (modelo === null) {
    return;
  }
  if (modelo.idModeloDesarrollo === null) {
    return;
  }
  // `?.` y no `=== null`: si la relación no viniera (un lector de mentira, un `select` recortado),
  // lo que tiene que salir es el error de NEGOCIO con la frase genérica, no un `TypeError` que la
  // ruta traduciría a un 500 opaco. La guarda ya decidió que hay que bloquear; el nombre del padre
  // es adorno del mensaje, y un adorno no puede cambiar el error.
  const padre = modelo.modeloDesarrollo?.codigo ?? null;
  throw new ErrorValidacion(
    `La receta de "${modelo.codigo}" no es suya: la COMPARTE con el modelo de desarrollo ` +
      `${padre === null ? 'del que nació' : `"${padre}"`}, y por eso los demás colores de ese ` +
      `desarrollo ven exactamente la misma. Edítala ahí y les cambia a todos a la vez. Si lo que ` +
      `hay que cambiar es SÓLO este color, el cambio va en su ORDEN de producción, no en el modelo.`,
  );
}
