/**
 * Rutas REST del **COTEJO de la factura contra el documento que emitimos** (fila 0.117;
 * §Post-F9.232). Handlers DELGADOS (A1): validan con el Zod compartido, autorizan (`conPermiso`,
 * A4) y delegan a `dominio/pagos/cotejo`. SIN permiso nuevo (§Post-F9.190): leer es `cxp.ver`,
 * ligar y atender es `cxp.administrar` — las mismas casillas que ya tiene quien lleva CxP.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `GET  /cxp/cotejo`                      (`cxp.ver`)          → la bandeja, con su tolerancia.
 *  • `GET  /cxp/cotejo/documentos/:idProveedor` (`cxp.ver`)       → los documentos que le emitimos.
 *  • `PUT  /cxp/cotejo/:id/documentos`       (`cxp.administrar`)  → qué documentos cubre (reemplaza).
 *  • `POST /cxp/cotejo/:id/atender`          (`cxp.administrar`)  → deja de frenar el pago, con nota.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAplicarCotejoEntrada,
  esquemaAtenderCotejoEntrada,
  esquemaBandejaCotejoQuery,
  esquemaBandejaCotejoSalida,
  esquemaDocumentosEmitidosSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  aplicarCotejo,
  atenderCotejo,
  bandejaDeCotejo,
  documentosEmitidosDeProveedor,
} from '../../dominio/pagos/cotejo.js';

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** `:id` de la factura (el movimiento de CxP). */
const esquemaParamId = z.object({
  id: z.coerce.number().int().positive().describe('Id del movimiento (la factura).'),
});

/** `:idProveedor` del listado de documentos emitidos. */
const esquemaParamProveedor = z.object({
  idProveedor: z.coerce.number().int().positive().describe('Id del proveedor.'),
});

/** Registra las rutas del cotejo (montadas bajo `/api`). */
export const rutasCotejo: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  app.route({
    method: 'GET',
    url: '/cxp/cotejo',
    preHandler: app.conPermiso('cxp.ver'),
    schema: {
      tags: ['cxp'],
      summary: 'Facturas cotejadas contra los documentos que les emitimos (las que frenan el pago)',
      security: SEGURIDAD_SESION,
      querystring: esquemaBandejaCotejoQuery,
      response: { 200: esquemaBandejaCotejoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return bandejaDeCotejo(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/cxp/cotejo/documentos/:idProveedor',
    preHandler: app.conPermiso('cxp.ver'),
    schema: {
      tags: ['cxp'],
      summary: 'Documentos para facturar emitidos a un proveedor, con lo que les falta por cubrir',
      security: SEGURIDAD_SESION,
      params: esquemaParamProveedor,
      response: { 200: esquemaDocumentosEmitidosSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return documentosEmitidosDeProveedor(sesion, request.params.idProveedor);
    },
  });

  // PUT y no POST: la lista que llega REEMPLAZA a la anterior (es el estado completo de las ligas
  // de esa factura), así que reenviarla dos veces deja lo mismo.
  app.route({
    method: 'PUT',
    url: '/cxp/cotejo/:id/documentos',
    preHandler: app.conPermiso('cxp.administrar'),
    schema: {
      tags: ['cxp'],
      summary: 'Dice qué documentos emitidos cubre esta factura (reemplaza las ligas)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAplicarCotejoEntrada,
      response: { 200: esquemaBandejaCotejoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aplicarCotejo(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'POST',
    url: '/cxp/cotejo/:id/atender',
    preHandler: app.conPermiso('cxp.administrar'),
    schema: {
      tags: ['cxp'],
      summary: 'Atiende el descuadre de una factura: sigue marcada, pero deja de frenar el pago',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAtenderCotejoEntrada,
      response: { 200: esquemaBandejaCotejoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return atenderCotejo(sesion, request.params.id, request.body);
    },
  });

  done();
};
