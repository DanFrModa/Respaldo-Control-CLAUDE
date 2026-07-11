/**
 * Rutas REST de los HITOS de una orden (cierre del hueco de emisores, post-F9; doc `08-Ruta-Critica.md`
 * §4). Un hito es un acto puntual capturado en el detalle de la orden (revisión de la OP, autorización
 * de fit/tono/avíos, empaque, autorización de arte) que auto-completa su proceso RC vía el auto-avance.
 * Handlers DELGADOS (A1): validan (Zod compartido de `src/contrato`), autorizan (`conPermiso`, A4) y
 * delegan al dominio `dominio/ruta-critica/hitosOrden`. CERO lógica de negocio aquí.
 *
 * Endpoints (todos por la empresa activa = A9):
 *  • `GET  /ruta-critica/ordenes/:id/hitos`               → hitos VIVOS de la orden. `rc.ruta-ver`
 *    (mismo permiso que ver su Ruta Crítica: los hitos son parte del estado de la RC de la orden).
 *  • `POST /ruta-critica/ordenes/:id/hitos`               → registrar un hito. `rc.capturar`.
 *  • `POST /ruta-critica/ordenes/:id/hitos/:idHito/cancelar` → cancelar (suave, con motivo). `rc.capturar`.
 *
 * Se registra en `app.ts` junto a las demás rutas de ruta-crítica.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCancelarHitoCuerpo,
  esquemaErrorApi,
  esquemaHitosOrdenSalida,
  esquemaParamOrdenHito,
  esquemaParamOrdenRc,
  esquemaRegistrarHitoCuerpo,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cancelarHito,
  listarHitosOrden,
  registrarHito,
} from '../../dominio/ruta-critica/hitosOrden.js';

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de los hitos de orden de la RC (montadas bajo `/api`). */
export const rutasHitosRc: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Listar los hitos vivos de una orden.
  app.route({
    method: 'GET',
    url: '/ruta-critica/ordenes/:id/hitos',
    preHandler: app.conPermiso('rc.ruta-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Hitos vivos de una orden (revisión OP, fit, tono, avíos, empaque, arte)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrdenRc,
      response: { 200: esquemaHitosOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarHitosOrden(sesion, request.params.id);
    },
  });

  // Registrar un hito en la orden (dispara el auto-avance de su proceso RC).
  app.route({
    method: 'POST',
    url: '/ruta-critica/ordenes/:id/hitos',
    preHandler: app.conPermiso('rc.capturar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Registrar un hito de la orden (auto-completa su proceso de la Ruta Crítica)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrdenRc,
      body: esquemaRegistrarHitoCuerpo,
      response: { 200: esquemaHitosOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return registrarHito(sesion, request.params.id, request.body);
    },
  });

  // Cancelar un hito (suave, con motivo; des-completa su proceso RC si ya no queda vivo).
  app.route({
    method: 'POST',
    url: '/ruta-critica/ordenes/:id/hitos/:idHito/cancelar',
    preHandler: app.conPermiso('rc.capturar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Cancelar un hito de la orden (cancelación suave, con motivo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrdenHito,
      body: esquemaCancelarHitoCuerpo,
      response: { 200: esquemaHitosOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarHito(sesion, request.params.id, request.params.idHito, request.body);
    },
  });

  done();
};
