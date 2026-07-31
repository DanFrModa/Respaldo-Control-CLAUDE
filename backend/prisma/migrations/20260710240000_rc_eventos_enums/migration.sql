-- Cierre del hueco de EMISORES de la Ruta Crítica (post-F9, hallazgo de Gabriel): Daniel dictó ~18/20
-- procesos AUTOMÁTICOS pero v2 no emitía sus eventos, así que el catálogo quedó 10 auto · 16 manuales.
-- Esta migración SOLO agrega los valores de enum que las siguientes piezas (tabla `hito_orden` +
-- emisores + auto-avance) van a USAR — separada y ANTERIOR a cualquier DDL/DML que los use, porque en
-- PostgreSQL un `ALTER TYPE ... ADD VALUE` no puede convivir con el uso del valor nuevo en la misma
-- transacción (lección F9-E4). Los valores se APENDAN al final (sin BEFORE): el schema los declara
-- también al final de cada enum, así BD == schema y `prisma migrate diff` no reporta drift.

-- AlterEnum: 8 eventos nuevos de proceso RC.
--  • compraTela / surtidoAvios / auditoriaCorte → los completa un hecho estructurado (OC de tela
--    autorizada / nota de salida de avíos confirmada / auditoría de corte aprobada).
--  • revisionOp / autorizacionFit / autorizacionTono / autorizacionAvios / empaque → los completa un
--    HITO capturado a mano (tabla `hito_orden` de la migración siguiente).
ALTER TYPE "tipo_evento_proceso" ADD VALUE 'revisionOp';
ALTER TYPE "tipo_evento_proceso" ADD VALUE 'autorizacionFit';
ALTER TYPE "tipo_evento_proceso" ADD VALUE 'autorizacionTono';
ALTER TYPE "tipo_evento_proceso" ADD VALUE 'autorizacionAvios';
ALTER TYPE "tipo_evento_proceso" ADD VALUE 'compraTela';
ALTER TYPE "tipo_evento_proceso" ADD VALUE 'surtidoAvios';
ALTER TYPE "tipo_evento_proceso" ADD VALUE 'auditoriaCorte';
ALTER TYPE "tipo_evento_proceso" ADD VALUE 'empaque';

-- AlterEnum: tipo de auditoría "de corte" (auditoría de piso previa al corte). Una auditoría `corte`
-- `aprobado` viva completa el proceso RC `auditoriaCorte` (igual que la `final` completa `auditoria`).
ALTER TYPE "tipo_auditoria" ADD VALUE 'corte';
