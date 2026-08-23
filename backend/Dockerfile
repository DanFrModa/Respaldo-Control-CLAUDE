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

# openssl: lo necesita el motor de Prisma.
#
# postgresql-client-17: lo necesita el SEGUNDO RESPALDO cifrado a R2 (V1-E6a) — `pg_dump` para
# volcar la base cada mes y `pg_restore`/`psql` para el script de restauración
# (`scripts/restaurar-respaldo.ts`). NO viene en node:22-slim, así que sin esto el respaldo
# fallaría en cada corrida.
#
# ⚠️ POR QUÉ LA 17 Y NO LA DEL REPO DE DEBIAN (que es la 15): **pg_dump se NIEGA a volcar un
# servidor MÁS NUEVO que él**. El Postgres de Railway es 17, así que un cliente 15 o 16 no falla a
# medias: no dumpea nada. Por eso se agrega el repositorio oficial de PostgreSQL (PGDG), que es de
# donde salen los clientes por major. **Si algún día se sube la major del servidor en Railway, hay
# que subir este número también** — el job lo detecta y lo dice con todas sus letras en el rastro de
# la corrida (`comun/respaldo/pg-dump.ts`), pero para entonces ya se habrán perdido corridas.
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl ca-certificates \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*

# ⚠️ SE APUNTA AL BINARIO REAL, NO AL WRAPPER — y esto NO sobra (viene del CI rojo del PR #184).
#
# `/usr/bin/pg_dump` no es el ejecutable: es un WRAPPER de `postgresql-client-common` que elige la
# versión según el clúster/versión por defecto del sistema. En el runner de CI, con la 16
# preinstalada y la 17 recién puesta, el wrapper se quedaba con la 16 y el ensayo de restauración
# reventaba con "pg_dump 16.14 es más viejo que el servidor 17.11".
#
# Hoy, en ESTA imagen, el wrapper acertaría: `node:22-slim` no trae ningún cliente, así que la 17 es
# la única instalada. Se fija de todos modos porque el día que la imagen base traiga otro cliente el
# respaldo empezaría a fallar por esta misma trampa, y **en producción no hay CI que la cace**: sólo
# el rastro de una corrida MENSUAL. En el peor caso se descubriría el día que haya que restaurar.
# Una línea apaga ese riesgo; en una etapa cuyo requisito rector es "que no falle en silencio",
# dejarlo dormido sería incoherente.
#
# `RESPALDO_PG_DUMP` ya existe en el dominio (`comun/respaldo/config.ts`): si algún día cambia la
# major, hay que mover ESTA ruta junto con el `postgresql-client-NN` de arriba.
ENV RESPALDO_PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump

# node_modules (incluye prisma CLI + tsx para migrar/sembrar al arrancar),
# el build compilado, las fuentes (el seed corre con tsx sobre src/), el schema
# y migraciones, la config de Prisma y el entrypoint. Todo con dueño `node`.
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/prisma ./prisma
# scripts/: el de RESTAURACIÓN del respaldo (V1-E6a) tiene que existir DENTRO de la imagen, porque
# es donde ya están el cliente de PostgreSQL 17 y las credenciales R2 del ambiente. Sin esto, el
# comentario de arriba prometía una herramienta que el contenedor no tenía.
# ⚠️ Ojo: si el escenario del desastre es "Railway ya no está", este contenedor tampoco está — para
# ESE caso hay que correr el script desde un checkout del repo con cliente PostgreSQL ≥ 17. Lo dicen
# las dos vías en la cabecera de scripts/restaurar-respaldo.ts.
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node package.json package-lock.json prisma.config.ts tsconfig.json ./
COPY --chown=node:node docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# node:22-slim ya trae el usuario "node" (uid 1000): no corremos como root.
USER node

# Fastify escucha en :: (dual-stack) dentro del contenedor — ver src/servidor.ts.
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
