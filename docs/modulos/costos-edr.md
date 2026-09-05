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
  (⭐ default **`recibido`** desde 0.061; hasta esa versión, `cortado`) y el **costo congelado** del
  cierre de la orden (`cantidadBaseCongelada`, `costoUnitarioCongelado`, `congeladoEn`,
  `descongeladoEn` — ver §Fórmulas). Todo NULLABLE (patrón *ceronulo*: un componente sin capturar
  cuenta como 0).
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
- **Costo unitario** = `costoTotal ÷ cantidadBase`, con `cantidadBase` según `baseProrrateo`. Cambiar
  la base cambia el unitario (el total es fijo, el divisor varía) — D2.
  - ⭐ **El default es `recibido` desde 0.061** (§Post-F9.154(b), DANIEL; antes era `cortado`).
    *«Las 10 faltantes se las voy a cobrar al maquilero… esas las sacaría de la ecuación. Y las
    segundas también se venden a un Saldero. Las únicas que se pierden por completo son las
    incompletas.»* ⇒ primeras y segundas **sí** entran al divisor (se venden), faltantes **no** (se
    cobran en EsMa) e incompletas **tampoco** (son la merma). Dividir entre las CORTADAS quedó
    descartado porque **escondería el costo de la merma**. ⚠️ Sólo hacia adelante: la migración **no
    reescribe** las órdenes ya costeadas (REGLA 0-B).
  - ⚠️ Imprecisión **declarada y no corregida**: el cobro del faltante al maquilero NO baja el costo
    de la orden (vive en EsMa, otra cuenta).
  - **Cuando la base es 0** (una orden recién cortada, sin recibos), no hay unitario y la salida
    **DICE POR QUÉ**: `motivoSinUnitario` (`sin-base` | `sin-costo` | `sin-importes`) + la frase
    `textoSinUnitario`, que **redacta el servidor** (`unitarioODeuda`, `cantidades.ts`) para que la
    ficha de costeo y la lista de costos no puedan decir cosas distintas.
- ⭐⭐ **EL COSTO SE CONGELA AL CERRAR LA ORDEN** (0.061 — §Post-F9.154(c); *«¿en qué momento se
  define que ya se cerró el costo? ¿O va cambiando?»*). Hasta 0.061 **iba cambiando**: el dinero se
  persistía, pero la **cantidad** del divisor se re-sumaba en CADA lectura — con `recibido` el
  unitario habría quedado vivo hasta el último recibo, para siempre. Al **cerrar la orden** (acto
  explícito, permiso `ordenes.cerrar`, ver `docs/modulos/produccion-wip.md`) se persisten
  `CostoOrden.cantidadBaseCongelada` + `costoUnitarioCongelado` + `congeladoEn`, y **toda lectura
  posterior usa el divisor congelado**. Son **CINCO** los sitios que publican un costo unitario, y
  los cinco lo respetan: la **ficha** de costeo y la **lista** de costos (`costos/costo-orden.ts`),
  el **EDR** (`edr/edr.ts`), la columna «costo actual» del **listado de modelos**
  (`modelos/modelos.ts`) y los **márgenes por pedido** (`costos/margenes.ts`, que lo aplica en SQL).
  La regla vive en un solo sitio (`divisorCongelado`, `costos/cantidades.ts`). La orden
  **abierta** sigue calculando en vivo. Cerrar además **rechaza capturar el costo**. **Reabrir** lo
  devuelve a cálculo vivo y **marca** lo congelado con `descongeladoEn` — no lo borra (D3).
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
| **Importe directo** | Σ (`cantidad × precio`) de las líneas de OC **ligadas a la orden** cuya OC esté `autorizada` / `recibida_parcial` / `recibida_total` (fuera: `borrador`, `pendiente_autorizacion`, `cancelada`). Sin impuestos ni descuentos: la OC no los modela. Entra **ÍNTEGRO**, nunca topado al requerido. | 1 — *manda lo comprado: la OC autorizada* |
| **Importe valuado** | `max(0, requerido − comprado)` × **último precio de compra** del material (la línea de OC autorizada+ más reciente **de la empresa activa**, sin importar a qué orden estuviera ligada). | 2 — *los genéricos, a último precio de compra*<br>3 — *la compra compartida se prorratea* |

- **El prorrateo (regla 3) sale solo:** una compra grande sin `idOrden` se vuelve "último precio"; cada
  orden se valúa por **su** consumo ⇒ el reparto es proporcional al consumo. No hay una tabla de
  prorrateo que mantener.
- **"Último precio" = el de la compra MÁS RECIENTE, venga de la orden que venga — incluida la propia
  orden.** Si esta orden acaba de comprar felpa a $30 y le falta cubrir un remanente, ese remanente se
  valúa a **$30**, no a una compra vieja de $18 de otra orden: es el costo de reponer hoy el material,
  y usar un precio viejo teniendo uno fresco sería peor. Orden determinista: **fecha de la OC DESC
  (las OC sin fecha, al final) → folio DESC → renglón DESC**; la liga a la orden no influye.
- **La SOBRE-COMPRA se costea COMPLETA** (aclaración de Daniel, 26-jul-2026): *"si se cortaron 1,000
  prendas pero la orden de etiquetas se hizo por 1,100, se debe costear el costo de la orden COMPLETA
  entre lo cortado ⇒ 1.1 etiquetas por prenda"*. El directo **jamás** se recorta a
  `min(comprado, requerido)`; el `max(0, …)` es solo para el remanente NO comprado. Comprar de más es
  normal: **no** genera aviso. El "1.1 por prenda" cae solo del `costoTotal ÷ cortado` (D2).
- **Requerido — SIEMPRE sobre las piezas CORTADAS** (la base del teórico), para que los dos números
  sean comparables y el default no meta un sesgo. El snapshot del MRP **no se usa tal cual**: nace de
  la receta `paraProduccion` y de las piezas **PEDIDAS**, así que se **ESCALA** `× (cortadas ÷ pedidas)`
  y se **RECONCILIA contra el BOM `paraCosto`** en ambos sentidos:
  - material `paraCosto` **ausente** del snapshot ⇒ se costea con la receta × cortadas **y avisa**
    (antes salía en **$0 sin decir nada**: BOM que creció, o avío `paraCosto` sin `paraProduccion`);
  - material del snapshot que **no es `paraCosto`** ⇒ **no se valúa** y avisa (su compra directa sí
    cuenta: es dinero gastado en la orden).
  Sin snapshot: receta `paraCosto` × cortadas. Sin corte: requerido 0 (solo cuenta lo comprado, con
  aviso). Se usa la cantidad **BRUTA** (antes del neteo contra stock): por eso el genérico sí se costea.
- **Fallbacks y guardas que AVISAN** (nunca se callan, mismo criterio que los `avisos` del MRP):
  material nunca comprado → **precio de catálogo**; sin catálogo → **0**; línea de OC de un material
  fuera del requerido → **entra al costo** con aviso; renglones de **compra LIBRE**
  (`descripcionLibre`) → se reportan aparte y **NO** entran a tela ni a avíos; **línea ligada con
  precio en cero**; **material requerido cuyo costo real queda en cero**; y el **comparativo**: un
  componente real por debajo de la **MITAD** de su teórico (umbral `UMBRAL_REAL_SOSPECHOSO = 0.5`).
- **Los avisos NUNCA llevan una cifra de dinero** en el texto: viajan por el mismo canal para todos,
  así que un usuario con `costos.ver` y sin `consultas.ver-importes` no puede deducir importes de
  ellos (lo verifican el test unitario y el de integración).
- **Unidades — UNA SOLA, desde V1-E8a (§Post-F9.97):** la cantidad y el precio se leen **tal cual**,
  en unidad de consumo. **No hay normalización, ni cascada de factores, ni aviso**: se retiraron los
  tres. Lo que hubo hasta F4 —y la deuda que arrastraba— quedó cerrado ahí: la traducción
  presentación→consumo vivía en medio de la cadena del dinero y, como multiplicaba la cantidad y
  dividía el precio, **el importe salía idéntico sobre números equivocados**. Lo que quedaba mal era
  el inventario, no el total, y por eso vivió meses sin que nadie lo cazara. *Sin dos unidades no hay
  traducción que equivocarse.*
- **Alcance:** solo **TELA** y **AVÍOS**. Los **procesos** (maquila/arte/bordados) no se compran con OC
  de material y siguen 100 % en el teórico. Solo cuenta la liga **por renglón**
  (`OrdenCompraLinea.idOrden`); la liga N:N de **encabezado** (`OrdenCompraOrden`) no es atribución
  directa — esas compras entran por la valuación a último precio (prorrateo por consumo).
- **Redondeo:** una sola vez y de abajo hacia arriba (compra → material → componente → total), para
  que el desglose **cuadre al centavo** con el encabezado.
- **Robustez:** `RequerimientoOrden` no tiene `@@unique(idOrden, material)`; las filas repetidas se
  **fusionan** (suma) al calcular. Se prefirió el dedupe defensivo a un índice único + migración para
  no arriesgar que la migración truene con duplicados ya existentes.
- **El DEFAULT al guardar** (el corazón de la petición): en el **PRIMER** costeo, si la orden **tiene
  compras ligadas**, `telaCost`/`aviosCost` caen al **REAL**; si no, al **teórico** (comportamiento
  previo intacto). `procesosCost` sigue al teórico. El usuario siempre puede teclear su valor. Y si la
  orden **ya estaba costeada**, **omitir** un componente lo **CONSERVA** (para borrarlo hay que mandar
  `null` explícito) — antes omitirlo lo pisaba con el default. Aplica igual a
  `otros`/`descOtros`/`observaciones`. ⭐ **Y desde 0.061 también a `baseProrrateo`, que era la
  ÚNICA excepción**: su Zod traía `.default('cortado')`, así que nunca llegaba `undefined` al dominio
  y **un PUT que la omitiera PISABA la base de una orden ya costeada**, cambiándole el unitario sin
  que nadie lo pidiera (el total no se mueve; el divisor sí). Era un defecto latente documentado como
  decisión, y al pasar el default a `recibido` habría dejado de ser latente. Hoy el campo es
  `.optional()` **sin default**: omitirlo **CONSERVA** la base guardada y, en el **primer** costeo,
  cae a `recibido` (`baseProrrateoAGuardar`, `cantidades.ts`).
- **Trazabilidad:** el real se **congela** al guardar en `CostoOrden.telaReal`/`aviosReal` (columnas
  nuevas, nullable ⇒ NULL en todo lo costeado antes; **no** entran a `costoTotal`) y
  `GET /api/costos/ordenes/{idOrden}/real` devuelve el **desglose por material**: qué se compró, a qué
  proveedor, a qué precio, cuánto se valuó y con qué precio. El **ETL de migración** llama a
  `guardarCostoOrden` con **`calcularReal: false`** (manda los tres componentes explícitos del CSV
  viejo): no calcula el real ni sella las columnas `*Real` — congelarlo sería estampar un número de
  HOY en una orden de los 90. La respuesta de `guardarCostoOrden` se arma con lo que la propia
  transacción ya leyó: **el real no se recalcula** para responder.
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
