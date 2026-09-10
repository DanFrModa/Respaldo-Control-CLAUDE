-- ⭐ V1-E8z (versión 0.067) — EL CANDADO DE COMPRA (§Post-F9.160(a) + §Post-F9.165).
--
-- DANIEL: *«pongamos un candado que **no se pueda comprar nada hasta que esté cerrado otra vez**»*.
-- Una receta de OP ya liberada se puede volver a ABRIR para corregirla, y **mientras está abierta la
-- compra de esa orden queda congelada**; se desbloquea al CERRARLA.
--
-- 🔴 POR QUÉ HACE FALTA UNA COLUMNA NUEVA — y no es "faltaba dónde guardar la fecha".
-- `ordenes.receta_liberada_en` PARECE el candado y NO lo es: desde V1-E3h es un DERIVADO ("no queda
-- ningún renglón vivo sin firmar") y **la puerta de compra dejó de consultarlo** (pregunta renglón
-- por renglón, `exigirRecetaLiberada`). Además ese derivado ya se cae solo a NULL al desfirmar
-- cualquier renglón. Quien lo usara para "reabrir" entregaría esto: la pantalla diría *«receta no
-- liberada»* y **la orden de compra saldría igual**. El dato que ya existe no gobierna la compra.
--
-- Migración **ADITIVA**: tres columnas anulables en `ordenes`, sin default y **SIN BACKFILL**
-- (REGLA 0-B, §Post-F9.163). NULL = «la receta no está abierta», que es exactamente la conducta de
-- hoy para toda orden existente: nada que reparar, nada que rellenar.
--
-- **SIN permisos nuevos** (`desarrollo.administrar` ya es la llave de firmar y de toda mutación de
-- receta; abrir y cerrar son actos del mismo dueño) y **SIN seed** ⇒ este deploy **NO requiere
-- `SEED_ON_START`**.
--
-- Sin índice a propósito: la única consulta que filtra por `receta_abierta_en` es la bandeja
-- «Recetas por liberar», cuyo costo lo domina el UNION de las tres tablas de renglones, y un índice
-- sobre una columna casi toda NULL no cambiaría ese plan.

ALTER TABLE "ordenes" ADD COLUMN "receta_abierta_en" TIMESTAMP(3);
ALTER TABLE "ordenes" ADD COLUMN "receta_abierta_por_id" TEXT;
ALTER TABLE "ordenes" ADD COLUMN "receta_abierta_motivo" TEXT;
