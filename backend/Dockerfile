# syntax=docker/dockerfile:1

# ───────────────────────────────────────────────────────────────────────────
# Etapa 1 — builder: instala TODAS las dependencias, genera el cliente Prisma
# y compila TypeScript a dist/.
# ───────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

# OpenSSL: lo necesita el motor de Prisma. Se instala en builder y runner.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Manifiestos + schema/config de Prisma PRIMERO: el `postinstall` (prisma generate)
# corre durante `npm ci` y necesita el schema. Aprovecha la cache de capas.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# Codigo fuente + configuracion de TypeScript, y compilamos a dist/.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ───────────────────────────────────────────────────────────────────────────
# Etapa 2 — runner: imagen que migra y sirve.
#
# Lleva el toolchain completo (node_modules con la CLI de Prisma y tsx) porque
# el contenedor, al arrancar, aplica `prisma migrate deploy` y opcionalmente el
# seed (ver docker-entrypoint.sh). El servidor en sí corre compilado (dist/).
# ───────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# node_modules (incluye prisma CLI + tsx para migrar/sembrar al arrancar),
# el build compilado, las fuentes (el seed corre con tsx sobre src/), el schema
# y migraciones, la config de Prisma y el entrypoint. Todo con dueño `node`.
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node package.json package-lock.json prisma.config.ts tsconfig.json ./
COPY --chown=node:node docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# node:22-slim ya trae el usuario "node" (uid 1000): no corremos como root.
USER node

# Fastify escucha en :: (dual-stack) dentro del contenedor — ver src/servidor.ts.
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
