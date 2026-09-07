# Módulo Pedidos — Cómo quedó construido (F2-E1 + F2-E5)

> Referencia funcional: `Documentacion_MJD/02-Pedidos.md` (no se duplica aquí — ADR-0002).
> Construido en F2-E1 (modelo + dominio + API + UI) y migrado en F2-E5 (datos reales).

El módulo PEDIDOS modela el **compromiso con el cliente** del que salen las órdenes de producción.
Dos niveles: el **pedido interno** (lo que se va a producir, con su precio pactado) y los **pedidos
reales** (cada liberación real del cliente contra ese pedido, con sus cantidades enviadas/entregadas).

## Entidades y tablas de BD

| Entidad v2 | Tablas v2 | Fuente (CSV viejo) |
|---|---|---|
| Pedido | `pedidos` | `Pedidos.csv` (1,529) |
| PedidoLinea | `pedido_linea` | `PedidosDet.csv` (5,636) |
| PedidoReal | `pedido_real` | `PedidosReales.csv` (161) |
| PedidoRealLinea | `pedido_real_linea` | `PedidosRealesDet.csv` (644) |

## Servicios de dominio (`backend/src/dominio/pedidos/`)

- `pedidos.ts` — CRUD del pedido + sus renglones (sincronización diff-mínimo del set), copiar y
  cancelar (suave). Folio por secuencia atómica `"pedido"` POR EMPRESA (A3, nunca `Max()+1`).
- `pedidos-reales.ts` — alta de pedido real (replica un renglón por cada `PedidoLinea` del pedido
  interno), edición del encabezado y captura del seguimiento por renglón. Sin folio propio (se
  identifica por `numPedReal`). **NOTA:** la cancelación del pedido real quedó DIFERIDA (pendiente
  de decisión de Daniel — sin campo `cancelado`, sin servicio).
- `migracion.ts` (F2-E5) — **modo migración** dedicado: `crearPedidoMigrado` y
  `crearPedidoRealMigrado` (ver §Migración).

## Permisos (RBAC, A4)

- `pedidos.ver` — leer pedidos y pedidos reales.
- `pedidos.administrar` — crear/editar/copiar/cancelar pedidos.
- `pedidos-reales.administrar` — crear/editar/seguimiento de pedidos reales.
- `pedidos.importes` — ver/capturar `precio`/`importe` (ocultamiento **server-side**: si la sesión
  no tiene el permiso, el JSON NO trae los importes — doc 02 §3, decidido en el backend, no con CSS).

## Pantallas (frontend)

Lista + detalle (estándar visual teal): listado de pedidos con búsqueda (folio o cliente), filtro
por cliente y orden; detalle con encabezado + renglones (matriz modelo/cantidad/precio) y la pestaña
de pedidos reales con su seguimiento. Los importes se ocultan según permiso.

## Decisiones de diseño

- **A2 transacción:** encabezado + renglones (y la réplica del detalle del pedido real) en UNA
  transacción. Corrige el viejo, que insertaba encabezado y detalle por separado.
- **A3 folio por secuencia:** `"pedido"` por empresa; sustituye `AumentarNumPed` (Max()+1).
- **A7 auditoría:** `creadoPorId`/`modificadoPorId` + `Bitacora` en la misma tx.
- **Cancelación suave:** `pedCancelado` — el pedido nunca se borra, sigue consultable.
- **⭐⭐ Cancelar el pedido NO se lleva las OP que ya tienen vida (0.150).** DANIEL: *«¿Qué pasa si me
  cancelan un pedido, pero la OC ya está producida? **No quiero que se borren las OP en ese caso.**
  Pero si no hay nada comprado ni producido y borra el pedido está bien cancelar en cascada.»* La
  casilla *«cancelar también sus órdenes»* cancela **sólo las OP sin movimientos**; las demás se
  **conservan y se nombran** (la respuesta trae `ordenesConservadas` + un `aviso` ya redactado, y la
  bitácora del pedido guarda el par simétrico `ordenesCanceladas` / `ordenesConservadas`). El pedido
  se cancela igual: **nunca queda atrapado** —que era el callejón de la orden CERRADA, cuyo mensaje
  llegó a ofrecer una salida que no existía en el código—.
  - El criterio de *«esta orden tiene vida»* es **único** y vive en
    `backend/src/dominio/produccion/actividad-orden.ts` (`senalesDeActividadOrden`): cierre, receta
    liberada/reabierta, etapas vivas, cierres de maquila, cargos EsMa, notas de salida, compras
    **comprometidas** (⭐ el BORRADOR de OC **no** cuenta — Daniel: *«no cuenta como comprado»*),
    kardex de PT / TELA / AVÍOS, ruta crítica capturada, hitos, auditorías, costo y EDR. **No**
    cuentan los derivados regenerables (snapshot del MRP, ruta sólo generada, receta congelada) ni
    nada cancelado/deshecho/anulado.
  - **Cancelar UNA orden a mano (`ordenes.cancelar`) sigue sin esa guarda**, a propósito: es un acto
    consciente con motivo obligatorio, y es la salida que el propio aviso ofrece.

## Migración de datos reales (F2-E5)

El histórico se carga con el **MODO MIGRACIÓN** de la capa de dominio (`pedidos/migracion.ts`), NO con
los servicios normales de captura. Razón: los servicios normales generan folio nuevo, exigen
cliente/modelo ACTIVOS y replican el detalle en 0 — correcto para el día a día, pero el histórico debe
PRESERVARSE tal cual. El modo migración (A1 — vive en `dominio`, NO se expone en ninguna ruta REST):

- **Folio EXPLÍCITO** = `NumeroPed`/`IdPedidosReales` del viejo (no de la secuencia).
- **NO valida** cliente/modelo activos (el histórico referencia catálogos hoy desactivados).
- Preserva **fechas, banderas** (`pedCancelado`/`noProducir`/`entregadoTienda`) y la **auditoría
  original** del viejo donde el CSV la trae (`PedidosReales.IdUsuarios` → `creadoPorId`).
- Sigue siendo **transaccional (A2)** y **auditado (A7)**.

Loaders: `migracion/loaders/pedidos.ts` y `pedidos-reales.ts`. Mapeos producidos (`MapeoMigracion`):
`Pedido` (`IdPedidos`→id), `PedidoLinea` (`IdPedidosDet`→id, **crítico**: lo usan las órdenes y los
reales), `PedidoReal`, `PedidoRealLinea`. Tras migrar, se **siembran las secuencias** `pedido` por
empresa al máximo folio migrado (la primera captura nueva sale con folio > histórico, sin colisión).

### Snapshots V1 (datos migrados que F3/F4 reemplazan)

Estos campos son **fotos del viejo, de SOLO LECTURA**, sin endpoint de escritura en F2. Su saldo vivo
real lo derivarán fases posteriores; aquí solo se conserva el dato histórico:

- `PedidoLinea.entregadoParcialV1` (viejo `EntregadoParcial`) y `PedidoLinea.cantFaltanteV1` (viejo
  `CantFalt`): cantidades ya entregada/faltante del viejo. **NO es saldo vivo** (espíritu D3); F3
  (EntregasCliente) lo reemplaza/deriva.
- `Pedido.idOrdCompraV1` (viejo `IdOrdCompra`, 233 de 1,529 pedidos): orden de compra ligada, **SIN
  FK** hasta que `OrdCompra` exista en F4 (entonces se promueve a relación real).

### Cuadre (esperado)

`npm run etl:cuadre-f2`. Conteos v1 (CSV) vs v2 (Postgres): Pedidos ≈ 1,529; PedidoLinea ≤ 5,636 (los
renglones con modelo sin mapeo se LISTAN al reporte y no entran); PedidosReales ≈ 161;
PedidoRealLinea ≤ 644 (los que ligan a un `IdPedidosDet` sin mapeo se LISTAN). Nada se descarta en
silencio (§7).
