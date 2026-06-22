/**
 * Rutas REST del MOTOR de la RUTA VIVA por orden (Módulo 8, F5-E3; doc `08-Ruta-Critica.md`
 * §2.3/§4). Handlers delgados (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y
 * delegan al dominio. RBAC por ruta: GET → `rc.ruta-ver`; mutaciones → `rc.programar`.
 *
 * La PROGRAMACIÓN responde de INMEDIATO con la ruta generada y el estado del recálculo
 * ('pendiente-de-calculo'): la captura NUNCA espera al CPM (§11) — el job de cálculo de fechas (E4)
 * corre en segundo plano (pg-boss).
 */
import type { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAjustarRuta,
  esquemaCapturarProceso,
  esquemaErrorApi,
  esquemaMarcarChecklist,
  esquemaParamChecklistItem,
  esquemaParamOrdenRc,
  esquemaParamRutaProceso,
  esquemaProgramarRc,
  esquemaRutaOrdenSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  ajustarRutaOrden,
  generarRutaOrden,
  obtenerRutaOrden,
  type RutaOrdenDto,
} from '../../dominio/ruta-critica/rutaOrden.js';
import {
  completarProceso,
  marcarChecklistItem,
  revertirProceso,
} from '../../dominio/ruta-critica/cumplimiento.js';

/** Proyecta el DTO de dominio (fechas Date) al JSON del contrato (fechas ISO). */
function aRutaSalida(r: RutaOrdenDto): z.infer<typeof esquemaRutaOrdenSalida> {
  const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
  return {
    idOrden: r.idOrden,
    rcActiva: r.rcActiva,
    fechaInicioRC: iso(r.fechaInicioRC),
    fechaEntregaRC: iso(r.fechaEntregaRC),
    fechaProgramada: iso(r.fechaProgramada),
    esResurtido: r.esResurtido,
    idArticuloRC: r.idArticuloRC,
    idTipoTela: r.idTipoTela,
    idAplicacion: r.idAplicacion,
    estadoRecalculo: r.estadoRecalculo,
    semaforo: r.semaforo,
    procesos: r.procesos.map((p) => ({
      id: p.id,
      idProcesoDef: p.idProcesoDef,
      codigoProceso: p.codigoProceso,
      nombreProceso: p.nombreProceso,
      secuencia: p.secuencia,
      critico: p.critico,
      ultimoProceso: p.ultimoProceso,
      esResurtido: p.esResurtido,
      condicionAplicabilidad: p.condicionAplicabilidad,
      duracionDias: p.duracionDias,
      acumuladoDias: p.acumuladoDias,
      fechaPlaneadaOriginal: iso(p.fechaPlaneadaOriginal),
      fechaPlaneadaVigente: iso(p.fechaPlaneadaVigente),
      fechaReal: iso(p.fechaReal),
      estado: p.estado,
      capturadoPorId: p.capturadoPorId,
      capturadoEn: iso(p.capturadoEn),
      origenCaptura: p.origenCaptura,
      semaforo: p.semaforo,
      idsAntecesores: p.idsAntecesores,
      checklist: p.checklist,
    })),
    advertencias: r.advertencias,
  };
}

/** Convierte `YYYY-MM-DD` a un `Date` a medianoche UTC (sin corrimientos de zona). */
function fechaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del motor de la RC por orden (montadas bajo `/api`). */
export const rutasProgramacionRc: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Programar (generar / re-generar) la RC de una orden ──────────────────────
  app.route({
    method: 'POST',
    url: '/ruta-critica/ordenes/:id/programar',
    preHandler: app.conPermiso('rc.programar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Programar (generar/re-generar) la Ruta Crítica de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrdenRc,
      body: esquemaProgramarRc,
      response: { 200: esquemaRutaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cuerpo = request.body;
      const ruta = await generarRutaOrden(sesion, {
        idOrden: request.params.id,
        idArticuloRC: cuerpo.idArticuloRC,
        fechaEntregaRC: fechaUtc(cuerpo.fechaEntregaRC),
        idTipoTela: cuerpo.idTipoTela,
        idAplicacion: cuerpo.idAplicacion,
        esResurtido: cuerpo.esResurtido,
        ...(cuerpo.fechaInicioRC === undefined
          ? {}
          : { fechaInicioRC: fechaUtc(cuerpo.fechaInicioRC) }),
      });
      return aRutaSalida(ruta);
    },
  });

  // ── Ajustar la ruta de una orden (sin tocar la plantilla, D10) ───────────────
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/ordenes/:id/ruta',
    preHandler: app.conPermiso('rc.programar'),
    schema: {
      tags: ['ruta-critica'],
      summary:
        'Ajustar la Ruta Crítica de una orden (agregar/quitar procesos, editar dependencias)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrdenRc,
      body: esquemaAjustarRuta,
      response: { 200: esquemaRutaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cuerpo = request.body;
      const ruta = await ajustarRutaOrden(sesion, {
        idOrden: request.params.id,
        ...(cuerpo.agregar === undefined ? {} : { agregar: cuerpo.agregar }),
        ...(cuerpo.quitar === undefined ? {} : { quitar: cuerpo.quitar }),
        ...(cuerpo.dependencias === undefined ? {} : { dependencias: cuerpo.dependencias }),
      });
      return aRutaSalida(ruta);
    },
  });

  // ── Consultar la ruta viva de una orden ──────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/ordenes/:id/ruta',
    preHandler: app.conPermiso('rc.ruta-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Obtener la Ruta Crítica viva de una orden (procesos, duraciones, dependencias)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrdenRc,
      response: { 200: esquemaRutaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aRutaSalida(await obtenerRutaOrden(sesion, request.params.id));
    },
  });

  // ── Capturar / revertir el cumplimiento de un proceso (F5-E4) ────────────────
  app.route({
    method: 'PUT',
    url: '/ruta-critica/procesos/:idRuta/cumplimiento',
    preHandler: app.conPermiso('rc.capturar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Capturar o revertir el cumplimiento de un proceso de la Ruta Crítica de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamRutaProceso,
      body: esquemaCapturarProceso,
      response: { 200: esquemaRutaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cuerpo = request.body;
      const idOrden = cuerpo.cumplido
        ? await completarProceso(
            sesion,
            request.params.idRuta,
            cuerpo.fechaReal === undefined ? undefined : fechaUtc(cuerpo.fechaReal),
          )
        : await revertirProceso(sesion, request.params.idRuta);
      return aRutaSalida(await obtenerRutaOrden(sesion, idOrden));
    },
  });

  // ── Marcar / desmarcar un ítem de checklist (F5-E4) ──────────────────────────
  app.route({
    method: 'PUT',
    url: '/ruta-critica/checklist/:idItem',
    preHandler: app.conPermiso('rc.capturar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Marcar o desmarcar un ítem de checklist de un proceso de la Ruta Crítica',
      security: SEGURIDAD_SESION,
      params: esquemaParamChecklistItem,
      body: esquemaMarcarChecklist,
      response: { 200: esquemaRutaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const idOrden = await marcarChecklistItem(sesion, request.params.idItem, request.body.hecho);
      return aRutaSalida(await obtenerRutaOrden(sesion, idOrden));
    },
  });

  done();
};
