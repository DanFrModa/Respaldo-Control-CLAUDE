/**
 * Rutas REST del MOTOR de la RUTA VIVA por orden (Módulo 8, F5-E3; doc `08-Ruta-Critica.md`
 * §2.3/§4; captura del cumplimiento + semáforo en F5-E4). Handlers delgados (A1): validan (Zod
 * compartido), autorizan (`conPermiso`, A4) y delegan al dominio. RBAC por ruta: GET → `rc.ruta-ver`;
 * programar/ajustar → `rc.programar`; capturar cumplimiento/checklist → `rc.capturar`.
 *
 * La PROGRAMACIÓN responde de INMEDIATO con la ruta generada y el estado del recálculo
 * ('recalculando' mientras el CPM aún no ha fechado los procesos): la captura NUNCA espera al CPM
 * (§11) — el job de cálculo de fechas (E4) corre en segundo plano (pg-boss).
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
  esquemaSecuenciaEstampadoCuerpo,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { elegirSecuenciaEstampado } from '../../dominio/ruta-critica/estampado.js';
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
import { impresoPlanRc } from '../../dominio/ruta-critica/impresos/impreso-plan-rc.js';

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
    secuenciaEstampadoModelo: r.secuenciaEstampadoModelo,
    secEstampadoElegido: r.secEstampadoElegido,
    secuenciaEstampadoEfectiva: r.secuenciaEstampadoEfectiva,
    motivoSinRuta: r.motivoSinRuta,
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
      tipoEvento: p.tipoEvento,
      rolesResponsables: p.rolesResponsables,
      esResponsableActual: p.esResponsableActual,
      duracionDias: p.duracionDias,
      acumuladoDias: p.acumuladoDias,
      fechaPlaneadaOriginal: iso(p.fechaPlaneadaOriginal),
      fechaPlaneadaVigente: iso(p.fechaPlaneadaVigente),
      fechaReal: iso(p.fechaReal),
      diasRestantes: p.diasRestantes,
      estado: p.estado,
      capturadoPorId: p.capturadoPorId,
      capturadoPorNombre: p.capturadoPorNombre,
      capturadoEn: iso(p.capturadoEn),
      origenCaptura: p.origenCaptura,
      parcialEnCurso: p.parcialEnCurso,
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

  // ── RE-programar la RC de una orden (rediseño R3, B5: la generación INICIAL es AUTOMÁTICA al
  //    nacer la OP — evento outbox `orden-creada` → `rcAutomatica.ts`; este endpoint queda como la
  //    vía MANUAL para corregir artículo/tela/aplicación/fechas o re-generar) ───────────────────
  app.route({
    method: 'POST',
    url: '/ruta-critica/ordenes/:id/programar',
    preHandler: app.conPermiso('rc.programar'),
    schema: {
      tags: ['ruta-critica'],
      summary:
        'Re-programar la Ruta Crítica de una orden (la generación inicial es automática al crear la OP)',
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

  // ── Elegir la secuencia de estampado de una orden FLEXIBLE (R4, B10) ──────────
  // Reprograma la ruta viva EN EL MOMENTO: agrega/quita la dependencia condicional "recibo de
  // estampado → envío a costura", guarda la elección y re-encola el CPM. 409 si el modelo no es
  // flexible o el estampado ya se completó.
  app.route({
    method: 'POST',
    url: '/ruta-critica/ordenes/:id/secuencia-estampado',
    preHandler: app.conPermiso('rc.programar'),
    schema: {
      tags: ['ruta-critica'],
      summary:
        'Elegir si el estampado va ANTES o DESPUÉS de coser (órdenes flexibles; reprograma en vivo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrdenRc,
      body: esquemaSecuenciaEstampadoCuerpo,
      response: { 200: esquemaRutaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const ruta = await elegirSecuenciaEstampado(sesion, {
        idOrden: request.params.id,
        secuencia: request.body.secuencia,
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

  // ── Plan de la RC por orden (impreso PDF, F5-E5, R9) ─────────────────────────
  // Binario `application/pdf` (no entra al cliente tipado: solo se documentan los errores). Mismo
  // patrón que los demás impresos (entrega/recibo/OC). 400 si la orden no tiene RC generada.
  app.route({
    method: 'GET',
    url: '/ruta-critica/ordenes/:id/plan-impreso',
    preHandler: app.conPermiso('rc.ruta-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary:
        'Plan de la Ruta Crítica de una orden (PDF): procesos, fechas, duración, responsables',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrdenRc,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folioOrden } = await impresoPlanRc(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="plan-rc-orden-${folioOrden}.pdf"`);
      return reply.send(buffer as unknown as never);
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
