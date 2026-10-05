-- ⭐⭐ FILA 0.252 — LA FACTURA DEL MAQUILERO SE CONTABA COMO DEUDA DOS VECES.
--
-- Daniel (5-oct-2026): *«Se valida la recepción en EsMa. Ahí se sube a su estado de cuenta lo que
-- debemos de pagar. Y de ahí confirmamos con él los montos para que haga su factura.»* ⇒ la deuda
-- con un maquilero NACE en EsMa (el recibo validado). Su CFDI, cuando llega, NO es deuda nueva: es
-- el COMPROBANTE fiscal de esa misma deuda. Hasta hoy el importador de CFDI lo registraba como un
-- cargo más del motor de terceros y el saldo del maquilero salía al DOBLE (11,600 → 23,200), y la
-- corrida —que al maquilero le paga en EsMa— nunca bajaba ese cargo del motor.
--
-- `ampara_esma = true` marca el movimiento del motor que AMPARA deuda que vive en EsMa: se ve en el
-- estado de cuenta y en el listado del contador (sigue siendo un CFDI real), pero NO suma a ningún
-- saldo, aging ni días vencidos. Lo decide el dominio AL IMPORTAR (`terceros/ampara-esma.ts`) y se
-- GUARDA: si mañana cambian los roles del proveedor, el pasado no cambia de significado.
--
-- ADITIVA. Las filas existentes quedan en `false` por el DEFAULT, sin backfill (REGLA 0-B: los
-- datos de `prueba` se limpian, no se reparan). SIN permisos nuevos y SIN semillas.

-- AlterTable
ALTER TABLE "movimientos_tercero" ADD COLUMN     "ampara_esma" BOOLEAN NOT NULL DEFAULT false;
