-- F9-E4 (R12): datos fiscales/comerciales del CLIENTE para CxC.
--  • `rfc`: RFC fiscal del cliente. Se usa para conciliar el RECEPTOR de un CFDI de VENTA importado
--    con el cliente al que se le carga (espejo del `rfc` del proveedor de F1-E1B / de la empresa de E3).
--  • `dias_credito`: días de crédito del cliente = base del aging de CxC (fecha de la venta + días de
--    crédito = vencimiento). NULL o 0 = contado. Espejo de `proveedores.dias_credito` de CxP.
-- Migración ADITIVA: ambas columnas nullable, sin backfill (los clientes existentes quedan sin RFC y
-- sin días de crédito hasta que se capturen; el cliente sin días de crédito se trata como contado).

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "dias_credito" INTEGER,
ADD COLUMN     "rfc" TEXT;
