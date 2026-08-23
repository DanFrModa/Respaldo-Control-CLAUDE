# Módulo — Indicadores (F7)

> Cómo quedó construido el **módulo de Indicadores** en CONTROL v2. No duplica el funcional
> (ADR-0002): para el QUÉ del negocio, ver `Documentacion_MJD/05-Indicadores.md`, `08-Ruta-Critica.md`
> §4.4 y `DECISIONES.md` §D6/D11. Aquí va el CÓMO de v2.

Construido en F7 (E3 = motor de KPIs/tableros, E4 = productividad + fichas + muestrarios, E5 =
inventario cíclico, E6 = ETL de cierre). Es el **módulo 11** del plan.

## Alcance

- **Productividad unificada IP / Almacén** (F7-E4): índices de productividad vs estándar, con **un
  solo motor** distinguido por `area` (Ingeniería del Producto / Almacén) en vez de las tablas
  paralelas del viejo (A6/D4).
- **Fichas confiables** (F7-E4): checklist de confiabilidad de la ficha técnica **por orden**.
- **Muestrarios pendientes** (F7-E4): seguimiento boards/muestras (solicitud → entrega) con KPI de
  cumplimiento.
- **Inventario cíclico** (F7-E5): conteo físico **contra el kardex propio de v2** (D6).
- **Tableros/KPIs directivos** (F7-E3): sobre **vistas materializadas** que refresca un job de
  pg-boss; la captura nunca espera un recálculo (muestra "datos al: `<fecha>`").

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/indicadores/`:
  - `productividad.ts` — CRUD de `PersonalArea` y `ActividadProductividad` (catálogos GLOBALES,
    ADR-0007) + `registrarProductividad` / `cancelarRegistroProductividad` + el **tablero agregado en
    servidor**. El `area` la determina la ACTIVIDAD (se sella). **IP** exige `idPersona` (área ip) y
    `horasBase`; **Almacén** usa la cuadrilla `personas` y el estándar `pzPersDia > 0` (divisor del
    índice). Cancelación SUAVE (A7); nunca se edita/borra.
  - `fichas.ts` — `obtenerFichaOrden` / `verificarFichaOrden` (upsert por `(idOrden, idReactivo)`).
    El indicador **% de fichas confiables** = Σ reactivos OK ÷ Σ evaluados, agregado en SQL.
  - `muestrarios.ts` — `crearMuestrario` / `actualizarMuestrario` / `entregarMuestrario` /
    `cancelarMuestrario` + el KPI de cumplimiento (`fechaEntregado ≤ fechaRequerida`).
  - `inventario-ciclico.ts` — `crearInventarioCiclico` (ALTA que **CONGELA el teórico** desde el
    kardex, D6), `capturarConteo` (**ciego**), `consultarExactitud`, `generarAjusteCiclico` (el ajuste
    es un **movimiento de kardex**, D3, nunca una edición de saldo) y `cancelarInventarioCiclico`.
  - `kpis.ts` / `fechas.ts` — los tableros sobre vistas materializadas y el gate de "fecha libre".
  - `migracion.ts` (F7-E6) — `crearInventarioCiclicoMigrado`: modo migración del cíclico histórico
    (ver abajo).
- **Migración** `backend/migracion/loaders/indicadores-*.ts` + `etl-indicadores.ts`.

## Modelo de datos (`backend/prisma/schema.prisma`)

- **`PersonalArea`** (catálogo global): persona del área; `horasBase` solo aplica a IP.
- **`ActividadProductividad`** (catálogo global): una actividad por área; IP usa `porcentajeD`,
  almacén usa `pzPersDia`+`porcenPzas` (A6: campos configurables, no columnas por módulo).
- **`RegistroProductividad`**: registro diario (área, actividad, `cantidad`, `horasTrabajadas`,
  cuadrilla `personas`, opcional `idPersona` en IP / `idCliente` en almacén). Cancelación suave. A9.
- **`ChecklistFichaDef`** (catálogo global): reactivo del checklist; el seed siembra los **8 fijos**
  del viejo (`InfGeneral`..`MedidasPrendas`) — se pueden agregar más sin migración (A6).
- **`FichaVerificacion`**: una fila **reactivo × orden** (`hecho`, `revisorId`, `fecha`).
- **`Muestrario`**: solicitud → entrega, con `boardsOK`/`muestrasOK`, `fechaEntregado` y cancelación
  suave; `idCliente`/`idTemporada` a los catálogos.
- **`InventarioCiclico`** / **`InventarioCiclicoDet`**: encabezado (folio A3, almacén, estado) +
  detalle a la granularidad REAL del kardex (**modelo×color×talla×orden×almacén**, ADR-0014).
  `cantTeorica` congelada, `cantReal` (conteo ciego), `idMovimientoAjuste` (traza del ajuste D3).
- **`KpiRefresco`**: sello de la última materialización de las vistas de KPIs.

## Inventario cíclico contra el kardex propio (D6 / D3 / D4)

El **alta CONGELA** `cantTeorica` = Σ de movimientos del artículo **en ese instante** (bajo lock por
artículo, suma directa NUNCA la vista); el **conteo es CIEGO** (el capturista no ve el teórico); el
**ajuste** aplica el delta como **movimiento de kardex** (entrada/salida), jamás editando un saldo
(D3). Las salidas validan no-negativo bajo lock por artículo. Máquina de estados
`abierto → contado → cerrado` (o `cancelado`).

## Migración del histórico (F7-E6)

`etl-indicadores.ts` orquesta, en ORDEN, VÍA los servicios de dominio (A1), idempotente y por lotes:

1. **Catálogos** (globales): `IP_Personal` → `PersonalArea` (ip), `IP_Actividades` →
   `ActividadProductividad` (ip), `Alm_Prd_Act` → `ActividadProductividad` (almacen).
2. **Productividad IP**: `IP_Productiv` → `RegistroProductividad` (1 por fila).
3. **Productividad Almacén**: `Alm_Prd` × `Alm_Prd_Det` → `RegistroProductividad` (1 por DETALLE,
   aplanando el encabezado-día: fecha/cuadrilla/horas).
4. **Baja suave** de las personas de IP que el viejo tenía inactivas — se aplica **DESPUÉS** de su
   productividad (`registrarProductividad` rechaza a una persona desactivada; las personas 4/5 del
   viejo son inactivas PERO tienen registros).
5. **Fichas**: `IP_InfConf` → `FichaVerificacion`, **despivotando** las 8 columnas booleanas contra
   los 8 `ChecklistFichaDef`. El **revisor viejo** (`IdUsuarios`) se **PRESERVA** como `revisorId`
   (texto sin FK, ADR-0005; F10 remapea) corriendo con una sesión con ese id (patrón D11). `Observ`
   (texto libre) NO se migra (no hay campo en el modelo; se LISTA).
6. **Muestrarios**: `IP_MuesPend` → `Muestrario` con su ciclo de vida (entrega/cancelación). El
   `Cliente` es TEXTO → se resuelve por **nombre** contra el catálogo; sin match (p. ej. "Walmart",
   "Soriana") → OMITIDO y LISTADO (no se inventa un cliente). El solicitante viejo se preserva.
7. **Inventario cíclico histórico Proscai (D6)**: `Alm_InvCic` → `InventarioCiclico` vía
   `crearInventarioCiclicoMigrado` — es de **origen EXTERNO** (Proscai), "solo consultable, NO
   comparable contra el kardex v2". Se carga como registros **CERRADOS** con `cantTeorica =
   CantProscai` (NO la suma del kardex de v2) y **SIN ajuste de kardex** (`idMovimientoAjuste` NULL:
   no reconcilia contra v2). Como el viejo solo tenía **modelo + fecha**, se usan **SENTINELAS**:
   Color/Talla `(sin especificar)` inactivos (los mismos de F3-E6/IPT) + almacén `(Migración
   Proscai)` inactivo (tipo PT); `idOrden` NULL. El `ModeloIC` (texto) se resuelve por **código**;
   sin match → LISTADO. Aquí `cerrado` significa "histórico terminado e inmutable" (no "ajuste
   aplicado"): las transiciones normales rechazan un cerrado, así que el histórico queda a salvo, y la
   vista de exactitud lo muestra (consultable, D6).

Se corre con `npx tsx --env-file=.env migracion/etl-indicadores.ts` (ver `migracion/README.md`). El
cuadre (`cuadre-f7.ts`) reporta los conteos v1/v2 por entidad; los `v2 ≤ v1` son ESPERADOS (mapeos
faltantes / datos inválidos) y se explican por renglón.

## Decisiones aplicadas

- **D6** — inventario cíclico contra el **kardex propio** (teórico congelado, conteo ciego, ajuste por
  movimiento); el **histórico Proscai** es externo, no comparable, sin ajuste.
- **D11** — KPIs directivos; captura preservada (`revisorId`/`capturadoPor` del histórico).
- **D4/A6** — motor de productividad **configurable por área** (filas, no tablas paralelas).
- **ADR-0007** (catálogos globales), **ADR-0014** (PT por orden), **A1/A2/A3/A7/A9**.
