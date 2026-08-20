-- V1-E3m — EL PROVEEDOR DEL MATERIAL (§Post-F9.82)
--
-- Daniel (20-ago-2026), atorado en Compras › Explosión de materiales con la receta ya liberada:
-- *"no me deja hacer nada… ahí veo todo, pero no puedo avanzar"*. El botón de generar OC solo se
-- enciende con renglones que traigan proveedor sugerido, y NINGUNO lo traía.
--
-- El diagnóstico NO fue "falta una función": fue una DESVIACIÓN. La regla de las telas ya vivía en
-- el modelo de datos —`telas.id_proveedor`, el proveedor DUEÑO del artículo (§Post-F9.11: *"la felpa
-- de Alsatex y la de otro proveedor son telas DISTINTAS"*)— y el motor de compras la ignoraba: desde
-- F8 resolvía por `tela_proveedor` (el amarre de Desarrollo, pensado para material que se compra a
-- varios) y, sin amarre, se rendía. Le pedía a Daniel capturar un proveedor que la tela YA tenía.
--
-- Esta migración pone las TRES piezas de datos que faltaban. El motor (dominio/compras) es el que
-- cambia de verdad; aquí solo se abren las columnas.
--
--   1. `avio_proveedor.habitual` — ⭐ EL PROVEEDOR HABITUAL DEL AVÍO. Daniel: *"tener avíos sin
--      proveedor asignado está generando más problemas que beneficios"*. Se invierte el default de
--      F4: la explosión deja de proponer **el más barato** como regla general y propone **al que se
--      le compra siempre**; el más barato queda de FALLBACK (no-regresión) para el avío sin
--      habitual. La bandera vive en el PAR avío–proveedor —no como FK suelta en `avios`— porque así
--      el habitual es, por construcción, uno de los que de verdad surten el avío, y trae consigo su
--      `precio` y su `factor_conversion`. El riesgo del otro lado (dos habituales) lo cierra la
--      BASE con un índice único PARCIAL, no la buena voluntad del dominio.
--
--   2. `orden_tela.id_proveedor_compra` / `orden_avio.id_proveedor_compra` (+ su `precio_compra`) —
--      ⭐ EL COMPRADOR DESATORA DESDE SU PANTALLA, SOLO PARA ESA OP. Daniel, textual: *"el comprador
--      asigna un proveedor **para esa OP en particular**… no para siempre ni para todo. El proveedor
--      puede seguir viniendo desde desarrollo"*. Por eso la asignación vive en la RECETA CONGELADA
--      de la orden y **jamás toca el catálogo**: una compra de urgencia no se vuelve permanente sin
--      que nadie lo decida. Y por eso es el ÚLTIMO escalón de la resolución (debajo de Desarrollo y
--      del catálogo): **no puede pisar a Desarrollo**, la autoridad queda intacta por construcción,
--      no por convención.
--
-- BACKFILL, y solo UNO, el que no decide nada: el avío que tiene **un solo** proveedor ACTIVO queda
-- con ése marcado como habitual. No hay elección que hacer —es el único— y es exactamente lo que la
-- pantalla hace al agregar el primero. A cambio, el avío de un solo proveedor SIN precio deja de
-- caer en el agujero que Daniel encontró: hasta hoy el "más barato" lo ignoraba (solo mira los que
-- tienen precio) y el renglón salía SIN proveedor. Los avíos con varios proveedores NO se tocan:
-- ahí sí hay una decisión de negocio y la toma una persona, no una migración.
--
-- Las columnas de la asignación de Compras nacen vacías y significan exactamente eso ("Compras no
-- ha asignado nada"). El comportamiento del día del deploy es el de hoy MÁS la resolución por dueño
-- de tela, que sale de un dato que ya estaba capturado.
--
-- SIN permisos nuevos: asignar/quitar el proveedor de una orden reusa `compras.administrar` (el
-- mismo que genera las OC) y marcar el habitual reusa `avios.administrar` (el del catálogo de avíos). El seed
-- no siembra nada nuevo → este deploy NO exige `SEED_ON_START`.

-- ── 1. El proveedor HABITUAL del avío ────────────────────────────────────────
ALTER TABLE "avio_proveedor" ADD COLUMN "habitual" BOOLEAN NOT NULL DEFAULT false;

-- UNO por avío, garantizado por la base (índice único PARCIAL: solo mira las filas marcadas).
CREATE UNIQUE INDEX "avio_proveedor_habitual_unico" ON "avio_proveedor"("id_avio") WHERE "habitual";

-- ── 2. La asignación de COMPRAS, por orden ───────────────────────────────────
ALTER TABLE "orden_tela" ADD COLUMN "id_proveedor_compra" INTEGER;
ALTER TABLE "orden_tela" ADD COLUMN "precio_compra" DECIMAL(12,4);
CREATE INDEX "orden_tela_id_proveedor_compra_idx" ON "orden_tela"("id_proveedor_compra");
ALTER TABLE "orden_tela"
  ADD CONSTRAINT "orden_tela_id_proveedor_compra_fkey"
  FOREIGN KEY ("id_proveedor_compra") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orden_avio" ADD COLUMN "id_proveedor_compra" INTEGER;
ALTER TABLE "orden_avio" ADD COLUMN "precio_compra" DECIMAL(12,4);
CREATE INDEX "orden_avio_id_proveedor_compra_idx" ON "orden_avio"("id_proveedor_compra");
ALTER TABLE "orden_avio"
  ADD CONSTRAINT "orden_avio_id_proveedor_compra_fkey"
  FOREIGN KEY ("id_proveedor_compra") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. BACKFILL del habitual OBVIO: el avío con un ÚNICO proveedor ACTIVO ────
-- Por construcción marca como máximo UNA fila por avío, así que nunca choca con el índice de arriba.
--
-- ⚠️ **Y SOLO SI ESE PROVEEDOR ESTÁ ACTIVO.** Sin el `EXISTS` de abajo, un avío cuyo único
-- `avio_proveedor` apunta a un proveedor DADO DE BAJA quedaría marcado como habitual, y el efecto
-- sería el atorón de Daniel devuelto del revés: hoy ese renglón sale SIN proveedor (el "más barato"
-- de F4 sí filtra activos) y el comprador lo desatora; marcado, saldría **comprable con un proveedor
-- muerto** —`candidatoHabitualAvio` conserva al inactivo a propósito, y `crearOC` no valida
-- `activo`— y encima la pantalla NO ofrecería reasignarlo. En una migración que nadie va a deshacer.
--
-- Es, además, el MISMO criterio que el dominio ya aplica en `proveedor-de-orden.ts`: un proveedor
-- desactivado no se puede ASIGNAR, porque asignar es *"una elección que se está tomando AHORA, no
-- una heredada que ya estaba tomada"*. **Un backfill es exactamente una elección que se toma ahora.**
-- (Lo HEREDADO —el habitual que marcó una persona y cuyo proveedor se dio de baja después— sí se
-- conserva, con aviso, y desde V1-E3m la explosión deja reasignarlo desde la pantalla del comprador.)
UPDATE "avio_proveedor" ap
   SET "habitual" = true,
       "modificado_en" = CURRENT_TIMESTAMP
 WHERE (SELECT COUNT(*) FROM "avio_proveedor" otros WHERE otros."id_avio" = ap."id_avio") = 1
   AND EXISTS (SELECT 1 FROM "proveedores" p WHERE p."id" = ap."id_proveedor" AND p."activo");
