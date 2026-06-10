# backend — CONTROL v2 (Servicio de API)

Servicio de API REST de **CONTROL v2** (ERP textil Marilyn / MJD). Construido con
**Node 22 + TypeScript estricto + Fastify 5 + Prisma 7 + PostgreSQL 17**. Es un
servicio autonomo: tiene su propio `package.json` y se gestiona con **npm** (no es
un monorepo).

> Estado: **F0 / E2 — datos + dominio**. Ya estan la capa de datos (Prisma), el
> contrato (Zod + catalogo de permisos), los motores comunes (transacciones,
> folios atomicos, auditoria, archivos R2) y la logica de administracion
> (almacenes, empresas, roles, usuarios) con sus pruebas. El contrato OpenAPI,
> las rutas REST y la autenticacion (better-auth) llegan en E3 (ver
> `../PLANMAESTRO.md` y `../CLAUDE.md` §8).

## Requisitos

- Node 22 (LTS)
- Docker (para el Postgres de los tests de integracion y para correr el stack
  completo con `docker-compose`)

## Desarrollo local (sin Docker)

```powershell
npm install                 # incluye `prisma generate` (postinstall)
copy .env.example .env      # ajusta DATABASE_URL si lo necesitas
npm run db:deploy           # aplica las migraciones a tu Postgres
npm run db:seed             # siembra FR Moda + permisos + roles + admin (idempotente)
npm run dev                 # tsx watch: recarga al guardar
```

El servidor escucha en `::` (IPv4 + IPv6), puerto `PORT` (3000 por defecto).

Pruebalo:

```powershell
curl http://localhost:3000/api/health
```

## Con Docker (todo el stack)

Desde la **raiz del repositorio** (no desde esta carpeta):

```powershell
docker compose up -d --build
```

El backend, al arrancar, aplica las migraciones (`prisma migrate deploy`) y, con
`SEED_ON_START=true` (asi viene en el compose de desarrollo), siembra los datos de
fundacion — todo idempotente. No publica puerto al host: es privado y solo lo
alcanza el frontend (nginx) por la red interna. La salud, via el proxy del
frontend:

```powershell
curl http://localhost:8080/api/health
# { "estado": "ok", "servicio": "backend", "bd": "ok", "hora": "<ISO>" }
```

## Scripts

| Script                    | Que hace                                                       |
| ------------------------- | -------------------------------------------------------------- |
| `npm run dev`             | Servidor en modo desarrollo (recarga con `tsx watch`)          |
| `npm run build`           | Compila TypeScript a `dist/` (`tsconfig.build.json`)           |
| `npm start`               | Corre el servidor compilado (`dist/servidor.js`)               |
| `npm run typecheck`       | Verifica tipos sin emitir (`tsc --noEmit`)                     |
| `npm run lint`            | ESLint sobre el codigo                                         |
| `npm run format:check`    | Verifica formato con Prettier                                  |
| `npm test`                | Todos los tests (unit + integracion) con Vitest                |
| `npm run test:unit`       | Solo los tests unitarios (sin base de datos)                   |
| `npm run test:integracion`| Tests de integracion contra Postgres efimero (testcontainers)  |
| `npm run db:generate`     | Genera el cliente Prisma (`src/datos/generated/`)              |
| `npm run db:migrate`      | Crea/aplica una migracion en desarrollo (`migrate dev`)        |
| `npm run db:deploy`       | Aplica migraciones pendientes (`migrate deploy`)               |
| `npm run db:seed`         | Siembra los datos de fundacion (idempotente)                   |

## Endpoints

| Metodo | Ruta          | Respuesta                                                         |
| ------ | ------------- | ---------------------------------------------------------------- |
| `GET`  | `/api/health` | `{ estado, servicio, bd, hora }` — 200 si la BD responde, 503 si no |

## Estructura

```
prisma/
├── schema.prisma          # esquema F0 (Prisma 7, generator prisma-client)
├── migrations/            # migracion `fundacion` (SQL versionado)
└── seed.ts                # seed idempotente (FR Moda + permisos + roles + admin)
src/
├── servidor.ts            # arranca Fastify, escucha en :: y maneja el apagado limpio
├── app.ts                 # construye/configura la instancia de Fastify (sin escuchar)
├── api/
│   └── salud/             # router de salud (ping a la BD) + tipos
├── datos/                 # cliente Prisma singleton (adapter pg) + tipos generados
├── contrato/              # Zod + catalogo de permisos (fuente del OpenAPI en E3)
├── comun/                 # motores: errores, transacciones, folios (A3), auditoria (A7),
│                          #   permisos (RBAC A4), paginacion, archivos R2 (A5)
├── dominio/               # LOGICA DE NEGOCIO (A1) — nunca en rutas ni en el front
│   └── admin/             #   almacenes (CRUD patron), empresas, roles, usuarios
└── pruebas/               # helpers de test (cliente efimero, sesiones, entorno global)
```

Convencion (PLANMAESTRO §3, A1): la logica de negocio vive SOLO en `src/dominio`;
las rutas REST (E3) seran routers delgados bajo `src/api/` que validan con el
contrato y delegan en el dominio.

## Base de datos (Prisma 7)

- **Generator** `prisma-client` (no el legacy `prisma-client-js`): emite el cliente
  a `src/datos/generated/prisma` (gitignoreado; se regenera con `npm run db:generate`,
  tambien en `postinstall` y en el build de Docker).
- **Sin `url` en el datasource**: la conexion va por `@prisma/adapter-pg` leyendo
  `DATABASE_URL` (ver `src/datos/index.ts`).
- **Migraciones**: el esquema se versiona en `prisma/migrations`; nunca `db push`.

## Tests

Dos proyectos de Vitest (PLANMAESTRO §9.2):

- **unit** (`*.test.ts`): reglas puras, sin base de datos.
- **integracion** (`*.int.test.ts`): contra un Postgres 17 **efimero** que levanta
  testcontainers y migra con las migraciones reales — JAMAS contra una base
  compartida. Requiere Docker corriendo.

## Variables de entorno

Ver `.env.example`. `DATABASE_URL` es la cadena de conexion a PostgreSQL. Las
variables `R2_*` (Cloudflare R2) solo se necesitan cuando se usan los archivos
adjuntos; el servicio de archivos las valida de forma perezosa.
