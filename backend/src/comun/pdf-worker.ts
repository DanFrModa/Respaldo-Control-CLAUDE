/**
 * Pool de workers de generación de DOCUMENTOS (hilo principal) — la orquestación del blindaje general
 * de impresos (PDF con `@react-pdf/renderer` y Excel con `exceljs`).
 *
 * Motivación (incidente 11-jul, `prueba`): imprimir el inventario de Telas renderizó miles de renglones
 * EN EL EVENT LOOP → 82 s de hilo principal bloqueado, nginx 504 y la app congelada para todos. Los
 * exports a Excel tienen el MISMO riesgo: acumulan el workbook completo (decenas de miles de filas) en
 * el hilo principal. Este pool mueve TODA la construcción a `node:worker_threads`: el hilo principal
 * solo resuelve los datos contra la BD (`armarDatos*`) y delega. Aunque un documento sea enorme, el
 * event loop sigue atendiendo peticiones; y una construcción que se dispare (timeout) se corta limpio
 * en vez de tumbar el proceso.
 *
 * Diseño:
 *  • Pool fijo de N workers (`PDF_WORKER_POOL`, default 2) + cola FIFO. Cada worker atiende un trabajo
 *    a la vez; los trabajos en espera se reparten a los workers ociosos. PDF y Excel comparten el pool.
 *  • Timeout por trabajo SEGÚN el tipo: los PDF (`PDF_WORKER_TIMEOUT_MS`, default 30 s) y los Excel
 *    (`EXCEL_WORKER_TIMEOUT_MS`, default 60 s — un libro grande tarda más que un render de PDF). Si no
 *    responde a tiempo se RECHAZA con un `ErrorValidacion` (400) accionable y el worker atascado se
 *    TERMINA y se reemplaza (no se puede recuperar un hilo bloqueado).
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
import { dataUrlLogoEmpresa } from './logo-empresa.js';
import type {
  ClavePdf,
  ClaveExcel,
  PeticionRenderPdf,
  RespuestaRenderPdf,
} from './pdf-worker-thread.js';

/** Tamaño del pool (≥1). Un par de workers basta: la construcción es CPU-bound y esporádica. */
const TAMANO_POOL = Math.max(1, Number(process.env.PDF_WORKER_POOL) || 2);

/** Familia del documento: fija el timeout y el mensaje de corte. */
type TipoDocumento = 'pdf' | 'excel';

/**
 * Tiempo máximo de una construcción antes de cortarla (ms), según el tipo. Se lee en cada trabajo (no
 * como constante de módulo) para que los tests puedan bajarlo y ejercer la rama de timeout sin esperar.
 * Los Excel llevan un tope mayor (default 60 s) porque el `writeBuffer` de un libro grande tarda más que
 * un render de PDF (default 30 s).
 */
function timeoutMs(tipo: TipoDocumento): number {
  if (tipo === 'excel') {
    return Math.max(1, Number(process.env.EXCEL_WORKER_TIMEOUT_MS) || 60_000);
  }
  return Math.max(1, Number(process.env.PDF_WORKER_TIMEOUT_MS) || 30_000);
}

/** Un trabajo de construcción en cola o en vuelo. */
interface Trabajo {
  id: string;
  clave: ClavePdf | ClaveExcel;
  tipo: TipoDocumento;
  datos: unknown;
  /** Logo de la empresa (data-URL) para el membrete del PDF; `undefined` = deja el empaquetado. */
  logo: string | undefined;
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

/**
 * ¿Se está cerrando el pool? `cerrarPoolPdf` termina los workers, y su `terminate()` dispara el evento
 * `exit` (código ≠ 0) → `alCaer` → `repartir`, que sin esta bandera RE-CREARÍA el pool que se acaba de
 * cerrar (auto-resurrección). Mientras está activa, `repartir` no despacha ni recrea; un trabajo nuevo
 * (`encolar`) la baja para reabrir el pool de forma perezosa.
 */
let cerrando = false;

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

/**
 * Arranca el pool AHORA, sin encolar nada. Es un `void`: los `Worker` se crean y siguen booteando
 * en segundo plano (bajo tsx eso incluye registrar el loader e importar módulos TypeScript, lo más
 * caro del primer render de cada proceso).
 *
 * Existe para SOLAPAR ese arranque con lo que el hilo principal tenga que resolver antes de poder
 * encolar — hoy, el logo del membrete (`comun/logo-empresa.ts`, que en frío inicializa Prisma).
 * Hacerlos en serie sumaba ambos costos al primer impreso; lanzados a la vez, el logo se resuelve
 * mientras el worker arranca y prácticamente desaparece del reloj.
 */
function precalentarPool(): void {
  // Un `precalentar` cuenta como uso: reabre el pool si venía de un cierre (mismo criterio que
  // `encolar`), porque justo detrás va a llegar el trabajo.
  cerrando = false;
  asegurarPool();
}

/** Reparte los trabajos en cola a los workers ociosos. */
function repartir(): void {
  // Durante el cierre no se despacha ni se recrea el pool: los `exit` de `terminate()` llegan aquí
  // vía `alCaer` y sin este corte resucitarían el pool recién cerrado.
  if (cerrando) {
    return;
  }
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
    const temporizador = setTimeout(() => alExpirar(ranura), timeoutMs(trabajo.tipo));
    // No debe mantener vivo el proceso por sí solo (la petición HTTP en curso ya lo hace).
    temporizador.unref();
    ranura.temporizador = temporizador;
    const peticion: PeticionRenderPdf = {
      id: trabajo.id,
      clave: trabajo.clave,
      datos: trabajo.datos,
      ...(trabajo.logo === undefined ? {} : { logo: trabajo.logo }),
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

/** Una construcción excedió el tiempo límite: corta el worker (no se recupera un hilo bloqueado) y avisa. */
function alExpirar(ranura: Ranura): void {
  const trabajo = liberar(ranura);
  reemplazar(ranura);
  // El PDF remite al Excel "para el total"; el Excel ya ES ese total, así que solo pide acotar.
  const mensaje =
    trabajo?.tipo === 'excel'
      ? 'El Excel tardó demasiado en generarse (probablemente por demasiados renglones). ' +
        'Acota con filtros e inténtalo de nuevo.'
      : 'El PDF tardó demasiado en generarse (probablemente por demasiados renglones). ' +
        'Acota con filtros o usa el export a Excel para el total.';
  trabajo?.rechazar(new ErrorValidacion(mensaje));
  repartir();
}

/** Encola un trabajo y devuelve la promesa de su Buffer. */
function encolar(
  tipo: TipoDocumento,
  clave: ClavePdf | ClaveExcel,
  datos: unknown,
  logo?: string,
): Promise<Buffer> {
  return new Promise<Buffer>((resolver, rechazar) => {
    cola.push({ id: randomUUID(), clave, tipo, datos, logo, resolver, rechazar });
    // Un trabajo nuevo reabre el pool si venía de un cierre (reset de `cerrando` ANTES de repartir,
    // que crea el pool nuevo perezosamente).
    cerrando = false;
    repartir();
  });
}

/**
 * Renderiza un impreso PDF EN UN WORKER (fuera del event loop) y devuelve su Buffer. `datos` debe ser el
 * resultado YA resuelto de `armarDatos*` (serializable por structured clone: primitivos, arreglos,
 * objetos planos, `Date`; NO instancias como `Prisma.Decimal` — conviértelas a número/cadena al armar).
 * Lanza `ErrorValidacion` (400) si el render excede el timeout; propaga cualquier otro fallo del render.
 *
 * **Branding (post-F9, petición de Daniel):** aquí, y SOLO aquí, se resuelve el LOGO de la empresa y
 * se manda al worker, que lo fija antes de construir el documento (`fijarLogoImpresos`). Como los 23
 * impresos comparten `EncabezadoDocumento`, con esto quedan brandeados TODOS sin tocar ninguno.
 * La resolución es best-effort y con tope de tiempo (`comun/logo-empresa.ts`): si la BD o R2 fallan,
 * se manda el logo empaquetado y el PDF sale igual.
 *
 * @param opciones.idEmpresa **empresa activa de la sesión** (`sesion.idEmpresaActiva`). PÁSALA
 *   SIEMPRE: el membrete de TEXTO ya sale de `sesion.nombreEmpresaActiva`, así que omitirla haría
 *   que en multi-empresa (A9) un impreso lleve el nombre de una empresa y el logo de otra. Si se
 *   omite, el logo se resuelve con la empresa PREDETERMINADA (favorita / primera activa) — que es
 *   lo correcto solo cuando hay una sola empresa, y por eso es un respaldo, no el camino normal.
 */
export async function renderizarPdfEnWorker(
  clave: ClavePdf,
  datos: unknown,
  opciones?: { idEmpresa?: number },
): Promise<Buffer> {
  // El worker arranca EN PARALELO con la resolución del logo (que en frío levanta Prisma): en
  // serie, el primer impreso de cada proceso pagaba los dos costos uno detrás del otro.
  precalentarPool();
  const logo = await dataUrlLogoEmpresa(opciones?.idEmpresa);
  return encolar('pdf', clave, datos, logo);
}

/**
 * Construye un export a EXCEL EN UN WORKER (fuera del event loop) y devuelve su Buffer. Mismas reglas de
 * serialización que {@link renderizarPdfEnWorker}: `datos` es el resultado plano de `armarDatos*`. Lanza
 * `ErrorValidacion` (400) si excede el timeout de Excel; propaga cualquier otro fallo de la construcción.
 */
export function renderizarExcelEnWorker(clave: ClaveExcel, datos: unknown): Promise<Buffer> {
  return encolar('excel', clave, datos);
}

/** Termina el pool (para apagado ordenado o limpieza de tests). Se re-crea perezosamente si se vuelve a usar. */
export async function cerrarPoolPdf(): Promise<void> {
  // Marca el cierre ANTES de terminar: los `exit` de `terminate()` (código ≠ 0) pasan por `alCaer` →
  // `repartir`, que ahora corta en vez de recrear el pool. Un render posterior lo reabre (`encolar`).
  cerrando = true;
  const ranuras = pool;
  pool = null;
  if (ranuras !== null) {
    await Promise.all(ranuras.map((r) => r.worker.terminate()));
  }
}
