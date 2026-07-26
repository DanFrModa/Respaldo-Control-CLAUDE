-- ORDEN del arte dentro del modelo (post-F9, petición de Daniel 25-jul-2026:
-- "debe de haber una foto principal del modelo… y la primera del arte también").
--
-- El arte PRINCIPAL de un modelo es simplemente el PRIMERO de su BOM. Las fotos ya tenían
-- `modelo_foto.orden`, así que ahí no hace falta columna nueva; el puente `modelo_bordado`
-- (PK compuesta modelo+bordado, solo `precio`) no tenía ninguna noción de orden y por eso
-- se agrega esta columna. NO se agrega una bandera "es principal": el orden es la ÚNICA
-- fuente de verdad (una bandera podría contradecirlo). Marcar principal = mover el renglón
-- a la posición 0 y reindexar los demás, en una transacción (dominio `marcarBordadoPrincipal`).
--
-- Aditiva y con default 0: los modelos existentes quedan todos en 0 y siguen listándose por
-- nombre (el desempate de la lectura), exactamente como hasta hoy. Sin backfill, sin permisos
-- nuevos, sin re-seed.

-- AlterTable
ALTER TABLE "modelo_bordado" ADD COLUMN     "orden" INTEGER NOT NULL DEFAULT 0;
