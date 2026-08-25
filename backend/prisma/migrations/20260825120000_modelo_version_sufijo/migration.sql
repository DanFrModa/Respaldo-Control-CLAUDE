-- V1-E7b · La versión de un modelo nace con SUFIJO (§Post-F9.110, decisión de Daniel).
--
-- Migración 100 % ADITIVA: dos columnas nuevas en `modelos`, su índice y su llave foránea.
-- No toca ni una fila existente, no borra nada y no cambia ningún default.
--
-- El QUÉ: cuando la negociación cambia la receta de un modelo, el modelo original NO se edita —
-- nace uno NUEVO con sufijo de versión (`CYA-26-71-001` → `CYA-26-71-001-01`) que hereda la receta
-- completa, y el original queda intacto porque lo ya producido con la receta vieja conserva su
-- verdad (D3). El sufijo se LEE en el código, pero un texto no se consulta: por eso el linaje se
-- guarda además como DATO en estas dos columnas.
--
--  1. `modelos.id_modelo_padre`     — de qué modelo salió esta versión (auto-relación, Restrict).
--  2. `modelos.version_desarrollo`  — el número del sufijo (1, 2, 3…); NULL = modelo raíz.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-2. Columnas del linaje
-- ─────────────────────────────────────────────────────────────────────────────
-- Las dos nacen NULL para TODO lo que ya existe (los 4,987 migrados del Access y los capturados a
-- mano): ninguno nació de otro modelo, así que todos son raíz. Sin backfill a propósito.
ALTER TABLE "modelos" ADD COLUMN "id_modelo_padre" INTEGER;
ALTER TABLE "modelos" ADD COLUMN "version_desarrollo" INTEGER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Índice del linaje
-- ─────────────────────────────────────────────────────────────────────────────
-- "Dame las versiones de este modelo" sin recorrer la tabla entera (y lo usa el minteo del
-- siguiente sufijo, que lee la familia bajo lock).
CREATE INDEX "modelos_id_modelo_padre_idx" ON "modelos"("id_modelo_padre");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Llave foránea (auto-relación) — RESTRICT
-- ─────────────────────────────────────────────────────────────────────────────
-- RESTRICT y no CASCADE: un modelo que ya tiene versiones NO se borra físico (se descontinúa,
-- borrado suave). Borrar el padre en cascada se llevaría por delante versiones que pudieron
-- producirse, que es justo lo que esta decisión vino a evitar.
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_modelo_padre_fkey"
  FOREIGN KEY ("id_modelo_padre") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
