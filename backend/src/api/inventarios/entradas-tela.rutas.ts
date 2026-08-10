/**
 * Rutas REST de la ENTRADA DE TELA por FACTURA/REMISIÓN sin orden de compra (etapa B1 — Daniel
 * `DECISIONES.md` §Post-F9.9 punto 7). Handlers DELGADOS (A1): validan (Zod compartido de
 * `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/inventarios/entradas-tela` (y `adjuntos-entrada-tela` para el PDF de la factura). Las
 * reglas (folio atómico, partidas, kardex, inverso de cancelación, ocultamiento de importes del
 * ex-acceso #7) viven en el dominio.
 *
 * Endpoints (todos por la empresa activa = A9; RBAC reusado, sin permisos nuevos):
 *  • `GET    /inventarios/telas/entradas`                  (`inventario-telas.ver`)   → listado paginado.
 *  • `POST   /inventarios/telas/entradas`                  (`inventario-telas.mover`) → alta en borrador.
 *  • `GET    /inventarios/telas/entradas/:id`              (`inventario-telas.ver`)   → detalle con partidas.
 *  • `PUT    /inventarios/telas/entradas/:id`              (`inventario-telas.mover`) → editar el borrador.
 *  • `POST   /inventarios/telas/entradas/:id/confirmar`    (`inventario-telas.mover`) → partidas + kardex.
 *  • `POST   /inventarios/telas/entradas/:id/cancelar`     (`inventario-telas.mover`) → inverso auditado.
 *  • `POST   /inventarios/telas/entradas/:id/adjuntos`     (`inventario-telas.mover`) → URL PUT prefirmada.
 *  • `GET    /inventarios/telas/entradas/:id/adjuntos`     (`inventario-telas.ver`)   → lista con URL GET.
 *  • `DELETE /inventarios/telas/entradas/:id/adjuntos/:idArchivo` (`inventario-telas.mover`).
 *
 * NINGÚN endpoint edita/borra existencias (D3): la corrección es la cancelación por inverso.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaEntradaTelaCrear,
  esquemaEntradaTelaActualizar,
  esquemaEntradaTelaCancelarCuerpo,
  esquemaEntradaTelaSalida,
  esquemaEntradasTelaQuery,
  esquemaEntradasTelaPagina,
  esquemaParamIdEntradaTela,
  esquemaEntradaTelaAdjuntoCrear,
  esquemaEntradaTelaAdjuntoSubida,
  esquemaEntradaTelaAdjuntosLista,
  esquemaLeerCfdiEntradaTela,
  esquemaPropuestaCfdiEntradaTela,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { esquemaEntradaTelaAdjuntoSalida } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarEntradaTela,
  cancelarEntradaTela,
  confirmarEntradaTela,
  crearEntradaTela,
  listarEntradasTela,
  obtenerEntradaTela,
} from '../../dominio/inventarios/entradas-tela.js';
import { leerCfdiParaEntradaTela } from '../../dominio/inventarios/cfdi-entrada-tela.js';
import {
  eliminarAdjuntoEntradaTela,
  listarAdjuntosEntradaTela,
  solicitarSubidaAdjuntoEntradaTela,
  type AdjuntoEntradaTelaConUrl,
} from '../../dominio/inventarios/adjuntos-entrada-tela.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Parámetros `:id` + `:idArchivo` para borrar un adjunto. */
const esquemaParamAdjuntoEntradaTela = esquemaParamIdEntradaTela.extend({
  idArchivo: z.string({ error: 'El id del archivo es obligatorio' }).describe('Id del adjunto.'),
});

/** Proyecta un adjunto (con URL) a su forma JSON (Date → ISO 8601). */
function aAdjuntoSalida(
  adjunto: AdjuntoEntradaTelaConUrl,
): z.infer<typeof esquemaEntradaTelaAdjuntoSalida> {
  return {
    idArchivo: adjunto.idArchivo,
    nombreOriginal: adjunto.nombreOriginal,
    tipoMime: adjunto.tipoMime,
    tamanoBytes: adjunto.tamanoBytes,
    urlDescarga: adjunto.urlDescarga,
    subidoPorId: adjunto.subidoPorId,
    creadoEn: adjunto.creadoEn.toISOString(),
  };
}

/** Registra las rutas de entradas de tela por factura/remisión (montadas bajo `/api`). */
export const rutasEntradasTela: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listado paginado ─────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/entradas',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Listar las entradas de tela por factura/remisión (sin orden de compra)',
      security: SEGURIDAD_SESION,
      querystring: esquemaEntradasTelaQuery,
      response: { 200: esquemaEntradasTelaPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarEntradasTela(sesion, request.query);
    },
  });

  // ── Alta (nace en borrador: NO toca el inventario) ───────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/entradas',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Capturar una entrada de tela por factura/remisión (queda en borrador)',
      security: SEGURIDAD_SESION,
      body: esquemaEntradaTelaCrear,
      response: { 201: esquemaEntradaTelaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const entrada = await crearEntradaTela(sesion, request.body);
      return reply.code(201).send(entrada);
    },
  });

  // ── Leer la FACTURA (XML del CFDI) para llenar la captura (§Post-F9.20) ──────
  // Solo LEE: devuelve una propuesta (proveedor por RFC + conceptos con su renglón de OC sugerido).
  // Va con `inventario-telas.mover` —quien captura la entrada—, NO con `cxp.administrar`: leer la
  // factura para recibir mercancía es parte de recibir. El PDF se sigue subiendo como adjunto.
  app.route({
    method: 'POST',
    url: '/inventarios/telas/entradas/leer-cfdi',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Leer el XML de la factura y proponer los renglones de la entrada',
      security: SEGURIDAD_SESION,
      body: esquemaLeerCfdiEntradaTela,
      response: { 200: esquemaPropuestaCfdiEntradaTela, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return leerCfdiParaEntradaTela(sesion, {
        xml: request.body.xml,
        ...(request.body.idOrdenCompra === undefined
          ? {}
          : { idOrdenCompra: request.body.idOrdenCompra }),
      });
    },
  });

  // ── Detalle ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/entradas/:id',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Obtener una entrada de tela con sus partidas',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdEntradaTela,
      response: { 200: esquemaEntradaTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerEntradaTela(sesion, request.params.id);
    },
  });

  // ── Editar el borrador (una confirmada es inmutable, D3) ─────────────────────
  app.route({
    method: 'PUT',
    url: '/inventarios/telas/entradas/:id',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Editar una entrada de tela en borrador (reemplaza cabecera y renglones)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdEntradaTela,
      body: esquemaEntradaTelaActualizar,
      response: { 200: esquemaEntradaTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarEntradaTela(sesion, request.params.id, request.body);
    },
  });

  // ── Confirmar: crea las partidas y da la entrada al kardex ───────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/entradas/:id/confirmar',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Confirmar la entrada de tela (crea las partidas y da la entrada al inventario)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdEntradaTela,
      response: { 200: esquemaEntradaTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return confirmarEntradaTela(sesion, request.params.id);
    },
  });

  // ── Cancelar (inverso auditado si ya estaba confirmada, D3) ──────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/entradas/:id/cancelar',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Cancelar una entrada de tela (si estaba confirmada genera el movimiento inverso; no edita ni borra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdEntradaTela,
      body: esquemaEntradaTelaCancelarCuerpo,
      response: { 200: esquemaEntradaTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarEntradaTela(sesion, request.params.id, request.body);
    },
  });

  // ── Adjuntos: el PDF de la factura/remisión (flujo presigned R2) ─────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/entradas/:id/adjuntos',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Preparar la subida de un adjunto de la entrada (el PDF de la factura)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdEntradaTela,
      body: esquemaEntradaTelaAdjuntoCrear,
      response: { 201: esquemaEntradaTelaAdjuntoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await solicitarSubidaAdjuntoEntradaTela(
        sesion,
        request.params.id,
        request.body,
      );
      return reply.code(201).send(subida);
    },
  });

  app.route({
    method: 'GET',
    url: '/inventarios/telas/entradas/:id/adjuntos',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Listar los adjuntos de una entrada de tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdEntradaTela,
      response: { 200: esquemaEntradaTelaAdjuntosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const adjuntos = await listarAdjuntosEntradaTela(sesion, request.params.id);
      return { datos: adjuntos.map(aAdjuntoSalida) };
    },
  });

  app.route({
    method: 'DELETE',
    url: '/inventarios/telas/entradas/:id/adjuntos/:idArchivo',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Quitar un adjunto de la entrada de tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamAdjuntoEntradaTela,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarAdjuntoEntradaTela(sesion, request.params.id, request.params.idArchivo);
      return reply.code(204).send(null);
    },
  });

  done();
};
