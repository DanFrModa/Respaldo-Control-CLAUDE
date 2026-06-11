# ADR-0003 — better-auth en lugar de Auth.js v5 (beta)

- **Estado:** Aceptado
- **Fecha:** 2026-06-10
- **Decisores:** Equipo CONTROL v2 (F0), bajo la regla de Daniel: "todo con versiones actuales **y estables**"

## Contexto

El plan maestro (§1) proponía **Auth.js v5** (credenciales + sesión) como capa de
autenticación, con RBAC propio en base de datos. Al arrancar la Fase F0 (junio 2026) se
verificó el estado real de la librería: **Auth.js v5 (`next-auth@5.x` / `@auth/*`) sigue
publicada únicamente como beta** (`5.0.0-beta.x`), sin fecha de versión estable, después de
más de dos años en ese estado.

Restricciones que mandan aquí:

- Regla del plan (§1, regla de versiones): se instala **la última versión estable** de cada
  dependencia. Una beta en el componente que custodia el login de TODO el sistema viola esa
  regla de frente.
- El sistema necesita: login con **usuario y contraseña** (no OAuth), **sesión en base de
  datos** (revocable por un administrador), **bloqueo al 5.º intento fallido** (paridad con
  el sistema viejo, doc funcional `00-Arranque-Login-y-Menu.md` §1.1) y adaptador Prisma.
- Auth.js, además, trata el proveedor de credenciales como ciudadano de segunda clase (su
  propia documentación desaconseja credentials y limita funciones con él, p. ej. sesiones de
  base de datos).

## Decisión

Usar **better-auth** (versión estable, pinneada exacta) como capa de autenticación del
backend (integración oficial con Fastify):

- `emailAndPassword` + **plugin `username`** → login con usuario/contraseña; el email es
  sintético (`<username>@control.local`) porque el negocio no usa email para entrar.
- **Sesión en base de datos** (tabla `Sesion`), adaptador Prisma del backend, tablas con
  nombres en español vía `@map/@@map` (el schema lo posee `backend/prisma`).
- El **bloqueo por intentos fallidos** se implementa sobre los hooks de better-auth contra
  los campos `intentosFallidos`/`bloqueado` de `Usuario` (regla del negocio, doc 00 §1.1).
  Verificado por test de integración (5 intentos fallidos → bloqueo).
- El **RBAC sigue siendo propio** (tablas `Rol`/`Permiso`/`RolPermiso`/`UsuarioRol`, mejora
  A4): better-auth solo autentica; autorizar es nuestro (`backend/src/comun/permisos`,
  verificado server-side en cada ruta).

## Consecuencias

- (+) Cumple la regla "solo estables"; librería mantenida y con soporte de primera clase
  para credenciales, plugin de username y sesiones en BD.
- (+) Incluye hashing de contraseñas (`better-auth/crypto`) — origen del ADR-0004.
- (−) Ecosistema más joven que next-auth; menos ejemplos de terceros. Mitigado: toda la
  integración queda encapsulada en `backend/src/auth` + el mapeo de tablas en
  `backend/prisma/schema.prisma`.
- (−) El nombre de las variables de entorno queda acoplado (`BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`) — documentado en `backend/.env.example`, en el CI y en la guía de
  Railway.

## Alternativas consideradas

- **Auth.js v5 (next-auth beta):** descartada por ser beta (regla de estables) y por su
  soporte de segunda a credenciales + sesión en BD.
- **Lucia:** descartada; el proyecto se archivó como librería (quedó como recurso
  educativo), sin mantenimiento como dependencia.
- **Implementación propia (sesiones + cookies a mano):** descartada; más superficie de
  error en el componente más sensible, sin beneficio sobre una librería estable auditada.

## Vuelta atrás

La autenticación está encapsulada (la configuración en `backend/src/auth` + las tablas
mapeadas en `backend/prisma`). Migrar a otra librería implica re-mapear esas tablas y
conservar el formato de hash de contraseñas (ver ADR-0004, que define la ruta de migración
de hashes).
