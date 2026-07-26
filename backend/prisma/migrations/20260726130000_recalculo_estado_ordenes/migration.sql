-- Migración de DATOS (no de esquema): pone al día el ESTADO GUARDADO de las órdenes con la regla
-- automática que estrenó `20260726120000_modelo_lleva_arte`.
--
-- POR QUÉ HACE FALTA. Tres cosas correctas por separado se combinaban mal:
--   1. `modelos.lleva_arte` nace en `true` para los ~miles de modelos migrados de Access.
--   2. El recálculo por cambio de catálogo SOLO ASCIENDE (nunca degrada, para no sacar de los
--      tableros una orden a medio producir), y el de la matriz solo corre cuando alguien la edita.
--   3. La pantalla "Órdenes incompletas" filtra por el ESTADO GUARDADO (`ordenes.estado`).
-- Resultado sin esta migración: el corpus histórico se quedaría guardado como `completa` y el
-- backlog que Daniel pidió atender —*"si no meten la información del arte, o no desmarcan la
-- casilla, está como incompleto… siempre hay que atender ese tema"*— sería INVISIBLE justo en la
-- pantalla donde se trabaja. Además una OP histórica se vería con el badge "Completa" y, al lado,
-- el aviso "Falta: arte" (contradicción en la misma pantalla).
--
-- QUÉ HACE. UNA sola pasada que baja a `capturada` las órdenes que hoy están `completa` y NO
-- cumplen la regla (`backend/src/dominio/produccion/requisitos-orden.ts`):
--   • sin renglones de matriz (falta TALLAS), o
--   • su modelo sin ningún avío `para_produccion` (falta AVÍOS), o
--   • su modelo con `lleva_arte` y SIN arte en el BOM (falta ARTE).
--
-- QUÉ **NO** TOCA (los mismos cinturones que el dominio, replicados aquí):
--   • Órdenes con ACTIVIDAD DE PRODUCCIÓN VIVA (≥1 `etapa_movimiento` sin cancelar): jamás se
--     degradan — es exactamente lo que autoriza `tieneActividadProduccion`. Una orden ya cortada o
--     enviada a maquila NO puede cambiar de semáforo por un cambio de catálogo.
--   • Las `cancelada` (cancelada siempre gana) ni las que ya están `capturada`.
--   • `fecha_completada`: es el SELLO HISTÓRICO de "cuándo quedó lista por primera vez"; se pone
--     una sola vez y NUNCA se borra. Por eso tras esta migración habrá órdenes `capturada` CON
--     fecha — es correcto y está documentado en el schema.
--   • `modificado_por_id`: no se toca. El cambio no lo hizo una persona; queda atribuido al
--     sistema por el renglón de bitácora con `id_usuario = NULL` (mismo criterio que el ETL).
--
-- POR QUÉ EN SQL Y NO EN TS: es un UPDATE de conjunto con predicados que Postgres resuelve de una
-- pasada (nada de traer ids a memoria ni de lotes), no necesita servicios de dominio y debe correr
-- SOLA en el deploy, sin que nadie ejecute un script a mano. La regla se replica aquí a propósito
-- y con este comentario al lado; el único punto de verdad para la APLICACIÓN sigue siendo
-- `requisitos-orden.ts`. Si la regla cambia, esta migración NO se re-escribe (ya corrió): se
-- agrega otra.
--
-- IDEMPOTENTE: re-correrla no encuentra filas (las degradadas ya están en `capturada`).
-- A7: cada orden tocada deja su propio renglón de bitácora, no solo un total.

WITH a_degradar AS (
  SELECT o.id
    FROM ordenes o
    JOIN modelos m ON m.id = o.id_modelo
   WHERE o.estado = 'completa'
     -- Cinturón: nada que ya esté en producción se degrada.
     AND NOT EXISTS (
           SELECT 1 FROM etapa_movimiento e
            WHERE e.id_orden = o.id AND e.cancelado_en IS NULL
         )
     AND (
           -- Falta TALLAS: la orden no tiene matriz.
           NOT EXISTS (SELECT 1 FROM orden_linea l WHERE l.id_orden = o.id)
           -- Falta AVÍOS: el modelo no tiene receta de producción.
           OR NOT EXISTS (
                SELECT 1 FROM modelo_avio ma
                 WHERE ma.id_modelo = o.id_modelo AND ma.para_produccion
              )
           -- Falta ARTE: el modelo lo lleva (default true) y el BOM no lo tiene capturado.
           OR (
                m.lleva_arte
                AND NOT EXISTS (SELECT 1 FROM modelo_bordado mb WHERE mb.id_modelo = o.id_modelo)
              )
         )
),
degradadas AS (
  UPDATE ordenes o
     SET estado = 'capturada',
         modificado_en = now()
    FROM a_degradar d
   WHERE o.id = d.id
  RETURNING o.id
)
INSERT INTO bitacora (entidad, id_entidad, accion, datos, id_usuario)
SELECT 'Orden',
       d.id::text,
       'MODIFICAR',
       jsonb_build_object(
         'estado', 'capturada',
         'motivo', 'recalculo-estado-automatico',
         'migracion', '20260726130000_recalculo_estado_ordenes'
       ),
       NULL
  FROM degradadas d;
