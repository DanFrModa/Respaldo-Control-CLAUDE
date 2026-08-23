/**
 * Rutas REST de Tipos de movimiento de inventario (F3-E1). SOLO LECTURA: un GET que lista los 19
 * tipos sembrados con su dirección, para que las pantallas de movimientos de E3 los ofrezcan.
 * Handler delgado (A1): autoriza (`inventario-pt.ver`, A4) y delega al dominio
 * `dominio/inventarios/tipos-movimiento`.
 */
import type { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { esquemaTipoMovimientoSalida } from '../../contrato/index.js';
import {
  esquemaErrorApi,
  esquemaTiposMovimientoLista,
  esquemaTiposMovimientoQuery,
} from '../../contrato/index.js';
import type { TipoMovimientoInventario } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { listarTiposMovimiento } from '../../dominio/inventarios/tipos-movimiento.js';

/** Proyecta el modelo Prisma a la forma JSON del contrato. */
function aTipoMovimientoSalida(
  tipo: TipoMovimientoInventario,
): z.infer<typeof esquemaTipoMovimientoSalida> {
  return {
    id: tipo.id,
    codigo: tipo.codigo,
    nombre: tipo.nombre,
    direccion: tipo.direccion,
    activo: tipo.activo,
  };
}

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
} as const;

/** Registra las rutas de tipos de movimiento (montadas bajo `/api`). */
export const rutasTiposMovimiento: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Catálogo read-only COMPARTIDO por todos los inventarios por kardex (PT, telas, avíos): cualquier
  // usuario con un `*.ver` de inventario puede leerlo. F4-E1 lo necesita para el selector de tipo del
  // AJUSTE de telas/avíos, sin acoplar esas pantallas al permiso de PT. `conAlgunPermiso` = guard
  // "alguno de" del RBAC (deny-by-default: sin ninguno → 403; sin sesión → 401).
  app.route({
    method: 'GET',
    url: '/tipos-movimiento',
    preHandler: app.conAlgunPermiso(
      'inventario-pt.ver',
      'inventario-telas.ver',
      'inventario-avios.ver',
    ),
    schema: {
      tags: ['inventario-pt'],
      summary: 'Listar tipos de movimiento de inventario (solo lectura)',
      security: SEGURIDAD_SESION,
      querystring: esquemaTiposMovimientoQuery,
      response: { 200: esquemaTiposMovimientoLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarTiposMovimiento(sesion, request.query);
      return { datos: datos.map(aTipoMovimientoSalida) };
    },
  });

  done();
};
