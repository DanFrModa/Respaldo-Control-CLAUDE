-- F9-E4 (R12): nuevo ORIGEN `factura_cliente` para el CARGO de CxC por venta (CFDI de venta o cargo
-- manual al cliente). Es un CARGO (+): aumenta lo que el cliente nos debe (el signo lo pone el dominio
-- `signoDeOrigen`, no un CHECK — el enum se puede extender sin migrar el CHECK del motor de F9-E1).
--
-- Migración SOLA (solo este DDL): en PostgreSQL `ALTER TYPE ... ADD VALUE` no puede convivir en la
-- misma transacción con otro DDL que use el valor nuevo, así que el ADD VALUE va en su propia migración,
-- separado de las columnas de Cliente (que viven en la migración `f9_e4_cliente_fiscal`).
--
-- `BEFORE 'nota_credito'`: posiciona el valor nuevo en el MISMO lugar en que el schema lo declara
-- (entre `entrada_sin_factura` y `nota_credito`), para que el orden del enum en BD == orden del schema
-- y `migrate diff` no reporte drift a futuro (sin BEFORE, ADD VALUE lo apendaría AL FINAL del type).

-- AlterEnum
ALTER TYPE "origen_movimiento_tercero" ADD VALUE 'factura_cliente' BEFORE 'nota_credito';
