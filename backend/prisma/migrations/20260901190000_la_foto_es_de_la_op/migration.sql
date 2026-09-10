-- ⭐ «LA FOTO ES DE LA OP» — quitar de UNA orden una foto HEREDADA del modelo (§Post-F9.169(b)).
--
-- 🔴 DANIEL, textual: *«La foto debería de ser **de la OP no del desarrollo**. Si el desarrollo tiene
-- fotos está bien que podamos **heredarlas**, pero también la opción de **quitarlas de la OP** y
-- meter fotos directo a la OP. **Eso me parece que ya existe.»*
--
-- Y tenía razón: heredar, subir a la OP y quitar lo subido YA existían (F2-E3 + ajuste de jul-2026,
-- `frontend/src/modulos/ordenes/FotosModeloOrden.tsx`). Lo único que faltaba era la media frase:
-- **quitar de la OP una foto que viene del modelo**. Eso es todo lo que agrega esta migración.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 🔴 OCULTAR NO ES BORRAR (D3) — y aquí no es un matiz, es TODO el diseño
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- La foto del modelo **no se toca**: ni se borra, ni se desmarca como principal, ni sale de la
-- galería del modelo, ni se pierde para las demás órdenes. Lo único que nace es una MARCA por
-- *(orden, foto)*. Otra orden del mismo modelo la sigue viendo, porque la marca es de ESA orden.
--
-- ⚠️ **Y NUNCA TOCA R2.** Esta tabla no guarda archivos ni los referencia: apunta a `modelo_foto`,
-- que es el puente. Ocultar y volver a mostrar son un INSERT y un DELETE de una fila de 4 columnas;
-- el objeto de Cloudflare sigue exactamente donde estaba, intacto, para el modelo y para todos.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ POR QUÉ UNA TABLA Y NO UNA BANDERA `excluido`, que es como esta casa hace lo mismo con el ARTE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `OrdenArte.excluido` (V1-E3d/E3f) resuelve exactamente este problema… porque allá la orden
-- CONGELA una copia del renglón del modelo: `OrdenArte` nace de `ModeloArte`, así que la orden ya
-- tiene una fila propia donde cabe la bandera.
--
-- Con las fotos NO hay tal fila, y es a propósito: las fotos viven en R2 y **el repo no clona
-- objetos de R2 por orden**. Lo dice el propio `OrdenArte`: *"La foto NO se copia (vive en el
-- modelo, y R2 no se clona desde SQL): la traza `idModeloArte` la alcanza mientras exista"*. Copiar
-- `modelo_foto` a la orden sólo para poder apagar una fila duplicaría el catálogo de imágenes de
-- todas las órdenes para escribir un booleano en unas pocas.
--
-- Así que es el MISMO concepto —lápida reversible, decisión de la orden, el modelo intacto— en la
-- única forma que admite un dato que no se copia: **la marca por ausencia/presencia**. Sin fila = se
-- ve (que es como se comporta el 100 % de lo ya capturado); con fila = esta orden no la enseña.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Lo que esta migración NO hace
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- • **SIN BACKFILL** (REGLA 0-B, §Post-F9.163): la tabla nace VACÍA y eso es la respuesta correcta
--   para todo lo anterior — nadie había podido ocultar nada, así que no hay nada que ocultar.
--   Una orden sin filas aquí se comporta EXACTAMENTE como hoy.
-- • **SIN permisos nuevos**: reusa `ordenes.ver` (leer) y `ordenes.administrar` (ocultar/mostrar),
--   los mismos que ya gobiernan subir y quitar fotos de la orden ⇒ este deploy **NO requiere**
--   `SEED_ON_START`.
-- • 100 % ADITIVA: una tabla nueva, dos índices, una llave única y dos FKs. No toca ni una fila
--   existente, no cambia ningún default y no restringe nada de lo que hoy se puede hacer.
--
-- ⚠️ Las DOS FKs son CASCADE, y la segunda va contra la costumbre de la casa (RESTRICT para
-- catálogos en uso) a propósito: **esconder una foto en una orden no puede secuestrar el catálogo
-- del modelo**. Si el dueño del modelo borra la foto, la marca que la escondía se va con ella —
-- nunca al revés. La reversibilidad no vale a costa de bloquear al que sí es dueño del dato.

-- CreateTable
CREATE TABLE "orden_foto_oculta" (
    "id" SERIAL NOT NULL,
    "id_orden" INTEGER NOT NULL,
    "id_modelo_foto" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "orden_foto_oculta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_foto_oculta_id_orden_idx" ON "orden_foto_oculta"("id_orden");

-- CreateIndex
CREATE INDEX "orden_foto_oculta_id_modelo_foto_idx" ON "orden_foto_oculta"("id_modelo_foto");

-- CreateIndex
-- LA LLAVE: una orden oculta una foto UNA vez. Es lo que vuelve idempotente el «ocultar» (dos clics
-- no dejan dos lápidas) sin que el dominio tenga que leer antes de escribir bajo carrera.
CREATE UNIQUE INDEX "orden_foto_oculta_id_orden_id_modelo_foto_key" ON "orden_foto_oculta"("id_orden", "id_modelo_foto");

-- AddForeignKey
ALTER TABLE "orden_foto_oculta" ADD CONSTRAINT "orden_foto_oculta_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_foto_oculta" ADD CONSTRAINT "orden_foto_oculta_id_modelo_foto_fkey" FOREIGN KEY ("id_modelo_foto") REFERENCES "modelo_foto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
