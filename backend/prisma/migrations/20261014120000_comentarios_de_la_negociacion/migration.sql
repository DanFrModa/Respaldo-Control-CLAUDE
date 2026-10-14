-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Fila 0.238 · COMENTAR LA NEGOCIACIÓN SIN PODER NEGOCIAR (§Post-F9.248(b))
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE:
--   Daniel, sobre Aurora: «las listas negociar solo de lectura y poder agregar comentarios, pero no
--   modificar lo que yo hice». Hasta aquí el único texto de la negociación era
--   `negociacion_evento.acuerdo`, y escribirlo exigía `listas.negociar` (que también emite y cancela
--   cotizaciones). El permiso nuevo `listas.comentar` (lo siembra el seed) escribe AQUÍ.
--
-- QUÉ HACE:
--   • crea `negociacion_comentario`: un registro INMUTABLE (D3) por comentario, colgado de la lista y,
--     opcionalmente, de un renglón. Cascade hacia los dos (el dominio lo fotografía en la bitácora
--     antes de quitar un renglón o borrar una lista).
--   • NO toca `negociacion_evento`: el comentario vive aparte para que ningún lector de eventos
--     (último precio negociado, meta negociada, vista de la orden) lo confunda con un acuerdo.
--
-- ES ADITIVA y sin backfill (REGLA 0-B).
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "negociacion_comentario" (
    "id" SERIAL NOT NULL,
    "id_lista" INTEGER NOT NULL,
    "id_lista_linea" INTEGER,
    "texto" TEXT NOT NULL,
    "registrado_por_id" TEXT,
    "registrado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negociacion_comentario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "negociacion_comentario_id_lista_idx" ON "negociacion_comentario"("id_lista");

-- CreateIndex
CREATE INDEX "negociacion_comentario_id_lista_linea_idx" ON "negociacion_comentario"("id_lista_linea");

-- AddForeignKey
ALTER TABLE "negociacion_comentario" ADD CONSTRAINT "negociacion_comentario_id_lista_fkey" FOREIGN KEY ("id_lista") REFERENCES "lista_precios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negociacion_comentario" ADD CONSTRAINT "negociacion_comentario_id_lista_linea_fkey" FOREIGN KEY ("id_lista_linea") REFERENCES "lista_precios_linea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
