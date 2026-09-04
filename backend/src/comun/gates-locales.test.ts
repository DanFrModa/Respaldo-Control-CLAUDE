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
 *  3. **⭐ FILA 0.108 — que un gate SALGA CON 0 SIN HABER TERMINADO** y eso cuente como pase. Es la
 *     misma enfermedad un piso más abajo: el código de salida contesta *«¿falló?»*, nunca
 *     *«¿terminó?»*, y hasta la 0.108 nadie hacía la segunda pregunta. Aquí se cubren las dos
 *     direcciones: que un `exit 0` sin resumen se ponga ROJO, y —igual de importante— que un gate
 *     legítimamente mudo (`eslint`, `tsc`, que no imprimen nada al pasar) **siga en verde**, para
 *     que el guardián nuevo no invente rojos.
 *
 * ⚠️ Lo que estas pruebas NO cubren: que el CI no gane un gate NUEVO que el pre-vuelo se pierda.
 * Eso es aceptable y está dicho en el propio script: **esto no es el CI**; el CI es el único juez.
 * Cubrir lo contrario —que el pre-vuelo prometa de más— es lo que sí importa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  clasificarEvidencia,
  FRASE_TODO_VERDE,
  GATES,
  lineaDeTecho,
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

/** Un resultado en verde para el gate `i` de la lista: salió con 0 y dejó su resumen impreso. */
const ok = (i: number): ResultadoGate => ({
  gate: GATES[i]!,
  codigo: 0,
  senal: null,
  evidencia: 'resumen',
});

/**
 * El gate `i` **salió con 0 pero sin dejar constancia de haber terminado** — el caso de la 0.108.
 * `'sin-resumen'` = habló y se cortó antes del resumen; `'sin-salida'` = no imprimió ni una línea.
 */
const mudoEnCero = (i: number, evidencia: 'sin-resumen' | 'sin-salida'): ResultadoGate => ({
  gate: GATES[i]!,
  codigo: 0,
  senal: null,
  evidencia,
});

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
    const resultados = [
      ok(0),
      { gate: GATES[1]!, codigo: 1, senal: null, evidencia: 'no-exigible' as const },
    ];

    const resultado = veredicto(resultados);

    expect(resultado.texto).not.toContain(FRASE_TODO_VERDE);
    expect(resultado.codigoSalida).toBe(1);
  });

  it('🔴🔴 un `Killed` (137/SIGKILL) NO es un pase: sin frase, con código ≠ 0 y dicho con letras', () => {
    // Éste es el caso que da nombre a la fila. Un proceso que el kernel mata no imprime resumen ni
    // conteo de pruebas: si el veredicto lo dejara pasar —o lo contara como «no falló»— el script
    // sería el defecto que vino a matar.
    const resultados = [
      ok(0),
      { gate: GATES[1]!, codigo: 137, senal: 'SIGKILL', evidencia: 'no-exigible' as const },
    ];

    const resultado = veredicto(resultados);

    expect(resultado.texto).not.toContain(FRASE_TODO_VERDE);
    expect(resultado.codigoSalida).toBe(137);
    expect(resultado.texto).toContain('OOM-KILLER');
    expect(resultado.texto).toContain('NO VALE');
  });

  it('🔴 un OOM de V8 (134) tampoco pasa, y manda a leer la fila antes de subir el techo', () => {
    // La rama gemela del 137: mismo síntoma, otra causa, y la reacción equivocada (subir el heap)
    // es justo la venda de la 0.092.
    const resultado = veredicto([
      { gate: GATES[0]!, codigo: 134, senal: null, evidencia: 'sin-resumen' as const },
    ]);

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

/** Índice del gate `paquete: script` dentro de {@link GATES} (por nombre, no por posición). */
function indiceDe(paquete: Gate['paquete'], script: string): number {
  const i = GATES.findIndex((g) => g.paquete === paquete && g.script === script);
  // Truena en vez de `expect`: esto se llama al armar los `describe`, fuera de una prueba.
  if (i < 0) throw new Error(`no existe el gate \`${paquete}: ${script}\``);
  return i;
}

/**
 * Los 8 gates en verde SALVO el `i`, que es el que se pone a prueba.
 *
 * 🔴 Se usa un juego COMPLETO a propósito, y no un par de resultados: con una corrida a medias, el
 * veredicto ya sale en rojo por *«no llegaron a correr»* — o sea, la prueba pasaría aunque la
 * detección de la 0.108 estuviera apagada. Medido: con `esPase` mutado para mirar sólo el código de
 * salida, la versión corta de estas pruebas **sobrevivía**. Ésta no.
 */
const completoSalvo = (i: number, resultado: ResultadoGate): ResultadoGate[] =>
  GATES.map((_gate, j) => (j === i ? resultado : ok(j)));

/**
 * Herramientas que imprimen un resumen al terminar, reconocidas en el COMANDO de npm.
 *
 * 🔴 Del comando, NO del nombre del script (R2 de la revisión de la 0.108): `test:unit` y
 * `format:check` se llaman así hoy, pero un `unit` o un `vitest:ci` de mañana corre exactamente la
 * misma herramienta y se colaba sin huella sin que nada se pusiera rojo. El nombre es convención;
 * el comando es el hecho.
 */
const HERRAMIENTAS_CON_RESUMEN = /\b(prettier|vitest)\b/;

/**
 * La regla del guardián, como función para poder probarla con gates de juguete: devuelve `''` si el
 * gate está bien declarado, o el reproche si no.
 */
function reprocheDeHuella(gate: Gate, comandoNpm: string): string {
  if (HERRAMIENTAS_CON_RESUMEN.test(comandoNpm)) {
    return gate.huellaDeFin === null
      ? `\`${gate.paquete}: ${gate.script}\` corre \`${comandoNpm}\`, que SÍ imprime resumen: ` +
          'no puede declararse sin huella'
      : '';
  }
  return gate.huellaDeFin === null && (gate.sinHuellaPorque ?? '') === ''
    ? `\`${gate.paquete}: ${gate.script}\` va sin huella y sin motivo`
    : '';
}

/*
 * ⭐ Muestras LITERALES de la salida real de cada herramienta, capturadas el 3-sep-2026 con la
 * salida CANALIZADA (sin terminal), que es exactamente como `gates.ts` la ve desde la 0.108. Están
 * aquí para que la huella no se pueda escribir «a ojo»: si una versión nueva de prettier o de
 * vitest cambia su resumen, se cae esta prueba —con la muestra a la vista— y no una corrida en rojo
 * sin explicación.
 */
const SALIDA_PRETTIER_VERDE = [
  '',
  '> backend@0.1.0 format:check',
  '> prettier --check "src/**/*.ts" "prisma/**/*.ts"',
  '',
  'Checking formatting...',
  'All matched files use Prettier code style!',
  '',
].join('\n');

const SALIDA_PRETTIER_ROJA = [
  '',
  '> backend@0.1.0 format:check',
  '> prettier --check "src/**/*.ts"',
  '',
  'Checking formatting...',
  '[warn] src/comun/algo.ts',
  '[warn] Code style issues found in the above file. Run Prettier with --write to fix.',
  '',
].join('\n');

/** Lo que vitest imprime desde que arranca hasta ANTES de su bloque final. */
const SALIDA_VITEST_A_MEDIAS = [
  '',
  '> backend@0.1.0 test:unit',
  '> vitest run --project unit',
  '',
  '',
  ' RUN  v4.1.8 /repo/backend',
  '',
  '',
].join('\n');

const SALIDA_VITEST_VERDE = [
  SALIDA_VITEST_A_MEDIAS,
  ' Test Files  1 passed (1)',
  '      Tests  13 passed (13)',
  '   Start at  20:20:52',
  '   Duration  334ms (transform 109ms, setup 0ms, import 127ms, tests 11ms)',
  '',
].join('\n');

const SALIDA_VITEST_ROJA = [
  SALIDA_VITEST_A_MEDIAS,
  ' Test Files  1 failed (1)',
  '      Tests  1 failed | 12 passed (13)',
  '',
].join('\n');

describe('⭐ 0.108 — la huella de fin: qué se le exige a cada gate y contra qué se midió', () => {
  it('🔴 la exigencia sale del COMANDO real de npm, no del nombre del script', () => {
    for (const gate of GATES) {
      const comando = scriptsDe(gate.paquete)[gate.script] ?? '';
      expect(reprocheDeHuella(gate, comando), 'gate mal declarado').toBe('');
    }
  });

  it('🔴🔴 un gate de juguete que NO se llama «test» pero corre vitest: se le exige huella', () => {
    /*
     * La versión anterior de este guardián decidía por el NOMBRE
     * (`script.startsWith('format') || startsWith('test')`) y este gate se le colaba entero: se
     * llama `unit`, no imprime nada en el nombre, pero corre vitest —que SÍ resume— y entra sin
     * huella. Con la regla leída del comando, el reproche sale solo.
     */
    const juguete: Gate = {
      paquete: 'backend',
      script: 'unit',
      huellaDeFin: null,
      sinHuellaPorque: 'me lo salté',
    };

    expect(reprocheDeHuella(juguete, 'vitest run --project unit')).toContain('SÍ imprime resumen');
    expect(reprocheDeHuella(juguete, 'prettier --check "src/**/*.ts"')).toContain(
      'SÍ imprime resumen',
    );
    // Y con una herramienta muda, el mismo gate está bien declarado: no se inventan rojos.
    expect(reprocheDeHuella(juguete, 'tsc --noEmit')).toBe('');
  });

  it('un gate mudo SIN motivo también se reprocha (el silencio no otorga)', () => {
    const sinMotivo = {
      paquete: 'backend',
      script: 'lint',
      huellaDeFin: null,
      sinHuellaPorque: '',
    };

    expect(reprocheDeHuella(sinMotivo as Gate, 'eslint .')).toContain('sin motivo');
  });

  it('🔴 la huella de prettier casa con su salida real, la verde Y la roja', () => {
    const gate = GATES[indiceDe('backend', 'format:check')]!;
    expect(clasificarEvidencia(gate, [SALIDA_PRETTIER_VERDE])).toBe('resumen');
    expect(clasificarEvidencia(gate, [SALIDA_PRETTIER_ROJA])).toBe('resumen');
  });

  it('🔴 la huella de vitest casa con su salida real, la verde Y la roja', () => {
    const gate = GATES[indiceDe('backend', 'test:unit')]!;
    expect(clasificarEvidencia(gate, [SALIDA_VITEST_VERDE])).toBe('resumen');
    expect(clasificarEvidencia(gate, [SALIDA_VITEST_ROJA])).toBe('resumen');
  });

  it('🔴🔴 un vitest cortado ANTES de su bloque final se ve como lo que es: sin resumen', () => {
    // Éste es el caso de la fila, con la salida de verdad: el gate habló, se le mató a mitad, y lo
    // que quedó impreso no contiene un solo veredicto. Que salga con 0 no lo vuelve un pase.
    const gate = GATES[indiceDe('backend', 'test:unit')]!;
    expect(clasificarEvidencia(gate, [SALIDA_VITEST_A_MEDIAS])).toBe('sin-resumen');
  });

  it('sin una sola línea impresa: `sin-salida`, incluso para un gate mudo', () => {
    // `npm run <script>` imprime SIEMPRE su encabezado, así que cero bytes no es «pasó callado»:
    // es que no arrancó. Vale igual para eslint/tsc, que no tienen huella que exigir.
    for (const script of ['format:check', 'lint']) {
      const gate = GATES[indiceDe('backend', script)]!;
      expect(clasificarEvidencia(gate, [''])).toBe('sin-salida');
      expect(clasificarEvidencia(gate, ['   \n\n  '])).toBe('sin-salida');
    }
  });

  it('un gate mudo que habló es `no-exigible` (no se le inventa una huella)', () => {
    const gate = GATES[indiceDe('backend', 'lint')]!;
    expect(clasificarEvidencia(gate, ['\n> backend@0.1.0 lint\n> eslint .\n'])).toBe('no-exigible');
  });
});

describe('⭐⭐ 0.108 — «terminó sin resumen» es un FALLO, nunca un silencio', () => {
  const iPrettier = indiceDe('backend', 'format:check');
  const iLint = indiceDe('backend', 'lint');

  it('🔴🔴 exit 0 SIN RESUMEN: sin frase, en rojo, y dicho con letras', () => {
    // El agujero exacto de la fila 0.108: hasta aquí, `codigo === 0` bastaba para contar un pase.
    const resultado = veredicto(completoSalvo(iPrettier, mudoEnCero(iPrettier, 'sin-resumen')));

    expect(resultado.texto).not.toContain(FRASE_TODO_VERDE);
    expect(resultado.texto).toContain('SIN RESUMEN');
    expect(resultado.texto).toContain('✗');
    // 🔴 Y el código de salida NO puede ser el 0 del propio gate: imprimir «NO PASÓ» y devolverle
    // un éxito al shell sería el mismo defecto disfrazado.
    expect(resultado.codigoSalida).toBe(1);
  });

  it('🔴 exit 0 sin imprimir NADA: tampoco pasa, y la causa lo distingue del anterior', () => {
    const resultado = veredicto(completoSalvo(iLint, mudoEnCero(iLint, 'sin-salida')));

    expect(resultado.texto).not.toContain(FRASE_TODO_VERDE);
    expect(resultado.texto).toContain('NO IMPRIMIÓ NADA');
    expect(resultado.texto).toContain('✗');
    expect(resultado.codigoSalida).toBe(1);
  });

  it('⭐ un gate MUDO (eslint/tsc) en 0 SIGUE pasando: el guardián no inventa rojos', () => {
    // La otra dirección, y no es adorno: una huella exigida de más pondría en rojo cada corrida
    // buena, y un pre-vuelo que miente en rojo se desactiva igual de rápido que uno que miente en
    // verde. Aquí los dos gates mudos van como los reporta la realidad: `no-exigible`.
    const todos: ResultadoGate[] = GATES.map((gate, i) =>
      gate.huellaDeFin === null
        ? { gate, codigo: 0, senal: null, evidencia: 'no-exigible' as const }
        : ok(i),
    );

    const resultado = veredicto(todos);

    expect(resultado.texto).toContain(FRASE_TODO_VERDE);
    expect(resultado.texto).not.toContain('✗');
    expect(resultado.codigoSalida).toBe(0);
  });

  it('🔴 la invariante, barrida: sale con 0 SI Y SÓLO SI imprimió la frase', () => {
    const casos: ResultadoGate[][] = [
      GATES.map((_gate, i) => ok(i)),
      completoSalvo(0, mudoEnCero(0, 'sin-resumen')),
      completoSalvo(0, mudoEnCero(0, 'sin-salida')),
      completoSalvo(0, { gate: GATES[0]!, codigo: 137, senal: 'SIGKILL', evidencia: 'sin-salida' }),
      completoSalvo(0, { gate: GATES[0]!, codigo: 1, senal: null, evidencia: 'resumen' }),
      [ok(0)],
    ];

    for (const caso of casos) {
      const { texto, codigoSalida } = veredicto(caso);
      expect(
        codigoSalida === 0,
        `desalineado: código ${String(codigoSalida)} contra un texto que ${
          texto.includes(FRASE_TODO_VERDE) ? 'SÍ' : 'NO'
        } trae la frase`,
      ).toBe(texto.includes(FRASE_TODO_VERDE));
    }
  });
});

describe('0.108 — un verde dice con cuánta memoria se logró', () => {
  it('sin `NODE_OPTIONS`: avisa que el techo es HEREDADO, y da el número en MB', () => {
    // El verde que cerró la medición de la 0.108 corrió con 8 GB heredados del contenedor, no
    // elegidos — y eso no se veía por ningún lado.
    const linea = lineaDeTecho(8_640_266_240, undefined);

    expect(linea).toContain('8240 MB');
    expect(linea).toContain('HEREDADO');
  });

  it('con `--max-old-space-size`: lo reporta como elegido a mano', () => {
    const linea = lineaDeTecho(6_442_450_944, '--max-old-space-size=6144');

    expect(linea).toContain('6144');
    expect(linea).not.toContain('HEREDADO');
  });
});

describe('⭐ 0.108 R1 — un pase vigilado y uno que nadie pudo vigilar no se leen igual', () => {
  /** Los 8 en verde, con los mudos como los reporta la realidad: `no-exigible`. */
  const todosEnVerde = (): ResultadoGate[] =>
    GATES.map((gate, i) =>
      gate.huellaDeFin === null
        ? { gate, codigo: 0, senal: null, evidencia: 'no-exigible' as const }
        : ok(i),
    );

  it('🔴 la línea del gate MUDO dice «SIN VIGILANCIA DE RESUMEN» y su motivo textual', () => {
    // El motivo se declaraba y el tipo lo obligaba… pero no salía por ningún lado: el operador veía
    // `— OK` en eslint y en prettier, sin manera de distinguir el verde medido del verde a ciegas.
    const lineas = veredicto(todosEnVerde()).texto.split('\n');
    const motivo = GATES[indiceDe('backend', 'lint')]?.sinHuellaPorque ?? '';
    const lineaMuda = lineas.find((l) => l.includes('backend: lint')) ?? '';

    expect(motivo).not.toBe('');
    expect(lineaMuda).toContain('SIN VIGILANCIA DE RESUMEN');
    expect(lineaMuda).toContain(motivo);
  });

  it('la línea del gate VIGILADO sigue diciendo `OK` a secas, y el verde sigue siendo verde', () => {
    const { texto, codigoSalida } = veredicto(todosEnVerde());
    const lineaVigilada = texto.split('\n').find((l) => l.includes('backend: format:check')) ?? '';

    expect(lineaVigilada).toContain('OK');
    expect(lineaVigilada).not.toContain('SIN VIGILANCIA');
    expect(texto).toContain(FRASE_TODO_VERDE);
    expect(codigoSalida).toBe(0);
  });
});

describe('⭐ 0.108 R3 — una cola POR FLUJO: stderr no puede partir el resumen', () => {
  const AVISO_STDERR = '(node:1234) ExperimentalWarning: algo suelto\n';
  const gateVitest = (): Gate => GATES[indiceDe('backend', 'test:unit')]!;

  it('🔴 pegados, un aviso de stderr parte la línea del resumen y la huella deja de casar', () => {
    // Lo que hacía la versión anterior, con una sola cola compartida: el ancla `^` no casa contra
    // `Test Fi(node:1234)…\nles  1 passed`, y una corrida BUENA se reportaba en rojo. Un pre-vuelo
    // que miente en rojo se desactiva tan rápido como uno que miente en verde.
    const mezclado = `${SALIDA_VITEST_A_MEDIAS} Test Fi${AVISO_STDERR}les  1 passed (1)\n`;

    expect(clasificarEvidencia(gateVitest(), [mezclado])).toBe('sin-resumen');
  });

  it('🔴 separados, esa misma corrida se clasifica bien', () => {
    expect(clasificarEvidencia(gateVitest(), [SALIDA_VITEST_VERDE, AVISO_STDERR])).toBe('resumen');
  });

  it('🔴 la huella cuenta aunque llegue por STDERR: prettier en rojo escribe ahí', () => {
    // Medido el 3-sep-2026: prettier manda «All matched files…» por stdout y «Code style issues
    // found…» por stderr. Si sólo se mirara stdout, un `format:check` FALLADO parecería, además,
    // no haber terminado — dos reproches por un solo hecho.
    const salidas = [
      '\n> backend@0.1.0 format:check\n> prettier --check "src/**/*.ts"\n\nChecking formatting...\n',
      '[warn] src/algo.ts\n[warn] Code style issues found in the above file.\n',
    ];

    expect(clasificarEvidencia(GATES[indiceDe('backend', 'format:check')]!, salidas)).toBe(
      'resumen',
    );
  });

  it('los DOS flujos en blanco siguen siendo `sin-salida`', () => {
    expect(clasificarEvidencia(gateVitest(), ['', '   \n'])).toBe('sin-salida');
  });
});
