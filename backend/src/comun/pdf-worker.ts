/**
 * Pool de workers de render de PDF (hilo principal) — la orquestación del blindaje general de PDFs.
 *
 * Motivación (incidente 11-jul, `prueba`): imprimir el inventario de Telas renderizó miles de renglones
 * con `@react-pdf/renderer` EN EL EVENT LOOP → 82 s de hilo principal bloqueado, nginx 504 y la app
 * congelada para todos. Este pool mueve TODO el `renderToBuffer` a `node:worker_threads`: el hilo
 * principal solo resuelve los datos contra la BD (`armarDatos*`) y delega el render. Aunque un impreso
 * sea enorme, el event loop sigue atendiendo peticiones; y un render que se dispare (timeout) se corta
 * limpio en vez de tumbar el proceso.
 *
 * Diseño:
 *  • Pool fijo de N workers (`PDF_WORKER_POOL`, default 2) + cola FIFO. Cada worker atiende un trabajo
 *    a la vez; los trabajos en espera se reparten a los workers ociosos.
 *  • Timeout por trabajo (`PDF_WORKER_TIMEOUT_MS`, default 30 s): si un render no responde a tiempo se
 *    RECHAZA con un `ErrorValidacion` (400) accionable ("acota con filtros o usa el export a Excel") y
 *    el worker atascado se TERMINA y se reemplaza (no se puede recuperar un hilo bloqueado).
 *  • Reciclaje: si un worker muere (error/exit≠0), su trabajo en vuelo se rechaza y se crea uno nuevo.
 *  • Los workers van `unref()` para no bloquear la salida del proceso (tests/CLI).
 *
 * Arranque dev/prod: en dev/tests (tsx) el Worker arranca por un bootstrap `.mjs` (`pdf-worker-boot.mjs`)
 * que registra el loader de tsx y recién entonces importa el hilo en TypeScript — `--import tsx` en el
 * `execArgv` de un Worker NO aplica a su propia entrada. En prod el hilo ya está compilado y se carga
 * directo (`pdf-worker-thread.js`). Ver {@link entradaWorker}.
 */
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

import { ErrorValidacion } from './errores.js';
import type { ClavePdf, PeticionRenderPdf, RespuestaRenderPdf } from './pdf-worker-thread.js';

/** Tamaño del pool (≥1). Un par de workers basta: el render es CPU-bound y los PDF son esporádicos. */
const TAMANO_POOL = Math.max(1, Number(process.env.PDF_WORKER_POOL) || 2);

/**
 * Tiempo máximo de un render antes de cortarlo (ms). Se lee en cada trabajo (no como constante de
 * módulo) para que los tests puedan bajarlo y ejercer la rama de timeout sin esperar 30 s. Default 30 s.
 */
function timeoutMs(): number {
  return Math.max(1, Number(process.env.PDF_WORKER_TIMEOUT_MS) || 30_000);
}

/** Un trabajo de render en cola o en vuelo. */
interface Trabajo {
  id: string;
  clave: ClavePdf;
  datos: unknown;
  resolver: (buffer: Buffer) => void;
  rechazar: (error: Error) => void;
}

/** Un worker del pool con el trabajo que atiende (si alguno) y su temporizador de timeout. */
interface Ranura {
  worker: Worker;
  trabajo: Trabajo | null;
  temporizador: NodeJS.Timeout | null;
}

let pool: Ranura[] | null = null;
const cola: Trabajo[] = [];

/** Resuelve la entrada del worker según se corra bajo tsx (dev/tests) o compilado (prod). */
function entradaWorker(): { url: URL; execArgv: string[] } {
  // `pathname` (no la URL cruda) para ignorar posibles `?query` que agregue el runner de dev/tests.
  const esTs = new URL(import.meta.url).pathname.endsWith('.ts');
  // Dev/tests: arranca por el bootstrap `.mjs` que registra tsx y carga el hilo en TypeScript
  // (`--import tsx` en execArgv no aplica a la entrada del Worker). Prod: el hilo ya está compilado.
  // `execArgv: []` = worker limpio (no hereda flags del proceso padre, p. ej. los de vitest).
  return {
    url: new URL(esTs ? './pdf-worker-boot.mjs' : './pdf-worker-thread.js', import.meta.url),
    execArgv: [],
  };
}

/** Crea un worker y engancha sus eventos. */
function crearRanura(): Ranura {
  const { url, execArgv } = entradaWorker();
  const worker = new Worker(url, { execArgv });
  const ranura: Ranura = { worker, trabajo: null, temporizador: null };
  worker.on('message', (msg: RespuestaRenderPdf) => alRecibir(ranura, msg));
  worker.on('error', (error: Error) => alCaer(ranura, error));
  worker.on('exit', (codigo: number) => {
    if (codigo !== 0) {
      alCaer(ranura, new Error(`el worker de PDF salió con código ${String(codigo)}`));
    }
  });
  worker.unref();
  return ranura;
}

/** Inicializa el pool la primera vez que se pide un render (lazy: no gasta hilos si nunca se imprime). */
function asegurarPool(): Ranura[] {
  pool ??= Array.from({ length: TAMANO_POOL }, () => crearRanura());
  return pool;
}

/** Reparte los trabajos en cola a los workers ociosos. */
function repartir(): void {
  const ranuras = asegurarPool();
  for (const ranura of ranuras) {
    if (ranura.trabajo !== null || cola.length === 0) {
      continue;
    }
    const trabajo = cola.shift();
    if (trabajo === undefined) {
      break;
    }
    ranura.trabajo = trabajo;
    const temporizador = setTimeout(() => alExpirar(ranura), timeoutMs());
    // No debe mantener vivo el proceso por sí solo (la petición HTTP en curso ya lo hace).
    temporizador.unref();
    ranura.temporizador = temporizador;
    const peticion: PeticionRenderPdf = {
      id: trabajo.id,
      clave: trabajo.clave,
      datos: trabajo.datos,
    };
    ranura.worker.postMessage(peticion);
  }
}

/** Suelta el trabajo y el temporizador de una ranura (queda ociosa). */
function liberar(ranura: Ranura): Trabajo | null {
  if (ranura.temporizador !== null) {
    clearTimeout(ranura.temporizador);
    ranura.temporizador = null;
  }
  const trabajo = ranura.trabajo;
  ranura.trabajo = null;
  return trabajo;
}

/** Respuesta de un worker: entrega el Buffer o el error a quien esperaba, y sigue con la cola. */
function alRecibir(ranura: Ranura, msg: RespuestaRenderPdf): void {
  const trabajo = ranura.trabajo;
  // Respuesta tardía tras un timeout/reciclaje: ya no hay a quién entregarla.
  if (trabajo === null || trabajo.id !== msg.id) {
    return;
  }
  liberar(ranura);
  if (msg.ok) {
    const b = msg.buffer;
    trabajo.resolver(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
  } else {
    trabajo.rechazar(new Error(msg.error));
  }
  repartir();
}

/** Sustituye una ranura muerta/atascada por un worker nuevo. */
function reemplazar(ranura: Ranura): void {
  void ranura.worker.terminate();
  if (pool !== null) {
    const i = pool.indexOf(ranura);
    if (i >= 0) {
      pool[i] = crearRanura();
    }
  }
}

/** Un worker murió (error o exit≠0): rechaza su trabajo en vuelo y lo reemplaza. */
function alCaer(ranura: Ranura, error: Error): void {
  const trabajo = liberar(ranura);
  reemplazar(ranura);
  trabajo?.rechazar(error);
  repartir();
}

/** Un render excedió el tiempo límite: corta el worker (no se recupera un hilo bloqueado) y avisa. */
function alExpirar(ranura: Ranura): void {
  const trabajo = liberar(ranura);
  reemplazar(ranura);
  trabajo?.rechazar(
    new ErrorValidacion(
      'El PDF tardó demasiado en generarse (probablemente por demasiados renglones). ' +
        'Acota con filtros o usa el export a Excel para el total.',
    ),
  );
  repartir();
}

/**
 * Renderiza un impreso EN UN WORKER (fuera del event loop) y devuelve su Buffer. `datos` debe ser el
 * resultado YA resuelto de `armarDatos*` (serializable por structured clone: primitivos, arreglos,
 * objetos planos, `Date`; NO instancias como `Prisma.Decimal` — conviértelas a número/cadena al armar).
 * Lanza `ErrorValidacion` (400) si el render excede el timeout; propaga cualquier otro fallo del render.
 */
export function renderizarPdfEnWorker(clave: ClavePdf, datos: unknown): Promise<Buffer> {
  return new Promise<Buffer>((resolver, rechazar) => {
    cola.push({ id: randomUUID(), clave, datos, resolver, rechazar });
    repartir();
  });
}

/** Termina el pool (para apagado ordenado o limpieza de tests). Se re-crea perezosamente si se vuelve a usar. */
export async function cerrarPoolPdf(): Promise<void> {
  const ranuras = pool;
  pool = null;
  if (ranuras !== null) {
    await Promise.all(ranuras.map((r) => r.worker.terminate()));
  }
}
