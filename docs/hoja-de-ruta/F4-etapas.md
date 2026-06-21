# F4 — Compras / MRP · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Entrega de la fase (plan §6):** Explosión R3, OC desde explosión, recepción R7 con estatus por orden, inventarios de telas (D5) y avíos (R4), notas de salida estructuradas.
> **Criterio de salida:** El tablero "qué tengo / qué falta" reemplaza el drive manual.
> **Estado:** 🚧 en curso (E1–E3 ✅, 3/6) — E1 (kardex telas/avíos), E2 (órdenes de compra) y E3 (recepción) cerradas; sigue E4 (explosión R3 + tablero).

## F4-E1 · Kardex de telas y avíos (lotes D5) + pantallas de inventario — ✅ (20-jun-2026)

> **Cierre (20-jun-2026) — reviewer independiente APROBADO sin condiciones (0 bloqueantes).** Entregado en 2 pasadas (backend → frontend) por 1 coder + 1 reviewer. **Backend:** `comun/kardex.ts` extendido a Tela (tela×lote, D5) y Avío (R4) con no-negativo por suma directa bajo `pg_advisory_xact_lock` (NUNCA la vista, D3); `comun/conversion.ts` (motor presentación→unidad de consumo, cantidad ×factor / precio ÷factor con invariante de valuación; factor en `AvioProveedor.factorConversion`→`Avio.factorConversion`→1:1, R1 — lo usará E3); `dominio/inventarios/{telas,avios}.ts` (ajuste con lote 1..N D5, salida-a-orden como ÚNICA vía que descuenta tela trazando `origenId=idOrden`, traspaso atómico, cancelación = inverso auditado). **Migración aditiva `20260620120000`** (`Lote`/`LoteComponente`, FK `idLote` en `MovimientoDetTela/Avio`, `factorConversion`, vistas `existencia_tela`/`existencia_avio`). 6 endpoints RBAC `inventario-{telas,avios}.{ver,mover}` con importes ocultos server-side sin el ex-acceso #7 `telas.ver-totales`. **Frontend:** 6 pantallas teal (3 consultas en móvil) + PDF de inventario de telas. **Correcciones del reviewer aplicadas en el mismo entregable y re-verificadas:** 🔴 guard que impide cancelar UNA pata de un traspaso (se revierte con traspaso inverso — D3) con su test; sufijo aleatorio anti-colisión en la clave de lote; comentario en las vistas; test de ajuste con `idLote` NULL. **SIN tocar F3.** CI verde (backend 457 unit; frontend 317 + build; integración en CI). **El deploy a `prueba` requiere `SEED_ON_START=true`** (4 permisos + 3 tipos de movimiento nuevos: `entrada-recepcion`, `salida-a-orden`, `salida-por-nota`). **Backlog (no bloqueante):** asimetría `idLote` en el kardex de avío; redondeo del importe al mostrar cuando E3 valúe.

**Objetivo:** Extender el motor kardex de F0 con las dimensiones Tela (tela×lote, D5) y Avío (R4), sus tipos de movimiento, las vistas de existencia y la conversión de unidades, entregando completas las pantallas de inventario que NO dependen de compras (ajuste, traspaso, salida a orden, consultas). Va primero porque es el cimiento sobre el que la recepción (E3) y las notas (E5) escriben movimientos; es el único corte horizontal de la fase y lo amerita un motor (regla 3).

**Alcance:**
- Prisma: tablas nuevas Lote (proveedor, factura, fecha, idColor — el lote define el teñido) y LoteComponente (idLote, idTela, cantidad, peso) — D5 elimina el límite ExTela1/ExTela2
- Prisma: extensión de MovimientoDet con dimensiones Tela (idTela × idLote) y Avío (idAvio × idLote opcional) + tipos de movimiento nuevos: entrada-recepcion, salida-a-orden, salida-por-nota, traspaso, ajuste; costoUnit en todo movimiento (D1)
- Vistas SQL ExistenciaTela (SUM por tela×lote×almacén) y ExistenciaAvio (SUM por avío×almacén) creadas en migración Prisma — NUNCA tablas editables (D3)
- Verificar que Avio.esGenerico quedó en F1 (R4); si falta, agregarlo aquí con migración
- Motor de conversión de unidades/presentación (presentación de compra rollo/pieza → unidad de consumo del BOM metros/pzas, factor desde AvioProveedor R1) en backend/src/comun — sin esto el cruce R7 no cuadra ('15 Rollos (750 mts)'); el factor convierte CANTIDADES y también PRECIOS (precio por presentación ÷ factor = costo por unidad de consumo, lo usa E3)
- backend/src/dominio/inventarios: consultarExistencias (telas tela×lote×almacén / avíos avío×almacén), ajustarInventario (motivo obligatorio, movimiento auditado, puede crear lote para telas — base del conteo físico y de los ajustes del ETL), traspasarEntreAlmacenes (salida+entrada atómica A2), registrarSalidaTelaAOrden (trazabilidad Salidas.IdOrdenes conservada). SEMÁNTICA que fija la fase: registrarSalidaTelaAOrden es LA única vía que descuenta tela hacia una orden; la nota de salida de E5 para telas es documento de envío que REFERENCIA esta salida, no genera segundo movimiento (04-Inventarios.md §'Cómo conecta')
- backend/src/api/inventarios: rutas REST de existencias, kardex/movimientos, ajuste, traspaso y salida a orden; permisos RBAC nuevos en el catálogo de contrato + seed; Bitacora en movimientos de inventario (A7); idEmpresa (A9)
- Permiso ex-acceso #7 'Ver Totales de telas e importes' (form viejo Existencia; ya seedeado en F0): las rutas de existencias y kardex de telas OMITEN server-side los campos de costo/importe/total en dinero para quien no lo tenga (A4, deny-by-default), y la UI los oculta — cantidades sí visibles para todos los que entren al módulo
- Pantallas: Inventario de telas — existencias por tela×lote×almacén con componentes del lote expandibles (UI que no estorba con 1 componente); Kardex de telas (entradas por factura / salidas por orden / salidas por nota); Inventario de avíos (existencias multi-almacén + kardex, distingue esGenerico); Salida de tela a orden; Traspaso entre almacenes; Ajuste / inventario físico (sustituye SalidasModificar: toda corrección es movimiento)
- Las pantallas de CONSULTA (existencias de telas, existencias de avíos, kardex) funcionan también en viewport MÓVIL (regla 10, PLANMAESTRO §Contexto 'Acceso': consultas en celular); la captura (ajuste, traspaso, salida a orden) puede quedar solo PC
- Impreso PDF 'Inventario de telas' con @react-pdf/renderer (R9, referencia: reporte viejo InventariosTela)
- backend/openapi.json regenerado + frontend/src/api/esquema.gen.ts sincronizado en esta misma etapa (regla 7)

**Entregables:**
- Migración Prisma (Lote, LoteComponente, dimensiones y tipos de movimiento, vistas de existencia) aplicable en limpio
- Servicios de dominio con TSDoc citando 04-Inventarios.md §B y D3/D5/R4/A2 + tests unitarios e integración con testcontainers (incluye test de propiedad: existencia mostrada = SUM de movimientos)
- Rutas REST con permisos verificados server-side + tests de integración de API (incluye: respuesta SIN importes para usuario sin el ex-acceso #7)
- 6 pantallas siguiendo docs/modulos/patron-crud.md + tests Vitest de componentes/hooks (las 3 consultas con test en viewport móvil)
- PDF de inventario de telas con test de generación
- openapi.json versionado + cliente tipado del frontend regenerado (npm run gen:api) compilando sin errores

**Criterio de cierre:**
- CI verde (lint, typecheck, tests backend+frontend, build de imágenes, migración en limpio) y review aprobado
- No existe NINGÚN endpoint ni campo de pantalla que edite una existencia directamente (D3)
- Traspaso y ajuste demostrados como transacciones atómicas en tests (A2)
- El API omite costos/importes de telas a un usuario sin el permiso ex-acceso #7 aunque la UI se manipule (A4)
- Checklist de verificación de Gabriel confirmado

**Verificación de Gabriel:**
- [ ] En la raíz del repo: docker compose up -d --build; abrir http://localhost:8080 y entrar como admin / Control.2026!
- [ ] Inventarios → Ajuste: capturar un ajuste de ENTRADA de una tela con lote de 2 componentes (ej. Felpa + Cardigan, mismo color) escribiendo el motivo
- [ ] Abrir Existencias de telas: ver la tela con su lote, expandir los 2 componentes y comparar cantidades contra lo capturado
- [ ] Hacer un traspaso entre almacenes: verificar que la existencia baja en el origen, sube en el destino y el kardex muestra los 2 movimientos de la misma operación
- [ ] Registrar una salida de tela a una orden de F2 y verificar en el kardex la salida ligada a esa orden
- [ ] Inventario de avíos: capturar ajuste de entrada de un avío con esGenerico y verlo en existencias multi-almacén
- [ ] Crear (en Administración) un usuario SIN el permiso 'Ver Totales de telas e importes' y entrar con él: en existencias y kardex de telas debe ver cantidades pero NINGÚN costo/importe; como admin sí se ven
- [ ] Abrir Existencias de telas y el kardex desde el celular (o devtools en modo móvil): se deben leer y navegar bien
- [ ] Recorrer todas las pantallas buscando un campo de existencia editable: NO debe existir ninguno (D3)
- [ ] Descargar el PDF de inventario de telas y comparar los números contra la pantalla
- [ ] Abrir http://localhost:8080/api/docs y confirmar que las rutas nuevas de inventarios aparecen documentadas

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI dentro del mismo módulo de inventarios: no se paraleliza). Nota para el lead: es la etapa más cargada de la fase; si se atora, el corte de contingencia es backend completo primero (esquema+motor+dominio+API con tests) y las 6 pantallas + PDF como sub-entrega final del MISMO equipo — no partir la etapa formalmente ni dejarla a medias entre etapas (regla 1); dejar la pantalla de avíos y el PDF como últimos commits

**Referencias:**
- Documentacion_MJD/04-Inventarios.md §B.1–B.4, §'Cómo conecta' (la tela sale ligada a la orden y viaja vía Notas — fija la semántica salida-vs-nota) y §'Observaciones para la modernización' (obs. 1: saldos por GotFocus/LostFocus; obs. 3: D5)
- Documentacion_MJD/DECISIONES.md §D5 (lote + N componentes) y D3 (existencia = suma de movimientos)
- Documentacion_MJD/REQUISITOS-NUEVOS.md §R4 (inventario de avíos, esGenerico, sin mínimos/máximos) y §R1 (presentación para la conversión)
- Respaldo CLAUDE/TABLAS/Accesos.csv — acceso #7 'Ver Totales de telas e importes' (form Existencia)
- PLANMAESTRO.md §4 'Motor de inventario único (D3)', §3 (lógica solo en dominio A1) y §Contexto 'Acceso' (consultas en móvil)
- docs/modulos/patron-crud.md
- Aplican: D1, D3, D5, A1, A2, A4 (ex-acceso #7), A6, A7, A9, R1, R4

---

## F4-E2 · Órdenes de compra: captura, autorización (móvil), cancelación, consultas e impresos — ✅ (en `prueba`, PR #62)

> **Cierre — en `prueba` (PR #62, commit `b4ee1e2`).** Módulo de OC completo, 1 coder + 1 reviewer. **Esquema:** `OrdenCompra` (folio `NumCompra` por secuencia atómica por empresa A3; estatus como **enum** `borrador/pendiente_autorizacion/autorizada/recibida_parcial/recibida_total/cancelada` —reemplaza el texto libre del viejo—; `idUsuAutorizado`+`fechaAutorizado`; cancelación suave con `motivoCancelacion`+responsable; `observaciones`/`correspondeA`/`facturasAmparadasLegacy`; `idEmpresa` A9; auditoría A7) + `OrdenCompraLinea` (liga a `idTela`/`idAvio` + `idAvioProveedor` para el precio R1, cantidad/unidad/precio, `idOrden` de producción **por línea**, `descripcionLibre` como fallback para servicios/no-catalogados) + `OrdenCompraLineaTalla` (detalle talla×color **opcional**, decisión **(c)** de Daniel) + `OrdenCompraOrden` (N:N OC↔órdenes, informativa). **Dominio (A1):** `crearOC/actualizarOC/autorizarOC/cancelarOC/duplicarOC/obtenerOC/listarOC`; `autorizarOC` exige el permiso `compras.autorizar` (ex-acceso #8) y registra usuario+fecha en Bitácora. **Permisos:** `compras.ver/.administrar/.cancelar/.autorizar`. **Frontend:** listado/consulta con filtros, captura/edición contra catálogo (selector de proveedor/precio), bandeja de autorización (móvil) y compras por orden de producción; **impreso PDF** de OC. **Decisión (a):** una OC autorizada queda bloqueada para edición salvo el administrador (cada cambio a Bitácora) + acción **"Duplicar a nueva OC"** (copia a borrador para reajustar sin recapturar). **NO toca el kardex** (eso llega con la recepción de E3), por eso solo depende de F1/F2. El `Totales` del viejo NO se almacena (derivado de líneas). El candado "no cancelable con recepciones" quedó preparado como punto de extensión que **E3 cerró**.

**Objetivo:** Módulo de OC completo: captura contra catálogo eligiendo proveedor/precio (R1), liga POR LÍNEA a la orden de producción (para que R7 cruce sin prorrateos), autorización con el permiso ex-acceso #8 también en celular, y cancelación suave auditada. No toca el kardex (eso llega con la recepción en E3), por eso solo depende de F1/F2.

**Alcance:**
- Prisma: OrdenCompra — folio NumCompra por secuencia atómica de Postgres por empresa (A3), proveedor, fechas emisión/entrega, entregaEn, estatus formal como enum (borrador / pendiente-autorización / autorizada / recibida-parcial / recibida-total / cancelada — reemplaza el texto libre del viejo), autorizadoPorId/fechaAutorizado, cancelación suave con motivo y responsable, idEmpresa (A9), auditoría (A7)
- Prisma: destino de los campos del encabezado viejo (OrdCompra.csv los trae y el ETL de E6 los necesita): observaciones y correspondeA → campos vigentes del encabezado nuevo (capturables); facturasAmparadasLegacy → campo de solo lectura para lo migrado (en v2 lo supera la factura por RecepcionCompra de E3); Totales del viejo NO se almacena (derivado de las líneas, se calcula)
- Prisma: OrdenCompraLinea — liga a material del catálogo (idTela o idAvio + idAvioProveedor para el precio R1), cantidad, unidad/presentación, precio, idOrden de producción POR LÍNEA, y descripción libre SOLO como fallback para servicios/no-catalogados (esas líneas no cruzarán en R7)
- Prisma: OrdenCompraOrden — relación N:N OC↔órdenes a nivel encabezado, derivada/informativa (reemplaza OrdCom-Ord)
- backend/src/dominio/compras: crearOC/actualizarOC (validando contra catálogo), autorizarOC (solo con el permiso 'Autorizar órdenes de compra' ya seedeado en F0; registra usuario+fecha; escribe Bitacora A7; regla de edición post-autorización según lo cerrado con Daniel), cancelarOC (suave, con motivo; la regla 'no cancelable con recepciones' queda implementada y el reverso que la destraba llega en E3)
- backend/src/api/compras: rutas REST con permiso verificado en servidor en cada una; OpenAPI regenerado + cliente del frontend sincronizado
- Pantalla: listado/consulta de OC con filtros (proveedor, estatus, autorizada/pendiente, fechas, empresa) — reemplaza OrdCompraVer(Sub)
- Pantalla: captura/edición — encabezado (incl. observaciones y correspondeA) + renglones contra catálogo (selector de proveedor/precio desde AvioProveedor R1) + línea libre + liga a órdenes de producción — reemplaza OrdCompra/OrdCompraDet/OrdCompraOrd
- Pantalla: bandeja de AUTORIZACIÓN con quién/cuándo, usable en PC y MÓVIL (PLANMAESTRO §Contexto 'Acceso': autorizaciones en celular) — reemplaza OrdCompraProceso
- Pantalla: compras por orden de producción — reemplaza OrdCompraOrdenes/OrdCompraOrdsDet
- Impresos R9: PDF de OC con las variantes que Daniel confirme (referencias viejas OrdCompraImp/OrdCompraImpAdm/OrdCompraImpInter) + exportación a Excel con exceljs si Daniel la confirma (ex OrdCompraExcel)

**Entregables:**
- Migración Prisma de OC + secuencia de folio por empresa
- Servicios de dominio con TSDoc (cita 03-Produccion.md §OC y A3/A7) + tests unitarios e integración (incluye: folio consecutivo bajo concurrencia, autorización denegada sin permiso, cancelación suave)
- Rutas REST + tests de integración; openapi.json regenerado + esquema.gen.ts sincronizado
- 4 pantallas según patron-crud.md (la bandeja de autorización verificada en viewport móvil) + tests Vitest
- PDF(s) de OC + export Excel (lo confirmado) con tests
- Registro en Documentacion_MJD/DECISIONES.md de las reglas de autorización/edición acordadas con Daniel
- Tabla de mapeo encabezado viejo→nuevo (Observaciones/CorrespondeA/FacturasAmparadas/Totales) documentada para el ETL de E6

**Criterio de cierre:**
- CI verde y review aprobado
- Dos OC creadas seguidas reciben folios consecutivos por secuencia (test, A3); jamás Max()+1
- Autorizar/cancelar dejan rastro en Bitacora con usuario y fecha (A7)
- El API rechaza autorizar sin el permiso aunque la UI se manipule (deny-by-default)
- Checklist de Gabriel confirmado

**Verificación de Gabriel:**
- [ ] docker compose up -d --build; entrar a http://localhost:8080 como admin
- [ ] Compras → nueva OC: agregar una línea de avío del catálogo eligiendo proveedor (el precio se llena solo desde AvioProveedor), una línea de tela y una línea libre tipo 'Servicio de fumigación'; capturar observaciones y 'corresponde a'; ligar las líneas a una orden de F2; guardar
- [ ] Crear una segunda OC y comprobar que el folio es exactamente el consecutivo
- [ ] Crear (en Administración) un usuario SIN el permiso de autorizar, entrar con él: la bandeja de autorización no debe aparecer; opcional: en /api/docs intentar la ruta de autorizar con esa sesión y ver el rechazo
- [ ] Como admin, abrir la bandeja desde el celular (o devtools en modo móvil) y autorizar la OC; verificar que muestra quién y cuándo
- [ ] Cancelar otra OC escribiendo el motivo: debe quedar visible como cancelada (no borrada) con motivo y responsable
- [ ] Abrir 'Compras por orden de producción' con la orden ligada y ver la OC listada
- [ ] Descargar el PDF de la OC y compararlo contra el formato viejo de referencia; probar la exportación a Excel si quedó incluida
- [ ] Administración → Bitácora: ver los eventos de autorización y cancelación registrados

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI del mismo grupo). Nota para el lead: E2 no depende de E1 (no toca kardex), así que si conviene acortar calendario puede correr en paralelo con E1 con un segundo equipo — módulos disjuntos (compras vs inventarios), coordinando solo el orden de las migraciones Prisma

**Referencias:**
- Documentacion_MJD/03-Produccion.md §'Submódulo — Órdenes de Compra (Menú 3.5)' (tablas OrdCompra/OrdCompraDet/OrdCom-Ord, autorización acceso #8, cancelación auditada)
- Respaldo CLAUDE/TABLAS/OrdCompra.csv (encabezado real: incluye Observaciones, CorrespondeA, FacturasAmparadas, Totales — mapeo definido en esta etapa)
- Documentacion_MJD/REQUISITOS-NUEVOS.md §R1 (proveedor/precio/presentación) y §R9 (impresos)
- PLANMAESTRO.md §Contexto 'Acceso' (autorizaciones en móvil), §4 (Bitacora en OC) y §5 (módulo 5)
- docs/modulos/patron-crud.md
- Aplican: A1, A2, A3, A4 (permiso ex-acceso #8), A7, A9, R1, R9

---

## F4-E3 · Recepción de compras (R7): lotes D5, entrada al kardex y evento para la RC — ✅ (21-jun-2026)

> **Cierre (21-jun-2026) — 2 reviewers independientes APROBARON (el transaccional, sin condiciones; plan §9.1).** 1 coder + 2 reviewers (uno al diff completo, uno al núcleo transaccional crítico). **Servicio `recibirCompra`** (UNA transacción A2): valida OC `autorizada`/`recibida_parcial` (**regla (b)** de Daniel, deny-by-default A4) y el **almacén destino** (existe + activo + global-o-de-la-empresa, A9 — helper `comun/almacenes.ts` extraído y compartido con los flujos gemelos de F3, idéntico, sin regresión); folio A3 (`recepcion-compra`); crea `RecepcionCompra`/`Linea`; para telas crea `Lote`+`LoteComponente` (**D5**, 1..N componentes del mismo color en una captura); registra la entrada al kardex (`entrada-recepcion`) aplicando el **motor de conversión a la CANTIDAD (×factor) Y al COSTO (÷factor)** con invariante de valuación `cantidad×costoUnit = cantidadOC×precioOC` (D1/D3); recalcula el estatus de la OC por línea/encabezado (R7) **bajo `pg_advisory_xact_lock` por OC** (clave `bigint` con namespace propio `0x4f43`, distinto al de los locks `(int,int)` del kardex → sin colisión; evita la carrera que dejaría la OC "parcial" estando completa); Bitácora A7; y **publica `material-recibido` vía OUTBOX transaccional** (la fila va en la MISMA tx → el evento nunca se pierde). **`reversarRecepcion`** = movimiento(s) inverso(s) auditado(s) (D3, nada se borra) + reverso suave con motivo, recalcula el estatus hacia atrás y **rechaza doble reverso bajo el lock**; destraba el candado de cancelación de OC de E2. **Infra NUEVA pg-boss 12 + outbox** (F0 no la dejó): worker tras flag `EVENTOS_COLA_ACTIVA` (inactivo en tests/CI), publish post-commit best-effort + barrido idempotente; **el consumidor (auto-avance de la RC) es de F5** — aquí solo se emite y registra. **ADR-0011** documenta el patrón + el contrato **versionado** del evento. Permiso nuevo `compras.recibir`. **Frontend:** pantalla de Recepción (selecciona OC autorizada/parcial, captura por línea, lote con 1..N componentes elegibles del **catálogo completo de telas** — D5 capturable) + historial con reverso; el listado de OC refleja el estatus de recepción. **Migración aditiva `20260620140000`** (`RecepcionCompra`/`Linea`/`EventoOutbox`). **SIN tocar F3** salvo el dedup idéntico del helper de almacén (verificado sin cambio de comportamiento). CI verde (backend **481** unit; frontend **348**; integración con testcontainers en CI: atomicidad/rollback, parciales acumuladas, existencia=Σmov + valuación, outbox atómico, reverso, regla (b), **concurrencia 500+500→`recibida_total`**, conversión de avío, línea libre). **El deploy a `prueba` requiere `SEED_ON_START=true`** (permiso `compras.recibir`; los tipos de movimiento `entrada-recepcion` ya estaban de E1). **Decisiones/notas registradas:** **(b.1)** el costo de los componentes **acompañantes** del lote queda **NULL** (provisional, a confirmar con Daniel antes de que F7 valúe inventario) en `DECISIONES.md §F4`; **TELAS se manejan 1:1** — el factor presentación→consumo vive solo en avíos (R1/E1); si Daniel compra telas por rollo y requiere convertir a metros, es tarea aparte (no es de E3).

**Objetivo:** El servicio transaccional recibirCompra: N recepciones parciales por OC que en UNA transacción crean el Lote con sus componentes, generan la entrada al kardex con costo unitario YA convertido a unidad de consumo, actualizan el estatus de la OC por línea y emiten el evento que F5 consumirá para el auto-avance de la RC. Incluye montar pg-boss + outbox (infra nueva: F0 no la dejó). Va después de E1 (kardex) y E2 (OC) porque escribe sobre ambos.

**Alcance:**
- Infraestructura de eventos (pieza propia, NUEVA — F0 no montó pg-boss): alta de pg-boss 12 sobre el MISMO Postgres existente + tabla/patrón outbox en backend/src/comun, con arranque verificado en el backend y en docker-compose (sin servicios extra); es la base del contrato de eventos que F5 consumirá (PLANMAESTRO §11)
- Prisma: RecepcionCompra (idOrdenCompra, factura, fecha, almacén destino, idEmpresa, auditoría A7) + RecepcionCompraLinea (línea de OC, cantidad recibida en unidad de consumo, idLote creado) — N recepciones parciales por OC con estatus por línea desde el día 1 (el viejo solo tenía Parcial + FechaRecibido en el encabezado). idOrdenCompra es obligatorio para recepciones v2; el histórico de E6 NO crea RecepcionCompra (no existe liga entrada↔OC en el viejo: entra directo como movimientos)
- backend/src/dominio/compras: recibirCompra — UNA transacción (A2) que: crea la recepción parcial/total; para telas crea Lote + LoteComponente (D5: todos los componentes del mismo lote/color en una sola captura); registra el Movimiento de entrada (tipo entrada-recepcion) aplicando la conversión presentación→unidad de consumo del motor de E1 a la CANTIDAD (15 rollos → 750 mts) Y al COSTO: costoUnit del movimiento = precio de la línea de OC ÷ factor de conversión (precio por rollo ÷ mts por rollo = costo por metro; D1/D3 — sin esto la valuación se infla por el factor); recalcula el estatus de la OC por línea y encabezado (pendiente/parcial/total); escribe Bitacora; y EMITE el evento de dominio 'material-recibido' (orden + material) vía el outbox/pg-boss recién montado — el consumidor llega en F5, aquí solo se publica y queda registrado
- backend/src/dominio/compras: reversarRecepcion — movimiento inverso auditado (D3, nada se borra); destraba la regla de cancelación de E2 ('no cancelable con recepciones: reversar primero')
- Regla '¿se puede recibir una OC no autorizada?' implementada exactamente como se cierre con Daniel (decisión previa registrada en DECISIONES.md)
- backend/src/api: rutas de recepción y reverso con permisos; OpenAPI regenerado + cliente sincronizado
- Pantalla: Recepción de compra (NUEVA, R7) — seleccionar OC → capturar factura, almacén destino y cantidades por línea; para líneas de tela, captura del lote con 1..N componentes en la misma pantalla (la UI no estorba en el caso común de 1 componente); historial de recepciones de la OC — reemplaza QueAlmacenEntrada/Entradas/EntradasSub
- El listado de OC de E2 muestra el estatus de recepción (pendiente / recibida parcial / recibida total) actualizado

**Entregables:**
- pg-boss + outbox operando: arranque en backend y docker-compose verificado, con doc breve del patrón (dónde se publica, dónde queda registrado, cómo lo consumirá F5)
- Migración Prisma de recepciones
- recibirCompra y reversarRecepcion con TSDoc (citan REQUISITOS-NUEVOS.md §R7, D5, D1, A2) + tests unitarios e integración con testcontainers que prueban la atomicidad (si falla la creación del lote NO queda recepción ni movimiento), las recepciones parciales acumuladas, la conversión de unidades Y de costo (cantidad del movimiento × costoUnit = cantidad de OC × precio de OC, mismo importe total), y la emisión del evento
- Rutas REST + tests; openapi.json + esquema.gen.ts sincronizados
- Pantalla de recepción (con captura de lote multi-componente) + tests Vitest
- Definición versionada del contrato del evento 'material-recibido' (payload documentado para F5)

**Criterio de cierre:**
- CI verde y review aprobado (recomendado 2º reviewer por ser servicio transaccional crítico, plan §9.1)
- Test de atomicidad en verde: ningún estado intermedio posible (A2)
- La existencia tras recibir = SUM de movimientos, y la VALUACIÓN cuadra: cantidad × costoUnit del movimiento = cantidad × precio de la línea de OC (D3/D1) — test que cubre el caso '15 rollos a precio por rollo → 750 mts a costo por metro'
- El evento 'material-recibido' se publica en cada recepción y queda consultable
- Checklist de Gabriel confirmado

**Verificación de Gabriel:**
- [ ] docker compose up -d --build; entrar como admin; usar la OC autorizada de E2
- [ ] Recepción de compra: recibir PARCIALMENTE (cantidades menores a lo pedido) capturando factura, almacén y — para la línea de tela — el lote con 2 componentes en la misma pantalla
- [ ] Verificar: la OC queda 'recibida parcial' en el listado; en Inventarios → existencias de telas aparece el lote nuevo con sus 2 componentes; el kardex muestra la entrada
- [ ] Hacer una segunda recepción que complete las cantidades → la OC pasa a 'recibida total'
- [ ] Probar la conversión completa con números redondos: una línea de 15 rollos a $500 el rollo (50 mts/rollo) debe entrar como 750 mts a $10 el metro — y el importe del kardex (750 × $10 = $7,500) debe ser igual al total de la línea de OC (15 × $500); si el costo del metro sale $500, está mal
- [ ] Intentar recibir una OC NO autorizada → el sistema responde según la regla acordada con Daniel (bloquea o avisa)
- [ ] Reversar una recepción → la existencia baja vía movimiento inverso visible en el kardex; nada desaparece
- [ ] Intentar cancelar la OC con recepciones vivas → bloqueado con mensaje de reversar primero
- [ ] Ver el evento: docker compose logs backend (o la tabla outbox de eventos) debe mostrar 'material-recibido' con la orden y el material de la recepción

**Equipo:** 1 coder + 1 reviewer, con 2º reviewer recomendado para recibirCompra (tarea grande/transaccional crítica, PLANMAESTRO §9.1). Un solo coder: todo es una cadena sobre dominio/compras + kardex (la pieza pg-boss/outbox va primero dentro de la misma etapa)

**Referencias:**
- Documentacion_MJD/REQUISITOS-NUEVOS.md §R7 (recepción con estatus automático; insight: el cruce depende de la identificación por catálogo)
- Documentacion_MJD/DECISIONES.md §D5 (lote con N componentes, mismo color)
- Documentacion_MJD/04-Inventarios.md §B.2/B.3 (entradas con factura) y §'Cómo conecta' (telas ← órdenes de compra)
- Documentacion_MJD/03-Produccion.md §OC (campos Parcial/FechaRecibido del viejo: lo que se supera)
- PLANMAESTRO.md §4 (eventos del sistema auto-completan procesos de la RC), §5 (gancho a F5) y §11 (pg-boss sobre el mismo Postgres — aquí se monta por primera vez)
- Aplican: A1, A2, A7, A9, D1, D3, D5, R1 (factor de conversión también para el precio), R7

---

## F4-E4 · Explosión R3, generar OC desde la explosión y tablero 'qué tengo / qué falta' (R7) — ✅ (21-jun-2026)

> **Cierre (21-jun-2026) — reviewer independiente APROBADO (0 bloqueantes; 4 hallazgos menores, 3 corregidos y re-verificados, 1 confirmado como no-issue).** 1 coder + 1 reviewer. **El corazón MRP de F4 y su criterio de salida.** Dominio `backend/src/dominio/compras/mrp.ts` (A1): **`explosionarOrden`** (R3) — requerido = `consumoPorPrenda` del BOM con bandera **`paraProduccion=true`** × **Σ piezas color×talla** de la orden (`OrdenLineaTalla.cantidad` de todas las tallas de todos los colores), para **telas (`ModeloTela`) Y avíos (`ModeloAvio`)** por igual; SIEMPRE por orden (Make-to-Order); persiste el **snapshot `RequerimientoOrden`** (borra+reescribe en UNA transacción A2 → congela la explosión aunque el BOM cambie) y devuelve el **diff** vs el snapshot previo (nuevo / eliminado / cantidad-cambiada). **Genéricos (decisión (d) de Daniel):** un avío `esGenerico=true` NO se compra completo — se **netea `max(0, requerido − existencia REAL)`** contra el kardex de avíos (Σ de movimientos, D3); lo cubierto → "cubierto por stock", solo el faltante va a compra; telas y avíos NO genéricos van completos. **`generarOCDesdeExplosion`** — agrupa el requerido **pendiente** seleccionado **por proveedor** → una OC por proveedor en un clic, **reusando `crearOC`** (folio atómico A3, ligas N:N, auditoría A7) dentro de la misma tx; **liga cada línea a su orden de producción** (`OrdenCompraLinea.idOrden`) para que R7 cruce sin prorrateos; precio desde `AvioProveedor` (R1); las telas (sin liga proveedor en v2) se omiten para captura manual. **`estatusMaterialesOrden`** (R7) — cruce **on-demand** Requerido(snapshot) vs **En-OC** (Σ líneas de OC `estatus != 'cancelada'` ligadas a la orden) vs **Recibido** (Σ recepciones `reversadaEn = null`) → `pendiente`/`en-oc`/`recibido-parcial`/`completo`; las líneas libres (`descripcionLibre`) o sin requerido → **'no-identificado'** y NO inflan el cruce; las canceladas/reversadas no cuentan. **Permisos:** explosión/estatus = `compras.ver`, generar-OC = `compras.administrar` (defensa en profundidad en dominio + rutas) — **SIN permisos nuevos**. **Migración aditiva `20260621120000_f4_e4_requerimiento_orden`** (tabla `RequerimientoOrden`: idOrden Cascade, idTela XOR idAvio Restrict, idProveedorSugerido Restrict, 4 índices, snake_case) — **SIN backfill, SIN seed, SIN permisos** → el deploy a `prueba` solo aplica la migración (no requiere `SEED_ON_START`). **Frontend (2 pantallas teal):** Explosión de materiales (agrupada por proveedor, neteo de genéricos visible, diff marcado, **selección múltiple + "Generar OC" en un clic**, imprimir) y Tablero "qué tengo / qué falta" (semáforo R7, **tarjetas en móvil** + tabla en escritorio — criterio de salida móvil). **2 PDFs (R9):** impreso de explosión + impreso de estatus de recepción. **E2E Playwright** del flujo explosión→generar-OC→autorizar→recibir→tablero. **Fixes del review cerrados:** (1) **desacople de permiso** — el neteo de genéricos usa el helper nuevo `existenciaAvioTotalEmpresa(tx, idEmpresa, idAvio)` de `comun/kardex.ts` (Σ pura, sin lock y sin guard, lectura de PLANEACIÓN — distinto de `existenciaAvioBloqueada` que sí valida no-negativo bajo lock; el único consumidor es `mrp.ts`) → un rol custom con `compras.ver` sin `inventario-avios.ver` ya no choca; `consultarExistenciasAvio` y los endpoints públicos de avíos quedaron intactos; (2) se **eliminó el `GET /ordenes/:id/explosion` que mutaba** (escribía snapshot) — la regeneración queda solo en el POST; (3) **desempate determinista** del proveedor más barato (gana menor `idProveedor`). **Hallazgo (4) (la existencia de genéricos lee la vista `existencia_avio` y no Σ-bajo-lock): confirmado NO-issue** — es planeación, no validación anti-negativo; la regla "nunca la vista" de D3 aplica a salidas/traspasos. CI verde (backend **503** unit incl. `mrp.test.ts` 14 + 2 PDFs; frontend páginas 7; integración `mrp.int.test.ts` —explosión, neteo genérico cubierto/faltante-parcial, BOM sin `paraProduccion`, diff, generar-OC por proveedor, estatus pendiente→en-oc→recibido, línea libre→no-identificado, empate de precio determinista— + e2e en CI). **SIN tocar F3.**

**Objetivo:** El corazón MRP de la fase y su criterio de salida: explosión de telas Y avíos por orden contra el BOM de F1, generación de OC agrupada por proveedor en un clic, y el tablero semáforo que reemplaza el drive manual. Va al final de la cadena porque cruza todo lo anterior: requerido (snapshot) vs líneas de OC (E2) vs recepciones (E3).

**Alcance:**
- Prisma: RequerimientoOrden — snapshot regenerable de la explosión: idOrden, material (tela/avío), cantidadRequerida, unidad, proveedor sugerido; persistirlo congela la explosión aunque el BOM cambie después
- backend/src/dominio (compras/mrp): explosionarOrden (R3) — Requerido = Σ(consumo del BOM con bandera paraProduccion × cantidades color×talla de la orden de F2), para TELAS y AVÍOS por igual; SIEMPRE por orden (Make-to-Order, nunca por niveles de stock ni reorden); regenerable mostrando diferencias si el BOM cambió; comportamiento de genéricos esGenerico según lo cerrado con Daniel (¿descuentan existencia disponible en vez de comprar?) — decisión registrada antes de construir
- backend/src/dominio: generarOCDesdeExplosion — crea OC(s) agrupando el requerido pendiente por proveedor con precio desde AvioProveedor (R1); folio por secuencia por empresa (A3); transaccional (A2); liga cada línea a su orden de producción para que R7 cruce sin prorrateos
- backend/src/dominio: estatusMaterialesOrden (R7) — cruce Requerido vs En-OC vs Recibido → pendiente / en OC / recibido parcial / completo; las líneas libres de OC aparecen como 'no identificado'; implementado como consulta/vista on-demand (la captura nunca espera un recálculo); materializar con pg-boss SOLO si la medición lo exige (plan §11)
- backend/src/api: rutas de explosión, generación de OC y estatus; OpenAPI regenerado + cliente sincronizado
- Pantalla: Explosión de materiales por orden (NUEVA, R3) — requerido agrupado por proveedor, con acción 'Generar OC desde la explosión' con selección múltiple en un clic (espíritu de MEJORAS: nada uno-por-uno)
- Pantalla: Tablero 'qué tengo / qué falta' por orden (NUEVO, R7) — semáforo por material requerido; PC + MÓVIL (consulta); ES el criterio de salida de la fase
- Impresos R9 NUEVOS: PDF de la explosión R3 y PDF del estatus de recepción R7 (alcance fino confirmado con Daniel)
- E2E Playwright del flujo crítico completo: explosión → generar OC → autorizar → recibir → tablero (la 'explosión' es flujo crítico nombrado en PLANMAESTRO §9.2)

**Entregables:**
- Migración Prisma de RequerimientoOrden
- Servicios explosionarOrden / generarOCDesdeExplosion / estatusMaterialesOrden con TSDoc (citan R3/R7/Make-to-Order y 01-Modelos.md §2) + tests unitarios e integración (casos: BOM con/sin paraProduccion, conversión de unidades, BOM cambiado → diff, línea libre → 'no identificado', genéricos según regla)
- Rutas REST + tests; openapi.json + esquema.gen.ts sincronizados
- 2 pantallas (explosión y tablero, el tablero verificado en viewport móvil) + tests Vitest
- 2 PDFs nuevos (explosión y estatus) con tests
- Test E2E Playwright del flujo explosión→OC→recepción→tablero en verde dentro del CI

**Criterio de cierre:**
- CI verde (incluido el E2E del flujo completo) y review aprobado
- Para una orden de prueba, el requerido calculado = verificación manual del BOM × cantidades (sin diferencias)
- El tablero refleja una recepción nueva al refrescar la consulta, sin recálculos que frenen la captura
- Las líneas libres se muestran como 'no identificado' y no inflan el cruce
- Checklist de Gabriel confirmado

**Verificación de Gabriel:**
- [ ] docker compose up -d --build; entrar como admin; usar una orden de F2 cuyo modelo tenga BOM completo de F1 (telas y avíos con paraProduccion)
- [ ] Abrir la explosión de la orden y verificar a mano 2-3 renglones: consumo del BOM × cantidad de la orden = requerido (uno de tela y uno de avío)
- [ ] Cambiar un consumo en el BOM del modelo (módulo de F1) y regenerar la explosión → la diferencia contra el snapshot anterior debe marcarse visiblemente
- [ ] Seleccionar varios materiales de UN proveedor y pulsar 'Generar OC' → se crea una sola OC con esas líneas, precio del catálogo y ligadas a la orden; verificarla en el listado de E2
- [ ] Abrir el tablero 'qué tengo / qué falta' de la orden: lo recién puesto en OC aparece 'en OC', el resto 'pendiente'
- [ ] Autorizar y recibir parcialmente esa OC (flujos E2/E3) → refrescar el tablero: el material pasa a 'recibido parcial'; completar la recepción → 'completo' (verde)
- [ ] Agregar a una OC una línea libre y comprobar que el tablero la lista como 'no identificado'
- [ ] Abrir el tablero desde el celular (o devtools móvil) y verificar que el semáforo se lee bien
- [ ] Descargar los PDFs de explosión y de estatus y comparar contra las pantallas
- [ ] Prueba reina de la etapa: tomar una orden real del drive manual actual y comparar — el tablero debe responder 'qué tengo / qué falta' igual o mejor que el drive (criterio de salida de F4)

**Equipo:** 1 coder + 1 reviewer (la cadena explosión→generación→estatus→tablero comparte dominio y contrato; no se paraleliza)

**Referencias:**
- Documentacion_MJD/REQUISITOS-NUEVOS.md §R3 (explosión avíos Y telas), §R7 (estatus por orden + insight de identificación por catálogo), §'Principio de negocio: compra por orden (Make-to-Order)' y §R9
- Documentacion_MJD/01-Modelos.md §2 (banderas del BOM: paraPreCosto/paraProduccion/paraCosto)
- Documentacion_MJD/MEJORAS.md (acciones masivas en un clic, nada uno-por-uno)
- PLANMAESTRO.md §6 (criterio de salida de F4: el tablero reemplaza el drive), §9.2 (explosión = flujo E2E crítico) y §11 (pg-boss para cálculos pesados)
- Aplican: A1, A2, A3, R1, R2, R3, R4 (esGenerico), R7, D4 (cantidades color×talla)

---

## F4-E5 · Notas de salida estructuradas (R4): captura, consumo de avíos, envío documentado de telas, consultas e impreso — ⬜ pendiente

**Objetivo:** Sustituir las notas de texto libre por renglones contra catálogo ligados a la orden: los renglones de AVÍO descuentan el kardex al confirmar (R4, PLANMAESTRO §5: 'notas estructuradas que descuentan avíos'); los renglones de TELA documentan el envío al maquilero referenciando la salida-a-orden de E1 SIN segundo movimiento (04-Inventarios.md §'Cómo conecta': la salida descuenta, la nota envía — así se evita el doble descuento). Cierra el ciclo de consumo de materiales; solo necesita el kardex (E1) y se ubica después del criterio de salida (E4) para no retrasar el tablero.

**Alcance:**
- DECISIÓN PREVIA con Daniel, registrada en DECISIONES.md ANTES de construir: semántica de TELAS en la nota. Default propuesto (fiel al sistema real, 04-Inventarios.md §'Cómo conecta'): la línea de tela referencia una salida-a-orden YA registrada con registrarSalidaTelaAOrden (E1) — la nota es el documento de envío al maquilero y NO genera movimiento de kardex para telas; alternativa a validar con Daniel: que confirmar la nota pueda DISPARAR la salida-a-orden cuando no exista aún (un solo movimiento, creado por la nota), con candado que impida descontar dos veces la misma tela/lote para la misma orden
- Prisma: NotaSalida (folio NumNota por secuencia atómica por empresa A3, fechaElaboracion, fechaEnvio, idMaquilero, observaciones, idEmpresa, auditoría A7, cancelación suave) + NotaSalidaLinea (idOrden destino + material: idAvio del catálogo O referencia tela/lote con liga al movimiento salida-a-orden de E1 + cantidad + unidad + descripcionLegacy SOLO para lo migrado en E6)
- backend/src/dominio (notas): crearNotaSalida + confirmarNotaSalida → genera los movimientos de SALIDA del kardex (tipo salida-por-nota) SOLO para los renglones de AVÍO, en UNA transacción (A2) — R4/MEJORAS §03: el consumo de avíos va ligado a las notas; los renglones de TELA quedan ligados a su salida-a-orden según la semántica decidida, con validación explícita de NO doble descuento (la misma tela/lote/orden no puede tener salida-a-orden Y salida-por-nota)
- backend/src/dominio: cancelar/reversar nota como movimiento inverso auditado (D3) — reversa solo los movimientos de avíos que la nota generó; la captura nueva es 100% estructurada; el texto libre solo existe como legacy migrado
- backend/src/api: rutas de notas con permisos; OpenAPI regenerado + cliente sincronizado
- Pantalla: captura estructurada de nota — maquilero + renglones (orden + avío del catálogo con cantidad/unidad, o tela/lote tomada de las salidas-a-orden registradas) — reemplaza Notas/NotasSub
- Pantallas: consulta por nota y consulta por orden de producción — reemplazan NotasVer(Sub) y NotasOrd(Sub)
- Impreso R9: PDF de nota de salida a maquilero (referencias viejas NotasImp/NotaEntImp)

**Entregables:**
- Migración Prisma de notas + secuencia NumNota
- Servicios con TSDoc (citan 03-Produccion.md §Notas de Salida, 04-Inventarios.md §'Cómo conecta', MEJORAS §03, R4, A2/A3) + tests unitarios e integración (folio consecutivo, descuento exacto de AVÍOS al confirmar, atomicidad, reverso, y test de integración ANTI-DOBLE-DESCUENTO: registrar salida-a-orden de una tela y luego incluirla en una nota → la existencia baja UNA sola vez)
- Rutas REST + tests; openapi.json + esquema.gen.ts sincronizados
- 3 pantallas según patron-crud.md + tests Vitest
- PDF de nota de salida con test
- DECISIONES.md actualizado con la semántica de telas-en-nota cerrada con Daniel

**Criterio de cierre:**
- CI verde y review aprobado
- Confirmar una nota descuenta del kardex exactamente los AVÍOS capturados, en una sola transacción (A2/D3)
- Test anti-doble-descuento en verde: ninguna tela puede descontarse dos veces (salida-a-orden + nota) para la misma orden
- Folio NumNota por secuencia, consecutivo bajo concurrencia (A3)
- La captura nueva no permite renglones sin material de catálogo o sin salida-a-orden referenciada (descripcionLegacy es solo de ETL)
- Checklist de Gabriel confirmado

**Verificación de Gabriel:**
- [ ] docker compose up -d --build; entrar como admin; debe haber existencia de avíos y telas (sembrada en E1/E3)
- [ ] Registrar primero una salida de tela a una orden (pantalla de E1) y anotar la existencia resultante de esa tela
- [ ] Crear una nota de salida: maquilero + un renglón de avío (ej. 620 pzas de cierre) + el renglón de tela referenciando esa salida-a-orden; confirmarla
- [ ] Verificar en Inventarios: la existencia del AVÍO bajó exactamente lo capturado con movimiento 'salida por nota' y el folio de la nota; la existencia de la TELA quedó IGUAL que después de la salida-a-orden (NO bajó otra vez) — esta es la prueba del no-doble-descuento
- [ ] Crear una segunda nota y comprobar el folio NumNota consecutivo
- [ ] Abrir 'Notas por orden de producción': ambas notas aparecen bajo su orden, con avíos y telas enviadas
- [ ] Cancelar/reversar la primera nota → la existencia del avío regresa vía movimiento inverso visible (nada se borra); la tela no se mueve (su salida-a-orden sigue viva)
- [ ] Intentar capturar un renglón sin elegir material del catálogo (o tela sin salida-a-orden) → la pantalla y el API deben rechazarlo
- [ ] Descargar el PDF de la nota y compararlo contra el formato viejo de referencia

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI del mismo grupo)

**Referencias:**
- Documentacion_MJD/04-Inventarios.md §'Cómo conecta' (la tela SALE del inventario ligada a la orden vía Salidas.IdOrdenes y se ENVÍA a maquila vía Notas — la nota no es la que descuenta la tela)
- Documentacion_MJD/03-Produccion.md §'Submódulo — Notas de Salida (Menú 3.4)' (Notas/NotasDet, 11,459 renglones de texto libre, mejora clave: estructurar)
- Documentacion_MJD/MEJORAS.md §03 (notas estructuradas contra el catálogo de Habilitación: avío + cantidad + unidad)
- Documentacion_MJD/REQUISITOS-NUEVOS.md §R4 (consumo de AVÍOS ligado a notas) y §R9
- PLANMAESTRO.md §5 módulo 5 ('notas de salida estructuradas que descuentan avíos')
- Aplican: A1, A2, A3, A7, A9, D3, R4, R9

---

## F4-E6 · ETL + cuadre de existencias, documentación de módulos y cierre de fase — ⬜ pendiente

**Objetivo:** Migrar el histórico de la fase (OC, notas, entradas/salidas de telas con lotes legacy sintetizados y traspasos detectados), cuadrar existencias v1 vs v2 listando diferencias para decisión, documentar los módulos en docs/modulos/ y verificar el criterio de salida completo en el ambiente de prueba. Es la última etapa por regla 6.

**Alcance:**
- backend/migracion (ETL idempotente, re-ejecutable, por lotes, latin-1, ventana de 10 años, reusando los servicios del dominio — plan §7). ⚠️ Los CSV traen saltos de línea EMBEBIDOS en los textos libres: leerlos con parser CSV real (los conteos de abajo son de registros CSV, no de líneas físicas — wc -l da otros números)
- ETL OrdCompra (7,978) + OrdCompraDet (18,163) + OrdCom-Ord (19,600) → OrdenCompra/Linea/N:N, con descripciones de renglón como descripcionLegacy SIN mapear a catálogo, migrando autorización (Autorizado/IdUsuAutorizado/FechaAutorizado), cancelaciones, y el mapeo de encabezado definido en E2: Observaciones→observaciones, CorrespondeA→correspondeA, FacturasAmparadas→facturasAmparadasLegacy, Totales NO se migra (derivado de líneas)
- ETL Notas (4,712) + NotasDet (11,459) → NotaSalida/Linea con Descripcion como descripcionLegacy, SIN impacto retroactivo a inventario (no se parsea el texto libre); solo las notas nuevas descuentan kardex
- ETL Entradas (8,017) / EntradasDet (11,041) y Salidas (16,525) / SalidasDet (22,734) con CLASIFICACIÓN previa (verificada en el VBA de ITelas_TransferAlmSub.txt): (a) PARES DE TRASPASO legacy — Entrada con Factura='Transferencia' + su Salida gemela SIN IdOrdenes y con Referencia de almacén — se detectan y migran como movimientos tipo 'traspaso' (salida+entrada pareadas), NO como recepción ni salida-a-orden; (b) entradas de compra → movimientos de entrada DIRECTOS al kardex SIN crear RecepcionCompra (el viejo no tiene liga entrada↔OC — encabezado real: IdEntradas, Fecha, Factura, Referencia, IdTela; RecepcionCompra queda solo para operaciones v2 — decisión documentada en el doc de módulo/nota ADR); (c) salidas con IdOrdenes → movimientos de salida ligados a la orden; (d) salidas restantes sin clasificar → se listan en el reporte para decisión, no se inventa liga
- Transformación clave §7: ExTela1/ExTela2 → Lote + LoteComponente identificando componentes con Telas.Texto1/Texto2 (Felpa/Cardigan); lotes legacy SINTETIZADOS según la regla cerrada con Daniel (por entrada/factura o por tela×color), incluyendo dónde queda el precio que hoy vive en TelasColores.Precio (en v2 el costo va en el movimiento)
- Cuadre TelasColAlm (113,219): SUM(entradas−salidas) vs ExTela1/ExTela2 almacenados; las diferencias (esperables por los saldos mantenidos con GotFocus/LostFocus) se LISTAN para decisión de Daniel/Gabriel y se cargan como movimiento de ajuste inicial documentado — jamás se 'arreglan' en silencio (plan §7)
- Avíos: sin histórico que migrar (R4 es nuevo) → arranque en cero o conteo físico inicial capturado como ajuste de entrada con la pantalla de E1
- Reporte de cuadre obligatorio que imprime, para CADA tabla, el conteo FUENTE leído del CSV en esa corrida + el conteo destino migrado + lo excluido por la ventana de 10 años + el desglose de traspasos detectados + suma de existencias v1 vs v2 + lista de diferencias — Gabriel compara reporte-vs-reporte entre corridas, no contra cifras escritas a mano en el plan
- Documentación de módulo al cierre: docs/modulos/compras-mrp.md y docs/modulos/inventario-telas-avios.md (cómo quedó construido, referenciando Documentacion_MJD/, ADR-0002; incluye la decisión 'entradas legacy sin RecepcionCompra' y la semántica salida/nota de telas)
- Registrar en Documentacion_MJD/DECISIONES.md todas las decisiones cerradas con Daniel durante la fase (autorización/edición de OC, genéricos en explosión, semántica de telas en notas, lotes legacy, variantes de impresos)
- Verificación funcional completa del criterio de salida de F4 en el ambiente de prueba (Railway `prueba` si ya existe, o docker compose local): el tablero reemplaza el drive manual

**Entregables:**
- Scripts de ETL en backend/migracion con tests (fixtures reales recortados de los CSV — incluyendo un PAR de traspaso Entrada 'Transferencia'+Salida sin orden, y un texto con salto de línea embebido — + corrida doble probando idempotencia)
- Reporte de cuadre generado (conteos fuente leídos del CSV + migrados + excluidos + traspasos detectados + existencias v1 vs v2 + diferencias listadas) como artefacto consultable
- docs/modulos/compras-mrp.md y docs/modulos/inventario-telas-avios.md
- DECISIONES.md actualizado con lo cerrado con Daniel
- CI verde con la migración aplicable en limpio + suite completa de la fase (unit + integración + E2E) en verde

**Criterio de cierre:**
- ETL corre dos veces seguidas con los CSV reales sin duplicar nada (idempotencia probada comparando los dos reportes: mismos conteos)
- Reporte de cuadre revisado: conteos fuente vs migrados explicados (incluyendo lo excluido por la ventana de 10 años y los pares de traspaso detectados) y CADA diferencia de existencias listada con su decisión registrada
- Los traspasos legacy quedaron como movimientos 'traspaso' (ninguna RecepcionCompra falsa creada desde Entradas con Factura='Transferencia'); las entradas legacy de compra NO crearon RecepcionCompra
- Las OC y notas legacy NO generaron movimientos retroactivos de kardex
- Demo del flujo completo en el ambiente de prueba aprobada por Gabriel: el tablero 'qué tengo / qué falta' responde lo que hoy responde el drive manual (criterio de salida F4, plan §6)
- Docs de módulo publicadas y PR de la fase mergeada a prueba con CI verde

**Verificación de Gabriel:**
- [ ] Desde backend/: correr el comando documentado del ETL (ej. npm run migrar -- --dominio=compras-inventarios) contra 'Respaldo CLAUDE/TABLAS/'; correrlo una SEGUNDA vez y comparar los DOS reportes entre sí: mismos conteos, cero duplicados
- [ ] En el reporte, verificar que el conteo FUENTE leído de cada CSV coincide con lo esperado de los archivos reales: OC 7,978; renglones de OC 18,163; ligas OC↔orden 19,600; notas 4,712; renglones de notas 11,459; entradas 8,017/11,041; salidas 16,525/22,734; TelasColAlm 113,219 (registros CSV, no líneas físicas) — y que el reporte desglosa lo excluido por la ventana de 10 años y cuántos pares de traspaso detectó
- [ ] Spot-check de traspasos: buscar en el kardex v2 una entrada legacy con Factura='Transferencia' del CSV → debe aparecer como movimiento de TRASPASO pareado (no como recepción de compra), y su salida gemela no debe estar ligada a ninguna orden
- [ ] Revisar con Daniel la lista de diferencias de existencias (TelasColAlm vs SUM de movimientos) y aprobar los ajustes iniciales ANTES de que se apliquen
- [ ] Spot-check en la UI: buscar una OC vieja conocida y compararla contra el CSV/Access (proveedor, fechas, autorización, observaciones/corresponde-a, facturas amparadas como legacy, renglones como texto legacy); repetir con una nota vieja
- [ ] Verificar acentos y eñes correctos en descripciones migradas (latin-1 bien leída, CLAUDE.md §4)
- [ ] Confirmar en el kardex que las notas/OC legacy no movieron inventario retroactivamente
- [ ] En el ambiente de prueba: demo completa de punta a punta — orden → explosión → generar OC → autorizar desde el celular → recibir con lote de 2 componentes → tablero en verde → nota de salida que descuenta avíos y documenta telas; capturar pantallas de cada paso
- [ ] Veredicto final del criterio de salida: operar unos días el tablero con órdenes reales y confirmar que ya no hace falta abrir el drive manual

**Equipo:** 2 coders en paralelo (pieza A: ETL de compras + notas — OrdCompra*/Notas* / pieza B: ETL de telas — Entradas/Salidas con clasificación de traspasos + lotes legacy + cuadre TelasColAlm) + 1 reviewer. Las piezas son independientes de verdad: CSVs fuente y entidades destino disjuntos; comparten solo el runner de migración que ya existe desde F1. Los docs de módulo los reparte el lead entre ambos

**Referencias:**
- PLANMAESTRO.md §7 (migración: idempotente, ExTela1/2→LoteComponente, ventana 10 años, reporte de cuadre, diferencias se listan no se arreglan) y §6 (criterio de salida F4)
- Respaldo CLAUDE/Respaldo CLAUDEFormularios/ITelas_TransferAlmSub.txt (VBA del traspaso viejo: par Salida sin IdOrdenes + Entrada con Factura='Transferencia' — base de la detección de pares)
- Respaldo CLAUDE/TABLAS/ — conteos de registros CSV verificados: OrdCompra 7,978; OrdCompraDet 18,163; OrdCom-Ord 19,600; Notas 4,712; NotasDet 11,459; Entradas 8,017; EntradasDet 11,041; Salidas 16,525; SalidasDet 22,734; TelasColAlm 113,219
- Documentacion_MJD/04-Inventarios.md §'Observaciones para la modernización' obs. 1 (descuadres esperables por GotFocus/LostFocus, existe IPT_Revision)
- Documentacion_MJD/03-Produccion.md §Notas de Salida (confirma 11,459 renglones)
- Documentacion_MJD/DECISIONES.md §D5 (estructura destino de lotes)
- CLAUDE.md §4 (encoding latin-1 de los CSV) y docs/ESTADO-DESPLIEGUE.md (estado del ambiente de prueba en Railway)
- Aplican: D3, D5, A2, A7, R4 (avíos arrancan en cero), plan §8 (docs de módulo al cierre)

---

## Notas de la fase (supuestos del diseño)

SUPUESTOS: (1) F1 entregó Proveedor/Tela/Avio + AvioProveedor (R1) con presentación — si el FACTOR de conversión presentación→unidad de consumo no quedó capturado en F1, se agrega el campo en E1 junto con el motor de conversión (el factor convierte cantidades Y precios: E3 lo usa para el costoUnit); (2) F1 entregó el BOM con bandera paraProduccion (R2) y F2 entregó Orden/OrdenLinea/OrdenLineaTalla con folio — sin eso E4 no puede arrancar; (3) Avio.esGenerico se verifica en E1 y se agrega ahí si F1 no lo incluyó; (4) el runner de ETL existe desde F1 (plan §6: 'migración desde F1'); (5) pg-boss NO quedó montado en F0 (sus motores fueron kardex, secuencias, auditoría, permisos, R2): se monta por primera vez en E3 (cola sobre el mismo Postgres + patrón outbox) como pieza propia del alcance. SEMÁNTICA SALIDA-vs-NOTA (anti doble descuento, fija para toda la fase): la TELA se descuenta UNA sola vez con registrarSalidaTelaAOrden (E1, Salidas.IdOrdenes como en el sistema real); la nota de salida (E5) descuenta AVÍOS (R4, PLANMAESTRO §5) y para telas es documento de envío que referencia la salida — con validación y test de integración que impiden el doble descuento (04-Inventarios.md §'Cómo conecta'). COSAS DEL INVENTARIO QUE PERTENECEN A OTRA FASE: el inventario de PT (IPT) y el recibo de maquila son de F3; el inventario cíclico (D6) opera sobre PT y queda FUERA de F4 — aunque el patrón de ajuste por conteo físico que E1 establece para telas/avíos le servirá de base; el CONSUMIDOR del evento 'material-recibido' (auto-avance de la RC) es de F5 — aquí solo se monta la infraestructura (pg-boss/outbox en E3), se define el contrato y se emite; Pedidos.IdOrdCompra es la orden de compra DEL CLIENTE hacia FR Moda (módulo Pedidos, F2), entidad totalmente distinta de la OC a proveedor — no tocar; los catálogos (proveedores, telas, avíos, maquileros, almacenes) y su ETL son de F0/F1: F4 solo los consume. DECISIONES A CERRAR CON DANIEL ANTES DE LA ETAPA QUE LAS USA (registrar en DECISIONES.md, no improvisar): reglas de autorización/edición de OC y si la recepción exige OC autorizada (antes de cerrar E2/E3); comportamiento de los genéricos esGenerico en la explosión — ¿descuentan existencia disponible en lugar de generar compra? (antes de E4; no sobre-diseñar un MRP de reabastecimiento que el negocio no usa); SEMÁNTICA DE TELAS EN LAS NOTAS (antes de E5): confirmar el default 'la nota referencia la salida-a-orden sin segundo movimiento' o permitir que la nota dispare la salida cuando no exista — en ambos casos con candado anti-doble-descuento; regla de síntesis de lotes legacy (¿por entrada/factura o por tela×color?) y destino del precio de TelasColores.Precio (antes de E6); variantes de impreso de OC que sobreviven y si la exportación a Excel sigue haciendo falta (antes de cerrar E2). ETL — CIFRAS Y CLASIFICACIÓN (verificadas contra los archivos reales): los conteos del plan son REGISTROS CSV leídos con parser (los textos libres traen saltos de línea embebidos; contar líneas físicas con wc -l da números inflados — p. ej. NotasDet: 11,459 registros vs 29,113 líneas); el cuadre de Gabriel es reporte-vs-reporte entre corridas, no contra cifras a mano; los traspasos legacy existen como pares Entrada(Factura='Transferencia')+Salida(sin IdOrdenes) — confirmado en el VBA de ITelas_TransferAlmSub.txt — y se migran como movimientos 'traspaso'; las entradas legacy de compra NO crean RecepcionCompra (el viejo no liga entrada↔OC). PARALELISMO: E2 (OC) no depende de E1 (no escribe kardex hasta E3) — si conviene acortar calendario, E1 y E2 pueden correr con dos equipos en paralelo (módulos disjuntos inventarios/compras, coordinando solo el orden de migraciones Prisma); el desglose las deja secuenciales para que Gabriel verifique una etapa a la vez. CONTINGENCIA E1: es la etapa más cargada; si se atora, el mismo equipo entrega backend primero y pantallas+PDF como cierre de la propia etapa (no se parte formalmente ni queda nada a medias entre etapas). COORDINACIÓN CON F3 (corre en paralelo desde F2, plan §6): la salida de tela a orden vive en F4-E1 (es inventario), y el evento de corte vive en F3 — definir al arrancar ambas fases la referencia cruzada para no duplicar captura; los maquileros (destino de las notas E5) son catálogo de F1. RENDIMIENTO: el estatus R7 se implementa como consulta/vista on-demand y solo se materializa con pg-boss si la medición lo exige (plan §11) — la captura nunca espera un recálculo. R2 menciona consumo por talla/color 'cuando aplique': la explosión E4 arranca con consumo por prenda × total de la orden; si el BOM de F1 ya soporta consumo diferenciado por talla, explosionarOrden lo respeta — verificar al iniciar E4 qué entregó F1 exactamente.
