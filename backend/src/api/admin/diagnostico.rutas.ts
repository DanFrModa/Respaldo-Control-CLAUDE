/**
 * Rutas del DIAGNÓSTICO DE INFRAESTRUCTURA (transversal): almacenamiento de archivos y respaldo.
 * Ruta delgada (A1): autoriza server-side y delega en `dominio/admin/diagnostico`.
 *
 * `GET /api/admin/diagnostico` reutiliza a propósito el permiso `admin.ver-bitacora` en vez de
 * estrenar uno: es exactamente la misma clase de acceso (mirar las entrañas del sistema, sin tocar
 * nada) y, sobre todo, un permiso NUEVO sólo existe en la base después de correr el seed — o sea,
 * el diagnóstico no serviría justo en el ambiente al que aún le falta configuración, que es cuando
 * hace falta. La corrida manual del respaldo SÍ estrena permiso (`admin.respaldo-ejecutar`): eso ya
 * es una acción, no una consulta, y pesa (vuelca la base entera).
 *
 * El ORIGEN contra el que se prueba CORS sale de la petición misma (cabecera `Origin`, o el host
 * público que reenvía nginx), no de una constante: así el diagnóstico prueba el dominio desde el que
 * la persona está entrando AHORA — que es el que le está fallando— aunque el dominio de Railway haya
 * cambiado y nadie haya actualizado la documentación.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';

import {
  esquemaDiagnostico,
  esquemaErrorApi,
  esquemaRespaldoEncolado,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { diagnosticarSistema, pedirRespaldoAhora } from '../../dominio/admin/diagnostico.js';

const respuestasError = {
  401: esquemaErrorApi,
  403: esquemaErrorApi,
} as const;

/**
 * Orígenes del frontend a validar, en orden de confianza. El primero es el que se prueba con el
 * preflight. `BETTER_AUTH_URL` va SIEMPRE al final como red de seguridad: es el dominio público que
 * el ambiente declara, y sirve cuando la petición llega sin `Origin` ni host reenviado.
 */
function origenesDeLaPeticion(peticion: FastifyRequest): string[] {
  const origenes: string[] = [];
  const cabecera = peticion.headers.origin;
  if (typeof cabecera === 'string' && cabecera.trim() !== '') {
    origenes.push(cabecera.trim());
  }
  const reenviado = peticion.headers['x-forwarded-host'] ?? peticion.headers.host;
  if (typeof reenviado === 'string' && reenviado.trim() !== '') {
    const protocolo = peticion.headers['x-forwarded-proto'] ?? 'https';
    origenes.push(`${typeof protocolo === 'string' ? protocolo : 'https'}://${reenviado.trim()}`);
  }
  const declarado = process.env.BETTER_AUTH_URL;
  if (declarado !== undefined && declarado.trim() !== '') {
    origenes.push(declarado.trim().replace(/\/+$/, ''));
  }
  return [...new Set(origenes)].filter((o) => /^https?:\/\//.test(o));
}

export const rutasDiagnostico: FastifyPluginCallbackZod = (app, _opciones, done) => {
  app.route({
    method: 'GET',
    url: '/admin/diagnostico',
    preHandler: app.conPermiso('admin.ver-bitacora'),
    schema: {
      tags: ['admin'],
      summary: 'Diagnosticar el almacenamiento de archivos (R2) y el respaldo mensual',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaDiagnostico, ...respuestasError },
    },
    handler: async (peticion) => diagnosticarSistema(origenesDeLaPeticion(peticion)),
  });

  app.route({
    method: 'POST',
    url: '/admin/diagnostico/respaldo',
    preHandler: app.conPermiso('admin.respaldo-ejecutar'),
    schema: {
      tags: ['admin'],
      summary: 'Pedir una corrida del respaldo ahora mismo (sin esperar al cron)',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaRespaldoEncolado, ...respuestasError },
    },
    handler: async (peticion) => {
      const sesion = (await peticion.obtenerSesion()) as SesionUsuario | null;
      if (sesion === null) {
        throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
      }
      return pedirRespaldoAhora(sesion);
    },
  });

  done();
};
