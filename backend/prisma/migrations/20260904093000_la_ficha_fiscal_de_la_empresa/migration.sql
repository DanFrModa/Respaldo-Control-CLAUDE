-- ⭐ LA FICHA FISCAL DE LA EMPRESA — la mitad que faltaba del DOCUMENTO PARA FACTURAR (fila 0.118).
--
-- Daniel (§Post-F9.186(k)): *«Nadie me factura si no le mando yo un documento con los datos con los
-- que me tiene que facturar… no al revés. Y eso debe salir del sistema.»*
--
-- Para que ese documento se pueda emitir hacen falta los datos fiscales de LOS DOS LADOS:
--   • el EMISOR (el proveedor que nos va a facturar) ya los tenía completos desde F1-E1B/R15
--     (`proveedores.rfc`, `regimen_fiscal_sat`, `uso_cfdi_habitual`, `codigo_postal_expedicion`);
--   • el RECEPTOR (esta empresa) sólo tenía `razon_social` y `rfc`. Le faltaban los dos datos que un
--     CFDI 4.0 exige del receptor: su RÉGIMEN FISCAL y el CÓDIGO POSTAL de su DOMICILIO FISCAL.
--
-- Esta migración agrega esos dos, y nada más.
--
-- 🔑 POR QUÉ NULLABLE Y SIN BACKFILL (REGLA 0-B): lo que falta se TOLERA, no se compensa. Ninguna
-- empresa ya capturada los trae, y NO se inventan: mientras estén vacíos el documento simplemente
-- **no se emite** y la pantalla dice qué falta y de quién (que es justo lo que Daniel pidió para el
-- proveedor sin RFC). Se capturan en Administración › Empresas.
--
-- 🔑 POR QUÉ `codigo_postal_fiscal` Y NO `codigo_postal_expedicion`: no son el mismo concepto. El
-- del proveedor es el LUGAR DE EXPEDICIÓN del comprobante (dato del emisor); éste es el DOMICILIO
-- FISCAL del receptor. Reusar el nombre habría invitado a copiar uno en el otro.
--
-- Aditiva pura: dos columnas nullable. No toca datos, no reescribe nada, no hay marcha atrás que dar.

ALTER TABLE "empresas"
  ADD COLUMN "regimen_fiscal_sat"   TEXT,
  ADD COLUMN "codigo_postal_fiscal" TEXT;
