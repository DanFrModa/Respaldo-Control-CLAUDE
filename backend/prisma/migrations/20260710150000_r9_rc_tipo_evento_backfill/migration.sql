-- R9 (remate, hallazgo de Gabriel): dos procesos de la RC que Daniel dictó AUTOMÁTICOS (§4.9
-- "auto-completado por evento") y cuyo evento REAL ya existe en v2 estaban en 'manual':
--   • "Auditoria de Calidad Interna" — la completa la auditoría AQL FINAL aprobada (F6-E2,
--     evento `auditoria-calidad-resuelta`) → tipo_evento 'auditoria'.
--   • "Entrega en CDIS" — la completa la entrega a cliente (F3-E5, evento
--     `entrega-cliente-registrada`) → tipo_evento 'entregaCliente'.
--
-- El seed (`seed-ruta-critica.ts`) ya trae estos valores para BDs NUEVAS, pero su upsert usa
-- `update: {}` (a propósito: no pisa ediciones del catálogo) → una BD YA sembrada (prueba) nunca
-- los recibiría. Backfill de UNA sola vez, guardado con `tipo_evento = 'manual'` para NO pisar un
-- valor editado a mano en "Procesos y responsables". Sin cambios de esquema.
UPDATE "proceso_def"
   SET "tipo_evento" = 'entregaCliente'
 WHERE "codigo" = 'entrega-cdis'
   AND "tipo_evento" = 'manual';

UPDATE "proceso_def"
   SET "tipo_evento" = 'auditoria'
 WHERE "codigo" = 'auditoria-calidad-interna'
   AND "tipo_evento" = 'manual';
