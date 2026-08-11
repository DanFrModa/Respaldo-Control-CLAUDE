-- El cargo de CxP que nace de una entrada de tela debe llevar el RFC del proveedor, igual que el
-- que nace importando el mismo CFDI desde Finanzas (§Post-F9.21 + §Post-F9.22).
--
-- POR QUÉ: el reporte fiscal del contador imprime `rfc_tercero`; sin esta columna, la MISMA factura
-- se veía distinta según por dónde hubiera entrado (con RFC si la capturó Finanzas, con "—" si entró
-- por el almacén de telas). El dato ya estaba en el XML al sellarlo: solo faltaba conservarlo.
--
-- Y SIRVE PARA UNA SEGUNDA COSA: re-validar el sello cuando se EDITA el borrador —¿el proveedor que
-- quedó capturado sigue siendo el que facturó?— sin tener que bajar el XML de R2 otra vez.
--
-- Migración ADITIVA y nullable: las entradas sin CFDI (y las ya capturadas) la dejan en NULL.

-- AlterTable
ALTER TABLE "entradas_tela" ADD COLUMN     "rfc_cfdi" TEXT;
