-- F8-E5 · Negociación por versiones (R20b).
-- Blinda a nivel BD la invariante "un desarrollo vive en A LO MÁS UNA lista": reemplaza el índice
-- simple de E4 (`lista_precios_linea_id_desarrollo_idx`) por un UNIQUE global sobre `id_desarrollo`.
-- E4 ya lo enforzaba en dominio bajo `pg_advisory_xact_lock`; esto es defensa en profundidad.
-- Migración ADITIVA sin pérdida de datos (los datos existentes ya cumplen la unicidad).
DROP INDEX "lista_precios_linea_id_desarrollo_idx";

CREATE UNIQUE INDEX "lista_precios_linea_id_desarrollo_key" ON "lista_precios_linea"("id_desarrollo");
