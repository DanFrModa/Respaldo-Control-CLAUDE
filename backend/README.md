# backend — CONTROL v2 (Servicio de API)

Servicio de API REST de **CONTROL v2** (ERP textil Marilyn / MJD). Construido con
**Node 22 + TypeScript estricto + Fastify 5**. Es un servicio autonomo: tiene su
propio `package.json` y se gestiona con **npm** (no es un monorepo).

> Estado: **F0 / E1 — esqueleto**. Por ahora solo expone el chequeo de salud.
> La base de datos (Prisma/PostgreSQL), el contrato OpenAPI, la autenticacion y
> los modulos de negocio llegan en E2, E3 y fases siguientes (ver
> `../PLANMAESTRO.md` y `../CLAUDE.md` §8).

## Requisitos

- Node 22 (LTS)
- Docker (para correr el stack completo con `docker-compose`)

## Desarrollo local (sin Docker)

```powershell
npm install
copy .env.example .env   # ajusta PORT si lo necesitas
npm run dev              # tsx watch: recarga al guardar
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

El backend NO publica puerto al host: es privado y solo lo alcanza el frontend
(nginx) por la red interna del compose. Ver `../docker-compose.yml`.

## Scripts

| Script                 | Que hace                                              |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Servidor en modo desarrollo (recarga con `tsx watch`) |
| `npm run build`        | Compila TypeScript a `dist/`                          |
| `npm start`            | Corre el servidor compilado (`dist/servidor.js`)      |
| `npm run typecheck`    | Verifica tipos sin emitir (`tsc --noEmit`)            |
| `npm run lint`         | ESLint sobre el codigo                                |
| `npm run format:check` | Verifica formato con Prettier                         |
| `npm test`             | Ejecuta los tests (Vitest)                            |

## Endpoints

| Metodo | Ruta          | Respuesta                                                  |
| ------ | ------------- | ---------------------------------------------------------- |
| `GET`  | `/api/health` | `{ "estado": "ok", "servicio": "backend", "hora": "<ISO>" }` |

## Estructura

```
src/
├── servidor.ts          # arranca Fastify, escucha en :: y maneja el apagado limpio
├── app.ts               # construye/configura la instancia de Fastify (sin escuchar)
└── api/
    └── salud/           # modulo de salud (router + tipos)
```

Convencion (PLANMAESTRO §3): un router REST delgado por modulo bajo `src/api/`,
y la logica de negocio — cuando llegue — vivira en `src/dominio/`, nunca en las
rutas.

## Variables de entorno

Ver `.env.example`. En E1 solo se usan `PORT` y `LOG_LEVEL`; `DATABASE_URL` queda
declarada pero reservada para E2.
