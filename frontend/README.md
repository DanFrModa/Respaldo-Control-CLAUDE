# frontend — CONTROL v2 (Aplicacion del usuario)

SPA de **CONTROL v2** (ERP textil Marilyn / MJD), construida con **Vite 8 +
React 19 + TypeScript estricto**. En produccion se compila a estaticos y se
sirve con **nginx**, que ademas hace de reverse-proxy de `/api` hacia el
backend. Es un servicio autonomo con su propio `package.json` y npm (no es un
monorepo).

> Estado: **F0 / E1 — esqueleto**. Solo muestra una pantalla "CONTROL v2" que
> consulta `/api/health` del backend para probar el cableado de extremo a
> extremo. El login, el layout por permisos, Tailwind/shadcn y el cliente
> generado del OpenAPI llegan en E4 (ver `../PLANMAESTRO.md` y `../CLAUDE.md` §8).

## Requisitos

- Node 22 (LTS)
- Docker (para correr el stack completo con `docker-compose`)

## Desarrollo local (sin Docker)

Necesita el backend corriendo en `http://localhost:3000` (Vite proxya `/api`
hacia alli):

```powershell
npm install
npm run dev            # servidor de desarrollo de Vite (por defecto :5173)
```

Abre la URL que imprime Vite. Si el backend esta arriba, veras el estado "ok".

## Con Docker (todo el stack)

Desde la **raiz del repositorio**:

```powershell
docker compose up -d --build
```

La app queda en `http://localhost:8080` (nginx). Las peticiones a `/api` las
reenvia nginx al backend por la red interna del compose. Ver
`../docker-compose.yml`.

## Scripts

| Script                 | Que hace                                            |
| ---------------------- | --------------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo de Vite (con proxy a `/api`) |
| `npm run build`        | Verifica tipos (`tsc -b`) y compila con Vite a `dist/` |
| `npm run preview`      | Sirve localmente el build de produccion             |
| `npm run typecheck`    | Verifica tipos sin emitir                           |
| `npm run lint`         | ESLint sobre el codigo                              |
| `npm run format:check` | Verifica formato con Prettier                       |

## Estructura

```
index.html              # punto de entrada del SPA
nginx.conf              # sirve estaticos + reverse-proxy /api -> backend
src/
├── main.tsx            # monta React en #root
├── App.tsx             # pantalla inicial: consulta /api/health y muestra el estado
└── index.css           # estilos minimos (Tailwind llega en E4)
```

## El proxy `/api`

- **Desarrollo:** lo maneja Vite (`vite.config.ts` → `server.proxy`) hacia
  `http://localhost:3000`.
- **Produccion (Docker/Railway):** lo maneja nginx (`nginx.conf`) hacia el
  servicio `backend`. Asi el navegador nunca habla directo con el backend: solo
  ve al frontend, que reenvia `/api` por la red privada.
