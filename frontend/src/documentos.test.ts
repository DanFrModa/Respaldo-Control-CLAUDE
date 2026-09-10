import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
