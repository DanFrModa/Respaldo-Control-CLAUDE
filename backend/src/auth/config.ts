/**
 * Instancia de better-auth de CONTROL v2 (autenticación; ADR-0003).
 *
 * Decisiones:
 *  - **Adapter Prisma** sobre el cliente singleton de `src/datos` (PostgreSQL).
 *    Los nombres de modelo/campo se mapean a los del esquema (modelo `Usuario`
 *    con `name → nombre`, `createdAt → creadoEn`, `updatedAt → modificadoEn`;
 *    las tablas `Sesion`/`Cuenta`/`Verificacion` ya usan los nombres que
 *    better-auth espera, ver `prisma/schema.prisma`).
 *  - **emailAndPassword** activado con el hash scrypt POR DEFECTO de
 *    better-auth (`better-auth/crypto`): es EXACTAMENTE el que usa el seed
 *    (`hashPassword`), por eso NO se sobrescribe `password.hash/verify`.
 *    `autoSignIn` desactivado: en este ERP no hay auto-registro.
 *  - **Plugin username**: el login es por usuario+contraseña (no email), igual
 *    que el sistema viejo (form `USUARIOS`). Endpoint: `POST /sign-in/username`.
 *  - **Bloqueo por intentos** (doc funcional 00 §1.1): se implementa con los
 *    hooks `before`/`after` delegando en el dominio (`dominio/auth/login`), que
 *    es donde vive la regla de negocio (A1). El motor verifica la contraseña;
 *    el servidor decide el bloqueo.
 *
 * El handler HTTP se monta en Fastify en `src/auth/plugin.ts` bajo `/api/auth/*`.
 */
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { username } from 'better-auth/plugins';

import { prisma, type PrismaClient } from '../datos/index.js';
import type { ContextoBd } from '../comun/transaccion.js';
import {
  evaluarAccesoPrevio,
  registrarAccesoExitoso,
  registrarIntentoFallido,
} from '../dominio/auth/login.js';

import { aplicarBloqueoAntesDeLogin, aplicarBloqueoDespuesDeLogin } from './bloqueo.js';

/** Ruta del endpoint de login por usuario (plugin username). */
const RUTA_LOGIN_USERNAME = '/sign-in/username';

/**
 * Límite de peticiones del login por usuario (rate limit per-IP de better-auth).
 *
 * better-auth trae una regla especial para `/sign-in*` de **3 req / 10 s**; con
 * ella, 5 intentos rápidos chocan con un 429 ANTES de llegar al 5º y disparar el
 * bloqueo del doc 00 §1.1 (es el 429 que aparecía al 4º intento en producción).
 * Esta `customRule` (que SOBRESCRIBE la regla especial para esta ruta exacta)
 * deja holgura para los 5 intentos deterministas y, a la vez, acota el spray
 * (password spraying / lockout-DoS) que el bloqueo per-usuario por sí solo no
 * frena. 20 intentos/min por IP nunca estorba a un usuario legítimo y corta una
 * inundación.
 */
const REGLA_RATE_LOGIN = { window: 60, max: 20 } as const;

/** Opciones de construcción de la instancia de better-auth (inyectables en pruebas). */
export interface OpcionesConstruirAuth {
  /**
   * Fuerza el rate limiter encendido sin importar el entorno. Por defecto el
   * limiter solo se activa en producción (comportamiento de better-auth); las
   * pruebas lo encienden para comprobar que la `customRule` del login deja pasar
   * los 5 intentos del bloqueo (no un 429 prematuro).
   */
  forzarRateLimit?: boolean;
}

/**
 * Construye la instancia de better-auth sobre el cliente Prisma dado.
 *
 * Recibe el cliente (en vez de tomar el singleton) para que las pruebas de
 * integración puedan apuntar la autenticación al Postgres efímero; la app usa
 * el singleton {@link auth}. El MISMO cliente se usa en el adapter y en los
 * hooks de bloqueo (`{ cliente }` al dominio), para que todo opere sobre una
 * sola base.
 *
 * `secret` y `baseURL` se leen del entorno (`BETTER_AUTH_SECRET`,
 * `BETTER_AUTH_URL`); en pruebas se inyecta un secreto fijo.
 */
export function construirAuth(
  prismaCliente: PrismaClient = prisma,
  opciones: OpcionesConstruirAuth = {},
) {
  // Contexto de BD que comparten los hooks de bloqueo con el dominio: así la
  // regla de negocio (intentos/bloqueo) opera sobre la misma base que el adapter.
  const bd: ContextoBd = { cliente: prismaCliente };

  return betterAuth({
    // El secreto firma cookies/tokens; en producción es obligatorio (ver .env.example).
    secret: process.env.BETTER_AUTH_SECRET ?? 'desarrollo-inseguro-cambiar-en-produccion',
    // URL base pública del servicio (para construir enlaces y validar origen).
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',

    database: prismaAdapter(prismaCliente, { provider: 'postgresql' }),

    // Solo el modelo Usuario renombra CAMPOS de Prisma (name→nombre,
    // createdAt→creadoEn, updatedAt→modificadoEn). En Sesion/Cuenta/Verificacion
    // los campos de Prisma ya son los nombres por defecto de better-auth
    // (createdAt/updatedAt/...); solo cambia la COLUMNA por @map, que el adapter
    // no ve. Por eso ahí solo se ajusta `modelName` (ver schema.prisma).
    user: {
      modelName: 'Usuario',
      fields: {
        name: 'nombre',
        createdAt: 'creadoEn',
        updatedAt: 'modificadoEn',
      },
    },
    session: { modelName: 'Sesion' },
    account: { modelName: 'Cuenta' },
    verification: { modelName: 'Verificacion' },

    emailAndPassword: {
      enabled: true,
      // No hay registro público en el ERP: el alta de usuarios es administrativa.
      autoSignIn: false,
      // Hash POR DEFECTO (scrypt de better-auth/crypto) = el del seed. No tocar.
    },

    // Rate limiter de better-auth ACTIVO (solo se enciende en producción por
    // defecto: window 60 s / max 100 global). Dos capas complementarias de
    // protección anti-fuerza-bruta: (1) este límite per-IP corta el spray sobre
    // muchos usuarios; (2) el bloqueo per-usuario a 5 intentos (doc 00 §1.1)
    // protege una cuenta concreta. La `customRule` para `/sign-in/username`
    // SOBRESCRIBE la regla especial de better-auth (3/10 s) para que los 5
    // intentos deterministas siempre lleguen al contador (ver REGLA_RATE_LOGIN).
    rateLimit: {
      // `enabled` solo se fija cuando una prueba lo fuerza; si no, se omite para
      // conservar el default de better-auth (off en dev, on en producción).
      ...(opciones.forzarRateLimit === true ? { enabled: true } : {}),
      customRules: { [RUTA_LOGIN_USERNAME]: REGLA_RATE_LOGIN },
    },

    plugins: [username()],

    // Bloqueo por intentos fallidos (doc 00 §1.1) — la lógica vive en el dominio
    // (A1); aquí solo se conecta al ciclo de vida del login.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== RUTA_LOGIN_USERNAME) {
          return;
        }
        // El bloqueo se traduce a APIError 403 (FORBIDDEN): better-auth corta el
        // login antes de verificar la contraseña, igual que el `Verif` viejo.
        await aplicarBloqueoAntesDeLogin(
          ctx.body,
          (nombre) => evaluarAccesoPrevio(nombre, bd),
          (mensaje) => {
            throw new APIError('FORBIDDEN', { message: mensaje });
          },
        );
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== RUTA_LOGIN_USERNAME) {
          return;
        }
        // `newSession` solo está presente cuando el login fue válido (el motor
        // creó sesión). Si es nulo, el intento falló (contraseña incorrecta).
        const sesionNueva = ctx.context.newSession;
        const exito = sesionNueva !== null && sesionNueva !== undefined;
        await aplicarBloqueoDespuesDeLogin(ctx.body, exito, sesionNueva?.user.id, {
          registrarAccesoExitoso: (idUsuario) => registrarAccesoExitoso(idUsuario, bd),
          registrarIntentoFallido: (nombre) => registrarIntentoFallido(nombre, bd),
        });
      }),
    },

    // El frontend (E4) y el propio backend están detrás del mismo origen vía el
    // nginx que proxya /api; en producción se ajusta por env.
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  });
}

/** Instancia singleton de better-auth usada por la app. */
export const auth = construirAuth();

/** Tipo de la instancia de better-auth (para tipar middlewares/decoradores). */
export type Auth = typeof auth;
