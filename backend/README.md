# backend — CONTROL v2 (Servicio de API)

Servicio de API REST de **CONTROL v2** (ERP textil Marilyn / MJD). Construido con
**Node 22 + TypeScript estricto + Fastify 5 + Prisma 7 + PostgreSQL 18** (el de Railway; local y CI 17). Es un
servicio autonomo: tiene su propio `package.json` y se gestiona con **npm** (no es
un monorepo).

> Estado: **F0 / E3 — API REST + OpenAPI + auth**. Sobre la capa de datos +
> dominio de E2 ya estan: la **autenticacion** con better-auth (login por
> usuario/contraseña con **bloqueo a 5 intentos** como el sistema viejo), los
> **permisos server-side** en cada ruta (RBAC A4, deny-by-default), las **rutas
> REST delgadas** (patron Almacenes), el **contrato OpenAPI** generado desde los
> mismos Zod (Swagger UI en `/api/docs`, `openapi.json` versionado) y el **manejo
> de errores uniforme**. El frontend (cliente del OpenAPI, login UI) es E4 (ver
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
alcanza el frontend (nginx) por la red interna. El arranque es **ordenado por
healthchecks** (postgres healthy -> backend healthy -> frontend), asi que el
frontend solo queda accesible cuando el backend ya responde: no hay "502 Bad
Gateway" durante el arranque. La salud, via el proxy del frontend:

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
| `npm run openapi`         | Regenera el contrato `openapi.json` desde los Zod de las rutas  |

## Endpoints

| Metodo        | Ruta                  | Que hace                                                      |
| ------------- | --------------------- | ------------------------------------------------------------ |
| `GET`         | `/api/health`         | Salud: `{ estado, servicio, bd, hora }` (200 / 503). Publico |
| `GET`/`POST`  | `/api/auth/*`         | Autenticacion (better-auth): login, logout, sesion           |
| `GET`         | `/api/sesion`         | Usuario actual + empresa activa + permisos (401 sin sesion)  |
| `GET`         | `/api/almacenes`      | Lista (busqueda + orden + paginacion). Permiso `almacenes.ver` |
| `POST`        | `/api/almacenes`      | Crea. Permiso `almacenes.administrar`                        |
| `GET`         | `/api/almacenes/:id`  | Obtiene uno. Permiso `almacenes.ver`                         |
| `PATCH`       | `/api/almacenes/:id`  | Actualiza (incluye activar/desactivar). `almacenes.administrar` |
| `DELETE`      | `/api/almacenes/:id`  | Desactiva (borrado suave). `almacenes.administrar`           |
| `GET`         | `/api/docs`           | Swagger UI (navegador del contrato)                          |

**Login** (plugin username de better-auth):

```powershell
# Inicia sesion (guarda la cookie de sesion en cookies.txt)
curl -i -c cookies.txt -X POST http://localhost:8080/api/auth/sign-in/username `
  -H "Content-Type: application/json" `
  -d '{"username":"admin","password":"Control.2026!"}'

# Usa la cookie para pedir el usuario actual y listar almacenes
curl -b cookies.txt http://localhost:8080/api/sesion
curl -b cookies.txt http://localhost:8080/api/almacenes
```

**Bloqueo por intentos** (paridad con el sistema viejo, doc `00-Arranque-Login-y-Menu.md`
§1.1): cada login fallido suma 1 a `intentosFallidos`; al **5º** la cuenta queda
`bloqueado=true` y responde 403 con *"Estas bloqueado. Contacta al administrador."*
(incluso con la clave correcta). Un login exitoso reinicia el contador. El
desbloqueo es manual por un administrador. La regla vive en el dominio
(`src/dominio/auth/login.ts`); los hooks de better-auth la invocan.

## Autenticacion y autorizacion

- **better-auth** (`src/auth/`) con adapter Prisma y el plugin **username** (login
  por usuario, no email). El hash de contraseña es **scrypt** por defecto de
  better-auth, el MISMO que usa el seed.
- **Permisos server-side** en CADA ruta protegida via `app.conPermiso('<clave>')`
  (preHandler, deny-by-default). Sin sesion → 401; con sesion sin el permiso → 403.
  La sesion de dominio (`SesionUsuario`: id, username, empresa activa, permisos) se
  resuelve una vez por peticion con `request.obtenerSesion()`.
- La **empresa activa** (multi-empresa, A9) sale del header `x-empresa-activa` si
  viene y es valida; si no, de la empresa favorita.
- Una cuenta que queda **desactivada o bloqueada a mitad de sesion** deja de tener
  sesion valida aunque conserve la cookie: `/api/sesion` y las rutas protegidas
  responden 401 (no un 200 con permisos vacios).
- **Anti-fuerza-bruta en dos capas**: (1) el **bloqueo per-usuario a 5 intentos**
  (arriba) protege una cuenta concreta; (2) el **rate limiter per-IP de better-auth**
  (activo en produccion) acota el *password spraying* sobre muchos usuarios. Una
  `customRule` para `/sign-in/username` (20/60 s, ver `REGLA_RATE_LOGIN` en
  `src/auth/config.ts`) deja pasar holgadamente los 5 intentos deterministas y a la
  vez frena la inundacion — sobrescribe la regla especial de better-auth (3/10 s)
  que cortaria antes del 5º.

## Contrato OpenAPI

El contrato se **genera desde los mismos esquemas Zod** que validan las rutas
(`fastify-type-provider-zod` + `@fastify/swagger`): una sola fuente de verdad.

- Swagger UI navegable en **`/api/docs`**.
- `openapi.json` (raiz del backend) versionado en el repo; se regenera con
  `npm run openapi`. El frontend (E4) deriva de ahi su cliente tipado.

## Estructura

```
prisma/
├── schema.prisma          # esquema F0 (Prisma 7, generator prisma-client)
├── migrations/            # migracion `fundacion` (SQL versionado)
└── seed.ts                # seed idempotente (FR Moda + permisos + roles + admin)
scripts/
└── generar-openapi.ts     # genera openapi.json desde la app (npm run openapi)
src/
├── servidor.ts            # arranca Fastify, escucha en :: y maneja el apagado limpio
├── app.ts                 # construye/configura Fastify: compiladores Zod, auth, swagger, routers
├── openapi.ts             # config del contrato OpenAPI (metadatos + security scheme)
├── auth/                  # better-auth: config + bloqueo (hooks) + sesion + plugin Fastify
├── api/                   # ROUTERS REST DELGADOS (A1): validan, autorizan, delegan al dominio
│   ├── salud/             #   router de salud (ping a la BD) + tipos
│   ├── sesion/            #   GET /api/sesion (usuario actual)
│   ├── almacenes/         #   CRUD patron (fija el estandar de ruta REST)
│   └── errores.ts         #   error handler unico (ErrorDominio/Zod → HTTP)
├── datos/                 # cliente Prisma singleton (adapter pg) + tipos generados
├── contrato/              # Zod (entrada + salida) + catalogo de permisos (fuente del OpenAPI)
├── comun/                 # motores: errores (+ mapeo HTTP), transacciones, folios (A3),
│                          #   auditoria (A7), permisos (RBAC A4), paginacion, archivos R2 (A5)
├── dominio/               # LOGICA DE NEGOCIO (A1) — nunca en rutas ni en el front
│   ├── admin/             #   almacenes (CRUD patron), empresas, roles, usuarios
│   └── auth/              #   bloqueo por intentos (login.ts)
└── pruebas/               # helpers de test (cliente efimero, sesiones, entorno global)
```

Convencion (PLANMAESTRO §3, A1): la logica de negocio vive SOLO en `src/dominio`;
las rutas de `src/api/` son routers DELGADOS que validan con el contrato (Zod),
autorizan (permiso server-side) y delegan en el dominio. Cero `INSERT`/`UPDATE`
ni reglas de negocio en las rutas.

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

Ver `.env.example`:

- `DATABASE_URL` — cadena de conexion a PostgreSQL.
- `BETTER_AUTH_SECRET` — secreto que firma cookies/tokens de sesion (better-auth).
  **Obligatorio en produccion**; genera uno largo y aleatorio.
- `BETTER_AUTH_URL` — URL base publica del backend.
- `BETTER_AUTH_TRUSTED_ORIGINS` — origenes extra de confianza separados por coma
  (opcional; util tras un dominio publico distinto).
- `R2_*` (Cloudflare R2) — solo cuando se usan los archivos adjuntos; el servicio
  de archivos las valida de forma perezosa.
