/**
 * ⭐⭐ V1-E9b pieza B — **EL GUARDIÁN DE LOS ESCRITORES DE RECETA**, y es el TERCERO de la familia.
 *
 * Los otros dos trabajan **por ARCHIVO** y lo dicen ellos mismos (*"es una red, no un teorema"*):
 *
 *  • `receta-embudo.test.ts` — todo archivo que ESCRIBE la receta conoce `tocarModeloPorCambioDeReceta`.
 *  • `receta-compartida-guardian.test.ts` — todo archivo que la LEE conoce el resolver.
 *
 * 🔴 **Y entre los dos quedaba justo el hueco que esta pieza vino a tapar.** Un escritor NUEVO
 * dentro de un archivo YA listado pasa invisible por los dos: `bom-modelo.ts` importa el resolver
 * desde la pieza A, así que sus cuatro lecturas del ORIGEN de `copiarBom` —que no resolvían nada—
 * estuvieron rojas de defecto y verdes de suite. Y el guardián del embudo mira si el archivo
 * *menciona* el embudo, no si la función nueva lo llama.
 *
 * Éste trabaja **por FUNCIÓN**: parte cada archivo en sus funciones de nivel superior, se queda con
 * las que de verdad escriben una tabla de la receta, y exige que **cada una** esté declarada abajo
 * con la disciplina que sigue frente al linaje 1:N. Una función nueva que escriba la receta y no
 * esté declarada pone esto rojo, aunque su archivo ya conozca todas las herramientas del mundo.
 *
 * ---
 * ## 🔴 CÓMO REPARTE, y por qué está escrito así (dos rondas de revisión, las dos por lo mismo)
 *
 * **La red atribuye por BINDING DE NIVEL SUPERIOR**, no por «función». Cada `function`, `const`,
 * `let`, `var` o `class` declarado en la columna 0 abre un trozo que llega hasta el siguiente. Con
 * eso, *todo* lo que el archivo declara arriba del todo —una clase, un objeto con métodos, una
 * arrow, una `async function` asignada— entra al conjunto **con su propio nombre** y tiene que
 * declararse abajo si escribe la receta.
 *
 * 🔴 **Ronda 1 — reconocía dos formas** (`function f()` y `const f = (…) =>`). El reviewer probó
 * `const f = async function`, un método de clase y uno de objeto: las tres, **verdes**. La
 * escritura caía fuera de todo trozo, el archivo quedaba con cero funciones escritoras y la
 * comparación de conjuntos pasaba comparando vacío contra vacío.
 *
 * 🔴🔴 **Ronda 2 — el arreglo tapó sólo la mitad, y la peor mitad quedó viva.** Se añadió el conteo
 * ({@link contarEscrituras}) creyendo que *«lo único que puede faltar es lo que quede por DELANTE
 * de la primera declaración»*. **Falso:** lo que va DETRÁS no falta — **se acredita a la función
 * anterior**, porque su trozo llega hasta la siguiente marca. Una clase o un objeto metidos ENTRE
 * dos funciones (o al final del archivo) quedaban dentro del trozo del vecino: el conteo cuadraba,
 * el conjunto no cambiaba, **10/10 en verde**. Y ése es justo el caso realista: un repo crece
 * **añadiendo a un archivo que ya existe**, y `bom-modelo.ts` y `arte-modelo.ts` ya son escritores
 * declarados. Sólo fallaba cuando la forma rara estrenaba un archivo nuevo — el caso que no pasa.
 *
 * 🔴🔴🔴 **Ronda 3 — el mismo fallo, un modificador más adentro.** El patrón exigía que `class` (o
 * `function`) viniera **inmediatamente** detrás de `export`. Cualquier palabra en medio rompía la
 * marca y el cuerpo volvía a absorberse en el trozo del vecino: `export abstract class`,
 * `export default class` y `export default async function` salieron **11/11 en verde**. Y no era
 * vocabulario inventado — **los dos idiomas ya se escriben en este repo**: `export abstract class`
 * en `src/comun/errores.ts` (`ErrorDominio`, la raíz de los cinco errores de dominio) y
 * `export default async function` en `src/pruebas/entorno-global.ts`.
 *
 * ⇒ Por eso {@link DECLARACION_BINDING} reconoce `const|let|var|class` **a secas**, sin exigir qué
 * viene después del `=`, y **tolera los modificadores** que pueden ir entre `export` y la palabra
 * clave (`default`, `abstract`). Cada binding es su propio trozo, así que ni la clase ni el objeto
 * pueden esconderse detrás de una función.
 *
 * ⚠️ **Y el conteo NO sobra**: es la red para lo que de verdad queda huérfano — código suelto por
 * DELANTE de la primera declaración, que no pertenece a ningún trozo. Las dos reglas cubren cosas
 * distintas y ninguna sustituye a la otra:
 *   • el **conjunto declarado** caza la forma nueva que sí es un binding (clase, objeto, arrow…);
 *   • el **conteo** caza la escritura que no cuelga de ningún binding.
 *
 * ---
 * ## 📌 LO QUE ESTO NO ES, Y LA FRASE QUE HAY QUE LEER ANTES DE DARLO POR CERRADO
 *
 * **Atribuye por binding, y lo hace con un REGEX, no con un parser.** Cualquier modificador que se
 * cuele entre `export` y la palabra clave —`default`, `abstract`, o el que traiga TypeScript dentro
 * de dos años— **hay que enseñárselo**, porque sin él la marca no se crea. El ejemplo no es
 * teórico: `export abstract class` ya vive en `src/comun/errores.ts`.
 *
 * ⚠️ **Y el consuelo que hay que NO repetir**, porque es el que dejó pasar las rondas 2 y 3: *«da
 * igual, la escritura cae dentro del trozo de un binding que sí está declarado»*. Caer dentro de un
 * vecino declarado es exactamente lo que lo pone **VERDE**, no lo que lo hace **seguro**: el
 * conteo cuadra, el conjunto no cambia, y la puerta nueva no la mira nadie.
 *
 * ⇒ **Las formas que el repartidor reconoce están ESCRITAS COMO DATOS** en {@link FORMAS_DE_DECLARAR}
 * y se ejercitan una por una. Añadir una forma es añadir un renglón ahí, no una frase aquí: van tres
 * rondas dando este guardián por cerrado con la lección en prosa, y las tres veces faltó probar la
 * forma de al lado. **Un comentario no ejecuta.**
 *
 * ---
 * ## Las tres disciplinas, y por qué no son intercambiables
 *
 *  • **`bloquea-el-destino`** — la puerta llama a `exigirRecetaPropia` (`receta-compartida.ts`) y
 *    rechaza escribir sobre un hijo del 1:N. Es la regla de las TRECE puertas de la receta: un
 *    modelo que COMPARTE la receta no la edita, la mira. Resolverlas en vez de bloquearlas
 *    reescribiría la receta del desarrollo y la de los hermanos de color desde el hijo de un solo
 *    color, **en silencio** ⇒ *«cambié un cierre sólo en la café y se le cambió a los cuatro»*.
 *
 *  • **`resuelve-el-origen`** — la función LEE la receta de otro modelo para copiarla a uno NUEVO.
 *    Aquí resolver es lo correcto y bloquear sería el error: sin resolver, copiar DESDE un hijo
 *    trae VACÍO. En `copiarBom` eso además **borra** la receta del destino (`reemplazar: true` es
 *    el default) y en `copiarRecetaAModeloNuevo` produce un modelo nuevo que precostea sólo con
 *    maquila y corte — el precio que se le dice al cliente en la cara.
 *
 *  • **`compara-por-receta`** — la función no lee la receta de otro para copiarla: **compara** dos
 *    modelos y necesita saber si son la MISMA receta (dos ids distintos pueden serlo). Es lo que
 *    hace `copiarArteDeOtroModelo` al resolver su DESTINO para la guarda origen≠destino. Se separó
 *    de `resuelve-el-origen` porque estaba etiquetada así y **la etiqueta mentía**: aquélla dice
 *    «lee la receta de OTRO modelo para copiarla a uno NUEVO», y esto resuelve el destino. Prosa
 *    incumplida dentro del guardián anti-prosa — el reviewer lo cazó, y va aquí para que no vuelva.
 *
 *  • **`la-bloquea-su-puerta`** — ayudante PRIVADO que recibe el `idModelo` ya comprobado. Para
 *    que esto NO sea un argumento en prosa (la lección cara de esta etapa: la excepción de
 *    `versiones.ts` en el guardián de lecturas razonaba sobre una de dos puertas y concluía sobre
 *    la función), la declaración NOMBRA a sus puertas y el test comprueba las tres cosas: que la
 *    puerta existe en el mismo archivo, que llama al ayudante, y que ella sí bloquea.
 *
 *  • **`etl-de-modelos-migrados`** — única excepción de verdad: los cargadores corren a mano sobre
 *    los ~4,987 modelos del Access, que llevan `idModeloDesarrollo = NULL` (REGLA 0-B, sin backfill
 *    a propósito) ⇒ no hay linaje que resolver ni que bloquear.
 *
 * ⚠️ **Lo que este guardián SÍ y NO garantiza.** Garantiza que ninguna función escriba la receta
 * sin que alguien haya declarado —y el test comprobado— qué hace con el linaje. NO garantiza que la
 * llamada esté en el sitio correcto dentro de la función; eso lo cubren las pruebas de conducta
 * (`receta-compartida.int.test.ts`). Sigue siendo una red, pero con los agujeros mucho más chicos.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** La raíz del BACKEND (no de `src/`): el barrido tiene que alcanzar también `migracion/`. */
const RAIZ_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Las dos raíces de código del backend que pueden escribir la receta. */
const RAICES = ['src', 'migracion'];

/** Las tablas que SON la receta de un modelo (las mismas cinco de los otros dos guardianes). */
const TABLAS_DE_RECETA = [
  'modeloTela',
  'modeloAvio',
  'modeloAvioTalla',
  'modeloArte',
  'modeloArteFoto',
];

/** Los métodos de Prisma que ESCRIBEN. */
const ESCRITURAS = [
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
];

/** Los nombres de RELACIÓN por los que se escribe la receta sin nombrar jamás su tabla. */
const RELACIONES_DE_RECETA = ['telas', 'avios', 'artes', 'tallas', 'fotos'];

/** La escritura DIRECTA: `tx.modeloTela.createMany(...)`. */
const ESCRIBE_DIRECTO = new RegExp(
  `\\.(?:${TABLAS_DE_RECETA.join('|')})\\.(?:${ESCRITURAS.join('|')})\\s*\\(`,
);

/**
 * La escritura ANIDADA: `fotos: { create: … }` colgando del padre.
 *
 * ⚠️ Los `\s*` tienen que seguir cruzando SALTOS DE LÍNEA: **tres** de las escrituras de hoy
 * (`bom-modelo.ts`, `versiones.ts` y `arte-modelo.ts`, las tres del arte con sus fotos) tienen el
 * `fotos: {` y el `create:` en líneas distintas. Un barrido línea a línea no las ve — y son
 * precisamente las que borran y recrean el arte. La prueba de abajo lo fija con un ejemplo.
 */
const ESCRIBE_ANIDADO = new RegExp(
  `\\b(?:${RELACIONES_DE_RECETA.join('|')})\\s*:\\s*\\{\\s*(?:${ESCRITURAS.join('|')})\\s*:`,
);

const ESCRIBE_RECETA = (codigo: string): boolean =>
  ESCRIBE_DIRECTO.test(codigo) || ESCRIBE_ANIDADO.test(codigo);

/**
 * ⭐ CUÁNTAS escrituras de receta hay en un trozo de código.
 *
 * Se usa dos veces sobre lo mismo: el archivo ENTERO y la suma de sus trozos atribuidos. Si no
 * cuadran, hay una escritura que no cuelga de NINGÚN binding de nivel superior y por lo tanto no la
 * vigila nadie.
 *
 * ⚠️ **Qué caza exactamente, dicho sin adornos** (la frase que había aquí prometía de más y por eso
 * se coló la reincidencia de la ronda 2): los trozos son rebanadas CONTIGUAS y sin solape que van
 * desde la PRIMERA declaración hasta el final del archivo. Por lo tanto lo único que puede quedar
 * fuera de la suma es **el código anterior a la primera declaración**. Lo que va DETRÁS de una
 * declaración NO falta —se acredita al trozo de esa declaración—, y ésa es justamente la razón por
 * la que el conteo, solo, NO basta: quien caza la clase o el objeto añadidos al final de un archivo
 * ya listado es que {@link DECLARACION_BINDING} los convierta en su propio trozo.
 */
function contarEscrituras(codigo: string): number {
  return (
    (codigo.match(new RegExp(ESCRIBE_DIRECTO.source, 'g')) ?? []).length +
    (codigo.match(new RegExp(ESCRIBE_ANIDADO.source, 'g')) ?? []).length
  );
}

/**
 * Quita comentarios ANTES de repartir el código en funciones. No es cosmética: estos archivos
 * llevan doc-comments larguísimos que nombran funciones y herramientas (`exigirRecetaPropia`,
 * `resolverIdRecetaDeModelo`, `modeloArte.create`…). Sin quitarlos, el guardián le acreditaría a
 * una función la disciplina que sólo estaba DESCRITA en el comentario de la de al lado — y una
 * prueba que pasa por lo que dice un comentario es exactamente lo que esta etapa vino a matar.
 *
 * ⚠️ El comentario de LÍNEA se corta desde el `//` hasta el fin de línea, **conservando lo que va
 * delante**: media docena de llamadas de verdad llevan su comentario pegado detrás, y borrar la
 * línea entera se llevaría la llamada con él (la primera versión de esta función lo hacía, y la
 * prueba de abajo es la que lo cazó). El `(?<!:)` deja en paz los `https://` de las URLs.
 */
function sinComentarios(codigo: string): string {
  return codigo.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(?<!:)\/\/[^\n]*/g, '');
}

/**
 * Las FUNCIONES de nivel superior. Se ancla en el inicio de línea a propósito: lo indentado
 * —callbacks, arrows dentro de un `Promise.all`, funciones anidadas— pertenece al binding que lo
 * envuelve, que es justo lo que se quiere atribuir.
 */
const DECLARACION_FUNCION =
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm;

/**
 * ⭐⭐ Los demás BINDINGS de nivel superior: `const`, `let`, `var` y **`class`**.
 *
 * 🔴 A secas, sin mirar qué viene después del `=`, y ahí está toda la corrección de la ronda 2. La
 * versión anterior exigía `= (` o `= async function`, así que una **clase** o un **objeto con
 * métodos** no abrían trozo: quedaban absorbidos por el trozo de la función anterior, el conteo
 * cuadraba y el guardián se quedaba **verde con la puerta abierta**. Reconocer el binding entero
 * subsume las dos formas viejas sin perder ninguna y cierra las dos nuevas — y las cierra también
 * cuando se añaden **al final de un archivo que ya estaba listado**, que es como crece un repo de
 * verdad.
 */
const DECLARACION_BINDING =
  /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;

export interface TrozoDeFuncion {
  nombre: string;
  codigo: string;
}

/**
 * Reparte el archivo en trozos, uno por BINDING de nivel superior, cada uno desde su declaración
 * hasta la siguiente.
 */
function funcionesDe(codigo: string): TrozoDeFuncion[] {
  const marcas = [
    ...[...codigo.matchAll(DECLARACION_FUNCION)].map((m) => ({
      pos: m.index,
      nombre: m[1] as string,
    })),
    ...[...codigo.matchAll(DECLARACION_BINDING)].map((m) => ({
      pos: m.index,
      nombre: m[1] as string,
    })),
  ].sort((a, b) => a.pos - b.pos);

  return marcas.map((marca, i) => ({
    nombre: marca.nombre,
    codigo: codigo.slice(marca.pos, marcas[i + 1]?.pos ?? codigo.length),
  }));
}

/**
 * ⭐⭐⭐ **LAS FORMAS DE DECLARAR QUE EL REPARTIDOR RECONOCE, COMO DATOS.**
 *
 * Cada renglón es una sintaxis con la que alguien puede abrir una puerta nueva a la receta, y su
 * prueba se genera sola abajo. Están aquí —y no en una frase de la cabecera— porque **un comentario
 * no ejecuta**: tres rondas seguidas se dio este guardián por cerrado con la lección en prosa, y
 * las tres veces la forma que faltaba salió verde.
 *
 * ➕ **Cómo se añade una forma:** un renglón aquí. La prueba y el mensaje salen solos.
 *
 * ⚠️ El repartidor es un REGEX, no un parser: los modificadores entre `export` y la palabra clave
 * (`default`, `abstract`) hay que enseñárselos uno a uno. Los dos últimos renglones existen porque
 * este repo YA los escribe (`src/comun/errores.ts`, `src/pruebas/entorno-global.ts`).
 */
const FORMAS_DE_DECLARAR: { comoSeEscribe: string; nombre: string; codigo: string }[] = [
  {
    comoSeEscribe: 'export async function f()',
    nombre: 'efe',
    codigo:
      'export async function efe(tx: Tx) {\n  await tx.modeloTela.deleteMany({ where: {} });\n}',
  },
  {
    comoSeEscribe: 'function f() (sin export)',
    nombre: 'efe',
    codigo: 'function efe(tx: Tx) {\n  await tx.modeloTela.deleteMany({ where: {} });\n}',
  },
  {
    comoSeEscribe: 'export const f = async (…) => (arrow)',
    nombre: 'efe',
    codigo:
      'export const efe = async (tx: Tx) => {\n  await tx.modeloAvio.deleteMany({ where: {} });\n};',
  },
  {
    comoSeEscribe: 'export const f = async function (…) — RONDA 1',
    nombre: 'efe',
    codigo:
      'export const efe = async function (tx: Tx) {\n  await tx.modeloAvio.deleteMany({ where: {} });\n};',
  },
  {
    comoSeEscribe: 'let / var',
    nombre: 'efe',
    codigo: 'let efe = async (tx: Tx) => {\n  await tx.modeloArte.deleteMany({ where: {} });\n};',
  },
  {
    comoSeEscribe: 'export class con MÉTODO — RONDA 1 y 2',
    nombre: 'RepoTraviesa',
    codigo:
      'export class RepoTraviesa {\n  async borrar(tx: Tx) {\n    await tx.modeloAvio.deleteMany({ where: {} });\n  }\n}',
  },
  {
    comoSeEscribe: 'export const OBJETO con método — RONDA 1 y 2',
    nombre: 'repoArte',
    codigo:
      'export const repoArte = {\n  async borrar(tx: Tx) {\n    await tx.modeloArte.deleteMany({ where: {} });\n  },\n};',
  },
  {
    comoSeEscribe: 'export abstract class — RONDA 3 (ya se usa en `src/comun/errores.ts`)',
    nombre: 'RepoAbstracto',
    codigo:
      'export abstract class RepoAbstracto {\n  async borrar(tx: Tx) {\n    await tx.modeloTela.deleteMany({ where: {} });\n  }\n}',
  },
  {
    comoSeEscribe: 'export default class — RONDA 3',
    nombre: 'RepoDefault',
    codigo:
      'export default class RepoDefault {\n  async borrar(tx: Tx) {\n    await tx.modeloArte.deleteMany({ where: {} });\n  }\n}',
  },
  {
    comoSeEscribe:
      'export default async function — RONDA 3 (ya se usa en `src/pruebas/entorno-global.ts`)',
    nombre: 'repoSuelto',
    codigo:
      'export default async function repoSuelto(tx: Tx) {\n  await tx.modeloAvioTalla.deleteMany({ where: {} });\n}',
  },
];

// ── La declaración: qué escribe la receta hoy, y con qué disciplina ───────────────────────────

/** Las CINCO disciplinas posibles frente al linaje 1:N (ver la cabecera). */
type Disciplina =
  | 'bloquea-el-destino'
  | 'resuelve-el-origen'
  | 'compara-por-receta'
  | 'la-bloquea-su-puerta'
  | 'etl-de-modelos-migrados';

interface EscritorDeclarado {
  /** TODAS las disciplinas que esta función tiene que cumplir (se comprueban todas). */
  exige: Disciplina[];
  /** Sólo con `la-bloquea-su-puerta`: las funciones del MISMO archivo que la llaman. */
  puertas?: string[];
  /**
   * ⭐ Expresiones que NO pueden volver a aparecer en el cuerpo, con su razón.
   *
   * 🔴 **Nació de una MUTACIÓN QUE SOBREVIVIÓ.** `resuelve-el-origen` se conforma con que el
   * resolver aparezca *en algún sitio* de la función. En `copiarBom` eso no basta: usa el id
   * resuelto en DOS lugares —la guarda origen≠destino y las cuatro lecturas de la receta—, así que
   * devolver **sólo las lecturas** al id crudo dejaba el resolver en pie y el guardián en verde,
   * con el defecto entero de vuelta (copiar desde un hijo trae VACÍO, y con `reemplazar: true`
   * borra la receta del destino). Esto ata la resolución al sitio donde tiene efecto.
   */
  prohibido?: { patron: RegExp; razon: string }[];
  /** Por qué. Se lee en el diff — es la parte que un humano tiene que mirar. */
  razon: string;
}

const ESCRITORES: Record<string, Record<string, EscritorDeclarado>> = {
  'src/dominio/modelos/bom-modelo.ts': {
    sincronizarTelas: {
      exige: ['la-bloquea-su-puerta'],
      puertas: ['reemplazarTelasBom'],
      razon:
        'Ayudante privado del diff de telas: recibe el `idModelo` ya comprobado por su puerta.',
    },
    sincronizarAvios: {
      exige: ['la-bloquea-su-puerta'],
      puertas: ['reemplazarAviosBom'],
      razon: 'Ayudante privado del diff de avíos: mismo reparto que `sincronizarTelas`.',
    },
    copiarBom: {
      exige: ['bloquea-el-destino', 'resuelve-el-origen'],
      prohibido: [
        {
          patron: /idModelo:\s*datos\.idOrigen/,
          razon:
            'Una lectura de la receta con el id CRUDO del cuerpo: desde un hijo traería VACÍO, y ' +
            'con `reemplazar: true` (el default) eso BORRA la receta del destino sin poner nada.',
        },
      ],
      razon:
        'La única puerta con los DOS lados: el DESTINO se bloquea (con `reemplazar: true`, que es ' +
        'el default, copiar sobre un hijo BORRA la receta del desarrollo antes de reescribirla) y ' +
        'el ORIGEN se resuelve (copiar DESDE un hijo tiene que traer la receta que ese hijo ' +
        'enseña, no una lista vacía).',
    },
  },
  'src/dominio/modelos/arte-modelo.ts': {
    crearArte: {
      exige: ['bloquea-el-destino'],
      razon: 'El arte del hijo es el de su desarrollo: un renglón nuevo aquí sería invisible.',
    },
    actualizarArte: {
      exige: ['bloquea-el-destino'],
      razon: 'Editar desde el hijo movería el arte del desarrollo y el de sus hermanos de color.',
    },
    eliminarArte: {
      exige: ['bloquea-el-destino'],
      razon: 'Borrar desde el hijo se llevaría el arte de los cuatro colores (y sus fotos de R2).',
    },
    marcarArtePrincipal: {
      exige: ['bloquea-el-destino'],
      razon: 'Reordenar es escribir: movería el arte principal del desarrollo desde un hijo.',
    },
    copiarArteDeOtroModelo: {
      exige: ['bloquea-el-destino', 'compara-por-receta'],
      prohibido: [
        {
          patron: /origen\.idModelo === idModelo\b/,
          razon:
            'La guarda origen≠destino comparando el modelo LITERAL en vez del de su RECETA. Es la ' +
            'invariante «no te copies un arte que ya es tuyo», y no puede colgar de que la guarda ' +
            'de linaje siga ahí: son dos reglas distintas (la lección de `versiones.ts`).',
        },
      ],
      razon:
        'Destino bloqueado, y la guarda origen≠destino compara contra el modelo de la RECETA del ' +
        'destino: copiarse un arte de su PROPIO padre dejaría un renglón duplicado e invisible.',
    },
    solicitarSubidaFotoArte: {
      exige: ['bloquea-el-destino'],
      razon: 'La foto ES el arte que el bordador hace: se sube donde el arte vive (el desarrollo).',
    },
    quitarFotoArte: {
      exige: ['bloquea-el-destino'],
      razon: 'Quitar desde el hijo le quitaría la foto al arte del desarrollo y a los hermanos.',
    },
  },
  'src/dominio/modelos/avios-favoritos.ts': {
    aceptarAviosFavoritos: {
      exige: ['bloquea-el-destino'],
      razon:
        'La peor de las trece: calculaba los faltantes contra la receta del PADRE (la lectura sí ' +
        'resuelve), los creaba en el HIJO y devolvía la del padre sin ellos ⇒ «se agregaron 5» y ' +
        'no aparecía ninguno, y al reintentar un 409 falso y permanente.',
    },
  },
  'src/dominio/modelos/medidas-avio-talla.ts': {
    sincronizarMedidas: {
      exige: ['la-bloquea-su-puerta'],
      puertas: ['guardarMedidasAvio'],
      razon: 'Ayudante privado del set-completo de medidas por talla (R18).',
    },
    guardarMedidasAvio: {
      exige: ['bloquea-el-destino'],
      razon:
        'Las medidas por talla mueven el requerido del MRP: escritas desde el hijo se moverían ' +
        'para los cuatro colores en silencio.',
    },
  },
  'src/dominio/modelos/versiones.ts': {
    copiarRecetaAModeloNuevo: {
      exige: ['resuelve-el-origen'],
      prohibido: [
        {
          patron: /idModelo:\s*idPadre/,
          razon:
            'Una lectura de la receta con el id crudo del origen: copiar un hijo desde la mesa de ' +
            'negociación daría un modelo nuevo con la receta VACÍA, sin lanzar.',
        },
      ],
      razon:
        'Copia a un modelo RECIÉN NACIDO (destino en crudo a propósito: acaba de nacer en la misma ' +
        'transacción). El ORIGEN sí se resuelve, y ahí estaba el riesgo nº1 del 1:N: ' +
        '`desarrollo/modelo-en-la-mesa.ts` la llama DIRECTO con el modelo que el usuario eligió en ' +
        'la cita, y copiar un hijo daba un modelo nuevo con la receta VACÍA — sin lanzar.',
    },
  },
  'migracion/loaders/fotos-modelos.ts': {
    cargarFotosArte: {
      exige: ['etl-de-modelos-migrados'],
      razon:
        'Cargador del ETL de fotos del arte sobre los ~4,987 modelos MIGRADOS del Access, que ' +
        'llevan `idModeloDesarrollo = NULL` (REGLA 0-B: sin backfill, a propósito) ⇒ no hay linaje ' +
        'que resolver ni que bloquear. Corre a mano, fuera de la vida normal del sistema.',
    },
  },
};

/** Carpetas que no son código de negocio (generado por Prisma, ayudas de prueba). */
const CARPETAS_FUERA = ['src/datos/generated', 'src/pruebas'];

/** Todos los `.ts` de producción del backend (sin generados, sin pruebas), en las dos raíces. */
function fuentesDeProduccion(carpeta: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(carpeta)) {
    const completa = path.join(carpeta, entrada);
    const relativa = path.relative(RAIZ_BACKEND, completa).replaceAll(path.sep, '/');
    if (CARPETAS_FUERA.some((fuera) => relativa === fuera || relativa.startsWith(`${fuera}/`))) {
      continue;
    }
    if (entrada === 'node_modules') continue;
    if (statSync(completa).isDirectory()) {
      fuentesDeProduccion(completa, acumulado);
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.test.ts')) {
      acumulado.push(relativa);
    }
  }
  return acumulado;
}

describe('El guardián de los ESCRITORES de receta (V1-E9b pieza B)', () => {
  const fuentes = fuentesDeProduccion(path.join(RAIZ_BACKEND, RAICES[0] as string)).concat(
    fuentesDeProduccion(path.join(RAIZ_BACKEND, RAICES[1] as string)),
  );
  /** Código YA sin comentarios: todo lo de abajo mira código que se ejecuta, no prosa. */
  const codigo = new Map(
    fuentes.map(
      (f) => [f, sinComentarios(readFileSync(path.join(RAIZ_BACKEND, f), 'utf8'))] as const,
    ),
  );
  /** `archivo` → funciones de nivel superior que ESCRIBEN la receta, con su trozo de código. */
  const escritores = new Map<string, TrozoDeFuncion[]>(
    fuentes
      .filter((f) => ESCRIBE_RECETA(codigo.get(f) ?? ''))
      .map((f) => [f, funcionesDe(codigo.get(f) ?? '').filter((fn) => ESCRIBE_RECETA(fn.codigo))]),
  );

  it('la prueba está mirando el código de verdad (si no, no vigila nada)', () => {
    expect(fuentes.length).toBeGreaterThan(100);
    expect(fuentes).toContain('src/dominio/modelos/bom-modelo.ts');
    expect(fuentes.some((f) => f.startsWith('migracion/'))).toBe(true);
    // Y que el reparto por función no salió vacío: si `funcionesDe` se rompiera, TODAS las
    // aserciones de abajo pasarían por no tener nada que revisar.
    expect([...escritores.values()].flat().length).toBeGreaterThan(10);
  });

  it('🔴 ve la escritura ANIDADA aunque esté en VARIAS LÍNEAS (las tres del arte lo están)', () => {
    // Ésta es la clase que un `grep` por línea NO ve. Si el `\s*` dejara de cruzar el salto de
    // línea, las tres escrituras de fotos del arte desaparecerían del barrido en silencio.
    expect(ESCRIBE_RECETA('        fotos: {\n          create: a.fotos.map((f) => ({\n')).toBe(
      true,
    );
    expect(ESCRIBE_RECETA('await tx.modeloTela.createMany({ data })')).toBe(true);
    // Y no confunde una LECTURA con una escritura (ésas las vigila el otro guardián).
    expect(ESCRIBE_RECETA('await tx.modeloTela.findMany({ where })')).toBe(false);
    expect(ESCRIBE_RECETA('  telas: { where: { paraPreCosto: true } },')).toBe(false);
  });

  it('🔴 el barrido quita los COMENTARIOS antes de repartir (si no, la prosa acreditaría código)', () => {
    const conProsa = [
      'function inocente() {',
      '  /* aquí se llama a exigirRecetaPropia(tx, id) — pero sólo en el comentario */',
      '  // y aquí también: exigirRecetaPropia(tx, id)',
      '  return 1;',
      '}',
    ].join('\n');
    expect(sinComentarios(conProsa)).not.toContain('exigirRecetaPropia');
    // …y NO se lleva por delante el código que va DELANTE del comentario. Esta línea cazó un
    // defecto real de la primera versión: borraba la línea entera, así que una llamada con su
    // comentario pegado detrás desaparecía y el guardián la daba por ausente.
    expect(sinComentarios('await exigirRecetaPropia(tx, id); // ojo')).toContain(
      'await exigirRecetaPropia(tx, id);',
    );
    // Y una URL dentro de una cadena no se parte en dos.
    expect(sinComentarios("const u = 'https://r2.example';")).toContain('https://r2.example');
  });

  it('reparte por BINDING de nivel superior (lo indentado es de quien lo envuelve)', () => {
    const trozos = funcionesDe(
      [
        'function alfa() {',
        '  const f = () => tx.modeloTela.createMany({ data });',
        '}',
        'export async function beta() {',
        '  return 2;',
        '}',
      ].join('\n'),
    );
    expect(trozos.map((t) => t.nombre)).toEqual(['alfa', 'beta']);
    expect(ESCRIBE_RECETA(trozos[0]?.codigo ?? '')).toBe(true);
    expect(ESCRIBE_RECETA(trozos[1]?.codigo ?? '')).toBe(false);
  });

  describe('🔴🔴🔴 LAS FORMAS DE DECLARAR que el repartidor tiene que ver, una por una', () => {
    // ⭐⭐⭐ ESTE BLOQUE ES LA LECCIÓN DE TRES RONDAS DE REVISIÓN, y está escrito como DATOS a
    // propósito. Las tres veces el arreglo fue correcto para lo que se había probado, y las tres
    // veces faltó probar la forma de al lado:
    //
    //   ronda 1 — `const f = async function`, método de clase, método de objeto → verdes.
    //   ronda 2 — se añadió el conteo, pero la clase y el objeto DETRÁS de una función seguían
    //             absorbidos por el trozo del vecino → verdes en un archivo ya listado.
    //   ronda 3 — `export abstract class`, `export default class` y `export default async
    //             function` → verdes, porque el patrón exigía la palabra clave PEGADA a `export`.
    //
    // Cada renglón de {@link FORMAS_DE_DECLARAR} se ejercita **DETRÁS de una función ya declarada**,
    // que es la posición realista (un repo crece añadiendo al final de un archivo que ya existe) y
    // la que se quedaba verde. Añadir una forma es añadir un renglón: un comentario no ejecuta.
    const ANCLA = ['export async function ancla(tx: Tx) {', '  return tx;', '}'].join('\n');

    for (const forma of FORMAS_DE_DECLARAR) {
      it(`la ve: ${forma.comoSeEscribe}`, () => {
        const texto = `${ANCLA}\n${forma.codigo}\n`;
        const trozos = funcionesDe(texto);
        // 1. Abre SU PROPIO trozo, con su nombre: es lo que la mete en el conjunto que se compara
        //    contra `ESCRITORES`, y por lo tanto lo que obliga a declararla.
        expect(trozos.map((t) => t.nombre)).toEqual(['ancla', forma.nombre]);
        // 2. Y la escritura queda DENTRO de ese trozo, no del vecino.
        expect(ESCRIBE_RECETA(trozos[1]?.codigo ?? '')).toBe(true);
        expect(ESCRIBE_RECETA(trozos[0]?.codigo ?? '')).toBe(false);
      });
    }

    it('🔑 y por qué el CONTEO, solo, nunca iba a cazar ninguna de ellas', () => {
      // La mitad que explica la ronda 2: la escritura de la clase está atribuida en las DOS
      // versiones del repartidor —antes al vecino, ahora a ella—, así que la suma cuadra igual.
      // Quien la caza es que tenga NOMBRE PROPIO en el conjunto, no el conteo.
      const forma = FORMAS_DE_DECLARAR.find((f) => f.nombre === 'RepoTraviesa');
      const texto = `${ANCLA}\n${forma?.codigo ?? ''}\n`;
      expect(contarEscrituras(texto)).toBe(1);
      expect(funcionesDe(texto).reduce((n, t) => n + contarEscrituras(t.codigo), 0)).toBe(1);
    });

    it('los dos idiomas de la ronda 3 NO son inventados: este repo ya los escribe', () => {
      // Si esta prueba se cae, el ejemplo de la cabecera dejó de existir: busca dónde se usa hoy o
      // quítalo. Una justificación que ya no aplica es peor que ninguna — parece que alguien lo
      // comprobó cuando en realidad protege a un archivo que ya no está.
      const errores = readFileSync(path.join(RAIZ_BACKEND, 'src/comun/errores.ts'), 'utf8');
      expect(errores, 'el ejemplo `export abstract class` de la cabecera ya no vive aquí').toMatch(
        /^export abstract class /m,
      );
    });
  });

  it('⭐ NINGUNA escritura se queda FUERA de un trozo atribuido (código suelto de cabecera)', () => {
    // La SEGUNDA red, y cubre lo que la comparación de conjuntos no puede: una escritura que no
    // cuelga de ningún binding —código suelto por DELANTE de la primera declaración—. Ahí no hay
    // nombre que declarar, así que el conjunto no cambia; lo único que se nota es que la suma no
    // cuadra con el archivo.
    //
    // ⚠️ Lo que esta regla NO caza, y por eso no basta sola: lo que va DETRÁS de una declaración
    // NO falta — se acredita al trozo de esa declaración. Una clase añadida al final de un archivo
    // ya listado cuadra perfectamente aquí. A ésa la caza `DECLARACION_BINDING` dándole su propio
    // nombre. Las dos reglas cubren cosas distintas.
    for (const [archivo, funciones] of escritores) {
      const enElArchivo = contarEscrituras(codigo.get(archivo) ?? '');
      const atribuidas = funciones.reduce((suma, f) => suma + contarEscrituras(f.codigo), 0);
      expect(
        atribuidas,
        `${archivo}: hay ${String(enElArchivo)} escrituras de receta y sólo ${String(atribuidas)} ` +
          `caen dentro de un binding de nivel superior. Las que faltan están en código suelto por ` +
          `DELANTE de la primera declaración del archivo, así que no las vigila nadie: no tienen ` +
          `nombre que declarar. Muévelas dentro de una función (o de un binding) de nivel superior.`,
      ).toBe(enElArchivo);
    }
  });

  it('🔴 y esa cuenta CAZA de verdad una escritura suelta ANTES de la primera declaración', () => {
    // La prueba de la prueba: sin ella, `contarEscrituras` podría devolver siempre lo mismo en las
    // dos patas y la regla de arriba sería un adorno.
    const conHuerfana = [
      'await tx.modeloTela.deleteMany({ where: { idModelo } });',
      'export async function declarada() {',
      '  await tx.modeloAvio.createMany({ data });',
      '}',
    ].join('\n');
    const trozos = funcionesDe(conHuerfana).filter((f) => ESCRIBE_RECETA(f.codigo));
    expect(contarEscrituras(conHuerfana)).toBe(2);
    expect(trozos.reduce((n, f) => n + contarEscrituras(f.codigo), 0)).toBe(1);
  });

  it('reconoce `const f = async function (…)`, que la primera versión no veía', () => {
    const trozos = funcionesDe(
      'export const escribe = async function (tx: Tx) {\n' +
        '  await tx.modeloArte.deleteMany({ where: {} });\n' +
        '};\n',
    );
    expect(trozos.map((t) => t.nombre)).toEqual(['escribe']);
    expect(ESCRIBE_RECETA(trozos[0]?.codigo ?? '')).toBe(true);
    // Y `let`/`var`, para que el binding no dependa de la palabra elegida.
    expect(funcionesDe('let x = 1;\nvar y = 2;\n').map((t) => t.nombre)).toEqual(['x', 'y']);
  });

  it('⭐⭐ TODA función que escribe la receta está DECLARADA, y ninguna declarada sobra', () => {
    const encontradas = [...escritores.entries()]
      .flatMap(([archivo, fns]) => fns.map((fn) => `${archivo}::${fn.nombre}`))
      .toSorted();
    const declaradas = Object.entries(ESCRITORES)
      .flatMap(([archivo, fns]) => Object.keys(fns).map((nombre) => `${archivo}::${nombre}`))
      .toSorted();
    expect(
      encontradas,
      'Cambió el conjunto de funciones que ESCRIBEN una tabla de la receta. Si nació una puerta ' +
        'nueva, decláralA abajo con su disciplina frente al linaje 1:N (bloquea el destino / ' +
        'resuelve el origen): sin eso, editar la receta parado en un modelo HIJO reescribiría la ' +
        'del desarrollo y la de sus hermanos de color, en silencio. Si una desapareció o se ' +
        'renombró, bórrala de la declaración.',
    ).toEqual(declaradas);
  });

  it('⭐ cada puerta CUMPLE la disciplina que declaró (no basta con declararla)', () => {
    for (const [archivo, declaradas] of Object.entries(ESCRITORES)) {
      const trozos = new Map(
        funcionesDe(codigo.get(archivo) ?? '').map((fn) => [fn.nombre, fn.codigo]),
      );
      for (const [nombre, declarada] of Object.entries(declaradas)) {
        const cuerpo = trozos.get(nombre) ?? '';
        expect(cuerpo, `${archivo}::${nombre} no aparece en el archivo`).not.toBe('');

        if (declarada.exige.includes('bloquea-el-destino')) {
          expect(
            cuerpo,
            `${archivo}::${nombre} declara que BLOQUEA pero no llama a \`exigirRecetaPropia\``,
          ).toContain('exigirRecetaPropia(');
        }
        if (declarada.exige.includes('resuelve-el-origen')) {
          expect(
            cuerpo,
            `${archivo}::${nombre} declara que RESUELVE el origen pero no llama al resolver`,
          ).toContain('resolverIdRecetaDeModelo(');
        }
        if (declarada.exige.includes('compara-por-receta')) {
          expect(
            cuerpo,
            `${archivo}::${nombre} declara que compara POR RECETA pero no llama al resolver`,
          ).toContain('resolverIdRecetaDeModelo(');
        }
        if (declarada.exige.includes('la-bloquea-su-puerta')) {
          // Aquí es donde esta prueba se separa de un argumento en prosa: se comprueba que la
          // puerta nombrada EXISTE, que llama al ayudante y que ella sí bloquea.
          const puertas = declarada.puertas ?? [];
          expect(puertas, `${archivo}::${nombre} no nombró ninguna puerta`).not.toEqual([]);
          for (const puerta of puertas) {
            const cuerpoPuerta = trozos.get(puerta) ?? '';
            expect(cuerpoPuerta, `la puerta ${archivo}::${puerta} ya no existe`).not.toBe('');
            expect(
              cuerpoPuerta,
              `la puerta ${archivo}::${puerta} ya no llama a ${nombre}`,
            ).toContain(`${nombre}(`);
            expect(
              cuerpoPuerta,
              `la puerta ${archivo}::${puerta} dejó de llamar a \`exigirRecetaPropia\`, así que ` +
                `${nombre} escribe la receta SIN que nadie haya comprobado el linaje`,
            ).toContain('exigirRecetaPropia(');
          }
        }
        for (const { patron, razon } of declarada.prohibido ?? []) {
          expect(cuerpo, `${archivo}::${nombre} — ${razon}`).not.toMatch(patron);
        }
        if (declarada.exige.includes('etl-de-modelos-migrados')) {
          expect(
            archivo.startsWith('migracion/'),
            `${archivo}::${nombre} se declara ETL pero no vive en \`migracion/\``,
          ).toBe(true);
        }
      }
    }
  });

  it('⭐ la MARCA DE AGUA es la única escritura que resuelve, y sigue resolviendo', () => {
    // `tocarModeloPorCambioDeReceta` no escribe la receta —escribe que la receta CAMBIÓ— y por eso
    // no aparece arriba. Pero es la excepción de la etapa y tiene que quedar amarrada: sellada en
    // el hijo, el aviso «la receta cambió después de congelarse el costo» (`costo-viejo.ts`, que
    // llega por el PADRE) NUNCA sale, y la cotización sigue con el precio viejo sin alarma.
    const revision = codigo.get('src/dominio/modelos/revision-modelo.ts') ?? '';
    const desde = revision.indexOf('export async function tocarModeloPorCambioDeReceta');
    expect(desde).toBeGreaterThan(-1);
    const cuerpo = revision.slice(desde);
    expect(cuerpo).toContain('resolverIdRecetaDeModelo(tx, idModelo)');
    // Y que lo resuelto es lo que se usa en las DOS patas (la firma y la marca), no sólo en una:
    // son ramas gemelas y arreglar una sola deja la otra escribiendo en el hijo.
    expect(cuerpo).toMatch(/invalidarRevisionSiAprobada\(tx, sesion, idReceta, cambio\)/);
    expect(cuerpo).toMatch(/where: \{ id: idReceta \}/);
  });
});
