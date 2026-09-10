-- 0.114 — CORTE Y EMPAQUE: SERVICIOS SOBRE LA ORDEN, NO MAQUILAS DE IDA Y VUELTA.
--
-- Daniel (§Post-F9): *«En corte no necesitas mandar y recibir mercancía. Mando tela y corta una
-- cierta cantidad. Sólo hay que poner su cantidad y precio para meterlo en la OP, pero no va y
-- viene. Lo mismo el empaque… el empaque no toca el inventario. Y el corte es donde nace la
-- cantidad, pero no sale ni entra mercancía. Simplemente sucede y ya.»* Y la frontera del dinero:
-- *«Corte es parte de maquilas, no de proveedores. Tengo proveedores de corte que el monto a pagar
-- sale de una orden, lo mismo que un maquilero. Y una maquila de empaque también.»*
--
-- Traducido al modelo:
--  • el EMPAQUE nace como etapa del WIP (`tipo_etapa_movimiento.empaque`), hermana del corte:
--    `id_tipo_proceso = NULL` —esa NULL es la marca de "servicio sobre la orden"—, sin envío ni
--    recibo y sin tocar el kardex;
--  • el CARGO EsMa aprende a colgar de un SERVICIO en vez de un proceso de maquila, para que el
--    cortador y el empacador se paguen desde la orden igual que un maquilero.
--
-- ⚠️ NO se convirtió corte/empaque en `TipoProceso`: eso los metería al flujo envío→recibo que
-- Daniel dice que NO son.
--
-- Datos existentes (REGLA 0-B): esta migración NO toca ni una fila. Los cargos que ya existen
-- llevan proceso y `servicio` NULL, que es exactamente lo que el CHECK exige; no hay backfill.

-- CreateEnum: el servicio sobre la orden que puede originar un cargo (excluyente con el proceso).
CREATE TYPE "servicio_orden" AS ENUM ('corte', 'empaque');

-- AlterEnum: el EMPAQUE como etapa del WIP. Se APENDA al final (sin BEFORE), igual que lo declara
-- el schema, para que BD == schema y `prisma migrate diff` no reporte drift.
--
-- ⚠️ PostgreSQL: un valor nuevo de enum NO se puede USAR en la misma transacción en que se agrega
-- (y Prisma corre cada migración en UNA transacción). Aquí no se usa: no hay INSERT, ni DEFAULT, ni
-- CHECK que nombre 'empaque' — solo se declara. Por eso cabe en esta misma carpeta y no hace falta
-- partirla en dos (precedente: `20260710240000_rc_eventos_enums`).
ALTER TYPE "tipo_etapa_movimiento" ADD VALUE 'empaque';

-- AlterTable: el cargo EsMa cuelga de un proceso de maquila O de un servicio de la orden.
ALTER TABLE "esma_cargo" ADD COLUMN     "servicio" "servicio_orden",
ALTER COLUMN "id_tipo_proceso" DROP NOT NULL;

-- CHECK de EXCLUSIVIDAD: exactamente uno de (`id_tipo_proceso`, `servicio`) va lleno. Es la
-- defensa en profundidad de la invariante que el dominio ya respeta al crear el cargo: sin ella,
-- un cargo con los dos NULL quedaría sin etiqueta que mostrar en el estado de cuenta, y uno con
-- los dos llenos diría dos cosas distintas del mismo dinero.
-- `<>` sobre dos booleanos = XOR; ninguno de los dos operandos puede ser NULL (`IS NULL` siempre
-- devuelve true/false), así que el CHECK nunca se evalúa a NULL ni deja pasar filas por omisión.
ALTER TABLE "esma_cargo"
  ADD CONSTRAINT "esma_cargo_proceso_o_servicio"
  CHECK (("id_tipo_proceso" IS NULL) <> ("servicio" IS NULL));
