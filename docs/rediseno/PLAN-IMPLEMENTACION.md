# Plan de implementación del rediseño — frontend real + backend faltante

> **Para cualquier sesión que retome esto (aunque no sea el mismo modelo):** este documento es EL plan de ejecución del rediseño del frontend de CONTROL v2. Se lee junto con:
> - **`REDISENO-FRONTEND.md`** (§1–§4 y §7) — la **spec del QUÉ**: cada pantalla como la dictaminó Daniel, con sus decisiones de negocio. Fuente de verdad funcional del rediseño.
> - **`prototipo.html`** — la maqueta interactiva congelada. Es la **maqueta de aceptación**: el front real debe quedar fiel a ella (se abre en el navegador; NO se lee completa, ver §3.5).
>
> Este documento define el **CÓMO** (fases, orden, arquitectura, brechas de backend) y lleva el **estado vivo** (§2). El §6 de `REDISENO-FRONTEND.md` ("Cómo llevarlo al código real") queda **superseded por este plan** — era una nota de otra sesión, no de Daniel.

Escrito: **7-jul-2026** · **Verificado contra `prueba` = commit `1195ce5`** (merge PR #100, F8-E6 — **F8 COMPLETA 6/6**) · Rama de trabajo: **`tarea/rediseno-r1`** (creada 7-jul desde ese commit, sin trackear; lleva encima `docs/rediseno/` completo) · Autoriza: **Gabriel** · Dictaminó el diseño: **Daniel**

---

## 1. Mandato (Gabriel, 7-jul-2026)

1. **La fase de prototipo HTML TERMINÓ.** Daniel ya no itera el HTML ni el artifact; el flujo "repo + artifact sincronizados" de `REDISENO-FRONTEND.md` §8 queda **obsoleto**. El prototipo es ahora **spec congelada**.
2. **Se implementa TODO en el front real** — incluidas las pantallas "base inicial" que Daniel no alcanzó a revisar. **Daniel revisa y pide ajustes ya sobre el front real en `prueba`** (Railway), no sobre HTML.
3. **NADA queda fuera.** Si una pieza del diseño de Daniel necesita backend que no existe (importador, campos del precosteo, scoring RC, etc.), **ese backend se construye** en la fase que le toca. Fidelidad al dictamen de Daniel: 100%.
4. **El lead decide el CÓMO** (organización del código, fases, arquitectura). El QUÉ no se toca: viene del prototipo + `REDISENO-FRONTEND.md`.
5. **El proceso del proyecto sigue intacto** (`CLAUDE.md` §7): coder + reviewer independiente, rama de tarea → PR a `prueba` → verificación de Gabriel en Railway, documentar ANTES de comitear, NADA de commit/push sin autorización expresa de Gabriel, nunca Docker local, economía de tokens.
6. **JERARQUÍA DE AUTORIDAD (Gabriel, 7-jul) — el REDISEÑO está HASTA ARRIBA; todo lo demás, abajo:**

   | Prioridad | Fuente |
   |---|---|
   | **1 · MÁXIMA — manda sobre TODO** | **El dictamen de Daniel en el REDISEÑO**: `prototipo.html` + `REDISENO-FRONTEND.md` §1–§4/§7 (cómo quiere que quede, se vea y funcione) |
   | 2 · Debajo | Todo lo demás: PLANMAESTRO, fases ya construidas (F0–F8), decisiones D#, fichas de etapa, código existente |

   No es cuestión de fechas: **aunque algo esté construido, mergeado y documentado, si contradice al rediseño, GANA el rediseño y el backend/código se adapta — siempre.** Lo que Daniel aprobó en el prototipo se trata como DECIDIDO (no se re-pregunta); solo el CÓMO técnico es del lead. Ejemplo concreto: F8-E2 dejó "el número nuestro es `Modelo.codigo`", pero en el rediseño Daniel dijo que desarrollo y producción son bases distintas con nº de producción minteado al salir a producción → se implementa lo de Daniel y F8 se adapta (ver R3/B4).

**Regla de fidelidad (cierre de cada pantalla):** antes de dar por buena una pantalla, se coteja **1:1 contra el prototipo**: columnas, filtros, botones, interacciones, textos, estados vacíos. Lo que en el proto es dato mock, en el real sale del API. Diferencias deliberadas (permisos reales, paginación, datos vivos) se anotan en la nota de cierre de la fase.

---

## 2. Estado vivo — ¿dónde vamos?

> Actualizar esta tabla al cerrar cada fase (es la que lee la siguiente sesión). Detalle de alcance en §5.

| Fase | Nombre | Estado | Nota |
|---|---|---|---|
| R1 | Piel y esqueleto (tokens verdes + shell + densidad) | ⬜ | rama `tarea/rediseno-r1` lista |
| R2 | Órdenes (centro de comando ⭐) + Avance de producción | ⬜ | — |
| R3 | Pedidos por mes + constructor + salida a producción | ⬜ | — |
| R4 | Ruta Crítica operativa (Mis pendientes + Procesos y responsables) | ⬜ | — |
| R5 | Desarrollo: re-vestir F8 + campos faltantes del precosteo | ⬜ | — |
| R6 | Notas de salida + Habilitación/surtido | ⬜ | — |
| R7 | Análisis RC (tablero de gestión + scoring/bonos) | ⬜ | — |
| R8 | Importador de pedido del cliente (motor backend NUEVO) | ⬜ | — |
| R9 | Resto de módulos + barrido final de fidelidad | ⬜ | — |

**Siguiente paso:** arrancar R1 en `tarea/rediseno-r1` (necesita OK de Gabriel).

---

## 3. Arquitectura de implementación (decisiones del lead)

### 3.1 Sistema de diseño → Tailwind v4 CSS-first
- Los tokens del prototipo (`REDISENO-FRONTEND.md` §2 tiene los **hex exactos**; el bloque fuente es el `:root`/`[data-theme]` al inicio del `<style>` de `prototipo.html`) se llevan a `frontend/src/index.css` (`@theme inline` + `:root`/`.dark`), **reemplazando** la paleta teal. Tokens a crear que el tema actual NO tiene:
  - **Riel:** `--rail-bg / --rail-fg / --rail-fg-strong / --rail-active-fg / --rail-active-bg` (verde muy oscuro, IGUAL en claro y oscuro — ancla de marca).
  - **Marca:** `--brand / --brand-hover / --brand-fg / --brand-soft / --brand-bright` (verde pino `#0e7c47` en claro, `#22b56c` en oscuro — NO teal).
  - **Semánticos separados de la marca:** `--ok / --warn / --crit / --info` + sus `*-soft` (chips, semáforos, badges).
- **Tipografía:** stack de sistema (`ui-sans-serif, system-ui…`) + mono (`ui-monospace…`) con `font-variant-numeric: tabular-nums` en **toda** columna numérica. Decidido: stack de sistema (es el look del prototipo que Daniel aprobó, §1.6); Inter se retira.
- **Densidad:** filas de tabla ~28–34 px, base 13 px, radios 9 px, chips 20 px.
- **Teal hardcodeado fuera de tokens** (7 archivos, migrar en R1): `lib/tono.ts` · `components/dominio/visuales.tsx` · `components/Marca.tsx` · `modulos/calidad/DialogoDefecto.tsx` · `modulos/administracion/BitacoraPagina.tsx` · `paginas/Inicio.tsx` · `paginas/Login.tsx`.

### 3.2 Shell y navegación
- **`CascaronSistema.tsx`** se rehace: riel oscuro izquierdo (~216 px, colapsable a 62 px con **⌘B**, estado persistido), topbar con **⌘K**, empresa activa, **badge de alertas RC** (endpoint `contarAlertas` de `ruta-critica/bandeja.ts` ya existe), `AlternadorTema`, usuario.
- **`NavegacionModulos.tsx`**: grupos con desplegables de **2 niveles** (padre con hijos SOLO despliega; el hijo navega; hijo principal primero).
- **`catalogo.ts`** (`MODULOS_MENU`): se reestructura a los grupos aprobados — estructura EXACTA en `REDISENO-FRONTEND.md` §3.1 y en `const NAV` de `prototipo.html:1018-1072`: `Resumen · OPERACIÓN (Desarrollo▾: Modelos·Pre-costeos·Cotizaciones/Listas | Pedidos | Producción▾: Órdenes·Notas de salida | Ruta Crítica | Calidad▾: Auditorías·Auditores) · INVENTARIOS (Inventario PT·Telas·Avíos·Compras/MRP) · COMERCIAL (Clientes▾: Catálogo·Listas de precios·Ventas | Proveedores) · FINANZAS (CxC·CxP) · ANÁLISIS (Análisis RC·Costos·EDR·Indicadores) · SISTEMA (Catálogos base▾: Colores·Tallas·Temporadas·Tipos de proceso·Almacenes | Procesos y responsables | Usuarios y accesos)`. Se **conserva el gate por permisos** por entrada y las claves/rutas existentes donde se pueda (las sub-páginas actuales de "Catálogos" se re-cuelgan de sus grupos nuevos: Telas/Avíos → Inventarios, Clientes/Proveedores → Comercial, colores/tallas/… → Sistema).
- **⌘K**: paleta de comandos (componente `Command` de shadcn/cmdk). En R1 encuentra módulos; en R2 se le suma el **buscador global** de órdenes/pedidos (backend F2-E4 ya existe).

### 3.3 Kit de componentes de dominio compartidos
Se construyen una vez (R1–R2) en `frontend/src/components/dominio/` y se reúsan en todas las pantallas:
- **TablaDensa** — restyling de `ui/table` + `ListaDetalle.tsx` (motor de ~todas las listas): densidad nueva, `tabular-nums`, barra de totales al pie, filas expandibles/agrupadas.
- **ComboboxBuscable** — typeahead insensible a acentos/mayúsculas ("óscar" → Óscar Jiménez/Hernández/López; "her" → solo Hernández). Para proveedores, maquileros, modelos de desarrollo, avíos.
- **MatrizColorTalla** — lectura y captura con **candado** (solo colores/tallas de la orden), totales por fila/columna/gran total, validación cuadra/faltan/sobran.
- **CajonDetalle** — cajón deslizante (sobre `ui/sheet`) + variante **panel persistente** (Órdenes) con encabezado + botones + matriz **sticky** (petición explícita de Daniel).
- **StepperEtapas** — las 5 etapas del avance con estado/color.
- **ChipEstado / BadgePunto / Semaforo** — chips de estatus uniformes sobre los tokens semánticos.
- **CadenaTrazabilidad** — cadena navegable `OC cliente → Desarrollo → Lista → Pedido → OP`.
- **KpiTiles** — tarjetas de indicadores (Resumen, Mis pendientes, Análisis RC).

### 3.4 Reglas técnicas transversales
- **Lógica de negocio SOLO en `backend/src/dominio`** (A1); toda agregación/tablero se calcula **en el servidor** (SQL/dominio), nunca pivotando en el cliente (lección F5-E7).
- Migraciones Prisma **aditivas**; permisos nuevos → seed idempotente (**recordar `SEED_ON_START=true`** en `prueba`); folios por secuencia atómica (A3); transacciones multi-tabla (A2); auditoría A7; existencias por suma de movimientos bajo lock (D3).
- **OpenAPI regenerado** en cada cambio de backend y cliente del front sincronizado en la misma fase (jamás leer los archivos generados completos).
- **e2e:** toda fase que toque menú/pantallas ajusta sus specs en la misma fase (lecciones F5-E4: `login.spec` asierta el menú; specs de matriz siembran una talla primero; lecturas "el primero" llevan `orderBy` determinista). El CI es bloqueante.
- Cada fase = **rama nueva desde `prueba`** (`tarea/rediseno-r1`, `-r2`, …), secuencial: R(n+1) arranca cuando R(n) esté mergeada a `prueba` y verificada por Gabriel.

### 3.5 Protocolo de ejecución por fase (para CUALQUIER sesión/modelo que la ejecute)

> Este plan está pensado para que una fase la ejecute una sesión distinta (incluso con un modelo más económico) sin contexto previo. El que ejecuta NO necesita leer todo: solo su pedazo.

1. **Leer (y NADA más que esto):** este doc §1–§3 + la sección de SU fase en §5 + los § de `REDISENO-FRONTEND.md` que su fase cita + las filas de la tabla §4 que su fase construye. El prototipo NO se lee completo (~383 KB / 5,230 líneas): se abre en el navegador para VER la pantalla y se `Grep`ean solo las funciones `vXxx()`/datos de esa vista (mapa de vistas: `const VISTAS` en `prototipo.html:4867`).
2. **Verificar las brechas antes de construir:** la tabla §4 tiene evidencia `archivo:línea` verificada al commit `1195ce5` — el código avanza; confirmar con Grep que la brecha sigue abierta antes de escribir código (no re-construir lo que otra fase ya cerró).
3. **Equipo:** 1 coder + 1 reviewer independiente (agentes normales, `SendMessage` para ciclos de corrección — economía de tokens, `CLAUDE.md` §7.4). El lead no escribe código de producción.
4. **Al terminar:** cotejo 1:1 de cada pantalla contra el prototipo → ajustar e2e → regenerar OpenAPI + cliente → **actualizar la tabla §2 de este doc con nota de cierre** → preguntar a Gabriel si comitear (TODO junto, docs incluidas) → con su OK, preguntar si abrir PR a `prueba`.
5. **Nunca:** commit/push sin OK expreso de Gabriel · Docker local · leer archivos generados completos · lógica de negocio en el front.

### 3.6 Corrida nocturna AUTORIZADA (Gabriel, 7-jul-2026) — modo autónomo encadenado

> Gabriel autorizó EXPRESAMENTE este modo para la(s) sesión(es) que ejecuten el rediseño mientras él duerme. **Sustituye al punto 4-5 de §3.5 SOLO en lo siguiente** (todo lo demás del plan sigue igual):

1. **Por fase:** construir con 1 coder + 1 reviewer independiente (2 reviewers en piezas críticas de backend); el reviewer tiene la última palabra. Cotejo 1:1 contra el prototipo + e2e ajustados + OpenAPI/cliente regenerados ANTES de dar la fase por lista.
2. **Al cerrar la fase:** actualizar §2 de este doc (estado + nota de cierre) → **comitear TODO junto** (docs incluidas) en la rama de trabajo → **pushear** → **abrir el PR a `prueba`** (o actualizar el MISMO PR si ya existe).
3. **Vigilar el CI del PR** (GitHub Actions): si falla → diagnosticar, corregir, pushear al MISMO PR, repetir hasta VERDE. Con CI verde → **arrancar la SIGUIENTE fase** (R1→R2→R3→… en el orden de §5) sobre la misma rama/PR, y así sucesivamente hasta donde alcance.
4. **Si una fase no logra CI verde** tras intentos razonables: revertir SUS commits (el PR se queda verde con las fases completas), documentarlo en §2 con el diagnóstico, y continuar con lo que no dependa de ella (o detenerse dejando reporte claro).
5. **Límites que NO cambian:** NUNCA hacer merge del PR (eso es de Gabriel), NUNCA push directo a `prueba` ni `main`, NUNCA Docker local. Las preguntas abiertas usan los defaults de §6 sin esperar respuesta.
5b. **PROHIBIDO TRABARSE Y PROHIBIDO PREGUNTARLE A GABRIEL (regla suya, 7-jul):** él está dormido — cualquier pregunta congela TODO. Ante CUALQUIER fallo, duda o decisión: diagnostica → decide tú (con los defaults del §6, la jerarquía del §1.6 y el criterio del reviewer) → actúa → documenta la decisión en la nota de cierre. Si algo se atora de verdad (dependencia rota, test imposible, etc.): aplica el punto 4 (revertir esa pieza, documentar, seguir con lo demás). NUNCA termines el turno esperando respuesta del usuario; termina solo cuando ya no haya nada más que puedas avanzar, dejando el reporte del punto 6.
6. **Al parar (por término o bloqueo):** dejar en la descripción del PR el resumen por fase (qué entregó, CI, pendientes) y §2 al día — es lo primero que Gabriel lee al despertar. Recordatorio para su deploy: si alguna fase agregó permisos/seed, `prueba` necesita `SEED_ON_START=true`.

---

## 4. Brechas de backend — AUDITORÍA VERIFICADA contra `prueba` @ `1195ce5` (7-jul-2026, F8 completa)

> Dos auditorías independientes (Fable 5): la 1ª sobre el árbol del 5-jul, la 2ª re-verificó el delta F8-E3–E6 sobre el `prueba` final. Esta tabla es el resultado NETO.

### 4.a Lo que YA EXISTE (el rediseño lo consume, NO lo re-construye)

| Pieza | Dónde (evidencia) |
|---|---|
| Referencias del cliente por orden (D7, generaliza "monarch") | `OrdenReferencia`/`ClienteCampo` `schema.prisma:2104/979` · `guardarReferenciasOrden` `produccion/ordenes.ts:816` |
| Crear Orden desde renglón de pedido con matriz color×talla en transacción | `crearOrden` `produccion/ordenes.ts:541-592` (`Orden.idPedidoLinea`; orden suelta bloqueada por diseño) |
| Movimientos multi-proveedor por etapa (corte/envío/recibo/aplicación) | F3: `dominio/produccion/etapas·recibos` (cada movimiento con proveedor + desglose) |
| **Adjuntos en la ORDEN** (¡cerrado por F8-E6!) | `OrdenArchivo` `schema.prisma:2055-2074` · `produccion/adjuntos-orden.ts` (presigned R2 + borrado físico) · front `ordenes/AdjuntosOrden.tsx` |
| **Precosteo persistido y versionado** (F8-E3) | `desarrollo/precostos.ts` — `generarPrecosto:414 / recalcularDesdeBom:497 / agregarLineaManual:559 / editarLinea:630 / eliminarLineaManual:694 / congelarVersion:747` (locks, D3, a lo más 1 borrador) |
| **Factores + listas + aprobación renglón por renglón + PDF/Excel** (F8-E4) | `cliente-factores.ts` (`resolverFactores:112`) · `listas-precios.ts` (`crearLista:267 / editarFactoresLista:428 / aprobarLinea:490 / ajustarPrecioLinea:534`) · cascada con redondeo al alza `costos/precio-lista.ts:50-79` |
| **Negociación por versiones + acuerdos inmutables + estados** (F8-E5) | `negociacion.ts` (`registrarRonda:112 / registrarAcuerdo:211 / cambiarEstadoLista:259`) · `NegociacionEvento` `schema.prisma:5291` · unique un-desarrollo-una-lista |
| **Liga desarrollo↔orden + expediente 360 + tablero** (F8-E6; manual, desde la orden) | `liga-orden.ts` (`ligarOrden:102 / quitarLiga:201 / sugerenciaLigaOrden:242 / expedienteOrden:337 / tableroDesarrollos:486`) · front `ordenes/SeccionDesarrolloOrden.tsx`, `desarrollo/TableroDesarrollos.tsx` |
| **MRP hereda amarres proveedor/precio + medidas por talla** (F8-E6) | `compras/mrp.ts:40-46/121-140/237-378` (desde el BOM del Modelo) |
| Telas multi-proveedor + precio por color | `TelaProveedor.manejaPrecioPorColor`/`TelaProveedorColor`/`TelaColor.precio` `schema.prisma:4899-4937/1135` |
| Avíos multi-proveedor | `AvioProveedor` `schema.prisma:1292` + `ModeloAvio.idAvioProveedor Int?` `:1564` |
| Medidas/consumo por talla en avíos + **promedio simple** al precostear (R18) | `ModeloAvio.consumoPorTalla` + `ModeloAvioTalla` `schema.prisma:1559/4954` · `precostos.ts:124-126,174-177` |
| Motor RC completo: DAG N:M (3 niveles), condicionales, duración por catálogo, CPM backward, calendario | `ProcesoDep/PlantillaRutaDep/RutaOrdenDep` `schema.prisma:3503/3654/3889` · `CondicionAplicabilidad(soloSiLlevaAplicacion)` `:3389` · `DuracionPorTipoTela/PorAplicacion/FactorCantidad` `:3693/3717/3671` · `cpm.ts:140` |
| Bandeja RC por usuario/rol + badge + capturadoPor/En (D11) + auto-avance por eventos F3/F4 | `bandeja.ts:226/282` · `RutaOrden.capturadoPorId/capturadoEn/origenCaptura` `schema.prisma:3861-3865` · `autoAvance.ts` |
| Notas de salida con orden POR LÍNEA, borrador→confirmada→cancelada, kardex | `NotaSalida/NotaSalidaLinea.idOrden` `schema.prisma:3249/3321` · `notas/notas-salida.ts:459/584/723` |
| Concentrado RC planeado-vs-real + export | `concentrado.ts:368` (F5-E7) |
| KPIs con vistas materializadas (incl. "entrega a tiempo") + pg-boss | F7-E3 (`kpi-refrescar`, 7 vistas) — R7 REUTILIZA esto |
| Buscador global (⌘K de datos) | F2-E4 |
| Permisos ya sembrados relevantes | `ordenes.precio-maquila:150 / ver-precio-real-maquila:176 / ver-costos:170 / habilitacion:160` · `desarrollo.* / listas.*` `permisos.ts:1049-1072` (listas.* YA cableados; los de precio de orden y habilitación AÚN sin endpoint) |

### 4.b Lo que FALTA (el rediseño LO CONSTRUYE, en su fase)

| # | Brecha | Estado verificado | Evidencia | Fase |
|---|---|---|---|---|
| B1 | **Edición de precios de la orden** (maquila/aplicación; venta vive en `PedidoLinea.precio`) con permiso + rastro de quién/cuándo/proveedor | Columnas `maquilaOrd/aplicacionOrd` y permisos existen; `actualizarOrden` NO las toca; ningún endpoint las escribe | `schema.prisma:1929-1931` · `ordenes.ts:619-658` · `permisos.ts:150/176` | R2 |
| B2 | **Consulta de lista para el centro de comando** (13 columnas: cortado, nº maquileros, OC de tela ✓/falta, ref. cliente, pedido `-F`, mes entrega) con filtros en servidor | No existe como endpoint único; los datos viven regados (etapas F3, `RequerimientoOrden`/OC F4, refs D7) | `produccion/consultas.ts` (base) | R2 |
| B3 | **OC del cliente** como campo VIVO en `Pedido` + snapshot en cada `Orden` + **adjuntos en PEDIDO** (el documento original) | Solo vestigio ETL de lectura `Pedido.idOrdCompraV1` (sin FK, nadie lo escribe); `Pedido` sin relación a `Archivo` | `schema.prisma:1720-1724/1691-1737` | R3 |
| B4 | **Salida a producción** — flujo "Generar OP" desde el pedido: liga `DesarrolloOrden` automática + **nº interno de producción minteado** en la 1ª OP del modelo + herencia visible | `ligarOrden` existe pero MANUAL desde la orden y NO mintea nada; `Desarrollo.idModelo` apunta a un `Modelo` normal (F8-E2 decidió "número nuestro = `Modelo.codigo`"). La aclaración de Daniel del 7-jul ("desarrollo y producción son bases distintas") **GANA por precedencia (§1.6)** — se implementa como en el proto | `liga-orden.ts:102-165` · `schema.prisma:5045` | R3 |
| B5 | **RC automática al crear la OP** (sin botón manual; el manual queda como re-programar) | `crearOrden` no invoca RC; sigue `POST /ruta-critica/ordenes/:id/programar` | `ordenes.ts:541-611` · `programacion.rutas.ts:112-125` | R3 |
| B6 | **Constructor de pedido interno** con selector de DESARROLLOS (no texto libre) + "Generar OP" con matriz desde el pedido | El front de pedidos sigue siendo el CRUD teal de F2 (`DialogoPedido/EditorRenglones`), sin desarrollo/matriz/liga | grep vacío en `modulos/pedidos/` y `dominio/pedidos/` | R3 |
| B7 | **# de operaciones de costura** (dato del modelo) + **tabla configurable de rangos de dificultad** (rango ops → nombre + días de costura) que alimenta el CPM | No existe campo ni catálogo (lo más cercano: `DuracionPorCantidad`, que es otra cosa) | grep `numeroOperaciones/dificultad` vacío · `schema.prisma:3695` | R4 (catálogo+motor) · R5 (captura) |
| B8 | **Corte como costo separado de la maquila** en el precosteo | Único concepto de mano de obra = `maquila` (desde `Modelo.maquilaBase`); no hay concepto `corte` sembrado. El corte NO lleva proveedor (decisión Daniel) | `precostos.ts:225-240` · `seed.ts:694-700` | R5 |
| B9 | **Maquilero (costura) cotizado** en el desarrollo/precosteo (siembra el default del programa de producción, cambiable) | `lineaMaquila` es solo importe; sin FK a proveedor | `precostos.ts:225-240` · `schema.prisma:5149-5186` | R5 |
| B10 | **Secuencia de estampado antes/después/FLEXIBLE** por modelo + reprogramación en vivo de la ruta para las flexibles | Sin campo; el bordado entra "una vez, sin secuencia"; RC tiene la dependencia condicional pero no la elección | `precostos.ts:203-216` · `schema.prisma:3389` | R4 (RC) + R5 (captura) |
| B11 | **Avío "por medida" con PRECIO por medida** (medidas agrupadas dentro del avío padre; precosteo usa el promedio de PRECIOS; la compra desglosa medida×talla) | Existe promedio del CONSUMO por talla; el precio es único por cascada. Falta el catálogo de medidas-con-precio | `precostos.ts:124-177` · `schema.prisma:4954` | R5 |
| B12 | **Calculadora de negociación "en vivo"** (editar TODOS los elementos: tela+consumo, corte, maquila, procesos, avíos — quitar/agregar) | La ronda solo ADOPTA una nueva versión de precosto; los renglones BOM (tela/avío/bordado) NO son editables en el precosto (solo vía BOM del modelo + recalcular) | `negociacion.ts:112-148` · `precostos.ts:654-658` | R5 |
| B13 | **Habilitación/surtido por orden** (requerido = receta × piezas vs **enviado = Σ notas CONFIRMADAS** por orden×avío, con extras y sobre-surtido >100%) | Existe `estatusMaterialesOrden` pero cruza contra COMPRAS/recepciones, no contra notas; permiso `ordenes.habilitacion` sin uso | `compras/mrp.ts:637-681` · `permisos.ts:160` | R6 |
| B14 | **Scoring/desempeño por persona** (% en tiempo, vencidos, reacción, tendencia, calificación 0-100, bono semanal) + **alertas predictivas (CPM forward pass)** + riesgo por cliente + carga vs desempeño | Solo existe el concentrado planeado-vs-real; nada por `capturadoPorId`; el CPM solo tiene backward pass | `concentrado.ts:368` · `cpm.ts:140` | R7 |
| B15 | **Importador de pedidos del cliente** (plantillas de mapeo por cliente, parseo Excel, amarre `Desarrollo.numeroCliente`↔modelo del cliente, alta transaccional pedido+OPs+RC) | No existe NADA (confirmado; `MapeoMigracion` es del ETL de Access, otra cosa). Ancla ya disponible: `Desarrollo.numeroCliente` | grep vacío · `schema.prisma:5019` | R8 |
| B16 | **Tech pack / adjuntos del DESARROLLO** (PDFs de referencia + fotos del proto §4.7) | `Archivo` solo se relaciona con Proveedor/Bordado/ModeloFoto/OrdenArchivo; `Desarrollo` sin adjuntos (las fotos del MODELO sí existen, `ModeloFoto`) | `schema.prisma:441-462` | R5 |
| B17 | Administrar **avío↔proveedor desde el lado del PROVEEDOR** ("avíos que surte" con asignar/quitar) | El vínculo `AvioProveedor` existe; verificar en fase si falta el endpoint/pantalla del lado proveedor | `schema.prisma:1292` | R9 |

> **Coordinación con el PLANMAESTRO:** F8 quedó **COMPLETA (6/6)** el 6-jul — este plan ya NO la construye, la **re-viste** (R5) y le agrega los campos que Daniel dictó DESPUÉS de su cierre (B7–B12, B16). La brecha B15 (importador) es **función NUEVA fuera del plan maestro**: al cerrar R8 se registra formalmente (PLANMAESTRO §5 / HOJA-DE-RUTA). Las pantallas de **CxC/CxP (Finanzas)** NO se construyen aquí porque su backend entero es la fase **F9**: el proto de esas vistas queda como **spec de UI para F9** (no es exclusión, es secuencia). Backlog que este plan NO toca (ya registrado en `HOJA-DE-RUTA.md` §4): borrado físico R2 en modelos/bordados/proveedores, precio propuesto en el renglón del pedido, nombres de usuario en vez de ids en vistas.

---

## 5. Fases (alcance detallado)

> Cada fase lista: **Objetivo · Frontend (pantalla por pantalla, con su § en `REDISENO-FRONTEND.md`) · Backend (brechas B# que construye, con el diseño propuesto) · Archivos clave · e2e · Cierre**. Todas incluyen: cotejo 1:1 contra el prototipo, OpenAPI + cliente regenerados, actualización de §2, y las reglas de §3.4/§3.5.

---

### R1 — Piel y esqueleto ⬅ SIGUIENTE
**Objetivo:** TODA la app (las ~100 pantallas actuales) cambia de cara de un golpe, sin tocar lógica. Las pantallas aún no rediseñadas quedan "verdes y densas" con su layout actual hasta que les toque su fase.

**Frontend:**
1. **Tokens** (§3.1): reemplazo completo de la paleta en `index.css` (claro/oscuro), tokens nuevos de riel y semánticos, tipografía, densidad. Migrar los 7 archivos con teal hardcodeado.
2. **Primitivos** `components/ui/*` (16 archivos: button, table, dialog, sheet, badge, input…) re-vestidos a la densidad/estética nueva.
3. **Shell** (§3.2): riel oscuro colapsable ⌘B + topbar (⌘K de módulos, empresa, badge RC con `contarAlertas`, tema, usuario) + Login e Inicio re-vestidos.
4. **Menú** (§3.2): `catalogo.ts` reestructurado a los grupos nuevos con desplegables; permisos intactos; rutas existentes re-colgadas.
5. **Motor de listas**: `ListaDetalle.tsx` + `detalle.tsx` densificados; nace **TablaDensa**, **ChipEstado**, **CajonDetalle**, **KpiTiles**.

**Backend:** ninguno.
**Archivos clave:** `frontend/src/index.css` · `modulos/CascaronSistema.tsx` · `modulos/NavegacionModulos.tsx` · `modulos/catalogo.ts` (+ su `catalogo.test.ts`) · `modulos/ListaDetalle.tsx` · `modulos/detalle.tsx` · `components/ui/*` · los 7 de teal.
**e2e:** `login.spec` (asierta el menú → reescribir contra los grupos nuevos), cualquier spec que navegue por "Catálogos".
**Cierre:** app entera en verde/denso claro+oscuro sin regresión funcional; menú agrupado; CI verde (backend intacto: `test:unit` 775 / front `test` 532 + los ajustes).

---

### R2 — Órdenes (centro de comando ⭐) + Avance de producción
**Objetivo:** la pantalla donde viven todo el día (§4.2) y el registro de avance (§4.3). Prioridad #1 de Daniel: filtrado ágil.

**Frontend:**
- **Órdenes** (§4.2): filtros arriba (buscador OP/modelo/**pedido del cliente** + selects Cliente/Maquilero/Estampador/Empresa/OC-tela + **tabs de mes de entrega**); tabla densa con las **13 columnas exactas** (Empresa · No. OP · Modelo · Pedido del cliente [D7, NO "monarch"] · Cant. ordenada · Cant. cortada [gris/ámbar/verde] · Maquilero · Nº maquileros [badge ×2] · Estampador · Pedido interno `-F` [liga a Pedidos] · OC de tela [✓ folio verde / "falta" ámbar] · Mes entrega · Cliente); **panel de detalle persistente** a la derecha: encabezado + botones + **matriz sticky SIN scroll** (petición Daniel), matriz color×talla con totales, **precios** venta/maquila/aplicación (editar 🔒 con permiso; "real" verde vs "referencia" gris; capturado por · fecha · proveedor), Tela y compra, foto del modelo, tiles a Modelo/Habilitación/Notas de salida/O.C./Ruta crítica/Consumo de tela/Imprimir/Modificar (los existentes navegan de verdad; Habilitación queda placeholder hasta R6). La `SeccionDesarrolloOrden` (expediente 360 F8-E6) se integra re-vestida.
- **Avance de producción** (§4.3): doble clic en la fila (y botón) → stepper 5 etapas (corte / entrega maquila / recibo maquila / entrega aplicación / recibo aplicación); **cada etapa = LISTA de movimientos** (proveedor + fecha + desglose color×talla + tipo Estampado/Bordado en aplicación) — el backend F3 ya lo modela así; captura con **candado** color×talla; resumen en dos bloques (Costura / Estampado-Bordado); al registrar, la RC se marca sola (auto-avance F3→F5 ya existe).
- Nacen **ComboboxBuscable**, **MatrizColorTalla**, **StepperEtapas**; ⌘K gana el buscador global (F2-E4).

**Backend:**
- **B1 — precios de la orden:** endpoint `PATCH /ordenes/:id/precios` (maquila/aplicación) gated `ordenes.precio-maquila` (visibilidad `ver-precio-real-maquila`); **tabla nueva `OrdenPrecioEvento`** (idOrden, campo, precioAnterior, precioNuevo, idProveedor?, capturadoPorId, capturadoEn, nota) — historial inmutable estilo `NegociacionEvento`; migración aditiva; SIN permisos nuevos.
- **B2 — consulta del centro de comando:** endpoint de lista con filtros/orden en servidor que agrega por orden: cortado (etapas F3), nº maquileros distintos (entregas), OC de tela (vía `RequerimientoOrden`→`OrdenCompraLinea`), referencia del cliente (D7), folio de pedido interno, mes de entrega. Extiende `produccion/consultas.ts`.

**e2e:** specs de órdenes y producción; sembrar color+talla para la matriz (lección F5-E4).
**Cierre:** Daniel opera su día completo en `prueba`: filtra, ve matriz sin scroll, registra un avance multi-proveedor, captura un precio real y queda el rastro.

---

### R3 — Pedidos por mes + constructor + salida a producción
**Objetivo:** el flujo de captura completo (§4.1): pedido interno `-F` → "Generar OP" por modelo → OP con matriz + RC sola + trazabilidad.

**Frontend:**
- **Pedidos** (§4.1): tabs Ene–Dic+Todos; **tabla agrupada expandible** (cabecera del pedido `-F` con Cant./Importe total + chip de OC del cliente; debajo los modelos con Cant./Precio/Importe/No. orden/Corte/Estatus); barra de totales (pedidos, órdenes, piezas, cortado, % avance, importe — gated `pedidos.importes`); filtros Cliente/Año/Empresa/estatus/Cantidades; click en modelo → cajón con detalle + "Va junto con".
- **Constructor de pedido interno** (panel): encabezado (cliente · empresa · fecha · **OC del cliente** + su archivo) + N modelos, cada uno elegido con **ComboboxBuscable de DESARROLLOS** (muestra nombre + proyecto/cliente; ancla `Desarrollo.numeroCliente`) + cantidad + precio (importe en vivo, folio `-F` automático). **SIN color×talla** (aclaración Daniel 7-jul).
- **"Generar OP" por modelo:** panel donde **NACE la matriz color×talla** (validación cuadra/faltan/sobran) → al confirmar: OP creada + liga al desarrollo + RC programada sola (toast) + **nº interno de producción** minteado si es la 1ª OP del modelo. Banner "salió a producción" + botón "Ver desarrollo".
- **CadenaTrazabilidad** en pedidos y órdenes: `OC cliente → Desarrollo → Lista → Pedido → OP` (nodos clicables; históricos sin ficha avisan "modelo anterior al módulo de Desarrollo").
- Los botones "Nueva orden" de Órdenes/Resumen abren ESTE constructor (la OP no se crea suelta — el backend ya lo exige).

**Backend:**
- **B3:** `Pedido.ocCliente String?` (captura viva) + snapshot `Orden.ocCliente` copiado al crear la OP (queda amarrado aunque el pedido se reorganice — petición Daniel) + **`PedidoArchivo`** (patrón `OrdenArchivo`, presigned R2, borrado físico). Migración aditiva.
- **B4:** operación **`salidaAProduccion`** en dominio (transacción A2): valida desarrollo↔modelo↔cliente, crea la `Orden` (reusa `crearOrden`), crea `DesarrolloOrden` (reusa `ligarOrden`), y **mintea el nº interno de producción** la 1ª vez que el modelo sale a producción — **decidido por Daniel en el proto** (§1.6): uno por modelo, reusable entre sus OPs, distinto del folio de OP y del nº de desarrollo. Modelado técnico (del lead): `Modelo.numeroProduccion Int? @unique` por secuencia atómica A3; `Modelo.codigo` queda como el nº de desarrollo. `PedidoLinea.idDesarrollo Int?` para la traza directa.
- **B5:** al crear la OP se **encola la generación de la RC** vía el outbox de eventos (patrón del auto-avance F3→F5 — la captura NUNCA espera al CPM); el endpoint `programar` manual queda como *re*-programar (`rc.programar`).
- **B6:** endpoints del constructor (candidatos de desarrollo, alta de pedido con OC, generar OP) — el CRUD F2 se conserva por debajo.

**e2e:** pedidos + flujo nuevo completo (pedido → generar OP → matriz → RC existe).
**Cierre:** flujo demostrable en `prueba` de punta a punta con la cadena de trazabilidad navegable.

---

### R4 — Ruta Crítica operativa
**Objetivo:** la RC como **guía diaria por persona** (§4.9) + su configuración (catálogo de procesos) en Sistema.

**Frontend:**
- **"Mis pendientes"** (ruta directa del menú "Ruta Crítica"): KPIs (Vencidas · Para hoy · Esta semana · Total); toggle **Agrupar por: Urgencia / Proceso** (petición Daniel 7-jul — en Proceso: todos los Corte juntos, con conteo de vencidos/hoy, para resolver en tanda); secciones ⚠ Vencidas (rojo) / Para hoy (ámbar) / Próximas (verde, "+N más adelante"); cada renglón: proceso + orden·modelo·cliente·entrega + badge fecha/holgura + tag **⟳ auto / ✋ manual** + botón **"Registrar"/"Marcar hecho"**; selector **"Viendo pendientes de:"** (solo admin/supervisor — usuario normal ve lo suyo, deriva de sus roles RBAC). Fuente: `consultarBandeja` existente + presentación.
- **Panel "Ruta de la orden"** (clic en cualquier pendiente): línea de tiempo con semáforo Hecho/Vencido/Hoy/Programado, badge "tú", renglones "⟳ Automático — al registrar: …"/"✋ Manual"; para órdenes **flexibles**, control **[Estampar ANTES] / [Estampar DESPUÉS]** que reprograma al momento.
- **"Procesos y responsables"** (bajo SISTEMA — config de baja frecuencia, decisión Daniel): catálogo `ProcesoDef` con #secuencia · proceso · área · responsables (N:M) · **columna Tiempo** (expandible: por dificultad / por catálogo / reglas) · **"¿Cómo se completa?"** (Automático+evento / Manual) · **dependencias editables** ("Espera a / Detona" con chips ✕ + agregar; el "Detona" se recalcula solo) · card **"Tabla de dificultad por # de operaciones"** (CRUD de rangos) · card de duraciones por catálogo (velocidad de recepción de tela: `DuracionPorTipoTela` ya existe). Los procesos del proto son default de ejemplo — la lista real la define Daniel con la operación (el catálogo ya lo permite).

**Backend:**
- **B7 (catálogo+motor):** modelo nuevo **`RangoDificultad`** (opsDesde, opsHasta?, nombre, diasCostura, orden, activo) + CRUD admin + integración a `calcularDuracion`: nueva `TipoDuracionProceso.porDificultad` que lee `Modelo.numOperaciones` → rango → días (fallback a la duración actual si el modelo aún no captura ops — la captura llega en R5). Migración aditiva + seed de ejemplo (1-8 Muy sencillo 6d · 9-14 Sencillo 8d · 15-22 Medio 11d · 23-32 Complejo 15d · 33+ Muy complejo 20d).
- **B10 (parte RC):** `Modelo.secuenciaEstampado` enum (`antes|despues|flexible`) + `Orden.secEstampadoElegido` para las flexibles + la dependencia `Recepción de procesos → Envío a maquila` condicionada a esa elección + endpoint de **reprogramación en vivo** (extiende `ajustarRutaOrden`). La captura del campo en el editor de desarrollo llega en R5; aquí el motor + el control en la ruta.
- Verificar/completar CRUD de `ProcesoDep` para la UI de antecesores (el DAG N:M y el rechazo de ciclos en `grafo.ts` ya existen).

**e2e:** specs de ruta-crítica (bandeja→mis pendientes, catálogo).
**Cierre:** cada usuario ve SU día en `prueba`; los tiempos del Excel real de Daniel (26 procesos, `docs/rediseno/referencias/Procesos_RC*.xlsx`) son cargables por el catálogo cuando él defina la lista.

---

### R5 — Desarrollo: re-vestir F8 + campos faltantes del precosteo
**Objetivo:** las 3 pantallas grandes de F8 (§4.7–§4.8) al estándar nuevo — F8 ya construyó el motor y pantallas teal; esta fase las **rediseña** y construye lo que Daniel dictó DESPUÉS del cierre de F8.

**Backend (los campos que F8 no tiene):**
- **B7 (captura):** `Modelo.numOperaciones Int?` — se captura en el editor de desarrollo; el editor muestra EN VIVO `34 ops → Muy complejo → costura ≈ 20 d` (consulta el catálogo de R4).
- **B8:** concepto de costo **`corte`** (fijo, seed) + `Modelo.corteBase Decimal?` + `lineaCorte` en `generarPrecosto` (patrón `lineaMaquila`); renglón propio en el desglose (Tela · Avíos · Procesos · **Corte** · Maquila). **Sin proveedor** (decisión Daniel).
- **B9:** `Modelo.idMaquileroCotizado Int?` (FK Proveedor) — visible en tarjeta y editor; siembra el default del maquilero asignado en producción (cambiable).
- **B10 (captura):** el campo `secuenciaEstampado` (de R4) editable en el editor de desarrollo.
- **B11:** modelo nuevo **`AvioMedida`** (idAvio, medida, precio, activo) — medidas agrupadas DENTRO del avío padre; `precostos.ts` usa el **promedio simple de los PRECIOS de las medidas** cuando el avío es "por medida" (badge); la compra/MRP desglosa por medida×talla (amarre `ModeloAvioTalla`↔medida — diseño fino con el reviewer). Migración aditiva.
- **B12:** **calculadora de negociación en vivo**: permitir en el precosto **borrador** editar/quitar/agregar CUALQUIER renglón — **es requisito de Daniel** ("se editan TODOS los elementos en vivo": tela+consumo, corte, maquila, procesos, avíos). Modelado técnico (del lead): los renglones de origen BOM pasan a `origen:'bom-ajustado'` con traza; `recalcularDesdeBom` no los pisa salvo "restaurar"; la ronda de negociación (E5) adopta esa versión congelada. Así "se quitan bolsas traseras → $224 → $205" se captura SIN tocar el BOM del modelo (si el cambio es definitivo de la prenda, se edita el BOM en el desarrollo y se recalcula).
- **B16:** **`DesarrolloArchivo`** (tech pack PDFs + fotos de referencia, patrón `OrdenArchivo`).

**Frontend:**
- **Pre-costeos** (§4.7): lista de proyectos con KPIs; **grid de tarjetas** de modelos (estatus Borrador/En proceso/Completo/Aprobado, costo, chips PDF/fotos, % avance, maquilero cotizado); **editor de modelo** (panel): números nuestro+cliente, telas N con consumo (multi-proveedor, **precio por color** con default al MÁS CARO si sin definir, "— precio único —" para planas), avíos (proveedor pre-elegido al más barato, "— sin definir —" como excepción, badge "Por medida" con promedio), procesos, **corte + maquila separados**, **# operaciones → dificultad en vivo**, secuencia de estampado, maquilero cotizado, tech pack/fotos. **SOLO COSTO — sin margen ni precio** (corrección Daniel: eso vive en la lista).
- **Listas de precios + Negociación** (§4.8): renglones **expandibles con el desglose de costo** (Daniel revisa "que haga sentido" antes de aprobar); aprobación renglón por renglón (`listas.aprobar`); factores snapshot editables solo con permiso; **calculadora de negociación en vivo** (costo / precio neto / % margen bruto coloreado contra el objetivo del cliente) + "Guardar versión" (ronda E5) + línea de tiempo `vN`; estados con reapertura auditada. Re-viste `ListasPreciosPagina`/`DialogoNegociacionRenglon`/`ComparadorVersiones`/`SelectorEstadoLista`.
- **Clientes** gana la sección de **factores** re-vestida (`EditorFactoresCliente` existe).

**e2e:** specs de desarrollo/listas existentes + los campos nuevos.
**Cierre:** flujo Daniel completo en `prueba`: proyecto → modelos costeados (con corte/dificultad/medidas) → lista → aprobar → negociar en vivo → versión guardada.

---

### R6 — Notas de salida + Habilitación/surtido
**Objetivo:** §4.6 completo — remisión de avíos a maquileros ligada al inventario + el tablero de surtido por orden.

**Backend:**
- **B13:** función de dominio + endpoint **`habilitacionOrden`** (gated `ordenes.habilitacion`, por fin cableado): por orden×avío de la receta → `requerido = consumo × piezas` vs `enviado = Σ NotaSalidaLinea de notas CONFIRMADAS` vs falta, con **extras** (avíos fuera de receta enviados) y **sobre-surtido** (>100% = estado válido "Sobre-surtido", no error — decisión Daniel). + endpoint "avíos de la orden" (propuesta desde el BOM con cantidad sugerida).

**Frontend:**
- **Notas de salida**: lista con chips de órdenes surtidas + cajón agrupado por orden; **constructor multi-renglón** (maquilero ComboboxBuscable, empresa, almacén origen único, fechas; renglones avío+orden+cantidad+**existencia disponible** en rojo si excede; totales vivos; **"Traer avíos de la orden"** que PROPONE sin limitar — ✓ "en la receta" / ⚠ "fuera de la receta — se enviará igual"); confirmar descuenta kardex; cancelar = inverso auditado.
- **Panel "Habilitación de avíos — Orden N"**: Requerido/Enviado/Falta con barra y estado Completo/Parcial/Pendiente/Sobre-surtido, % global, extras marcados; **surtido selectivo** (check + "A surtir", default = la falta; escribir auto-marca; re-envío con falta 0 permitido) → **"Pasar a nota de salida (N)"** pre-carga el constructor con lo seleccionado + el maquilero de la orden. Se abre desde el tile "Habilitación" del detalle de la OP (R2) y desde el banner de filtro de notas.
- **Nota de salida de TELAS**: se diseña AQUÍ directo en el front real (propia nota del almacén de telas, separada de la de avíos — decisión Daniel 6-jul, decidida §1.6; puede reusar la "salida de tela a orden" de F4 como respaldo). Daniel la revisa en `prueba`.

**e2e:** notas de salida + habilitación (sembrar BOM + nota confirmada).
**Cierre:** ciclo real en `prueba`: ver habilitación → surtir selectivo → confirmar nota → % actualizado; sobre-surtir un avío completo funciona y se ve "Sobre-surtido 112%".

---

### R7 — Análisis RC (tablero de gestión)
**Objetivo:** §4.10 — de capturar a ANALIZAR: salud de órdenes, calificar personas para el bono semanal, cuellos, y las 4 analíticas ("haz todas" — Daniel).

**Backend (B14 — agregaciones EN SERVIDOR, reusando las vistas materializadas de F7-E3 donde aplique):**
- **Salud/triage:** órdenes activas a-tiempo/en-riesgo/atrasadas + % cumplimiento (sobre `semaforoYRiesgo` existente) + "órdenes que requieren atención" ordenadas por holgura con etapa atorada y responsable.
- **Scoring por persona:** sobre `RutaOrden.capturadoPorId/capturadoEn` + fechas planeadas (D11): % en tiempo, vencidos ahora, **reacción** (promedio de atención desde que cae en su cancha), **tendencia** vs semana pasada, **calificación 0-100** (= % en tiempo − penalización por vencidos), **bono semanal** (calificación ≥ 90 y 0 vencidos; umbrales configurables) + "Generar evaluación semanal".
- **Cuellos por proceso** (vencidos+hoy por `ProcesoDef` — problemas sistémicos, no solo personas).
- **Las 4 adicionales:** on-time delivery % con tendencia 4 semanas + tiempo de ciclo (OP→entrega) — reusar la vista "entrega a tiempo" de F7-E3; **alertas predictivas** = **CPM forward pass** (NUEVO en `cpm.ts`: colchón proyectado = días a la entrega − trabajo restante; negativo → va a atrasarse); **riesgo por cliente**; **carga vs desempeño** (marca sobrecarga para que el bono sea justo).

**Frontend:** pantalla "Análisis RC" (grupo ANÁLISIS): KPIs, triage, tabla de desempeño con badges Excelente/Bien/Regular/Bajo + Bono ✓, cuellos, y las 4 tarjetas analíticas (sparklines con el estándar de `dataviz` del proto).
**e2e:** smoke del tablero con datos sembrados.
**Cierre:** tablero completo con datos reales en `prueba`; el forward pass documentado (ADR si amerita).

---

### R8 — Importador de pedido del cliente (motor backend NUEVO)
**Objetivo:** §4.1 Etapa 3 + §7 del handoff — el cliente manda su OC en SU formato; se enseña UNA vez y después se importa solo. **Función nueva NO contemplada en el PLANMAESTRO — al cerrar, registrarla formalmente.**

**Backend (B15):**
- Modelo **`PlantillaImportacion`** (idCliente, nombre, version, mapeo de columnas JSON: Modelo del cliente / Color / Talla / Cantidad / Precio / ignorar) — versionada, una vigente por cliente.
- **Parseo de Excel** (con `exceljs`, ya en el backend desde F5-E7; PDF queda para una iteración posterior).
- **Amarre** modelo-del-cliente ↔ desarrollo por `Desarrollo.numeroCliente` (campo YA existente); no reconocidos → resolución manual en el paso 3.
- **Alta transaccional**: pedido interno (con `ocCliente` + archivo original adjunto, de R3) + una OP por modelo con su matriz (el archivo trae color y talla) + RC sola — **reusa `salidaAProduccion` de R3** (A2, todo o nada).
**Frontend:** asistente de 3 pasos desde Pedidos ("Importar de cliente"): **Origen** (cliente + archivo; muestra si ya tiene formato guardado) → **Formato** (mapear columnas UNA vez, se guarda como plantilla) → **Vista previa** (reconocidos ✓ / sin reconocer con ComboboxBuscable para ligar a mano) → confirmar.
**e2e:** importación completa con un archivo de prueba (caso C&A del proto: 2 reconocidos + 1 sin reconocer).
**Cierre:** importar un archivo real en `prueba` y que nazcan pedido + OPs + rutas. La "IA que detecta formatos sola" queda explícitamente para después (servicio posterior).

---

### R9 — Resto de módulos + barrido final de fidelidad
**Objetivo:** todas las vistas restantes del prototipo al estándar nuevo, y el cierre de fidelidad global.

**Frontend (cada una cotejada contra su vista `vXxx()` del proto):**
- **Resumen** (`vResumen`): KpiTiles + órdenes por vencer + cortes/semana + bandeja RC.
- **Modelos** (`vModelos`): tabla + cajón con ficha/BOM/matriz (re-viste el módulo F1).
- **Producción/WIP** (`vProduccion`): tablero WIP F3 re-vestido.
- **Inventario PT** (`vInventarios`): existencias por almacén + kardex (F3-E3).
- **Telas** (`vTelas`) y **Avíos** (`vAvios`): inventarios F4 re-vestidos; Avíos con proveedores expandibles (precios por proveedor), badge "Por medida" (medidas + promedio, de R5) y "Genérico·stock / Por orden" (los DOS conceptos de genérico — aclaración Daniel §4.7).
- **Compras/MRP** (`vCompras`): banner de faltantes + avance de recepción (F4).
- **Proveedores** (`vProveedores`): catálogo + cajón + **"Avíos que surte"** con asignar/quitar (B17 — verificar/crear endpoint del lado proveedor) + saldo CxP placeholder hasta F9.
- **Clientes** (`vClientes`): catálogo + departamentos + factores (de R5).
- **Ventas** (`vVentas`): sobre pedidos reales + entregas a cliente (F3-E5); lo que exija factura/CFDI espera a F9.
- **Costos** (`vCostos`) y **EDR** (`vEdr`): F7 re-vestidos.
- **Indicadores** (`vIndicadores`): tableros F7-E3/E4 re-vestidos.
- **Calidad** (`vCalidad`) + **Auditores**: F6 re-vestido.
- **Usuarios y accesos** (`vUsuarios`): admin F0 + roles/permisos (PR #98) re-vestidos.
- **Catálogos base** (`vCat`): colores/tallas/temporadas/tipos de proceso/almacenes.
- **CxC/CxP**: entradas del menú con vista "llega con Finanzas (F9)".
**Backend:** B17 y huecos menores que salgan del cotejo.
**Barrido final:** recorrido pantalla-por-pantalla contra el prototipo completo + ronda de ajustes de Daniel viendo `prueba` + verificación de que TODO comentario de Daniel en `REDISENO-FRONTEND.md` §4 quedó implementado (checklist explícito en la nota de cierre).
**Cierre:** plan §2 completo; el rediseño queda como el estándar del sistema; actualizar `CLAUDE.md` (estándar visual) y `HOJA-DE-RUTA.md`.

---

## 6. Preguntas para Daniel — UNA sola tanda (con defaults; NO bloquean)

> Por la regla de precedencia (§1.6), **todo lo que Daniel aprobó en el prototipo está DECIDIDO y se implementa tal cual** — incluido: nº de producción a nivel modelo minteado al salir a producción, promedio de medidas en el precosteo, tipografía del sistema, nota de telas propia, y la calculadora de negociación que edita todo en vivo. Solo quedan abiertas las 2 preguntas que el propio handoff dejó explícitamente sin cerrar. Mientras no conteste, se implementa el **default** (cambiarlo después es barato).

1. **Combobox de proveedores:** ¿texto libre (proveedor nuevo al vuelo) o solo de lista? *(El handoff §4.4 la deja "preguntada, sin cerrar".)* **Default: solo de lista + atajo "crear proveedor" (alta rápida en modal)** — evita duplicados con los homónimos (Óscar J./H./L.).
2. **Funciones viejas de Órdenes de Access** (Composición forzada, "Maquila real", EXP/Copiar, RC Clave/Tipo tela/Concentrado): ¿cuáles entran? *(El handoff §7 dice "evaluar cuáles entran".)* **Default: ninguna por ahora** — se piden viendo el front real (la composición como dato ya existe).

---

## 7. Registro

| Fecha | Evento |
|---|---|
| 4–5 jul 2026 | Sesión de diseño con Daniel → prototipo + handoff (`REDISENO-FRONTEND.md`). |
| 6–7 jul 2026 | Iteración del prototipo pantalla por pantalla con Daniel (45 commits en `tarea/rediseno-frontend`). |
| 7 jul 2026 | **Mandato de Gabriel:** prototipo congelado como spec; se implementa TODO (backend incluido); Daniel revisa en el front real. 1ª auditoría de brechas. |
| 7 jul 2026 | **F8 confirmada COMPLETA (6/6) en `prueba`** (PRs #96–#100) → 2ª auditoría sobre `1195ce5`; plan corregido (F8 se re-viste, no se re-construye; adjuntos de orden y liga dev↔orden ya existen). Rama **`tarea/rediseno-r1`** creada desde ese commit con `docs/rediseno/` encima. **Este plan, v2.** |
| 7 jul 2026 | **Jerarquía de autoridad (Gabriel):** el REDISEÑO hasta arriba, todo lo demás abajo — si algo (aunque esté construido, ej. F8) contradice al rediseño, gana el rediseño SIEMPRE; lo aprobado en el prototipo = DECIDIDO → §1.6; el batch de preguntas a Daniel se reduce a 2. |
