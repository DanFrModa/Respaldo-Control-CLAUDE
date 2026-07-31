-- F9-E3 (R11): RFC fiscal de la empresa. Se usa para validar que el RECEPTOR de un CFDI de
-- proveedor importado sea esta empresa (A9), y como EMISOR en los CFDI de ventas (F9-E4).
-- Migración ADITIVA: columna nullable, sin backfill (las empresas existentes quedan con RFC vacío
-- hasta que se capture; la validación del receptor entonces solo AVISA, no rechaza).

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "rfc" TEXT;
