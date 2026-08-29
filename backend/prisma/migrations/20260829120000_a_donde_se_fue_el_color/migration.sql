-- V1-E8s · A DÓNDE SE FUE EL COLOR: la fusión deja RASTRO de quién se llevó a cada absorbido
-- (§Post-F9.143).
--
-- EL PROBLEMA QUE CIERRA. `fusionarColores` sólo APAGA el color origen (borrado suave, D3) y no
-- guarda en ningún lado a QUIÉN se lo llevó. El importador de OC (`resolverOCrearColor`), al toparse
-- otra vez con ese nombre en el siguiente PDF de C&A, lo RESUCITABA — y como ese resolver **sí
-- amarra el id a la matriz color×talla de la OP**, el color revivido volvía a acumular referencias.
-- Con referencias encima, `contarUsosQueBloqueanFusion` (§Post-F9.129) ya no lo deja volver a
-- fusionar: la siguiente OC no sólo deshacía la limpieza, la dejaba IRREPETIBLE.
-- Con esta columna el importador ya tiene a dónde mandarlo: al CANÓNICO.
--
-- Migración ADITIVA: una columna nullable + su índice + la FK reflexiva. No borra nada, no cambia
-- ningún default y no restringe nada de lo que hoy se puede hacer. NO requiere `SEED_ON_START`
-- (sin permisos, roles ni catálogos nuevos: la fusión sigue con `colores.administrar`).
--
-- ⚠️ SÍ TRAE BACKFILL, y por eso se explica aquí. Las fusiones YA HECHAS no tienen dónde haber
-- dejado el rastro… salvo en la BITÁCORA: `fusionarColores` viene registrando desde F1-E6, por cada
-- origen absorbido, un renglón `entidad='Color'` / `accion='OTRO'` con
-- `datos = {"operacion":"fusionar","fusionadoEn":{"id":<destino>,"nombre":"…"}}`. El UPDATE de abajo
-- lo lee y siembra la columna. Sin él, un color fusionado ANTES de este deploy seguiría resucitando
-- (el defecto quedaría cerrado sólo para las fusiones futuras).
--   • Sólo toca colores APAGADOS (`activo = false`): un color activo no está absorbido.
--   • Sólo escribe donde la columna está NULA (idempotente si se re-corre).
--   • Toma la fusión MÁS RECIENTE de cada color (`DISTINCT ON` + `ORDER BY fecha DESC`): si un color
--     se fusionó, se reactivó a mano y se volvió a fusionar, manda la última.
--   • Descarta destinos que ya no existan, y jamás se apunta a sí mismo (evita un ciclo de un nodo).
--   • `id_entidad` es texto en `bitacora`: se filtra a dígitos antes de castear.
-- Si la bitácora está vacía o no hay fusiones, el UPDATE no toca una sola fila.

-- AlterTable
ALTER TABLE "colores" ADD COLUMN     "id_fusionado_en" INTEGER;

-- CreateIndex
CREATE INDEX "colores_id_fusionado_en_idx" ON "colores"("id_fusionado_en");

-- AddForeignKey
ALTER TABLE "colores" ADD CONSTRAINT "colores_id_fusionado_en_fkey" FOREIGN KEY ("id_fusionado_en") REFERENCES "colores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill del rastro de las fusiones YA HECHAS, leído de la bitácora (ver la nota de arriba).
UPDATE "colores" c
SET "id_fusionado_en" = f."id_destino"
FROM (
  SELECT DISTINCT ON (b."id_entidad")
         b."id_entidad"::int                              AS "id_color",
         (b."datos" -> 'fusionadoEn' ->> 'id')::int        AS "id_destino"
  FROM "bitacora" b
  WHERE b."entidad" = 'Color'
    AND b."accion" = 'OTRO'
    AND b."id_entidad" ~ '^[0-9]+$'
    AND b."datos" ->> 'operacion' = 'fusionar'
    AND (b."datos" -> 'fusionadoEn' ->> 'id') ~ '^[0-9]+$'
  ORDER BY b."id_entidad", b."fecha" DESC, b."id" DESC
) f
WHERE c."id" = f."id_color"
  AND c."activo" = false
  AND c."id_fusionado_en" IS NULL
  AND f."id_destino" <> c."id"
  AND EXISTS (SELECT 1 FROM "colores" d WHERE d."id" = f."id_destino");
