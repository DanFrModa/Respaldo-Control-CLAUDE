/**
 * ⭐ FILA **0.092**, segunda mitad — el guardián del pre-vuelo local (`scripts/gates.ts`).
 *
 * El script existe para que un `Killed` no se pueda leer como pase. Estas pruebas cuidan las dos
 * formas en que ese script se podría volver mentira:
 *
 *  1. **Que prometa un gate que no existe** (un `npm run` renombrado ⇒ npm falla con un error que
 *     no es el del gate) o **que corra algo que el CI no corre** — o sea, que se convierta en una
 *     SEGUNDA definición de «los gates» capaz de divergir de `ci.yml`. Aquí se exige que la lista
 *     sea un SUBCONJUNTO de lo que el CI ya invoca, gate por gate.
 *  2. **Que la frase de verde salga cuando no debe.** Es toda la idea del script: la ausencia de la
 *     frase es la señal. Si un fallo —o peor, una muerte por señal— pudiera imprimirla, el script
 *     sería exactamente el defecto que vino a matar.
 *
 * ⚠️ Lo que estas pruebas NO cubren: que el CI no gane un gate NUEVO que el pre-vuelo se pierda.
 * Eso es aceptable y está dicho en el propio script: **esto no es el CI**; el CI es el único juez.
 * Cubrir lo contrario —que el pre-vuelo prometa de más— es lo que sí importa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FRASE_TODO_VERDE,
  GATES,
  veredicto,
  type Gate,
  type ResultadoGate,
} from '../../scripts/gates.js';

const RAIZ_REPO = fileURLToPath(new URL('../../..', import.meta.url));

function leer(rutaRelativa: string): string {
  return readFileSync(`${RAIZ_REPO}${rutaRelativa}`, 'utf8');
}

function scriptsDe(paquete: string): Record<string, string> {
  const paqueteJson = JSON.parse(leer(`${paquete}/package.json`)) as {
    scripts: Record<string, string>;
  };
  return paqueteJson.scripts;
}

/** Un resultado en verde para el gate `i` de la lista. */
const ok = (i: number): ResultadoGate => ({ gate: GATES[i]!, codigo: 0, senal: null });

describe('scripts/gates.ts — la lista de gates es real y no inventa nada', () => {
  it('cada gate existe como script de npm en su paquete', () => {
    expect(GATES.length).toBeGreaterThanOrEqual(6);
    for (const gate of GATES) {
      expect(
        Object.keys(scriptsDe(gate.paquete)),
        `\`npm run ${gate.script}\` no existe en ${gate.paquete}/package.json`,
      ).toContain(gate.script);
    }
  });

  it('🔴 el CI corre TODOS estos gates (el pre-vuelo es un subconjunto, nunca una verdad aparte)', () => {
    const ci = leer('.github/workflows/ci.yml');
    // Red de seguridad: si el workflow no se leyera, las aserciones fallarían por vacío en vez de
    // por ausencia — pero un fichero equivocado sí podría pasar en silencio. Esto lo ancla.
    expect(ci).toContain('name: CI');

    /*
     * 🔴 SE COMPARA CONTRA EL COMANDO ENTERO, EXTRAÍDO — NO CON `toContain` SOBRE EL TEXTO.
     *
     * La primera versión de esta prueba preguntaba `ci.toContain('run: npm run test')` y era falsa
     * por los dos lados, medido:
     *   • el CI corre los unit como **`run: npm test`** (`:275` backend, `:397` frontend), y esa
     *     cadena NO contiene `run: npm run test` ⇒ la aserción no comprobaba nada de los dos gates
     *     de pruebas;
     *   • la ÚNICA línea del workflow que sí la contenía era `:491 run: npm run test:e2e` — o sea,
     *     el guardián se apoyaba justo en el gate que este mismo archivo declara PROHIBIDO. Con los
     *     dos `npm test` sustituidos por un `echo`, daba 10/10 en verde con el CI sin correr ni una
     *     prueba.
     * Un `Set` de comandos exactos no puede equivocarse así: `npm test` ≠ `npm run test:e2e`.
     */
    const comandosDelCi = new Set(
      [...ci.matchAll(/^\s*run:\s*(npm\b.*)$/gm)].map((linea) => linea[1]!.trim()),
    );
    /*
     * DOS AFIRMACIONES DISTINTAS, Y POR ESO DOS `expect` (N1). Juntarlas en uno solo hacía que el
     * guardián fallara **diagnosticando una causa falsa**: con `run: npm ci --prefer-offline` el
     * regex extrae los nueve comandos perfectamente, pero el mensaje decía *«el regex no extrajo
     * ningún comando»* y mandaba a depurar el regex en vez del ancla. Un guardián que se dispara
     * por la razón equivocada es el mismo defecto con otra ropa.
     *
     * El ancla es `npm ci` a propósito: el CI SIEMPRE lo corre y **no es ninguno de los gates**, así
     * que no solapa con la invariante de abajo. Y se mide por presencia, no por conteo: una versión
     * anterior afirmaba `size > 8` y —con 16 líneas `run: npm …` que colapsan a 9 comandos
     * distintos— se ponía roja al quitar un paso ajeno, otra vez por la razón equivocada.
     */
    expect(
      comandosDelCi.size,
      'el regex no extrajo ningún `run: npm …` del workflow',
    ).toBeGreaterThan(0);
    expect(
      comandosDelCi,
      'el CI ya no corre `npm ci` tal cual (¿le pusieron banderas?): el ancla dejó de servir. ' +
        'Elige otro comando que el CI corra SIEMPRE y que NO sea ninguno de los gates.',
    ).toContain('npm ci');

    for (const gate of GATES) {
      // LA TRADUCCIÓN, dicha con exactitud: los DOS gates de pruebas (`test:unit` en backend y
      // `test` en frontend) los corre el CI como **`npm test`** — en backend eso es unit +
      // integración, y el pre-vuelo se queda con los unit porque la integración necesita Docker,
      // prohibido aquí. Es la única traducción permitida. Todo lo demás va literal.
      const enElCi =
        gate.script === 'test:unit' || gate.script === 'test'
          ? 'npm test'
          : `npm run ${gate.script}`;
      expect(
        [...comandosDelCi],
        `el CI no corre \`${enElCi}\`, así que el pre-vuelo no debería correr ` +
          `\`${gate.paquete}: npm run ${gate.script}\``,
      ).toContain(enElCi);
    }
  });

  it('no corre gates que necesiten Docker o base de datos (regla de «NUNCA Docker local»)', () => {
    const prohibidos = ['test:integracion', 'test:e2e'];
    for (const gate of GATES) {
      expect(prohibidos).not.toContain(gate.script);
    }
  });

  it('no repite un gate ni se olvida de ningún paquete', () => {
    const llaves = GATES.map((g: Gate) => `${g.paquete}:${g.script}`);
    expect(new Set(llaves).size).toBe(llaves.length);
    expect(new Set(GATES.map((g) => g.paquete))).toEqual(new Set(['backend', 'frontend']));
  });
});

describe('⭐⭐ veredicto — la frase de verde sale SI Y SÓLO SI pasó todo', () => {
  it('con todos los gates en 0: imprime la frase y sale con 0', () => {
    const todos = GATES.map((_gate, i) => ok(i));
    const resultado = veredicto(todos);

    expect(resultado.texto).toContain(FRASE_TODO_VERDE);
    expect(resultado.codigoSalida).toBe(0);
  });

  it('🔴 con un gate FALLADO: no imprime la frase y sale con su código', () => {
    const resultados = [ok(0), { gate: GATES[1]!, codigo: 1, senal: null }];

    const resultado = veredicto(resultados);

    expect(resultado.texto).not.toContain(FRASE_TODO_VERDE);
    expect(resultado.codigoSalida).toBe(1);
  });

  it('🔴🔴 un `Killed` (137/SIGKILL) NO es un pase: sin frase, con código ≠ 0 y dicho con letras', () => {
    // Éste es el caso que da nombre a la fila. Un proceso que el kernel mata no imprime resumen ni
    // conteo de pruebas: si el veredicto lo dejara pasar —o lo contara como «no falló»— el script
    // sería el defecto que vino a matar.
    const resultados = [ok(0), { gate: GATES[1]!, codigo: 137, senal: 'SIGKILL' }];

    const resultado = veredicto(resultados);

    expect(resultado.texto).not.toContain(FRASE_TODO_VERDE);
    expect(resultado.codigoSalida).toBe(137);
    expect(resultado.texto).toContain('OOM-KILLER');
    expect(resultado.texto).toContain('NO VALE');
  });

  it('🔴 un OOM de V8 (134) tampoco pasa, y manda a leer la fila antes de subir el techo', () => {
    // La rama gemela del 137: mismo síntoma, otra causa, y la reacción equivocada (subir el heap)
    // es justo la venda de la 0.092.
    const resultado = veredicto([{ gate: GATES[0]!, codigo: 134, senal: null }]);

    expect(resultado.texto).not.toContain(FRASE_TODO_VERDE);
    expect(resultado.codigoSalida).toBe(134);
    expect(resultado.texto).toContain('0.092');
  });

  it('🔴 corrida INCOMPLETA (se paró a la mitad, todos verdes): tampoco es un pase', () => {
    // Sin esto, pararse en el primer fallo y reportar «los que corrieron pasaron» daría la frase
    // con la mitad de los gates sin medir — el paso vacuo, disfrazado de verde.
    const parcial = [ok(0), ok(1)];

    const resultado = veredicto(parcial);

    expect(resultado.texto).not.toContain(FRASE_TODO_VERDE);
    expect(resultado.codigoSalida).not.toBe(0);
  });

  it('la frase es inequívoca y el resumen nombra cada gate que corrió', () => {
    expect(FRASE_TODO_VERDE.length).toBeGreaterThan(10);
    const texto = veredicto(GATES.map((_gate, i) => ok(i))).texto;
    for (const gate of GATES) {
      expect(texto).toContain(`${gate.paquete}: ${gate.script}`);
    }
  });
});
