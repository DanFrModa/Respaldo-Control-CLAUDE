# CLAUDE.md — Contexto del proyecto (handoff entre sesiones)

> **Para cualquier chat/sesión nueva:** lee este archivo primero, luego **`PLANMAESTRO.md`** (la ley del desarrollo) y **`HOJA-DE-RUTA.md`** (el plan por etapas + estado vivo: ahí dice exactamente qué sigue, y la ficha detallada de cada fase está en `docs/hoja-de-ruta/`). El idioma de trabajo es **español**. **Daniel Masri** es el dueño del sistema y experto del negocio (ya **validó** toda la ingeniería inversa). **Gabriel** opera el desarrollo: coordina los agentes, verifica los avances y hace los pasos manuales en Railway/Cloudflare/GitHub.

---

## 1. Qué estamos haciendo

Modernizar **"CONTROL"**, un ERP textil (marca **Marilyn / MJD**, empresa *FR Moda SA de CV*) que Daniel construyó hace ~30 años en **Microsoft Access 97**. La **ingeniería inversa está COMPLETA y validada** (en `Documentacion_MJD/`) y el **plan de construcción está aprobado**: **`PLANMAESTRO.md`** (raíz del repo) — ese plan es LEY.

**Estado actual: CONTROL v2 — Fase F0 (Fundación) COMPLETA** (E1–E5 construidas en `backend/` y `frontend/`). Falta que Gabriel conecte Railway + R2 con `docs/GUIA-RAILWAY-R2.md`. Detalle de ejecución en **§8**; lo siguiente es **F1 (Catálogos + Modelos)**.

> **Integración Finanzas (2026-06-13):** se incorporó al plan la propuesta de **Finanzas** (`Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`): decisión **D12**, requisitos **R10–R15**, **módulo 14 (Finanzas: CxC/CxP + CFDI, generaliza EsMa)** y una **fase nueva F8 (Finanzas)** entre F7 y Go-live —que pasa a **F9**— (plan ahora F0–F9, 10 fases). El **catálogo de proveedores enriquecido (R15)** entra en **F1, etapa F1-E1B**. La contabilidad NO entra (sigue con el contador); meta de fondo: **apagar SINUBE** por etapas (timbrado vía PAC = R14, posterior). Ver `DECISIONES.md` D12 y `HOJA-DE-RUTA.md`.

**Arquitectura (decidida por Gabriel — ver `PLANMAESTRO.md` §1-3):**
- **Backend y frontend SEPARADOS**, en carpetas `backend/` y `frontend/`. **NO es monorepo** (sin workspaces; cada carpeta autónoma con su `package.json` y `npm`).
- **Todo dockerizado** — `docker compose up` levanta el sistema completo. Prioridad: **portabilidad** (si Railway se cae, se levanta en cualquier lado sin reescribir).
- **Backend** = API REST: Node 22 + TypeScript + **Fastify** + Zod → genera **OpenAPI** (el "contrato"/menú). Prisma 7 + PostgreSQL 17. **better-auth** + RBAC. Archivos en **Cloudflare R2**.
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
│   └── TABLAS/                       116 tablas exportadas a CSV (datos reales, latin-1)
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

- **⚠️ Encoding:** TODOS los .txt exportados y los .csv de `Respaldo CLAUDE/` están en **latin-1 (ISO-8859-1)**, NO utf-8. En Python: `encoding="latin-1"`; en Node: `fs.readFileSync(ruta, "latin1")`. Leerlos como utf-8 corrompe acentos y eñes en silencio.
- **Datos reales:** las 116 tablas ya están exportadas en `Respaldo CLAUDE/TABLAS/*.csv`. (Si algún día hay que releer un `.mdb`: librería Python `access-parser`.)
- **⚠️ `grep` puede fallar** leyendo estos archivos por argumento (por el encoding). Lo seguro: **Python** (`re` sobre el texto leído con latin-1), o `grep` por **stdin** (`cat archivo | grep ...`).
- Los formularios exportados (`SaveAsText`) tienen el diseño (controles + propiedades) y, al final, una sección **`CodeBehindForm`** con el código VBA de cada control.

### Snippet útil (extraer estructura de un formulario)
```python
import re
t = open("Respaldo CLAUDE/Respaldo CLAUDEFormularios/Ordenes.txt", encoding="latin-1").read()
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
- La numeración de los docs es organizativa ≠ estructura final (la estructura de módulos es la del plan §5, D8).

---

## 7. Cómo se desarrolla CONTROL v2 (reglas vigentes)

1. **`PLANMAESTRO.md` es ley.** Innegociables (A1–A8): **lógica de negocio solo en `backend/src/dominio`** (nunca en las rutas REST ni en el frontend); operaciones multi-tabla en **transacción** (A2); folios por **secuencia atómica** (A3, nunca `Max()+1`); existencias = **suma de movimientos** (kardex, D3); auditoría uniforme (A7); RBAC único (A4).
2. **Flujo de ramas (innegociable):** rama de tarea → PR a **`prueba`** (CI + review + verificación EN VIVO) → PR de `prueba` a **`main`** (producción). Nunca directo a `prueba` ni `main`. (`prueba` ya existe en GitHub.)
3. **Equipo mínimo por tarea: 1 coder + 1 reviewer independiente** (agentes). Nada se integra sin el visto bueno del reviewer y el CI en verde. **El orquestador (lead) NO escribe código de producción**: coordina, decide arquitectura, revisa y reporta a Gabriel. Agent Teams está habilitado (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).
4. **El contrato OpenAPI** se regenera en cada cambio del backend y el cliente del frontend queda sincronizado en la misma tarea.
5. **Documentación viva en `docs/`:** `arquitectura/` (ADRs), `modulos/` (cómo quedó cada módulo, al cerrarlo). El funcional NO se copia: se referencia `Documentacion_MJD/` (ADR-0002). La guía de infraestructura: `docs/GUIA-RAILWAY-R2.md`.
6. **Gabriel verifica cada etapa** en el ambiente de prueba o con `docker compose up` local, antes de continuar.

---

## 8. ESTADO DE EJECUCIÓN — Fase F0 (COMPLETA)

**F0 está construida y verificada en local.** El sistema vive en `backend/` y `frontend/` (arquitectura nueva: 2 servicios npm dockerizados, no monorepo, REST/OpenAPI). `docker compose up -d --build` levanta postgres + backend + frontend, y el flujo real funciona (login `admin` → menú por permisos → CRUD de Almacenes end-to-end), sin 502. La carpeta `control-v2/` (intento viejo, monorepo Next.js+tRPC) ya fue **reaprovechada y BORRADA** — su lógica probada (esquema Prisma, seed real, motores comunes, componentes shadcn) vive ahora dentro de `backend/`/`frontend/`.

**Qué entregó cada etapa (todas cerradas con coder + reviewer + CI):**
- **E1 — Esqueleto dockerizado:** `backend/` (Fastify, `/api/health`, escucha en `::`, Dockerfile multi-stage), `frontend/` (Vite + nginx que proxya `/api`, Dockerfile), `docker-compose.yml`.
- **E2 — Backend datos+dominio:** `backend/prisma` (esquema F0 completo, migración `fundacion`, **seed con FR Moda real + 38 permisos reales de `Accesos.csv` + 9 roles**) + `backend/src/{datos,contrato,comun,dominio}` (motores: secuencias atómicas A3, auditoría A7, permisos, archivos R2; servicios admin almacenes/usuarios/roles/empresas). **114 tests** (datos + motores comunes) en verde.
- **E3 — API REST + OpenAPI + auth:** rutas REST Fastify (Zod→OpenAPI en `backend/openapi.json`, Swagger UI en `/api/docs`) + better-auth (login, sesión en BD, **bloqueo a 5 intentos**) + permisos server-side en cada ruta. **+35 tests** → **149 en total en el backend** (48 unit + 101 integración con testcontainers).
- **E4 — Frontend funcional:** cliente tipado generado del OpenAPI (`frontend/src/api/esquema.gen.ts`) + login + layout responsive (13 módulos por permisos) + **CRUD patrón Almacenes** end-to-end + doc del patrón (`docs/modulos/patron-crud.md`). **38 tests del frontend** (30 Vitest + 8 Playwright E2E).
- **E5 — Infra y cierre:** CI (`.github/workflows/ci.yml`: jobs backend, frontend, build de las 2 imágenes Docker, e2e con docker compose) + `renovate.json`; `backend/railway.json` y `frontend/railway.json` (build por Dockerfile, healthcheck, restart, migraciones en pre-deploy del backend); `docs/GUIA-RAILWAY-R2.md` (3 servicios, frontend público / backend+Postgres privados); ADRs `docs/arquitectura/ADR-0001..0006` (arquitectura, doc-referenciada, better-auth, scrypt, auditoría-sin-FK, OpenAPI-desde-Zod); este CLAUDE.md; y borrado de `control-v2/`.

**Lo que falta (manos de Gabriel, NO es código):** conectar **Railway** (proyecto + Postgres + servicios backend/frontend, ambientes `prueba`/`production`) y **Cloudflare R2** (2 buckets + token S3), siguiendo `docs/GUIA-RAILWAY-R2.md` paso a paso (o el atajo con el Railway Agent en `docs/DESPLIEGUE-CON-AGENTE-RAILWAY.md`). El proxy del frontend ya es **portable por configuración**, sin cambios de código: el nginx usa `frontend/nginx.conf.template` (envsubst) y dos variables de entorno — `BACKEND_UPSTREAM` (default `backend:3000` para compose; en Railway `backend.railway.internal:3000`) y `DNS_RESOLVER` (autodetectado en local; en Railway `[fd12::10]`). El mismo artefacto sirve en compose y en Railway. Tras conectar la infra: PR de `tarea/f0-fundacion` → `prueba` (deploy + verificación en vivo) → `main`.

**Siguiente fase: F1 — Catálogos + Modelos** (plan §5 módulos 1 y 2, §6). Replicar el **patrón CRUD** documentado en `docs/modulos/patron-crud.md` con el equipo coder+reviewer por tarea.

**Versiones verificadas (jun-2026):** Fastify 5.8 · @fastify/swagger 9.7 · fastify-type-provider-zod 6.1 · Vite 8.0 · React 19.2 · react-router-dom 7.17 · openapi-typescript 7.13 · openapi-fetch 0.17 · Prisma 7.8 · better-auth 1.6 · Zod 4.4 · Tailwind 4.3 · TanStack Query 5.101 / Table 8.21 · Vitest 4.1 · Playwright 1.60 · pino 10 · pg-boss 12 · @react-pdf/renderer 4. PostgreSQL 17, Node 22.

**Notas para quien orqueste F1:** el equipo es efímero (muere con la sesión) — recrear con TeamCreate + lanzar agentes (coder + reviewer independiente por tarea; el lead no escribe código de producción). Agent Teams habilitado (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). El password del admin seedeado es `Control.2026!` (hash scrypt de better-auth; cámbialo al primer login). Gabriel **verifica por etapas** (no soltar todo el enjambre de corrido).
