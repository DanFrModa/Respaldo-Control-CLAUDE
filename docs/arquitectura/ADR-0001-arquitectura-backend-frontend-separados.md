# ADR-0001 — Backend y frontend separados, dockerizados, comunicados por REST/OpenAPI (no monorepo)

- **Estado:** Aceptado
- **Fecha:** 2026-06-10
- **Decisores:** Gabriel (dueño de la ejecución del proyecto). Validado en `PLANMAESTRO.md` §1–§3.

## Contexto

CONTROL v2 reemplaza un ERP que hoy corre el negocio completo de FR Moda. La prioridad
explícita de Gabriel es la **portabilidad**: si el proveedor de hosting (Railway) se cae o
sube de precio, el sistema debe poder levantarse en otro PaaS, en un VPS o en una máquina
**sin reescribir nada**. La segunda prioridad es que la arquitectura sea **transparente**
("no quiero cosa volando"): lo que se ve es lo que hay, sin capas mágicas que escondan el
build o el despliegue.

Un primer intento de F0 se construyó como **monorepo** (pnpm workspaces + turbo, Next.js +
tRPC). Funcionaba, pero arrastraba acoplamientos que chocan con esas prioridades:

- Workspaces y herramientas compartidas (turbo, `workspace:*`) **esconden** qué depende de
  qué; el frontend y el backend quedaban entrelazados por el grafo de paquetes.
- tRPC acopla cliente y servidor por **tipos de TypeScript compartidos en build**: no hay un
  contrato publicado e inspeccionable, y mover una pieza implica mover el monorepo entero.
- Next.js mezcla servidor y cliente en un solo artefacto; separar "API" de "app" para
  desplegarlas como servicios independientes y portables es a contracorriente.

## Decisión

**Dos aplicaciones autónomas, cada una en su carpeta, desplegadas como servicios
independientes, comunicadas por API REST con contrato OpenAPI. No es un monorepo.**

1. **`backend/`** — servicio de API: Node 22 + TypeScript estricto + **Fastify 5**, Prisma 7
   + PostgreSQL 17, **better-auth** (ADR-0003) + RBAC propio, archivos en Cloudflare R2.
   Tiene su propio `package.json`, su `package-lock.json` y su `npm` — sin workspaces. Su
   lógica de negocio vive en `backend/src/dominio` (A1) y nada más la toca.
2. **`frontend/`** — la app del usuario: Vite 8 + React 19 + TypeScript estricto, servida en
   producción por **nginx** (sirve los estáticos y hace de reverse-proxy de `/api` al
   backend). También autónomo: su propio `package.json` y `npm`.
3. **El único punto compartido es el contrato OpenAPI** (ADR-0006): el backend lo genera
   desde sus esquemas Zod; el frontend genera su cliente tipado a partir de ese contrato.
   Tipado de punta a punta **sin** acoplar los dos lados en build.
4. **Todo dockerizado.** Cada servicio tiene su `Dockerfile` (multi-stage); un
   `docker-compose.yml` en la raíz levanta el sistema completo (`postgres` + `backend` +
   `frontend`) con un comando. **El entorno local es idéntico al de producción.**
5. El backend escucha en **`::`** (dual-stack IPv4+IPv6) — requisito de la red privada de
   Railway y, en general, de cualquier red moderna (`backend/src/servidor.ts`).

```
USERS ─HTTPS─▶ frontend (nginx, PÚBLICO) ─/api (red privada)─▶ backend (Fastify, PRIVADO) ─▶ Postgres (PRIVADO)
                                                                       └─ API S3 ─▶ Cloudflare R2
```

## Consecuencias

- (+) **Portabilidad real:** el artefacto desplegable es una imagen Docker estándar, sin
  nada específico de Railway. `docker compose up` levanta el sistema en cualquier proveedor,
  VPS o laptop. Railway es el proveedor elegido hoy, no una dependencia (ver
  `docs/GUIA-RAILWAY-R2.md` y los `railway.json` de cada servicio).
- (+) **Servicios de verdad independientes:** el backend no sabe nada del frontend; el
  frontend solo conoce el contrato. Se pueden versionar, escalar y desplegar por separado.
- (+) **Transparencia:** `npm` plano en cada carpeta, sin workspaces ni turbo; el build de
  cada servicio se lee de un vistazo en su `Dockerfile`.
- (+) **Seguridad por diseño:** solo el frontend es público; backend y base de datos viven
  en la red privada. Sin CORS (mismo origen vía el proxy de nginx), sin URLs quemadas.
- (−) El tipado de punta a punta ya no es "gratis" como en tRPC: hay que **regenerar el
  cliente** del frontend cuando cambia el contrato (un script, `npm run gen:api`), y el CI lo
  verifica sincronizado. Es el precio de desacoplar — y queda automatizado (ADR-0006).
- (−) Dos `package.json` y dos `package-lock.json` que mantener (Renovate los cubre, ver
  `.github/renovate.json`). Aceptado: la independencia vale más que la deduplicación.

## Alternativas consideradas

- **Monorepo (pnpm + turbo) con Next.js + tRPC** (el primer intento): descartado por
  acoplar cliente/servidor en build, esconder dependencias y atar el despliegue a un único
  artefacto — lo contrario de la portabilidad y transparencia exigidas.
- **Backend y frontend juntos en un solo servicio Next.js (BFF):** descartado; mezcla
  presentación y dominio, dificulta exponer el backend como API portable y reusable.
- **Monorepo "ligero" (solo npm workspaces, sin turbo):** descartado; cualquier workspace
  reintroduce el grafo compartido y la tentación de saltarse el contrato.

## Vuelta atrás

Cada servicio es autónomo: si en el futuro se quisiera unificarlos, se haría fusionando
carpetas y eligiendo un build común — pero se perdería la portabilidad que motiva este ADR.
Cambiar de proveedor de hosting **no** requiere tocar esta decisión: se reusan las mismas
imágenes Docker y se ajusta, a lo sumo, el target del reverse-proxy de nginx (una línea) y
las variables de entorno.

## Referencias cruzadas

- `PLANMAESTRO.md` §1 (stack), §2 (infraestructura Docker/Railway/R2), §3 (estructura del
  código y "el contrato es lo único compartido").
- ADR-0006 (cómo se genera y sincroniza el contrato OpenAPI).
- `docs/GUIA-RAILWAY-R2.md` (cómo se despliega esta arquitectura en Railway).
