/**
 * Rutas REST del CIERRE DE ORDEN CON UN MAQUILERO (V1, fila 0.109). Handlers DELGADOS (A1): validan
 * (Zod compartido de `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/produccion/cierre-maquila`. Las reglas —derivar el faltante bajo lock, saldarlo, proponer
 * el descuento sin cobrarlo, el deshacer y su rechazo si el descuento ya se revisó— viven allá.
 *
 * PERMISOS: **ninguno nuevo** (no requiere `SEED_ON_START`). Se reusan los que ya gobiernan la
 * recepción de maquila, que es de donde sale el acto: DANIEL pidió que *«lo apriete quien recibe»*.
 *  • `POST /produccion/ordenes/:id/cierre-maquila`  (perm `produccion.recibo`)    → cierra.
 *  • `POST /produccion/cierres-maquila/:id/deshacer`(perm `produccion.cancelar`)  → deshace (D3).
 *  • `GET  /produccion/ordenes/:id/cierres-maquila` (perm `produccion.wip-ver`)   → los cierres.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCierreMaquilaCrear,
  esquemaCierreMaquilaDeshacerCuerpo,
  esquemaCierreMaquilaSalida,
  esquemaCierresMaquilaLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cerrarOrdenMaquila,
  deshacerCierreMaquila,
  listarCierresDeOrden,
} from '../../dominio/produccion/cierre-maquila.js';

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del recurso.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del cierre de orden con maquilero (montadas bajo `/api`). */
export const rutasCierreMaquila: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    method: 'POST',
    url: '/produccion/ordenes/:id/cierre-maquila',
    preHandler: app.conPermiso('produccion.recibo'),
    schema: {
      tags: ['produccion'],
      summary: 'Cerrar la orden con un maquilero: salda su faltante y propone (o no) cobrárselo',
      description:
        'Salda las piezas que ese maquilero nunca devolvió de ese proceso (derivadas en el ' +
        'servidor por suma directa bajo bloqueo) y, con `desenlace = cobrado`, PROPONE un ' +
        'descuento EsMa `capturado`: no cuenta al saldo hasta que alguien lo revise.',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCierreMaquilaCrear,
      response: { 201: esquemaCierreMaquilaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cierre = await cerrarOrdenMaquila(sesion, request.params.id, request.body);
      return reply.code(201).send(cierre);
    },
  });

  app.route({
    method: 'POST',
    url: '/produccion/cierres-maquila/:id/deshacer',
    preHandler: app.conPermiso('produccion.cancelar'),
    schema: {
      tags: ['produccion'],
      summary: 'Deshacer un cierre (acto inverso auditado): las piezas vuelven al pendiente',
      description:
        'Marca el cierre como deshecho y CANCELA el descuento propuesto. Se rechaza (400) si ese ' +
        'descuento ya fue revisado: ese importe ya está en el saldo del maquilero.',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCierreMaquilaDeshacerCuerpo,
      response: { 200: esquemaCierreMaquilaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return deshacerCierreMaquila(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'GET',
    url: '/produccion/ordenes/:id/cierres-maquila',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Cierres de una orden con sus maquileros (vivos primero, deshechos al final)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCierresMaquilaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarCierresDeOrden(sesion, request.params.id);
    },
  });

  done();
};
