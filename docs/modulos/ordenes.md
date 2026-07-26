# Módulo Órdenes — Cómo quedó construido (F2-E2/E3/E4 + F2-E5)

> Referencia funcional: `Documentacion_MJD/03-Produccion.md` y `02-Pedidos.md` (no se duplica — ADR-0002).
> Construido en F2-E2 (modelo + dominio + API), F2-E3 (UI matriz), F2-E4 (consultas/tableros/impreso R9)
> y migrado en F2-E5 (datos reales).

La **orden de producción** es el documento con el que se manda a PRODUCIR un renglón de un pedido. Su
corazón es la **matriz color × talla** (renglones de color, cada uno con cantidades por talla).

## Entidades y tablas de BD

| Entidad v2 | Tablas v2 | Fuente (CSV viejo) |
|---|---|---|
| Orden | `ordenes` (+ enum `estado_orden`) | `Ordenes.csv` (5,451, 34 columnas) |
| OrdenLinea (color) | `orden_linea` | `OrdenesDet.csv` (9,511) — un renglón por color |
| OrdenLineaTalla | `orden_linea_talla` | despivote de `OrdenesDet.T1..T8` contra `Ordenes.Tallas` |
| OrdenReferencia (D7) | `orden_referencia` | `Ordenes.Monarch` (solo valores reales) |
| OrdenComentario | `orden_comentario` | `ComentaOrd.csv` (795) |

## Servicios de dominio (`backend/src/dominio/produccion/`)

- `ordenes.ts` — CRUD de la orden + matriz (sincronización diff-mínimo color×talla), copiar matriz de
  otra orden, cancelar (suave), referencias por cliente (D7) y comentarios inmutables. Folio por
  secuencia atómica `"orden"` POR EMPRESA. **AUTORRELLENO**: al crear desde un renglón de pedido,
  modelo/cliente/empresa derivan del renglón→pedido. **ESTADO DERIVADO** (no editable): `capturada`
  al abrir; `completa` al guardar la primera matriz con líneas (sella `fechaCompletada`, paridad con
  `Ordenes.FechaDet`); `cancelada` por `cancelarOrden`. El **mapeo de las 34 columnas v1→v2** vive en
  el TSDoc de este archivo (contrato del ETL).
- `migracion.ts` (F2-E5) — **modo migración** dedicado: `crearOrdenMigrada`,
  `agregarReferenciasOrdenMigrada`, `crearComentarioOrdenMigrado` (ver §Migración).

## Permisos (RBAC, A4)

- `ordenes.ver` — leer/consultar/buscar órdenes y tableros.
- `ordenes.administrar` — crear/editar orden + matriz + referencias + comentarios.
- `ordenes.cancelar` — cancelación suave (permiso propio).

## Pantallas (frontend)

Lista + detalle (teal): listado con **búsqueda combinada** (folio, código de modelo, nombre de
cliente o CUALQUIER valor de referencia D7) + filtros (modelo/cliente/año/estado). Detalle con el
**componente matriz color × talla** de captura. **Impreso PDF de la orden (R9)** y los
tableros/consultas de F2-E4.

## Decisiones de diseño

- **D4 tallas ilimitadas:** las columnas fijas `T1..T8` del viejo → `OrdenLineaTalla` (catálogo
  `Talla`). El total NUNCA se persiste: se deriva por suma (espíritu D3).
- **D7 referencias por cliente:** el `Monarch` del viejo se generaliza a `OrdenReferencia` (valor de
  un `ClienteCampo` del cliente de la orden). Índice dedicado sobre `valor` para la búsqueda global.
- **R9 impreso:** el impreso de la orden (PDF) se construyó en F2-E4. Cómo quedó por dentro (qué
  muestra, de dónde sale cada dato —incluida la regla de la TELA desde la OC—, el presupuesto de
  altura de la hoja y los seams de DI): **`docs/modulos/impreso-orden.md`**.
- **UPC en retiro (Gabriel, 16-jun-2026):** los códigos de barra de orden ya NO se usan. La columna
  `Orden.upc` queda en el schema pero **el ETL NO la migra** (no se conserva historial); su
  desmantelamiento completo (quitar columna, generador F1-E5, UI) es una tarea aparte.

## Cómo correr el ETL de F2 (pedidos + órdenes)

```bash
# Variables requeridas
export DATABASE_URL="postgresql://..."
export TABLAS_DIR="/ruta/a/Respaldo CLAUDE/TABLAS"   # opcional (default: Respaldo CLAUDE/TABLAS/)

# PRIMERO: deben haber corrido los ETL de F1 (dejan los mapeos que F2 consume).
#   npm run etl:catalogos   (clientes, empresas, colores, tallas, etiquetas, proveedores…)
#   npm run etl:modelos     (IdModelos → Modelo.id)

# Analizar el catálogo de cadenas Tallas (read-only; insumo de tests y revisión con Daniel)
npm run etl:analisis-tallas

# Migrar pedidos + órdenes (idempotente, re-ejecutable). Al final imprime el cuadre + incidencias.
npm run etl:pedidos-ordenes

# Solo el cuadre de F2 (no carga nada; dos niveles: filas/sumas + columnas)
npm run etl:cuadre-f2
```

## Migración de datos reales (F2-E5)

Se carga con el **MODO MIGRACIÓN** de la capa de dominio (`produccion/migracion.ts`, A1 — NO expuesto
en REST), porque el histórico debe PRESERVARSE: folio original, estado/fecha originales, snapshots sin
endpoint, y las ~26 órdenes sin pedido. El servicio normal exige un renglón de pedido válido, deriva
todo del pedido y sella la fecha con `now()` — incompatible con el histórico. El modo migración:

- **Folio EXPLÍCITO** = `Ordenes.Numero`.
- **`idPedidoLinea` NULL** cuando `IdPedidosDet ∈ {0, vacío}` (**26 órdenes huérfanas** del viejo;
  jamás se intenta una FK con 0). La captura nueva SÍ exige pedido.
- **Estado + `fechaCompletada` EXPLÍCITOS**: `FechaDet` → estado `completa` + esa fecha (NO re-sellada
  con now()); `OrdCancelada` → estado `cancelada` + `motivoCancelada` (si el viejo no trae motivo, se
  usa el texto "Cancelada en sistema anterior (sin motivo registrado)").
- **Despivote de la matriz** (`tallas-orden.ts`): cada `OrdenesDet.Tn` con cantidad >0 se alinea con
  la etiqueta de su **posición** en `Ordenes.Tallas` (ancho fijo de 2 chars). Maneja **doble curva**
  (separadores `-`/`--`/`- ` que NO son talla). Color texto-libre → `idColor` (mapeo F1 →
  normalizado → si no hay match, se **crea el color y se LISTA** al reporte). Token de talla sin match
  → se **crea la talla y se LISTA**. Nunca se pierde un renglón ni una cantidad en silencio (§7).
- **Monarch → `OrdenReferencia`** con el `ClienteCampo` "No. de pedido del cliente" (D7) del cliente
  de la orden, **solo valores reales**: si `Monarch == código del modelo` (default automático del
  viejo) NO se migra y se cuenta como descartado.
- Sigue siendo **transaccional (A2)** y **auditado (A7)**; los comentarios preservan autor y fecha
  ORIGINALES (`ComentaOrd.IdUsuarios`/`FechaComen`).

Loaders: `migracion/loaders/ordenes.ts` y `comentarios-orden.ts`. Mapeos: `Orden` (`IdOrdenes`→id),
`OrdenComentario` (`IdComentaOrd`→id). Tras migrar se **siembra la secuencia** `orden` por empresa al
máximo folio migrado.

### Snapshots V1 / datos sin motor (conservados de v1)

Columnas escalares **nullable sin FK ni motor** (su lógica llega en fases posteriores): RC/F5
(`idTipoArticuloRC`, `idRcAplicaciones`, `idRcTipoTelas`, `fechaInicioRC`, `fechaEntregaRC`,
`fechaProg`, `enRiesgo`, `siRC`, `rcViva`); F3/F6 (`maquilaOrd`, `aplicacionOrd`, `pagada`,
`noCostear`); `tallasV1` (cadena cruda de trazabilidad). El **UPC NO se migra** (códigos de barra en
retiro). Mismo espíritu que `idOrdCompraV1` de pedidos.

### Cuadre (dos niveles, esperado)

`npm run etl:cuadre-f2` produce DOS niveles (§7 — ninguna columna se tira en silencio):

1. **Filas y sumas:** conteos v1 vs v2 por tabla + la **suma de cantidades de la matriz** (Σ T1..T8
   de v1 vs Σ `OrdenLineaTalla.cantidad` de v2 — deben cuadrar para toda cantidad con etiqueta).
2. **Columnas:** checklist de cada columna v1 → destino v2 con conteo de no-vacíos. `Ordenes.UPC`
   aparece como **EXCLUIDA POR DECISIÓN** (códigos de barra en retiro), no como columna tirada.

**Hallazgos del histórico para Daniel** (se LISTAN en el reporte, no se autocorrigen):
- **26 órdenes sin pedido** (`IdPedidosDet` 0/vacío) → `idPedidoLinea` NULL.
- **~1,415 piezas** caen en columnas `Tn` con cantidad >0 pero SIN etiqueta de talla en `Ordenes.Tallas`
  (1,307 en 3 órdenes con `Tallas` vacía; 103 con una talla de más sobre `"CHM G EX"`; 5 sobre una
  curva de 7 tallas). Se reportan por orden/columna — Daniel decide la etiqueta correcta.
- **8 cadenas `Tallas` ambiguas** y **17 con doble curva** (de 183 distintas) — se despivotan por
  posición y se LISTAN para revisión de la etiqueta.
- Colores y tallas creados al vuelo (sin match en catálogo) — se LISTAN para revisión.
