-- F9-E5 (D15d): los LÍMITES de antigüedad de saldos (aging) pasan de constantes 30/60 a
-- CONFIGURACIÓN por empresa. Migración ADITIVA: dos columnas NOT NULL con DEFAULT (30/60, el
-- valor histórico de `LIMITES_AGING_*`). Postgres rellena las filas ya sembradas con el DEFAULT
-- de la columna, así que no hace falta backfill aparte. CxP y CxC (bandejas) leen los límites de
-- aquí; el común `aging-comun.ts` los recibe como parámetro (solo cambia la FUENTE).
ALTER TABLE "configuraciones_empresa"
  ADD COLUMN "aging_limite1" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "aging_limite2" INTEGER NOT NULL DEFAULT 60;
