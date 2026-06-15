# CONTROL v2 — Hoja de ruta (plan por etapas + estado vivo)

> **Documento vivo.** Aquí está TODO el camino: las 10 fases divididas en **etapas** con su estado. La ley técnica es `PLANMAESTRO.md`; esto es el mapa y el tracker.
> **Para cualquier chat/sesión nueva:** lee `CLAUDE.md` → `PLANMAESTRO.md` → este archivo (la sección *¿Dónde vamos?*) → la **ficha completa de la fase activa** en `docs/hoja-de-ruta/` — y con eso sabes exactamente qué sigue y cómo ejecutarlo. No leas las 8 fichas: solo la de la fase en curso.
> — *Actualizado: 14-jun-2026.*

---

## 1. ¿Dónde vamos? (estado vivo — actualizar al cerrar cada etapa)

- **Fase activa:** F1 — Catálogos + Modelos. **`F1-E1` ✅, `F1-E1B` ✅, `F1-E2` ✅, `F1-E3` ✅, `F1-E4` ✅ y `F1-E5` ✅ hechas, verificadas y desplegadas en `prueba`** (F1-E5: 14-jun-2026, PR #39 — galería móvil + generador EAN-13/DUN-14 + impreso PDF de etiqueta, R9). **Siguiente etapa: `F1-E6`** (ETL de catálogos y materiales + mapeos reutilizables + fusión de colores; ficha en [`docs/hoja-de-ruta/F1-etapas.md`](docs/hoja-de-ruta/F1-etapas.md)). **Rectificación 14-jun (D12/R15, rama `tarea/fusion-terceros`):** se eliminaron los catálogos `Maquilero` y `Cortador` — un tercero se da de alta una vez como **Proveedor** y marca sus servicios con casillas de roles (sin duplicar terceros).
- **Hecho:** ingeniería inversa + diseño ✅ 100 % (validado por Daniel). **F0 (Fundación) ✅ construida y desplegada** — desde el 12-jun-2026 corre en Railway **como ambiente de prueba** (login real funcionando). El despliegue de **producción NO se monta todavía**: se contrata al acercarse el go-live, por costo (decisión de Gabriel, 12-jun-2026).
- **Pendientes manuales de Gabriel** (no bloquean el arranque de F1): cambiar el password de `admin` (seed `Control.2026!`), activar backups del Postgres en Railway, montar **Cloudflare R2** (⚠️ sí se necesita antes de F1-E3/E4, que suben fotos), borrar el servicio frontend viejo si quedó en el canvas, y proteger las ramas exigiendo los checks del CI.

```
Entender + diseñar    : ██████████  100 %  ✅
Construir (F0–F9)     : █░░░░░░░░░  F0 de 10 ✅ — siguen F1…F9 (57 etapas planificadas)
```

| Fase | Etapas | Estado |
|---|---|---|
| **F0 · Fundación** | 5 | ✅ **hecha** (construida + desplegada como prueba, 12-jun-2026) |
| **F1 · Catálogos + Modelos** | 8 | 🔄 **en curso — F1-E1 ✅, F1-E1B ✅, F1-E2 ✅, F1-E3 ✅, F1-E4 ✅ y F1-E5 ✅ (en prueba); sigue F1-E6** |
| **F2 · Pedidos + Órdenes** | 5 | ⬜ |
| **F3 · Producción / WIP** | 6 | ⬜ |
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

### F1 · Catálogos + Modelos — ⬜ pendiente

**Salida:** Un modelo real con su receta completa, capturado en el ambiente de prueba. · **Ficha completa:** [`docs/hoja-de-ruta/F1-etapas.md`](docs/hoja-de-ruta/F1-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F1-E1** | Catálogos sencillos + mini-pantallas de Administración (usuarios/empresas) + decisión A9 | 1 coder backend (cat.) → 1 coder backend (admin) → 1 coder frontend + 1 reviewer (cadena por contrato, ver nota de cierre) | ✅ **13-jun-2026 (en prueba)** |
| **F1-E1B** | Catálogo de Proveedores **enriquecido** (R15): roles multi-valor + campos fiscales/pago/operativos + adjuntos R2 — cimiento de las CxP (D12) | 1 coder + 1 reviewer (extiende el Proveedor de E1) | ✅ **13-jun-2026 (en prueba)** |
| **F1-E2** | Catálogos estructurados: maquila unificada, tallas/curvas D4 y clientes D7 | 3 coders en paralelo + 1 reviewer | ✅ **13-jun-2026 (en prueba)** · ⚠️ **rectificado 14-jun (D12/R15): se ELIMINÓ el catálogo de Maquilero — un maquilero es un Proveedor con roles de servicio, ver abajo)** |
| **F1-E3** | Catálogos de materiales: telas unificadas, avíos R1 y bordados con foto R2 | 3 coders en paralelo + 1 reviewer | ✅ **14-jun-2026 (en prueba)** |
| **Fusión de terceros** | Rectificación D12/R15: se eliminan los catálogos `Maquilero` (de F1-E2) y `Cortador` (de F1-E1) — UN solo catálogo de terceros: el Proveedor con casillas de roles. `precioReferencia` del cortador → desuso; el **costo del corte va en la orden (F2/F3)**. `TipoProceso` se conserva para la Ruta Crítica (F5). | 1 coder + 1 reviewer (rama `tarea/fusion-terceros`) | 🔄 14-jun-2026 |
| **F1-E4** | Modelos: ficha + fotos R2 + BOM completo | 1 coder + 1 reviewer (cadena sobre los mismos archivos) | ✅ **14-jun-2026 (en prueba)** |
| **F1-E5** | Galería de modelos + generador de códigos de barra por empresa | 2 coders + 1 reviewer | ✅ **14-jun-2026 (en prueba)** |
| **F1-E6** | ETL de catálogos y materiales + mapeos reutilizables + fusión de colores | 2 coders en paralelo + 1 reviewer | ⬜ |
| **F1-E7** | ETL de modelos + BOM + fotos masivas + docs del módulo + cierre de fase en `prueba` | 1 coder + 1 reviewer | ⬜ |

### F2 · Pedidos + Órdenes — ⬜ pendiente

**Salida:** Un pedido fluye hasta su orden; impreso de orden. · **Ficha completa:** [`docs/hoja-de-ruta/F2-etapas.md`](docs/hoja-de-ruta/F2-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F2-E1** | Pedidos internos + Pedidos Reales | 1 coder + 1 reviewer (con corte de contingencia E1a/E1b previsto) | ⬜ |
| **F2-E2** | Órdenes: datos + dominio + API | 1 coder + 1 reviewer (review en dos cortes) | ⬜ |
| **F2-E3** | Frontend de órdenes: componente MatrizColorTalla (se reusa en F3/F6) + captura completa | 1 coder + 1 reviewer | ⬜ |
| **F2-E4** | Consultas, tableros, búsqueda global e impreso de orden | 2 coders en paralelo + 1 reviewer (límites de archivos declarados) | ⬜ |
| **F2-E5** | ETL de pedidos y órdenes + documentación + cierre de fase | 1 coder + 1 reviewer | ⬜ |

### F3 · Producción / WIP — ⬜ pendiente

**Salida:** Una orden recorre todo el ciclo; inventario PT cuadra por kardex. · **Ficha completa:** [`docs/hoja-de-ruta/F3-etapas.md`](docs/hoja-de-ruta/F3-etapas.md)

| Etapa | Qué entrega | Equipo | Estado |
|---|---|---|---|
| **F3-E1** | Modelo de datos F3 + motor kardex genérico + catálogos base | 1 coder + 2 reviewers | ⬜ |
| **F3-E2** | Corte + envío a maquila unificado | 1 coder + 1 reviewer | ⬜ |
| **F3-E3** | Inventario PT operable: movimientos, traspasos, existencias y kardex | 1 coder + 1 reviewer | ⬜ |
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

## 7. ¿Cuánto tarda? (gruesa, honesta)

Los agentes comprimen en horas lo que tomaría semanas; el **calendario real** lo mandan tus verificaciones por etapa, los pasos manuales de infra y, al final, las **2–4 semanas fijas de paralelo** (F9-E7, no se aceleran: son el seguro de que todo cuadra antes de apagar el viejo). Fases pesadas: **F3**, **F5** y **F9**. Orden de magnitud total: **unos pocos meses**.

## 8. Cómo se mantiene este documento (regla para toda sesión)

1. Al **cerrar una etapa**: cambiar su ⬜ → ✅ (con fecha) aquí **y** en la ficha de la fase; actualizar la sección *¿Dónde vamos?*.
2. Al **arrancar una fase**: revisar su ficha completa y confirmar/ajustar el desglose (los ajustes se escriben en la ficha, con una línea de por qué).
3. Decisiones de negocio nuevas → `Documentacion_MJD/DECISIONES.md`; decisiones técnicas → ADR en `docs/arquitectura/`. Este documento solo **apunta**, no duplica.
