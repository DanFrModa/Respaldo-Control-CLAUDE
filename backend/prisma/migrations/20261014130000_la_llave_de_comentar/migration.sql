-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Fila 0.238 · LA LLAVE DE COMENTAR: `listas.comentar` para «Gerente de Ventas» (§Post-F9.248(b) de
-- Documentacion_MJD/DECISIONES.md)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE (y no basta con el seed):
--   Daniel, sobre Aurora: «las listas negociar solo de lectura y poder agregar comentarios, pero no
--   modificar lo que yo hice». La 0.238 crea `listas.comentar` y el seed se la da al perfil de puesto
--   «Gerente de Ventas». Pero ese perfil es rol DEL DUEÑO (`es_sistema = false`): el seed lo siembra
--   CREAR-SI-NO-EXISTE y, en `prueba`, donde ya existe con permisos, lo SALTA. Sin esta migración la
--   llave no le llegaría a Aurora más que con un paso manual en Administración › Roles.
--   (Mismo motivo que `20261003120000_las_11_llaves_de_daniel`.)
--
-- POR QUÉ CREA LA FILA DEL PERMISO: en `prueba` las migraciones corren ANTES del seed, y el seed es
--   quien siembra el catálogo; sin esto `listas.comentar` no existiría todavía y no habría qué dar.
--   Sólo se crea si `listas.negociar` ya existe (base con catálogo sembrado). El seed después hace
--   `upsert` por clave; descripción y módulo van IGUALES a `src/contrato/permisos.ts`.
--   (Mismo patrón que `20261006120000_la_llave_de_ventas`.)
--   • Base NUEVA (CI, producción): no hay catálogo ⇒ no crea nada, cero filas, sin error. El seed crea
--     el catálogo y los roles ya con `listas.comentar`.
--
-- SÓLO A «Gerente de Ventas», Y SÓLO SI YA TIENE AL MENOS UN PERMISO (`WHERE EXISTS`): un rol
--   cascarón con cero permisos lo llena entero el seed; meterle aquí una llave lo haría parecer
--   «ya afinado» y el seed lo saltaría. Directivo y Gerencial (que negocian) la reciben del seed, que
--   re-sincroniza los roles de sistema; los de acceso total, por derivación del catálogo.
--
-- ES ADITIVA: sólo AGREGA, nunca quita ni modifica. Idempotente: `ON CONFLICT DO NOTHING` en las dos
--   tablas.
--
-- UNA SOLA SENTENCIA: las CTE que modifican datos no ven lo que inserta otra CTE de la misma
--   sentencia, por eso el id de la llave sale del `RETURNING` (si es nueva) UNIDO a la fila que ya
--   existiera (si la migración se repite).
--
-- RASTRO (A7): una entrada de bitácora si EFECTIVAMENTE se le agregó, `id_usuario` NULL (la escribe
--   el despliegue, no una persona), igual que sus dos precedentes.
-- ════════════════════════════════════════════════════════════════════════════════════════════

WITH "catalogo" AS (
  SELECT "id" FROM "permisos" WHERE "clave" = 'listas.negociar'
),
"llave_nueva" AS (
  INSERT INTO "permisos" ("clave", "descripcion", "modulo", "modificado_en")
  SELECT 'listas.comentar',
         'Agregar comentarios a la negociación de una lista (a la lista o a un modelo). No cambia precios, estados, acuerdos, la mesa ni cotizaciones; los comentarios no se editan ni se borran',
         'listas',
         CURRENT_TIMESTAMP
   WHERE EXISTS (SELECT 1 FROM "catalogo")
  ON CONFLICT ("clave") DO NOTHING
  RETURNING "id"
),
"llave_comentar" AS (
  SELECT "id" FROM "llave_nueva"
  UNION ALL
  SELECT "id" FROM "permisos" WHERE "clave" = 'listas.comentar'
),
"insertadas" AS (
  INSERT INTO "roles_permisos" ("id_rol", "id_permiso")
  SELECT r."id", c."id"
    FROM "roles" r
   CROSS JOIN "llave_comentar" c
   WHERE r."nombre" = 'Gerente de Ventas'
     AND EXISTS (SELECT 1 FROM "roles_permisos" rp WHERE rp."id_rol" = r."id")
  ON CONFLICT ("id_rol", "id_permiso") DO NOTHING
  RETURNING "id_rol"
)
INSERT INTO "bitacora" ("entidad", "id_entidad", "accion", "datos", "id_usuario")
SELECT 'Rol',
       i."id_rol"::text,
       'MODIFICAR'::"accion_bitacora",
       jsonb_build_object(
         'operacion', 'agregarPermisos',
         'nombre', r."nombre",
         'clavesAgregadas', jsonb_build_array('listas.comentar'),
         'motivo', 'fila 0.238 · comentar la negociación sin negociarla §Post-F9.248(b)',
         'migracion', '20261014130000_la_llave_de_comentar'
       ),
       NULL
  FROM "insertadas" i
  JOIN "roles" r ON r."id" = i."id_rol";
