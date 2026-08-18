/**
 * Rutas REST del sub-recurso MEDIDAS POR TALLA de un avío del BOM (F8-E1, R18). Plugin NUEVO e
 * independiente que calca el ESTÁNDAR de las rutas del BOM (`modelos.rutas.ts`): cada handler solo
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)`: `modelos.ver` para leer, `modelos.
 *     administrar` para mutar.
 *  3. **Delega** al servicio de dominio (`dominio/modelos/medidas-avio-talla.ts`).
 *
 * Es un sub-recurso del renglón avío del BOM: `/modelos/:idModelo/avios/:idAvio/medidas` con GET
 * (leer el toggle + las medidas) y PUT (reemplazar el SET completo en una transacción A2). CERO
 * lógica de negocio o acceso a datos aquí; los errores de dominio los traduce el error handler
 * global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasMedidasAvioTalla, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/esquemas/error.js';
import {
  esquemaMedidasAvioGuardar,
  esquemaModeloAvioMedidasSalida,
} from '../../contrato/esquemas/modelo-avio-talla.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  guardarMedidasAvio,
  obtenerMedidasAvio,
  type MedidasAvio,
} from '../../dominio/modelos/medidas-avio-talla.js';

/** Proyecta las medidas por talla de un avío a la forma JSON del contrato. */
function aMedidasSalida(m: MedidasAvio): z.infer<typeof esquemaModeloAvioMedidasSalida> {
  return {
    idModelo: m.idModelo,
    idAvio: m.idAvio,
    consumoPorTalla: m.consumoPorTalla,
    tieneCurva: m.tieneCurva,
    modoCaptura: m.modoCaptura,
    unidadConsumo: m.unidadConsumo,
    unidadMedida: m.unidadMedida,
    avisos: m.avisos,
    tallas: m.tallas.map((t) => ({
      idTalla: t.idTalla,
      etiquetaTalla: t.etiquetaTalla,
      consumo: t.consumo,
      enCurva: t.enCurva,
      idAvioMedida: t.idAvioMedida,
      medidaAmarrada: t.medidaAmarrada,
      precioMedida: t.precioMedida,
    })),
  };
}

/** Parámetros de ruta `:idModelo` + `:idAvio` (enteros positivos). */
const esquemaParamMedidas = z.object({
  idModelo: z.coerce
    .number({ error: 'El id del modelo debe ser un número' })
    .int({ error: 'El id del modelo debe ser entero' })
    .positive({ error: 'El id del modelo debe ser positivo' })
    .describe('Id del modelo.'),
  idAvio: z.coerce
    .number({ error: 'El id del avío debe ser un número' })
    .int({ error: 'El id del avío debe ser entero' })
    .positive({ error: 'El id del avío debe ser positivo' })
    .describe('Id del avío (renglón del BOM).'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de medidas por talla del avío (montadas bajo `/api`). */
export const rutasMedidasAvioTalla: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Leer las medidas por talla de un avío del BOM ───────────────────────────
  app.route({
    method: 'GET',
    url: '/modelos/:idModelo/avios/:idAvio/medidas',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Obtener las medidas por talla de un avío del BOM',
      security: SEGURIDAD_SESION,
      params: esquemaParamMedidas,
      response: { 200: esquemaModeloAvioMedidasSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const medidas = await obtenerMedidasAvio(
        sesion,
        request.params.idModelo,
        request.params.idAvio,
      );
      return aMedidasSalida(medidas);
    },
  });

  // ── Reemplazar (set-completo) las medidas por talla de un avío del BOM ───────
  app.route({
    method: 'PUT',
    url: '/modelos/:idModelo/avios/:idAvio/medidas',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Reemplazar las medidas por talla de un avío del BOM',
      security: SEGURIDAD_SESION,
      params: esquemaParamMedidas,
      body: esquemaMedidasAvioGuardar,
      response: { 200: esquemaModeloAvioMedidasSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const medidas = await guardarMedidasAvio(
        sesion,
        request.params.idModelo,
        request.params.idAvio,
        request.body,
      );
      return aMedidasSalida(medidas);
    },
  });

  done();
};
