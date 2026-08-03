/**
 * Capa de datos — punto de entrada al cliente Prisma de CONTROL v2.
 *
 * Expone:
 *  • `prisma`: cliente singleton para la app (patrón global para no fugar
 *    conexiones si el módulo se re-evalúa; PLANMAESTRO §3).
 *  • `crearClientePrisma(url)`: fábrica para procesos que apuntan a OTRA base
 *    (tests de integración con testcontainers, seed, tools). Encapsula el
 *    driver adapter de Prisma 7 (`@prisma/adapter-pg`) para que ningún
 *    consumidor dependa de él.
 *  • Re-exporta TODO lo generado (tipos de modelos, enums, namespace `Prisma` —
 *    incluye `Prisma.TransactionClient` y los errores `PrismaClientKnownRequestError`).
 *
 * El cliente generado vive en `./generated/prisma` (gitignoreado): se regenera
 * con `prisma generate` (postinstall + Dockerfile + antes de los tests).
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { type Prisma, PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';

/** Opciones de la fábrica del cliente Prisma (procesos fuera de la app). */
export interface OpcionesClientePrisma {
  /**
   * Opciones de transacción (maxWait/timeout/isolationLevel) para `$transaction`. Las usa
   * el ETL de migración contra una BD REMOTA (Railway): la latencia del proxy público hace
   * que los defaults de Prisma (maxWait 2s / timeout 5s) den `P2028` al arrancar la
   * transacción. NO afecta a la app (singleton {@link prisma}) ni a los tests, que crean el
   * cliente sin estas opciones.
   */
  transactionOptions?: Prisma.PrismaClientOptions['transactionOptions'];
  /**
   * Tamaño máximo del pool de conexiones del adapter `pg`. El ETL carga con concurrencia
   * acotada (ver `migracion/comun/lotes.ts`): el pool debe poder sostenerla, así que se sube
   * por encima del default (10) para que las tareas en vuelo no se serialicen esperando
   * conexión. Si se omite, se usa el default de `pg` (sin cambios para tests/seed/app).
   */
  poolMax?: number;
  /**
   * Opciones del POOL de `pg` para una conexión REMOTA estable (solo el ETL contra Railway).
   * El proxy público corta conexiones ociosas a media corrida de minutos; estas opciones hacen
   * el pool más resistente sin afectar a la app (singleton {@link prisma}) ni a los tests, que
   * no las pasan. Todas son OPCIONALES y aditivas (si se omiten, el pool de `pg` se comporta
   * como antes):
   *  • `keepAlive`: activa TCP keep-alive (evita que el proxy mate sockets ociosos).
   *  • `idleTimeoutMillis`: cuánto vive una conexión ociosa en el pool antes de cerrarse.
   *  • `connectionTimeoutMillis`: cuánto esperar a ABRIR una conexión nueva antes de fallar.
   *  • `statementTimeoutMillis`: tope del lado del SERVIDOR (`statement_timeout`): corta la
   *    sentencia colgada en vez de dejar que el proxy mate el socket.
   *  • `queryTimeoutMillis`: tope del lado del CLIENTE (`query_timeout` de `pg`): es el que
   *    evita el `SocketTimeout` seco del adaptador en una corrida larga contra Railway.
   */
  pool?: {
    keepAlive?: boolean;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    statementTimeoutMillis?: number;
    queryTimeoutMillis?: number;
  };
}

/**
 * Crea un cliente Prisma conectado a la URL indicada (driver adapter pg de Prisma 7).
 * Úsalo SOLO fuera de la app (tests, seed, migración F1-E6/F10); la app usa el singleton
 * {@link prisma}. `opciones.transactionOptions` (opcional) sube los tiempos de transacción
 * para tolerar latencia remota; `opciones.poolMax` sube el pool de `pg` para sostener la
 * concurrencia del ETL. Si se omiten, el cliente se comporta EXACTAMENTE como antes.
 */
export function crearClientePrisma(
  databaseUrl: string,
  opciones?: OpcionesClientePrisma,
): PrismaClient {
  // `PrismaPg` acepta un `pg.PoolConfig` (connectionString + max + opciones de pool). Cada
  // opción se incluye SOLO si vino, para no alterar el pool por defecto de tests/seed/app.
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    ...(opciones?.poolMax === undefined ? {} : { max: opciones.poolMax }),
    ...(opciones?.pool?.keepAlive === undefined ? {} : { keepAlive: opciones.pool.keepAlive }),
    ...(opciones?.pool?.idleTimeoutMillis === undefined
      ? {}
      : { idleTimeoutMillis: opciones.pool.idleTimeoutMillis }),
    ...(opciones?.pool?.connectionTimeoutMillis === undefined
      ? {}
      : { connectionTimeoutMillis: opciones.pool.connectionTimeoutMillis }),
    ...(opciones?.pool?.statementTimeoutMillis === undefined
      ? {}
      : { statement_timeout: opciones.pool.statementTimeoutMillis }),
    ...(opciones?.pool?.queryTimeoutMillis === undefined
      ? {}
      : { query_timeout: opciones.pool.queryTimeoutMillis }),
  });
  return new PrismaClient({
    adapter,
    ...(opciones?.transactionOptions ? { transactionOptions: opciones.transactionOptions } : {}),
  });
}

const globalParaPrisma = globalThis as unknown as { prismaControl?: PrismaClient };

/**
 * Cliente Prisma singleton de la aplicación. Lee `DATABASE_URL` del entorno;
 * la conexión es perezosa (se abre en el primer query), por lo que importar este
 * módulo sin la variable definida no truena hasta el primer uso.
 */
export const prisma: PrismaClient =
  globalParaPrisma.prismaControl ?? crearClientePrisma(process.env.DATABASE_URL ?? '');

if (process.env.NODE_ENV !== 'production') {
  globalParaPrisma.prismaControl = prisma;
}
