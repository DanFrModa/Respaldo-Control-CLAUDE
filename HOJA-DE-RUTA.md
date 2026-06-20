# CONTROL v2 — Hoja de ruta (plan por etapas + estado vivo)

> **Documento vivo.** Aquí está TODO el camino: las 10 fases divididas en **etapas** con su estado. La ley técnica es `PLANMAESTRO.md`; esto es el mapa y el tracker.
> **Para cualquier chat/sesión nueva:** lee `CLAUDE.md` → `PLANMAESTRO.md` → este archivo (la sección *¿Dónde vamos?*) → la **ficha completa de la fase activa** en `docs/hoja-de-ruta/` — y con eso sabes exactamente qué sigue y cómo ejecutarlo. No leas las 8 fichas: solo la de la fase en curso.
> — *Actualizado: 16-jun-2026.*

---

## 1. ¿Dónde vamos? (estado vivo — actualizar al cerrar cada etapa)

- **F3 — Producción / WIP: 🔄 EN CURSO (3/6).** **`F3-E3` ✅ (19-jun-2026; reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`)** — **inventario PT operable** (primer uso real del motor kardex de E1): movimientos manuales, traspasos entre almacenes, existencias y kardex, dominio→API→UI. `registrarMovimientoPt` (entrada/salida manual con tipo del catálogo; las **salidas validan no-negativo** por suma directa del detalle bajo lock, NUNCA la vista —ADR-0010 §3). `registrarTraspasoPt` (abre la tx en dominio, toma el lock, valida existencia del ORIGEN y delega al motor de `comun/kardex.ts` en la MISMA tx — **cierra su TODO** sin tocar el núcleo). `cancelarMovimientoPt` (= movimiento INVERSO auditado con motivo en Bitácora A7; reemplaza 'Error de Entrada/Salida', NUNCA edita/borra — D3). `consultarExistenciasPt` (lee la vista `existencia_pt`, aquí SÍ la vista por ser CONSULTA) y `kardexPt` (por modelo con saldo corrido y por folio). 6 endpoints `/api/inventarios/pt/*` con RBAC (`inventario-pt.ver`/`.mover`); **CERO endpoints de edición/borrado** (D3). Frontend: 4 pantallas teal — Movimientos manuales, Traspaso, **Existencias responsive PC+MÓVIL** (la consulta móvil del módulo) y Kardex (por modelo/folio + cancelación con confirmación); reutiliza `MatrizColorTalla`. **SIN migración** (tablas y vista ya de E1) y **SIN permisos nuevos** (`inventario-pt.*` ya sembrados en E1); lo ÚNICO del seed son **2 tipos de movimiento** nuevos (`transferencia-salida`/`transferencia-entrada`, para las patas del traspaso) → el deploy a `prueba` **requiere `SEED_ON_START=true`**. **`IPT_Revision` NO se construye** (con kardex puro no hay saldo materializado que recuadrar). **Patrón consistente:** las consultas re-validan en el dominio con esquemas LOCALES `z.boolean()` (no el `stringbool` del contrato), evitando de raíz el bug de banderas que afectó a F2 (hotfix `fix(ordenes)` PR #56). **Equipo:** 1 coder + 1 reviewer. CI verde (backend 375 unit; frontend 293; integración —existencia=suma de movimientos, no-negativo en salida/traspaso, traspaso atómico, inverso neutraliza saldo, dos salidas concurrentes sin negativo— + e2e en CI con testcontainers). Ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md). **Siguiente: `F3-E4` (recibo de maquila ⭐ — transacción WIP + kardex PT condicionado por proceso + cargo EsMa + validación de cargos).**
- **`F3-E2` ✅ (18-jun-2026; reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`)** — primer vertical sobre `EtapaMovimiento`: **corte + envío a maquila unificado** (dominio→API→UI + 2 PDFs), sin tocar el kardex PT todavía (eso llega con el recibo en E4). `registrarCorte` (det color×talla, folio A3, valida cortador con rol `corte`; **sobre-corte LIBRE** —solo avisa, decisión (f)). `registrarEnvioMaquila` (UN servicio para costura Y estampado parametrizado por TipoProceso D8; maquilero filtrado por el rol que mapea al proceso; **sobre-envío ESTRICTO** `enviado ≤ cortado` por proceso, suma directa de `EtapaMovimientoDet` bajo `pg_advisory_xact_lock` tomado ANTES de las sumas, decisión (g)). `cancelarEtapaMovimiento` (suave + motivo + Bitácora; bloquea cancelar un corte con envíos vivos). Consultas DERIVADAS `pendientesPorOrden`/`corteSemanalPorCortador` + `listarEtapasOrden` (historial vivo/cancelado). 9 endpoints RBAC + 2 PDFs (envío + ficha de estampado). Frontend: Captura de corte, Envío unificado (selector de proceso en la MISMA pantalla), Corte semanal **responsive**, e `HistorialEtapasOrden` (cancelar con motivo). **SIN migración, SIN permisos nuevos, SIN tocar el seed** (`produccion.*` ya estaban de E1 → el deploy a `prueba` **NO requiere `SEED_ON_START`**). Decisiones (f)/(g) en `DECISIONES.md` (ambas con tope configurable; para E4 queda fijado **`recibido ≤ enviado`**). **Bloqueante que cazó el reviewer (resuelto):** la cancelación quedaba inalcanzable desde la UI → se agregó `listarEtapasOrden` + `HistorialEtapasOrden`. **Equipo:** 1 coder + 1 reviewer. CI verde (backend 364 unit; frontend producción 12/12; integración —incl. dos envíos concurrentes— en CI). Ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md). **`F3-E3` ✅ cerrada** (ver arriba).
- **`F3-E1` ✅ (17-jun-2026, verificada por Gabriel; los 2 reviewers APROBARON)** — cimiento de la fase. **Motor kardex genérico** `backend/src/comun/kardex.ts` (registrar movimiento encabezado+detalle en transacción A2, folio atómico A3, traspaso de 2 patas en UNA transacción, inverso auditado, y `existenciaPtBloqueada`/`bloquearArticuloPt` = suma directa de `MovimientoDet` bajo advisory lock, **NUNCA la vista** — base de "no recibir lo no enviado"/"no entregar lo que no existe" de E4/E5) + despachador de eventos `comun/eventos.ts` (gancho para la RC de F5, sin consumidores). **Modelo de datos de TODA F3 en una migración aditiva única** (`20260617120000_f3_e1_produccion_kardex`): `EtapaMovimiento`/`EtapaMovimientoDet` (corte/envío/recibo/entrega, color×talla D4, folio A3, cancelación suave, idEmpresa A9, liga `idEtapaEnvio` nullable), kardex genérico `Movimiento` + **un detalle por tipo de artículo** `MovimientoDetPt`/`Tela`/`Avio` (extensibilidad verificada D5/R4: F4 agrega tela/avío con código nuevo + 1 FK aditiva, **sin migrar filas ni tocar el núcleo de `kardex.ts`**), `EsMaCargo` (solo esquema; el flujo en E4), `TipoMovimientoInventario`, y la **vista `existencia_pt`** (Σ movimientos, D3, nunca tabla editable). `TipoProceso` extendido con `generaEntradaPt`. **CRUD 'Tipos de proceso'** end-to-end (la marca *genera entrada a PT* editable **solo por admin, validado en el servidor**) + GET de tipos de movimiento. Seeds idempotentes (19 tipos de movimiento desde `IPT_TiposMov.csv` en **CP850**, 3 almacenes PT, tipos de proceso con su bandera) + **9 permisos RBAC nuevos**. ADR-0010. **costoUnit NULL en toda F3** (D1/D2; la valuación llega en F7). **Decisiones de Gabriel (reversibles, ambas defaults — ver `DECISIONES.md`):** (d) liga recibo↔envío = agregado por orden+proceso + campo opcional nullable; (e) `generaEntradaPt` = solo costura (**Gabriel lo confirma con Daniel antes de E4**). **Trampa de la fase (no perder):** agregar una columna con `DEFAULT` a una tabla **ya sembrada en `prueba`** (aquí `tipos_proceso`, nacida en F1) + seed con `update:{}` deja la fila vieja con el default → la pantalla mostraría costura **sin** la bandera en `prueba` aunque los tests en BD limpia pasen; **fix = backfill `UPDATE` en la migración** (lo cazó el 2º reviewer, no los tests). **Equipo:** 1 coder + 2 reviewers (el 2º validó el diseño del ADR **antes** de codear, contra D5/R4 y la liga; luego revisó el diff y halló 2 bloqueantes que el 1º no vio). La decisión de **tolerancia de sobre-corte/sobre-envío** que esto requería ya se consiguió y quedó en `DECISIONES.md` (incisos (f)/(g)). **F3-E2 ✅ cerrada** (ver arriba). Ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md).
- **F2 — Pedidos + Órdenes: ✅ COMPLETA (5/5, 17-jun-2026).** **`F2-E1` ✅ (16-jun-2026, en `prueba`, PR #46)** — módulo Pedidos internos + Pedidos Reales (vertical completo: 4 tablas, dominio, API, UI; folio por secuencia por empresa A3, importes ocultos server-side, snapshots `V1` de solo lectura D3). **Diferido pendiente de Daniel:** la política de cancelación del **Pedido Real** (solo queda un TODO; no bloquea el resto). **`F2-E2` ✅ (16-jun-2026, en `prueba`, PR #48)** — verificado por Gabriel en Swagger. Backend de Órdenes completo: 5 tablas (Orden + 34 columnas mapeadas 1:1, OrdenLinea, OrdenLineaTalla, OrdenReferencia con índice D7, OrdenComentario) + migración a mano; dominio (crear con autorrelleno + exige renglón, matriz con estado derivado `completa`/`fechaCompletada`, copiar, cancelar, referencias D7, comentarios, búsqueda combinada); total siempre derivado (sin columna total, D4/D3); folio por empresa (A3); 9 endpoints REST + OpenAPI + cliente front; script demo + guía `VERIFICACION-F2-E2.md`. **Decisiones (Gabriel, 16-jun):** UPC eliminado (sin `generarUPC`; `upc` solo dato histórico de lectura) y orden sin pedido = solo histórico (captura nueva exige renglón; FK nullable solo para el ETL). **`F2-E3` ✅ (16-jun-2026, en `prueba`, PR #50)** — verificado por Gabriel. Frontend completo de Órdenes: **componente reutilizable `matriz-color-talla`** (presentación pura A1, reuso en F3/F6: filas=colores × columnas=tallas de la curva + extra, totales en vivo, captura por teclado, solo-lectura, README del contrato) + **pantalla Producción → Órdenes** (lista+detalle: alta pedido→renglón con autorrelleno, editor de encabezado, matriz, copiar matriz, referencias D7 dinámicas por cliente, comentarios inmutables, cancelar con motivo, badge de estado derivado). Hooks TanStack, ruta y entrada de menú "Órdenes". **Sin botón "Generar UPC"** (UPC en retiro, decisión Gabriel). Review independiente APROBADO; CI frontend en verde. **`F2-E4` ✅ (16-jun-2026, en `prueba`, PR #52)** — verificado por Gabriel. Operación diaria de Órdenes: **impreso de orden (R9)** en PDF server-side (`@react-pdf/renderer`, primer PDF de servidor del repo) individual y por **lote consolidado** (encabezado + fotos R2 + matriz con totales + telas/bordados/habilitación del BOM; **sin precios ni código de barra**; se imprime con solo `ordenes.ver`, foto faltante no truena); **consulta ligera** con filtros + impresión múltiple; **órdenes incompletas** con semáforo derivado (verde ≤3d / amarillo 4–7d / urgente >7d); **tablero 'Pedidos por mes'** con saltos; **buscador global** en el layout (folio / modelo / valor de OrdenReferencia D7). 6 endpoints nuevos con **proyecciones ligeras** (NO reusan el listado pesado de E2), todo `ordenes.ver` (**sin permisos nuevos → sin re-seed, sin migración**). Construido por **2 coders en paralelo con límites de archivos declarados** (pieza A impreso / pieza B consultas+frontend) + reviewer independiente (APROBADO; 1 menor [el impreso ya no exige `modelos.ver`] + 3 nits, todos cerrados). **`F2-E5` ✅ (17-jun-2026, verificada por Gabriel; reviewer independiente APROBADO con 0 bloqueantes + 3 menores corregidos) — CIERRE DE FASE F2.** ETL idempotente de pedidos y órdenes (7 CSVs reales, CP850) cargado vía un **modo migración** dedicado en la capa de dominio (A1, NO expuesto en el API → E1–E4 intactos): preserva folios viejos, órdenes sin pedido (idPedidoLinea NULL en las 26 históricas), estado/fechaCompletada desde el viejo, snapshots V1 y auditoría original; siembra de secuencias `pedido`/`orden` por empresa al máximo migrado (A3); despivote de la matriz parseando `Ordenes.Tallas` (catálogo real de **183 cadenas**); **reporte de cuadre en dos niveles** (filas/sumas + columnas, plan §7) que LISTA las inconsistencias para Daniel (**8 cadenas de talla ambiguas**, **~1,415 piezas sin etiqueta**, Monarch == código del modelo descartados ~3,212, **26 órdenes sin pedido**); docs de módulo `docs/modulos/{pedidos,ordenes}.md`. **En el MISMO cambio: RETIRO TOTAL de los códigos de barra** (decisión de Gabriel, ya no se usan): eliminado el módulo `codigos-barra` (front+back), el permiso `modelos.codigos-barra`, las columnas `Orden.upc` y `Empresa.upc` (migración `20260616140000_retiro_codigos_barra`), el generador/impreso de F1-E5 y su UI; deps `bwip-js` y `@react-pdf/renderer` quitadas del frontend; menú a 18. CI local verde (backend 345 + 110 migración, frontend 270). **Pendiente operativo de Gabriel:** commit → PR a `prueba` → correr `npm run etl:pedidos-ordenes` en Railway (el ETL es re-ejecutable; se vuelve a correr en F9 al corte). **Siguiente fase: `F3` — Producción / WIP** (ficha en [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md)). Ficha de F2 en [`docs/hoja-de-ruta/F2-etapas.md`](docs/hoja-de-ruta/F2-etapas.md).
- **F1 — Catálogos + Modelos: ✅ COMPLETA (15-jun-2026, en `prueba`).** Las 8 etapas hechas, verificadas por Gabriel y desplegadas en `prueba`: `F1-E1` ✅, `F1-E1B` ✅, `F1-E2` ✅, `F1-E3` ✅, `F1-E4` ✅, `F1-E5` ✅, `F1-E6` ✅ (ETL de catálogos/materiales + mapeos `MapeoMigracion` + fusión de colores; PR #42/#43) y **`F1-E7` ✅ (ETL de modelos+BOM + cuadre de fase + docs de módulo + cierre; PR #44)**. **Criterio de salida F1 cumplido:** un modelo real con su receta completa capturado y verificado en `prueba`. **Pendiente explícito (no bloquea):** el ETL de **fotos masivas** quedó construido y probado, pero la **carpeta física de fotos** (`S:\...\FotosMod` + bordados) aún no la tiene Gabriel — se corre con `--fotos-modelos`/`--fotos-bordados` cuando la consiga. **Decisión abierta para Daniel:** avío `IdHabilitacion=12` (842 recetas lo usan) fue borrado del catálogo viejo — ¿re-darlo de alta o dejarlo retirado? **Siguiente fase: `F2` — Pedidos + Órdenes** (ficha en [`docs/hoja-de-ruta/F2-etapas.md`](docs/hoja-de-ruta/F2-etapas.md)).
- **Hecho:** ingeniería inversa + diseño ✅ 100 % (validado por Daniel). **F0 (Fundación) ✅ construida y desplegada** — desde el 12-jun-2026 corre en Railway **como ambiente de prueba** (login real funcionando). El despliegue de **producción NO se monta todavía**: se contrata al acercarse el go-live, por costo (decisión de Gabriel, 12-jun-2026).
- **Pendientes manuales de Gabriel** (no bloquean el arranque de F1): cambiar el password de `admin` (seed `Control.2026!`), activar backups del Postgres en Railway, montar **Cloudflare R2** (⚠️ sí se necesita antes de F1-E3/E4, que suben fotos), borrar el servicio frontend viejo si quedó en el canvas, y proteger las ramas exigiendo los checks del CI.

```
Entender + diseñar    : ██████████  100 %  ✅
Construir (F0–F9)     : ███░░░░░░░  F2 de 10 ✅ · F3 EN CURSO (E3 ✅ de 6) — siguen F3…F9 (52 etapas planificadas)
```

| Fase | Etapas | Estado |
|---|---|---|
| **F0 · Fundación** | 5 | ✅ **hecha** (construida + desplegada como prueba, 12-jun-2026) |
| **F1 · Catálogos + Modelos** | 8 | ✅ **hecha** (8 etapas, verificadas y en prueba, 15-jun-2026) |
| **F2 · Pedidos + Órdenes** | 5 | ✅ **hecha** (5 etapas, 17-jun-2026) |
| **F3 · Producción / WIP** | 6 | 🔄 **E3 ✅** (3/6) |
| **F4 · Compras / MRP** | 6 | ⬜ |
| **F5 · Ruta Crítica ⭐** | 7 | ⬜ |
| **F6 · Calidad + EsMa** | 6 | ⬜ |
| **F7 · Costos / EDR + Indicadores** | 6 | ⬜ |
| **F8 · Finanzas (CxC/CxP + CFDI)** | 6 | ⬜ |
| **F9 · Migración + Go-live** | 7 | ⬜ |

---

## 2. Cómo funciona el trabajo (el "motor")

Cada **etapa** es una tarea cerrada que pasa siempre por el mismo circuito:

1. **El lead (orquestador)** especifica la etapa a partir de su ficha (no escribe código de producción).
2. Un **coder** la construye (o varios en paralelo **solo si** las piezas son independientes — la ficha de cada etapa ya lo dice).
3. Un **reviewer independiente** la revisa; **tiene la última palabra** y rige *"todo lo menor es mayor"* (cero pendientes diferidos).
4. **Gabriel verifica** con el checklist "Verificación de Gabriel" de la ficha (navegador o `docker compose up`).
5. Recién entonces se integra: **rama de tarea → PR a `prueba` → PR a `main`** (nunca directo), con el CI en verde.

**Reglas transversales a toda etapa** (del `PLANMAESTRO.md`, se verifican en cada review): lógica de negocio solo en `backend/src/dominio` (A1) · transacciones multi-tabla (A2) · folios por secuencia atómica (A3) · existencias solo por kardex (D3) · RBAC en cada ruta (A4) · auditoría uniforme (A7) · el contrato **OpenAPI se regenera y el cliente del frontend se sincroniza en la misma etapa** · los impresos (R9) van dentro de la etapa de su grupo funcional · la **última etapa de cada fase** incluye su parte del ETL, la doc del módulo en `docs/modulos/` y la verificación del criterio de salida en el ambiente de prueba.

---

## 3. Las fases y sus etapas

Cada fase tiene su **ficha completa** en `docs/hoja-de-ruta/F#-etapas.md`: por etapa van objetivo, alcance concreto, entregables, criterio de cierre, **checklist de verificación para Gabriel**, equipo sugerido y referencias a la doc funcional. Lo de abajo es el índice con estado. **El desglose de una fase se confirma/ajusta al arrancarla** (es plan, no escritura sagrada — lo que cambie se actualiza en la ficha y aquí).

### F0 · Fundación — ✅ HECHA

**Salida cumplida:** `docker compose up` levanta todo; app desplegada en Railway; login real; CRUD patrón (Almacenes) end-to-end.

| Etapa | Qué entregó | Estado |
|---|---|---|
| **F0-E1** | Esqueleto dockerizado (backend Fastify + frontend nginx + compose) + tema claro/oscuro | ✅ en main |
| **F0-E2** | Datos + dominio: Prisma (14 tablas), seed real FR Moda, motores comunes (folios A3, auditoría A7, permisos, archivos R2). 114 tests | ✅ en main |
| **F0-E3** | API REST + OpenAPI + login real (bloqueo a 5 intentos) + permisos server-side. 149 tests | ✅ en main |
| **F0-E4** | Frontend: login, layout 13 módulos por permisos, CRUD patrón Almacenes, cliente tipado. 38 tests | ✅ en main |
| **F0-E5** | CI bloqueante, railway.json, ADRs 0001–0006, guía Railway/R2, limpieza | ✅ en main |
| **Despliegue** | Railway (Postgres + backend + frontend privados/público) — **funge como ambiente de prueba** | ✅ 12-jun-2026 |

### F1 · Catálogos + Modelos — ✅ HECHA (15-jun-2026, en `prueba`)

**Salida cumplida:** Un modelo real con su receta completa, capturado y verificado en el ambiente de prueba. · **Ficha completa con notas de cierre:** [`docs/hoja-de-ruta/F1-etapas.md`](docs/hoja-de-ruta/F1-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F1-E1** | Catálogos sencillos + mini-pantallas de Administración (usuarios/empresas) + decisión A9 | 1 coder backend (cat.) → 1 coder backend (admin) → 1 coder frontend + 1 reviewer (cadena por contrato, ver nota de cierre) | ✅ **13-jun-2026 (en prueba)** |
| **F1-E1B** | Catálogo de Proveedores **enriquecido** (R15): roles multi-valor + campos fiscales/pago/operativos + adjuntos R2 — cimiento de las CxP (D12) | 1 coder + 1 reviewer (extiende el Proveedor de E1) | ✅ **13-jun-2026 (en prueba)** |
| **F1-E2** | Catálogos estructurados: maquila unificada, tallas/curvas D4 y clientes D7 | 3 coders en paralelo + 1 reviewer | ✅ **13-jun-2026 (en prueba)** · ⚠️ **rectificado 14-jun (D12/R15): se ELIMINÓ el catálogo de Maquilero — un maquilero es un Proveedor con roles de servicio, ver abajo)** |
| **F1-E3** | Catálogos de materiales: telas unificadas, avíos R1 y bordados con foto R2 | 3 coders en paralelo + 1 reviewer | ✅ **14-jun-2026 (en prueba)** |
| **Fusión de terceros** | Rectificación D12/R15: se eliminan los catálogos `Maquilero` (de F1-E2) y `Cortador` (de F1-E1) — UN solo catálogo de terceros: el Proveedor con casillas de roles. `precioReferencia` del cortador → desuso; el **costo del corte va en la orden (F2/F3)**. `TipoProceso` se conserva para la Ruta Crítica (F5). | 1 coder + 1 reviewer (rama `tarea/fusion-terceros`) | 🔄 14-jun-2026 |
| **F1-E4** | Modelos: ficha + fotos R2 + BOM completo | 1 coder + 1 reviewer (cadena sobre los mismos archivos) | ✅ **14-jun-2026 (en prueba)** |
| **F1-E5** | Galería de modelos + generador de códigos de barra por empresa | 2 coders + 1 reviewer | ✅ **14-jun-2026 (en prueba)** |
| **F1-E6** | ETL de catálogos y materiales + mapeos reutilizables + fusión de colores | 2 coders en paralelo + 1 reviewer | ✅ **15-jun-2026 (en prueba)** · PR #42/#43 |
| **F1-E7** | ETL de modelos + BOM + fotos masivas + docs del módulo + cierre de fase en `prueba` | 1 coder + 1 reviewer | ✅ **15-jun-2026 (en prueba)** · PR #44 · **cierre de fase F1** |

### F2 · Pedidos + Órdenes — ✅ HECHA (5 etapas, 17-jun-2026)

**Salida:** Un pedido fluye hasta su orden; impreso de orden. · **Ficha completa:** [`docs/hoja-de-ruta/F2-etapas.md`](docs/hoja-de-ruta/F2-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F2-E1** | Pedidos internos + Pedidos Reales | 1 coder + 1 reviewer (con corte de contingencia E1a/E1b previsto) | ✅ **16-jun-2026 (en prueba)** · PR #46 |
| **F2-E2** | Órdenes: datos + dominio + API | 1 coder + 1 reviewer (review en dos cortes) | ✅ **16-jun-2026 (en prueba)** · PR #48 |
| **F2-E3** | Frontend de órdenes: componente MatrizColorTalla (se reusa en F3/F6) + captura completa | 1 coder + 1 reviewer | ✅ **16-jun-2026 (en prueba)** · PR #50 |
| **F2-E4** | Consultas, tableros, búsqueda global e impreso de orden | 2 coders en paralelo + 1 reviewer (límites de archivos declarados) | ✅ **16-jun-2026 (en prueba)** |
| **F2-E5** | ETL de pedidos y órdenes + documentación + cierre de fase (+ retiro total de códigos de barra) | 1 coder + 1 reviewer | ✅ **17-jun-2026** · cierre de fase F2 |

### F3 · Producción / WIP — 🔄 EN CURSO (3/6)

**Salida:** Una orden recorre todo el ciclo; inventario PT cuadra por kardex. · **Ficha completa:** [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F3-E1** | Modelo de datos F3 + motor kardex genérico + catálogos base | 1 coder + 2 reviewers | ✅ **17-jun-2026** |
| **F3-E2** | Corte + envío a maquila unificado | 1 coder + 1 reviewer | ✅ **18-jun-2026** |
| **F3-E3** | Inventario PT operable: movimientos, traspasos, existencias y kardex | 1 coder + 1 reviewer | ✅ **19-jun-2026** |
| **F3-E4** | **Recibo de maquila ⭐** — transacción WIP + kardex PT + cargo EsMa (el punto de integración central del plan) | 1 coder + 2 reviewers independientes | ⬜ |
| **F3-E5** | Entrega a cliente + tablero WIP y consultas | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F3-E6** | ETL de producción e inventario PT + cuadre + docs + cierre de fase | 2 coders en paralelo + 1 reviewer | ⬜ |

### F4 · Compras / MRP — ⬜ pendiente

**Salida:** El tablero "qué tengo / qué falta" reemplaza el drive manual. · **Ficha completa:** [`docs/hoja-de-ruta/F4-etapas.md`](docs/hoja-de-ruta/F4-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F4-E1** | Kardex de telas y avíos + pantallas de inventario | 1 coder + 1 reviewer (la más cargada de la fase; contingencia prevista en la ficha) | ⬜ |
| **F4-E2** | Órdenes de compra: captura, autorización, cancelación, consultas e impresos | 1 coder + 1 reviewer (puede correr en paralelo con E1) | ⬜ |
| **F4-E3** | Recepción de compras: lotes D5, entrada al kardex y evento para la RC | 1 coder + 1 reviewer (+2º reviewer recomendado) | ⬜ |
| **F4-E4** | Explosión R3, generar OC desde la explosión y tablero "qué tengo / qué falta" | 1 coder + 1 reviewer | ⬜ |
| **F4-E5** | Notas de salida estructuradas: captura, consumo de avíos, consultas e impreso | 1 coder + 1 reviewer | ⬜ |
| **F4-E6** | ETL + cuadre de existencias, docs de módulos y cierre de fase | 2 coders en paralelo + 1 reviewer | ⬜ |

### F5 · Ruta Crítica ⭐ — ⬜ pendiente

**Salida:** Una orden corre con su RC y las fechas se llenan solas donde aplica. · **Ficha completa:** [`docs/hoja-de-ruta/F5-etapas.md`](docs/hoja-de-ruta/F5-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F5-E1** | Procesos como datos: catálogo + roles responsables + DAG de dependencias + checklists | 1 coder + 1 reviewer | ⬜ |
| **F5-E2** | Plantillas de ruta por familia + reglas de duración + calendario laboral | 2 coders en paralelo + 1 reviewer (solo si no hay solape) | ⬜ |
| **F5-E3** | Motor RC parte 1: jobs + datos de la ruta viva + generación de ruta | 1 coder + 2 reviewers | ⬜ |
| **F5-E4** | Motor RC parte 2: CPM en pg-boss + captura de avance + semáforo | 1 coder + 2 reviewers | ⬜ |
| **F5-E5** | Pantallas: Programar RC, bandeja de tareas con semáforo, RC por orden | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F5-E6** | Auto-avance: eventos de dominio en F3/F4 y suscriptor de la RC | 1 coder + 1 reviewer | ⬜ |
| **F5-E7** | Concentrado planeado vs real + exportación + ETL + docs + cierre de fase | 2 coders en paralelo + 1 reviewer | ⬜ |

### F6 · Calidad + EsMa — ⬜ pendiente

**Salida:** EsMa cuadra contra los recibos del periodo. · **Ficha completa:** [`docs/hoja-de-ruta/F6-etapas.md`](docs/hoja-de-ruta/F6-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F6-E1** | Calidad: catálogo de defectos + motor de planes AQL + consulta de bitácora | 1 coder + 1 reviewer (Calidad y EsMa pueden correr en paralelo) | ⬜ |
| **F6-E2** | Calidad: auditorías con folio atómico + resultado AQL + integración RC | 1 coder + 1 reviewer | ⬜ |
| **F6-E3** | Calidad: consulta e impresión, historial por maquilero, modificar/cancelar | 1 coder + 1 reviewer | ⬜ |
| **F6-E4** | EsMa: movimientos, validación de cargos, saldos, conciliación, recibo de pago | 1 coder + 1 reviewer | ⬜ |
| **F6-E5** | EsMa: estado de cuenta, consultas semanales, impreso + vista móvil | 1 coder + 1 reviewer | ⬜ |
| **F6-E6** | ETL Calidad + EsMa, reporte de cuadre v1 vs v2, docs y cierre de fase | 2 coders en paralelo + 1 reviewer | ⬜ |

### F7 · Costos / EDR + Indicadores — ⬜ pendiente

**Salida:** Costos y tableros cuadran contra el cálculo manual. · **Ficha completa:** [`docs/hoja-de-ruta/F7-etapas.md`](docs/hoja-de-ruta/F7-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F7-E1** | Motor de costeo: pre-costo, costo de orden y márgenes por pedido (D1) | 1 coder + 1 reviewer | ⬜ |
| **F7-E2** | EDR automatizado: generación desde entregas, conciliación, consultas | 1 coder + 1 reviewer | ⬜ |
| **F7-E3** | Motor de KPIs en segundo plano (pg-boss) + tableros directivos (D11) | 1 coder + 1 reviewer (+1 coder opcional para páginas) | ⬜ |
| **F7-E4** | Productividad unificada IP/Almacén + fichas confiables + muestrarios | 1 coder + 1 reviewer | ⬜ |
| **F7-E5** | Inventario cíclico contra el kardex propio (D6) + auditoría 5S | 1 coder + 1 reviewer | ⬜ |
| **F7-E6** | ETL histórico + cuadre numérico v1 vs v2 + docs y cierre de fase | 1 coder + 1 reviewer | ⬜ |

### F8 · Finanzas (CxC/CxP + CFDI) — ⬜ pendiente

**Salida:** CxC y CxP cuadran por suma de movimientos; un CFDI de proveedor y uno de venta importados, conciliados y ligados a su operación; reporte fiscal para el contador. · **Ficha completa:** [`docs/hoja-de-ruta/F8-etapas.md`](docs/hoja-de-ruta/F8-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F8-E1** | Motor de cuenta corriente de terceros (generaliza EsMa, R10): movimiento con ejes origen+fiscal, saldo = Σ movimientos, notas de crédito, dos vistas | 1 coder + 2 reviewers (motor central) | ⬜ |
| **F8-E2** | CxP — cuentas por pagar de proveedores: cargos desde recibos/entradas/OC, pagos/abonos, estado de cuenta, conciliación con maquila (EsMa) | 1 coder + 1 reviewer | ⬜ |
| **F8-E3** | Importación de CFDI de proveedores (R11): parseo/validación del XML, ligado a OC/entrada, conciliación del cargo, XML en R2 | 1 coder + 1 reviewer | ⬜ |
| **F8-E4** | CxC — cuentas por cobrar + importación de CFDI de ventas (R12): XML timbrado por fuera → cargo CxC ligado a pedido/cliente, cobros, estado de cuenta | 1 coder + 1 reviewer | ⬜ |
| **F8-E5** | Reportes fiscales para el contador (R13): exportación de movimientos fiscales de clientes y proveedores; vistas y conciliaciones | 1 coder + 1 reviewer | ⬜ |
| **F8-E6** | ETL de saldos/históricos de terceros (desde SINUBE/CFDI) + cuadre + docs del módulo + cierre de fase en `prueba` | 1 coder + 1 reviewer | ⬜ |

> **Nota F8:** el **timbrado nativo vía PAC (R14)** es sub-entrega **posterior** (lo regulado) — no entra en estas 6 etapas; queda como visión a futuro una vez que R10–R12 dejaron la estructura lista. El **catálogo de proveedores enriquecido (R15)** NO está aquí: se construye antes, en **F1-E1B** (es el cimiento de las CxP). El desglose se confirma/ajusta al arrancar la fase (esquema Prisma y pantallas se definen al construir, D12 §8).

### F9 · Migración + Go-live — ⬜ pendiente

**Salida:** Saldos v2 = saldos Access en fecha de corte; usuarios operando. · **Ficha completa:** [`docs/hoja-de-ruta/F9-etapas.md`](docs/hoja-de-ruta/F9-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F9-E1** | Cimientos del ETL integrado: extracción al corte + transporte a la nube + staging + "modo migración" + consola | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F9-E2** | ETL bloque A: usuarios + catálogos + modelos/BOM + pedidos + órdenes + calibrador de folios | 1 coder + 1 reviewer | ⬜ |
| **F9-E3** | ETL bloque B: producción M/A + kardex PT + telas + OC/notas + EsMa + costos + RC/CC | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F9-E4** | Archivo histórico de solo lectura + frontera de 10 años por grafo | 1 coder + 1 reviewer | ⬜ |
| **F9-E5** | Saldos iniciales como AJUSTE de kardex + reporte de cuadre v1 vs v2 | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F9-E6** | Capa de seguridad de usuarios + fotos a R2 + tablero de go-live | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F9-E7** | Prueba reina + ensayo del corte + capacitación + **paralelo 2–4 semanas con cuadre diario** + corte final y go-live | 1 coder + 1 reviewer; Gabriel opera el cuadre; Daniel valida | ⬜ |

> **Nota F9:** aquí también se monta el **ambiente de producción en Railway** (hoy solo existe el de prueba, por costo) y el **modo mantenimiento** para congelar capturas durante el corte.

---

## 4. Piezas que el plan §6 no asignaba a ninguna fase (ya asignadas — auditoría 12-jun-2026)

- **Módulo 12 · Documental:** los **adjuntos por orden/modelo (R6)** → etapa final de **F2** (la Orden es su ancla; el motor R2 existe desde F0). Las **fichas técnicas estructuradas (R5)** → **F6** (la auditoría AQL las consume como referencia). Confirmar al arrancar cada una.
- **Módulo 13 · Administración (lo que faltaba):** pantallas de usuarios/empresas → **F1-E1** (ya en la ficha) · consulta de bitácora → **F6-E1** (ya en la ficha) · configuración por empresa (ex-`Propiedades`) → **F1** (confirmar al arrancar) · **modo mantenimiento** → **F9**.
- **Respaldo doble** (job pg-boss con `pg_dump` diario cifrado a R2, §2.2 del plan): etapa chica al **inicio de F1**, en cuanto Gabriel monte R2. Es la mitigación #1 de la tabla de riesgos y hoy nadie la tiene.
- **Impreso "Lista de precios"** (R9): sin módulo claro — decidir en F1 (si el precio vive en el modelo) o F2 (si es por cliente).
- **Deuda técnica — borrado físico en R2 (diferido, Gabriel 14-jun-2026):** hoy borrar una foto/adjunto elimina el registro en BD pero deja el objeto **huérfano en R2** (el motor `backend/src/comun/archivos.ts` no tiene `DeleteObject`). Fix **global** para los 3 módulos que suben archivos (modelos, bordados, proveedores): borrar el objeto en R2 **tras el commit** de la transacción y **best-effort** (si R2 falla → log + limpieza posterior; nunca romper el borrado del usuario). Sin fase asignada — retomar cuando se priorice.

## 5. Fuera de alcance del primer desarrollo (para que nadie lo busque como "hueco")

- **R8** (importar pedidos de clientes y generar órdenes): es "Etapa 2" **por decisión del dueño**. D7 (campos por cliente) se diseña en F1/F2 sabiendo que R8 se apoyará en él.
- **Promoda** (D9): cliente extinto — sus tablas NO se migran. **Proscai** (D6): ERP retirado — la comparación de cíclico es contra el propio kardex.

## 6. Decisiones de negocio aún abiertas (agendar con Daniel, con fecha límite)

| Decisión | Cuándo se necesita |
|---|---|
| **D2** — detalles de por qué Costos/EDR no se usa hoy | antes de abrir **F7** (sesión durante F5/F6) |
| **D8** — ubicación final de Control de Calidad (¿proceso de la RC?) | al cerrar **F5** |
| **A9** — qué catálogos son por empresa vs globales | en **F1-E1** (la firma Gabriel) |
| **Historia de las 6 empresas viejas INACTIVAS** (MJD, Zipora, Skintex, Free Ride, Corporativo MJD, Marilyn — **444 pedidos / ~1,528 órdenes**, casi todo **2005–2012**) — ¿migrar a v2 y a qué empresa? **POR AHORA NO SE MIGRA** (decisión Gabriel 17-jun-2026; el ETL F2-E5 las omite y las lista en el reporte de cuadre). Solo se migró el negocio reciente (Marilyn Fitness + FR Moda, 2012→2026). MJD/Corporativo/Marilyn son el linaje viejo de FR Moda (candidatos a folder ahí); Zipora/Skintex/Free Ride eran empresas aparte. | revisar con Daniel **antes de F9** (el ETL se re-corre al corte; ahí se decide si se rescata esa historia) |

## 7. ¿Cuánto tarda? (gruesa, honesta)

Los agentes comprimen en horas lo que tomaría semanas; el **calendario real** lo mandan tus verificaciones por etapa, los pasos manuales de infra y, al final, las **2–4 semanas fijas de paralelo** (F9-E7, no se aceleran: son el seguro de que todo cuadra antes de apagar el viejo). Fases pesadas: **F3**, **F5** y **F9**. Orden de magnitud total: **unos pocos meses**.

## 8. Cómo se mantiene este documento (regla para toda sesión)

1. Al **cerrar una etapa**: cambiar su ⬜ → ✅ (con fecha) aquí **y** en la ficha de la fase; actualizar la sección *¿Dónde vamos?*.
2. Al **arrancar una fase**: revisar su ficha completa y confirmar/ajustar el desglose (los ajustes se escriben en la ficha, con una línea de por qué).
3. Decisiones de negocio nuevas → `Documentacion_MJD/DECISIONES.md`; decisiones técnicas → ADR en `docs/arquitectura/`. Este documento solo **apunta**, no duplica.
