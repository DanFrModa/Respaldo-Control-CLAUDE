-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Fila 0.250 · LAS 11 LLAVES QUE DANIEL ACEPTÓ (§Post-F9.260 de Documentacion_MJD/DECISIONES.md)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN (y no basta con el seed):
--   Los 15 perfiles de puesto son roles DEL DUEÑO, no del sistema (§Post-F9.258): nacen
--   `es_sistema = false` y `sembrarPerfilesDePuesto` (prisma/seed.ts) los siembra
--   CREAR-SI-NO-EXISTE — un perfil que ya existe CON PERMISOS no se vuelve a tocar, para no
--   pisar lo que el dueño afine desde Administración › Roles. Por eso agregar las 11 llaves a
--   `PERFILES_DE_PUESTO` sólo alcanza a una base NUEVA: en `prueba` los perfiles ya existen y el
--   seed los salta. Esta migración lleva las 11 a esos roles ya sembrados.
--
-- ES ADITIVA A PROPÓSITO — sólo AGREGA, nunca quita ni modifica:
--   Daniel pudo haber movido esos roles en pantalla y no sabemos qué. Lo que haya, se respeta:
--   una llave que él quitó y NO es de las 11 sigue quitada; una que agregó sigue puesta. No se
--   toca la fila del rol (ni nombre, ni descripción, ni `es_sistema`, ni `modificado_en`).
--
-- SÓLO A ROLES QUE YA TIENEN AL MENOS UN PERMISO — y es lo que la hace segura en todo caso:
--   • Base nueva (CI, producción): la migración corre ANTES del seed, los roles no existen ⇒ cero
--     filas, sin error. Después el seed los crea ya con las 11.
--   • Rol que existe con CERO permisos (un cascarón, p. ej. «Habilitaciones» como rol funcional
--     de la Ruta Crítica antes de que se sembraran los puestos): NO se toca. Si se le metieran
--     aquí dos llaves, el seed lo vería «con permisos», lo saltaría y el puesto nacería con dos
--     llaves en vez de su perfil completo. Vacío, el seed lo llena entero — 11 incluidas.
--
-- Idempotente: `ON CONFLICT DO NOTHING` sobre la PK (id_rol, id_permiso). Si el rol o el permiso
-- no existen, el JOIN simplemente no produce el par.
--
-- RASTRO (A7): una entrada de bitácora por cada rol al que EFECTIVAMENTE se le agregó algo, con
-- las claves agregadas. `id_usuario` NULL: no la hizo una persona desde la pantalla, la hizo esta
-- migración (mismo criterio que 20260726130000 y 20260815140000).
-- ════════════════════════════════════════════════════════════════════════════════════════════

WITH "decisiones" ("nombre_rol", "clave") AS (
  VALUES
    ('Encargado de Telas',            'compras.ver'),
    ('Producción',                    'compras.ver'),
    ('Producción',                    'rc.bandeja-completa'),
    ('Supervisor de Calidad',         'calidad.generar-auditorias'),
    ('Habilitaciones',                'compras.recibir'),
    ('Habilitaciones',                'compras.ver'),
    ('Líder de Calidad',              'calidad.administrar-catalogo'),
    ('Gerente de Ventas',             'clientes.administrar'),
    ('Compras',                       'proveedores.administrar'),
    ('Compras',                       'compras.cancelar'),
    ('Almacén de Producto Terminado', 'produccion.empaque')
),
"insertadas" AS (
  INSERT INTO "roles_permisos" ("id_rol", "id_permiso")
  SELECT r."id", p."id"
    FROM "decisiones" d
    JOIN "roles" r    ON r."nombre" = d."nombre_rol"
    JOIN "permisos" p ON p."clave" = d."clave"
   WHERE EXISTS (SELECT 1 FROM "roles_permisos" rp WHERE rp."id_rol" = r."id")
  ON CONFLICT ("id_rol", "id_permiso") DO NOTHING
  RETURNING "id_rol", "id_permiso"
)
INSERT INTO "bitacora" ("entidad", "id_entidad", "accion", "datos", "id_usuario")
SELECT 'Rol',
       i."id_rol"::text,
       'MODIFICAR'::"accion_bitacora",
       jsonb_build_object(
         'operacion', 'agregarPermisos',
         'nombre', r."nombre",
         'clavesAgregadas', jsonb_agg(p."clave" ORDER BY p."clave"),
         'motivo', 'fila 0.250 · decisiones de Daniel §Post-F9.260',
         'migracion', '20261003120000_las_11_llaves_de_daniel'
       ),
       NULL
  FROM "insertadas" i
  JOIN "roles" r    ON r."id" = i."id_rol"
  JOIN "permisos" p ON p."id" = i."id_permiso"
 GROUP BY i."id_rol", r."nombre";
