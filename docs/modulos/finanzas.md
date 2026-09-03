# Módulo — Finanzas (CxC / CxP + CFDI) (F9)

> Cómo quedó construido el módulo de **Finanzas** (cuentas por cobrar/pagar + importación de CFDI) en
> CONTROL v2. No duplica el funcional (ADR-0002): para el QUÉ del negocio, ver
> `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`, `DECISIONES.md` §D12/D15 y
> `REQUISITOS-NUEVOS.md` §R10–R14. Aquí va el CÓMO de v2.

Construido en F9 (etapas E1 → E6). Generaliza el motor **EsMa** de F6
([`esma.md`](esma.md)) sin migrar sus datos (convivencia de lectura). El decisor técnico central es
**ADR-0017** (motor de terceros: referencias por tipo, no tabla polimórfica).

## Alcance

Un **único motor de cuenta corriente de terceros** del que cuelgan **CxP** (proveedores, formales e
informales), **CxC** (clientes) y —por convivencia— **EsMa** (maquileros). **Importación** de CFDI ya
timbrados en los dos sentidos (proveedores → CxP; ventas propias → CxC), conciliados con su operación
real y guardados en R2. **Reportes fiscales** para el contador (la vista fiscal del libro) con exports
Excel/PDF y aging configurable. **Meta:** apagar SINUBE por etapas — lo operativo primero, el timbrado
nativo vía PAC (R14) es posterior. **CONTROL no lleva contabilidad** (pólizas/DIOT/declaraciones): eso
sigue con el contador; CONTROL le entrega información fiscal limpia.

## Principio de oro (D3, A1)

`saldo(tercero) = Σ monto` — **nunca** una columna editable. Cada hecho (factura, pago, abono, nota de
crédito, apertura) es un **movimiento**; el saldo se deriva sumando. La cancelación es un **inverso
auditado** (patrón kardex), jamás una edición/borrado. Toda la lógica vive en `backend/src/dominio`.

## Un motor, dos ejes, dos vistas

- **Eje 1 — `origen`** (enum `OrigenMovimientoTercero`): fija la **dirección contable** vía
  `signoDeOrigen` (`src/dominio/terceros/origen-tercero.ts`, el ÚNICO lugar de verdad del signo).
  - **CARGO (+)**: `recibo_maquila`, `factura_proveedor`, `entrada_sin_factura`, `factura_cliente`.
  - **ABONO (−)**: `nota_credito`, `pago`, `abono`, `descuento`.
  - El API recibe `importe` **positivo**; el servidor le pone el signo por el origen.
- **Eje 2 — `esFiscal`** (+ `uuidCfdi` / `rfcTercero` / `idArchivoCfdi`): naturaleza fiscal del
  movimiento (con CFDI o no).
- **Dos vistas = dos filtros del MISMO libro** (no dos libros): **operativa** (todo) y **fiscal**
  (`esFiscal = true`, exige `terceros.fiscal`).

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/terceros/`:
  - `origen-tercero.ts` — clasificación de orígenes y `signoDeOrigen` (fuente única del signo).
  - `terceros.ts` — resuelve el tercero por **tipo + id** (D15a: dos FKs reales nullable con CHECK de
    exclusividad, **sin** tabla `Tercero` polimórfica — ADR-0017); nombre + días de crédito (aging).
  - `cuenta-terceros.ts` — el **MOTOR** (`registrarMovimientoTercero` / `cancelarMovimientoTercero` /
    `calcularSaldoTercero` / `estadoDeCuentaTercero`): folio por **secuencia atómica por empresa**
    (A3, clave `movimiento-tercero`), signo por origen, **vencimiento derivado** del aging
    (`calcularVencimiento` = fecha + días de crédito, solo los cargos vencen), transacción + bitácora
    (A2/A7), cancelación = inverso auditado con **advisory lock + unique parcial** de
    `idMovimientoInverso` (anti write-skew de doble cancelación).
  - `convivencia-esma.ts` — para un PROVEEDOR, el saldo/estado de cuenta **INCLUYEN** los movimientos
    EsMa (F6) **reusando la fórmula `calcularSaldoMaquilero`** → no-regresión garantizada por
    reutilización; NO se migró ni un dato EsMa (opción **(b)**, compatibilidad de lectura).
  - `cxp/` y `cxc/` — usos de negocio del motor por **composición** (cero duplicación): registrar
    pagos/abonos/descuentos/NC, estado de cuenta operativo/fiscal, **aging server-side**
    (`aging-comun.ts`: cubetas + neteo FIFO). La bandeja "por pagar" **foldea** el saldo EsMa (misma
    cuenta del maquilero, en cubeta "Maquila sin antigüedad"); el `%` al corriente es honesto (`null`
    si no hay cartera clasificable). El fold trae DOS cosas por maquilero (`aportesEsMaSaldoLote`, un
    solo agregado, nunca N+1): el **saldo** —al que sólo entra lo REVISADO en los cuatro conceptos,
    V1 fila 0.115— y `maquilaPorRevisar`, lo capturado que aún espera revisión.
    - ⭐ **El corte de la bandeja es `saldo ≠ 0` **o** algo por revisar** (§Post-F9.188a, Daniel): un
      maquilero con TODO sin revisar tiene saldo 0 y, con el corte anterior, DESAPARECÍA justo cuando
      alguien tiene que decidir sobre ese dinero. Es el mismo corte del tablero de EsMa, con las
      mismas funciones (`tieneSaldo` / `hayPendiente` de `esma/formula-saldo.ts`), y se mide por el
      CONTEO de partidas, no por el neto (dos partidas pueden netear cero).
    - Lo por revisar **no es deuda todavía**: no suma a `carteraTotal`, a `maquilaTotal` ni a
      `proveedoresConSaldo` (los KPIs siguen contando sólo saldo ≠ 0), pero se declara aparte en el
      resumen y en la columna «Por revisar» de la tabla, con su importe y su conteo. Los importes se
      ocultan sin `consultas.ver-importes`; el conteo nunca.
  - `cfdi/` — `parser-cfdi.ts` (CFDI **4.0** puro, endurecido contra XML no confiable: sin DTD, sin
    expansión de entidades, tope 2 MB), `cfdi-proveedor.ts` (I → `factura_proveedor` +, E →
    `nota_credito` −) y `cfdi-ventas.ts` (reusa el parser con roles invertidos: emisor = empresa,
    receptor = cliente). El XML se sube **server-side** a R2 (orden seguro **R2 primero → tx
    después**: un cargo fiscal sin su XML sería irrecuperable por la unique del UUID). Anti-duplicado
    por **UUID único global** (pre-check + backstop P2002). `cfdi-comun.ts` comparte el RFC de la
    empresa activa (`Empresa.rfc`) y el chequeo de UUID.
  - `reportes/` — `ServicioReportesFiscales`: la vista `esFiscal=true` del libro (CxP+CxC) por
    periodo/empresa, con conciliación (con/sin CFDI, con/sin XML), tablero de salud fiscal y totales
    del periodo completo. Exports **Excel** (exceljs) y **PDF** (@react-pdf, con leyenda de truncado).
  - `config-aging.ts` — límites del aging **configurables por empresa**
    (`ConfiguracionEmpresa.agingLimite1/2`, default 30/60 — cierra D15d).
  - `migracion.ts` — **modo migración** (F9-E6): `insertarAperturasMigradas` inserta los saldos
    iniciales por **LOTES** (ver §ETL abajo).
- **Rutas** `backend/src/api/terceros/` — delegan al dominio; RBAC deny-by-default.
- **Frontend** — pantallas del riel FINANZAS: `/cxp`, `/cxc` (bandejas + estado de cuenta
  operativa/fiscal + captura + impreso PDF), `/cxp/importar-cfdi`, `/cxc/importar-cfdi`,
  `/reportes-fiscales`.

## RBAC (A4)

`terceros.ver` / `.administrar` / `.fiscal` (motor); `cxp.ver` / `.administrar` y `cxc.ver` /
`.administrar` (usos). Reparto conservador: administrar/fiscal solo Administrador/AdministraciónDirección;
`ver` baja hasta Gerencial (se corta en Ventas). Cada etapa que agrega permisos requiere
`SEED_ON_START=true` en el deploy a `prueba`.

## ETL de cierre (F9-E6) — arranque de SINUBE

A diferencia del resto de fases, **estos datos NO viven en Access**: viven en SINUBE / CFDI. Por eso el
ETL es de **saldos iniciales** + **importación masiva de CFDI**, no del `.mdb` viejo.

- **`migracion/etl-terceros-saldos.ts`** — carga el **punto de partida** de CxC/CxP como movimientos de
  **APERTURA** (D3: jamás un saldo editable). Fuente: un CSV de **formato flexible** (corte de SINUBE /
  export del contador). Daniel pidió el **detalle** de las facturas pendientes (cada una con su fecha →
  el aging cuenta desde el día 1); también acepta un **saldo neto** por tercero. Mecánica:
  - **Modo migración por LOTES** (`src/dominio/terceros/migracion.ts::insertarAperturasMigradas`,
    regla dura de Gabriel — nunca 1×1): por bloque de un tercero se **reserva un bloque de folios en
    una sentencia atómica** (`reservarBloqueFolios`, A3) y se insertan los movimientos con
    `createManyAndReturn` (un solo INSERT). El **signo** (`signoDeOrigen`) y el **vencimiento**
    (`calcularVencimiento`) se **reusan del motor** (A1: un solo lugar de verdad — el ETL no los
    recalcula).
  - **Idempotencia atómica**: cada movimiento + su renglón de `MapeoMigracion` (`AperturaTercero`,
    clave natural = folio de origen · UUID · `neto:<tipo>:<id>`) se crean en la MISMA transacción; una
    re-corrida NO duplica (el loader filtra por `MapeoMigracion` y por la unique global del `uuidCfdi`
    antes de insertar). Demostrado por test (2ª corrida = 0 nuevos).
  - Con `uuid` → cargo **fiscal** (`factura_proveedor`/`factura_cliente`); sin `uuid` → cargo **no
    fiscal** (`entrada_sin_factura`, requiere folio); saldo neto ± → `entrada_sin_factura`/`abono`.
- **`migracion/etl-cfdi-masivo.ts`** — recorre una **carpeta de XML**, decide **compra/venta** por el
  RFC de la empresa (`decidirDireccionCfdi`) y resuelve el tercero por RFC, luego **REUSA** los
  importadores interactivos de E3/E4 (`importarCfdi` / `importarCfdiVenta`) tal cual — la única lógica
  nueva es decidir la dirección y auto-resolver el tercero (en la UI lo elige un humano). **Idempotente
  por UUID** (el comprobante repetido cuenta como "duplicado", no error). Respeta `R2_SUBIDA_LOCAL`.
- **`migracion/cuadre-f9.ts`** — compara, por tercero, el **saldo esperado del corte** (columna
  `saldoEsperado`, o Σ de las aperturas del CSV con su signo) contra el **Σ monto de las aperturas
  cargadas** (los movimientos en `MapeoMigracion.AperturaTercero`). Los descuadres se **LISTAN**, nunca
  se fuerzan (§7).

Formato de entrada, ejemplos y cómo correr: `backend/migracion/README.md` (sección F9). **Se corre con
`npx tsx --env-file=.env migracion/etl-terceros-saldos.ts -- --archivo=...`** (NUNCA `npm run`).

## Decisiones (DECISIONES.md §D15)

- **D15a** — el movimiento referencia al tercero por **tipo + id** (dos FKs nullable + CHECK de
  exclusividad), sin tabla `Tercero` polimórfica (ADR-0017).
- **D15b** — EsMa se re-expresa por **convivencia de lectura**, NO por migración de datos.
- **D15c** — el ETL de saldos/CFDI **se construye y prueba pero NO se corre** hasta que Daniel entregue
  el corte de SINUBE; el corte trae el **desglose** de las facturas pendientes (fecha + folio/UUID +
  monto) para que el aging funcione desde el día 1.
- **D15d** — aging **configurable por empresa** (`agingLimite1/2`, default 30/60).

## Pendientes honestos

- **Correr el ETL** (`etl-terceros-saldos` + `etl-cfdi-masivo`) cuando Daniel entregue el corte de
  SINUBE / la carpeta de XML (D15c). Hoy solo están construidos y probados con fixtures.
- **Timbrado nativo vía PAC (R14)** — posterior; hoy es **importación**, no emisión. La estructura ya
  queda lista para que el salto sea chico.
- **Desglose base/IVA/retenciones** — el movimiento persiste el **TOTAL** del CFDI (la verdad fiscal);
  el desglose vive en el XML guardado en R2. Leerlo del XML para el reporte del contador es iteración
  posterior (documentado en el TSDoc de `reportes/`).
- **UsuarioRol / usuarios reales** — dependen de F10 (go-live); no afectan el motor.
