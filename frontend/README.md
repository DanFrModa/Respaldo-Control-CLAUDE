# frontend — CONTROL v2 (Aplicacion del usuario)

SPA de **CONTROL v2** (ERP textil Marilyn / MJD), construida con **Vite 8 +
React 19 + TypeScript estricto**, **Tailwind v4** y **shadcn/ui**. En produccion
se compila a estaticos y se sirve con **nginx**, que ademas hace de
reverse-proxy de `/api` hacia el backend. Es un servicio autonomo con su propio
`package.json` y npm (no es un monorepo).

> Estado: **F0 / E4 — frontend funcional**. Incluye login real (better-auth),
> layout responsive con los 13 modulos del plan filtrados por permisos, y el
> **CRUD patron de Almacenes** de extremo a extremo. El cliente del API se
> **genera del contrato OpenAPI** del backend (ver `../PLANMAESTRO.md` y
> `../CLAUDE.md` §8). El patron a replicar esta documentado en
> [`../docs/modulos/patron-crud.md`](../docs/modulos/patron-crud.md).

## Principio: el frontend NO tiene logica de negocio (A1)

El frontend solo **pide al API y presenta**. El bloqueo de login, la
autorizacion, la validacion de negocio y las reglas viven en el backend; aqui se
muestran los mensajes que el API devuelve y se ocultan las acciones para las que
el usuario no tiene permiso (la decision real la toma el servidor en cada ruta).

## Requisitos

- Node 22 (LTS)
- Docker (para correr el stack completo con `docker compose`)

## Desarrollo local (sin Docker)

Necesita el backend corriendo en `http://localhost:3000` (Vite proxya `/api`
hacia alli):

```powershell
npm install
npm run dev            # servidor de desarrollo de Vite (por defecto :5173)
```

Entra con el admin sembrado: **`admin` / `Control.2026!`**.

## Con Docker (todo el stack)

Desde la **raiz del repositorio**:

```powershell
docker compose up -d --build
```

La app queda en `http://localhost:8080` (nginx). Las peticiones a `/api` las
reenvia nginx al backend por la red interna del compose. Ver
`../docker-compose.yml`.

## El cliente del API (generado del OpenAPI)

El cliente tipado se genera del contrato del backend con **openapi-typescript**
(tipos) + **openapi-fetch** (cliente). Para regenerarlo cuando cambie el backend:

```powershell
npm run gen:api
```

Ese script (`scripts/gen-api.mjs`) hace dos cosas y AMBAS se commitean para que
el build sea autonomo:

1. Copia `../backend/openapi.json` a `frontend/openapi.json` (el contrato viaja
   dentro del frontend; la imagen Docker no alcanza `../backend` en build).
2. Genera `src/api/esquema.gen.ts` (los tipos `paths`) desde esa copia.

El login y el cierre de sesion NO pasan por este cliente: los maneja el cliente
de **better-auth** (`src/lib/auth-client.ts`), que define su propio contrato.

## Scripts

| Script                 | Que hace                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo de Vite (con proxy a `/api`)            |
| `npm run build`        | Verifica tipos (`tsconfig.build.json`) y compila a `dist/`     |
| `npm run gen:api`      | Regenera el cliente del API desde el contrato OpenAPI          |
| `npm run typecheck`    | Verifica tipos de la app, las pruebas y los E2E                |
| `npm run lint`         | ESLint sobre el codigo                                         |
| `npm run format:check` | Verifica formato con Prettier                                  |
| `npm test`             | Pruebas unitarias y de componente (Vitest + Testing Library)   |
| `npm run test:e2e`     | Pruebas E2E (Playwright) — requiere el stack levantado         |

### Pruebas

- **Unitarias / de componente** (`npm test`, Vitest + Testing Library, jsdom): la
  validacion del login, el filtrado del menu por permisos, el mapeo de errores y
  el comportamiento de las pantallas (login y CRUD de Almacenes) con el API
  simulado. Incluye que el **mensaje de bloqueo** del backend se muestre tal cual.
- **E2E** (`npm run test:e2e`, Playwright): contra el **stack real** levantado con
  Docker. Cubre redireccion sin sesion, login (exito y credenciales invalidas),
  los 13 modulos, el CRUD completo (crear → editar → desactivar), la busqueda, el
  cierre de sesion y el alternador de tema. Antes de correrlo:

  ```powershell
  docker compose up -d --build      # desde la raiz del repo
  npm run test:e2e                  # desde frontend/
  ```

  > El bloqueo a 5 intentos se prueba de forma determinista en la prueba de
  > componente del login (respuesta 403 simulada), no en E2E: bloquear de verdad
  > requeriria 5 fallos sobre el unico usuario sembrado (`admin`), que las demas
  > pruebas necesitan operativo (un usuario inexistente nunca se bloquea).

## Estructura

```
index.html                  # punto de entrada del SPA (script anti-parpadeo del tema)
nginx.conf                  # sirve estaticos + reverse-proxy /api -> backend
openapi.json                # copia versionada del contrato (autonomia del build)
components.json             # config de shadcn/ui
src/
├── main.tsx                # monta React en #root
├── App.tsx                 # router + proveedores (Query, sesion, toasts)
├── index.css               # Tailwind v4 + tokens de shadcn + tema claro/oscuro
├── tema.ts / useTema.ts    # sistema de tema (clase `dark` en <html>, default claro)
├── AlternadorTema.tsx      # boton de tema (sol/luna)
├── api/                    # cliente del API
│   ├── esquema.gen.ts      #   tipos GENERADOS del OpenAPI (no editar)
│   ├── cliente.ts          #   cliente openapi-fetch (mismo origen, cookies)
│   ├── tipos.ts            #   alias utiles derivados del contrato
│   ├── esquemas.ts         #   esquemas Zod de captura (UX; el server re-valida)
│   ├── errores.ts          #   normalizacion de errores -> mensaje en español
│   ├── sesion.ts           #   GET /api/sesion
│   └── almacenes.ts        #   hooks de TanStack Query del CRUD de almacenes
├── lib/                    # utilidades (cn, auth-client, mensajes-auth, useDebounce)
├── sesion/                 # contexto de sesion + guard de rutas
├── components/             # componentes compartidos
│   ├── ui/                 #   primitivas de shadcn/ui
│   └── DialogoConfirmacion.tsx
├── modulos/                # cascara + modulos del ERP
│   ├── CascaronSistema.tsx #   layout (sidebar + header)
│   ├── catalogo.ts         #   los 13 modulos + filtro por permisos
│   ├── NavegacionModulos.tsx
│   ├── catalogos/          #   portada de Catalogos
│   └── almacenes/          #   CRUD patron de Almacenes
├── paginas/                # Login, Inicio, Proximamente, NoEncontrado
└── pruebas/                # configuracion y utilidades de prueba
e2e/                        # pruebas Playwright (login + CRUD)
```

## El proxy `/api`

- **Desarrollo:** lo maneja Vite (`vite.config.ts` → `server.proxy`) hacia
  `http://localhost:3000`.
- **Produccion (Docker/Railway):** lo maneja nginx (`nginx.conf`) hacia el
  servicio `backend`. Asi el navegador nunca habla directo con el backend: solo
  ve al frontend, que reenvia `/api` por la red privada.
