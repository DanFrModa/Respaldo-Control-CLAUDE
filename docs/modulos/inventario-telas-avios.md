# Módulo — Inventario de Telas y Avíos (F4)

> Cómo quedó construido el inventario de **telas (D5) y avíos (R4)** en CONTROL v2. No duplica el
> funcional (ADR-0002): para el QUÉ, ver `Documentacion_MJD/04-Inventarios.md` §B y
> `REQUISITOS-NUEVOS.md` §R4/R1, `DECISIONES.md` §D5/D3. Aquí va el CÓMO de v2.

Construido en F4 (E1 = motor + pantallas; E6 = ETL del histórico + cuadre). Es el cimiento sobre el
que escriben la recepción y las notas de [`compras-mrp.md`](compras-mrp.md).

## Motor (D3 — existencia = suma de movimientos)

- `backend/src/comun/kardex.ts` — motor genérico (de F3-E1) extendido en F4-E1 a las dimensiones
  **Tela (tela×lote)** y **Avío**: registrar movimiento (encabezado `Movimiento` + detalle
  `MovimientoDetTela`/`MovimientoDetAvio`) en transacción (A2), folio atómico (A3), traspaso de 2
  patas en UNA tx, inverso auditado. El **no-negativo** se valida por **suma directa de los
  movimientos bajo `pg_advisory_xact_lock`, NUNCA la vista** (D3). Existe `existenciaAvioTotalEmpresa`
  (Σ pura de lectura, sin lock/guard) para la PLANEACIÓN del MRP — distinto de la existencia bajo
  lock que valida salidas.
- `backend/src/comun/conversion.ts` — motor presentación→unidad de consumo (R1): cantidad ×factor,
  precio ÷factor, con invariante de valuación. Factor en
  `AvioProveedor.factorConversion`→`Avio.factorConversion`→1:1. Las **telas se manejan 1:1** (el
  factor vive en avíos).
- **Vistas** `existencia_tela` / `existencia_avio` (Σ por tela×lote×almacén / avío×almacén) — solo
  para CONSULTA; nunca tablas editables.

## Dominio (A1)

`backend/src/dominio/inventarios/`:
- `telas.ts` / `avios.ts` — `ajustarInventario` (crea `Lote`+componentes D5 en UNA tx, motivo
  obligatorio — base del conteo físico y de los ajustes del ETL), `registrarSalidaTelaAOrden` (la
  **ÚNICA** vía que descuenta tela hacia una orden, traza `origenId=idOrden` → base del
  anti-doble-descuento de la nota de salida, decisión (e)), `traspasar` (atómico; no se cancela una
  sola pata, se revierte con traspaso inverso), `cancelar` (= movimiento INVERSO auditado, NUNCA
  edita/borra), `consultarExistencias` / `kardex`.
- `migracion.ts` (F4-E6) — helpers modo migración: `crearMovimientoTelaMigrado`,
  `crearTraspasoTelaMigrado`, `asegurarLoteLegacyTela` (vía el motor de kardex; A1/A2/A3/A7).

## Lotes (D5)

`Lote` (proveedor, factura, fecha, idColor — el lote define el teñido) + `LoteComponente` (idTela,
cantidad, peso) — elimina el límite `ExTela1/ExTela2` del viejo. Un lote puede traer N telas
acompañantes del mismo color en una sola captura.

## API y Frontend

- 6 endpoints RBAC `inventario-{telas,avios}.{ver,mover}`; los **importes se ocultan server-side** a
  quien no tenga el ex-acceso #7 `telas.ver-totales` (A4), y la UI los oculta.
- 6 pantallas teal: Existencias de telas (componentes del lote expandibles), Kardex de materiales,
  Existencias de avíos (distingue `esGenerico`), Salida de tela a orden, Traspaso, Ajuste/inventario
  físico. Las **3 consultas** funcionan en móvil (regla 10). Impreso PDF de inventario de telas (R9).

## Migración del histórico (F4-E6)

ETL idempotente, por lotes, CP850, vía dominio modo-migración:

- `loaders/entradas-salidas-telas.ts` — clasifica `Entradas`/`Salidas` y carga; orquestador
  `etl-telas.ts` (escribe `reporte-etl-f4e6-telas-*.txt`).
- `comun/pares-traspaso-tela.ts` — detector PURO determinista de **pares de traspaso** legacy.
- `cuadre-f4.ts` — cuadre `TelasColAlm` v1 vs Σ movimientos v2.

**Clasificación** (verificada contra el VBA `ITelas_TransferAlmSub.txt`):
- **(a) Pares de traspaso:** Entrada `Factura='Transferencia'` ↔ Salida gemela sin `IdOrdenes` (con
  `Referencia` de almacén) → movimientos **`traspaso`** pareados (2 patas, atómicas). Emparejado
  determinista por **firma de detalle** (fecha + idTela + renglones color/cantidad ordenados,
  ignorando almacén) + orden. En los datos reales **359/368** entradas 'Transferencia' parean limpio;
  las **9** de cardinalidad desigual se **reportan**, no se fuerzan. Ninguna `RecepcionCompra` falsa.
- **(b) Entradas de compra:** → entrada DIRECTA al kardex (`entrada-recepcion`), `costoUnit =
  TelasColores.Precio` (D1), **SIN crear `RecepcionCompra`** (el viejo no liga entrada↔OC;
  `RecepcionCompra` queda solo para operaciones v2). El cuadre verifica 0 telas con origen
  `recepcion-compra`.
- **(c) Salidas con `IdOrdenes`:** → `salida-a-orden` (`origenTipo=salida-tela-orden`,
  `origenId=idOrden`, empresa de la orden) — preserva la trazabilidad del consumo por orden.
- **(d) Salidas restantes** sin clasificar → `ajuste-salida` (preserva la existencia, D3) **y
  LISTADAS**; no se inventa liga.

**Lotes legacy (refinamiento de la decisión (f)):** la decisión (f) dijo "por entrada/factura", pero
v2 unificó `Telas`+`TelasDis` en UNA sola `Tela` con `tipoComponente` (ADR-0009) — no hay 2 telas por
renglón. Como las salidas legacy **no referencian lote**, sintetizar por entrada/factura dejaría las
salidas sin lote del cual descontar. Por eso el ETL sintetiza **un lote legacy POR COLOR**
(`IdTelasColores`, clave `LEGACY-TELA-<id>`), reusado por las entradas y salidas de ese color → la
existencia v2 cuadra **1:1 con `TelasColAlm`** (que es por tela×color×almacén). `TelaEnt1+TelaEnt2` se
suman como cantidad de la tela parent (desglose en observaciones). **Refinamiento técnico de (f) a
ratificar con Daniel** (registrado en `DECISIONES.md` §"ETL F4-E6").

**Cuadre (D3, §7):** `cuadre-f4.ts` suma `MovimientoDetTela` por SQL directo, compara vs
`TelasColAlm.ExTela1+ExTela2` y **LISTA los descuadres sin corregirlos** (los descuadres son
esperables: el viejo mantenía saldos a mano con GotFocus/LostFocus, 04-Inventarios Obs.1). Cualquier
ajuste va como **movimiento documentado**, jamás un parche silencioso.

**Relación con el go-live (decisión (c) de Daniel, 21-jun):** el ETL de F4-E6 reconstruye el
histórico de movimientos/consumos por orden para el **cuadre** y la trazabilidad. El **saldo de
existencia de telas al go-live = 0** (F9): el inventario de telas se inicializa desde conteo/cero, no
hereda el stock viejo. Lo que se conserva es el **registro de consumos por orden**. Avíos: sin
histórico (R4 nuevo) → arrancan en cero; el conteo inicial entra como ajuste con la pantalla de E1.

## Reglas que el módulo respeta

A1 · A2 · A3 · A7 · A9 · D1 (costo en el movimiento) · D3 (existencia = Σ movimientos) · D5 (lote N
componentes) · R1 (factor) · R4 (avíos) · §7 (migración: idempotente, por lotes, diferencias listadas
no corregidas).
