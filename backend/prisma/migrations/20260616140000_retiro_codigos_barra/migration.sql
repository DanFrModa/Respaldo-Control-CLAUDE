-- Retiro de CÓDIGOS DE BARRA (decisión Gabriel, 16-jun-2026): los códigos de barra (EAN-13 /
-- DUN-14) salen del sistema por completo y NO se conserva historial. Esta migración elimina las
-- columnas de prefijo/código de barra del modelo y limpia el permiso huérfano:
--   • `empresas.upc`  — prefijo UPC de la empresa (viejo `UPCEmp`). Tiene datos reales (el prefijo
--     de FR Moda), pero Gabriel pidió borrarlo: el dato no se conserva.
--   • `ordenes.upc`   — código de barra histórico de la orden (viejo `Ordenes.UPC`). Dato histórico
--     que tampoco se conserva.
--   • permiso `modelos.codigos-barra` — se borra del catálogo de permisos. Primero se quitan sus
--     asignaciones en `roles_permisos` (FK ON DELETE RESTRICT), luego la fila de `permisos`.
-- Seguridad: el DROP COLUMN es destructivo a propósito (Gabriel no quiere historial). El DELETE del
-- permiso es idempotente (no falla si ya no existe).

-- AlterTable
ALTER TABLE "empresas" DROP COLUMN "upc";

-- AlterTable
ALTER TABLE "ordenes" DROP COLUMN "upc";

-- Limpia el permiso huérfano `modelos.codigos-barra` (ya no está en el catálogo de src/contrato).
DELETE FROM "roles_permisos"
WHERE "id_permiso" IN (SELECT "id" FROM "permisos" WHERE "clave" = 'modelos.codigos-barra');

DELETE FROM "permisos" WHERE "clave" = 'modelos.codigos-barra';
