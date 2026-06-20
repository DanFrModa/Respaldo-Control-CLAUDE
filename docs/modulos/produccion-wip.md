# Módulo Producción / WIP — Cómo quedó construido (F3)

> Referencia funcional: `Documentacion_MJD/03-Produccion.md` (corte→maquila→recibo→entrega, WIP, form
> `Proceso`) y `07-EsMa-…` (cuenta de maquileros) — no se duplica (ADR-0002).
> Motor y reglas del kardex: `docs/arquitectura/ADR-0010-motor-kardex-produccion.md`.
> El inventario PT (kardex) tiene su propia ficha: `docs/modulos/inventario-pt.md`.

La **producción** es el ciclo de vida de una orden: **corte → envío a maquila → recibo de maquila →
entrega a cliente**, con el **WIP** (work-in-progress) DERIVADO por suma de las etapas (D3/D4, sin
acumuladores). El **estampado/bordado/lavado** NO es un flujo aparte: es el mismo modelo de etapa
parametrizado por `TipoProceso` (D8 — unifica costura `Entregas`/`Recibos` y estampado
`EntregasEst`/`RecibosEst` del viejo).

## Entidades y tablas de BD

| Entidad v2 | Tablas v2 | Fuente (CSV viejo) |
|---|---|---|
| TipoProceso (costura/estampado/bordado/lavado) | `tipos_proceso` (+ `generaEntradaPt`) | catálogo (F3-E1) |
| EtapaMovimiento (encabezado WIP) | `etapa_movimiento` (enum `tipo_etapa_movimiento`) | `Corte`, `Entregas`, `EntregasEst`, `Recibos`, `RecibosEst` |
| EtapaMovimientoDet (color×talla, D4) | `etapa_movimiento_det` | `OrdenesDetCorte.TC1..TC8` (corte) |
| EsMaCargo (cargo a maquilero) | `esma_cargo` (enum `estado_cargo_esma`) | `EsMa_Recibos` |
| Movimiento / MovimientoDetPt (kardex PT) | `movimientos` / `movimiento_det_pt` | derivado (recibo costura + entrega) |

`EtapaMovimiento` es el encabezado de cada captura (corte/envío/recibo/entrega); su detalle color×talla
cuelga en `EtapaMovimientoDet`. **NO es el kardex:** el kardex PT (entrada/salida real de existencia) lo
generan SOLO el **recibo de costura** (`TipoProceso.generaEntradaPt`) y la **entrega**, vía un `Movimiento`
aparte. Folio por secuencia atómica `"etapa-mov"` POR EMPRESA (A3).

## Servicios de dominio

- `produccion/tipos-proceso.ts` (F3-E1) — CRUD del catálogo de tipos de proceso (admin-only;
  `generaEntradaPt` marca los que meten a PT — solo costura).
- `produccion/etapas.ts` (F3-E2) — **corte** + **envío a maquila** unificado (M+A por `TipoProceso`).
  Decisiones (DECISIONES.md): **(f) sobre-corte LIBRE** (`registrarCorte` no topa por pedido; tolerancia
  configurable), **(g) sobre-envío ESTRICTO** (`registrarEnvioMaquila` bloquea si `enviado > cortado`
  disponible para ese proceso, suma directa bajo lock). Cancelación SUAVE + motivo + bitácora.
- `produccion/recibos.ts` (F3-E4) ⭐ — **recibo de maquila**, la etapa CENTRAL: de UNA captura, en UNA
  transacción, deriva: la etapa `recibo_maquila` + detalle con CALIDAD (primeras/segundas), la validación
  `recibido ≤ enviado` (estricto, g), **la ENTRADA al kardex PT SOLO si `generaEntradaPt`** (primeras→
  almacén primeras, segundas→segundas), y un **`EsMaCargo(propuesto)` para TODO proceso** (cantidad
  recibida × precio del envío). Emite evento `recibo-registrado` post-commit (gancho RC F5).
- `produccion/entregas-cliente.ts` (F3-E5) — **entrega a cliente** (cierre del ciclo): el "gemelo de
  salida" del recibo de costura. Deriva la etapa `entrega_cliente`, la validación **no-negativo estricta**
  (no entregar lo que no existe, suma directa bajo lock), y la **SALIDA del kardex PT**. El seguimiento
  del pedido (entregado/faltante) es DERIVADO de las entregas vivas (D3). Evento `entrega-registrado`.
- `produccion/wip.ts` (F3-E5) — **tablero WIP** + existencias en poder del maquilero (`MaqExis`): CONSULTAS
  de solo lectura, todo derivado por suma de `EtapaMovimientoDet` (excluyendo canceladas).
- `esma/cargos.ts` (F3-E4) — **cola de validación EsMa**: el cargo nace `propuesto` del recibo; el admin
  lo `validado` fijando cantidad/precio reales (punto de control humano de v1). El estado de cuenta
  completo (abonos/saldos) es F6.
- `produccion/migracion.ts` y `esma/migracion.ts` (F3-E6, **Pieza A**) — modo migración del histórico de
  corte/envío/recibo/EsMa (NO lo cubre esta ficha de cierre de Pieza B; ver su loader).

### Fórmulas del WIP (form `Proceso` del viejo, derivadas por suma)

- Por cortar = pedido(orden) − cortado
- Cortado por enviar = cortado − enviado (por `TipoProceso`)
- Por recibir = enviado − recibido (por `TipoProceso`)
- Entregado a cliente = Σ entregas (etapa `entrega_cliente`)
- Por entregar = recibido(procesos `generaEntradaPt`) − entregado a cliente

## Permisos (RBAC, A4)

`produccion.corte` · `produccion.envio` · `produccion.recibo` · `produccion.entrega` ·
`produccion.cancelar` · `produccion.wip-ver` · `esma.cargo-validar`.

## El `generaEntradaPt` — la bisagra del kardex

`TipoProceso.generaEntradaPt` es la bandera que decide si un recibo METE prenda al inventario de PT. Solo
**costura** la tiene: el recibo de costura es lo que convierte WIP en producto terminado (entra a PT). El
estampado/bordado/lavado son pasos intermedios sobre la MISMA pieza — su recibo sube el WIP "recibido"
(para el cuadre del envío) pero **NO** toca el kardex. Esto reemplaza el `MeterInventario` / bandera
`Inventariado` del viejo: recibir costura = ya queda en inventario en la misma transacción (mejora A1/D3).

## Eventos que entrega a F5 (Ruta Crítica)

El recibo y la entrega emiten eventos de dominio post-commit (`recibo-registrado`, `entrega-registrado`)
como **gancho** para el motor de Ruta Crítica de F5 (D10/D11). Hoy NO tienen consumidores; fijan el
contrato del evento para que F5 enganche el avance del WIP al CPM sin tocar estos servicios.

## Qué entrega a otras fases

- **F4 (Compras/órdenes de compra):** la producción consume materiales; las OC se ligan a la orden.
- **F6 (Costos/EDR):** los `EsMaCargo` validados son la base de la CxP de maquila; `costoUnit` (hoy NULL,
  D1/D2) se llenará en F7.
- **F7 (Valuación):** la valuación del kardex (`costoUnit`) llega aquí; el motor ya tiene el campo nullable.

## Migración del histórico de producción (F3-E6)

> **Esta ficha cierra la Pieza B (kardex IPT, ver `inventario-pt.md`).** La Pieza A migra
> corte/envío/recibo/EsMa con su propio modo migración (`produccion/migracion.ts`, `esma/migracion.ts`).
> La regla de CONTRATO entre piezas (para que NO haya doble conteo del inventario):

- Los **recibos de costura** del histórico se cargan **SIN** la entrada a PT derivada (`generaEntradaPt`):
  esa entrada YA está en `IPT_Movs` (el viejo la registró como movimiento de inventario), así que el
  kardex de v2 viene **solo** de la migración de IPT (Pieza B), nunca de un recibo. Re-generarla duplicaría.
- Los **cargos EsMa** se migran solo de `EsMa_Recibos`, NUNCA del kardex.
- El **cuadre F3** (`migracion/cuadre-f3.ts`) verifica esto explícitamente: todo `Movimiento` de kardex
  tiene `origenTipo = 'migracion'`; CERO de `recibo-maquila` o de un cargo.

Orden de corrida (ver `backend/migracion/README.md`): `etl-produccion` → `etl-ipt` → `cuadre-f3`.

## Decisiones de diseño

- **D8 maquila unificada:** un solo modelo de etapa para costura y estampado/bordado/lavado, por `TipoProceso`.
- **D3/D4 WIP derivado:** todo el avance es suma directa de `EtapaMovimientoDet` por color×talla; sin
  columnas/acumuladores. Las cancelaciones son suaves (se excluyen de la suma, no se borran).
- **(f) sobre-corte libre / (g) sobre-envío y sobre-recibo estrictos** (DECISIONES.md F3-E2/E4).
