# Módulo — Inventario de Telas y Avíos (F4 + A2)

> Cómo quedó construido el inventario de **telas (D5) y avíos (R4)** en CONTROL v2. No duplica el
> funcional (ADR-0002): para el QUÉ, ver `Documentacion_MJD/04-Inventarios.md` §B y
> `REQUISITOS-NUEVOS.md` §R4/R1, `DECISIONES.md` §D5/D3 y §Post-F9.9/.11 (reestructura de telas).
> Aquí va el CÓMO de v2.

Construido en F4 (E1 = motor + pantallas; E6 = ETL del histórico + cuadre). Es el cimiento sobre el
que escriben la recepción y las notas de [`compras-mrp.md`](compras-mrp.md).

> ⚠️ **Desde A2 (6-ago-2026) el inventario de TELAS opera por PARTIDAS y COLOR** (sección A2 abajo).
> El flujo por `Lote` de F4 quedó como **LEGADO en cuarentena**: sus vistas/kardex **excluyen** los
> movimientos nuevos, y ningún flujo nuevo escribe `Lote`. Los avíos NO cambian.
>
> 🔒 **Y desde la fila 0.170 (9-sep-2026) el flujo por lote YA NO ESCRIBE, por ninguna puerta.** Sus
> tres capturas se fueron retirando —el ajuste el 13-ago-2026, el traspaso en la 0.098— pero **sus
> endpoints seguían vivos**, y la tercera, «Salida a orden por lote (legado)», seguía capturando
> desde ⌘K con el `inventario-telas.mover` que tienen seis perfiles. Escribían renglones **sin
> color**, y la pantalla de existencias que se mira hoy (`existencia_tela_color`) los excluye: sacar
> tela por ahí **descontaba existencia que nadie veía moverse**. Se retiraron la entrada de ⌘K, la
> pantalla y los tres endpoints (`POST /inventarios/telas/ajustes`, `.../salidas-orden` y
> `.../traspasos`); la ruta de la pantalla quedó como **redirección** a la salida por color.
> **Lo que sobrevive del lote es SÓLO LECTURA + corrección:** las dos consultas
> (`GET /inventarios/telas/existencias` y `.../kardex`) y
> `POST /inventarios/telas/movimientos/:id/cancelar` —que además **no es sólo del legado**: es el
> botón «cancelar» del kardex y acepta cualquier movimiento con renglones de tela, los del flujo por
> color incluidos (por eso conserva las guardas de la 0.099/0.104)—. Las tres funciones de escritura
> **siguen en el dominio, sin ruta**: son el andamio con el que las pruebas fabrican movimientos con
> la forma legada para comprobar que el flujo por color los tolera.

## A2 — Inventario de telas por PARTIDAS y COLOR (2026-08-06)

La unidad de inventario ya no es el `Lote` global sino el **color de la tela** (`TelaColor`, hijo del
catálogo A1), con el **complemento (cardigan) siempre junto al cuerpo** en el mismo renglón:

- **`PartidaTela`** = la unidad de ENTRADA (decisión B de Daniel): `folio` propio por secuencia
  atómica `partida-tela` por empresa (A3, `@@unique([idEmpresa, folio])`), `loteProveedor` (texto
  opcional buscable), `factura`, `fecha`, FK Restrict a `TelaColor`. **Una entrada crea UNA partida
  POR RENGLÓN** — una factura con dos lotes del mismo color se captura en un documento con dos
  renglones → dos partidas con folios consecutivos.
- **`MovimientoDetTela`** ganó 3 columnas nullable: `idTelaColor`, `idPartida` (entradas y, desde la
  fila 0.142, las dos patas del traspaso) y
  `cantidadComplemento` (NULL = la tela no lleva; con complemento se guarda 0 explícito; `cantidad` =
  cuerpo y admite 0 → compra de solo cardigan). Las filas del flujo Lote quedan con las 3 en NULL.
- **Las SALIDAS A ORDEN no escogen partida**: el consumo empareja por **TELA+COLOR** (decisión de
  Daniel); la pantalla de salida a orden avisa **"riesgo de tono" SIN bloquear** (§Post-F9.11 punto
  2). `registrarSalidaTelaColorAOrden` es la vía nueva del consumo (traza `origenId=idOrden`); el
  contrato de salida/traspaso **no acepta** `loteProveedor` (solo la entrada lo lleva).
- ⭐⭐ **PERO EL TRASPASO SÍ CONSERVA EL LOTE (fila 0.142 — Daniel §Post-F9.201 punto 1).** Hasta la
  0.141 las dos patas del traspaso se escribían con `idPartida = NULL` («no son entradas de
  compra»), y eso dejaba al **almacén del cortador** —alimentado casi sólo por traspasos, y donde
  arranca la pantalla de salida de tela— **sin saber nunca de qué lotes era su tela**: el aviso de
  riesgo de tono no podía entregar ninguna de las dos mitades que Daniel pidió (*«sólo cuando hay
  más de una partida»* y *«con la lista a la vista»*). Ahora:
  - **Se captura igual** (color + cantidad, sin pantalla nueva): el dominio reparte **FIFO por folio
    de partida** contra el **saldo por lote del origen** (`repartirPorPartidaFifo`, función pura) y
    expande la captura a **un renglón de kardex por lote**. El motor pasa el MISMO arreglo a las dos
    patas ⇒ la salida descuenta del lote en el origen y la entrada lo nombra en el destino. **No se
    tocó `comun/kardex.ts`**: el motor ya escribía `idPartida` y ya compartía las líneas.
  - **Cuerpo y complemento se reparten POR SEPARADO** (son dos existencias independientes, y hay
    partidas de sólo cardigan) y se juntan **por partida** en el renglón.
  - **El reparto se calcula DENTRO de la transacción y DESPUÉS del lock** de no-negativo
    (`pg_advisory_xact_lock` por empresa+almacén+color). Fuera del lock, dos traspasos simultáneos
    repartirían el mismo lote dos veces en silencio.
  - **Lo que ningún lote explica viaja SIN lote (`NULL`), sin error**: la tela traspasada ANTES de
    esta fila se queda sin nombre y **no se repara** (REGLA 0-B: aditivo, sin backfill, sin
    migración). ⭐ **Las otras TRES puertas que meten tela sin lote, medidas una por una:** el
    **ajuste de ENTRADA del conteo cíclico** (`indicadores/ciclico/tela.ts` — no crea partida a
    propósito: una hoja de conteo no tiene factura ni lote del proveedor), la **cancelación de una
    salida que tampoco llevaba lote**, cuyo inverso copia el `idPartida` NULL del original, y **un
    traspaso de HOY cuyo origen tampoco pueda nombrarla** —incluido el remanente que deja el tope
    del reparto—, porque la tela sin nombre **se propaga** de almacén en almacén: el traspaso no
    inventa lotes. *(Esta cuarta faltaba cuando el mapa se declaraba «completo»; la cazó el reviewer
    en la 3ª vuelta.)* 📌 **«Medidas» quiere decir que cada una tiene su prueba de integración,
    y dos de ellas se escribieron en la 4ª vuelta justo porque la palabra estaba de más**: el ajuste
    del cíclico en `indicadores/inventario-ciclico.int.test.ts` (*«el ajuste de ENTRADA de TELA no
    crea partida»*) y la **cancelación de una salida sin lote** en
    `inventarios/partidas-telas.int.test.ts` (hasta entonces era un corolario razonado del caso que
    sí estaba medido: cancelar una ENTRADA, que sí lleva partida); la **propagación** ya estaba en ese mismo
    archivo (*«la tela que ningún lote explica viaja SIN lote»*), y **la tela vieja** en
    `inventarios/previa-salida-tela-orden.int.test.ts` (*«la tela vieja, traspasada ANTES de la 0.142»*). 🔴 **NO es una puerta el «sobrante» de un conteo por color**, aunque esta doc
    lo dijo: sobrante = *contado < sistema* = **salida**, y una salida baja la existencia; el
    faltante, que sí es entrada, **crea partida**.
  - **La hoja del traspaso sale desglosada por lote** (número del proveedor + folio de partida; «—»
    cuando no hay).
- 🔻 **CONSECUENCIA QUE HAY QUE SABER: el saldo por lote NUNCA cuadra del todo en un almacén que
  consume.** **Ninguna salida nombra lote salvo la pata del traspaso** — ni la salida a orden, ni la
  salida sin orden, ni la pata de sobrante del conteo, ni el ajuste de salida, ni el del cíclico —,
  así que ninguna se lo descuenta: el saldo de un lote se queda **por encima** de lo que de verdad
  hay. En la práctica, el aviso de tono puede **listar un lote que la producción ya se llevó** y su
  `sinNombrar` puede quedarse corto. Es el precio explícito de que el consumo empareje por color, y
  está medido en la integración.
- 🔴🔴 **Y ese saldo inflado tuvo un efecto GRAVE en el traspaso, cazado en la ronda de corrección:
  podía escribir el LOTE EQUIVOCADO.** Medido: entran 500 de `L-VIEJO` → se surten 500 a una orden
  (no nombra lote, así que su saldo sigue diciendo 500) → entran 300 de `L-NUEVO`, que es lo único
  que hay → se traspasan al cortador. El FIFO se llevaba **`L-VIEJO`**, el destino quedaba en
  `sin-riesgo` y **la hoja impresa salía con un lote que no era**. Eso es *peor* que el estado previo
  a la fila: cambia un «no sé» honesto por una afirmación falsa dicha con confianza.
  - **Mitigación construida** (`repartirPorPartidaFifo`): antes de repartir se le quita a los lotes
    el déficit `Σ saldos − existencia real`, **del folio más viejo al más nuevo** (misma hipótesis
    FIFO del reparto) y **por componente**. La existencia sale de la lectura **bajo lock** que hace
    `validarNoNegativoTelaColor`, que por eso ahora la devuelve en vez de tirarla.
  - **Lo que aporta, medido — y es sobre QUÉ lote, no sobre cuánta tela:** que el lote escogido sea
    **uno que la existencia pueda respaldar**, cuando el desajuste viene sólo de consumo no apuntado
    (el caso normal de la bodega). Lo que no alcance viaja **sin lote**.
    ⚠️ **Lo que NO aporta, aunque una versión anterior de esta doc lo presumía «medido»:** que *«no se
    nombre más tela de la que hay»*. Eso **ya lo daba la validación de no-negativo** (rechaza la
    captura si pasa de la existencia) ⇒ era cierto con tope y sin él, y su prueba pasaba con el tope
    borrado. **En una línea: el tope no cambia CUÁNTA tela se nombra, cambia CUÁL lote.**
  - 🔻🔻 **Lo que NO garantiza — y la primera versión de esta doc lo prometía de más, hasta que una
    prueba lo desmintió:** *«nunca nombra un lote que ya no tiene nada»* **es FALSO cuando además ha
    entrado tela SIN lote.** El desajuste `Σ saldos − existencia` mezcla **dos causas de signo
    contrario que la Σ no puede separar**: el consumo no nombrado (el lote reclama de MÁS) y la
    entrada sin lote (reclama de MENOS). Se cancelan entre sí. Medido: 500 de `L-FANTASMA`
    consumidos por una salida a orden + 200 entrados sin lote ⇒ el tope sólo ve 300 de desajuste y
    le deja al fantasma 200 kg que no son suyos. **El caso del reviewer sí queda curado** (ahí no hay
    tela sin lote y el déficit coincide exactamente con lo del fantasma).
  - 🔻 **Y tampoco cura la raíz:** con varios lotes vivos y consumo parcial, el nombre puede ser el
    del lote de al lado. Todo esto es P3, y está pendiente de que **Daniel lo vea** antes de
    ratificar P2/P3 (`DECISIONES.md §Post-F9.206`, recuadro final).
  - ⚠️ **El mismo tope NO se aplica al aviso de tono**, a propósito: ahí sobrar-listar es inofensivo
    (alguien mira el anaquel de más) y esconder sería callar un aviso real. En el papel del traspaso
    es al revés: sobre-nombrar **es** la mentira. Misma cifra, dos usos, dos criterios.
- **Vistas**: `existencia_tela_color` (Σ de AMBOS componentes con signo por tela×color×almacén,
  solo filas con `id_tela_color IS NOT NULL`); la vieja `existencia_tela` fue REEMPLAZADA con el
  filtro espejo `id_tela_color IS NULL` para que el flujo nuevo **no contamine** el legado (misma
  cuarentena en `kardexTela` y en la suma bajo lock `existenciaTelaBloqueada`). Vistas = solo
  consulta (D3): el no-negativo se valida por suma directa de ambos componentes bajo
  `pg_advisory_xact_lock` por color (`bloquearTelaColor`/`existenciaTelaColorBloqueada`).
- **Dominio** `backend/src/dominio/inventarios/partidas-telas.ts`: `ajustarInventarioTelaColor`
  (puerta del **arranque desde cero** — conteo físico; la entrada crea las partidas en la misma tx,
  folio de partida SIEMPRE antes del de movimiento), `registrarSalidaTelaColorAOrden`,
  `traspasarTelaColor` (⭐ reparte el lote FIFO, fila 0.142), `cancelarMovimientoTelaColor` (inverso
  auditado que copia las 3 dimensiones nuevas), `consultarExistenciasTelaColor` (agrupado TELA
  PADRE→colores→almacenes), `kardexTelaColor` (saldo corrido doble, filtro por partida),
  `listarPartidasTela`, y **`saldosPorPartidaTela`** — la Σ neta por lote en un almacén (entradas −
  salidas que lo nombran), **un solo sitio** para los dos consumidores que la necesitan: el reparto
  del traspaso y el aviso de riesgo de tono. **No filtra las canceladas a propósito**: el inverso
  copia `idPartida`, así que el par se neutraliza solo; filtrarlas restaría dos veces.
  ⚠️ **Cancelar UNA sola pata del traspaso está prohibido** por el motor: la marcha atrás es un
  **traspaso inverso**, que vuelve a repartir FIFO contra el saldo del que ahora es el origen.
  Permisos REUSADOS `inventario-telas.ver/.mover` (cero seed).
- **Pantallas**: Existencias de telas (padre desplegable → colores con columnas cuerpo/complemento,
  pantone, unidad; **doble clic o botón** en el color → cajón con su kardex, cancelar-inverso y
  filtro por partida), Ajuste por color, Traspaso por color, **Salida a orden por color** (hereda el
  deep-link "Descargar tela" de producción). Del lote sobrevive **una sola** pantalla, "(legado)" y
  de SÓLO CONSULTA: `/inventarios/telas/existencias-lote` (⌘K). `/inventarios/telas/salida-orden-lote`
  se retiró en la fila 0.170 —capturaba sin color— y su ruta redirige a la salida por color. El riel:
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
  por factura/remisión (B1). Mismo criterio que Producción
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
  - ⭐ **Fila 0.172 — el traspaso también exige MOTIVO** (`traspasarTelaColor` y `traspasarAvio`).
    Hasta esa fila lo exigían el ajuste, el conteo cíclico y la salida sin orden, pero los traspasos
    llevaban unas `observaciones` OPCIONALES: mandarle mil metros de tela a un cortador no obligaba a
    escribir una palabra, mientras que mover producto terminado sí (fila 0.100). Misma forma que
    `esquemaAjusteTelaCrear.motivo` (3–500, mensajes verbatim) y mismo destino: se guarda en
    `observaciones` de **las dos patas**, sin columna nueva ni migración. Los traspasos anteriores se
    quedan con `observaciones` NULL y se leen e imprimen tal cual (REGLA 0-B).
    ⚠️ El traspaso LEGADO por lote (`traspasarTela`) **no** lo lleva: la fila 0.170 le retiró la ruta
    y hoy sólo es el andamio de las pruebas de integración.
- `migracion.ts` (F4-E6) — helpers modo migración: `crearMovimientoTelaMigrado`,
  `crearTraspasoTelaMigrado`, `asegurarLoteLegacyTela` (vía el motor de kardex; A1/A2/A3/A7).
- `cancelacion-comun.ts` (fila 0.099) — ⚠️ **lo que NO se cancela desde aquí**: un movimiento nacido
  del **ajuste de un inventario cíclico** (`origenTipo = ajuste-ciclico`). La hoja de conteo quedó
  `cerrado` y `cancelarInventarioCiclico` rechaza justo ese estado, así que revertir el movimiento
  dejaría al kardex contando una historia distinta de la que cuenta la hoja. El rechazo vive una
  sola vez y lo aplican **las tres** puertas (`telas.ts`, `partidas-telas.ts`, `avios.ts`) — la misma
  puerta trasera que cerró la 0.104. Si el conteo estuvo mal, se corrige con un **movimiento manual
  NUEVO** (compatible con D3). El cíclico se documenta en `docs/modulos/indicadores.md`.

## ⭐ La salida que NO es por OP — devolución y venta (fila 0.104, 5-sep-2026)

**Daniel** (2-sep): *«el 99 % sale por medio de una OP pero deberíamos tener la opción de sacar
alguna venta o cualquier otra cosa»*; y al cerrarlo (§Post-F9.193 resp. 12): *«sacar por ejemplo una
**devolución**, o una **venta de avíos que ya no se usen**… que no sea mediante la descarga o
aplicación a una OP. Esto **autorizado siempre por mí**. Lo mismo en telas»*.

Hasta esta fila, de telas y avíos sólo se podía sacar material **por orden**, **por nota** o con un
**ajuste** de conteo. Ahora hay una cuarta puerta, y **sólo ajusta inventario**: no genera nota de
crédito, no toca CxP ni la facturación (*«por ahora que toque sólo inventarios»*). A qué proveedor se
le devolvió o a quién se le vendió viaja en el **motivo obligatorio**, no en una FK.

- **Dominio:** `salida-sin-orden.ts` (las DECISIONES: permiso y concepto→tipo de movimiento) +
  `registrarSalidaTelaColorSinOrden` en `partidas-telas.ts` y `registrarSalidaAvioSinOrden` en
  `avios.ts` (la orquestación, que reusa el MISMO no-negativo bajo lock de las demás salidas — D3).
- **Permiso PROPIO `salida-material.registrar`** (módulo propio `salida-material`), en
  `SOLO_ADMINISTRADOR`: lo llevan sólo `Administrador` y `AdministracionDireccion`. NO se reusó
  `inventario-telas.mover`/`inventario-avios.mover`, que hoy bajan hasta `Secretarial`. **El mismo
  permiso gobierna la CANCELACIÓN** de estas salidas (el inverso devuelve el material al inventario,
  o sea deshace la decisión) **por las TRES puertas que pueden alcanzarlas**: la del flujo por color
  (`partidas-telas.ts`), la de avíos (`avios.ts`) y la LEGADA por lote (`telas.ts`), que acepta
  cualquier movimiento con renglones de tela — incluidos los del flujo por color. Las demás
  cancelaciones siguen con su `.mover` de siempre.
- **El concepto elige un tipo de movimiento DEDICADO** (mismo criterio que `ajuste-ciclico-*` de
  F7-E5: que el kardex sepa distinguir): `devolucion-proveedor` → *Devolución a Proveedor*,
  `venta` → *Venta de Material* (los dos NUEVOS, entran por **seed**), `otro` → *Otras Salidas* (uno
  de los 19 canónicos del sistema viejo; no estrena tipo para un caso que nadie ha nombrado).
- **Traza:** `origenTipo = salida-sin-orden`, sin `origenId` (no hay entidad detrás). Es lo que
  permite exigir la llave del dueño al cancelar.
- **API:** `POST /inventarios/telas/color/salidas-sin-orden` y `POST /inventarios/avios/salidas-sin-orden`.
- **Pantalla:** «Salida de material sin orden» (`/inventarios/salida-sin-orden`), con las dos
  dimensiones en pestañas. Cuelga del grupo Inventarios, **no** de «Telas» ni de «Avíos»: sirve a las
  dos, y la decisión de Daniel fue una sola.
- **En producto terminado NO se construyó la salida** —la pantalla de movimientos de PT ya ofrece
  `venta-mostrador` y `otras-salidas` desde el sistema viejo, y su gemela con precio y cliente es la
  fila **0.130**—, **pero esa pantalla SÍ cambió**: los dos rótulos nuevos son de catálogo GLOBAL y
  se colaron a su desplegable, ofreciéndole a cualquiera con `inventario-pt.mover` el rótulo que
  Daniel se reservó. Ahora **están reservados**: el dominio los rechaza en los **CUATRO** escritores
  genéricos (ajuste de tela por color, ajuste LEGADO de tela por lote, ajuste de avíos y movimiento
  manual de PT) y el API los marca con `capturaManual: false` para que ninguna pantalla los ofrezca. Sólo los escriben las dos
  funciones de esta fila, que los resuelven por código.
  🔑 **Por qué era obligatorio:** un tipo dedicado es, implícitamente, una afirmación sobre QUIÉN lo
  escribió. Si cualquiera puede estampar «Venta de Material», el rótulo no clasifica mejor —
  clasifica igual de mal y con más confianza, porque quien lea el kardex creerá que esa salida la
  autorizó el dueño.

## Lotes (D5)

`Lote` (proveedor, factura, fecha, idColor — el lote define el teñido) + `LoteComponente` (idTela,
cantidad, peso) — elimina el límite `ExTela1/ExTela2` del viejo. Un lote puede traer N telas
acompañantes del mismo color en una sola captura.

## Los TRES kardex son de un PERIODO (fila 0.173)

Antes, pedir cualquiera de los tres kardex de materiales —tela por **color**, tela por **lote** (el
legado) y **avíos**— traía **todo el histórico**: ni filtro de fechas ni `LIMIT`. Es la misma falla que
la fila **0.138** ya había curado en producto terminado, y aquí se reusa **su** mecanismo, no otro: vive
una sola vez en `backend/src/dominio/inventarios/periodo-kardex.ts` y de ahí lo toman los cuatro.

| Regla | Qué hace |
|---|---|
| `desde` / `hasta` (YYYY-MM-DD) | Periodo, **ambos bordes INCLUSIVOS**. Se resuelve en el `WHERE` (`movimientos.fecha`), nunca recortando en el cliente lo que ya llegó. |
| Ventana por omisión | Si no viene `desde`, se pone **hoy − 12 meses** (o `hasta` − 12 meses si sólo vino el techo): **el periodo SIEMPRE tiene piso**. Sin techo, para que un movimiento con fecha futura siga saliendo — y el histórico de Access trae fechas capturadas mal, hasta 2029. |
| Tope duro `limite` | 1 000 renglones por omisión, **máximo 5 000**. Un rango ancho (`desde=2016-01-01`) no puede volver a traer todo. |
| ⭐ Dirección del corte | Cuando el periodo no cabe, se conserva **el FINAL** (`folio DESC` + inversión), no el principio. |

⭐ **Y el periodo trae de la mano su SALDO ANTERIOR (`saldosIniciales`).** Los tres kardex tienen columna
de saldo corrido —el de color tiene **dos**, cuerpo y complemento—, así que recortar a secas las dejaría
arrancando en cero y mintiendo hasta el último renglón. Una consulta agregada suma, por artículo, todo lo
que se movió **antes del primer renglón visible** (D3: Σ de movimientos, jamás un saldo guardado). La
llave del saldo es distinta en cada uno, y por eso el `GROUP BY` también:

| Kardex | Llave del saldo corrido | Guardas de CORRECCIÓN en el saldo anterior | De rendimiento |
|---|---|---|---|
| Tela por **color** | almacén (cuerpo y complemento) | `id_empresa` (A9), `id_tela_color`, `id_partida` | `id_almacen` |
| Tela por **lote** (legado) | lote × almacén | `id_empresa` (A9), `id_tela`, **`id_tela_color IS NULL`** | `id_lote`, `id_almacen` |
| **Avíos** | almacén | `id_empresa` (A9), `id_avio` | `id_almacen` |

La distinción no es cosmética: lo que está en la llave de agrupación produce, si se quita, grupos de más
que el llamador descarta (rendimiento); lo que **no** está en la llave suma lo ajeno **dentro del mismo
grupo** y hace mentir a toda la columna a la vez. Por eso las de corrección tienen prueba que muere al
quitarlas y las otras no pueden tenerla — se dice en el código en vez de fingirlo. El caso más filoso es
el `id_tela_color IS NULL` del legado: sin él, los renglones del inventario **vigente por color** (que
llevan `id_lote` NULL) caerían en el cubo «sin lote» del saldo anterior — el mismo descuadre que el
reviewer de la etapa A2 cazó en la lista.

⚠️ **El desempate es `(folio, id)`, no la fecha**, la misma llave con la que la lista se ordena y se
corta. En el kardex por color el caso no es teórico: desde la fila **0.142** un traspaso reparte FIFO
entre las partidas del origen, así que **una pata escribe varios renglones del mismo color y almacén**;
si el tope corta en medio, el renglón que queda fuera tiene el MISMO folio que el ancla y sólo el `id` los
separa. En el legado pasa igual cuando un ajuste toca varios lotes de la misma tela. En **avíos no puede
pasar**: la captura prohíbe repetir el avío en dos renglones, así que un movimiento aporta como mucho una
línea a ese kardex y la llave degenera en el folio — ahí el `id` se conserva por coherencia con el
`ORDER BY`, y **no hay prueba que muera al quitarlo** porque no la puede haber.

### Por qué los mismos números que en producto terminado, y no otros (medido)

La tentación era darle al kardex **legado por lote** una ventana distinta: es un archivo CONGELADO —desde
la fila 0.170 nadie escribe ahí, sólo vive el histórico migrado de Access— y una ventana que corre con el
calendario acabará dejándolo en blanco. Se midió antes de inventar nada, sobre los CSV de Access:

- Histórico completo: **33 688** renglones de detalle en **813** telas; la más movida, **2 153**.
- Con la ventana de migración vigente (`ETL_DESDE=2025`, §Post-F9.24), que es lo que hay en `prueba`:
  **259** renglones en **51** telas; la más movida, **48**.

⇒ el kardex que la fila daba por «el único con volumen real» es, en la práctica, **el más pequeño de los
tres**. Sin un problema que resolver, una regla propia sería doblar el diseño para que le cuadre al
histórico, y eso es justo lo que la **REGLA 0-B** prohíbe. Un solo mecanismo, un solo juego de números; lo
que sí se hace es que la pantalla del legado **diga** que su vacío es del periodo y mande a ampliar las
fechas.

### Sin índice nuevo, y por qué (medido)

Mismo veredicto que en la 0.138, re-medido aquí. Base local PostgreSQL 16 con **100 000 movimientos /
500 000 renglones de tela por lote + 100 000 por color + 100 000 de avío** repartidos en diez años (10 000
renglones para la tela medida). Tiempos de punta a punta de la función de dominio (mediana de 5):

| Kardex (ventana por omisión) | SIN índices | CON los 4 candidatos |
|---|---|---|
| Tela por lote | **108 ms** (305 renglones, 105 KB) | 112 ms |
| Tela por color | 53 ms (153 renglones, 73 KB) | 49 ms |
| Avíos | 38 ms (61 renglones, 20 KB) | 34 ms |
| Tela por lote, 10 años con tope 5 000 | 251 ms (1 691 KB) | 267 ms |

Candidatos probados: `movimientos(id_empresa, fecha)`, `movimiento_det_tela(id_tela, id_movimiento)
WHERE id_tela_color IS NULL`, `movimiento_det_tela(id_tela_color, id_movimiento)` y
`movimiento_det_avio(id_avio, id_movimiento)`. El plan no cambia de forma (sigue mandando el índice por
artículo, `Parallel Bitmap Heap Scan` sobre el detalle) y la ganancia queda dentro del ruido cuando la
hay. **La selectividad ya la da el artículo, no la fecha** ⇒ **sin migración**.

📏 **El tamaño del defecto que esto cierra:** con esa misma base, el kardex viejo de la tela medida
devolvía sus **10 000 renglones** completos (los 5 000 que caben en el tope pesan ya **1 691 KB** ⇒ del
orden de **3.4 MB** en una sola respuesta). Con la ventana por omisión son **305 renglones / 105 KB**.

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
