/**
 * Rutas REST de los MOVIMIENTOS planos de EsMa — ABONOS y DESCUENTOS (F6-E4). Handlers DELGADOS (A1):
 * validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/esma/movimientos`.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `POST /esma/abonos`                    (perm `esma.modificar`)  → captura un abono.
 *  • `POST /esma/descuentos`                (perm `esma.modificar`)  → captura un descuento.
 *  • `GET  /esma/maquileros/:id/abonos`     (perm `esma.ver-pagos`)  → abonos del maquilero (importes ocultables).
 *  • `GET  /esma/maquileros/:id/descuentos` (perm `esma.ver-pagos`)  → descuentos del maquilero.
 *  • `POST /esma/movimientos/:concepto/:id/corregir` (perm `esma.ver-pagos` **+ el de capturar ESE
 *    concepto + la bandera de la persona**) → corrige un movimiento SIN FACTURA (fila 0.145): anula
 *    el viejo y captura el bueno, ligados, en una transacción. La BANDERA y el permiso fino los
 *    exige el DOMINIO (`dominio/esma/correccion.ts`), no esta ruta.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  CONCEPTOS_CORREGIBLES_ESMA,
  esquemaAbonoCrear,
  esquemaCorreccionEsMaSalida,
  esquemaCorreccionSinFactura,
  esquemaDescuentoCrear,
  esquemaMovimientoEsMaSalida,
  esquemaMovimientosEsMaLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { corregirMovimientoEsMa } from '../../dominio/esma/correccion.js';
import {
  crearAbonoMaquilero,
  crearDescuentoMaquilero,
  listarAbonosMaquilero,
  listarDescuentosMaquilero,
} from '../../dominio/esma/movimientos.js';

/** Parámetro de ruta `:id` (id de maquilero). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del maquilero (Proveedor).'),
});

/** Parámetros de la corrección: `:concepto` (abono|descuento|pago) + `:id` del movimiento. */
const esquemaParamCorreccion = z.object({
  concepto: z
    .enum(CONCEPTOS_CORREGIBLES_ESMA)
    .describe('Concepto del movimiento a corregir (el CARGO no se corrige: nace de un recibo).'),
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del movimiento dentro de su concepto.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de abonos/descuentos EsMa (montadas bajo `/api`). */
export const rutasMovimientosEsMa: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Abonos ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/esma/abonos',
    preHandler: app.conPermiso('esma.modificar'),
    schema: {
      tags: ['esma'],
      summary: 'Capturar un abono a la cuenta de un maquilero',
      security: SEGURIDAD_SESION,
      body: esquemaAbonoCrear,
      response: { 201: esquemaMovimientoEsMaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const abono = await crearAbonoMaquilero(sesion, request.body);
      return reply.code(201).send(abono);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/abonos',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Abonos de un maquilero (importes ocultos sin consultas.ver-importes)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaMovimientosEsMaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarAbonosMaquilero(sesion, request.params.id);
    },
  });

  // ── Descuentos ────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/esma/descuentos',
    preHandler: app.conPermiso('esma.modificar'),
    schema: {
      tags: ['esma'],
      summary: 'Capturar un descuento a la cuenta de un maquilero',
      security: SEGURIDAD_SESION,
      body: esquemaDescuentoCrear,
      response: { 201: esquemaMovimientoEsMaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const descuento = await crearDescuentoMaquilero(sesion, request.body);
      return reply.code(201).send(descuento);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/descuentos',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Descuentos de un maquilero (importes ocultos sin consultas.ver-importes)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaMovimientosEsMaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarDescuentosMaquilero(sesion, request.params.id);
    },
  });

  // ── Corrección de un movimiento SIN FACTURA (fila 0.145) ────────────────────
  //
  // `esma.ver-pagos` es el permiso más BAJO de los tres que este acto puede necesitar (es el que
  // hace falta para siquiera ver el estado de cuenta). El fino —`esma.modificar` para abonos y
  // descuentos, `esma.revisar` si el movimiento ya estaba revisado— y la BANDERA de la persona los
  // exige el dominio, que es donde se sabe qué concepto y en qué estado está el renglón (A1).
  app.route({
    method: 'POST',
    url: '/esma/movimientos/:concepto/:id/corregir',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Corregir un movimiento SIN FACTURA de un maquilero (anular + recapturar, D3)',
      description:
        'Reservado a la dirección por una bandera de la persona que no se otorga con ningún ' +
        'permiso ni desde ninguna pantalla. Un movimiento con factura se rechaza. Un PAGO ya ' +
        'aplicado a cargos se corrige en fecha y observaciones, no en importe.',
      security: SEGURIDAD_SESION,
      params: esquemaParamCorreccion,
      body: esquemaCorreccionSinFactura,
      response: { 200: esquemaCorreccionEsMaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return corregirMovimientoEsMa(
        sesion,
        request.params.concepto,
        request.params.id,
        request.body,
      );
    },
  });

  done();
};
