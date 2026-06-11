# ADR-0006 — El contrato OpenAPI se genera desde los esquemas Zod del backend

- **Estado:** Aceptado
- **Fecha:** 2026-06-10
- **Decisores:** Equipo CONTROL v2 (F0). Mandato de `PLANMAESTRO.md` §1, §3, §8.4.

## Contexto

ADR-0001 desacopló backend y frontend en dos servicios independientes. Eso elimina el tipado
compartido "gratis" que daba el monorepo/tRPC, y plantea la pregunta: **¿cómo se mantienen
sincronizados los tipos entre ambos sin volver a acoplarlos?**

El plan maestro responde con un principio: **el contrato (OpenAPI) es la única cosa
compartida** entre los dos servicios (§3). Quedaba decidir y dejar escrito **cómo** se
produce ese contrato para que nunca se desactualice ni se escriba a mano.

Dos hechos del backend habilitan la solución:

- Las rutas REST ya validan su entrada/salida con **Zod 4** (una sola definición de cada
  regla de captura, alimentando la validación).
- `fastify-type-provider-zod` + `@fastify/swagger` saben convertir esos mismos esquemas Zod
  a **JSON Schema / OpenAPI 3.1**.

## Decisión

**El OpenAPI se GENERA desde los mismos esquemas Zod que validan las rutas; nunca se escribe
ni se mantiene a mano. El frontend deriva su cliente tipado de ese contrato.**

Backend (`backend/`):

- Cada ruta declara su `schema` con Zod; `jsonSchemaTransform` de `fastify-type-provider-zod`
  los convierte (config en `backend/src/openapi.ts`).
- El contrato se vuelca a **`backend/openapi.json`** (versionado en el repo) con
  `npm run openapi` (`backend/scripts/generar-openapi.ts`: construye la app, `ready()`,
  `app.swagger()` → disco). (`npm run build` solo compila TypeScript a `dist/`; no toca el
  contrato — por eso el CI corre `npm run openapi` explícitamente antes de verificarlo.)
- Swagger UI se sirve en `/api/docs` (navegable como página web).

Frontend (`frontend/`):

- `npm run gen:api` (`frontend/scripts/gen-api.mjs`) copia `../backend/openapi.json` a
  `frontend/openapi.json` (para que la imagen Docker del frontend sea autónoma y no necesite
  alcanzar `../backend` en build) y genera `frontend/src/api/esquema.gen.ts` con
  **openapi-typescript**. El cliente en runtime usa **openapi-fetch** sobre esos tipos.
- Tanto la copia del contrato como los tipos generados se **commitean**.

CI (`.github/workflows/ci.yml`):

- En el job `backend`, tras `npm run openapi` (que regenera el contrato desde los Zod), se
  verifica `git diff --exit-code openapi.json`: si el contrato versionado quedó viejo respecto
  al código, el CI falla.
- En el job `frontend`, tras `gen:api`, se verifica que `openapi.json` y `esquema.gen.ts`
  estén sincronizados con el contrato. Una incompatibilidad se ve en CI y en compilación del
  frontend, **no en producción**.

## Consecuencias

- (+) **Una sola fuente de verdad** por regla de captura (el Zod): valida en runtime y define
  el contrato. Imposible que validación y documentación diverjan.
- (+) **Tipado de punta a punta** sin acoplar los servicios: si el backend cambia el
  contrato, el frontend lo marca al regenerar/compilar.
- (+) Contrato **inspeccionable** (JSON versionado + Swagger UI), no tipos ocultos de TS.
- (−) Hay un **paso de regeneración** (`gen:api`) y el contrato se versiona: hay que correrlo
  y commitearlo cuando cambia el backend. Mitigado: el CI lo exige (no se puede olvidar).
- (−) Acopla la generación a `fastify-type-provider-zod`/`@fastify/swagger`. Aceptado: son
  estándar del ecosistema Fastify y la salida es OpenAPI estándar (portable a otros
  generadores de cliente).

## Alternativas consideradas

- **tRPC (tipos compartidos en build):** descartada con ADR-0001 (acopla cliente/servidor,
  requiere monorepo, sin contrato publicado e inspeccionable).
- **Escribir el OpenAPI a mano:** descartada; se desactualiza en cuanto cambia una ruta y
  duplica lo que el Zod ya dice.
- **Generar tipos desde Prisma:** descartada; Prisma describe la BD, no el contrato HTTP
  (entrada/salida del API, permisos, formas de respuesta) que el frontend consume.

## Vuelta atrás

El contrato es OpenAPI 3.1 estándar: se puede cambiar el generador de cliente del frontend
(p. ej. a otra herramienta que consuma OpenAPI) sin tocar el backend, o cambiar el
generador del backend conservando el mismo `openapi.json`. Migrar fuera de Zod implicaría
re-expresar las validaciones, no el contrato.

## Referencias cruzadas

- `backend/src/openapi.ts`, `backend/scripts/generar-openapi.ts`, `backend/openapi.json`.
- `frontend/scripts/gen-api.mjs`, `frontend/src/api/esquema.gen.ts`.
- ADR-0001 (por qué dos servicios y un contrato como único punto compartido).
- `PLANMAESTRO.md` §3 ("el contrato OpenAPI es la única cosa compartida").
