/**
 * Rutas REST del IMPORTADOR del pedido del cliente (rediseño R8, B15 — proto §4.1 "Etapa 3"):
 * plantilla de mapeo por cliente (GET vigente / POST versionar), analizar/preview del archivo y
 * confirmar (crea pedido + OPs + RC). Handlers delgados (A1): validan (Zod compartido), autorizan
 * (`conPermiso`, A4) y delegan al dominio `dominio/pedidos/importacion`. CERO lógica de negocio aquí.
 * SIN permisos nuevos: leer plantilla → `pedidos.ver`; guardar/analizar → `pedidos.administrar`;
 * confirmar → `pedidos.administrar` (el dominio exige ADEMÁS `ordenes.administrar`, como Generar OP).
 *
 * Se registra en `app.ts`. Los paths estáticos `/pedidos/importacion/...` tienen prioridad sobre la
 * paramétrica `/pedidos/:id` (find-my-way resuelve estáticas primero). El archivo viaja como base64
 * en JSON, por eso las rutas de analizar/confirmar suben su `bodyLimit`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAnalizarImportacionCuerpo,
  esquemaAnalizarImportacionSalida,
  esquemaConfirmarImportacionCuerpo,
  esquemaConfirmarImportacionSalida,
  esquemaErrorApi,
  esquemaPlantillaImportacionGuardar,
  esquemaPlantillaImportacionSalida,
  esquemaPlantillaImportacionVigente,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  analizarImportacion,
  confirmarImportacion,
  guardarPlantilla,
  obtenerPlantillaVigente,
} from '../../dominio/pedidos/importacion.js';

/**
 * Límite de cuerpo de las rutas que reciben el archivo en base64. Alineado a los 10 MB reales de
 * Excel: 10 MB decodificados ≈ 13.98 MB en base64; el string Zod se topa en 14 MiB; este bodyLimit
 * (15 MiB) queda apenas por encima para dejar sitio al resto del JSON (mapeo, resoluciones…) sin
 * admitir payloads absurdos.
 */
const LIMITE_CUERPO_IMPORTACION = 15 * 1024 * 1024;

/** Parámetro de ruta `:idCliente`. */
const esquemaParamIdCliente = z.object({
  idCliente: z.coerce
    .number({ error: 'El id del cliente debe ser un número' })
    .int({ error: 'El id del cliente debe ser entero' })
    .positive({ error: 'El id del cliente debe ser positivo' })
    .describe('Id del cliente.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del importador de pedidos (montadas bajo `/api`). */
export const rutasImportacionPedido: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Plantilla vigente de un cliente ──────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/pedidos/importacion/plantillas/:idCliente',
    preHandler: app.conPermiso('pedidos.ver'),
    schema: {
      tags: ['pedidos'],
      summary: 'Plantilla de importación VIGENTE de un cliente (null si aún no tiene formato)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdCliente,
      response: { 200: esquemaPlantillaImportacionVigente, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerPlantillaVigente(sesion, request.params.idCliente);
    },
  });

  // ── Guardar (versionar) la plantilla de un cliente ───────────────────────────
  app.route({
    method: 'POST',
    url: '/pedidos/importacion/plantillas/:idCliente',
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary:
        'Guardar el formato del cliente como versión NUEVA (la anterior deja de ser vigente)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdCliente,
      body: esquemaPlantillaImportacionGuardar,
      response: { 201: esquemaPlantillaImportacionSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const plantilla = await guardarPlantilla(sesion, request.params.idCliente, request.body);
      return reply.code(201).send(plantilla);
    },
  });

  // ── Analizar el archivo del cliente (encabezados/muestras + vista previa) ─────
  app.route({
    method: 'POST',
    url: '/pedidos/importacion/analizar',
    bodyLimit: LIMITE_CUERPO_IMPORTACION,
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary:
        'Analizar el Excel del cliente: columnas, muestras, plantilla vigente y vista previa',
      security: SEGURIDAD_SESION,
      body: esquemaAnalizarImportacionCuerpo,
      response: { 200: esquemaAnalizarImportacionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return analizarImportacion(sesion, request.body);
    },
  });

  // ── Confirmar la importación (crea pedido + OPs + RC en una transacción) ──────
  app.route({
    method: 'POST',
    url: '/pedidos/importacion/confirmar',
    bodyLimit: LIMITE_CUERPO_IMPORTACION,
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary:
        'Confirmar la importación: pedido interno + OPs con matriz + RC (reusa salidaAProduccion)',
      security: SEGURIDAD_SESION,
      body: esquemaConfirmarImportacionCuerpo,
      response: { 201: esquemaConfirmarImportacionSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const resultado = await confirmarImportacion(sesion, request.body);
      return reply.code(201).send(resultado);
    },
  });

  done();
};
