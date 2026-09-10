/**
 * Configuración del contrato OpenAPI (el "menú" del backend, PLANMAESTRO §1/§3).
 *
 * El OpenAPI se GENERA desde los mismos esquemas Zod que validan las rutas
 * (`fastify-type-provider-zod` + `@fastify/swagger`): una sola fuente de verdad
 * para validación y contrato. El frontend (E4) deriva de aquí su cliente tipado.
 *
 * Este módulo centraliza:
 *  - los metadatos del documento (info, servidor, security scheme de la cookie
 *    de sesión de better-auth);
 *  - el `transform` (jsonSchemaTransform) que convierte Zod → JSON Schema.
 * Lo consumen tanto la app (`app.ts`, que además sirve Swagger UI) como el
 * script de generación (`scripts/generar-openapi.ts`).
 */
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';

/** Nombre de la cookie de sesión de better-auth (security scheme del contrato). */
export const COOKIE_SESION = 'better-auth.session_token';

/** Ruta donde se sirve Swagger UI. */
export const RUTA_DOCS = '/api/docs';

/**
 * Requisito de seguridad para rutas protegidas: la cookie de sesión. Se pone en
 * el `schema.security` de cada ruta que exige sesión, para que el contrato (y el
 * cliente de E4) sepan que necesitan estar autenticadas.
 */
export const SEGURIDAD_SESION = [{ cookieSesion: [] }];

/**
 * Esquema de una respuesta BINARIA (imagen, PDF…) para el contrato.
 *
 * En Fastify, `reply.send(buffer)` NO pasa por el serializador (los Buffer viajan tal cual), así que
 * declarar la respuesta 200 aquí **no cambia nada en tiempo de ejecución**: solo hace que el
 * endpoint quede DOCUMENTADO en el OpenAPI (antes las rutas binarias solo declaraban sus errores y
 * el 200 quedaba invisible para quien lee el contrato).
 *
 * `@fastify/swagger` envuelve toda respuesta en `application/json`; los tipos de medio REALES se
 * declaran en `mediaTypes` y {@link corregirMediaTypesBinarios} los corrige al volcar el contrato.
 */
export function esquemaRespuestaBinaria(descripcion: string, mediaTypes: string[]) {
  // `z.custom<Buffer>` (y no `z.string()`) para que `reply.send(buffer)` tipe sin castear: el
  // `.meta()` fija a mano el JSON Schema equivalente (`string` con `format: binary`).
  return z
    .custom<Buffer>((valor) => Buffer.isBuffer(valor))
    .meta({ type: 'string', format: 'binary', mediaTypes, description: descripcion });
}

/** Forma mínima del documento OpenAPI que recorre {@link corregirMediaTypesBinarios}. */
interface DocumentoOpenApi {
  paths?: Record<
    string,
    Record<
      string,
      {
        responses?: Record<
          string,
          { content?: Record<string, { schema?: { mediaTypes?: unknown } }> }
        >;
      }
    >
  >;
}

/**
 * Corrige, EN EL DOCUMENTO YA GENERADO, el tipo de medio de las respuestas binarias: donde
 * {@link esquemaRespuestaBinaria} dejó `mediaTypes`, cambia el `application/json` que pone
 * `@fastify/swagger` por los tipos reales (`image/png`, `image/jpeg`…) y quita la marca auxiliar.
 *
 * Se aplica al volcar `openapi.json` (lo que consume el cliente del frontend y lo que lee un
 * humano). La Swagger UI que sirve la app en vivo llama a `app.swagger()` por su cuenta y ahí sigue
 * mostrando `application/json`: es cosmético y no vale acoplar el pipeline de la app por eso.
 */
export function corregirMediaTypesBinarios(documento: unknown): void {
  const paths = (documento as DocumentoOpenApi).paths ?? {};
  for (const operaciones of Object.values(paths)) {
    for (const operacion of Object.values(operaciones)) {
      for (const respuesta of Object.values(operacion.responses ?? {})) {
        const json = respuesta.content?.['application/json'];
        const tipos = json?.schema?.mediaTypes;
        if (json === undefined || respuesta.content === undefined || !Array.isArray(tipos)) {
          continue;
        }
        delete json.schema?.mediaTypes;
        delete respuesta.content['application/json'];
        for (const tipo of tipos as string[]) {
          respuesta.content[tipo] = json;
        }
      }
    }
  }
}

/** Opciones de `@fastify/swagger` (metadatos + transform Zod→JSON Schema). */
export const opcionesSwagger: FastifyDynamicSwaggerOptions = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'CONTROL v2 — API',
      description:
        'API REST del ERP CONTROL v2 (FR Moda / Marilyn). Contrato generado desde los esquemas Zod del backend.',
      version: '0.1.0',
    },
    servers: [{ url: '/', description: 'Mismo origen (el frontend proxya /api).' }],
    tags: [
      { name: 'salud', description: 'Estado del servicio.' },
      { name: 'sesion', description: 'Usuario actual y permisos.' },
      { name: 'resumen', description: 'Resumen operativo de la portada (R9, por bloque/permiso).' },
      { name: 'almacenes', description: 'Catálogo de almacenes (CRUD patrón).' },
      { name: 'usuarios', description: 'Administración de usuarios.' },
      { name: 'empresas', description: 'Administración de empresas y su configuración.' },
      { name: 'roles', description: 'Roles (solo lectura, para el selector de usuarios).' },
      // Catálogos maestros (F1-E1).
      {
        name: 'proveedores',
        description: 'Catálogo de proveedores de telas, avíos y servicios.',
      },
      { name: 'temporadas', description: 'Catálogo de temporadas.' },
      {
        name: 'etiquetas-marca',
        description: 'Catálogo de etiquetas de marca (con su porcentaje de regalías).',
      },
      { name: 'colores', description: 'Catálogo de colores.' },
      // Catálogos estructurados (F1-E2). NOTA: maquileros se fusionó en proveedores (D12/R15).
      { name: 'tallas', description: 'Catálogo de tallas y curvas de tallas (D4).' },
      {
        name: 'clientes',
        description: 'Catálogo de clientes y sus campos de referencia (D7).',
      },
      // Órdenes de producción (F2-E2).
      {
        name: 'ordenes',
        description: 'Órdenes de producción: alta desde pedido, matriz colores × tallas, cancelar.',
      },
      // Inventario de materiales por kardex (F4-E1).
      {
        name: 'inventario-telas',
        description:
          'Inventario de telas por kardex (tela×lote, D5): ajuste, salida a orden, traspaso, existencias y kardex.',
      },
      {
        name: 'inventario-avios',
        description:
          'Inventario de avíos por kardex (multi-almacén, R4): ajuste, traspaso, existencias y kardex.',
      },
      // La corrida semanal de pagos y su catálogo de conceptos (0.113 / 0.125).
      {
        name: 'pagos',
        description:
          'La corrida semanal de pagos: la relación con la que se decide a quién se le paga y cuánto (con factura y sin factura).',
      },
      {
        name: 'conceptos-pago',
        description:
          'Catálogo de conceptos de pago que NO son proveedores (nómina por fuera, servicios, caja chica) y sus cuentas.',
      },
    ],
    components: {
      securitySchemes: {
        // La sesión viaja en una cookie HTTP-only emitida por /api/auth/sign-in/*.
        cookieSesion: {
          type: 'apiKey',
          in: 'cookie',
          name: COOKIE_SESION,
          description: 'Cookie de sesión emitida por better-auth al iniciar sesión.',
        },
      },
    },
  },
  transform: jsonSchemaTransform,
};
