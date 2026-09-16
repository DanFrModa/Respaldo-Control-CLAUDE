/**
 * ⭐⭐ LA RED QUE IMPIDE QUE «ESCRIBIR Y LUEGO NEGAR» VUELVA A NACER (fila 0.199).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * QUÉ DEFECTO VIGILA
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Una operación **escribe** con su permiso (`compras.administrar`), **cierra la transacción**, y
 * para devolverle al usuario el eco de lo que acaba de guardar llama a una consulta que exige
 * **OTRO** permiso (`compras.ver`) ⇒ **403 con el documento YA guardado y su folio ya quemado**.
 * Quien captura lee «no tienes permiso», cree que no se guardó, y vuelve a capturar: dos órdenes de
 * compra con dos folios. Es el sistema informando MAL sobre su propio estado.
 *
 * Se arreglaron **48 sitios** en cuatro filas (0.195, 0.196, 0.197, 0.198). Los 48 estaban escritos
 * de buena fe: nada impedía que el 49 naciera en la siguiente función que alguien escribiera. Esta
 * comprobación es lo que lo impide. **Corre en el CI** (`src/pruebas/eco-sin-reja.test.ts`, proyecto
 * `unit` → job `backend`, bloqueante): no depende de que nadie se acuerde.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * EL ARREGLO CANÓNICO QUE LA RED RECONOCE COMO CORRECTO
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * ```ts
 * export async function proyectarOC(sesion, id, bd?) { …lee y arma el DTO… }        // SIN reja
 * export async function obtenerOC(sesion, id, bd?) {                                 // CON reja
 *   verificarPermiso(sesion, 'compras.ver');
 *   return proyectarOC(sesion, id, bd);
 * }
 * export async function crearOC(sesion, entrada, bd?) {
 *   verificarPermiso(sesion, 'compras.administrar');
 *   const idOC = await enTransaccion(async (tx) => { … }, bd);
 *   return proyectarOC(sesion, idOC, bd);   // ← el ECO va por la proyectora, no por la consulta
 * }
 * ```
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CÓMO MIDE (y por qué NO es un `grep`)
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Los cuatro censos que se usaron en las filas 0.195–0.198 buscaban `verificarPermiso(sesion, '…')`
 * **literal**, y por eso compartían dos puntos ciegos medidos. Esta red no los tiene:
 *
 *  **(1) Rejas ENVUELTAS en un helper.** En el repo hay al menos tres puertas que no llaman a
 *  `verificarPermiso` donde se ven (`exigirVerCorrida`, `exigirVerCotejo`,
 *  `exigirAlgunPermisoCiclico`) y de ellas dependen 9 escritores. Aquí la exigencia de una función
 *  se calcula **transitivamente por el grafo de llamadas** (ver {@link exigenciaDe}), así que da
 *  igual cuántas capas de helper haya —y una regresión metida **DENTRO** de uno de esos helpers
 *  también se ve, porque la exigencia del helper se recalcula desde su cuerpo en cada corrida.
 *
 *  **(2) Índice por NOMBRE GLOBAL.** Hay homónimos entre archivos (`agregarLineaManual` existe dos
 *  veces). Todo se indexa por **(archivo, función)**; nunca por nombre suelto.
 *
 * Y el modelo de permisos es **CNF** (conjunción de disyunciones), no un conjunto plano, porque las
 * puertas OR son la diferencia entre una red útil y una que grita en los 9 sitios correctos hasta
 * que alguien la apaga:
 *  - `verificarPermiso(sesion, 'k')`  → cláusula `{k}` (hay que traer k).
 *  - `exigirVerCorrida`               → cláusula `{pagos.corrida-ver ∨ pagos.corrida-armar}`.
 *  - Una cláusula está **satisfecha** si alguna cláusula ya garantizada es **subconjunto** suya. Por
 *    eso quien trae `pagos.corrida-armar` satisface `{ver ∨ armar}` y **no se reporta**; y por eso
 *    si alguien añade una exigencia nueva dentro de la puerta, esa cláusula nueva **sí** se reporta.
 *
 * El recorrido arranca en las **rutas** (`src/api/**\/*.rutas.ts`), que son donde se sabe qué llave
 * trae quien llama (`preHandler: app.conPermiso('a')` = `{a}`; `[conPermiso('a'), conPermiso('b')]`
 * = `{a} ∧ {b}`; `conAlgunPermiso('a','b')` = `{a ∨ b}`), y baja por el grafo acumulando lo que cada
 * función exige antes de escribir. Eso resuelve de un golpe los dos casos que el censo a mano tuvo
 * que clasificar a ojo:
 *  - los **22** sitios donde la RUTA exige los dos permisos encadenados salen **limpios** solos,
 *    porque la garantía con la que se entra al dominio ya trae los dos;
 *  - y el hueco que esa exención tenía —`generarPrecosto` también se llama **desde el dominio**,
 *    donde no hay `preHandler` que valga— **no existe aquí**, porque cada camino se mide entero: si
 *    el llamador de dominio no trae la llave, el camino se reporta aunque la ruta «propia» la traiga.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * LA MEDICIÓN QUE LA VALIDA (16-sep-2026)
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Contra el árbol **de antes** de los arreglos (`4c8894f0`, el commit anterior a la fila 0.195,
 * exportado con `git archive`): **53 sitios**, repartidos EXACTAMENTE como las cuatro filas los
 * describen — 5 de Ruta Crítica (0.195: dos manejadores de `programacion.rutas.ts`, `estampado.ts`
 * y los dos de `hitosOrden.ts`), 8 de producción (0.196), 21 de altas (0.197) y 19 de ediciones
 * (0.198). Los 53 caen dentro de los archivos que esos cuatro commits tocaron, y contra
 * `origin/prueba` de hoy la red sale **limpia**.
 *
 * 📌 **Sobre el «48» de los documentos:** `HOJA-DE-RUTA.md` y `HISTORIAL-DE-VERSIONES.md` dicen «48
 * REALES» y a la vez reparten las cuatro filas en **5 + 8 + 21 + 19 = 53**. Esta herramienta mide
 * **53**, que es lo que cuadra con el reparto. La cifra de los documentos **no se tocó en la fila
 * 0.199** (queda dicho para quien la audite); lo que sí es auditable desde aquí es el 53.
 *
 * Y la parte que demuestra que la red **no está simplemente callada**: si se le quita la regla del
 * subconjunto (se exige coincidencia exacta de cláusula), sobre el árbol de HOY aparecen **35**
 * sitios que hoy exonera con razón — **9 escritores** detrás de las tres puertas OR (5 de
 * `pagos/corrida.ts`, 2 de `pagos/cotejo.ts`, 2 de `indicadores/inventario-ciclico.ts`, justo los 9
 * que el censo a mano tuvo que apartar) y los **22** que la ruta cubre con `preHandler` encadenado
 * (8 de listas de precios, 5 de negociación, 2 de cotizaciones y 7 de precostos: los 22 enumerados
 * en `HOJA-DE-RUTA.md`), más las tres consultas que son la puerta misma y `crearPagoMaquilero`. O
 * sea: la red **recorre** esos 35 caminos y decide; no es que no los vea.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA RED **NO** VE (dicho a propósito — una red que promete el 100 % es peor que una que
 * cubre el 80 % y lo dice)
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 *  a. **Entradas que no son rutas HTTP**: consumidores de la cola (pg-boss), ETL de `migracion/` y
 *     scripts. Ahí no hay `preHandler` del que partir. Un defecto que SÓLO sea alcanzable por esos
 *     caminos no se ve.
 *  b. **Permisos calculados**: `verificarPermiso(sesion, clave)` con una variable en vez de un
 *     literal. No se puede leer sin resolver tipos; se ignora.
 *  c. **Llamadas DENTRO de la transacción**: se consideran protegidas, porque lo son — si el 403
 *     sale, el `ROLLBACK` no deja nada escrito, y ése es justo el motivo por el que el censo a mano
 *     descartó 4 sitios (`importarCfdi`, `importarCfdiVenta`, `salidaAProduccion`…). ⚠️ **El precio
 *     de esa regla**: `crearModeloEnLista` (`desarrollo/modelo-en-la-mesa.ts`) llama a
 *     `generarPrecosto` **dentro** de su transacción, así que la reja `desarrollo.ver` de su línea
 *     366 —la única que protege esa vía dominio→dominio— **NO la vigila esta red**. Quitarla no deja
 *     datos a medias (revierte), pero sí un 403 confuso a mitad de operación. Sigue siendo un
 *     comentario en el código quien lo defiende. Y tampoco se distingue el caso de que la función
 *     llamada abra su PROPIA transacción por no recibir `bd`.
 *  d. **Indirección dinámica**: llamadas a través de variables, mapas de funciones o métodos de
 *     objetos. Sólo se resuelven llamadas a identificadores importados o declarados en el archivo.
 *  e. **Orden dentro de un mismo `enTransaccion`**: lo que pase dentro del callback no se ordena.
 *  f. **Profundidad**: el recorrido corta a 12 niveles de llamada por debajo de la ruta. Medido el
 *     16-sep-2026, ninguno de los 53 sitios del árbol viejo estaba a más de 3; la cota está para que
 *     una recursión rara no cuelgue la prueba, no porque haga falta.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * VIVE EN `src/pruebas/` A PROPÓSITO
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * `tsconfig.build.json` excluye `src/pruebas/**`, así que este analizador **no entra en `dist/`** ni
 * viaja al contenedor de producción (usa `typescript`, que es `devDependency`). Y al vivir bajo
 * `src/` sí lo alcanzan `npm run typecheck`, `npm run lint` y `npm run format:check`, a diferencia
 * de `herramientas/verificar-documentos.mjs`, que quedó en tierra de nadie y tuvo que colgarse del
 * suite del frontend a mano.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import ts from 'typescript';

// ── Vocabulario ─────────────────────────────────────────────────────────────────────────────────

/** Una disyunción de permisos: basta traer UNO de ellos. Se guarda ordenada para poder comparar. */
export type Clausula = readonly string[];

/** Exigencia en CNF: hay que satisfacer TODAS las cláusulas. */
export type Cnf = readonly Clausula[];

/** Clave estable de una función: `ruta/relativa.ts::nombre`. NUNCA el nombre suelto (homónimos). */
type ClaveFuncion = string;

/** Un sitio donde la red encontró «escribir y luego negar». */
export interface Hallazgo {
  /** Archivo (relativo a `backend/`) de la función que escribe. */
  readonly archivo: string;
  /** Función que escribe y luego pide el eco. */
  readonly funcion: string;
  /** Línea (1-based) de la llamada que niega. */
  readonly linea: number;
  /** Función a la que se llama DESPUÉS del commit. */
  readonly llamada: string;
  /** Archivo donde vive esa función. */
  readonly archivoLlamada: string;
  /** Permisos que la escritura ya cobró (lo que quien llama trae garantizado). */
  readonly garantizados: readonly string[];
  /** La cláusula que nadie satisface: hay que traer alguno de estos y no se trae ninguno. */
  readonly faltante: Clausula;
  /** Rutas HTTP desde las que se llega a este sitio (para reproducirlo). */
  readonly rutas: readonly string[];
}

/** Resultado completo de una corrida. */
export interface Resultado {
  readonly hallazgos: readonly Hallazgo[];
  /** Excepciones declaradas que ya no corresponden a ningún sitio real (lista podrida). */
  readonly excepcionesPodridas: readonly string[];
  /** Cuántas rutas HTTP sirvieron de punto de partida (sanidad: si baja a 0, la red no midió nada). */
  readonly rutasAnalizadas: number;
  /** Cuántas funciones se indexaron (misma sanidad). */
  readonly funcionesIndexadas: number;
}

// ── Excepciones declaradas ──────────────────────────────────────────────────────────────────────

/**
 * ⚠️ LA ÚNICA VÍA PARA DEJAR PASAR UN SITIO — y no es «apagar la regla».
 *
 * Cada entrada silencia **un** sitio concreto (archivo + función que escribe + función que niega +
 * permiso que falta) y **obliga a escribir la razón**. Todo lo demás sigue midiéndose.
 *
 * 🔑 **Y la lista no se puede pudrir:** si una entrada deja de corresponder a un sitio real —porque
 * alguien arregló el sitio, renombró la función o movió el archivo— la comprobación **falla igual**,
 * diciendo que sobra. Una lista de excepciones que nadie limpia acaba tapando defectos nuevos; ésta
 * avisa el día que sobra, no seis meses después.
 *
 * Hoy está **vacía**, y eso es una medición, no una omisión: los 53 sitios se arreglaron de verdad
 * y las tres puertas OR las reconoce el modelo CNF por su forma (ver {@link puertaDeLaSentencia}),
 * así que no hizo falta declarar ni una. Si algún día hace falta, va aquí con su razón escrita —y
 * conviene mirar dos veces: una excepción que se pueda describir como CATEGORÍA («las llamadas
 * dentro de la transacción», «las puertas OR») no es una excepción, es una regla que falta.
 */
export const EXCEPCIONES: readonly {
  readonly archivo: string;
  readonly funcion: string;
  readonly llamada: string;
  readonly permiso: string;
  readonly razon: string;
}[] = [];

// ── Utilidades de CNF ───────────────────────────────────────────────────────────────────────────

const clave = (c: Clausula): string => [...c].sort().join('|');

/** Añade una cláusula a una CNF sin duplicarla. */
function agregar(cnf: Clausula[], nueva: Clausula): void {
  if (nueva.length === 0) return;
  const k = clave(nueva);
  if (!cnf.some((c) => clave(c) === k)) cnf.push([...nueva].sort());
}

/** Une dos CNF (conjunción). */
function unir(a: Cnf, b: Cnf): Cnf {
  const salida: Clausula[] = [];
  for (const c of a) agregar(salida, c);
  for (const c of b) agregar(salida, c);
  return salida;
}

/**
 * ¿La garantía satisface la cláusula? Sí cuando **alguna** cláusula ya garantizada es subconjunto
 * de la exigida: si traigo `{armar}` y me piden `{ver ∨ armar}`, traigo lo suficiente. Es lo que
 * hace que las tres puertas OR del repo **no** produzcan falsos positivos.
 */
function satisface(garantia: Cnf, exigida: Clausula): boolean {
  const pedidos = new Set(exigida);
  return garantia.some((g) => g.length > 0 && g.every((p) => pedidos.has(p)));
}

/** Permisos que la garantía asegura de forma individual (para el mensaje de error). */
function garantizadosPlanos(garantia: Cnf): string[] {
  return [...new Set(garantia.flat())].sort();
}

// ── Índice del código ───────────────────────────────────────────────────────────────────────────

interface Funcion {
  readonly clave: ClaveFuncion;
  readonly archivo: string;
  readonly nombre: string;
  readonly cuerpo: ts.Node;
  readonly fuente: ts.SourceFile;
}

interface Archivo {
  readonly ruta: string;
  readonly fuente: ts.SourceFile;
  /** Nombre local importado → archivo (relativo) donde vive. */
  readonly importes: ReadonlyMap<string, string>;
  /** Nombre declarado en este archivo → clave de función. */
  readonly locales: ReadonlyMap<string, ClaveFuncion>;
}

/** Métodos de Prisma que dejan rastro: si aparecen, hubo escritura. */
const METODOS_ESCRITURA = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** Llamadas que ABREN Y CIERRAN una transacción: lo que venga después ya está comiteado. */
const ABRE_TRANSACCION = new Set(['enTransaccion', '$transaction']);

function listarTs(raiz: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(raiz)) {
    const completa = join(raiz, entrada);
    if (statSync(completa).isDirectory()) {
      if (entrada === 'generated' || entrada === 'node_modules') continue;
      listarTs(completa, salida);
    } else if (
      entrada.endsWith('.ts') &&
      !entrada.endsWith('.d.ts') &&
      !entrada.includes('.test.')
    ) {
      salida.push(completa);
    }
  }
  return salida;
}

/** Nombre invocado de una llamada: `foo()` → `foo`; `tx.orden.create()` → `create`. */
function nombreLlamado(llamada: ts.CallExpression): string | undefined {
  const expr = llamada.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

/** `foo()` donde `foo` es un identificador suelto (lo único que se sabe resolver). */
function identificadorLlamado(llamada: ts.CallExpression): string | undefined {
  return ts.isIdentifier(llamada.expression) ? llamada.expression.text : undefined;
}

/** El segundo argumento como literal de texto, si lo es. */
function literalEnPosicion(llamada: ts.CallExpression, i: number): string | undefined {
  const arg = llamada.arguments[i];
  return arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : undefined;
}

/** ¿Este nodo abre un ámbito propio (no se desciende a él al listar las llamadas del ámbito)? */
function esFuncion(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isClassDeclaration(n) ||
    ts.isClassExpression(n)
  );
}

/**
 * Llamadas del ámbito, **en orden de aparición** y **sin entrar** a las funciones anidadas.
 *
 * Lo segundo es la clave de que los sitios correctos no se reporten: en
 * `enTransaccion(async (tx) => { … }, bd)` el callback NO se recorre aquí, así que lo que ocurre
 * dentro de la transacción **no** cuenta como «después del commit» — que es exactamente lo que lo
 * protege (si revienta, el `ROLLBACK` no deja nada escrito).
 */
function llamadasDelAmbito(cuerpo: ts.Node): ts.CallExpression[] {
  const salida: ts.CallExpression[] = [];
  const visitar = (n: ts.Node): void => {
    if (esFuncion(n)) return;
    if (ts.isCallExpression(n)) salida.push(n);
    ts.forEachChild(n, visitar);
  };
  // ⚠️ Si el cuerpo NO es un bloque es la EXPRESIÓN de una arrow (`handler: async (r) => crearX(r)`,
  // que es como están escritos varios manejadores de ruta): ahí la llamada es el propio nodo, y
  // arrancar por sus hijos la dejaría fuera — el ámbito entero pasaría por «no llama a nadie».
  if (ts.isBlock(cuerpo)) {
    ts.forEachChild(cuerpo, visitar);
  } else {
    visitar(cuerpo);
  }
  return salida.sort((a, b) => a.getStart(a.getSourceFile()) - b.getStart(b.getSourceFile()));
}

/** Las sentencias del cuerpo, en orden, con las del `try` puestas en línea. */
function sentenciasDelCuerpo(cuerpo: ts.Node): ts.Node[] {
  if (!ts.isBlock(cuerpo)) return [cuerpo]; // arrow de expresión (ver `llamadasDelAmbito`)
  const salida: ts.Node[] = [];
  for (const s of cuerpo.statements) {
    if (ts.isTryStatement(s)) salida.push(...s.tryBlock.statements);
    else salida.push(s);
  }
  return salida;
}

/**
 * Llamadas de UNA sentencia que se ejecutan **con certeza** si no se lanza: nunca dentro de un
 * `if`, un ternario, un bucle, un `catch` ni a la derecha de un `&&`/`||`. Dar por bueno un permiso
 * verificado dentro de un `if` sería justo el falso negativo que esta red no se puede permitir.
 */
function llamadasCiertasDe(sentencia: ts.Node): ts.CallExpression[] {
  const salida: ts.CallExpression[] = [];
  const recorrerSentencia = (n: ts.Node): void => {
    if (esFuncion(n)) return;
    if (
      ts.isIfStatement(n) ||
      ts.isConditionalExpression(n) ||
      ts.isForStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isWhileStatement(n) ||
      ts.isDoStatement(n) ||
      ts.isSwitchStatement(n) ||
      ts.isCatchClause(n) ||
      (ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      return;
    }
    if (ts.isCallExpression(n)) salida.push(n);
    ts.forEachChild(n, recorrerSentencia);
  };
  recorrerSentencia(sentencia);
  return salida.sort((a, b) => a.getStart(a.getSourceFile()) - b.getStart(b.getSourceFile()));
}

/** Todas las llamadas ciertas del cuerpo, como conjunto (lo que necesita el recorrido). */
function llamadasCiertas(cuerpo: ts.Node): Set<ts.CallExpression> {
  const salida = new Set<ts.CallExpression>();
  for (const sentencia of sentenciasDelCuerpo(cuerpo)) {
    for (const llamada of llamadasCiertasDe(sentencia)) salida.add(llamada);
  }
  return salida;
}

/** Claves de los `tienePermiso(sesion, 'k')` que aparecen en una expresión. */
function clavesTienePermiso(expresion: ts.Node): string[] {
  return todasLasLlamadas(expresion)
    .filter((l) => identificadorLlamado(l) === 'tienePermiso')
    .map((l) => literalEnPosicion(l, 1))
    .filter((k): k is string => k !== undefined);
}

/** ¿La rama es un `return` a secas (con o sin bloque)? */
function esReturnSeco(rama: ts.Statement | undefined): boolean {
  if (rama === undefined) return false;
  if (ts.isReturnStatement(rama)) return true;
  return (
    ts.isBlock(rama) && rama.statements.length === 1 && ts.isReturnStatement(rama.statements[0]!)
  );
}

/** ¿La rama lanza un `ErrorPermiso`? */
function lanzaErrorPermiso(rama: ts.Statement | undefined): boolean {
  if (rama === undefined) return false;
  const cuerpo = ts.isBlock(rama) ? rama.statements : [rama];
  return cuerpo.some(
    (s) =>
      ts.isThrowStatement(s) &&
      ts.isNewExpression(s.expression) &&
      ts.isIdentifier(s.expression.expression) &&
      s.expression.expression.text === 'ErrorPermiso',
  );
}

/**
 * ⭐ LAS PUERTAS **OR** DEL REPOSITORIO, LEÍDAS POR SU FORMA — y el motivo de que la red no grite en
 * los 9 escritores que dependen de ellas.
 *
 * Devuelve, para una sentencia, o bien un **atajo** (claves que a partir de aquí dejan salir sin más
 * comprobaciones) o bien una **cláusula** exigida. Las dos formas que existen hoy:
 *
 * ```ts
 * if (tienePermiso(sesion, 'pagos.corrida-armar')) return;   // ← ATAJO: {corrida-armar}
 * verificarPermiso(sesion, 'pagos.corrida-ver');             //   ⇒ cláusula {ver ∨ armar}
 *
 * if (!tienePermiso(a) && !tienePermiso(b)) throw new ErrorPermiso(…);  // ← CLÁUSULA {a ∨ b}
 * ```
 *
 * 🔑 **La posición importa, y es lo que cierra el punto ciego de verdad.** Las alternativas del
 * atajo sólo ensanchan lo que viene **DESPUÉS** de él. Una reja nueva metida **ANTES** del atajo la
 * paga todo el mundo —incluido quien escribe— y por eso **sí se reporta**. Una primera versión de
 * esto ensanchaba el cuerpo entero con las claves de cualquier `tienePermiso`, y se tragaba esa
 * regresión sin decir nada: la mutación M2 de la fila 0.199 salió verde y destapó el agujero.
 */
function puertaDeLaSentencia(
  sentencia: ts.Node,
): { tipo: 'atajo' | 'clausula'; claves: string[] } | undefined {
  if (!ts.isIfStatement(sentencia) || sentencia.elseStatement !== undefined) return undefined;
  const claves = clavesTienePermiso(sentencia.expression);
  if (claves.length === 0) return undefined;

  // `if (tienePermiso(a)) return;` — y su variante `if (tienePermiso(a) || tienePermiso(b)) return;`.
  if (esReturnSeco(sentencia.thenStatement) && !contieneNegacion(sentencia.expression)) {
    if (claves.length === 1 || soloOperador(sentencia.expression, ts.SyntaxKind.BarBarToken)) {
      return { tipo: 'atajo', claves };
    }
    return undefined; // `&&` de varios: escapar exigiría todos; no se aproxima.
  }

  // `if (!tienePermiso(a) && !tienePermiso(b)) throw new ErrorPermiso(…);` — lanza sólo si no trae
  // NINGUNO ⇒ exige a ∨ b. Con un solo `!tienePermiso` es lo mismo que un `verificarPermiso`.
  if (lanzaErrorPermiso(sentencia.thenStatement)) {
    if (
      claves.length === 1 ||
      soloOperador(sentencia.expression, ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      return { tipo: 'clausula', claves };
    }
  }
  return undefined;
}

/** ¿La expresión contiene algún `!`? */
function contieneNegacion(expresion: ts.Node): boolean {
  let hay = false;
  const visitar = (n: ts.Node): void => {
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) hay = true;
    ts.forEachChild(n, visitar);
  };
  visitar(expresion);
  return hay;
}

/** ¿Todos los operadores lógicos de la expresión son el indicado? */
function soloOperador(expresion: ts.Node, operador: ts.SyntaxKind): boolean {
  let ok = true;
  const visitar = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      const esLogico =
        k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken;
      if (esLogico && k !== operador) ok = false;
    }
    ts.forEachChild(n, visitar);
  };
  visitar(expresion);
  return ok;
}

/**
 * Recorre TODO el subárbol, incluidas las funciones anidadas.
 *
 * ⚠️ El callback de `ts.forEachChild` **DEBE devolver `undefined`**: si devuelve algo distinto,
 * `forEachChild` lo toma por «ya encontré lo que buscaba» y **corta el recorrido en el primer hijo**.
 * Una primera versión de esto devolvía el arreglo acumulado (que siempre es truthy) y por eso
 * `escribe()` sólo veía la primera rama del árbol: la red salía «limpia» sobre el árbol de ANTES de
 * los arreglos, con los 48 sitios delante. Un verde que no mide nada es peor que un rojo.
 */
function todasLasLlamadas(n: ts.Node, salida: ts.CallExpression[] = []): ts.CallExpression[] {
  if (ts.isCallExpression(n)) salida.push(n);
  ts.forEachChild(n, (h) => {
    todasLasLlamadas(h, salida);
  });
  return salida;
}

// ── El analizador ───────────────────────────────────────────────────────────────────────────────

/**
 * Analiza `raizBackend` (la carpeta `backend/`) y devuelve los sitios de «escribir y luego negar».
 *
 * No toca la base de datos, no compila el proyecto y no usa el type checker: sólo parsea. Tarda
 * unos segundos sobre las ~280 unidades de dominio.
 */
export function analizar(raizBackend: string): Resultado {
  const raizSrc = join(raizBackend, 'src');
  const archivosDisco = [
    ...listarTs(join(raizSrc, 'dominio')),
    ...listarTs(join(raizSrc, 'api')),
    ...listarTs(join(raizSrc, 'comun')),
  ];

  const rel = (ruta: string): string => relative(raizBackend, ruta).split(sep).join('/');
  const archivos = new Map<string, Archivo>();
  const funciones = new Map<ClaveFuncion, Funcion>();

  for (const disco of archivosDisco) {
    const ruta = rel(disco);
    const fuente = ts.createSourceFile(
      ruta,
      readFileSync(disco, 'utf8'),
      ts.ScriptTarget.ES2022,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );

    const importes = new Map<string, string>();
    const locales = new Map<string, ClaveFuncion>();

    const registrar = (nombre: string, cuerpo: ts.Node): void => {
      const k: ClaveFuncion = `${ruta}::${nombre}`;
      locales.set(nombre, k);
      funciones.set(k, { clave: k, archivo: ruta, nombre, cuerpo, fuente });
    };

    for (const sentencia of fuente.statements) {
      if (ts.isImportDeclaration(sentencia)) {
        const spec = sentencia.moduleSpecifier;
        if (!ts.isStringLiteral(spec) || !spec.text.startsWith('.')) continue;
        // `./x.js` en el código fuente es `./x.ts` en disco (NodeNext + ESM).
        const destino = rel(join(dirname(disco), spec.text.replace(/\.js$/, '.ts')));
        const enlaces = sentencia.importClause?.namedBindings;
        if (enlaces !== undefined && ts.isNamedImports(enlaces)) {
          for (const el of enlaces.elements) importes.set(el.name.text, destino);
        }
        continue;
      }
      if (ts.isFunctionDeclaration(sentencia) && sentencia.name && sentencia.body) {
        registrar(sentencia.name.text, sentencia.body);
        continue;
      }
      if (ts.isVariableStatement(sentencia)) {
        for (const d of sentencia.declarationList.declarations) {
          const ini = d.initializer;
          if (!ts.isIdentifier(d.name) || ini === undefined) continue;
          if ((ts.isArrowFunction(ini) || ts.isFunctionExpression(ini)) && ini.body) {
            registrar(d.name.text, ini.body);
          }
        }
      }
    }

    archivos.set(ruta, { ruta, fuente, importes, locales });
  }

  /** Resuelve `foo(...)` llamado desde `archivo` a su clave `(archivo, función)`, o `undefined`. */
  function resolver(archivo: string, llamada: ts.CallExpression): Funcion | undefined {
    const nombre = identificadorLlamado(llamada);
    if (nombre === undefined) return undefined;
    const meta = archivos.get(archivo);
    if (meta === undefined) return undefined;
    const propio = meta.locales.get(nombre);
    if (propio !== undefined) return funciones.get(propio);
    const desde = meta.importes.get(nombre);
    if (desde === undefined) return undefined;
    return funciones.get(`${desde}::${nombre}`);
  }

  // ── ¿Escribe? (transitivo) ────────────────────────────────────────────────────────────────────

  const cacheEscribe = new Map<ClaveFuncion, boolean>();
  const enCursoEscribe = new Set<ClaveFuncion>();

  /** ¿La llamada, por sí sola, deja rastro en la base? */
  function esLlamadaDeEscritura(f: Funcion, llamada: ts.CallExpression): boolean {
    const nombre = nombreLlamado(llamada);
    if (nombre === undefined) return false;
    if (ABRE_TRANSACCION.has(nombre)) return true;
    if (METODOS_ESCRITURA.has(nombre) && ts.isPropertyAccessExpression(llamada.expression)) {
      return true;
    }
    const destino = resolver(f.archivo, llamada);
    return destino !== undefined && escribe(destino);
  }

  /** ¿Esta función (o algo que llama) escribe? */
  function escribe(f: Funcion): boolean {
    const memo = cacheEscribe.get(f.clave);
    if (memo !== undefined) return memo;
    if (enCursoEscribe.has(f.clave)) return false; // ciclo: no aporta
    enCursoEscribe.add(f.clave);
    let resultado = false;
    for (const llamada of todasLasLlamadas(f.cuerpo)) {
      if (esLlamadaDeEscritura(f, llamada)) {
        resultado = true;
        break;
      }
    }
    enCursoEscribe.delete(f.clave);
    cacheEscribe.set(f.clave, resultado);
    return resultado;
  }

  // ── ¿Qué exige? (transitivo, en CNF) ──────────────────────────────────────────────────────────

  const cacheExigencia = new Map<ClaveFuncion, Cnf>();
  const enCursoExigencia = new Set<ClaveFuncion>();

  /**
   * Permisos que la función exige **antes de escribir nada**, en CNF y **transitivamente** (el punto
   * ciego nº 1: una reja envuelta en un helper cuenta igual que una escrita a la vista).
   *
   * Tres fuentes, por orden:
   *  1. `verificarPermiso(sesion, 'k')` en posición cierta → cláusula `{k}`.
   *  2. La exigencia de las funciones que llama, también en posición cierta y antes del primer
   *     rastro escrito.
   *  3. Una puerta hecha a mano (`if (!tienePermiso(a) && !tienePermiso(b)) throw new ErrorPermiso(
   *     undefined, 'a')`) cuando no hay ninguna reja directa: la clave del `throw` es la cláusula.
   *
   * Y al final, el ensanche que evita los 9 falsos positivos: cada `tienePermiso(sesion, 'j')` del
   * cuerpo añade `j` como **alternativa** a las cláusulas propias, porque ese `tienePermiso` sólo
   * está ahí para dejar pasar a quien trae `j` (es una puerta OR, no una exigencia extra).
   */
  function exigenciaDe(f: Funcion): Cnf {
    const memo = cacheExigencia.get(f.clave);
    if (memo !== undefined) return memo;
    if (enCursoExigencia.has(f.clave)) return [];
    enCursoExigencia.add(f.clave);

    const clausulas: Clausula[] = [];
    /** Claves que, de aquí en adelante, dejan salir sin pagar nada más (atajos de puerta OR). */
    const atajos = new Set<string>();
    /** Una cláusula vale para quien NO se escapó por un atajo previo ⇒ se ensancha con ellos. */
    const conAtajos = (claves: readonly string[]): Clausula => [...new Set([...claves, ...atajos])];

    sentencias: for (const sentencia of sentenciasDelCuerpo(f.cuerpo)) {
      const puerta = puertaDeLaSentencia(sentencia);
      if (puerta !== undefined) {
        if (puerta.tipo === 'atajo') for (const k of puerta.claves) atajos.add(k);
        else agregar(clausulas, conAtajos(puerta.claves));
        continue;
      }
      for (const llamada of llamadasCiertasDe(sentencia)) {
        // A partir del primer rastro escrito, lo que la función pida ya no es una condición de
        // entrada: es el defecto que esta red vigila, y lo mide `recorrer`, no esto.
        if (esLlamadaDeEscritura(f, llamada)) break sentencias;
        const nombre = identificadorLlamado(llamada);
        if (nombre === 'verificarPermiso') {
          const permiso = literalEnPosicion(llamada, 1);
          if (permiso !== undefined) agregar(clausulas, conAtajos([permiso]));
          continue;
        }
        if (nombre === 'verificarCorrectorSinFactura') {
          // No es un permiso del catálogo (fila 0.145) pero se comporta como reja: clave sintética,
          // para que una escritura que la exige satisfaga a una lectura que también la exige.
          agregar(clausulas, conAtajos(['#corrector-sin-factura']));
          continue;
        }
        const destino = resolver(f.archivo, llamada);
        if (destino !== undefined && destino.clave !== f.clave) {
          for (const c of exigenciaDe(destino)) agregar(clausulas, conAtajos(c));
        }
      }
    }

    enCursoExigencia.delete(f.clave);
    cacheExigencia.set(f.clave, clausulas);
    return clausulas;
  }

  // ── Puntos de partida: las rutas HTTP ─────────────────────────────────────────────────────────

  interface Ruta {
    readonly etiqueta: string;
    readonly garantia: Cnf;
    readonly manejador: ts.Node;
    readonly archivo: string;
  }

  const rutas: Ruta[] = [];
  for (const [ruta, meta] of archivos) {
    if (!ruta.endsWith('.rutas.ts')) continue;
    const buscar = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        const prop = (nombre: string): ts.Expression | undefined => {
          for (const p of n.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === nombre) {
              return p.initializer;
            }
          }
          return undefined;
        };
        const manejador = prop('handler');
        if (
          manejador !== undefined &&
          (ts.isArrowFunction(manejador) || ts.isFunctionExpression(manejador))
        ) {
          const garantia: Clausula[] = [];
          const pre = prop('preHandler');
          if (pre !== undefined) {
            for (const llamada of todasLasLlamadas(pre)) {
              const nombre = nombreLlamado(llamada);
              if (nombre === 'conPermiso') {
                const p = literalEnPosicion(llamada, 0);
                if (p !== undefined) agregar(garantia, [p]);
              } else if (nombre === 'conAlgunPermiso') {
                const claves = llamada.arguments
                  .filter((a): a is ts.StringLiteralLike => ts.isStringLiteralLike(a))
                  .map((a) => a.text);
                agregar(garantia, claves);
              }
            }
          }
          const metodo = prop('method');
          const url = prop('url');
          const etiqueta = `${
            metodo !== undefined && ts.isStringLiteralLike(metodo) ? metodo.text : '?'
          } ${url !== undefined && ts.isStringLiteralLike(url) ? url.text : '?'}`;
          rutas.push({ etiqueta, garantia, manejador: manejador.body, archivo: ruta });
        }
      }
      ts.forEachChild(n, buscar);
    };
    buscar(meta.fuente);
  }

  // ── El recorrido: de cada ruta hacia abajo, acumulando garantías ───────────────────────────────

  const crudos = new Map<string, { hallazgo: Hallazgo; rutas: Set<string> }>();
  const visitados = new Set<string>();

  /**
   * Recorre un ámbito (manejador de ruta o función de dominio) con la garantía con la que se entra.
   * `yaEscribio` viene en `true` cuando el llamador ya dejó rastro antes de esta llamada: entonces
   * TODO lo que este ámbito lea con reja propia es ya «después del commit».
   */
  function recorrer(
    f: Funcion | undefined,
    cuerpo: ts.Node,
    archivo: string,
    garantiaEntrada: Cnf,
    yaEscribio: boolean,
    etiquetaRuta: string,
    profundidad: number,
  ): void {
    if (profundidad > 12) return;
    // El ámbito se memoiza por (quién, si ya se escribió, con qué garantía). Para un manejador de
    // ruta la identidad lleva el ARCHIVO además del método+url: hay `POST /x` repetidos en módulos
    // distintos, y sin el archivo el segundo se saltaría por parecer ya visitado.
    const quien = f?.clave ?? `ruta:${archivo}:${etiquetaRuta}`;
    const memo = `${quien}|${yaEscribio ? '1' : '0'}|${garantiaEntrada.map(clave).sort().join(';')}`;
    if (visitados.has(memo)) return;
    visitados.add(memo);

    const ciertas = llamadasCiertas(cuerpo);
    let garantia = garantiaEntrada;
    let escribio = yaEscribio;
    let escrituraEn: ts.CallExpression | undefined;

    for (const llamada of llamadasDelAmbito(cuerpo)) {
      const destino = resolver(archivo, llamada);
      const esEscritura = escrituraDeAmbito(archivo, llamada);

      if (escribio && destino !== undefined) {
        // Ya hay rastro escrito: cualquier reja que esta llamada exija llega DESPUÉS del commit.
        const exigida = exigenciaDe(destino);
        for (const c of exigida) {
          if (satisface(garantia, c)) continue;
          const { line } = llamada
            .getSourceFile()
            .getLineAndCharacterOfPosition(llamada.getStart(llamada.getSourceFile()));
          const donde = f ?? { archivo, nombre: `manejador de ${etiquetaRuta}` };
          const k = `${donde.archivo}::${donde.nombre}->${destino.clave}::${clave(c)}`;
          const previo = crudos.get(k);
          if (previo === undefined) {
            crudos.set(k, {
              hallazgo: {
                archivo: donde.archivo,
                funcion: donde.nombre,
                linea: line + 1,
                llamada: destino.nombre,
                archivoLlamada: destino.archivo,
                garantizados: garantizadosPlanos(garantia),
                faltante: c,
                rutas: [],
              },
              rutas: new Set([etiquetaRuta]),
            });
          } else {
            previo.rutas.add(etiquetaRuta);
          }
        }
      }

      if (esEscritura) {
        escribio = true;
        escrituraEn = llamada;
      } else if (!escribio && ciertas.has(llamada)) {
        // Antes de escribir, lo que esta llamada exige queda garantizado para lo que venga después.
        if (destino !== undefined) garantia = unir(garantia, exigenciaDe(destino));
        if (identificadorLlamado(llamada) === 'verificarPermiso') {
          const p = literalEnPosicion(llamada, 1);
          if (p !== undefined) garantia = unir(garantia, [[p]]);
        }
        if (identificadorLlamado(llamada) === 'verificarCorrectorSinFactura') {
          garantia = unir(garantia, [['#corrector-sin-factura']]);
        }
      }

      // Bajar al dominio: sólo merece la pena si por ahí abajo se escribe (o ya se escribió).
      if (destino !== undefined && (escribe(destino) || escribio)) {
        const entraEscrito = escribio && llamada !== escrituraEn;
        recorrer(
          destino,
          destino.cuerpo,
          destino.archivo,
          garantia,
          entraEscrito,
          etiquetaRuta,
          profundidad + 1,
        );
      }
    }
  }

  /** Variante de `esLlamadaDeEscritura` para un ámbito que no es una función indexada (una ruta). */
  function escrituraDeAmbito(archivo: string, llamada: ts.CallExpression): boolean {
    const nombre = nombreLlamado(llamada);
    if (nombre === undefined) return false;
    if (ABRE_TRANSACCION.has(nombre)) return true;
    if (METODOS_ESCRITURA.has(nombre) && ts.isPropertyAccessExpression(llamada.expression)) {
      return true;
    }
    const destino = resolver(archivo, llamada);
    return destino !== undefined && escribe(destino);
  }

  for (const r of rutas) {
    recorrer(undefined, r.manejador, r.archivo, r.garantia, false, r.etiqueta, 0);
  }

  // ── Excepciones declaradas: se restan, y se avisa si sobran ───────────────────────────────────

  const hallazgos: Hallazgo[] = [];
  const usadas = new Set<number>();
  for (const { hallazgo, rutas: origen } of crudos.values()) {
    const i = EXCEPCIONES.findIndex(
      (e) =>
        e.archivo === hallazgo.archivo &&
        e.funcion === hallazgo.funcion &&
        e.llamada === hallazgo.llamada &&
        hallazgo.faltante.includes(e.permiso),
    );
    if (i >= 0) {
      usadas.add(i);
      continue;
    }
    hallazgos.push({ ...hallazgo, rutas: [...origen].sort() });
  }

  const excepcionesPodridas = EXCEPCIONES.filter((_, i) => !usadas.has(i)).map(
    (e) =>
      `${e.archivo} :: ${e.funcion} → ${e.llamada} (${e.permiso}) — declarada como excepción («${e.razon}») pero YA NO corresponde a ningún sitio real. Si el sitio se arregló, BORRA la entrada de EXCEPCIONES.`,
  );

  hallazgos.sort((a, b) =>
    `${a.archivo}${a.funcion}${a.llamada}`.localeCompare(`${b.archivo}${b.funcion}${b.llamada}`),
  );

  return {
    hallazgos,
    excepcionesPodridas,
    rutasAnalizadas: rutas.length,
    funcionesIndexadas: funciones.size,
  };
}

// ── El informe que lee quien encuentre el CI en rojo dentro de seis meses ───────────────────────

/** Texto del fallo: qué pasa, dónde, por qué importa y cómo se arregla. */
export function informe(resultado: Resultado): string {
  const lineas: string[] = [];
  if (resultado.hallazgos.length > 0) {
    lineas.push(
      `🔴 ESCRIBIR Y LUEGO NEGAR — ${resultado.hallazgos.length} sitio(s) donde una operación deja`,
      `rastro en la base y DESPUÉS pide un permiso que quien escribe puede no traer. El resultado es`,
      `un 403 con el dato YA guardado (y su folio ya quemado): el usuario lee «no tienes permiso»,`,
      `cree que no se guardó y vuelve a capturar. Es la misma familia que arreglaron las filas`,
      `0.195–0.198 (53 sitios, medidos con esta misma herramienta contra el árbol de antes).`,
      '',
    );
    for (const h of resultado.hallazgos) {
      lineas.push(
        `  • ${h.archivo}:${h.linea}`,
        `      ${h.funcion}  ESCRIBE y DESPUÉS llama a  ${h.llamada}()`,
        `      ${h.llamada}() vive en ${h.archivoLlamada} y exige: ${h.faltante.join(' ó ')}`,
        `      quien llega hasta aquí sólo trae garantizado: ${
          h.garantizados.length > 0 ? h.garantizados.join(', ') : '(ningún permiso)'
        }`,
        `      se llega por: ${h.rutas.slice(0, 3).join(' · ')}${h.rutas.length > 3 ? ` · (+${h.rutas.length - 3} más)` : ''}`,
        '',
      );
    }
    lineas.push(
      'CÓMO SE ARREGLA (el patrón de las filas 0.195–0.198, ya aplicado 53 veces):',
      '',
      '  1. Parte la consulta en dos. La de siempre CONSERVA su reja y delega:',
      '',
      '       export async function proyectarX(sesion, id, bd?) { …el cuerpo de siempre, SIN reja… }',
      '       export async function obtenerX(sesion, id, bd?) {',
      "         verificarPermiso(sesion, 'modulo.ver');   // ← la reja NO se afloja ni se borra",
      '         return proyectarX(sesion, id, bd);',
      '       }',
      '',
      '  2. La ESCRITURA devuelve su eco por `proyectarX`, no por `obtenerX`. Su autorización ya la',
      '     cobró ella misma con su propio permiso ANTES de escribir; volver a pedir otra llave',
      '     DESPUÉS del commit es el defecto.',
      '',
      '  3. `proyectarX` es SÓLO para el eco de una escritura propia. Toda lectura suelta sigue',
      '     yendo por `obtenerX`.',
      '',
      '  ⚠️ Lo que NO es arreglo: quitarle la reja a `obtenerX`, ni añadir el permiso de lectura al',
      '     `preHandler` de la ruta (deja fuera a quien sólo puede escribir, y no cubre las llamadas',
      '     dominio→dominio, donde no hay `preHandler` que valga).',
      '',
      '  Si de verdad este sitio es correcto y la regla no lo puede distinguir, declara la excepción',
      '  en `EXCEPCIONES` (src/pruebas/eco-sin-reja.ts) CON SU RAZÓN. No se apaga la regla.',
    );
  }
  if (resultado.excepcionesPodridas.length > 0) {
    if (lineas.length > 0) lineas.push('');
    lineas.push('🟠 EXCEPCIONES PODRIDAS (declaradas y ya sin sitio real que silenciar):', '');
    for (const e of resultado.excepcionesPodridas) lineas.push(`  • ${e}`);
  }
  return lineas.join('\n');
}
