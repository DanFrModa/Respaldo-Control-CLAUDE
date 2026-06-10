# syntax=docker/dockerfile:1

# ───────────────────────────────────────────────────────────────────────────
# Etapa 1 — builder: instala dependencias y compila el SPA con Vite.
# ───────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ───────────────────────────────────────────────────────────────────────────
# Etapa 2 — nginx: sirve los estaticos y proxya /api al backend.
# ───────────────────────────────────────────────────────────────────────────
FROM nginx:alpine AS runner

# Configuracion del sitio (estaticos + reverse-proxy de /api).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Estaticos compilados.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
