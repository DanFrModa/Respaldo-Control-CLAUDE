-- ⭐ EL PACK, COMO CAMPO PROPIO (§Post-F9.10 — decisión de Daniel del 6-ago-2026, «adelante» el 2-sep).
--
-- 🔴 DANIEL, textual: *«Me gusta que exista **un solo Negro** y no esté fragmentado en miles de
-- colores escritos de diferente manera.»*
--
-- C&A pide VARIOS TENDIDOS en una misma OP: el pack A con corrida 1-2-2-1 (CH-M-G-EG), el pack B con
-- 1-1-1-2. Hasta hoy eso se resolvía metiendo la letra DENTRO del nombre del color («Negro A»,
-- «Negro B»), fabricando un color de catálogo por pack. La primera mitad ya se hizo (V1-E8g /
-- §Post-F9.129: el importador de PDF dejó de componer el color con la letra). Ésta es la segunda:
-- **el pack como CAMPO PROPIO que viaja con la pieza.**
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- HASTA DÓNDE VIAJA — la especificación es textual de Daniel
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--   • Matriz de la OP      → OBLIGATORIO cuando la orden trae packs (renglón = color × pack)
--   • Corte                → OBLIGATORIO (cada tendido es de un pack)
--   • Entrega a maquila    → OBLIGATORIO
--   • Recibo de maquila    → ⭐ OPCIONAL: *«que sea opcional al recibir»* (el maquilero pudo
--                            devolverlos separados o revueltos)
--   • Arte · entrega a cliente · inventario PT → NO APLICA (ahí ya es sólo color)
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 🔑 POR QUÉ `text NOT NULL DEFAULT ''` Y NO `text NULL` — es la decisión de modelado, no un capricho
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `orden_linea` tenía `UNIQUE (id_orden, id_color)`: **un renglón por color**. Al meter el pack, esa
-- llave tiene que crecer a `(id_orden, id_color, pack)`. Si `pack` fuera NULLABLE, Postgres trataría
-- como DISTINTOS dos `(1, 5, NULL)` (NULLs are distinct, el default del estándar) y la unicidad
-- **desaparecería justo para el caso normal** — el de todas las órdenes sin packs. Se debilitaría una
-- garantía que existe hoy, a cambio de nada.
--
-- La salida limpia sería `UNIQUE NULLS NOT DISTINCT` (Postgres 15+), pero **Prisma 7.8 no la sabe
-- expresar** (`@@unique(..., nullsNotDistinct: true)` → «No such argument», verificado con
-- `prisma validate`), así que quedaría fuera del esquema y el `migrate diff` marcaría drift para
-- siempre. Con `''` la unicidad sigue siendo REAL, el esquema declara la verdad, y de paso las claves
-- de agregación del dominio (`color:talla:pack`) no tienen que arbitrar entre NULL, undefined y `''`.
--
-- 🔴 Y REGLA 0-B, que es lo que hace que esto sea barato: el DEFAULT lo resuelve todo. Los renglones
-- y celdas que ya existen quedan con `''` = «sin pack» y se comportan **exactamente igual que hoy**.
-- NO hay backfill, ni script de reparación, ni migración de los colores «NEGRO A»/«NEGRO B» ya
-- capturados: *«lo viejo se tira, no se arregla»* (§Post-F9.132). Fusionar esos colores es requisito
-- del ETL de Access del arranque (§Post-F9.133), no de aquí.

-- ── 1) La matriz de la OP: el renglón pasa a ser COLOR × PACK ───────────────────────────────────
ALTER TABLE "orden_linea" ADD COLUMN "pack" TEXT NOT NULL DEFAULT '';

DROP INDEX "orden_linea_id_orden_id_color_key";

CREATE UNIQUE INDEX "orden_linea_id_orden_id_color_pack_key" ON "orden_linea"("id_orden", "id_color", "pack");

-- ── 2) El WIP: la celda del corte / entrega / recibo lleva su pack ──────────────────────────────
-- En un RECIBO el `''` significa además «el maquilero los devolvió revueltos», y ese recibo consume
-- del saldo AGREGADO de todos los packs (la guarda vive en `dominio/produccion/recibos.ts`).
ALTER TABLE "etapa_movimiento_det" ADD COLUMN "pack" TEXT NOT NULL DEFAULT '';

DROP INDEX "etapa_movimiento_det_id_etapa_mov_id_color_id_talla_key";

CREATE UNIQUE INDEX "etapa_movimiento_det_id_etapa_mov_id_color_id_talla_pack_key" ON "etapa_movimiento_det"("id_etapa_mov", "id_color", "id_talla", "pack");
