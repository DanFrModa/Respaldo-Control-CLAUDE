// Configuración de la CLI de Prisma 7 (reemplaza a `package.json#prisma` para
// migraciones/seed; el `schema` también se declara en package.json para que
// `prisma generate` lo encuentre desde cualquier directorio).
//
// Prisma 7 ya NO carga .env automáticamente: se carga aquí con dotenv para que
// `prisma migrate`/`prisma db seed` tomen DATABASE_URL en desarrollo local.
import 'dotenv/config';

import { defineConfig } from 'prisma/config';

// `prisma generate` no necesita conexión (solo lee el schema), pero Prisma 7
// evalúa el datasource al cargar este config: si `DATABASE_URL` falta —como en
// `postinstall`, el build de Docker o CI antes de tener una BD— `env()` aborta.
// Por eso se lee con un placeholder inofensivo: las operaciones que SÍ tocan la
// base (`migrate`/`db seed`) reciben siempre la `DATABASE_URL` real por entorno.
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `prisma db seed` — el seed es idempotente (upserts), se puede correr N veces.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: DATABASE_URL,
  },
});
