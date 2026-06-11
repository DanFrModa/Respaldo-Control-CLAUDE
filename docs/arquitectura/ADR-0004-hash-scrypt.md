# ADR-0004 — Hash de contraseñas con scrypt (better-auth) en lugar de argon2

- **Estado:** Aceptado
- **Fecha:** 2026-06-10
- **Decisores:** Equipo CONTROL v2 (F0)

## Contexto

El plan maestro (§1 y §4) decía "passwords con hash **argon2**". Al adoptar better-auth
(ADR-0003) apareció un hecho práctico: better-auth trae su propio hashing de contraseñas —
**scrypt** vía `better-auth/crypto` (`hashPassword`/`verifyPassword`) — y lo usa por defecto
en todo su flujo de credenciales.

El sistema crea contraseñas en DOS lugares:

1. **El seed de la base** (`backend/prisma/seed.ts`): crea el usuario `admin` inicial
   escribiendo el hash directo en la tabla `Cuenta` (providerId `credential`).
2. **El runtime** (better-auth en `backend/src/auth`): registra/cambia contraseñas y las
   verifica en cada login.

Si el seed usara un formato (p. ej. argon2 con una librería aparte) y el runtime otro
(scrypt de better-auth), el login del admin fallaría o habría que inyectar funciones custom
de hash en better-auth solo para igualar formatos — complejidad sin beneficio en F0.

## Decisión

**Un solo formato de hash en todo el sistema: scrypt de `better-auth/crypto`.**

- El seed genera el hash del admin con `hashPassword` de `better-auth/crypto` (la MISMA
  librería y versión pinneada que el runtime).
- El runtime usa el default de better-auth, sin funciones custom.
- Ninguna otra librería de hashing entra al proyecto en F0 (sin `@node-rs/argon2` ni
  similares).

scrypt es un KDF memory-hard estándar (RFC 7914); la guía de OWASP de almacenamiento de
contraseñas lo acepta como alternativa válida cuando argon2id no es el default de la
plataforma. Para el perfil de este sistema (decenas de usuarios internos, bloqueo al 5.º
intento fallido, sesiones en BD) la diferencia práctica con argon2id es marginal.

## Consecuencias

- (+) Seed y runtime comparten formato: el admin inicial entra a la primera y cualquier
  test de login es fiel a producción.
- (+) Cero dependencias nativas extra (argon2 en Node requiere binarios precompilados,
  p. ej. `@node-rs/argon2` — un riesgo más de build en CI/Railway y en la imagen Docker).
- (−) argon2id es la recomendación primaria de OWASP; scrypt es la alternativa aceptada.
  Asumido conscientemente; ver ruta de migración abajo.

## Alternativas consideradas

- **argon2 con funciones custom en better-auth** (`emailAndPassword.password.hash/verify` +
  `@node-rs/argon2`): funciona, pero obliga a duplicar la configuración custom en el seed y
  en el runtime para siempre, y agrega una dependencia nativa. Descartada en F0.
- **Dos formatos conviviendo (seed scrypt, runtime argon2):** descartada de plano; login
  roto o lógica de verificación bifurcada.

## Vuelta atrás

Migrable sin reseteo masivo de contraseñas: better-auth acepta `password.hash`/`verify`
custom, así que se puede implementar **re-hash en el login** — verificar con scrypt el hash
viejo y, si pasa, re-guardar con argon2id; los hashes se distinguen por su formato. Se haría
en una fase posterior si se decide endurecer el perfil criptográfico (se escribiría el ADR
que reemplace a este).
