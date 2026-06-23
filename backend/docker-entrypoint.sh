#!/bin/sh
# Arranque del backend en contenedor (F0 / E2).
#
# Antes de servir, deja la base lista de forma IDEMPOTENTE:
#   1. `prisma migrate deploy` — aplica las migraciones pendientes (no-op si ya están).
#   2. Seed opcional (SEED_ON_START=true) — siembra FR Moda + permisos + roles + admin
#      (idempotente: upserts). Útil en local/prueba; en producción se controla por env.
#
# ARRANQUE RESILIENTE A LA BD: en Railway el backend conecta a Postgres por la red privada
# interna (`postgres.railway.internal`), que tarda unos segundos en levantar al arrancar el
# contenedor (y Postgres puede estar reiniciando). Por eso `migrate deploy` y el seed se
# REINTENTAN con espera en vez de morir al primer fallo de conexión: el propio `migrate deploy`
# sirve de prueba de conectividad. Tras agotar los reintentos, el script SÍ aborta con código ≠ 0
# (preservamos la intención del `set -e` original: no servir contra una base inalcanzable o sin
# migrar; solo toleramos la indisponibilidad TRANSITORIA del arranque, no fallos persistentes).
#
# Reintentos configurables por env: DB_WAIT_MAX_INTENTOS (default 30) y DB_WAIT_ESPERA_SEG
# (default 3) → ~90 s de margen.
set -e

# Cuántos intentos como máximo y cuántos segundos espera entre intentos.
DB_WAIT_MAX_INTENTOS="${DB_WAIT_MAX_INTENTOS:-30}"
DB_WAIT_ESPERA_SEG="${DB_WAIT_ESPERA_SEG:-3}"

# Ejecuta un comando reintentando hasta que tenga éxito o se agoten los intentos.
# Uso: reintentar "<etiqueta para los logs>" <comando> [args...]
# OJO: el comando se corre dentro de un `if`, así que su fallo NO dispara `set -e` (eso nos
# deja testear el resultado y reintentar). Si se agotan los intentos, retorna 1 y el llamador
# aborta el script.
reintentar() {
  etiqueta="$1"
  shift
  intento=1
  while [ "$intento" -le "$DB_WAIT_MAX_INTENTOS" ]; do
    if "$@"; then
      return 0
    fi
    if [ "$intento" -lt "$DB_WAIT_MAX_INTENTOS" ]; then
      echo "[entrypoint] ${etiqueta} (intento ${intento}/${DB_WAIT_MAX_INTENTOS}); reintento en ${DB_WAIT_ESPERA_SEG}s (BD aún no lista)..."
      sleep "$DB_WAIT_ESPERA_SEG"
    fi
    intento=$((intento + 1))
  done
  echo "[entrypoint] ${etiqueta}: agotados ${DB_WAIT_MAX_INTENTOS} intentos; la BD sigue inalcanzable. Abortando."
  return 1
}

echo "[entrypoint] Aplicando migraciones (prisma migrate deploy)..."
reintentar "Migraciones aún no aplicadas" npx prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Sembrando datos de fundación (idempotente)..."
  reintentar "Seed aún no aplicado" npx prisma db seed
fi

echo "[entrypoint] Iniciando el servidor..."
exec node dist/servidor.js
