/**
 * AJUSTE DE RENDIMIENTO del ETL contra la BD REMOTA (Railway por el proxy público).
 *
 * La corrida real desde la Mac de Gabriel (31-jul-2026) midió el cuello: **latencia por viaje
 * redondo, NO CPU**. El seed cargó ~1,300 renglones en 9m20s ≈ **0.43 s/renglón**, y
 * `etl-catalogos` murió a los 45m47s con `DriverAdapterError: SocketTimeout` justo en Colores
 * (5,664 textos × 0.43 s ≈ 40 min). Con trabajo latency-bound la salida es **más tareas en
 * vuelo** (no más CPU) + un pool y timeouts que aguanten una corrida de minutos.
 *
 * Todo es CONFIGURABLE POR ENTORNO para que Gabriel pueda subirlo sin recompilar:
 *
 *  • `ETL_CONCURRENCIA` (default **12**, tope duro **64**): tareas simultáneas de `enLotes`.
 *    Antes 8. El default es CONSERVADOR a propósito: (a) el pool del ETL convive con el de la
 *    app desplegada y con pg-boss contra el `max_connections` de Railway, y un
 *    `sorry, too many clients already` tumbaría la corrida; (b) en los loaders con folio, más
 *    de ~12 en vuelo se serializan igual en la fila `Secuencia` (23 esperando de 24 no ayuda).
 *    Si la corrida va holgada, Gabriel puede subirla; si truena por conexiones, bajarla.
 *  • `ETL_POOL_MAX` (default **`ETL_CONCURRENCIA` + 4**): conexiones del pool de `pg`. DEBE ser
 *    ≥ concurrencia o las tareas se serializan esperando conexión (el default lo garantiza).
 *  • `ETL_STATEMENT_TIMEOUT_MS` (default **120000**): corta una sentencia colgada del lado del
 *    servidor en vez de dejar morir el socket.
 *  • `ETL_QUERY_TIMEOUT_MS` (default **120000**): el equivalente del lado del cliente (`pg`).
 *    Es el que evita el `SocketTimeout` seco del adaptador en un lote largo.
 *  • `ETL_TX_TIMEOUT_MS` (default **120000**) y `ETL_TX_MAXWAIT_MS` (default **20000**):
 *    tiempos de `$transaction` (los defaults de Prisma —2s/5s— dan `P2028` con esta latencia).
 *
 * ⚠️ Subir la concurrencia NO cambia la atomicidad ni el orden de dependencias: `enLotes` solo
 * se usa donde las filas son INDEPENDIENTES, cada unidad sigue en SU transacción (A2), y los
 * loaders con estado compartido orden-dependiente (fusión de terceros) siguen secuenciales.
 */
import type { OpcionesClientePrisma } from '../../src/datos/index.js';

/** Lee un entero positivo del entorno; valor inválido/ausente → `porDefecto`. */
function enteroEnv(clave: string, porDefecto: number): number {
  const crudo = (process.env[clave] ?? '').trim();
  if (crudo === '') return porDefecto;
  const n = Number(crudo);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

/** Tope duro de concurrencia: un dedazo (`ETL_CONCURRENCIA=500`) no debe reventar el servidor. */
const MAX_CONCURRENCIA = 64;

/** Tareas simultáneas de `enLotes` en los loaders (env `ETL_CONCURRENCIA`, default 12, tope 64). */
export function concurrenciaEtl(): number {
  return Math.min(enteroEnv('ETL_CONCURRENCIA', 12), MAX_CONCURRENCIA);
}

/**
 * Opciones del cliente Prisma para TODOS los ETL (pool + timeouts + transacciones), derivadas
 * de la concurrencia efectiva. Un solo lugar: si Gabriel sube `ETL_CONCURRENCIA`, el pool sube
 * con ella y ningún script se queda corto.
 */
export function opcionesClienteEtl(): OpcionesClientePrisma {
  const concurrencia = concurrenciaEtl();
  return {
    transactionOptions: {
      maxWait: enteroEnv('ETL_TX_MAXWAIT_MS', 20_000),
      timeout: enteroEnv('ETL_TX_TIMEOUT_MS', 120_000),
    },
    poolMax: enteroEnv('ETL_POOL_MAX', concurrencia + 4),
    pool: {
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 30_000,
      // Anti-`SocketTimeout`: el proxy público de Railway corta sockets que tardan; estos dos
      // topes hacen que una sentencia lenta falle con un error CLARO (y reintentable) en vez
      // de matar la conexión a media corrida.
      statementTimeoutMillis: enteroEnv('ETL_STATEMENT_TIMEOUT_MS', 120_000),
      queryTimeoutMillis: enteroEnv('ETL_QUERY_TIMEOUT_MS', 120_000),
    },
  };
}

/** Texto para el banner de los ETL: qué ajuste de rendimiento quedó activo. */
export function describirAjusteEtl(): string {
  const o = opcionesClienteEtl();
  return (
    `Rendimiento ETL: concurrencia=${String(concurrenciaEtl())} poolMax=${String(o.poolMax)} ` +
    `queryTimeout=${String(o.pool?.queryTimeoutMillis)}ms (configurable con ETL_CONCURRENCIA/ETL_POOL_MAX/…)`
  );
}
