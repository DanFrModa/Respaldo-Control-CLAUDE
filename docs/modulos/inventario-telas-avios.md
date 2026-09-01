# Módulo — Inventario de Telas y Avíos (F4 + A2)

> Cómo quedó construido el inventario de **telas (D5) y avíos (R4)** en CONTROL v2. No duplica el
> funcional (ADR-0002): para el QUÉ, ver `Documentacion_MJD/04-Inventarios.md` §B y
> `REQUISITOS-NUEVOS.md` §R4/R1, `DECISIONES.md` §D5/D3 y §Post-F9.9/.11 (reestructura de telas).
> Aquí va el CÓMO de v2.

Construido en F4 (E1 = motor + pantallas; E6 = ETL del histórico + cuadre). Es el cimiento sobre el
que escriben la recepción y las notas de [`compras-mrp.md`](compras-mrp.md).

> ⚠️ **Desde A2 (6-ago-2026) el inventario de TELAS opera por PARTIDAS y COLOR** (sección A2 abajo).
> El flujo por `Lote` de F4 quedó como **LEGADO en cuarentena**: sus pantallas siguen vivas
> retituladas "(legado)", sus vistas/kardex **excluyen** los movimientos nuevos, y ningún flujo nuevo
> escribe `Lote`. Los avíos NO cambian.

## A2 — Inventario de telas por PARTIDAS y COLOR (2026-08-06)

La unidad de inventario ya no es el `Lote` global sino el **color de la tela** (`TelaColor`, hijo del
catálogo A1), con el **complemento (cardigan) siempre junto al cuerpo** en el mismo renglón:

- **`PartidaTela`** = la unidad de ENTRADA (decisión B de Daniel): `folio` propio por secuencia
  atómica `partida-tela` por empresa (A3, `@@unique([idEmpresa, folio])`), `loteProveedor` (texto
  opcional buscable), `factura`, `fecha`, FK Restrict a `TelaColor`. **Una entrada crea UNA partida
  POR RENGLÓN** — una factura con dos lotes del mismo color se captura en un documento con dos
  renglones → dos partidas con folios consecutivos.
- **`MovimientoDetTela`** ganó 3 columnas nullable: `idTelaColor`, `idPartida` (solo entradas) y
  `cantidadComplemento` (NULL = la tela no lleva; con complemento se guarda 0 explícito; `cantidad` =
  cuerpo y admite 0 → compra de solo cardigan). Las filas del flujo Lote quedan con las 3 en NULL.
- **Las SALIDAS no escogen partida**: el consumo empareja por **TELA+COLOR** (decisión de Daniel);
  la pantalla de salida a orden avisa **"riesgo de tono" SIN bloquear** (§Post-F9.11 punto 2).
  `registrarSalidaTelaColorAOrden` es la vía nueva del consumo (traza `origenId=idOrden`); el
  contrato de salida/traspaso **no acepta** `loteProveedor` (solo la entrada lo lleva).
- **Vistas**: `existencia_tela_color` (Σ de AMBOS componentes con signo por tela×color×almacén,
  solo filas con `id_tela_color IS NOT NULL`); la vieja `existencia_tela` fue REEMPLAZADA con el
  filtro espejo `id_tela_color IS NULL` para que el flujo nuevo **no contamine** el legado (misma
  cuarentena en `kardexTela` y en la suma bajo lock `existenciaTelaBloqueada`). Vistas = solo
  consulta (D3): el no-negativo se valida por suma directa de ambos componentes bajo
  `pg_advisory_xact_lock` por color (`bloquearTelaColor`/`existenciaTelaColorBloqueada`).
- **Dominio** `backend/src/dominio/inventarios/partidas-telas.ts`: `ajustarInventarioTelaColor`
  (puerta del **arranque desde cero** — conteo físico; la entrada crea las partidas en la misma tx,
  folio de partida SIEMPRE antes del de movimiento), `registrarSalidaTelaColorAOrden`,
  `traspasarTelaColor`, `cancelarMovimientoTelaColor` (inverso auditado que copia las 3 dimensiones
  nuevas), `consultarExistenciasTelaColor` (agrupado TELA PADRE→colores→almacenes),
  `kardexTelaColor` (saldo corrido doble, filtro por partida), `listarPartidasTela`.
  Permisos REUSADOS `inventario-telas.ver/.mover` (cero seed).
- **Pantallas**: Existencias de telas (padre desplegable → colores con columnas cuerpo/complemento,
  pantone, unidad; **doble clic o botón** en el color → cajón con su kardex, cancelar-inverso y
  filtro por partida), Ajuste por color, Traspaso por color, **Salida a orden por color** (hereda el
  deep-link "Descargar tela" de producción). Las de lote viven como "(legado)":
  `/inventarios/telas/existencias-lote` y `/inventarios/telas/salida-orden-lote` (⌘K). El riel:
  `Telas` es ahora nodo PADRE con 4 hijos visibles (existencias, **catálogo**, salida a orden,
  ajuste).
- **El inventario arranca DESDE CERO** (conteo físico, decisión §Post-F9.11 punto 5): no se migran
  existencias del `Lote` legado ni del sistema viejo. Los consumos históricos 2025-2026 entrarán
  como datos de orden SIN tocar existencias (etapa posterior del track).
- **La entrada por factura LIGADA a su orden de compra (§Post-F9.14, 7-ago-2026; OBLIGATORIA desde
  §Post-F9.159(a), 30-ago-2026):** `EntradaTelaLinea.idOrdenCompraLinea` (**por renglón**: una
  factura puede surtir dos OCs en el mismo documento). Aquí decía *"y traer tela suelta"*: esa vía
  **se cerró** —Daniel: *«sin OC no podemos recibir tela»*— y el dominio la rechaza en su embudo
  (`exigirRenglonesConOrdenDeCompra`). La columna sigue `nullable` **sólo** por los documentos
  anteriores a la decisión, que se siguen leyendo (D3 + REGLA 0-B). Al CONFIRMAR, `confirmarEntradaTela` llama a
  `registrarRecepcionesDesdeEntradaTela` (`dominio/compras/recepciones.ts`) y escribe una
  `RecepcionCompra` por OC surtida —con `id_entrada_tela` como traza— reusando la partida y el
  movimiento ya creados: la tela entra UNA vez al kardex y suma UNA vez a lo recibido. La OC pasa
  sola a `recibida_parcial`/`recibida_total` (R7) y sale el evento `material-recibido` (RC). Al
  CANCELAR, esas recepciones se reversan (suave) y la OC vuelve a pendiente. **`recibirCompra` ya
  NO recibe tela** (ver [`compras-mrp.md`](compras-mrp.md)): una sola puerta.
- **Punto de partida: la ORDEN DE COMPRA (§Post-F9.15, replanteo del anterior):** botón "Dar entrada
  a la tela" en la OC → `state: { idOrdenCompra, idProveedor }` a la captura, que fija el proveedor
  (deshabilitado) y pinta el panel "Pendiente de la orden de compra" (`GET
  /api/compras/lineas-tela-pendientes?idProveedor&idOrdenCompra`); cada renglón precarga tela +
  pendiente + precio + la liga con un clic. **Se retiró** el selector "Renglón de OC". Y el buscador
  de telas se acota al **proveedor DUEÑO** (`listarTelas` gana el filtro `idProveedor`, ESTRICTO: las
  migradas sin dueño no aparecen). La contabilidad de §Post-F9.14 NO cambió: esto es el punto de
  entrada, no el mecanismo.
- **Almacén ligado a su CORTADOR (§Post-F9.13, 7-ago-2026):** `Almacen.idCortador` (nullable,
  **único**, FK Restrict a `Proveedor`) validado en `dominio/admin/almacenes.ts` — solo tipo TELA,
  proveedor activo con rol `corte`, y un cortador = un almacén (si no, "el almacén de este cortador"
  sería ambiguo). Lo consumen los deep-links del avance de producción: **"Descargar tela"** manda
  `state.idCortador` a la salida por color (que preselecciona SU almacén) y **"Mandar tela al
  cortador"** al traspaso (que preselecciona el DESTINO; el origen lo elige el usuario). La
  preselección ocurre **una sola vez y solo con el campo vacío** — nunca pisa lo que el usuario
  eligió. Salida y traspaso listan **solo almacenes `tipo: TELA`**.
- **Quién puede surtir tela: solo el rol `vende-telas`** (§Post-F9.12, 7-ago-2026). El selector de
  proveedor se acota **en servidor** (`GET /api/proveedores?rol=`) vía el hook compartido
  `useProveedoresPorRol` en: alta/edición de tela del catálogo (el proveedor DUEÑO de A1), entrada
  por factura/remisión (B1) y el ajuste del flujo legado por lote. Mismo criterio que Producción
  (Corte → `corte`). **El proveedor ya capturado se conserva** como opción aunque no traiga el rol
  (documentos viejos/migrados): el filtro es ayuda de captura, no candado retroactivo.

## Motor (D3 — existencia = suma de movimientos)

- `backend/src/comun/kardex.ts` — motor genérico (de F3-E1) extendido en F4-E1 a las dimensiones
  **Tela (tela×lote)** y **Avío**: registrar movimiento (encabezado `Movimiento` + detalle
  `MovimientoDetTela`/`MovimientoDetAvio`) en transacción (A2), folio atómico (A3), traspaso de 2
  patas en UNA tx, inverso auditado. El **no-negativo** se valida por **suma directa de los
  movimientos bajo `pg_advisory_xact_lock`, NUNCA la vista** (D3). Existe `existenciaAvioTotalEmpresa`
  (Σ pura de lectura, sin lock/guard) para la PLANEACIÓN del MRP — distinto de la existencia bajo
  lock que valida salidas.
- ⚰️ **`backend/src/comun/conversion.ts` YA NO EXISTE** (borrado en V1-E8a, §Post-F9.97). Era el motor
  presentación→unidad de consumo: cantidad ×factor, precio ÷factor. **La regla de hoy: todo va en
  unidad de CONSUMO —metro, pieza, kilo— de punta a punta**, así que no hay nada que convertir. La
  presentación (rollo, caja) es texto informativo, no una unidad del sistema. Las **telas se manejan
  1:1** (el
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
existencia de telas al go-live = 0** (F10): el inventario de telas se inicializa desde conteo/cero, no
hereda el stock viejo. Lo que se conserva es el **registro de consumos por orden**. Avíos: sin
histórico (R4 nuevo) → arrancan en cero; el conteo inicial entra como ajuste con la pantalla de E1.

## Reglas que el módulo respeta

A1 · A2 · A3 · A7 · A9 · D1 (costo en el movimiento) · D3 (existencia = Σ movimientos) · D5 (lote N
componentes) · R1 (factor) · R4 (avíos) · §7 (migración: idempotente, por lotes, diferencias listadas
no corregidas).
