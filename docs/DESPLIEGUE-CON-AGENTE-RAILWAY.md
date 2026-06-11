# Desplegar CONTROL v2 con el Railway Agent

> Guía para usar el **Railway Agent** (el asistente de IA dentro del dashboard de Railway) para montar CONTROL v2 casi solo. Es el atajo a la guía manual completa: el detalle paso-a-paso y los valores exactos están en **`GUIA-RAILWAY-R2.md`** (esta guía la complementa, no la reemplaza). — Para Gabriel.

---

## 1. Qué es el Railway Agent

Es un **chat de IA integrado en el dashboard de Railway** que opera la plataforma por ti con lenguaje natural: crea servicios, conecta bases de datos, pone variables y arma la red. Le pegas un prompt describiendo lo que quieres y lo hace (puedes revisar lo que propone antes de aplicar).

- **Dónde está:** dentro del dashboard de Railway, en el proyecto, hay un panel de chat del Agent.
- **Costo (ojo):** el Agent se cobra **aparte**, por tokens del modelo, a tarifa de Anthropic **sin recargo**, con un **tope de gasto** ($5 en plan Hobby, $20 en Pro). Montar F0 es una operación corta → el gasto es mínimo, pero el tope existe.
- **No confundir** con el "MCP de Railway" (que es para pilotar Railway desde fuera, p.ej. desde Claude Code). Para lo tuyo, el **Agent del dashboard** es lo correcto.

---

## 2. ANTES de hablarle al Agent (3 cosas tuyas, una sola vez)

El Agent NO puede hacer estas (están fuera de su alcance), así que déjalas listas primero:

1. **Vincular tu GitHub a Railway** y darle acceso al repo `DanFrModa/Respaldo-Control-CLAUDE`. (Railway lo exige para desplegar desde el repo; es un permiso tuyo.)
2. **Generar el secreto de login** `BETTER_AUTH_SECRET`: en una terminal corre
   ```
   openssl rand -base64 32
   ```
   y guarda el resultado (lo pegarás como valor de variable).
3. **Cloudflare R2** (es de Cloudflare, NO de Railway → el Agent no lo toca): crea los 2 buckets (`control-v2-prod`, `control-v2-prueba`) y un token S3 con permiso *Object Read & Write* limitado a esos buckets. Apunta el **Access Key**, el **Secret** (se muestra una sola vez), tu **Account ID** y el nombre del bucket. → Pasos exactos en `GUIA-RAILWAY-R2.md`.

> El `DATABASE_URL` NO lo generas tú: lo crea Postgres y el Agent lo enlaza solo.

---

## 3. El prompt para pegarle al Railway Agent

Copia esto tal cual en el chat del Agent (en un proyecto nuevo de Railway):

```text
Quiero desplegar una app llamada CONTROL v2 en este proyecto, desde el
repositorio de GitHub DanFrModa/Respaldo-Control-CLAUDE (rama main).
Son 3 servicios. Cada servicio del repo YA trae su Dockerfile y su
railway.json (con el builder Dockerfile, el healthcheck y el preDeploy de
migraciones) — respétalos, no los sobrescribas. Configura:

1) PostgreSQL del catálogo de Railway, PRIVADO, con backups diarios.

2) Un servicio llamado "backend":
   - Desde el repo, Root Directory: backend/  (build por Dockerfile).
   - PRIVADO: sin dominio público, solo red interna.
   - Variables:
       DATABASE_URL = ${{Postgres.DATABASE_URL}}
       PORT = 3000
       NODE_ENV = production
       SEED_ON_START = true
       BETTER_AUTH_SECRET = (déjala como placeholder, yo pongo el valor)
       BETTER_AUTH_URL = (placeholder, la pongo cuando exista el dominio del frontend)
       R2_ACCESS_KEY_ID = (placeholder)
       R2_SECRET_ACCESS_KEY = (placeholder)
       R2_ACCOUNT_ID = (placeholder)
       R2_BUCKET = (placeholder)

3) Un servicio llamado "frontend":
   - Desde el repo, Root Directory: frontend/  (build por Dockerfile).
   - PÚBLICO: genérale un dominio.
   - Variables:
       BACKEND_UPSTREAM = backend.railway.internal:3000
       DNS_RESOLVER = [fd12::10]

El backend escucha en :: (IPv6) y corre las migraciones de Prisma en el
pre-deploy automáticamente (viene en su railway.json). Despliega los 3
servicios y muéstrame el estado de cada uno y el dominio del frontend.
```

> Si el Agent te pregunta o propone algo raro, dile que pare y revísalo conmigo. Es un asistente: tú mandas.

> ⚠️ **Sobre `DNS_RESOLVER = [fd12::10]`:** es la dirección del DNS interno de Railway **comúnmente observada** — Railway no la publica oficialmente. Es el mejor valor conocido para el primer intento. Si tras desplegar el **frontend carga pero el login da 502** (no encuentra al backend), el ajuste es justo esta variable: lo confirmamos juntos en el despliegue (cómo verlo y la palanca están en `GUIA-RAILWAY-R2.md` §8.1). Es un cambio de **una variable**, no de código.

---

## 4. Qué hace el Agent vs. qué haces tú

| Tarea | ¿Quién? |
|---|---|
| Crear el proyecto, Postgres, y los 2 servicios desde el repo | 🤖 Agent |
| Aplicar build por Dockerfile + healthcheck + migraciones (pre-deploy) | 🤖 Automático (lo lee del `railway.json` del repo) |
| Crear las variables y enlazar `DATABASE_URL` | 🤖 Agent |
| Generar el dominio público del frontend | 🤖 Agent |
| **Vincular GitHub + dar acceso al repo** | 👤 Tú (antes) |
| **Pegar los valores secretos** (BETTER_AUTH_SECRET, R2_*) | 👤 Tú (después) |
| **Crear el bucket y el token de Cloudflare R2** | 👤 Tú (en Cloudflare) |
| **Ligar rama ↔ environment** (production←main, prueba←prueba) | 👤 Tú (clic en el dashboard) |

---

## 5. DESPUÉS de que el Agent despliegue (tus toques finales)

1. **Pega los valores secretos** en las variables del **backend**: `BETTER_AUTH_SECRET` (el de `openssl`), y las 4 de R2 (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`).
2. **Pon `BETTER_AUTH_URL`** = el dominio público que generó el frontend (p.ej. `https://control-v2-production.up.railway.app`).
3. La **base se siembra sola** en el primer arranque (`SEED_ON_START=true`): crea FR Moda + permisos + roles + el usuario `admin`. **Después de confirmar que entró, quítale `SEED_ON_START`** (o ponla en `false`) para que no re-siembre en cada arranque.
4. **Ambiente de prueba:** duplica el environment de production, y cambia el *Source* de los 2 servicios a la rama `prueba` (+ su propio secret/URL/bucket de prueba). → Detalle en `GUIA-RAILWAY-R2.md`.

---

## 6. Verificar que quedó

1. Abre el **dominio del frontend** → te manda a `/login`.
2. Entra con `admin` / `Control.2026!` → ves tu menú de 13 módulos.
3. Entra a **Catálogos → Almacenes**, crea uno → funciona.

Si el frontend carga pero el login da error de red (502), revisa la subsección **§8.1 "re-despliegues del backend"** de `GUIA-RAILWAY-R2.md` (la red interna se autoconfigura; el fallback es reiniciar el servicio frontend una vez).

---

## 7. En una línea

El Agent hace el **90%** (proyecto + Postgres + los 2 servicios + variables + dominio). Tú haces **4 cositas explicadas**: conectar GitHub, pegar 5 valores secretos, el R2 en Cloudflare, y ligar las ramas a los ambientes. Cualquier duda, lo hacemos juntos en vivo.
