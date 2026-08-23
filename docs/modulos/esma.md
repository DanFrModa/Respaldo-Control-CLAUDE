# Módulo — EsMa (Estado de Cuenta de Maquileros)

> Cómo quedó construido el módulo **EsMa** en CONTROL v2. No duplica el funcional (ADR-0002): para el
> QUÉ del negocio, ver `Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md` y `DECISIONES.md`
> §F6 (decisiones (e)–(h)). Aquí va el CÓMO de v2.

Construido a lo largo de: **F3-E4** (el cargo, nacido del recibo de maquila), **F6-E4** (el corazón
contable: los 3 movimientos planos + pagos ligados), **F6-E5** (pantallas, semanales, impresos R9,
Excel) y **F6-E6** (ETL del histórico). Es la **cuenta corriente** de cada maquilero: cuánto se le
debe (cargos), cuánto se le ha abonado/descontado/pagado, y su **saldo derivado**.

## Alcance

Por cada maquilero (un `Proveedor` con rol de maquila — fusión de terceros D12/R15): **cargos** (lo
que se le debe por la maquila recibida), **abonos**, **descuentos** y **pagos** (ligados a cargos),
con **saldo DERIVADO** (nunca persistido, D3), estado de cuenta segmentable por facturación (decisión
(h)), conciliación contra los recibos de producción (F3), tablero de saldos de todos, vistas
semanales, impresos R9 (estado de cuenta + recibo de pago) y export a Excel.

## Modelo de datos (`backend/prisma/schema.prisma`)

- **`EsMaCargo`** — lo que se le debe al maquilero por una orden+proceso. Nace de un **recibo** de
  maquila (`idEtapaRecibo`, F3-E4) como `propuesto`; el admin lo **valida** fijando `cantidadReal` y
  `precioReal`. `sinCosto` = 2ª sin costo (decisión (f), se excluye del saldo). `cantidadPagada` =
  cache de prendas ya pagadas (para derivar "pagado"; el dato de verdad son las `PagoAplicacion`).
  `conFactura` se fija al validar según la modalidad del proveedor (decisión (h)). En el histórico
  migrado `idEtapaRecibo = NULL` (sin liga 1:1).
- **`AbonoMaquilero`**, **`DescuentoMaquilero`**, **`PagoMaquilero`** — los 3 movimientos **PLANOS**
  (F6-E4): el maquilero + la fecha + las observaciones viven en CADA movimiento (mejora sobre el
  viejo, que llevaba una cabecera `EsMa` por maquilero). Todos con `idEmpresa` (A9), `monto`
  `Decimal(14,2)`, `fecha` `@db.Date`, `conFactura` (decisión (h)) y `estadoRevision`
  (`capturado`/`revisado`, ex asteriscos `Rev` del viejo).
- **`PagoAplicacion`** — puente N:N pago↔cargo (decisión (g)): cuántas prendas de un cargo cubrió un
  pago y por qué importe. PK `(idPago, idCargo)`.

El **SALDO NUNCA se persiste** (D3 extendido a saldos): `Σ(cargos validados no sin-costo) + Σabonos −
Σpagos − Σdescuentos`.

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/esma/`:
  - `cargos.ts` — derivación del cargo desde el recibo + **validación** (fija cantidad/precio reales y
    `conFactura`). El cargo de **estampado** entra a su propio precio (decisión (e)). Permiso
    `esma.cargo-validar`.
  - `movimientos.ts` — `crearAbonoMaquilero` / `crearDescuentoMaquilero` + **revisión**
    (`revisarMovimiento`: `capturado`→`revisado`). `conFactura` se resuelve de la modalidad del
    proveedor (`facturacion.ts`, decisión (h)). Permiso `esma.modificar`.
  - `pagos.ts` — `crearPagoMaquilero`: **anti-doble-pago DURO** (decisión (g)). `porPagar =
    cantidadReal − Σ(PagoAplicacion.cantidad)` por **suma directa bajo `pg_advisory_xact_lock` por
    maquilero** (nunca una columna cacheada como verdad, D3); pagar de más lanza `ErrorConflicto`. El
    `monto` = Σ(cantidad × precioReal); actualiza `cantidadPagada` y **recalcula `Orden.pagada`**
    (derivada, decisión (f), `orden-pagada.ts`). Permiso `esma.ver-pagos`.
  - `saldos.ts` (`saldoDeMaquilero`) y `saldos-todos.ts` (`saldosDeTodosMaquileros`, SQL agregado, sin
    N+1) — el saldo DERIVADO, segmentable por `conFactura` (decisión (h)). Ocultan importes sin
    `consultas.ver-importes` (server-side).
  - `conciliacion.ts` (`conciliarEsMa`) — cuadra por periodo+orden+maquilero+proceso lo **recibido**
    (F3) vs lo **cargado** a EsMa; lista los `cargosSinRecibo` (histórico/manual).
  - `estado-cuenta.ts` / `semanales.ts` — estado de cuenta detallado + vistas semanales (F6-E5).
  - `maquileros.ts` — selector de maquileros de EsMa (activos con rol de maquila).
  - `migracion.ts` — **modo migración** (F3-E6 + F6-E6): `crearCargoEsMaMigrado` (cargo histórico) +
    `crearAbonoMigrado` / `crearDescuentoMigrado` / `crearPagoMigrado` (movimientos planos históricos).
    En 1 transacción (A2) + bitácora `operacion:'migracion'` (A7), `conFactura = null`, **SIN efectos
    derivados** (los pagos migrados son LIBRES: sin `aplicaciones`, sin lock, sin recomputar
    `Orden.pagada`).
- **API** `backend/src/api/esma/` — `cargos` / `cuenta` / `estado-cuenta` / `movimientos` / `pagos`
  (rutas REST con permiso verificado server-side; OpenAPI + cliente del frontend sincronizados).
- **Frontend** `frontend/src/modulos/esma/` (F6-E5) — saldos de todos + drill-down al estado de
  cuenta, captura de movimientos y pagos, validación y conciliación de cargos, recibos/pagos
  semanales, desglosado, vista móvil.
- **Impresos R9** `backend/src/dominio/esma/impresos/` — estado de cuenta (PDF) + recibo de pago (PDF)
  + export a **Excel** del estado de cuenta.

## Permisos (A4)

`esma.ver-pagos` (ver estado de cuenta + meter pagos) · `esma.modificar` (capturar/revisar
abonos/descuentos) · `esma.cargo-validar` (validar cargos). Importes ocultos sin
`consultas.ver-importes`.

## Migración del histórico (F6-E6)

ETL idempotente, por lotes, CP850, vía dominio modo-migración (`backend/migracion/`):

- `loaders/esma-cargos.ts` (`EsMa`+`EsMa_Recibos` → `EsMaCargo`; también lo corre el ETL de producción
  F3-E6, mismo `MapeoMigracion` → no duplica) y los 3 movimientos planos: `loaders/esma-abonos.ts`,
  `loaders/esma-descuentos.ts`, `loaders/esma-pagos.ts` (todos sobre el loader genérico
  `cargarMovimientosPlanosEsMa`). Orquestador **`etl-esma.ts`** (imprime el cuadre F6 + escribe
  `reporte-etl-f6e6-esma-*.txt`); cuadre de solo lectura en **`cuadre-f6.ts`**.
- **Decisiones de migración:**
  1. ⭐ **FIX de estampado (causa raíz F6-E6):** los cargos `EsEstampado=1` apuntan a un maquilero del
     catálogo `Maquileros` con `Proceso=1` (NO al catálogo aparte de 44 `Estampadores`). El loader
     resolvía el maquilero de estampado SOLO en `mapaEstampador` → **1,251 cargos válidos quedaban
     omitidos** ("maquilero sin mapeo"). Ahora se resuelve por `mapaMaquilero` (fallback estampador,
     `resolverMaquileroCabecera`); el `idTipoProceso` sigue siendo estampado. Recupera esos 1,251
     cargos; el único huérfano real (`IdEsMa_Recibos=5811`, `IdEsMa=0` sin cabecera) se lista.
  2. **Cargos históricos** con `estado` desde `RevisionPendiente` (1→`propuesto` / 0→`validado`),
     `cantidadReal`/`precioReal` = los reales ya conciliados del viejo, `idEtapaRecibo = NULL` (el
     viejo no ligaba recibo↔cargo 1:1 — no-cuadre conocido 12,440 recibos vs 7,401 cargos).
  3. **Movimientos planos:** el maquilero + la fecha vienen de la **cabecera `EsMa`**;
     `conFactura = null` (el viejo no tenía el flag). Montos **negativos** de abonos/descuentos ("saldo
     anterior") **se preservan tal cual** (por eso se insertan directo, sin la validación Zod del
     servicio normal). Monto nulo → 0. `estadoRevision`: abonos/descuentos → `revisado` (ya
     conciliados, no traían bandera); **pagos** por `RevisionPendienteP` (1→`capturado` / 0→`revisado`).
  4. **Pagos históricos LIBRES:** el viejo NUNCA ligó pago↔cargo, así que se insertan SIN
     `aplicaciones`, SIN el lock por maquilero y SIN recomputar `Orden.pagada` (el esquema permite el
     pago sin aplicaciones — F6-E4 lo dejó a propósito para este ETL).
  5. **Empresa** de los movimientos (que no cuelgan de una orden): la del cargo EsMa ya migrado
     (cargos primero), luego la favorita (FR Moda / Marilyn — misma empresa). El viejo llevaba UN solo
     estado de cuenta de maquila.
- **Nada se pierde en silencio (§7):** cabecera EsMa inexistente, maquilero sin mapeo en v2 (empresas
  viejas → pendiente F10), fecha vacía y `IdEsMa` sin cabecera se **OMITEN y se LISTAN** en el cuadre.
  El **cuadre F6** (`cuadre-f6.ts`) cuenta Calidad + EsMa (v1 CSV vs v2 Prisma), compara **saldos por
  maquilero** (v1 comparable — solo cargos validados de órdenes migradas — vs v2 `saldoDeMaquilero`,
  explicando la diferencia sistemática de cargos de órdenes no migradas, sin corregirla) y corre la
  **conciliación** recibido-vs-cargado del periodo histórico (criterio de salida). Es
  **reporte-vs-reporte** entre corridas, no contra cifras a mano.
- **Refinamiento F10 (documentado, no bloquea):** un maquilero con `Proceso=1` puede quedar en v2 solo
  con rol `maquila-costura` (sin `estampado`); no afecta la validez del cargo, solo los filtros de UI
  por tipo.

## Reglas que el módulo respeta

A1 (lógica en dominio) · A2 (cada alta/validación/pago en transacción) · A4 (permisos server-side,
deny-by-default) · A7 (Bitácora) · A9 (idEmpresa) · D3 (saldo y prendas-por-pagar = Σ movimientos,
nunca editable) · decisiones F6 (e) cargo de estampado a su precio · (f) `Orden.pagada` derivada + 2ª
sin costo · (g) pago ligado a cargos anti-doble-pago · (h) `conFactura`/modalidad y estado de cuenta
segmentado · R9 (impresos).
