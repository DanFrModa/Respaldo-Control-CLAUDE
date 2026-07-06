# F8 — Desarrollo, Cotización y Listas de Precios por Cliente · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Origen:** decisión **D13** + requisitos **R16–R20** + módulo **15**, integrados desde
> `Documentacion_MJD/PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md` (2026-07-04).
> Las sub-decisiones de negocio del §8 de la propuesta **ya las resolvió Daniel** (2026-07-04);
> lo poco que falta cerrar está en la lista de preguntas de las *Notas de la fase* (con defaults).
> **Entrega de la fase (plan §6):** Módulo 15: la capa previa al pedido — **proyectos de
> desarrollo por Cliente + Departamento** (R16), **precosteo preciso y persistido** con precios
> amarrados a proveedor/producto/precio (telas por proveedor y por color, R17), medidas por talla
> en ciertos avíos (R18) y conceptos de costo abiertos (R19); **listas de precios por
> Cliente+Departamento** con factores del cliente, **aprobación del dueño modelo por modelo** y
> **negociación por versiones** con acuerdos (R20); y el **enganche**: al ligar el modelo a su
> orden de producción, el MRP/OC hereda lo predefinido (telas dejan de capturarse a mano; avíos
> se compran por medidas por talla).
> **Criterio de salida:** un desarrollo real recorre el ciclo completo en `prueba`: proyecto →
> precosteo amarrado (tela por proveedor/color + medidas por talla + conceptos abiertos) →
> lista de precios con los factores del cliente → el dueño aprueba/ajusta → una ronda de
> negociación re-costeada por versiones con su acuerdo → liga a una orden de producción → la
> explosión MRP sugiere la tela con proveedor/precio predefinidos y calcula el avío por medidas
> por talla; y el impreso PDF de la lista de precios sale (R9).
> **Estado:** ⬜ pendiente — el desglose se confirma/ajusta al arrancar la fase. **El esquema
> Prisma propuesto abajo es PARTIDA, no contrato** (se confirma al construir), pero está
> aterrizado contra el código real verificado el 2026-07-04.
>
> **Dependencias de fase (por qué F8 va aquí):** usa el **motor de costeo de F7** (`backend/src/
> dominio/costos/`: `pre-costo.ts`, `precio-sugerido.ts` — misma fórmula, distinto origen de
> precios, principio D1/D2), los **Modelos + BOM de F1** (`ModeloTela`/`ModeloAvio`/
> `ModeloBordado`, `AvioProveedor` R1, proveedor enriquecido R15), los **clientes de F1/F2**
> (patrón D7 `ClienteCampo`) y el **MRP/OC de F4** (`dominio/compras/mrp.ts`:
> `explosionarOrden`/`RequerimientoOrden`/`generarOCDesdeExplosion`). Se apoya en los motores de
> F0: secuencias atómicas (A3: folios de proyecto y de lista), auditoría (A7), transacciones
> (A2), RBAC (A4), multi-empresa (proyectos y listas por empresa). **NO depende de F9
> (Finanzas)** ni Finanzas de ella. **SIN ETL de Access** (D13): proyectos, listas y negociación
> hoy viven en Excel fuera del sistema — la fase arranca en cero (como el EDR, D2 #11).

## Mapa rápido de lo que la fase agrega (contra el código verificado)

| Hueco hoy (verificado 2026-07-04) | Lo llena |
|---|---|
| No existe `TelaProveedor` (solo `Tela.precioSugerido` genérico y `TelaColor.precio` sin proveedor); el MRP saca las telas a **captura manual** (`RequerimientoOrden.idProveedorSugerido = NULL`) | E1 (catálogo de precios) + E6 (MRP la sugiere sola) |
| No existe consumo por talla (solo `consumoPorPrenda`) | E1 (datos) + E3 (promedio en precosteo) + E6 (compra exacta) |
| Conceptos de costo fijos (tela/avíos/bordado/maquila en `pre-costo.ts`) | E1 (`ConceptoCosto` como datos) + E3 (N renglones) |
| No existe entidad Departamento del cliente | E1 (`ClienteDepartamento`) |
| Precosteo **al vuelo** por modelo, parámetros por **empresa**, no persistido | E3 (persistido por desarrollo, versionable) |
| No hay lista de precios **por cliente** ni negociación (vive en Excel) | E4 + E5 |
| El precio pactado solo vive en `PedidoLinea.precio`, sin rastro de cómo se llegó a él | E6 (liga desarrollo↔orden: todo el registro queda pegado) |

---

## F8-E1 · Cimientos de datos: precios amarrados (telas por proveedor/color), medidas por talla, conceptos/estados/departamentos + modelo de datos de TODA la fase — ✅ E1a+E1b (pend. verif. de Gabriel en `prueba`)

**Objetivo:** Construir las **tres mejoras habilitadoras** de la propuesta §7 — (A) precio de insumo amarrado a proveedor (el hueco grande: telas), (B) medida por talla en ciertos avíos, (C) conceptos de costo extensibles — y dejar el **modelo de datos de TODA la fase en UNA sola migración aditiva** (patrón F3-E1: las tablas de E2–E6 nacen aquí aunque su dominio/UI llegue después), con **los permisos de toda la fase sembrados** desde ahora. Va primero porque el precosteo preciso (E3) y el MRP enganchado (E6) leen de estos catálogos; si la resolución de precios no queda sólida aquí, todo lo demás hereda el defecto.

**Alcance:**
- **Migración Prisma aditiva ÚNICA de la fase** (partida, a confirmar al construir):
  - `ClienteDepartamento(id, idCliente FK→Cliente, nombre, activo, auditoría A7)` — `@@unique([idCliente, nombre])`. Los departamentos son **del cliente** (ej. C&A / NIÑOS), catálogo chico capturado a mano.
  - `TelaProveedor(id, idTela FK→Tela, idProveedor FK→Proveedor, precio Decimal(12,2), manejaPrecioPorColor Boolean @default(false), condiciones String?, activo, auditoría)` — `@@unique([idTela, idProveedor])`. Espejo de `AvioProveedor` (R1), que ya existe y NO se toca.
  - `TelaProveedorColor(idTelaProveedor FK, idColor FK→Color, precio Decimal(12,2))` — PK `[idTelaProveedor, idColor]`. Solo para proveedores con `manejaPrecioPorColor = true` (decisión de Daniel: "ciertos proveedores").
  - `ModeloAvio.consumoPorTalla Boolean @default(false)` (columna nueva) + `ModeloAvioTalla(idModelo, idAvio, idTalla FK→Talla, consumo Decimal(12,4))` — PK `[idModelo, idAvio, idTalla]`, FK compuesta a `ModeloAvio` (su PK es `[idModelo, idAvio]`). Solo avíos marcados (cierres, elástico…). **Las telas NO llevan talla ni color** (consumo por modelo completo, decisión de Daniel).
  - **Amarres en el BOM:** `ModeloTela.idTelaProveedor?` y `ModeloAvio.idAvioProveedor?` (FK nullable al renglón proveedor–producto–precio elegido por Desarrollo). Nota: `OrdenCompraLinea.idAvioProveedor` ya existe (F4) — el amarre del BOM es el paso previo del mismo hilo.
  - `ConceptoCosto(id, codigo kebab-case @unique, nombre, orden, fijo Boolean, activo)` — seed: `tela`, `avios`, `maquila` (fijo=true, no desactivables), `estampado`, `bordado`, `otros-procesos`, `otros` (ampliables). Patrón `TipoProceso`: catálogo que gobierna comportamiento por DATOS, no por código.
  - `EstadoLista(id, codigo @unique, nombre, orden, esCierre Boolean, activo)` — seed: `abierta`, `en-negociacion`, `cerrada`, `ya-pedida` (ampliables; los estados de lista son configurables, decisión de Daniel).
  - **Y las tablas de E2–E6** (detalladas en sus etapas): `Proyecto`, `Desarrollo`, `DesarrolloOrden`, `Precosto`, `PrecostoLinea`, `ClienteFactores`, `ListaPrecios`, `ListaPreciosLinea`, `NegociacionEvento`.
- **Regla de resolución del precio de TELA** (helper puro compartido en `dominio/costos`, con TSDoc y tests — la usan E3 y E6): amarre con color (`TelaProveedorColor.precio`, si el proveedor amarrado maneja color y hay color en contexto) → amarre (`TelaProveedor.precio`) → referencia por color (`TelaColor.precio`, ya existente, sin proveedor) → `Tela.precioSugerido`. Para AVÍO: amarre (`AvioProveedor.precio` del amarrado, normalizado por `factorConversion`) → más barato (regla F4 actual) → `Avio.precioReferencia`. **El precosteo al vuelo de F7 (`calcularPreCosto`) se EXTIENDE para usar esta resolución cuando el modelo tiene amarres** — con fallback intacto (test de no-regresión: un modelo sin amarres precostea idéntico a hoy).
- **Pantallas** (estándar visual vigente): pestaña/sección **"Precios por proveedor"** en el detalle de la Tela (Catálogos → Telas), igual que el avío maneja sus proveedores; captura de **medidas por talla** en el BOM del modelo (sección avíos: checkbox "consumo por talla" despliega la tabla de tallas de la curva del modelo); **departamentos** en el detalle del Cliente; CRUD de `ConceptoCosto` y `EstadoLista` en **Administración** (bandera admin-only **server-side**, patrón F3-E1 'Tipos de proceso').
- **Permisos RBAC de TODA la fase**, sembrados aquí (patrón F3-E1): `desarrollo.ver`, `desarrollo.administrar`, `desarrollo.precostear`, `listas.ver`, `listas.administrar`, `listas.aprobar`, `listas.negociar` — en `backend/src/contrato/permisos.ts` (`CATALOGO_PERMISOS`) + reparto por rol en `backend/prisma/seed.ts`. Los importes se ocultan sin `consultas.ver-importes` (transversal, ya existe).
- Endpoints REST de los catálogos nuevos + OpenAPI regenerado + cliente del frontend sincronizado.

**Entregables:**
- Migración Prisma de la fase aplicable en limpio (redactada a mano + `prisma migrate diff`, regla §7 de CLAUDE.md — NUNCA Docker local)
- Helper de resolución de precios con TSDoc (referencia a R17/D13) y batería de tests unitarios (las 4 cascadas de tela, las 3 de avío, tela sin nada → precioSugerido)
- Test de no-regresión del precosteo F7 (modelo sin amarres → resultado idéntico)
- CRUDs + pantallas con tests de componente; permisos + seed; OpenAPI + cliente sincronizados
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado; migración aplica en limpio
- Una tela con 2 proveedores (uno con precio por color) resuelve su precio según la cascada, demostrado por test
- Un avío marcado "consumo por talla" guarda sus medidas por talla
- El precosteo F7 de un modelo sin amarres NO cambió (no-regresión)
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] En `prueba` (con `SEED_ON_START=true`): abrir Catálogos → Telas → una tela → capturar 2 proveedores con precio, uno marcado "maneja precio por color" con 2 colores a precio distinto
- [ ] En un modelo, marcar un avío (ej. cierre) como "consumo por talla" y capturar medidas por talla de su curva
- [ ] En el Cliente, dar de alta 2 departamentos (ej. NIÑOS, DAMAS); intentar duplicar el nombre → error claro
- [ ] En Administración: ver conceptos de costo sembrados (tela/avíos/maquila NO desactivables) y agregar uno nuevo (ej. "lavado"); ver estados de lista sembrados
- [ ] Abrir el pre-costo F7 de un modelo viejo sin amarres → mismo resultado que antes de la etapa

**Equipo:** 1 coder + 1 reviewer. **Contingencia** (como F4-E1): si crece, cortar en E1a (migración + dominio + API) y E1b (pantallas) — mismo reviewer.

**Referencias:**
- PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md §3 y §7 (A/B/C); DECISIONES.md D13; REQUISITOS-NUEVOS.md R17/R18/R19
- `backend/prisma/schema.prisma`: `Tela` (~1050), `TelaColor` (~1107), `Avio` (~1207), `AvioProveedor` (~1266, el espejo a imitar), `ModeloTela` (~1480), `ModeloAvio` (~1508), `Talla`/`CurvaTalla` (~847/875), `Cliente` (~925), `TipoProceso` (~806, patrón catálogo-con-bandera)
- `backend/src/dominio/costos/pre-costo.ts` (el precosteo F7 que se extiende), `backend/src/contrato/permisos.ts` + `backend/prisma/seed.ts` (`sembrarPermisos`)
- docs/hoja-de-ruta/F3-etapas.md E1 (patrón "modelo de datos de toda la fase en una migración" + permisos de fase sembrados temprano)

**✅ Nota de cierre (E1a backend + E1b pantallas, 2026-07-04 — pend. verif. de Gabriel en `prueba`):**
- **Construida en 2 sub-piezas** (contingencia de la ficha): **E1a** (backend) y **E1b** (pantallas), cada una con coder + **reviewer independiente que APROBÓ**. Validaciones locales verdes: backend `typecheck`/`lint`/`format`/`test:unit` (750) + `openapi`; frontend `typecheck`/`lint`/`format`/`test` (491)/`build`. Integración (testcontainers) y e2e corren en CI.
- **Migración única aditiva** `20260704120000_f8_e1_cimientos_precios`: 15 tablas + 2 enums + columnas de amarre (`ModeloTela.idTelaProveedor`, `ModeloAvio.idAvioProveedor`+`consumoPorTalla`) — verificada línea por línea vs schema, **aditiva pura (cero DROP/ALTER)**. **El deploy a `prueba` requiere `SEED_ON_START=true`** (siembra los permisos + conceptos/estados nuevos).
- **Helper `dominio/costos/resolucion-precios.ts`**: cascada de tela (color-amarrado → amarre → color-referencia → sugerido) y de avío (amarre → más barato → referencia), con tests de las 7 rutas; `calcularPreCosto` de F7 **extendido** con fallback intacto (test de **no-regresión** verde).
- **Desviaciones vs esta ficha (justificadas):** (1) el amarre de avío se unificó a **`idAvioProveedor`** (casa con `OrdenCompraLinea.idAvioProveedor` de F4 y con `ModeloTela.idTelaProveedor`); (2) se agregaron permisos propios **`concepto-costo.*`** y **`estado-lista.*`** para el CRUD admin → **13 permisos** F8 en total (no 7).
- **Reparto de permisos** (refinado con Gabriel, ver `DECISIONES.md` F8): `*.ver` amplios; `desarrollo.administrar`/`desarrollo.precostear`/`listas.administrar` **cortados en Logística hacia abajo** (precedente `precostos.consultar` de F7); `listas.aprobar`/`listas.negociar` restringidos (D13-h).
- **Pantallas (E1b):** precios por proveedor en Tela (+ grid color×precio, importes ocultos sin `consultas.ver-importes`), medidas por talla en el BOM (checkbox → tabla de tallas de la curva, lazy, solo avíos guardados), departamentos en Cliente (con error de nombre duplicado), CRUD admin de conceptos/estados (respeta `fijo` no-desactivable). **Sin módulo nuevo al menú** (viven en pantallas existentes) → `login.spec` intacto.
- **Pendiente:** verificación de Gabriel en `prueba` (checklist de "Verificación de Gabriel" de arriba) y luego PR de `prueba` → `main`.

---

## F8-E2 · Proyectos de desarrollo (Cliente + Departamento) + desarrollos (R16) — ✅ (pend. verif. de Gabriel en `prueba`)

**Objetivo:** El concepto central de la propuesta §2: **Proyecto = 1 cliente + 1 departamento, con nombre/tema** (varios por departamento/temporada: joggers, Disney, básicos…), agrupando **desarrollos** (cada uno un modelo con dos números: el del cliente y el nuestro). Da el "dónde vivir" a todo lo que sigue (precostos E3, listas E4/E5, liga a producción E6).

**Alcance:**
- Dominio `backend/src/dominio/desarrollo/proyectos.ts` sobre las tablas creadas en E1:
  - `Proyecto(id, idEmpresa, folio BigInt — secuencia atómica A3 clave `proyecto`, idCliente, idClienteDepartamento, nombre, idTemporada?, notas?, archivado, auditoría)` — `@@unique([idEmpresa, folio])`; validación de dominio: el departamento pertenece al cliente (A1: regla en dominio, nunca en la ruta ni el frontend).
  - `Desarrollo(id, idProyecto, idModelo FK→Modelo, numeroCliente String?, apagado Boolean, apagadoEn?, apagadoPor?, motivoApagado?, notas?, auditoría)` — `@@unique([idProyecto, idModelo])`. El "número nuestro" es `Modelo.codigo` (no se duplica); el del cliente se captura aquí. **Estado del desarrollo DERIVADO, no editable** (consistente con el patrón `EstadoOrden`): `en desarrollo` (sin precosto congelado) → `cotizado` (con precosto congelado, E3) → `en lista` (en un renglón de lista, E4) → `ligado a producción` (con `DesarrolloOrden`, E6) → `apagado` (bandera manual, reversible, con motivo).
  - Crear desarrollo **ligando un modelo existente o creando uno nuevo** desde la misma pantalla (default (f) de las preguntas de fase); apagar/reactivar desarrollo = borrado suave con motivo (NUNCA borrar: el archivo del departamento es parte del valor, propuesta §4).
- Endpoints REST (`/api/desarrollo/proyectos`, `/api/desarrollo/desarrollos`) con RBAC (`desarrollo.ver`/`desarrollo.administrar`); OpenAPI + cliente regenerados.
- **Módulo nuevo en el menú: "Desarrollo"**, entre Modelos y Pedidos (el flujo natural desarrollo→cotización→pedido): entrada en `MODULOS_MENU` (`frontend/src/modulos/catalogo.ts`) + rutas en `App.tsx`. ⚠️ Lección de CI (F5-E4): **ajustar las aserciones de `login.spec`** (piso de módulos y módulos clave) en la MISMA etapa.
- Pantallas (lista + detalle): **Proyectos** (filtros: cliente, departamento, temporada, archivados; tarjeta con conteo de desarrollos por estado) y **detalle del proyecto** (sus desarrollos con estado derivado, número del cliente, acceso al modelo y — desde E3 — a su precosto).

**Entregables:**
- `proyectos.ts` con TSDoc (referencia R16/D13) y tests: folio por secuencia A3, departamento-de-otro-cliente rechazado, unique proyecto+modelo, estado derivado correcto en cada transición, apagar/reactivar con motivo y auditoría
- Pantallas con tests de componente + E2E Playwright (crear proyecto → agregar desarrollo con modelo nuevo → aparece "en desarrollo")
- `login.spec` ajustado al módulo nuevo; OpenAPI + cliente sincronizados
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde (incluido e2e) + review aprobado
- Un proyecto real (cliente + departamento + tema) con 2 desarrollos: uno de modelo nuevo y uno de modelo existente, cada uno con su número del cliente
- El folio del proyecto sale de secuencia atómica (test)
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] Login → aparece el módulo "Desarrollo" (y NO aparece para un usuario sin `desarrollo.ver`)
- [ ] Crear el proyecto "C&A / NIÑOS / básicos"; intentar usar un departamento de OTRO cliente → error
- [ ] Agregar un desarrollo ligando un modelo existente y otro creando modelo nuevo; capturar el número del cliente en ambos
- [ ] Apagar un desarrollo con motivo → queda visible en archivados, con quién/cuándo/por qué; reactivarlo
- [ ] Crear un segundo proyecto del MISMO departamento y temporada (tema distinto) → se permite (regla de Daniel)

**Equipo:** 1 coder + 1 reviewer

**Referencias:**
- PROPUESTA §2 (concepto central) y §6 (rol Desarrollo); DECISIONES.md D13; REQUISITOS-NUEVOS.md R16
- `backend/src/comun/secuencias.ts` (`siguienteFolio`), `frontend/src/modulos/catalogo.ts` (`MODULOS_MENU`), patrón lista+detalle en `docs/modulos/patron-crud.md`
- Trampa CI en CLAUDE.md §8 (login.spec al agregar módulo al menú)

**✅ Nota de cierre (2026-07-04 — pend. verif. de Gabriel en `prueba`):**
- **1 coder + 1 reviewer independiente que APROBÓ** (sin bloqueantes). Validaciones locales verdes, confirmadas también por el lead: backend `typecheck`/`lint`/`format:check`/`test:unit` (**750**); frontend `typecheck`/`lint`/`format:check`/`test` (**498**)/`build`; OpenAPI + cliente del frontend regenerados sin diff pendiente. Integración (testcontainers) y e2e corren en CI.
- **SIN migración, SIN permisos nuevos:** las tablas `Proyecto`/`Desarrollo`/`DesarrolloOrden` ya nacieron en la migración única de E1 y `desarrollo.ver`/`desarrollo.administrar` ya estaban sembrados. La etapa fue dominio → API → frontend + módulo nuevo al menú. (El deploy de la fase a `prueba` sigue requiriendo `SEED_ON_START=true` por lo de E1.)
- **Dominio** (`backend/src/dominio/desarrollo/proyectos.ts` + `desarrollos.ts`): folio de proyecto por secuencia atómica (clave `proyecto`, A3/A9) dentro de la tx; validación *departamento pertenece al cliente* en el dominio (A1, `exigirDepartamentoDeCliente`); **scope por empresa (A9) en todas las lecturas y mutaciones** (verificado sin fugas por el reviewer, con tests cross-empresa); `@@unique([idProyecto, idModelo])` → `ErrorConflicto` claro; apagar/reactivar desarrollo = borrado suave con **motivo + auditoría** (quién/cuándo/por qué), archivar/desarchivar proyecto reversible; ambas actualizaciones **idempotentes** (PATCH sin cambios → no toca `modificadoEn` ni escribe bitácora).
- **Estado del desarrollo DERIVADO** por un único helper `calcularEstadoDesarrollo` (reutilizado en los conteos, sin doble implementación ni N+1): precedencia `apagado > ligado-produccion > en-lista > cotizado > en-desarrollo`. Se implementó COMPLETO aunque en E2 las relaciones de precosto/lista/orden están vacías (se pueblan en E3/E4/E6).
- **Frontend:** módulo **"Desarrollo"** en `MODULOS_MENU` entre Modelos y Pedidos (ícono portapapeles, permiso `desarrollo.ver`; **es módulo del plan §5, NO sub-vista**); página lista+detalle (`frontend/src/modulos/desarrollo/`) con diálogos de proyecto/desarrollo, apagar-con-motivo (patrón "touched") y toggle "mostrar apagados" + reactivar. **"Modelo nuevo" lo orquesta el front** en dos pasos (crea Modelo con el endpoint existente → crea el desarrollo con el `id`); el backend recibe `idModelo` (no duplica la creación de modelos; un modelo huérfano ante fallo del 2º paso es aceptable por diseño).
- **Lecciones de CI aplicadas en la misma etapa:** `login.spec` agrega `'Desarrollo'` a los módulos representativos; `catalogo.test.ts` ajustó los conteos (14→15 planeados, 89→90 total). E2E `desarrollo.spec.ts` ejercita el ciclo crear→agregar desarrollo→apagar con motivo→reactivar.
- **Menor conocido (dejado a propósito):** al crear/editar proyecto NO se valida el `activo` del departamento en el dominio (el `DialogoProyecto` filtra inactivos en UX y la integridad no se rompe porque el depto sí es del cliente). Se revisita si estorba.
- **Pendiente:** verificación de Gabriel en `prueba` (checklist de "Verificación de Gabriel" de arriba) tras el deploy con `SEED_ON_START=true`.

---

## F8-E3 · Motor de precosteo por desarrollo: persistido, amarrado y versionable (R17/R18/R19) ⭐ — ✅ (pend. verif. de Gabriel en `prueba`)

**Objetivo:** El corazón de la fase: convertir el precosteo al vuelo de F7 en un **precosto PERSISTIDO por desarrollo**, calculado desde el BOM con los **precios amarrados** (E1), el **promedio de las medidas por talla** (R18) y **N conceptos de costo** (R19), y **versionable por congelado inmutable** (la base del re-costeo de negociación de E5). Es el motor central → **2 reviewers** (como el kardex F3-E1 y el recibo F3-E4).

**Alcance:**
- Modelo de datos (creado en E1):
  - `Precosto(id, idDesarrollo, version Int, estado [borrador|congelado], congeladoEn?, congeladoPor?, costoTotal Decimal(12,2) — derivado, se persiste al congelar, auditoría)` — `@@unique([idDesarrollo, version])`; **a lo más UN borrador por desarrollo** (regla de dominio bajo transacción).
  - `PrecostoLinea(id, idPrecosto, idConceptoCosto FK, origen [bom-tela|bom-avio|bom-bordado|manual], idTela?, idTelaProveedor?, idAvio?, idAvioProveedor?, idBordado?, descripcion, consumo Decimal(12,4)?, precioUnit Decimal(12,2), importe Decimal(12,2), notas?)` — el renglón guarda las FK del amarre para trazabilidad ("de dónde salió este precio").
- Dominio `backend/src/dominio/desarrollo/precostos.ts`:
  - `generarPrecosto(sesion, idDesarrollo)`: lee el BOM (renglones `paraPreCosto: true`, mismas banderas que F7) y arma renglones por concepto — **tela**: consumo × precio resuelto por la cascada de E1; **avíos**: consumo × precio del amarre (o más barato); para avíos `consumoPorTalla`, el consumo del precosto = **PROMEDIO SIMPLE de las medidas por talla capturadas** (default (g); es estimación — la compra exacta es de E6); **bordado**: precio del BOM; **maquila**: default desde `Modelo.maquilaBase`, editable; **conceptos manuales** (estampado, otros procesos, otros…): renglones capturables a mano contra `ConceptoCosto`. **La regalía NO es concepto del costo** (D2: la regalía va SOBRE la venta — es factor de la lista en E4).
  - `recalcularDesdeBom(...)`: refresca los renglones de origen BOM del borrador sin pisar los manuales; `editarLinea`/`agregarLineaManual` (precio del catálogo **o a mano** — decisión de Daniel "ambos").
  - `congelarVersion(sesion, idPrecosto)`: transacción A2 — valida borrador completo, persiste `costoTotal`, marca `congelado`, abre opcionalmente el siguiente borrador copiando renglones. **Las versiones congeladas NUNCA se editan ni se borran** (patrón snapshot de `RequerimientoOrden`/`CostoOrden.*Calc`; espíritu D3).
  - **REUTILIZA los helpers de `dominio/costos`** (resolución de precios de E1, redondeos): misma fórmula, distinto origen de precios (principio D1/D2). NO duplica la aritmética del pre-costo de F7 — lo compartible se extrae a helpers puros con tests.
- Endpoints REST (`/api/desarrollo/precostos/...`) con RBAC (`desarrollo.precostear` para generar/editar/congelar, `desarrollo.ver` para consultar; importes ocultos sin `consultas.ver-importes`); OpenAPI + cliente.
- Pantalla en el detalle del desarrollo: precosto vivo (renglones agrupados por concepto, editar/agregar/quitar manuales, re-calcular desde BOM con confirmación), **congelar versión**, historial de versiones (solo lectura, con fecha/quién).

**Entregables:**
- `precostos.ts` con TSDoc (R17/R18/R19, D13, D2-regalía-fuera) y batería de tests: generar desde BOM con amarres (tela por proveedor y por color), promedio de medidas por talla, conceptos manuales, re-calcular no pisa manuales, congelado inmutable (editar una versión congelada → error), un solo borrador por desarrollo, transacción A2 del congelado
- Tests de integración (testcontainers, corren en CI — NUNCA Docker local)
- Pantalla con tests de componente + E2E (generar → editar maquila → congelar → aparece v1 en historial)
- OpenAPI + cliente sincronizados
- PR a `prueba` con CI verde y **2 reviews** aprobados

**Criterio de cierre:**
- CI verde + 2 reviewers aprobaron; inmutabilidad del congelado y transacción A2 demostradas por test
- Un desarrollo con tela amarrada (precio por color), un cierre con medidas por talla y un concepto manual "estampado" produce el costo esperado, calculado a mano en la review
- El estado derivado del desarrollo pasa a "cotizado" al congelar la v1
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] En un desarrollo del proyecto de E2: generar el precosto → los renglones de tela traen el precio del proveedor amarrado (y el del color correcto), el cierre trae el promedio de sus medidas por talla
- [ ] Editar la maquila a mano y agregar un renglón manual "estampado" → el total se actualiza
- [ ] Congelar la versión → v1 en el historial, intocable (intentar editarla → no se puede); el desarrollo aparece "cotizado"
- [ ] Re-calcular desde BOM en el nuevo borrador tras cambiarle un consumo al modelo → el renglón de tela cambia, el manual de estampado sigue
- [ ] Sin permiso `consultas.ver-importes`, los importes salen ocultos

**Equipo:** 1 coder + **2 reviewers** independientes (motor central de la fase)

**Referencias:**
- PROPUESTA §3 (precosteo preciso) y §8 (decisiones: ambos/por color/abiertos/promedio); DECISIONES.md D13 y D2 (regalía fuera del costo, redondeo al alza); REQUISITOS-NUEVOS.md R17/R18/R19
- `backend/src/dominio/costos/pre-costo.ts` (`calcularPreCosto`, `incluirReceta` — la referencia de QUÉ leer del BOM) y `precio-sugerido.ts` (helper puro, el estilo a seguir)
- Patrón snapshot: `RequerimientoOrden` (schema ~3116) y `CostoOrden` `*Calc` (~4221)
- docs/modulos/costos-indicadores.md (si existe; cómo quedó F7) · docs/hoja-de-ruta/F7-etapas.md E1

**✅ Nota de cierre (2026-07-05 — pend. verif. de Gabriel en `prueba`):**
- **1 coder + 2 reviewers independientes** (motor central, como pedía la ficha). **Reviewer #1** (dominio/correctness): CAMBIOS REQUERIDOS. **Reviewer #2** (API/frontend/tests): APROBADO CON OBSERVACIONES. **Los dos hallaron por separado el mismo bloqueante** (B1). **TODOS** los hallazgos —bloqueante y no-bloqueantes— se corrigieron en la misma ronda (regla nueva de Gabriel *"un defecto conocido no es menor"*, ahora en `CLAUDE.md` §7.3). Gates locales finales verdes (corridos por el lead tras 2 caídas de infraestructura del coder): backend `typecheck`/`lint`/`format:check`/`test:unit` (**750**) + `openapi` sin drift; frontend `typecheck`/`lint`/`format:check`/`test` (**504**) + `build` + `gen:api` sin drift. Integración (17 casos) y e2e corren en CI.
- **SIN migración, SIN permisos, SIN seed nuevos:** las tablas `Precosto`/`PrecostoLinea` y el permiso `desarrollo.precostear` ya nacieron en E1. La etapa fue dominio → API → frontend + tests. (El deploy de la fase a `prueba` sigue requiriendo `SEED_ON_START=true` por E1.)
- **Dominio** (`backend/src/dominio/desarrollo/precostos.ts`): `generarPrecosto` lee el BOM (`paraPreCosto:true`, como F7) y arma renglones por concepto con los **precios amarrados de E1** (`resolverPrecioTela`/`resolverPrecioAvio`, cascada); avío `consumoPorTalla` = **promedio simple** de las medidas por talla (decisión g), con fallback a `consumoPorPrenda` si no hay tallas capturadas (sin división por cero); maquila desde `Modelo.maquilaBase` editable; **regalía FUERA del costo** (D2). `recalcularDesdeBom` refresca solo los renglones BOM sin pisar los manuales. `congelarVersion` persiste `costoTotal` y marca inmutable (D3). **A lo más UN borrador por desarrollo** y **TODA mutación** serializada por `pg_advisory_xact_lock(idDesarrollo)` (helpers `bloquearDesarrollo`/`bloquearDesarrolloDePrecosto`, con scope de empresa A9) → `exigirBorrador` se evalúa BAJO el lock (cierra el write-skew que si no violaría la inmutabilidad D3). Estado del desarrollo → `cotizado` al congelar v1 (deriva del helper de E2, no se setea a mano).
- **API** (`api/desarrollo/precostos.rutas.ts`): 8 endpoints; lecturas exigen `desarrollo.ver`, **mutaciones exigen `desarrollo.precostear` AND `desarrollo.ver`** (mutar implica poder leer → evita el 403-tras-commit); importes (`precioUnit`/`importe`/`costoTotal`) en `null` sin `consultas.ver-importes` (ocultación **server-side**; el `consumo` siempre visible).
- **Refactor de F7 sin regresión:** se extrajeron `redondear2`/`num`/`numOrNull` a `dominio/costos/decimales.ts`, compartidos por `pre-costo.ts` (F7) y E3 — F7 quedó idéntico (750 unit verdes + no-regresión de E1).
- **Frontend** (`DialogoPrecosto.tsx` en el detalle del desarrollo): renglones agrupados por concepto, editar/agregar/quitar manuales, recalcular con confirmación, congelar, historial de versiones (solo lectura). **Traza de tela FIEL** (guarda `idTelaProveedor` solo si el precio salió del amarre; null si cayó a sugerido/color-referencia — como ya hacía el avío). El `<select>` de conceptos manuales **excluye los fijos** (Tela/Avíos/Maquila/Bordado salen del BOM). `verImportes` **derivado del permiso real** (no de inferir `costoTotal===null`); sin él, los controles de precio no permiten sobrescribir a ciegas.
- **Correcciones de la review (todas aplicadas, no archivadas):** B1 (renglón manual bajo concepto fijo → rechazado en dominio + filtrado en front); traza de tela fiel; guarda de transparencia; **403-tras-mutación cerrado** (la mutación exige `ver`); **write-skew/D3 cerrado** (lock en las 6 operaciones); + cobertura de tests (cross-empresa A9, congelado inmutable en las 5 mutaciones, `consumoPorTalla` sin tallas, manual-bajo-fijo, traza fiel).
- **Punto a confirmar con Daniel (no bloquea):** el renglón manual (estampado/otros) se captura **a mano** (precio + consumo opcional), sin fuente de catálogo de precio — coherente con "conceptos abiertos" (R19), pero conviene que Daniel lo confirme.
- **Nota de proceso:** el coder tuvo 2 caídas de infraestructura (error de API + stall del watchdog), no de lógica; el trabajo aterrizó completo en disco y el **lead corrió los gates locales**. Recordatorio: integración/e2e son gate de **CI**, no local (regla Docker).
- **Pendiente:** verificación de Gabriel en `prueba` (checklist de "Verificación de Gabriel" de arriba) tras el deploy con `SEED_ON_START=true`.

---

## F8-E4 · Factores del cliente + lista de precios por Cliente+Departamento + aprobación del dueño (R20a) — ⬜ pendiente

**Objetivo:** Generar la **lista de precios** desde los precostos congelados aplicando los **factores del cliente** (margen objetivo, % descuentos, regalías, % costo de ventas), y darle al **dueño** el flujo de la propuesta §4: el sistema propone → él revisa y, **modelo por modelo, aprueba o teclea el precio** → aprobada, la toma comercial. Incluye el **impreso PDF "Lista de precios"** (R9) — el pendiente que `HOJA-DE-RUTA.md` §4 traía "sin módulo claro" queda asignado y cerrado aquí.

**Alcance:**
- Modelo de datos (creado en E1):
  - `ClienteFactores(id, idCliente, idClienteDepartamento?, margenPct, descuentosPct, regaliasPct, costoVentasPct Decimal(5,2), auditoría)` — `@@unique([idCliente, idClienteDepartamento])`; default por cliente, **override opcional por departamento** (default (a) de las preguntas de fase).
  - `ListaPrecios(id, idEmpresa, folio — secuencia A3 clave `lista-precios`, idCliente, idClienteDepartamento, fecha, idEstadoLista FK→EstadoLista, margenPct/descuentosPct/regaliasPct/costoVentasPct — SNAPSHOT copiado de `ClienteFactores` al crearla, editable en la lista, notas?, auditoría)` — la lista vive **por Cliente + Departamento** (decisión de Daniel), con fechas; los renglones pueden venir de varios proyectos de ese departamento.
  - `ListaPreciosLinea(id, idLista, idDesarrollo, idPrecosto FK — la versión congelada usada, costoUnit — snapshot, precioCalculado, precioAprobado?, aprobadoPor?, aprobadoEn?)` — `@@unique([idLista, idDesarrollo])`. `precioAprobado` lo escribe SOLO quien tenga `listas.aprobar` (el dueño): aprueba el calculado o teclea otro.
- Dominio `backend/src/dominio/desarrollo/listas-precios.ts`:
  - `crearLista(sesion, {idCliente, idClienteDepartamento, idsDesarrollo})`: valida que cada desarrollo tenga **precosto congelado** (si no, se rechaza con lista de faltantes) y pertenezca a un proyecto del mismo cliente+departamento; copia factores; calcula precios.
  - **Fórmula del precio propuesto** (helper puro con tests, estilo `calcularPrecioSugerido` de F7; partida — confirmar composición exacta con Daniel, pregunta (b)): cascada como F7/D2 — `precioBase = costo ÷ (1 − margen%)`, luego `precio = precioBase ÷ (1 − (descuentos% + regalías% + costoVentas%)/100)`, **redondeado al alza** (D2). Los factores del snapshot de la lista (editables) — recalcular al cambiarlos.
  - `aprobarLinea` / `ajustarPrecioLinea` (permiso `listas.aprobar`): registra quién/cuándo; `liberarLista`: cuando el dueño termina, el estado pasa al configurado (p. ej. sigue `abierta` para comercial) — los cambios de estado son de E5.
- Endpoints REST + RBAC (`listas.ver`/`listas.administrar`/`listas.aprobar`); importes ocultos sin `consultas.ver-importes`; OpenAPI + cliente.
- Pantallas: **Listas de precios** (lista + detalle, filtros cliente/departamento/estado/fechas); **crear lista** (elegir cliente+departamento → propone los desarrollos cotizados sin lista); **vista de aprobación del dueño** (tabla renglón por renglón: modelo, número del cliente, costo, precio calculado → botón aprobar / campo para teclear; pensada también para móvil — el dueño aprueba desde donde sea); pantalla de factores del cliente (en el detalle del Cliente).
- **Impreso PDF de la lista de precios** (R9, `@react-pdf/renderer`, patrón de los impresos F2/F4) + **export a Excel** (exceljs, patrón F5-E7/F6-E5): columnas modelo / número del cliente / precio (aprobado si existe, si no calculado).

**Entregables:**
- `listas-precios.ts` + helper de fórmula puros con TSDoc y tests: crear lista exige precostos congelados; snapshot de factores; recálculo al editar factores; aprobar/teclear solo con `listas.aprobar`; folio A3
- Impreso PDF y export Excel con tests; pantallas con tests de componente + E2E (crear lista → aprobar un renglón → PDF sale)
- OpenAPI + cliente sincronizados
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado
- Una lista real de un cliente+departamento con ≥2 desarrollos: precios calculados con los factores, uno aprobado tal cual y uno ajustado a mano por el dueño (con rastro de quién/cuándo)
- El PDF y el Excel salen y coinciden con la pantalla
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] Capturar factores del cliente (margen/descuentos/regalías/costo de ventas) y un override por departamento
- [ ] Crear la lista del proyecto de E2/E3 → los precios calculados cuadran con la fórmula (revisar 1 a mano con calculadora)
- [ ] Intentar crear una lista con un desarrollo SIN precosto congelado → error claro con el faltante
- [ ] Como usuario con `listas.aprobar`: aprobar un renglón y teclear otro precio en el segundo → ambos con rastro
- [ ] Como usuario SIN `listas.aprobar`: los botones de aprobar no existen y el endpoint rechaza
- [ ] Generar el impreso PDF y el Excel; revisarlos contra la pantalla

**Equipo:** 1 coder + 1 reviewer

**Referencias:**
- PROPUESTA §4 (lista + aprobación) y §6 (rol del dueño); DECISIONES.md D13 y D2 (redondeo al alza; regalía sobre la venta); REQUISITOS-NUEVOS.md R20
- `backend/src/dominio/costos/precio-sugerido.ts` (fórmula en cascada de F7 — el molde) y `pre-costo.ts` `listaPrecios()` (la lista por MODELO de F7, que SIGUE existiendo como consulta rápida — esta es la de CLIENTE)
- HOJA-DE-RUTA.md §4 (pendiente del impreso "Lista de precios" que aquí se cierra); patrón Excel en F6-E5/F5-E7

---

## F8-E5 · Negociación por versiones: re-costeo interactivo + acuerdos + estados (R20b) — ⬜ pendiente

**Objetivo:** Traer al sistema lo que hoy vive en Excel (propuesta §4): la **negociación como re-costeo por VERSIONES** — se cambia el desarrollo para cerrar el precio (ej. quitar bolsas ⇒ menos tela + maquila más barata ⇒ nuevo costo ⇒ nuevo precio) — registrando por modelo los **acuerdos de diseño + el precio acordado**, con **estados configurables** de la lista y el **archivo histórico por Cliente+Departamento aunque no se cierre venta**.

**Alcance:**
- Dominio (`listas-precios.ts` + `negociacion.ts`):
  - **Flujo "nueva ronda" sobre un renglón de lista**: editar el desarrollo (BOM/conceptos, con lo de E1/E3) → `recalcularDesdeBom` en el nuevo borrador → `congelarVersion` (E3) → el renglón se **re-apunta a la versión nueva** recalculando `precioCalculado` — TODO en una operación guiada; la versión y el precio anteriores quedan en la bitácora (nunca se pierden).
  - `NegociacionEvento(id, idListaLinea, idPrecostoAnterior?, idPrecostoNuevo?, precioAnterior?, precioNuevo?, acuerdo TEXT — qué se cambió/acordó, registradoPor, registradoEn)` — bitácora **inmutable** por renglón (patrón A7: se agrega, jamás se edita). Sirve también para acuerdos SIN re-costeo (solo precio acordado + nota).
  - **Cambio de estado de la lista** (`EstadoLista` configurable: abierta / en negociación / cerrada / ya pedida / …) con permiso `listas.negociar` (dueño y/o gerente comercial — decisión de Daniel §6); reglas de dominio: una lista en estado `esCierre` no admite nuevas rondas ni ediciones de renglón (reabrir = cambio de estado explícito, auditado).
  - El **archivo** es consecuencia: las listas y su negociación quedan consultables por cliente+departamento con fechas, cierren o no (propuesta: "aunque no se cierre venta, queda archivada como info del departamento").
- Endpoints REST + RBAC (`listas.negociar` para rondas/acuerdos/estados); OpenAPI + cliente.
- Pantallas: **panel de negociación del renglón** (historial de rondas: versión, costo, precio, acuerdo, quién/cuándo; botón "nueva ronda" que guía editar→re-costear→congelar→acordar); **comparador de versiones** (v anterior vs nueva: renglones del precosto que cambiaron, delta de costo y de precio); cambio de estado en el detalle de la lista; **archivo del departamento** (todas sus listas históricas con fechas y estado).

**Entregables:**
- Dominio con TSDoc y tests: la ronda re-apunta y bitacorea (anterior recuperable), evento inmutable, estados `esCierre` bloquean, permiso `listas.negociar` exigido, acuerdo-sin-recosteo
- Pantallas con tests de componente + E2E (una ronda completa: quitar un renglón del BOM → re-costear → nuevo precio → acuerdo registrado → comparador muestra el delta)
- OpenAPI + cliente sincronizados
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado
- Una negociación real reproducida: v1 con bolsas → acuerdo "se quitan bolsas" → v2 con menos tela y maquila más barata → precio nuevo → todo el rastro consultable (versiones, acuerdos, precios, quién/cuándo)
- Una lista `cerrada` rechaza nuevas rondas; reabrirla queda auditado
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] Sobre la lista de E4: abrir una ronda en un renglón — quitarle un avío al modelo, re-costear, congelar v2 → el renglón trae el precio nuevo y el comparador muestra qué cambió y los deltas
- [ ] Registrar el acuerdo ("cliente pidió quitar bolsas; precio acordado $X") → aparece en la bitácora del renglón con quién/cuándo
- [ ] Mover la lista a "en negociación" y luego a "cerrada" (con permiso); sin `listas.negociar` → no se puede
- [ ] Con la lista cerrada, intentar otra ronda → rechazada; reabrir (auditado) y verificar que sí
- [ ] Abrir el archivo del departamento: las listas históricas con fechas y estados, incluida una que nunca cerró

**Equipo:** 1 coder + 1 reviewer

**Referencias:**
- PROPUESTA §4 (negociación por versiones — "la clave") y §8 (estados configurables, versionado sí, negociación comercial y/o dueño); DECISIONES.md D13; REQUISITOS-NUEVOS.md R20
- E3 (congelado inmutable — el mecanismo que esta etapa orquesta); patrón bitácora A7 (`Bitacora` de F0)

---

## F8-E6 · Enganche con pedidos/órdenes y compras (MRP/OC) + tablero + docs + cierre de fase — ⬜ pendiente

**Objetivo:** Cerrar la promesa de la propuesta §5: **la lista NO dispara pedidos** (el pedido nace de la **OC del cliente**, flujo F2 actual) — pero al **ligar cada modelo/desarrollo a su orden de producción**, todo el registro queda pegado a la orden y **nuestra OC a proveedores hereda lo predefinido**: telas con proveedor/producto/precio (dejan de ser captura manual en el MRP) y avíos comprados por **medidas por talla × la curva real de la orden**. Cierre de fase: docs del módulo + criterio de salida demostrado en `prueba`. **SIN ETL de Access** (D13).

**Alcance:**
- **Liga desarrollo ↔ orden**: `DesarrolloOrden(idDesarrollo, idOrden @unique)` (creada en E1) — una orden liga a lo más a un desarrollo; un desarrollo puede tener N órdenes (resurtidos). Dominio: al capturar/editar una orden (F2), si el modelo pertenece a un desarrollo activo de ese cliente → **sugerir la liga** (aceptable/editable, nunca forzada); pantalla de liga también a posteriori. Al ligar: **`PedidoLinea.precio` se propone = precio acordado/aprobado** de la lista (default (e); editable — es default, no candado). El estado derivado del desarrollo pasa a "ligado a producción".
- **MRP enganchado** (`dominio/compras/mrp.ts`, cambios quirúrgicos con no-regresión):
  - **Telas**: `explosionarOrden` llena `RequerimientoOrden.idProveedorSugerido` + `precioSugerido` desde el amarre `ModeloTela.idTelaProveedor` (resolviendo `TelaProveedorColor` cuando el proveedor maneja color — el color del requerimiento/lote decide), en lugar del NULL actual. Sin amarre → sigue como hoy (captura manual). 
  - **Avíos**: el amarre `ModeloAvio.idAvioProveedor` tiene **prioridad** sobre la regla "más barato" (que queda como fallback, F4).
  - **Medidas por talla (R18)**: para avíos `consumoPorTalla`, `cantidadRequerida = Σ(medida de la talla × piezas de esa talla en la orden)` (leyendo `OrdenLineaTalla`), en lugar de `consumoPorPrenda × piezas`; tallas de la orden sin medida capturada → fallback al promedio + AVISO en el resultado (nada truena en silencio, §7 del plan).
  - `generarOCDesdeExplosion` hereda proveedor/precio sugeridos (ya lo hace para avíos); **todo editable al comprar** (decisión de Daniel).
  - **Tests de NO-REGRESIÓN de F4**: órdenes de modelos sin amarres/medidas explotan idéntico a hoy.
- **Vista 360 desde la orden**: en el detalle de la orden (F2), sección "Desarrollo" cuando hay liga — proyecto, número del cliente, precosto vigente, lista/precio acordado, acuerdos de negociación (solo lectura, permiso `desarrollo.ver`).
- **Adjuntos de la orden (R6 — confirmado por Gabriel 2026-07-04):** repositorio de archivos de apoyo (Excel/PDF/imágenes) ligados a la **orden de producción** — subir/descargar/eliminar con metadatos (nombre, tipo, fecha, quién subió), reutilizando el motor `backend/src/comun/archivos.ts` + Cloudflare R2 (mismo patrón que las fotos de modelos/bordados). Nace en F8 porque la fase arranca **sin ETL** y Daniel quiere cargar aquí los archivos viejos de apoyo por orden. Permiso: ligado al de ver/editar la orden (definir el permiso fino al construir); recordar la deuda técnica de borrado físico en R2 (CLAUDE.md §8) al implementar el "eliminar". **NO es la ficha técnica estructurada (R5), que sigue pendiente aparte.**
- **Tablero del módulo**: desarrollos por estado (en desarrollo / cotizado / en lista / ligado / apagado) filtrable por cliente/departamento/temporada — el pulso de la capa de pre-venta.
- **Cierre de fase**: `docs/modulos/desarrollo-cotizacion.md` (cómo quedó el módulo: esquema final, resolución de precios, fórmula de lista, decisiones tomadas y desviaciones de esta ficha); actualización de `docs/modulos/compras-mrp.md` (el MRP ahora sugiere telas); verificación del criterio de salida completo en `prueba`; OpenAPI + cliente regenerados.

**Entregables:**
- Dominio de liga + MRP extendido con TSDoc y tests (unit + integración): sugerencia de liga, precio propuesto al pedido, tela amarrada sugerida (con y sin color), prioridad del amarre de avío, cantidad por medidas×tallas con fallback avisado, **no-regresión F4 completa**
- Pantallas (liga, vista 360, tablero) con tests de componente + E2E del ciclo completo (desarrollo → lista aprobada → orden ligada → explosión trae la tela predefinida)
- `docs/modulos/desarrollo-cotizacion.md` + `compras-mrp.md` actualizados
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado; no-regresión F4 demostrada por test
- CRITERIO DE SALIDA DE LA FASE verificado en `prueba` (el ciclo completo del encabezado de esta ficha, con un caso real capturado por Gabriel)
- La explosión de una orden ligada muestra la tela con proveedor/precio del desarrollo y el avío por medidas por talla; la OC generada los hereda y se pueden editar
- `docs/modulos/desarrollo-cotizacion.md` publicada
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] Capturar un pedido/orden (flujo F2 normal) de un modelo con desarrollo y lista aprobada → el sistema sugiere la liga y propone el precio acordado en el renglón del pedido (editable)
- [ ] En la orden ligada: abrir la sección "Desarrollo" → se ve proyecto, versiones, acuerdos y precio
- [ ] Explosionar la orden → la tela sale con proveedor y precio predefinidos (y el precio del COLOR correcto si aplica); el cierre sale con la cantidad = medidas × curva real de la orden
- [ ] Generar la OC desde la explosión → hereda proveedor/precio; cambiarle el proveedor a un renglón → se puede (editable al comprar)
- [ ] Explosionar una orden VIEJA (modelo sin amarres) → idéntico que antes de la fase
- [ ] Abrir el tablero de desarrollos y el archivo del departamento; apagar un desarrollo que no llegó a producción
- [ ] **R6:** en una orden de producción, subir un Excel y un PDF de apoyo → verlos con quién/cuándo, descargarlos, y eliminar uno
- [ ] CIERRE DE FASE: recorrer el criterio de salida completo en `prueba` y dar el visto bueno para el PR de `prueba` → `main`

**Equipo:** 1 coder + 1 reviewer (el cambio al MRP es quirúrgico pero delicado: la review carga la mano ahí y en la no-regresión)

**Referencias:**
- PROPUESTA §5 (el punto fino: dos OC distintas) y §9 (estado real del MRP verificado); DECISIONES.md D13; REQUISITOS-NUEVOS.md R17/R18/R20
- `backend/src/dominio/compras/mrp.ts` (`explosionarOrden` ~387, `proveedorSugeridoAvio` ~190, `generarOCDesdeExplosion` ~525), `RequerimientoOrden` (schema ~3116), `OrdenCompraLinea.idAvioProveedor` (~2850), `OrdenLineaTalla`
- `PedidoLinea.precio` (snapshot del precio pactado, schema ~1692) — el punto donde el precio acordado aterriza
- docs/modulos/compras-mrp.md (cómo quedó F4 — la base que se extiende)

---

## Notas de la fase (supuestos del diseño)

ESTA FASE ES NUEVA (integrada el **2026-07-04** desde `Documentacion_MJD/PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md`; decisión **D13**, requisitos **R16–R20**, módulo **15**). **Numeración (mismo criterio secuencial que con Finanzas):** esta fase es **F8**; **Finanzas pasó de F8 a F9** y **Migración + Go-live de F9 a F10** (fichas renombradas). POSICIÓN: va justo después de **F7** porque su pieza central (el precosteo) **extiende el motor de costeo recién construido** (misma fórmula, distinto origen de precios — D1/D2) y porque sus decisiones de negocio YA están cerradas por Daniel, mientras que F9 (Finanzas) aún depende de insumos externos (corte/formato de SINUBE); **no hay dependencia técnica en ningún sentido entre F8 y F9**. SUPUESTOS Y DECISIONES DE DISEÑO: (1) **El esquema Prisma de esta ficha es PARTIDA aterrizada contra el código real (2026-07-04), no contrato** — se confirma/ajusta al construir; los nombres de campos/tablas pueden cambiar, las REGLAS (cascada de precios, congelado inmutable, estados derivados, snapshot de factores) no deberían. (2) **Toda la fase cabe en UNA migración aditiva** (patrón F3-E1) que nace en E1 junto con TODOS los permisos (`desarrollo.*`, `listas.*`) → **cada deploy de la fase a `prueba` requiere `SEED_ON_START=true`** (trampa conocida de CLAUDE.md §8). (3) **SIN ETL de Access:** el sistema viejo no tiene proyectos, ni listas por cliente, ni negociación (eso vive en Excel) — la fase arranca en cero como el EDR (D2 #11); si Daniel quiere arrancar con sus listas vigentes, se capturan a mano (pregunta (c) abajo). (4) **La regalía queda FUERA del costo** (D2): en esta fase es un **factor de la lista** (sobre la venta), nunca un concepto del precosto — coherencia total con F7. (5) **El precosteo por modelo de F7 NO se retira:** sigue como consulta rápida; el de esta fase es por DESARROLLO, persistido y versionable. Ambos comparten helpers (nada duplicado). (6) **La lista NO dispara pedidos** (propuesta §5): el pedido nace de la OC del cliente por el flujo F2 de siempre; esta fase solo LIGA y PROPONE (precio al pedido, proveedor/precio al MRP) — todo editable por el humano. (7) **Estándar visual:** el vigente al arrancar la fase — hoy teal "lista + detalle"; si el rediseño de `tarea/rediseno-frontend` ya está integrado para entonces, se sigue ese (misma estructura de pantallas). (8) **Lecciones de CI que esta fase pisa:** E2 agrega módulo al menú → ajustar `login.spec` en la misma etapa; los E2E que capturan medidas/matrices siembran tallas primero (helper `crearColorYTalla`); listados con "el primero" llevan `orderBy` determinista.

**PREGUNTAS PARA DANIEL (una sola lista, al arrancar la fase — regla de trabajo §6 de CLAUDE.md; cada una con default para que solo confirme o ajuste):**
- **(a) Factores del cliente:** ¿un solo juego por cliente, o puede variar por departamento? — **Default propuesto:** por cliente, con override opcional por departamento; y al crear cada lista se copian y ahí se pueden afinar (snapshot).
- **(b) Fórmula del precio de lista:** ¿los factores se aplican en cascada (margen primero: `costo ÷ (1−margen)`, y al resultado `÷ (1−(descuentos+regalías+costoVentas))`) o de otra forma (p. ej. sumar todos los % en un solo divisor)? — **Default propuesto:** cascada, como el precio sugerido de F7, con redondeo al alza (D2).
- **(c) Arranque:** ¿capturamos a mano sus listas de precios vigentes (del Excel) como listas históricas iniciales, o arrancamos en cero? — **Default propuesto:** en cero; las negociaciones nuevas nacen ya en el sistema.
- **(d) Moneda de los precios de insumo:** proveedores que cotizan en USD — ¿capturamos el precio ya convertido a MXN (y lo actualizan al comprar), o la fase maneja moneda + tipo de cambio? — **Default propuesto:** todo en MXN capturado (sin motor de tipo de cambio en esta fase; se anota en `condiciones` del proveedor).
- **(e) Precio al pedido:** al ligar un desarrollo a su orden, ¿el precio acordado se propone automáticamente en el renglón del pedido? — **Default propuesto:** sí, como default editable (nunca candado).
- **(f) Desarrollos sobre modelos existentes:** ¿un desarrollo puede ligar un modelo que ya existe en el catálogo (además de crear nuevos)? — **Default propuesto:** ambos.
- **(g) Promedio de medidas por talla para el precosto:** ¿promedio simple de las tallas capturadas, o ponderado por la curva? — **Default propuesto:** simple (el precosto es estimación; la compra sí usa las medidas exactas por talla de cada orden).
- **(h) ¿Quién apaga/archiva?** — **Default propuesto:** apagar desarrollos/archivar proyectos = `desarrollo.administrar`; mover estados de lista = `listas.negociar` (dueño y gerente comercial, como él decidió).
