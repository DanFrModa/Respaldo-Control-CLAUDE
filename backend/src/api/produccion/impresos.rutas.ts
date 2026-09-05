/**
 * Rutas REST del IMPRESO de la orden de producción (F2-E4, R9). La hoja (PDF) de PISO DE
 * PRODUCCIÓN que se le da al maquilero/corte para producir una orden. Calca el ESTÁNDAR de
 * `ordenes.rutas.ts`: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod compartidos de `src/contrato` (params/cuerpo).
 *  2. **Autoriza** server-side con `app.conPermiso('ordenes.ver')` (deny-by-default, §9.2).
 *  3. **Delega** al dominio (`dominio/produccion/impresos/impreso-orden.ts`), que arma el Buffer PDF.
 *
 * Endpoints (ambos `ordenes.ver`, ambos por la empresa activa de la sesión = A9; si una orden no es
 * de la empresa activa → 404):
 *  • `GET  /ordenes/:id/impreso` → `application/pdf` (Buffer). `Content-Disposition: inline;
 *    filename="orden-<folio>.pdf"`.
 *  • `POST /ordenes/impresos`    → cuerpo `{ ids: number[] }` (1..100), una orden por página.
 *    ⭐ 0.140 (2ª ronda): la respuesta es UN PDF cuando el lote cabe en un archivo
 *    (`filename="ordenes.pdf"`) y un **ZIP con varios PDF** cuando no (`filename="ordenes.zip"`).
 *    El cuerpo de la petición NO cambia y la 200 sigue sin declararse (Fastify manda el binario
 *    tal cual), pero **el contrato publicado SÍ cambió**: `summary`, `description` y los dos
 *    `.describe()` del cuerpo se reescribieron, y con ellos los dos `openapi.json` y el cliente
 *    generado del frontend. Quien descarga distingue por `Content-Type`, como en cualquier
 *    descarga. El porqué del corte está en `dominio/.../impreso-orden.ts`; el resumen es que un
 *    solo PDF con cien órdenes obligaba a dejar hojas sin imágenes, y partirlo no.
 *
 * La respuesta es BINARIA (no JSON): no se declara `response` 200 en el esquema (Fastify envía el
 * Buffer tal cual). Los errores de dominio los traduce el error handler global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin lo registra la Pieza B en `app.ts`
 * (`await app.register(rutasImpresosOrden, { prefix: '/api' })`); aquí NO se registra ni se regenera
 * el OpenAPI.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi, esquemaOrdenesImpresoCuerpo } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  impresoOrden,
  impresoOrdenesPorPartes,
} from '../../dominio/produccion/impresos/impreso-orden.js';
import { empaquetarZipAlVuelo, type ArchivoZip } from '../../comun/zip-al-vuelo.js';

/** Buffer vacío con el que se sueltan las partes ya entregadas (para que el GC se las lleve). */
const VACIO = Buffer.alloc(0);

/** Parámetro de ruta `:id` (orden). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del impreso de órdenes (montadas bajo `/api`). */
export const rutasImpresosOrden: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Impreso de UNA orden (PDF, una página).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/impreso',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Imprimir una orden de producción (PDF de piso de producción)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      // La respuesta 200 es binaria (application/pdf); solo se documentan los errores.
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoOrden(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="orden-${folio}.pdf"`);
      // La respuesta es binaria (no JSON): Fastify envía el Buffer tal cual. El tipo del `send` lo
      // infiere el type-provider de las respuestas DECLARADAS (solo errores), por eso el cast.
      return reply.send(buffer as unknown as never);
    },
  });

  // Impreso por LOTE: una orden por página. UN PDF si el lote cabe en un archivo; si no, un ZIP
  // con varios PDF (0.140), porque partirlo es lo que evita que una hoja salga sin sus imágenes.
  app.route({
    method: 'POST',
    url: '/ordenes/impresos',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary:
        'Imprimir varias órdenes (una por página): un PDF, o un ZIP con varios PDF si el lote no cabe en uno',
      description:
        'Responde `application/pdf` cuando el lote entra en un solo archivo y `application/zip` con ' +
        'varios PDF cuando no (el servidor lo parte para que ninguna hoja salga sin sus imágenes). ' +
        'Distínguelo por el `Content-Type`: el `Content-Disposition` trae el nombre con su extensión.',
      security: SEGURIDAD_SESION,
      body: esquemaOrdenesImpresoCuerpo,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const partes = impresoOrdenesPorPartes(sesion, request.body.ids);

      // Se pide la PRIMERA parte para saber si el lote cupo en un archivo: con eso ya se decide la
      // cabecera. Si hay más, las siguientes se piden mientras el ZIP se escribe, nunca todas de
      // golpe. ⚠️ Cuántos PDF hay vivos a la vez —que NO es uno— está contado en `zip-al-vuelo.ts`.
      const primera = await partes.next();
      if (primera.done === true) {
        // No puede pasar (el cuerpo exige 1..100 ids), pero un 500 mudo sería peor que decirlo.
        throw new Error('La impresión por lote no produjo ningún PDF.');
      }
      // Se fijan aquí, ya estrechados: dentro del generador de abajo TypeScript pierde el
      // estrechamiento de `done` (es otro ámbito) y `value` volvería a ser `Buffer | void`.
      let primeraParte: Buffer = primera.value;
      const segunda = await partes.next();
      if (segunda.done === true) {
        reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', 'inline; filename="ordenes.pdf"');
        return reply.send(primeraParte as unknown as never);
      }
      let segundaParte: Buffer = segunda.value;

      /**
       * ⚠️ 0.140 (4ª ronda) — **LAS DOS PARTES QUE YA SE MIRARON NO PUEDEN QUEDARSE EN UNA VARIABLE
       * DE ESTE MARCO.** Un generador conserva sus locales entre `yield` y `yield`, así que
       * guardarlas en un `const` de aquí dentro —como hizo una ronda anterior— las sujeta hasta que
       * el ZIP termina: medido con `WeakRef` + `gc()`, seguían vivas al llegar a la 5ª parte, **4
       * PDF a la vez en vez de 2**, y son ~100 MB cada una. Por eso viajan en un array del que se
       * las **saca** (`shift`) y se entregan sin nombrarlas: desde aquí lo único que las sujeta es
       * la variable del `for await` de abajo, que muere con su iteración —aparte va la que el
       * empaquetador tiene en la mano, que es la otra mitad de esos 2—. Vaciar sólo las variables
       * de FUERA no bastaba: el marco de este generador seguía sujetando las suyas.
       */
      async function* todasLasPartes(): AsyncGenerator<Buffer, void, undefined> {
        const yaMiradas = [primeraParte, segundaParte];
        primeraParte = VACIO;
        segundaParte = VACIO;
        while (yaMiradas.length > 0) {
          yield yaMiradas.shift() as Buffer;
        }
        yield* partes;
      }

      async function* archivos(): AsyncGenerator<ArchivoZip, void, undefined> {
        // Los nombres van numerados para que el orden del lote sobreviva al descomprimir, que es
        // como llegan a la mesa de corte.
        let numero = 0;
        for await (const parte of todasLasPartes()) {
          numero += 1;
          yield {
            nombre: `ordenes-parte-${String(numero).padStart(2, '0')}.pdf`,
            contenido: parte,
          };
        }
      }

      reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', 'attachment; filename="ordenes.zip"');
      return reply.send(empaquetarZipAlVuelo(archivos()) as unknown as never);
    },
  });

  done();
};
