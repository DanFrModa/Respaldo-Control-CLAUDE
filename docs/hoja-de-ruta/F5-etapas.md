# F5 — Ruta Crítica ⭐ · desglose en etapas

> Parte de la hoja de ruta viva ([`HOJA-DE-RUTA.md`](../../HOJA-DE-RUTA.md), raíz del repo).
> Una sesión nueva lee `CLAUDE.md` → `PLANMAESTRO.md` → `HOJA-DE-RUTA.md` → la ficha de la fase activa.
>
> **Entrega de la fase (plan §6):** Motor de workflow + CPM + plantillas + bandeja con semáforo + auto-avance desde F3/F4.
> **Criterio de salida:** Una orden corre con su RC y las fechas se llenan solas donde aplica.
> **Estado:** 🔄 EN CURSO (5/7) — **F5-E1 ✅, F5-E2 ✅, F5-E3 ✅, F5-E4 ✅ y F5-E5 ✅ (22-jun-2026)** — el motor completo (datos + duraciones + generación + CPM + captura + semáforo) y las **pantallas de operación** (Programar RC, Bandeja de tareas con semáforo PC+móvil, RC por orden, badge de alertas) están construidos; decisiones de fase (a–h) cerradas con Daniel (`Documentacion_MJD/DECISIONES.md` §"Decisiones de negocio de F5"). Resto E6–E7 ⬜.

## F5-E1 · Procesos como datos: catálogo de procesos + roles responsables N:M + DAG de dependencias + checklists configurables — ✅ COMPLETA (22-jun-2026)

> **✅ Nota de cierre (22-jun-2026; 1 coder + 1 reviewer independiente — APROBADO; pendiente verificación de Gabriel en `prueba`).** Corazón configurable del workflow construido:
> - **Esquema + migración aditiva `20260622120000_f5_e1_ruta_critica_procesos`:** 3 enums (`CondicionAplicabilidad {ninguna|soloSiLlevaAplicacion}` TIPADO, NO motor de expresiones; `TipoEventoProceso`; `TipoDuracionProceso`) + 4 modelos GLOBALES — `ProcesoDef` (banderas `critico`/`ultimoProceso`/`esResurtido` + `condicionAplicabilidad`/`tipoEvento`/`tipoDuracion`), `ProcesoDefRol` (N:M sobre el `Rol` del **RBAC único** de F0, sin catálogo paralelo A4), `ProcesoDep` (DAG self-relation, FK Restrict), `ProcesoChecklist` (FK Cascade, `orden`, borrado suave).
> - **Dominio `dominio/ruta-critica/catalogoProcesos.ts` (A1)** + `grafo.ts` (detección de ciclos PURA y testeable: **auto-antecedencia, ciclo directo A↔B y transitivo A→B→C→A**; DFS iterativo; ignora las aristas previas del propio proceso al re-definir → sin falsos positivos; mensaje claro en español). Todo cambio en `enTransaccion` (A2) con `registrarBitacora` + `datosCreacion/datosModificacion` (A7). Borrado SUAVE (proceso y checklist).
> - **API:** 8 endpoints `/api/ruta-critica/procesos*` (procesos + roles + dependencias + checklist por sub-recursos PUT de set completo), RBAC server-side por ruta — GET→`rc.catalogo-ver`, mutaciones→`rc.catalogo-administrar` (**2 permisos nuevos**). Contrato `openapi.json` + cliente `esquema.gen.ts` regenerados en la etapa.
> - **RBAC:** alta de los **18 roles funcionales reales** (`RC_TipoUsuarios`: Ventas, IP, Diseño, Producción, Corte, Calidad, Telas, Moldes…) en el RBAC único; reusa "Administrador" de F0 (no lo duplica).
> - **Frontend:** 2 pantallas teal — `ProcesosPagina` (CRUD con banderas, multi-rol responsable, `tipoEvento`/`tipoDuracion`, checklist editable) y `DependenciasPagina` (N antecesores, **rechazo de ciclos en vivo**) + menú + ruta + e2e Playwright.
> - **Seed de DESARROLLO:** 26 procesos reales + **54 asignaciones N:M** + dependencias (de `AntecesorRef`) + checklist de IP, con **datos BAKEADOS** (transcritos, NO lee CSV en runtime → corre en Railway). Mapeo `TipoProceso`→`tipoEvento` documentado (AP→autorizacionArte, T→recepcionTela, CO→corte, EP→envioEstampado, RP→reciboEstampado, CP→auditoria, EC→envioCostura, C→reciboCostura, F/M/vacío→manual). Idempotente. **Cuadre seed↔CSV reales 1:1 verificado por el reviewer (0 mismatches).**
> - **CI:** type-check back+front, 548 unit backend (+ `grafo.test.ts`), tests de página + catálogo en verde; integración (testcontainers: CRUD, N:M, ciclos auto/directo/transitivo, soft delete, bitácora) y e2e corren en CI.
> - **Deuda explícita (menor del review, ACEPTABLE para E1):** el editor de roles y la pantalla de dependencias consumen `GET /api/roles`, que hoy exige `roles.administrar`; el admin de RC tiene ambos permisos, así que funciona. **Para E2+:** exponer un `GET` de roles ligero bajo `rc.catalogo-ver` para desacoplar.
> - **Deploy a `prueba`:** requiere **`SEED_ON_START=true`** (2 permisos + 18 roles + 26 procesos nuevos; seed idempotente, no resetea el password del admin).

**Objetivo:** Construir el corazón configurable del workflow (D10): el catálogo de procesos con sus banderas, los roles responsables por proceso en relación N:M sobre el RBAC único (los 26 procesos vigentes tienen TODOS 2–3 roles responsables en RC_ProcUsua — verificado), el grafo de dependencias con N antecesores y validación de ciclos, y los checklists configurables que reemplazan las columnas fijas RC_IP2..5 (A6). Va primero porque TODO lo demás de la fase (plantillas, motor, rutas vivas) referencia estas tablas.

**Alcance:**
- Tablas Prisma: ProcesoDef (nombre, critico, esCheckpoint/ultimoProceso, esResurtido, condición de aplicabilidad TIPADA enum {ninguna|soloSiLlevaAplicacion} — empezar simple, NO motor de expresiones, ver riesgos del inventario—, tipoEvento enum para auto-avance (recepcionTela, corte, envioCostura, reciboCostura, envioEstampado, reciboEstampado, auditoria, autorizacionArte, entregaCliente, manual…), tipoDuracion enum {fija|porCantidad|porTipoTela|porAplicacion}, activo, auditoría A7), ProcesoDefRol (N:M idProcesoDef × idRol del RBAC único de F0 — equivalente directo de RC_ProcUsua y del ProcesoResponsable que propone 08 §4; NO una columna de rol único: en los datos reales TODO proceso tiene 2–3 roles responsables), ProcesoDep (DAG: idProceso × idAntecesor), ProcesoChecklist (sub-pasos por proceso, con orden)
- Roles funcionales faltantes en el RBAC único (A4): alta vía el servicio de roles de F0 de los roles reales de RC_TipoUsuarios (Ventas, IP, Diseño, Producción, Corte, Calidad, Telas, Moldes…) — NO se crea un segundo catálogo de tipos de usuario
- Permisos nuevos del módulo Ruta Crítica en el catálogo de permisos (backend/src/contrato) y su asignación a roles
- Servicio de dominio catalogoProcesos en backend/src/dominio/ruta-critica: CRUD de ProcesoDef/ProcesoDefRol/ProcesoDep/ProcesoChecklist; regla clave: rechazar CICLOS en el grafo (validación DAG con mensaje claro); borrado suave; auditoría A7 + Bitacora (la RC es tabla crítica, PLANMAESTRO §4)
- Endpoints REST /api/ruta-critica/procesos (+ roles responsables + dependencias + checklist) con Zod→OpenAPI y permiso verificado server-side en cada ruta (A4)
- Pantallas PC: 'Catálogo de procesos' (CRUD con banderas, asignación de VARIOS roles responsables por proceso, tipoEvento, checklist editable — patrón docs/modulos/patron-crud.md) y 'Editor de dependencias' (definir N antecesores por proceso, vista del grafo, rechazo de ciclos en vivo)
- Entrada del módulo Ruta Crítica en el menú del layout (visible solo con permiso)
- Seed de DESARROLLO (compose local / ambiente prueba): los 26 procesos reales de CP_Procesos.csv con banderas mapeadas + sus roles responsables N:M desde RC_ProcUsua.csv (54 asignaciones vigentes, 2–3 roles por proceso) + dependencias genéricas (AntecesorRef) + checklist de IP documentado (Moldes, MuestraFísica, FichaTécnica, Digitalización, Graduación, Corte, FichaProceso, Aprobada, Asignada, ComplementarOP, Consumos). El ETL formal con reporte de cuadre va en E7

**Entregables:**
- Migración Prisma de ProcesoDef/ProcesoDefRol/ProcesoDep/ProcesoChecklist + seed de desarrollo (procesos con 2–3 roles c/u)
- backend/src/dominio/ruta-critica/catalogoProcesos con TSDoc (referencia a 08 §4 y D10/A6) y tests unitarios + integración (testcontainers): CRUD, asignación N:M de roles, rechazo de ciclos, borrado suave, bitácora
- Rutas REST en backend/src/api/ruta-critica + backend/openapi.json regenerado + cliente frontend/src/api/esquema.gen.ts sincronizado EN ESTA etapa
- Páginas React 'Procesos' y 'Dependencias' con tests Vitest + 1 e2e Playwright (crear proceso con 2 roles, intentar ciclo)
- Roles funcionales y permisos RC en el seed/catálogo de permisos

**Criterio de cierre:**
- Tests backend y frontend en verde + CI completo verde
- Review aprobado por reviewer independiente (checklist A1/A4/A6/A7: lógica solo en dominio, permisos en cada ruta, roles responsables N:M sobre el RBAC único sin catálogo paralelo, checklist como datos, bitácora)
- openapi.json y esquema.gen.ts regenerados y commiteados juntos
- Verificación de Gabriel completada y PR mergeado a prueba

**Verificación de Gabriel:**
- [ ] Correr `docker compose up -d --build` y entrar a http://localhost:8080 con admin
- [ ] Abrir el módulo Ruta Crítica → Procesos: ver los 26 procesos del seed; comparar 4-5 nombres contra 'Respaldo CLAUDE/TABLAS/CP_Procesos.csv' abierto en Excel (Revisión OP … Aceptación de Cliente)
- [ ] Abrir un proceso del seed (p. ej. el de corte) y confirmar que tiene 2 o MÁS roles responsables; comparar contra 'Respaldo CLAUDE/TABLAS/RC_ProcUsua.csv' + RC_TipoUsuarios.csv (en los datos reales ningún proceso tiene un solo rol)
- [ ] Crear un proceso 'Prueba Gabriel' con DOS roles responsables, banderas y checklist de 2 ítems; recargar la página y confirmar que persiste; quitarle un rol y confirmar que el otro queda
- [ ] En el editor de dependencias: ponerle 2 antecesores a un proceso; luego intentar crear un ciclo (A depende de B y B de A) y confirmar que el sistema lo RECHAZA con mensaje claro
- [ ] Desactivar el proceso de prueba → desaparece de la lista de activos (borrado suave, no se borra de la BD)
- [ ] Abrir http://localhost:8080/api/docs y confirmar que aparece el grupo ruta-critica
- [ ] Entrar con un usuario SIN permiso de RC → el módulo no aparece en el menú y la URL directa responde 403

**Equipo:** 1 coder + 1 reviewer (cadena esquema→dominio→API→UI del mismo grupo: no se paraleliza)

**Referencias:**
- Documentacion_MJD/08-Ruta-Critica.md §2.1 (CP_Procesos, RC_ProcUsua) y §4 (modelo propuesto: ProcesoResponsable como tabla aparte, capacidades 1 y 2)
- PLANMAESTRO.md §4 'Ruta Crítica como workflow configurable' (ProcesoDef/ProcesoDep) y §5 fila 7
- Documentacion_MJD/DECISIONES.md D10; MEJORAS.md A4 (RBAC único), A6 (checklists configurables), A7 (auditoría)
- docs/modulos/patron-crud.md (patrón de referencia F0)
- Respaldo CLAUDE/TABLAS/CP_Procesos.csv, RC_TipoUsuarios.csv, RC_ProcUsua.csv (datos reales, **CP850** — ver CLAUDE.md §4; RC_ProcUsua = 68 filas, todo proceso con 2–3 roles)

---

## F5-E2 · Plantillas de ruta por familia/artículo + reglas de duración + calendario laboral + colchón — ✅ COMPLETA (22-jun-2026)

> **✅ Nota de cierre (22-jun-2026; 1 coder + 1 reviewer; verificación de correctitud del lead APROBADA —gates locales en verde + revisión a fondo del dominio; pendiente verificación de Gabriel en `prueba`).** Parametrización de QUÉ procesos lleva cada prenda y CUÁNTO tarda cada uno:
> - **Migración aditiva `20260622130000_f5_e2_plantillas_reglas`** con **7 tablas GLOBALES nuevas**: `FamiliaArticulo` (ex `CP_Familia`), `ArticuloRC` (ex `CP_Articulos`/`IdCP_Articulos`, **SIN FK desde `Orden`** —el escalar `idTipoArticuloRC` queda como dato; prueba tiene órdenes ETL con esos valores), `PlantillaRuta` (por familia y/o artículo), `PlantillaRutaProceso` (proceso + `tiempoEstandar` + `orden`, ex `CP_Tiempos`), `PlantillaRutaDep` (**arista del DAG de encadenamiento PROPIO de la plantilla**, puede diferir del `ProcesoDep` genérico de E1 → caso `CP_Tiempos.Antecesor ≠ AntecesorRef`), `FactorCantidad` (ex `CP_Cant`), `DuracionPorTipoTela` (con `factorTela`, ex `RC_TipoTelas`), `DuracionPorAplicacion` (con `factor`, ex `RC_Aplicaciones`), `CalendarioEmpresa` (días hábiles de la semana por empresa) + `DiaFestivo` (festivos por empresa). **`colchonCostura` NO se agregó: ya existía en `ConfiguracionEmpresa` desde F0** (nullable → sin backfill ni trampa NOT NULL); la UI de Config RC lo edita por la ruta de configuración de empresa existente.
> - **Dominio** `dominio/ruta-critica/{plantillasRuta,reglasDuracion,familiasArticulos,calendarioLaboral}.ts` (A1) — CRUD en `enTransaccion` (A2) con `registrarBitacora` + `datos(Creacion|Modificacion)` (A7) y **borrado suave**. `plantillasRuta` valida el set (sin procesos repetidos, cada proceso existe y está activo, antecesor dentro del set, sin auto-antecedencia) y **reúsa `grafo.ts` (`validarDependencias`) para rechazar ciclos** del encadenamiento propio; reemplazo de set completo (borra+recrea renglones para conocer los ids de las aristas).
> - **`comun/diasHabiles.ts` PURO y testeable** (sin Prisma): `esDiaHabil`, `sumarDiasHabiles` (n positivo=forward, **n negativo=backward para el CPM**, n=0 no mueve, el día de partida no cuenta), `contarDiasHabiles` (intervalo inclusivo) — TODO en **UTC** (festivos por clave `YYYY-MM-DD`). Recibe el calendario ya cargado por parámetro. **Batería exhaustiva de bordes**: finde, festivo entre semana, cruce de año (avance y conteo), n negativo (finde y festivo), festivo-en-finde (no resta de más), intervalo invertido, mismo día. Pieza crítica que consumirá el CPM de E4.
> - **API** `/api/ruta-critica/{plantillas,familias,articulos,reglas-duracion/{cantidad,tela,aplicacion},calendario}` con RBAC server-side por ruta — **reusa `rc.catalogo-ver`/`rc.catalogo-administrar`, SIN permisos nuevos**. Contrato `openapi.json` (back+front) + cliente `esquema.gen.ts` regenerados frescos en la etapa.
> - **Decisión (b) aplicada al modelo:** los catálogos **GUARDAN** `factorTela` (0.07–2.30) y el factor de aplicación aunque el viejo nunca los aplicara (la fórmula que los usa es de E3, donde se valida con Daniel con números concretos). **Decisión (a):** calendario **configurable por empresa**; el seed siembra L–V + festivos oficiales de México — las **fechas propias de FR Moda** las cargará Gabriel por el CRUD cuando Daniel se las dé (pendiente operativo, no bloquea).
> - **Frontend:** 3 pantallas teal "lista + detalle" — **Plantillas de ruta** (qué procesos, tiempo estándar, encadenamiento propio con rechazo de ciclos en vivo + CRUD simple de familia y artículo), **Reglas de duración** (una pantalla, 3 pestañas: cantidad / tipo de tela / aplicación) y **Configuración RC** en Administración (colchón de costura + calendario laboral/festivos) + menú + rutas con guard de permiso + e2e Playwright de captura de plantilla.
> - **Seed de desarrollo** (archivo aparte, enganchado en `seed.ts`, **datos BAKEADOS — no lee CSV en runtime** → corre en Railway, idempotente): 2 plantillas reales con su encadenamiento propio + `CP_Cant` (11) + `RC_TipoTelas` (7) + `RC_Aplicaciones` (9) + calendario L–V + festivos MX.
> - **Deploy a `prueba`:** requiere **`SEED_ON_START=true`** (datos de catálogo nuevos; **no hay permisos ni roles nuevos**).
> - **Equipo:** **1 coder + 1 reviewer** (NO 2 en paralelo). La ficha contemplaba 2 coders, pero las piezas A/B comparten `schema.prisma`, la migración única, el contrato/cliente y el menú/rutas → demasiado solape; la propia ficha manda 1 coder en ese caso.
> - **CI verde local:** backend `format:check`/`typecheck`/`lint`/`build`; frontend `format:check`/`typecheck`/`build`/`test` (380 — los 3 timeouts iniciales eran flaky de F1/F3, pasan aislados). Integración (testcontainers) + e2e corren en CI.

**Objetivo:** Parametrizar QUÉ procesos lleva cada tipo de prenda y CUÁNTO tarda cada uno: plantillas con su PROPIO encadenamiento por artículo (CP_Tiempos.Antecesor manda sobre el genérico), reglas de duración (fija/cantidad/tela/aplicación), calendario laboral configurable (hoy L–V hardcodeado) y colchón de costura por empresa. Va después de E1 porque todo referencia ProcesoDef.

**Alcance:**
- Tablas Prisma: FamiliaArticulo y ArticuloRC (⚠️ verificar primero si F1/F2 ya las crearon por Ordenes.IdCP_Articulos; si existen, solo CRUD/extensión), PlantillaRuta + PlantillaRutaProceso (subconjunto de procesos, tiempo estándar y dependencias PROPIAS de la plantilla — también DAG validado), FactorCantidad (rangos DeCant/ACant/Factor = CP_Cant), DuracionPorTipoTela (días de abasto sobre el catálogo de tipos de tela de F1/F4 — aquí solo la regla de días, no el catálogo), DuracionPorAplicacion (días por tipo de aplicación), CalendarioLaboral (días laborables + festivos por empresa)
- ConfiguracionEmpresa: campo colchonCostura (días) en la configuración por empresa de F0 (ex-Propiedades.ColchonCostura, módulo 13)
- Servicios de dominio: plantillasRuta (CRUD; validar que el encadenamiento de la plantilla sea DAG y que sus procesos existan en ProcesoDef), reglasDuracion (CRUDs de los 3 catálogos), calendarioLaboral con función díasHábiles/sumarDíasHábiles compartida en backend/src/comun o dominio (la consumirá el motor CPM de E4) — con tests exhaustivos de bordes (fin de semana, festivo, cruce de año)
- Endpoints REST: /api/ruta-critica/plantillas, /familias, /articulos, /reglas-duracion/*, /calendario; /api/admin/configuracion (extensión colchón)
- Pantallas PC: 'Plantillas de ruta' (por familia/artículo: qué procesos, tiempo estándar, encadenamiento propio; incluye CRUDs simples de familia y artículo — reemplaza CP_Catalogo/CP_LlenarCat/CP_CruzarTablas), 'Reglas de duración' (una pantalla con 3 pestañas: factores por cantidad / días por tipo de tela / días por aplicación), y en Administración: 'Configuración RC' (colchón de costura por empresa + calendario laboral/festivos)
- Seed de desarrollo: plantilla(s) reales desde CP_Tiempos.csv (156 filas) + CP_Cant (11) + RC_TipoTelas (7) + RC_Aplicaciones (9) para poder probar E3/E4 con datos reales

**Entregables:**
- Migración Prisma + seed de desarrollo de plantillas y reglas
- Servicios de dominio con TSDoc y tests (unit + integración); tests dedicados de díasHábiles con festivos
- Rutas REST + openapi.json regenerado + cliente del frontend sincronizado
- Páginas React (plantillas, reglas con pestañas, configuración RC) con tests Vitest + e2e de captura de plantilla
- Nota técnica corta en la PR: si FamiliaArticulo/ArticuloRC ya existían de F1/F2 y qué se reutilizó

**Criterio de cierre:**
- Tests en verde + CI verde + review aprobado (A1/A2/A7 y patrón CRUD)
- El encadenamiento por plantilla acepta dependencias DISTINTAS al DAG genérico de E1 (probado con test que replica el caso CP_Tiempos.Antecesor ≠ AntecesorRef)
- openapi.json + esquema.gen.ts sincronizados
- Verificación de Gabriel completada y merge a prueba

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`; en RC → Plantillas: ver las plantillas seedeadas desde CP_Tiempos; abrir una y comparar 3 tiempos contra 'Respaldo CLAUDE/TABLAS/CP_Tiempos.csv'
- [ ] Crear familia 'Prueba' y artículo 'Playera Gabriel'; armarle una plantilla de ~8 procesos con tiempos y encadenamiento propio; guardar y recargar
- [ ] Intentar un ciclo en el encadenamiento de la plantilla → rechazo con mensaje claro
- [ ] Reglas de duración: en las 3 pestañas comparar contra los CSV (CP_Cant 11 rangos, RC_TipoTelas 7, RC_Aplicaciones 9) y editar un valor
- [ ] Administración → Configuración RC: poner colchón de costura = 2 días; agregar un festivo al calendario (p. ej. 16-sep); recargar y confirmar persistencia
- [ ] Con usuario sin permiso → las pantallas nuevas no aparecen

**Equipo:** 2 coders en paralelo (pieza A: plantillas + familia/artículo · pieza B: reglas de duración + calendario + config en Administración) + 1 reviewer — SOLO si las piezas quedan en archivos de esquema Prisma, rutas y páginas separados sin solape (como los catálogos de F1); si hay solape en archivos compartidos, 1 solo coder

**Referencias:**
- Documentacion_MJD/08-Ruta-Critica.md §2.1 (CP_Tiempos/CP_Cant/RC_TipoTelas/RC_Aplicaciones) y §4 capacidad 5 ('conserva lo bueno de hoy')
- PLANMAESTRO.md §4 (PlantillaRuta + duracionRegla); DECISIONES.md D10
- Respaldo CLAUDE/TABLAS/CP_Tiempos.csv, CP_Cant.csv, RC_TipoTelas.csv, RC_Aplicaciones.csv, CP_Familia.csv, CP_Articulos.csv
- Riesgos del inventario: 'Dependencia por artículo ≠ genérica' y 'Calendario laboral hardcodeado'
- Respaldo CLAUDE/Respaldo CLAUDEModulos/Funciones RC.txt (FechaHabiles, CuantosSabYDom, TiempoColchonCostura — leer con latin-1)

---

## F5-E3 · Motor RC parte 1 (backend): infraestructura de jobs + datos de la ruta viva + duraciones + generación y ajuste de ruta — ✅ COMPLETA (22-jun-2026)

> **✅ Nota de cierre (22-jun-2026; 1 coder + 2 reviewers independientes; pendiente verificación de Gabriel en `prueba`).** Primera mitad del motor de la RC construida, todo en backend:
> - **Migración ADITIVA** `20260622140000_f5_e3_ruta_viva_motor`: 2 enums (`EstadoProcesoRuta {pendiente|activo|completado}`, `OrigenCaptura {manual|evento}`), 3 tablas (`RutaOrden` un renglón por proceso×orden con snapshot de banderas + duración + fechas planeada/real + estado + captura, pensada para explotación analítica D11; `RutaOrdenDep` snapshot del DAG de ESA orden editable sin tocar la plantilla; `RutaOrdenChecklist`), y **campos NUEVOS en `Orden`** (`rcActiva`, `fechaProgramada`, `esResurtidoRC`, FKs `idArticuloRcProg`/`idDuracionTela`/`idDuracionAplicacion`). Los escalares RC legados de v1 se conservan SIN tocar. Validada con `prisma migrate diff` (no se aplicó contra BD).
> - **Motor de jobs pg-boss** (`backend/src/comun/jobs/index.ts`, NUEVO): instancia sobre el MISMO Postgres (separada del relay de eventos de ADR-0011), arranque/cierre en `servidor.ts`, **serialización por orden vía `singletonKey`** (`<cola>:<idRecurso>` — dos recálculos de la misma orden colapsan en uno; dedup). Guarda `JOBS_ACTIVOS` (NO-OP en tests/CI). El job CPM `rc-recalcular-ruta` se REGISTRA y se ENCOLA; su handler lo implementa E4 (en E3 la ruta queda en estado "pendiente-de-calculo").
> - **`calcularDuracion`** (dominio puro): 4 reglas leyendo TODO de los catálogos en vivo (cero números a fuego). `fija`=tiempoEstandar; `porCantidad`=`max(1, round(t×factor+colchón))`; `porTipoTela`=`dias` DIRECTOS (NO ×factorTela); `porAplicacion`=`max(0, round(diasAplic×factorCantidad))` — **PRENDE el factor de cantidad** (corrige el ex-bug `FactCantAp`). `factorTela` y `DuracionPorAplicacion.factor` se conservan como referencia pero NO se multiplican (doble-conteo — decisión de Daniel 22-jun, ADR-0012). Tests unit con números a mano desde los CSV.
> - **`generarRutaOrden` / `ajustarRutaOrden`** (A2 transacción + A7 bitácora): resuelve la plantilla aplicable (por artículo, si no por familia); OMITE condicionales sin aplicación RECONECTANDO a los antecesores TRANSITIVOS vivos (reusa `grafo.ts`, no el frágil `VerifAntecesor`); **guard del "último proceso"**: si el terminal único era condicional y se omitiría, NO se omite (la RC conserva su ancla para el CPM de E4); resurtido → procesos `esResurtido` con duración 0; **duración 0 = auto-completado** (`fechaReal`=inicio, `estado`=completado, `origenCaptura`='evento'); RE-GENERAR conserva las fechas reales ya capturadas; la RC NUNCA pisa `Orden.fechaEntrega` (decisión (c)); ajuste valida el grafo acíclico de forma **ACUMULATIVA por lote** (`validarRedefinicionesAcumulado` en `grafo.ts`, PURO + unit tests: rechaza el **ciclo CRUZADO** entre dos redefiniciones del mismo PATCH, p. ej. `[{A→[B]},{B→[A]}]`) y NO toca la plantilla (D10). Encola el recálculo tras el commit (fire-and-forget; **asume tx propia** — si se compone bajo `bd.tx` externa, mover a hook post-commit).
> - **API REST** (`programacion.rutas.ts`): `POST /ruta-critica/ordenes/:id/programar` (respuesta INMEDIATA), `PATCH …/ruta`, `GET …/ruta`. RBAC por ruta. **Permisos NUEVOS** `rc.programar` (muta) / `rc.ruta-ver` (consulta), operativos (cascadean a producción/IP) → **deploy a `prueba` necesita `SEED_ON_START=true`**. OpenAPI + `esquema.gen.ts` regenerados.
> - **ADR-0012** (fórmula de duración + jobs pg-boss con serialización por orden).
> - **Gates locales en verde:** backend format/typecheck/lint/build + unit; **frontend SIN cambios de UI** (etapa solo-backend) — solo se regeneró el cliente OpenAPI (`esquema.gen.ts`), y su suite (383) quedó en verde como no-regresión. Los tests de integración con testcontainers corren en CI. Las FECHAS planeadas se calculan en E4.

**Objetivo:** Primera mitad del motor, toda en backend/src/dominio (A1): montar pg-boss como motor común de jobs (primera pieza del proyecto que lo exige), las tablas de la ruta viva, el cálculo de duraciones por regla y la generación/ajuste de la ruta de una orden desde su plantilla. Corte horizontal justificado: es 'tarea grande' tipo motor (PLANMAESTRO §9), y se parte en dos etapas (E3/E4) para que cada una sea una tarea cerrada del tamaño de referencia — esta deja la ruta GENERADA con duraciones correctas; las fechas CPM llegan en E4.

**Alcance:**
- Tablas Prisma: RutaOrden (idOrden × proceso: fechaPlaneadaORIGINAL + fechaPlaneadaVigente + fechaReal + estado + duración calculada + acumulado + capturadoPor/capturadoEn + origenCaptura manual|evento — diseñada para explotación analítica D11; los responsables se resuelven por los roles N:M de ProcesoDefRol de E1, no por columna de responsable único), RutaOrdenDep (snapshot de dependencias DE ESA orden, editable sin tocar la plantilla), RutaOrdenChecklist (hecho/fechaHecho/quién); campos RC en Orden de F2: rcActiva, rcViva, enRiesgo, fechaEntregaRC, fechaInicioRC, fechaProgramada (+ datos de programación: artículoRC, tipoTela, tipoAplicación, esResurtido)
- Infraestructura pg-boss 12 como motor común (backend/src/comun/jobs) — verificado: hoy NO existe en backend/; incluye el patrón de serialización por singleton key que usarán los jobs de E4/E6
- Servicio calcularDuracion: normal=tiempo estándar; variable=tiempo×factor por rango + COLCHÓN de costura de ConfiguracionEmpresa; tela=días por tipo de tela (SOLO Dias); aplicación=días por aplicación; sin rango de cantidad definido → advertencia y tiempo sin factor; ADR con la decisión sobre FactCantAp Y FactorTela (mismo patrón: ambos campos existen en el origen — FactorTela en RC_TipoTelas con valores 0.07–2.30 — pero el código viejo NO los aplica; propuesta: conservar el comportamiento actual y dejar el descarte explícito para que nadie lo 'corrija' en silencio en el ETL)
- Servicio generarRutaOrden (A2, transacción): exige artículo+fechaEntregaRC+tipoTela+tipoAplicación; omite condicionales si la orden no lleva aplicación RECONECTANDO a los antecesores TRANSITIVOS reales (no el decremento frágil de VerifAntecesor); resurtido → procesos esResurtido con duración 0 auto-completados con la fecha de inicio; TODO proceso con duración 0 queda auto-completado (semántica TiemposEnCero explícita); snapshot de procesos+dependencias+plan; RE-GENERAR permitido SIN perder fechas reales capturadas (mejora explícita vs el bloqueo 'Ya está programada'); deja la ruta en estado 'fechas pendientes de cálculo' y encola el job CPM (que se implementa en E4)
- Servicio ajustarRutaOrden (D10): agregar/quitar/ajustar procesos y dependencias de UNA orden sobre RutaOrden/RutaOrdenDep sin tocar la plantilla; re-encola recálculo
- Endpoints REST: POST programar / re-programar (respuesta INMEDIATA con la ruta generada y estado del recálculo — la captura NUNCA espera, §11), PATCH ajustar ruta, GET ruta de la orden (renglones, duraciones, dependencias, estado)

**Entregables:**
- Migración Prisma (RutaOrden/RutaOrdenDep/RutaOrdenChecklist + campos en Orden)
- Motor pg-boss en comun/ con tests (encolar, singleton key, reintentos)
- Servicios calcularDuracion/generarRutaOrden/ajustarRutaOrden con TSDoc (referencia a 08 §2.3/§4, D10, A2/A7) y tests unit + integración (testcontainers): duraciones por las 4 reglas con casos calculados a mano desde los CSV, condicionales reconectados transitivos, resurtido, duración 0, re-generación conservando fechas reales
- Rutas REST + openapi.json regenerado + cliente frontend sincronizado (aunque la UI llegue en E5)
- ADR en docs/arquitectura/: decisión FactCantAp + FactorTela (conservar comportamiento actual, descarte explícito) y patrón de jobs/serialización
- Guion de verificación para Gabriel con los cuerpos JSON EXACTOS listos para pegar en Swagger (programar, re-programar, ajustar) — Gabriel verifica como usuario, no arma payloads

**Criterio de cierre:**
- Toda la lógica en backend/src/dominio (A1) — cero reglas en rutas; transacciones A2 en generar/ajustar; verificado en review
- Tests en verde (duraciones cuadradas a mano contra CP_Tiempos/CP_Cant/RC_TipoTelas/RC_Aplicaciones); CI verde
- Review aprobado por LOS DOS reviewers
- ADR de FactCantAp/FactorTela mergeado; openapi.json + esquema.gen.ts sincronizados
- Verificación de Gabriel vía Swagger (con el guion entregado) completada y merge a prueba

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`; login en http://localhost:8080; abrir Swagger en http://localhost:8080/api/docs
- [ ] Tomar (o crear en Pedidos/Órdenes) una orden de prueba con artículo y cantidad; pegar el cuerpo JSON del guion en POST …/ruta-critica/ordenes/{id}/programar (tipo de tela, aplicación, fechaEntregaRC)
- [ ] Confirmar que la respuesta fue INMEDIATA, con la ruta generada y el estado 'fechas pendientes de cálculo' (el CPM llega en E4): un renglón por proceso aplicable con su duración
- [ ] Comparar 2-3 duraciones contra las reglas de E2 con el guion (proceso variable = tiempo × factor del rango de cantidad + colchón; proceso de tela = días del tipo elegido en RC_TipoTelas.csv)
- [ ] Programar una orden SIN aplicación con el segundo cuerpo del guion → los procesos condicionales NO aparecen y sus sucesores quedan colgados de los antecesores transitivos correctos (el guion dice cuáles)
- [ ] Programar una orden marcada como resurtido → los procesos de resurtido aparecen con duración 0 y ya completados con la fecha de inicio
- [ ] PATCH ajustar (cuerpo del guion): agregar un proceso extra y quitar uno a ESA orden → GET de la ruta lo refleja; abrir RC → Plantillas y confirmar que la plantilla NO cambió (D10)
- [ ] Re-programar la misma orden → la ruta se regenera sin error y sin perder lo capturado (el guion incluye el caso)

**Equipo:** 1 coder + 2 reviewers (motor crítico: PLANMAESTRO §9 pide refuerzo en tareas grandes; cadena esquema→duración→generación, NO se paralelizan coders)

**Referencias:**
- Documentacion_MJD/08-Ruta-Critica.md §2.2, §2.3 (fórmulas de TiempoRC y encadenamiento) y §4
- PLANMAESTRO.md §4 (RutaOrden), §9 (tareas grandes), §11 ('cálculos pesados frenando la captura' → pg-boss)
- DECISIONES.md D10, D11 (modelo pensado para explotación analítica — snapshot del plan original)
- Respaldo CLAUDE/Respaldo CLAUDEFormularios/RC_ProgramacionSub.txt (HacerProgramacion, VerifAntecesor, TiemposEnCero, EsResurtidoBoton, TelasDias — leer con latin-1) y RC_Programacion.txt
- Respaldo CLAUDE/TABLAS/RC_TipoTelas.csv (columna FactorTela presente y NO usada por TelasDias — va a la ADR), CP_Cant.csv
- Riesgos del inventario: 'colchón escondido', 'FactCantAp', 're-enlace por decremento', 'TiemposEnCero', 'snapshot para D11'

---

## F5-E4 · Motor RC parte 2 (backend): CPM en pg-boss + captura de avance + checklist + semáforo y EnRiesgo — ✅ COMPLETA (22-jun-2026)

> **✅ Nota de cierre (22-jun-2026; 1 coder + 2 reviewers independientes — ambos APROBARON; pendiente verificación de Gabriel en `prueba`).** Segunda mitad del motor de la RC, todo en backend (la UI llega en E5). **SIN migración** (los campos `fechaPlaneada*`/`acumuladoDias`/`estado`/`origenCaptura`/checklist ya existían de E3).
> - **CPM backward-pass** — `dominio/ruta-critica/cpm.ts` (PURO, testeable sin BD) + `cpm-job.ts` (wrapper de BD + handler de la cola `recalcularRutaOrden` que E3 dejó registrada sin implementar; `registrarHandlerCpm`). Programa hacia atrás desde `Orden.fechaEntregaRC`: el/los terminal(es) anclan en la entrega; `fin(p)=MIN(inicio de sucesores)`; `inicio(p)=sumarDiasHabiles(fin,-duracion)` (reusa `comun/diasHabiles.ts` de E2, todo UTC; duración 0 ⇒ inicio=fin). Orden topológico **Kahn**; N antecesores → el inicio de la ruta lo marca la cadena más larga (equiv. al MAX del forward). Reemplaza el forward+nudge `'OtraVez'` del viejo por una sola pasada exacta. **Idempotente:** `fechaPlaneadaOriginal` solo se escribe si está null (snapshot del 1er cálculo, D11); `fechaPlaneadaVigente` y `acumuladoDias` (=`contarDiasHabiles(inicioRuta, fin(p))`; en el terminal = lead time) siempre; NUNCA toca `fechaReal`/captura/estado. Serializado por orden (singletonKey de E3, `localConcurrency:1`); errores se propagan a pg-boss para reintento (idempotente ⇒ seguro).
> - **Cumplimiento** `dominio/ruta-critica/cumplimiento.ts` (A2/A7): `completarProceso` (registra `capturadoPorId`/`capturadoEn`/`origenCaptura='manual'`/`estado='completado'`; valida `rc.capturar` **Y** que ALGÚN rol del usuario esté en `ProcesoDefRol` N:M del proceso —o admin—; activa los sucesores cuyos antecesores estén TODOS completados, "la pelota pasa de mano en mano", generaliza `QueActiva` a N; si es `ultimoProceso` cierra la RC `rcActiva=false` = `MatarRC`). `revertirProceso` (limpia fecha real/captura, recalcula estado de sucesores, audita; reabre la RC). `marcarChecklistItem` (completar TODOS los ítems auto-completa el padre con `origenCaptura='evento'`; desmarcar SOLO revierte lo auto-completado por el sistema —`origenCaptura !== 'manual'`— así una captura manual nunca se pisa). **La RC NUNCA escribe `Orden.fechaEntrega`** (decisión (c) de E3). **Todas las capturas de una orden serializan con `pg_advisory_xact_lock(idEmpresa,idOrden)`** —misma familia 0x4F='O' que `bloquearEtapasDeOrden` de F3-E2— para que dos antecesores completados en paralelo no dejen colgado al sucesor común.
> - **Semáforo y riesgo** `dominio/ruta-critica/semaforoYRiesgo.ts` (PURO/derivado, A1): estado `aTiempo|enRiesgo|atrasado` por proceso y por orden (peor de sus procesos) comparando HOY vs `fechaPlaneadaVigente`; umbral único `UMBRAL_RIESGO_DIAS=3`. Regla "**EnRiesgo nace ANTES de programar**" como **job RECURRENTE** `comun/jobs/riesgo-rc.ts` (cola nueva `barridoRiesgoRc`, `boss.schedule` cron horario configurable `RC_RIESGO_CRON`, NO-OP con `JOBS_ACTIVOS=false`, best-effort): barre las órdenes con RC activa y persiste `Orden.enRiesgo` (booleano legacy v1 reutilizado; solo el barrido lo escribe, idempotente); el GET deriva el tri-estado en vivo.
> - **API** (`programacion.rutas.ts`): 2 `PUT` nuevos (capturar/revertir fecha real; marcar ítem de checklist) con RBAC server-side, handlers delgados (A1). El `GET …/ruta` se EXTENDIÓ con el **semáforo** por proceso y por orden y el **estado del recálculo** (para el indicador 'recalculando…' de E5). **Permiso NUEVO `rc.capturar`** (captura de avance/checklist; operativo, cascadea) → **el deploy a `prueba` requiere `SEED_ON_START=true`**. OpenAPI + `esquema.gen.ts` regenerados (sin cambio de firma respecto a E3 salvo los 2 PUT + el semáforo).
> - **Script `npm run demo:rc`** (`backend/scripts/demo-rc.ts`): corre la secuencia completa (programar la plantilla chica, capturar, re-programar) e imprime la tabla de fechas para que Gabriel compare. **ADR-0013** (algoritmo CPM backward-pass + decisión RC↔`Orden.fechaEntrega` + umbral del semáforo).
> - **Hallazgos del review cerrados y re-verificados:** (🟡) el advisory lock por orden y (🟡) el checklist que ya no pisa una captura manual; (🟢) acumulado global documentado, test de concurrencia renombrado, param sin usar eliminado.
> - **A ratificar con Daniel (no bloquea):** el **umbral del semáforo = 3 días** (afina el "+7 URGENTE" del viejo; cambiable en un solo sitio) y la **frecuencia del barrido = horaria**.
> - **Gates locales en verde:** backend `format:check`/`typecheck`/`lint`/`build` + **622 unit** (60 archivos, incl. `cpm.test.ts`/`semaforoYRiesgo.test.ts` con fechas calculadas a mano); frontend `typecheck`/`build`/`test` **383** sin regresión (solo se regeneró el cliente OpenAPI; sin UI nueva). Integración con testcontainers (cumplimiento, concurrencia, manual-no-pisado) corre en CI; el transporte real del cron/serialización se valida en Railway.

**Objetivo:** Segunda mitad del motor: programar fechas con CPM hacia atrás en días hábiles como job de pg-boss (la captura NUNCA espera, §11), completar procesos activando sucesores, checklist con auto-completado reversible, y el semáforo con la regla EnRiesgo. Cierra el motor completo que las pantallas de E5 consumen.

**Alcance:**
- Job motorCPM (pg-boss, sobre la infraestructura de E3): programación hacia atrás desde fechaEntregaRC usando calendarioLaboral de E2 (algoritmo limpio backward pass; con N antecesores fechaInicio = MAX(fin de antecesores); acumulado del último proceso = lead time); llena fechaPlaneadaORIGINAL (solo la primera vez) y fechaPlaneadaVigente; idempotente y SERIALIZADO por orden (singleton key de E3 — dos eventos de la misma orden no se pisan); RE-PROGRAMAR conserva fechas reales y plan original; ADR que documenta el algoritmo y su equivalencia con EstablecerLasFechas (incluido el bucle 'OtraVez' del viejo)
- Servicio completarProceso: registra quién/cuándo (base del KPI D11), valida server-side permiso y que ALGUNO de los roles del usuario esté en los roles responsables del proceso (ProcesoDefRol, N:M), activa sucesores ('la pelota pasa de mano en mano'), si es ultimoProceso cierra la RC (rcViva=false, equivalente MatarRC); reversión de fecha real con registro en Bitacora; DECISIÓN documentada en ADR sobre el efecto colateral del viejo (FechaEst del proceso 'C' escribía Ordenes.FechaEntrega): propuesta = la RC NO escribe fechas de la orden en silencio, expone su fecha y la orden decide
- Servicio checklistProceso: completar TODOS los ítems auto-completa el proceso padre (fechaReal + usuario); desmarcar un ítem REVIERTE la fecha real dejando rastro en Bitacora (no se pierde historia, A7)
- Servicio semaforoYRiesgo: estado por proceso y por orden (aTiempo|enRiesgo|atrasado) comparando hoy vs fechaPlaneadaVigente; regla 'EnRiesgo nace ANTES de programar' (si al asignar artículo+fechaEntregaRC ya pasó la fecha de inicio requerida) implementada como job recurrente que barre órdenes — sin tocar el servicio de órdenes de F2; recálculo continuo, no solo al capturar
- Endpoints REST: PUT fechaReal (capturar/revertir), PUT checklist item, POST re-programar con recálculo completo, GET ruta de la orden con fechas, semáforo y estado del recálculo (para el indicador 'recalculando…' de E5)

**Entregables:**
- Job motorCPM y job de semáforo registrados en el arranque del servidor, con tests
- Servicios completarProceso/checklistProceso/semaforoYRiesgo con TSDoc (referencia a 08 §2.3/§4, D10/D11, A2/A7) y batería FUERTE de tests: unit del CPM con casos calculados a mano (festivos, N antecesores, condicionales reconectados, duración 0, re-programación conservando fechas reales y plan original) + integración con testcontainers + test de concurrencia (2 recálculos de la misma orden)
- Rutas REST + openapi.json regenerado + cliente frontend sincronizado (aunque la UI llegue en E5)
- ADR en docs/arquitectura/: algoritmo CPM v2 (backward pass, días hábiles, MAX antecesores, serialización por orden) y decisión RC↔Orden.fechaEntrega
- Script `npm run demo:rc` en el backend que ejecuta la secuencia completa (programar la plantilla chica de 3 procesos, capturar, re-programar) + tabla de fechas esperadas — Gabriel solo compara los GET contra la tabla, sin armar JSON
- Guion de verificación con los cuerpos JSON exactos para los pasos que Gabriel haga a mano en Swagger

**Criterio de cierre:**
- Toda la lógica en backend/src/dominio (A1); transacciones A2 en completar/revertir; verificado en review
- Tests en verde incluyendo el caso de cuadre manual del CPM y el de concurrencia; CI verde
- Review aprobado por LOS DOS reviewers
- ADR del CPM mergeado; openapi.json + esquema.gen.ts sincronizados
- Verificación de Gabriel (script demo + Swagger con guion) completada y merge a prueba

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`; correr `docker compose exec backend npm run demo:rc` y comparar las fechas que imprime contra la tabla de fechas esperadas del entregable (plantilla chica de 3 procesos: 2+3+1 días)
- [ ] GET de la ruta de la orden demo en Swagger: confirmar que las fechas planeadas (a) NO caen en sábado/domingo ni en el festivo capturado en E2 y (b) la cadena termina en la fechaEntregaRC
- [ ] Re-programar (cuerpo del guion) con otra fechaEntregaRC → la respuesta es INMEDIATA y las fechas nuevas llegan después (estado del recálculo): la captura no espera al CPM
- [ ] PUT fechaReal al primer proceso (cuerpo del guion) → GET: los sucesores aparecen activos; completar el ÚLTIMO proceso → la orden queda con rcViva=false
- [ ] Cambiar la fechaEntregaRC y re-programar → las fechas reales ya capturadas NO se pierden; la fechaPlaneadaOriginal se conserva y la vigente cambia
- [ ] PUT de los ítems del checklist de un proceso hasta completarlos todos → el proceso queda completado solo (fechaReal + usuario); desmarcar un ítem → la fechaReal se revierte y queda rastro en la Bitácora (verla en Administración → Bitácora)
- [ ] Dejar un proceso con fecha planeada vencida sin fecha real → el GET lo marca 'atrasado' y la orden queda EnRiesgo (job de semáforo)

**Equipo:** 1 coder + 2 reviewers (motor crítico: PLANMAESTRO §9 pide refuerzo en el CPM; cadena CPM→captura→semáforo, NO se paralelizan coders)

**Referencias:**
- Documentacion_MJD/08-Ruta-Critica.md §2.2, §2.3 (encadenamiento y fechas) y §4 capacidad 2 (recálculo automático CPM)
- PLANMAESTRO.md §4 (RutaOrden), §9 (tareas grandes), §11 (pg-boss)
- DECISIONES.md D10, D11 (quién y cuándo capturó = base de KPIs)
- Respaldo CLAUDE/Respaldo CLAUDEFormularios/RC_ProgramacionSub.txt (EstablecerLasFechas con su bucle 'OtraVez') — leer con latin-1
- Respaldo CLAUDE/Respaldo CLAUDEModulos/Funciones RC.txt (FechaHabiles, CuantosSabYDom, QueActiva, EsUrgente)
- Documentacion_MJD/03-Produccion.md (campos RC de la tabla Ordenes: SI_RC, RC_Viva, EnRiesgo, FechaInicioRC, FechaEntregaRC, FechaProg)
- Riesgos del inventario: 'CPM iterativo', 'FechaEst del proceso C', 'MatarRC', 'concurrencia del recálculo'

---

## F5-E5 · Pantallas de operación: Programar RC, bandeja de tareas con semáforo y alertas (PC+móvil) y RC por orden — ✅ COMPLETA (22-jun-2026)

> **✅ Nota de cierre (22-jun-2026; 1 coder de backend + 1 coder de frontend en fases secuenciales + 1 reviewer independiente — APROBADO; pendiente verificación de Gabriel en `prueba`).** El motor de E3/E4 queda en manos de los usuarios con pantallas responsive (PC + móvil), todo consumiendo el cálculo del backend (A1: cero lógica de negocio en React).
> - **Backend (2 consultas nuevas, todo en `dominio/ruta-critica/bandeja.ts`, A1):** `consultarBandeja` ("mis tareas" = renglones `RutaOrden` con `estado='activo'` de órdenes con `rcActiva`, donde los roles del usuario INTERSECTAN `ProcesoDefRol` N:M del proceso —replica `exigirCapturaProceso` de `cumplimiento.ts`, admin ve todo; flag `todas` solo amplía con `rc.programar`, si no se IGNORA; filtro `idProcesoDef` se INTERSECA con los responsables, no expone procesos ajenos; scope por empresa activa; una sola query con `include` anti-N+1; **semáforo y `diasAtraso` calculados en el dominio** reusando `estadoSemaforoProceso` de `semaforoYRiesgo.ts`; orden por urgencia atrasado>enRiesgo>aTiempo / atraso desc / fecha asc; paginación en memoria sobre el universo acotado de tareas activas) y `contarAlertas` (`{atrasados, enRiesgo}` sobre mis tareas, alimenta el badge). **2 endpoints GET** (`/ruta-critica/bandeja`, `/ruta-critica/alertas/conteo`) con RBAC server-side `rc.ruta-ver`. **Extensión ADITIVA** del `GET …/ruta`: campo `capturadoPorNombre` (resuelto sin N+1 vía `nombresCapturadores` en `rutaOrden.ts`) para que "RC por orden" muestre quién capturó cada fecha — declarado en el schema de respuesta Y poblado en la proyección (fastify-zod descarta campos no declarados); no cambia campos existentes, no rompe los tests de E4. **SIN migración, SIN permisos nuevos, SIN seed** → el deploy a `prueba` **NO requiere `SEED_ON_START`** por esta etapa (reusa `rc.ruta-ver`/`rc.programar`/`rc.capturar` de E1–E4).
> - **Frontend (3 páginas teal responsive + badge + componente reutilizable):** **`Semaforo`** (tri-estado emerald/amber/red, en `ruta-critica/piezas.tsx`, lo reusan bandeja, RC por orden, badge) + `fechaRc` (formateo SIN desfase UTC, tolerante a date-only y datetime ISO). **`ProgramarRcPagina`** (`/ruta-critica/ordenes/:idOrden/programar`, permiso `rc.programar`): form artículo/tela/aplicación (dropdowns con `porPagina:100` por la trampa conocida) + fechaEntregaRC/fechaInicioRC + resurtido, **Programar/Re-programar** (POST), **"Copiar de orden anterior"** (reusa GET ruta, sin endpoint nuevo), indicador **"recalculando…"** vía `refetchInterval` condicionado a `estadoRecalculo==='recalculando'` (se detiene solo, NO bloquea la captura), y **ajustes de procesos de ESA orden** (PATCH …/ruta) con el texto explícito "la plantilla no se toca (D10)". **`BandejaTareasPagina`** (`/ruta-critica/bandeja`, `rc.ruta-ver`): mis tareas por urgencia con `Semaforo`, **captura rápida Hoy/Ayer** (fecha date-only en hora LOCAL, sin off-by-one → PUT cumplimiento; invalida bandeja+conteo+ruta → la tarea desaparece y se activa el sucesor), checklist marcar/desmarcar, filtros + toggle "ver todas"; cards en móvil. **`RutaPorOrdenPagina`** (`/ruta-critica/ordenes/:idOrden`, `rc.ruta-ver`): timeline plan vs real por proceso, estado, semáforo, quién (`capturadoPorNombre`) y cuándo capturó; cards en móvil. **`BadgeAlertasRc`** en el header (`CascaronSistema`): conteo atrasados+enRiesgo (rojo si atrasados>0, ámbar si solo enRiesgo, oculto en 0), refetch ~60s, click → bandeja; solo con `rc.ruta-ver`. Wiring: 3 rutas en `App.tsx`, entrada de menú "Bandeja de tareas" en `catalogo.ts` (`rc.ruta-ver`), botones "Programar RC"/"Ver Ruta Crítica" en el detalle de `OrdenesPagina` (gateados por permiso, ocultos en canceladas).
> - **Impreso PDF del plan (R9): CONSTRUIDO en E5** (decisión (g) de Daniel). Server-side (`@react-pdf/renderer`, mismo patrón que orden/OC/nota/entrega): `dominio/ruta-critica/impresos/impreso-plan-rc.ts` + ruta binaria `GET /ruta-critica/ordenes/:id/plan-impreso` (permiso `rc.ruta-ver`, **scope de empresa A9 impuesto por el propio impreso** —`obtenerRutaOrden` no filtra por empresa, gap preexistente—, 400 si la orden no tiene RC, 404 si no es de la empresa) con encabezado (folio, cliente, modelo, fechaEntregaRC, semáforo) + tabla de procesos (fecha planeada, duración, responsables de `ProcesoDefRol`, estado, fecha real). Botón **"Imprimir plan"** en *RC por orden* (`window.open`, calca `urlComprobanteEntrega`; oculto si la orden no tiene RC). Tests unit+int del impreso + Vitest del botón.
> - **Hallazgo del review cerrado y re-verificado (🔴):** `fechaRc` rendía **"Invalid Date"** en TODA fecha de la RC porque el contrato serializa datetime ISO completo y la función solo parseaba date-only (los tests no lo cazaban por usar mocks date-only ≠ contrato); verde en CI, roto en Railway. Fix: `valor.slice(0,10)` antes de parsear + guard endurecido a los 3 componentes; mocks de los 4 tests realineados al formato real + caso de regresión explícito que falla con el código viejo. (🟡) prefill de los `<input type="date">` de re-programación también cortado a `slice(0,10)`. (🟢) paginación en memoria de la bandeja: aceptable para el volumen (universo acotado de tareas activas); anotado por si una empresa acumulara miles de procesos activos simultáneos.
> - **Gates locales en verde (comandos exactos del CI):** backend `format:check`/`typecheck`/`lint`/`test`/`build`; frontend `format:check`/`typecheck` (`tsc -b`, cubre `e2e/`)/`lint`/`test` **398**/`build`. Tests de integración (testcontainers: bandeja con 2 antecesores uno incompleto ⇒ no activa, rol secundario SÍ ve la tarea, `todas`, conteo, `capturadoPorNombre`) y e2e Playwright (flujo programar→bandeja→capturar Hoy→pelota pasa→cierre; + viewport móvil 390×844) corren en CI.

**Objetivo:** Poner el motor de E3/E4 en manos de los usuarios: programar la RC desde la orden con recálculo en segundo plano visible, la bandeja 'MIS tareas' con semáforo, alerta mínima viable (badge de atrasados/en riesgo) y captura rápida (también en celular), y el timeline planeado-vs-real por orden. Corte vertical sobre los endpoints de E3/E4 + las consultas nuevas que necesita.

**Alcance:**
- Backend (consultas, en dominio): bandejaTareas — proceso ACTIVO = sin fechaReal y TODOS sus antecesores completados (generaliza QueActiva a N antecesores); 'MIS tareas' = procesos cuyo CONJUNTO de roles responsables (ProcesoDefRol, N:M de E1) INTERSECTA los roles del usuario — con un solo rol por proceso se perdería a los responsables secundarios que hoy existen en el 100% de los procesos; filtros por usuario/rol/proceso/orden; orden por urgencia (semáforo + días de atraso); consulta timeline por orden; consulta de CONTEO de mis procesos atrasados/en riesgo (alimenta el badge). Endpoints GET con permisos A4; OpenAPI + cliente sincronizados
- Pantalla 'Programar la RC' (PC, desde la orden): captura de datos de programación (artículo, tipo de tela, tipo de aplicación, fechaEntregaRC) con 'copiar de orden anterior' (CopiarAnt/Copiar_Click del viejo); botón Programar/Re-programar; indicador 'recalculando…' SIN bloquear (estado del recálculo de E4); marcar resurtido; agregar/quitar/ajustar procesos de ESA orden (ajustarRutaOrden de E3) dejando claro que la plantilla no se toca (D10) — reemplaza RC_MeterInfo + RC_Programacion/Sub
- Pantalla 'Bandeja de tareas' (PC + MÓVIL): mis procesos activos ordenados por urgencia, semáforo aTiempo/enRiesgo/atrasado, captura rápida de fechaReal con botones Hoy/Ayer, checklist por proceso (marcar/desmarcar con la semántica de E4) — reemplaza RC_MeterFechas/Sub + RC_MeterDatosDet + RC_PorUsuario/Sub
- ALERTA mínima viable (08 §4 capacidad 3: 'bandeja… con semáforo… y alertas'): badge/contador en el encabezado del layout con MIS procesos atrasados y en riesgo, visible al entrar al sistema desde cualquier módulo, alimentado por el job de semáforo de E4 vía la consulta de conteo — sin infraestructura nueva; las notificaciones push/correo se DIFIEREN a F7 (se registra en docs/modulos/ruta-critica.md en E7)
- Pantalla 'RC por orden' (PC + MÓVIL consulta): timeline/Gantt de la ruta completa, planeado vs real, estado por proceso, quién y cuándo capturó cada fecha — reemplaza RC_PorOrden/Sub
- Componente semáforo reutilizable (lo reusarán el concentrado de E7 y Calidad en F6)
- Impreso candidato (R9, SOLO si Daniel lo confirma antes de esta etapa — Gabriel pregunta y se registra en DECISIONES.md): PDF 'Plan de la RC por orden' con @react-pdf/renderer (procesos, fechas planeadas, responsables) desde la pantalla RC por orden; si no se confirma, se registra la decisión y no se construye

**Entregables:**
- Endpoints de consulta (bandeja, timeline, conteo de alertas) en dominio + api con tests de integración (casos: proceso con 2 antecesores, uno incompleto → NO activo; usuario con un rol secundario del proceso SÍ lo ve en su bandeja)
- 3 páginas React responsive + badge de alertas en el layout, con tests Vitest + e2e Playwright del flujo completo: programar → bandeja → capturar con 'Hoy' → pelota pasa → último proceso cierra la RC
- openapi.json + esquema.gen.ts regenerados y sincronizados
- PDF del plan (si se confirmó) con su test de generación
- Captura del estado en docs de la PR: pantallas en desktop y en viewport móvil

**Criterio de cierre:**
- Tests + e2e en verde; CI verde; review aprobado (A1: cero lógica de negocio en React — semáforo, activación y conteo de alertas vienen calculados del backend; bandeja por INTERSECCIÓN de roles N:M verificada)
- Bandeja y RC por orden usables en viewport móvil (Playwright con viewport de teléfono en verde)
- Verificación de Gabriel (incluida la prueba desde su celular) completada y merge a prueba

**Verificación de Gabriel:**
- [ ] `docker compose up -d --build`; abrir una orden y programar su RC desde la pantalla nueva: ver el indicador 'recalculando…' y que las fechas aparecen solas al terminar, sin trabar la captura
- [ ] En esa orden: quitar un proceso condicional y agregar un proceso extra → abrir la plantilla en RC → Plantillas y confirmar que NO cambió (D10)
- [ ] Entrar con un usuario que tenga UNO de los roles responsables del primer proceso → Bandeja: ver SU tarea con semáforo; entrar con OTRO usuario que tenga el rol secundario del MISMO proceso → también la ve (responsables N:M, comparar contra RC_ProcUsua.csv)
- [ ] Capturar con el botón 'Hoy' → la tarea desaparece y al entrar con el usuario del siguiente proceso, su tarea ya está activa ('la pelota pasa de mano en mano')
- [ ] Checklist: marcar TODOS los ítems de un proceso → se completa solo con fecha y usuario; desmarcar un ítem → la fecha real se revierte y en Administración → Bitácora queda el rastro
- [ ] Forzar un atraso (proceso con fecha planeada de ayer sin fecha real) → semáforo en rojo en bandeja, la orden marcada EnRiesgo, y el BADGE de alertas del encabezado muestra el conteo desde cualquier módulo; capturar esa tarea → el contador baja
- [ ] Desde el celular (misma red WiFi, abrir http://<IP-de-tu-PC>:8080): bandeja y RC por orden se ven y operan bien; capturar un 'Hoy' desde el teléfono
- [ ] RC por orden: timeline con planeado vs real y quién capturó cada fecha
- [ ] Si se confirmó el impreso: generar el PDF del plan y compararlo contra la pantalla

**Equipo:** 2 coders en paralelo (pieza A: pantalla Programar RC + ajustes por orden · pieza B: bandeja + badge de alertas + RC por orden + endpoints de consulta) + 1 reviewer — páginas y endpoints distintos sin solape de archivos; el cliente OpenAPI y el componente semáforo se integran al final en una sola pasada

**Referencias:**
- Documentacion_MJD/08-Ruta-Critica.md §2.4 (ejecución y seguimiento) y §4 capacidad 3 (bandeja con semáforo Y ALERTAS)
- PLANMAESTRO.md 'Acceso' (captura en PC, consultas/autorizaciones también en móvil) y §11 (la captura nunca espera)
- MEJORAS.md §08 🟡 ('con semáforo… y alertas', sub-checklists); REQUISITOS-NUEVOS.md R9 (impresos nuevos 'por definir')
- Respaldo CLAUDE/TABLAS/RC_ProcUsua.csv (responsables N:M reales para la prueba de bandeja)
- Respaldo CLAUDE/Respaldo CLAUDEFormularios/RC_MeterInfo.txt, RC_MeterFechas.txt, RC_MeterFechasSub.txt, RC_MeterDatosDet.txt, RC_PorOrden.txt, RC_PorUsuario.txt (latin-1) — referencia del QUÉ, no del CÓMO
- docs/modulos/patron-crud.md (convenciones de página/grid de F0)

---

## F5-E6 · Auto-avance: eventos de dominio en F3/F4 y suscriptor de la RC — ⬜ pendiente

**Objetivo:** Que las fechas 'se llenen solas donde aplica' (criterio de salida): los servicios YA construidos de F3 (corte, envío/recibo de maquila costura y estampado, entrega a cliente) y F4 (recepción de materiales R7, órdenes de compra) emiten eventos de dominio al confirmar su transacción y la RC los consume completando el proceso por tipoEvento. Etapa propia y al final del flujo principal porque toca código AJENO probado y desplegado — el recibo de maquila es el punto de integración central de §5.

**Alcance:**
- Mecanismo de eventos de dominio en backend/src/comun: publicación vía pg-boss send DENTRO de la misma transacción del servicio emisor (atomicidad A2: si el recibo hace rollback, el evento no existe) — sobre la infraestructura de jobs de E3
- Ganchos MÍNIMOS en servicios de F3: registrarCorte, registrarEnvio (costura/estampado), recibirMaquila (costura/estampado), entregarCliente; y de F4: recepción de materiales (telas y avíos, R7) y creación/autorización de OC — emiten evento {tipoEvento, idOrden, cantidades por color×talla D4, idMovimiento origen, usuario} SIN cambiar su contrato ni su lógica; sus suites de tests completas quedan en verde (regresión obligatoria)
- Servicio autoAvance (dominio ruta-critica, suscriptor pg-boss): mapea tipoEvento → proceso(s) de la ruta de ESA orden (vía ProcesoDef.tipoEvento, equivalente a los TipoProceso viejos con evento: T/CO/EC/C/EP/RP/CP/AP — los tipos M, F y vacío son de captura manual y NO generan auto-avance, ver mapeo completo del ETL en E7); completa fechaReal con origenCaptura='evento' y referencia al movimiento; activa sucesores y encola recálculo CPM + semáforo (jobs de E4)
- Regla de recibos PARCIALES (decisión de negocio NUEVA — Gabriel la confirma con Daniel ANTES de codificar y se registra en Documentacion_MJD/DECISIONES.md; propuesta a presentarle: el proceso se completa al llegar la cantidad COMPLETA, con marca visible de 'parcial en curso' desde el primer recibo, sobre cantidades color×talla D4/R7)
- Regla de conflicto evento vs captura manual: si ya hay fechaReal manual, el evento NO la pisa; se registra en Bitacora como 'evento recibido sobre proceso ya completado'
- Regla de cancelación del movimiento origen: el proceso NO se descompleta solo; se registra en Bitacora y aparece advertencia en la bandeja/timeline (decisión documentada)
- Idempotencia: el mismo evento procesado dos veces produce UN solo efecto (clave de deduplicación por movimiento origen); jobs serializados por orden (mismo singleton key de E3/E4)

**Entregables:**
- Motor de eventos en comun/ con tests; ganchos en F3/F4 con sus suites COMPLETAS en verde (sin tests borrados ni debilitados)
- Servicio autoAvance con TSDoc y tests de integración: evento completa proceso correcto, parcial vs total según la regla acordada, evento duplicado = 1 efecto, evento sobre fecha manual no pisa, transacción del recibo de maquila sigue cuadrando IPT + EsMa + WIP + RC en UNA operación (test end-to-end del punto de integración central)
- Entrada nueva en DECISIONES.md (regla de parciales y de cancelación) redactada y confirmada
- openapi.json regenerado SOLO si cambió el contrato (los ganchos no deberían cambiarlo); si cambia, cliente sincronizado
- Indicador visual en bandeja/timeline de origen de la fecha (manual vs evento) — ajuste menor de frontend

**Criterio de cierre:**
- Suites completas de F3 y F4 en verde SIN modificaciones de aflojamiento (verificado explícitamente por el reviewer) + suite nueva de autoAvance en verde + CI verde
- El recibo de maquila sigue siendo UNA transacción que actualiza WIP + IPT + EsMa + RC (PLANMAESTRO §5) — probado con test de integración
- Decisión de parciales registrada en DECISIONES.md y confirmada por Daniel (vía Gabriel) ANTES del merge
- Verificación de Gabriel completada y merge a prueba

**Verificación de Gabriel:**
- [ ] ANTES de que el coder arranque: preguntar a Daniel la regla de recibos parciales (¿el proceso de la RC se completa con el primer recibo o hasta la cantidad completa?) y pasarla al equipo
- [ ] `docker compose up -d --build` con una orden programada (flujo de E5)
- [ ] En Producción registrar el CORTE de esa orden → abrir RC por orden: la fechaReal de 'Corte' se llenó SOLA, marcada como origen 'evento' con referencia al movimiento
- [ ] Registrar un recibo de maquila de costura → el proceso de recibo de confección se completa solo Y verificar que el recibo sigue haciendo lo de F3: entrada en kardex IPT y cargo en EsMa (abrir ambas pantallas y comparar como en la verificación de F3)
- [ ] Registrar una recepción de tela (F4) → el proceso 'recibir tela' responde según la regla parcial/total acordada (probar un recibo parcial y luego el resto)
- [ ] Capturar a MANO la fechaReal de un proceso y después generar su evento → la fecha manual NO cambia; en Bitácora queda el registro del evento ignorado
- [ ] Repetir el mismo evento (p. ej. otro recibo de la misma remesa) → sin fechas duplicadas ni errores
- [ ] Confirmar que el semáforo, el badge de alertas y las fechas de los sucesores se refrescaron solos (recálculo en background) sin que ninguna captura se sintiera lenta

**Equipo:** 1 coder + 1 reviewer (cadena emisión→consumo no paralelizable; el reviewer además corre las suites íntegras de F3 y F4 como regresión y revisa que los ganchos sean mínimos)

**Referencias:**
- REQUISITOS-NUEVOS.md R7 ('🔗 Integración con la RC: la FechaReal se llena sola') y la distinción recibido parcial/total
- PLANMAESTRO.md §5 'Punto de integración central' (recibo de maquila = una transacción WIP+IPT+EsMa+RC) y §4 (eventos auto-completan procesos)
- DECISIONES.md D4 (cantidades por color×talla en los eventos de F3)
- Documentacion_MJD/03-Produccion.md (flujos M/A de maquila, corte, entrega) y 08-Ruta-Critica.md §1 ('procesos anidados… unos activan a otros')
- Riesgos del inventario: 'Auto-avance vs captura manual y recibos PARCIALES', 'Concurrencia del recálculo', 'Ganchos en F3/F4 tocan servicios ya probados'

---

## F5-E7 · Concentrado planeado vs real + exportación + ETL del módulo + documentación y cierre de fase — ⬜ pendiente

**Objetivo:** La vista gerencial que hoy es la pantalla más pesada del sistema viejo (RC_ConcentradoDif), rediseñada con agregación en servidor; la exportación a Excel; el ETL completo e idempotente de los catálogos, las asignaciones usuario↔rol funcional y el histórico RC; la doc del módulo; y la verificación funcional de TODA la fase contra el criterio de salida en el ambiente de prueba.

**Alcance:**
- Backend: consulta agregada del concentrado en dominio con SQL crudo o vista (todas las órdenes con RC viva × procesos, semáforo, días de atraso; paginada, filtrable por cliente/proceso/responsable y ordenable por retraso/cliente/fecha) — NUNCA pivote en el cliente; endpoint GET con permisos; exportación a Excel con exceljs del mismo resultado (confirmar con Daniel si basta el tablero o quiere el Excel — registrar en DECISIONES.md)
- Pantalla 'Concentrado planeado vs real' (PC + MÓVIL consulta): tablero con semáforo por orden×proceso, filtros y orden por retraso — reemplaza RC_ConcentradoDif
- ETL en backend/migracion (patrón §7: TypeScript idempotente, latin-1, cargando POR LOS SERVICIOS del dominio, reporte de cuadre por entidad): CP_Familia (1) y CP_Articulos (6) → FamiliaArticulo/ArticuloRC (o verificación si ya migraron en F1/F2); CP_Procesos (26) → ProcesoDef con TABLA DE MAPEO COMPLETA de los valores REALES de TipoProceso {'' (16 filas), M, F, T, AP, CO, EP, RP, CP, EC, C} → tipoEvento — explícito: M (Ficha técnica), F (Contramuestra autorizada) y vacío van a tipoEvento='manual' (no tienen evento que los complete) — más banderas (Critico, UltimoProceso, Variable→porCantidad, NoLlevaProceso→condicional, EsResurtido); CP_Procesos.AntecesorRef → ProcesoDep genérico Y CP_Tiempos.Antecesor → dependencias de PlantillaRutaProceso (el encadenamiento POR ARTÍCULO manda); CP_Tiempos (156) → plantillas+tiempos; CP_Cant (11) → FactorCantidad; RC_TipoTelas (7) → DuracionPorTipoTela (solo Dias; la columna FactorTela se LISTA en el reporte como no migrada a propósito, conforme a la ADR de E3); RC_Aplicaciones (9) → DuracionPorAplicacion; RC_TipoUsuarios (19) → roles RBAC existentes (cuadrar contra los creados en E1, sin catálogo paralelo, A4); RC_ProcUsua (68) → ProcesoDefRol N:M: 54 asignaciones vigentes migradas tal cual + 14 HUÉRFANAS (apuntan a procesos borrados) LISTADAS como inconsistencia de origen para decisión, no arregladas en silencio (§7); Usuarios.IdRC_TipoUsuarios → UsuarioRol con el rol funcional correspondiente (23 de 137 usuarios tienen tipo asignado — SIN esto nadie 'tiene' los roles y la bandeja de E5 quedaría vacía para los usuarios reales; renglón propio de cuadre listando los usuarios activos sin tipo); RC (181) → RutaOrden histórico con FechaEst/FechaReal + RC.IdUsuario → capturadoPor y RC.FechaUsuarioRC → capturadoEn (el dato que alimenta el KPI D11 de 'quién y cuándo capturó') + Acumulado; RC_IP3/IP4 (6+6) → RutaOrdenChecklist histórico; Ordenes.{FechaInicioRC, FechaEntregaRC, FechaProg, EnRiesgo, SI_RC, RC_Viva} → estado RC de órdenes migradas; Propiedades.ColchonCostura → ConfiguracionEmpresa
- docs/modulos/ruta-critica.md: cómo quedó construido el módulo (modelo, motor CPM, eventos, pantallas, decisiones tomadas, qué quedó abierto para F6/F7)
- Registro explícito de lo que esta fase DEJA ABIERTO: D8 (la auditoría de calidad como proceso de la RC se decide en F6 — los procesos #16/#20/#23 quedan migrados en el catálogo con tipoEvento 'auditoria'), D11 (los tableros KPI se construyen en F7 sobre RutaOrden) y las ALERTAS avanzadas (notificaciones push/correo se difieren a F7 junto con los tableros; en F5 queda el badge de E5 como mínimo viable)
- Verificación funcional completa de la fase contra el criterio de salida de §6 en el ambiente de prueba

**Entregables:**
- Consulta agregada + endpoint + export Excel con tests (incluye test de volumen: cientos de órdenes × 26 procesos responde paginado)
- Página del concentrado responsive con tests + e2e
- backend/migracion/ruta-critica con reporte de cuadre por entidad (conteos v1 vs v2, huérfanas y usuarios sin tipo LISTADOS, columnas no migradas declaradas) y prueba de idempotencia (correr 2 veces = mismos números); tests del ETL con los CSV reales
- openapi.json + esquema.gen.ts sincronizados
- docs/modulos/ruta-critica.md + actualización de CLAUDE.md §8 (estado de F5) + entradas nuevas en DECISIONES.md (Excel/impreso)
- Demo de cierre de fase documentada (guion + capturas) en la PR final a prueba

**Criterio de cierre:**
- Reporte de cuadre del ETL sin diferencias inexplicadas: 26 procesos (con el mapeo completo de TipoProceso incluidos M/F/vacío→manual), 156 tiempos, 11 rangos, 7 telas (FactorTela listada como no migrada a propósito), 9 aplicaciones, 19 roles mapeados, 68 filas de RC_ProcUsua cuadradas = 54 migradas a ProcesoDefRol + 14 huérfanas LISTADAS, 23 usuarios con rol funcional en UsuarioRol (y los usuarios sin tipo listados), 181 renglones RC históricos con capturadoPor/capturadoEn poblados desde IdUsuario/FechaUsuarioRC, 12 ítems de checklist históricos (las inconsistencias de origen se LISTAN para decisión, no se arreglan en silencio — §7)
- ETL corrido dos veces seguidas con el mismo resultado (idempotente)
- Criterio de salida de F5 demostrado EN EL AMBIENTE DE PRUEBA: 'una orden corre con su RC y las fechas se llenan solas donde aplica'
- Tests + CI verdes, review aprobado, docs mergeadas; PR de prueba → main lista

**Verificación de Gabriel:**
- [ ] Correr el ETL con el comando que entregue la etapa (p. ej. `docker compose exec backend npm run migracion:ruta-critica`) y LEER el reporte de cuadre: comparar los conteos contra los CSV (26 procesos / 156 tiempos / 11 rangos / 7 telas / 9 aplicaciones / 19 roles / 68 = 54+14 asignaciones / 23 usuarios con rol / 181 RC); correrlo una SEGUNDA vez y confirmar los mismos números
- [ ] En el reporte: confirmar que las 14 asignaciones huérfanas de RC_ProcUsua y los usuarios sin tipo aparecen LISTADOS (no desaparecidos en silencio), y que FactorTela figura como columna no migrada a propósito
- [ ] Spot-check: abrir 'Respaldo CLAUDE/TABLAS/CP_Tiempos.csv' y comparar 3 tiempos de un artículo contra la plantilla migrada en la pantalla de Plantillas; abrir un proceso migrado y comparar sus 2-3 roles contra RC_ProcUsua.csv
- [ ] Entrar con un usuario MIGRADO real (uno de los 23 con tipo de usuario RC en Usuarios.csv) → su Bandeja muestra tareas de SUS procesos (criterio '08 §1: cada usuario ve sus tareas' demostrado con datos migrados)
- [ ] Abrir el Concentrado: ordenarlo por retraso, filtrar por cliente, confirmar que carga rápido aun con todas las órdenes; abrirlo también desde el celular
- [ ] Exportar a Excel y abrir el archivo: mismas cifras que el tablero
- [ ] PRUEBA DEL CRITERIO DE SALIDA (en el ambiente de prueba de Railway, o compose si prueba no está montado): crear una orden nueva → programar su RC → registrar recepción de tela, corte y recibo de maquila → ver en RC por orden que esas fechas se llenaron SOLAS → completar el resto desde la bandeja → el último proceso cierra la RC y la orden sale del concentrado de vivas
- [ ] Leer docs/modulos/ruta-critica.md y confirmar que refleja lo que acabas de operar (incluido que las notificaciones se difieren a F7 y la auditoría-como-proceso a F6)
- [ ] Confirmar con Daniel (mensaje corto): regla de parciales aplicada, si quiere el Excel/impreso, y avisarle que la auditoría-como-proceso queda para F6 (D8)

**Equipo:** 2 coders en paralelo (pieza A: concentrado + export + pantalla · pieza B: ETL en backend/migracion — carpetas y archivos sin solape real) + 1 reviewer; la doc del módulo la integra el lead con insumos de ambos

**Referencias:**
- Documentacion_MJD/08-Ruta-Critica.md §2.4 (RC_ConcentradoDif, 2,061 líneas — el riesgo a no repetir), §3.2 ('no hay manera de analizarla') y §1 ('cada usuario ve sus tareas')
- PLANMAESTRO.md §6 fila F5 (criterio de salida), §7 (patrón del ETL: idempotente, latin-1, por servicios del dominio, reporte de cuadre, inconsistencias se listan), §8 (docs/modulos al cerrar)
- DECISIONES.md D8 (pendiente para F6), D11 (KPIs en F7 sobre este modelo); REQUISITOS-NUEVOS.md R9
- Respaldo CLAUDE/TABLAS/: CP_Familia, CP_Articulos, CP_Procesos (columna TipoProceso con valores '', M, F, T, AP, CO, EP, RP, CP, EC, C), CP_Tiempos, CP_Cant, RC_TipoTelas (columna FactorTela), RC_Aplicaciones, RC_TipoUsuarios, RC_ProcUsua (68 filas, 14 huérfanas), Usuarios (columna IdRC_TipoUsuarios, 23 usuarios con tipo), RC (columnas IdUsuario y FechaUsuarioRC), RC_IP2..RC_IP5 (.csv, latin-1)
- Respaldo CLAUDE/Respaldo CLAUDEFormularios/RC_Responsables.txt (RecordSource une Usuarios×RC_TipoUsuarios por IdRC_TipoUsuarios — referencia del mapeo usuario→rol)
- Documentacion_MJD/03-Produccion.md (campos RC de Ordenes para el ETL de flags)
- CLAUDE.md §4 (encoding latin-1 y cómo leer el volcado)

---

## Notas de la fase (supuestos del diseño)

SUPUESTOS: (1) Al arrancar F5 ya existen F1–F4: Orden de F2 con cantidad/cliente/fechas y los servicios de F3 (corte, envío/recibo maquila, entrega) y F4 (recepción R7, OC) construidos — E6 los modifica mínimamente para emitir eventos. (2) pg-boss HOY NO está en backend/ (verificado con grep); si F1–F4 no lo montaron antes, E3 lo introduce como motor común — es la primera pieza del plan que lo exige. (3) FamiliaArticulo/ArticuloRC pueden haber nacido en F1/F2 (Ordenes.IdCP_Articulos viene de F2): E2 empieza VERIFICANDO y solo crea lo que falte. (4) La URL local de verificación es http://localhost:8080 (compose F0) y Swagger en /api/docs. (5) ReglaAplicabilidad se implementa como condiciones TIPADAS en ProcesoDef (lleva aplicación / resurtido / tipo de tela), no como motor de expresiones — las condiciones reales de hoy son 3; generalizar sería sobre-ingeniería (riesgo señalado en el inventario). CORRECCIONES DEL REVISOR APLICADAS (verificadas contra los archivos): (a) responsable por proceso es N:M — RC_ProcUsua.csv tiene 68 asignaciones, TODOS los 26 procesos vigentes con 2–3 roles, y 08 §4 propone ProcesoResponsable como tabla aparte → ProcesoDefRol en E1, bandeja por intersección de roles en E5, ETL 54+14 huérfanas listadas en E7; (b) Usuarios.IdRC_TipoUsuarios (23 de 137 usuarios) se migra a UsuarioRol en E7 — sin esto la bandeja quedaría vacía tras migrar; (c) las ALERTAS de 08 §4 capacidad 3 se cubren con un mínimo viable en E5 (badge/contador de atrasados+en riesgo alimentado por el job de semáforo, sin infraestructura nueva) y las notificaciones push/correo se DIFIEREN explícitamente a F7 (registrado en docs del módulo en E7, junto a D11); (d) el motor de E3 original se partió en E3 (jobs+datos+duraciones+generación) y E4 (CPM+captura+semáforo) para respetar la granularidad de referencia — la fase queda en 7 etapas, el máximo permitido, y Gabriel verifica el motor en dos cortes manejables; (e) mapeo COMPLETO de TipoProceso en el ETL: los valores reales son '', M, F, T, AP, CO, EP, RP, CP, EC, C — M, F y vacío van a tipoEvento='manual'; y RC.IdUsuario/FechaUsuarioRC → capturadoPor/capturadoEn en el histórico (alimentan D11); (f) FactorTela de RC_TipoTelas (0.07–2.30, no usado por TelasDias en el viejo) entra a la MISMA ADR de E3 que FactCantAp: se conserva el comportamiento actual y el descarte queda explícito para que el ETL no lo 'corrija' en silencio; (g) la verificación de Gabriel en E3/E4 deja de depender de armar JSON a mano: guion con cuerpos exactos para pegar en Swagger (E3/E4) + script `npm run demo:rc` (E4) que ejecuta la secuencia y deja solo comparar contra la tabla de fechas esperadas. DECISIONES NUEVAS QUE GABRIEL CONFIRMA CON DANIEL (van a DECISIONES.md; el negocio validado no se re-valida, pero estas son reglas NUEVAS): regla de recibos parciales del auto-avance (antes de E6, sobre cantidades color×talla D4), impreso PDF del plan de la orden (antes de E5) y si quiere el Excel del concentrado (E7). Decisiones técnicas que se toman y documentan en ADR sin Daniel: FactCantAp y FactorTela (conservar el comportamiento actual de no aplicar los factores, explícito), algoritmo CPM v2 (backward pass limpio en vez del bucle iterativo 'OtraVez'), y que la RC ya NO escriba Ordenes.FechaEntrega en silencio (efecto colateral del proceso 'C' del viejo). COSAS DEL INVENTARIO QUE PERTENECEN A OTRA FASE: los KPIs/tableros D11 son de F7 (aquí solo se garantiza el modelo analítico de RutaOrden: plan original vs vigente vs real, responsable, duraciones, origen de captura, capturadoPor/capturadoEn migrados); las notificaciones/alertas avanzadas (push/correo) también se difieren a F7 — en F5 queda el badge de E5; la decisión D8 (auditoría de calidad como proceso de la RC) es de F6 — F5 solo deja la puerta abierta migrando los procesos #16/#20/#23 con tipoEvento 'auditoria'; el catálogo de TIPOS DE TELA es de F1/F4 — aquí solo la regla de días de abasto (DuracionPorTipoTela); la Bitacora y ConfiguracionEmpresa ya existen de F0 (solo se extienden). ALCANCE DUDOSO ASUMIDO DENTRO DE F5: CalendarioLaboral (nuevo, no existe en el viejo — sin él el CPM repite los huecos de festivos hardcodeados; lo metí en E2 como parte de las reglas de tiempo); el gancho 'EnRiesgo nace antes de programar' se implementa como job recurrente que barre órdenes (E4) para NO tocar el servicio de órdenes de F2. ORDEN ELEGIDO: E1→E2 configuración (vertical), E3→E4 motor backend (horizontal justificado por §9: el CPM es 'tarea grande'; partido en dos tareas cerradas, E5 depende del motor entero), E5 operación (vertical PC+móvil), E6 integración con código ajeno (aislada para proteger F3/F4 con regresión), E7 concentrado+ETL+cierre (regla 6). Cada etapa que toca backend regenera openapi.json y sincroniza esquema.gen.ts en la misma etapa (regla 7).
