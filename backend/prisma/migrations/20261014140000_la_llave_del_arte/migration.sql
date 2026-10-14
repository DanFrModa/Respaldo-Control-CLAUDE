-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Fila 0.235 · LA LLAVE DEL ARTE: `modelos.arte`, partida de `modelos.administrar`
-- (§Post-F9.247(c) y §Post-F9.250(b) de Documentacion_MJD/DECISIONES.md)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE:
--   Daniel describió a Diseño Gráfico: «desarrolla todos los artes, define quién es el proveedor y
--   cotiza cuánto cuesta cada uno». Hasta la 0.235 el arte del modelo sólo se podía dar con
--   `modelos.administrar` (que abre además la ficha, las telas y los avíos de cualquier modelo) y
--   las fotos de arte de la orden con `desarrollo.administrar` (que abre proyectos y la receta de
--   la orden). La 0.235 crea `modelos.arte` y se la da al perfil de puesto «Diseño Gráfico».
--
-- Y LE DA TAMBIÉN `tipos-proceso.ver` (que ya existe en el catálogo): es la que llena el selector
--   de TIPO del diálogo de arte (`GET /tipos-proceso?soloArte=true`). Sin ella, Diseño Gráfico
--   tendría la llave del arte y no podría usar el diálogo. Sólo LEE el catálogo de tipos de proceso
--   (código, nombre, banderas, rol de proveedor; sin dinero): dos `GET` y nada más.
--
-- POR QUÉ NO BASTA EL SEED:
--   Los perfiles de puesto son roles DEL DUEÑO (§Post-F9.258): `sembrarPerfilesDePuesto`
--   (prisma/seed.ts) los siembra CREAR-SI-NO-EXISTE y un perfil que ya existe CON PERMISOS no se
--   vuelve a tocar. En `prueba` «Diseño Gráfico» ya existe ⇒ el seed lo salta. Esta migración le
--   lleva la llave. (Los roles de SISTEMA que la declaran —Directivo, Gerencial y los de acceso
--   total— la reciben del seed, que los re-sincroniza en cada arranque.)
--
-- POR QUÉ CREA LA FILA DEL PERMISO: en `prueba` las migraciones corren ANTES del seed, y el seed es
--   quien siembra el catálogo; sin esto `modelos.arte` no existiría todavía y no habría qué dar.
--   Sólo se crea si `modelos.administrar` ya existe (base con catálogo sembrado), con la MISMA
--   descripción y módulo que `src/contrato/permisos.ts`; el seed después hace `upsert` por clave.
--   • Base NUEVA (CI, producción): no hay catálogo ⇒ no crea nada, cero filas, sin error. El seed
--     crea el catálogo y el perfil ya con `modelos.arte`.
--
-- ES ADITIVA A PROPÓSITO — sólo AGREGA, nunca quita ni modifica:
--   ⚠️ NO le quita a Diseño Gráfico `modelos.administrar` ni `desarrollo.administrar` si Daniel se
--   los dio en pantalla (§Post-F9.250(b): «abre los permisos en lo que se construye»). Quitarlos es
--   decisión suya. No se toca la fila del rol (ni nombre, ni descripción, ni `es_sistema`).
--
-- SÓLO SI EL ROL YA TIENE AL MENOS UN PERMISO (`WHERE EXISTS`), igual que
--   `20261003120000_las_11_llaves_de_daniel`: un rol en CERO es un cascarón (p. ej. el rol
--   funcional de la Ruta Crítica antes de sembrarse el puesto) y el seed lo llena ENTERO; si aquí se
--   le metiera una llave, el seed lo vería «con permisos», lo saltaría y el puesto nacería con una
--   llave en vez de su perfil completo.
--   ⚠️ El nombre es «Diseño Gráfico» CON acento: el rol funcional de la RC «Diseño Grafico» (sin
--   acento) es OTRA fila y no se toca.
--
-- Idempotente: `ON CONFLICT DO NOTHING` en las dos tablas.
--
-- UNA SOLA SENTENCIA, A PROPÓSITO (mismo molde que `20261006120000_la_llave_de_ventas`): las CTE que
--   modifican datos no ven lo que inserta otra CTE de la misma sentencia, por eso el id de la llave
--   sale del `RETURNING` (si es nueva) UNIDO a la fila que ya existiera (si la migración se repite),
--   y la bitácora escribe la clave literal en vez de leerla de `permisos`.
--
-- RASTRO (A7): una entrada de bitácora por rol al que EFECTIVAMENTE se le agregó algo, con las claves
--   que de verdad se agregaron, `id_usuario` NULL (la escribe el despliegue, no una persona).
-- ════════════════════════════════════════════════════════════════════════════════════════════

WITH "catalogo" AS (
  SELECT "id" FROM "permisos" WHERE "clave" = 'modelos.administrar'
),
"llave_nueva" AS (
  INSERT INTO "permisos" ("clave", "descripcion", "modulo", "modificado_en")
  SELECT 'modelos.arte',
         'Capturar y editar el arte de los modelos (estampado/bordado, proveedor, costo y fotos del arte) y las fotos de arte de la orden, sin tocar la ficha, las telas ni los avíos',
         'modelos',
         CURRENT_TIMESTAMP
   WHERE EXISTS (SELECT 1 FROM "catalogo")
  ON CONFLICT ("clave") DO NOTHING
  RETURNING "id"
),
"llaves_a_dar" ("id", "clave") AS (
  SELECT "id", 'modelos.arte' FROM "llave_nueva"
  UNION ALL
  SELECT "id", "clave" FROM "permisos" WHERE "clave" IN ('modelos.arte', 'tipos-proceso.ver')
),
"insertadas" AS (
  INSERT INTO "roles_permisos" ("id_rol", "id_permiso")
  SELECT r."id", l."id"
    FROM "roles" r
   CROSS JOIN "llaves_a_dar" l
   WHERE r."nombre" = 'Diseño Gráfico'
     AND EXISTS (SELECT 1 FROM "roles_permisos" rp WHERE rp."id_rol" = r."id")
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
         'clavesAgregadas', jsonb_agg(l."clave" ORDER BY l."clave"),
         'motivo', 'fila 0.235 · el arte con llave propia, partida de modelos.administrar §Post-F9.247(c)',
         'migracion', '20261014140000_la_llave_del_arte'
       ),
       NULL
  FROM "insertadas" i
  JOIN "roles" r        ON r."id" = i."id_rol"
  JOIN "llaves_a_dar" l ON l."id" = i."id_permiso"
 GROUP BY i."id_rol", r."nombre";
