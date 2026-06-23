-- F5-E6 · RUTA CRÍTICA — Auto-avance por eventos de dominio (Módulo 8 — doc
-- `Documentacion_MJD/08-Ruta-Critica.md` §4; DECISIONES.md §F5 (d)/(e)/(f); A2/A7). Migración
-- ADITIVA: una sola columna nueva, NOT NULL con DEFAULT (segura sobre la BD de `prueba`, que ya
-- tiene renglones `ruta_orden` por el ETL/uso de E3+: el DEFAULT rellena las filas existentes).
--
--   • ruta_orden.parcial_en_curso — MARCA "parcial en curso" (decisión (d)): el auto-avance la
--     enciende cuando un evento (recibo de maquila, recepción de tela, entrega…) cubre SOLO una
--     parte de la cantidad pedida color×talla y la apaga al completarse o des-completarse. El
--     proceso solo pasa a `completado` cuando llega la cantidad COMPLETA. Default false (lo SEGURO:
--     un proceso recién generado no tiene parcial en curso).
--
-- SIN seed, SIN permisos nuevos, SIN tablas nuevas: el auto-avance reusa la cola de eventos
-- (`eventos_outbox` + pg-boss, ADR-0011) y el motor de jobs (ADR-0012) ya existentes. La idempotencia
-- del consumidor sale de la RE-EVALUACIÓN pura del estado físico (suma de etapas vivas vs lo pedido),
-- por eso NO hace falta persistir el id del evento de origen.

-- AlterTable
ALTER TABLE "ruta_orden" ADD COLUMN     "parcial_en_curso" BOOLEAN NOT NULL DEFAULT false;
