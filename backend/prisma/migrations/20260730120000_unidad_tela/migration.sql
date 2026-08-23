-- Unidad de la tela: de texto libre a ENUM obligatorio (kg / m).
--
-- Daniel (30-jul-2026): *"todo lo que se compra en kilos se consume en kilos y lo que se compra en
-- metros se consume en metros… solo kilos y metros, no hay otras medidas"*. La columna era
-- `text NULL` y estaba VACÍA en TODAS las telas (el ETL nunca la llenaba), así que el stock, el
-- consumo y el costo por prenda no tenían unidad con la que significar algo.
--
-- CONVERSIÓN DE LO EXISTENTE: se respeta lo que ya estuviera capturado a mano (kg/kilo/mt/metros…)
-- y TODO LO DEMÁS —incluidos los NULL y cualquier texto que no se reconozca, p. ej. los 'YARDA' /
-- 'ROLLO' / 'CONO' que ofrecía el datalist viejo— queda en KG, la unidad de 735 de las 877 telas
-- del sistema viejo (punto: felpa, french terry, licra). Esa conversión NO deja rastro: es
-- deliberado, porque Daniel confirmó que solo existen kilos y metros.
--
-- Las 142 telas que van en METROS las corrige el ETL al re-correrse: `migracion/loaders/telas.ts`
-- RECONCILIA la unidad de las telas ya migradas contra `Telas.Medida` del Access (-1 = Kilos,
-- 0 = Metros) y reporta cada corrección. No hace falta borrar la base.
CREATE TYPE "unidad_tela" AS ENUM ('KG', 'M');

ALTER TABLE "telas"
  ALTER COLUMN "unidad_medida" DROP DEFAULT,
  ALTER COLUMN "unidad_medida" TYPE "unidad_tela"
    USING (
      CASE
        WHEN lower(btrim(COALESCE("unidad_medida", ''))) IN ('m', 'mt', 'mts', 'metro', 'metros')
          THEN 'M'::"unidad_tela"
        ELSE 'KG'::"unidad_tela"
      END
    ),
  ALTER COLUMN "unidad_medida" SET DEFAULT 'KG',
  ALTER COLUMN "unidad_medida" SET NOT NULL;
