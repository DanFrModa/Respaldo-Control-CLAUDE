# Módulo Inventario PT (Producto Terminado) — Cómo quedó construido (F3-E3 + F3-E6)

> Referencia funcional: `Documentacion_MJD/04-Inventarios.md` (IPT) — no se duplica (ADR-0002).
> Motor y reglas del kardex: `docs/arquitectura/ADR-0010-motor-kardex-produccion.md`.
> Construido en F3-E1 (motor + modelo de datos), F3-E3 (operable: movimientos/traspasos/existencias/kardex)
> y migrado en F3-E6 (histórico real de IPT_Movs).

El inventario de **producto terminado** en v2 es un **kardex puro** (D3): la existencia NUNCA es una
columna editable, es **la SUMA de los movimientos**. Esto erradica el problema del sistema viejo, donde
`IPT_Mod_Alm.Existencia` se podía editar a mano y descuadraba contra los movimientos (doc 04 — Observación 1).

## Entidades y tablas de BD

| Entidad v2 | Tablas v2 | Fuente (CSV viejo) |
|---|---|---|
| Movimiento (encabezado de kardex) | `movimientos` | `IPT_Movs.csv` (~5,072) |
| MovimientoDetPt (renglón modelo×color×talla) | `movimiento_det_pt` | `IPT_MovsDet.csv` (~6,886) |
| TipoMovimientoInventario | `tipos_movimiento_inventario` | `IPT_TiposMov.csv` (19) + 2 patas de traspaso v2 |
| Almacen (PT) | `almacenes` (tipo `PT`) | `IPT_Almacenes.csv` (3: Primeras/Segundas/Tránsito) |
| existencia_pt (VISTA, solo consulta) | `existencia_pt` (CREATE VIEW) | — (derivada, D3) |

El **encabezado `Movimiento` es genérico** (PT/tela/avío — ADR-0010 §2); en F3 solo se ejercita el
detalle PT (`MovimientoDetPt`, dimensión modelo×color×talla — D4). El **origen** del movimiento es una
referencia polimórfica (`origenTipo` + `origenId`, ADR-0010 §1; valores en `comun/origenes.ts`).

## Motor de kardex (`backend/src/comun/kardex.ts`)

El ÚNICO lugar que escribe `Movimiento`/`MovimientoDetPt`. Genérico, sin lógica de negocio:
`registrarMovimientoPt` (encabezado+detalle+bitácora en una tx, folio atómico A3), `registrarTraspasoPt`
(dos patas salida+entrada en la MISMA tx), `cancelarMovimientoPt` (inverso auditado — D3/A7, JAMÁS borra),
`bloquearArticuloPt` + `existenciaPtBloqueada` (validación de no-negativo bajo advisory lock, suma DIRECTA
del detalle, NUNCA la vista — ADR-0010 §3). `costoUnit` queda NULL en toda F3 (D1/D2).

## Servicios de dominio (`backend/src/dominio/inventarios/`)

- `movimientos-pt.ts` (F3-E3) — orquesta el motor con las VALIDACIONES de negocio: movimiento manual
  (entrada/salida/ajuste; salidas validan no-negativo bajo lock), traspaso entre almacenes (valida el
  origen), cancelación (elige el tipo inverso `error-entrada`/`error-salida`), consulta de **existencias**
  (lee la vista `existencia_pt` — aquí SÍ, es consulta), **kardex por modelo** (saldo corrido en memoria)
  y por folio. Permisos `inventario-pt.ver` / `inventario-pt.mover` (A4).
- `tipos-movimiento.ts` — catálogo de tipos de movimiento.
- `migracion.ts` (F3-E6) — **modo migración** dedicado: `crearMovimientoIptMigrado` (ver §Migración).

> **`IPT_Revision` (recuadre del viejo) NO se construye.** Con kardex puro no hay saldo materializado que
> "recuadrar"; cualquier ajuste es un movimiento de ajuste o un inverso auditado.

## Permisos (RBAC, A4)

- `inventario-pt.ver` — leer existencias / kardex / movimientos.
- `inventario-pt.mover` — registrar movimientos, traspasos, cancelaciones.

## Pantallas (frontend)

Lista + detalle (teal): existencias (responsive PC+móvil), kardex por modelo, captura de movimiento manual
y de traspaso, detalle de un movimiento por folio.

## Decisiones de diseño

- **D3 existencia = Σ movimientos:** sin columna/tabla de saldo editable. Las validaciones transaccionales
  suman `MovimientoDetPt` DIRECTO bajo lock; la vista `existencia_pt` es **solo** para consulta/tableros.
- **D4 tallas/colores ilimitados:** el detalle del kardex es modelo×color×talla (catálogos `Color`/`Talla`).
- **Cancelación = inverso auditado (D3/A7):** nunca se edita ni borra un movimiento.

## Migración del histórico de IPT (F3-E6, Pieza B)

Se carga con el **MODO MIGRACIÓN** del dominio (`inventarios/migracion.ts` → `crearMovimientoIptMigrado`,
A1 — NO expuesto en REST), que llama al motor de kardex con `origenTipo = ORIGEN.migracion`. Reglas:

- **Decisión (c) — SENTINELA (DECISIONES.md F3-E6):** el viejo NO tenía color/talla en IPT. Cada
  movimiento histórico entra con un **Color y una Talla `(sin especificar)`** del catálogo, marcados
  **inactivos** (no aparecen en los selectores de captura nueva). Se upsertan una sola vez y se reúsan.
  Lo que el viejo sí sabía (modelo×almacén×cantidad) se preserva exacto; lo que nunca tuvo se marca como tal.
- **Un `Movimiento` por `IPT_MovsDet`** (no por `IPT_Movs`): cada renglón es su propio movimiento.
- **Empresa = la del MODELO viejo** (`IPT_Modelos.IdEmpresas` → mapeo `Empresa`): `IPT_Movs` no trae
  empresa. Modelo de empresa sin mapeo (inactivas / 0) → movimiento OMITIDO + reportado.
- **Tipo de movimiento:** `IPT_Movs.IdIPT_TipoMov` (1..19) → código del seed por POSICIÓN. Tipo `0/vacío`
  (464 filas del viejo) → "Otras Entradas/Salidas" según `EnSa`. Dirección que NO casa con `EnSa` (p. ej.
  el tipo 9 'traspaso', dir 3 — el histórico NO trae la contraparte de un traspaso v2) → se carga por
  `EnSa` como entrada/salida simple y se LISTA.
- **Almacén:** `IPT_Movs.IdIPT_Almacenes` → mapeo `Almacen:IPT`. Modelo: `IdIPT_Mod_Alm` →
  `IPT_Mod_Alm.IdIPT_Modelos` → `IPT_Modelos.NumMod` (= **código** de v2) → modelo.
- **`IPT_Movs.IdRecibos`** (2,353 filas): se conserva como **referencia informativa** en `observaciones`
  (`[v1 IdRecibos=…]`), **NUNCA** como FK ni efecto.
- **`EntregasCliente.csv` tiene 0 filas:** la entrega real vieja vive en `IPT_Movs` tipo 5 + PedidosReales
  (se documenta en el cuadre).
- **Idempotencia:** por `Movimiento.origenId` = `IdIPT_MovsDet` (origen `migracion`); 2ª corrida no duplica.
- **NO valida no-negativo:** el histórico se carga tal cual; un saldo inicial negativo o un descuadre del
  viejo se PRESERVA y se LISTA en el cuadre (no se corrige en silencio, §7).

### Excepción del ETL — por qué NO hay doble conteo

El kardex de v2 (entrada/salida real de existencia) en F3 proviene de **un único origen**: la migración de
`IPT_Movs`. La Pieza A (corte/envío/recibo/EsMa) carga sus etapas **SIN** generar kardex:

- Los **recibos de costura** del histórico se cargan como `EtapaMovimiento` tipo `recibo_maquila` **sin** la
  entrada a PT derivada (`generaEntradaPt`) que el flujo NUEVO (F3-E4) sí produce — porque esa entrada YA
  está en `IPT_Movs` (el viejo la registró como movimiento de inventario). Generarla otra vez duplicaría.
- Los **cargos EsMa** se cargan solo de `EsMa_Recibos` (cuenta de maquileros), NUNCA del kardex.

El **cuadre F3** lo verifica explícitamente (bloque 3): todo `Movimiento` de kardex tiene
`origenTipo = 'migracion'`; CERO provienen de `recibo-maquila` o de un cargo.

## Cómo correr el ETL de IPT y su cuadre

Ver `backend/migracion/README.md`. Desde `backend/`, SIEMPRE con `--env-file=.env` (NUNCA `npm run`):

```bash
# Prerequisitos: etl-catalogos (Empresa, Almacen:IPT) + etl-modelos (modelos por código) ya corridos,
# y el SEED del catálogo de tipos de movimiento + almacenes (SEED_ON_START=true en prueba).
npx tsx --env-file=.env migracion/etl-produccion.ts   # Pieza A (corte/envío/recibo/EsMa — sin kardex)
npx tsx --env-file=.env migracion/etl-ipt.ts          # Pieza B: kardex histórico de IPT (este módulo)
npx tsx --env-file=.env migracion/cuadre-f3.ts         # cuadre de TODA la fase (3 bloques)
```

`etl-ipt.ts` imprime el cuadre F3 al final y escribe `reporte-etl-f3-<timestamp>.txt` (gitignored).

### Cuadre F3 (tres bloques, §7)

1. **Conteos** v1 (CSV) vs v2 (BD) por entidad (cortes, envíos, recibos, cargos, movimientos IPT/dets).
2. **Existencias:** Σ kardex v2 por **modelo×almacén** (ignorando el sentinela) vs `IPT_Mod_Alm.Existencia`.
   Donde NO cuadra (saldo editado a mano en el viejo — D3 lo erradica) se **LISTA el descuadre con su
   causa**, jamás se corrige.
3. **No doble conteo:** todo el kardex es origen `migracion`; 0 de recibo/cargo.

## Decisión de rendimiento (vista normal vs materializada)

`existencia_pt` se deja como **VISTA normal** (no materializada) por ahora. Razones:

- Las validaciones transaccionales (no-negativo en salidas/traspasos/entregas) NUNCA usan la vista: suman
  `MovimientoDetPt` DIRECTO bajo advisory lock (ADR-0010 §3). La vista es solo para CONSULTA/tableros, donde
  una latencia mayor es tolerable.
- Hay índices de apoyo en `movimiento_det_pt` (`@@index([idModelo, idColor, idTalla])`, `@@index([idMovimiento])`)
  y en `movimientos` (empresa/almacén) que sostienen el `GROUP BY` de la vista para el volumen de `prueba`.
- **Recomendación:** medir en `prueba` con los 10 años de historia ya cargados ANTES de materializar. Si la
  consulta de existencias se vuelve lenta con el volumen real, materializar exige un **mini-ADR** y respeta
  ADR-0010: la materializada sería SOLO para consulta; las validaciones transaccionales seguirían sumando
  el detalle directo (la materializada nunca decide un no-negativo).
