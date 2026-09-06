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
 *  3. **Que las entradas del historial vayan en orden estrictamente descendente** — la misma regla
 *     que `frontend/src/version.test.ts` exige, comprobada también aquí para que un cambio de docs
 *     no tenga que esperar al suite del frontend para enterarse.
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
 * abajo). Se dice de qué fila salió. Si DOS filas declararan ese mismo número, es un problema y se
 * grita: no un empate que se resuelve solo.
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
  if (empatadas.length > 1) {
    problemas.push(
      `Hay ${empatadas.length} filas que dicen entregar la v${mayor.version} ` +
        `(${empatadas.map((f) => f.fila).join(', ')}). Con dos, este cruce compararía la equivocada ` +
        'sin avisar.',
    );
  }
  filaQueEntrega = mayor.fila;
  versionDeLaFila = mayor.version;
}

const sitios = {
  [`HOJA-DE-RUTA · fila ${filaQueEntrega ?? '?'}`]: versionDeLaFila,
  'HOJA-DE-RUTA · línea «versión en prueba»': hoja.match(/versión en `prueba` `(\d+\.\d+)`/)?.[1],
  'HISTORIAL · primera entrada': entradas[0],
  'frontend/src/version.ts': versionTs.match(/VERSION = '([^']+)'/)?.[1],
};
decir('\nversión por sitio:');
for (const [sitio, valor] of Object.entries(sitios))
  decir(`  ${sitio}: ${valor ?? '(no encontrado)'}`);
const distintas = new Set(Object.values(sitios));
if (distintas.size !== 1 || distintas.has(undefined)) {
  problemas.push(
    `Los cuatro sitios de la versión no dicen lo mismo: ${[...distintas].join(', ')}.`,
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

// ── Veredicto ───────────────────────────────────────────────────────────────────────────────────
if (problemas.length === 0) {
  decir('\n✅ Todo cuadra.');
  process.exit(0);
}
decir(`\n❌ ${problemas.length} problema(s):`);
for (const p of problemas) decir(`  · ${p}`);
process.exit(1);
