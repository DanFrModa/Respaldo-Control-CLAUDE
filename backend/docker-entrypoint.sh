#!/bin/sh
# Arranque del backend en contenedor (F0 / E2).
#
# Antes de servir, deja la base lista de forma IDEMPOTENTE:
#   1. `prisma migrate deploy` — aplica las migraciones pendientes (no-op si ya están).
#   2. Seed opcional (SEED_ON_START=true) — siembra FR Moda + permisos + roles + admin
#      (idempotente: upserts). Útil en local/prueba; en producción se controla por env.
#
# Cualquier fallo aquí aborta el arranque (set -e): preferimos no servir a servir
# contra una base sin migrar.
set -e

echo "[entrypoint] Aplicando migraciones (prisma migrate deploy)..."
npx prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Sembrando datos de fundación (idempotente)..."
  npx prisma db seed
fi

echo "[entrypoint] Iniciando el servidor..."
exec node dist/servidor.js
