-- ⭐⭐ FILA 0.117 — LA FACTURA DEL MAQUILERO, CONTRA EL DOCUMENTO QUE NOSOTROS EMITIMOS.
--
-- El sistema tenía las dos mitades y no las unía: por un lado IMPORTA los CFDI del proveedor
-- (`terceros/cfdi/cfdi-proveedor.ts`), por el otro EMITE el documento con el que ese proveedor
-- tiene que facturar (`pagos/documento-facturacion.ts`, fila 0.118). Daniel cotejaba a mano.
-- Sus cuatro decisiones están en `Documentacion_MJD/DECISIONES.md` §Post-F9.232:
--   (a) se coteja contra EL DOCUMENTO QUE FR MODA EMITE, no contra los recibos sueltos;
--   (b) la tolerancia es UN PESO FIJO, sin porcentaje;
--   (c) la factura que no cuadra ENTRA, marcada y en ROJO, y no se puede pagar hasta que alguien
--       la atienda — no se rechaza;
--   (d) «como venga»: una factura puede cubrir varios documentos y varias facturas uno solo.
--
-- ══ 1) EL DOCUMENTO EMITIDO POR FIN TIENE IDENTIDAD ════════════════════════════════════════════
-- No nace ninguna tabla para él: el `renglon_corrida_pago` YA ES el documento (así lo dice su
-- propio dominio). Lo que le faltaba era NÚMERO. Hasta hoy el impreso sólo rotulaba «Corrida #N»,
-- y un mismo proveedor puede llevar VARIOS renglones en una corrida (partir un pago en dos cuentas
-- es lo normal, §Post-F9.185(e)) ⇒ dos hojas con el mismo número y nada que las distinga. El
-- maquilero cita ese número en su factura: sin él, el cotejo no tiene contra qué amarrar.
--
-- `folio_documento` es la OCTAVA serie de folios del sistema (§Post-F9.233) y se asigna AL CERRAR
-- la corrida, por secuencia atómica `documento-facturacion` (A3, jamás `Max()+1`).
--
-- ⚠️ POR QUÉ ADEMÁS ENTRA `id_empresa` EN EL RENGLÓN. El folio se numera POR EMPRESA (A9/A3, como
-- los otros siete), y sin esa columna no hay dónde colgar el `UNIQUE (id_empresa, folio_documento)`
-- que impide dos documentos con el mismo número. Es una COPIA de la empresa de la corrida —el
-- renglón no cambia de corrida nunca—, y de paso deja la bandeja del cotejo en una sola consulta.
--
-- 🔑 El `UPDATE` de abajo NO es un backfill de los prohibidos por la REGLA 0-B: no repara datos ni
-- inventa nada de negocio, sólo copia a cada renglón la empresa de su propia corrida para que la
-- columna pueda ser NOT NULL. Los `folio_documento` de las corridas ya cerradas se quedan en NULL
-- A PROPÓSITO (eso sí sería rellenar el pasado): sus documentos siguen saliendo rotulados con la
-- corrida, como hasta hoy, y sólo lo que se cierre de aquí en adelante trae folio.
--
-- ══ 2) EL ROJO VIVE EN LA FACTURA ══════════════════════════════════════════════════════════════
-- `estado_cotejo` va en `movimientos_tercero` y no en la tabla de ligas por una razón medida: el
-- descuadre MÁS COMÚN es la factura que no tiene NI UNA liga, y una marca que viviera en la liga
-- no tendría dónde ponerse. `NULL` = a esta factura no le toca cotejo.
--
-- Y el veredicto mecánico va SEPARADO de la decisión humana: `estado_cotejo` se RECALCULA cada vez
-- que cambian las ligas, mientras que `cotejo_atendido_en/_por_id/_nota` son un HECHO auditado
-- (D3/A7). Si «atendida» viviera dentro del enum, el primer recálculo borraría en silencio el acto
-- de una persona.
--
-- ══ 3) LA LIGA ES UNA TABLA, NO UN `ref_tipo` ══════════════════════════════════════════════════
-- La decisión (d) descarta el 1:1 de forma explícita, así que `cotejo_factura_documento` es una
-- tabla de aplicaciones N:M con importe, mismo patrón que `pago_aplicacion` (el pago de maquila
-- contra sus cargos). Es LA ÚNICA VÍA: no se deja además el `ref_tipo` como segundo mecanismo para
-- lo mismo. Las dos invariantes (ninguna factura aplica más de su total, ningún documento recibe
-- más de su monto) viven en el dominio, por suma directa bajo lock (D3), no en una columna de saldo.
--
-- ADITIVA. SIN permisos nuevos (reusa `cxp.ver` / `cxp.administrar`, §Post-F9.190: cero casillas
-- nuevas en Roles) y SIN semillas.

-- CreateEnum
CREATE TYPE "estado_cotejo_factura" AS ENUM ('cuadra', 'descuadre');

-- AlterTable — el documento emitido: su empresa (copiada de la corrida) y su folio propio.
ALTER TABLE "renglon_corrida_pago" ADD COLUMN     "folio_documento" BIGINT,
ADD COLUMN     "id_empresa" INTEGER;

UPDATE "renglon_corrida_pago" AS r
   SET "id_empresa" = c."id_empresa"
  FROM "corrida_pago" AS c
 WHERE c."id" = r."id_corrida";

ALTER TABLE "renglon_corrida_pago" ALTER COLUMN "id_empresa" SET NOT NULL;

-- AlterTable — el cotejo, en la factura.
ALTER TABLE "movimientos_tercero" ADD COLUMN     "cotejo_atendido_en" TIMESTAMP(3),
ADD COLUMN     "cotejo_atendido_por_id" TEXT,
ADD COLUMN     "cotejo_nota" TEXT,
ADD COLUMN     "estado_cotejo" "estado_cotejo_factura";

-- CreateTable
CREATE TABLE "cotejo_factura_documento" (
    "id_movimiento" INTEGER NOT NULL,
    "id_renglon" INTEGER NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "cotejo_factura_documento_pkey" PRIMARY KEY ("id_movimiento","id_renglon")
);

-- Una liga en cero (o negativa) no dice nada: si una factura no cubre nada de ese documento, la
-- liga no existe. Se blinda en la base porque el dominio ya lo exige y las dos deben decir lo mismo.
ALTER TABLE "cotejo_factura_documento"
  ADD CONSTRAINT "cotejo_factura_documento_importe_positivo" CHECK ("importe" > 0);

-- CreateIndex
CREATE INDEX "cotejo_factura_documento_id_renglon_idx" ON "cotejo_factura_documento"("id_renglon");

-- CreateIndex
CREATE INDEX "movimientos_tercero_id_empresa_estado_cotejo_idx" ON "movimientos_tercero"("id_empresa", "estado_cotejo");

-- CreateIndex
CREATE INDEX "renglon_corrida_pago_id_empresa_idx" ON "renglon_corrida_pago"("id_empresa");

-- CreateIndex — los NULL son DISTINTOS entre sí en Postgres: los renglones sin documento conviven.
CREATE UNIQUE INDEX "renglon_corrida_pago_id_empresa_folio_documento_key" ON "renglon_corrida_pago"("id_empresa", "folio_documento");

-- AddForeignKey
ALTER TABLE "cotejo_factura_documento" ADD CONSTRAINT "cotejo_factura_documento_id_movimiento_fkey" FOREIGN KEY ("id_movimiento") REFERENCES "movimientos_tercero"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotejo_factura_documento" ADD CONSTRAINT "cotejo_factura_documento_id_renglon_fkey" FOREIGN KEY ("id_renglon") REFERENCES "renglon_corrida_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglon_corrida_pago" ADD CONSTRAINT "renglon_corrida_pago_id_empresa_fkey" FOREIGN KEY ("id_empresa") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
