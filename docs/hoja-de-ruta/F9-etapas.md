# F9 — Finanzas (CxC/CxP + CFDI) · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Origen:** decisión **D12** + requisitos **R10–R15** + módulo **14**, integrados desde
> `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` (2026-06-13).
> **Entrega de la fase (plan §6):** Módulo 14: cuenta corriente única de terceros (CxC + CxP, que
> generaliza EsMa) con marca fiscal y dos vistas; importación y conciliación de CFDI de proveedores
> y de ventas; notas de crédito; reportes fiscales para el contador. Meta: **apagar SINUBE** por
> etapas (lo operativo primero; el timbrado vía PAC, R14, es posterior).
> **Criterio de salida:** CxC y CxP cuadran por suma de movimientos; un CFDI de proveedor y uno de
> venta importados, conciliados y ligados a su operación real; el reporte fiscal para el contador
> sale del libro filtrado por movimientos fiscales.
> **Estado:** ⬜ pendiente — el desglose se confirma/ajusta al arrancar la fase. **El esquema Prisma
> y el diseño de pantallas se definen AL CONSTRUIR la fase, no aquí** (propuesta §8); este desglose
> es la hoja de ruta provisional.
>
> **Dependencias de fase (por qué F9 va aquí):** generaliza el motor **EsMa** (construido en F6),
> necesita **Pedidos/clientes** (F2) para CxC y **Compras/OC + recepción** (F4) para CxP. Se apoya
> en los motores de F0: **secuencias atómicas** (A3, folios de facturas/notas/movimientos),
> **auditoría** (A7), **transacciones** (A2, registrar CFDI + crear el cargo en una sola
> operación), **archivos R2** (guardar el XML/PDF de cada CFDI), **RBAC** (A4) y **multi-empresa**
> (CxC/CxP segmentadas por empresa). El **catálogo de proveedores enriquecido (R15)** NO está en
> esta fase: es su cimiento y se construyó en **F1-E1B**.

## F9-E1 · Motor de cuenta corriente de terceros (generaliza EsMa, R10) — ✅ COMPLETA (10-jul-2026; 2 reviewers independientes APROBARON — #1 halló el write-skew de doble cancelación B1 cerrado con advisory lock + unique parcial + test concurrente; #2 halló el crash TDZ del cancelar y la asimetría del permiso fiscal, cerrada como decisión (b) documentada en ADR-0017; pend. verificación de Gabriel en `prueba`)

> **CIERRE (10-jul-2026).** Construido el **motor central** de F9: `MovimientoTercero` + `ServicioCuentaTerceros`. Decisiones y entregables:
> - **Modelo del tercero (D15a, ADR-0017):** el movimiento REFERENCIA a Cliente o Proveedor por **tipo + id** — dos FKs reales nullable (`idCliente`/`idProveedor`, Restrict) + **CHECK de exclusividad** — SIN tabla `Tercero` polimórfica (el Proveedor ya unifica maquilero/estampador vía roles R15). Enum `TipoTercero` + `OrigenMovimientoTercero` (7 orígenes; extensible en E4).
> - **Convención de signo (única, en el dominio `origen-tercero.ts`):** `saldo = Σ monto`; el API recibe `importe` POSITIVO y el servidor le pone el signo por el origen — **cargo +** (recibo_maquila/factura_proveedor/entrada_sin_factura), **abono −** (nota_credito/pago/abono/descuento). La **nota de crédito baja** el saldo. CHECK `monto <> 0` (el signo-por-origen se valida en el dominio, no en el CHECK, para poder extender el enum en E2–E5 sin migrar).
> - **Dos ejes / dos vistas:** cada movimiento lleva `origen` (eje 1) + `esFiscal` (eje 2). La vista **operativa** trae todo; la **fiscal** filtra `esFiscal=true` y **exige `terceros.fiscal`** (lo valida el dominio). No son dos libros, son dos filtros.
> - **EsMa re-expresado — grado elegido: (b) compatibilidad de LECTURA (convivencia), NO migración.** Para un PROVEEDOR, el saldo y el estado de cuenta del motor **INCLUYEN** los movimientos EsMa (F6): el saldo reusa `calcularSaldoMaquilero` (extraído de F6 como cálculo puro sin permiso) → **no-regresión garantizada por reutilización de la MISMA fórmula**; el detalle proyecta los renglones EsMa con `fuente="esma"` y su signo (Σ de todos los renglones = saldo). NO se migró ningún dato EsMa. Test de no-regresión: `saldoDeMaquilero` viejo == aporte EsMa del motor.
> - **Aging (D15d):** `fechaVencimiento` derivada = fecha + días de crédito del tercero (Proveedor R15 ya los trae; Cliente = contado en E1, el campo llega en E4). Solo los cargos vencen. Los cortes configurables del reporte son de E5.
> - **Cancelación = inverso auditado** (D3/A7, patrón kardex): crea el inverso (monto negado), marca el original `cancelado`, nunca borra/edita; no se re-cancela ni se cancela un inverso; el saldo neta (operativo y fiscal).
> - **Endpoints + RBAC:** 4 rutas (`POST /terceros/movimientos`, `POST …/:id/cancelar`, `GET /terceros/:tipo/:id/saldo`, `GET …/estado-cuenta`). Permisos NUEVOS `terceros.ver` / `.administrar` / `.fiscal` (deny-by-default). **Reparto conservador (como el fix del pentest):** administrar/fiscal SOLO Administrador/AdministracionDireccion; ver baja hasta **Gerencial** (se corta en Ventas, como `indicadores.ver`). **El deploy a `prueba` requiere `SEED_ON_START=true`** (permisos/reparto nuevos).
> - **SIN pantallas** (E1 es motor puro; las pantallas CxP/CxC son E2/E4): el frontend solo recibió el cliente OpenAPI regenerado (cero cambios de UI). Migración `20260710170000_f9_e1_motor_terceros` ADITIVA (validada con `prisma migrate diff`). ADR-0017.
> - **Módulo:** dominio `backend/src/dominio/terceros/` (`origen-tercero.ts`, `terceros.ts`, `convivencia-esma.ts`, `cuenta-terceros.ts`); rutas `backend/src/api/terceros/movimientos.rutas.ts`; contrato `backend/src/contrato/esquemas/terceros.ts`. Tests: unit (convención de signo) + int testcontainers (saldo=Σ, nota de crédito, cancelación=inverso, vista fiscal⊂operativa, A2, folio A3 concurrente, A9, deny A4, no-regresión EsMa, CHECK de exclusividad) + api int (RBAC/cableado). **2 reviewers** (motor central).

**Objetivo:** Construir el corazón de la fase: un **único motor de movimientos por tercero** del que cuelgan CxC, CxP y el propio EsMa, con el mismo principio que ya rige el sistema — `saldo = Σ(cargos) − Σ(abonos/pagos)`, **nunca editable** (consistente con D3). Va primero porque CxP (E2), CFDI (E3) y CxC (E4) son **usos** de este motor; si la mecánica del saldo, los dos ejes (origen + fiscal) y las dos vistas no quedan sólidos aquí, todo lo demás hereda el defecto. Es el motor central de la fase → **2 reviewers** (como el recibo de maquila o el kardex).

**Alcance:**
- Modelo de datos (a diseñar al arrancar; partida): `Tercero` unificado (o vista sobre Cliente/Proveedor/Maquilero ya existentes — **decisión de diseño a cerrar**: tabla `Tercero` polimórfica vs. referencias por tipo), `MovimientoTercero` (idTercero, idEmpresa, fecha, **origen** [recibo_maquila · factura_proveedor · entrada_sin_factura · nota_credito · pago · abono · descuento], **cargo/abono** con signo, **esFiscal** + datos fiscales, folio por **secuencia atómica A3**, referencia a la operación real [recibo/OC/entrada/pedido], idArchivo del CFDI en R2, auditoría A7). Las **notas de crédito** son un tipo de movimiento (egreso que baja el saldo)
- Regla de oro (A1, solo en dominio): el saldo de un tercero **se calcula sumando movimientos**, jamás se almacena editable (vista/materialización donde el volumen lo pida, igual que el kardex D3)
- **Dos vistas sobre el mismo libro:** (1) estado de cuenta **operativo** (todos los movimientos) y (2) reporte **fiscal** (solo `esFiscal = true`, para el contador). No son dos libros: son dos filtros
- **EsMa se re-expresa sobre este motor** sin perder su semántica: el cargo del maquilero nace del recibo de maquila (cantidad × precio real), no de una factura; al que factura se le concilia el XML sobre ESE movimiento y se marca fiscal. Compatibilidad: lo que F6 construyó como EsMa debe seguir cuadrando (test de no-regresión de saldos de maquilero)
- Servicio `ServicioCuentaTerceros` (dominio): registrar cargo/abono/pago/nota de crédito en transacción (A2), calcular saldo, listar movimientos con filtros (tercero, rango, origen, fiscal/no fiscal)
- Endpoints REST + permisos RBAC nuevos (terceros.ver / .administrar / .fiscal según se decida); OpenAPI regenerado + cliente del frontend sincronizado
- **Decisión a cerrar con Daniel/Gabriel ANTES de codificar:** ¿`Tercero` es una entidad nueva que unifica, o el motor referencia Cliente/Proveedor/Maquilero por separado? (afecta todo el esquema de la fase)

**Entregables:**
- Migración Prisma del motor de terceros aplicable en limpio
- `ServicioCuentaTerceros` con TSDoc (referencia a R10/D12, doc 07 EsMa) y batería de tests: saldo = Σ movimientos (nunca editable); nota de crédito baja el saldo; vista fiscal = subconjunto de la operativa; transacción A2 (registrar CFDI + cargo: o todo o nada); folio por secuencia A3; no-regresión de saldos EsMa de F6
- Endpoints + permisos + seed; OpenAPI + cliente sincronizados
- ADR de la decisión `Tercero` unificado vs. referencias por tipo
- PR a `prueba` con CI verde y review de **2 reviewers** aprobado

**Criterio de cierre:**
- CI verde + 2 reviewers aprobaron; transaccionalidad A2 y folio A3 demostrados por test
- El saldo de un tercero cuadra como Σ movimientos y NO es editable por ninguna ruta
- Los saldos EsMa de maquileros migrados en F6 siguen cuadrando sobre el motor nuevo (no-regresión)
- Decisión del modelo `Tercero` firmada y en ADR
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin
- [ ] Crear a mano un tercero de prueba y registrar: un cargo, un abono y una nota de crédito → el saldo refleja Σ(cargos) − Σ(abonos) − nota de crédito; intentar editar el saldo directamente → no se puede (solo movimientos)
- [ ] Marcar un movimiento como fiscal y otro como no fiscal; abrir la **vista operativa** (salen los dos) y la **vista fiscal** (sale solo el fiscal)
- [ ] Abrir el estado de cuenta de un maquilero conocido (de F6) y confirmar que su saldo es el mismo que antes de esta fase
- [ ] Swagger /api/docs muestra los recursos nuevos de cuenta de terceros

**Equipo:** 1 coder + **2 reviewers** independientes (motor central de la fase, como el recibo de maquila F3-E4 y el kardex F3-E1)

**Referencias:**
- Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md §3 (modelo de dominio: un motor, dos ejes, dos vistas) y §7 (motores de F0 reutilizables); DECISIONES.md D12; REQUISITOS-NUEVOS.md R10
- Documentacion_MJD/07-EsMa-Estados-de-Cuenta-Maquileros.md (saldo = suma de movimientos; el molde que se generaliza)
- PLANMAESTRO §4 ('Cuenta corriente de terceros (R10) — generaliza EsMa'); backend/src/comun (secuencias A3, auditoría A7), ADR-0005 (auditoría sin FK)
- docs/hoja-de-ruta/F6-etapas.md (cómo quedó EsMa — base de la no-regresión)

---

## F9-E2 · CxP — cuentas por pagar de proveedores — ✅ COMPLETA (10-jul-2026; reviewer APROBÓ tras 2 rondas; pend. verificación de Gabriel en `prueba`)

> **CIERRE (10-jul-2026).** Primer uso de negocio del motor E1 — todo por COMPOSICIÓN (cero duplicación):
> - **`ServicioCxP`** (`dominio/terceros/cxp/`): registrar/cancelar/estado-de-cuenta DELEGAN en `cuenta-terceros.ts` (folio A3, signo por origen, A2/A7/D3 del motor). Orígenes capturables: `entrada_sin_factura` (+helper `registrarCargoCompraCxp` que liga la OC real), `nota_credito`, `pago`, `abono`, `descuento`. El `recibo_maquila` NO se duplica (nace en EsMa, entra por convivencia); `factura_proveedor` llega en E3.
> - **Aging server-side (A1):** `$queryRaw` por proveedor (A9, `::numeric`) + `netearCubetas` PURA (créditos FIFO viejo→nuevo; vencido-hoy=corriente; el reparto por cubeta es convención — TSDoc; el saldo total siempre exacto). Límites en UN lugar (`LIMITES_AGING_CXP`: 30/60 — configurables en E5). `fechaVencimiento` = fecha + días de crédito del proveedor (R15).
> - **La bandeja "por pagar" FOLDEA el saldo EsMa** (DEBE del reviewer — "su cuenta es la misma"): `saldosEsMaPorMaquilero` batched (fórmula IDÉNTICA a `calcularSaldoMaquilero`; equivalencia bandeja==detalle probada por int test; sin N+1) vía `aportesEsMaSaldoLote`. Maquila en **cubeta APARTE "Maquila (sin antigüedad)"**; maquileros solo-EsMa SÍ aparecen; `carteraTotal` veraz. **`alCorrientePct` SOLO sobre la cartera del motor** (Matiz B): `null` ("—") si no hay cartera clasificable — la maquila jamás pinta "al corriente"; `maquilaTotal` aparte. El batched no filtra por rol/activo (consistencia bandeja==detalle).
> - **Pantallas** (proto `vCxp`, kit del rediseño): `/cxp` (4 KPIs + chips + tabla con aging + Maquila) y `/cxp/estado-cuenta` (toggle operativa/fiscal —fiscal exige `terceros.fiscal`—, captura gated `cxp.administrar`, cancelación con motivo, impreso PDF patrón EsMa). La hoja del riel dejó de ser placeholder.
> - **RBAC:** `cxp.ver`/`cxp.administrar` nuevos (reparto = `terceros.*`; defensa en profundidad probada en int). **El deploy a `prueba` requiere `SEED_ON_START=true`.** SIN migración.
> - Tests: unit aging (bordes+neteo) · int (cargo liga OC; pago baja saldo; informal operativa/fiscal-vacía; A9; deny A4; fold EsMa k1/k2/k3) · api int · componente · e2e `cxp.spec.ts` · PDF. Reviewer: 1 DEBE (fold EsMa) + Matiz B (% honesto) + S1/S2 — TODO corregido en 2 rondas → APROBADO; `test:unit` 860/860 aislado.

**Objetivo:** Primer uso de negocio del motor: llevarles a los **proveedores** (formales e informales) su estado de cuenta, con los cargos naciendo de la **operación real** (recibo de maquila para maquileros, recepción de material/OC para proveedores de bienes), pagos, abonos, descuentos y notas de crédito. Cubre el caso de Daniel de proveedores que **no facturan** (informales): un solo libro por proveedor, marca fiscal por movimiento.

**Alcance:**
- Cargos de CxP por **origen** (sobre el motor de E1): recibo de maquila (liga F3), recepción de material / entrada (liga F4), factura de proveedor (cuando llega vía E3), entrada sin factura, nota de crédito de proveedor; pagos/abonos/descuentos como egresos
- Conciliación con la **maquila (EsMa)**: el proveedor que también maquila no se duplica — su cuenta es la misma; el **origen** del movimiento decide la vista (EsMa vs. CxP) — se apoya en el catálogo de proveedores con **roles multi-valor** (R15, F1-E1B)
- Servicio `ServicioCxP` (sobre `ServicioCuentaTerceros`): registrar pago/abono/descuento en transacción A2; estado de cuenta del proveedor (operativo y fiscal); antigüedad de saldos (aging) por días de crédito (campo del proveedor R15)
- Endpoints + permisos RBAC (cxp.*); pantallas: estado de cuenta del proveedor, captura de pagos/abonos, bandeja de "por pagar"; impreso de estado de cuenta (R9, @react-pdf/renderer)
- OpenAPI + cliente regenerados

**Entregables:**
- `ServicioCxP` con TSDoc y tests (unit + integración testcontainers): cargo desde recepción/recibo, pago que baja el saldo, aging por crédito, proveedor informal sin CFDI llevado en el mismo libro
- Pantallas con tests de componente + E2E Playwright (capturar un pago de proveedor → el saldo baja); impreso de estado de cuenta con test
- OpenAPI + cliente sincronizados; permisos + seed
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado; transacción A2 demostrada
- Un proveedor formal y uno informal con su estado de cuenta cuadrando por suma de movimientos
- El proveedor que maquila no se duplica (misma cuenta, vista por origen)
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin
- [ ] Registrar un cargo a un proveedor de material y un pago parcial → el saldo y el aging reflejan lo correcto
- [ ] Llevar a un proveedor **informal** (sin RFC, R15 flag ¿factura?=no) su estado de cuenta: aparece completo en la vista operativa y vacío en la fiscal
- [ ] Para un proveedor que también maquila, confirmar que su saldo de maquila (EsMa) y sus compras conviven en una sola cuenta, separadas por origen
- [ ] Generar el impreso PDF del estado de cuenta y revisarlo

**Equipo:** 1 coder + 1 reviewer

**Referencias:**
- Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md §3.2 (formal vs informal = un libro, dos vistas), §3.4 (maquila), §4 (roles del proveedor); REQUISITOS-NUEVOS.md R10
- Documentacion_MJD/03-Produccion.md (recibos de maquila, OC, recepción) y 07-EsMa
- F1-E1B (proveedor enriquecido: días de crédito, ¿factura?, roles)

---

## F9-E3 · Importación de CFDI de proveedores (XML → CxP, R11) — ✅ COMPLETA (10-jul-2026; reviewer APROBÓ tras 3 rondas; pend. verificación de Gabriel en `prueba`)

> **CIERRE (10-jul-2026).** CONTROL ya jala el XML sellado del proveedor y lo concilia en CxP:
> - **Parser CFDI 4.0 PURO** (`dominio/terceros/cfdi/parser-cfdi.ts`, `fast-xml-parser@5.9.3` exacta): extrae versión/UUID del timbre/emisor/receptor/conceptos/IVA-retenciones/total; rechazos limpios (malformado, ≠4.0, sin timbre, tipo P/N/T, total ≤0, importes no numéricos); **endurecido para XML no confiable** (`processEntities:false` + rechazo explícito de `<!DOCTYPE`, tope 2 MB). I→`factura_proveedor` (+), E→`nota_credito` (−). Fixtures sintéticos en `pruebas/cfdi-fixtures.ts`.
> - **Importación por COMPOSICIÓN sobre el motor E1** (`cfdi-proveedor.ts`): el cargo = **TOTAL del CFDI** (la verdad fiscal); diferencias contra la OC → `avisos[]` (no se fuerzan). **El XML se sube SERVER-SIDE** (`subirContenido` nuevo en el motor de archivos; hallazgo DEBE del reviewer — el presigned dejaba cargos fiscales sin su XML, irrecuperables por el UUID único): orden seguro **R2 primero → tx después** (Archivo + movimiento fiscal en A2; huérfano de R2 inocuo si la tx falla). **Anti-duplicado por UUID** (pre-check + backstop P2002 de la unique de E1). La OC ligada se valida contra el proveedor elegido (ErrorValidacion) además de A9.
> - **Receptor validado contra `Empresa.rfc`** (columna NUEVA, migración aditiva `20260710190000_f9_e3_empresa_rfc`; el campo se captura en Administración › Empresas — de paso se corrigió la etiqueta engañosa del `identificador`): RFC capturado y no coincide → rechazo; sin capturar → aviso y entra. La misma columna servirá a E4 (emisor del CFDI de ventas).
> - **Candidatos honestos, sin auto-liga**: proveedor por RFC del emisor; OCs del proveedor (autorizada/recibida) ordenadas por |Δtotal| top 8 — se ELIGEN a mano en la pantalla `/cxp/importar-cfdi` (subir XML → previsualizar → conciliar → confirmar; gated `cxp.administrar`).
> - **Guard del modo local**: `R2_SUBIDA_LOCAL` (no-op de subida, SOLO para e2e/CI sin R2 real) ahora AVISA ruidoso al boot y **rehúsa arrancar en production** (`decidirArranqueSubidaLocal` pura + test) — un modo que descartaría documentos fiscales no embarca mudo.
> - **RBAC:** reúsa `cxp.administrar` + defensa en profundidad `terceros.administrar` — **SIN permisos nuevos → SIN `SEED_ON_START`**; la migración de `empresa.rfc` se auto-aplica. Tests: unit parser/receptor/guard + int (cargo fiscal ligado + XML, UUID duplicado, sin-OC con aviso, NC baja saldo, OC↔proveedor, A9, deny A4) + componente + e2e `cfdi.spec.ts`. Reviewer: 1 DEBE (server-side) + 1 DEBE-small (guard) + S1/S2 — TODO corregido → APROBADO; backend 881/881, front 671/671.

**Objetivo:** Que CONTROL **jale el XML ya sellado** que manda el proveedor, lo valide, lo **ligue a la OC/entrada** y **concilie** el cargo en CxP marcándolo fiscal — alimentando de paso costos e inventario. Es importación, **no emisión** (el timbrado nativo vía PAC es R14, posterior).

**Alcance:**
- Parser/validador de **CFDI 4.0** (XML del SAT): leer emisor (RFC, razón social), receptor, conceptos, impuestos (IVA, retenciones), total, UUID; validar estructura y que el receptor sea la empresa activa; **guardar el XML (y el PDF si viene) en R2** (motor de F0)
- Conciliación: ligar el CFDI a una **OC / entrada / recibo** existente (match por proveedor + montos + referencia) y **crear/marcar fiscal** el movimiento de CxP correspondiente, en transacción A2 (registrar CFDI + cargo: o todo o nada); evitar duplicados por UUID
- Casos: factura sin OC previa (alta de cargo + aviso), nota de crédito de proveedor (egreso fiscal), diferencias de monto a incidencia (no se fuerzan)
- Servicio `ServicioCfdiProveedor`; endpoint de subida del XML (presigned o multipart) + pantalla "Importar CFDI de proveedor" (subir XML → previsualizar datos extraídos → conciliar/ligar → confirmar)
- OpenAPI + cliente regenerados

**Entregables:**
- Parser de CFDI con tests sobre **XML reales de ejemplo** (emisor/impuestos/UUID/retenciones), incluido un CFDI mal formado que se rechaza y una nota de crédito
- `ServicioCfdiProveedor` con tests de integración: el XML se guarda en R2, el cargo queda fiscal y ligado, el UUID duplicado se rechaza, la transacción A2 es atómica
- Pantalla de importación con E2E Playwright (subir XML → conciliar → el saldo de CxP queda fiscal)
- OpenAPI + cliente sincronizados; permisos + seed
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- PRERREQUISITO: R2 montado (motor de archivos de F0) — heredado, debe estar desde F1-E3
- CI verde + review aprobado; atomicidad A2 (CFDI + cargo) demostrada; UUID único garantizado
- Un CFDI de proveedor real importado, ligado a su operación y conciliado en CxP (marcado fiscal), con el XML visible en R2
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin
- [ ] Importar un XML real de un proveedor: la pantalla muestra emisor, conceptos, IVA/retenciones y total extraídos del XML; ligarlo a una OC/entrada y confirmar
- [ ] Verificar que el cargo aparece en CxP **marcado fiscal** y que el XML quedó guardado en R2 (llave ordenada)
- [ ] Reintentar el mismo XML (mismo UUID) → el sistema lo rechaza como duplicado
- [ ] Importar una nota de crédito de proveedor → baja el saldo y queda fiscal
- [ ] Importar un XML corrupto → error claro, no se crea cargo

**Equipo:** 1 coder + 1 reviewer

**Referencias:**
- Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md §2 (CFDI por importación), §3.3 (ejes), §3.5 (notas de crédito), §7 (R2 para el XML); REQUISITOS-NUEVOS.md R11
- PLANMAESTRO §2.3 (R2/presigned), §4 (motor de terceros); backend/src/comun/archivos.ts (motor R2 de F0)

---

## F9-E4 · CxC — cuentas por cobrar + importación de CFDI de ventas (XML → CxC, R12) — ⬜ pendiente

**Objetivo:** Lo simétrico del lado del cliente: llevar **lo que te deben** (CxC), alimentado por el **XML ya timbrado** de las ventas propias (emitido por fuera, en SINUBE u otro), **ligado al pedido/cliente**, más cobros, abonos y notas de crédito a clientes.

**Alcance:**
- Cargos de CxC por venta: importar el **CFDI de ventas ya timbrado** (XML emitido por fuera) → crear el cargo en CxC ligado al **pedido/cliente** (liga F2); el XML se guarda en R2 y el movimiento queda fiscal; cobros/abonos como ingresos; **notas de crédito a clientes** (egreso que baja lo que deben)
- Reusa el parser de CFDI de E3 (ahora el receptor es el cliente y el emisor es la empresa); match por cliente + pedido + montos; evitar duplicados por UUID
- Servicio `ServicioCxC` (sobre el motor de E1): estado de cuenta del cliente (operativo/fiscal), aging por días de crédito del cliente, registrar cobro/abono/nota de crédito en transacción A2
- Endpoints + permisos RBAC (cxc.*); pantallas: estado de cuenta del cliente, captura de cobros, importar CFDI de venta, bandeja de "por cobrar"; impreso de estado de cuenta (R9)
- OpenAPI + cliente regenerados

**Entregables:**
- `ServicioCxC` con tests (unit + integración): cargo desde CFDI de venta ligado a pedido, cobro que baja el saldo, nota de crédito a cliente, aging
- Importación de CFDI de ventas con tests (reusa parser de E3); UUID duplicado rechazado; XML en R2
- Pantallas con tests de componente + E2E Playwright (importar CFDI de venta → cargo en CxC ligado al pedido; registrar cobro → baja el saldo); impreso de estado de cuenta
- OpenAPI + cliente sincronizados; permisos + seed
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado; atomicidad A2 demostrada
- Un CFDI de venta importado, ligado a su pedido/cliente y reflejado en CxC (fiscal); un cobro que baja el saldo
- El estado de cuenta del cliente cuadra por suma de movimientos
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin
- [ ] Importar un XML de una venta propia (timbrado por fuera) y ligarlo a un pedido/cliente → aparece como cargo en CxC marcado fiscal, con el XML en R2
- [ ] Registrar un cobro parcial → el saldo del cliente y su aging bajan
- [ ] Registrar una nota de crédito a un cliente → baja lo que debe
- [ ] Abrir el estado de cuenta del cliente (operativo y fiscal) y el impreso PDF

**Equipo:** 1 coder + 1 reviewer

**Referencias:**
- Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md §2 (ventas propias → CxC), §3.1 (clientes), §3.5; REQUISITOS-NUEVOS.md R12
- Documentacion_MJD/02-Pedidos.md (pedidos/clientes — liga de CxC) y D7 (campos por cliente); parser de CFDI de E3

---

## F9-E5 · Reportes fiscales para el contador (R13) + conciliaciones — ⬜ pendiente

**Objetivo:** Cerrar la promesa de fondo: que CONTROL le entregue al contador **información fiscal limpia y detallada** de clientes y proveedores (solo lo fiscal), y consolidar las conciliaciones (CFDI ↔ operación) en reportes utilizables. CONTROL **no** lleva contabilidad: entrega datos, no pólizas.

**Alcance:**
- Reporte fiscal por periodo y por empresa: movimientos **fiscales** de proveedores (CxP) y clientes (CxC) con su CFDI (UUID, RFC, base, IVA, retenciones, total) — la **vista fiscal** del libro de E1, exportable
- Exportación a Excel (exceljs) y PDF (@react-pdf/renderer); filtros por tercero, periodo, tipo (ingreso/egreso), con/sin CFDI
- Conciliación consolidada: qué movimientos tienen CFDI y cuáles no (pendientes de XML), diferencias CFDI ↔ operación a revisión
- Tablero de "salud fiscal": % de movimientos conciliados, faltantes de XML, saldos por tercero
- Servicio `ServicioReportesFiscales`; endpoints + permisos RBAC; pantallas (PC; consulta en móvil)
- OpenAPI + cliente regenerados

**Entregables:**
- `ServicioReportesFiscales` con tests (la vista fiscal = solo movimientos fiscales; los totales cuadran contra los movimientos)
- Exportaciones Excel/PDF con tests; pantallas con tests de componente + E2E
- OpenAPI + cliente sincronizados; permisos + seed
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado
- El reporte fiscal de un periodo trae exactamente los movimientos fiscales (ni uno no fiscal) y cuadra contra el libro
- El export a Excel abre y coincide con la pantalla
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin
- [ ] Generar el reporte fiscal de un periodo: salen solo los movimientos con CFDI (proveedores y clientes), con RFC, IVA, retenciones y UUID
- [ ] Exportar a Excel y a PDF; confirmar que coinciden con la pantalla
- [ ] Abrir el tablero de salud fiscal: ver % conciliado y la lista de movimientos sin XML
- [ ] Confirmar que un movimiento **no fiscal** (proveedor informal) NO aparece en el reporte del contador

**Equipo:** 1 coder + 1 reviewer

**Referencias:**
- Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md §2 (entregar info al contador, sin contabilidad), §3.2 (vista fiscal), §8 (lo que NO incluye); REQUISITOS-NUEVOS.md R13
- PLANMAESTRO §1 (exceljs, @react-pdf/renderer)

---

## F9-E6 · ETL de saldos/históricos de terceros + cuadre + docs + cierre de fase — ⬜ pendiente

**Objetivo:** Cargar el **punto de partida** de CxC/CxP (saldos iniciales y los movimientos que se quieran traer desde SINUBE / históricos de CFDI), cuadrarlos, documentar el módulo y demostrar el criterio de salida en `prueba`. A diferencia de las otras fases, estos datos **no viven en Access** (viven en SINUBE/CFDI), así que el ETL es de **saldos iniciales** + importación masiva de CFDI, no del .mdb viejo.

**Alcance:**
- Carga de **saldos iniciales** por tercero (CxC/CxP) como **movimiento de apertura** (nunca saldo editable, D3), en transacción A2, con auditoría 'migración' (A7) — fuente: corte de SINUBE / captura asistida
- Importación masiva de **CFDI históricos** (carpeta de XML que el contador/SINUBE entregue) reusando el parser de E3/E4: alimenta la vista fiscal hacia atrás lo que se decida traer
- **Decisión a cerrar con Daniel/Gabriel:** cuánto histórico fiscal se trae (¿solo saldos al corte? ¿N meses de CFDI?) y de dónde sale el corte de SINUBE (export, API, manual)
- Reporte de cuadre: saldos v2 de terceros vs. el corte de SINUBE/contador; diferencias a incidencia (no se fuerzan, §7)
- `docs/modulos/finanzas.md` (cómo quedó el módulo: motor de terceros, CxC/CxP, importación CFDI, reportes, decisiones tomadas)
- Verificación del criterio de salida en el environment `prueba`
- OpenAPI + cliente regenerados si el ETL agrega endpoints

**Entregables:**
- ETL de saldos iniciales + importador masivo de CFDI en backend/migracion, idempotente (test que lo corre DOS veces sin duplicar — UUID y apertura no se duplican)
- Reporte de cuadre saldos v2 vs. corte SINUBE/contador, calculado en runtime
- `docs/modulos/finanzas.md` publicada
- PR a `prueba` con CI verde (migración aplicable en limpio) y review aprobado; datos cargados en el ambiente de prueba

**Criterio de cierre:**
- ETL corre dos veces seguidas con el mismo resultado (idempotencia demostrada)
- Reporte de cuadre revisado por Gabriel: saldos v2 = corte de terceros, o diferencias explicadas
- CRITERIO DE SALIDA DE LA FASE: CxC y CxP cuadran por suma de movimientos; un CFDI de proveedor y uno de venta importados y conciliados; reporte fiscal para el contador — verificado en `prueba`
- `docs/modulos/finanzas.md` publicada; CI verde; review aprobado

**Verificación de Gabriel:**
- [ ] Antes: decidir con Daniel cuánto histórico fiscal se trae y cómo sale el corte de SINUBE
- [ ] Local: correr el ETL de saldos + importación de CFDI DOS veces; la segunda no duplica nada
- [ ] Abrir el reporte de cuadre: los saldos de 2–3 terceros conocidos coinciden con SINUBE/el contador, o la diferencia está explicada
- [ ] En la app (prueba tras el merge): abrir el estado de cuenta de un proveedor y de un cliente reales con su saldo de apertura + movimientos
- [ ] CIERRE DE FASE: importar EN PRUEBA un CFDI de proveedor y uno de venta nuevos, conciliarlos y generar el reporte fiscal del periodo
- [ ] Dar el visto bueno para el PR de `prueba` → `main`

**Equipo:** 1 coder + 1 reviewer

**Referencias:**
- Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md §1 (apagar SINUBE), §2, §8; REQUISITOS-NUEVOS.md R10–R13
- PLANMAESTRO §7 (migración idempotente, reporte de cuadre, inconsistencias a decisión) y §4 (motor de terceros)
- docs/hoja-de-ruta/F10-etapas.md (patrón de ETL/cuadre del go-live — esta fase reusa el criterio, con fuente SINUBE en vez de .mdb)

---

## Notas de la fase (supuestos del diseño)

ESTA FASE ES NUEVA (integrada el 2026-06-13 desde `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`; decisión **D12**, requisitos **R10–R15**, módulo **14**). Gabriel decidió la numeración secuencial: al integrarse, **Finanzas fue F8** y **Migración + Go-live pasó de F8 a F9**; el **2026-07-04**, al insertarse la fase **F8 · Desarrollo, Cotización y Listas de Precios (D13)**, **Finanzas pasó a F9** y **Go-live a F10** (fichas renombradas a `F9-etapas.md` y `F10-etapas.md`). SUPUESTOS Y DECISIONES DE DISEÑO: (1) **El esquema Prisma y las pantallas se definen AL CONSTRUIR la fase, no en este desglose** (propuesta §8) — las 6 etapas son la hoja de ruta provisional, se confirman/ajustan al arrancar. (2) **Posición:** F9 va después de F7 (y de la nueva **F8 · Desarrollo y Cotización**, con la que no tiene dependencia técnica) y antes del Go-live (F10) porque **generaliza el motor EsMa** (construido en F6), necesita **Pedidos/clientes** (F2) para CxC y **Compras/OC + recepción** (F4) para CxP; la propuesta original la situaba "después de F4", pero la dependencia de EsMa (F6) la ancla más tarde. (3) **R14 (timbrado nativo vía PAC) NO entra en estas 6 etapas:** es sub-entrega posterior (lo regulado); R10–R12 dejan la estructura lista para que, cuando se aborde, pasar de "importar XML" a "emitir + timbrar" sea un salto chico. (4) **R15 (proveedor enriquecido) NO está aquí:** es el cimiento de las CxP y se construyó en **F1-E1B**. (5) **Reúso de F0 (propuesta §7):** secuencias atómicas (A3) para folios de facturas/notas/movimientos, auditoría (A7), transacciones (A2: registrar CFDI + cargo en una sola operación), archivos R2 (XML/PDF del CFDI), RBAC (A4), multi-empresa (CxC/CxP por empresa). (6) **EsMa no se reescribe ni se duplica:** se re-expresa sobre el motor único de terceros conservando su semántica (cargo desde el recibo, no desde factura); E1 incluye no-regresión de los saldos de maquilero de F6. (7) **CONTROL no lleva contabilidad** (pólizas, balanza, DIOT, declaraciones) ni tesorería/conciliación bancaria completa: eso se queda con el contador; CONTROL entrega información fiscal limpia (vista fiscal). DECISIONES A CERRAR TEMPRANO (con Daniel/Gabriel): el modelo `Tercero` (unificado vs. referencias por tipo) en E1; cuánto histórico fiscal se trae y de dónde sale el corte de SINUBE en E6. DEPENDENCIA OPERATIVA: el formato/fuente del corte de SINUBE (export, API o captura asistida) condiciona E6. META DE FONDO: **apagar SINUBE por etapas** — primero lo operativo (CxC/CxP + importación de CFDI, sin riesgo regulatorio), dejando lo regulado (PAC, R14) para el final.
