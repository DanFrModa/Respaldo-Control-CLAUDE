# F1 — Catálogos + Modelos · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Entrega de la fase (plan §6):** Módulos 1 y 2: todos los catálogos (incl. campos por cliente D7, avíos R1 y **Proveedor enriquecido R15** en E1B) y el catálogo de Modelos con fotos en R2 y BOM completo (R2).
> **Criterio de salida:** Un modelo real con su receta completa, capturado en el ambiente de prueba.
> **Estado:** 🔄 en curso — **F1-E1 ✅ hecha** (13-jun-2026, verificada en `prueba`); sigue **F1-E2**.

## F1-E1 · Catálogos sencillos + mini-pantallas de Administración (consolidación del patrón CRUD) — ✅ hecha (13-jun-2026, en `prueba`)

> **CIERRE (13-jun-2026).** Entregado, verificado por Gabriel en `prueba` (Railway) y mergeado vía PR #15.
> - **Qué quedó:** 5 catálogos GLOBALES (Proveedor, Cortador, Temporada, EtiquetaMarca, Color — sin `idEmpresa`, decisión A9/ADR-0007) con dominio + API + frontend (patrón CRUD) + tests; y Administración (rutas REST + pantallas de Usuarios/Empresas/Roles sobre los servicios de dominio que F0 ya tenía probados; se agregó `cambiarContrasenaUsuario` reutilizando el scrypt de better-auth). Migración única `f1_e1_catalogos`, 10 permisos nuevos + seed (el rol `Basico` queda sin permisos de catálogos para la prueba de acceso), OpenAPI + cliente del frontend sincronizados. Componente de tabla con `AccionesFila<T>` genérico y helper `numeroOpcional` para campos numéricos.
> - **Decisiones:** A9 = catálogos globales ([`ADR-0007`](../arquitectura/ADR-0007-catalogos-globales-vs-por-empresa.md)); `schema.prisma` único ([`ADR-0008`](../arquitectura/ADR-0008-schema-prisma-archivo-unico.md)); **Marilyn Fitness = FR Moda** (misma empresa renombrada, NO se crea una 2ª empresa en E5/E6 — corregir esos supuestos al llegar).
> - **Ajuste de equipo (vs. el plan de 3 coders en paralelo):** se hizo en **cadena por el contrato** — 1 coder backend catálogos → 1 coder backend admin → 1 coder frontend (en 2 olas) → reviewer — porque el backend de E1 es una cadena sobre archivos compartidos (`schema.prisma`, `seed.ts`, `permisos.ts`, `openapi.json`); paralelizar ahí genera esperas/conflictos (PLANMAESTRO §9.1). El paralelismo seguro (backend vs frontend) sí se aprovechó.
> - **El CI atrapó un bug real** (corregido antes del merge, commit `7939d00`): en Zod, `.partial()` NO elimina los `.default()`, así que editar/desactivar **reseteaba campos** (proveedor.tipo, etiqueta.regalias, empresa favorita/paraIpt/paraEdr). Fix: sobrescribir esos campos como `.optional()` sin default en los esquemas de edición, + tests unitarios de esquema (sin Docker) y de regresión (integración). CI completo en verde (unit + integración testcontainers + E2E Playwright + build de imágenes Docker).
> - **Prerrequisito de despliegue confirmado:** el backend de `prueba` necesita `SEED_ON_START=true` para sembrar los permisos nuevos al arrancar (el seed es idempotente y NO resetea la contraseña del admin). Aplica a TODA etapa futura que agregue permisos.
> - **Diferido a su etapa (NO se coló en E1):** `docs/modulos/catalogos.md` completo y el ETL → F1-E6/E7; la fusión de colores → F1-E6.

**Objetivo:** Replicar el patrón CRUD de Almacenes en los 5 catálogos sin dependencias entre sí, consolidando el estándar de la fase y dejando listas las referencias que E3 necesita (Proveedor para AvioProveedor, Color para TelaColor). Además entrega las mini-pantallas de Administración (Usuarios y Empresas) sobre los servicios de dominio que F0 YA construyó y probó — sin ellas, las verificaciones de Gabriel en E1 (usuario sin permisos) y E5 (editar el UPC de la empresa) serían imposibles, porque Gabriel no programa. Va primero porque es el menor riesgo para afinar el patrón y porque aquí se congela la decisión A9 (catálogos globales vs por empresa) que condiciona TODOS los esquemas de la fase.

**Alcance:**
- Tablas Prisma (todas con auditoría A7 creadoPor/En + modificadoPor/En, activo para borrado suave, onDelete Restrict): Proveedor (nombre, razonSocial, tipo TELAS/AVIOS/SERVICIOS/SIN_CLASIFICAR, telefono, contacto, condiciones), Cortador (nombre, precioReferencia, telefonos), Temporada (nombre), EtiquetaMarca (nombre, regalias % validado 0–100), Color (nombre normalizado único, pensado para soportar la normalización de la migración). Las mini-pantallas de Administración NO requieren tablas nuevas (Usuario y Empresa ya existen del esquema F0)
- Servicios en backend/src/dominio/catalogos/: ServicioProveedores, ServicioCortadores, ServicioTemporadas, ServicioEtiquetasMarca, ServicioColores (con alta rápida: crear varios seguidos); unicidad de nombre y reglas SOLO aquí (A1)
- Endpoints REST (patrón de Almacenes: GET lista paginada/ordenada/buscada en servidor + incluirInactivos, POST, PATCH con reactivación, DELETE suave): /api/proveedores (filtro por tipo), /api/cortadores, /api/temporadas, /api/etiquetas-marca, /api/colores
- PIEZA C — Administración mínima: rutas REST delgadas /api/usuarios y /api/empresas sobre los servicios de dominio EXISTENTES de F0 (backend/src/dominio/admin/usuarios.ts, empresas.ts; roles.ts solo lectura para el selector de rol) — F0 entregó los servicios con tests de integración pero NO las rutas REST ni las pantallas (verificado: backend/src/api solo tiene almacenes/salud/sesion). Pantallas con el patrón CRUD: Administración > Usuarios (alta con rol existente del seed, edición, activar/desactivar, cambio de contraseña) y Administración > Empresas (alta, edición de datos incluido el prefijo upc — campo que ya existe del esquema F0). La administración fina de roles/permisos NO entra (queda para fase posterior, registrado)
- Permisos RBAC nuevos por catálogo (proveedores.ver/.administrar, cortadores.*, temporadas.*, etiquetas-marca.*, colores.*) + los de administración que falten (usuarios.*, empresas.*) agregados al catálogo de permisos en código (backend/src/contrato/permisos.ts) + seed idempotente + asignación a los roles que correspondan (al menos un rol del seed debe quedar SIN permisos de catálogos, para la prueba de acceso)
- Pantallas (frontend/src/modulos/, patrón completo: búsqueda con debounce, paginación/orden de servidor, toggle desactivados, reactivar sin confirmación, toasts, permisos): Catálogos > Proveedores, Cortadores, Temporadas, Etiquetas de marca, Colores (con alta rápida encadenada) + Administración > Usuarios y Empresas
- PROTOCOLO DE INTEGRACIÓN entre coders (backend/prisma/schema.prisma es UN solo archivo — verificado): (1) el esquema de las 5 tablas se diseña JUNTO al arrancar y la migración Prisma ÚNICA de la etapa la consolida un solo coder integrador al final; (2) openapi.json y frontend/src/api/esquema.gen.ts se regeneran UNA sola vez al integrar, no por pieza; (3) catálogo de permisos, seed y App.tsx se reparten por bloques pre-asignados al arrancar. Al inicio de la etapa se decide además (nota técnica corta) si se activa prismaSchemaFolder (esquema por dominios, en línea con PLANMAESTRO §3) o se mantiene el archivo único con este protocolo
- openapi.json regenerado + frontend/src/api/esquema.gen.ts re-generado + rutas en App.tsx + enlaces en la portada de Catálogos y Administración
- Decisión A9 cerrada con Gabriel y escrita (ADR corto en docs/arquitectura/): qué catálogos llevan idEmpresa y cuáles son globales — aplica al diseño de E2–E4
- Sin impresos (R9 de la fase: ver E5 y notasFase)

**Entregables:**
- Migración Prisma ÚNICA de la etapa (5 tablas) aplicable en limpio, consolidada por el coder integrador
- Código dominio + API + frontend de los 5 catálogos con tests: unitarios de dominio, integración de API contra Postgres efímero (testcontainers), componente (Vitest+Testing Library) por pantalla, y E2E Playwright del ciclo completo (crear→editar→desactivar→mostrar desactivados→reactivar→buscar) en al menos Proveedores y Colores
- Rutas REST + pantallas de Usuarios y Empresas con tests: integración de las rutas (los servicios de dominio ya tienen los suyos de F0), componente por pantalla, y E2E del flujo 'crear usuario con rol limitado → login con él → no ve los catálogos'
- backend/openapi.json regenerado y cliente tipado del frontend sincronizado en la misma PR (una sola regeneración al integrar)
- Permisos nuevos en catálogo en código + seed idempotente
- ADR de la decisión A9 (catálogos globales vs por empresa) + nota técnica de la decisión prismaSchemaFolder vs archivo único
- PR de rama de tarea a `prueba` con CI verde y visto bueno del reviewer

**Criterio de cierre:**
- CI bloqueante en verde (lint, typecheck, tests backend+frontend, build de las 2 imágenes Docker, e2e con compose)
- Reviewer independiente aprobó el diff contra patron-crud.md, A1/A7 y los docs funcionales
- OpenAPI regenerado y `npm run gen:api` del frontend sin diff pendiente
- Los 5 CRUDs + Usuarios + Empresas operando end-to-end en `docker compose up` verificados por Gabriel
- Decisión A9 firmada por Gabriel (bloquea el diseño de esquemas de E2–E4)

**Verificación de Gabriel:**
- [ ] Correr `docker compose up -d --build` y abrir http://localhost:8080; login admin
- [ ] En el menú Catálogos deben aparecer las 5 opciones nuevas; entrar a cada una y verificar lista vacía con mensaje de vacío
- [ ] Proveedores: crear 'Textiles Prueba' tipo Telas → editar el teléfono → desactivar (pide confirmación) → activar 'Mostrar desactivados' → reactivar (sin confirmación) → buscar por nombre; filtrar por tipo
- [ ] Colores: dar de alta 5 colores seguidos con el alta rápida; intentar crear 'NEGRO' dos veces → error claro del backend en toast
- [ ] Etiquetas de marca: capturar regalías 150 → el formulario y el backend lo rechazan (0–100)
- [ ] Administración > Empresas: abrir FR Moda, editar un dato (p. ej. teléfono) y guardar; verificar que el campo de prefijo UPC se ve y es editable (E5 lo usará)
- [ ] Administración > Usuarios: crear el usuario 'consulta' con un rol que NO tenga permisos de catálogos; cerrar sesión y entrar como 'consulta' → las opciones de Catálogos NO aparecen en el menú y la URL directa (p. ej. /catalogos/proveedores) responde prohibido
- [ ] Abrir http://localhost:8080/api/docs y confirmar que los recursos nuevos (5 catálogos + usuarios + empresas) aparecen documentados en el Swagger
- [ ] Abrir Proveedores con devtools en modo móvil: la tabla hace scroll horizontal y el sidebar colapsa

**Equipo:** 3 coders en paralelo (pieza A: Proveedores + Cortadores / pieza B: Temporadas + EtiquetasMarca + Colores / pieza C: Administración Usuarios + Empresas — sin tablas nuevas, solo rutas y UI sobre dominio F0) + 1 reviewer. Con protocolo de integración explícito: esquema diseñado junto al arrancar, migración única consolidada por un integrador, openapi/esquema.gen regenerados una vez, bloques pre-asignados en permisos/seed/App.tsx

**Referencias:**
- docs/modulos/patron-crud.md (completo — checklist final)
- backend/src/dominio/admin/usuarios.ts, empresas.ts y roles.ts (servicios F0 ya probados — la pieza C solo agrega rutas REST y pantallas)
- Documentacion_MJD/03-Produccion.md §Submódulo Órdenes de Compra (Proveedores: TipoProv H/T/S) y §Paso 3 Corte (Cortadores)
- Documentacion_MJD/01-Modelos.md §2 (Temporadas, EtiquetasM con Regalias) y §6 punto 4 (regalías como % para costos)
- Documentacion_MJD/04-Inventarios.md §B.2 (TelasColores.Color texto libre — motiva el catálogo Color)
- Documentacion_MJD/00-Arranque-Login-y-Menu.md y 10-Modelo-Datos-y-Usuarios.md (usuarios/roles — contexto de la pieza C)
- Documentacion_MJD/DECISIONES.md D0; MEJORAS.md A7, A9; PLANMAESTRO §3 (schema por dominios), §4 (reglas globales del modelo de datos) y §9.1 (paralelización)

---

## F1-E1B · Catálogo de Proveedores enriquecido (R15) — 🔄 backend hecho (en revisión)

> **ACTA DE DECISIÓN (`tipo` enum vs roles):** el `tipo` de E1
> (TELAS/AVIOS/SERVICIOS/SIN_CLASIFICAR) **se conserva como clasificador rápido** + **roles multivalor** (Gabriel, 13-jun-2026). Ambos coexisten: la lista filtra por `tipo` Y por `rol`.
>
> **Modelado del backend (para el reviewer y el coder de frontend):**
> - **Condición de pago** se modeló como `diasCredito Int?` (NULL o 0 = contado; >0 = días de
>   crédito). Se eligió un entero simple sobre un enum+campo porque el negocio solo distingue
>   "contado" de "N días" y así el cálculo de vencimientos de las CxP (F8) no necesita un mapeo extra.
> - **Roles** van **inline** en el body de crear/editar (`roles: number[]`), en la MISMA
>   transacción (A2). El dominio exige **≥1 rol** en alta y al reemplazar el set en edición
>   (omitir `roles` = no se tocan; mandar `[]` = error). Solo se asignan roles activos.
> - **Adjuntos** (`ProveedorArchivo` → `Archivo` de F0): `onDelete Cascade` a Proveedor y a
>   Archivo (quitar el adjunto borra su `Archivo`; el objeto R2 huérfano es inofensivo). Key R2
>   ordenada por id (`proveedores/<id>/…`), nunca por nombre. El servicio de archivos se inyecta
>   (default `servicioArchivos()` lazy) → CI verde sin R2 real (cliente S3 falso en tests).
>   `ProveedorRol`: `onDelete Cascade` a Proveedor, `Restrict` a `RolProveedor` (un rol en uso
>   no se borra; se desactiva).
> - **Reglas de captura** (en Zod + repetidas en dominio, A1): `factura=true ⇒ rfc + regimenFiscalSat`;
>   `rfc` validado (forma física 13 / moral 12), `clabe` 18 dígitos con dígito de control (módulo 10,
>   pesos 3,7,1), `moneda ∈ {MXN,USD}`, `metodoPago ∈ {PUE,PPD}`. **Sin permisos nuevos** (reusa
>   `proveedores.ver`/`.administrar`). Migración única `f1_e1b_proveedor_enriquecido` (aditiva: ADD
>   COLUMN nullable + 3 tablas), aplica en limpio. Seed idempotente de `RolProveedor` (6 roles base).
> - **Endpoints nuevos/cambiados:** `GET /api/roles-proveedor` (selector); listado `?rol=` además de
>   `?tipo=`; GET `/:id` y listado devuelven `roles[]` + `cantidadAdjuntos`;
>   `POST|GET|DELETE /api/proveedores/:id/adjuntos[/:idArchivo]`.

**Objetivo:** Enriquecer el catálogo de Proveedores que F1-E1 ya entregó (hoy: nombre, razón social, `tipo`, teléfono, contacto, condiciones) para convertirlo en el **cimiento de las CxP** de la futura fase de Finanzas (F8, decisión D12). Se agregan **roles/servicios multi-valor** (un mismo proveedor puede maquilar y cortar, o vender avíos y además maquilar — sin duplicarlo), los **campos fiscales** que el CFDI necesita, los **datos comerciales/de pago** y el **lead time** que alimenta el MRP (R3/R7 de F4), más **adjuntos en R2** (constancia de situación fiscal, contrato). Es una etapa pequeña y autocontenida que cuelga del Proveedor de E1 y del motor de archivos de F0; por eso va aquí, en cadena corta (1 coder), justo después de E1. (Se numeró **E1B** —sin renumerar E2–E7— porque se incorporó al integrar la propuesta de Finanzas; ver `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`.)

**Alcance:**
- Migración Prisma que EXTIENDE `Proveedor` (no rompe lo de E1): nuevos campos agrupados — **fiscal** (`factura` bool ¿emite CFDI?, `rfc`, `regimenFiscalSat`, `usoCfdiHabitual`, `codigoPostalExpedicion`, retenciones aplicables IVA/ISR), **contacto** (`email` para enviar la OC y recibir el XML, `direccion`; el `telefono`/`contacto` de E1 se conservan), **comercial/pago** (`condicionPago` contado o días de crédito, `moneda` MXN/USD, `formaPago`/`metodoPago` PUE/PPD, datos bancarios `banco`/`clabe`, `limiteCredito` opcional), **operativo** (`leadTimeDias` para el MRP, `notas`). Todos NULLABLE (los 443 proveedores migrados de E6 no traen estos datos; se capturan en altas/ediciones nuevas)
- Nuevas tablas: `RolProveedor` (catálogo administrable de roles/servicios: maquila-costura, corte, estampado/aplicación, vende telas, vende avíos, otros servicios) + `ProveedorRol` (N:N) — patrón idéntico a `MaquileroTipoProceso` de E2
- **Decisión a cerrar con Gabriel ANTES de codificar:** si el `tipo` enum de E1 (TELAS/AVIOS/SERVICIOS/SIN_CLASIFICAR) se conserva como clasificador rápido, se deriva de los roles, o se retira mapeando los datos de E1/E6 a roles iniciales (queda en acta)
- Adjuntos en R2: tabla puente `ProveedorArchivo` (idProveedor, idArchivo de F0, tipo: constancia/contrato/otro) usando el motor de archivos de F0 (presigned PUT/GET). Reutiliza el componente de subida de E3 si esta etapa se agenda DESPUÉS de E3; si va antes, entrega un adjuntador de PDF delgado sobre el motor R2 (sin preview de imagen)
- Reglas de dominio (A1/A2): alta/edición del proveedor con sus roles y adjuntos en UNA transacción; validación de ≥1 rol; si `factura=true` exigir RFC + régimen (regla de captura, relajada para los migrados); `clabe` con dígito de control validado
- Servicio: extiende `ServicioProveedores` de E1 (mismos endpoints `/api/proveedores` + `/api/proveedores/{id}/roles` y `/api/proveedores/{id}/adjuntos`); el permiso RBAC reutiliza `proveedores.administrar` (sin permisos nuevos, salvo que se decida uno fiscal)
- Pantalla: la ficha de Proveedores de E1 gana secciones plegables (Fiscal · Contacto · Pago · Operativo · Roles · Adjuntos); la lista gana filtro por **rol** (además del filtro por tipo de E1)
- `RolProveedor` se siembra (seed idempotente) con los roles base; openapi.json + cliente del frontend regenerados

**Entregables:**
- Migración Prisma (extensión de `proveedores` + `roles_proveedor` + `proveedor_rol` + `proveedor_archivo`) aplicable en limpio
- `ServicioProveedores` extendido con TSDoc (referencia a R15/D12 y a la PROPUESTA) y tests: unitarios (≥1 rol, regla factura⇒RFC, CLABE), integración (testcontainers) de la transacción proveedor+roles+adjuntos, E2E Playwright de capturar un proveedor con 2 roles + datos fiscales + 1 adjunto PDF
- Componente/adjuntador de archivos para PDF (o reúso del de E3) probado contra el motor R2
- Acta corta de la decisión `tipo` enum vs roles
- openapi.json + cliente sincronizados; seed de `RolProveedor`
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado; transacción A2 demostrada por test
- No-regresión: el CRUD básico de Proveedores de E1 sigue funcionando igual
- Un proveedor con roles + campos fiscales + adjunto capturable de punta a punta en compose local, verificado por Gabriel
- Decisión `tipo` vs roles firmada y registrada
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin, abrir Catálogos > Proveedores
- [ ] Editar un proveedor existente de E1: marcar roles 'maquila-costura' + 'corte'; capturar RFC, régimen, uso CFDI, CP; condición de pago a 30 días, moneda MXN, datos bancarios; lead time
- [ ] Marcar ¿factura? = sí y dejar el RFC vacío → el formulario y el backend lo rechazan
- [ ] Subir un PDF de constancia como adjunto → se ve listado; quitarlo
- [ ] Filtrar la lista por rol 'estampado' y por tipo (filtro de E1) — ambos funcionan
- [ ] Verificar en Cloudflare que el PDF quedó bajo una llave ordenada (no por nombre del proveedor)
- [ ] Confirmar que un proveedor capturado en E1 sin estos datos sigue abriendo sin error (campos vacíos)

**Equipo:** 1 coder + 1 reviewer — es una cadena (extensión de esquema → dominio → API → ficha) sobre los mismos archivos del Proveedor de E1; paralelizar generaría esperas (PLANMAESTRO §9.1)

**Referencias:**
- Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md §4 (catálogo de proveedores enriquecido — campos por grupo) y §3 (las CxP que se pararán sobre este catálogo); DECISIONES.md D12; REQUISITOS-NUEVOS.md R15
- backend/prisma/schema.prisma (model Proveedor de E1 que se extiende) y backend/src/dominio/catalogos/ (ServicioProveedores de E1)
- PLANMAESTRO §4 ('Proveedor enriquecido (R15)') y §2.3 (R2/presigned para adjuntos)
- DECISIONES.md D7 (campos por cliente — patrón paralelo) y la pantalla de Maquileros de E2 (MaquileroTipoProceso = mismo patrón N:N de roles)
- docs/modulos/patron-crud.md

---

## F1-E2 · Catálogos estructurados: maquila unificada, tallas/curvas D4 y clientes D7 — ⬜ pendiente

**Objetivo:** Construir los tres catálogos con estructura propia (relación N:N, maestro-detalle ordenado y definición de campos dinámicos), que son independientes entre sí en datos y archivos — por eso van en paralelo. Van después de E1 solo para que el patrón ya esté consolidado con lo simple; no dependen de E1 en datos.

**Alcance:**
- Tablas Prisma: Maquilero (corto, nombre, apellidos, telefonos, direccion, observaciones, obsPago, asegurado, activo — unifica Maquileros + Estampadores del viejo), TipoProceso (catálogo administrable: costura, estampado, bordado, lavado…; en F5 cada tipo se liga a un proceso de la RC), MaquileroTipoProceso (N:N)
- Tablas Prisma: Talla (etiqueta única, orden), CurvaTalla (nombre único), CurvaTallaItem (idCurva, idTalla, posición) — patrón D4 del PLANMAESTRO §4
- Tablas Prisma: Cliente (nombre, datos de contacto básicos nuevos, activo), ClienteCampo (idCliente, etiqueta única por cliente, tipo de dato, orden, activo) — SOLO la definición D7; los valores (OrdenReferencia) son de F2
- Reglas de dominio (A1/A2): alta/edición de maquilero con sus tipos en UNA transacción y validación de ≥1 tipo de proceso; talla o curva usada no se borra físico (Restrict + borrado suave); ClienteCampo nunca se borra físico si llegara a tener valores (la regla queda en dominio desde ya, documentada para F2)
- Servicios: ServicioMaquileros, ServicioTallasCurvas, ServicioClientes (incluye gestión de ClienteCampo)
- Endpoints: /api/maquileros (con filtros por tipo de proceso y activo), /api/tipos-proceso, /api/tallas, /api/curvas-talla (con sus items ordenados), /api/clientes y /api/clientes/{id}/campos — permisos RBAC nuevos por grupo + seed
- Pantallas: Maquileros (CRUD con filtros por tipo de proceso y activo; la CONSULTA usable también en móvil — directorio en campo; el botón VerEdo/estado de cuenta del viejo NO entra: es F6), Tallas y curvas de talla (pantalla NUEVA D4: catálogo de tallas ordenadas + armado visual de curvas seleccionando tallas en orden), Clientes (CRUD + sección 'Campos de referencia' por cliente — editor NUEVO sin equivalente viejo)
- PROTOCOLO DE INTEGRACIÓN (igual que E1): esquema de las 8 tablas diseñado JUNTO al arrancar; migración Prisma ÚNICA consolidada por un coder integrador; openapi.json + esquema.gen.ts regenerados UNA vez al integrar; permisos/seed/App.tsx por bloques pre-asignados
- openapi.json + cliente del frontend regenerados; rutas y enlaces de menú

**Entregables:**
- Migración Prisma ÚNICA de la etapa (8 tablas: Maquilero, TipoProceso, MaquileroTipoProceso, Talla, CurvaTalla, CurvaTallaItem, Cliente, ClienteCampo) aplicable en limpio
- 3 grupos verticales completos (dominio + API + pantallas) con tests unitarios, integración (testcontainers), componente y E2E Playwright del flujo de cada grupo (incluye: maquilero sin tipo rechazado; talla usada por curva no borrable; campo D7 con etiqueta duplicada en el mismo cliente rechazado)
- OpenAPI regenerado + cliente tipado sincronizado (una sola regeneración al integrar)
- Permisos nuevos en catálogo en código + seed
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + visto bueno del reviewer en los 3 grupos
- Transaccionalidad A2 demostrada por test de integración (alta de maquilero con tipos: o entra todo o no entra nada)
- Restricciones de borrado verificadas (Restrict en uso + borrado suave)
- Verificación de Gabriel completada en compose local

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin
- [ ] Maquileros: crear un maquilero con tipos Costura + Estampado; intentar guardar otro SIN ningún tipo → error claro; filtrar la lista por tipo 'Estampado' y por activos/inactivos
- [ ] Abrir Maquileros en devtools modo móvil: la consulta es usable (búsqueda + lista legible)
- [ ] Tallas: crear XCH, CH, M, G, XG con su orden; armar la curva 'Caballero básica' con esas 5 tallas en orden; verificar que la curva muestra las tallas EN el orden capturado
- [ ] Intentar desactivar/borrar la talla M estando usada por la curva → el sistema lo bloquea o lo limita a desactivar, con mensaje claro
- [ ] Clientes: crear un cliente y agregarle 2 campos de referencia (p. ej. 'No. de pedido del cliente' tipo texto, orden 1; 'Temporada del cliente' orden 2); editar la etiqueta de uno; desactivar el otro; intentar dos campos con la misma etiqueta en el mismo cliente → error
- [ ] Swagger /api/docs muestra los recursos nuevos; entrar con el usuario 'consulta' creado en E1 → estos menús no aparecen

**Equipo:** 3 coders en paralelo (pieza A: Maquileros + TipoProceso / pieza B: Tallas + Curvas / pieza C: Clientes + ClienteCampo) + 1 reviewer — modelos de datos y carpetas sin solape, CON el protocolo de integración de E1 para los puntos compartidos (schema.prisma único, migración consolidada, regeneración única de openapi/esquema.gen, bloques en permisos/seed/App.tsx)

**Referencias:**
- PLANMAESTRO §4: 'Tallas ilimitadas (D4)', 'Maquila unificada' y 'Campos de referencia por cliente (D7)'
- Documentacion_MJD/03-Produccion.md §Paso 4 Entrega a maquilero (Maquileros) y §Flujo paralelo Estampado/Aplicación (Estampadores)
- Documentacion_MJD/02-Pedidos.md §2 (tabla Clientes: hoy solo Id/Cliente/Activo)
- Documentacion_MJD/DECISIONES.md D4 y D7; MEJORAS.md A6 (anchos fijos → catálogo) y A7
- docs/modulos/patron-crud.md (variantes maestro-detalle parten del mismo patrón)

---

## F1-E3 · Catálogos de materiales: telas unificadas (D5), avíos R1 y bordados con foto R2 — ⬜ pendiente

**Objetivo:** Construir los tres catálogos complejos que alimentan el BOM. Va después de E1 porque Tela×Color necesita el catálogo Color y AvioProveedor necesita Proveedor. Bordados estrena el flujo real de archivos R2 (presigned URLs, motor de F0) y entrega el componente de subida de imagen que E4 reutiliza. Las decisiones de diseño se cierran con Gabriel ANTES de codificar: criterio de unificación Telas/TelasDis, lista inicial de unidades de medida/presentaciones de avíos, y el fallback del precio histórico de avíos sin proveedor identificable (insumo del ETL de E6 y del costeo de F7 — se decide AQUÍ para no descubrirlo en E6).

**Alcance:**
- Tablas Prisma: TelaCategoria; Tela UNIFICADA (nombre único, descripción, idCategoria, unidad de medida, tipo de componente D5: cuerpo/cardigan/otro, favorito, precioSugerido, paraProduccion, activo — una sola entidad que corrige la dualidad Telas/TelasDis; diseñada para que Lote/LoteComponente de F4 cuelguen de ella sin retocarla); TelaColor (idTela × idColor único, precio)
- Tablas Prisma: Avio (clave única de negocio, descripcion, unidad y presentacion — campos NUEVOS que el viejo no tiene, NULLABLE en el esquema: obligatorios solo en altas nuevas vía UI, con la validación relajada del dominio DOCUMENTADA para que el ETL de E6 pueda cargar los 629 avíos históricos sin esos datos —, favorito + cantFav, esGenerico R4, activo; campo precioReferencia SI la decisión del fallback de precio lo pide); AvioProveedor (idAvio × idProveedor, precio, condiciones, activo) — R1, base de R3/R7 en F4
- DECISIÓN DEL FALLBACK DE PRECIO (cerrar con Gabriel ANTES de congelar el esquema): Habilitacion.csv trae el precio actual por avío, pero el precio solo puede migrar a AvioProveedor cuando el proveedor (texto libre) tiene match; para los no-mapeados el precio NO se puede perder (es insumo del costeo, 01-Modelos §5). Opciones: campo Avio.precioReferencia, o un Proveedor '(por confirmar)' que reciba esos AvioProveedor — la elegida queda en el acta y el ETL de E6 la ejecuta
- Tablas Prisma: Bordado (nombre, descripcion, puntadas, precio, tipo bordado/estampado ex-BorEst, idArchivoFoto → Archivo de F0, activo)
- Servicios: ServicioTelas (CRUD + grid de colores con precio; alta con colores en UNA transacción A2; regla: la tela del BOM y la del inventario son LA MISMA entidad), ServicioAvios (alta/edición con N proveedores en transacción A2; clave única; favorito⇒cantFav obligatoria; unidad/presentación exigidas solo en el flujo de captura UI), ServicioBordados (foto vía motor de archivos R2: solicitarSubida + urlDescarga)
- Endpoints: /api/telas-categorias, /api/telas y /api/telas/{id}/colores, /api/avios y /api/avios/{id}/proveedores, /api/bordados y /api/bordados/{id}/foto (presigned PUT/GET) — permisos RBAC nuevos + seed
- Pantallas: Telas (datos generales + categoría + componente/unidad D5 + grid de colores con precio), Avíos (CRUD con tabla de N proveedores/precios R1, favorito + cantidad preestablecida, bandera 'genérico' R4), Bordados/Estampados (CRUD con tipo y foto: subir/ver/quitar con placeholder NoFoto) + Galería de fotos de bordados (consulta visual paginada; vista móvil útil)
- Componente frontend REUTILIZABLE de subida de imagen (presigned PUT + preview + manejo de error) en frontend/src/componentes — lo entrega la pieza Bordados y lo consume E4
- Tablas en modo servidor obligatorio por volumen (Bordados 2,964 / TelasColores 4,566)
- PROTOCOLO DE INTEGRACIÓN (igual que E1/E2): esquema de las 6 tablas diseñado JUNTO al arrancar; migración Prisma ÚNICA consolidada; openapi.json + esquema.gen.ts regenerados UNA vez al integrar; permisos/seed/App.tsx por bloques pre-asignados
- openapi.json + cliente regenerados

**Entregables:**
- Migración Prisma ÚNICA de la etapa (6 tablas) aplicable en limpio
- 3 grupos verticales completos con tests (unit dominio, integración testcontainers — incluida la transaccionalidad de avío+proveedores y tela+colores —, componente, E2E Playwright del CRUD de avíos con 2 proveedores y del de telas con colores)
- Componente de subida de imagen reutilizable + test de componente; prueba de integración del flujo presigned contra el motor de archivos (mock de S3 en unit; flujo real verificado a mano contra R2)
- Acta corta de las 3 decisiones de diseño (unificación de telas; unidades/presentaciones de avíos; fallback del precio sin proveedor) en docs/arquitectura/ o en la futura docs/modulos/catalogos.md
- OpenAPI + cliente sincronizados (una sola regeneración al integrar); permisos nuevos en código + seed
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- PRERREQUISITO MANUAL CUMPLIDO: R2 montado por Gabriel (bucket de prueba + token S3 + variables R2_* en Railway y en el .env local del compose) — pendiente heredado de F0, guía en docs/GUIA-RAILWAY-R2.md y checklist en docs/ESTADO-DESPLIEGUE.md; sin esto la foto de bordado no es verificable
- Las 3 decisiones (unificación de telas; unidades/presentaciones; fallback de precio) firmadas por Gabriel ANTES de congelar el esquema
- CI verde + review aprobado en los 3 grupos; transacciones A2 demostradas por test
- Avio.unidad/presentacion confirmadas NULLABLE en el esquema con la validación de UI documentada (lo verifica el reviewer — condición para que el ETL de E6 no truene)
- Subida y visualización de una foto de bordado funcionando end-to-end contra R2 real, verificada por Gabriel
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] Antes de la etapa: montar R2 con docs/GUIA-RAILWAY-R2.md (bucket prueba + token) y pasar las variables R2_* al .env local que usa el compose
- [ ] `docker compose up -d --build`, login admin
- [ ] Telas: crear la categoría 'Felpa'; crear la tela 'Felpa 220g' (componente: cuerpo, unidad: kg) y agregarle 3 colores con precios distintos en el grid; intentar repetir el mismo color en la misma tela → error
- [ ] Avíos: crear el avío 'BTN-001 Botón 4 hoyos' con unidad/presentación, marcar Favorito y verificar que exige cantidad preestablecida; agregarle 2 proveedores (de los creados en E1) con precios distintos; intentar otra clave 'BTN-001' → rechazo
- [ ] Marcar un avío como 'genérico' (R4) y confirmar que el listado lo distingue
- [ ] Bordados: crear un bordado tipo 'estampado' con puntadas y precio; subirle una foto real (jpg) → se ve la miniatura; quitar la foto → aparece el placeholder NoFoto
- [ ] Abrir la Galería de bordados, buscar el bordado y verlo con foto; repetir en devtools modo móvil
- [ ] Verificar en el dashboard de Cloudflare que el objeto quedó en el bucket bajo una llave ordenada (no por nombre del bordado)

**Equipo:** 3 coders en paralelo (pieza A: Telas + TelaCategoria + TelaColor / pieza B: Avíos + AvioProveedor / pieza C: Bordados + galería + componente de subida) + 1 reviewer — carpetas de dominio/UI sin solape y solo la pieza C toca el motor de archivos, CON el protocolo de integración para los puntos compartidos (schema.prisma único, migración consolidada, regeneración única, bloques pre-asignados)

**Referencias:**
- Documentacion_MJD/04-Inventarios.md §B.1 (telas de dos componentes) y §B.2 (Telas/TelasCategorias/TelasColores)
- Documentacion_MJD/01-Modelos.md §2 (catálogos TelasDis, Habilitacion con Favorito/CantFav, Bordados con BorEst y Foto) y §5 (el costeo usa precios de Habilitacion — motiva el fallback de precio)
- Documentacion_MJD/DECISIONES.md D5; REQUISITOS-NUEVOS.md R1 (avíos por proveedor — insight clave del dueño) y R4 (genéricos / Make-to-Order); MEJORAS.md A5 y A6
- PLANMAESTRO §2.3 (R2/presigned), §4 ('BOM completo' y motor de inventario que F4 colgará de estos catálogos)
- backend/src/comun/archivos.ts (motor R2 de F0: solicitarSubida/urlDescarga) y docs/GUIA-RAILWAY-R2.md

---

## F1-E4 · Modelos: ficha + fotos R2 + BOM completo (la pieza integradora) — ⬜ pendiente

**Objetivo:** Construir el Módulo 2 completo: el modelo con su receta (BOM de telas, avíos y bordados con las 3 banderas) y sus fotos en R2. Va al final de la cadena porque consume todos los catálogos de E1–E3. Antes de codificar se cierran con Gabriel (y Daniel si toca negocio): género del modelo (¿atributo propio? ¿de dónde se puebla?), si ModeloBordado lleva cantidad/banderas para simetría del BOM, y si la alta masiva (VerificarModelos) entra o basta el alta normal.

**Alcance:**
- Tablas Prisma: Modelo (código de negocio ÚNICO, descripcion, maquilaBase — costo que heredan las órdenes —, idTemporada, idCurvaTalla D4, idEtiquetaMarca si la decisión lo pide, género según decisión, activo/descontinuado), ModeloFoto (idModelo, idArchivo, tipo frente/espalda/otro, orden), ModeloTela (idModelo × idTela único, consumoPorPrenda, paraPreCosto/paraProduccion/paraCosto), ModeloAvio (ídem con idAvio y consumoPorPrenda), ModeloBordado (idModelo × idBordado + cantidad/banderas según la decisión)
- Servicios (backend/src/dominio/modelos/): ServicioModelos (alta/edición transaccional A2, código único, descontinuar = borrado suave), ServicioBomModelo (renglones sin duplicados por componente, banderas con nombres claros — regla 🔑 de 01-Modelos §2: un componente puede costear sin listarse en producción y viceversa, SE CONSERVA —, operación multi-renglón en UNA transacción, y 'copiar BOM desde otro modelo' en una transacción), ServicioFotosModelo (N fotos con tipo/orden vía presigned del motor R2; registra Archivo + ModeloFoto; A5: nunca por convención de nombre)
- Endpoints: /api/modelos (lista en modo servidor con búsqueda por código/descripción y filtros temporada/activo — esta lista CUBRE la consulta TodosModelos del viejo), /api/modelos/{id} (ficha con BOM y fotos), /api/modelos/{id}/bom/telas | /avios | /bordados, /api/modelos/{id}/copiar-bom, /api/modelos/{id}/fotos — permisos RBAC nuevos (modelos.ver/.administrar) + seed
- Pantalla compuesta Modelos: lista paginada de servidor (respeta 4,987 filas) + ficha con: datos generales (código, descripción, maquila base, temporada, curva de tallas, etiqueta/género según decisión), carrusel/orden de fotos con subida (componente de E3) y placeholder NoFoto, y 3 pestañas de BOM (Telas/Avíos/Bordados) con buscador de componente, consumo y banderas + botón 'Copiar BOM de…'; consulta usable en móvil
- openapi.json + cliente regenerados; ruta y menú del módulo Modelos

**Entregables:**
- Migración Prisma (5 tablas) aplicable en limpio
- ServicioModelos / ServicioBomModelo / ServicioFotosModelo con TSDoc (referencia a 01-Modelos y a R2/A5/A2) y tests unitarios + integración (testcontainers): código duplicado rechazado, BOM sin duplicados, transacción de copiar BOM (o todo o nada), banderas persistidas
- Pantalla compuesta con tests de componente + E2E Playwright: crear modelo → subir foto → capturar 1 tela + 1 avío + 1 bordado con banderas → copiar BOM a otro modelo → descontinuar → reactivar
- OpenAPI + cliente sincronizados; permisos nuevos en código + seed
- Acta de las 3 decisiones (género, ModeloBordado, alta masiva) en docs/arquitectura/ o borrador de docs/modulos/modelos.md
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- Decisiones de género / ModeloBordado / alta masiva cerradas ANTES de congelar el contrato (el reviewer lo verifica)
- CI verde + review aprobado; transacciones A2 del BOM demostradas por test de integración
- Un modelo con receta completa (telas+avíos+bordados+fotos) capturable de punta a punta en compose local, verificado por Gabriel
- Lista de modelos fluida con datos de volumen (probar con seed de cientos de filas): paginación/búsqueda de servidor, sin cargar todo en memoria
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin, entrar al módulo Modelos
- [ ] Tomar un modelo real del negocio desde 'Respaldo CLAUDE/TABLAS/Modelos.csv' (uno que tenga renglones en ModelosTela/ModelosHab/ModelosBor) y capturarlo A MANO: código, descripción, costo de maquila, temporada, curva de tallas
- [ ] Subirle 2 fotos (frente y espalda) y ordenarlas; quitar una y confirmar que aparece NoFoto donde falte
- [ ] En la pestaña Telas: agregar 2 telas con consumo y banderas distintas (una solo paraCosto, otra paraProduccion+paraCosto); en Avíos: 4–5 avíos con consumos; en Bordados: 1 bordado — comparar contra los renglones del CSV viejo
- [ ] Intentar agregar la misma tela dos veces al BOM → rechazo; intentar crear otro modelo con el mismo código → rechazo
- [ ] Crear un segundo modelo vacío y usar 'Copiar BOM de…' desde el primero → la receta completa aparece copiada
- [ ] Descontinuar el segundo modelo → desaparece de la lista por defecto; 'Mostrar desactivados' → reactivar
- [ ] Buscar por código y por palabra de la descripción; cambiar de página; abrir la ficha en devtools modo móvil (consulta legible)

**Equipo:** 1 coder + 1 reviewer — es una cadena (esquema → dominio → API → pantalla compuesta) sobre los mismos archivos; paralelizar aquí generaría esperas e interferencias (PLANMAESTRO §9.1)

**Referencias:**
- Documentacion_MJD/01-Modelos.md COMPLETO (en especial §2 banderas 🔑, §4 reglas de fotos/maquila, §6 observaciones)
- PLANMAESTRO §4 'BOM completo en el modelo (R2)' y §2.3 (presigned URLs)
- Documentacion_MJD/REQUISITOS-NUEVOS.md R2; MEJORAS.md A5 (fotos nunca por convención de nombre) y A2/A7; DECISIONES.md D4 (curva en el modelo)
- docs/modulos/patron-crud.md (la lista hereda el patrón; la ficha lo extiende)
- Componente de subida de imagen entregado en E3

---

## F1-E5 · Galería de modelos (móvil) + generador de códigos de barra por empresa — ⬜ pendiente

**Objetivo:** Cerrar las consultas de cara al negocio (la galería visual para enseñar producto fuera de la oficina — vista móvil PRIORITARIA) y la utilería de códigos EAN-13/DUN-14 parametrizada por empresa, corrigiendo el hardcodeo de prefijos UPC del form Codigo viejo. Son dos piezas pequeñas, independientes entre sí y dependientes de E4 (necesitan que Modelo exista) — por eso van aquí y en paralelo.

**Alcance:**
- Pantalla 'Galería de fotos de modelos': grid visual paginado de servidor con búsqueda y filtro por temporada/activo, foto principal con NoFoto donde falte, tap para ver la ficha; diseño móvil PRIMERO (replica la consulta ModelosFotos del viejo) — usa /api/modelos y /api/modelos/{id}/fotos de E4 (más un endpoint de listado con foto principal si hace falta)
- ServicioCodigoBarras (backend/src/dominio/modelos/ o catalogos/): servicio PURO y testeable que genera EAN-13 (prefijo UPC desde Empresa.upc — campo que YA existe en el esquema F0, ex UPCEmp, editable desde la pantalla Empresas de E1; validar que prefijo+modelo den 12 dígitos antes del verificador módulo 10 — NO hardcodear como el form Codigo viejo) y DUN-14 de caja
- Endpoint: /api/modelos/{id}/codigos-barra (devuelve EAN-13 y DUN-14 calculados para la empresa activa de la sesión) — permiso RBAC nuevo
- Pantalla 'Generador de códigos de barra': elegir modelo → muestra EAN-13 y DUN-14 renderizados como código escaneable en pantalla + el número legible; error claro si la empresa no tiene UPC capturado
- Impreso OPCIONAL (cerrar con Daniel ANTES de la etapa): etiqueta PDF del código de barras con @react-pdf/renderer — si se aprueba entra aquí (sería el primer impreso del sistema, R9); si no, el R9 de F1 queda vacío y @react-pdf se estrena en F2 con la orden
- openapi.json + cliente regenerados

**Entregables:**
- ServicioCodigoBarras con tests unitarios exhaustivos (dígito verificador módulo 10 contra códigos reales conocidos del negocio, validación de 12 dígitos, DUN-14, empresa sin UPC)
- Galería con tests de componente (estados carga/vacío/error, NoFoto) + E2E Playwright en viewport móvil
- Pantalla del generador con test de componente; impreso PDF con su test si la decisión fue sí
- OpenAPI + cliente sincronizados; permisos nuevos en código + seed
- PR a `prueba` con CI verde y review aprobado

**Criterio de cierre:**
- CI verde + review aprobado
- Un EAN-13 generado por el sistema coincide dígito a dígito con una etiqueta real del negocio (mismo prefijo de empresa y modelo) — la empresa dueña de la etiqueta debe existir en v2 con su UPC (las activas del viejo son FR Moda, ya seedeada, y Marilyn Fitness, ambas con prefijo 7500092; si falta, Gabriel la da de alta en Administración > Empresas de E1)
- Galería navegable y fluida en móvil con datos de volumen
- Decisión del impreso de etiqueta registrada (sí entró / no entra y por qué)
- OpenAPI regenerado y cliente sin diff pendiente

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`, login admin
- [ ] Abrir la Galería de modelos en devtools modo móvil (y si se puede, desde el celular en la red local): se ven las tarjetas con foto, los sin foto muestran NoFoto, la búsqueda filtra, el tap abre la ficha
- [ ] Si la etiqueta física a comparar es de una empresa que aún no existe en v2 (p. ej. Marilyn Fitness): darla de alta a mano en Administración > Empresas (pantalla de E1) con su UPC 7500092 antes de comparar
- [ ] En el Generador de códigos de barra: elegir un modelo del que el negocio tenga etiqueta impresa real y comparar el EAN-13 mostrado contra esa etiqueta física (deben ser idénticos, incluido el dígito final)
- [ ] Escanear el código en pantalla con una app lectora del celular → lee el número correcto
- [ ] Quitar temporalmente el UPC de la empresa en Administración > Empresas (pantalla entregada en E1) y volver a generar → mensaje claro de 'la empresa no tiene prefijo UPC', no un error técnico; restaurarlo
- [ ] Si el impreso se aprobó: descargar la etiqueta PDF y verificar que el código impreso también escanea

**Equipo:** 2 coders en paralelo (pieza A: galería de modelos / pieza B: ServicioCodigoBarras + pantalla + impreso opcional) + 1 reviewer — piezas sin solape de archivos; openapi/esquema.gen se regeneran una vez al integrar

**Referencias:**
- Documentacion_MJD/01-Modelos.md §3 Consultas (ModelosFotos) y §4 (NoFoto)
- Documentacion_MJD/00-Arranque-Login-y-Menu.md (menú 1: generador de códigos, form Codigo)
- Riesgo del inventario: prefijos UPC hardcodeados (7500021, 7509564, 7500092, 7500119) en el form viejo pese a existir Empresas.UPCEmp — en v2 usar backend/prisma/schema.prisma campo Empresa.upc (ya existe en F0); Empresas.csv verificado: 8 empresas, 2 activas (FR Moda y Marilyn Fitness, ambas UPC 7500092)
- PLANMAESTRO §1 (impresos @react-pdf/renderer) y §5 (acceso móvil para consultas); MEJORAS.md A9 (UPC por empresa); REQUISITOS-NUEVOS.md R9
- Pantalla Administración > Empresas entregada en E1 (edición del UPC)

---

## F1-E6 · ETL de catálogos y materiales + mapeos reutilizables + fusión de colores — ⬜ pendiente

**Objetivo:** Cargar los datos reales del sistema viejo en TODOS los catálogos (sencillos, estructurados y de materiales), producir los MAPEOS que la migración del historial reutiliza de F2 a F9 (texto→idColor, tela vieja→unificada, maquilero/estampador→unificado) y entregar la fusión de colores duplicados. Se separa del ETL de modelos/fotos (E7) porque junto eran 2–3 veces el tamaño de cualquier otra etapa; la cadena de dependencias corta limpio aquí (colores antes que telas; catálogos antes que BOM). Verificable por Gabriel en compose local.

**Alcance:**
- backend/migracion (TypeScript, lectura LATIN-1 obligatoria, PARSER CSV REAL que maneje comillas y campos multilinea — verificado: Maquileros.csv aparenta 1,711 líneas pero tiene 496 registros; contar líneas engaña —, idempotente y re-ejecutable §7, cargando vía servicios del dominio): Clientes.csv (117) → Cliente + ClienteCampo semilla 'No. de pedido del cliente' (D7, el valor Monarch migra en F2/F9); Maquileros.csv (496) + Estampadores.csv (44) → Maquilero + MaquileroTipoProceso (banderas Costura/Proceso → capacidades; estampadores → tipo estampado) con detección de duplicados por nombre a REPORTE; Proveedores.csv (443) → Proveedor (H/T/S; los de tipo vacío → 'sin clasificar'); Cortadores.csv (69); EtiquetasM.csv (81); TelasCategorias.csv (21, limpiar la de nombre vacío)
- TEMPORADAS — NO anular en silencio (§7): Temporadas.csv exportó 0 filas pero 4,984 de los 4,987 modelos tienen IdTemporadas capturado — la tabla casi seguro vive en un back-end .mdb con contraseña y la exportación quedó vacía. ANTES de cargar nada: investigar el origen (releer el .mdb al corte con access-parser, o preguntar a Daniel si las temporadas siguen vigentes y cuáles son). La decisión queda registrada y E7 la consume para mapear IdTemporadas de los modelos; si no se recupera, los 4,984 colgantes van al reporte de cuadre como inconsistencia a decisión
- EMPRESAS: alta idempotente de las empresas ACTIVAS del viejo que falten (Empresas.csv: 8 empresas, 2 activas — FR Moda ya existe del seed F0; falta Marilyn Fitness, UPC 7500092); las 6 inactivas NO migran (se registra la decisión); esto garantiza que la verificación de E5 contra etiqueta física tenga su empresa en v2
- ETL de materiales: Telas.csv (877) + TelasDis.csv (109) → Tela unificada con el criterio de mapeo decidido en E3 + REPORTE de no-mapeados para decisión (no se arreglan en silencio, §7); Texto1/Texto2 → tipo de componente D5; TelasColores.csv (4,566) → TelaColor con color normalizado; Habilitacion.csv (629) → Avio (unidad/presentación quedan NULL por capturar — el esquema de E3 lo permite explícitamente) + match difuso de Proveedor texto libre → AvioProveedor con el precio actual; el precio de los avíos SIN match de proveedor NO se pierde: se aplica el fallback decidido en E3 (Avio.precioReferencia o Proveedor '(por confirmar)') además de listarlos a reporte; Bordados.csv (2,964) → Bordado (solo el catálogo; las fotos masivas son de E7)
- ETL de tallas y colores (mapeos clave): Ordenes.csv campo Tallas (183 cadenas distintas no vacías) → Talla + CurvaTalla/Item con parser de ANCHO FIJO de 2 caracteres ('XCCHM G XG' → XC|CH|M␠|G␠|XG, confirmado en TallasMeter; NUNCA por espacios) y lista de cadenas raras a revisión humana; OrdenesDet.Color (3,628 distintos) + TelasColores.Color (2,380 distintos) → catálogo Color + TABLA DE MAPEO texto→idColor PERSISTIDA (entregable que reutilizan los ETL de E7/F2/F4/F9) — variantes tipo 'NEGRO A'/'NEGRO B' se preguntan a Daniel ANTES de fusionar
- Servicio de FUSIÓN de colores duplicados (alias) preservando referencias (aquí y no en E1, porque aquí ya existen referencias reales en TelaColor): dominio + endpoint (p. ej. POST /api/colores/fusionar) + acción 'Fusionar' en la pantalla Colores de E1
- IPT_Almacenes.csv (3: Primeras/Segundas/Tránsito) + Almacenes.csv (56 telas, 6 activos) → consolidación en la tabla Almacen de F0 (tipos PT/TELA). DECISIÓN REGISTRADA (no congelar por omisión): Primeras/Segundas se migran PROVISIONALMENTE como almacenes PT; MEJORAS.md (sección 03) marca que TipoPrendas mezcla calidad con almacén — la separación calidad-vs-almacén queda como decisión abierta a cerrar al diseñar F3 (el recibo usa TipoPrendas como destino); queda en el acta y en docs/modulos/catalogos.md (E7)
- REPORTE DE CUADRE de catálogos y materiales (§7): los conteos esperados se CALCULAN EN TIEMPO DE EJECUCIÓN leyendo los CSV fuente (v1 contado de la fuente con el parser real vs v2 contado de Postgres) — NUNCA contra números escritos a mano en el plan; los números de este desglose son solo referencia de dimensionamiento. Incluye listas de no-mapeados/duplicados/raros para decisión
- openapi.json regenerado + frontend/src/api/esquema.gen.ts re-generado (el endpoint de fusión cambia el contrato)

**Entregables:**
- ETL de catálogos y materiales en backend/migracion con comando documentado, idempotente (test que lo corre DOS veces sin duplicar), con tests de las transformaciones críticas: parser CSV con multilinea, parser de tallas de ancho fijo (incluidas las cadenas raras conocidas), normalización de color, unificación de telas, match de proveedores, fallback de precio de avíos
- Tabla de mapeo texto→idColor persistida + mapeo tela vieja→Tela unificada + mapeo maquilero/estampador→Maquilero (los reutilizan E7/F2/F4/F9)
- Reporte de cuadre v1-vs-v2 por entidad calculado en runtime + listas de no-mapeados para decisión de Gabriel/Daniel
- Servicio y acción de fusión de colores con tests (las referencias TelaColor sobreviven la fusión)
- Resolución documentada del origen de Temporadas (datos recuperados, o decisión de Daniel registrada)
- openapi.json regenerado + cliente tipado del frontend sincronizado sin diff pendiente (igual que E1–E5)
- PR a `prueba` con CI verde (incluida la migración aplicable en limpio) y review aprobado

**Criterio de cierre:**
- ETL corre dos veces seguidas con el mismo resultado (idempotencia demostrada por test y por Gabriel)
- Reporte de cuadre revisado por Gabriel: v1 (contado de los CSV en runtime) vs v2 (contado de Postgres) sin descuadres no explicados — referencia de dimensionamiento verificada al 2026-06-12: Clientes 117, Maquileros 496+44 menos duplicados detectados, Proveedores 443, Cortadores 69, Telas 877+109 unificadas, TelasColores 4,566, Avíos 629, Bordados 2,964, EtiquetasM 81 — y no-mapeados decididos o registrados
- Temporadas resuelto: datos recuperados y cargados, o decisión registrada (sin null silencioso)
- Fusión de colores demostrada: las referencias TelaColor sobreviven (test + verificación de Gabriel)
- OpenAPI regenerado y cliente sin diff pendiente
- CI verde + review aprobado

**Verificación de Gabriel:**
- [ ] Antes: resolver con Daniel (o con el .mdb al corte) el origen de Temporadas; decidir con Daniel las variantes de color 'A/B' (¿tonos o lotes?) antes de aprobar fusiones
- [ ] Local: `docker compose up -d --build` y correr el comando del ETL (documentado) DOS veces; comparar el reporte: la segunda corrida no duplica nada
- [ ] Abrir el reporte de cuadre: confirmar que los conteos v1 los calculó el ETL leyendo los CSV (no números fijos) y que v1=v2 por entidad o el descuadre está explicado; revisar las listas de no-mapeados (telas sin pareja, proveedores sin match, cadenas de talla raras, colores dudosos) y decidir/anotar con Daniel lo que toque
- [ ] Abrir Telas y verificar que una tela conocida trae su categoría, componente y colores con precio; abrir Avíos y verificar un avío con su proveedor y precio migrados, y uno SIN proveedor identificado conservando su precio por el fallback
- [ ] Abrir Maquileros y verificar que un estampador conocido quedó como maquilero con tipo 'estampado'
- [ ] En Colores: probar la acción 'Fusionar' con dos variantes obvias del mismo color y confirmar que las telas que los usaban siguen correctas
- [ ] En Administración > Empresas: confirmar que Marilyn Fitness existe con UPC 7500092
- [ ] Swagger /api/docs muestra el endpoint de fusión documentado

**Equipo:** 2 coders en paralelo (pieza A: ETL de catálogos/materiales + mapeos + reporte de cuadre, todo en backend/migracion / pieza B: fusión de colores end-to-end, en dominio/catalogos + pantalla Colores) + 1 reviewer — carpetas sin solape; openapi/esquema.gen los regenera la pieza B una vez (es la única que toca el contrato). Dentro de la pieza A el ETL es secuencial (colores antes que telas), no se subdivide

**Referencias:**
- PLANMAESTRO §7 (migración: idempotente, vía servicios del dominio, reporte de cuadre, inconsistencias a decisión — Temporadas y no-mapeados caen exactamente aquí)
- CLAUDE.md §4 (encoding LATIN-1 obligatorio; access-parser para releer .mdb si Temporadas lo exige; cómo leer el volcado viejo)
- Respaldo CLAUDE/TABLAS/*.csv (las 116 tablas reales — los CSV tienen campos multilinea entrecomillados: parsear, no contar líneas) y Respaldo CLAUDE/Respaldo CLAUDEFormularios/TallasMeter.txt (parser de ancho fijo confirmado)
- Documentacion_MJD/04-Inventarios.md §A.1 y §B.2 (IPT_Almacenes, Almacenes, TelasColores); MEJORAS.md sección 03 (TipoPrendas mezcla calidad con almacén — decisión abierta para F3) y A5/A6
- Documentacion_MJD/DECISIONES.md D7 (ClienteCampo semilla Monarch)
- Acta de decisiones de E3 (criterio de unificación de telas; fallback del precio de avíos)

---

## F1-E7 · ETL de modelos + BOM + fotos masivas + docs del módulo + cierre de fase en `prueba` — ⬜ pendiente

**Objetivo:** Cargar los 4,987 modelos con sus 10,332 renglones de BOM reutilizando los mapeos de E6, subir las fotos masivas a R2, publicar la documentación del módulo y demostrar el criterio de salida de la fase en el environment `prueba`. Es la última etapa: necesita todas las entidades, pantallas y mapeos construidos (E6 entrega colores/telas/avíos/bordados mapeados que el BOM referencia).

**Alcance:**
- ETL de modelos (backend/migracion, mismas reglas: latin-1, parser CSV real, idempotente, vía servicios del dominio): Modelos.csv (4,987) → Modelo, con IdTemporadas según la resolución de E6 (si Temporadas se recuperó, se mapea; si no, los 4,984 colgantes van al reporte de cuadre como inconsistencia a decisión — NUNCA null silencioso, §7); ModelosTela.csv (791) / ModelosHab.csv (7,163) / ModelosBor.csv (2,378) → BOM (banderas b* → para*; renglones con tela/avío/bordado inexistente → reporte de cuadre usando los mapeos de E6)
- ETL de fotos (REQUIERE la carpeta física — paso manual de Gabriel/Daniel): ~9,000 imágenes de modelos (convención código y código+'-P' de S:\...\FotosMod) → R2 + Archivo + ModeloFoto; 2,686 fotos de bordados (DirBordados) → R2 + Archivo + foto del bordado; modelos sin foto quedan con NoFoto; si la carpeta no llega a tiempo, el ETL de fotos queda probado con una muestra y registrado como pendiente explícito (no bloquea el cuadre de datos)
- REPORTE DE CUADRE completo de la fase (§7): modelos, BOM y fotos con conteos v1 calculados en runtime de los CSV/carpeta vs v2 de Postgres/R2; consolida también el cuadre de E6
- Documentación del módulo: docs/modulos/catalogos.md y docs/modulos/modelos.md (cómo quedó construido, decisiones tomadas — incluida la migración provisional de Primeras/Segundas como almacenes PT con la separación calidad-vs-almacén abierta para F3, y el destino de 'Generar listas de precios'/'Consultar PreCostos' → F7 —, mapeos producidos, cómo correr el ETL)
- Verificación funcional completa de la fase contra el criterio de salida (§6) en el environment `prueba` de Railway: un modelo real con su receta completa capturado en prueba

**Entregables:**
- ETL de modelos/BOM/fotos en backend/migracion, idempotente (test que lo corre DOS veces sin duplicar), con tests de las transformaciones críticas (banderas b*→para*, resolución de componentes vía mapeos de E6, convención de fotos código/código-P)
- Reporte de cuadre completo de la fase (catálogos + materiales + modelos + BOM + fotos) calculado en runtime
- docs/modulos/catalogos.md y docs/modulos/modelos.md publicadas
- PR a `prueba` con CI verde (migración aplicable en limpio) y review aprobado; datos reales cargados en el ambiente de prueba
- Lista de pendientes explícitos si los hay (p. ej. fotos con muestra si la carpeta no llegó, IdTemporadas a decisión)

**Criterio de cierre:**
- PRERREQUISITOS MANUALES CUMPLIDOS: environment `prueba` en Railway operando (auto-deploy de la rama prueba, BD propia, bucket R2 de prueba) según docs/GUIA-RAILWAY-R2.md y docs/ESTADO-DESPLIEGUE.md, y carpeta física de fotos conseguida (si no llegó: ETL de fotos probado con muestra y registrado como pendiente explícito, sin bloquear el resto)
- ETL corre dos veces seguidas con el mismo resultado (idempotencia demostrada)
- Reporte de cuadre revisado por Gabriel: v1 runtime vs v2 sin descuadres no explicados (referencia: Modelos 4,987, BOM 791/7,163/2,378) y el destino de IdTemporadas resuelto conforme a la decisión de E6
- CRITERIO DE SALIDA DE LA FASE: un modelo real con su receta completa capturado en el ambiente de prueba, verificado por Gabriel
- docs/modulos/ publicada; CI verde; review aprobado

**Verificación de Gabriel:**
- [ ] Antes: montar el environment `prueba` en Railway (docs/GUIA-RAILWAY-R2.md; checklist en docs/ESTADO-DESPLIEGUE.md) y conseguir con Daniel la carpeta física de fotos (S:\AplicacionesMJD\Control\FotosMod + bordados)
- [ ] Local: `docker compose up -d --build` y correr el comando del ETL (documentado en docs/modulos/catalogos.md) DOS veces; comparar el reporte: la segunda corrida no duplica nada
- [ ] Abrir el reporte de cuadre completo: v1 (calculado de los CSV) vs v2 por entidad; revisar el renglón de IdTemporadas contra la decisión de E6; revisar renglones de BOM huérfanos y decidir/anotar con Daniel
- [ ] En la app (prueba en Railway tras el merge): abrir Modelos y buscar 2–3 modelos conocidos del negocio; comparar su receta pestaña por pestaña contra el sistema viejo (mismo modelo en Access) — telas, avíos con cantidades, bordados
- [ ] Galería de modelos desde el celular contra prueba: se ven fotos reales migradas; un modelo sin foto muestra NoFoto
- [ ] CIERRE DE FASE: capturar EN PRUEBA un modelo real NUEVO de punta a punta (código, curva, fotos, 2 telas, varios avíos, 1 bordado con banderas) — esto demuestra el criterio de salida del PLANMAESTRO §6
- [ ] Dar el visto bueno para el PR de `prueba` → `main`

**Equipo:** 1 coder + 1 reviewer — el ETL de modelos es una cadena (modelos antes que BOM; modelos antes que fotos) que además consume los mapeos de E6 sobre los mismos archivos de backend/migracion; paralelizar generaría esperas (PLANMAESTRO §9.1)

**Referencias:**
- PLANMAESTRO §7 (migración idempotente, reporte de cuadre, inconsistencias a decisión) y §6 (criterio de salida F1 + 'migración desde F1')
- CLAUDE.md §4 (encoding LATIN-1; parser CSV con multilinea)
- Respaldo CLAUDE/TABLAS/Modelos.csv, ModelosTela.csv, ModelosHab.csv, ModelosBor.csv
- Documentacion_MJD/01-Modelos.md §4 (convención de fotos a reemplazar — código y código-P) y MEJORAS.md A5
- Mapeos persistidos de E6 (texto→idColor, tela vieja→unificada, maquilero/estampador→unificado) y resolución de Temporadas de E6
- docs/GUIA-RAILWAY-R2.md y docs/ESTADO-DESPLIEGUE.md (environment prueba + bucket)

---

## Notas de la fase (supuestos del diseño)

SUPUESTOS Y DECISIONES DE DISEÑO DEL DESGLOSE: (1) La consulta 'TodosModelos' del viejo queda cubierta por la lista principal del CRUD de Modelos en modo servidor — no se construye pantalla aparte; si Gabriel quiere columnas extra se ajusta en E4. (2) 'VerificarModelos' (alta masiva, nivel ≤45) NO entra por defecto: se decide con Gabriel al arrancar E4. (3) La fusión de colores duplicados se implementa en E6 (no en E1) porque ahí ya existen referencias reales (TelaColor) que la fusión debe preservar; la pantalla Colores de E1 nace con alta rápida y gana la acción 'Fusionar' en E6 — y como la fusión agrega un endpoint, E6 regenera openapi.json + esquema.gen.ts igual que las demás etapas. (4) Bordados se construye completo (catálogo + foto + galería) en E3 para estrenar el flujo R2 antes de Modelos y entregar el componente de subida reutilizable. (5) Almacenes no se reconstruye: ya existe de F0; E6 solo lo consolida vía ETL — y se registra (acta + docs/modulos/catalogos.md en E7) que Primeras/Segundas se migran PROVISIONALMENTE como almacenes PT: MEJORAS.md (sección 03) marca que TipoPrendas mezcla calidad con almacén, y esa separación queda como decisión abierta a cerrar al diseñar F3, para que no se congele por omisión. (6) F1 no crea folios de negocio (A3 no aplica: IDs autoincrementales bastan). (7) ADMINISTRACIÓN: verificado que F0 dejó los servicios de dominio de usuarios/empresas/roles con tests (backend/src/dominio/admin/) pero SIN rutas REST ni pantallas (frontend los muestra como 'Próximamente'); para que las verificaciones de Gabriel sean ejecutables (E1: usuario sin permisos; E5: editar UPC), E1 entrega mini-pantallas de Usuarios y Empresas con sus rutas REST delgadas; la administración fina de roles/permisos queda explícitamente para una fase posterior. (8) ETL EN DOS ETAPAS: el cierre original acumulaba ETL de ~16 entidades + fusión + fotos masivas + docs + cierre con 1 coder (2–3x el tamaño de cualquier otra etapa); se dividió en E6 (catálogos/materiales + mapeos + fusión, verificable en local) y E7 (modelos/BOM/fotos + docs + cierre en prueba), usando el límite de 7 etapas; la cadena corta limpio (catálogos antes que BOM). (9) CONTEOS: los números del plan son referencia de dimensionamiento verificada contra los CSV al 2026-06-12 con parser CSV real (los CSV tienen campos multilinea: Maquileros.csv aparenta 1,711 líneas pero tiene 496 registros): Cortadores 69, TelasColores 4,566, tallas 183 cadenas distintas, colores 3,628 (OrdenesDet) + 2,380 (TelasColores), Empresas 8 (2 activas). El reporte de cuadre SIEMPRE calcula v1 leyendo los CSV en runtime, nunca contra números escritos a mano (§7). (10) TEMPORADAS: Temporadas.csv exportó 0 filas pero 4,984/4,987 modelos tienen IdTemporadas — NO se anula en silencio; E6 investiga el origen (.mdb con contraseña vía access-parser, o Daniel) antes de decidir, y E7 aplica la resolución. (11) AVÍOS: Avio.unidad/presentacion nacen NULLABLE en E3 (obligatorias solo en altas nuevas vía UI) para que el ETL no truene con los 629 históricos, y el fallback del precio sin proveedor identificable (Avio.precioReferencia o Proveedor '(por confirmar)') se decide con Gabriel en E3 junto con las unidades — no se descubre en E6; el precio histórico es insumo del costeo (01-Modelos §5) y no se pierde. (12) EMPRESAS: el ETL de E6 da de alta las empresas ACTIVAS faltantes del viejo (Marilyn Fitness, UPC 7500092; FR Moda ya existe del seed F0); las 6 inactivas no migran (registrado); si E5 necesita Marilyn Fitness antes de E6, Gabriel la captura a mano en la pantalla Empresas de E1. PRERREQUISITOS MANUALES DE GABRIEL (no son etapas de código, condicionan el calendario): montar R2 (bucket prueba + token S3 + R2_*) ANTES de E3; montar el environment `prueba` en Railway ANTES del cierre de E7; conseguir con Daniel la carpeta física de fotos (S:\...\FotosMod + bordados, NO está en el repo) ANTES de E7 — si no llega, el ETL de fotos queda probado con muestra y registrado como pendiente explícito sin bloquear el cuadre. DECISIONES A CERRAR TEMPRANO (repartidas por etapa): A9 global-vs-por-empresa y prismaSchemaFolder-vs-archivo-único en E1; criterio de unificación Telas/TelasDis + unidades/presentaciones + fallback de precio de avíos en E3; género del modelo, cantidad/banderas en ModeloBordado y alta masiva en E4; etiqueta imprimible de código de barras con Daniel en E5; origen de Temporadas y significado de variantes de color 'A/B' (¿tonos o lotes?) con Daniel en E6 antes de fusionar. PARALELIZACIÓN: las etapas con varios coders (E1/E2/E3/E5/E6) reparten piezas sin solape de carpetas, pero los puntos de colisión reales (schema.prisma ÚNICO, la migración de la etapa, catálogo de permisos, seed, App.tsx, openapi.json/esquema.gen.ts) se gobiernan con el protocolo de integración escrito en cada etapa: esquema diseñado junto al arrancar, UNA migración consolidada por un coder integrador, artefactos generados regenerados UNA vez al integrar, y bloques pre-asignados en permisos/seed/App.tsx. COSAS QUE PERTENECEN A OTRA FASE (registradas para no perderse, NO entran en F1): 'Generar listas de precios' (EscojerGenero + reporte ListaPrecios) y 'Consultar PreCostos' → F7 (su origen es el pre-costo; anotado en docs/modulos/modelos.md); OrdenReferencia (valores D7) y búsqueda global → F2; matriz color×talla de captura → F2; Lote/LoteComponente y kardex de telas/avíos → F4 (el catálogo Tela de E3 se diseña para que cuelguen sin retocarlo, D3); estado de cuenta del maquilero (botón VerEdo) → F6; ligar TipoProceso a procesos de la RC → F5; el ETL del HISTORIAL de 10 años → F9 (F1 solo entrega catálogos + mapeos reutilizables); administración fina de roles/permisos → fase posterior (F1 solo entrega las mini-pantallas Usuarios/Empresas). IMPRESOS: la fase no tiene impresos R9 obligatorios; el único candidato propio (lista de precios) se pospone a F7 por depender del pre-costo; la etiqueta de código de barras y el catálogo PDF de modelos con foto son opcionales a decisión de Daniel (la etiqueta entraría en E5; el catálogo PDF no se planifica salvo pedido explícito). Si ningún impreso entra, @react-pdf/renderer se estrena en F2 con la orden de producción. RIESGO MAYOR DE LA FASE (vigilarlo en cada review): no colarse a F2/F4 — F1 es catálogos + modelo con receta; cualquier 'ya que estamos' (capturar valores D7, lotes, explosión) se rechaza en review. NOTA OPERATIVA (corregida): docs/ESTADO-DESPLIEGUE.md SÍ existe en el working tree pero está SIN COMMITEAR (aparece como '??' en git status, junto con varios .md modificados que lo referencian); el pendiente real es commitearlo en la rama tarea/f0-fundacion antes de arrancar F1, para que el checklist de los prerrequisitos manuales de E3/E7 quede versionado y no se pierda. (13) PROVEEDOR ENRIQUECIDO: F1-E1B (R15) se insertó al integrar la propuesta de Finanzas (D12, 2026-06-13) SIN renumerar E2–E7 — enriquece el Proveedor que E1 ya entregó (roles multi-valor + campos fiscales/pago/operativos + adjuntos R2) y es el cimiento de las CxP de F8; va en cadena corta (1 coder) después de E1, idealmente AGENDADA TRAS E3 para reusar su componente de subida de archivos (si va antes, entrega un adjuntador de PDF delgado sobre el motor R2 de F0). La decisión 'tipo enum de E1 vs roles multi-valor' se cierra con Gabriel al arrancar E1B. El catálogo BÁSICO de Proveedores ya está construido (F1-E1, commit a0583bb / PR #15): E1B es enriquecimiento, no alta nueva.
