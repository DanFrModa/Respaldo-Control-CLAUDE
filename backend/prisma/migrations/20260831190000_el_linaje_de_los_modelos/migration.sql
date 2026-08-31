-- ⭐⭐ V1-E9a (versión 0.069) — EL LINAJE DE LOS MODELOS 1:N (§Post-F9.135 + §Post-F9.167).
--
-- DANIEL: cuatro órdenes de compra del cliente para **cuatro colores del mismo modelo** producen
-- hoy 4 órdenes y **UN SOLO modelo de producción**. El objetivo del bloque es que nazcan **N
-- modelos** —uno por color, cada uno con su número de 5 dígitos— **compartiendo la receta** de su
-- modelo de desarrollo. Esta migración pone **el vínculo, y nada más**: el resolver que lee la
-- receta por él llega en la etapa siguiente (V1-E9b).
--
-- 🔴 POR QUÉ UNA COLUMNA NUEVA Y NO `id_modelo_padre` — la razón, medida (§Post-F9.167 punto 2).
-- `id_modelo_padre` es el linaje de las VERSIONES (`CYA-26-71-001` → `-01`), y son dos cosas
-- distintas: una versión nace EN DESARROLLO, se lleva una COPIA CONGELADA de la receta y **lleva su
-- propia revisión**; un hijo de producción nace **ya en producción**, **comparte** la receta del
-- padre y **no lleva revisión propia** (la firma que lo habilita es la del padre). Reusar la columna
-- haría que `esVersionDeModelo` diera `true` para cada hijo y la ficha lo enseñara como *«Revisión
-- pendiente · no puede mandarse a producir»* **sin ningún botón para arreglarlo**, sobre un modelo
-- que YA está en producción: la cicatriz de §Post-F9.119 otra vez.
-- ⚠️ Y la razón que daba el plan («el hijo bloquearía su propia promoción») era FALSA: el hijo nunca
-- se promueve, nace promovido. Se deja escrito porque el mecanismo es lo que alguien va a verificar.
--
-- Migración **100 % ADITIVA**: una columna anulable, su índice, su llave foránea y dos CHECK.
-- **SIN BACKFILL** (REGLA 0-B, §Post-F9.163) y eso es DECISIÓN, no omisión: `NULL` significa «la
-- receta es la mía», que es exactamente la conducta de hoy para los ~4,987 modelos migrados del
-- Access y para todo lo capturado a mano. Inventarles un padre sería mentir.
--
-- **SIN permisos nuevos** (`modelos.administrar` ya gobierna el alta de modelos) y **SIN seed** ⇒
-- este deploy **NO requiere `SEED_ON_START`**.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna del linaje
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "modelos" ADD COLUMN "id_modelo_desarrollo" INTEGER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índice
-- ─────────────────────────────────────────────────────────────────────────────
-- "Dame los modelos de producción de este desarrollo" sin recorrer la tabla — y, sobre todo, es por
-- donde entrará el resolver de la receta compartida (V1-E9b), que se pregunta en CADA lectura de
-- receta. Un índice sobre una columna casi toda NULL es barato: Postgres no indexa los NULL de un
-- B-tree simple más allá de su entrada, y aquí las filas con valor son exactamente las que se buscan.
CREATE INDEX "modelos_id_modelo_desarrollo_idx" ON "modelos"("id_modelo_desarrollo");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Llave foránea (auto-relación, la SEGUNDA de esta tabla) — RESTRICT
-- ─────────────────────────────────────────────────────────────────────────────
-- RESTRICT y no CASCADE, por la misma razón que la del linaje de versiones: un desarrollo que ya
-- tiene hijos de producción NO se borra físico (se descontinúa, borrado suave, D3). Un CASCADE se
-- llevaría por delante modelos que ya se produjeron, con órdenes e inventario colgando.
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_id_modelo_desarrollo_fkey"
  FOREIGN KEY ("id_modelo_desarrollo") REFERENCES "modelos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Las dos invariantes que la BASE vigila sola
-- ─────────────────────────────────────────────────────────────────────────────
-- (a) Un modelo no puede ser su propio padre de receta. La FK no lo impide (la fila se referencia a
--     sí misma y la FK queda satisfecha), y con el resolver `id_modelo_desarrollo ?? id` de V1-E9b
--     un auto-vínculo sería invisible: leería su propia receta y nadie notaría el dato roto.
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_linaje_desarrollo_no_es_si_mismo_check"
  CHECK ("id_modelo_desarrollo" IS DISTINCT FROM "id");

-- (b) Sólo un modelo de PRODUCCIÓN puede llevar el vínculo. Esto **no es adorno: es la mitad de lo
--     que hace imposibles las CADENAS** (A → B → C). La otra mitad vive en el dominio, y hay que
--     decirlo con precisión porque de esto depende que alguien no escriba la columna por otro
--     camino creyéndose cubierto:
--
--      • el único escritor (`derivarModeloDeProduccion`) exige que el PADRE sea de DESARROLLO;
--      • este CHECK garantiza que un modelo de desarrollo NUNCA lleve la columna;
--      • luego un hijo —que es de producción, y por lo tanto lleva la columna— jamás puede ser padre
--        de otro, y la profundidad máxima del linaje es 1.
--
--     🔴 **Esa profundidad la garantizan las DOS COSAS JUNTAS: este CHECK *más* la guarda del único
--     escritor — NO la base ella sola.** Un CHECK no puede mirar OTRA fila, así que "el padre es de
--     desarrollo" no se puede exigir aquí: la cadena A(desarrollo) → B(producción, hijo de A) →
--     C(producción, hijo de B) **satisface los dos CHECK sin problema**. Quien escriba
--     `id_modelo_desarrollo` por otra puerta (un ETL, SQL crudo, una función nueva) tiene que
--     comprobar él mismo que el padre es de DESARROLLO: la base NO se lo va a atajar.
ALTER TABLE "modelos" ADD CONSTRAINT "modelos_linaje_desarrollo_solo_produccion_check"
  CHECK ("id_modelo_desarrollo" IS NULL OR "origen" = 'produccion');
