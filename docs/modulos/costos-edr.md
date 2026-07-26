# Módulo — Costos y EDR (F7)

> Cómo quedó construido el módulo de **Costos y Estado de Resultados** en CONTROL v2. No duplica el
> funcional (ADR-0002): para el QUÉ del negocio, ver `Documentacion_MJD/06-Costos-y-EDR.md` y
> `DECISIONES.md` §D1/D2. Aquí va el CÓMO de v2.

Construido en F7 (etapas E1 = costo por orden, E2 = EDR mensual, E6 = ETL de cierre). Es el **módulo
10** del plan.

## Alcance

- **Costo REAL por orden** (F7-E1): el costeo de cada orden de producción, valuado a **costo ACTUAL**
  (D1: precios vigentes, nunca `CostoViejo`), con un **triple juego** de componentes — el TEÓRICO
  (calculado en vivo de la receta), el **REAL DE COMPRAS** (lo que de verdad se compró en OC —
  agregado el 26-jul-2026 a petición de Daniel, ver §"Costo real de materiales desde las OC") y el
  GUARDADO (lo que el usuario confirma o ajusta).
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
  - `costo-real-compras.ts` — el motor del **REAL DE COMPRAS** (ver §propia abajo): `combinarCostoReal`
    (núcleo PURO, con tests unitarios), `calcularCostoRealDeOrden` (lectura) y `costoRealOrden`
    (desglose por material, permiso `costos.ver`). Lo consumen `obtenerCostoOrden` (resumen) y
    `guardarCostoOrden` (default + congelado), y la ruta `GET /costos/ordenes/:idOrden/real`.
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

- **`CostoOrden`** (uno por orden, `idOrden` @unique): `telaCalc`/`telaCost`/**`telaReal`**,
  `procesosCalc`/`procesosCost` (**maquila + estampado + otros procesos**),
  `aviosCalc`/`aviosCost`/**`aviosReal`** (**habilitación de costura + empaque**), `otros`/`descOtros`,
  `costoTotal` (Σ de los **guardados** — los `*Real` NO entran), `baseProrrateo`
  (default `cortado`). Todo NULLABLE (patrón *ceronulo*: un componente sin capturar cuenta como 0).
  Los `*Real` (26-jul-2026) **congelan el real de compras** al guardar: trazabilidad de con qué se
  costeó, NULL en todo lo costeado antes de la columna.
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

## Costo real de materiales desde las OC (26-jul-2026, DANIEL — `DECISIONES.md` §Post-F9.5)

El teórico valúa la receta a **precios de catálogo**, y eso no es lo que costó: al comprar cambian el
**proveedor** y el **precio**. Como en v2 la compra ya se liga a la orden de producción
(`OrdenCompraLinea.idOrden`, R7/F4), el motor `costo-real-compras.ts` arma el **tercer origen**:

```
costo real del material  =  IMPORTE DIRECTO  +  IMPORTE VALUADO
```

| Pieza | Qué es | Regla de Daniel |
|---|---|---|
| **Importe directo** | Σ (`cantidad × precio`) de las líneas de OC **ligadas a la orden** cuya OC esté `autorizada` / `recibida_parcial` / `recibida_total` (fuera: `borrador`, `pendiente_autorizacion`, `cancelada`). Sin impuestos ni descuentos: la OC no los modela. | 1 — *manda lo comprado: la OC autorizada* |
| **Importe valuado** | `max(0, requerido − comprado)` × **último precio de compra** del material (la línea de OC autorizada+ más reciente **de la empresa activa**, sin importar a qué orden estuviera ligada). | 2 — *los genéricos, a último precio de compra*<br>3 — *la compra compartida se prorratea* |

- **El prorrateo (regla 3) sale solo:** una compra grande sin `idOrden` se vuelve "último precio"; cada
  orden se valúa por **su** consumo ⇒ el reparto es proporcional al consumo. No hay una tabla de
  prorrateo que mantener.
- **Requerido** = snapshot del MRP (`RequerimientoOrden.cantidadRequerida`, el consumo **BRUTO** antes
  del neteo contra stock — por eso el genérico sí se costea aunque salga del almacén). Sin snapshot,
  receta `paraCosto` × piezas **cortadas** (o pedidas si aún no hay corte): la misma base del teórico.
- **Fallbacks que AVISAN** (nunca se callan, mismo criterio que los `avisos` del MRP): material nunca
  comprado → **precio de catálogo**; sin catálogo → **0**; línea de OC de un material fuera del
  requerido → **entra al costo** con aviso; renglones de **compra LIBRE** (`descripcionLibre`) →
  se reportan aparte y **NO** entran a tela ni a avíos (captúralos en "Otros" si aplican).
- **Unidades (R1):** el importe directo no se convierte (la invariante de valuación dice que
  `cantidad × precio` no cambia). La **cantidad comprada** y el **último precio** sí se normalizan a
  unidad de consumo con **la misma cascada que la recepción** (`recepciones.ts`): tela → factor 1;
  avío → `AvioProveedor.factorConversion` del proveedor de la OC → `Avio.factorConversion` → 1. Así el
  real cuadra con el costo que entra al kardex.
- **Alcance:** solo **TELA** y **AVÍOS**. Los **procesos** (maquila/arte/bordados) no se compran con OC
  de material y siguen 100 % en el teórico.
- **El DEFAULT al guardar** (el corazón de la petición): si la orden **tiene compras ligadas**,
  `telaCost`/`aviosCost` caen al **REAL**; si no, al **teórico** (comportamiento previo intacto).
  `procesosCost` sigue al teórico. El usuario siempre puede teclear su valor, y lo ya costeado no se
  reescribe.
- **Trazabilidad:** el real se **congela** al guardar en `CostoOrden.telaReal`/`aviosReal` (columnas
  nuevas, nullable ⇒ NULL en todo lo costeado antes; **no** entran a `costoTotal`) y
  `GET /api/costos/ordenes/{idOrden}/real` devuelve el **desglose por material**: qué se compró, a qué
  proveedor, a qué precio, cuánto se valuó y con qué precio.
- **Permisos:** ninguno nuevo — `costos.ver` para consultar, `costos.capturar` para guardar, importes
  en `null` sin `consultas.ver-importes` (las **cantidades** sí se ven: no son dinero).
- **El EDR no cambia**: sigue recalculando desde `CostoOrden` al leer (D1).

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
- **Post-F9.5** (2026-07-26, Daniel) — el costo de **materiales** de la orden sale de lo **realmente
  comprado**: OC autorizada ligada a la orden (manda), genéricos y compras compartidas a **último
  precio de compra** (prorrateo por consumo). Cambia el **default** de `telaCost`/`aviosCost` al
  guardar cuando hay compras; el usuario sigue pudiendo ajustar.
- **A1/A2/A4/A7/A9** — dominio, transacción, permisos `costos.*`, bitácora (módulo financiero),
  empresa activa. Importes ocultos sin `consultas.ver-importes`.
