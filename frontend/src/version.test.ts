import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VERSION } from './version';

/**
 * EL CANDADO CONTRA LA VERSIÓN VIEJA.
 *
 * La versión se pinta en la topbar, así que **una versión que miente es peor
 * que no tener versión**: Daniel la usa para decir «estoy viendo la 0.007 y me
 * pasó esto». El riesgo real no es pintarla, es que se quede atrás cuando se
 * suba una nueva a `prueba`.
 *
 * Por eso esta prueba lee el archivo REAL `HISTORIAL-DE-VERSIONES.md` de la
 * raíz del repo (con `node:fs`, no con un `?raw`: así el archivo NUNCA entra al
 * bundle ni al `docker build`, cuyo contexto es solo `frontend/`) y exige que la
 * constante `VERSION` sea **exactamente** la entrada más reciente del historial.
 * Si alguien agrega la entrada `0.002` y olvida la constante —o al revés— el CI
 * se pone rojo con el número que sobra y el que falta.
 *
 * ⚠️ **Y el candado no se fía de la convención «lo más reciente arriba»: la
 * OBLIGA.** Un changelog invita a escribir la entrada nueva al final, y un
 * encabezado con formato raro (`## v0.014`, `## 0.0025`) sería invisible para
 * un regex que solo pesca lo que entiende. Cualquiera de esas dos costumbres
 * dejaría pasar una topbar con el número viejo — el fallo exacto que esto viene
 * a impedir. Por eso, además de comparar la constante, se exige que:
 *
 *  - los números vayan en orden **estrictamente descendente** (comparados como
 *    NÚMERO, no como texto: `0.010` es mayor que `0.009`), y
 *  - **todo** encabezado `## ` del archivo sea una versión o uno de los títulos
 *    conocidos; lo que no parsee es ROJO, nunca invisible.
 */

/**
 * Raíz del repo: se sube desde el directorio de trabajo hasta topar con
 * `PLANMAESTRO.md` (marcador estable de la raíz). Se busca así —y no con una
 * ruta relativa al archivo— porque bajo Vitest `import.meta.url` no siempre es
 * una URL `file:`, y porque el runner puede invocarse desde `frontend/` o desde
 * la raíz.
 */
function raizDelRepo(): string {
  let directorio = process.cwd();
  for (;;) {
    if (existsSync(join(directorio, 'PLANMAESTRO.md'))) {
      return directorio;
    }
    const padre = dirname(directorio);
    if (padre === directorio) {
      throw new Error(
        `No encontré la raíz del repo (PLANMAESTRO.md) subiendo desde ${process.cwd()}`,
      );
    }
    directorio = padre;
  }
}

/** Ruta de `HISTORIAL-DE-VERSIONES.md` en la raíz del repo. */
const RUTA_HISTORIAL = join(raizDelRepo(), 'HISTORIAL-DE-VERSIONES.md');

/**
 * Encabezados `## ` del historial que NO son una entrada de versión (las
 * secciones fijas del documento). Cualquier otro tiene que parsear como
 * versión: si no, la prueba truena en vez de ignorarlo.
 */
const ENCABEZADOS_CONOCIDOS: readonly string[] = ['Cómo se numeran'];

/** Un número de versión partido en sus dos mitades, para compararlo como NÚMERO. */
interface NumeroDeVersion {
  readonly texto: string;
  readonly mayor: number;
  readonly menor: number;
}

/** Encabezados de nivel 2 (`## …`, no los `###` de adentro), en orden del archivo. */
function encabezadosDelHistorial(): readonly string[] {
  if (!existsSync(RUTA_HISTORIAL)) {
    throw new Error(
      `No encontré ${RUTA_HISTORIAL}. Es el historial de versiones (raíz del repo) y esta ` +
        'prueba lo usa de fuente de verdad: sin él, la versión de la topbar no tiene con qué ' +
        'contrastarse.',
    );
  }
  const texto = readFileSync(RUTA_HISTORIAL, 'utf8');
  return [...texto.matchAll(/^##(?!#)[ \t]*(.*)$/gm)].map((coincidencia) =>
    (coincidencia[1] ?? '').trim(),
  );
}

/** Lee el número de versión de un encabezado (`0.001 · fecha — título`), o `null`. */
function versionDelEncabezado(encabezado: string): NumeroDeVersion | null {
  const coincidencia = /^(\d+)\.(\d{3})(?=\s|$)/.exec(encabezado);
  if (coincidencia?.[1] === undefined || coincidencia[2] === undefined) {
    return null;
  }
  return {
    texto: `${coincidencia[1]}.${coincidencia[2]}`,
    mayor: Number(coincidencia[1]),
    menor: Number(coincidencia[2]),
  };
}

/** Versiones del historial, en el orden en que aparecen en el archivo. */
function versionesDelHistorial(): readonly NumeroDeVersion[] {
  return encabezadosDelHistorial().flatMap((encabezado) => {
    const version = versionDelEncabezado(encabezado);
    return version === null ? [] : [version];
  });
}

describe('VERSION (la versión que se ve en la topbar)', () => {
  it('tiene la forma `n.nnn` de la regla de numeración', () => {
    expect(VERSION).toMatch(/^\d+\.\d{3}$/);
  });

  it('el historial de versiones existe en la raíz del repo', () => {
    // Sin historial no hay contra qué comparar: mejor rojo y ruidoso que un
    // candado que se salta en silencio.
    expect(existsSync(RUTA_HISTORIAL), `No encontré ${RUTA_HISTORIAL}`).toBe(true);
  });

  it('coincide con la entrada MÁS RECIENTE del historial', () => {
    const versiones = versionesDelHistorial();
    expect(versiones.length, 'el historial no trae ningún encabezado `## n.nnn`').toBeGreaterThan(
      0,
    );
    expect(
      versiones[0]?.texto,
      `HISTORIAL-DE-VERSIONES.md va en ${String(versiones[0]?.texto)} y src/version.ts en ` +
        `${VERSION}: súbelos JUNTOS, en el mismo commit.`,
    ).toBe(VERSION);
  });

  it('las entradas van de la más nueva a la más vieja, sin repetir', () => {
    // Sin esto, una entrada agregada AL FINAL —la costumbre normal en un
    // changelog— dejaría la constante vieja y el candado en verde: `versiones[0]`
    // seguiría siendo la entrada de arriba. Se compara como NÚMERO (`0.010` es
    // mayor que `0.009`, aunque como texto sea al revés).
    const versiones = versionesDelHistorial();
    versiones.forEach((version, indice) => {
      const siguiente = versiones[indice + 1];
      if (siguiente === undefined) {
        return;
      }
      const desciende =
        version.mayor > siguiente.mayor ||
        (version.mayor === siguiente.mayor && version.menor > siguiente.menor);
      expect(
        desciende,
        `HISTORIAL-DE-VERSIONES.md tiene ${siguiente.texto} DEBAJO de ${version.texto}: las ` +
          'entradas van de la más nueva a la más vieja (la nueva se agrega ARRIBA), y sin ' +
          'repetir.',
      ).toBe(true);
    });
  });

  it('no hay encabezados que el candado no entienda', () => {
    // Un `## v0.014` o un `## 0.0025` no parsean como versión: sin esta prueba
    // serían INVISIBLES —ni versión ni error— y la topbar se quedaría atrás.
    const desconocidos = encabezadosDelHistorial().filter(
      (encabezado) =>
        versionDelEncabezado(encabezado) === null &&
        !ENCABEZADOS_CONOCIDOS.includes(encabezado.replace(/\s*·.*$/, '').trim()),
    );
    expect(
      desconocidos,
      'encabezados `## ` que no son una versión `n.nnn` ni una sección conocida ' +
        `(${ENCABEZADOS_CONOCIDOS.join(', ')}): revisa el formato del historial.`,
    ).toEqual([]);
  });
});
