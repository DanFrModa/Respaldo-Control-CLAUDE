-- Importador de OC por PDF (petición Daniel), 2 columnas ADITIVAS:
--  • ordenes.packs_cliente (jsonb): desglose SKU/packs del cliente TAL COMO viene en la OC (informativo
--    hoy; base del futuro módulo de EMPAQUE). Se escribe en la misma tx del alta de la OP.
--  • orden_linea.pantone (text): código PANTONE por color de la orden (antes en observaciones; ahora
--    campo propio, opcional, prefilleado por el importador cuando la OC lo trae).
-- Ambas nullable, sin backfill: las órdenes existentes quedan en NULL (sin packs / sin pantone).

ALTER TABLE "ordenes" ADD COLUMN "packs_cliente" JSONB;

ALTER TABLE "orden_linea" ADD COLUMN "pantone" TEXT;
