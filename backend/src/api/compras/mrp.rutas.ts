/**
 * Rutas REST del MRP / EXPLOSIÓN de materiales por orden (F4-E4). Calca el ESTÁNDAR de las rutas de
 * Órdenes de compra: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `compras.ver` para explosionar/consultar estatus (lecturas; la explosión persiste el snapshot
 *     pero es una operación de consulta del usuario), `compras.administrar` para generar OC.
 *  3. **Delega** a los servicios de dominio (`dominio/compras/mrp.ts`).
 *
 * Endpoints (bajo `/api`):
 *   `POST /explosion`                      — ⭐ V1-E3q: explosiona el CONJUNTO de OP del cuerpo y
 *                                            persiste/regenera su snapshot (R3, §Post-F9.86). Es POST
 *                                            (tiene efectos: escribe snapshot + bitácora).
 *   `POST /ordenes/:id/explosion`          — atajo de una sola OP (mismo cálculo).
 *   `GET  /ordenes/:id/del-mismo-pedido`   — ⭐ V1-E3q: las OP del mismo pedido interno (precarga).
 *   `POST /explosion/previo`               — ⭐ V1-E3q: REVISIÓN PREVIA (§Post-F9.85). No escribe nada.
 *   `POST /explosion/generar-oc`           — genera OC por proveedor desde la explosión (R3).
 *   `GET  /ordenes/:id/colores-tela`       — ⭐⭐ V1-E3u: de qué color se compra cada tela (§Post-F9.89).
 *   `PUT  /ordenes/:id/colores-tela`       — ⭐⭐ V1-E3u: amarra (o quita) el color de tela de un color.
 *   `PUT  /telas-colores/:idTelaColor/precio` — ⭐⭐ V1-E3u(b): corrige el precio del color y ACTUALIZA
 *                                            el catálogo (auditado, A7).
 *   `GET  /ordenes/:id/estatus-materiales` — tablero "qué tengo / qué falta" (R7).
 *   `GET  /ordenes/:id/explosion/impreso`        — PDF de la explosión (R9, binario).
 *   `GET  /ordenes/:id/estatus-materiales/impreso` — PDF del estatus de recepción (R9, binario).
 *
 * NO crea permisos nuevos (usa los `compras.*` de E2). CERO lógica de negocio aquí.
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasMrp, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaExplosionCuerpo,
  esquemaExplosionSalida,
  esquemaGenerarOcCuerpo,
  esquemaGenerarOcResultado,
  esquemaAsignarProveedorCuerpo,
  esquemaAsignarProveedorSalida,
  esquemaEstatusMaterialesSalida,
  esquemaOrdenesDelPedidoSalida,
  esquemaPlanCompra,
  esquemaColoresDeTelaSalida,
  esquemaAsignarColorTelaCuerpo,
  esquemaFijarPrecioColorCuerpo,
  esquemaFijarPrecioColorSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  explosionarOrden,
  explosionarOrdenes,
  generarOCDesdeExplosion,
  previoCompraDesdeExplosion,
  ordenesDelPedidoDeOrden,
  estatusMaterialesOrden,
} from '../../dominio/compras/mrp.js';
import { asignarProveedorDeMaterial } from '../../dominio/compras/proveedor-de-orden.js';
import {
  asignarColorDeTela,
  coloresDeTelaDeOrden,
  fijarPrecioDeColor,
} from '../../dominio/compras/color-de-la-tela.js';
import { impresoExplosion } from '../../dominio/compras/impresos/impreso-explosion.js';
import { impresoEstatusMateriales } from '../../dominio/compras/impresos/impreso-estatus-materiales.js';

/** Parámetro de ruta `:id` (orden de producción). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden de producción.'),
});

/** Parámetro de ruta `:idTelaColor` (color de tela del catálogo). */
const esquemaParamTelaColor = z.object({
  idTelaColor: z.coerce
    .number({ error: 'El id del color de tela debe ser un número' })
    .int({ error: 'El id del color de tela debe ser entero' })
    .positive({ error: 'El id del color de tela debe ser positivo' })
    .describe('Id del color de tela (`TelaColor`).'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del MRP (montadas bajo `/api`). */
export const rutasMrp: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ⭐ V1-E3q (§Post-F9.86) — Explosionar UN CONJUNTO de OP (regenera y persiste el snapshot de
  // cada una; R3). Las OP van en el CUERPO porque son varias: *"normalmente compramos varias OP
  // con una sola OC"* (Daniel). Con una sola OP el resultado es idéntico al de antes.
  app.route({
    method: 'POST',
    url: '/explosion',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Explosionar los materiales de una o varias órdenes (R3) y persistir el snapshot',
      security: SEGURIDAD_SESION,
      body: esquemaExplosionCuerpo,
      response: { 200: esquemaExplosionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return explosionarOrdenes(sesion, request.body.idsOrden);
    },
  });

  // Explosionar UNA orden (atajo histórico; mismo cálculo, un solo id en la URL).
  app.route({
    method: 'POST',
    url: '/ordenes/:id/explosion',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Explosionar los materiales de una orden (R3) y persistir el snapshot',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaExplosionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return explosionarOrden(sesion, request.params.id);
    },
  });

  // ⭐ V1-E3q (§Post-F9.86) — Las OP del MISMO PEDIDO INTERNO, para PRECARGAR la explosión
  // (*"muchas veces se compran los avíos de un mismo pedido interno… ejemplo 1515"*).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/del-mismo-pedido',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Órdenes de producción del mismo pedido interno (precarga de la explosión)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaOrdenesDelPedidoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return ordenesDelPedidoDeOrden(sesion, request.params.id);
    },
  });

  // ⭐⭐ V1-E3q (§Post-F9.85) — LA REVISIÓN PREVIA. *"Una revisión previa es indispensable"*
  // (Daniel). No escribe NADA: enseña las OC que saldrían (proveedor, renglones, cantidades, de qué
  // OP es cada una) y lo que se va a omitir con su razón. Es POST porque lleva cuerpo (la selección
  // completa), no porque tenga efectos — no los tiene.
  app.route({
    method: 'POST',
    url: '/explosion/previo',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Revisión previa de las órdenes de compra que se generarían (§Post-F9.85)',
      security: SEGURIDAD_SESION,
      body: esquemaGenerarOcCuerpo,
      response: { 200: esquemaPlanCompra, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return previoCompraDesdeExplosion(sesion, request.body);
    },
  });

  // Generar OC por proveedor desde la explosión (R3), para el conjunto de OP del cuerpo.
  app.route({
    method: 'POST',
    url: '/explosion/generar-oc',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Generar órdenes de compra (una por proveedor) desde la explosión (R3)',
      security: SEGURIDAD_SESION,
      body: esquemaGenerarOcCuerpo,
      response: { 201: esquemaGenerarOcResultado, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const resultado = await generarOCDesdeExplosion(sesion, request.body);
      return reply.code(201).send(resultado);
    },
  });

  // ⭐ V1-E3m (§Post-F9.82) — asignar/quitar el proveedor con el que ESTA orden compra un material.
  // PUT (idempotente: mandar dos veces lo mismo deja lo mismo) y `compras.administrar`, el MISMO
  // permiso que genera las OC: quien compra es quien desatora. NO toca el catálogo.
  app.route({
    method: 'PUT',
    url: '/ordenes/:id/materiales/proveedor',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Asignar (o quitar) el proveedor con el que esta orden compra un material',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAsignarProveedorCuerpo,
      response: { 200: esquemaAsignarProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return asignarProveedorDeMaterial(sesion, request.params.id, request.body);
    },
  });

  // ⭐⭐ V1-E3u (§Post-F9.89) — DE QUÉ COLOR SE COMPRA CADA TELA DE ESTA ORDEN. Lectura del
  // comprador (`compras.ver`, la misma puerta que la explosión): el desglose por color de la matriz
  // con lo amarrado, lo propuesto y lo elegible. El cálculo (piezas × consumo) lo hace el SERVIDOR.
  app.route({
    method: 'GET',
    url: '/ordenes/:id/colores-tela',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'De qué color se compra cada tela de una orden (§Post-F9.89)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaColoresDeTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return coloresDeTelaDeOrden(sesion, request.params.id);
    },
  });

  // ⭐⭐ V1-E3u (§Post-F9.89) — AMARRA (o quita, con `idTelaColor: null`) el color de tela que le
  // toca a un color de la matriz. PUT: idempotente. `compras.administrar`, el MISMO permiso que
  // genera las OC (quien compra, dice de qué color compra). NO toca el catálogo de telas.
  app.route({
    method: 'PUT',
    url: '/ordenes/:id/colores-tela',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Amarrar (o quitar) el color de tela de un color de la orden (§Post-F9.89)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAsignarColorTelaCuerpo,
      response: { 200: esquemaColoresDeTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return asignarColorDeTela(sesion, request.params.id, request.body);
    },
  });

  // ⭐⭐ V1-E3u (§Post-F9.89(b)) — CORREGIR EL PRECIO DEL COLOR **ACTUALIZA EL CATÁLOGO**. Es una
  // escritura de catálogo disparada desde la pantalla de compra: por eso responde el ANTES y el
  // DESPUÉS (para que se VEA) y el dominio la deja en bitácora con su origen (A7).
  app.route({
    method: 'PUT',
    url: '/telas-colores/:idTelaColor/precio',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Corregir el precio de un color de tela desde la compra (actualiza el catálogo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamTelaColor,
      body: esquemaFijarPrecioColorCuerpo,
      response: { 200: esquemaFijarPrecioColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return fijarPrecioDeColor(sesion, request.params.idTelaColor, request.body);
    },
  });

  // Tablero "qué tengo / qué falta" (R7).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/estatus-materiales',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Tablero de estatus de materiales de una orden (qué tengo / qué falta, R7)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEstatusMaterialesSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return estatusMaterialesOrden(sesion, request.params.id);
    },
  });

  // Impreso (PDF) de la explosión. Respuesta BINARIA (application/pdf).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/explosion/impreso',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Imprimir la explosión de materiales de una orden (PDF, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folioOrden } = await impresoExplosion(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="explosion-orden-${folioOrden}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  // Impreso (PDF) del estatus de materiales (recepción). Respuesta BINARIA (application/pdf).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/estatus-materiales/impreso',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Imprimir el estatus de materiales de una orden (PDF, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folioOrden } = await impresoEstatusMateriales(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="estatus-materiales-orden-${folioOrden}.pdf"`,
        );
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
