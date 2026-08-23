-- La entrada de tela conserva la FACTURA para poder generar la cuenta por pagar al confirmarla
-- (§Post-F9.21; Daniel: *"que la información la tomes del XML para las dos cosas"*).
--
--  • `total_cfdi`: el TOTAL del comprobante (la verdad fiscal, CON impuestos). El cargo de CxP entra
--    por este importe, NO por la suma de los renglones (que es cantidad×precio, sin IVA).
--  • `id_archivo_cfdi`: el XML guardado en R2, el mismo del que se leyeron los datos. Respalda el
--    cargo fiscal igual que una importación de CFDI de F9. SET NULL para no perder el cargo si
--    algún día se borra el archivo.
--
-- Migración ADITIVA: las dos columnas son nullable (las entradas capturadas a mano, y todas las que
-- ya existen, las dejan en NULL y no generan CxP).

-- AlterTable
ALTER TABLE "entradas_tela" ADD COLUMN     "id_archivo_cfdi" TEXT,
ADD COLUMN     "total_cfdi" DECIMAL(14,2);

-- AddForeignKey
ALTER TABLE "entradas_tela" ADD CONSTRAINT "entradas_tela_id_archivo_cfdi_fkey" FOREIGN KEY ("id_archivo_cfdi") REFERENCES "archivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
