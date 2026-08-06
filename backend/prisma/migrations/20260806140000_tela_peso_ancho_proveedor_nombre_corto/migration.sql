-- Remates del catálogo de telas, etapa A1.1 (feedback textual de Daniel, 6-ago-2026).
--
-- (1) `peso` (gr/m²) y `ancho` (metros) en la tela — "Me faltó incluir un campo de peso y otro
--     de ancho". Informativos y NULLABLE: las telas existentes (y las migradas) no los traen.
-- (2) `nombre_corto` en el proveedor ("Bloom" para BLOOM TEXTIL): display para armar el nombre
--     compuesto de la tela (nombre corto del proveedor + nombre que él le da). SIN unicidad.
--
-- Todo aditivo y nullable: cero impacto en filas existentes. (`tipo_componente` y
-- `para_produccion` quedan como LEGADO en la base — la UI dejó de capturarlos en A1.1, pero
-- NO se borran columnas.)

ALTER TABLE "telas"
    ADD COLUMN "peso" DECIMAL(8,2),
    ADD COLUMN "ancho" DECIMAL(8,2);

ALTER TABLE "proveedores" ADD COLUMN "nombre_corto" TEXT;
