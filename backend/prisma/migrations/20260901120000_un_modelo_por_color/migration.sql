-- ⭐⭐ V1-E3 — UN MODELO DE PRODUCCIÓN POR (DESARROLLO, COLOR) (§Post-F9.172(b)).
--
-- V1-E9a puso el LINAJE (`id_modelo_desarrollo`) y V1-E9b el resolver que lee la receta por él.
-- Faltaba la otra mitad de la identidad del hijo: **de qué COLOR es**. Sin ella, la salida a
-- producción no podía contestar la única pregunta que decide si estrena número o reusa uno:
-- *«¿este desarrollo ya tiene un modelo para este color?»*.
--
-- 🔴 DANIEL (§Post-F9.172(b)): ***«se reúsa cuando sea el mismo modelo»*** ⇒ el número de 5 dígitos
-- **es del MODELO, no de la OP**. La llave se pudo poner en dos sitios y sólo uno cumple esa frase:
--
--   (A) llave = RENGLÓN de pedido  → reusa el resurtido de la misma OC, pero una **OC nueva** del
--       mismo color **estrena otro número** ⇒ la misma prenda con DOS números de catálogo.
--   (B) llave = DESARROLLO + COLOR → reusa el resurtido **y** cualquier OC posterior de ese color
--       ⇒ **un número por prenda real**. Es la que se construye aquí.
--
-- ⚠️ El color es IDENTIDAD, no operación: lo que se produce lo sigue mandando la OP (`orden_linea`,
-- decisión de Daniel *«el color va en la OP»*). Nadie lee `modelos.id_color` para decidir qué
-- cortar; sólo dice de qué color es este modelo del CATÁLOGO.
--
-- Migración **100 % ADITIVA**: una columna anulable, dos índices, una llave foránea y un CHECK.
-- **SIN BACKFILL** (REGLA 0-B, §Post-F9.163): `NULL` no es un dato que falte, es la respuesta
-- correcta para todo lo que no nació por color (los ~4,987 migrados del Access, lo capturado a mano
-- y los propios modelos de desarrollo). Inventarles un color sería mentir.
--
-- **SIN permisos nuevos** y **SIN seed** ⇒ este deploy **NO requiere `SEED_ON_START`**.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna del color de nacimiento
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "modelos" ADD COLUMN "id_color" INTEGER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Llave foránea hacia el catálogo de colores — RESTRICT
-- ─────────────────────────────────────────────────────────────────────────────
-- RESTRICT por el mismo criterio que el resto del repo: un color que ya bautizó modelos no se borra
-- físico (se desactiva, D3). ⚠️ Y hay una segunda guarda que la base NO puede dar: la FUSIÓN de
-- colores (`fusionarColores`) **desactiva** el origen sin borrarlo, así que la FK no la ataja. Por
-- eso `REFERENCIAS_QUE_BLOQUEAN_FUSION` lleva esta relación: absorber un color por debajo dejaría a
-- la llave única sin poder reconocer el color de la próxima OC y estrenaría un número para una
-- prenda que ya lo tiene. El guardián `colores-fusion-referencias.test.ts` lee este esquema y se
-- pone rojo si alguien agrega una FK a `colores` y se olvida de la lista.
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_color_fkey"
  FOREIGN KEY ("id_color") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Índice de la FK (lo que la fusión pregunta: "¿este color tiene modelos?")
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX "modelos_id_color_idx" ON "modelos"("id_color");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ⭐⭐ LA LLAVE: un modelo de producción por (desarrollo, color)
-- ─────────────────────────────────────────────────────────────────────────────
-- Es la llave de negocio de (B) **y, de paso, la llave de IDEMPOTENCIA que nunca existió**. Hasta
-- hoy el freno del doble clic era un EFECTO DE BORDE: la primera salida dejaba el modelo en
-- `produccion`, así que la segunda ya no promovía. Con el linaje, el desarrollo **se queda en
-- desarrollo para siempre** ⇒ sin esta llave cada clic derivaría un hijo más, quemando números de
-- una serie que sólo tiene **999 por par** (concepto+género).
--
-- ⚠️ **Postgres trata los NULL como DISTINTOS en un índice único** (`NULLS DISTINCT`, el default), y
-- de eso dependen dos cosas a la vez:
--   • los ~4,987 modelos migrados llevan las DOS columnas en `NULL` y conviven sin chocar — sin esa
--     semántica esta migración no podría ni aplicarse sobre los datos de hoy;
--   • y por lo mismo la llave **NO** ata a los hijos MULTICOLOR (`id_color IS NULL`, matriz de
--     varios colores del importador por Excel). A ésos los serializa el advisory lock del dominio
--     (`obtenerODerivarModeloDeProduccion`), que es quien decide el reuso; esto es la red.
CREATE UNIQUE INDEX "modelos_linaje_color_unico" ON "modelos"("id_modelo_desarrollo", "id_color");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La invariante que la base vigila sola: el color es de los HIJOS
-- ─────────────────────────────────────────────────────────────────────────────
-- Sólo un modelo del linaje 1:N puede llevar color de nacimiento. Un modelo de desarrollo, uno
-- migrado o uno capturado a mano no nacieron "de un color" y no tienen por qué llevarlo; si se les
-- colara por otra puerta, la llave única de arriba empezaría a significar otra cosa (dos modelos
-- sueltos del mismo color chocarían entre sí en la pareja `(NULL, color)`).
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_color_solo_con_linaje_check"
  CHECK ("id_color" IS NULL OR "id_modelo_desarrollo" IS NOT NULL);
