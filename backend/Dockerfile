# syntax=docker/dockerfile:1

# ───────────────────────────────────────────────────────────────────────────
# Etapa 1 — builder: instala TODAS las dependencias y compila TypeScript.
# ───────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

# Copiamos manifiestos primero para aprovechar la cache de capas de Docker.
COPY package.json package-lock.json ./
RUN npm ci

# Codigo fuente + configuracion de TypeScript, y compilamos a dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ───────────────────────────────────────────────────────────────────────────
# Etapa 2 — deps: solo dependencias de produccion (imagen final mas liviana).
# ───────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ───────────────────────────────────────────────────────────────────────────
# Etapa 3 — runner: imagen minima que corre el servidor como usuario no root.
# ───────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# node:22-slim ya trae el usuario "node" (uid 1000). Lo usamos para no correr
# como root dentro del contenedor.
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

USER node

# Fastify escucha en :: (dual-stack) dentro del contenedor — ver src/servidor.ts.
EXPOSE 3000
CMD ["node", "dist/servidor.js"]
