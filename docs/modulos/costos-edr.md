# Módulo — Costos y EDR (F7)

> Cómo quedó construido el módulo de **Costos y Estado de Resultados** en CONTROL v2. No duplica el
> funcional (ADR-0002): para el QUÉ del negocio, ver `Documentacion_MJD/06-Costos-y-EDR.md` y
> `DECISIONES.md` §D1/D2. Aquí va el CÓMO de v2.

Construido en F7 (etapas E1 = costo por orden, E2 = EDR mensual, E6 = ETL de cierre). Es el **módulo
10** del plan.

## Alcance

- **Costo REAL por orden** (F7-E1): el costeo de cada orden de producción, valuado a **costo ACTUAL**
  (D1: precios vigentes, nunca `CostoViejo`), con un **doble juego** de componentes — el TEÓRICO
  (calculado en vivo de la receta) y el GUARDADO (lo que el usuario confirma o ajusta).
- **EDR** (F7-E2): el estado de resultados mensual, **consolidado** y **generado** desde las ventas
  reales del mes, valuado siempre a costo actual (D1).

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/costos/`:
  - `costo-orden.ts` — `obtenerCostoOrden` / `guardarCostoOrden` / `listarCostos`. `guardarCostoOrden`
    es **UNA transacción (A2)**: congela el TEÓRICO al momento (`*Calc` = receta `paraCosto` × precios
    vigentes × piezas cortadas), toma los GUARDADOS del cuerpo (los que no vengan caen al teórico
    congelado) y **arma `costoTotal` = tela + procesos + avíos + otros** (la ARMA el servidor, nunca
    se edita a mano). Permiso `costos.capturar` (A4), auditoría A7, empresa activa (A9). Una orden
    marcada **`noCostear` se RECHAZA** (mensaje claro). Los importes van a `null` sin
    `consultas.ver-importes`.
  - `cantidades.ts` — `cantidadesDeOrden(es)`: las cantidades derivadas (pedido / cortado / recibido /
    vendido) por **agregación** de las etapas de producción (F3), base del prorrateo del unitario.
  - EDR (`edr.ts` y afines) — el **generador** del EDR mensual: propone una `EdrLinea` por orden
    vendida del mes desde las entregas a cliente de F3 y **reconcilia** en cada re-generación (origen
    `automatica`/`ajustada`/`manual`). El COSTO NO se congela en la línea: se **recalcula desde
    `CostoOrden`** al leer (D1). El EDR es **consolidado** (no se acota a la empresa activa); los
    cortes por empresa/cliente se DERIVAN de las líneas (D2 #6).
- **Migración** `backend/migracion/` (F7-E6): `loaders/costos.ts` + `etl-costos.ts` + el análisis de
  regalías de `cuadre-f7.ts`.

## Modelo de datos (`backend/prisma/schema.prisma`)

- **`CostoOrden`** (uno por orden, `idOrden` @unique): `telaCalc`/`telaCost`, `procesosCalc`/
  `procesosCost` (**maquila + estampado + otros procesos**), `aviosCalc`/`aviosCost` (**habilitación
  de costura + empaque**), `otros`/`descOtros`, `costoTotal` (Σ de los guardados), `baseProrrateo`
  (default `cortado`). Todo NULLABLE (patrón *ceronulo*: un componente sin capturar cuenta como 0).
  **La REGALÍA NO es componente** (D2, 2026-07-02): va sobre la venta → NO hay `regaliasCalc/Cost`.
- **`Edr`** (uno por año-mes, sin `idEmpresa`: consolidado): gastos / intereses / bonificaciones /
  otros GLOBALES del mes (D2 #6). Ventas y Costo se derivan de las líneas al leer.
- **`EdrLinea`** (una venta del mes, por orden/modelo): `cantVendida`, `precioVenta` (**lo FACTURADO**,
  editable — D2 #5), `costoHistorico` (solo-informativo, lo llena el ETL; el EDR valúa a costo actual),
  `origen` (gobierna la reconciliación).

## Fórmulas (doc 06 §3, D1/D2)

- **Teórico por prenda** = Σ (`ModeloTela.consumoPorPrenda` × `Tela.precioSugerido` de la receta
  `paraCosto`) para tela; Σ (`ModeloAvio.consumoPorPrenda` × `Avio.precioReferencia`) para avíos;
  `(maquilaOrd ?? modelo.maquilaBase) + aplicacionOrd + Σ bordados` para procesos. Todo a **costo
  ACTUAL** (D1). Los totales teóricos = por-prenda × piezas **cortadas**.
- **`costoTotal`** (el dinero REAL) = `telaCost + procesosCost + aviosCost + otros`. La **regalía NO
  entra** (D2).
- **Costo unitario** = `costoTotal ÷ cantidadBase`, con `cantidadBase` según `baseProrrateo` (default
  `cortado`). Cambiar la base cambia el unitario (el total es fijo, el divisor varía) — D2.
- **Precio de venta sugerido**: redondeo **AL ALZA** (D2); la regalía se calcula **sobre la venta**,
  no dentro del costo (D2).

## Migración del histórico (F7-E6)

`CostoOrd.csv` (2,513) → `CostoOrden` vía `guardarCostoOrden` (modo migración, A1), idempotente
(salta órdenes ya costeadas) y por lotes. Mapeo (**D2 — la regalía sale del costo**):

| viejo (`CostoOrd`) | v2 (`CostoOrden`) |
|---|---|
| `TelaCost` | `telaCost` |
| `HabCost` | `aviosCost` (habilitación de costura + empaque) |
| `MaquilaCost + BordCost` | `procesosCost` (maquila + bordado) |
| `Otros` / `DescOtros` | `otros` / `descOtros` |
| `RegaliasCost` | **NO se migra** (va sobre la venta, D2) |

- **Hallazgo empírico (cuadre):** se verificó sobre el CSV que el `Costo` viejo **INCLUÍA la
  regalía** (`Costo == tela+hab+bord+maquila+regalia+otros` en las 305 de 362 filas con regalía ≠ 0;
  57 no casan por inconsistencias del dato viejo, LISTADAS). Por eso el `costoTotal` v2 es menor por
  **Σ RegaliasCost**: un **delta ESPERADO por diseño (D2)**, documentado en `cuadre-f7.ts`, NUNCA
  corregido en silencio (§7). El `Costo` viejo se preserva en el `MapeoMigracion` para trazabilidad.
- Órdenes `noCostear` o sin mapeo de F2 → **LISTADAS y OMITIDAS** (no se fuerza el costeo).
- **EDR histórico NO se migra** (D2 #11, 2026-07-02): el EDR arranca con la facturación real de 2026.
  Los CSV `EdoResult`/`EdoResultDet` se ignoran (la columna `EdrLinea.costoHistorico` existe para
  conservar el dato si algún día se decide migrarlo, pero hoy nace NULL).

Se corre con `npx tsx --env-file=.env migracion/etl-costos.ts` (ver `migracion/README.md`).

## Decisiones aplicadas

- **D1** — valuación a **costo ACTUAL** (nunca `CostoViejo`).
- **D2** (2026-07-02) — **regalía FUERA del costo** (sobre la venta), prorrateo del unitario por base
  configurable, precio sugerido **al alza**, EDR **consolidado** y **desde la facturación real** (no
  del pedido), gastos del EDR **globales** por mes, EDR histórico **no migrado**.
- **A1/A2/A4/A7/A9** — dominio, transacción, permisos `costos.*`, bitácora (módulo financiero),
  empresa activa. Importes ocultos sin `consultas.ver-importes`.
