-- ⭐⭐ V1-E8w (versión 0.060) — LA MESA CON SU FORMA REAL + EL GUARDADO.
--
-- Migración ADITIVA (§Post-F9.149 / .150 / .153). Tres cosas, y las tres juntas a propósito: las dos
-- primeras cambian la FORMA de lo que hay que persistir, así que guardar antes de reacomodar habría
-- obligado a DOS migraciones.
--
--  1. `configuraciones_empresa.costo_empaque_base` — el COSTO DE EMPAQUE por prenda, tercera ancla
--     fija del precosto. Daniel: *"Ponle 2.20 pesos por default, y ya si cambia, que se pueda
--     modificar"*. Vive en la configuración POR EMPRESA (como `pct_desvio_compra` y los
--     `aging_limite*`), NO clavado en el código: el empaque va a subir y el día que sean $2.50 se
--     cambia sin un deploy. El `DEFAULT` rellena las filas ya sembradas.
--  2. `lista_precios_linea.precio_target` — el TARGET PRICE del cliente, NULLABLE porque *"si es que
--     nos lo dio"*: la ausencia es lo normal.
--  3. `negociacion_evento.costo_estimado` + `negociacion_evento_costo` — el DESGLOSE de costos con
--     el que se cerró la mesa. INMUTABLE (D3) y colgado del evento que ya guarda autor, fecha y
--     comentario.
--
-- 🔴 NADA de esto toca un precosto existente: los renglones ya congelados —la foto de lo que se
-- cotizó— se quedan exactamente como están, empaque incluido (o sea, SIN empaque).

-- 1. Costo de empaque por prenda (default 2.20, por empresa).
ALTER TABLE "configuraciones_empresa"
  ADD COLUMN "costo_empaque_base" DECIMAL(12,2) NOT NULL DEFAULT 2.20;

-- 2. Target price del cliente en el renglón de la lista (opcional).
ALTER TABLE "lista_precios_linea"
  ADD COLUMN "precio_target" DECIMAL(12,2);

-- 3. El desglose de la mesa, colgado del evento de negociación.
ALTER TABLE "negociacion_evento"
  ADD COLUMN "costo_estimado" DECIMAL(12,2);

CREATE TABLE "negociacion_evento_costo" (
    "id" SERIAL NOT NULL,
    "id_evento" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "concepto_codigo" VARCHAR(40) NOT NULL,
    "concepto_nombre" VARCHAR(120) NOT NULL,
    "etiqueta" VARCHAR(160) NOT NULL,
    "consumo" DECIMAL(12,4),
    "precio_unit" DECIMAL(12,4) NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "negociacion_evento_costo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "negociacion_evento_costo_id_evento_idx" ON "negociacion_evento_costo"("id_evento");

ALTER TABLE "negociacion_evento_costo"
  ADD CONSTRAINT "negociacion_evento_costo_id_evento_fkey"
  FOREIGN KEY ("id_evento") REFERENCES "negociacion_evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
