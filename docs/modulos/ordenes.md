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
  modelo/cliente/empresa derivan del renglón→pedido. **ESTADO AUTOMÁTICO** (no editable): lo decide
  `requisitos-orden.ts` (ver abajo); `cancelada` por `cancelarOrden`. El **mapeo de las 34 columnas
  v1→v2** vive en el TSDoc de este archivo (contrato del ETL).
- `requisitos-orden.ts` (26-jul-2026; segundo requisito re-fundado en V1-E3d, §Post-F9.43) — **la
  regla del estado `completa`, ÚNICA fuente**. Función PURA
  `requisitosOrden({renglonesMatriz, recetaLiberada, artesOrden, llevaArte})` → `{tallas, receta,
  arte, completa, faltantes}` con la regla vigente: **tallas + receta liberada, y arte si aplica**
  (matriz con ≥1 renglón · **la receta congelada de ESA orden está liberada POR COMPLETO**
  —`Orden.recetaLiberadaEn`, derivado de "no queda ningún renglón vivo sin firmar"— · el arte según
  la bandera **`Modelo.llevaArte`**, default `true`, `DECISIONES.md §Post-F9.4`): `llevaArte=false` →
  `'no-aplica'`; `llevaArte=true` con arte **en la receta de la ORDEN** → `true`; `llevaArte=true`
  SIN arte → **`false` = falta** (la orden no se completa).
  ⚠️ El segundo requisito **ya NO mira el modelo**: era *"¿el MODELO tiene avíos `paraProduccion`?"*,
  que daba la misma respuesta para dos órdenes distintas del mismo modelo. Consecuencia buscada:
  **editar el BOM de un modelo ya no alcanza hacia atrás a sus órdenes**.
  ⚠️ Y **ninguna orden CAPTURADA A MANO nace `completa`**: `copiarRecetaDelModelo` no escribe
  `liberadoEn` (la deja en NULL), así que `Orden.recetaLiberadaEn` nunca se pone en el alta y el
  requisito `receta` sale siempre en falso. La **excepción es el ETL**: `crearOrdenMigrada` escribe
  el `estado` explícito de Access —que puede ser `completa`— y libera la receta migrada **sólo si la
  orden no está cancelada y su receta no quedó vacía**. Como **2 de cada 3 modelos del viejo no
  tienen BOM**, muchas órdenes históricas nacen `completa` **SIN cumplir la regla** — **por eso
  `realinear-estado-ordenes.ts` es paso obligatorio al cerrar la carga** (ver «Histórico»).
  `cambiosEstadoPorRequisitos` traduce la
  regla al par (`estado`, `fechaCompletada`): `fechaCompletada` **se sella una vez y nunca se borra**
  (paridad `Ordenes.FechaDet`, es un sello histórico del que el estado NO se deriva) y **`cancelada`
  siempre gana**. `recalcularEstadoOrden` / `recalcularEstadoOrdenesDeModelo` la aplican **dentro de
  la transacción del llamador** (A2).
  - **COMPLETAR** ocurre al guardar/copiar la **matriz de la orden**, al **liberar su receta**
    (`receta-orden.ts`) y al desmarcar **"lleva arte"** en el modelo. El **alta** (`crearOrden`)
    recalcula pero nunca puede completar (la receta recién copiada no está firmada), y los **cambios
    del BOM del modelo ya no disparan nada**.
  - **DES-COMPLETAR es la excepción** (acotado tras revisión, 26-jul-2026): solo al editar la
    **matriz de ESA orden** y solo si la orden **no tiene actividad de producción viva** (≥1
    `EtapaMovimiento` sin cancelar). Motivo: el estado no puede sacar de los tableros a una orden en
    curso ni degradar el histórico por una edición de catálogo.
  - **El ÚNICO cambio de catálogo que todavía toca órdenes es la casilla `llevaArte`**
    (`actualizarModelo` → `recalcularEstadoOrdenesDeModelo(..., 'lleva-arte')`, su único llamador
    real), y **SOLO COMPLETA**. Editar el BOM (`reemplazarAviosBom` / `reemplazarBordadosBom` /
    `copiarBom`) **ya no recalcula ninguna orden** desde V1-E3d. Si tras el cambio ni una orden con matriz podría completarse, sale sin tocar la
    base; si sí, actualiza **solo las `capturada` de ese modelo que ya tienen matriz**
    (`lineas: { some: {} }`, sin traer ids a memoria salvo para la bitácora), en **lotes de 500** y
    con **bitácora POR ORDEN** (A7, `registrarBitacoraLote`).
  - **Histórico:** el ETL carga `estado`/`fechaCompletada` explícitos y la regla solo entra cuando la
    orden se vuelve a tocar. La **puesta al día única** al estrenar la bandera del arte es la
    migración de DATOS `20260726130000_recalculo_estado_ordenes`: baja a `capturada` las `completa`
    que ya no cumplen, **saltándose las que tienen `EtapaMovimiento` viva** (mismo cinturón que el
    dominio) y **sin borrar `fechaCompletada`**, con bitácora por orden (`idUsuario` NULL = proceso
    de sistema). Sin ella el backlog del arte sería invisible en "Órdenes incompletas", que filtra
    por el estado GUARDADO. Esa migración corre **una sola vez** y **solo DEGRADA**; el script
    **re-ejecutable** `migracion/realinear-estado-ordenes.ts` aplica la MISMA regla en **las dos
    direcciones** (degrada las que dejaron de cumplir y **completa** las `capturada` que ya cumplían)
    delegando en `realinearEstadoOrdenes` (dominio: misma regla, mismos cinturones, por lotes,
    idempotente). Es **paso obligatorio al terminar cualquier carga/recarga de datos** (F10 o
    re-corrida de ETL), porque `crearOrdenMigrada` carga el estado explícito de Access sin
    recalcular — y tras un borrado+recarga es el **único** camino que corre (la migración ya no).
  - ⚠️ El estado es un **semáforo de captura, NO una llave para operar**: ninguna pantalla exige
    `completa` para cortar/enviar/recibir/entregar (el `SelectorOrden` del frontend filtra solo las
    canceladas). Lo único que el dominio rechaza es `cancelada`.
  La salida de la orden expone `requisitos` (y la fila del centro de comando, `faltantes`) para que
  la UI diga **"Falta: avíos"** / **"Falta: arte"** — transparencia pedida por Daniel.
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
