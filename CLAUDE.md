# CLAUDE.md — Contexto del proyecto (handoff entre sesiones)

> **Para cualquier chat/sesión nueva:** lee este archivo primero, luego **`PLANMAESTRO.md`** (la ley del desarrollo) y **`HOJA-DE-RUTA.md`** (el plan por etapas + estado vivo: ahí dice exactamente qué sigue, y la ficha detallada de cada fase está en `docs/hoja-de-ruta/`). El idioma de trabajo es **español**. **Daniel Masri** es el dueño del sistema y experto del negocio (ya **validó** toda la ingeniería inversa). **Gabriel** opera el desarrollo: coordina los agentes, verifica los avances y hace los pasos manuales en Railway/Cloudflare/GitHub.

---

## 1. Qué estamos haciendo

Modernizar **"CONTROL"**, un ERP textil (marca **Marilyn / MJD**, empresa *FR Moda SA de CV*) que Daniel construyó hace ~30 años en **Microsoft Access 97**. La **ingeniería inversa está COMPLETA y validada** (en `Documentacion_MJD/`) y el **plan de construcción está aprobado**: **`PLANMAESTRO.md`** (raíz del repo) — ese plan es LEY.

> ## ⚠️ ESTADO REAL (15-ago-2026) — LEE ESTO ANTES QUE EL PÁRRAFO DE ABAJO
>
> **El relato de §1 y la tabla de §8 se congelaron en junio (F2–F5) y ya NO son el estado del
> proyecto.** Se conservan como historia porque su detalle sigue siendo útil, pero **no los uses para
> saber qué sigue**.
>
> **Hoy: F0–F9 ✅ COMPLETAS** + el rediseño del frontend ✅ + los remates post-F9 ✅. Corre el track
> **`V1 · Primera versión a producción`** (`docs/hoja-de-ruta/V1-etapas.md`), que **no es una fase
> nueva**: es el empujón de cierre nacido del repaso del 13-ago-2026
> (`docs/DIAGNOSTICO-FLUJO-COMPLETO.md`) y las nueve decisiones de Daniel (§Post-F9.36/.37).
> `V1-E1` ✅ · `V1-E2` ✅ · `V1-E3d pieza A` ✅ · `V1-E3c` ✅ (15-ago). Falta `V1-E3`, `E3d pieza B`,
> `E4`–`E7` y la separación desarrollo/producción (§Post-F9.34 + §Post-F9.46).
>
> **El estado vivo y el "qué sigue" mandan desde `HOJA-DE-RUTA.md` §1 (*¿Dónde vamos?*)** y la ficha
> de la fase activa. Este archivo manda en **las REGLAS** (§6, §7 y las trampas de §8), que sí están
> al día — y son innegociables.
>
> ⚠️ **Bloqueo abierto:** no se pueden **subir fotos** en `prueba` (configuración de Cloudflare R2,
> no código — las cuatro trampas están en `docs/hoja-de-ruta/F1-etapas.md:222`).

**Estado actual _(HISTÓRICO, junio-2026 — ver el recuadro de arriba)_: CONTROL v2 — F0 ✅, F1 ✅ (desplegadas en `prueba` de Railway) y F2 (Pedidos + Órdenes) ✅ COMPLETA (17-jun-2026, verificada por Gabriel; reviewer APROBADO; pendiente solo su commit + deploy a `prueba`).** Las 8 etapas de F1 (catálogos sencillos y estructurados, proveedor enriquecido R15, materiales, modelos con BOM y fotos R2, galería + códigos de barra EAN-13/DUN-14 con impreso PDF R9, y el ETL de migración de datos reales) quedaron construidas, verificadas por Gabriel y en `prueba`. **F3 (Producción / WIP) ✅ COMPLETA (6/6, 20-jun-2026; pendiente verificación de Gabriel en `prueba`) — F3-E1 ✅ (17-jun-2026, verificada por Gabriel; 2 reviewers APROBARON): motor kardex genérico + modelo de datos de toda F3 + CRUD 'Tipos de proceso'. F3-E2 ✅ (18-jun-2026; reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`): corte + envío a maquila unificado (M+A por TipoProceso) — dominio→API→UI + 2 PDFs + historial/cancelación; SIN migración ni permisos nuevos (los `produccion.*` ya estaban de E1); decisiones (f) sobre-corte libre / (g) sobre-envío estricto en `DECISIONES.md`. F3-E3 ✅ (19-jun-2026; reviewer independiente APROBADO; pendiente verificación de Gabriel en `prueba`): inventario PT operable (primer uso real del motor kardex) — movimientos manuales, traspasos entre almacenes, existencias y kardex (dominio→API→UI, 6 endpoints, 4 pantallas teal con existencias responsive); salidas/pata-origen del traspaso validan no-negativo por suma directa bajo lock (nunca la vista); cancelación = movimiento inverso auditado (NUNCA edita/borra, D3); SIN migración ni permisos nuevos, pero +2 tipos de movimiento al seed (`transferencia-salida`/`entrada`) → el deploy a `prueba` requiere `SEED_ON_START=true`. **F3-E4** ✅ (recibo de maquila ⭐, PR #58: transacción WIP + kardex PT condicionado por `generaEntradaPt` + cargo EsMa) · **F3-E5** ✅ (entrega a cliente + tablero WIP + existencias de maquilero, cierre del ciclo) · **F3-E6** ✅ (ETL de cierre: histórico de producción/IPT cargado por lotes vía dominio modo-migración; decisión (c) histórico PT "sin desglose" con sentinela; recibos en variante SIN efectos derivados anti-doble-conteo; reporte de cuadre; SIN migración/permisos/seed → el ETL se corre a mano post-deploy). **F4 (Compras/MRP), F5 (Ruta Crítica ⭐), F6 (Calidad + EsMa) y F7 (Costos/EDR + Indicadores) ✅ COMPLETAS** (22-jun → 3-jul-2026; el detalle vive en `HOJA-DE-RUTA.md` y sus fichas, no aquí). **F8 (Desarrollo, Cotización y Listas de Precios) ✅ COMPLETA (6/6, 6-jul-2026;** fase nueva D13/R16–R20/módulo 15; con su inserción **Finanzas pasó a F9** y **Migración+Go-live a F10** — plan **F0–F10, 11 fases**; ficha en `docs/hoja-de-ruta/F8-etapas.md`).** Después de F8 corrió el REDISEÑO COMPLETO del frontend (R1–R9, 7–10 jul-2026, ✅ CERRADO** — track propio en `docs/rediseno/PLAN-IMPLEMENTACION.md`): toda la UI al estándar del **prototipo de Daniel** (tabla-first, tokens verdes, riel oscuro, verificada FOTO contra FOTO contra el HTML), y de ahí nacieron el **importador de pedido del cliente** (R8, versión Excel; **+variante PDF plantilla C&A el 12-jul-2026, reglas dictadas por DANIEL en vivo** — sobre-pedido por packs 7%, referencia = nº de orden de la OC, SKUs guardados para el futuro módulo de empaque, pantone por color de la OP; ver `DECISIONES.md §Post-F9.2` + nota R8.1 del track del rediseño), el **catálogo de Auditores** (+R21 flujo del auditor, pendiente de diseño de Daniel), el **Resumen operativo** (`GET /api/resumen`), KPIs de agregación en servidor por módulo y las decisiones **D14/D15**. **F9 · Finanzas ✅ COMPLETA (6/6, construida el 10-jul-2026** con las decisiones D15 cerradas de antemano; ficha `docs/hoja-de-ruta/F9-etapas.md`; módulo documentado en `docs/modulos/finanzas.md`): motor de cuenta corriente de terceros (ADR-0017) + CxP con fold EsMa + importación de CFDI 4.0 de proveedores y ventas + reportes fiscales del contador + aging configurable + ETL de apertura **LISTO SIN CORRER** (espera el corte de SINUBE de Daniel, D15c). ⚠️ El deploy de F9 a `prueba` requiere `SEED_ON_START=true` (permisos `terceros.*`/`cxp.*`/`cxc.*`) y capturar el RFC de FR Moda en Administración › Empresas. De los remates post-F9: el **cierre visual de Finanzas** ✅ quedó verificado foto-contra-foto (PR #123: subtítulo CxC + TODO EsMa migrado a TablaDensa) y los **emisores de eventos RC** ✅ construidos (11-jul: `compraTela`/`surtidoAvios`/`auditoriaCorte` + tabla `HitoOrden` para revisión OP/fit/tono/avíos/empaque/arte → catálogo ~18 automáticos como el proto; defaults en `DECISIONES.md §Post-F9.1`; SIN permisos nuevos, solo migraciones automáticas). Los **hubs** quedaron sobrios (los 7 con degradado pasaron al patrón de Inventarios, `bg-primary-soft`), la **pantalla Ventas** ya es real (facturación por modelo sobre el EDR consolidado, permiso `edr.ver`; era el último placeholder desactualizado — solo queda `/documental`, legítimo) y los **filtros del Centro de Órdenes** quedaron en una línea (mes de entrega como select + conteo sin brinco). **Sigue: F10 (Migración + Go-live) como siguiente fase** (pendientes que esperan insumos: ETL de apertura de F9 ← corte SINUBE de Daniel; R21 flujo del auditor ← diseño de Daniel; fotos masivas ← carpeta física). **Nota: los códigos de barra fueron RETIRADOS del todo en F2-E5** (decisión de Gabriel, ya no se usan): se eliminó el generador EAN-13/DUN-14 de F1-E5 con su impreso/UI y las columnas `upc` (`Orden.upc`, `Empresa.upc`). El **detalle por etapa** (qué entregó cada una, decisiones, trampas y notas de cierre) vive en **`HOJA-DE-RUTA.md`** y las fichas de **`docs/hoja-de-ruta/`** — este archivo ya NO lo duplica. La UI está en el estándar visual del **prototipo del rediseño** (tabla-first + tokens VERDES + riel oscuro colapsable + cajones de detalle; el teal viejo quedó retirado) — la spec visual es `docs/rediseno/prototipo.html` + `docs/rediseno/REDISENO-FRONTEND.md` §4. **Pendiente explícito de F1 (no bloquea F2):** el ETL de **fotos masivas** quedó listo y probado, pero falta la **carpeta física de fotos** (`S:\...\FotosMod` + bordados); se corre cuando Gabriel la consiga.

> **Integración Finanzas (2026-06-13):** se incorporó al plan la propuesta de **Finanzas** (`Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`): decisión **D12**, requisitos **R10–R15**, **módulo 14 (Finanzas: CxC/CxP + CFDI, generaliza EsMa)** y una **fase nueva de Finanzas** entre F7 y Go-live (al integrarse fue F8; hoy es **F9**, ver nota de abajo). El **catálogo de proveedores enriquecido (R15)** entra en **F1, etapa F1-E1B**. La contabilidad NO entra (sigue con el contador); meta de fondo: **apagar SINUBE** por etapas (timbrado vía PAC = R14, posterior). Ver `DECISIONES.md` D12 y `HOJA-DE-RUTA.md`.

> **Integración Desarrollo y Cotización (2026-07-04):** se incorporó al plan la propuesta de **Desarrollo, Cotización y Listas de Precios por Cliente** (`Documentacion_MJD/PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md`): decisión **D13**, requisitos **R16–R20**, **módulo 15 (Desarrollo y Cotización)** y una **fase nueva F8** entre F7 y Finanzas — con lo que **Finanzas pasó de F8 a F9** y **Migración+Go-live de F9 a F10** (fichas renombradas; plan ahora **F0–F10, 11 fases**). Es la capa previa al pedido: **proyectos por Cliente+Departamento** → **precosteo persistido y amarrado** (telas con precio por proveedor y por color, medidas por talla en ciertos avíos, conceptos de costo abiertos) → **lista de precios con factores del cliente** → **aprobación del dueño modelo por modelo** → **negociación por versiones** con acuerdos → liga a la orden de producción que alimenta el MRP/OC (las telas dejan de capturarse a mano en la explosión). **La lista NO dispara pedidos** (el pedido sigue naciendo de la OC del cliente). **SIN ETL de Access** (la negociación vivía en Excel; arranca en cero). Las sub-decisiones ya las resolvió Daniel (D13); las preguntas restantes van con defaults en la ficha `docs/hoja-de-ruta/F8-etapas.md`.

**Arquitectura (decidida por Gabriel — ver `PLANMAESTRO.md` §1-3):**
- **Backend y frontend SEPARADOS**, en carpetas `backend/` y `frontend/`. **NO es monorepo** (sin workspaces; cada carpeta autónoma con su `package.json` y `npm`).
- **Todo dockerizado** — `docker compose up` levanta el sistema completo. Prioridad: **portabilidad** (si Railway se cae, se levanta en cualquier lado sin reescribir).
- **Backend** = API REST: Node 22 + TypeScript + **Fastify** + Zod → genera **OpenAPI** (el "contrato"/menú). Prisma 7 + PostgreSQL 18 (el gestionado de Railway; local y CI corren 17). **better-auth** + RBAC. Archivos en **Cloudflare R2**.
- **Frontend** = SPA: **Vite + React** + Tailwind + shadcn/ui, servido por **nginx** (sirve estáticos + reverse-proxy `/api` → backend). Su cliente del API se **genera desde el OpenAPI** del backend.
- **Comunicación**: REST. El **OpenAPI es lo único compartido** entre los dos servicios (tipado de punta a punta sin acoplarlos).
- **Railway**: 3 servicios (frontend público; backend y Postgres **privados** por red interna). Archivos en **R2**.

---

## 2. Ubicaciones clave (rutas relativas a la raíz del repo)

Repositorio git: **`DanFrModa/Respaldo-Control-CLAUDE`** en GitHub (se trabaja en Windows; usa rutas relativas al repo). Rama de trabajo actual: **`tarea/f0-fundacion`** (flujo de ramas en §7).

```
<raíz del repo>/
├── CLAUDE.md                      ← este archivo (handoff)
├── PLANMAESTRO.md                 ← ⭐ EL PLAN (leer antes de tocar código)
├── backend/                       ← SERVICIO 1: API (Fastify/REST/OpenAPI). src/{api,dominio,comun,
│                                     auth,datos,contrato} + prisma/ + Dockerfile + railway.json + openapi.json
├── frontend/                      ← SERVICIO 2: app del usuario (Vite/React + nginx). src/ + e2e/ +
│                                     nginx.conf.template (upstream por env) + Dockerfile + railway.json
├── docker-compose.yml             ← levanta postgres + backend + frontend (un comando)
├── docs/                          ← arquitectura/ (ADR-0001..0006 + README) · GUIA-RAILWAY-R2.md ·
│                                     modulos/patron-crud.md (patrón CRUD de referencia)
├── .github/                       ← workflows/ci.yml (CI bloqueante: backend, frontend, imágenes Docker, e2e) + renovate.json
├── Respaldo CLAUDE/               ← VOLCADO del sistema viejo en texto
│   ├── Respaldo CLAUDEFormularios/   292 formularios (.txt, diseño + código VBA)
│   ├── Respaldo CLAUDEConsultas/     161 consultas
│   ├── Respaldo CLAUDEModulos/       13 módulos VBA
│   ├── Respaldo CLAUDEReportes/      7 reportes
│   └── TABLAS/                       116 tablas exportadas a CSV (datos reales, CP850)
└── Documentacion_MJD/             ← LA DOCUMENTACIÓN funcional (fuente de verdad del negocio)
```

> Los `.mdb` de Access ya **no** viven en el repo. Para datos reales usa `Respaldo CLAUDE/TABLAS/*.csv`.

---

## 3. La documentación generada (en `Documentacion_MJD/`)

**Empieza siempre por `RESUMEN-EJECUTIVO.md`** (panorama completo). Luego:

| Archivo | Contenido |
|---|---|
| `README.md` | Índice + arquitectura |
| `00-Arranque-Login-y-Menu.md` | Login, seguridad, mapa de 36 menús, niveles |
| `01-Modelos.md` | Catálogo + receta/BOM (telas/habilitación/bordados) |
| `02-Pedidos.md` | Pedidos internos + Pedidos Reales + clientes |
| `03-Produccion.md` | Orden→corte→maquila→recibo→entrega, **estampado**, **WIP**, órdenes de compra, notas de salida |
| `04-Inventarios.md` | Producto Terminado (IPT) + Telas |
| `05-Indicadores.md` | KPIs de IP (Ingeniería Producto) y Almacén |
| `06-Costos-y-EDR.md` | Costeo y estado de resultados |
| `07-EsMa-Estados-de-Cuenta-Maquileros.md` | Cuenta corriente de maquileros |
| `08-Ruta-Critica.md` | ⭐ RC = workflow/CPM. El módulo más importante |
| `09-Control-de-Calidad.md` | Auditorías AQL |
| `10-Modelo-Datos-y-Usuarios.md` | ER de todas las tablas + 2 sistemas de seguridad |
| `DECISIONES.md` | **Decisiones del dueño (D0–D12)** — leer siempre |
| `MEJORAS.md` | Mejoras de diseño para v2 (A1–A10 + por módulo) |
| `REQUISITOS-NUEVOS.md` | Funciones que faltan (R1–R15 + principio Make-to-Order; R10–R15 = Finanzas) |
| `RESUMEN-EJECUTIVO.md` | Consolidado de todo |

---

## 4. Cómo leer los archivos del sistema viejo (notas técnicas)

- **⚠️ Encoding (corregido en F1-E6):** los .csv de `Respaldo CLAUDE/TABLAS/` están en **CP850 (codepage DOS)**, NO latin-1 ni utf-8. Leerlos como latin-1 corrompe los acentos **en silencio** (la ñ es el byte `0xA4`, que en latin-1 da `¤`; la ó es `0xA2` → `¢`: "Montaño"→"Monta¤o", "Algodón"→"Algod¢n"). En Node usa **`iconv-lite`** (`iconv.decode(buf, 'cp850')`, ver `backend/migracion/comun/csv.ts`); en Python `encoding="cp850"`. El ETL de F1-E6/E7/F10 ya lee CP850. *(Verificado para los CSV; los .txt de formularios del mismo volcado casi seguro comparten encoding.)*
- **Datos reales:** las 116 tablas ya están exportadas en `Respaldo CLAUDE/TABLAS/*.csv`. (Si algún día hay que releer un `.mdb`: librería Python `access-parser`.)
- **⚠️ `grep` puede fallar** leyendo estos archivos por argumento (por el encoding). Lo seguro: **Python** (`re` sobre el texto leído con cp850), o `grep` por **stdin** (`cat archivo | grep ...`).
- Los formularios exportados (`SaveAsText`) tienen el diseño (controles + propiedades) y, al final, una sección **`CodeBehindForm`** con el código VBA de cada control.

### Snippet útil (extraer estructura de un formulario)
```python
import re
t = open("Respaldo CLAUDE/Respaldo CLAUDEFormularios/Ordenes.txt", encoding="cp850").read()
re.search(r'RecordSource ="([^"]*)"', t)           # origen de datos
re.findall(r'SourceObject ="([^"]*)"', t)          # subformularios
re.findall(r'(?:Private|Public) (?:Sub|Function) [^\(\r\n]+', t)  # procedimientos
# el código está en:  t[t.find("CodeBehindForm"):]
```

---

## 5. Hechos clave del sistema (para no re-descubrirlos)

- **Arquitectura:** front-end `CONTROL_S_MJD.mdb` (pantallas+código) + 4 back-ends de datos (`MJD_Taine` núcleo, `MJD_Nauc` telas/inventarios, `MJD_Prop` usuarios, `MJD_Excel`). En producción los back-ends tienen **contraseña**.
- **Menú:** manejado por datos (tabla `Elementos del Panel de control`), filtrado por nivel. Form de login = `USUARIOS`; menú principal = `PANEL DE CONTROL`.
- **Seguridad: DOS sistemas.** (1) Niveles en cascada (`Usuarios.Nivel`, 1=admin…100). (2) **Accesos granulares** (tablas `Accesos`+`UsuAccesos`, arreglo `PrP`) — **este es el que se usa hoy**.
- **Tallas:** hoy columnas fijas `T1..T8` / `TC1..TC8` (máx 8). Decisión D4: hacerlas ilimitadas.
- **Telas:** doble componente `ExTela1/ExTela2` (ej. felpa + cardigan, mismo lote). D5: N acompañantes por lote.
- **Maquila:** dos flujos paralelos → **M = costura** (`Entregas`/`Recibos`), **A = estampado/aplicación** (`EntregasEst`/`RecibosEst`). NO es "Almacén".
- **WIP:** form `Proceso` = avance por etapas (corte/envío/recibo/estampado + pendientes).
- **RC (Ruta Crítica):** es un **CPM hecho a mano** (procesos con antecesores, tiempos, fechas). El módulo más importante; hoy NO se usa. Será motor de workflow + KPIs (D10/D11).
- **Costos:** decisión D1 = usar **costo actual**, no `CostoViejo`.
- **Compra por orden (Make-to-Order):** no se compra para stock (salvo genéricos).
- **Excluido:** módulo **Promoda** (cliente que ya no existe, D9). **Proscai** = ERP viejo retirado (D6). **Monarch** = campo reutilizado para referencia del cliente → generalizar a campos por cliente (D7).

---

## 6. Estilo de trabajo

- **Español, tono cercano y claro.** El negocio ya está **validado por Daniel**: la documentación funcional (`Documentacion_MJD/`) es la verdad del negocio y **no hay que re-validar módulos con él**. Gabriel coordina, **verifica los avances por etapas** y hace los pasos manuales de infraestructura.
- El sistema viejo es **solo referencia de la lógica del negocio (el QUÉ)**, no de cómo programar (el CÓMO): v2 se construye 100 % nuevo (D0), corrigiendo de raíz las limitaciones de Access (ver D# y A#).
- Decisiones de negocio nuevas → `DECISIONES.md`/`MEJORAS.md`/`REQUISITOS-NUEVOS.md`. Decisiones **técnicas** → ADR en `docs/arquitectura/`.
- **Preguntas a Daniel: TODAS de una vez al arrancar cada FASE (no etapa por etapa).** Al empezar una fase, el lead lee la **ficha completa** (`docs/hoja-de-ruta/F#-etapas.md`) — todas sus etapas y sus *"Decisiones a cerrar con Daniel"* — y le entrega a Gabriel **en el chat** (NO en un documento suelto) **una sola lista** con TODAS las decisiones de negocio que la fase va a necesitar, cada una con un **default propuesto** para que Daniel solo confirme o ajuste. Así Gabriel le pregunta a Daniel **una vez por fase** y no lo interrumpe en cada etapa. Al cerrarse, las respuestas se registran en `DECISIONES.md`. *(Estrenado en F4, 20-jun-2026.)*
- La numeración de los docs es organizativa ≠ estructura final (la estructura de módulos es la del plan §5, D8).

---

## 7. Cómo se desarrolla CONTROL v2 (reglas vigentes)

1. **`PLANMAESTRO.md` es ley.** Innegociables (A1–A8): **lógica de negocio solo en `backend/src/dominio`** (nunca en las rutas REST ni en el frontend); operaciones multi-tabla en **transacción** (A2); folios por **secuencia atómica** (A3, nunca `Max()+1`); existencias = **suma de movimientos** (kardex, D3); auditoría uniforme (A7); RBAC único (A4).
2. **Flujo de ramas + AUTORIZACIÓN (innegociable):** rama de tarea → PR a **`prueba`** → **Gabriel verifica EN VIVO en Railway** (no en local) → PR de `prueba` a **`main`** (producción). Nunca directo a `prueba` ni `main`. (`prueba` ya existe en GitHub.) La rama de tarea **NO debe trackear `prueba`** como upstream (riesgo de push accidental). **NADA de `git commit` ni `git push` sin autorización EXPRESA de Gabriel.** El flujo correcto al terminar una etapa:
   1. El lead y los agentes codean en el working tree (sin comitear nada).
   2. **ANTES de comitear, el lead DOCUMENTA la etapa en sus archivos (innegociable, regla de Gabriel 21-jun-2026):** la **ficha de la fase** (`docs/hoja-de-ruta/F#-etapas.md`) con su **nota de cierre** + estado ⬜→✅; la sección *¿Dónde vamos?*, la tabla de fase y la barra de avance de **`HOJA-DE-RUTA.md`**; las **decisiones de negocio** nuevas en `Documentacion_MJD/DECISIONES.md` (y ADRs en `docs/arquitectura/` si hubo decisión técnica); `docs/modulos/` si se cierra un módulo. **La documentación es PARTE del entregable, no un paso posterior** — debe quedar lista y entrar en el MISMO commit.
   3. Con la doc lista, el lead le **PREGUNTA a Gabriel si comitear** (y le da el checklist de qué se hizo, doc incluida). Con su OK → se comitea **TODO junto** (no "cada cosa"), docs incluidas.
   4. El lead le **PREGUNTA a Gabriel si abrir el PR a `prueba`**. Con su OK → se abre el PR; Railway despliega `prueba`.
   5. **Gabriel verifica en vivo en el servidor de `prueba` de Railway** (NO corriendo docker local). Si aprueba → PR de `prueba` → `main`.
   *(Incidente 13-jun-2026: un push automático mandó E1B-backend a `prueba` sin permiso — no repetir.)*
3. **Equipo mínimo por tarea: 1 coder + 1 reviewer independiente.** Nada se integra sin el visto bueno del reviewer (tiene la última palabra) y el CI en verde. **El orquestador (lead) NO escribe código de producción**: coordina, decide arquitectura, revisa y reporta a Gabriel.
   - **UN DEFECTO CONOCIDO NO ES "MENOR" (innegociable — regla de Gabriel, 5-jul-2026).** Todo hallazgo de un reviewer se **arregla en la misma ronda de corrección**. Está PROHIBIDO archivarlo como "menor", "aceptado", "improbable" o "no lo alcanza el seed de hoy": los seeds, roles y permisos cambian (ya hay cicatrices de CI por eso) y conocer el defecto lo vuelve responsabilidad, no nota al pie. Antes de siquiera pensar en no arreglar algo, **re-evaluar su severidad REAL** (¿toca una invariante A1–A9 / D#?) — a veces lo etiquetado "menor" es en realidad una violación de una invariante central (caso F8-E3: un "write-skew aceptado" era en realidad una violación de la inmutabilidad D3). Si de verdad NO se arregla, se dice con la **razón de diseño explícita** y se anota como deuda en `HOJA-DE-RUTA.md` §4 — jamás se calla con un "es menor".
4. **ECONOMÍA DE TOKENS (innegociable — el costo se dispara fácil; toda sesión la cumple):**
   - **Mancuarna coder+reviewer con AGENTES NORMALES (`Agent`), NO con teams.** El coder construye y deja el diff en el working tree; el reviewer independiente **lee el diff del disco** (no se le vuelca todo) y dicta veredicto; los ciclos de corrección se continúan con `SendMessage` al MISMO coder (contexto intacto, no se relanza desde cero). Los teams (`TeamCreate`) se reservan SOLO para etapas con piezas verdaderamente paralelas e independientes (la ficha de la etapa lo dice); por defecto, agentes normales.
   - **UN SOLO CODER A LA VEZ SOBRE EL WORKING TREE (cicatriz del 13-ago-2026).** El árbol de trabajo es **compartido y único**: dos coders en paralelo lo pisan aunque toquen módulos distintos, porque los **archivos GENERADOS** (`backend/openapi.json`, `frontend/openapi.json`, `frontend/src/api/esquema.gen.ts`) los reescriben **los dos**. Pasó así: con el precosteo terminado y esperando revisión, se lanzó el coder de compras sobre el mismo árbol; el reviewer certificó los generados a mitad de camino y **su certificación quedó inválida** (de 261 líneas de delta pasaron a 525, mezclando ambos cambios), y el diff del PR se llenó de trabajo ajeno a medias —incluido un archivo borrado—. **La regla:** el siguiente coder no arranca hasta que el anterior esté **comiteado** (o su trabajo revertido). Si de verdad hay que solapar, cada uno va en su **worktree de git** aparte, nunca en el mismo. Los agentes de **solo lectura** (analistas, reviewers) sí pueden correr en paralelo con un coder, pero al reviewer hay que **avisarle** que el árbol se está moviendo.
   - **A cada agente se le pasa SOLO su pedazo.** El lead extrae de `docs/hoja-de-ruta/F#-etapas.md` el alcance de ESA etapa/sub-pieza y se lo da en el prompt. Los agentes NO cargan el plan completo ni las 7 fichas de etapa ni `Documentacion_MJD/` entera — solo lo que su tarea necesita.
   - **NUNCA leer archivos generados completos.** `backend/openapi.json` y `frontend/openapi.json` (~100k tokens c/u) y `frontend/src/api/esquema.gen.ts` (~74k) son GENERADOS: se **regeneran con su comando**, no se leen ni se vuelcan al chat enteros. Si hay que mirar algo puntual, `Grep` del fragmento — jamás `Read` del archivo completo. Lo mismo con cualquier dump grande (logs de tests, CSV de `Respaldo CLAUDE/`, lockfiles): mirar el pedazo, no todo.
   - **Sesiones acotadas.** Cerrar y arrancar chat nuevo al terminar una etapa sale más barato que arrastrar una conversación larguísima (cada turno reprocesa todo).
5. **HISTORIAL DE VERSIONES (regla de Daniel, 19-ago-2026):** **cada vez que se actualiza `prueba` se
   sube la versión** y se agrega su entrada en **`HISTORIAL-DE-VERSIONES.md`** (raíz). Numeración
   **`0.xxx`** correlativa **mientras nada esté en producción** (el cero lo dice a simple vista); al
   arrancar producción, esa versión se rebautiza **`1.000`** anotando de cuál `0.xxx` viene. **El número
   es UNO SOLO y VIAJA**: se asigna al entrar a `prueba` y **esa misma versión** sube a producción, sin
   re-numerar. Se escribe **en lenguaje del negocio**, no técnico,
   con tres bloques: *qué se puede hacer ahora que antes no* · *qué cambió y puede sorprender* · *qué sigue
   pendiente o roto*. **NO es un changelog de commits** — para eso están `DECISIONES.md` (el porqué) y
   `HOJA-DE-RUTA.md` (el qué sigue).
6. **El contrato OpenAPI** se regenera en cada cambio del backend y el cliente del frontend queda sincronizado en la misma tarea.
7. **Documentación viva en `docs/`:** `arquitectura/` (ADRs), `modulos/` (cómo quedó cada módulo, al cerrarlo). El funcional NO se copia: se referencia `Documentacion_MJD/` (ADR-0002). La guía de infraestructura: `docs/GUIA-RAILWAY-R2.md`.
8. **Gabriel verifica cada etapa en el ambiente de `prueba` de Railway** (NO en local), antes de continuar.
9. **NUNCA Docker local (innegociable).** Ni el lead ni los agentes abren ni corren Docker / `docker compose` / testcontainers en la máquina de Gabriel. Las pruebas pesadas (integración con testcontainers, e2e con compose) corren en **CI (GitHub Actions)**; la verificación funcional, en **Railway**. Para generar migraciones Prisma sin BD local: redactar el `migration.sql` a mano y validarlo con `prisma migrate diff`, o dejar que CI/Railway las apliquen. *(Decisión de Gabriel, 13-jun-2026.)*

---

## 8. ESTADO DE EJECUCIÓN (resumen — el detalle vive en las fichas)

> ⚠️ **La tabla de abajo llega hasta F5 y se quedó ahí (junio-2026). F6–F9 están COMPLETAS y hoy
> corre el track V1** — ver el recuadro de §1 y `HOJA-DE-RUTA.md`. Lo que sigue vigente y vale oro de
> este §8 son las **trampas/recordatorios** que vienen después de la tabla: ésas aplican a toda etapa
> futura y se mantienen al día.
>
> **Este §8 solo apunta; NO duplica.** El relato completo de cada etapa (qué entregó, decisiones, trampas, aprendizajes) está en `docs/hoja-de-ruta/F#-etapas.md`; el estado vivo y el "qué sigue" están en `HOJA-DE-RUTA.md` (sección *¿Dónde vamos?*). Para trabajar una etapa, lee **solo** su nota en la ficha de su fase, no todo el historial.

| Hito | Estado | Dónde está el detalle |
|---|---|---|
| **F0 · Fundación** (E1–E5) | ✅ en `main`, desplegada en Railway como **prueba** (12-jun-2026) | `docs/hoja-de-ruta/F0` + `HOJA-DE-RUTA.md` §3 |
| **F1 · Catálogos + Modelos** (E1–E7) | ✅ **COMPLETA** en `prueba` (15-jun-2026) — catálogos sencillos/estructurados, proveedor R15, materiales, modelos+BOM+fotos R2, galería + códigos de barra EAN-13/DUN-14 con impreso PDF (R9), y ETL de datos reales | CIERRE por etapa (qué entregó, decisiones, trampas) en `docs/hoja-de-ruta/F1-etapas.md` |
| **F2 · Pedidos + Órdenes** (E1–E5) | ✅ **COMPLETA** en `prueba` (17-jun-2026, PR #52+#53 merged; ETL corrido: 1,084 ped / 3,923 órd) — pedidos internos/reales, órdenes con matriz color×talla (D4) + referencias del cliente (D7), consultas/tableros/buscador global, **impreso de orden PDF (R9)**, y **ETL de pedidos/órdenes** (cierre de fase). En la misma etapa: **retiro total de los códigos de barra** (columnas `upc` + generador de F1-E5) | CIERRE por etapa en `docs/hoja-de-ruta/F2-etapas.md` |
| **F3 · Producción / WIP** (E1–E6) | ✅ **COMPLETA (6/6)** (20-jun-2026; pend. verif. Gabriel en `prueba`) — `F3-E1` ✅ (17-jun-2026, verificada por Gabriel; 2 reviewers APROBARON): **motor kardex genérico** (`comun/kardex.ts`: registrar/traspaso atómico/inverso, existencia por suma directa bajo bloqueo nunca la vista) + eventos de dominio (gancho RC F5); modelo de datos de TODA F3 en una migración aditiva (etapas color×talla D4, kardex PT/tela/avío extensible D5/R4, EsMaCargo solo esquema, vista `existencia_pt` D3); `TipoProceso`+`generaEntradaPt`; CRUD 'Tipos de proceso' (bandera admin-only server-side); seeds + 9 permisos RBAC; ADR-0010; costoUnit NULL en F3 (D1/D2). · `F3-E2` ✅ (18-jun-2026; reviewer indep. APROBADO; pendiente verificación de Gabriel en `prueba`): **corte + envío a maquila unificado** (M+A por TipoProceso, D8) — `registrarCorte` (sobre-corte LIBRE, decisión (f)) / `registrarEnvioMaquila` (sobre-envío ESTRICTO `enviado ≤ cortado` por proceso, suma directa bajo `pg_advisory_xact_lock`, decisión (g)) / `cancelarEtapaMovimiento` (suave + motivo) / `listarEtapasOrden` (historial); 9 endpoints RBAC + 2 PDFs (envío + ficha estampado); 3 pantallas (corte semanal responsive) + historial/cancelación; **SIN migración, SIN permisos nuevos, SIN re-seed** (`produccion.*` ya de E1). · `F3-E3` ✅ (19-jun-2026; reviewer indep. APROBADO; pendiente verificación de Gabriel en `prueba`): **inventario PT operable** (primer uso real del motor kardex) — movimientos manuales/traspasos/existencias/kardex (`dominio/inventarios/movimientos-pt.ts`); salidas y pata-origen del traspaso validan no-negativo por suma directa bajo lock (nunca la vista, D3); `cancelarMovimientoPt` = inverso auditado (NUNCA edita/borra); 6 endpoints RBAC (`inventario-pt.ver`/`.mover`) + 4 pantallas teal (existencias responsive PC+móvil); `IPT_Revision` NO se construye; **SIN migración, SIN permisos nuevos** pero **+2 tipos de movimiento al seed** (`transferencia-salida`/`-entrada`) → deploy a `prueba` requiere `SEED_ON_START`. · `F3-E4` ✅ recibo de maquila ⭐ (PR #58) · `F3-E5` ✅ entrega a cliente + tablero WIP · `F3-E6` ✅ **CIERRE DE FASE**: ETL del histórico de producción/IPT (por lotes, vía dominio modo-migración) + decisión (c) histórico PT "sin desglose" (sentinela) + recibos SIN efectos derivados (anti-doble-conteo) + `cuadre-f3` + docs de módulo; SIN migración/permisos/seed (el ETL se corre a mano post-deploy) | CIERRE por etapa en `docs/hoja-de-ruta/F3-etapas.md` |
| **F4 · Compras / MRP** (E1–E6) | ✅ **COMPLETA (6/6)** (22-jun-2026, PR #67 en `prueba`; pend. verif. Gabriel) — órdenes de compra contra catálogo, recepción de material (R7) con entrada al kardex, **explosión MRP por orden** (R3) con neteo de genéricos, tablero "qué tengo / qué falta", **notas de salida** estructuradas (R4, tela sin doble descuento) e impresos PDF; cierre con ETL del histórico (compras/notas/telas) + cuadre. Módulo en `docs/modulos/compras-mrp.md` + `inventario-telas-avios.md` | CIERRE por etapa en `docs/hoja-de-ruta/F4-etapas.md` |
| **F5 · Ruta Crítica ⭐** (E1–E7) | ✅ **COMPLETA (7/7)** (23-jun-2026; pend. verif. Gabriel en `prueba`) — el módulo MÁS importante (D10/D11): **motor de workflow/CPM configurable** (procesos como datos + DAG + roles N:M + checklists, E1; plantillas + reglas de duración + calendario laboral, E2; ruta viva + pg-boss + generación, E3; **CPM backward-pass** + captura + semáforo, E4, ADR-0012/0013), **pantallas** de operación (Programar RC, Bandeja, RC por orden, badge) + impreso PDF del plan (E5), **auto-avance por eventos de F3/F4** (consumidor del outbox; parciales/evento-pisa-manual/cancelación-des-completa, decisiones d/e/f, E6), y **E7 cierre**: **concentrado planeado-vs-real** (agregación SQL en servidor, NUNCA pivote en cliente) + export Excel (exceljs, decisión h) + **ETL completo del módulo** (catálogos/plantillas/54 ProcesoDefRol/UsuarioRol/181 RC históricas con capturadoPor-capturadoEn para D11) con `cuadre-f5`. E7 SIN migración/permisos/seed (reusa `rc.ruta-ver`); el ETL se corre a mano post-deploy. **Deja abierto:** D8 (auditoría-como-proceso → F6), KPIs D11 → F7, notificaciones push/correo → F7. **Dependencia con F10 (go-live):** `UsuarioRol` de los 23 usuarios reales queda pendiente hasta que F10 migre usuarios (el ETL idempotente los materializa al re-correrse). Módulo en `docs/modulos/ruta-critica.md` | CIERRE por etapa en `docs/hoja-de-ruta/F5-etapas.md` |

**Trampas/recordatorios que aplican a TODA etapa futura (no perder):**
- **Despliegue:** el backend de `prueba` necesita `SEED_ON_START=true` para sembrar permisos/roles nuevos al arrancar (seed idempotente; NO resetea el password del admin). Sin eso, los menús nuevos no aparecen en `prueba`.
- **Arranque resiliente a la BD (hotfix 23-jun):** el backend conecta a Postgres por la red privada interna de Railway (`postgres.railway.internal`), que tarda unos segundos en levantar al arrancar el contenedor → antes cada deploy desde GitHub crasheaba con `P1001 Can't reach database server` en `prisma migrate deploy` (entrypoint con `set -e`) → bucle hasta `CRASHED`. Ahora `docker-entrypoint.sh` **reintenta** `migrate deploy`/seed con espera (configurable por `DB_WAIT_MAX_INTENTOS`=30 / `DB_WAIT_ESPERA_SEG`=3 ≈ 90 s; si la BD nunca responde, SÍ aborta con exit≠0) y se quitó el `preDeployCommand` duplicado de `railway.json`. Además `publicarPendientes` (relay del outbox, `comun/cola-eventos.ts`) ya **nunca propaga rechazos** y `servidor.ts` tiene handlers globales `unhandledRejection`/`uncaughtException` (loguean y siguen). **No re-romper:** no volver a poner `set -e` sin reintento, ni re-duplicar el migrate en `preDeployCommand`. Rotar la contraseña de Postgres provoca un bache breve pero **se auto-recupera** (no requiere redeploy manual).
- **⚠️ VALIDAR SIEMPRE CON LOS `npm run` DEL PROYECTO, NUNCA con comandos sueltos (cicatriz del 14-ago-2026).** El typecheck del **frontend** es `npm run typecheck` = **`tsc -b --noEmit`**. Un `npx tsc --noEmit` pelón **NO recorre los proyectos referenciados** y sale **limpio con errores reales adentro** — o sea, da un falso verde. Pasó así: el lead validó con el comando suelto, reportó "typecheck limpio" en el commit y al usuario, y el reviewer independiente encontró que `npm run typecheck` estaba en **rojo** (y `npm run lint` también, con 1 error, que el lead tampoco vio). El defecto oculto rompía el botón «quitar foto» en producción. **Los comandos correctos, los dos lados:** `npm run test:unit` (backend; **nunca** `npx vitest run` pelón → dispara testcontainers) · `npm run typecheck` · `npm run lint` · `npm run format:check` · `npm run openapi` (backend) / `npm run gen:api` (frontend). **Y el corolario:** el **CI es el único juez** — una validación local sirve para ir rápido, pero nada cuenta como verificado hasta que pasan los 4 trabajos de GitHub Actions.
- **Correr el ETL:** SIEMPRE `npx tsx --env-file=.env migracion/<script>.ts` desde `backend/` — **NUNCA `npm run etl:*`** (esos no cargan `.env` → truena con "no DATABASE_URL" aunque sí exista; los `npm run` no llevan `--env-file` a propósito, para no romper el CI). Ejemplo real (Gabriel, 19-jun): `npx tsx --env-file=.env migracion/etl-pedidos-ordenes.ts`. Ver `backend/migracion/README.md`.
- **ETL por LOTES, no 1×1 (Gabriel, 19-jun):** los scripts de ETL deben escribir a la BD **por lotes** (`createMany`/chunks/transacciones agrupadas), **NUNCA registro por registro** en un loop (uno por uno tarda muchísimo). Aplicarlo desde el inicio en F3-E6/F10 y al tocar los ETL ya hechos; mantener idempotencia y modo migración vía dominio, pero sin perder el rendimiento por lotes.
- **CI e2e: ✅ RESUELTO (22/23-jun, F5-E4, merges #72/#73).** El job **e2e** estuvo rojo crónico en `prueba` por fallos pre-existentes; quedó **VERDE** (corrida del #73: `e2e/backend/frontend/imagenes-docker` en verde). Lo arregló, dentro de F5-E4: `dd0d62c` (los 6 e2e crónicos — helper `crearColorYTalla` para la matriz color×talla que el seed no siembra, `login.spec` con piso ≥18 + módulos clave en vez de conteo exacto, `bordados.spec` navega a `/catalogos` antes de la galería, `DialogContent` con `max-h`+overflow); `6e2c307` (selector de color en Movimientos/Traspasos PT); el **rate-limit de login resuelto EN CÓDIGO** (`AUTH_LOGIN_RATE_MAX` env-configurable en `backend/src/auth/config.ts` default 20 → prod intacta; `1000` en `docker-compose.yml` para e2e/local; el limiter sigue encendido, solo cambia el cap); y los flaky de backend hechos deterministas (`2411c57` ETL comentarios, `ad51921`+#72 ETL telas). **Lecciones (no re-romper):** toda etapa que agrega módulo/sub-vista al menú ajusta las aserciones de `login.spec`; los specs que capturan en matriz siembran una talla primero; los tests que leen "el primero" llevan `orderBy` determinista.
- **Marilyn Fitness = FR Moda** (misma empresa renombrada; NO crear 2ª empresa). Catálogos F1 = GLOBALES (A9 / ADR-0007). `schema.prisma` único (ADR-0008).
- **Pendiente manual de Gabriel:** cambiar el password de `admin` (seed `Control.2026!`). *(Cloudflare R2 ya quedó montado en `prueba`: las fotos de bordados y modelos suben y se descargan OK.)*
- **Deuda técnica diferida (Gabriel, 14-jun, a futuro — NO hoy):** borrar una foto/adjunto elimina el registro en BD pero NO el objeto físico en R2 (queda huérfano); el motor `backend/src/comun/archivos.ts` no tiene DeleteObject. Fix global (modelos + bordados + proveedores), tras el commit y best-effort; aparcado — backlog en `HOJA-DE-RUTA.md` §4.

**Estándar visual (ya aplicado):** UI "lista + detalle" + tema **teal** + menú colapsable (propuesta 3, `docs/diseno/propuestas-colores.html`).

**Versiones verificadas (jun-2026):** Fastify 5.8 · @fastify/swagger 9.7 · fastify-type-provider-zod 6.1 · Vite 8.0 · React 19.2 · react-router-dom 7.17 · openapi-typescript 7.13 · openapi-fetch 0.17 · Prisma 7.8 · better-auth 1.6 · Zod 4.4 · Tailwind 4.3 · TanStack Query 5.101 / Table 8.21 · Vitest 4.1 · Playwright 1.60 · pino 10 · pg-boss 12 · @react-pdf/renderer 4. PostgreSQL 18 en Railway (local/CI 17), Node 22. **El cliente `pg_dump` de la imagen va ATADO a la major del servidor** — ver `backend/Dockerfile`.
