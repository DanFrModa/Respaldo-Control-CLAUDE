-- V1-E3g (§Post-F9.66) — La MEDIDA del avío deja de ser texto libre y se separa del CONSUMO.
--
-- Un cierre se CONSUME en piezas (1 por prenda) pero se PIDE por su largo (53 cm): son dos datos
-- distintos que hasta hoy vivían en el mismo campo de texto ("15 cm", "18 cm"). El texto libre
-- partía la compra en tres ("53 cm" ≠ "53cm" ≠ "53"), así que la medida pasa a ser un NÚMERO
-- (`avio_medida.valor`) y su unidad vive UNA sola vez en el avío (`avio.unidad_medida`).
--
-- ⚠️ D3 — Lo que no se pueda convertir NO se tira ni se le inventa valor: se queda con su etiqueta
-- original, `valor` en NULL y `requiere_revision = true` para que alguien lo mire. La etiqueta
-- (`medida`) se conserva SIEMPRE: sigue siendo la clave del diff (`@@unique(id_avio, medida)`) y
-- lo que se ve en pantalla.

-- ── 1) Columnas nuevas (aditivo puro; nada se borra ni cambia de tipo) ──────────────────────────
ALTER TABLE "avio" ADD COLUMN "unidad_medida" TEXT;

ALTER TABLE "avio_medida" ADD COLUMN "valor" DECIMAL(12,2);
ALTER TABLE "avio_medida" ADD COLUMN "requiere_revision" BOOLEAN NOT NULL DEFAULT false;

-- ── 2) Backfill del NÚMERO ──────────────────────────────────────────────────────────────────────
-- Solo se convierte la etiqueta que es, ENTERA, un número seguido (opcionalmente) de una unidad:
-- "15", "15 cm", "15cm", "22 CM", "2.5 mm", "12,5 cm", '18"'. Se quedan FUERA —a propósito— los
-- rangos ("15-18 cm"), las tallas ("S", "M", "XL") y cualquier texto ("vieja"): convertirlos sería
-- adivinar. La coma decimal se normaliza a punto ANTES de decidir, no después.
UPDATE "avio_medida"
   SET "valor" = (substring(replace(btrim("medida"), ',', '.') from '^[0-9]+(\.[0-9]+)?'))::numeric(12,2)
 WHERE replace(btrim("medida"), ',', '.') ~ '^[0-9]+(\.[0-9]+)?[[:space:]]*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ"''°]*\.?$';

-- ── 3) Backfill de la UNIDAD de las medidas, por avío ───────────────────────────────────────────
-- El sufijo de la etiqueta ("cm" en "15 cm") es la unidad. Se adopta SOLO si TODAS las medidas
-- convertibles del avío dicen lo MISMO y ese sufijo no está vacío. Si el avío mezcla unidades
-- ("15 cm" y "150 mm") NO se elige ninguna: se marcan sus medidas para revisión (paso 4).
WITH sufijos AS (
  SELECT
    m."id_avio",
    lower(btrim(regexp_replace(replace(btrim(m."medida"), ',', '.'), '^[0-9]+(\.[0-9]+)?', ''))) AS sufijo
  FROM "avio_medida" m
  WHERE m."valor" IS NOT NULL
),
unicos AS (
  SELECT "id_avio", min(sufijo) AS unidad
  FROM sufijos
  GROUP BY "id_avio"
  HAVING count(DISTINCT sufijo) = 1 AND min(sufijo) <> ''
)
UPDATE "avio" a
   SET "unidad_medida" = u.unidad
  FROM unicos u
 WHERE a."id" = u."id_avio";

-- ── 4) Lo que quedó sin resolver se MARCA (nunca se adivina) ────────────────────────────────────
-- (a) etiquetas no convertibles a número;
-- (b) medidas de un avío cuyas etiquetas MEZCLAN unidades (o no traen ninguna y el avío se quedó
--     sin `unidad_medida`): el número existe, pero nadie sabe si es cm, mm o pulgadas.
UPDATE "avio_medida" m
   SET "requiere_revision" = true
  FROM "avio" a
 WHERE a."id" = m."id_avio"
   AND (m."valor" IS NULL OR a."unidad_medida" IS NULL);
