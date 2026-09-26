#!/usr/bin/env node
/**
 * CRUCE MECÁNICO DE LOS DATOS QUE VIVEN EN VARIOS DOCUMENTOS A LA VEZ.
 *
 * `node herramientas/verificar-documentos.mjs` — sin dependencias, sin red, sin base de datos.
 * Sale 0 si todo cuadra y 1 con el detalle si no.
 *
 * 🔑 **NO hace falta acordarse de correrlo: lo ejecuta el CI.** `frontend/src/documentos.test.ts` lo
 * lanza como proceso y exige código de salida 0, así que entra por el job `frontend` que ya es
 * bloqueante (`npm run test`). Se hizo así a propósito: una herramienta nacida de una cicatriz sobre
 * verificación mecánica que dependiera de que alguien la recuerde **se saltaría igual que se saltó el
 * conteo que vino a vigilar**. Para correrlo a mano durante la edición, el comando de arriba.
 *
 * 📌 **Y este archivo SÍ pasa por el formateador**, aunque viva fuera de `backend/` y `frontend/`:
 * el `format:check` del frontend lo incluye por glob (`../herramientas/*.mjs`) con la MISMA
 * `.prettierrc.json` del repo. Sin eso quedaba en tierra de nadie —el CI corre todo con
 * `working-directory: backend|frontend`— y un archivo que nada vigila se deforma solo. Lo que
 * deliberadamente NO tiene es ESLint: montarle una configuración propia a un script de Node suelto
 * costaba más de lo que aporta, y lo que importaba era que **se ejecutara**.
 *
 * ⚠️ **POR QUÉ EXISTE** (cicatriz del 3-sep-2026, `CLAUDE.md` §8): *«un dato repetido en N sitios
 * necesita un cruce mecánico, no N lecturas»*. El ojo confirma el sitio que está mirando y da por
 * buenos los demás — así sobrevivió tres rondas un conteo equivocado en la línea más visible del
 * historial. Lo que este script comprueba hoy:
 *
 *  1. **El tablero de filas de `HOJA-DE-RUTA.md` contra su línea de resumen** («De las N filas
 *     numeradas: X ✅ · Y 🔶 · Z ⏸️ · W ⬜»). Recuenta los estados leyendo la tabla y compara.
 *  2. **El número de versión, que vive en CUATRO sitios**: la fila que la entrega en
 *     `HOJA-DE-RUTA.md`, la línea «versión en `prueba`» del mismo archivo, la primera entrada de
 *     `HISTORIAL-DE-VERSIONES.md` y la constante `VERSION` de `frontend/src/version.ts`.
 *     ⭐ **Con una salida, y sólo una (v0.170):** una versión puede **no cerrar ninguna fila** —es
 *     el caso de un arreglo que no da nada por resuelto—, y entonces el primero de esos cuatro
 *     sitios no existe. Para que ese hueco no se cuele en silencio, la entrada del historial tiene
 *     que decirlo con la frase exacta **«La v0.xxx no cierra ninguna fila del programa»**. Callarlo
 *     sigue siendo ROJO; declararlo Y cerrar fila a la vez, también (son incompatibles).
 *  3. **Que las entradas del historial vayan en orden estrictamente descendente** — la misma regla
 *     que `frontend/src/version.test.ts` exige, comprobada también aquí para poder correr la
 *     verificación A MANO sobre los documentos, sin montar el suite entero. En el CI la ejecuta
 *     `frontend/src/documentos.test.ts` (ver arriba): ahí no se salta.
 *
 * 📌 **Nació de una afirmación falsa, y conviene que se sepa:** en la fila 0.142 el coder dijo haber
 * dejado esta herramienta cuando lo que tenía era un script efímero fuera del repositorio. El
 * resultado que reportó era correcto, pero la herramienta no existía. Existe desde aquí.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (ruta) => readFileSync(join(raiz, ruta), 'utf8');

const problemas = [];
const decir = (linea) => process.stdout.write(`${linea}\n`);

// ── 0 · Marcadores de conflicto sin resolver ────────────────────────────────────────────────────
//
// Va PRIMERO porque invalida todo lo demás: un archivo a medio mergear no se puede cruzar contra
// nada. Y nadie más lo caza — el CI no linta markdown, prettier ignora estos archivos y el propio
// verificador leía «HISTORIAL · primera entrada: 0.128» tan campante con un `<<<<<<< HEAD` tres
// líneas más arriba.
//
// Cicatriz del 8-sep-2026: se resolvió un merge mirando la salida de `git merge` truncada con
// `tail -8`, así que dos de los cuatro conflictos NO SE VIERON; después se revisaron sólo los
// archivos que esa salida truncada mencionaba, y un `git add -A` comiteó el historial con sus tres
// marcadores dentro. Es el archivo que Daniel lee para saber qué salió. Lo cazó un reviewer, no el
// CI. ⇒ nunca trunques la salida de un merge, y que la comprobación no dependa de acordarse.
const CON_MARCADORES = [
  'HOJA-DE-RUTA.md',
  'HISTORIAL-DE-VERSIONES.md',
  'CLAUDE.md',
  'Documentacion_MJD/DECISIONES.md',
];
for (const archivo of CON_MARCADORES) {
  const lineas = leer(archivo).split('\n');
  const sucias = [];
  lineas.forEach((linea, i) => {
    if (/^(<{7} |={7}$|>{7} )/.test(linea)) sucias.push(`${i + 1}: ${linea.slice(0, 40)}`);
  });
  if (sucias.length > 0) {
    problemas.push(
      `${archivo} tiene ${sucias.length} marcador(es) de conflicto sin resolver — ${sucias.join(' · ')}`,
    );
  }
}

// ── 1 · El tablero de filas contra su línea de resumen ──────────────────────────────────────────
const hoja = leer('HOJA-DE-RUTA.md');

/** Estado de cada fila numerada. La PRIMERA aparición de un número es la del tablero: los demás
 *  listados (el backlog de §4, por ejemplo) repiten el número sin estado y no cuentan. */
const estadoPorFila = new Map();
for (const m of hoja.matchAll(/^> \| \*\*(0\.\d{3})\*\* (\S+)/gm)) {
  if (!estadoPorFila.has(m[1])) estadoPorFila.set(m[1], m[2]);
}
const cuenta = (simbolo) => [...estadoPorFila.values()].filter((e) => e === simbolo).length;
const real = {
  total: estadoPorFila.size,
  cerradas: cuenta('✅'),
  aMedias: cuenta('🔶'),
  aparcadas: cuenta('⏸️'),
  porHacer: cuenta('⬜'),
};

const resumen = hoja.match(
  /De las \*\*(\d+) filas\*\* numeradas: \*\*(\d+) ✅[\s\S]*?\*\*(\d+) 🔶[\s\S]*?\*\*(\d+) ⏸️[\s\S]*?\*\*(\d+) ⬜/,
);
decir(`filas numeradas: ${real.total}`);
decir(`  ✅ ${real.cerradas} · 🔶 ${real.aMedias} · ⏸️ ${real.aparcadas} · ⬜ ${real.porHacer}`);
if (resumen === null) {
  problemas.push(
    'No se encontró la línea de resumen «De las N filas numeradas: …» en HOJA-DE-RUTA.md.',
  );
} else {
  const dicho = {
    total: +resumen[1],
    cerradas: +resumen[2],
    aMedias: +resumen[3],
    aparcadas: +resumen[4],
    porHacer: +resumen[5],
  };
  for (const clave of Object.keys(real)) {
    if (dicho[clave] !== real[clave]) {
      problemas.push(
        `El resumen dice ${dicho[clave]} en «${clave}» y el tablero tiene ${real[clave]}.`,
      );
    }
  }
}

// ── 1b · Las LISTAS enumeradas del resumen contra el tablero ────────────────────────────────────
//
// El bloque de arriba cruza CUÁNTAS hay; éste cruza CUÁLES son. No es lo mismo, y la diferencia
// muerde: el 8-sep-2026 la lista de pendientes traía una fila **ya cerrada** y le faltaba **una
// nueva** — el total cuadraba en 26 y el ojo lo dio por bueno. Dos filas equivocadas que se
// compensan dejan el conteo perfecto y la lista mintiendo.
const listasDelResumen = [
  { simbolo: '⏸️', patron: /\*\*\d+ ⏸️ aparcadas a fase 2\*\* \(([^)]*)\)/, nombre: 'aparcadas' },
  // El rótulo dejó de decir «en la V1» el 10-sep-2026: la columna de ESTADO (⬜) y la de
  // CLASIFICACIÓN (⏸️ post-V1) son ejes distintos, y ocho filas ⬜ están aparcadas a post-V1 en su
  // propia ficha — llamarlas «por hacer en la V1» contaba de más. El sufijo se acepta opcional para
  // no romper ramas en vuelo que todavía lo traigan.
  {
    simbolo: '⬜',
    patron: /\*\*\d+ ⬜ por hacer(?: en la V1)?\*\* \(([^)]*)\)/,
    nombre: 'por hacer',
  },
];
for (const { simbolo, patron, nombre } of listasDelResumen) {
  const hallada = hoja.match(patron);
  if (hallada === null) {
    problemas.push(`No se encontró la lista enumerada de «${nombre}» (${simbolo}) en el resumen.`);
    continue;
  }
  const enLaLista = new Set(
    hallada[1]
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
  const enElTablero = new Set(
    [...estadoPorFila].filter(([, e]) => e === simbolo).map(([fila]) => fila),
  );
  const faltan = [...enElTablero].filter((f) => !enLaLista.has(f)).sort();
  const sobran = [...enLaLista].filter((f) => !enElTablero.has(f)).sort();
  if (faltan.length > 0) {
    problemas.push(
      `La lista de «${nombre}» no menciona ${faltan.join(', ')}, que en el tablero está ${simbolo}.`,
    );
  }
  if (sobran.length > 0) {
    problemas.push(
      `La lista de «${nombre}» menciona ${sobran.join(', ')}, que en el tablero ya NO está ${simbolo}.`,
    );
  }
}

// ── 1c · Las cifras que el propio resumen REPITE más abajo ──────────────────────────────────────
//
// El resumen no dice el número de ⬜ una vez: lo dice, y tres renglones después lo VUELVE A DECIR
// para desglosarlo («Y de esas N ⬜, NUEVE las llama post-V1…»). El 26-sep-2026 el reviewer cazó que
// la primera decía 25 y la segunda seguía en 26 — al bajar el total se corrigió el sitio que estaba
// en el ojo y no el que estaba más abajo. El bloque 1 NO lo veía, porque su regex captura sólo la
// PRIMERA aparición del patrón. Es la trampa del §8 de `CLAUDE.md` en su forma más pura: *un dato
// repetido en N sitios necesita un cruce mecánico, no N lecturas*.
const reMenciones = [...hoja.matchAll(/de esas \*{0,2}(\d+)\*{0,2} ⬜/g)];
if (reMenciones.length === 0) {
  problemas.push(
    'No se encontró la re-mención «de esas N ⬜» del resumen; ¿se reescribió la línea?',
  );
}
for (const [texto, cifra] of reMenciones) {
  if (+cifra !== real.porHacer) {
    problemas.push(
      `El resumen re-dice «${texto.trim()}» y el tablero tiene ${real.porHacer} filas ⬜.`,
    );
  }
}

// ── 1d · El desglose de la V1: que sume, y que cada lista tenga los que dice ─────────────────────
//
// Este desglose YA salió mal una vez, y la propia línea lo cuenta: decía «15 … 3 + 7 + 5» y no
// sumaba (eran 16, y las que pueden esperar 6). Se corrigió a mano y a mano volvió a quedar
// expuesto. Tres números y tres listas cruzados entre sí es trabajo de script, no de ojo.
const desglose = [
  { nombre: 'bloquean', patron: /\*\*(\d+) que bloquean\*\* \(([^)]*)\)/ },
  { nombre: 'duelen', patron: /\*\*(\d+) que duelen\*\* \(([^)]*)\)/ },
  { nombre: 'pueden esperar', patron: /\*\*(\d+) que pueden esperar\*\* \(([^)]*)\)/ },
];
let sumaV1 = 0;
let desgloseCompleto = true;
for (const { nombre, patron } of desglose) {
  const hallada = hoja.match(patron);
  if (hallada === null) {
    problemas.push(`No se encontró el grupo «N que ${nombre} (…)» del desglose de la V1.`);
    desgloseCompleto = false;
    continue;
  }
  const dicho = +hallada[1];
  const filas = hallada[2]
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^0\.\d+$/.test(x));
  if (filas.length !== dicho) {
    problemas.push(
      `El desglose dice «${dicho} que ${nombre}» y su paréntesis nombra ${filas.length}: ${filas.join(', ')}.`,
    );
  }
  sumaV1 += dicho;
}
const totalV1 = hoja.match(/pendientes de verdad para la V1: \*{0,2}(\d+)/);
if (totalV1 === null) {
  problemas.push('No se encontró el total «pendientes de verdad para la V1: N».');
} else if (desgloseCompleto && +totalV1[1] !== sumaV1) {
  problemas.push(
    `El resumen dice «pendientes de verdad para la V1: ${totalV1[1]}» y sus tres grupos suman ${sumaV1}.`,
  );
}
decir(
  `  V1: ${totalV1 === null ? '?' : totalV1[1]} pendientes = ${sumaV1} sumando los tres grupos`,
);

// ── 2 · El número de versión, en sus cuatro sitios ──────────────────────────────────────────────
const historial = leer('HISTORIAL-DE-VERSIONES.md');
const versionTs = leer('frontend/src/version.ts');
const entradas = [...historial.matchAll(/^## (\d+\.\d+)/gm)].map((m) => m[1]);

/**
 * La versión que entrega una fila se lee ANCLADA A LA FILA QUE LA ENTREGA, nunca por la primera
 * aparición del texto en todo el archivo: el tablero tiene decenas de filas cerradas y cada una
 * lleva SU versión, así que un `match` suelto compararía la equivocada **en silencio**.
 *
 * **Cómo se ancla:** se recogen todas las líneas de tablero que declaran una versión entregada —el
 * tablero usa DOS redacciones y las dos valen: `CERRADA (2-sep, v0.085)` y `CERRADA — v0.122`— y se
 * toma la del número MÁS ALTO, que es por definición la última que entró a `prueba` (las versiones
 * sólo suben; `HISTORIAL-DE-VERSIONES.md` lo exige en su propio orden y este script lo comprueba más
 * abajo). Se dice de qué fila salió — y si son VARIAS, se nombran TODAS.
 *
 * ⚠️ **Esto último cambió el 10-sep-2026 (v0.138) y conviene saber por qué.** Antes, dos filas con el
 * mismo número se trataban como un PROBLEMA. La premisa era que una versión entrega una fila, y dejó
 * de ser cierta: la v0.138 entregó **la 0.176 y la 0.177 juntas a propósito**, porque una corrida de
 * CI cuesta 40-50 min y las dos eran de la misma pantalla. Juntarlas es buena economía, no un error.
 * 🔑 **El miedo del autor original NO se tira:** lo peligroso no es el empate, es **elegir una en
 * silencio**. Por eso ahora se listan todas.
 *
 * ⚠️⚠️ **PERO ESTO PIERDE DETECCIÓN, Y SE DICE EN VEZ DE CALLARLO (medido por el reviewer, 10-sep):**
 * una **errata** que escriba en otra fila el número de la versión máxima —p. ej. la 0.145, que entrega
 * la v0.121, tecleada como `v0.138`— **antes gritaba y ahora sale en verde**. El cruce de los cuatro
 * sitios mide *«¿coinciden?»*; el candado del empate medía *«¿es verdad lo que declara cada fila?»*,
 * que es OTRA invariante, y este cambio funde la segunda en la primera. Confiar en que alguien note el
 * `+ 0.145` impreso es apoyarse en el ojo, que es justo lo que este script vino a sustituir.
 *
 * **Por qué aun así se quita, y no es pereza — los tres sustitutos se midieron y ninguno vale:**
 * «toda versión del historial debe tener fila que la reclame» daría **97 falsas alarmas de 134**;
 * «toda versión declarada debe existir en el historial» es viable pero **no caza la errata** (la
 * v0.138 sí existe); y cruzar la fila contra la entrada que la nombra es imposible porque **sólo 4 de
 * 134** entradas nombran su fila. **B8 no es cazable barato con los datos que hoy existen.**
 *
 * 📌 **Y el candado que se quita tampoco cumplía:** sólo miraba el empate en la versión **máxima**, así
 * que las filas **0.089 y 0.090** —que entregan las dos la v0.086— llevaban años empatadas **sin que
 * gritara nunca**. Era una regla que sonaba el día del estreno y enmudecía para siempre.
 * 🔴 **El agujero mayor, preexistente y también medido:** de las ~37 versiones que declaran filas, este
 * cruce comprueba **UNA**, la del máximo. Una errata en cualquier fila no-máxima ya era invisible.
 * Vive como fila **0.182**.
 *
 * ⚠️ **Y por qué NO se exige «una sola línea con `CERRADA — v`», que es lo que hacía la primera
 * versión de este bloque:** esa redacción es la que estrenó la fila 0.142, y en `prueba` no aparece
 * **ni una vez** (medido sobre `origin/prueba`: 0 líneas con ese formato, 20 con el de siempre).
 * Ese candado habría puesto el CI en rojo —culpando a la fila 0.142— en cuanto la siguiente fila
 * cerrara con la redacción normal. Con el criterio de arriba, medido: en `origin/prueba` sale la
 * fila 0.099 con v0.120, que es justo la que dice su línea «versión en prueba».
 */
const filasQueEntregan = [];
for (const linea of hoja.split('\n')) {
  const fila = linea.match(/^> \| \*\*(0\.\d{3})\*\*/)?.[1];
  if (fila === undefined) continue;
  // Entre «CERRADA» y el número no puede haber ni `|` (fin de celda) ni otra `v`, para no saltar de
  // una celda a la siguiente ni engancharse con una palabra suelta.
  const version = linea.match(/CERRADA[^|v]{0,40}v(\d+\.\d{3})\b/)?.[1];
  if (version === undefined) continue;
  filasQueEntregan.push({ fila, version });
}
let filaQueEntrega = null;
let versionDeLaFila;
if (filasQueEntregan.length === 0) {
  problemas.push(
    'Ninguna fila del tablero de HOJA-DE-RUTA.md declara la versión que entrega («CERRADA … v0.xxx»).',
  );
} else {
  const mayor = filasQueEntregan.reduce((a, b) => (Number(b.version) > Number(a.version) ? b : a));
  const empatadas = filasQueEntregan.filter((f) => f.version === mayor.version);
  // Varias filas pueden entregar la MISMA versión (la v0.138 entregó dos). No es un fallo: todas
  // dicen el mismo número, así que comparar cualquiera es correcto. Lo que no puede pasar es que el
  // cruce elija una calladamente ⇒ se nombran todas en la salida.
  filaQueEntrega = empatadas.map((f) => f.fila).join(' + ');
  versionDeLaFila = mayor.version;
}

const versionDeTs = versionTs.match(/VERSION = '([^']+)'/)?.[1];

/**
 * ⭐ **UNA VERSIÓN PUEDE NO CERRAR NINGUNA FILA — pero tiene que DECIRLO (17-sep-2026, v0.170).**
 *
 * El bloque de arriba daba por hecho que **toda** versión cierra al menos una fila del tablero: el
 * cuarto «sitio» de la versión no está escrito en ninguna parte, se **deduce** del `CERRADA … v0.xxx`
 * más alto. Esa premisa no es cierta y este archivo ya lo sabía: su propio comentario (arriba) mide
 * que *«toda versión del historial debe tener fila que la reclame» daría **97 falsas alarmas de
 * 134***. Una versión puede ser un arreglo que no cierra nada — la v0.170 lo es: arregla una
 * precondición sin esperar en un e2e y deja su fila (la 0.169) **abierta a propósito**, porque la
 * causa del fallo sigue sin medirse.
 *
 * 🔑 **El candado NO se afloja: cambia de «tiene que haber una fila que la reclame» a «tiene que
 * haber una fila que la reclame, O decir por qué no».** El silencio sigue siendo ROJO. Lo único que
 * se acepta es una declaración **explícita y nominal**, con el número de la versión dentro, para que
 * no pueda quedarse puesta de una versión anterior y excusar a la siguiente en silencio.
 *
 * 📌 **Por qué la declaración vive en `HISTORIAL-DE-VERSIONES.md` y no aquí ni en un fichero aparte**
 * (cicatriz de `CLAUDE.md` §8: *el aviso que importa es el que está pegado a la cosa*): la entrada
 * del historial es **el sitio al que va quien pregunta «¿y qué trajo la v0.170?»**. Ponerlo en el
 * tablero de `HOJA-DE-RUTA.md` era imposible sin inventar un sitio —el tablero habla de FILAS, y el
 * caso es justo que no hay fila—, y un archivo de excepciones aparte es exactamente lo que nadie
 * abre.
 *
 * ⚠️ **Y la declaración tiene que ser de una versión que EXISTA en el historial**, para que un
 * copiar-pegar no pre-autorice en silencio a la versión siguiente.
 */
const DECLARA_SIN_FILA = /\*\*La v(\d+\.\d{3}) no cierra ninguna fila del programa\*\*/g;
const declaradasSinFila = [...historial.matchAll(DECLARA_SIN_FILA)].map((m) => m[1]);
for (const declarada of declaradasSinFila) {
  if (!entradas.includes(declarada)) {
    problemas.push(
      `El historial declara que «La v${declarada} no cierra ninguna fila del programa», pero la v${declarada} NO tiene entrada en HISTORIAL-DE-VERSIONES.md. Una declaración de una versión que no existe no excusa a nadie: bórrala o escribe su entrada.`,
    );
  }
}
const declaraSinFila = versionDeTs !== undefined && declaradasSinFila.includes(versionDeTs);

// Declararse «sin fila» y tener una fila que te reclame son afirmaciones INCOMPATIBLES: una de las
// dos miente, y callarlo sería justo lo que este archivo vino a impedir.
if (declaraSinFila) {
  const reclaman = filasQueEntregan.filter((f) => f.version === versionDeTs);
  if (reclaman.length > 0) {
    problemas.push(
      `La v${versionDeTs} se declara «no cierra ninguna fila del programa» en el historial, pero la(s) fila(s) ${reclaman.map((f) => f.fila).join(', ')} de HOJA-DE-RUTA.md dicen entregarla. Una de las dos afirmaciones es falsa: quita la declaración o quita el «CERRADA … v${versionDeTs}».`,
    );
  }
}

const sitios = {
  // Cuando la versión se declara SIN fila, este sitio no existe y no se cruza — pero se imprime para
  // que la salida diga POR QUÉ son tres y no cuatro, en vez de que uno desaparezca calladamente.
  [`HOJA-DE-RUTA · fila ${filaQueEntrega ?? '?'}`]: versionDeLaFila,
  'HOJA-DE-RUTA · línea «versión en prueba»': hoja.match(/versión en `prueba` `(\d+\.\d+)`/)?.[1],
  'HISTORIAL · primera entrada': entradas[0],
  'frontend/src/version.ts': versionDeTs,
};
decir('\nversión por sitio:');
for (const [sitio, valor] of Object.entries(sitios))
  decir(`  ${sitio}: ${valor ?? '(no encontrado)'}`);
if (declaraSinFila) {
  decir(`  ⇒ la v${versionDeTs} se declara SIN fila en el historial: ese sitio no se cruza.`);
}
const aCruzar = Object.entries(sitios).filter(
  ([sitio]) => !(declaraSinFila && sitio.startsWith('HOJA-DE-RUTA · fila')),
);
const distintas = new Set(aCruzar.map(([, valor]) => valor));
if (distintas.size !== 1 || distintas.has(undefined)) {
  // El mensaje DICE QUÉ HACER. La forma más común de llegar aquí es haber subido la versión sin
  // cerrar fila y sin declararlo: sin esta pista, el script sólo dice «no cuadran» y deja a quien lo
  // lee adivinando entre dos arreglos opuestos.
  const olvidoLaDeclaracion =
    !declaraSinFila &&
    versionDeTs !== undefined &&
    versionDeLaFila !== undefined &&
    Number(versionDeLaFila) < Number(versionDeTs);
  const pista = olvidoLaDeclaracion
    ? ` Ninguna fila del tablero declara «CERRADA … v${versionDeTs}». Si la v${versionDeTs} SÍ cierra una fila, escribe esa marca en la fila que entrega; si NO cierra ninguna, dilo en su entrada de HISTORIAL-DE-VERSIONES.md con la frase exacta «**La v${versionDeTs} no cierra ninguna fila del programa**» y la razón.`
    : '';
  problemas.push(
    `Los ${String(aCruzar.length)} sitios de la versión no dicen lo mismo: ${[...distintas].join(', ')}.${pista}`,
  );
}

// ── 3 · El historial, en orden estrictamente descendente ────────────────────────────────────────
for (let i = 0; i < entradas.length - 1; i += 1) {
  if (!(Number(entradas[i]) > Number(entradas[i + 1]))) {
    problemas.push(
      `El historial no va en orden descendente: ${entradas[i]} aparece antes que ${entradas[i + 1]}.`,
    );
  }
}

// ── 4 · REFERENCIAS COLGANTES: toda §Post-F9.NNN citada tiene que EXISTIR ───────────────────────
//
// 🔴 Nació de una cicatriz repetida CINCO veces en una sola sesión (7-sep-2026): se escribió «ver
// §Post-F9.204», «.207», «.216», «.217» y «la fila 0.162» y **la sección no existía donde el lector
// iba a buscarla**. Cuatro de las cinco las cazó un reviewer humano; el verificador decía «todo
// cuadra» porque sólo cruzaba versiones y contadores.
//
// ⚠️ Y la lección de método, que es la razón de que esto sea CÓDIGO y no otra regla escrita: la regla
// «comprueba que existe antes de citarla» YA ESTABA ESCRITA en CLAUDE.md, la redactó la misma persona
// que volvió a romperla en la fila siguiente. Una comprobación que depende de acordarse no es una
// comprobación. Ésta corre sola en cada CI.
//
// El daño no es cosmético: una referencia colgante manda a alguien a buscar una decisión que no puede
// leer, y en un repo cuya ley es «el porqué vive en DECISIONES.md» eso equivale a que la decisión no
// exista.
const decisiones = leer('Documentacion_MJD/DECISIONES.md');
const DEFINE = /^#### \(Post-F9\.([\d.]+[a-z]?)\)/gm;
const definidas = new Set([...decisiones.matchAll(DEFINE)].map((m) => m[1]));
const colgantes = new Map();
for (const [archivo, texto] of Object.entries({
  'HOJA-DE-RUTA.md': hoja,
  'HISTORIAL-DE-VERSIONES.md': historial,
  'Documentacion_MJD/DECISIONES.md': decisiones,
})) {
  for (const m of texto.matchAll(/§Post-F9\.([\d.]+[a-z]?)/g)) {
    // Una cita como «§Post-F9.213·A» apunta a la sección 213: se comprueba la raíz.
    const raiz = m[1].split('.').slice(0, 1).join('.');
    if (!definidas.has(m[1]) && !definidas.has(raiz)) {
      if (!colgantes.has(m[1])) colgantes.set(m[1], new Set());
      colgantes.get(m[1]).add(archivo);
    }
  }
}
for (const [seccion, archivos] of [...colgantes].sort())
  problemas.push(
    `§Post-F9.${seccion} se cita en ${[...archivos].join(', ')} y NO existe en DECISIONES.md.`,
  );
decir(`  secciones definidas en DECISIONES.md: ${String(definidas.size)}`);

// ── Veredicto ───────────────────────────────────────────────────────────────────────────────────
if (problemas.length === 0) {
  decir('\n✅ Todo cuadra.');
  process.exit(0);
}
decir(`\n❌ ${problemas.length} problema(s):`);
for (const p of problemas) decir(`  · ${p}`);
process.exit(1);
