# Módulo — Compras / MRP (F4)

> Cómo quedó construido el módulo de **Compras y MRP** en CONTROL v2. No duplica el funcional
> (ADR-0002): para el QUÉ del negocio, ver `Documentacion_MJD/03-Produccion.md` §Órdenes de Compra,
> `REQUISITOS-NUEVOS.md` §R3/R7/R1 y `DECISIONES.md` §"Decisiones de diseño F4". Aquí va el CÓMO de v2.

Construido en F4 (etapas E2 → E6). El inventario de telas/avíos que lo sostiene está en
[`inventario-telas-avios.md`](inventario-telas-avios.md).

## Alcance

Órdenes de compra (OC) contra catálogo, recepción de material (R7) con entrada al kardex, explosión
MRP por orden (R3), tablero "qué tengo / qué falta" (R7) y notas de salida estructuradas (R4). Todo
**Make-to-Order**: se compra por orden de producción, no para stock (salvo el neteo de genéricos).

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/compras/`:
  - `ordenes-compra.ts` — `crearOC` / `actualizarOC` / `autorizarOC` / `cancelarOC` / `duplicarOC` /
    `obtenerOC` / `listarOC`. Folio `NumCompra` por **secuencia atómica por empresa** (A3, nunca
    `Max()+1`). Estatus como **enum** (`borrador` / `pendiente_autorizacion` / `autorizada` /
    `recibida_parcial` / `recibida_total` / `cancelada`). Autorización exige el permiso
    `compras.autorizar` (ex-acceso #8) y registra usuario+fecha en `Bitacora` (A7). OC autorizada
    **bloqueada** salvo admin (decisión **(a)**) + "Duplicar a nueva OC". El `Totales` viejo NO se
    almacena: es derivado de las líneas.
  - `recepciones.ts` — `recibirCompra` / `reversarRecepcion`. `recibirCompra` es **UNA transacción
    (A2)**: valida OC `autorizada`/`recibida_parcial` (decisión **(b)**, deny-by-default A4) y el
    almacén destino (`comun/almacenes.ts`), folio A3, crea `RecepcionCompra`/`Linea` + `Lote`+
    componentes (**D5**), registra la entrada al kardex (`entrada-recepcion`) **convirtiendo cantidad
    ×factor y costo ÷factor** (invariante de valuación `cantidad×costoUnit = cantidadOC×precioOC`,
    D1/D3), recalcula el estatus de la OC **bajo `pg_advisory_xact_lock` por OC** (namespace `bigint`
    `0x4f43`, anti-carrera R7) y **publica `material-recibido` vía OUTBOX transaccional** (el evento
    nunca se pierde; consumidor en F5). `reversarRecepcion` = movimiento(s) inverso(s) auditado(s)
    (D3) que destraba el candado de cancelación de OC. Contrato del evento + patrón outbox en
    **ADR-0011**.
  - `mrp.ts` — el **corazón MRP** (R3/R7):
    - `explosionarOrden` — requerido = `consumoPorPrenda` del BOM con bandera `paraProduccion` ×
      Σ piezas color×talla de la orden, para **telas Y avíos**; SIEMPRE por orden. Persiste el
      snapshot `RequerimientoOrden` (borra+reescribe en UNA tx → congela la explosión aunque el BOM
      cambie) y devuelve el **diff** vs el snapshot previo.
    - **Genéricos (decisión (d)):** un avío `esGenerico` se **netea contra existencia REAL** del
      kardex (`existenciaAvioTotalEmpresa` de `comun/kardex.ts`, Σ pura de lectura de PLANEACIÓN, sin
      lock ni guard); solo el faltante va a compra.
    - `generarOCDesdeExplosion` — agrupa el pendiente **por proveedor** → una OC por proveedor en un
      clic, **reusando `crearOC`** (A3/A7) y ligando **cada línea a su orden de producción** (R7 sin
      prorrateos); precio desde `AvioProveedor` (R1).
    - `estatusMaterialesOrden` — cruce **on-demand** Requerido(snapshot) vs En-OC vs Recibido →
      `pendiente`/`en-oc`/`recibido-parcial`/`completo`. Las líneas libres → `no-identificado` (no
      inflan); canceladas/reversadas no cuentan.
  - `migracion.ts` (F4-E6) — `crearOCMigrada`: modo migración (A1) con folio explícito `NumCompra`,
    estatus/autorización/cancelación legacy explícitos, líneas legacy SOLO texto libre, ligas N:N,
    **SIN kardex ni RecepcionCompra**.
- **Notas de salida** `backend/src/dominio/notas/notas-salida.ts` — `crearNotaSalida` /
  `actualizarNotaSalida` / `confirmarNotaSalida` / `cancelarNotaSalida` / `obtener` / `listar`.
  `confirmarNotaSalida` en UNA tx (A2) descuenta el kardex **solo de los AVÍOS** (`salida-por-nota`)
  bajo advisory lock por nota (`bigint` `0x4e53`). Los renglones de **TELA solo REFERENCIAN** una
  salida-a-orden ya registrada (`idMovimientoSalidaTela`) y **nunca generan segundo movimiento**
  (decisión **(e)**, anti-doble-descuento estructural + `validarRenglones`). Almacén origen en el
  **encabezado** (decisión **(g)**). Folio `NumNota` A3, soft-cancel, A7/A9.
  `notas/migracion.ts` (F4-E6) — `crearNotaMigrada`: folio explícito, estatus `confirmada` histórico
  **SIN descontar avíos ni tocar tela**, renglones SOLO `descripcionLegacy`.
- **API** `backend/src/api/compras/` y `.../notas-salida/` — rutas REST con permiso verificado
  server-side en cada una; OpenAPI regenerado + cliente del frontend sincronizado. Permisos:
  `compras.ver/.administrar/.cancelar/.autorizar/.recibir`, `notas.ver/.administrar/.cancelar`.
- **Frontend** `frontend/src/modulos/{compras,notas-salida}/` — listado/captura de OC, bandeja de
  autorización (móvil), compras por orden, recepción con lote multi-componente, explosión (con
  "Generar OC" en un clic), tablero "qué tengo / qué falta" (semáforo, móvil), captura/consulta de
  notas. Impresos PDF (R9): OC, recepción/estatus, explosión y nota de salida.

## Migración del histórico (F4-E6)

ETL idempotente, por lotes, CP850, vía dominio modo-migración (`backend/migracion/`):

- `loaders/ordenes-compra.ts` (`OrdCompra`+`OrdCompraDet`+`OrdCom-Ord` → `OrdenCompra`/`Linea`/N:N) y
  `loaders/notas-salida.ts` (`Notas`+`NotasDet` → `NotaSalida`/`Linea`). Orquestador
  `etl-compras-notas.ts` (imprime cuadre + escribe `reporte-etl-f4e6-compras-*.txt`).
- **Decisiones de migración** (registradas en `DECISIONES.md` §"ETL F4-E6"):
  1. Las **OC y notas legacy NO mueven kardex** ni crean `RecepcionCompra` (el viejo no liga
     entrada↔OC; las entradas de tela las migra el ETL de inventario, ver el otro doc). Las notas
     legacy son documento histórico `confirmada` sin descontar avíos (anti-doble-conteo).
  2. **Líneas legacy = texto libre** (`OrdCompraDet.Descripcion`→`descripcionLibre`,
     `NotasDet.Descripcion`→`descripcionLegacy`); NO se mapean a catálogo (R7 no cruza el histórico).
     `Totales` NO se migra (derivado).
  3. **Estatus OC derivado** del legacy (cancelada > autorizada > borrador); los `recibida_*` exigen
     recepciones que el histórico no crea.
  4. **Usuarios viejos** sin mapeo → `IdUsuAutorizado`/`IdUsuCancelado` preservados como texto
     `legacy:<id>` (columnas sin FK, ADR-0005). *(A ratificar: NULL vs `legacy:` — ver reporte.)*
  5. **Almacén sentinela** para notas (el viejo no tenía almacén origen y `idAlmacen` es NOT NULL):
     almacén `(histórico — sin almacén)` global + inactivo, creado por el propio ETL.
  6. **idEmpresa de la nota** derivado de la primera orden mapeable de sus renglones (folio por
     empresa, A9); sin orden mapeable → nota omitida + listada.
  7. **Ventana temporal CONFIGURABLE** (`ETL_VENTANA_ANIOS`, default **0 = sin recorte**; el recorte
     real lo hace el mapeo de empresas — solo migran las activas 7=Marilyn Fitness y 8=FR Moda; las 6
     empresas viejas inactivas se omiten y listan, consistente con la decisión de no migrar su
     historia). El reporte siempre imprime la config de ventana y lo excluido.
- **Nada se pierde en silencio (§7):** toda FK no resuelta, cantidad negativa saneada, registro fuera
  de ventana y colisión de unique se OMITE *y se LISTA* en el reporte de cuadre. El cuadre de Gabriel
  es **reporte-vs-reporte** entre corridas, no contra cifras a mano.

## Reglas que el módulo respeta

A1 (lógica en dominio) · A2 (recepción/confirmación/reverso en transacción) · A3 (folios por
secuencia) · A4 (permisos server-side, deny-by-default) · A7 (Bitácora) · A9 (idEmpresa) ·
D1 (costo en el movimiento) · D3 (existencia = Σ movimientos, nunca editable) · D5 (lote N
componentes) · R1 (proveedor/precio/factor) · R3 (explosión) · R7 (estatus por orden) · R9 (impresos).
