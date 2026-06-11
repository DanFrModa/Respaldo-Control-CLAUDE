# syntax=docker/dockerfile:1

# ───────────────────────────────────────────────────────────────────────────
# Etapa 1 — builder: instala dependencias y compila el SPA con Vite.
# ───────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Solo lo que el build de produccion necesita (autonomo: NO alcanza ../backend).
# El cliente del API ya esta generado y versionado en src/api/esquema.gen.ts, asi
# que el build no depende del contrato del backend en tiempo de construccion.
# tsconfig.build.json hereda de tsconfig.app.json y excluye las pruebas (la imagen
# no trae tooling de tests).
COPY tsconfig.app.json tsconfig.build.json vite.config.ts index.html ./
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
