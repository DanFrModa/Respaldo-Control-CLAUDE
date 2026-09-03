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
 * ## ⭐ FILA **0.108** — «terminó sin resumen» también es un fallo
 *
 * Al medir la 0.108 la sospecha original —*«`npm run gates` reporta verde un OOM»*— quedó a medias
 * desmentida: se forzó un OOM real (`--max-old-space-size=40` ⇒ **exit 134**) y el veredicto **sí**
 * lo traduce y **sí** retiene la frase. Lo que de verdad faltaba es el hueco de al lado: el script
 * miraba **sólo el código de salida** y era **ciego a la salida del gate**. Un gate que terminara
 * **en 0 sin haber llegado a imprimir su resumen** —vaciado a un `echo`, un runner que se traga su
 * propio crash, npm silenciado— contaba como pase, y el principio *«si no ves la frase, no pasó»*
 * vivía **sólo en la prosa de este comentario**.
 *
 * Desde la 0.108 el script **lee lo que el gate imprime** (lo sigue mostrando en vivo, además de
 * guardarse la cola) y exige la **{@link Gate.huellaDeFin}**: la marca que la herramienta imprime
 * al LLEGAR A SU FINAL, pase o falle. Sin esa marca, el gate se reporta `✗ TERMINÓ SIN RESUMEN`
 * aunque haya salido con 0, y la corrida entera queda en rojo. Nunca un silencio.
 *
 * ⚠️ **El precio, dicho de frente:** para poder leer la salida hay que canalizarla (`pipe`), así
 * que los gates **dejan de ver una terminal** y pierden color y barra de progreso. Se cambia
 * cosmética por la capacidad de afirmar que cada gate llegó a su final; en un pre-vuelo que existe
 * justo para no confiar en la vista, el cambio vale.
 *
 * ⚠️ **Y una herramienta muda no se puede vigilar así:** `eslint` y `tsc` **no imprimen nada**
 * cuando pasan, de modo que ahí no hay huella que exigir (`huellaDeFin: null`, con el motivo
 * escrito **y obligado por el tipo**). Para ellas la red sigue siendo el código de salida, que en
 * una muerte por señal nunca es 0.
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
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getHeapStatistics } from 'node:v8';

/** La frase. No aparece en ninguna otra parte del script: verla es haber pasado todo. */
export const FRASE_TODO_VERDE = 'GATES EN VERDE: pasaron TODOS';

/**
 * Huellas de fin, **medidas contra la salida real de cada herramienta** (3-sep-2026, con la salida
 * canalizada, que es como este script la va a ver). Los mismos textos están fijados como muestras
 * literales en `src/comun/gates-locales.test.ts`: si una versión nueva de la herramienta cambia su
 * resumen, se cae ahí y no en una corrida en rojo sin explicación.
 */
/** `prettier --check`: «All matched files…» al pasar, «Code style issues found…» al fallar. */
const HUELLA_PRETTIER = /All matched files use Prettier code style!|Code style issues found/;
/** `vitest run`: el bloque final siempre abre con `Test Files  N passed|failed (N)`. */
const HUELLA_VITEST = /^\s*Test Files\s+\d+/m;

/**
 * Un gate: un `npm run <script>` dentro de un paquete.
 *
 * 🔑 **La huella no se puede apagar en silencio**: o se declara la marca de fin, o se declara el
 * motivo de que no haya. El tipo obliga a lo segundo — mismo remedio que el seed de perfiles usó
 * para que un permiso no naciera sin dueño (fila 0.105): *el silencio no otorga*.
 */
export type Gate = {
  /** Carpeta del paquete, relativa a `backend/`. */
  paquete: 'backend' | 'frontend';
  /** Nombre del script de npm (tiene que existir en el `package.json` de ese paquete). */
  script: string;
} & (
  | {
      /** Lo que la herramienta imprime al LLEGAR A SU FINAL, pase o falle. */
      huellaDeFin: RegExp;
      sinHuellaPorque?: never;
    }
  | {
      /** La herramienta no imprime nada al pasar: no hay marca que exigir. */
      huellaDeFin: null;
      /** Por qué no la hay. Obligatorio: apagar la vigilancia exige decirlo. */
      sinHuellaPorque: string;
    }
);

/**
 * Motivo de las herramientas mudas. **Se IMPRIME en el resumen** (R1 de la revisión de la 0.108),
 * así que va corto: la explicación larga vive en la cabecera de este archivo.
 */
const MUDA_AL_PASAR = 'no imprime nada al pasar';

/**
 * Los gates locales, EN ESTE ORDEN. Son los de `CLAUDE.md` §7 — ni uno más.
 *
 * El orden no es casual: primero lo barato (formato, lint) y al final lo caro (typecheck y las
 * pruebas), para que un dedazo de formato no te cueste cinco minutos de compilador antes de
 * enterarte. Se corren **SERIALIZADOS**: dos `tsc` a la vez en un sandbox chico es justo la receta
 * del `Killed` que esto viene a hacer visible.
 */
export const GATES: Gate[] = [
  { paquete: 'backend', script: 'format:check', huellaDeFin: HUELLA_PRETTIER },
  {
    paquete: 'backend',
    script: 'lint',
    huellaDeFin: null,
    sinHuellaPorque: `eslint ${MUDA_AL_PASAR}`,
  },
  {
    paquete: 'backend',
    script: 'typecheck',
    huellaDeFin: null,
    sinHuellaPorque: `tsc ${MUDA_AL_PASAR}`,
  },
  { paquete: 'backend', script: 'test:unit', huellaDeFin: HUELLA_VITEST },
  { paquete: 'frontend', script: 'format:check', huellaDeFin: HUELLA_PRETTIER },
  {
    paquete: 'frontend',
    script: 'lint',
    huellaDeFin: null,
    sinHuellaPorque: `eslint ${MUDA_AL_PASAR}`,
  },
  {
    paquete: 'frontend',
    script: 'typecheck',
    huellaDeFin: null,
    sinHuellaPorque: `tsc ${MUDA_AL_PASAR}`,
  },
  { paquete: 'frontend', script: 'test', huellaDeFin: HUELLA_VITEST },
];

/**
 * Qué evidencia dejó el gate de haber llegado hasta el final. **Es independiente del código de
 * salida**: son dos preguntas distintas —«¿falló?» y «¿terminó?»— y confundirlas es el defecto de
 * la 0.108.
 */
export type Evidencia =
  /** Imprimió su huella de fin: llegó al final y lo que se vea es un veredicto de verdad. */
  | 'resumen'
  /** Habló, pero nunca imprimió la huella: murió (o se cortó) a media corrida. */
  | 'sin-resumen'
  /** No imprimió NADA, ni el encabezado de npm. */
  | 'sin-salida'
  /** El gate no tiene huella declarada (herramienta muda al pasar). */
  | 'no-exigible';

/**
 * Clasifica la salida de un gate. **Función pura**: se prueba sin correr nada.
 *
 * ⚠️ `'sin-salida'` se juzga sobre TODA la salida, no sobre la huella: `npm run <script>` imprime
 * siempre su encabezado (`> paquete@version script`), así que **cero bytes** significa que el
 * proceso no llegó ni a arrancar… o que npm corre silenciado, que aquí no se soporta a propósito
 * (el mensaje lo dice, para que un rojo así se diagnostique en un vistazo y no erosione la
 * confianza en el pre-vuelo).
 *
 * 🔴 **Recibe UNA CADENA POR FLUJO, nunca las dos pegadas** (R3 de la revisión). Con stdout y
 * stderr concatenados, un aviso escrito por stderr en mitad de la línea del resumen la parte
 * —`Test Fi` + aviso + `les  1 passed`— y el ancla `^` deja de casar: **un rojo falso**, que apaga
 * la confianza en el pre-vuelo tan rápido como un verde falso. La huella cuenta si aparece en
 * CUALQUIERA de los flujos, y hace falta que sea así: medido el 3-sep-2026, prettier dice «All
 * matched files…» por **stdout** y «Code style issues found…» por **stderr**; vitest resume por
 * **stdout**.
 */
export function clasificarEvidencia(gate: Gate, salidas: readonly string[]): Evidencia {
  if (salidas.every((salida) => salida.trim() === '')) return 'sin-salida';
  if (gate.huellaDeFin === null) return 'no-exigible';
  const huella = gate.huellaDeFin;
  return salidas.some((salida) => huella.test(salida)) ? 'resumen' : 'sin-resumen';
}

/** Cómo terminó un gate. */
export interface ResultadoGate {
  gate: Gate;
  /** Código de salida efectivo: el del proceso, o `128 + señal` si lo mataron. */
  codigo: number;
  /** Nombre de la señal si el sistema lo mató (`SIGKILL`), `null` si terminó por su cuenta. */
  senal: string | null;
  /** Qué dejó impreso: la otra mitad del veredicto, la que el código de salida no contesta. */
  evidencia: Evidencia;
}

/** Un gate pasa **sólo si** salió con 0 **y** dejó constancia de haber terminado. */
function esPase(resultado: ResultadoGate): boolean {
  return (
    resultado.codigo === 0 &&
    (resultado.evidencia === 'resumen' || resultado.evidencia === 'no-exigible')
  );
}

/** Lo que hay que decir sobre la evidencia, o `''` si no hay nada que reprochar. */
function explicarEvidencia(resultado: ResultadoGate): string {
  if (resultado.evidencia === 'sin-salida') {
    return (
      'NO IMPRIMIÓ NADA — ni el encabezado de npm: o murió antes de escribir una línea, o npm ' +
      'está silenciado (`--silent`/`loglevel`), que aquí NO se soporta a propósito.'
    );
  }
  if (resultado.evidencia === 'sin-resumen') {
    const huella = resultado.gate.huellaDeFin?.source ?? '';
    return (
      `TERMINÓ SIN RESUMEN — nunca imprimió su marca de fin (/${huella}/), así que se cortó a ` +
      'media corrida y NADA quedó medido.'
    );
  }
  return '';
}

/**
 * `137` (SIGKILL) y `134` (SIGABRT) son los dos OOM, y no significan lo mismo. Y desde la 0.108 hay
 * un tercer desenlace que no es ninguno de los dos: **salir con 0 sin haber terminado**.
 */
function explicarResultado(resultado: ResultadoGate): string {
  const falta = explicarEvidencia(resultado);
  if (resultado.codigo === 0) {
    if (falta !== '') return `${falta} Exit 0, pero NO es un pase.`;
    // 🔴 R1: un pase VIGILADO y uno que nadie pudo vigilar no pueden leerse igual. El motivo está
    // declarado y el tipo lo obliga, pero si además no se imprime, el operador nunca se entera de
    // que este verde se apoya sólo en un número. Va en la línea del pase, que es donde engaña.
    if (resultado.gate.huellaDeFin === null) {
      return (
        `OK, pero SIN VIGILANCIA DE RESUMEN (${resultado.gate.sinHuellaPorque}): aquí el pase lo ` +
        'respalda sólo el código de salida.'
      );
    }
    return 'OK';
  }
  const base = ((): string => {
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
  })();
  return falta === '' ? base : `${base} Además: ${falta}`;
}

/**
 * El veredicto. **Función pura**: recibe cómo terminó cada gate y devuelve qué imprimir y con qué
 * código salir. Se prueba sin correr un solo gate (`src/comun/gates-locales.test.ts`).
 *
 * La invariante es una sola: {@link FRASE_TODO_VERDE} sale **si y sólo si** todos los gates
 * terminaron en 0 **y con constancia de haber terminado**. Un gate muerto por señal cuenta como
 * fallo, y uno que salió con 0 sin imprimir su resumen, también.
 */
export function veredicto(resultados: readonly ResultadoGate[]): {
  texto: string;
  codigoSalida: number;
} {
  const lineas = resultados.map(
    (r) =>
      `  ${esPase(r) ? '·' : '✗'} ${r.gate.paquete}: ${r.gate.script} — ${explicarResultado(r)}`,
  );
  const fallados = resultados.filter((r) => !esPase(r));
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
  // 🔴 El código del primer fallado, PERO nunca 0: un gate que salió con 0 sin resumen es un fallo,
  // y salir con su propio 0 imprimiría «NO PASÓ» y devolvería un éxito al shell. El agujero exacto
  // que esta fila vino a tapar, un piso más abajo.
  const primero = fallados[0];
  const codigoSalida = primero === undefined || primero.codigo === 0 ? 1 : primero.codigo;
  return { texto: [...lineas, ...cola].join('\n'), codigoSalida };
}

/**
 * Con cuánta memoria corrió esto. **Función pura** (recibe el techo y el entorno) para poder
 * probarla.
 *
 * Nace de la 0.108: el verde que cerró aquella medición corrió con **8 GB heredados del
 * contenedor**, no elegidos — y un verde que no dice con cuánta memoria se logró no se puede
 * comparar con el de mañana. Es el techo de ESTE proceso; los gates son procesos aparte, pero
 * heredan `NODE_OPTIONS` y el mismo default de la máquina, así que el número es representativo.
 */
export function lineaDeTecho(limiteHeapBytes: number, nodeOptions: string | undefined): string {
  const mb = String(Math.round(limiteHeapBytes / 1024 / 1024));
  const elegido = /--max-old-space-size[= ](\d+)/.exec(nodeOptions ?? '');
  return elegido === null
    ? `Heap de este proceso: ${mb} MB — HEREDADO de la máquina/contenedor, nadie lo eligió ` +
        '(`NODE_OPTIONS` no fija `--max-old-space-size`). Un verde de aquí vale para ESTA memoria.'
    : `Heap de este proceso: ${mb} MB — elegido a mano (\`--max-old-space-size=${elegido[1] ?? ''}\`).`;
}

/**
 * Lanza un comando y lo **OBSERVA**: lo muestra en vivo y a la vez se guarda la **cola de cada
 * flujo** para poder exigirle su huella de fin. Sólo la cola —no todo— porque este script existe
 * para corridas donde la memoria ya escasea: acumular la salida entera de `vitest` sería llevarle
 * leña al incendio.
 *
 * 🔴 **Está exportada para que una prueba pueda ejercitar ESTE cableado con un proceso de verdad**
 * (`src/comun/gates-locales.proceso.test.ts`). Antes no lo hacía ninguna: el reviewer de la 0.108
 * mutó las dos colas a una sola compartida y **las 30 pruebas lo dejaron pasar**, porque todas le
 * entregaban las cadenas ya separadas a {@link clasificarEvidencia}. Un refactor que volviera a
 * juntarlas habría devuelto el rojo falso sin que nada se pusiera rojo — el mismo silencio que esta
 * fila vino a cerrar, una capa más abajo.
 */
export async function correrComando(
  gate: Gate,
  comando: string,
  argumentos: readonly string[],
  cwd: string,
): Promise<ResultadoGate> {
  const hijo = spawn(comando, argumentos, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  /** Últimos ~256 KiB de CADA flujo, por separado — el porqué, en {@link clasificarEvidencia}. */
  const COLA_MAXIMA = 256 * 1024;
  const espejo = (
    origen: NodeJS.ReadableStream | null,
    destino: NodeJS.WritableStream,
  ): (() => string) => {
    let cola = '';
    const leer = (): string => cola;
    if (origen === null) return leer;
    const decodificador = new StringDecoder('utf8');
    const anexar = (texto: string): void => {
      cola += texto;
      if (cola.length > COLA_MAXIMA) cola = cola.slice(-COLA_MAXIMA);
    };
    origen.on('data', (trozo: Buffer) => {
      // En vivo y tal cual: verlo pasar sigue siendo la mitad del valor. Y CON CONTRAPRESIÓN,
      // porque desde la 0.108 la salida del hijo ya no va directa a la terminal sino que atraviesa
      // este proceso: sin pausar la fuente, un gate parlanchín se acumularía en la memoria del
      // script que existe justo para vigilar los OOM.
      if (!destino.write(trozo)) {
        origen.pause();
        destino.once('drain', () => {
          origen.resume();
        });
      }
      anexar(decodificador.write(trozo));
    });
    origen.on('end', () => {
      anexar(decodificador.end());
    });
    return leer;
  };
  const colaSalida = espejo(hijo.stdout, process.stdout);
  const colaError = espejo(hijo.stderr, process.stderr);

  const { codigo, senal } = await new Promise<{ codigo: number; senal: string | null }>(
    (resolver) => {
      // Ni siquiera se pudo lanzar npm (ENOENT). No hay salida que leer: caerá en 'sin-salida'.
      hijo.on('error', () => {
        resolver({ codigo: 127, senal: null });
      });
      hijo.on('close', (estado, senalRecibida) => {
        const recibida = senalRecibida ?? null;
        resolver({
          codigo: estado ?? (recibida === null ? 1 : 128 + (recibida === 'SIGKILL' ? 9 : 6)),
          senal: recibida,
        });
      });
    },
  );

  return {
    gate,
    codigo,
    senal,
    evidencia: clasificarEvidencia(gate, [colaSalida(), colaError()]),
  };
}

/** Corre un gate: `npm run <script>` dentro de su paquete, observado por {@link correrComando}. */
async function correr(gate: Gate, raizRepo: string): Promise<ResultadoGate> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return correrComando(gate, npm, ['run', gate.script], `${raizRepo}/${gate.paquete}`);
}

async function main(): Promise<void> {
  const raizRepo = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

  for (const paquete of ['backend', 'frontend'] as const) {
    if (!existsSync(`${raizRepo}/${paquete}/node_modules`)) {
      console.error(
        `\nNo hay \`${paquete}/node_modules\`: corre \`npm ci\` ahí antes. (Esto NO es un gate ` +
          'fallado: es que ni siquiera se pudo empezar.)\n',
      );
      process.exitCode = 2;
      return;
    }
  }

  const techo = lineaDeTecho(getHeapStatistics().heap_size_limit, process.env['NODE_OPTIONS']);
  console.log(`\n${techo}`);

  const resultados: ResultadoGate[] = [];
  for (const gate of GATES) {
    console.log(`\n───── ${gate.paquete}: npm run ${gate.script} ─────`);
    const resultado = await correr(gate, raizRepo);
    resultados.push(resultado);
    // Se PARA en el primero que NO pasa: seguir corriendo tras un OOM sólo produce más ruido en el
    // que ya no cabe la memoria, y el resumen diría «7 de 8» como si el octavo se hubiera medido.
    if (!esPase(resultado)) break;
  }

  const { texto, codigoSalida } = veredicto(resultados);
  // El techo se repite al pie a propósito: arriba queda a ocho gates de distancia, y el número con
  // el que se logró un verde es parte del verde.
  console.log(`\n═════ RESUMEN ═════\n${texto}\n${techo}\n`);
  // 🔴 `process.exitCode`, NO `process.exit()`: desde la 0.108 la salida de los gates ATRAVIESA
  // este proceso, y un `exit` inmediato puede cortar lo que siga en el búfer cuando la salida no es
  // una terminal (`npm run gates | tee bitacora.txt`). Truncar justo la evidencia sería el defecto
  // de esta fila con otra ropa. Sin nada vivo en el bucle, el proceso termina solo con este código.
  process.exitCode = codigoSalida;
}

// Sólo cuando se ejecuta directamente (`npm run gates`): importarlo desde una prueba no corre nada.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main();
}
