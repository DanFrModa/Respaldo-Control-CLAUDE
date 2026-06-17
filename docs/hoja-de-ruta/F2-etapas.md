# F2 — Pedidos + Órdenes · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Entrega de la fase (plan §6):** Módulo 3 (pedido interno + pedido real) y órdenes de producción con matriz color×talla ilimitada (D4) y referencias del cliente buscables (D7).
> **Criterio de salida:** Un pedido fluye hasta su orden; impreso de orden.
> **Estado:** ✅ **FASE F2 COMPLETA (5/5)** — `F2-E1` ✅ (en `prueba`, PR #46) · `F2-E2` ✅ (en `prueba`, PR #48) · `F2-E3` ✅ (en `prueba`, PR #50) · `F2-E4` ✅ (en `prueba`, PR #52) · `F2-E5` ✅ (17-jun-2026, verificada por Gabriel; reviewer independiente APROBADO). Pendiente operativo de Gabriel: commit → PR a `prueba` → corrida del ETL en Railway.

## F2-E1 · Pedidos internos + Pedidos Reales (vertical completo) — ✅ 16-jun-2026 (en `prueba`, PR #46)

> **Cierre F2-E1 (16-jun-2026).** Entregado el vertical completo: 4 tablas (`Pedido`/`PedidoLinea`/`PedidoReal`/`PedidoRealLinea`) con migración a mano; dominio crear/actualizar/copiar/cancelar pedido + crear/seguir/editar pedido real (réplica automática de renglones); folio por **secuencia atómica por empresa** (A3); operaciones multi-tabla en **transacción** (A2); **bitácora** en cada mutación (A7); RBAC `pedidos.ver/administrar/importes` + `pedidos-reales.administrar` (A4, este último kebab con módulo propio). **Importes ocultos server-side** (el JSON no trae `precio` sin permiso) con **defensa al editar** (no se pisan precios reales — bloqueante detectado en review y corregido, con test int). **Snapshots `V1` de solo lectura** `idOrdCompraV1`/`entregadoParcialV1`/`cantFaltanteV1` (D3; los puebla el ETL de E5). Frontend lista+detalle responsive con copiado multi-renglón en un clic y captura/edición de pedidos reales. **Decisiones:** Pedido Real sin folio propio (se identifica por `numPedReal`); migración Prisma redactada a mano (sin BD local) y verificada campo×campo por el reviewer. **DIFERIDO pendiente de Daniel:** la política de cancelación del **Pedido Real** (no se construyó servicio/ruta/UI/campo `cancelado`; solo un TODO) — confirmar antes de retomarla. **Trampa de la fase (aplica a futuras):** cada etapa que agregue un módulo o sub-vista al menú debe actualizar las aserciones e2e — aquí `login.spec` (`toHaveCount` 13→**15**: 13 módulos del plan + 2 sub-vistas de F1-E5) y el link 'Modelos' que chocaba con 'Galería de modelos' (fix `exact:true`). **CI:** backend/frontend/imágenes-docker en verde; e2e 30/31 (solo el flaky crónico de galería de bordados, ajeno a F2). Construido por coder + reviewer independiente (1 bloqueante + 3 menores, todos corregidos). **No se hizo corte de contingencia E1a/E1b** (el equipo absorbió el vertical doble).

**Objetivo:** Construir el módulo de Pedidos de punta a punta (esquema→dominio→API→UI) replicando el patrón CRUD de F0. Va primero porque es el inicio del flujo del criterio de salida (un pedido fluye hasta su orden) y porque la Orden de E2 cuelga del renglón de pedido (FK idPedidoLinea).

**Alcance:**
- Tablas Prisma: Pedido (cliente, folio por secuencia por empresa A3, fechaPedido, fechaDe/fechaHasta, fechaTela, fechaElaboracion, entregadoTienda, noProducir, pedCancelado, idEmpresa A9, auditoría A7, y idOrdCompraV1 — dato migrado de Pedidos.IdOrdCompra 'Orden de compra ligada' (02 §2), con valor real en 233 de 1,529 pedidos; SIN FK hasta que OrdCompra exista en F4, solo se conserva y se documenta), PedidoLinea (idModelo, cantidadPedida, precio snapshot; entregadoParcialV1/cantFaltanteV1 — nombre inequívoco de SNAPSHOT MIGRADO de solo lectura, sin endpoint de escritura: NO son saldo vivo, su derivación real desde EntregasCliente llega en F3 y los reemplaza, espíritu D3), PedidoReal (numPedReal del cliente, cedis, apertura — texto libre en F2, fechaPedPR, fechaInicio/fechaFin, fechaEntregadaReal, auditoría), PedidoRealLinea (idPedidoLinea, cantidadPR, cantidadEnviada, cantidadEntregadaReal, empaques — captura manual en F2, en F3 cambia de fuente)
- Secuencia folioPedido POR EMPRESA con el motor existente backend/src/comun/secuencias.ts (A3; reemplaza AumentarNumPed = Max()+1 global, 02 §4.1)
- Servicios backend/src/dominio/pedidos/: crearPedido y actualizarPedido (encabezado+renglones en UNA transacción A2, valida cliente y modelos activos), copiarPedido (clona pedido + renglones SELECCIONADOS en un clic y una transacción; folio nuevo de la secuencia — NO se replica la rareza v1 de NumeroPed=0), cancelarPedido (cancelación suave pedCancelado + auditoría; deja el estado que crearOrden validará en E2), crearPedidoReal (réplica automática de un renglón por cada renglón del pedido interno, 02 §4.4), actualizarSeguimientoPedidoReal (enviada/entregadaReal/fechaEntregadaReal por renglón), cancelarPedidoReal (política v2 asumida: inmutable pero con cancelación suave auditada bajo permiso — CONFIRMAR con Daniel antes de arrancar)
- Endpoints REST backend/src/api/pedidos/ (Zod→OpenAPI): CRUD de pedidos con paginación/búsqueda de servidor, POST /api/pedidos/{id}/copiar, POST /api/pedidos/{id}/cancelar, rutas anidadas de pedidos reales
- Permisos RBAC nuevos en el catálogo (A4): pedidos.ver, pedidos.administrar, pedidos.importes (ver importes $ — hoy ocultos a nivel 45+, 02 §3), pedidosReales.administrar (hoy nivel ≤60); el ocultamiento de precios/importes se aplica EN EL SERVIDOR: los esquemas Zod de respuesta omiten precio/importes si la sesión no tiene pedidos.importes
- Pantallas frontend/src/modulos/pedidos/ (patrón docs/modulos/patron-crud.md): lista de pedidos con filtros básicos, captura/edición con grid de renglones (modelo con foto desde R2, cantidad, precio), copiado con selección múltiple de renglones en UN clic (MEJORAS 02, reemplaza el MsgBox por renglón), cancelación con relabel 'Cancelado', pantalla de Pedidos Reales por pedido (alta que replica renglones + captura CEDIS/apertura/fechas + seguimiento por renglón). La LISTA de pedidos y la CONSULTA de pedidos reales heredan el responsive del patrón CRUD de F0 y deben ser usables en móvil (regla 10: captura en PC, consultas también en móvil)
- OpenAPI regenerado (backend/openapi.json) + cliente tipado frontend/src/api/esquema.gen.ts sincronizado en la misma etapa

**Entregables:**
- Migración Prisma de las 4 tablas + seed de permisos nuevos
- Servicios de dominio con TSDoc (referencia a 02-Pedidos.md y a D#/A# que implementan)
- Tests unit + integración (testcontainers): folios por empresa sin colisión bajo concurrencia, copiado transaccional de renglones seleccionados, réplica automática del pedido real, respuesta del API SIN precios para usuario sin pedidos.importes, cancelación suave
- Pruebas de componente (Vitest) de las pantallas + E2E Playwright: crear pedido → copiar con selección múltiple → crear pedido real
- openapi.json regenerado y esquema.gen.ts del frontend sincronizado (compila sin errores)

**Criterio de cierre:**
- CI verde y visto bueno del reviewer independiente
- Folio de pedido por empresa: test de concurrencia sin duplicados (A3)
- Test de integración que demuestra que el JSON de respuesta NO contiene precio/importes sin el permiso pedidos.importes (A1/A4 server-side, no solo CSS)
- Copiado de N renglones y alta de pedido real en UNA transacción cada uno (A2)
- entregadoParcialV1/cantFaltanteV1 no son escribibles por ningún endpoint y su nombre/TSDoc los marca como snapshot migrado que F3 reemplaza (espíritu D3)
- idOrdCompraV1 existe en el modelo como dato conservado (sin FK) — ninguna columna v1 con datos se descarta sin decisión registrada
- Lista de pedidos y consulta de pedidos reales usables en viewport móvil (regla 10)
- E2E del flujo pedido→copiado→pedido real en verde

**Verificación de Gabriel:**
- [ ] Correr `docker compose up -d --build` y entrar a http://localhost:8080 como admin
- [ ] Menú Pedidos → crear un pedido con 3 renglones usando modelos reales de F1; anotar el folio y crear otro pedido: el folio debe ser consecutivo (misma empresa)
- [ ] Copiar el primer pedido seleccionando solo 2 de los 3 renglones en un clic → abrir el pedido nuevo y comparar que trae exactamente esos 2 renglones con modelo/cantidad/precio
- [ ] Cancelar un pedido → debe verse el badge 'Cancelado' y seguir consultable (no se borra)
- [ ] Desde el pedido, crear un Pedido Real → verificar que se replicó automáticamente un renglón por cada renglón del pedido; capturar CEDIS y cantidades enviada/entregada
- [ ] En Administración (F0) crear un usuario de prueba SIN el permiso de importes, entrar con él y abrir el mismo pedido: no deben verse precios ni totales $; abrir las devtools del navegador (pestaña Red) y confirmar que el JSON tampoco los trae
- [ ] Abrir la lista de pedidos y la consulta de pedidos reales desde el celular (o devtools en modo móvil) y confirmar que son usables
- [ ] Abrir http://localhost:8080/api/docs y verificar que aparecen las rutas nuevas de pedidos documentadas

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI sobre archivos compartidos: schema.prisma, contrato, app.ts — no se paraleliza). Etapa calibrada al límite superior (vertical doble Pedido + PedidoReal): si a medio camino no se absorbe, está PREVISTO el corte de contingencia E1a (pedido interno completo) / E1b (pedidos reales + seguimiento) — ambos verticales, la fase quedaría en 6 etapas dentro del límite de 3-7; lo decide el lead al planear la tarea, no se improvisa después

**Referencias:**
- Documentacion_MJD/02-Pedidos.md — COMPLETO (§1 dos niveles de pedido, §2 modelo de datos — incluye IdOrdCompra 'Orden de compra ligada', §3 pantallas y niveles, §4 reglas de negocio del código — §4.1 AumentarNumPed, §4.4 réplica del pedido real, §6 observaciones para la modernización)
- Documentacion_MJD/00-Arranque-Login-y-Menu.md — ocultamiento de importes a nivel 45+ (nivVentas)
- Documentacion_MJD/MEJORAS.md — módulo 02 (copiado en un clic 🟡, secuencia atómica 🔴, conservar Pedido interno vs Pedido Real ✅)
- Decisiones: A1, A2, A3, A4, A7, A9, D3 (espíritu: saldos derivados — por eso el sufijo V1 en los snapshots migrados), D8; R8 (NO construir, solo no cerrarle la puerta al diseño)
- docs/modulos/patron-crud.md (patrón de pantalla a replicar, incluye responsive) y backend/src/comun/secuencias.ts (motor A3 de F0)
- Código viejo de referencia del QUÉ: Respaldo CLAUDE/Respaldo CLAUDEFormularios/Pedidos.txt, PedidosRealesVer.txt (leer en latin-1, CLAUDE.md §4)
- BLOQUEANTE antes de arrancar: confirmar con Daniel la política v2 de cancelación del Pedido Real (en v1 era 'imposible de borrar', 02 §4.4)

---

## F2-E2 · Órdenes: datos + dominio + API (matriz D4 + referencias D7 + folios A3) — ✅ 16-jun-2026 (en `prueba`, PR #48)

> **Cierre F2-E2 (16-jun-2026).** Entregado el backend completo de Órdenes (corte horizontal datos+dominio+API). **5 tablas:** `Orden` (con sus **34 columnas mapeadas 1:1** contra `Ordenes.csv`; la tabla de mapeo vive en el TSDoc de `ordenes.ts` = contrato del ETL de E5) + enum `EstadoOrden`, `OrdenLinea`, `OrdenLineaTalla`, `OrdenReferencia` (con índice para búsqueda D7), `OrdenComentario`; migración redactada a mano (sin BD local). **Dominio** `produccion/ordenes.ts`: crearOrden (autorrelleno modelo/cliente/empresa desde el renglón de pedido; **exige** renglón y rechaza pedido `pedCancelado`/`noProducir`), guardarMatrizOrden (**estado `completa` + `fechaCompletada` derivados al primer guardado de matriz con líneas, sin marcado manual** — paridad v1 `FechaDet`), copiarDetalleOrden (mapeo de tallas por etiqueta), cancelarOrden (motivo obligatorio), guardarReferenciasOrden (valida que el ClienteCampo sea del cliente de la orden), agregarComentarioOrden, buscarOrdenes (combinada: folio/modelo/cliente/empresa/año/estado + valor de referencia D7). **Total SIEMPRE derivado por suma** (sin columna `total`, D4/D3); color único por orden; tallas del catálogo; folio por **secuencia por empresa** (A3); todo en transacción (A2) + bitácora (A7); RBAC `ordenes.ver/administrar/cancelar` (A4). `idMaquilero` → FK a `Proveedor` (fusión de terceros; en F2 solo asignación, sin validar rol). **9 endpoints REST** (PATCH encabezado; PUT matriz/referencias = reemplazo de set completo; POST acciones) + OpenAPI regenerado + cliente del frontend sincronizado (compila). **Script de datos demo** (`npm run demo:ordenes`, idempotente) + **guía** `backend/src/api/produccion/VERIFICACION-F2-E2.md` (cuerpos JSON listos para Swagger). **Decisiones (Gabriel, 16-jun-2026):** (1) UPC eliminado — sin `generarUPC` ni algoritmo; `upc` queda solo como dato histórico de lectura; (2) orden sin pedido = solo histórico — la captura nueva la rechaza, la FK `idPedidoLinea` es nullable solo para el ETL. **Campos-dato de F3/F5/F6 persistidos sin FK ni motor** (idTipoArticuloRC, idRcAplicaciones, idRcTipoTelas, fechas RC, enRiesgo, siRC, rcViva, maquilaOrd, aplicacionOrd, pagada) + `tallasV1` (cadena cruda) + `upc`. **Review en 2 cortes** (esquema+dominio, luego API): aprobado con 0 bloqueantes; 2 menores corregidos — M1 `PUT`→`PATCH` del encabezado (consistencia con Pedidos), M2 documentada la **trampa de los folios centinela** del demo para E5 (borrar los pedidos demo antes de sembrar las secuencias, o el `MAX(folio)+1` se contamina). **CI:** sin cambio de menú (la entrada 'Producción' ya existía gated `autenticado`; la UI de órdenes es E3). 306 tests unit en verde + tests de integración para CI. Construido por 1 coder + 1 reviewer independiente. **Verificado por Gabriel en `prueba`** vía Swagger (deploy con `SEED_ON_START=true` + `npm run demo:ordenes`), 16-jun-2026.

**Objetivo:** Construir TODO el backend de órdenes de producción: el modelo normalizado D4 (OrdenLinea+OrdenLineaTalla), referencias del cliente D7 indexadas, folios atómicos, estado derivado, comentarios y búsqueda. Corte horizontal deliberado (excepción permitida por §9/regla 3): este dominio es el motor de la fase, F3 cuelga de él (dimensiones del WIP), y conviene que el frontend de E3 consuma un API ya estable y testeado.

> **Ajustes confirmados por Gabriel (16-jun-2026) — SOBREESCRIBEN los bullets de abajo donde haya conflicto:**
> 1. **UPC de orden: NO se construye `generarUPC`.** Los códigos de barra de orden ya no se usan (Gabriel los va a retirar). Se ignora todo lo que el alcance/criterios/verificación dicen sobre replicar `SacarUPC`, el algoritmo EAN-13 y validar contra los 524 UPC reales. La columna `upc` se conserva SOLO como dato histórico de solo lectura (string nullable, sin endpoint de escritura ni generación) para que el ETL de E5 tenga destino y no se tire dato en silencio (plan §7). *Por qué: Gabriel confirma que esa funcionalidad está muerta.*
> 2. **Orden sin pedido: SOLO HISTÓRICO.** `crearOrden` EXIGE un renglón de pedido (rechaza la orden sin pedido con error de validación claro). La FK `idPedidoLinea` queda **nullable a nivel BD** únicamente para que el ETL de E5 migre los 26 casos históricos en modo histórico; la captura nueva nunca crea órdenes huérfanas. *Por qué: decisión de negocio de Gabriel.*

**Alcance:**
- Tabla Orden con destino EXPLÍCITO para las 34 columnas de Ordenes.csv (regla: ninguna columna con datos reales se pierde en silencio — plan §7). Mapeo columna v1 → v2: IdOrdenes→id (mapeo del ETL), Numero→folio (secuencia por empresa A3), IdPedidosDet→idPedidoLinea (OPCIONAL y N:1 — datos reales verificados: 26 órdenes sin pedido [25 con IdPedidosDet=0 + 1 vacío, el '0' es el 'sin pedido' de Access] y resurtidos de máximo 2 órdenes por renglón), IdModelos→idModelo, IdMaquileros→idMaquilero (solo asignación; el flujo de maquila es F3), IdEtiquetasM→idEtiquetaMarca, IdClientes→idCliente, IdTelasDis→idTela (tela/diseño de F1), Fecha→fecha, FechaEntrega→fechaEntrega, Observaciones→observaciones, Tallas→se DESPIVOTA a OrdenLineaTalla en el ETL (+ columna de trazabilidad tallasV1 con la cadena cruda, solo lectura), MaquilaOrd→maquilaOrd (dato, motor F3/F6), NoCost→noCostear, Monarch→OrdenReferencia D7 (E5), OrdCancelada+MotivoCancelada→estado 'cancelada'+motivoCancelada, IdEmpresas→idEmpresa (A9), UPC→upc, IdCP_Articulos→idTipoArticuloRC (dato F5), IdRC_Aplicaciones→idRcAplicaciones (dato F5, 1,263 órdenes con valor), IdRC_TipoTelas→idRcTipoTelas (dato F5, 1,263), FechaInicioRC→fechaInicioRC / FechaEntregaRC→fechaEntregaRC / FechaProg→fechaProg (datos F5), EnRiesgo→enRiesgo (dato F5), SI_RC→siRC (dato F5, 2,292 con valor), FechaDet→fechaCompletada (5,444 órdenes con fecha — NO se pierde el cuándo; ver estado), Composicion→composicion + CompForzada→compForzada, Pagada→pagada (dato F6), ObsMaquila→obsMaquila, AplicacionOrd→aplicacionOrd (dato F3/F6: precio de estampado/aplicación, contraparte del flujo A de maquilaOrd — 2,548 órdenes con valor >0), RC_Viva→rcViva (dato F5, 472 con valor). Los campos-dato de F3/F5/F6 se persisten SIN motor en F2
- Estado de la orden (capturada/completa/cancelada) DERIVADO, no manual: regla v1 verificada en OrdenesDet.txt Form_BeforeInsert — FechaDet se sella automáticamente al insertar el primer renglón del detalle. En v2: guardarMatrizOrden marca la orden 'completa' y sella fechaCompletada en el primer guardado de matriz con líneas; 'incompleta' = orden sin matriz capturada (base confiable de la vista de E4). NO existe servicio de marcado manual; si Daniel quisiera un override manual sería decisión de negocio NUEVA a registrar, no un supuesto
- Tablas OrdenLinea (idOrden, idColor — FK al catálogo Color de F1, ya no texto libre; color único por orden) y OrdenLineaTalla (idOrdenLinea, idTalla, cantidad entera ≥0); el total de la orden SIEMPRE derivado por suma, jamás columna editable (D4 + espíritu D3)
- Tabla OrdenReferencia (idOrden, idClienteCampo, valor) con ÍNDICE dedicado para búsqueda global (D7)
- Tabla OrdenComentario (idOrden, usuario, fecha, comentario inmutable — form viejo ComentaOrd)
- Secuencia folioOrden por empresa con backend/src/comun/secuencias.ts (reemplaza AumentarNumOrd = Max()+1)
- Servicios backend/src/dominio/produccion/ (con TSDoc): crearOrden (desde renglón de pedido con AUTORELLENO de modelo/cliente/empresa — comportamiento de IdPedidosDet_AfterUpdate; rechaza renglones de pedidos cancelados/noProducir; permite N órdenes por renglón y orden sin pedido; transacción con sus líneas A2), actualizarOrden, guardarMatrizOrden (upsert de OrdenLinea+OrdenLineaTalla con validaciones: color no repetido, tallas del catálogo, cantidades enteras ≥0; deriva estado 'completa' + fechaCompletada en el primer guardado con líneas; cambios a Bitacora A7 — órdenes son entidad crítica según plan §4), copiarDetalleOrden (copia la matriz completa de otra orden mapeando tallas por etiqueta — CopiarDetallesOrd), cancelarOrden (suave, motivoCancelada OBLIGATORIO + Bitacora), guardarReferenciasOrden (D7: cada valor debe corresponder a un ClienteCampo ACTIVO del cliente de la orden), agregarComentarioOrden, buscarOrdenes (combinada: folio interno, modelo, cliente, empresa, año, estado y CUALQUIER valor de OrdenReferencia), generarUPC (réplica EXACTA del algoritmo SacarUPC de Funciones 2.txt: 12 dígitos [UPCEmp de la empresa + Monarch/referencia] ponderados impar×1/par×3 + verificador 10−(total mod 10) → código de 13 dígitos estilo EAN-13 con prefijo 750 — NO etiquetarlo ni implementarlo como UPC-A, que invierte la ponderación y fallaría contra los datos reales; validar contra los 524 UPC reales de Ordenes.csv; fuente del dato en v2 según lo confirmado con Daniel)
- Endpoints REST backend/src/api/produccion/: CRUD de órdenes, PUT matriz, POST copiar-matriz, POST cancelar, PUT referencias, POST comentarios, GET búsqueda, POST generar-upc; permisos RBAC: ordenes.ver, ordenes.administrar, ordenes.cancelar (A4 en cada ruta)
- Script de datos demo (seed de desarrollo, NO de producción) que deja creadas órdenes de muestra colgadas de los pedidos de E1 — con matriz, referencia D7 y una cancelada — para que la verificación de Gabriel sea de LECTURA, más una guía de verificación con los cuerpos JSON exactos listos para copiar/pegar en Swagger para quien quiera probar escrituras
- OpenAPI regenerado + cliente esquema.gen.ts del frontend sincronizado (regla 7, aunque la UI llega en E3 — el front debe compilar)

**Entregables:**
- Migración Prisma de las 5 tablas (Orden con las columnas-dato de F3/F5/F6 enumeradas en el mapeo de 34 columnas) + secuencia + índice de OrdenReferencia + permisos en el seed
- Tabla de mapeo columna-v1→destino-v2 de Ordenes.csv (las 34) publicada en el TSDoc/README del dominio — es el contrato que E5 ejecuta y contra el que cuadra
- Servicios de dominio con TSDoc citando 03-Produccion.md paso 2, D4, D7, A2/A3/A7
- Tests unit + integración (testcontainers): folios de orden concurrentes por empresa, matriz con totales derivados correctos, color duplicado rechazado, talla fuera de catálogo rechazada, copiado de matriz entre órdenes con curvas distintas (mapeo por etiqueta), referencia con ClienteCampo de OTRO cliente rechazada, búsqueda por valor de referencia, orden desde pedido cancelado/noProducir rechazada, orden sin pedido permitida, estado 'completa'+fechaCompletada derivados automáticamente en el primer guardado de matriz (y NO antes), UPC validado contra los 524 casos reales de Ordenes.csv, cambios de matriz registrados en Bitacora
- Script de datos demo + guía de verificación para Gabriel (cuerpos JSON listos para copiar/pegar y los IDs sembrados)
- openapi.json regenerado + esquema.gen.ts regenerado (frontend compila)

**Criterio de cierre:**
- CI verde y aprobación del reviewer
- Checklist de las 34 columnas de Ordenes.csv: cada una con destino v2 en el esquema o exclusión JUSTIFICADA y registrada — el reviewer lo verifica contra la tabla de mapeo (ninguna columna con datos queda sin destino)
- Ninguna columna 'total' persistida/editable: el total de la orden solo existe como suma derivada (D4/D3)
- El estado 'completa' es derivado por guardarMatrizOrden (con fechaCompletada), no existe endpoint de marcado manual (paridad con la regla v1 verificada)
- crearOrden + guardarMatrizOrden + copiarDetalleOrden cada uno en UNA transacción (A2), verificado en tests
- Cambios de matriz y cancelaciones visibles en Bitacora (A7)
- La búsqueda por OrdenReferencia usa el índice (verificado con EXPLAIN en un test de integración o en la revisión)
- generarUPC reproduce los 524 UPC reales (test contra Ordenes.csv)
- Toda la lógica (autorelleno, UPC, validaciones, folios, derivación de estado) vive en backend/src/dominio — cero lógica en rutas (A1, lo verifica el reviewer)
- Contrato OpenAPI regenerado y el frontend compila con el cliente nuevo

**Verificación de Gabriel:**
- [ ] Correr `docker compose up -d --build` y correr el script de datos demo con el comando que deja documentado el coder (aún no hay UI de órdenes — la verificación es de lectura sobre datos ya sembrados, sin redactar JSON a mano)
- [ ] Abrir Swagger UI en http://localhost:8080/api/docs, autenticarse y usar GET /api/ordenes: las órdenes demo deben venir con modelo/cliente/empresa autorellenados desde el renglón de pedido de E1 y folios consecutivos por empresa
- [ ] Hacer GET de la orden demo con matriz y comparar el total derivado contra el total anotado en la guía (p. ej. 120); confirmar que esa orden aparece como 'completa' con su fechaCompletada (se derivó sola al cargar la matriz)
- [ ] Con los cuerpos listos para copiar/pegar de la guía: intentar crear una orden desde el renglón del pedido CANCELADO en E1 → debe responder error de validación con mensaje claro; e intentar registrar una referencia D7 con el ClienteCampo de OTRO cliente (ID en la guía) → error
- [ ] GET /api/ordenes?busqueda=<valor de la referencia demo de la guía> → debe encontrar la orden
- [ ] Comparar el UPC de la orden demo contra un UPC real de Ordenes.csv indicado en la guía (mismo algoritmo, dígito verificador igual)
- [ ] Abrir la pantalla de Bitácora (Administración, F0) y confirmar que los cambios de matriz del script demo quedaron auditados con usuario y fecha

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API dentro del mismo servicio; comparte schema.prisma y contrato — no se paraleliza). Por tamaño, el reviewer revisa en dos cortes: modelo+dominio primero, API después

**Referencias:**
- Documentacion_MJD/03-Produccion.md — Paso 2 (Orden de producción: tablas Ordenes/OrdenesDet y campos clave) y 'Observaciones para la modernización' puntos 1-2
- Documentacion_MJD/DECISIONES.md — D4 (modelo OrdenLinea/OrdenLineaTalla detallado) y D7 (ClienteCampo + OrdenReferencia)
- Documentacion_MJD/MEJORAS.md — A1, A2, A3, A6 (T1..T8 → detalle), A7, A9
- PLANMAESTRO.md §4 'Estructuras nuevas clave' (tallas ilimitadas D4 y campos de referencia D7 — el modelo objetivo) y §7 (ninguna pérdida de datos en silencio — de ahí el mapeo de 34 columnas)
- Código viejo (el QUÉ, leer en latin-1): Respaldo CLAUDE/Respaldo CLAUDEFormularios/Ordenes.txt (AumentarNumOrd, IdPedidosDet_AfterUpdate, CopiarDetallesOrd, Monarch_LostFocus, Generar_Click: UPC = SacarUPC(UPCEmp, Monarch), ComentaOrd), OrdenesDet.txt (Form_BeforeInsert: FechaDet = Now() automática — la regla del estado derivado) y Respaldo CLAUDEModulos/Funciones 2.txt (SacarUPC: ponderación impar×1/par×3, estilo EAN-13)
- Datos reales para tests: Respaldo CLAUDE/TABLAS/Ordenes.csv (34 columnas; 26 órdenes sin pedido; 524 UPC) y OrdenesDet.csv (latin-1)
- BLOQUEANTE RESUELTO (Gabriel, 16-jun-2026): (1) el UPC de orden NO se conserva como función — los códigos de barra ya no se usan y están en retiro; NO se construye `generarUPC`; la columna `upc` se migra como dato histórico de solo lectura. (2) Orden sin pedido = SOLO HISTÓRICO: la captura nueva exige renglón de pedido; la FK es nullable solo para los 26 casos que migra el ETL en modo histórico. Ver el recuadro de ajustes al inicio de F2-E2

---

## F2-E3 · Frontend de órdenes: componente MatrizColorTalla + captura completa — ✅ 16-jun-2026 (en `prueba`, PR #50)

> **Cierre F2-E3 (16-jun-2026).** Entregado el frontend completo de Órdenes (corte vertical de UI sobre el API de E2). **Componente reutilizable `frontend/src/componentes/matriz-color-talla/`** (presentación pura, A1; pensado para reuso en F3/F6): filas = colores, columnas = tallas de la curva del modelo + tallas extra fuera de curva; **totales en vivo** por fila/columna/orden; **captura por teclado** (Tab/Enter/flechas — una fila completa sin tocar el mouse; se resolvió el `selectionStart === null` de los `<input type=number>`); modo `soloLectura`; responsive; **README con el contrato de props** y guía de reuso. **Pantalla `frontend/src/modulos/ordenes/`** (lista+detalle, espejo de Pedidos, reusa `ListaDetalle`): alta eligiendo pedido→renglón con **autorrelleno** de modelo/cliente/empresa; editor de encabezado (PATCH); la matriz (`PUT .../matriz`); **copiar matriz de otra orden**; **referencias D7 dinámicas** (solo los `ClienteCampo` ACTIVOS del cliente de la orden); comentarios inmutables; **cancelar con motivo obligatorio**; badge de estado **DERIVADO** del backend (sin botón "marcar completa"). Hooks TanStack (`api/ordenes.ts`) calcando `api/pedidos.ts`, alias de tipos del contrato, ruta `produccion/ordenes` y entrada de menú "Órdenes" (gated `ordenes.ver`). **Decisión aplicada (Gabriel, 16-jun-2026):** **NO se construyó botón "Generar UPC"** — el UPC está en retiro; `upc` solo se muestra como dato histórico de lectura si viene poblado (la ficha de abajo lo menciona; quedó obsoleto). **Pruebas:** de componente (matriz: totales en vivo, teclado, talla fuera de curva, color duplicado, solo-lectura, matriz grande) y de pantalla (lista/vacío/error, acciones por permiso, referencias D7 por cliente, badge derivado, cancelar exige motivo) + **E2E** del flujo de la fase (pedido→orden→matriz→copiar→referencia D7→cancelar; el E2E **siembra un `ClienteCampo`** y captura/asevera la referencia, no la salta). **Trampa de la fase (cumplida):** agregar la entrada "Órdenes" al menú obligó a actualizar los conteos en `catalogo.test.ts` y en el e2e `login.spec.ts` (15→16). **Cambio menor de infraestructura UI:** `ListaDetalle.tsx` ganó la prop opcional `ocultarAccionesBase` (el detalle de la orden edita el encabezado en el cuerpo y cancela con diálogo de motivo, no encaja en los botones Editar/Desactivar genéricos; los consumidores existentes no la pasan → sin cambio). **Review independiente: APROBADO** (0 bloqueantes, 0 menores; 2 NIT corregidos — typo y que el E2E ejercite de verdad D7). **CI:** typecheck/lint/format/build/test del frontend en verde; única falla de `npm test` = `DialogoProveedor.test.tsx` (flaky preexistente por contención en la corrida paralela, pasa 11/11 en aislado, ajeno a la etapa). Construido por 1 coder + 1 reviewer independiente. **Verificado por Gabriel en `prueba`**, 16-jun-2026.

**Objetivo:** Construir EL componente clave de la fase — la matriz color×talla ilimitada (D4) — como componente independiente y reutilizable (F3 lo reusa en corte, envíos, recibos y entregas), y la pantalla de captura/edición de orden completa consumiendo el API de E2.

**Alcance:**
- Componente independiente frontend/src/componentes/matriz-color-talla/: filas = colores, columnas = tallas de la curva del modelo con opción de agregar tallas fuera de curva; totales por fila/columna/orden EN VIVO; captura rápida con teclado (Tab/Enter/flechas entre celdas, sin obligar al mouse); rendimiento aceptable con órdenes de muchas líneas; responsive; API del componente pensada para reuso en F3 (recibe colores/tallas/cantidades, emite cambios — sin lógica de negocio, A1)
- Pantalla de captura/edición de Orden frontend/src/modulos/ordenes/: selección de pedido→renglón con autorelleno visible de modelo/cliente/empresa (el backend lo resuelve), encabezado (fechas, etiqueta de marca, tela asignada, maquilero, composición + compForzada, observaciones, obsMaquila), fotos del modelo desde R2, la matriz, botón 'Copiar matriz de otra orden' en un clic, campos de referencia del cliente DINÁMICOS según los ClienteCampo del cliente (D7 — solo se ofrecen los de ese cliente), botón generar UPC, panel de comentarios (agregar + ver bitácora de comentarios), cancelar con motivo obligatorio. El estado 'completa' NO se marca a mano: la pantalla muestra el badge capturada/completa/cancelada que deriva el backend (al guardar la primera matriz con líneas la orden pasa sola a 'completa', paridad v1)
- Hooks TanStack Query (frontend/src/api/ordenes.ts) para todos los endpoints de E2, siguiendo el patrón de capas de patron-crud.md
- Entrada del módulo Producción/Órdenes en el layout, gobernada por permisos ordenes.ver/administrar
- Captura pensada para PC (regla 10: la captura es PC; las consultas móviles llegan en E4)

**Entregables:**
- Componente matriz-color-talla con pruebas de componente dedicadas (Vitest + Testing Library): totales en vivo por fila/columna/total, navegación completa con teclado, agregar talla fuera de curva, color duplicado bloqueado en UX (el backend re-valida), render con matriz grande
- Pantalla de orden con pruebas de componente (estados carga/vacío/error, acciones ocultas sin permiso, referencias dinámicas por cliente, badge de estado derivado)
- E2E Playwright del flujo de la fase: crear pedido (E1) → crear orden desde un renglón → capturar matriz (la orden pasa a 'completa' sola) → copiar matriz a otra orden → capturar referencia D7 → cancelar una orden con motivo
- README breve (o TSDoc de cabecera) del componente matriz: contrato de props y guía de reuso para F3

**Criterio de cierre:**
- CI verde y aprobación del reviewer
- El componente matriz NO contiene reglas de negocio: solo presentación y UX; toda validación real la hace el backend (A1, lo verifica el reviewer)
- Una fila completa de la matriz se captura solo con teclado, sin tocar el mouse
- Los campos de referencia mostrados son EXACTAMENTE los ClienteCampo activos del cliente de la orden (D7)
- El estado mostrado es el derivado del backend (no hay botón de 'marcar completa')
- E2E pedido→orden→matriz→referencia en verde
- El componente queda documentado para su reuso en F3

**Verificación de Gabriel:**
- [ ] Correr `docker compose up -d --build`, entrar a http://localhost:8080 y abrir Producción → Órdenes
- [ ] Crear una orden eligiendo el pedido de E1 y un renglón → comprobar que modelo, cliente y empresa se llenan solos
- [ ] Capturar la matriz: 3 colores × las tallas de la curva del modelo; verificar que los totales por fila, por columna y de la orden cambian en vivo mientras tecleas; agregar una talla fuera de la curva y verificar que entra al total
- [ ] Guardar la matriz y verificar que la orden pasa SOLA de 'capturada' a 'completa' (badge), sin botón de marcado manual — igual que el sistema viejo
- [ ] Capturar una fila completa SOLO con teclado (Tab/Enter/flechas) — debe fluir sin tomar el mouse
- [ ] Crear una segunda orden y usar 'Copiar matriz de otra orden' → comparar que las cantidades quedaron idénticas
- [ ] Verificar que los campos de referencia que aparecen son los del cliente de la orden (cambiar a una orden de otro cliente y ver que cambian); capturar el No. de pedido del cliente
- [ ] Generar el UPC con el botón y agregar un comentario; recargar la página y confirmar que el comentario quedó con tu usuario y fecha
- [ ] Cancelar una orden: el sistema debe exigir el motivo y la orden debe quedar marcada (no borrada)

**Equipo:** 1 coder + 1 reviewer (la pantalla depende del componente matriz — cadena, no se paraleliza; el coder construye primero el componente con sus pruebas y luego la pantalla)

**Referencias:**
- Documentacion_MJD/DECISIONES.md — D4 (la matriz es el patrón único que F3 reusa en TODAS las etapas del WIP) y D7 (UI muestra solo los campos del cliente)
- Documentacion_MJD/03-Produccion.md — Paso 2 (subform OrdenesDet: columna Total calculada, utilidades de copiado NuevoReg/Copiar_Click)
- docs/modulos/patron-crud.md — capas del frontend, permisos, accesibilidad, tema claro/oscuro, pruebas
- Decisiones: A1 (cero lógica en el frontend — el estado lo deriva el backend), A4 (acciones ocultas por permiso pero decisión real en el backend)
- Código viejo de referencia del comportamiento: Respaldo CLAUDE/Respaldo CLAUDEFormularios/Ordenes.txt, OrdenesDet.txt (FechaDet automática) y ComentaOrd.txt (latin-1)
- Riesgo del inventario: usabilidad de captura rápida con teclado y rendimiento con órdenes grandes — es EL componente de la fase

---

## F2-E4 · Consultas, tableros, búsqueda global e impreso de orden (R9) — ✅ 16-jun-2026 (en `prueba`, PR #52)

> **Cierre F2-E4 (16-jun-2026).** Cerrada la operación diaria de Órdenes. **Impreso de orden (R9)** en PDF **server-side** con `@react-pdf/renderer` (PRIMER PDF de servidor del repo; el de barras de F1-E5 era de cliente): `GET /api/ordenes/:id/impreso` (individual) y `POST /api/ordenes/impresos` (lote → **un solo PDF consolidado**, una orden por página). El PDF lleva encabezado (folio, fechas, cliente, etiqueta, maquilero, modelo+descripción+composición, observaciones), **hasta 3 fotos** del modelo desde R2 (best-effort: foto faltante NO truena), la **matriz color×talla** con totales por fila/columna/orden (cuadran con `totalPiezas`) y secciones **TELAS** (`paraProduccion`), **BORDADOS** (sin precio) y **HABILITACIÓN** = avíos del BOM (`paraProduccion`), todo de la receta del modelo de F1. **Decisiones del dueño (Gabriel, 16-jun):** la hoja es de PISO de producción → **SIN precios/costos** (ni precio de bordados, ni `maquilaOrd`/`aplicacionOrd`/`maquilaBase`) y **SIN UPC/código de barra** (en retiro); lote = un PDF consolidado. El impreso se genera con solo `ordenes.ver` (review detectó y se corrigió que NO dependiera de `modelos.ver`: se extrajo `leerFotosModelo` de bajo nivel). **Consultas (proyecciones LIGERAS, NO reusan el listado pesado de E2):** `GET /api/ordenes/consulta` (filtros cliente/año/modelo/estado/canceladas/búsqueda + paginación de servidor; `totalPiezas` por agregado SQL, sin traer la matriz), `GET /api/ordenes/incompletas` (estado='capturada' = sin matriz; **semáforo derivado en backend**: verde ≤3d / amarillo 4–7d / urgente >7d desde `creadoEn`, paridad `EsUrgente`), `GET /api/ordenes/tablero/pedidos-por-mes` (agregado por mes, forma EXTENSIBLE para columnas de avance de F3 sin rehacerlo; banderas entregadosTienda/noProducir aceptadas sin efecto en F2 y documentadas), `GET /api/ordenes/buscar` (**buscador global** ligero: folio/modelo/valor de OrdenReferencia D7, tope 20, excluye canceladas; reusa `armarBusqueda` de E2). **Frontend (PC + móvil):** vista de consulta con filtros + selección múltiple → imprimir (lote por fetch→blob, individual por window.open; los binarios PDF van fuera del cliente tipado), pantalla de incompletas con semáforo, tablero pedidos-por-mes con saltos a la consulta filtrada/pedidos reales, **buscador global en el header** (`CascaronSistema`), y los botones a proceso/OC/notas/costos como **stubs deshabilitados** (F3/F4/F7). 3 entradas de menú nuevas gated `ordenes.ver` (conteos 16→19 en `catalogo.test.ts` y `login.spec.ts`). **Sin permisos nuevos** (todo `ordenes.ver`) → **sin re-seed**; **sin migración** (E4 es solo lectura + PDF). **Construido por 2 coders en PARALELO con límites de archivos declarados** (pieza A = `dominio/produccion/impresos/**` + `impresos.rutas.ts`; pieza B = consultas + todo el frontend + integración), único punto de contacto el contrato del impreso; **reviewer independiente APROBADO** (0 bloqueantes; 1 menor [dependencia oculta de `modelos.ver` en el impreso] + 3 nits, todos cerrados). **CI local en verde:** backend 333 unit + typecheck/lint/build; frontend 40 (módulos E4 + adyacentes) + typecheck/lint/build. El demo `npm run demo:ordenes` siembra DEMO-D (orden con `creadoEn` −10 días) para ver el semáforo URGENTE. **Verificado por Gabriel en `prueba`, 16-jun-2026.** **Sigue: F2-E5** (ETL de pedidos y órdenes + cierre de fase F2).

**Objetivo:** Cerrar la operación diaria de F2: consulta/lista unificada de órdenes con impresión individual y por lote (R9), órdenes incompletas con semáforo, búsqueda global por referencia D7 en el layout, y tablero 'Pedidos por mes'. El impreso va aquí (no al final) porque pertenece a este grupo funcional (forms viejos ListaOrdenes/ImprimirOrdenes/OrdImp*), cumpliendo la regla 5.

**Alcance:**
- Backend — impreso R9 (pieza A): servicio impresoOrden en backend/src/dominio/produccion/impresos/ con @react-pdf/renderer (PDF en el servidor, plan §1): encabezado (folio, fechas, cliente, etiqueta de marca, maquilero, modelo+descripción+composición, observaciones, fotos del modelo), MATRIZ color×talla con totales por fila/columna/orden, sección TELAS desde el BOM del modelo de F1 (bandera paraProduccion), sección BORDADOS desde el BOM, sección HABILITACIÓN según decisión confirmada con Daniel (supuesto de trabajo: imprime el BOM de habilitación del modelo de F1 rotulado como tal; la habilitación POR ORDEN con cantidades llega con la explosión R3 en F4); la variante con CORTE (OrdImp_Cor) queda explícitamente para F3
- Backend — endpoints de impresión (pieza A): GET /api/ordenes/{id}/impreso (PDF individual) y POST /api/ordenes/impresos (lote: N órdenes seleccionadas → un PDF por orden o consolidado, form viejo ImprimirOrdenes)
- Backend — endpoints de consulta (pieza B): lista de órdenes con filtros de servidor (cliente/empresa/año/modelo/estado/canceladas), órdenes incompletas (estado derivado 'capturada' = SIN matriz capturada, paridad con FechaDet Is Null de v1 + antigüedad con regla EsUrgente >7 días — confiable porque el estado es derivado, no depende de que alguien acuerde marcarlo), tablero pedidos-por-mes (filtros mes/año/cliente/empresa/cancelados/entregados-tienda/no-producir; respuesta diseñada para CRECER con columnas de avance corte/entregas en F3 sin rehacer el endpoint — riesgo del inventario), y la búsqueda global ya construida en E2 expuesta para el layout
- Frontend — vista única de órdenes (pieza B, fusión de ListaOrdenes+OrdenVer, rediseño A1/D0): filtros + fotos + acceso al detalle + selección múltiple → imprimir una o varias; los botones viejos a proceso/OC/notas/costos quedan como stubs deshabilitados con leyenda (F3/F4/F7)
- Frontend — pantalla de órdenes incompletas con semáforo de antigüedad (verde/amarillo/URGENTE >7 días)
- Frontend — buscador global en el layout: localiza órdenes por folio interno, modelo o CUALQUIER valor de OrdenReferencia (D7, MEJORAS 'Clientes/Búsqueda' 🔴)
- Frontend — tablero 'Pedidos por mes' con saltos: ver órdenes del pedido (a la vista de órdenes filtrada) y a pedidos reales; links a compras/costos/proceso como stubs hasta F4/F7/F3; nota del viejo: la consulta filtraba EntregadoParcial=No — en F2 ese avance aún no existe, el filtro vivo se documenta para F3
- PC + VISTA MÓVIL para consultas, tablero, incompletas y buscador (regla 10); la captura sigue siendo PC
- OpenAPI regenerado + cliente del frontend sincronizado (UNA sola regeneración al integrar las dos piezas)

**Entregables:**
- Contrato Zod del endpoint del impreso commiteado el DÍA 1 como primer entregable de la pieza A (es el único punto de contacto: B desarrolla el botón Imprimir contra ese contrato tipado)
- Servicio del PDF con tests (estructura/snapshot + caso real con matriz grande: totales del PDF = totales de la orden)
- Endpoints de consulta/tablero/impresión con tests de integración
- Pantallas con pruebas de componente + E2E Playwright: buscar una orden por la referencia del cliente desde el buscador global; descargar el PDF de una orden y el lote de varias
- openapi.json + esquema.gen.ts regenerados (al integrar)

**Criterio de cierre:**
- CI verde y aprobación del reviewer
- El PDF de una orden real contiene la matriz completa y sus totales coinciden con los de la pantalla
- La impresión por lote de N órdenes produce los N documentos
- El buscador global encuentra órdenes por cualquier OrdenReferencia, por folio y por modelo
- Órdenes incompletas lista exactamente las órdenes SIN matriz capturada (estado derivado) y marca URGENTE a >7 días
- Consultas, tablero y buscador usables en móvil (viewport chico)
- La sección de habilitación del impreso quedó según la decisión registrada (no se adelantó alcance de F4)
- Sin conflictos de integración entre las piezas A y B: cada una tocó solo sus archivos declarados (lo verifica el reviewer en el diff)

**Verificación de Gabriel:**
- [ ] Correr `docker compose up -d --build`, abrir la consulta de órdenes y filtrar por cliente y año — la lista debe responder con paginación de servidor
- [ ] Abrir una orden de las capturadas en E3 → Imprimir → revisar el PDF contra la pantalla: folio, fechas, cliente, etiqueta, modelo con fotos, matriz con totales por fila/columna/orden, secciones de telas y bordados del BOM
- [ ] Seleccionar 3 órdenes en la lista → Imprimir lote → verificar que salen los 3 PDFs (o el consolidado, según lo construido)
- [ ] En el buscador global del layout, pegar el No. de pedido del cliente capturado en E3 → debe localizar la orden; probar también por folio interno y por modelo
- [ ] Abrir 'Órdenes incompletas': crear vía la captura una orden SIN guardar matriz → debe aparecer; guardarle la matriz → debe salir de la lista sola; verificar el semáforo (para ver URGENTE, usar el dato de prueba con fecha vieja que el coder deja sembrado)
- [ ] Tablero Pedidos por mes: filtrar por mes/año/cliente, alternar 'ver cancelados' y saltar a las órdenes de un pedido — debe aterrizar en la vista de órdenes ya filtrada
- [ ] Repetir la consulta de órdenes, el buscador global y el tablero desde el celular (o devtools en modo móvil) y confirmar que son usables

**Equipo:** 2 coders en paralelo + 1 reviewer, con LÍMITES DE ARCHIVOS DECLARADOS (regla 4: independencia real, no urgencia). Pieza A (impreso R9): backend/src/dominio/produccion/impresos/** + backend/src/api/produccion/impresos.ts + sus tests — y NADA más del módulo. Pieza B (consultas/tableros/búsqueda): backend/src/api/produccion/consultas.ts + dominio de consultas + todo el frontend de E4. El ÚNICO punto de contacto es el contrato Zod del impreso, que A commitea el día 1 (primer entregable) para que B integre el botón Imprimir contra el tipo, no contra la implementación; el registro de rutas agrega cada pieza su archivo propio y el openapi.json se regenera UNA vez al integrar. Si al planear la tarea no se puede garantizar este no-solape (p. ej. el registro de rutas o el contrato obligan a tocar los mismos archivos), se degrada a 1 coder en secuencia A→B sin cambiar el alcance

**Referencias:**
- Documentacion_MJD/REQUISITOS-NUEVOS.md — R9 (formatos de impresos: usar los actuales como referencia, diseño final con el modelo nuevo)
- Documentacion_MJD/03-Produccion.md — Paso 2 (pantallas OrdenVer/OrdImp)
- Documentacion_MJD/02-Pedidos.md — §3 (tablero PedidosPorMes y sus filtros)
- Documentacion_MJD/MEJORAS.md — 'Clientes/Búsqueda' (búsqueda por nomenclatura del cliente 🔴) y A1/D0 (fusión ListaOrdenes/OrdenVer)
- Decisiones: D7 (búsqueda global), R9, A1/A4 (permisos también en endpoints de consulta e impresión)
- Forms viejos de referencia (latin-1): Respaldo CLAUDE/Respaldo CLAUDEFormularios/OrdImp.txt + OrdImpDet/OrdImpTela/OrdImpHab/OrdImpBor, ImprimirOrdenes.txt, ListaOrdenes.txt, OrdenVer.txt/OrdenVerSub, OrdsIncompletas.txt (función EsUrgente), PedidosPorMes.txt y consulta PedidosPorMesCon
- PLANMAESTRO.md §1 (impresos con @react-pdf/renderer en el backend) y §5 (impresos dentro de la fase de su módulo)
- BLOQUEANTE RESUELTO (Gabriel, 16-jun-2026): la sección HABILITACIÓN imprime los **avíos del modelo** del BOM marcados `paraProduccion` (la habilitación POR ORDEN con cantidades es de F4, R3). Decisiones adicionales del dueño: el impreso es de PISO de producción → SIN precios/costos y SIN código de barra; la impresión por lote es UN PDF consolidado (una orden por página)

---

## F2-E5 · ETL de pedidos y órdenes + documentación + cierre de fase — ✅ 17-jun-2026 (verificada por Gabriel) · CIERRE DE FASE F2

> **CIERRE F2-E5 (17-jun-2026, verificada por Gabriel; reviewer independiente APROBADO con 0 bloqueantes + 3 menores corregidos).** ÚLTIMA etapa de F2 → **cierra la fase**. Migra el histórico real de
> pedidos y órdenes vía un **MODO MIGRACIÓN dedicado en la capa de dominio** (A1): funciones
> `crearPedidoMigrado`/`crearPedidoRealMigrado` (`src/dominio/pedidos/migracion.ts`) y
> `crearOrdenMigrada`/`agregarReferenciasOrdenMigrada`/`crearComentarioOrdenMigrado`
> (`src/dominio/produccion/migracion.ts`). Esas funciones NO se exponen en NINGUNA ruta REST →
> **E1–E4 y el API quedan INTACTOS**. Relajan SOLO las excepciones históricas documentadas (folio
> explícito, sin validar activos, idPedidoLinea NULL, estado/fecha desde el viejo, snapshots V1) y
> siguen siendo **transaccionales (A2)** y **auditadas (A7)** con la auditoría ORIGINAL del viejo
> donde el CSV la trae.
>
> **Orquestador:** `npm run etl:pedidos-ordenes` (`migracion/etl-pedidos-ordenes.ts`). Loaders en
> `migracion/loaders/{pedidos,pedidos-reales,ordenes,comentarios-orden}.ts`. Cadena de carga:
> Pedidos→PedidoLinea (mapea `IdPedidosDet`, **crítico**) → PedidosReales → Ordenes (despivote +
> Monarch) → ComentaOrd → **siembra de secuencias** `pedido`/`orden` por empresa al máximo migrado.
>
> **Reportes:** cuadre en DOS niveles (`npm run etl:cuadre-f2`): (1) filas/sumas + la suma de
> cantidades de matriz v1 (Σ T1..T8) vs v2 (Σ OrdenLineaTalla); (2) checklist columna-v1 → destino-v2
> con no-vacíos por columna para las 7 tablas. Las inconsistencias (colores/tallas creados al vuelo,
> Monarch descartados, órdenes sin pedido, cadenas ambiguas) se LISTAN en el `Reporte` del
> orquestador. **Análisis de tallas** (`npm run etl:analisis-tallas`): catálogo completo de las
> **183 cadenas distintas** de `Ordenes.Tallas` con frecuencia (committeado como fixture
> `__fixtures__/catalogo-tallas-real.json` para los tests, CI-safe).
>
> **Tests:** unitarios (110 en `migracion/`, verdes en local) — parsing posicional contra el
> catálogo COMPLETO de 183 cadenas, doble curva, despivote con cuadre de sumas, normalización de
> color CP850, reglas puras (IdPedidosDet 0/vacío→NULL, Monarch==código→descartado, estado
> histórico), fechas. Integración (`etl-pedidos-ordenes.int.test.ts`, **corre en CI**, no local —
> testcontainers prohibido en la máquina de Gabriel): conteos exactos de fixtures, idempotencia,
> modo migración (folio explícito, idPedidoLinea NULL, estado/fechaCompletada desde el viejo),
> siembra de secuencias post-máximo.
>
> **DESVIACIONES de la ficha original (registradas):**
> - **Encoding = CP850, NO latin-1.** La ficha decía latin-1; el lector real (`comun/csv.ts`, F1-E6)
>   decodifica **CP850** (corregido desde F1). El ETL de F2 reusa ese lector.
> - **UPC EXCLUIDO por decisión (Gabriel, 16-jun-2026).** La ficha pedía normalizar el espacio del
>   `UPC` y re-validar el verificador; **se ANULÓ**: los códigos de barra están en retiro y NO se
>   conserva historial. El ETL **NO migra** `Ordenes.UPC` (`Orden.upc` queda null). En el cuadre de
>   columnas aparece como **EXCLUIDA POR DECISIÓN** (exclusión justificada y registrada, §7), no como
>   columna tirada en silencio. El algoritmo de re-validación NO se usa. **Además, en este mismo
>   cambio se hizo el RETIRO TOTAL de los códigos de barra** (decisión de Gabriel, 16-jun-2026): se
>   ELIMINARON las columnas `Orden.upc` y `Empresa.upc` (migración `20260616140000_retiro_codigos_barra`),
>   el generador de códigos de barra de F1-E5 con su impreso y UI, y el permiso `modelos.codigos-barra`.
> - **Tallas: 183 cadenas distintas** (la ficha estimaba ~184). 8 ambiguas + 17 con doble curva.
> - **Token de talla sin match** (p. ej. `GE` de `"CHM GEX"`, padding perdido): se CREA la talla y se
>   LISTA para Daniel (preserva la cantidad; no se autocorrige la etiqueta). Igual para colores.
> - **Verificada por Gabriel (17-jun-2026).** El ETL es **re-ejecutable**: su corrida sobre los datos reales y el cuadre vs CSV se hacen al desplegar a `prueba` (y de nuevo en F9, al corte). Pendiente operativo: commit → PR a `prueba` → `npm run etl:pedidos-ordenes` en Railway.
>
> **HALLAZGOS para Daniel (al reporte, no autocorregidos):** **26 órdenes sin pedido**
> (`IdPedidosDet` 0/vacío → idPedidoLinea NULL); **~1,415 piezas** en columnas `Tn` con cantidad pero
> SIN etiqueta de talla en `Ordenes.Tallas` (1,307 en 3 órdenes con `Tallas` vacía; 103 con una talla
> de más sobre `"CHM G EX"`; 5 sobre una curva de 7); **8 cadenas ambiguas** + **17 con doble curva**;
> Monarch == código del modelo (~3,212 esperados) descartados como default automático.

**Objetivo:** Migrar los datos reales de pedidos y órdenes (idempotente, cargando a través de los servicios de dominio), sembrar las secuencias después del histórico, documentar los módulos y verificar el criterio de salida de F2 completo (un pedido fluye hasta su orden; impreso de orden).

**Alcance:**
- backend/migracion/ — ETL F2 (TypeScript, CSVs en latin-1 — CLAUDE.md §4): Pedidos.csv (1,529) → Pedido conservando folios viejos NumeroPed, banderas pedCancelado/noProducir/entregadoTienda y IdOrdCompra → idOrdCompraV1 (233 pedidos con valor real; dato sin FK hasta F4, listado en el cuadre); PedidosDet.csv (5,636) → PedidoLinea con EntregadoParcial/CantFalt → entregadoParcialV1/cantFaltanteV1 (snapshot de solo lectura); PedidosReales.csv (161) + PedidosRealesDet.csv (644) → PedidoReal/PedidoRealLinea con CEDIS/Apertura texto libre y la auditoría IdUsuarios/FechaUsuario original
- Ordenes.csv (5,451) → Orden EJECUTANDO la tabla de mapeo de 34 columnas publicada en E2 (es el contrato del ETL): IdPedidosDet ∈ {0, vacío} → NULL (el 0 es el 'sin pedido' de Access — se esperan 26 órdenes sin pedido, listadas en el reporte de cuadre; NO intentar la FK con 0 o truenan 25 órdenes); FechaDet → fechaCompletada + estado='completa' derivado de ella (y 'cancelada' desde OrdCancelada); UPC en 524 órdenes NORMALIZANDO el espacio que mete el Str() de VBA antes del dígito verificador ('750956476088 5' → '7509564760885') y re-validando el verificador con el algoritmo de E2; campos-dato sin motor en F2 cargados tal cual: maquilaOrd/aplicacionOrd/pagada (F3/F6), idTipoArticuloRC/idRcAplicaciones/idRcTipoTelas/fechas RC/enRiesgo/siRC/rcViva (F5); Tallas crudo → tallasV1
- OrdenesDet.csv (9,511) → OrdenLinea + OrdenLineaTalla: DESPIVOTEAR T1..T8 a filas (solo cantidades > 0); reconstruir la etiqueta de cada Tn parseando Ordenes.Tallas en PARES DE 2 CARACTERES (confirmado en código viejo: OrdenesDet Form_GotFocus recorre la cadena con Step ±2; 'CHM G EX'→CH,M,G,EX). DIMENSIÓN REAL: el catálogo completo son ~184 cadenas distintas (las top-30 cubren ~91% de las órdenes pero quedan ~150 cadenas más, cientos de órdenes) — PRIMER paso de la etapa: script que extrae el catálogo completo de cadenas de Ordenes.csv con su frecuencia; definir el manejo de los tokens separadores de doble curva ('-'/'--' y '- ' = cambio de curva, NO talla; 18 cadenas los traen, p. ej. '6 1218--2 3 3X'); los casos ambiguos (p. ej. '2 233445566778' ¿talla infantil?) van a validación con Daniel; match contra CurvaTalla de F1; Color texto libre → normalizar (trim/mayúsculas/acentos latin-1) y mapear al catálogo Color de F1 reportando NO-mapeables (plan §7: se listan, no se corrigen en silencio)
- Ordenes.Monarch → OrdenReferencia con ClienteCampo 'No. de pedido del cliente' (D7), aplicando la decisión confirmada sobre los 3,212 valores que son el default automático = código del modelo (supuesto: migrar solo los ≈2,200 con valor real para no ensuciar la búsqueda)
- ComentaOrd.csv (795) → OrdenComentario con usuario y fecha originales
- Siembra de secuencias folioPedido y folioOrden POR EMPRESA arrancando DESPUÉS del máximo folio migrado de cada empresa (los folios v1 eran consecutivo GLOBAL — riesgo de colisión en el paralelo de F9 si no se siembra bien)
- El ETL carga a través de los servicios de dominio (mismas validaciones que la captura, plan §7) con modo histórico donde aplique: pedidos cancelados/noProducir CON órdenes existentes se migran sin rechazo (la validación nueva aplica a futuro), y la derivación de estado/fechaCompletada respeta la FechaDet original (no se re-sella con la fecha del ETL)
- Reporte de cuadre obligatorio en DOS niveles: (1) filas y sumas — conteos por tabla v1 vs v2 + suma de cantidades por orden v1 (T1..T8) vs v2 (OrdenLineaTalla); (2) COLUMNAS — checklist columna-v1 → destino-v2 con conteo de valores no nulos/no cero por columna en v1 y en v2 para TODAS las tablas migradas (las 34 de Ordenes, las 13 de Pedidos, las 7 de PedidosDet, etc.): así una columna tirada en silencio NO puede cerrar en verde (plan §7). Más listas de inconsistencias (colores no mapeados, curvas no parseables, Monarch descartados, las 26 órdenes sin pedido) para decisión de Daniel
- docs/modulos/pedidos.md y docs/modulos/ordenes.md: cómo quedó cada módulo (modelo, servicios, permisos, pantallas, impreso, componente matriz, decisiones tomadas y referencias a D4/D7/R9; documentar explícitamente que entregadoParcialV1/cantFaltanteV1 e idOrdCompraV1 son datos migrados que F3/F4 reemplazan o ligan)
- Verificación funcional completa del criterio de salida §6 en el ambiente de prueba (Railway env prueba si ya está montado; si no, docker compose local y se anota)

**Entregables:**
- ETL idempotente y re-ejecutable (se volverá a correr en F9 al corte) con tests: idempotencia (dos corridas = mismo estado), parsing de Ordenes.Tallas contra el CATÁLOGO COMPLETO de ~184 cadenas reales extraídas (no una muestra), manejo de separadores '-'/'--', despivote con cuadre de sumas, normalización de colores con casos latin-1, normalización del espacio del UPC con re-validación del dígito verificador, IdPedidosDet 0/vacío → NULL
- Script de extracción del catálogo de cadenas de Tallas con frecuencias (insumo de los tests y de la sesión de validación con Daniel)
- Reporte de cuadre generado (archivo legible) con conteos, sumas, el checklist columna-v1→destino-v2 con no-nulos por columna, y las listas de inconsistencias
- docs/modulos/pedidos.md y docs/modulos/ordenes.md publicados
- README de backend/migracion actualizado con el comando exacto para correr el ETL de F2
- Checklist de cierre de fase ejecutado (criterio §6) y CI verde

**Criterio de cierre:**
- El ETL corre en una base limpia y una SEGUNDA corrida no duplica ni altera nada (idempotencia)
- Cuadre de filas: conteos v1 = v2 por tabla (1,529 / 5,636 / 161 / 644 / 5,451 / 9,511-despivotadas / 795) y suma de cantidades por orden v1 = v2, o diferencia EXPLICADA en el reporte
- Cuadre de columnas: TODAS las columnas v1 de las 7 tablas migradas aparecen en el checklist con destino v2 y conteo de no-nulos v1 vs v2 que cuadra (o exclusión justificada y registrada) — ninguna columna con datos tirada en silencio (plan §7)
- Las 26 órdenes sin pedido quedaron con idPedidoLinea NULL y listadas en el reporte
- Los tests de parsing de Tallas corren contra el catálogo completo de cadenas reales; las no parseables están LISTADAS para decisión — ninguna autocorregida en silencio
- Los UPC migrados quedan sin espacio y su dígito verificador re-validado contra el algoritmo de E2
- Las secuencias de folio arrancan después del máximo migrado por empresa (test que crea un pedido y una orden nuevos sin colisión)
- Criterio de salida de F2 verificado por Gabriel: un pedido fluye hasta su orden y se imprime el PDF
- Documentación de módulo publicada y revisada

**Verificación de Gabriel:**
- [ ] Base limpia: `docker compose down -v` y luego `docker compose up -d --build`; correr el ETL con el comando documentado en backend/migracion/README (el coder lo deja exacto)
- [ ] Abrir el reporte de cuadre y comparar contra los conteos esperados: 1,529 pedidos · 5,636 renglones · 161 pedidos reales · 644 renglones reales · 5,451 órdenes · 795 comentarios · 26 órdenes sin pedido; revisar que el checklist de columnas no tenga ninguna fila en rojo (columna sin destino) y revisar las listas de colores/curvas no mapeados y los Monarch descartados (llevárselas a Daniel para decisión)
- [ ] Correr el ETL una SEGUNDA vez → volver a generar el reporte: los conteos no deben cambiar (idempotencia)
- [ ] Pedir a Daniel el folio de una orden que conozca bien, abrirla en la UI y comparar su matriz color×talla contra el Access/CSV viejo (cantidades por talla) y que su estado/fecha de completada correspondan a la FechaDet original
- [ ] Buscar en el buscador global un No. de pedido del cliente REAL migrado desde Monarch → debe encontrar la orden
- [ ] Crear un pedido NUEVO y una orden NUEVA: sus folios deben ser mayores al máximo migrado de su empresa
- [ ] Flujo completo de cierre (criterio §6): crear pedido → copiarlo → crear pedido real → crear orden desde un renglón → capturar matriz (pasa a 'completa' sola) → referencia D7 → localizarla en el buscador → imprimir el PDF de la orden
- [ ] Si el environment 'prueba' de Railway ya está montado: mergear la rama a prueba y repetir el flujo completo EN VIVO; si no, dejar constancia de la verificación en compose
- [ ] Leer docs/modulos/pedidos.md y docs/modulos/ordenes.md y confirmar que reflejan lo construido

**Equipo:** 1 coder + 1 reviewer (el ETL es una cadena: pedidos→órdenes comparten utilidades de parsing/reporte y el orden de carga importa — las órdenes necesitan los IDs de los renglones de pedido migrados)

**Referencias:**
- PLANMAESTRO.md §7 (migración: idempotente, vía servicios de dominio, reporte de cuadre, inconsistencias se listan) y §6 (criterio de salida de F2)
- CLAUDE.md §4 (encoding latin-1 de TODOS los CSV — leerlos como utf-8 corrompe en silencio)
- Tabla de mapeo de 34 columnas de Ordenes.csv publicada en E2 (contrato del ETL de órdenes)
- Datos reales: Respaldo CLAUDE/TABLAS/Pedidos.csv, PedidosDet.csv, PedidosReales.csv, PedidosRealesDet.csv, Ordenes.csv, OrdenesDet.csv, ComentaOrd.csv
- Código viejo del parsing (latin-1): Respaldo CLAUDE/Respaldo CLAUDEFormularios/OrdenesDet.txt (Form_GotFocus: la cadena Tallas se recorre en pares de 2 con Step ±2 — confirma el despivote)
- Decisiones: D4 (despivote), D7 (Monarch → 'No. de pedido del cliente'), A3 (siembra de secuencias post-máximo por empresa), D3 (saldos snapshot V1 de solo lectura)
- Riesgos del inventario: parsing de Ordenes.Tallas — son ~184 cadenas distintas reales, con separadores de doble curva '-'/'--' (validar cadenas ambiguas con Daniel), curva oculta en LlenarTallas (2º dígito del código de modelo — regla no escrita), colores texto libre con acentos latin-1, espacio del Str() en los UPC
- BLOQUEANTES antes de arrancar: decisión de Daniel sobre (1) migrar o no los Monarch=código de modelo y (2) validación del parsing de las cadenas de talla ambiguas y de los separadores de doble curva (p. ej. '2 233445566778' = talla infantil, '6 1218--2 3 3X')

---

## Notas de la fase (supuestos del diseño)

RESUELTOS por Gabriel (16-jun-2026) para E2 — supuestos (2) UPC y (3) orden sin pedido: el UPC de orden NO se construye (códigos de barra en retiro; columna `upc` solo como dato histórico de solo lectura, sin algoritmo ni validación contra los 524) y la orden sin pedido es SOLO HISTÓRICA (la captura nueva exige renglón de pedido; FK nullable solo para el ETL). Lo demás de abajo sigue vigente.

SUPUESTOS TOMADOS (confirmar con Daniel/Gabriel antes de la etapa que bloquean): (1) Pedido Real: en v1 era 'imposible de borrar' (02 §4.4); se asume política v2 de inmutable + cancelación suave auditada bajo permiso — bloquea E1. (2) UPC: verificado en código que SacarUPC produce un código de 13 dígitos estilo EAN-13 (prefijo 750 = México, ponderación impar×1/par×3), NO UPC-A, y que hoy se genera desde UPCEmp de la empresa + Monarch (Ordenes.txt Generar_Click); se asume que se conserva la réplica exacta como acción opcional, confirmando con Daniel la fuente del dato en v2 (Monarch desaparece como columna: pasa a OrdenReferencia D7) — bloquea E2. (3) Orden sin pedido: se modela FK opcional; dato real verificado: 26 órdenes sin pedido (25 con IdPedidosDet=0, el 'sin pedido' de Access, + 1 vacío) y resurtidos N:1 de máximo 2 órdenes por renglón; confirmar si se permite a futuro — E2. (4) Impreso R9, sección HABILITACIÓN: hoy se imprime desde OrdenesHab (habilitación POR ORDEN, que es la explosión R3 de F4); se asume que en F2 imprime el BOM de habilitación del MODELO (F1) rotulado, y F4 la completa — bloquea E4. (5) Monarch: 3,212 de 5,414 valores son el default automático = código del modelo; se asume migrar solo los ≈2,200 reales para no ensuciar la búsqueda D7 — bloquea E5. (6) CEDIS y Apertura quedan texto libre en F2 (su catalogación, o CEDIS como ClienteCampo D7, se decide después). (7) Referencias D7 a nivel PEDIDO ('podría aplicar también a Pedido', DECISIONES D7): NO en F2; el modelo no lo impide. (8) Impreso de pedido interno/pedido real: NO existe en v1 ni en la lista R9 — no se construye en F2; si Daniel lo quiere, es tarea nueva. REGLAS v1 VERIFICADAS EN CÓDIGO (ya NO son supuestos): el estado 'completa' de la orden es AUTOMÁTICO — FechaDet se sella sola al capturar el primer renglón del detalle (OrdenesDet.txt Form_BeforeInsert); v2 lo replica derivándolo en guardarMatrizOrden (fechaCompletada), sin marcado manual — un override manual sería decisión de negocio nueva. El parsing de Tallas en pares de 2 caracteres está confirmado (Form_GotFocus, Step ±2), pero el catálogo real son ~184 cadenas distintas (no ~30), incluyendo separadores de doble curva '-'/'--'. DATOS CONSERVADOS SIN MOTOR (nada se tira en silencio, plan §7): Pedidos.IdOrdCompra → idOrdCompraV1 (233 pedidos; la FK real llega con OrdCompra en F4); PedidosDet.EntregadoParcial/CantFalt → entregadoParcialV1/cantFaltanteV1 (snapshot de solo lectura; F3 los reemplaza por la derivación desde EntregasCliente — documentado en docs/modulos/pedidos.md); Ordenes: aplicacionOrd (precio de estampado, 2,548 órdenes, motor F3/F6), maquilaOrd/pagada (F3/F6), idTipoArticuloRC/idRcAplicaciones/idRcTipoTelas/fechas RC/enRiesgo/siRC/rcViva (F5), tallasV1 (trazabilidad del despivote). COSAS DEL INVENTARIO QUE PERTENECEN A OTRA FASE (no se metieron a fuerza): OrdenesHab.csv (28,432 filas) y su ETL → F4 con la explosión R3; variante del impreso con corte (OrdImp_Cor) → F3; lógica de RC incrustada en el form de órdenes (cálculo de FechaInicioRC con días hábiles, EnRiesgo) → F5 (en F2 los campos solo se persisten como datos); derivación de EntregadoParcial/CantFalt desde EntregasCliente y la automatización de cantidadEnviada/cantidadEntregadaReal del pedido real → F3; columnas de avance (corte/entregas) del tablero PedidosPorMes → F3 (el endpoint se diseña para crecer); PrecioOrd (precio de maquila) → F3/F6; OrdCompra/Notas de salida → F4; CostoOrd → F7; R8 (importar pedidos de clientes) = Etapa 2, NO se construye, pero el diseño Pedido/PedidoReal + D7 le deja la puerta abierta. DECISIONES DE CORTE: el tablero 'Pedidos por mes' se construye en E4 (no en E1) para que sus saltos a órdenes funcionen; el corte E2/E3 es horizontal a propósito (backend de órdenes primero, frontend después) porque la matriz D4 es el motor de la fase y F3 cuelga de su dominio — excepción prevista por la regla 3, mitigada para Gabriel con el script de datos demo + guía de verificación de E2 (verifica como usuario, sin redactar JSON); E1 va al límite superior y tiene PREVISTO el corte de contingencia E1a/E1b (la fase quedaría en 6 etapas, dentro del límite) si el equipo no lo absorbe; la paralelización de E4 queda condicionada a los límites de archivos declarados (si no se garantiza el no-solape, se degrada a 1 coder); la pantalla de Clientes NO es de F2 (es de F1). ENTREGABLE TRANSVERSAL CLAVE: el componente frontend matriz-color-talla queda documentado para reuso directo en F3 (corte/envíos/recibos/entregas) — si F3 no puede reusarlo tal cual, el diseño falló. El ETL de E5 queda re-ejecutable: F9 lo vuelve a correr al corte, y su contrato es la tabla de mapeo de 34 columnas publicada en E2 (así el esquema y el ETL no pueden divergir en silencio).
