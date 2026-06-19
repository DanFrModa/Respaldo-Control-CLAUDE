# F3 — Producción / WIP · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Entrega de la fase (plan §6):** Corte, envíos/recibos de maquila unificada, servicio transaccional recibo→IPT+EsMa, WIP y entregas a cliente.
> **Criterio de salida:** Una orden recorre todo el ciclo; inventario PT cuadra por kardex.
> **Estado:** 🔄 **EN CURSO (2/6)** — `F3-E1` ✅ (17-jun-2026) y `F3-E2` ✅ (18-jun-2026; reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`). Siguen E3→E6. El desglose se confirmó al arrancar (supuestos verificados: `TipoProceso` ya existía de F1, el motor kardex NO existía — se construyó en E1).
>
> **⚠️ Actualización 14-jun-2026 (fusión de terceros, D12/R15):** ya NO existen los catálogos `Maquilero` ni `Cortador`. Un maquilero/cortador es un **`Proveedor` con su(s) rol(es) de servicio** (`maquila-costura`, `corte`, `estampado`, `bordado`, `lavado`, `aplicacion`). El flujo de maquila de esta fase filtra **proveedores por rol**, NO una tabla `Maquilero` ni "banderas Costura/Proceso"; toda mención de abajo a "maquileros/cortadores" debe leerse así. (No se construyó enlace `Proveedor`↔`TipoProceso`: el servicio se declara con las casillas de rol; `TipoProceso` queda como catálogo independiente para la RC en F5.) El **costo del corte** se define en la orden de producción (no en un catálogo de cortadores). Ver `DECISIONES.md` D12/R15.

## F3-E1 · Modelo de datos F3 + motor kardex genérico + catálogos base — ✅ 17-jun-2026 (verificada por Gabriel; 2 reviewers APROBARON)

> **Cierre F3-E1 (17-jun-2026).** Entregado el **cimiento de toda F3**. **Motor kardex genérico** `backend/src/comun/kardex.ts`: `registrarMovimientoPt` (encabezado+detalle en transacción A2, folio atómico A3 vía `secuencias.ts`, Bitácora A7, `costoUnit` NULL), `registrarTraspasoPt` (salida-origen + entrada-destino en UNA transacción — 2 `Movimiento` con dirección efectiva entrada/salida, NO un movimiento `traspaso`), `cancelarMovimientoPt` (movimiento inverso auditado; nunca edición/borrado), y `bloquearArticuloPt`+`existenciaPtBloqueada` (suma directa de `MovimientoDet` bajo `pg_advisory_xact_lock`, **NUNCA la vista** — base transaccional de "no recibir lo no enviado"/"no entregar lo que no existe" de E4/E5). + `comun/eventos.ts` (despachador best-effort post-commit de corte/envío/recibo-registrado, gancho para la RC de F5, sin consumidores) y `comun/origenes.ts` (constantes de `origenTipo`, el dominio nunca escribe el literal). **Migración aditiva única** `20260617120000_f3_e1_produccion_kardex`: 3 enums + 8 tablas + 1 columna + 1 vista, 100% aditiva (aplica en limpio sobre la BD de `prueba`). `EtapaMovimiento`/`EtapaMovimientoDet` (corte/envío/recibo/entrega; det SIEMPRE color×talla D4; folio A3; cancelación suave + motivo; idEmpresa A9; liga `idEtapaEnvio` nullable). Kardex genérico: encabezado `Movimiento` (referencia polimórfica `origenTipo`+`origenId` sin FK, mismo criterio que ADR-0005; folio A3; idEmpresa A9; `idMovimientoInverso` para cancelaciones) + **un detalle por tipo de artículo** `MovimientoDetPt` (idModelo×idColor×idTalla, `Int`) / `MovimientoDetTela` (idTela×idLote, D5) / `MovimientoDetAvio` (idAvio×idLote + `esGenerico`, R4) — los tres con `costoUnit` nullable. `EsMaCargo` (solo esquema; el flujo en E4). `TipoMovimientoInventario` (catálogo con `direccion` entrada/salida/traspaso). Vista SQL **`existencia_pt`** = Σ `MovimientoDetPt` con signo `entrada +1 / salida −1 / ELSE 0` por modelo×color×talla×almacén (D3, nunca tabla editable). `TipoProceso` extendido con `generaEntradaPt`. **CRUD 'Tipos de proceso'** end-to-end (dominio/rutas RBAC A4/pantalla teal lista+detalle/cliente tipado; la bandera *genera entrada a PT* editable **solo por admin, validado en `dominio`**, no solo deshabilitada en la UI) + GET solo-lectura de `TipoMovimientoInventario`. Seeds idempotentes: 19 `TipoMovimientoInventario` (verificados contra `IPT_TiposMov.csv` leído en **CP850**), 3 almacenes PT (Primeras/Segundas/Tránsito, sin duplicar globales), tipos de proceso con `generaEntradaPt` (costura=true, resto=false). **9 permisos RBAC nuevos** (`tipos-proceso.ver/.administrar`, `produccion.{corte,envio,recibo,entrega,wip-ver,cancelar}`, `inventario-pt.{ver,mover}`, `esma.cargo-validar`) asignados a roles. **ADR-0010** (motor kardex: referencia polimórfica, extensibilidad un-detalle-por-tipo verificable, regla validaciones-suman-detalle-nunca-la-vista, costoUnit NULL en F3, vista→materializable en E6, eventos, liga reversible). **`costoUnit` NULL en toda F3** (D1/D2; valuación a costo actual en F7). **Decisiones de Gabriel (reversibles, ambas defaults — registradas en `DECISIONES.md`):** (d) liga recibo↔envío = agregado por orden+proceso + campo opcional nullable (sin migración destructiva si Daniel luego quiere amarre por envío); (e) `generaEntradaPt` = solo costura (**Gabriel lo confirma con Daniel ANTES de E4**; cambiarlo es dato, no migración). **Trampa de la fase (aplica a TODA etapa futura que añada columnas a tablas viejas):** agregar una columna con `DEFAULT` a una tabla **ya sembrada en `prueba`** (aquí `tipos_proceso`, nacida en F1-E2) + seed con `upsert(update:{})` deja la fila vieja con el default → en `prueba` costura habría quedado **sin** la bandera, rompiendo la decisión (e) y el criterio de cierre, **aunque los tests en BD limpia pasen** (usan el camino `create`); **fix = backfill `UPDATE … WHERE codigo='costura'` en la migración** (aditivo/idempotente; el seed sigue con `update:{}` para preservar ediciones futuras de admin). Lo cazó el 2º reviewer, no los tests. **Equipo:** 1 coder + 2 reviewers — el 2º **validó el diseño del ADR/esquema ANTES de codear** (extensibilidad contra D5/R4 + liga recibo↔envío), y luego revisó el diff final (halló 2 bloqueantes: el backfill de B1 y una inconsistencia del ADR §5 con el modelo de traspaso viejo) que el 1er reviewer (generalista, APROBADO) no detectó. **CI/checks:** backend `tsc`/eslint/prettier + 350 tests unit verde; frontend `tsc`/eslint + 16 tests verde; integración (kardex: entrada/salida, traspaso atómico, inverso, no-doble-cancelación, folio concurrente A3, costoUnit NULL, dos-renglones-mismo-artículo, rechazo de dirección `traspaso`, suma directa bloqueada=0) y e2e corren en CI con testcontainers. **Verificación en `prueba`:** requiere `SEED_ON_START=true` al desplegar (siembra los 9 permisos + catálogos nuevos).

**Objetivo:** Crear en una sola migración TODAS las tablas de F3 y construir el motor kardex genérico en comun/ (verificado: NO existe en F0 pese a la nota del orquestador — no hay kardex.ts ni modelos Movimiento/MovimientoDet en el repo). Corte horizontal justificado (regla 3): es un motor nuevo del que dependen todas las etapas siguientes; incluye una rebanada vertical verificable (CRUD TipoProceso) para que Gabriel tenga algo que ver.

**Alcance:**
- Tablas Prisma (una migración): TipoProceso (costura/estampado-aplicación/bordado/lavado; crear aquí solo si F1 no lo creó) CON la bandera generaEntradaPt — define por dato qué proceso deja prenda terminada y por tanto si su recibo mete a inventario PT (costura sí; estampado/bordado/lavado no; evidencia del viejo: Recibos.Inventariado solo existe en costura, RecibosEst NO trae esa columna, e IPT_Movs tiene 2,468 entradas tipo 2 'Entrada de Maquila' contra 3 del tipo 3 'Entrada de Aplicación' — decisión (e) de notasFase, la columna nace con el default propuesto y cambiarla es dato, no migración); EtapaMovimiento (idOrden, tipo corte|envio_maquila|recibo_maquila|entrega_cliente, idTipoProceso en envíos/recibos, idTercero, folio por Secuencia A3, precioPactado, cancelación suave + motivo, auditoría A7, idEmpresa A9); EtapaMovimientoDet (SIEMPRE idColor × idTalla × cantidad, D4)
- Tablas kardex (D3, genérico para PT/tela/avío aunque F3 solo use PT): Movimiento (tipoMov, fecha, idAlmacen, referencia polimórfica, folio A3, usuario, idEmpresa); MovimientoDet con dimensiones POR TIPO de artículo según PLANMAESTRO §4 — PT: idModelo × idColor × idTalla (D4); Tela: idTela × idLote (D5); Avío: idAvio × idLote opcional, esGenerico (R4) — implementadas con el mecanismo que fije el ADR (columnas de dimensión nullable con CHECKs por tipo, o tablas de detalle por tipo MovimientoDetPt/MovimientoDetTela/MovimientoDetAvio sobre el mismo encabezado); en F3 solo se ejercita la dimensión PT pero el esquema queda listo para que F4 agregue tela/avío SIN migrar filas existentes ni tocar el núcleo de kardex.ts; cantidad + costoUnit NULLABLE (política F3: queda NULL hasta que F7 defina la valuación, D1/D2 — fijada con test); TipoMovimientoInventario (catálogo con dirección entrada/salida/traspaso)
- Tabla EsMaCargo (FK a EtapaMovimiento de recibo NULLABLE para histórico, idMaquilero, idOrden, cantidadReal, precioReal, idTipoProceso, estado propuesto|validado|cancelado, observaciones, auditoría) — solo el esquema; el flujo llega en E4 (aplica a costura Y estampado: EsMa_Recibos.EsEstampado lo confirma)
- Vista SQL ExistenciaPt: SUM(MovimientoDet) por modelo × color × talla × almacén — nunca tabla editable (D3); nace como vista normal, se materializa en E6 si el volumen migrado lo exige. REGLA FIJADA EN EL ADR: las validaciones transaccionales (no recibir lo no enviado, no entregar lo que no existe) SIEMPRE suman MovimientoDet directo dentro de la transacción y NUNCA leen esta vista — la vista (normal o materializada) es solo para consultas y tableros
- Motor backend/src/comun/kardex.ts: registrar movimiento (encabezado+detalle en transacción A2, folio A3, Bitacora A7), traspaso (salida origen + entrada destino en UNA transacción), movimiento inverso (para cancelaciones auditadas), lectura de existencia consistente DENTRO de transacción con bloqueo — suma de MovimientoDet directo, base de 'no entregar lo que no existe' (E5) y de las validaciones de pendientes (E4)
- backend/src/comun/eventos.ts: despachador mínimo de eventos de dominio (corte-registrado, envio-registrado, recibo-registrado) — solo el gancho para el auto-avance de RC en F5, sin consumidores aquí (PLANMAESTRO §4)
- Seeds idempotentes: 19 tipos de movimiento desde IPT_TiposMov.csv con su dirección, almacenes PT Primeras/Segundas/Tránsito desde IPT_Almacenes.csv (son 3, no 2), tipos de proceso base con su generaEntradaPt (Costura=sí; Estampado/Aplicación, Bordado y Lavado=no)
- Permisos RBAC nuevos en el catálogo (produccion.corte, produccion.envio, produccion.recibo, produccion.entrega, produccion.wipVer, produccion.cancelar, inventarioPt.mover, inventarioPt.ver, esma.cargoValidar) + asignación a roles del seed
- Endpoints + pantalla: CRUD de TipoProceso (patrón Almacenes, docs/modulos/patron-crud.md; la bandera generaEntradaPt visible y editable solo por admin) y GET solo-lectura de TipoMovimientoInventario
- ADR nuevo en docs/arquitectura/: diseño del motor kardex — (1) referencia polimórfica; (2) MECANISMO DE EXTENSIBILIDAD por tipo de artículo (columnas nullable+CHECKs vs tablas de detalle por tipo) con criterio VERIFICABLE: agregar tela/avío en F4 no requiere migrar filas ni cambiar el núcleo de kardex.ts — el segundo reviewer lo valida contra D5 y R4 ANTES de codificar; (3) regla 'validaciones transaccionales suman MovimientoDet, nunca la vista materializada'; (4) política de costoUnit en F3 (NULL hasta F7, D1/D2); (5) vista vs materializada; (6) despachador de eventos; (7) diseño por defecto de la liga recibo↔envío: agregado por orden+proceso con liga opcional nullable (decisión (d) de notasFase — si Daniel no decide antes de la revisión del ADR, este default queda documentado como decisión reversible sin migración destructiva)

**Entregables:**
- Migración Prisma que aplica en limpio + schema.prisma extendido con TSDoc
- backend/src/comun/kardex.ts + eventos.ts con tests unitarios e integración (testcontainers): entrada, salida, traspaso atómico, inverso, folio concurrente, y test que fija la política de costoUnit (las entradas de F3 lo dejan NULL)
- Seeds idempotentes (tipos de movimiento, almacenes PT, tipos de proceso con generaEntradaPt, permisos/roles)
- CRUD TipoProceso end-to-end (API + pantalla) con tests
- openapi.json regenerado + frontend/src/api/esquema.gen.ts sincronizado (regla 7)
- ADR del motor kardex (extensibilidad por tipo de artículo verificable, regla validaciones-vs-vista, política costoUnit, liga recibo↔envío por defecto) y eventos de dominio

**Criterio de cierre:**
- Migración aplica en limpio sobre BD vacía y sobre la BD de prueba existente
- Tests del motor en verde, incluyendo: traspaso que falla a la mitad no deja nada escrito (A2), dos folios concurrentes no chocan (A3) y costoUnit queda NULL en F3 (política del ADR)
- Vista ExistenciaPt devuelve la suma correcta en tests; grep del repo confirma que NINGÚN código hace UPDATE de existencia (D3) y que ninguna validación transaccional lee la vista
- El ADR demuestra la extensibilidad con su mecanismo concreto: el segundo reviewer valida contra D5 y R4 (antes de codificar) que F4 podrá agregar tela/avío sin migrar filas ni tocar el núcleo de kardex.ts
- CRUD TipoProceso operando con permisos verificados server-side (A4)
- CI en verde + visto bueno de los 2 reviewers (incluida la revisión de diseño del ADR previa a codificar)

**Verificación de Gabriel:**
- [ ] Correr `docker compose up -d --build` y confirmar que los 3 servicios levantan
- [ ] Correr `docker compose exec backend npx prisma migrate status` → la migración de F3 aparece aplicada
- [ ] Abrir el CRUD de Almacenes (F0) y confirmar que existen los 3 almacenes PT: Primeras, Segundas y Tránsito
- [ ] Abrir la pantalla nueva 'Tipos de proceso': ver los seedeados (Costura con la marca 'genera entrada a PT' activada; Estampado/Aplicación, Bordado y Lavado sin ella), crear uno de prueba, editarlo y desactivarlo
- [ ] Abrir Swagger UI en /api/docs y ver los endpoints nuevos (tipos-proceso, tipos-movimiento) documentados
- [ ] Correr `docker compose exec backend npm test` (o verlo en el CI del PR) → todos los tests en verde, con los nuevos del motor kardex

**Equipo:** 1 coder + 2 reviewers (el motor kardex es 'tarea grande' según PLANMAESTRO §9.1: el segundo reviewer revisa el diseño del esquema/ADR — en especial la extensibilidad tela/avío contra D5/R4 y la liga recibo↔envío — antes de codificar, y el diff al final)

**Referencias:**
- PLANMAESTRO §4 'Motor de inventario único (D3)' (dimensiones por tipo de artículo: PT/Tela+Lote/Avío), 'Tallas ilimitadas (D4)', 'Maquila unificada' y §9.1
- Documentacion_MJD/04-Inventarios.md §A.1, §A.2 y Observación 1 (existencia editada = descuadres, IPT_Revision)
- Documentacion_MJD/03-Produccion.md Paso 5 (MeterInventario y la bandera Inventariado SOLO en Recibos de costura) y Observación 4 (un solo modelo de proceso de maquila)
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md §3 (EsMa_Recibos.EsEstampado: el cargo aplica a costura y estampado)
- DECISIONES.md D1 (costo actual — política costoUnit), D3, D4, D5 y REQUISITOS-NUEVOS.md R4 (el motor debe quedar listo para telas/avíos de F4); MEJORAS.md A2, A3, A7, A9
- Respaldo CLAUDE/TABLAS/: IPT_TiposMov.csv, IPT_Almacenes.csv, y la evidencia de generaEntradaPt — Recibos.csv (con Inventariado) vs RecibosEst.csv (sin Inventariado) e IPT_Movs.csv (2,468 tipo 2 vs 3 tipo 3) — todos latin-1
- docs/modulos/patron-crud.md (CRUD TipoProceso)

---

## F3-E2 · Corte + envío a maquila unificado (M+A por TipoProceso) — ✅ 18-jun-2026 (reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`)

> **Cierre F3-E2 (18-jun-2026; reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`).** Primer vertical sobre `EtapaMovimiento`: **corte + envío a maquila unificado** end-to-end (dominio→API→UI + 2 PDFs), sin tocar el kardex PT (eso llega con el recibo en E4). **Dominio** `backend/src/dominio/produccion/etapas.ts`: `registrarCorte` (EtapaMovimiento tipo=corte + det color×talla en transacción A2, folio A3 clave `etapa-mov`, Bitácora A7, idEmpresa de la orden A9; valida cortador con rol `corte`, cantidades enteras ≥0 y color/talla pertenecientes a la orden; **sobre-corte LIBRE** decisión (f): no bloquea, solo avisa cuánto excede; emite `corte-registrado` post-commit). `registrarEnvioMaquila` (UN servicio para costura Y estampado parametrizado por TipoProceso D8; valida tercero con el rol que mapea al proceso vía `MAPEO_PROCESO_A_ROL` —costura→`maquila-costura`, resto identidad—; **sobre-envío ESTRICTO** decisión (g): enviado ≤ cortado disponible por proceso, calculado por **suma directa de `EtapaMovimientoDet` DENTRO de la tx** bajo `pg_advisory_xact_lock` por empresa+orden tomado **ANTES** de las sumas —sin carrera—, excluye canceladas; cada proceso se topa independiente contra el cortado total; guarda precioPactado/fechaCompromiso; emite `envio-registrado`). `cancelarEtapaMovimiento` (cancelación **suave** + motivo + Bitácora; bloquea cancelar un corte con envíos vivos; rechaza re-cancelar; solo corte/envío). Consultas **DERIVADAS** sin acumuladores: `pendientesPorOrden` (por cortar = orden − corte, negativo si hubo sobre-corte; cortado por enviar[proceso] = corte − enviado a ese proceso) y `corteSemanalPorCortador` (semana ISO en UTC). `listarEtapasOrden` (HISTORIAL de cortes+envíos de la orden, vivos **y** cancelados, con su detalle color×talla — base de la cancelación y de la verificación de Gabriel). **API** `backend/src/api/produccion/etapas.rutas.ts` (9 endpoints, RBAC A4, Zod→OpenAPI): POST `/produccion/cortes` y `/envios` + sus cancelaciones (`produccion.corte`/`.envio`/`.cancelar`), GET `/produccion/ordenes/:id/pendientes`, GET `/produccion/ordenes/:id/etapas`, GET `/produccion/corte-semanal` (`produccion.wip-ver`) y 2 GET de PDF. **Impresos R9** `dominio/produccion/impresos/impreso-envio-maquila.ts` (@react-pdf/renderer, patrón de F2-E4): documento de envío/entrega a maquila + ficha de estampado. **Frontend** `frontend/src/modulos/produccion/`: Captura de corte (avisa el sobre-corte en vivo), Envío a maquila unificado (selector de proceso en la MISMA pantalla → costura o estampado; maquilero filtrado por el rol del proceso; matriz limitada al cortado disponible; precio pactado + fecha compromiso; botones de PDF), Corte semanal por cortador **responsive/móvil**, y `HistorialEtapasOrden` (cancelar con diálogo de motivo, cableado en ambas pantallas de captura). Reutiliza el componente `MatrizColorTalla` de F2 (no se reimplementó). 3 rutas + 3 entradas de menú bajo Producción. **SIN migración, SIN permisos nuevos, SIN tocar el seed** (los 9 `produccion.*` ya se sembraron en F3-E1 → el deploy a `prueba` **NO requiere `SEED_ON_START`**). OpenAPI + cliente del frontend regenerados (regla 7). **Decisiones de negocio (Gabriel/Daniel, registradas en `DECISIONES.md` incisos (f)/(g)):** sobre-corte **libre** (solo avisa) y sobre-envío **estricto** (`enviado ≤ cortado`), ambas con tope **configurable** sin migración; se dejó fijada para E4 la regla del recibo **`recibido ≤ enviado`**. **Bloqueante que cazó el reviewer (resuelto):** la cancelación quedaba **inalcanzable desde la UI** (hooks `useCancelarCorte/Envio` definidos pero sin pantalla que los usara) y faltaba el historial → se agregaron `listarEtapasOrden` (backend) + `HistorialEtapasOrden` (UI), porque la verificación de Gabriel exige cancelar un envío con motivo y verlo en el historial como cancelado. **Equipo:** 1 coder + 1 reviewer independiente (corte y envío son una cadena dominio→API→UI que comparte servicios y la matriz color×talla — no se paralelizó). **CI/checks (corridos por el lead sin Docker):** backend `tsc`/eslint/prettier + **364 unit** verde; frontend `tsc`/eslint/prettier + **tests de producción 12/12** verde (los timeouts de la corrida completa son flakiness ambiental en módulos no tocados; aislados pasan); integración (enviar > cortado → rechazado; cortador/maquilero sin rol → rechazado; sobre-corte permitido; cancelar corte con envío vivo → rechazado; folios A3 consecutivos; **dos envíos concurrentes** no exceden lo cortado) corre en CI con testcontainers.

**Objetivo:** Primer corte vertical sobre EtapaMovimiento: capturar el corte y los envíos de costura Y estampado con UNA sola pantalla parametrizada por TipoProceso (D8). Va segunda porque el corte fija el techo de todo lo demás (enviar ≤ cortado, recibir ≤ enviado).

**Alcance:**
- Dominio (backend/src/dominio/produccion): registrarCorte (EtapaMovimiento corte + det color×talla, valida contra la orden de F2 con la tolerancia de sobre-corte DECIDIDA antes de empezar la etapa, folio A3, evento 'corte-registrado')
- Dominio: registrarEnvioMaquila — UN servicio para M y A parametrizado por TipoProceso: valida tercero por banderas Maquileros.Costura/Proceso (07-EsMa §3), valida que lo enviado no exceda el cortado disponible para ese proceso, registra precioPactado y fecha compromiso, evento 'envio-registrado'
- Dominio: cancelarEtapaMovimiento para corte y envío (cancelación suave + motivo + Bitacora; bloquea cancelar un corte que ya tiene envíos vivos)
- Dominio: consultas de pendientes por orden+proceso ('por cortar' = orden − corte; 'cortado por enviar' = corte − enviado) que las pantallas muestran en vivo — todo derivado, sin acumuladores
- API REST: POST /api/produccion/cortes, POST /api/produccion/envios, POST de cancelación, GET de pendientes por orden, GET corte semanal por cortador — RBAC en cada ruta (A4), Zod→OpenAPI
- Pantallas: Captura de corte PC (matriz color×talla reutilizando el componente de F2, cortador, fecha, observaciones, 'por cortar' visible — base OrdDetCorte/OrdDetCorteSub); Envío a maquila unificado PC (selector TipoProceso, maquilero/estampador filtrado por banderas, matriz limitada a cortado disponible, precio pactado — base ProcesoEntrega/ProcesoEntregaEst); Consulta de corte semanal por cortador PC + MÓVIL (es consulta — regla del plan: consultas también en móvil; base CorteSemanal/OrdDetCorteCon)
- Impresos R9 (@react-pdf/renderer en backend): Documento de envío/entrega a maquila (ref. ReciboEntMaquilaImp/ReciboEntMaqDetImp) y Ficha de estampado (ref. FichaEstImp/form FichaEst)

**Entregables:**
- Servicios de dominio con TSDoc (regla de negocio + referencia al doc y D#/A#) y tests unit + integración (incluye: enviar más que lo cortado → rechazado; cortador/maquilero inválido para el proceso → rechazado)
- Rutas REST + openapi.json regenerado + cliente del frontend sincronizado (regla 7)
- 3 pantallas (corte semanal responsive) + 2 PDFs descargables
- Decisión de tolerancias de sobre-corte/sobre-envío registrada en DECISIONES.md (la consigue Gabriel con Daniel ANTES de arrancar la etapa)

**Criterio de cierre:**
- Una orden de F2 puede cortarse y enviarse a costura Y a estampado desde la misma pantalla, con folios consecutivos por secuencia (A3)
- Imposible exceder lo cortado disponible por proceso (validación server-side, test incluido)
- Los 2 PDFs se generan con datos reales de la captura
- Cancelación deja rastro (motivo + Bitacora) y recalcula los pendientes
- Consulta de corte semanal usable en móvil (responsive)
- CI verde + review aprobado; OpenAPI y cliente sincronizados

**Verificación de Gabriel:**
- [ ] Con `docker compose up -d` y una orden capturada en F2 (o la del seed demo): abrir 'Captura de corte', llenar la matriz color×talla y guardar; confirmar que 'por cortar' baja exactamente lo capturado
- [ ] Intentar cortar más que la orden → ver el mensaje de bloqueo/tolerancia acordado con Daniel
- [ ] Abrir 'Envío a maquila', elegir proceso Costura: confirmar que solo aparecen maquileros de costura y que la matriz no deja exceder lo cortado; guardar con precio pactado
- [ ] En la MISMA pantalla cambiar el proceso a Estampado y hacer un envío al estampador — comprobar que es una sola pantalla, no dos
- [ ] Descargar el PDF de envío y la ficha de estampado; compararlos a ojo contra los impresos del sistema viejo (formularios ReciboEntMaquilaImp / FichaEst)
- [ ] Abrir 'Corte semanal por cortador' y verificar que el corte capturado aparece en la semana correcta; abrirla también desde el celular (o angostar la ventana) → usable
- [ ] Cancelar el envío de estampado con motivo: verificar que el 'cortado por enviar' regresa y que el movimiento queda en el historial como cancelado

**Equipo:** 1 coder + 1 reviewer (corte y envío son una cadena dominio→API→UI que comparte servicios, el router de producción y la matriz color×talla — paralelizar aquí estorba)

**Referencias:**
- Documentacion_MJD/03-Produccion.md Paso 3 (Corte), Paso 4 (Entrega a maquilero), 'Flujo paralelo — Estampado' y Observación 4
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md §3 (banderas Costura/Proceso de Maquileros)
- PLANMAESTRO §Contexto (captura en PC; consultas también en móvil), §4 'Tallas ilimitadas (D4)' y 'Maquila unificada'; §5 Impresos R9
- DECISIONES.md D4, D8; MEJORAS.md A1, A2, A3, A6, A7, A9; REQUISITOS-NUEVOS.md R9
- docs/modulos/patron-crud.md + componente matriz color×talla de F2 (frontend/src/componentes)

---

## F3-E3 · Inventario PT operable: movimientos manuales, traspasos, existencias y kardex — ⬜ pendiente

**Objetivo:** Dar su primer uso real al motor kardex con todo el inventario PT manual y sus consultas. Va ANTES del recibo a propósito: cuando el recibo automático llegue en E4, sus efectos serán visibles y verificables en pantallas que ya existen.

**Alcance:**
- Dominio (backend/src/dominio/inventarios): registrarMovimientoPt (entrada/salida/ajuste con tipo del catálogo TipoMovimientoInventario; modelo×color×talla×almacén); el traspaso entre almacenes hace salida en origen + entrada en destino en UNA transacción (A2, hoy puede quedar a medias)
- Dominio: cancelarMovimientoPt = movimiento inverso generado y auditado (Bitacora A7) — NUNCA edición ni borrado del original; reemplaza los tipos viejos 'Error de Entrada/Salida' como práctica
- Dominio: consultarExistenciasPt (vista ExistenciaPt con filtros modelo/color/talla/almacén) y kardexPt por modelo y por folio de movimiento (SQL crudo si el volumen lo pide, PLANMAESTRO §1)
- API REST: POST /api/inventarios/pt/movimientos, POST /api/inventarios/pt/traspasos, POST /api/inventarios/pt/movimientos/{id}/cancelar, GET /api/inventarios/pt/existencias, GET /api/inventarios/pt/kardex (por modelo y por folio) — RBAC A4
- Pantallas: Movimientos manuales PC (captura; base IPT_Mov/IPT_Movimientos); Traspaso entre almacenes origen+destino en una operación PC (base IPT_MovTransfer); Existencias PC + MÓVIL con filtros y totales (la consulta móvil del módulo; base IPT_Exis/IPT_ExisSub); Kardex por modelo (base IPT_MovsSaldo) y por folio (base IPT_MovsLista) — consultas de análisis denso pensadas para PC (justificación regla 10: su uso real es de escritorio administrativo; la consulta de piso/móvil es Existencias)
- El va-y-ven del estampado por inventario queda operable: tipos 6 'Salida a Aplicación' y 3 'Entrada de Aplicación' funcionan como movimientos manuales (riesgo 'estampado no secuencial' cubierto — es la vía de inventario para el estampado POST-costura, complemento de la regla generaEntradaPt de E4)
- IPT_Revision NO se construye: con kardex puro no hay nada que recuadrar (04-Inventarios Obs. 1) — se documenta su desaparición

**Entregables:**
- Servicios de dominio con TSDoc + tests unit e integración (traspaso atómico, inverso, existencia nunca negativa donde aplique según tipo)
- Rutas REST + openapi.json regenerado + cliente sincronizado (regla 7)
- 4 pantallas (existencias con vista móvil verificada)
- Tests E2E Playwright del flujo entrada manual → traspaso → kardex

**Criterio de cierre:**
- Entrada, salida, ajuste y traspaso operan end-to-end y la existencia mostrada SIEMPRE es la suma de movimientos (D3) — test que lo demuestra
- Ningún endpoint permite editar/borrar un movimiento; la corrección es inversa y queda en Bitacora (A7)
- Existencias se consulta bien en móvil (responsive)
- CI verde + review aprobado

**Verificación de Gabriel:**
- [ ] Abrir 'Inventario PT → Movimientos' y capturar una entrada manual tipo 'Inventario Inicial' de un modelo con 2 colores y 3 tallas al almacén Primeras
- [ ] Abrir 'Existencias', filtrar por ese modelo: ver las cantidades por color×talla×almacén exactas
- [ ] Hacer un traspaso Primeras → Tránsito de una parte: confirmar en Existencias que bajó en origen y subió en destino con UNA sola captura
- [ ] Abrir 'Kardex por modelo': ver los movimientos en orden con saldo; abrir 'Kardex por folio' con el folio del traspaso
- [ ] Intentar modificar o borrar un movimiento ya guardado → confirmar que NO se puede; cancelarlo y ver que aparece el movimiento inverso en el kardex
- [ ] Abrir Existencias desde el celular (o angostar la ventana) → la consulta es usable
- [ ] En Administración → Bitácora (F0): confirmar que los movimientos quedaron registrados

**Equipo:** 1 coder + 1 reviewer (cadena dominio→API→UI del mismo módulo inventarios)

**Referencias:**
- Documentacion_MJD/04-Inventarios.md §A.2 'Cómo se mueve el stock', §A.3 'Pantallas (Menú 4.1)', Observaciones 1 y 4
- PLANMAESTRO §4 'Motor de inventario único (D3)' y §1 (SQL crudo para consultas pesadas)
- DECISIONES.md D3, D4, D6 (los ajustes/conteos preparan el cíclico de F4/F6); MEJORAS.md A1, A2, A7, A9
- Respaldo CLAUDE/TABLAS/IPT_TiposMov.csv (los 19 tipos, en especial 3 y 6 del ciclo de aplicación)

---

## F3-E4 · Recibo de maquila ⭐ — transacción WIP + kardex PT condicionado por proceso + cargo EsMa + validación de cargos — ⬜ pendiente

**Objetivo:** Construir el PUNTO DE INTEGRACIÓN CENTRAL del plan (§5): el recibo es UNA transacción de la que se derivan los efectos QUE SU TIPO DE PROCESO define — el avance WIP y el cargo EsMa para TODO recibo (EsMa_Recibos.EsEstampado confirma que el cargo aplica a costura Y estampado), y la entrada a inventario PT SOLO para el proceso que deja prenda terminada (generaEntradaPt: costura). Capturar una vez, usar en todos lados. Va aquí porque ya hay envíos que recibir (E2) y pantallas de inventario donde VER el efecto (E3). Incluye la validación del cargo para que el flujo EsMa no quede a medias entre etapas.

**Alcance:**
- Dominio: registrarReciboMaquila — UNA transacción (A2) que: (1) crea EtapaMovimiento(recibo, TipoProceso) + det color×talla → el WIP sube solo; (2) SOLO si TipoProceso.generaEntradaPt (costura): genera la ENTRADA al kardex PT (Movimiento+Det modelo×color×talla en el almacén destino) — reemplaza el MeterInventario del botón viejo (A1) y ELIMINA la bandera Inventariado. Los recibos de estampado/bordado/lavado NO meten a PT (verificado: RecibosEst no tiene Inventariado; IPT_Movs: 2,468 entradas tipo 2 vs 3 del tipo 3): si el estampado va ANTES de la costura serían paneles sin coser en PT, y si va DESPUÉS la prenda se contaría DOBLE — su va-y-ven post-costura se maneja con los tipos 6/3 que E3 dejó operables; (3) crea EsMaCargo en estado 'propuesto' para TODO proceso, costura y estampado (cantidad × precio del envío; puede nacer SIN precio — 1,309 envíos viejos no lo traen — por eso la validación del admin es obligatoria); (4) emite 'recibo-registrado' (gancho F5). CALIDAD (primeras/segundas) capturada SEPARADA del ALMACÉN destino (mejora 03 Obs. 3); el almacén destino solo aplica cuando hay entrada a PT
- Concurrencia: la validación de 'pendiente por recibir' se hace DENTRO de la transacción con lectura consistente/bloqueo de los EtapaMovimiento de la orden+proceso (suma directa, nunca vistas — regla del ADR de E1) — test automatizado de dos recibos simultáneos que no exceden lo enviado; tolerancia de sobre-recibo según la decisión registrada (mermas/segundas/reposiciones)
- Dominio: validarCargoEsMa (propuesto → validado; el admin ajusta cantidad y precio real; Bitacora A7) — se CONSERVA el punto de control humano de 07-EsMa §2 pero sin recapturar
- Dominio: cancelarEtapaMovimiento extendido a recibos: genera el movimiento inverso en kardex SOLO si el recibo generó entrada (generaEntradaPt) y cancela el cargo si no está validado; si ya está validado exige permiso especial + Bitacora
- API REST: POST /api/produccion/recibos, GET pendientes por recibir (orden+proceso), POST de cancelación, GET recibos semanales por maquilero, GET /api/esma/cargos?estado=propuesto, POST /api/esma/cargos/{id}/validar — RBAC A4
- Pantallas: Recibo de maquila UNIFICADO PC (matriz color×talla contra pendiente por recibir, calidad y almacén destino como campos separados — el almacén solo visible si el proceso genera entrada a PT, precio de referencia del envío — base ProcesoRecibo/ProcesoReciboEst/ReciboMaqDet); Consulta de recibos semanales por maquilero PC + MÓVIL (es consulta; base RecibosSemanalesMaq); Validación de cargos EsMa PC + MÓVIL (es una AUTORIZACIÓN — regla del plan: autorizaciones también en móvil; cola de propuestos, validar/ajustar — pantalla mínima, el estado de cuenta completo es de F6)
- Impreso R9: Recibo de maquila UNIFICADO en un PDF parametrizado por TipoProceso (ref. ReciboMaquilaImp / ReciboMaquilaImpEst)

**Entregables:**
- Servicio registrarReciboMaquila con TSDoc extensa (es el corazón de la fase) + tests unit, integración y de CONCURRENCIA (testcontainers); test explícito de atomicidad: si falla el cargo, no queda ni recibo ni entrada de inventario (A2); test explícito de que un recibo de ESTAMPADO no crea Movimiento en kardex ni altera existencias, pero SÍ sube el WIP y SÍ genera su cargo EsMa propuesto
- validarCargoEsMa + cancelación de recibos con sus tests
- Rutas REST + openapi.json regenerado + cliente sincronizado (regla 7)
- 3 pantallas (recibos semanales y validación de cargos responsive) + 1 PDF; test E2E Playwright del flujo envío→recibo→cargo validado (flujo crítico, PLANMAESTRO §9.2)
- Decisión de tolerancia de sobre-recibo registrada en DECISIONES.md y bandera generaEntradaPt confirmada con Daniel (decisión (e), antes de arrancar)

**Criterio de cierre:**
- UNA captura de recibo produce de forma atómica los efectos que su TipoProceso define — costura: pendiente baja + existencia PT sube + cargo propuesto (3 efectos); estampado: pendiente baja + cargo propuesto SIN tocar el kardex PT — demostrado por tests y verificable en pantallas
- Test en verde: un recibo de estampado NO crea entrada en kardex ni duplica existencias (cubre estampado pre-costura y post-costura)
- Test de concurrencia en verde: dos recibos paralelos no exceden lo enviado
- No existe la bandera 'Inventariado' ni ningún paso posterior de inventariado manual
- Cancelar un recibo revierte el kardex con movimiento inverso solo si lo generó, y el cargo según su estado
- Validación de cargos y recibos semanales usables en móvil
- CI verde + visto bueno de LOS DOS reviewers

**Verificación de Gabriel:**
- [ ] Sobre la orden con envíos de E2: abrir 'Recibo de maquila', elegir proceso Costura → la pantalla muestra el pendiente por recibir por color×talla
- [ ] Capturar un recibo PARCIAL eligiendo calidad Primeras y almacén Primeras (campos separados) y confirmar
- [ ] Verificar los 3 efectos de esa ÚNICA captura de costura: (a) el pendiente por recibir bajó; (b) en 'Existencias' (pantalla de E3) apareció la entrada con color y talla en el almacén elegido; (c) en 'Validación de cargos EsMa' hay un cargo propuesto con cantidad × precio del envío
- [ ] Validar el cargo ajustando el precio → queda en estado 'validado'; repetir la validación de otro cargo desde el celular (o angostando la ventana) — la pantalla de autorización es usable en móvil
- [ ] Capturar un recibo con proceso Estampado en la MISMA pantalla: confirmar que el pendiente de estampado baja y que aparece su cargo EsMa propuesto, PERO que 'Existencias' (E3) NO cambió — el estampado no mete prendas a PT (la pantalla ni siquiera pide almacén destino)
- [ ] Descargar el PDF de recibo en ambos casos (costura y estampado) y comparar contra ReciboMaquilaImp/ReciboMaquilaImpEst del viejo
- [ ] Intentar recibir más de lo enviado → bloqueo/tolerancia según la decisión registrada
- [ ] Cancelar un recibo de costura NO validado con motivo: el kardex muestra el movimiento inverso, el cargo queda cancelado y el pendiente por recibir regresa; cancelar también el de estampado → el cargo se cancela y el kardex NO se toca (no había entrada)
- [ ] Abrir 'Recibos semanales por maquilero' y ver las capturas de la semana; abrirla también desde el celular → usable
- [ ] En el PR: confirmar que el test de concurrencia (dos recibos simultáneos) y el test 'recibo de estampado no toca kardex' están en verde en el CI

**Equipo:** 1 coder + 2 reviewers independientes (PLANMAESTRO §9.1 lo nombra explícitamente como tarea grande; el segundo reviewer se enfoca en la transacción, la concurrencia, la atomicidad y la condición generaEntradaPt)

**Referencias:**
- PLANMAESTRO §5 'Punto de integración central', §Contexto (autorizaciones también en móvil) y §9.1
- Documentacion_MJD/03-Produccion.md Paso 5 completo (MeterInventario e Inventariado SOLO en Recibos de costura) + recuadro '⭐ El recibo es la fuente de TRES cosas' + Observaciones 2 y 3; el diagrama general solo conecta el recibo de costura con el inventario
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md §2 (flujo de captura y punto de control del admin), §3 (modelo de datos, EsEstampado: el cargo SÍ aplica a estampado), §6.1–6.4 (mejoras)
- Respaldo CLAUDE/TABLAS/: Recibos.csv (con Inventariado) vs RecibosEst.csv (sin Inventariado) e IPT_Movs.csv (2,468 tipo 2 vs 3 tipo 3) — evidencia de la condición por proceso
- DECISIONES.md D3, D4, D8; MEJORAS.md A1, A2, A3, A7, A9; REQUISITOS-NUEVOS.md R9
- Documentacion_MJD/04-Inventarios.md §A.2 (entradas automáticas — el comportamiento a reemplazar)

---

## F3-E5 · Entrega a cliente + tablero WIP y consultas (cierre del ciclo) — ⬜ pendiente

**Objetivo:** Cerrar el ciclo de la orden (salida de PT al cliente con seguimiento de pedido DERIVADO) y entregar las vistas consolidadas (WIP, existencias en poder del maquilero) que demuestran el criterio de salida de la fase. Dos piezas de verdad independientes → se paralelizan.

**Alcance:**
- PIEZA A — Entrega a cliente: dominio registrarEntregaCliente — transacción: EtapaMovimiento(entrega_cliente) + det color×talla + SALIDA de kardex PT (tipo 'Entrega a Cliente', el tipo 5 viejo) + actualización del seguimiento del pedido (PedidosDet.entregadoParcial/cantFaltante y PedidosReales como valores DERIVADOS de las entregas, nunca editados — 02-Pedidos §5); cancelación con inverso; folio A3; el flujo se construye según la decisión PREVIA con Daniel (la tabla vieja EntregasCliente tiene 0 filas — el flujo real hoy pasa por IPT tipo 5 + PedidosReales)
- PIEZA A — Concurrencia (mismo tratamiento que el recibo de E4): la validación 'no se entrega lo que no existe' se hace DENTRO de la transacción sumando MovimientoDet DIRECTO (nunca la vista ExistenciaPt — y menos materializada; regla fijada en el ADR de E1) bajo bloqueo: advisory lock por modelo×color×talla×almacén o SELECT ... FOR UPDATE sobre tabla ancla — un SUM en READ COMMITTED sin bloqueo dejaría pasar dos entregas simultáneas y existencia negativa; test automatizado de dos entregas simultáneas del mismo artículo que no dejan negativo
- PIEZA A — Pantalla: Entrega a cliente PC (captura color×talla contra existencia disponible, referencia de pedido, fecha); Comprobante PDF de entrega SOLO si la decisión con Daniel lo confirma (impreso NUEVO, R9 'por definir')
- PIEZA A — API: POST /api/produccion/entregas-cliente, GET entregas por orden/pedido, POST de cancelación
- PIEZA B — Dominio consultarWip: agregados por orden y etapa con los pendientes calculados EXACTAMENTE como el form Proceso (por cortar = orden − corte; cortado por enviar = corte − enviado; por recibir = enviado − recibido; por proceso) + columna de entregado a cliente + drill-down color×talla ('faltan 12 pzas talla 6 color rojo', D4) — todo derivado de EtapaMovimiento, sin acumuladores
- PIEZA B — Dominio consultarExistenciaMaquilero: enviado − recibido por maquilero/proceso/orden (base MaqExis; lo reutilizará EsMa en F6)
- PIEZA B — Pantallas: Tablero WIP PC + MÓVIL (lista de órdenes con avance y pendientes por etapa, drill-down, búsqueda por modelo/cliente/REFERENCIA DEL CLIENTE D7, cubre 'órdenes incompletas' del menú 3); Existencias en poder del maquilero PC + MÓVIL
- PIEZA B — API: GET /api/produccion/wip (+detalle por orden), GET /api/produccion/existencias-maquilero; índices de apoyo y medición de tiempos de las consultas (preparar la decisión de materializar en E6)

**Entregables:**
- Servicios con TSDoc + tests (incluye: entregar más que la existencia → rechazado; test de CONCURRENCIA: dos entregas simultáneas no dejan existencia negativa; el seguimiento del pedido cuadra como derivado tras entregas y cancelaciones)
- Rutas REST + openapi.json regenerado + cliente sincronizado UNA vez al integrar las dos piezas (regla 7)
- Pantalla de entrega + tablero WIP responsive + existencias de maquilero responsive
- Test E2E Playwright: orden → corte → envío → recibo → entrega y el WIP refleja cada paso
- Decisión del flujo real de entrega a cliente (y si lleva comprobante PDF) registrada en DECISIONES.md

**Criterio de cierre:**
- Una orden completa su ciclo y el tablero WIP muestra avance y pendientes correctos en cada etapa, con drill-down color×talla
- La entrega descuenta kardex y el pedido de F2 muestra entregado/faltante DERIVADOS (sin campos editables)
- Test de concurrencia en verde: dos entregas paralelas del mismo artículo no dejan existencia negativa (validación por suma de MovimientoDet con bloqueo, nunca por la vista)
- Enviado − recibido por maquilero cuadra contra las capturas de E2/E4
- Tablero WIP y existencias usables en móvil
- CI verde + review aprobado de ambas piezas

**Verificación de Gabriel:**
- [ ] Abrir el 'Tablero WIP': localizar la orden de prueba y comparar sus números contra lo capturado en E2/E4 (cortado, enviado, recibido por proceso, pendientes) — deben cuadrar exacto
- [ ] Hacer drill-down a color×talla y confirmar que los pendientes por talla coinciden con las matrices capturadas
- [ ] Buscar la orden por la referencia del cliente (campo D7 capturado en F2) → la encuentra
- [ ] Abrir el tablero y 'Existencias en poder del maquilero' desde el celular → legibles y usables; verificar que enviado−recibido del maquilero cuadra
- [ ] Capturar una 'Entrega a cliente' parcial color×talla: confirmar que la existencia PT baja (pantalla E3), que el kardex muestra la salida tipo 'Entrega a Cliente' y que en el pedido (F2) el entregado/faltante se actualizó solo
- [ ] Intentar entregar más de la existencia disponible → bloqueado con mensaje claro
- [ ] Confirmar que la orden de prueba ya no aparece en 'órdenes incompletas' si se completó (o aparece con su faltante real)
- [ ] En el PR: confirmar que el test de concurrencia de entregas (dos simultáneas sin existencia negativa) está en verde en el CI

**Equipo:** 2 coders en paralelo (pieza A: entrega a cliente / pieza B: consultas WIP y existencias de maquilero — dominios, rutas y pantallas sin solape; solo coordinan la regeneración del contrato al integrar) + 1 reviewer

**Referencias:**
- Documentacion_MJD/03-Produccion.md 'El WIP — avance de la orden (form Proceso)' con su tabla de pendientes, Paso 7 y nota D4 ampliada
- Documentacion_MJD/02-Pedidos.md §5 (EntregadoParcial/CantFalt deben quedar derivados)
- Documentacion_MJD/04-Inventarios.md (tipo de movimiento 5 'Entrega a Cliente')
- ADR del kardex de E1 (regla: validaciones transaccionales suman MovimientoDet, nunca la vista) + el patrón de bloqueo del recibo de E4
- DECISIONES.md D3, D4, D7; MEJORAS.md A1, A2, A3, A9; REQUISITOS-NUEVOS.md R9 ('por definir con Daniel')
- Formularios viejos: Proceso + ProcesoCorte/Entrega/Recibo/EntregaEst/ReciboEst, MaqExis

---

## F3-E6 · ETL de producción e inventario PT + cuadre + documentación + cierre de fase — ⬜ pendiente

**Objetivo:** Migrar el histórico real (corte, envíos, recibos, movimientos IPT, cargos EsMa) de forma idempotente con reporte de cuadre obligatorio, documentar el módulo y verificar el criterio de salida completo de F3 en el ambiente de prueba (regla 6: la última etapa siempre cierra con ETL + docs + verificación).

**Alcance:**
- ETL en backend/migracion (TypeScript, latin-1, idempotente y re-ejecutable, cargando VÍA los servicios de dominio — mismas validaciones que la captura real, PLANMAESTRO §7; con modo tolerante documentado para datos históricos que la captura nueva rechazaría)
- PIEZA A — Producción: Corte (6,967) + OrdenesDetCorte (12,946) → EtapaMovimiento(corte)+Det (TC1..TC8 → filas talla A6; color desde la línea OrdenesDet); Entregas (7,412) + OrdenesDetEntM (15,220) y EntregasEst (4,516) + OrdenesDetEntA (7,619) → envíos por TipoProceso conservando PrecioPactado y Consecutivo como folio histórico
- PIEZA A — Recibos SIN doble conteo: TODOS los recibos históricos (12,440 de costura + 4,059 de estampado) se cargan con una VARIANTE del servicio SIN efectos derivados — NO genera entrada a kardex NI crea EsMaCargo — porque esos efectos históricos se migran de sus propias fuentes: el kardex PT viene ÚNICAMENTE de IPT_Movs y los cargos ÚNICAMENTE de EsMa_Recibos (si los 10,512 recibos inventariados pasaran por el servicio completo, las 2,468 entradas tipo 2 se duplicarían; 2,353 IPT_Movs ya traen IdRecibos — esa liga se conserva como referencia informativa). La variante se documenta como EXCEPCIÓN JUSTIFICADA a la regla §7 'cargar vía servicios de dominio': las validaciones de captura se reusan, los efectos colaterales no. Separación de TipoPrendas en calidad + almacén (reglas de limpieza para 1,408 sin TipoPrendas y 158 sin cantidad → lista de inconsistencias para decisión, NO se arreglan en silencio); los 1,928 recibos con Inventariado=0/vacío tampoco generan entradas retroactivas (el saldo sale de IPT_Movs)
- PIEZA A — Cargos EsMa: EsMa + EsMa_Recibos (7,401, con EsEstampado) → EsMaCargo histórico ligado a orden+maquilero SIN FK a recibo (la liga formal nace en v2; documentar el no-cuadre 12,440 recibos vs 7,401 cargos)
- PIEZA B — IPT + cuadre + docs: IPT_TiposMov/IPT_Almacenes → verificación contra los catálogos seedeados en E1; IPT_Modelos (1,224) → mapeo a Modelo vía NumMod; IPT_Movs (5,072) + IPT_MovsDet (6,886) → Movimiento/Det PT aplicando la estrategia DECIDIDA para el histórico sin color×talla (dimensión 'sin desglose' vs reconstrucción desde OrdenesDetRecM — decisión explícita documentada); EntregasCliente con 0 filas → documentado en el reporte (las entregas reales viven en IPT_Movs tipo 5 + PedidosReales)
- Reporte de cuadre obligatorio: conteos por entidad v1 vs v2 + Σ Movimiento v2 por modelo×almacén vs IPT_Mod_Alm.Existencia (3,655 filas) + CHECK de no-doble-conteo: ningún recibo migrado generó movimiento kardex propio (las entradas tipo 2 de v2 provienen 1:1 de IPT_Movs); descuadres LISTADOS con causa para decisión de Daniel/Gabriel
- Rendimiento con 10 años migrados: medir ExistenciaPt, WIP y kardex; materializar la vista y/o agregar índices si hace falta (mini-ADR si se materializa, respetando la regla de E1: las validaciones transaccionales siguen sumando MovimientoDet directo — la materializada es solo para consultas)
- Documentación del módulo: docs/modulos/produccion-wip.md y docs/modulos/inventario-pt.md (cómo quedó construido, servicios, la regla generaEntradaPt, eventos que entrega a F5, qué entrega a F4/F6/F7); actualizar DECISIONES.md con las decisiones tomadas en la fase
- Verificación funcional del criterio de salida de F3 en el ambiente de prueba (PLANMAESTRO §6): una orden recorre TODO el ciclo y el inventario PT cuadra por kardex

**Entregables:**
- Scripts de ETL idempotentes en backend/migracion con tests (corren contra los CSV reales de 'Respaldo CLAUDE/TABLAS/' en el CI o localmente), incluida la variante de carga sin efectos derivados documentada
- Reporte de cuadre generado (artefacto legible: conteos, sumas, check de no-doble-conteo, lista de inconsistencias con causa)
- docs/modulos/produccion-wip.md + docs/modulos/inventario-pt.md + DECISIONES.md actualizado
- openapi.json regenerado si algo cambió + cliente sincronizado
- Demo del ciclo completo en el ambiente de prueba con datos migrados

**Criterio de cierre:**
- El ETL corre DOS veces seguidas con los mismos conteos finales (idempotencia demostrada)
- El cuadre Σ kardex v2 vs IPT_Mod_Alm coincide, o cada descuadre está listado con su causa para decisión (nunca corregido en silencio)
- El reporte demuestra CERO doble conteo: ningún recibo migrado generó entrada kardex propia ni cargo EsMa propio (kardex solo de IPT_Movs; cargos solo de EsMa_Recibos)
- Criterio de salida de la fase verificado EN VIVO: una orden nueva recorre corte→envío→recibo (efectos según su proceso)→validación de cargo→entrega, y las existencias PT cuadran por kardex
- Tablero WIP y existencias responden con tiempos razonables con los 10 años migrados
- Docs del módulo publicadas; CI verde; review aprobado

**Verificación de Gabriel:**
- [ ] Correr el ETL de F3 (comando documentado en backend/migracion/README, p. ej. `docker compose exec backend npm run migracion -- f3`) y volverlo a correr: confirmar que la segunda corrida reporta los mismos totales (idempotente)
- [ ] Abrir el reporte de cuadre y revisar: conteos contra los esperados (6,967 cortes; 7,412+4,516 envíos; 12,440+4,059 recibos; 5,072 movs IPT; 7,401 cargos), el check de no-doble-conteo (las entradas tipo 2 de v2 = las de IPT_Movs, ni una más) y la lista de inconsistencias con su causa — llevarla a Daniel para decisión
- [ ] Elegir con Daniel 2–3 órdenes históricas conocidas, abrir su WIP en v2 y comparar contra el sistema viejo (form Proceso)
- [ ] Elegir 2–3 modelos, comparar su existencia v2 (pantalla Existencias) contra IPT_Mod_Alm del viejo (o el reporte de cuadre)
- [ ] En el ambiente de prueba (Railway o compose): ejecutar el ciclo completo con una orden nueva — corte, envío, recibo de costura (3 efectos) y de estampado (2 efectos, sin tocar PT), validar los cargos, entregar al cliente — y confirmar que el WIP y el kardex cuadran en cada paso
- [ ] Sentir los tiempos del tablero WIP y de Existencias con todo el histórico cargado (deben abrir fluido)
- [ ] Leer docs/modulos/produccion-wip.md e inventario-pt.md y confirmar que reflejan lo construido (incluida la regla generaEntradaPt y la excepción del ETL)

**Equipo:** 2 coders en paralelo (pieza A: ETL de producción corte/envíos/recibos + cargos EsMa / pieza B: ETL de IPT + reporte de cuadre + docs — scripts y archivos independientes sobre el runner de migración ya existente) + 1 reviewer

**Referencias:**
- PLANMAESTRO §7 (Migración de datos — la variante sin efectos derivados se documenta como excepción justificada) y §6 (criterio de salida de F3)
- Documentacion_MJD/03-Produccion.md (mapeo de tablas viejas por paso), 04-Inventarios.md §A.1 y Observación 1, 07-EsMa §3
- DECISIONES.md D3, D4; MEJORAS.md A6 (TC1..TC8 → filas)
- Respaldo CLAUDE/TABLAS/: Corte, OrdenesDetCorte, Entregas(Est), OrdenesDetEntM/A, Recibos(Est), OrdenesDetRecM/A, IPT_* (IPT_Movs trae IdRecibos en 2,353 filas), EsMa, EsMa_Recibos, EntregasCliente (todos latin-1)
- CLAUDE.md §4 (encoding latin-1 y trampas de lectura)

---

## Notas de la fase (supuestos del diseño)

SUPUESTOS: (1) F1 y F2 están terminadas al arrancar F3 — existen Maquileros (con banderas costura/proceso), Cortadores/Estampadores, Colores, Tallas/CurvaTalla, Modelos, Orden/OrdenLinea/OrdenLineaTalla, Pedido/PedidosDet/PedidosReales y el componente reutilizable de matriz color×talla del frontend; si F1 ya creó TipoProceso, E1 solo lo extiende (agrega generaEntradaPt) y lo seedea. (2) Verifiqué en el repo que el motor kardex NO existe en F0 (no hay kardex.ts en backend/src/comun ni modelos Movimiento/MovimientoDet en backend/prisma/schema.prisma) — la nota del orquestador era imprecisa; su construcción está presupuestada en E1, genérica para PT/tela/avío con extensibilidad VERIFICABLE en el ADR (dimensiones por tipo según PLANMAESTRO §4: PT modelo×color×talla; Tela idTela×idLote D5; Avío idAvio×idLote/esGenerico R4 — F4 no migra filas ni toca el núcleo). (3) El criterio de salida exige datos de F1+F2 capturados en el ambiente de prueba (una orden con modelo, colores y tallas reales); si no hay, E2 necesita un seed demo. DECISIONES QUE GABRIEL DEBE CONSEGUIR ANTES DE LA ETAPA CORRESPONDIENTE (registrar en DECISIONES.md, no inventar): (a) tolerancias de sobre-corte/sobre-envío antes de E2 y de sobre-recibo antes de E4 (mermas, segundas, reposiciones — la doc no fija la regla); (b) flujo real de entrega a cliente antes de E5 (la tabla vieja EntregasCliente tiene 0 filas; el flujo real pasa por IPT tipo 5 + PedidosReales) y si lleva comprobante PDF; (c) estrategia del histórico PT sin color×talla antes de E6 (dimensión 'sin desglose' vs reconstrucción aproximada desde OrdenesDetRecM — afecta el cuadre de F9); (d) si v2 liga cada recibo a un envío específico o conserva el agregado por orden+proceso — ANTES DE E1 (revisión de diseño del ADR), porque congela el esquema de EtapaMovimiento/EsMaCargo de la migración única; si Daniel no decide a tiempo, el ADR documenta el diseño por defecto (agregado por orden+proceso con liga opcional nullable) como decisión reversible sin migración destructiva; (e) NUEVA: qué tipos de proceso generan entrada a PT (bandera generaEntradaPt) — propuesta verificada en el viejo: SOLO costura (Recibos.Inventariado existe solo en costura; RecibosEst no trae esa columna; IPT_Movs: 2,468 entradas tipo 2 'Entrada de Maquila' vs 3 del tipo 3 'Entrada de Aplicación') — confirmar con Daniel A MÁS TARDAR antes de E4; la columna nace en E1 con el default propuesto y cambiar el valor es dato, no migración. COSAS DEL INVENTARIO QUE NO METÍ A F3: la pantalla de Asignación/programación de órdenes a maquileros (MaquilerosProg/MaqProgCual) la dejo para F5 — no está documentada en 03-Produccion y usa Ordenes.FechaProg/EnRiesgo, que son campos de programación/RC; si el orquestador la quiere en F3, cabe como pantalla extra en E5 pieza B. Los abonos, descuentos, pagos y el estado de cuenta completo de EsMa son de F6 (aquí solo nace el cargo propuesto→validado — y el cargo aplica a costura Y estampado, EsMa_Recibos.EsEstampado). Los impresos de otros módulos (nota de salida y OC → F4; estado de cuenta y auditoría → F6; orden de producción → F2) quedan fuera. El auto-avance de la RC es F5: aquí solo se emiten los eventos (corte/envío/recibo-registrado) desde un despachador mínimo en comun/eventos.ts. NOTAS DE DISEÑO: (i) la entrada a PT del recibo está CONDICIONADA por TipoProceso.generaEntradaPt — el estampado nunca mete a PT (pre-costura serían paneles sin coser; post-costura sería doble conteo) y su va-y-ven se maneja por dos vías: envíos/recibos por TipoProceso para WIP y cargo (E2/E4) y los tipos de movimiento 6 'Salida a Aplicación' / 3 'Entrada de Aplicación' como movimientos de inventario (E3); (ii) ExistenciaPt nace como vista normal y E6 decide materializarla con los 10 años migrados, PERO las validaciones transaccionales (recibo E4, entrega E5) siempre suman MovimientoDet directo bajo bloqueo y nunca leen la vista — regla fijada en el ADR de E1, con test de concurrencia obligatorio en E4 (dos recibos) Y en E5 (dos entregas); (iii) costoUnit del kardex queda NULL en toda F3 (entradas de recibo y movimientos manuales) hasta que F7 defina la valuación a costo actual (D1/D2) — política fijada en el ADR de E1 con test; (iv) el ETL de E6 carga los recibos históricos con una variante del servicio SIN efectos derivados (kardex solo de IPT_Movs, cargos solo de EsMa_Recibos) — excepción justificada y documentada a PLANMAESTRO §7, con check de no-doble-conteo en el reporte de cuadre. Total: 6 etapas — E1→E2→E3→E4→E5→E6 estrictamente secuenciales entre sí (cada una usa lo de la anterior), con paralelismo interno solo en E5 y E6 donde las piezas son de verdad independientes.
