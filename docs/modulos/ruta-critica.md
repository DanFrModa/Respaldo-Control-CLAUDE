# Módulo — Ruta Crítica (F5)

> Cómo quedó construido el módulo de **Ruta Crítica (RC)** en CONTROL v2 — el motor de
> workflow/CPM que el sistema viejo tenía pero **no usaba**. No duplica el funcional (ADR-0002):
> para el QUÉ del negocio, ver `Documentacion_MJD/08-Ruta-Critica.md`, `DECISIONES.md` §D10/D11 y
> §"Decisiones de negocio de F5", y `REQUISITOS-NUEVOS.md` §R9. Aquí va el CÓMO de v2.

Construido en F5 (etapas E1 → E7). Es el módulo **más importante** del plan (D10): rediseña la RC
como **motor de workflow configurable** (procesos como datos, dependencias como grafo, responsables,
reglas de duración) y como **modelo analítico** para los KPIs (D11, que se explotan en F7).

---

## 🔴 ESTADO: APAGADO en la v1 (V1-E3t, 21-ago-2026)

> Daniel, 13-ago: *"Sí podemos arrancar sin ruta crítica. Hoy honestamente no lo estamos ocupando en
> Control. Podríamos empezar sin eso sin problema. **Y lo vamos construyendo**."*
> Daniel, 21-ago, preguntado si había cambiado de opinión: *"sigue apagada, **déjala que se apague
> bien**"*.
> Decisión completa: `Documentacion_MJD/DECISIONES.md` **§Post-F9.36 punto 1**.

**Todo lo que describe el resto de este documento sigue construido y en pie.** Apagar no es demoler:
no se borró código, ni tablas, ni datos, ni las ~181 rutas históricas. Es **un interruptor**.

### Dónde está el interruptor

`backend/src/contrato/modulos-apagados.ts` → **`MODULOS_APAGADOS = ['rc']`**. Uno solo, en código
(no una variable de entorno: el RBAC de v2 tiene una sola fuente de verdad y vive en código, A4).

### Qué apaga

| | Qué pasa | Dónde |
|---|---|---|
| **1. Nadie tiene permisos `rc.*`** | La sesión los DESCARTA al armarse → **403 del servidor** aunque la fila `RolPermiso` exista. Y como el frontend pinta menú y ruta con esos mismos permisos, se apagan **menú, campana, pantallas y ⌘K** de un golpe (las tres capas de §Post-F9.68). | `comun/permisos.ts` · `cargarPermisosDeUsuario` |
| **2. La ruta NO se genera sola** | `procesarOrdenCreada` sale por el interruptor y deja bitácora `rc-automatica-omitida`. Cada OP nueva se ahorra sus ~26 procesos. | `dominio/ruta-critica/rcAutomatica.ts` |
| **3. El seed suelta las concesiones muertas** | Los roles de sistema dejan de traer `rc.*` (limpieza; la cerradura es la sesión). | `prisma/seed.ts` · `sembrarRoles` |
| **4. Los KPIs de RC piden las DOS llaves** | Era la única superficie de RC gateada por un permiso que no empieza con `rc.` (`indicadores.ver`); ahora exige además `rc.ruta-ver`. | `api/indicadores/indicadores.rutas.ts` · `conTodosPermisos` |

🔴 **Se apagó la GENERACIÓN, no el CONSUMIDOR de la cola.** `manejarEventoAutoAvance` sigue
registrado y drenando: los emisores de F3/F4 no dejaron de escribir al outbox, y sin consumidor
`pgboss.job` crecería para siempre. Las rutas que YA existen siguen avanzando con los eventos; las
órdenes nuevas simplemente no tienen ruta que avanzar, así que para ellas es un no-op natural.

### Cómo se vuelve a encender — PROCEDIMIENTO EXACTO

1. **Vaciar el interruptor:** en `backend/src/contrato/modulos-apagados.ts`, dejar
   `export const MODULOS_APAGADOS: readonly ModuloPermiso[] = [];`.
2. **Reactivar los e2e:** en `frontend/e2e/ayudas.ts`, `export const RC_APAGADA: boolean = false;`
   (los cinco specs de RC están *skipped*, no borrados, y vuelven solos).
3. **Desplegar con `SEED_ON_START=true`.** El seed re-otorga los `rc.*` a los roles de sistema; sin
   eso, el interruptor estaría encendido pero la base seguiría sin las filas `RolPermiso`.
4. **Programar las órdenes que nacieron sin ruta:** con **Re-programar**
   (`POST /api/ruta-critica/ordenes/:id/programar`, permiso `rc.programar`), que nunca se retiró. Se
   identifican por su bitácora `rc-automatica-omitida`. Las órdenes NUEVAS vuelven a nacer con su
   ruta solas.

⚠️ **Antes de encenderla de verdad** hacen falta los insumos que el diagnóstico ya listaba: el **ETL
de plantillas de F5**, el **`UsuarioRol` de los 23 usuarios**, los **festivos de FR Moda**, y el
**concentrado de pendientes por persona** que Daniel pidió para la v2 del módulo (§Post-F9.36).

### Dónde está probado

- `backend/src/api/rc-apagada.int.test.ts` — entra con el **admin** (el de más permisos) y exige
  **403** en los cuatro permisos `rc.*`, en lectura y escritura; que la sesión no entregue ninguna
  clave `rc.*` **y sí todo lo demás**; que un rol con la fila `RolPermiso` puesta a mano tampoco
  entre; y que Indicadores siga encendido (apagar la RC no puede tumbar al vecino).
- `backend/src/dominio/ruta-critica/rcApagada.int.test.ts` — con el catálogo RC COMPLETO, la orden
  nace **sin ruta** y con bitácora; el consumidor **drena** sin lanzar; una ruta ya generada **no se
  toca**.
- `backend/src/dominio/ruta-critica/rcAutomatica.int.test.ts` — sustituye `moduloApagado` por `false`
  y **sigue ejerciendo el motor** con la RC apagada, para que *"se enciende sin perder nada"* no sea
  un decir.
- `backend/src/datos/seed.int.test.ts` — ningún rol de sistema conserva permisos apagados, **y el
  permiso sigue existiendo** en la tabla `Permiso`.

## Alcance

La RC modela, por cada orden de producción, su **plan de procesos** (qué pasos, en qué orden, quién
responsable, cuánto duran) y lo contrasta contra la **realidad física** de producción. Cubre:
catálogo de procesos configurable (DAG), plantillas de ruta por familia/artículo, reglas de duración
y calendario laboral, **generación de la ruta viva** por orden, **CPM** (fechas planeadas por
camino crítico), **captura de avance** (manual y **automática por eventos de F3/F4**), **semáforo y
riesgo**, **bandeja de tareas** por responsable, **concentrado planeado-vs-real** gerencial, impreso
del plan y el **ETL del histórico**.

> **Principio rector (Daniel):** la RC **refleja la realidad física de producción** → el dato
> automático (evento de producción) **manda** sobre la captura a mano (de ahí las decisiones (e)/(f)).

## Capas (A1 — lógica solo en dominio)

- **Dominio** `backend/src/dominio/ruta-critica/`:
  - **Catálogo (E1):** `catalogoProcesos.ts` — procesos como datos (`ProcesoDef`), con bandera
    admin-only server-side; `grafo.ts` — DAG de dependencias (`ProcesoDep`) con detección de ciclos;
    roles responsables **N:M** (`ProcesoDefRol`) y checklists por proceso. `familiasArticulos.ts` —
    `FamiliaArticulo`/`ArticuloRC` (la "familia/tipo de producto" que elige la plantilla).
  - **Configuración de tiempo (E2):** `plantillasRuta.ts` — plantillas de ruta por familia/artículo
    (`PlantillaRuta`/`PlantillaRutaProceso`, el encadenamiento **por artículo** manda);
    `reglasDuracion.ts` — `FactorCantidad`, `DuracionPorTipoTela`, `DuracionPorAplicacion`;
    `calendarioLaboral.ts` — `CalendarioLaboral` configurable por empresa (L–V + festivos MX +
    fechas propias de FR, decisión (a); **reemplaza el L–V hardcodeado del viejo**).
  - **Cálculo de duración (E3, ADR-0012):** `calcularDuracion.ts` — cada proceso tiene UN
    `tipoDuracion` y se calcula por esa regla (no se combinan ejes): `fija` (la plantilla),
    `porCantidad` (`tiempoEstandar × factorCantidad + colchonCostura`), `porTipoTela` (los `dias` del
    catálogo **directos**, sin multiplicar por `factorTela`), `porAplicacion` (`diasAplicacion ×
    factorCantidad`). `factorTela` y el `factor` de aplicación se **conservan como referencia** pero
    NO se aplican (aplicarlos doble-contaría — decisión (b)/(b.E3)).
  - **Ruta viva (E3):** `rutaOrden.ts` — `generarRutaOrden`/`ajustarRutaOrden` materializan la ruta
    de una orden DESDE la plantilla aplicable (resuelve artículo/familia/tela/aplicación, calcula
    duraciones, auto-completa los procesos de duración 0, **activa el proceso raíz**) en
    `RutaOrden`/`RutaOrdenDep`/`RutaOrdenChecklist` + campos RC en `Orden`.
  - **Motor CPM (E4, ADR-0013):** `cpm.ts` + `cpm-job.ts` — **backward-pass** limpio (Kahn, días
    hábiles UTC contra el calendario) que fija `fechaPlaneadaVigente` por camino crítico; corre como
    **job de pg-boss** (no bloquea la captura). `cumplimiento.ts` — captura de avance
    (completar/revertir/checklist) con **intersección de roles N:M** y **advisory lock por orden**;
    `activarProcesosListos` activa sucesores cuando se completan sus antecesores. `semaforoYRiesgo.ts`
    — semáforo (a tiempo / en riesgo / atrasado, `UMBRAL_RIESGO_DIAS=3`) + **job recurrente** que
    barre órdenes y marca `EnRiesgo` sin tocar el servicio de órdenes de F2.
  - **Operación (E5):** `bandeja.ts` — `consultarBandeja` (tareas de MIS procesos por intersección de
    roles N:M) + `contarAlertas` (badge de atrasados/en riesgo). Impreso del plan en
    `impresos/impreso-plan-rc.ts` (decisión (g), R9).
  - **Auto-avance (E6):** `autoAvance.ts` — **consumidor** de la cola `eventos-dominio` (OUTBOX
    durable, ADR-0011) que mapea cada evento físico de F3/F4 → el/los proceso(s) de la ruta de ESA
    orden y los completa solos. Ver §"Auto-avance" abajo.
  - **Concentrado (E7):** `concentrado.ts` — consulta **agregada en servidor** (SQL crudo
    parametrizado, sin vista de BD → sin migración) de todas las órdenes con RC viva × procesos, con
    semáforo y atraso, **paginada/filtrable/ordenable**; el pivote se hace en SQL, **nunca en el
    cliente** (el pecado del `RC_ConcentradoDif` viejo). `impresos/excel-concentrado.ts` — export a
    Excel (`exceljs`, decisión (h)) del MISMO resultado (todo el filtro, no solo la página visible).
  - **Modo migración (E7):** `migracion.ts` — capa de dominio aparte (NO se expone en REST) para
    cargar el histórico sin ensuciar el servicio normal: `crearRutaOrdenMigrada` (renglones
    explícitos del viejo, sin plantilla ni CPM), `sincronizarRolesProcesoMigrado` (`ProcesoDefRol`
    aditivo), `asignarRolUsuarioMigrado` (`UsuarioRol` aditivo), `fijarEstadoRcOrdenMigrado`.
    Transaccional (A2) y auditado (A7) igual que el servicio normal.
- **Jobs** `backend/src/comun/jobs/` (pg-boss, introducido en E3): colas `eventos-dominio`
  (auto-avance), el job del CPM y el job recurrente de riesgo. Outbox transaccional en ADR-0011.
- **API** `backend/src/api/ruta-critica/` — `procesos.rutas.ts`, `plantillas.rutas.ts`,
  `programacion.rutas.ts`, `bandeja.rutas.ts`, `concentrado.rutas.ts` (GET `/concentrado` +
  `/concentrado/excel`). Permiso verificado server-side en cada ruta; OpenAPI regenerado + cliente
  del frontend sincronizado. Permisos: `rc.catalogo-ver`/`.administrar`, `rc.programar`,
  `rc.ruta-ver`, `rc.capturar` (el concentrado **reusa `rc.ruta-ver`**, no agrega permiso) + los 18
  roles funcionales de E1.
- **Frontend** `frontend/src/modulos/ruta-critica/` — catálogo de procesos (DAG, roles, checklists),
  plantillas, reglas de duración, configuración (calendario), **Programar RC**, **Bandeja de tareas**
  (PC+móvil, captura Hoy/Ayer, checklist), **RC por orden** (timeline planeado-vs-real + quién
  capturó + Imprimir plan), **Concentrado** (tablero teal responsive, filtros, export Excel), badge
  de alertas en el header y la portada-hub del módulo. Componente `Semaforo` reutilizable.

## Auto-avance por eventos de producción (E6)

Los servicios de F3 (corte, envío/recibo de maquila, entrega) y F4 (recepción de tela) **emiten
eventos de dominio** vía el **OUTBOX durable** (`registrarEventoOutbox` dentro de su propia tx — el
evento nunca se pierde aunque el proceso crashee, ADR-0011). El consumidor `autoAvance.ts` (worker de
la cola `eventos-dominio`, **sin sesión** — el evento es autoritativo, audita con `registrarBitacora(tx,
null, …)`) mapea `tipoEvento` → el/los proceso(s) de la ruta de esa orden, los completa con
`origenCaptura='evento'` y `fechaReal` = fecha física del hecho, activa sucesores y encola el CPM.
Reglas de negocio cerradas con Daniel:

- **(d) Parciales:** un proceso que llega en varias remesas se completa **solo al llegar la cantidad
  COMPLETA** (color×talla, D4); desde el primer recibo lleva la marca **`parcialEnCurso`** (única
  columna que agregó E6).
- **(e) El evento PISA la captura manual:** si alguien ya había puesto la fecha a mano y luego llega
  el evento, el evento gana; la `Bitacora` guarda el rastro de lo manual (A7).
- **(f) Cancelar el movimiento origen DES-completa el proceso:** cancelar el corte/recibo que
  auto-completó un proceso lo des-completa solo, recalcula el CPM y revisa los sucesores ya
  activados; después alguien puede volver a capturarlo a mano.

La completitud/cancelación se resuelven por **RE-EVALUACIÓN del estado físico** (suma de etapas vivas
vs `OrdenLineaTalla`) → idempotente gratis. La RC **nunca** modifica `Orden.fechaEntrega` (decisión
(c): a diferencia del viejo, donde el proceso 'C' la sobre-escribía en silencio).

### Emisores completados en el remate post-F9 (11-jul-2026)

Con estos el catálogo queda **~18/26 procesos automáticos** (el objetivo del prototipo §4.9 de
Daniel). Defaults de negocio en `DECISIONES.md §(Post-F9.1)`; misma mecánica E6 (outbox en la tx,
re-lectura física binaria, cancelar des-completa):

- **`compraTela`** — "Orden de compra tela": `autorizarOC`/`cancelarOC` emiten por cada orden de
  producción ligada en líneas de TELA. Físico: ¿hay OC viva autorizada/recibida con línea de tela de
  la orden?
- **`surtidoAvios`** — "Surtido de avíos": confirmar/cancelar la **nota de salida** emite por cada
  orden con líneas de AVÍO. Físico: ¿hay nota confirmada viva con avío de la orden?
- **`auditoriaCorte`** — "Auditoría de Corte": sin emisor nuevo; `auditoria-calidad-resuelta` ya se
  emitía en toda captura y el consumidor ahora re-evalúa también este tipo (se agregó **`corte`** a
  `TipoAuditoria`). Físico: ¿hay auditoría de corte APROBADA viva?
- **Hitos de la orden (`HitoOrden` + `dominio/ruta-critica/hitosOrden.ts`)** — revisión de OP,
  autorización de fit / tono de tela / avíos, empaque y **arte** no nacen de ningún documento del
  sistema: se capturan como hito (quién/cuándo; un vivo por orden+tipo con **unique parcial**;
  cancelación suave con motivo) en el detalle de Producción › Órdenes (`PanelHitosOrden`), permisos
  reusados `rc.ruta-ver`/`rc.capturar`. El hito de ARTE emite `autorizacionArte` y cierra el hueco
  latente de F5-E1. Completitud **por presencia** (sin cantidades).

## Migración del histórico (F5-E7)

ETL idempotente, por lotes, **CP850** (`comun/csv.ts`), vía dominio modo-migración
(`backend/migracion/ruta-critica/` + orquestador `etl-ruta-critica.ts` + `cuadre-f5.ts`):

- **Catálogos** (`catalogos.ts`): `CP_Familia`/`CP_Articulos` → `FamiliaArticulo`/`ArticuloRC` (crea
  lo que falte; pudieron nacer en F1/F2); `CP_Procesos` (26) **verificados** contra el catálogo que
  ya sembró E1 (el mapeo `TipoProceso→tipoEvento` vive en el **seed de E1**, el ETL NO lo re-mapea);
  `CP_Cant` (11) → `FactorCantidad`; `RC_TipoTelas` (7) → `DuracionPorTipoTela`; `RC_Aplicaciones`
  (9) → `DuracionPorAplicacion`. **Materializa las 54 `ProcesoDefRol` vigentes** de `RC_ProcUsua`.
- **Plantillas** (`plantillas.ts`): `CP_Tiempos` (156) → `PlantillaRutaProceso` + tiempos.
- **Roles de usuario** (`usuarios-roles.ts`): `Usuarios.IdRC_TipoUsuarios` (23 de 137) → `UsuarioRol`
  contra el RBAC único (A4, casa los `RC_TipoUsuarios` contra los roles de E1). Ver caveat F10 abajo.
- **Ruta histórica** (`ruta-orden.ts`): `RC` (181 renglones) → `RutaOrden` con `FechaEst`/`FechaReal`
  + **`RC.IdUsuario`→`capturadoPorId`** + **`RC.FechaUsuarioRC`→`capturadoEn`** (el dato que alimenta
  el KPI D11 "quién y cuándo capturó"); `RC_IP3`/`RC_IP4` → `RutaOrdenChecklist`. Idempotente:
  borra+recrea la ruta de cada orden.
- **Estado RC de órdenes** (`ordenes-estado-rc.ts`): `Ordenes.{FechaInicioRC, FechaEntregaRC,
  FechaProg, EnRiesgo, SI_RC, RC_Viva}` → campos RC de `Orden` (update solo si difiere).
- **Colchón** (`propiedades.ts`): `Propiedades.ColchonCostura` → `ConfiguracionEmpresa`.

**Decisiones / caveats de la migración (todo se LISTA, nada se "arregla" en silencio — §7):**

1. **`RC_ProcUsua` (68) = 54 vigentes + 14 HUÉRFANAS** (apuntan a procesos borrados del viejo): las
   54 se materializan como `ProcesoDefRol`; las 14 se **listan** como inconsistencia de origen.
2. **`FactorTela` NO se migra a propósito** (ADR-0012/E3: el viejo nunca lo aplicaba) — declarado en
   el cuadre, no "corregido".
3. **Checklist = 9 ítems** (`RC_IP3` 6 columnas + `RC_IP4` 3 columnas reales), **no 12** como decía
   la ficha: el ETL lee las columnas reales del CSV; documentado.
4. **UsuarioRol ↔ F10 (dependencia cruzada):** los 137 usuarios del viejo **aún no están migrados a
   v2** (eso es F10); hoy solo existe `admin`. El ETL **no crea usuarios**: casa cada uno de los 23
   con tipo contra un usuario v2 existente por su login y, los que aún no existen, los **lista como
   "UsuarioRol pendiente hasta F10"**. Como es idempotente, **re-correr el ETL después de F10 los
   materializa automáticamente**. *Implicación operativa:* hasta F10, la Bandeja con datos reales se
   demuestra con un usuario sembrado al que se le asigna un rol RC (no "entrando como" uno de los 23).
5. **Solo migran rutas de órdenes ya migradas** (mapeo de F2-E5): las `RC` que apuntan a órdenes no
   migradas (p. ej. de las 6 empresas viejas inactivas) se omiten y listan, consistente con la
   decisión de no migrar esa historia.

El cuadre de Gabriel es **reporte-vs-reporte** entre dos corridas (idempotencia: 2ª corrida =
mismos números, creados/insertados = 0). Comando: `npx tsx --env-file=.env
migracion/etl-ruta-critica.ts` (y `migracion/cuadre-f5.ts` para solo el cuadre), desde `backend/`.

## Lo que esta fase DEJA ABIERTO (a propósito)

- **D8 — Control de Calidad como proceso de la RC: se decide en F6.** F5 solo deja la puerta abierta:
  los procesos de auditoría (#16/#20/#23) quedan migrados en el catálogo con `tipoEvento='auditoria'`.
- **D11 — tableros KPI:** se construyen en **F7** sobre el modelo `RutaOrden` (plan original vs
  vigente vs real, responsable, duraciones, origen de captura, `capturadoPor`/`capturadoEn`). F5
  garantiza el **modelo analítico**, no los tableros.
- **Notificaciones avanzadas (push/correo): se difieren a F7.** En F5 el mínimo viable es el **badge**
  de alertas del header (E5).
- **Pendiente operativo:** la lista de **fechas propias de FR Moda** para el calendario laboral
  (decisión (a)) se carga por el CRUD de Config RC cuando Gabriel la consiga con Daniel; no bloquea.

## Reglas que el módulo respeta

A1 (lógica en dominio; rutas REST y frontend sin lógica) · A2 (generación de ruta, captura,
auto-avance y migración en transacción) · A3 (sin folios propios; se apoya en los de F2) · A4 (RBAC
único, permisos server-side, sin catálogo de roles paralelo) · A7 (Bitácora en cada captura/cambio) ·
A9 (idEmpresa en consultas y migración) · D3 (la RC no recalcula existencias; lee el estado físico) ·
D10 (workflow configurable) · D11 (modelo analítico) · R9 (impresos: plan PDF + export Excel).

## ADRs y referencias

ADR-0011 (eventos outbox + pg-boss), ADR-0012 (motor de duración + jobs), ADR-0013 (CPM backward-pass
+ semáforo). Funcional: `Documentacion_MJD/08-Ruta-Critica.md`. Decisiones de negocio:
`DECISIONES.md` §D10/D11 y §"Decisiones de negocio de F5" (a–h).
