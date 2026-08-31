/**
 * Rutas REST de la LISTA DE PRECIOS por Cliente+Departamento (F8-E4, D13/R20a). Handlers DELGADOS
 * (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/desarrollo/listas-precios`. El dominio devuelve ya la proyección del contrato (importes
 * ocultos sin `consultas.ver-importes`; los cuatro FACTORES ocultos sin `listas.aprobar`).
 *
 * RBAC (mutar implica leer — preHandler en arreglo = AND; evita 403-tras-commit, lección de E3):
 *  • LEER (listado/detalle/candidatos)        → `listas.ver`.
 *  • CREAR / QUITAR renglón / BORRAR lista     → `listas.administrar` + `listas.ver`.
 *  • EDITAR FACTORES                          → `listas.aprobar` + `listas.ver` (⭐ V1-E8b,
 *    §Post-F9.125(a): mover un factor ES mover el precio de venta, y el precio es del dueño —
 *    *"los factores sólo yo los puedo mover"*. Antes bastaba `listas.administrar`).
 *  • APROBAR / teclear precio de un renglón    → `listas.aprobar` + `listas.ver`.
 *  • NEGOCIAR (rondas/acuerdos/cambiar estado) → `listas.negociar` + `listas.ver` (F8-E5).
 *  • Historial de eventos de un renglón        → `listas.ver` (F8-E5).
 *  • PDF / Excel                              → `listas.ver` + `consultas.ver-importes` (el impreso ES
 *    la exportación de precios; sin ver-importes no tiene sentido → 403). ⚠️ Además el DOMINIO los
 *    rechaza (409) si algún renglón no tiene precio APROBADO (§Post-F9.125(c): *"si no está aprobado
 *    no debería de poder bajar ni un borrador"*).
 * Se registra en `app.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaAjustarPrecioLinea,
  esquemaCambiarEstadoRenglon,
  esquemaCandidatosLista,
  esquemaCandidatosQuery,
  esquemaDesgloseCostoLinea,
  esquemaListaFactoresEditar,
  esquemaAgregarLineasLista,
  esquemaListaEncabezadoEditar,
  esquemaListaPreciosCrear,
  esquemaListaPreciosDetalle,
  esquemaModeloNuevoEnLista,
  esquemaModeloNuevoEnListaSalida,
  esquemaPendienteLineaCrear,
  esquemaPendienteLineaEditar,
  esquemaPendienteLineaSalida,
  esquemaPendientesLineaLista,
  esquemaListasPreciosLista,
  esquemaListasPreciosQuery,
  esquemaPrecioTargetLinea,
} from '../../contrato/esquemas/lista-precios.js';
import {
  esquemaAcuerdoRegistrar,
  esquemaCambiarEstadoLista,
  esquemaNegociacionEventos,
  esquemaRondaRegistrar,
  esquemaGuardarMesa,
  esquemaSimulacionNegociacion,
  esquemaSimularMesaCuerpo,
  esquemaSimulacionMesa,
  esquemaSimularNegociacionQuery,
} from '../../contrato/esquemas/negociacion.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  agregarLineasLista,
  ajustarPrecioLinea,
  aprobarLinea,
  crearLista,
  editarEncabezadoLista,
  desgloseCostoLinea,
  diagnosticoCandidatosLista,
  editarFactoresLista,
  eliminarLista,
  fijarPrecioTargetLinea,
  listarListas,
  obtenerLista,
  quitarLineaLista,
} from '../../dominio/desarrollo/listas-precios.js';
import {
  cambiarEstadoLista,
  cambiarEstadoRenglon,
  guardarMesa,
  listarEventosDeLinea,
  registrarAcuerdo,
  registrarRonda,
  simularMesa,
  simularNegociacion,
} from '../../dominio/desarrollo/negociacion.js';
import { crearModeloEnLista } from '../../dominio/desarrollo/modelo-en-la-mesa.js';
import {
  crearPendienteDeRenglon,
  editarPendienteDeRenglon,
  eliminarPendienteDeRenglon,
  listarPendientesDeRenglon,
} from '../../dominio/desarrollo/pendientes-linea.js';
import { impresoListaPrecios } from '../../dominio/desarrollo/impresos/impreso-lista-precios.js';
import { excelListaPrecios } from '../../dominio/desarrollo/impresos/excel-lista-precios.js';

/** Parámetro de ruta `:id` (lista). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la lista debe ser un número' })
    .int({ error: 'El id de la lista debe ser entero' })
    .positive({ error: 'El id de la lista debe ser positivo' })
    .describe('Id de la lista de precios.'),
});

/** Parámetro de ruta `:idLinea` (renglón). */
const esquemaParamLinea = z.object({
  idLinea: z.coerce
    .number({ error: 'El id del renglón debe ser un número' })
    .int({ error: 'El id del renglón debe ser entero' })
    .positive({ error: 'El id del renglón debe ser positivo' })
    .describe('Id del renglón de la lista.'),
});

/** Parámetros `:idLinea` + `:idPendiente` (V1-E8y, pendientes por modelo). */
const esquemaParamPendiente = z.object({
  idLinea: z.coerce
    .number({ error: 'El id del renglón debe ser un número' })
    .int()
    .positive()
    .describe('Id del renglón de la lista.'),
  idPendiente: z.coerce
    .number({ error: 'El id del pendiente debe ser un número' })
    .int()
    .positive()
    .describe('Id del pendiente.'),
});

/** Respuestas de error comunes a toda ruta protegida. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de listas de precios (montadas bajo `/api`). */
export const rutasListasPrecios: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Candidatos para una lista (cotizados, sin renglón en una lista) — y, desde V1-E8f, TAMBIÉN los
  // descartados con su motivo, para que el diálogo pueda decir POR QUÉ no hay y qué hacer.
  app.route({
    method: 'GET',
    url: '/listas-precios/candidatos',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Desarrollos candidatos para una lista, y los descartados con su motivo',
      security: SEGURIDAD_SESION,
      querystring: esquemaCandidatosQuery,
      response: { 200: esquemaCandidatosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { candidatos, descartados, faltanFactores } = await diagnosticoCandidatosLista(sesion, {
        idCliente: request.query.idCliente,
        idClienteDepartamento: request.query.idClienteDepartamento,
        ...(request.query.idProyecto === undefined ? {} : { idProyecto: request.query.idProyecto }),
      });
      return { datos: candidatos, descartados, faltanFactores };
    },
  });

  // Listado de listas (filtrable).
  app.route({
    method: 'GET',
    url: '/listas-precios',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Listar listas de precios (por cliente/departamento/estado/fechas)',
      security: SEGURIDAD_SESION,
      querystring: esquemaListasPreciosQuery,
      response: { 200: esquemaListasPreciosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarListas(sesion, request.query);
      return { datos };
    },
  });

  // Crear una lista.
  app.route({
    method: 'POST',
    url: '/listas-precios',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary:
        'Crear una lista de precios desde los precostos congelados y los factores del cliente',
      security: SEGURIDAD_SESION,
      body: esquemaListaPreciosCrear,
      response: { 201: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const lista = await crearLista(sesion, request.body);
      return reply.code(201).send(lista);
    },
  });

  // Detalle de una lista.
  app.route({
    method: 'GET',
    url: '/listas-precios/:id',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Obtener una lista de precios (con renglones)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerLista(sesion, request.params.id);
    },
  });

  // Editar el snapshot de factores: recalcula los precios calculados y TUMBA las aprobaciones
  // (§Post-F9.125(d)). Es facultad del DUEÑO (`listas.aprobar`), no de quien administra la lista.
  app.route({
    method: 'PATCH',
    url: '/listas-precios/:id/factores',
    preHandler: [app.conPermiso('listas.aprobar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary:
        'Editar los factores de una lista, recalcular sus precios e invalidar las aprobaciones (el dueño)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaListaFactoresEditar,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return editarFactoresLista(sesion, request.params.id, request.body);
    },
  });

  // QUITAR un renglón de la lista (V1-E4 punto 4: un desarrollo metido por error quedaba atrapado
  // para siempre por el `@@unique([idDesarrollo])`). Devuelve la lista ya sin ese renglón.
  app.route({
    method: 'DELETE',
    url: '/listas-precios/lineas/:idLinea',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Quitar un renglón de una lista de precios (queda íntegro en la bitácora)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return quitarLineaLista(sesion, request.params.idLinea);
    },
  });

  // BORRAR una lista completa (V1-E4 punto 4). 204 sin cuerpo: ya no hay lista que devolver.
  app.route({
    method: 'DELETE',
    url: '/listas-precios/:id',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Borrar una lista de precios (queda íntegra en la bitácora)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarLista(sesion, request.params.id);
      return reply.code(204).send(null);
    },
  });

  // Aprobar un renglón (precioAprobado = precioCalculado).
  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/aprobar',
    preHandler: [app.conPermiso('listas.aprobar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Aprobar el precio calculado de un renglón (el dueño)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aprobarLinea(sesion, request.params.idLinea);
    },
  });

  // Teclear el precio aprobado de un renglón.
  app.route({
    method: 'PATCH',
    url: '/listas-precios/lineas/:idLinea/precio',
    preHandler: [app.conPermiso('listas.aprobar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Teclear el precio aprobado de un renglón (el dueño)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaAjustarPrecioLinea,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return ajustarPrecioLinea(sesion, request.params.idLinea, request.body);
    },
  });

  // ── Negociación por versiones (F8-E5) ─────────────────────────────────────────────

  // Registrar una RONDA sobre un renglón (re-apunta a una versión congelada nueva + evento).
  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/rondas',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Registrar una ronda de negociación (re-costeo) sobre un renglón',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaRondaRegistrar,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return registrarRonda(sesion, request.params.idLinea, request.body);
    },
  });

  // Registrar un ACUERDO sin re-costeo sobre un renglón (sólo evento).
  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/acuerdos',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Registrar un acuerdo (sin re-costeo) sobre un renglón',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaAcuerdoRegistrar,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return registrarAcuerdo(sesion, request.params.idLinea, request.body);
    },
  });

  // Historial de eventos de negociación de un renglón (cronológico).
  app.route({
    method: 'GET',
    url: '/listas-precios/lineas/:idLinea/eventos',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Historial de negociación de un renglón (rondas y acuerdos)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaNegociacionEventos, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarEventosDeLinea(sesion, request.params.idLinea);
      return { datos };
    },
  });

  // Calculadora de negociación (§4.8): simula el margen de un precio objetivo. Todo es importes → se
  // exige además `consultas.ver-importes` (como el PDF/Excel); es una lectura pura (no muta nada).
  app.route({
    method: 'GET',
    url: '/listas-precios/lineas/:idLinea/simular',
    preHandler: [
      app.conPermiso('listas.negociar'),
      app.conPermiso('listas.ver'),
      app.conPermiso('consultas.ver-importes'),
    ],
    schema: {
      tags: ['listas'],
      summary:
        'Simular el margen de un precio objetivo sobre un renglón (calculadora de negociación)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      querystring: esquemaSimularNegociacionQuery,
      response: { 200: esquemaSimulacionNegociacion, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return simularNegociacion(sesion, request.params.idLinea, request.query);
    },
  });

  /**
   * ⭐⭐ EL NEGOCIADOR EN VIVO de la mesa (§Post-F9.138): el renglón completo de costos —movidos a
   * mano, con números LIBRES (§Post-F9.139)— contra el precio que se está discutiendo, y devuelve
   * las DOS direcciones: el margen del precio y el precio que ese costo pediría.
   *
   * 🔴 **Es POST y es de SÓLO LECTURA.** POST únicamente porque el renglón es de largo variable y no
   * cabe en un querystring; `simularMesa` **no escribe nada** (ni catálogo, ni receta, ni precosto,
   * ni el renglón) — su único acceso a la base es un `findFirst`. Mismos permisos que la calculadora
   * hermana, y por la misma razón: todo lo que devuelve son importes.
   */
  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/simular-mesa',
    preHandler: [
      app.conPermiso('listas.negociar'),
      app.conPermiso('listas.ver'),
      app.conPermiso('consultas.ver-importes'),
    ],
    schema: {
      tags: ['listas'],
      summary: 'Negociador en vivo: margen y precio sugerido sobre costos movidos a mano',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaSimularMesaCuerpo,
      response: { 200: esquemaSimulacionMesa, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return simularMesa(sesion, request.params.idLinea, request.body);
    },
  });

  /**
   * ⭐⭐ GUARDAR LA MESA (§Post-F9.149): persiste el desglose de costos estimados con el que se cerró
   * la negociación. **Éste sí escribe** —es el único de la mesa que lo hace— y es un guardado
   * EXPLÍCITO: *«Voy jugando y al terminar la negociación guardo la última información que metí»*.
   * Mismos permisos que el simulador hermano: todo lo que recibe y devuelve son importes.
   */
  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/mesa',
    preHandler: [
      app.conPermiso('listas.negociar'),
      app.conPermiso('listas.ver'),
      app.conPermiso('consultas.ver-importes'),
    ],
    schema: {
      tags: ['listas'],
      summary: 'Guardar el desglose de costos estimados con el que se cerró la mesa',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaGuardarMesa,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return guardarMesa(sesion, request.params.idLinea, request.body);
    },
  });

  /**
   * ⭐ TARGET PRICE del cliente en un renglón (§Post-F9.150). Lo captura **Aurora al armar la
   * lista** ⇒ `listas.administrar` (la misma puerta con la que se agrega y se quita un renglón), NO
   * `listas.aprobar`, que es del dueño. `null` lo borra. **Informa, no bloquea.**
   */
  app.route({
    method: 'PATCH',
    url: '/listas-precios/lineas/:idLinea/precio-target',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Fijar (o borrar) el target price que dio el cliente para un renglón',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaPrecioTargetLinea,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return fijarPrecioTargetLinea(sesion, request.params.idLinea, request.body);
    },
  });

  /**
   * ⭐⭐ CAMBIAR EL ESTADO DE UN RENGLÓN (§Post-F9.151): abierto → en negociación → cerrado →
   * dropeado, y la vuelta (REVIVIR, §Post-F9.155). **`listas.negociar`** — el mismo permiso que
   * mueve el estado de la LISTA; SIN permiso nuevo. NO exige `consultas.ver-importes`: aquí no
   * viaja ni un número de dinero, y quien negocia sin ver precios igual tiene que poder marcar un
   * modelo como dropeado.
   */
  app.route({
    method: 'PATCH',
    url: '/listas-precios/lineas/:idLinea/estado',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary:
        'Cambiar el estado de un renglón (modelo) de la lista: abierto/en negociación/cerrado/dropeado',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaCambiarEstadoRenglon,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cambiarEstadoRenglon(sesion, request.params.idLinea, request.body);
    },
  });

  // Desglose de costo por concepto de un renglón (§4.8): renglón expandible en la lista.
  app.route({
    method: 'GET',
    url: '/listas-precios/lineas/:idLinea/desglose-costo',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Desglose de costo por concepto del precosto congelado de un renglón',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaDesgloseCostoLinea, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return desgloseCostoLinea(sesion, request.params.idLinea);
    },
  });

  // Cambiar el estado de la lista (incluida la reapertura de una lista cerrada, auditada).
  app.route({
    method: 'PATCH',
    url: '/listas-precios/:id/estado',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Cambiar el estado de una lista de precios (negociación / cierre / reapertura)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCambiarEstadoLista,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cambiarEstadoLista(sesion, request.params.id, request.body);
    },
  });

  // Impreso PDF de la lista (R9). Binario; exige ver importes (el impreso ES precios).
  // ── ⭐⭐ V1-E8y (§Post-F9.152) — LA MESA ABIERTA ────────────────────────────
  //
  // Tres puertas nuevas: agregar modelos ya cotizados a una lista que ya existe (lo que NO se
  // podía), dar de alta ahí mismo un modelo que no existe (desde cero o copiando) y corregir los
  // datos de la cita. SIN permisos nuevos.

  // AGREGAR renglones a una lista ya creada. Hasta V1-E8y el único escritor de renglones era el
  // alta de la lista: agregar un modelo obligaba a borrarla y rehacerla.
  app.route({
    method: 'POST',
    url: '/listas-precios/:id/lineas',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Agregar modelos (ya cotizados) a una lista de precios existente',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAgregarLineasLista,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return agregarLineasLista(sesion, request.params.id, request.body);
    },
  });

  // El ENCABEZADO de la cita: el LUGAR (nuevo) y las NOTAS (que sólo se podían escribir al crear).
  app.route({
    method: 'PATCH',
    url: '/listas-precios/:id/encabezado',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Editar el lugar de la cita y las notas de una lista de precios',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaListaEncabezadoEditar,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return editarEncabezadoLista(sesion, request.params.id, request.body);
    },
  });

  // ⭐⭐ COTIZAR EN LA CITA UN MODELO QUE NO EXISTE: crea (proyecto si hace falta) + modelo (desde
  // cero o copiando) + desarrollo + precosto BORRADOR, en UNA transacción. NO agrega el renglón:
  // eso pide un precosto congelado, y primero hay que teclearle los estimados (ver el dominio).
  //
  // Los SEIS permisos van en el preHandler (AND) porque el dominio hace todas esas cosas —
  // incluidas las LECTURAS con las que `crearProyecto` y `generarPrecosto` proyectan su salida. Si
  // faltara uno, el 403 llegaría a mitad de la transacción — la lección de F8-E3.
  app.route({
    method: 'POST',
    url: '/listas-precios/:id/modelo-nuevo',
    preHandler: [
      app.conPermiso('listas.administrar'),
      app.conPermiso('listas.ver'),
      app.conPermiso('desarrollo.administrar'),
      app.conPermiso('desarrollo.ver'),
      app.conPermiso('modelos.administrar'),
      app.conPermiso('desarrollo.precostear'),
    ],
    schema: {
      tags: ['listas'],
      summary:
        'Dar de alta desde la mesa un modelo que no existe (desde cero o copiando otro) con su precosto borrador',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaModeloNuevoEnLista,
      response: { 201: esquemaModeloNuevoEnListaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const creado = await crearModeloEnLista(sesion, request.params.id, request.body);
      return reply.code(201).send(creado);
    },
  });

  // ── ⭐ V1-E8y — PENDIENTES POR MODELO ───────────────────────────────────────
  //
  // La LIBRETA de la cita («falta muestra de color»). No es el papel: no sale en PDF/Excel/
  // cotización, y por eso el dominio NO la frena con el cierre de la lista ni con el estado del
  // renglón (ver el encabezado de `pendientes-linea.ts`). Se leen también embebidos en cada renglón
  // del detalle de la lista; este GET existe para quien quiera sólo la libreta.
  app.route({
    method: 'GET',
    url: '/listas-precios/lineas/:idLinea/pendientes',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Listar los pendientes anotados sobre un modelo de la lista',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaPendientesLineaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarPendientesDeRenglon(sesion, request.params.idLinea);
      return { datos };
    },
  });

  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/pendientes',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Anotar un pendiente sobre un modelo de la lista',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaPendienteLineaCrear,
      response: { 201: esquemaPendienteLineaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pendiente = await crearPendienteDeRenglon(sesion, request.params.idLinea, request.body);
      return reply.code(201).send(pendiente);
    },
  });

  // Corrige el texto y/o TACHA el pendiente (`resuelto`).
  app.route({
    method: 'PATCH',
    url: '/listas-precios/lineas/:idLinea/pendientes/:idPendiente',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Corregir o tachar un pendiente de un modelo de la lista',
      security: SEGURIDAD_SESION,
      params: esquemaParamPendiente,
      body: esquemaPendienteLineaEditar,
      response: { 200: esquemaPendienteLineaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return editarPendienteDeRenglon(
        sesion,
        request.params.idLinea,
        request.params.idPendiente,
        request.body,
      );
    },
  });

  // Borra el pendiente (queda íntegro en la bitácora). 204 sin cuerpo.
  app.route({
    method: 'DELETE',
    url: '/listas-precios/lineas/:idLinea/pendientes/:idPendiente',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Borrar un pendiente de un modelo de la lista (queda en la bitácora)',
      security: SEGURIDAD_SESION,
      params: esquemaParamPendiente,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarPendienteDeRenglon(sesion, request.params.idLinea, request.params.idPendiente);
      return reply.code(204).send(null);
    },
  });

  app.route({
    method: 'GET',
    url: '/listas-precios/:id/pdf',
    preHandler: [app.conPermiso('listas.ver'), app.conPermiso('consultas.ver-importes')],
    schema: {
      tags: ['listas'],
      summary: 'Lista de precios en PDF (modelo / número del cliente / precio)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoListaPrecios(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="lista-precios-${folio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  // Export a Excel de la lista. Binario; exige ver importes.
  app.route({
    method: 'GET',
    url: '/listas-precios/:id/excel',
    preHandler: [app.conPermiso('listas.ver'), app.conPermiso('consultas.ver-importes')],
    schema: {
      tags: ['listas'],
      summary: 'Lista de precios en Excel (.xlsx)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await excelListaPrecios(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="lista-precios-${folio}.xlsx"`);
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
