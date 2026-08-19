-- V1-E3h — LA RECETA SE LIBERA POR PARTES (§Post-F9.72)
--
-- Daniel (19-ago-2026), recorriendo el flujo con una orden real: *"podría haber algún cierre que aún
-- no autoriza el cliente, pero ya podríamos ir comprando lo demás"*. Hasta hoy la firma de Desarrollo
-- era UNA SOLA para toda la receta (`ordenes.receta_liberada_en`) y la puerta de compra era
-- todo-o-nada: un avío pendiente detenía la compra de la tela.
--
-- Qué hace esta migración, en orden:
--   1. Baja la firma AL RENGLÓN: `liberado_en` + `liberado_por_id` en `orden_tela`, `orden_avio` y
--      `orden_arte`, con su índice (la bandeja «Recetas por liberar» y la puerta preguntan
--      justamente por los NULL).
--   2. BACKFILL: toda orden con `receta_liberada_en` NO NULA deja **todos** sus renglones firmados
--      con ESA MISMA fecha y ESE MISMO autor. Nadie se despierta con la puerta cerrada el día del
--      deploy: lo que ayer se podía comprar, hoy se sigue pudiendo comprar.
--
-- ⭐ DECISIÓN SOBRE `ordenes.receta_liberada_en`: **SE CONSERVA, como DERIVADO** — pasa a significar
--    *"todo lo vivo de esta receta está liberado"*, y lo mantiene el DOMINIO
--    (`sincronizarLiberacionOrden` en `dominio/produccion/receta-orden.ts`), nunca la UI ni una
--    vista. Se conserva y no se retira porque **no es la puerta de compra**: es lo que leen el
--    semáforo de "orden completa" (`requisitos-orden.ts` — requisito `receta`) y el detalle de la
--    orden, donde la pregunta correcta sigue siendo "¿la receta está completa?". Retirarla habría
--    obligado a re-derivar ese semáforo con un `NOT EXISTS` por orden en todas sus consultas —
--    incluida la de recálculo masivo— a cambio de nada. La PUERTA DE COMPRA, en cambio, ya NO la
--    consulta: pregunta renglón por renglón.
--
-- SIN permisos nuevos: la bandeja y las acciones nuevas reusan `desarrollo.ver`/`desarrollo.administrar`
-- (y `compras.ver` para leer lo pendiente en la explosión). El seed no siembra nada nuevo → este
-- deploy NO exige `SEED_ON_START`.

-- ── 1. La firma, por renglón ─────────────────────────────────────────────────
ALTER TABLE "orden_tela" ADD COLUMN "liberado_en" TIMESTAMP(3);
ALTER TABLE "orden_tela" ADD COLUMN "liberado_por_id" TEXT;
CREATE INDEX "orden_tela_liberado_en_idx" ON "orden_tela"("liberado_en");

ALTER TABLE "orden_avio" ADD COLUMN "liberado_en" TIMESTAMP(3);
ALTER TABLE "orden_avio" ADD COLUMN "liberado_por_id" TEXT;
CREATE INDEX "orden_avio_liberado_en_idx" ON "orden_avio"("liberado_en");

ALTER TABLE "orden_arte" ADD COLUMN "liberado_en" TIMESTAMP(3);
ALTER TABLE "orden_arte" ADD COLUMN "liberado_por_id" TEXT;
CREATE INDEX "orden_arte_liberado_en_idx" ON "orden_arte"("liberado_en");

-- ── 2. BACKFILL: lo que ya estaba liberado, sigue liberado ───────────────────
-- Se firman TODOS los renglones (incluidos los `excluido`): la lápida no se compra de todos modos,
-- y dejarla sin firma haría que la orden nunca pudiera volver a leerse como "todo liberado".
-- `modificado_en` no tiene DEFAULT en la base (Prisma lo escribe con @updatedAt): se fija a mano.
UPDATE "orden_tela" t
   SET "liberado_en"     = o."receta_liberada_en",
       "liberado_por_id" = o."receta_liberada_por_id",
       "modificado_en"   = CURRENT_TIMESTAMP
  FROM "ordenes" o
 WHERE o."id" = t."id_orden"
   AND o."receta_liberada_en" IS NOT NULL;

UPDATE "orden_avio" a
   SET "liberado_en"     = o."receta_liberada_en",
       "liberado_por_id" = o."receta_liberada_por_id",
       "modificado_en"   = CURRENT_TIMESTAMP
  FROM "ordenes" o
 WHERE o."id" = a."id_orden"
   AND o."receta_liberada_en" IS NOT NULL;

UPDATE "orden_arte" r
   SET "liberado_en"     = o."receta_liberada_en",
       "liberado_por_id" = o."receta_liberada_por_id",
       "modificado_en"   = CURRENT_TIMESTAMP
  FROM "ordenes" o
 WHERE o."id" = r."id_orden"
   AND o."receta_liberada_en" IS NOT NULL;
