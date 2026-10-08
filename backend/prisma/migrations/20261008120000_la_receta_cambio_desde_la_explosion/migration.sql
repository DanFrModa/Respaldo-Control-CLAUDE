-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Fila 0.257 · LA PREVIA DE COMPRA SABE SI LA RECETA CAMBIÓ DESDE LA ÚLTIMA EXPLOSIÓN
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE:
--   La previa y la generación de OC compran el SNAPSHOT de la explosión (`requerimiento_orden`).
--   Explotar con un avío de captura contradictoria (5,300 donde eran 600), corregirlo en la
--   receta, re-firmarlo y pedir la previa SIN re-explotar sacaba la OC por 5,300 sin aviso.
--   Ninguna fecha que ya existía sirve para detectarlo: hace falta un contador explícito.
--
-- QUÉ HACE: crea `orden_version_receta` (1:1 con `ordenes`):
--   • `version_receta`: lo sube el dominio en cada cambio que mueve lo que la explosión lee.
--   • `version_explotada`: la versión que leyó la última explosión. Distinta (o NULL con snapshot)
--     = el snapshot ya no corresponde y la compra se bloquea hasta volver a explotar.
--
-- POR QUÉ UNA TABLA Y NO DOS COLUMNAS EN `ordenes`: sellar la explosión con `UPDATE ordenes` metía a
--   la explosión en el grafo de candados de fila de la orden y daba deadlocks contra quien la
--   escribe (medido: 8-11 de 25 contra `recalcularEstadoOrdenesDeModelo`). Insertar o actualizar
--   aquí sólo toma `FOR KEY SHARE` sobre la orden, que no choca con un `UPDATE` que no toque la llave.
--
-- ES ADITIVA y sin backfill (REGLA 0-B): que una orden no tenga fila = versión 0, nunca explotada.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "orden_version_receta" (
    "id_orden" INTEGER NOT NULL,
    "version_receta" INTEGER NOT NULL DEFAULT 0,
    "version_explotada" INTEGER,

    CONSTRAINT "orden_version_receta_pkey" PRIMARY KEY ("id_orden")
);

-- AddForeignKey
ALTER TABLE "orden_version_receta" ADD CONSTRAINT "orden_version_receta_id_orden_fkey" FOREIGN KEY ("id_orden") REFERENCES "ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
