# ADR-0015 — KPIs sobre vistas materializadas + job de refresco (la captura nunca espera) (F7-E3)

Estado: aceptado · Fecha: 2026-07-03 · Fase: F7-E3 (motor de KPIs + tableros directivos)

## Contexto

F7-E3 entrega tres **tableros directivos** (KPIs de Ruta Crítica/D11, calidad por maquilero/F6, WIP
analítico/F3). Son cálculos PESADOS: recorren toda la ruta viva (`ruta_orden`), todas las auditorías
(`auditorias` + `auditoria_defecto`) y todo el WIP (`etapa_movimiento` + `etapa_movimiento_det`) y
los AGREGAN. El sistema viejo hacía esto PIVOTEANDO EN EL CLIENTE (la pantalla `RC_ConcentradoDif`,
2,061 líneas) — el pecado que el plan §11 prohíbe.

El plan §11 pide, para este tipo de reporte directivo, que **el cálculo pesado se precompute en
segundo plano** y que **la captura/consulta del día a día nunca espere un recálculo**.

Ya existe la infraestructura de jobs durables sobre pg-boss (ADR-0012, `comun/jobs/`) y el patrón de
job recurrente por cron (`comun/jobs/riesgo-rc.ts`).

## Decisiones

### 1. Los KPIs se calculan sobre VISTAS MATERIALIZADAS (SQL crudo), no en tiempo de consulta

Se crean 7 vistas materializadas en la migración `20260703140000_f7_e3_kpis` (`kpi_entregas_a_tiempo`,
`kpi_lead_time_proceso`, `kpi_cuellos_botella`, `kpi_desempeno_responsable`, `kpi_calidad_maquilero`,
`kpi_defecto_maquilero`, `kpi_wip`). NO son modelos Prisma: se consultan por `$queryRaw` desde el
dominio (`dominio/indicadores/kpis.ts`), que aplica el filtro de empresa (A9), los filtros del tablero
y la agregación final EN SQL — nunca pivoteando en el cliente. Cada vista lleva `id_empresa` por fila
(para A9) y un **índice único** (requisito de `REFRESH ... CONCURRENTLY`).

Precedente: el proyecto ya envía objetos de BD que no son modelos Prisma (la vista `existencia_pt` de
F3, ADR-0010). El `prisma migrate diff` reporta esas vistas como "drift" inofensivo (no se usan en el
schema); CI aplica las migraciones y corre los tests, no valida drift.

### 2. Un JOB de pg-boss refresca las vistas; la captura NUNCA espera

`comun/jobs/refrescar-kpis.ts` es espejo de `riesgo-rc.ts`: un cuerpo testeable `refrescarKpis(bd)`
(hace `REFRESH MATERIALIZED VIEW CONCURRENTLY` de cada vista y estampa el timestamp) y un
`registrarRefrescoKpis` que lo cablea a pg-boss (worker + `schedule` cron, default `*/20 * * * *`,
configurable por `KPIS_CRON`). El endpoint `POST /api/indicadores/refrescar` solo **encola** el job
(vía `encolarJob`, serializado por `singletonKey` global) y responde de inmediato: ni la consulta ni
la captura se bloquean por el recálculo (plan §11).

`REFRESH ... CONCURRENTLY` no bloquea las lecturas mientras refresca (por eso el índice único), y NO
puede correr dentro de una transacción: `refrescarKpis` usa el cliente PLANO (nunca `bd.tx`). Si
CONCURRENTLY fallara (p. ej. una vista aún no populada), cae a un `REFRESH` normal (fallback).

### 3. Sello "datos al:" — la única tabla Prisma del módulo

`KpiRefresco` (tabla `kpi_refresco`, fila singleton `clave='global'`) guarda `refrescadoEn`, que
`refrescarKpis` estampa (upsert) al terminar. El API lo devuelve como `datosAl`; la UI muestra
"Datos al: &lt;fecha/hora&gt;" para que el directivo sepa qué tan frescos son los números, y ofrece un
botón **Refrescar** que encola el job y re-consulta.

### 4. Alcance de los filtros (limitación documentada de las vistas pre-agregadas)

- **Ruta Crítica**: `kpi_entregas_a_tiempo` es POR ORDEN → el % a tiempo y la tendencia honran TODOS
  los filtros (periodo/cliente/maquilero/proceso). `kpi_lead_time_proceso` / `kpi_cuellos_botella` ya
  vienen agregadas POR PROCESO (sin periodo/cliente) → honran empresa + proceso; `kpi_desempeno_
  responsable` viene agregada POR RESPONSABLE → honra empresa. Si a futuro se requiere cortar esos
  KPIs por periodo/cliente, se re-modela la vista al grano por proceso-instancia.
- **Calidad**: `kpi_calidad_maquilero` lleva (año, mes) → honra periodo + maquilero (y sirve el total
  y la tendencia). `kpi_defecto_maquilero` NO lleva periodo → los defectos top honran empresa +
  maquilero, no periodo.
- **Desempeño por responsable**: se usa `ruta_orden.capturado_por_id` (quien capturó), que SÍ está
  poblado. El responsable "por ROL" (ProcesoDefRol/UsuarioRol) depende de F10 (usuarios reales aún no
  migrados) — se documenta y se difiere.
- **La UI ROTULA la limitación**: las tarjetas ciegas al periodo (lead time, cuellos de botella,
  desempeño por responsable, defectos más frecuentes) llevan una leyenda teal
  "Histórico acumulado — no filtra por Año/Mes" (`BadgeHistorico`, `modulos/indicadores/piezas.tsx`)
  para que el directivo no crea que TODA la página respeta el periodo elegido. Así el alcance real
  queda cerrado por triplicado: ADR (aquí) + TSDoc (`dominio/indicadores/kpis.ts`) + UI (el badge).

### 5. Fórmulas elegidas

- **Entrega a tiempo** (D2/F7 #7): `fecha_real <= fecha_planeada_vigente` de la fila de `ruta_orden`
  con `ultimo_proceso = TRUE`. El denominador del % son las órdenes **MEDIBLES** = último proceso
  cumplido (`fecha_real` ≠ null) Y con `fecha_planeada_vigente` ≠ null → `% = a tiempo ÷ medibles`.
  Las completadas SIN plan (no medibles, sin nada contra qué compararse) se EXCLUYEN del denominador
  para no sesgar el % hacia abajo; se exponen aparte (`completadasSinPlan`, visible en la tarjeta).
- **Lead time real del proceso**: `fecha_real − COALESCE(MAX(fecha_real de sus antecesores en la ruta
  viva), orden.fecha_inicio_rc)`, acotado a ≥ 0; promediado por proceso. Comparado con
  `AVG(duracion_dias)` (estimado).
- **Cuello de botella**: `AVG(fecha_real − fecha_planeada_vigente)` (días), solo procesos cumplidos;
  orden desc.
- **Calidad**: % aprobación = `aprobadas ÷ (resultado <> 'no_calificado')`, auditorías vivas
  (`cancelada = FALSE`).
- **WIP**: reutiliza la MISMA agregación del tablero WIP de F3-E5 (`dominio/produccion/wip.ts`): suma
  directa de `etapa_movimiento_det` de etapas vivas (D3/D4), por tipo; pendientes derivados igual que
  `pendientesDerivados`.

## Consecuencias

- Los números pueden estar hasta ~20 min "atrasados" respecto a la captura (frescura visible en el
  sello "datos al:" + botón Refrescar). Es el trade-off buscado: la captura nunca se frena.
- El deploy a `prueba` requiere `SEED_ON_START=true` (permiso nuevo `indicadores.ver`) y que el motor
  de jobs esté activo (`JOBS_ACTIVOS` ≠ "false") para que el cron refresque; el primer poblado también
  se puede disparar a mano con el botón Refrescar / `POST /indicadores/refrescar`.
- En tests/CI el motor está inactivo: los tests de integración invocan `refrescarKpis(bd)` directo
  (sin transacción) para poblar las vistas antes de asertar.
