/**
 * Rutas REST de Tipos de movimiento de inventario (F3-E1). SOLO LECTURA: un GET que lista los 19
 * tipos sembrados con su dirección, para que las pantallas de movimientos de E3 los ofrezcan.
 * Handler delgado (A1): autoriza (`inventario-pt.ver`, A4) y delega al dominio
 * `dominio/inventarios/tipos-movimiento`.
 */
import type { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { ClavePermiso, esquemaTipoMovimientoSalida } from '../../contrato/index.js';
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
  // AJUSTE de telas/avíos, sin acoplar esas pantallas al permiso de PT. Guard inline "alguno de"
  // (deny-by-default: si no trae ninguno → 403); el `conPermiso` decorado solo cubre un permiso único.
  const PERMISOS_VER_INVENTARIO: ClavePermiso[] = [
    'inventario-pt.ver',
    'inventario-telas.ver',
    'inventario-avios.ver',
  ];

  app.route({
    method: 'GET',
    url: '/tipos-movimiento',
    preHandler: async (request, reply) => {
      const sesion = await request.obtenerSesion();
      if (sesion === null) {
        return reply
          .code(401)
          .send({ codigo: 'NO_AUTENTICADO', mensaje: 'Necesitas iniciar sesión.' });
      }
      if (!PERMISOS_VER_INVENTARIO.some((p) => sesion.permisos.has(p))) {
        return reply
          .code(403)
          .send({ codigo: 'PERMISO', mensaje: 'No tienes permiso para realizar esta operación.' });
      }
      return undefined;
    },
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
