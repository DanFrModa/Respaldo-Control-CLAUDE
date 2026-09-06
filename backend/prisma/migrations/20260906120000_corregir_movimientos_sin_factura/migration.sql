-- 0.145 · CORREGIR un movimiento SIN FACTURA del estado de cuenta de un proveedor.
--
-- DANIEL (6-sep-2026, §Post-F9.203): «Quiero tener manera de modificar cualquier registro que se
-- meta en cualquier estado de cuenta de los proveedores sin factura. Sólo yo. Nadie más ni con
-- permiso. Sólo yo.» — y sobre la forma, tras plantearle el costo: «Sí, está bien con rastro.»
--
-- «Con rastro» = por dentro NO se edita nada (D3): se cancela el viejo con su contra-asiento y nace
-- uno nuevo LIGADO al que sustituye. Esta migración sólo agrega las columnas de esas dos cosas:
--
--  (a) `usuarios.puede_corregir_sin_factura` — la bandera de la PERSONA (patrón `es_auditor`), NO un
--      permiso: no se reparte desde ninguna pantalla ni endpoint, se prende sólo por base de datos.
--
--  (b) `movimientos_tercero.id_movimiento_corregido` — el movimiento nuevo apunta al que sustituye.
--      UNIQUE (los NULL son distintos en Postgres): una sola corrección por movimiento corregido.
--
--  (c) `abono_maquilero` / `pago_maquilero` — CANCELACIÓN SUAVE (`cancelado_en`, `cancelado_por_id`,
--      `motivo_cancelacion`), que hasta hoy sólo tenía el descuento (fila 0.109). Sin ella un abono
--      o un pago capturado por error NO se podían deshacer NUNCA.
--
--  (d) `id_abono_corregido` / `id_pago_corregido` / `id_descuento_corregido` — la misma liga que (b)
--      para los tres movimientos planos de EsMa.
--
-- Todo ADITIVO y nullable (o con DEFAULT): ninguna fila existente se reescribe (REGLA 0-B).

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "puede_corregir_sin_factura" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "movimientos_tercero" ADD COLUMN     "id_movimiento_corregido" INTEGER;

-- AlterTable
ALTER TABLE "abono_maquilero" ADD COLUMN     "cancelado_en" TIMESTAMP(3),
ADD COLUMN     "cancelado_por_id" TEXT,
ADD COLUMN     "id_abono_corregido" INTEGER,
ADD COLUMN     "motivo_cancelacion" TEXT;

-- AlterTable
ALTER TABLE "descuento_maquilero" ADD COLUMN     "id_descuento_corregido" INTEGER;

-- AlterTable
ALTER TABLE "pago_maquilero" ADD COLUMN     "cancelado_en" TIMESTAMP(3),
ADD COLUMN     "cancelado_por_id" TEXT,
ADD COLUMN     "id_pago_corregido" INTEGER,
ADD COLUMN     "motivo_cancelacion" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_tercero_id_movimiento_corregido_key" ON "movimientos_tercero"("id_movimiento_corregido");

-- CreateIndex
CREATE UNIQUE INDEX "abono_maquilero_id_abono_corregido_key" ON "abono_maquilero"("id_abono_corregido");

-- CreateIndex
CREATE INDEX "abono_maquilero_cancelado_en_idx" ON "abono_maquilero"("cancelado_en");

-- CreateIndex
CREATE UNIQUE INDEX "descuento_maquilero_id_descuento_corregido_key" ON "descuento_maquilero"("id_descuento_corregido");

-- CreateIndex
CREATE UNIQUE INDEX "pago_maquilero_id_pago_corregido_key" ON "pago_maquilero"("id_pago_corregido");

-- CreateIndex
CREATE INDEX "pago_maquilero_cancelado_en_idx" ON "pago_maquilero"("cancelado_en");

-- AddForeignKey
ALTER TABLE "movimientos_tercero" ADD CONSTRAINT "movimientos_tercero_id_movimiento_corregido_fkey" FOREIGN KEY ("id_movimiento_corregido") REFERENCES "movimientos_tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abono_maquilero" ADD CONSTRAINT "abono_maquilero_id_abono_corregido_fkey" FOREIGN KEY ("id_abono_corregido") REFERENCES "abono_maquilero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descuento_maquilero" ADD CONSTRAINT "descuento_maquilero_id_descuento_corregido_fkey" FOREIGN KEY ("id_descuento_corregido") REFERENCES "descuento_maquilero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_maquilero" ADD CONSTRAINT "pago_maquilero_id_pago_corregido_fkey" FOREIGN KEY ("id_pago_corregido") REFERENCES "pago_maquilero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
