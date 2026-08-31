-- ⭐⭐ V1-E8x (versión 0.062) — LOS CUATRO ESTADOS DEL MODELO DENTRO DE LA LISTA DE PRECIOS.
--
-- Migración ADITIVA (§Post-F9.151 + §Post-F9.155). Daniel: *«Que empiece todo en "Abierto", y luego
-- estan los otros 3 estados. En negociacion, cerrado, dropeado. en total son 4 estados»*.
--
--  1. El TIPO es un ENUM cerrado, NO una tabla-catálogo: *«en total son 4 estados»*. Un catálogo
--     ampliable invitaría a agregar un quinto sin decidir qué hace con el papel, y ya hay un eje
--     catálogo en esta pantalla (`EstadoLista`, el estado del DOCUMENTO) que NO se debe reusar para
--     esto — son dos ejes distintos, aunque tres nombres se parezcan (§Post-F9.151 punto 3).
--  2. La columna nace `NOT NULL DEFAULT 'abierto'`: con eso las filas que ya existen quedan en
--     `abierto`, que es exactamente lo que dice la decisión (*todo renglón nace ahí*).
--  3. `estado_por_id` / `estado_en` = la FIRMA del estado vigente (quién lo dejó así y cuándo),
--     mismo patrón que `aprobado_por_id`/`aprobado_en`. El rastro COMPLETO del dropeo y del revivir
--     (§Post-F9.155 punto 3) NO vive aquí: cada transición agrega un `negociacion_evento`
--     INMUTABLE (D3) que ya guarda autor, fecha y texto, y queda en la bitácora.
--
-- 🔴 NO toca `precio_aprobado` ni ninguna otra columna: el eje Aprobado/Pendiente sigue igual y
-- convive con éste. Un renglón dropeado conserva su firma vieja intacta — por eso revivirlo no
-- pierde nada. SIN permisos nuevos (`listas.negociar` ya gobierna el cambio de estado) y SIN seed.

CREATE TYPE "estado_renglon_lista" AS ENUM ('abierto', 'en_negociacion', 'cerrado', 'dropeado');

ALTER TABLE "lista_precios_linea"
  ADD COLUMN "estado" "estado_renglon_lista" NOT NULL DEFAULT 'abierto',
  ADD COLUMN "estado_por_id" TEXT,
  ADD COLUMN "estado_en" TIMESTAMP(3);
