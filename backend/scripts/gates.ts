/**
 * ⭐⭐ FILA **0.092**, segunda mitad — **EL `Killed` QUE SE LEE COMO PASE.**
 *
 * ## El daño que viene a tapar
 *
 * El sandbox local se queda sin memoria y el kernel mata el proceso. Pasó **cuatro veces en una
 * noche**, a dos coders y a dos reviewers. Y el problema no es que muera: es que **muere impreso
 * como `Killed`**, sin resumen, sin conteo de pruebas y sin nada rojo — y a ojo, después de
 * cuatro gates, un `Killed` se parece bastante a un verde. Así se reportó «typecheck limpio» sobre
 * una corrida que ni siquiera terminó.
 *
 * La cura no es más memoria: es que **la ausencia de una frase sea la señal**. Este script corre
 * los gates uno por uno, imprime el código de salida de cada uno, **traduce** el `137` y el `134`
 * a lo que de verdad significan, y sólo imprime {@link FRASE_TODO_VERDE} cuando pasaron TODOS. Si
 * no ves esa frase, no pasó — no importa cómo se vea lo de arriba.
 *
 * ## Lo que este script NO es
 *
 * 🔴 **NO es el CI, y no pretende serlo.** `CLAUDE.md` §7 ya lo dice: *el CI es el único juez*.
 * Esto es el pre-vuelo local: el subconjunto de gates que corre **sin Docker y sin base de datos**
 * (la regla de «NUNCA Docker local» deja fuera la integración y el e2e). Fuera quedan, a propósito:
 *
 *  • las pruebas de **integración** y el **e2e** (necesitan Postgres/compose ⇒ CI);
 *  • el **build** (`tsc -p tsconfig.build.json`) — lo cubre el typecheck salvo la emisión;
 *  • la **regeneración del contrato** (`npm run openapi` / `npm run gen:api` + `git diff
 *    --exit-code`), porque ESCRIBE en el árbol de trabajo y un pre-vuelo no debe hacerlo a tus
 *    espaldas. Si tocaste rutas o esquemas Zod, ese par va aparte y a mano.
 *
 * Que el subconjunto no se agrande solo por descuido lo vigila `src/comun/gates-locales.test.ts`:
 * exige que cada gate exista en su `package.json` y que el CI corra ese mismo gate.
 *
 * Uso:  `npm run gates`   (desde `backend/`)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** La frase. No aparece en ninguna otra parte del script: verla es haber pasado todo. */
export const FRASE_TODO_VERDE = 'GATES EN VERDE: pasaron TODOS';

/** Un gate: un `npm run <script>` dentro de un paquete. */
export interface Gate {
  /** Carpeta del paquete, relativa a `backend/`. */
  paquete: 'backend' | 'frontend';
  /** Nombre del script de npm (tiene que existir en el `package.json` de ese paquete). */
  script: string;
}

/**
 * Los gates locales, EN ESTE ORDEN. Son los de `CLAUDE.md` §7 — ni uno más.
 *
 * El orden no es casual: primero lo barato (formato, lint) y al final lo caro (typecheck y las
 * pruebas), para que un dedazo de formato no te cueste cinco minutos de compilador antes de
 * enterarte. Se corren **SERIALIZADOS**: dos `tsc` a la vez en un sandbox chico es justo la receta
 * del `Killed` que esto viene a hacer visible.
 */
export const GATES: Gate[] = [
  { paquete: 'backend', script: 'format:check' },
  { paquete: 'backend', script: 'lint' },
  { paquete: 'backend', script: 'typecheck' },
  { paquete: 'backend', script: 'test:unit' },
  { paquete: 'frontend', script: 'format:check' },
  { paquete: 'frontend', script: 'lint' },
  { paquete: 'frontend', script: 'typecheck' },
  { paquete: 'frontend', script: 'test' },
];

/** Cómo terminó un gate. */
export interface ResultadoGate {
  gate: Gate;
  /** Código de salida efectivo: el del proceso, o `128 + señal` si lo mataron. */
  codigo: number;
  /** Nombre de la señal si el sistema lo mató (`SIGKILL`), `null` si terminó por su cuenta. */
  senal: string | null;
}

/** `137` (SIGKILL) y `134` (SIGABRT) son los dos OOM, y no significan lo mismo. */
function explicarCodigo(resultado: ResultadoGate): string {
  if (resultado.codigo === 0) return 'OK';
  if (resultado.codigo === 137 || resultado.senal === 'SIGKILL') {
    return (
      'MUERTO POR EL OOM-KILLER DEL KERNEL (137/SIGKILL) — la corrida NO VALE y NO es un pase: ' +
      'el proceso se quedó sin memoria y lo mataron a mitad. Vuelve a correrlo solo, sin nada más ' +
      'en paralelo.'
    );
  }
  if (resultado.codigo === 134) {
    return (
      'OOM DE V8 (134, «JavaScript heap out of memory») — tampoco es un pase. Si es el typecheck, ' +
      'antes de subir ningún techo lee la fila 0.092 y `ci.yml` (las curas son otras).'
    );
  }
  return `FALLÓ (exit ${String(resultado.codigo)})`;
}

/**
 * El veredicto. **Función pura**: recibe cómo terminó cada gate y devuelve qué imprimir y con qué
 * código salir. Se prueba sin correr un solo gate (`src/comun/gates-locales.test.ts`).
 *
 * La invariante es una sola: {@link FRASE_TODO_VERDE} sale **si y sólo si** todos los gates
 * terminaron en 0. Un gate muerto por señal cuenta como fallo, nunca como pase.
 */
export function veredicto(resultados: readonly ResultadoGate[]): {
  texto: string;
  codigoSalida: number;
} {
  const lineas = resultados.map(
    (r) =>
      `  ${r.codigo === 0 ? '·' : '✗'} ${r.gate.paquete}: ${r.gate.script} — ${explicarCodigo(r)}`,
  );
  const fallados = resultados.filter((r) => r.codigo !== 0);
  const faltantes = GATES.length - resultados.length;

  if (fallados.length === 0 && faltantes === 0) {
    return {
      texto: [
        ...lineas,
        '',
        `${FRASE_TODO_VERDE} (${String(GATES.length)}/${String(GATES.length)}).`,
        '',
      ].join('\n'),
      codigoSalida: 0,
    };
  }

  const cola = [
    '',
    `NO PASÓ: ${String(fallados.length)} gate(s) fallaron` +
      (faltantes > 0 ? ` y ${String(faltantes)} no llegaron a correr` : '') +
      '.',
    'Si no ves la frase de verde, NO pasó — aunque lo de arriba se vea tranquilo.',
    '',
  ];
  return { texto: [...lineas, ...cola].join('\n'), codigoSalida: fallados[0]?.codigo ?? 1 };
}

/** Corre un gate heredando la salida, para verlo en vivo. */
function correr(gate: Gate, raizRepo: string): ResultadoGate {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const salida = spawnSync(npm, ['run', gate.script], {
    cwd: `${raizRepo}/${gate.paquete}`,
    stdio: 'inherit',
  });
  const senal = salida.signal ?? null;
  const codigo = salida.status ?? (senal === null ? 1 : 128 + (senal === 'SIGKILL' ? 9 : 6));
  return { gate, codigo, senal };
}

function main(): void {
  const raizRepo = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

  for (const paquete of ['backend', 'frontend'] as const) {
    if (!existsSync(`${raizRepo}/${paquete}/node_modules`)) {
      console.error(
        `\nNo hay \`${paquete}/node_modules\`: corre \`npm ci\` ahí antes. (Esto NO es un gate ` +
          'fallado: es que ni siquiera se pudo empezar.)\n',
      );
      process.exit(2);
    }
  }

  const resultados: ResultadoGate[] = [];
  for (const gate of GATES) {
    console.log(`\n───── ${gate.paquete}: npm run ${gate.script} ─────`);
    const resultado = correr(gate, raizRepo);
    resultados.push(resultado);
    // Se PARA en el primero que falla: seguir corriendo tras un OOM sólo produce más ruido en el
    // que ya no cabe la memoria, y el resumen diría «7 de 8» como si el octavo se hubiera medido.
    if (resultado.codigo !== 0) break;
  }

  const { texto, codigoSalida } = veredicto(resultados);
  console.log(`\n═════ RESUMEN ═════\n${texto}`);
  process.exit(codigoSalida);
}

// Sólo cuando se ejecuta directamente (`npm run gates`): importarlo desde una prueba no corre nada.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
