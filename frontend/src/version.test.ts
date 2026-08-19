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

/** Encabezados de versión del historial, en orden del archivo (lo más reciente arriba). */
function versionesDelHistorial(): readonly string[] {
  if (!existsSync(RUTA_HISTORIAL)) {
    throw new Error(
      `No encontré ${RUTA_HISTORIAL}. Es el historial de versiones (raíz del repo) y esta ` +
        'prueba lo usa de fuente de verdad: sin él, la versión de la topbar no tiene con qué ' +
        'contrastarse.',
    );
  }
  const texto = readFileSync(RUTA_HISTORIAL, 'utf8');
  return [...texto.matchAll(/^##\s+(\d+\.\d{3})(?=\s|$)/gm)].flatMap((coincidencia) =>
    coincidencia[1] === undefined ? [] : [coincidencia[1]],
  );
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
      versiones[0],
      `HISTORIAL-DE-VERSIONES.md va en ${String(versiones[0])} y src/version.ts en ${VERSION}: ` +
        'súbelos JUNTOS, en el mismo commit.',
    ).toBe(VERSION);
  });

  it('el historial no repite un número de versión', () => {
    const versiones = versionesDelHistorial();
    expect([...new Set(versiones)]).toEqual([...versiones]);
  });
});
