-- Migración de DATOS (no de esquema): alinea los catálogos SEMBRADOS con el vocabulario unificado.
--
-- Contexto: en la tanda del 25-jul-2026 se unificó el vocabulario visible (Daniel, dueño):
-- "Estampador/Bordador" → **Prov. de Arte** y "Habilitación" → **Avíos**. Los nombres nuevos
-- entraron en `prisma/seed.ts`, pero el seed hace `upsert` con `update: {}` — es decir, NO pisa el
-- nombre de un registro que ya existe (a propósito: pudo editarse en producción). Resultado: las
-- bases que YA existen (`prueba` y producción) se quedaban con el nombre viejo y había que
-- editarlas a mano desde Administración. Daniel pidió que se actualice solo.
--
-- Criterio: el UPDATE es CONDICIONAL A PROPÓSITO — solo toca el renglón si todavía conserva el
-- nombre viejo EXACTO (el que sembró el seed). Si alguien ya lo personalizó a otra cosa, se
-- respeta su texto: esta migración jamás pisa una edición del usuario.
--
-- Solo cambia el NOMBRE VISIBLE. Las claves estables (`codigo` / `clave`) no se tocan: son la
-- llave natural por la que busca el dominio.
--
-- Idempotente: re-correrla no cambia nada (el WHERE ya no encuentra filas).

-- 1) Roles de proveedor (F1-E1B): el taller que estampa o borda es un "Prov. de Arte".
UPDATE roles_proveedor
   SET nombre = 'Prov. de Arte (estampado)'
 WHERE codigo = 'estampado'
   AND nombre = 'Estampado';

UPDATE roles_proveedor
   SET nombre = 'Prov. de Arte (bordado)'
 WHERE codigo = 'bordado'
   AND nombre = 'Bordado';

-- 2) Reactivos del checklist de ficha técnica (F7-E4): "habilitación" → "avíos".
UPDATE checklist_ficha_def
   SET etiqueta = 'Información de avíos'
 WHERE clave = 'InfHab'
   AND etiqueta = 'Información de habilitación';

UPDATE checklist_ficha_def
   SET etiqueta = 'Medidas de avíos'
 WHERE clave = 'Medidas'
   AND etiqueta = 'Medidas de habilitación';
