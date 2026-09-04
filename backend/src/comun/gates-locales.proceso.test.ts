/**
 * ⭐⭐ FILA **0.108** — la única prueba del pre-vuelo que **lanza un proceso de verdad**.
 *
 * ## Por qué existe (y por qué en un archivo aparte)
 *
 * `gates-locales.test.ts` prueba las funciones **puras** de `scripts/gates.ts`: le entrega a
 * {@link clasificarEvidencia} las cadenas ya separadas por flujo y comprueba el veredicto. Eso deja
 * un hueco del tamaño exacto del defecto: **nadie ejercitaba el cableado** que produce esas
 * cadenas.
 *
 * 🔴 **Y el hueco se midió, no se supuso.** El reviewer de la 0.108 mutó `correrComando` para que
 * volviera a usar **una sola cola compartida** en orden de llegada —la forma que tenía antes de la
 * corrección R3— y **las 30 pruebas puras la dejaron pasar en verde**. Sólo la cazó a mano,
 * corriendo un proceso que separa sus escrituras: con la mutación, una corrida perfecta se reporta
 * `✗ TERMINÓ SIN RESUMEN` y sale con 1. Un rojo falso, que apaga la confianza en el pre-vuelo tan
 * rápido como un verde falso — y ninguna prueba se habría enterado.
 *
 * ## Qué reproduce, exactamente
 *
 * Un hijo que escribe su resumen **partido en dos por stdout** y mete un aviso **por stderr justo
 * en medio**, con ~60 ms entre escrituras para que el orden de llegada sea determinista:
 *
 * ```
 * stdout: «JUGUETE 0.108 — RESU»      stderr: «(aviso…)»      stdout: «MEN: 1 listo»
 * ```
 *
 * Con **una cola compartida** eso se guarda como `JUGUETE 0.108 — RESU(aviso…)\nMEN: 1 listo`, y el
 * ancla `^` de la huella no casa. Con **una cola por flujo**, stdout conserva su línea entera y el
 * gate pasa, que es lo correcto: la corrida fue impecable.
 *
 * ⚠️ El texto del juguete se llama `JUGUETE 0.108` a propósito, y NO imita el resumen de vitest: al
 * correr, estas dos líneas salen mezcladas con la salida de la suite, y una línea que dijera
 * `Test Files  1 passed` ahí en medio sería una mentira esperando a que alguien la lea.
 *
 * ⚠️ No usa `npm run` ni toca `package.json`: lanza `node -e` directo, así que no depende de
 * `frontend/node_modules` y tarda ~0.2 s.
 */
import { describe, expect, it } from 'vitest';

import { correrComando, veredicto, type Gate } from '../../scripts/gates.js';

/** Un gate de juguete: su huella es suya, con el mismo ancla `^` que las de verdad. */
const JUGUETE: Gate = {
  paquete: 'backend',
  script: 'juguete-intercalado',
  huellaDeFin: /^\s*JUGUETE 0\.108 — RESUMEN\b/m,
};

/** Las tres escrituras, separadas ~60 ms para que el orden de llegada no dependa de la suerte. */
const GUION_DEL_HIJO = [
  "process.stdout.write('JUGUETE 0.108 — RESU');",
  'setTimeout(function () {',
  "  process.stderr.write('(juguete: aviso por stderr, justo en medio)\\n');",
  "  setTimeout(function () { process.stdout.write('MEN: 1 listo\\n'); }, 60);",
  '}, 60);',
].join('\n');

describe('⭐⭐ 0.108 — el cableado de `correrComando`, con un proceso hijo REAL', () => {
  it('🔴🔴 un aviso de stderr en mitad del resumen NO impide reconocerlo: cola por flujo', async () => {
    const resultado = await correrComando(
      JUGUETE,
      process.execPath,
      ['-e', GUION_DEL_HIJO],
      process.cwd(),
    );

    // Lo que de verdad ocurrió: el hijo terminó bien y dejó su resumen entero en stdout.
    expect(resultado.codigo).toBe(0);
    expect(resultado.senal).toBeNull();
    // 🔴 Con una sola cola compartida, esto vale 'sin-resumen' y todo lo de abajo se cae.
    expect(resultado.evidencia).toBe('resumen');

    const linea = veredicto([resultado]).texto.split('\n')[0] ?? '';

    expect(linea).toContain('· backend: juguete-intercalado — OK');
    expect(linea).not.toContain('SIN RESUMEN');
    expect(linea).not.toContain('✗');
  });

  it('y si el hijo MUERE antes de su resumen, el mismo camino lo reporta con su causa', async () => {
    // La otra mitad del cableado: aquí no hay nada que reconocer, y el silencio tiene que doler.
    const resultado = await correrComando(
      JUGUETE,
      process.execPath,
      ['-e', "process.stdout.write('JUGUETE 0.108 — arrancando\\n'); process.exit(0);"],
      process.cwd(),
    );

    expect(resultado.codigo).toBe(0);
    expect(resultado.evidencia).toBe('sin-resumen');
    expect(veredicto([resultado]).texto).toContain('TERMINÓ SIN RESUMEN');
  });
});
