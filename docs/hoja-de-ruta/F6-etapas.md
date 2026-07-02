# F6 — Calidad + EsMa · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Entrega de la fase (plan §6):** AQL configurable + estado de cuenta completo de maquileros (abonos, descuentos, pagos, impresos).
> **Criterio de salida:** EsMa cuadra contra los recibos del periodo.
> **Estado:** ⬜ pendiente — el desglose se confirma/ajusta al arrancar la fase.
>
> **⚠️ Actualización 14-jun-2026 (fusión de terceros, D12/R15):** los "maquileros" de EsMa son ahora **`Proveedor` con rol de maquila** (ya no existe la tabla `Maquilero`); el estado de cuenta y los recibos de pago se ligan a ese proveedor. Toda mención de abajo a "maquileros" se refiere a esos proveedores filtrados por rol. Ver `DECISIONES.md` D12/R15.

> **⚠️ DECISIONES DE NEGOCIO CERRADAS CON DANIEL — 2026-06-24 (relayed por Gabriel).** Las 8 preguntas de la fase quedaron resueltas; varias **modifican el diseño descrito en las etapas de abajo** — el detalle canónico está en **`DECISIONES.md` §"Decisiones de negocio de F6" (a)–(h)**. Deltas a aplicar (mandan sobre el texto original de cada etapa):
> - **(a) E2 — resultado MANUAL, no automático:** el auditor marca defectos pero **decide a mano** aprobar/reprobar con comentarios. El cálculo por nivel AQL queda como **sugerencia informativa** (y metadato para KPIs F7), **no vinculante**. La **severidad NO entra** en ningún veredicto.
> - **(b) E1/E2 — muestra automática con default; cambiarla requiere autorización (permiso).** La tabla AQL sirve para la **muestra**, no para el veredicto.
> - **(c) E1 — un solo plan para todos:** misma exigencia para todos los clientes y productos → **se cae** la asignación de plan por cliente/tipo de producto y el resolver en cascada. Queda **plan único default**.
> - **(d) E1/E2 — defectos por tipo de producto:** catálogo nuevo **`TipoProducto`** (corto/editable), **defectos etiquetados** por tipo (+ "general"); el tipo **viene del modelo por default** (campo en `Modelo`) con **override en la auditoría**; el alta pre-carga defectos del tipo + generales. (El "tipo de producto" ya **no** es para el plan AQL —ver (c)—, solo para filtrar defectos.)
> - **(e) E4 — estampado a su propio precio** (`AplicacionOrd`, por orden, puede variar): confirma el **fix del bug v1**. Cierra la consulta (a) de las notas.
> - **(f) E4 — `Orden.pagada` derivada + casilla de forzar estatus (excepciones) + "segundas" sin costo.** Ajusta el supuesto (5). Liga Calidad↔EsMa (lo reclasificado a 2ª no se le paga al maquilero).
> - **(g) E4 — pagos duplicados se BLOQUEAN, no solo se avisan:** modelo de **"prendas por pagar"** ligado a recibos (al pagar se descuentan; re-pagar lo mismo = **error**).
> - **(h) E4/E5 — pagador = FR Moda (config empresa); con/sin factura por proveedor; proveedor "ambos" → DOS estados de cuenta.** Flag **`conFactura`** en movimientos + **modalidad de facturación** en el proveedor (R15); el edo. de cuenta de E5 se **segmenta** por factura.
> - **Pendiente operativo (no bloquea):** Daniel entrega la **lista inicial** de tipos de producto (se siembra una corta y editable mientras).

## F6-E1 · Calidad — catálogo de defectos + motor de planes AQL + consulta de bitácora (vertical) — ✅ HECHA (24-jun-2026)

> **NOTA DE CIERRE (F6-E1, 24-jun-2026 — 1 coder + 1 reviewer independiente; pendiente verificación de Gabriel en `prueba`).** Quedó construida la base configurable de Calidad + la lectura de bitácora (transversal), con las decisiones (a)–(d) de Daniel YA aplicadas.
>
> **Qué entregó:**
> - **Migración aditiva `20260624120000_f6_e1_calidad_catalogos`** (6 tablas + 1 columna NULLABLE): `DefectoCatalogo` (clave única, descripción, pag, `nivelAQL` Decimal 1.0/2.5/10, favorito, categoría, `severidad` enum `critico|mayor|menor` —METADATO, NO veredicto, decisión (a)—, `aplicaGeneral`, activo, A7); `TipoProducto` (catálogo corto/editable, decisión (d)); puente M:N `DefectoTipoProducto`; motor de planes `PlanMuestreoAQL` + `PlanMuestreoRenglon` (rango de lote → muestra; `loteMax` null = rango abierto) + `PlanMuestreoLimite` (Ac/Re POR NIVEL AQL, único por `(renglon, nivel)`); y `Modelo.idTipoProducto` **NULLABLE sin default** (no rompe modelos existentes, decisión (d)). SQL escrito a mano y validado byte-a-byte contra `prisma migrate diff` (sin BD local).
> - **Dominio (A1)** `dominio/calidad/{tipos-producto,defectos,planes-aql}.ts`: CRUD con **borrado SUAVE** (un defecto/tipo/plan con historia NO se borra físico), transacción + auditoría + bitácora juntas (A2/A7), unicidad insensible a mayúsculas. `servicioPlanesAQL.resolverPlan(lote, nivel)` = **plan default activo** (sin cascada por cliente/tipo, decisión (c)) → localiza el renglón por lote y devuelve `tamanoMuestra` (lo VINCULANTE, decisión (b)) + `aceptar`/`rechazar` de ESE nivel (REFERENCIA — el veredicto es manual en E2, decisión (a)). Validación de coherencia de renglones (rangos sin solape, Re>Ac, un nivel por renglón). El **etiquetado de defectos por tipo** (decisión (d)): el defecto aplica a los tipos ligados, o a TODOS si `aplicaGeneral`; al editar se reescribe el set de ligas en la tx.
> - **Bitácora (transversal):** `dominio/admin/bitacora.ts` (lectura del motor A7 que F0 solo escribía) + `GET /api/admin/bitacora` (paginado, filtros entidad/folio/usuario/acción/fechas, resuelve el nombre del usuario) — porque las verificaciones de E2–E5 la necesitan (Gabriel no consulta SQL).
> - **Rutas REST** `/api/calidad/{defectos,tipos-producto,planes-aql}` (+ `GET …/planes-aql/resolver`) con Zod→OpenAPI; **permisos NUEVOS** `calidad.ver` / `calidad.administrar-catalogo` (catálogo) y `admin.ver-bitacora` (módulo nuevo `admin`), **deny-by-default** verificados server-side (A4). El catálogo lo escribe solo `calidad.administrar-catalogo`; el seed de roles resta `calidad.administrar-catalogo` a Directivo↓ (mismo reparto que los demás catálogos).
> - **Seed (idempotente):** lista corta y editable de **tipos de producto** + **UN plan AQL default** ISO 2859-1 **nivel general II** (AQL 1.0/2.5/10) cargado como DATOS (tabla simple, sin motor estadístico). **NO siembra defectos** (los 40 reales los carga el ETL de E6).
> - **Frontend (teal lista+detalle):** Catálogo de defectos (filtros severidad/nivel/favoritos; multiselect de tipos de producto o casilla "general"), Tipos de producto, Planes AQL (con **preview en vivo** lote+nivel → muestra/límites), Consulta de bitácora (bajo Administración), + selector de **tipo de producto** en el diálogo de Modelos. Menú y rutas registrados; `login.spec`/`catalogo.test` ajustados.
> - **Contrato** OpenAPI regenerado + cliente del frontend sincronizado. **Tests:** unitarios de contrato (niveles AQL/severidad/plan), de integración de dominio (borrado suave, etiquetado M:N, resolución por nivel con los casos de la tabla, bitácora) y de API (deny-by-default 403, CRUD por HTTP, resolución del plan default sembrado), + componente (Vitest) y E2E (Playwright) del ciclo de defectos.
>
> **Decisiones de modelado (para el reviewer):** la **clasificación de modelos** (supuesto (7) de la fase) se resolvió con un **catálogo nuevo `TipoProducto`** (decisión (d) de Daniel) en lugar de reusar género/familia — el tipo se hereda del modelo y servirá para filtrar defectos en E2 (NO para el plan AQL, que es único, decisión (c)). La tabla de muestreo se normalizó en renglón (rango→muestra) + límite (nivel→Ac/Re) para que cada nivel AQL tenga su propio par, como en ISO 2859. La severidad quedó como enum informativo, fuera de todo veredicto.
>
> **NO toca / deja para después:** SIN ETL (los 40 defectos reales y el histórico de auditorías son **F6-E6**); el **núcleo de auditorías** (alta con folio, captura, integración RC, reclasificación) es **F6-E2**; la ubicación final del módulo de Calidad sigue siendo D8 (pendiente). El borrado en R2 de adjuntos huérfanos (deuda global) no aplica aquí.

**Objetivo:** Construir la base configurable del módulo de Calidad: el catálogo de defectos enriquecido (severidad/categoría) y el motor NUEVO de planes de muestreo AQL como DATOS parametrizables (no código), más una pieza transversal pequeña: la consulta de bitácora (F0 entregó el motor A7 solo como escritura en backend, sin endpoint ni pantalla de lectura). Va primero porque las auditorías de E2 consumen catálogo y planes, y TODAS las verificaciones de bitácora de la fase (E2–E5) necesitan esta pantalla para que Gabriel compruebe la auditoría A7 sin SQL.

**Alcance:**
- Tablas Prisma (migración nueva): DefectoCatalogo (clave, descripcion, pag, nivelAQL numérico, favorito, categoria, severidad critico/mayor/menor, activo, auditoría A7, idEmpresa A9). La severidad es METADATO informativo (categorización y KPIs de F7): NO entra en la fórmula del resultado de la auditoría (doc 09 §2)
- Tablas Prisma: PlanMuestreoAQL (nombre, activo) + PlanMuestreoRenglon (rango tamaño de lote → tamaño de muestra → límite aceptar/rechazar POR NIVEL AQL) + asignación del plan por cliente y/o tipo de producto, con plan default del sistema. ANTES de diseñar la tabla de asignación: verificar qué clasificación de modelos entregó F1 — la documentación NO define ninguna (01-Modelos.md solo tiene IdTemporadas; 'género' solo se usa para listas de precios vía EscojerGenero; plan §5 módulo 2 tampoco la define). Si F1 no la entregó, decidir en esta etapa con Gabriel/Daniel el atributo destino (género, familia, o un catálogo nuevo 'tipo de producto' DENTRO del alcance de E1) — deuda explícita, no se absorbe en silencio
- Seed: un plan AQL default basado en ISO 2859 simplificado (nivel general II, AQL 1.0 / 2.5 / 10) cargado como datos — referencia explícita del riesgo 'no sobre-diseñar': tabla simple, configurable, sin motor estadístico
- Servicios dominio backend/src/dominio/calidad/: servicioDefectos (CRUD con borrado suave; regla: defecto con auditorías históricas NO se borra físico, solo inactivo) y servicioPlanesAQL (resolver plan aplicable: cliente → tipo de producto → default; y dado tamaño de lote + nivel AQL devolver tamaño de muestra y límites acepta/rechaza de ESE nivel) — lógica SOLO en dominio (A1)
- Endpoints REST backend/src/api/calidad/: /api/calidad/defectos (CRUD paginado patrón Almacenes) + /api/calidad/planes-aql (CRUD con renglones) + GET de resolución/preview (lote+nivel → muestra/límites). RBAC server-side en cada ruta (A4): permisos nuevos calidad.ver y calidad.administrar-catalogo agregados al catálogo en backend/src/contrato/permisos.ts
- TRANSVERSAL — lectura de bitácora: endpoint GET /api/admin/bitacora (solo lectura, paginado, filtros por entidad/folio/usuario/rango de fechas, permiso de administración, A4) + pantalla mínima 'Consulta de bitácora' (solo lectura, patrón de consulta del patrón CRUD). Verificado: backend/src/api solo tiene almacenes/auth/salud/sesion y frontend/src no tiene ninguna pantalla de bitácora — el motor A7 (backend/src/comun/auditoria.ts) solo escribe
- Pantallas frontend (patrón docs/modulos/patron-crud.md): CRUD Catálogo de defectos (PC; en móvil solo consulta), Configuración de planes AQL (pantalla NUEVA sin referencia vieja, con preview en vivo de la tabla de muestreo) y Consulta de bitácora
- Regeneración del contrato: backend/openapi.json + frontend/src/api/esquema.gen.ts sincronizados en esta misma etapa

**Entregables:**
- Migración Prisma 'calidad-catalogos' aplicable en limpio + seed del plan AQL default
- Servicios servicioDefectos y servicioPlanesAQL con TSDoc (referencia a doc 09 y MEJORAS 09) + tests unitarios y de integración (testcontainers): resolución del plan en los 3 niveles de prioridad y los límites correctos POR NIVEL AQL para casos de tabla conocidos
- Endpoint GET de bitácora + pantalla de consulta (solo lectura) con tests de integración y de componente
- Rutas REST con Zod→OpenAPI + tests de integración de API (permisos deny-by-default incluidos)
- Decisión documentada de la dimensión 'tipo de producto' para la asignación de planes (atributo existente de F1 o catálogo nuevo creado aquí)
- openapi.json regenerado y cliente tipado del frontend re-generado (npm run gen:api) sin errores de compilación
- 3 pantallas con tests de componente (Vitest) + E2E Playwright del ciclo CRUD de defectos
- CI en verde en la PR a prueba

**Criterio de cierre:**
- Un defecto se crea/edita/desactiva/reactiva end-to-end con severidad y categoría, y la lista pagina/busca en servidor
- Un plan AQL con renglones se configura por pantalla y el preview devuelve muestra y límite correctos (por nivel) para un lote dado
- servicioPlanesAQL resuelve cliente → tipo de producto → default (probado con tests), con la dimensión 'tipo de producto' decidida y documentada
- La pantalla de consulta de bitácora muestra los registros A7 existentes (p. ej. los cambios del CRUD de Almacenes de F0) filtrando por entidad
- Usuario sin calidad.administrar-catalogo no ve acciones de escritura y el API se las rechaza (403)
- Contrato OpenAPI regenerado y cliente del frontend sincronizado; CI verde; visto bueno del reviewer

**Verificación de Gabriel:**
- [ ] docker compose up -d --build y entrar como admin a la app local
- [ ] Abrir Calidad → Catálogo de defectos: crear un defecto con severidad 'mayor' y categoría, editarlo, desactivarlo, mostrar desactivados y reactivarlo (ciclo completo del patrón)
- [ ] Abrir Calidad → Planes AQL: crear un plan con 3 renglones (p. ej. lote 281–500 → muestra 50 → acepta 3 / rechaza 4 en AQL 2.5) y en el preview capturar lote=400 y AQL=2.5 → verificar que devuelve exactamente muestra 50 y límite 3/4
- [ ] Asignar el plan a un cliente de prueba (catálogo de F1) y verificar que el resolver lo elige sobre el default
- [ ] Abrir Administración → Consulta de bitácora: editar un almacén (CRUD de F0), refrescar la bitácora filtrando por entidad 'Almacen' y verificar que el cambio aparece con usuario y fecha
- [ ] Entrar con un usuario sin permiso de administrar: confirmar que solo consulta (sin botón Nuevo ni acciones de fila)
- [ ] Abrir /api/docs (Swagger) y confirmar que aparecen las rutas nuevas de calidad y la de bitácora

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI del mismo grupo; sin paralelizar). Esta etapa PUEDE correr en paralelo con E4 (EsMa) — módulos independientes; conviene CERRARLA PRIMERO: es la más ligera y su pantalla de bitácora la usan las verificaciones de E2–E5

**Referencias:**
- Documentacion_MJD/09-Control-de-Calidad.md §2 (CC_Catalogo y la regla 'NumFallas por tipo de defecto vs AQL') y §5.2/§5.4 (AQL parametrizable, catálogo con categorías/severidad)
- Documentacion_MJD/01-Modelos.md (la tabla Modelos NO tiene clasificación de producto: solo IdTemporadas; género solo en listas de precios) — base del supuesto a verificar contra lo entregado por F1
- Documentacion_MJD/MEJORAS.md — sección módulo 09
- PLANMAESTRO.md §5 módulo 8 ('AQL configurable por cliente/producto') y §9.2 (estándares)
- docs/modulos/patron-crud.md (plantilla de las 3 pantallas)
- backend/src/comun/auditoria.ts (motor A7 de F0 — solo escritura; la lectura se construye aquí)
- A1 (lógica solo en dominio), A4 (RBAC server), A7 (auditoría uniforme), A9 (idEmpresa)
- Respaldo CLAUDE/TABLAS/CC_Catalogo.csv (40 filas reales; columna AQL en texto LIMPIO: solo '1', '2.5' y '10' — referencia de forma, el ETL es de E6)
- Riesgo del inventario: el cálculo AQL NO existe en v1 — diseñar como datos (ISO 2859 simplificado), sin sobre-ingeniería

---

## F6-E2 · Calidad — núcleo de auditorías: alta con folio atómico + resultado MANUAL + integración RC + reclasificación (vertical) — ✅ HECHA (27-jun-2026)

> **NOTA DE CIERRE (F6-E2, 27-jun-2026 — 1 coder + 1 reviewer independiente APROBÓ; pendiente verificación de Gabriel en `prueba`).** El corazón transaccional de la auditoría de calidad, con la decisión (a) de Daniel YA aplicada (resultado MANUAL, no calculado).
>
> **Qué entregó:**
> - **Migración aditiva `20260626120000_f6_e2_calidad_auditorias`** (2 enums + 2 tablas): `Auditoria` (folio `numAuditoria` por **secuencia atómica por empresa A3** —reemplaza el `Max()+1`/`AumentarNumAudit` del viejo—, FKs `idEmpresa`/`idOrden`/`idMaquilero`, `elaboroPorId`+`auditorPorId` doble responsable, `tamanoMuestra`+`muestraManual`, `resultado` enum aprobado/reprobado/no_calificado, `resultadoManual`, `tipoAuditoria` enum en_piso/final/no_definida, `observaciones`, `cancelada` borrado suave; UNIQUE `(idEmpresa, numAuditoria)`) + `AuditoriaDefecto` (idDefecto + numFallas, UNIQUE `(idAuditoria, idDefecto)`). SQL a mano == DDL canónico de Prisma (validado con `migrate diff`).
> - **Dominio (A1)** `dominio/calidad/auditorias.ts`: `crearAuditoria` (tx A2: folio A3 + trae la cantidad de la orden + propone maquileros desde las `EtapaMovimiento` reales de la orden + pre-carga TODOS los defectos favoritos activos con 0 fallas + muestra automática del plan default de E1 —decisión (b)—; bitácora A7) · `capturarResultado` (⚠️ **resultado MANUAL**, decisión (a): el humano fija aprobado/reprobado con observaciones; `calcularSugerenciaAql` es función PURA que suma fallas POR NIVEL —niveles distintos NO se mezclan, cada uno su Ac/Re— y se devuelve SOLO como sugerencia informativa, NUNCA pisa `resultado`; la severidad no entra; override de muestra gated por permiso) · `reclasificar` (Primeras↔Segundas vía **motor kardex directo** `registrarTraspasoPtMotor`; no-negativo en el almacén origen por suma directa bajo `pg_advisory_xact_lock` —D3, nunca edita existencias). Helper `resolverPlanPorLote` en `planes-aql.ts` (interno, no ruteado, clampa al primer renglón si el lote queda por debajo).
> - **Integración RC** (`dominio/ruta-critica/autoAvance.ts`): consume el evento `auditoria-calidad-resuelta` (publicado en CADA captura) y **re-evalúa el estado físico de forma idempotente** (filtrado a `tipoEvento=auditoria`): auditoría **final + aprobada + no cancelada** → completa el proceso de auditoría de la `RutaOrden` (fecha física = `fechaAuditoria`); cualquier otro estado → lo **des-completa**; no-op si no hay cambio.
> - **Rutas REST** `/api/calidad/auditorias` (GET contexto-de-orden, GET por id, POST alta, PATCH resultado, POST reclasificación) con Zod→OpenAPI; **SIN permisos nuevos** — reusa `calidad.generar-auditorias` (alta) y `calidad.actualizar-auditorias` (captura/override/reclasif), deny-by-default server-side (A4). `calidad.modificar-auditorias` queda para E3.
> - **Frontend (teal):** `AltaAuditoriaPagina` (alta responsive usable en piso/tablet) y `CapturaAuditoriaPagina` (grid defectos×fallas + sugerencia AQL por nivel en vivo —no vinculante— + tarjeta de reclasificación); tarjeta "Auditorías de calidad" en la portada de Calidad **gateada por `calidad.generar-auditorias`** (se cambió el filtro de `CalidadPagina` a gate por-tarjeta). Rutas en `App.tsx`; entrada de menú en `catalogo.ts`.
> - **Contrato** OpenAPI regenerado + cliente del frontend sincronizado. **Tests:** dominio (folio concurrente A3, favoritos activos, resultado manual≠sugerencia, RC final aprobada/reprobada/des-completa, traspaso kardex no-negativo), API (deny-by-default 403, alta+captura, rol solo-generar → 403 en captura), unitarios de la sugerencia AQL pura (5/5) y componente de la pantalla de captura (4/4), + e2e shallow (precedente `recibos-maquila.spec.ts`).
>
> **Ciclo coder+reviewer:** el reviewer halló 2 bloqueantes de frontend (typecheck `tsc -b` rojo por falta de `?.` en un `mock.calls`; tarjeta de auditorías ausente de la portada `CalidadPagina` → el `testid` del e2e no existía) → corregidos por el mismo coder (optional chaining + gate por-tarjeta con campo `permiso` por sub-vista) → reviewer **APROBÓ**. El núcleo de dominio/RC/migración pasó la revisión sin cambios.
>
> **⭐ AMPLIACIÓN "PT ligado a la orden" (27-jun/1-jul-2026, dentro de esta misma etapa/PR — Daniel respondió las 2 preguntas, `DECISIONES.md §F6 (i)/(j)`):** Daniel confirmó que **el inventario de PT debe quedar ligado a la orden de producción** (restaura el `IPT_Modelos.IdOrdenes` de v1, perdido al aplanar el ETL de F3-E6). Se construyó, sobre esta rama: columna NULLABLE `movimiento_det_pt.idOrden` (+FK `ordenes` RESTRICT + índices) + `existencia_pt` agrupa por orden (bucket `IS NULL` = histórico/manual); motor `kardex.ts` (`LineaMovimientoPt.idOrden`, `existenciaPtBloqueada`/`bloquearArticuloPt` con `IS NOT DISTINCT FROM` + orden en la clave del advisory lock); **recibo (F3-E4)/entrega (F3-E5)/reclasificación (E2) la pueblan**, manual/traspaso/ETL = NULL; **BACKFILL** en la migración que etiqueta los movimientos ya en `prueba` derivables de recibo/entrega (y las cancelaciones heredan del original). La **reclasificación de E2 ahora mueve SOLO lo de la orden auditada** (no el modelo entero) — objetivo de Daniel. Vista+consultas+2 pantallas de inventario (Existencias/Kardex PT) a la nueva grain. **ADR-0014** (enmienda ADR-0010). Migración `20260627120000_f6_e2_pt_por_orden`. Reviewer independiente **APROBÓ** (verificó backfill, `IS NOT DISTINCT FROM`, lock por orden, entrega/reclasif por orden, ripple). **(j)** Daniel confirmó que reclasificar es **independiente del veredicto** (la clasificación Primeras/Segundas se hace al recibir; ya era el comportamiento de E2). **Consecuencia intencional:** entrega se valida contra el stock de SU orden; el PT histórico (bucket NULL) no se entrega "por orden". **Enriquecer el histórico por orden = pendiente F9** (no bloquea).
>
> **Fix de e2e (regresión de la sub-vista nueva):** al agregar la tarjeta/enlace "Auditorías de calidad", el selector `getByRole('link', {name:'Calidad'})` de la navegación por el sidebar en `auditorias-calidad.spec.ts` y `calidad-defectos.spec.ts` matcheaba 2 enlaces ("Calidad" y "Auditorías de **calidad**") → strict mode violation → e2e del PR #81 rojo. Corregido con `exact: true` en ambos specs (fix de test, no de producto).
>
> **NO toca / deja para después:** consulta/listado de auditorías, impreso PDF (R9) y modificar/cancelar = **F6-E3**; el ETL del histórico (488 auditorías / 15,296 detalles) = **F6-E6**.

**Objetivo:** Entregar el corazón transaccional de la auditoría: alta con folio atómico y favoritos pre-cargados → captura de fallas → resultado CALCULADO POR NIVEL AQL contra el plan (con override auditado); conectado a la Ruta Crítica (auto-completar proceso) y al kardex (reclasificación Primeras/Segundas por traspaso). Va después de E1 porque consume catálogo y planes. La consulta, impresión y modificar/cancelar van en E3 para mantener la etapa en el tamaño de referencia.

**Alcance:**
- Tablas Prisma: Auditoria (folio numAuditoria por SECUENCIA por empresa A3 — reemplaza el Max()+1 de AumentarNumAudit; idOrden FK real; fechaElaboracion/fechaAuditoria; idMaquilero; elaboroPorId + auditorPorId doble responsable; tamanoMuestra; resultado aprobado/reprobado/no_calificado; tipoAuditoria en_piso/final/no_definida — los estados 'no definida'/'no calificado' se admiten por los datos históricos; resultadoManual bandera de override; observaciones; cancelada borrado suave; idEmpresa A9) + AuditoriaDefecto (idDefecto, numFallas)
- dominio/calidad/servicioAuditorias.crear: TRANSACCIÓN (A2) que genera folio (A3), trae la cantidad de la orden (ex TraerCant), propone maquilero desde las entregas de la orden pero deja ELEGIR entre los maquileros reales de la orden (mejora sobre PrimerMaq, riesgo del inventario), pre-inserta TODOS los defectos favoritos activos del catálogo (ex InsertarFav; hoy 33 favoritos con Favorito=1 — consistente con el histórico: 15,296 detalles / 488 auditorías ≈ 31 por auditoría) y registra elaboró (usuario de sesión) + auditor
- dominio/calidad/servicioAuditorias.capturarResultado — resultado calculado POR NIVEL AQL (doc 09 §2; ISO 2859: cada nivel AQL tiene su PROPIO número de aceptación/rechazo, NO existe suma ponderada): por cada nivel AQL presente en los defectos capturados, Σ numFallas de los defectos de ESE nivel se compara contra el límite acepta/rechaza del plan resuelto (E1) para ese nivel y el tamaño de muestra; REPROBADA si CUALQUIER nivel rebasa su número de rechazo, APROBADA si todos los niveles quedan dentro de su número de aceptación. La severidad del catálogo NO entra en la fórmula (metadato para categorización/KPIs F7). Override manual SOLO con permiso y registrado en Bitacora (A7) — en v1 era captura manual 1/2/0 (Res_AfterUpdate)
- Permisos granulares ya seedeados, verificados server-side en cada ruta (A4): calidad.generar-auditorias (ex acceso 11) gobierna el alta y calidad.actualizar-auditorias (ex 13) la captura de resultados; calidad.modificar-auditorias (ex 12) se aplica en E3 con modificar/cancelar
- dominio/calidad/integracionRC: auditoría FINAL aprobada → auto-completa el proceso 'auditoría de calidad' de la RutaOrden vía el motor de auto-avance de F5; reprobada NO completa el proceso y marca la orden en riesgo
- dominio/calidad/reclasificacion: si la auditoría reclasifica prendas Primeras↔Segundas, se genera TRASPASO de kardex entre almacenes (motor D3 de F3/F0), NUNCA edición de existencias — regla implícita en doc 09 §1/§4 y doc 03 paso 5 que aquí queda explícita y testeada
- Pantallas: Alta de auditoría (RESPONSIVE usable en tablet/móvil — la auditoría se hace en piso; ex CC_AltaAuditorias) y Captura de resultados (grid defectos × numFallas con el resultado POR NIVEL calculado en vivo: subtotal de fallas por nivel AQL vs su límite; ex CC_MeterAuditorias/Det)
- Endpoints /api/calidad/auditorias (alta + captura de resultados) y regeneración OpenAPI + cliente tipado en la misma etapa

**Entregables:**
- Migración Prisma 'calidad-auditorias' + secuencia de folio por empresa
- Servicios de dominio con TSDoc (referencia a doc 09 §2, D3, D10/D11, A2/A3/A7) + tests unitarios y de integración: folio consecutivo bajo concurrencia; favoritos pre-insertados = TODOS los activos del catálogo; cálculo del resultado POR NIVEL con casos límite explícitos (fallas de un nivel = su número de aceptación → aprobada; = su número de rechazo → reprobada; niveles mezclados donde un nivel aprueba y otro rebasa → reprobada; fallas de niveles distintos NO se suman entre sí; override); reprobada no completa RC; traspaso de kardex genera movimientos y no edita existencias
- Rutas REST con permisos por acción + tests de integración de API
- 2 pantallas con tests de componente + E2E Playwright del flujo alta→captura→resultado
- openapi.json + esquema.gen.ts regenerados; CI verde

**Criterio de cierre:**
- Una auditoría fluye: alta (folio automático, todos los favoritos pre-cargados, maquilero propuesto de las entregas reales) → captura de fallas → resultado calculado POR NIVEL contra el plan AQL de E1
- Caso límite verificado en vivo: con límite acepta 3 / rechaza 4 en un nivel, 3 fallas de ese nivel aprueban y 4 reprueban; fallas de niveles distintos no se suman entre sí
- Auditoría final aprobada completa solo el proceso de RC de la orden; reprobada no lo completa
- Reclasificación tras auditoría genera traspaso de kardex entre almacenes Primeras/Segundas (verificable en los movimientos)
- Los permisos viejos 11/13 gobiernan generar/actualizar tanto en UI como en API
- Override manual del resultado queda en Bitacora con usuario y motivo (verificable en la pantalla de bitácora de E1)
- CI verde + visto bueno del reviewer

**Verificación de Gabriel:**
- [ ] docker compose up -d --build; con una orden de prueba que ya tenga entregas/recibos de maquila (datos de F3): crear una auditoría y verificar: folio consecutivo, cantidad de la orden traída sola, lista de maquileros propuestos = los de las entregas de esa orden, y el grid pre-cargado con TODOS los defectos favoritos del catálogo (hoy 33)
- [ ] Con el plan de E1 (muestra 50, AQL 2.5 → acepta 3 / rechaza 4): capturar 3 fallas en un defecto de nivel 2.5 → el resultado debe ser Aprobada; subir a 4 fallas → Reprobada
- [ ] Capturar además 2 fallas en un defecto de nivel 10 (límite más holgado) y verificar que NO se suman a las del nivel 2.5: el resultado se evalúa nivel por nivel
- [ ] Forzar un override manual del resultado y confirmar que pide permiso y que queda registrado: abrir la pantalla Consulta de bitácora (E1) filtrando por entidad 'Auditoria' y ver el registro con usuario y motivo
- [ ] Abrir la Ruta Crítica de esa orden (pantalla de F5) y confirmar que el proceso de auditoría se marcó completado al aprobar; repetir con una auditoría reprobada y confirmar que NO se completa
- [ ] Reclasificar prendas a Segundas y revisar en Inventarios (F3) que aparece un TRASPASO entre almacenes (no cambió ninguna existencia a mano)
- [ ] Probar la pantalla de alta desde el celular o con devtools en modo móvil: que la captura en piso sea usable (grid scrolleable, botones alcanzables)
- [ ] Con un usuario sin calidad.actualizar-auditorias: intentar capturar resultados → bloqueado en UI y 403 en API

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI; depende de E1). Esta etapa PUEDE correr en paralelo con E5 (EsMa) — módulos independientes

**Referencias:**
- Documentacion_MJD/09-Control-de-Calidad.md §1 (flujo), §2 (modelo y la REGLA DEL RESULTADO: 'se cuentan las NumFallas por cada tipo de defecto del catálogo, y comparando contra el AQL se determina el Resultado' — conteo POR nivel/tipo, sin ponderación), §4 (conexiones), §5 (observaciones)
- Documentacion_MJD/03-Produccion.md paso 5 (el recibo clasifica Primeras/Segundas) — base de la regla de reclasificación por traspaso
- Formularios viejos: Respaldo CLAUDE/Respaldo CLAUDEFormularios/CC_AltaAuditorias.txt (VBA: AumentarNumAudit Max()+1, InsertarFav, TraerCant, PrimerMaq, PrP(11)/(13)), CC_MeterAuditorias(Det); módulo 'Funciones CC' (QueTipoAudit, QueResultado) — leer en latin-1
- backend/src/contrato/permisos.ts: calidad.generar-auditorias / calidad.actualizar-auditorias (ya seedeados en F0)
- A1, A2 (alta encabezado+favoritos en transacción), A3 (folio por secuencia — antipatrón exacto en v1), A4, A7 (override a bitácora), A9, D3 (traspaso, nunca edición), D10/D11 (RC como workflow)
- notasFase: la fórmula default es la regla por nivel del doc — cualquier variante (p. ej. ponderación por severidad) requiere confirmación de Daniel ANTES de arrancar esta etapa

---

## F6-E3 · Calidad — consulta e impresión (R9), historial por maquilero y modificar/cancelar (vertical) — ✅ HECHA (1-jul-2026)

> **NOTA DE CIERRE (F6-E3, 1-jul-2026 — 1 coder + 1 reviewer independiente APROBÓ; pendiente verificación de Gabriel en `prueba`).** Cierra la experiencia de usuario del módulo de Calidad sobre el núcleo transaccional de E2: consulta, impreso PDF (R9), historial por maquilero y modificar/cancelar. **SIN migración, SIN permisos nuevos, SIN re-seed** (reusa `calidad.ver` + `calidad.modificar-auditorias`, ya en el contrato/seed de F0) → el deploy a `prueba` de esta etapa **NO** requiere `SEED_ON_START`.
>
> **Qué entregó:**
> - **Dominio (A1)** `dominio/calidad/auditorias.ts` (ampliado): `listarAuditorias` (consulta **paginada y filtrada EN SERVIDOR** —folio de orden, maquilero, resultado, tipo, rango de fechas, `incluirCanceladas` que por defecto las excluye—, proyección **LIGERA** de resumen —sin cargar defectos ni calcular sugerencia por fila—, Σ fallas por un `groupBy` por página —sin N+1—, `orderBy` DETERMINISTA `numAuditoria desc, id desc`) · `historialPorMaquilero` (agregados + `porcentajeAprobacion = aprobadas/(aprobadas+reprobadas)*100`, solo CALIFICADAS, `null` si no hay —sin división por cero—, excluye canceladas, 404 si el maquilero no existe) · `modificarAuditoria` (permiso `calidad.modificar-auditorias`; edita solo ENCABEZADO —maquilero validado contra los reales de la orden, fechas, tipo, observaciones—, bloquea si `cancelada`, tx A2 + bitácora A7; **publica `auditoria-calidad-resuelta` al outbox en la misma tx** para que la RC se re-evalúe al cambiar el tipo —descubierto por el reviewer, ver ciclo abajo) · `cancelarAuditoria` (permiso `calidad.modificar-auditorias`; borrado SUAVE `cancelada=true` + motivo en bitácora y anexado a `observaciones`, 409 si ya cancelada; **publica el evento RC** → una auditoría cancelada deja de ser "viva" → **des-completa** el proceso `auditoria` de la orden).
> - **Impreso R9** `dominio/calidad/impresos/impreso-auditoria.ts` (NUEVO, patrón `impreso-recibo-maquila`): encabezado (no. auditoría, orden, modelo, cantidad, muestra, tipo, maquilero, auditor/elaboró, fecha) + detalle (clave, pag, descripción, nivel AQL, fallas) + resultado grande **ACEPTADO/RECHAZADO/NO CALIFICADO** + total de prendas rechazadas + banda "cancelada" + observaciones; A9 (reusa `obtenerAuditoria`); firma `{ buffer, folio }`. Ex reporte `FormatoAuditorias`/`FormatoAuditoriasDet`.
> - **Rutas REST** en `auditorias.rutas.ts`: `GET /calidad/auditorias` (lista, `calidad.ver`), `GET …/maquilero/:idMaquilero` (historial, `calidad.ver`), `GET …/:id/impreso` → `application/pdf` (`calidad.ver`), `PATCH …/:id` (modificar, `calidad.modificar-auditorias`), `POST …/:id/cancelacion` (cancelar, `calidad.modificar-auditorias`). RBAC por acción deny-by-default (A4); orden de rutas sin colisión con `/:id` (estáticas primero).
> - **Contrato** OpenAPI regenerado + cliente del frontend sincronizado (esquemas nuevos: resumen ligero, query de lista + página, cuerpo de modificar, cuerpo de cancelar con `motivo`, query/salida de historial).
> - **Frontend (teal lista+detalle):** `ConsultaAuditoriasPagina` (filtros al servidor con debounce + Imprimir PDF + Ver/capturar + Modificar/Cancelar gateados por `calidad.modificar-auditorias` y ocultos si `cancelada`), `AuditoriasPorMaquileroPagina` (selector + rango + tarjeta de % de aprobación + tabla), `DialogoModificarAuditoria`, `DialogoCancelarAuditoria` (motivo obligatorio). Rutas en `App.tsx` (estáticas antes de `:id`); 2 tarjetas en `CalidadPagina` + 2 sub-vistas en `catalogo.ts` con testid exactos (sin strict-mode violation); `catalogo.test.ts` actualizado (59→61 entradas).
> - **Tests:** dominio (integración: lista+filtros+orden determinista, Σ fallas, no-canceladas por defecto; modificar + rechazo de maquilero ajeno + deny-by-default + bloqueo si cancelada + **transición de tipo que des-completa la RC**; cancelar soft + bitácora + des-completa RC + doble-cancel 409; historial 50%/null/404), API (lista filtra, PDF 200 `application/pdf`, modificar/cancelar OK, deny-by-default 403 sin permiso), impreso unitario (3 casos: aprobado/no calificado/cancelada + observaciones vacías) y componente (Consulta, 6 tests) + E2E (pantallas cargan / consulta / imprimir / cancelar, precedente de E2).
>
> **Ciclo coder+reviewer:** el reviewer halló 1 bloqueante de CI (lint `@typescript-eslint/no-unsafe-return` en el mock de un test del frontend → job `frontend` rojo) y **1 hallazgo de correctitud real**: `modificarAuditoria` cambiaba `tipoAuditoria` pero NO re-evaluaba la RC (la auto-completación depende de `tipoAuditoria='final' && resultado='aprobado'` en `autoAvance.ts`), así que mover una auditoría `final`↔`en_piso` dejaba el proceso de RC mal sincronizado (sobre/sub-reporta). El mismo coder corrigió ambos (cuerpo de sentencia en el mock + publicación del evento RC en la misma tx de `modificarAuditoria` + test de la transición) → re-verificación CI verde (backend + frontend, 433/433 tests, lint 0 errores) → reviewer **APROBÓ**.
>
> **NO toca / deja para después:** el **ETL del histórico** (488 auditorías / 15,296 detalles) y el cuadre v1↔v2 = **F6-E6** (cierre de fase). Los KPIs formales por maquilero son **F7/D11** (aquí solo la vista operativa del %). La ubicación final del módulo de Calidad sigue siendo **D8** (pendiente). Sin `docs/modulos/calidad.md` todavía: el módulo se documenta al cerrarlo en E6.

**Objetivo:** Completar la experiencia del módulo de Calidad sobre el núcleo de E2: consulta de auditorías con su impreso PDF (R9, FormatoAuditorias), el historial operativo por maquilero y el flujo de modificar/cancelar con borrado suave y bitácora. Etapa separada de E2 para respetar la granularidad de referencia; puede correr en paralelo con E5 (EsMa).

**Alcance:**
- dominio/calidad/servicioAuditorias.modificar y .cancelar: borrado suave + observaciones + Bitacora (A7); permiso calidad.modificar-auditorias (ex acceso 12) verificado server-side (A4)
- Pantallas: Consulta de auditorías con filtros y botón Imprimir→PDF (ex CC_ConsultaAuditorias), Auditorías por maquilero (historial + % de aprobación operativo; ex CC_ConsulAuditMaq — los tableros KPI formales son F7/D11), Modificar/cancelar (ex CC_ModificarDatos)
- Impreso R9 (@react-pdf/renderer, en backend): Formato de auditoría — encabezado (no. auditoría, orden, modelo, cantidad, muestra, tipo, maquilero, auditor, género, fecha) + detalle (clave, pag, descripción, AQL, fallas) + resultado ACEPTADO/RECHAZADO + prendas rechazadas + observaciones — referencia reportes FormatoAuditorias + FormatoAuditoriasDet
- Endpoints: consultas/listados de /api/calidad/auditorias + /api/calidad/auditorias/{id}/pdf + modificación/cancelación. RBAC por acción (A4) y regeneración OpenAPI + cliente tipado en la misma etapa

**Entregables:**
- Servicios modificar/cancelar con TSDoc + tests de integración (cancelación = borrado suave, registro en Bitacora, permiso requerido)
- Componente PDF del formato de auditoría versionado + test de generación
- 3 pantallas con tests de componente + E2E Playwright del flujo consulta→imprimir y cancelar
- Rutas REST con permisos por acción + tests de integración de API
- openapi.json + esquema.gen.ts regenerados; CI verde

**Criterio de cierre:**
- La consulta de auditorías filtra/pagina en servidor y el PDF descargable coincide con el reporte viejo FormatoAuditorias (encabezado y detalle)
- Cancelar una auditoría es borrado suave con motivo, y queda en Bitacora (verificable en la pantalla de E1)
- El historial por maquilero muestra sus auditorías y el % de aprobación operativo
- El permiso 12 (calidad.modificar-auditorias) gobierna modificar/cancelar tanto en UI como en API
- CI verde + visto bueno del reviewer

**Verificación de Gabriel:**
- [ ] docker compose up -d --build; abrir Calidad → Consulta de auditorías y localizar las auditorías creadas en E2 (aprobada y reprobada)
- [ ] Descargar el PDF de una auditoría y compararlo lado a lado con el reporte viejo FormatoAuditorias (mismos datos de encabezado y detalle, resultado ACEPTADO/RECHAZADO)
- [ ] Abrir Auditorías por maquilero con el maquilero de prueba: con 1 aprobada y 1 reprobada el % de aprobación debe mostrar 50%
- [ ] Cancelar una auditoría capturando el motivo; verificar que desaparece de la consulta normal (o se marca cancelada) y que el registro aparece en la Consulta de bitácora (E1) con usuario y motivo
- [ ] Con un usuario sin calidad.modificar-auditorias: intentar cancelar una auditoría → bloqueado en UI y 403 en API

**Equipo:** 1 coder + 1 reviewer (depende de E2). Esta etapa PUEDE correr en paralelo con E5 (EsMa) — módulos independientes

**Referencias:**
- Documentacion_MJD/09-Control-de-Calidad.md §3 (pantallas del menú 3.7.1) y §5.3 (los KPIs formales por maquilero son F7/D11 — aquí solo vista operativa)
- Formularios viejos (latin-1): CC_ConsultaAuditorias, CC_ConsulAuditMaq, CC_ModificarDatos (PrP(12)); reportes FormatoAuditorias + FormatoAuditoriasDet
- REQUISITOS-NUEVOS.md §R9 (fila del formato de auditoría)
- backend/src/contrato/permisos.ts: calidad.modificar-auditorias (ya seedeado en F0)
- A1, A4, A7 (cancelación a bitácora), R9 (impreso dentro de la etapa de su grupo funcional)

---

## F6-E4 · EsMa — movimientos, validación de cargos, saldos, conciliación y recibo de pago (R9) — ⬜ pendiente

**Objetivo:** Construir el corazón contable de EsMa: completar el cargo automático nacido en F3 con su flujo de conciliación (capturado→revisado→pagado), los otros 3 conceptos (abonos, descuentos, pagos con detección de duplicados), el saldo SIEMPRE derivado (D3) y el servicio de conciliación contra recibos — la lógica del criterio de salida de la fase. Independiente de Calidad: puede arrancar en paralelo con E1.

**Alcance:**
- Esquema Prisma: completar CargoMaquila (nacido en F3): estadoConciliacion capturado→revisado→pagado (reemplaza RevisionPendiente, doc 07 §6.3), liga idRecibo (fin de la doble captura, 07 §6.1), tipoProceso del recibo (reemplaza EsEstampado — maquila unificada plan §4), cantidadReal y precioReal confirmados; tablas AbonoMaquilero, DescuentoMaquilero, PagoMaquilero (estadoRevision, fecha) como movimientos PLANOS (sin encabezado EsMa: maquilero+fecha+obs van en cada movimiento); todo con auditoría A7 + idEmpresa A9
- Decisión Orden.pagada: se DERIVA del estado de los cargos de la orden (todos en estado pagado), no es bandera editable — si la operación exigiera marca manual se revisa aquí, no después
- dominio/esma/servicioCargos.validar: el cargo se PROPONE desde el recibo (cantidad y precio pactado de la orden como referencia: Ordenes.MaquilaOrd costura / AplicacionOrd estampado) y el admin CONFIRMA/ajusta cantidad real y precio real — el punto de control humano SE CONSERVA (doc 07 §2); transición de estados con Bitacora (A7, EsMa es crítico en plan §4). ANTES de fijar la regla del precio de estampado, confirmar con Daniel/datos el posible bug v1 (EsMaRecibosSemEstCon calcula Importe con MaquilaOrd en vez de AplicacionOrd)
- dominio/esma/servicioAbonos / servicioDescuentos / servicioPagos: cada movimiento en transacción (A2) con Bitacora; regla de pagos: advertir posibles duplicados (mismo maquilero + monto en ventana corta — problema real en v1, existía la consulta 'Buscar duplicados por EsMa_Pagos')
- dominio/esma/servicioSaldos: saldo = Σ(cantReal×precioReal) + Σabonos − Σpagos − Σdescuentos con nulos=0 (fórmula exacta de EsMa_SaldosMaq con ceronulo, doc 07 §1) — VISTA derivada, NUNCA editable (D3 extendido, 07 §6.2)
- dominio/esma/servicioConciliacion: cuadre EsMa vs recibos del periodo por orden+maquilero: Σcantidad recibida (producción F3) vs Σcantidad cargada (EsMa) → faltantes por cargar / cargos sin recibo (lógica CuantasFaltan de EsMaRecibosSemCon, unificada — desaparece el par duplicado /Est)
- Permisos server-side (A4) en cada ruta: esma.ver-pagos (ex acceso 24: ver estado de cuenta y meter SOLO pagos) vs esma.modificar (ex 25: todo — cargos/abonos/descuentos y editar fechas); ocultar precios/importes con consultas.ver-importes (ya seedeado, ex regla NivelAct>nivGerencial) — los 3 ya existen en backend/src/contrato/permisos.ts
- Pantallas: Validación/conciliación de cargos (reemplaza EsMaRecibos/Det/Sem: lista de recibos del periodo con cantidad orden/cortado/entregado/recibido/ya cargado/faltante + filtros 'cuántas faltan' y 'pagadas'; selector de maquilero SOLO activos y del tipo correcto) y Captura de abonos / descuentos / pagos (formularios simples monto+observaciones, ex EsMaAbonos/EsMaDescuentos/EsMaPagos)
- Impreso R9 (@react-pdf): Recibo de pago al maquilero ('RECIBÍ ... LA CANTIDAD DE $X POR CONCEPTO DE PAGO DE MAQUILA', bueno por, nombre y firma — ex ReciboMaquileros) con el nombre del pagador desde la CONFIGURACIÓN DE EMPRESA (A9), no hardcodeado como el 'SR. DANIEL MASRI' del reporte viejo
- Endpoints /api/esma/* + regeneración OpenAPI + cliente tipado en la misma etapa

**Entregables:**
- Migración Prisma 'esma-movimientos' aplicable en limpio (compatible con los cargos ya creados por F3)
- 5 servicios de dominio con TSDoc (referencia a doc 07 §1/§2/§6, D3, A2/A3/A7) + tests unitarios y de integración: fórmula del saldo con nulos, transiciones de estado válidas/ inválidas, detección de duplicados, conciliación con faltantes y con cargos sin recibo
- Rutas REST con los 3 permisos aplicados por acción + tests de API (incluido: usuario solo esma.ver-pagos no puede crear abonos/descuentos; respuesta sin importes si falta consultas.ver-importes)
- Componente PDF del recibo de pago + test de generación (nombre del pagador desde empresa)
- Pantallas de conciliación y captura con tests de componente + E2E Playwright (proponer→confirmar cargo→pagar→imprimir recibo)
- openapi.json + esquema.gen.ts regenerados; CI verde

**Criterio de cierre:**
- Un recibo de maquila de F3 aparece como cargo propuesto, el admin lo confirma ajustando precio y pasa a 'revisado' (con bitácora)
- Abonos, descuentos y pagos se capturan y el saldo derivado refleja exactamente Σcargos+Σabonos−Σpagos−Σdescuentos (tests con nulos=0)
- Un pago repetido (mismo maquilero+monto en ventana corta) dispara advertencia
- La conciliación lista faltantes por cargar y cargos sin recibo para un periodo dado
- Permisos 24/25 + ver-importes funcionan en API y UI; el recibo de pago sale con el pagador de la configuración de empresa
- Regla del precio de estampado CONFIRMADA con Daniel/datos y documentada en el TSDoc del servicio
- CI verde + visto bueno del reviewer

**Verificación de Gabriel:**
- [ ] docker compose up -d --build; con datos de prueba de F3 (una orden con recibo de maquila): abrir EsMa → Validación de cargos y verificar que el recibo aparece propuesto con cantidad y precio de referencia de la orden
- [ ] Confirmar el cargo ajustando el precio real → verificar que pasa a 'revisado' y que el cambio quedó registrado: abrir la pantalla Consulta de bitácora (construida en E1) filtrando por entidad 'CargoMaquila' — este paso requiere E1 cerrada; si excepcionalmente esta etapa cerrara antes que E1, verificarlo al cierre de E1
- [ ] Capturar 1 abono, 1 descuento y 1 pago al mismo maquilero; calcular el saldo a mano (calculadora: cargos+abonos−pagos−descuentos) y compararlo contra el saldo que muestra el sistema
- [ ] Capturar un segundo pago idéntico (mismo monto, mismo maquilero) → debe salir la advertencia de posible duplicado
- [ ] Imprimir el recibo de pago en PDF y verificar el texto 'RECIBÍ...' y que el nombre del pagador es el de la configuración de la empresa (no un nombre fijo)
- [ ] En la pantalla de conciliación, filtrar el periodo y verificar que la columna 'faltante' = recibido − cargado para la orden de prueba
- [ ] Entrar con un usuario que solo tenga esma.ver-pagos: puede ver y meter pagos, pero los botones de cargos/abonos/descuentos no aparecen y el API los rechaza (403); con un usuario sin consultas.ver-importes: los precios e importes no se ven

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI). Esta etapa PUEDE correr en paralelo con E1/E2 (Calidad) — módulos independientes, sin archivos compartidos; el paso de bitácora de la verificación usa la pantalla de E1

**Referencias:**
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md §1 (fórmula EsMa_SaldosMaq), §2 (flujo de captura — el punto de control del admin SE CONSERVA), §3 (modelo), §6.1–6.5 (mejoras: liga al recibo, saldo derivado, estados, precio unificado, conservar 4 conceptos)
- PLANMAESTRO.md §4 (maquila unificada por TipoProceso; Bitacora con EsMa listado como crítico A7) y §5 módulo 9 + punto de integración central (el cargo NACE en F3)
- Consultas viejas: EsMa_SaldosMaq (fórmula con ceronulo), EsMaRecibosSemCon/Est (CuantasFaltan, QuePagEs, posible BUG de precio de estampado a confirmar), 'Buscar duplicados por EsMa_Pagos'; formularios EsMaRecibos/Det, EsMaAbonos, EsMaDescuentos, EsMaPagos (Imprimir_Click); reporte ReciboMaquileros — leer en latin-1
- backend/src/contrato/permisos.ts: esma.ver-pagos (ex 24), esma.modificar (ex 25), consultas.ver-importes (ya seedeados en F0)
- A1, A2, A4, A7, A9, D3 (extendido a saldos, 07 §6.2), D8/plan §5, R9 (recibo de pago)
- docs/modulos/patron-crud.md + motores de F0: backend/src/comun/{transaccion,auditoria,permisos}.ts

---

## F6-E5 · EsMa — estado de cuenta, consultas semanales, desglosado e impreso del estado de cuenta (R9) + vista móvil — ⬜ pendiente

**Objetivo:** Entregar la experiencia de usuario completa de EsMa sobre los servicios de E4: la pantalla central del estado de cuenta (la más completa del sistema viejo), las consultas semanales y de saldos, el estado desglosado con su impreso/exportable, y la vista móvil de consulta y autorización. Va después de E4 porque consume sus movimientos, saldos y conciliación.

**Alcance:**
- Pantalla Estado de cuenta del maquilero (ex EsMa_EdoCta, abría 13 forms — aquí UNA pantalla con secciones): selector tipo costura/estampado (ex QueTipoMaq sobre Maquileros.Costura/Proceso de F1) + selector de maquilero ACTIVO del tipo correcto; grid de movimientos por fecha (cargos/abonos/descuentos/pagos) con marcas de partidas pendientes de revisión (ex asteriscos Rev/RevRec → estados de E4); botones Agregar/Abrir por concepto (reusa los formularios de E4); acción 'Duplicar partida' en el grid (pre-llena el formulario de captura del concepto de E4 con los datos de la partida origen — conserva la función 'copiar partidas' de EsMa_EdoCta, doc 07 §4, distinta del botón ParaCopiar del desglosado); acceso al saldo, a las existencias del maquilero (dato MaqExis de F3) y al desglosado
- Pantalla Saldos de todos los maquileros (ex EsMa_SaldosMaq): solo activos con saldo ≠ 0, con drill-down al estado de cuenta
- Pantalla Pagos semanales (ex EsMa_PagosSem): pagos agrupados por semana con navegación semana actual/anterior
- Pantalla Recibos semanales de maquila (ex RecibosSemanalesMaq, menú 3.8): recibos del periodo por maquilero/modelo con filtro de fechas (importes visibles solo con consultas.ver-importes)
- Pantalla Estado de cuenta desglosado (ex EsMa_EdoDesglosado, botón 'ParaCopiar'): detalle por orden/modelo/cantidad/precio/importe, exportable (copiar/Excel vía exceljs)
- Impreso R9 (@react-pdf, backend): Estado de cuenta del maquilero por periodo — desglosado por orden/modelo/cantidad/precio/importe + abonos/descuentos/pagos + saldo final (referencia EsMa_EdoDesglosado + fila 'estado de cuenta' de REQUISITOS §R9; el orquestador confirmó que este impreso va en F6)
- Vista móvil (responsive): consulta de saldos y estado de cuenta SOLO lectura + autorización/revisión de partidas pendientes (transición de estado de E4) desde el celular
- Endpoints de consulta que falten (semanales, desglosado, periodo) en /api/esma/* — solo lectura/agregación, la lógica de agregación en dominio (A1; SQL crudo permitido para reportes según plan §1) + regeneración OpenAPI + cliente tipado
- Permisos: las mismas claves de E4 gobiernan qué ve/hace cada usuario en todas estas pantallas (deshabilitar por permiso como hacía PrP(25) en el form viejo)

**Entregables:**
- 5 pantallas + vista móvil con tests de componente (estados carga/vacío/error, acciones por permiso) + E2E Playwright: abrir estado de cuenta → agregar pago → ver saldo actualizado → descargar PDF
- Acción 'duplicar partida' con test de componente (pre-llenado correcto del formulario destino)
- Endpoints de consulta con tests de integración (agregación semanal correcta contra datos sembrados)
- Componente PDF del estado de cuenta versionado + test de generación, y exportación a Excel del desglosado
- openapi.json + esquema.gen.ts regenerados en la misma etapa; CI verde

**Criterio de cierre:**
- El estado de cuenta de un maquilero muestra los 4 conceptos por fecha con sus marcas de revisión y su saldo coincide con la pantalla de saldos y con el cálculo manual
- 'Duplicar partida' pre-llena el formulario del concepto con los datos de la partida origen y al guardar crea un movimiento nuevo independiente
- Pagos semanales y recibos semanales navegan por semana/periodo con totales correctos
- El PDF del estado de cuenta por periodo coincide renglón a renglón con el desglosado en pantalla
- Desde un viewport móvil se consultan saldos/estado de cuenta y se autoriza una partida pendiente
- Selectores de maquilero filtran activos + tipo correcto (costura/estampado)
- CI verde + visto bueno del reviewer

**Verificación de Gabriel:**
- [ ] docker compose up -d --build; abrir EsMa → Estado de cuenta, elegir tipo 'costura' y el maquilero de prueba de E4: verificar el grid con los movimientos capturados en E4 (cargo, abono, descuento, pagos) y las marcas de pendiente de revisión
- [ ] Comparar el saldo mostrado contra la pantalla 'Saldos de maquileros' (deben ser idénticos) y contra tu cálculo a mano de E4
- [ ] Usar 'Duplicar partida' sobre el abono de prueba: el formulario debe abrirse pre-llenado con sus datos, guardarlo y verificar que aparece como movimiento nuevo (y que el saldo cambió en consecuencia)
- [ ] Cambiar el selector a 'estampado': el maquilero de costura ya no debe aparecer (filtro de tipo + activos)
- [ ] Abrir Pagos semanales y navegar a la semana de los pagos de prueba: el total semanal debe sumar los pagos capturados
- [ ] Abrir el desglosado del maquilero, exportarlo a Excel y descargarse el PDF del estado de cuenta del periodo: cotejar renglón a renglón contra la pantalla (orden/modelo/cantidad/precio/importe + saldo)
- [ ] Desde el celular (o devtools modo móvil): abrir saldos, entrar al estado de cuenta (solo lectura) y autorizar una partida pendiente de revisión
- [ ] Con el usuario de solo esma.ver-pagos: en el estado de cuenta solo el botón de pagos está habilitado (como el form viejo deshabilitaba campos por PrP(25))

**Equipo:** 1 coder + 1 reviewer (consume los servicios de E4; trabajo mayormente de frontend + endpoints de consulta — un solo coder evita conflictos en las rutas /api/esma). Esta etapa PUEDE correr en paralelo con E2/E3 (Calidad) — módulos independientes

**Referencias:**
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md §4 (las 5 pantallas del menú 3.8; EsMa_EdoCta incluye 'copiar partidas y ver existencias del maquilero') y §1 (fórmula del saldo)
- Formularios viejos (latin-1): EsMa_EdoCta (VBA completo: PrP(24)/PrP(25), QueTipoMaq, ParaCopiar, ExistenciaMaq), EsMa_SaldosMaq, EsMa_PagosSem, RecibosSemanalesMaq, EsMa_EdoDesglosado; consultas EsMa_EdoCtaCon, EsMa_ReciboTotal
- REQUISITOS-NUEVOS.md §R9 (fila 'Recibo a maquileros / estado de cuenta') — impreso confirmado para F6
- PLANMAESTRO.md §1 (acceso móvil: captura en PC, consultas/autorizaciones también en móvil) y §1 stack (exceljs para exportación)
- A1 (agregaciones en dominio), A4 (permisos por pantalla y por ruta), R9
- Riesgo del inventario: 496 maquileros en el catálogo (Maquileros.csv, verificado con parser CSV), mayormente inactivos — selectores siempre con Activo + tipo (Costura/Proceso)

---

## F6-E6 · ETL Calidad + EsMa, reporte de cuadre v1 vs v2, documentación y cierre de fase — ⬜ pendiente

**Objetivo:** Migrar los datos históricos reales de los dos módulos, probar el cuadre obligatorio de saldos v1 vs v2 (la herramienta que F9 usará en el paralelo), documentar cómo quedaron los módulos y verificar el criterio de salida de la fase en el ambiente de prueba. Va al final porque necesita todo lo construido en E1–E5 (los ETL cargan VÍA los servicios de dominio).

**Alcance:**
- REGLA DE CONTEO: todos los conteos del ETL se hacen con un parser CSV REAL (no contando líneas) — los campos de observaciones traen saltos de línea embebidos (verificado: CC_Auditorias.csv tiene más líneas que registros; los registros reales son 488 IdCC_Auditorias únicos)
- backend/migracion — ETL de Calidad: CC_Catalogo.csv (40 filas) → DefectoCatalogo (AQL de TEXTO '1'/'2.5'/'10' → numérico — valores limpios, verificado; Favorito y Pag mapeados; severidad INICIAL inferida del AQL: 1=crítico, 2.5=mayor, 10=menor, marcada 'para revisión'); CC_Auditorias.csv (488 registros) + CC_AuditoriasDet.csv (15,296) → Auditoria + AuditoriaDefecto (Resultado 1/2/0 → aprobado/reprobado/no_calificado; TipoAuditoria 1/2/0 → en_piso/final/no_definida; Cancelada → borrado suave; usuarios elaboró/auditor → usuarios v2; IdOrdenes → órdenes migradas con FK real, huérfanos LISTADOS para decisión; NumAuditoria conservado como folio histórico)
- backend/migracion — ETL de EsMa: APLANAR el encabezado EsMa.csv (11,369: FechaEsMa+IdMaquileros+ObsEsMa pasan a cada movimiento hijo) hacia EsMa_Recibos (7,401) → CargoMaquila, EsMa_Abonos (554), EsMa_Desc (743), EsMa_Pagos (5,935); EsEstampado → tipoProceso; RevisionPendiente/P → estadoConciliacion/estadoRevision inicial; cargos históricos quedan SIN liga a idRecibo (en v1 nunca existió esa FK); descomponer el LEFT JOIN múltiple del mismo IdEsMa sin duplicar ni perder filas; nulos → 0 en montos; IdMaquileros validado contra el catálogo migrado en F1
- Reglas transversales del ETL (plan §7): CSV en latin-1, idempotente y re-ejecutable (correr 2 veces = mismos datos), cargando vía los servicios de dominio v2 (mismas validaciones que la captura real), inconsistencias LISTADAS para decisión — nunca corregidas en silencio
- Reporte de cuadre OBLIGATORIO (plan §7/§11 y criterio de salida F6): por maquilero, saldo v1 (fórmula EsMa_SaldosMaq con ceronulo sobre los CSV: Σimporte+Σabonos−Σpagos−Σdescuentos) = saldo v2 (servicioSaldos de E4) al corte + conteos por concepto y por tabla CC + corrida del servicioConciliacion sobre un periodo histórico (recibos vs cargos)
- Documentación de cierre: docs/modulos/calidad.md y docs/modulos/esma.md (cómo quedó construido cada módulo: modelo, servicios, pantallas, impresos, permisos, decisiones tomadas — incluida la disposición de 'copiar partidas' y la regla del resultado por nivel AQL — estándar §8)
- Verificación funcional completa de la fase en el ambiente de prueba (Railway, rama prueba): demo del criterio de salida 'EsMa cuadra contra los recibos del periodo' con datos migrados reales

**Entregables:**
- Scripts ETL en backend/migracion (calidad/ y esma/) con tests sobre muestras reales de los CSV (encoding latin-1, saltos de línea embebidos en observaciones, mapeos, idempotencia) + corrida completa documentada
- Reporte de cuadre v1 vs v2 generado (saldos por maquilero, conteos por entidad) + lista de inconsistencias de origen para decisión de Daniel/Gabriel
- docs/modulos/calidad.md y docs/modulos/esma.md
- Suite completa de la fase en verde en CI; despliegue en el ambiente de prueba con los datos migrados
- Checklist del criterio de salida F6 firmado por Gabriel (verificación en vivo)

**Criterio de cierre:**
- ETL corre 2 veces seguidas con los CSV reales y los conteos finales (de REGISTROS, con parser CSV) son idénticos (idempotencia): 40 defectos, 488 auditorías, 15,296 detalles, 7,401 cargos, 554 abonos, 743 descuentos, 5,935 pagos (± exclusiones listadas)
- Reporte de cuadre: saldo v2 = saldo v1 por maquilero al corte, o la diferencia está LISTADA como inconsistencia de origen con explicación
- servicioConciliacion sobre un periodo histórico real muestra recibido vs cargado coherente (criterio de salida de la fase verificado)
- docs/modulos/ actualizada; CI verde; reviewer aprueba; Gabriel valida en el ambiente de prueba
- PR de prueba → main lista (la fase no se cierra hasta la verificación en vivo)

**Verificación de Gabriel:**
- [ ] En la rama de la tarea: correr el ETL de la fase según el README de backend/migracion (comando documentado) contra una BD local limpia con los catálogos de F1–F5 ya migrados; capturar los conteos finales que imprime y compararlos contra los esperados: 40 defectos, 488 auditorías, 15,296 detalles, 7,401 cargos, 554 abonos, 743 descuentos, 5,935 pagos
- [ ] Volver a correr EXACTAMENTE el mismo comando y comparar: los conteos no deben cambiar (idempotencia)
- [ ] Abrir el reporte de cuadre: revisar que los saldos v1 vs v2 por maquilero cuadran; donde no, leer la lista de inconsistencias y anotar las que requieren decisión de Daniel
- [ ] En la app: abrir el estado de cuenta de un maquilero real con historial (p. ej. uno con movimientos recientes en los CSV) y comparar su saldo contra el cálculo de la consulta vieja EsMa_SaldosMaq (el reporte de cuadre trae ambos números)
- [ ] Abrir una auditoría histórica migrada (folio conservado), revisar sus defectos y descargar su PDF (impreso de E3)
- [ ] En la pantalla de conciliación (E4), elegir un periodo histórico y verificar 'recibido vs cargado vs faltante' contra los números del reporte — ESTE es el criterio de salida de F6
- [ ] Mergear a prueba, esperar el deploy de Railway, repetir la verificación del estado de cuenta y la conciliación EN VIVO en el ambiente de prueba, y dar el visto bueno de cierre de fase

**Equipo:** 2 coders en paralelo (pieza A: ETL+doc de Calidad / pieza B: ETL+doc de EsMa + reporte de cuadre) + 1 reviewer — piezas de verdad independientes: CSV distintos, carpetas distintas en backend/migracion, sin archivos compartidos salvo el registro del runner (se define primero)

**Referencias:**
- PLANMAESTRO.md §7 (ETL idempotente vía servicios de dominio, reporte de cuadre obligatorio, inconsistencias listadas) y §11 (descuadres EsMa como riesgo cubierto)
- Respaldo CLAUDE/TABLAS/: CC_Catalogo.csv (40), CC_Auditorias.csv (488 registros — las líneas del archivo son MÁS por saltos embebidos en Observaciones), CC_AuditoriasDet.csv (15,296), EsMa.csv (11,369), EsMa_Recibos.csv (7,401), EsMa_Abonos.csv (554), EsMa_Desc.csv (743), EsMa_Pagos.csv (5,935) — TODOS en latin-1 (CLAUDE.md §4), contar siempre con parser CSV
- Documentacion_MJD/07-EsMa §1 (fórmula exacta del saldo con ceronulo — el patrón de cuadre) y §3 (estructura encabezado+4 hijas a aplanar)
- Documentacion_MJD/09 §2 (mapeos Resultado/TipoAuditoria vía funciones QueResultado/QueTipoAudit del módulo 'Funciones CC')
- Riesgos del inventario: saltos de línea embebidos en campos de observaciones (contar registros, no líneas), LEFT JOIN múltiple del mismo IdEsMa (no duplicar/perder), estados históricos 'no definida'/'no calificado' admitidos por el modelo de E2, maquileros inactivos contra catálogo F1. (El supuesto riesgo de 'AQL con ¿? por encoding' se verificó como INFUNDADO: la columna AQL solo trae '1', '2.5' y '10' limpios)
- docs/ESTADO-DESPLIEGUE.md (estado real de Railway para la verificación en vivo del ambiente de prueba)

---

## Notas de la fase (supuestos del diseño)

SUPUESTOS TOMADOS: (1) El cargo EsMa NACE en F3 (plan §5: el recibo de maquila es UN servicio transaccional que actualiza WIP+IPT+EsMa+RC); E4 lo COMPLETA (estados de conciliación, validación del admin, liga al recibo). Si al llegar a F6 ese cargo automático no quedó implementado en F3, es deuda de F3 a saldar ANTES de arrancar E4 — no se absorbe en silencio. (2) El motor de RC y el auto-avance por eventos vienen de F5; E2 solo registra la auditoría como evento que completa su proceso. (3) Los almacenes Primeras/Segundas y el kardex vienen de F3/F0; E2 solo genera traspasos. (4) El permiso de ocultar importes YA existe seedeado como consultas.ver-importes — se reutiliza, no se crea. (5) Orden.pagada se DERIVA del estado de los cargos (no bandera editable); si la operación exige marca manual, se decide en E4 con Daniel. (6) Alcance móvil decidido: la ALTA/captura de auditoría se entrega responsive usable en tablet (la auditoría es en piso, E2); en EsMa el móvil es solo consulta + autorización de partidas (E5). (7) CLASIFICACIÓN DE MODELOS (mismo tratamiento que el supuesto 1): el doc 09 §5.2 pide AQL parametrizable 'por cliente, por tipo de producto', pero ni 01-Modelos.md (solo IdTemporadas; género solo para listas de precios) ni el plan §5 módulo 2 definen una clasificación de producto — E1 verifica qué entregó F1 y, si no existe, decide con Gabriel/Daniel el atributo (género, familia o catálogo nuevo 'tipo de producto' dentro de E1) ANTES de diseñar la asignación de planes; si falta, es deuda a saldar, no se absorbe en silencio. (8) BITÁCORA: F0 entregó el motor A7 solo como escritura en backend (verificado: sin endpoint de lectura en backend/src/api ni pantalla en frontend/src) — E1 construye el GET /api/admin/bitacora + pantalla mínima de consulta como pieza transversal, porque las verificaciones de Gabriel en E2–E5 la necesitan (Gabriel no programa ni consulta SQL); por eso conviene cerrar E1 primero. CONSULTAS DE NEGOCIO — TODAS CERRADAS CON DANIEL 2026-06-24 (ver el banner arriba + `DECISIONES.md` §F6 (a)–(h)): (a) precio de estampado → CONFIRMADO su propio precio `AplicacionOrd` por orden, decisión (e); (b) fórmula del resultado AQL → Daniel decidió **resultado MANUAL con comentarios** (decisión (a)): el cálculo por nivel AQL ya NO es vinculante, queda como sugerencia informativa + metadato de KPIs; la severidad no entra. Además cerró: muestra automática con default y override autorizado (b); un solo plan para todos —se cae la asignación por cliente/producto— (c); defectos por tipo de producto vía catálogo nuevo + etiqueta + tipo heredado del modelo (d); Orden.pagada derivada + forzar estatus + segundas sin costo (f); bloqueo duro de pagos duplicados vía "prendas por pagar" (g); con/sin factura por proveedor → dos estados de cuenta para "ambos" (h). NINGUNA bloquea el arranque. CIFRAS VERIFICADAS con parser CSV real en latin-1 (no líneas — hay saltos embebidos en observaciones): 40 defectos (33 favoritos), 488 auditorías, 15,296 detalles, 11,369 EsMa, 7,401 cargos, 554 abonos, 743 descuentos, 5,935 pagos, 496 maquileros; la columna AQL solo trae '1'/'2.5'/'10' limpios. ESTRUCTURA: la etapa única de auditorías se partió en E2 (núcleo transaccional) y E3 (consulta/impresión/modificar-cancelar) para respetar la granularidad de referencia; la fase queda en 6 etapas (dentro del límite 3–7). PARALELISMO: Calidad (E1→E2→E3) y EsMa (E4→E5) son dos cadenas independientes sin archivos compartidos (salvo registro de rutas/menú, trivial); el orquestador puede correr E1∥E4 (cerrando E1 primero — es la más ligera y su pantalla de bitácora la usan las demás verificaciones), luego E2∥E5 y E3∥E5; cada etapa con su coder+reviewer y la verificación de Gabriel al cerrar; E6 requiere ambas cadenas cerradas. PERTENECE A OTRA FASE (no se metió): los KPIs formales de calidad por maquilero (% aprobación, defectos frecuentes, tendencia — D11) son F7 Indicadores; en E3 solo queda la vista operativa del historial por maquilero (ex CC_ConsulAuditMaq). El precio real confirmado en EsMa como fuente de CostoOrd.MaquilaCost es entrega A F7 (aquí solo se deja el dato consistente y documentado). El cuadre DIARIO del periodo en paralelo y la migración final de 10 años al corte son F9 — E6 entrega la herramienta (ETL idempotente + reporte de cuadre) ya probada con los CSV completos. La calificación/evaluación del maquilero a partir de sus auditorías (doc 09 §1 'Calificación del maquilero') también se deriva en F7. ALCANCE DUDOSO ASUMIDO DENTRO: la exportación a Excel del desglosado (ex botón ParaCopiar) se incluyó en E5 con exceljs porque es parte de la operación diaria documentada del estado de cuenta, no un indicador; y la función 'copiar partidas' de EsMa_EdoCta (doc 07 §4, distinta de ParaCopiar) se conserva como acción 'duplicar partida' en el grid de E5.
