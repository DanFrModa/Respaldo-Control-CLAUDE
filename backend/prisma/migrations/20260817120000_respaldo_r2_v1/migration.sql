-- V1-E6a — SEGUNDO RESPALDO: COPIA CIFRADA A R2 (rastro de cada corrida)
--
-- PLANMAESTRO §2.2 ("respaldo doble": además del backup nativo de Railway, un job de pg-boss hace
-- `pg_dump` y lo sube CIFRADO a R2) y §11; es la mitigación #1 de la tabla de riesgos y hoy NO
-- existe.
--
-- Corre MENSUAL (Gabriel, 17-ago-2026): los respaldos diarios de Railway ya están encendidos en
-- todos los ambientes y cubren el día a día. Esta copia cubre lo que ellos no pueden — que el
-- problema SEA Railway: cuenta suspendida, servicio borrado, caída larga o mudanza de proveedor.
--
-- Esta migración es puramente ADITIVA (una tabla nueva y dos enums nuevos): no toca ninguna tabla
-- existente, así que se aplica sin riesgo sobre la base viva.
--
-- POR QUÉ UNA TABLA Y NO SOLO LOGS: un respaldo que falla callado es PEOR que no tener respaldo,
-- porque genera confianza falsa. `console.error` nadie lo lee. Aquí queda, por escrito y
-- consultable, cuándo corrió, si el objeto QUEDÓ en R2 (verificado con HeadObject, no "el PUT no
-- lanzó"), cuánto pesó y —si tronó— en qué paso y con qué error. Cada corrida escribe además un
-- renglón de `bitacora` (entidad `RespaldoBd`), que ya tiene pantalla de consulta desde F6-E1.

-- CreateEnum
CREATE TYPE "estado_respaldo" AS ENUM ('EXITO', 'FALLO');

-- CreateEnum
CREATE TYPE "paso_respaldo" AS ENUM ('CONFIGURACION', 'VOLCADO', 'CIFRADO', 'SUBIDA', 'VERIFICACION', 'RETENCION');

-- CreateTable
CREATE TABLE "respaldo_corrida" (
    "id" BIGSERIAL NOT NULL,
    "iniciado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminado_en" TIMESTAMP(3),
    "estado" "estado_respaldo" NOT NULL,
    "paso" "paso_respaldo" NOT NULL,
    "bucket" TEXT,
    "key" TEXT,
    "tamano_dump_bytes" BIGINT,
    "tamano_subido_bytes" BIGINT,
    "objetos_borrados" INTEGER NOT NULL DEFAULT 0,
    "duracion_ms" INTEGER,
    "error" TEXT,

    CONSTRAINT "respaldo_corrida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "respaldo_corrida_iniciado_en_idx" ON "respaldo_corrida"("iniciado_en");

-- CreateIndex
CREATE INDEX "respaldo_corrida_estado_iniciado_en_idx" ON "respaldo_corrida"("estado", "iniciado_en");
