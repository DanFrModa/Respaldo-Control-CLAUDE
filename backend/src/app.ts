import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { rutasAlmacenes } from './api/almacenes/almacenes.rutas.js';
import { rutasClientes } from './api/clientes/clientes.rutas.js';
import { rutasColores } from './api/colores/colores.rutas.js';
import { rutasCortadores } from './api/cortadores/cortadores.rutas.js';
import { rutasEmpresas } from './api/empresas/empresas.rutas.js';
import { rutasEtiquetasMarca } from './api/etiquetas-marca/etiquetas-marca.rutas.js';
import { registrarManejadorErrores } from './api/errores.js';
import { rutasMaquileros } from './api/maquileros/maquileros.rutas.js';
import { rutasProveedores } from './api/proveedores/proveedores.rutas.js';
import { rutasRoles } from './api/roles/roles.rutas.js';
import { rutasSalud } from './api/salud/salud.rutas.js';
import { rutasSesion } from './api/sesion/sesion.rutas.js';
import { rutasTallas } from './api/tallas/tallas.rutas.js';
import { rutasTemporadas } from './api/temporadas/temporadas.rutas.js';
import { rutasUsuarios } from './api/usuarios/usuarios.rutas.js';
import { registrarAuth, type OpcionesAuth } from './auth/plugin.js';
import { opcionesSwagger, RUTA_DOCS } from './openapi.js';

/** Opciones para construir la aplicacion Fastify. */
export interface OpcionesApp {
  /**
   * Habilita el formateo legible de logs (pino-pretty), util en desarrollo.
   * En produccion se dejan los logs en JSON estructurado.
   */
  logBonito?: boolean;
  /**
   * Inyección de la autenticación (better-auth + cliente Prisma). Por defecto
   * usa los singletons de la app; las pruebas de integración lo apuntan al
   * Postgres efímero.
   */
  auth?: OpcionesAuth;
}

/**
 * Construye y configura la instancia de Fastify (sin ponerla a escuchar).
 *
 * Separar la construccion de la escucha (`servidor.ts`) mantiene la app
 * facilmente probable: los tests de integracion usan `app.inject()` sin abrir
 * un puerto.
 *
 * Orden de armado (importa):
 *  1. Compiladores Zod (validacion de entrada + serializacion de salida) y
 *     manejador de errores unico: se fijan en la raiz para toda la app.
 *  2. Autenticacion (`registrarAuth`): decora la raiz con `obtenerSesion` y
 *     `conPermiso` (se propagan a los routers) y monta `/api/auth/*`.
 *  3. OpenAPI: `@fastify/swagger` (genera el contrato desde los Zod) + Swagger
 *     UI en `/api/docs`.
 *  4. Routers de modulos bajo `/api` (el nginx del frontend proxya /api -> backend).
 */
export async function construirApp(opciones: OpcionesApp = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opciones.logBonito
      ? {
          level: process.env.LOG_LEVEL ?? 'info',
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          },
        }
      : { level: process.env.LOG_LEVEL ?? 'info' },
  });

  // 1) Zod como validador de entrada y serializador de salida de toda ruta con
  //    `schema`, y el error handler que traduce ErrorDominio/Zod -> HTTP.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(app);

  // 2) Autenticacion: decoradores en la raiz + catch-all /api/auth/*.
  registrarAuth(app, opciones.auth ?? {});

  // 3) OpenAPI generado desde los Zod + Swagger UI navegable.
  await app.register(fastifySwagger, opcionesSwagger);
  await app.register(fastifySwaggerUi, { routePrefix: RUTA_DOCS });

  // 4) Routers de modulos (cada uno bajo /api).
  await app.register(rutasSalud, { prefix: '/api' });
  await app.register(rutasSesion, { prefix: '/api' });
  await app.register(rutasAlmacenes, { prefix: '/api' });
  // Catálogos maestros globales (F1-E1) — patrón CRUD de Almacenes.
  await app.register(rutasProveedores, { prefix: '/api' });
  await app.register(rutasCortadores, { prefix: '/api' });
  await app.register(rutasTemporadas, { prefix: '/api' });
  await app.register(rutasEtiquetasMarca, { prefix: '/api' });
  await app.register(rutasColores, { prefix: '/api' });
  // Catálogos estructurados (F1-E2) — maquila unificada, tallas/curvas (D4), clientes (D7).
  await app.register(rutasMaquileros, { prefix: '/api' });
  await app.register(rutasTallas, { prefix: '/api' });
  await app.register(rutasClientes, { prefix: '/api' });
  // Administración (F1-E1 PIEZA C) — rutas REST sobre los servicios de dominio de F0.
  await app.register(rutasUsuarios, { prefix: '/api' });
  await app.register(rutasEmpresas, { prefix: '/api' });
  await app.register(rutasRoles, { prefix: '/api' });

  return app;
}
