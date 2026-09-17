import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * EL CRUCE MECÁNICO DE LOS DOCUMENTOS, ENGANCHADO AL CI.
 *
 * `herramientas/verificar-documentos.mjs` comprueba los datos que viven en VARIOS documentos a la
 * vez: el contador de filas de `HOJA-DE-RUTA.md` contra su línea de resumen, el número de versión en
 * sus cuatro sitios, y el orden descendente del historial. Esta prueba **lo ejecuta**, para que no
 * dependa de que alguien se acuerde.
 *
 * ⚠️ **Por qué vive aquí y no como paso suelto** (fila 0.142, 3ª vuelta de revisión): el CI corre
 * todo con `working-directory: backend|frontend`, así que un script en `herramientas/` no lo alcanza
 * ningún job — **no se lintea, no se formatea y, sobre todo, no se ejecuta**. Una herramienta nacida
 * de la cicatriz *«un dato repetido en N sitios necesita un cruce mecánico»* que dependa de la
 * memoria de quien edita **se salta igual que se saltó el conteo que vino a vigilar**. Colgada del
 * suite del frontend —que ya es bloqueante— el olvido cuesta un CI rojo, que es exactamente lo que
 * hace falta. *(El formateo se cerró en la misma vuelta por otro lado: el `format:check` del
 * frontend incluye `../herramientas/*.mjs`. ESLint sigue sin alcanzarlo, a propósito.)*
 *
 * Es vecina de `version.test.ts` y por la misma razón: ése ya lee `HISTORIAL-DE-VERSIONES.md` de la
 * raíz con `node:fs`, así que el precedente de leer la raíz desde el suite del frontend está puesto
 * (y los archivos NUNCA entran al bundle ni al `docker build`, cuyo contexto es sólo `frontend/`).
 */

/** Raíz del repo: se sube hasta topar con `PLANMAESTRO.md`. Mismo criterio que `version.test.ts`. */
function raizDelRepo(): string {
  let directorio = process.cwd();
  for (;;) {
    if (existsSync(join(directorio, 'PLANMAESTRO.md'))) return directorio;
    const padre = dirname(directorio);
    if (padre === directorio) {
      throw new Error(
        `No encontré la raíz del repo (PLANMAESTRO.md) subiendo desde ${process.cwd()}`,
      );
    }
    directorio = padre;
  }
}

describe('cruce mecánico de los documentos (herramientas/verificar-documentos.mjs)', () => {
  it('los contadores y el número de versión cuadran en todos sus sitios', () => {
    const raiz = raizDelRepo();
    const script = join(raiz, 'herramientas', 'verificar-documentos.mjs');
    expect(existsSync(script)).toBe(true);

    // `execFileSync` LANZA si el código de salida no es 0; se captura para que el mensaje del CI sea
    // el diagnóstico del script (qué cifra no cuadra, qué sitio dice otra versión) y no un stack.
    try {
      execFileSync(process.execPath, [script], { cwd: raiz, encoding: 'utf8' });
    } catch (error) {
      const salida = error as { stdout?: string; stderr?: string };
      throw new Error(
        `El cruce de documentos falló:\n${salida.stdout ?? ''}${salida.stderr ?? ''}`.trim(),
        { cause: error },
      );
    }
  });
});

/**
 * ⭐ **LA RAMA «una versión puede no cerrar ninguna fila» (v0.170), PROBADA DE VERDAD.**
 *
 * La prueba de arriba corre el script contra el repo REAL, así que sólo puede comprobar el camino
 * que el repo tiene hoy. Para medir que el candado **muerde** hace falta poder romperlo, y para eso
 * se monta una COPIA del repo en un directorio temporal —el script deduce la raíz de su propia
 * ubicación (`dirname(import.meta.url)/..`), así que copiar el script y los documentos a un árbol
 * aparte basta— y se mutan los documentos ahí.
 *
 * 🔑 **Por qué esto no es decorado:** `verificar-documentos.mjs` es una COMPUERTA. Si se rompe en
 * silencio deja de servir, y nadie lo notaría — seguiría imprimiendo «✅ Todo cuadra». La rama nueva
 * relaja el cruce cuando una versión se declara «sin fila», y una relajación sin prueba es una puerta
 * trasera: lo que estas tres pruebas fijan es que **olvidarse sigue siendo rojo**, que **declarar y
 * cerrar fila a la vez es rojo** (son afirmaciones incompatibles) y que **una declaración de una
 * versión inexistente no excusa a nadie**.
 */
const ARCHIVOS_DEL_CRUCE = [
  'HOJA-DE-RUTA.md',
  'HISTORIAL-DE-VERSIONES.md',
  'CLAUDE.md',
  'Documentacion_MJD/DECISIONES.md',
  'frontend/src/version.ts',
  'herramientas/verificar-documentos.mjs',
];

/** Copia el script y los documentos que cruza a un árbol temporal, para poder mutarlos sin tocar el repo. */
function copiaDelRepo(): string {
  const raiz = raizDelRepo();
  const destino = mkdtempSync(join(tmpdir(), 'cruce-documentos-'));
  for (const relativa of ARCHIVOS_DEL_CRUCE) {
    const salida = join(destino, relativa);
    mkdirSync(dirname(salida), { recursive: true });
    copyFileSync(join(raiz, relativa), salida);
  }
  return destino;
}

/** Corre el script en un árbol dado y devuelve su código de salida y su salida completa. */
function correr(arbol: string): { codigo: number; salida: string } {
  try {
    const salida = execFileSync(
      process.execPath,
      [join(arbol, 'herramientas', 'verificar-documentos.mjs')],
      { cwd: arbol, encoding: 'utf8' },
    );
    return { codigo: 0, salida };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { codigo: e.status ?? -1, salida: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Reescribe un archivo del árbol temporal aplicando un reemplazo único (y exige que sea único). */
function mutar(arbol: string, relativa: string, viejo: string | RegExp, nuevo: string): void {
  const ruta = join(arbol, relativa);
  const texto = readFileSync(ruta, 'utf8');
  const partes = texto.split(viejo as string);
  expect(
    partes.length,
    `el ancla de la mutación no aparece EXACTAMENTE una vez en ${relativa}`,
  ).toBe(2);
  writeFileSync(ruta, partes.join(nuevo), 'utf8');
}

/**
 * El trozo del historial que pertenece a UNA versión: desde su encabezado `## 0.xxx ·` hasta el
 * siguiente `## `.
 *
 * 🔴 **Existe por un defecto medido al rebasar la v0.171 sobre la v0.170 (fila 0.168).** La
 * declaración *«no cierra ninguna fila»* de una versión **se queda en el archivo para siempre**, así
 * que preguntarle al historial ENTERO por esa frase contesta por TODAS las versiones a la vez.
 * Acotar a la entrada es lo que hace que la pregunta sea sobre la versión que se está midiendo.
 */
function entradaDe(historial: string, version: string): string {
  const desde = historial.indexOf(`## ${version} ·`);
  expect(desde, `no encontré la entrada de la v${version} en el historial`).toBeGreaterThanOrEqual(
    0,
  );
  const resto = historial.slice(desde + 3);
  const hasta = resto.indexOf('\n## ');
  return hasta === -1 ? resto : resto.slice(0, hasta);
}

describe('una versión que NO cierra ninguna fila tiene que DECIRLO', () => {
  let arbol: string;
  let version: string;

  beforeAll(() => {
    arbol = copiaDelRepo();
    version =
      readFileSync(join(arbol, 'frontend/src/version.ts'), 'utf8').match(
        /VERSION = '([^']+)'/,
      )?.[1] ?? '';
    expect(version, 'no se pudo leer la versión de la copia').toMatch(/^\d+\.\d{3}$/);
  });

  it('la copia del repo, sin tocar, sale en VERDE (control positivo del montaje)', () => {
    const { codigo, salida } = correr(arbol);
    expect(codigo, salida).toBe(0);
    expect(salida).toContain('✅ Todo cuadra');
  });

  it('🔴 si se QUITA la declaración y ninguna fila la reclama, sale ROJO y dice qué escribir', () => {
    const copia = copiaDelRepo();
    const declaracion = `**La v${version} no cierra ninguna fila del programa**`;
    const historial = readFileSync(join(copia, 'HISTORIAL-DE-VERSIONES.md'), 'utf8');
    if (!historial.includes(declaracion)) {
      // Esta versión SÍ cierra fila: la rama nueva no aplica y no hay nada que medir aquí.
      // (No se salta la prueba: se afirma el hecho, para que el día que cambie se vea.)
      //
      // 🔴 **LA ASERCIÓN VA CONTRA LA ENTRADA DE ESTA VERSIÓN, NO CONTRA EL ARCHIVO ENTERO** — y
      // así nació el arreglo: mirando todo el archivo, la declaración de CUALQUIER versión pasada
      // ponía esto en rojo. La v0.170 se declaró «sin fila», y **la primera versión posterior que SÍ
      // cerrara una (la v0.171) reventaba aquí sin que nada estuviera mal**. O sea: este candado, el
      // día que se escribió, ya estaba abocado a fallar en la entrega siguiente. Medido al rebasar
      // la v0.171 sobre la v0.170 (fila 0.168).
      expect(entradaDe(historial, version)).not.toContain('no cierra ninguna fila del programa');
      return;
    }
    mutar(copia, 'HISTORIAL-DE-VERSIONES.md', declaracion, '(declaración retirada por la prueba)');
    const { codigo, salida } = correr(copia);
    expect(codigo, salida).not.toBe(0);
    expect(salida).toContain('no dicen lo mismo');
    // El mensaje tiene que DECIR QUÉ HACER, no sólo que algo no cuadra.
    expect(salida).toContain('no cierra ninguna fila del programa');
    expect(salida).toContain('CERRADA');
  });

  it('🔴 declararse «sin fila» Y tener una fila que la reclame es ROJO: son incompatibles', () => {
    const copia = copiaDelRepo();
    const historial = readFileSync(join(copia, 'HISTORIAL-DE-VERSIONES.md'), 'utf8');
    if (!historial.includes(`**La v${version} no cierra ninguna fila del programa**`)) return;
    // Se le cuelga la marca de entrega a la PRIMERA fila del tablero, sea cual sea.
    const hoja = readFileSync(join(copia, 'HOJA-DE-RUTA.md'), 'utf8');
    const primera = hoja.match(/^> \| \*\*(0\.\d{3})\*\* \S+ \|/m)?.[0];
    expect(primera, 'no se encontró ninguna fila del tablero').toBeDefined();
    mutar(copia, 'HOJA-DE-RUTA.md', primera ?? '', `${primera ?? ''} ✅ CERRADA — v${version}.`);
    const { codigo, salida } = correr(copia);
    expect(codigo, salida).not.toBe(0);
    expect(salida).toContain('Una de las dos afirmaciones es falsa');
  });

  it('🔴 una declaración de una versión que NO existe en el historial es ROJO', () => {
    const copia = copiaDelRepo();
    mutar(
      copia,
      'HISTORIAL-DE-VERSIONES.md',
      '# CONTROL v2 — Historial de versiones',
      '# CONTROL v2 — Historial de versiones\n\n> **La v9.999 no cierra ninguna fila del programa**',
    );
    const { codigo, salida } = correr(copia);
    expect(codigo, salida).not.toBe(0);
    expect(salida).toContain('9.999');
    expect(salida).toContain('NO tiene entrada');
  });
});
