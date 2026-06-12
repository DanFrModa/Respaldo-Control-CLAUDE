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

# Configuracion del sitio como PLANTILLA: la imagen oficial corre envsubst sobre
# /etc/nginx/templates/*.template al arrancar y escribe el resultado en
# /etc/nginx/conf.d/ (quitando .template). Al llamarla default.conf.template se
# genera /etc/nginx/conf.d/default.conf, sustituyendo el default de la imagen.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Resolver DNS para nginx (directiva `resolver` de la plantilla). Se decide en el
# arranque con esta prioridad: variable DNS_RESOLVER del entorno > autodeteccion de
# /etc/resolv.conf > 127.0.0.11. Dos piezas:
#  1. NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 activa el script oficial 15-local-resolvers.envsh,
#     que llena ${NGINX_LOCAL_RESOLVERS} leyendo /etc/resolv.conf (corchetes para IPv6).
#  2. 16-resolver-default.envsh (abajo) corre despues y fija DNS_RESOLVER = el del entorno,
#     o el autodetectado si no se dio. Asi:
#       - docker-compose: sin tocar nada -> 127.0.0.11 (autodetectado).
#       - Railway: se pone DNS_RESOLVER=[fd12::10] (resolver interno fijo de la red privada),
#         garantizado, sin depender de lo que traiga /etc/resolv.conf.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY docker-entrypoint.d/16-resolver-default.envsh /docker-entrypoint.d/16-resolver-default.envsh
RUN chmod +x /docker-entrypoint.d/16-resolver-default.envsh

# Upstream del backend, configurable por entorno (portabilidad: el MISMO artefacto
# sirve en docker-compose y en Railway sin tocar codigo).
#  - docker-compose: backend:3000 (nombre del servicio en la red del compose).
#  - Railway:        se sobrescribe con BACKEND_UPSTREAM=backend.railway.internal:3000.
ENV BACKEND_UPSTREAM=backend:3000
# Limita envsubst a NUESTRAS variables: asi NO toca las propias de nginx ($host,
# $uri, $request_uri, $backend_upstream, ...). Es un regex sobre NOMBRES de env.
ENV NGINX_ENVSUBST_FILTER=^(BACKEND_UPSTREAM|DNS_RESOLVER|PORT)$

# Estaticos compilados.
COPY --from=builder /app/dist /usr/share/nginx/html

ENV PORT=80
EXPOSE 80
# El ENTRYPOINT de la imagen oficial procesa las plantillas (envsubst) y luego
# arranca nginx; mantenemos su CMD por defecto.
CMD ["nginx", "-g", "daemon off;"]
