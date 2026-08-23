-- Limpieza de PERMISOS HUÉRFANOS: 6 claves retiradas del catálogo tipado (src/contrato) que quedaron
-- como filas inertes en `permisos` de los ambientes ya desplegados (prueba). El seed ya no las
-- referencia y la sesión las filtra (cargarPermisosDeUsuario descarta las claves fuera del catálogo),
-- así que son inofensivas, pero se borran para no dejar basura.
--
-- La FK roles_permisos → permisos es onDelete: Restrict, por lo que PRIMERO se sueltan los enlaces
-- residuales (si un rol viejo aún las tuviera asignadas) y LUEGO las filas de permiso. Idempotente:
-- correrla dos veces no borra nada la segunda vez.

DELETE FROM "roles_permisos"
WHERE "id_permiso" IN (
  SELECT "id" FROM "permisos"
  WHERE "clave" IN (
    'cortadores.ver',
    'cortadores.administrar',
    'maquileros.ver',
    'maquileros.administrar',
    'maquileros.programar',
    'maquileros.alta-asegurados'
  )
);

DELETE FROM "permisos"
WHERE "clave" IN (
  'cortadores.ver',
  'cortadores.administrar',
  'maquileros.ver',
  'maquileros.administrar',
  'maquileros.programar',
  'maquileros.alta-asegurados'
);
