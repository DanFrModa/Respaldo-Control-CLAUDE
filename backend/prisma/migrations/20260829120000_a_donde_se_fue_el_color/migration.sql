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
--   • Descarta destinos que ya no existan. ⚠️ Si la fusión MÁS RECIENTE de un color apunta a un
--     destino borrado, se descarta el renglón entero y **también se pierde la fusión anterior válida**:
--     es a propósito, la elección conservadora — preferimos quedarnos sin rastro (comportamiento de
--     siempre) que sembrar uno que la historia ya desmintió.
--   • Nunca se apunta a sí mismo. Eso cubre el ciclo de UN nodo y **nada más**: los de dos o más los
--     rompe el paso siguiente, que es obligatorio (ver «ROMPE-CICLOS» abajo).
--   • `id_entidad` es texto en `bitacora`: se filtra a dígitos **y a ≤ 9 de largo** antes de castear
--     (un `::int` desbordado ABORTA la migración a media aplicación; hoy es inalcanzable —los 7 sitios
--     que escriben esta bitácora usan `String(color.id)`— pero la guarda cuesta una línea).
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
    AND length(b."id_entidad") <= 9
    AND b."datos" ->> 'operacion' = 'fusionar'
    AND (b."datos" -> 'fusionadoEn' ->> 'id') ~ '^[0-9]+$'
    AND length(b."datos" -> 'fusionadoEn' ->> 'id') <= 9
  ORDER BY b."id_entidad", b."fecha" DESC, b."id" DESC
) f
WHERE c."id" = f."id_color"
  AND c."activo" = false
  AND c."id_fusionado_en" IS NULL
  AND f."id_destino" <> c."id"
  AND EXISTS (SELECT 1 FROM "colores" d WHERE d."id" = f."id_destino");

-- 🔴 ROMPE-CICLOS — obligatorio, no decorativo (hallazgo H1 de la revisión de V1-E8s).
--
-- **El DOMINIO no puede cerrar un círculo** (`fusionarColores` limpia el rastro del destino, así que
-- el canónico siempre queda terminal). **El BACKFILL de arriba SÍ podría**, y por eso se rompe aquí:
-- la bitácora guarda la historia COMPLETA, incluidas fusiones que después se deshicieron a mano, y de
-- ahí se puede reconstruir un anillo que nunca existió a la vez. El camino es alcanzable sólo con la
-- UI: fusionar A→B, corregir fusionando B→A (caso plausible: hay una prueba para él) y apagar a mano
-- al sobreviviente ⇒ dos renglones de bitácora que, leídos juntos, dicen «A→B» y «B→A».
--
-- ⚠️ El `f."id_destino" <> c."id"` del UPDATE sólo cubre el ciclo de UN nodo. Se reprodujeron ciclos
-- de DOS y de TRES; por eso aquí NO se parchea el caso de pares, se rompe **cualquier longitud**.
--
-- QUÉ HACE: busca los colores que, siguiendo la cadena, vuelven a sí mismos, y les BORRA el rastro.
-- Se borra a TODOS los del anillo, no un eslabón elegido a dedo: si la bitácora dice «A absorbió a B»
-- y «B absorbió a A», el dato es AMBIGUO y no hay forma honesta de nombrar un canónico. Sin rastro,
-- esos colores vuelven al comportamiento de siempre (el importador los reactiva) en vez de tumbar la
-- importación con un error que nadie puede accionar. Un color que sólo APUNTA a un anillo sin ser
-- parte de él conserva su rastro: al romperse el anillo, su cadena ya termina.
--
-- El `n < 50` corta la recursión (sin él, un ciclo la vuelve infinita). 50 es holgadísimo: la cadena
-- real tiene 1 o 2 eslabones, y el dominio topa en 20 saltos al recorrerla.
WITH RECURSIVE "cadena"("raiz", "nodo", "n") AS (
  SELECT "id", "id_fusionado_en", 1 FROM "colores" WHERE "id_fusionado_en" IS NOT NULL
  UNION ALL
  SELECT "cadena"."raiz", c."id_fusionado_en", "cadena"."n" + 1
  FROM "cadena" JOIN "colores" c ON c."id" = "cadena"."nodo"
  WHERE c."id_fusionado_en" IS NOT NULL AND "cadena"."n" < 50
)
UPDATE "colores"
SET "id_fusionado_en" = NULL
WHERE "id" IN (SELECT "raiz" FROM "cadena" WHERE "nodo" = "raiz");
