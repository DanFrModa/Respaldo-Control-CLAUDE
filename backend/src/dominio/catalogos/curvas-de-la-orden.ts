/**
 * ⭐ **LA CURVA DE LA ORDEN MANDA, y cuando difiere de la del modelo se AVISA** (V1-E3r,
 * §Post-F9.81).
 *
 * Daniel, capturando el consumo por talla de un avío: *"me da la curva diferente a como la di de
 * alta… yo le puse la curva de la XCH a la XG y en «recetas por liberar» me pone tallas de bebés"*.
 * Y él mismo corrigió el diagnóstico: *"creo que el error es mío… **mi información de pruebas es
 * incongruente**. Pero entonces, ¿de dónde toma las tallas realmente?"*.
 *
 * El sistema no tenía un defecto de cálculo: tomaba las tallas de donde debe (la matriz color×talla
 * de la ORDEN). Lo que sí tenía es que **dejó capturar dos curvas que se contradicen sin decir ni
 * media palabra**. Este módulo pone las palabras.
 *
 * 🔴 **AVISA, NUNCA BLOQUEA.** Entre las dos salidas que Daniel ofreció —*"no debería dejarme poner
 * otra curva"* o *"debería decirme que ya tiene una curva"*— eligió la segunda, y es coherente con
 * §Post-F9.64 (*la curva es una GUÍA, no una jaula*): que una OP pida tallas fuera de la curva del
 * modelo es legítimo y ocurre, y bloquearlo pararía trabajo real. Nada de lo que hay aquí lanza.
 *
 * 🔴 **El aviso lo REDACTA el servidor (A1).** Dice los **nombres de las dos curvas** y **qué tallas
 * sobran o faltan, en las dos direcciones** — un aviso que sólo dijera "son distintas" obligaría a
 * ir a buscar la diferencia a otra pantalla, que es justo lo que a Daniel le pasó. La pantalla sólo
 * lo pinta: ni arma la frase, ni resuelve el singular/plural, ni decide el orden de las etiquetas.
 *
 * ⚠️ **El universo comparado es SIEMPRE el mismo con el que se arma la matriz que el usuario ve
 * debajo.** Por eso {@link avisoCurvaDeLaOrden} recibe las tallas ya resueltas por el llamador en
 * vez de re-consultarlas: comparar contra otro conjunto sería una segunda contradicción encima de
 * la primera.
 *
 * La otra mitad de la decisión —*"si el modelo no tiene curva y ya tiene una OP, que jale la curva
 * de la OP"*— vive en {@link curvasDeLasOrdenesDelModelo} y en el dominio de modelos, que es quien
 * puede escribir el catálogo.
 */
import type { Tx } from '../../comun/transaccion.js';

// ── El AVISO: dos curvas que no coinciden ──────────────────────────────────────────────────

/** Un lado de la comparación: cómo se llama y qué tallas trae, EN SU ORDEN. */
export interface LadoDeLaComparacion {
  /** Nombre con el que se le habla al usuario ("Caballero básica", "las tallas de esta orden"). */
  nombre: string;
  /** Etiquetas de talla, en el orden en que el usuario las ve. */
  etiquetas: string[];
}

/** El aviso de curva distinta, ya redactado por el servidor. */
export interface AvisoCurvaDistinta {
  /** El texto completo, listo para pintar. Lo redacta el servidor (A1). */
  texto: string;
  /** Nombre de la curva del MODELO (para que la pantalla pueda rotularlo aparte si quiere). */
  curvaModelo: string;
  /** Nombre del conjunto de la ORDEN. */
  curvaOrden: string;
  /** Tallas que la ORDEN pide y la curva del modelo NO tiene ("sobran"). */
  sobran: string[];
  /** Tallas que la curva del modelo tiene y la ORDEN no pide ("faltan"). */
  faltan: string[];
}

/**
 * Redacta "N talla(s)" sin que el cliente tenga que reimplementar el singular/plural. Vive aquí,
 * una sola vez, porque el aviso entero es responsabilidad del servidor.
 */
function cuantasTallas(cuantas: number): string {
  return cuantas === 1 ? '1 talla' : `${String(cuantas)} tallas`;
}

/** Pinta una lista de etiquetas entre paréntesis, separadas por coma. */
function lista(etiquetas: string[]): string {
  return etiquetas.join(', ');
}

/**
 * Compara la curva del MODELO contra el conjunto de tallas de la ORDEN y devuelve el aviso
 * redactado, o `null` cuando **no hay nada que avisar**.
 *
 * Devuelve `null` en tres casos, y los tres son deliberados:
 *  • Los dos conjuntos son el MISMO (no hay contradicción).
 *  • El modelo no tiene curva (no hay dos curvas que se contradigan: hay un hueco, y ese hueco lo
 *    atiende la propuesta de {@link curvasDeLasOrdenesDelModelo}, no un aviso).
 *  • La orden todavía no tiene matriz (no hay con qué comparar).
 *
 * La comparación es de CONJUNTO, no de orden: que la orden liste las mismas tallas en otra secuencia
 * no es una contradicción — la secuencia de captura la manda la curva y la de la orden, su matriz.
 */
export function avisoCurvaDistinta(
  modelo: LadoDeLaComparacion | null,
  orden: LadoDeLaComparacion,
): AvisoCurvaDistinta | null {
  if (modelo === null || modelo.etiquetas.length === 0 || orden.etiquetas.length === 0) {
    return null;
  }

  const enModelo = new Set(modelo.etiquetas);
  const enOrden = new Set(orden.etiquetas);
  const sobran = orden.etiquetas.filter((e) => !enModelo.has(e));
  const faltan = modelo.etiquetas.filter((e) => !enOrden.has(e));

  if (sobran.length === 0 && faltan.length === 0) {
    return null;
  }

  const partes: string[] = [];
  if (sobran.length > 0) {
    partes.push(
      `la orden pide ${cuantasTallas(sobran.length)} que la curva no trae (${lista(sobran)})`,
    );
  }
  if (faltan.length > 0) {
    partes.push(
      `la curva trae ${cuantasTallas(faltan.length)} que la orden no pide (${lista(faltan)})`,
    );
  }

  const texto =
    `La curva del modelo («${modelo.nombre}»: ${lista(modelo.etiquetas)}) no coincide con ` +
    `${orden.nombre} (${lista(orden.etiquetas)}): ${partes.join(', y ')}. ` +
    'No bloquea: se compra y se consume sobre las tallas que el cliente pidió, que son las de la ' +
    'orden. Si la curva del modelo está mal, corrígela en su ficha.';

  return { texto, curvaModelo: modelo.nombre, curvaOrden: orden.nombre, sobran, faltan };
}

// ── Las CURVAS QUE USAN LAS ÓRDENES del modelo ─────────────────────────────────────────────

/** Una curva distinta usada por las órdenes de un modelo (candidata a llenar el hueco). */
export interface CurvaDeLasOrdenes {
  /** Ids de talla, EN el orden canónico (`Talla.orden`, V1-E3r). Es lo que se confirma. */
  idsTalla: number[];
  /** Etiquetas, en el mismo orden que `idsTalla`. */
  etiquetas: string[];
  /** Cuántas órdenes (no canceladas) de este modelo usan exactamente este conjunto. */
  ordenes: number;
  /** Folios de las órdenes que la usan (hasta {@link MAX_FOLIOS_MOSTRADOS}), para que se reconozca. */
  folios: number[];
  /** Si ya existe una curva del catálogo con EXACTAMENTE estas tallas: su id; si no, `null`. */
  idCurvaExistente: number | null;
  /** Nombre de esa curva del catálogo, o el nombre determinista que se le pondría al crearla. */
  nombre: string;
}

/** Cuántos folios se enseñan por sugerencia (los suficientes para reconocerla, no un listado). */
const MAX_FOLIOS_MOSTRADOS = 5;

/**
 * Nombre DETERMINISTA de una curva por su contenido, el mismo que usó el ETL
 * (`migracion/loaders/tallas.ts`): así una curva que el ETL ya sembró se reconoce por nombre y no
 * se duplica con otro rótulo.
 */
export function nombreDeterministaCurva(etiquetas: string[]): string {
  return `Curva ${etiquetas.join('-')}`;
}

/**
 * Busca la curva del catálogo que cubre EXACTAMENTE este conjunto de tallas, o `null`.
 *
 * 🔴 **Las dos condiciones son necesarias y ninguna sobra.** `items: { every: … }` en Prisma es
 * *vacuously true* para una curva SIN items: una curva vacía "cumple" que todos sus items están en
 * cualquier lista, así que sin el conteo esta función devolvería una curva de cero tallas como si
 * cubriera el conjunto. Y sin el `every`, el conteo solo diría que tiene el mismo NÚMERO de tallas,
 * no que sean las mismas. Es exactamente por eso que la prueba de esta guarda necesita una curva de
 * CERO items: con una de tres, el conteo ya la descarta sola y el defecto pasaría vivo.
 */
export async function curvaQueCubreExactamente(
  tx: Tx,
  idsTalla: number[],
): Promise<{ id: number; nombre: string } | null> {
  if (idsTalla.length === 0) {
    return null;
  }
  const candidatas = await tx.curvaTalla.findMany({
    where: { activo: true, items: { every: { idTalla: { in: idsTalla } } } },
    select: { id: true, nombre: true, _count: { select: { items: true } } },
    orderBy: { id: 'asc' },
  });
  const exacta = candidatas.find((c) => c._count.items === idsTalla.length);
  return exacta === undefined ? null : { id: exacta.id, nombre: exacta.nombre };
}

/**
 * Las curvas DISTINTAS que usan las órdenes de un modelo, de la más usada a la menos.
 *
 * 🔴 **`idEmpresa` es OBLIGATORIO y sin default (A9).** Las órdenes son POR EMPRESA (`Orden
 * .idEmpresa`) y el catálogo de tallas es global (ADR-0007): que el catálogo sea global NO autoriza
 * a leer las ÓRDENES de otra empresa. Sin este filtro, la curva que se le propone a un modelo puede
 * venir de una orden que quien mira no tiene derecho a ver — y quedaría escrita en el catálogo.
 *
 * ⚠️ **Si varias OP usan curvas distintas, se devuelven TODAS.** Una regla de desempate inventada
 * ("la más reciente", "la más usada") fallaría **en silencio** justo en el caso en que importa: la
 * persona es la que sabe cuál de las dos es la buena.
 *
 * Las órdenes CANCELADAS no cuentan: sus tallas no son un compromiso con nadie.
 */
export async function curvasDeLasOrdenesDelModelo(
  tx: Tx,
  idModelo: number,
  idEmpresa: number,
): Promise<CurvaDeLasOrdenes[]> {
  const filas = await tx.ordenLineaTalla.findMany({
    where: {
      ordenLinea: { orden: { idModelo, idEmpresa, estado: { not: 'cancelada' } } },
    },
    select: {
      idTalla: true,
      talla: { select: { etiqueta: true, orden: true } },
      ordenLinea: { select: { idOrden: true, orden: { select: { folio: true } } } },
    },
  });
  if (filas.length === 0) {
    return [];
  }

  // 1. El conjunto de tallas de CADA orden (una orden multi-color repite tallas por renglón).
  const porOrden = new Map<number, { folio: number; tallas: Map<number, string> }>();
  const ordenDeTalla = new Map<number, number>();
  for (const f of filas) {
    ordenDeTalla.set(f.idTalla, f.talla.orden);
    const idOrden = f.ordenLinea.idOrden;
    const acumulado = porOrden.get(idOrden) ?? {
      folio: Number(f.ordenLinea.orden.folio),
      tallas: new Map<number, string>(),
    };
    acumulado.tallas.set(f.idTalla, f.talla.etiqueta);
    porOrden.set(idOrden, acumulado);
  }

  // 2. Se agrupan las órdenes por conjunto. La firma se arma con los ids YA ordenados por la escala
  //    canónica, así dos órdenes que piden lo mismo caen juntas aunque su matriz esté en otro orden.
  const grupos = new Map<string, { idsTalla: number[]; etiquetas: string[]; folios: number[] }>();
  for (const { folio, tallas } of porOrden.values()) {
    const ordenadas = [...tallas.entries()].sort(
      ([idA, etiquetaA], [idB, etiquetaB]) =>
        (ordenDeTalla.get(idA) ?? 0) - (ordenDeTalla.get(idB) ?? 0) ||
        etiquetaA.localeCompare(etiquetaB, 'es') ||
        idA - idB,
    );
    const idsTalla = ordenadas.map(([id]) => id);
    const firma = idsTalla.join('-');
    const grupo = grupos.get(firma) ?? {
      idsTalla,
      etiquetas: ordenadas.map(([, etiqueta]) => etiqueta),
      folios: [],
    };
    grupo.folios.push(folio);
    grupos.set(firma, grupo);
  }

  // 3. El nombre de cada grupo: el de la curva del catálogo que lo cubre exacto, o el determinista.
  //    Se resuelven en PARALELO (son pocas): un `await` dentro del bucle sería un N+1.
  const ordenados = [...grupos.values()].sort(
    (a, b) =>
      b.folios.length - a.folios.length ||
      a.etiquetas.join('-').localeCompare(b.etiquetas.join('-'), 'es'),
  );
  const existentes = await Promise.all(
    ordenados.map((g) => curvaQueCubreExactamente(tx, g.idsTalla)),
  );

  return ordenados.map((g, i) => {
    const existente = existentes[i] ?? null;
    return {
      idsTalla: g.idsTalla,
      etiquetas: g.etiquetas,
      ordenes: g.folios.length,
      folios: [...g.folios].sort((a, b) => a - b).slice(0, MAX_FOLIOS_MOSTRADOS),
      idCurvaExistente: existente?.id ?? null,
      nombre: existente?.nombre ?? nombreDeterministaCurva(g.etiquetas),
    };
  });
}

// ── Los dos LADOS, rotulados por el servidor ───────────────────────────────────────────────

/**
 * El lado MODELO de la comparación, o `null` si el modelo no tiene curva (no hay contradicción que
 * avisar: hay un hueco, y el hueco lo llena la propuesta).
 */
export function ladoDelModelo(
  nombreCurva: string | null,
  etiquetas: string[],
): LadoDeLaComparacion | null {
  return nombreCurva === null ? null : { nombre: nombreCurva, etiquetas };
}

/** El lado ORDEN cuando se mira UNA orden concreta (la receta de la OP). */
export function ladoDeUnaOrden(nombreCurva: string, etiquetas: string[]): LadoDeLaComparacion {
  return { nombre: `las tallas de esta orden («${nombreCurva}»)`, etiquetas };
}

/**
 * El lado ORDEN cuando se mira el modelo y detrás hay VARIAS órdenes con el mismo conjunto (la
 * ficha del modelo y la captura de medidas por talla del avío del BOM).
 */
export function ladoDeVariasOrdenes(
  nombreCurva: string,
  cuantasOrdenes: number,
  etiquetas: string[],
): LadoDeLaComparacion {
  const cuantas =
    cuantasOrdenes === 1
      ? 'de 1 orden de producción'
      : `de ${String(cuantasOrdenes)} órdenes de producción`;
  return { nombre: `las tallas ${cuantas} («${nombreCurva}»)`, etiquetas };
}
