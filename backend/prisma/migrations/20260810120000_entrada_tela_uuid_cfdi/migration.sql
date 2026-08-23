-- La entrada de tela recuerda de QUÉ FACTURA (CFDI) se leyeron sus datos (§Post-F9.20; Daniel:
-- *"está perfecto que la información la tomes del XML para las dos cosas, y el PDF que se suba solo
-- como referencia para poder consultar siempre la factura"*).
--
-- Migración ADITIVA: la columna es nullable (las entradas capturadas a mano, y todas las que ya
-- existen, la dejan en NULL). El UNIQUE es POR EMPRESA e ignora los NULL (Postgres no compara nulos
-- entre sí), así que solo impide capturar DOS VECES la misma factura — que es de lo que protege.

-- AlterTable
ALTER TABLE "entradas_tela" ADD COLUMN     "uuid_cfdi" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "entradas_tela_id_empresa_uuid_cfdi_key" ON "entradas_tela"("id_empresa", "uuid_cfdi");
