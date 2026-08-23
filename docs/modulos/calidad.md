# Módulo — Control de Calidad (F6)

> Cómo quedó construido el módulo de **Control de calidad** (auditorías AQL) en CONTROL v2. No
> duplica el funcional (ADR-0002): para el QUÉ del negocio, ver `Documentacion_MJD/09-Control-de-Calidad.md`
> y las decisiones **(a)–(d)** de `DECISIONES.md` §F6. Aquí va el CÓMO de v2.

Construido en F6 (etapas E1 → E6). El corazón contable de maquileros que lo acompaña (EsMa) está en
[`esma.md`](esma.md).

## Alcance

Catálogo de **defectos** enriquecido (ex `CC_Catalogo`), **tipos de producto** (clasificación nueva
de modelos, decisión (d)), motor de **planes de muestreo AQL** (ISO 2859, como DATOS), y el núcleo
transaccional de **auditorías**: una auditoría inspecciona una MUESTRA de prendas de una orden
recibida de un maquilero, cuenta las **fallas por defecto** y deja un **RESULTADO que el auditor
decide a mano** (decisión (a)). Integra con la Ruta Crítica (F5): una auditoría FINAL aprobada
auto-completa el proceso `auditoria` de la orden. Incluye reclasificación Primeras↔Segundas como
traspaso de kardex (D3), consulta/impresión (R9), historial por maquilero y modificación/cancelación.

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/calidad/`:
  - `defectos.ts` — CRUD del catálogo de defectos (patrón Almacenes, borrado SUAVE). Enriquecimientos
    v2: `nivelAQL` numérico (1 / 2.5 / 10), `favorito` (pre-carga en toda auditoría nueva), `categoria`,
    `severidad` (**METADATO informativo — NO entra en el veredicto**, decisión (a)) y etiquetado por
    **tipo de producto** (M:N `DefectoTipoProducto`, o `aplicaGeneral` = todos, decisión (d)). Clave
    única insensible a mayúsculas. Catálogo **GLOBAL** (sin `idEmpresa`).
  - `tipos-producto.ts` — CRUD de los tipos de producto (catálogo nuevo, decisión (d); lista corta
    sembrada, editable).
  - `planes-aql.ts` — plan de muestreo AQL como **datos** (tabla ISO 2859, no motor estadístico):
    `resolverPlanPorLote`/`resolverPlan` eligen el renglón por tamaño de lote y el `tamanoMuestra`
    (decisión (b), vinculante) + los límites Ac/Re por nivel (referencia). Un solo plan default activo
    (decisión (c)).
  - `auditorias.ts` — el **núcleo transaccional**:
    - `crearAuditoria` — alta (permiso `calidad.generar-auditorias`). En **UNA transacción (A2)**:
      folio `numAuditoria` por **secuencia atómica por empresa** (A3, ex `AumentarNumAudit`, nunca
      `Max()+1`), trae la cantidad de la orden (ex `TraerCant`), **propone** el maquilero de las
      entregas reales pero ELEGIBLE (mejora del `PrimerMaq`), calcula la muestra del plan AQL default
      (decisión (b)) y **pre-carga todos los favoritos activos con 0 fallas** (ex `InsertarFav`).
      Resultado nace `no_calificado`.
    - `capturarResultado` — el auditor captura las fallas por defecto (reescriben el set completo) y
      decide **a mano** el `resultado` con observaciones (permiso `calidad.actualizar-auditorias`).
      `calcularSugerenciaAql` es una función PURA que suma fallas por nivel AQL y compara contra Ac/Re
      — **solo SUGERENCIA informativa**, NO vinculante (decisión (a)). En la misma tx publica el evento
      `auditoria-calidad-resuelta` al **OUTBOX** para que la RC re-evalúe el proceso `auditoria`.
    - `reclasificar` — Primeras↔Segundas tras la auditoría = **TRASPASO de kardex** (motor
      `comun/kardex.ts`, D3, nunca edita existencias); valida no-negativo por suma directa bajo lock,
      PT por orden.
    - `modificarAuditoria` / `cancelarAuditoria` — edición de encabezado y **borrado SUAVE** (A7);
      ambas republican el evento de calidad al outbox (la RC re-evalúa, idempotente).
    - Consultas: `listarAuditorias` (paginado en servidor, `orderBy` determinista), `obtenerAuditoria`,
      `obtenerContextoOrden` (para el alta), `historialPorMaquilero` (con `% aprobación`).
    - `impresos/impreso-auditoria.ts` — el **impreso PDF (R9)** de la auditoría (`@react-pdf/renderer`).
- **API REST** `backend/src/api/calidad/` (rutas delgadas: permiso + Zod, delegan al dominio):
  `defectos.rutas.ts`, `tipos-producto.rutas.ts`, `planes-aql.rutas.ts`, `auditorias.rutas.ts`.
- **Frontend** `frontend/src/modulos/calidad/`: hub `CalidadPagina`, catálogos (`DefectosPagina`,
  `TiposProductoPagina`, `PlanesAqlPagina`), y el flujo de auditorías (`AltaAuditoriaPagina`,
  `CapturaAuditoriaPagina`, `ConsultaAuditoriasPagina`, `AuditoriasPorMaquileroPagina` + diálogos de
  modificar/cancelar). Cliente del API generado del OpenAPI (`frontend/src/api/calidad.ts`).

## Modelo de datos (`backend/prisma/schema.prisma`)

- `DefectoCatalogo` (ex `CC_Catalogo`) + `DefectoTipoProducto` (puente M:N) + enum `SeveridadDefecto`
  (`critico`/`mayor`/`menor`).
- `PlanMuestreoAQL` → `PlanMuestreoRenglon` (rango de lote → muestra) → `PlanMuestreoLimite` (Ac/Re por
  nivel AQL). Sembrado por `prisma/seed-calidad.ts` (ISO 2859 nivel general II).
- `Auditoria` (ex `CC_Auditorias`) + `AuditoriaDefecto` (ex `CC_AuditoriasDet`, defecto→`numFallas`) +
  enums `ResultadoAuditoria` (`aprobado`/`reprobado`/`no_calificado`) y `TipoAuditoria`
  (`en_piso`/`final`/`no_definida`). Folio `@@unique([idEmpresa, numAuditoria])`. `resultadoManual`
  siempre `true` (el veredicto lo pone el humano). Cancelación suave (`cancelada` + `canceladaEn`/
  `canceladaPorId`/`motivoCancelacion`). `elaboroPorId`/`auditorPorId` son referencias de usuario **sin
  FK física** (ADR-0005, igual que la Bitácora).

## Impresos (R9)

- **Auditoría** (`impreso-auditoria.ts`): PDF con encabezado (orden/modelo/maquilero/fechas/muestra),
  los renglones defecto→fallas y el resultado/observaciones.

## Permisos (RBAC, A4)

`calidad.ver` · `calidad.administrar-catalogo` (defectos/tipos/planes) · `calidad.generar-auditorias`
(alta) · `calidad.actualizar-auditorias` (captura/reclasificación) · `calidad.modificar-auditorias`
(editar encabezado/cancelar). Se siembran con el catálogo de `src/contrato` (deploy a `prueba` con
`SEED_ON_START=true`).

## Migración del histórico (F6-E6)

ETL en `backend/migracion/etl-calidad.ts` (orquestador) + `loaders/calidad-defectos.ts` y
`loaders/calidad-auditorias.ts`. Carga **vía los servicios de dominio** (A1), **idempotente**, **por
lotes** y con encoding **CP850**. Se corre a mano post-deploy:
`npx tsx --env-file=.env migracion/etl-calidad.ts` desde `backend/` (NUNCA `npm run`, ver
`migracion/README.md`).

- **`CC_Catalogo` (40) → `DefectoCatalogo`** vía `crearDefecto`. La `severidad` NO viene en el viejo:
  se **INFIERE del AQL** (`severidadDesdeAql`: 1→crítico, 2.5→mayor, 10→menor) — es metadato "para
  revisión", no un veredicto migrado. Todos entran con `aplicaGeneral=true` (v1 no clasificaba por
  tipo de producto — decisión (d); se etiqueta a mano después).
- **`CC_Auditorias` (488) → `Auditoria`** vía el **modo migración** `crearAuditoriaMigrada`
  (`dominio/calidad/auditorias.ts`), que:
  - **PRESERVA el folio histórico** `NumAuditoria` (no lo saca de la secuencia); al terminar, el ETL
    **recalibra la secuencia `auditoria`** por empresa al máximo folio migrado (A3, como F2 con las
    órdenes) para que la primera captura nueva no choque el `@@unique`.
  - Fija resultado/tipo/cancelación/fechas/muestra EXPLÍCITOS del viejo, `resultadoManual=true`, y **NO
    publica** el evento de RC (excepción justificada §7: migrar el histórico no debe encolar 488
    auto-avances — esa historia ya la cargó el ETL de F5).
  - Mapeos: `IdOrdenes`→`Orden` (F2; sin mapeo ⇒ auditoría OMITIDA, `idOrden` es FK obligatoria; el
    `idEmpresa` se deriva de la orden, A9). `IdMaquilero`→`Proveedor:IdMaquileros` (en el viejo
    referencia la tabla `Maquileros` de costura; `0`/vacío o sin mapeo ⇒ null, es nullable).
    `Resultado 1/2/0`→`aprobado/reprobado/no_calificado` y `TipoAuditoria 1/2/0`→`en_piso/final/no_definida`
    (calcan `QueResultado`/`QueTipoAudit` del módulo viejo `Funciones CC`). `IdUsuariosElaboro/Auditor`
    se preservan como **texto del id viejo** (sin FK; `0`/vacío ⇒ null); F10 migrará usuarios y podrá
    remapearlos.
- **`CC_AuditoriasDet` (15,296) → `AuditoriaDefecto`** (creados junto a su auditoría, misma tx). El
  `idDefecto` se resuelve por el mapeo `DefectoCatalogo`; renglón con defecto sin mapeo ⇒ OMITIDO +
  reportado. El `@@unique(idAuditoria, idDefecto)` exige un renglón por defecto: los **pares
  DUPLICADOS del viejo** (p. ej. la auditoría 488) se **FUSIONAN sumando fallas** (decisión documentada);
  cada `IdCC_AuditoriasDet` viejo se mapea al `AuditoriaDefecto` resultante.
- **Idempotencia**: por `MapeoMigracion` (`DefectoCatalogo`/`Auditoria`/`AuditoriaDefecto`) y,
  defensivamente, por las claves únicas (`clave` del defecto, `(idEmpresa, numAuditoria)`). Toda
  inconsistencia va al **REPORTE** (`reporte-etl-f6e6-calidad-*.txt`), nunca se corrige en silencio.
  El **cuadre v1 (CSV) vs v2 (Postgres)** se imprime al final (conteos con el parser real, no a mano).

## Reglas que el módulo respeta

- **A1** — lógica solo en dominio; rutas delgadas; el ETL LLAMA al dominio.
- **A2/A7** — alta/captura/reclasificación/migración en una transacción, con bitácora uniforme.
- **A3** — folio `numAuditoria` por secuencia atómica por empresa (nunca `Max()+1`).
- **A4** — cada operación re-verifica su permiso (deny-by-default).
- **A9** — todo sellado/filtrado por la empresa activa.
- **D3** — la reclasificación Primeras↔Segundas es un traspaso de kardex, nunca una edición de existencias.
- **Decisión (a)** — el resultado es MANUAL; la sugerencia AQL y la severidad son informativas, NO
  vinculantes.
