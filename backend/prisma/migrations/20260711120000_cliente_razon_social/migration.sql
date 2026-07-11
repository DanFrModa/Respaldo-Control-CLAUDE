-- Rediseño de altas (lote 1): razón social del CLIENTE.
--  • `razon_social`: nombre legal del cliente para la factura si difiere del comercial. Espejo EXACTO
--    de `proveedores.razon_social` (F1-E1B) y `empresas.razon_social`. Se usará al conciliar el
--    RECEPTOR de un CFDI de VENTA (F9).
-- Migración ADITIVA: columna nullable, sin backfill (los clientes existentes quedan sin razón social
-- hasta que se capture).

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "razon_social" TEXT;
