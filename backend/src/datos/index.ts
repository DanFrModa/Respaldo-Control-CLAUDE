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

import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';

/**
 * Crea un cliente Prisma conectado a la URL indicada (driver adapter pg de Prisma 7).
 * Úsalo SOLO fuera de la app (tests, seed, migración F8); la app usa el singleton {@link prisma}.
 */
export function crearClientePrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
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
