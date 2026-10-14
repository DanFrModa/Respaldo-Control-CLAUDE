import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

/**
 * ⭐⭐ Fila 0.239 (§Post-F9.248(b)) — LAS PUERTAS HTTP de las mutaciones del cliente, partidas entre
 * `clientes.modificar` y `clientes.administrar`, probadas SIN base de datos.
 *
 * Daniel, sobre Aurora: *«Administración o yo damos de alta al cliente. Ella puede meter información
 * de compradores, departamentos, datos de cada comprador»*. Lo que fija este archivo es la decisión
 * del ARCHIVO DE RUTAS, ruta por ruta (las 13 mutaciones):
 *  • las 8 de lo que cuelga del cliente (3 de departamentos, 3 de campos, 2 de personas) se abren
 *    con `clientes.modificar` **o** con `clientes.administrar`;
 *  • las 3 del cliente mismo (alta, ficha —que también reactiva—, baja) y las 2 de la FUSIÓN de
 *    departamentos (que mueve o borra los factores de precio del dueño) siguen siendo sólo de
 *    `clientes.administrar`.
 *
 * El dominio re-exige lo mismo (`dominio/catalogos/acceso-clientes.test.ts`). Mismo molde que
 * `edr/ventas.rutas.test.ts` (fila 0.251): los plugins REALES sobre un Fastify pelado, el dominio
 * mockeado y los guards con la semántica de `auth/plugin.ts`. El dominio mockeado LANZA: lo que se
 * mide es si la petición llegó a él (la puerta abrió) o se quedó en un 403.
 */

/** Lo que lanza el dominio mockeado: la petición cruzó la puerta. */
class LlegoAlDominio extends Error {}

const llegar = () => vi.fn(() => Promise.reject(new LlegoAlDominio()));

const dominioClientes = {
  actualizarCampoCliente: llegar(),
  actualizarCliente: llegar(),
  agregarCampoCliente: llegar(),
  crearCliente: llegar(),
  desactivarCampoCliente: llegar(),
  desactivarCliente: llegar(),
  listarCamposCliente: llegar(),
  listarClientes: llegar(),
  obtenerCliente: llegar(),
};
const dominioContactos = {
  actualizarContactoCliente: llegar(),
  crearContactoCliente: llegar(),
  listarContactosCliente: llegar(),
};
const dominioDepartamentos = {
  actualizarDepartamentoCliente: llegar(),
  agregarDepartamentoCliente: llegar(),
  desactivarDepartamentoCliente: llegar(),
  fusionarDepartamentosCliente: llegar(),
  listarDepartamentosCliente: llegar(),
  previsualizarFusionDepartamentos: llegar(),
};

vi.mock('../../dominio/catalogos/clientes.js', () => dominioClientes);
vi.mock('../../dominio/catalogos/cliente-contactos.js', () => dominioContactos);
vi.mock('../../dominio/catalogos/cliente-departamentos.js', () => dominioDepartamentos);

const { rutasClientes } = await import('./clientes.rutas.js');
const { rutasClienteDepartamentos } = await import('./cliente-departamentos.rutas.js');

/** Las rutas que los plugins REGISTRAN de verdad, como `MÉTODO /url` (lo llena el hook `onRoute`). */
const rutasRegistradas: string[] = [];

async function appCon(sesion: SesionUsuario | null): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  rutasRegistradas.length = 0;
  app.addHook('onRoute', (ruta) => {
    const metodos = Array.isArray(ruta.method) ? ruta.method : [ruta.method];
    for (const metodo of metodos) {
      rutasRegistradas.push(`${metodo} ${ruta.url}`);
    }
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('obtenerSesion', () => Promise.resolve(sesion));
  const guard =
    (...claves: ClavePermiso[]) =>
    (
      _req: unknown,
      reply: { code: (n: number) => { send: (c: unknown) => unknown } },
    ): Promise<void> => {
      if (sesion === null) {
        reply.code(401).send({ codigo: 'NO_AUTENTICADO', mensaje: 'Necesitas iniciar sesión.' });
      } else if (!claves.some((c) => sesion.permisos.has(c))) {
        reply.code(403).send({ codigo: 'PERMISO', mensaje: 'No tienes permiso.' });
      }
      return Promise.resolve();
    };
  app.decorate('conPermiso', (clave: ClavePermiso) => guard(clave));
  app.decorate('conAlgunPermiso', (...claves: ClavePermiso[]) => guard(...claves));
  // El dominio mockeado lanza a propósito: se responde 418 para distinguir «llegó» de un 500 real.
  app.setErrorHandler((error, _req, reply) =>
    error instanceof LlegoAlDominio
      ? reply.code(418).send({ llego: true })
      : reply.code(500).send({ mensaje: error instanceof Error ? error.message : String(error) }),
  );
  await app.register(rutasClientes, { prefix: '/api' });
  await app.register(rutasClienteDepartamentos, { prefix: '/api' });
  await app.ready();
  return app;
}

function con(...permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ permisos: ['clientes.ver', ...permisos], idEmpresaActiva: 1 });
}

type Peticion = {
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: Record<string, unknown>;
};

/** 418 = cruzó la puerta y llegó al dominio; 403 = la puerta lo detuvo. */
async function codigo(sesion: SesionUsuario, peticion: Peticion): Promise<number> {
  const app = await appCon(sesion);
  try {
    const res = await app.inject(peticion);
    return res.statusCode;
  } finally {
    await app.close();
  }
}

/**
 * Lo que CUELGA del cliente: `clientes.modificar` o `clientes.administrar`. El nombre de cada caso es
 * la ruta TAL COMO SE REGISTRA (`MÉTODO /url` con sus `:parámetros`): así se compara por igualdad con
 * lo que los plugins registran de verdad.
 */
const DE_MODIFICAR: readonly (readonly [string, Peticion])[] = [
  [
    'POST /api/clientes/:idCliente/departamentos',
    { method: 'POST', url: '/api/clientes/1/departamentos', payload: { nombre: 'Dama' } },
  ],
  [
    'PATCH /api/clientes/:idCliente/departamentos/:id',
    { method: 'PATCH', url: '/api/clientes/1/departamentos/2', payload: { activo: true } },
  ],
  [
    'DELETE /api/clientes/:idCliente/departamentos/:id',
    { method: 'DELETE', url: '/api/clientes/1/departamentos/2' },
  ],
  [
    'POST /api/clientes/:id/campos',
    { method: 'POST', url: '/api/clientes/1/campos', payload: { etiqueta: 'Nº de OC' } },
  ],
  [
    'PATCH /api/clientes/:id/campos/:idCampo',
    { method: 'PATCH', url: '/api/clientes/1/campos/5', payload: { activo: true } },
  ],
  [
    'DELETE /api/clientes/:id/campos/:idCampo',
    { method: 'DELETE', url: '/api/clientes/1/campos/5' },
  ],
  [
    'POST /api/clientes/:id/contactos',
    { method: 'POST', url: '/api/clientes/1/contactos', payload: { nombre: 'Ana López' } },
  ],
  [
    'PATCH /api/clientes/:id/contactos/:idContacto',
    { method: 'PATCH', url: '/api/clientes/1/contactos/4', payload: { puesto: 'Compradora' } },
  ],
];

/**
 * Sólo `clientes.administrar`: el cliente MISMO (alta, ficha —que también reactiva—, baja) y la
 * FUSIÓN de departamentos con su previa, que mueve o borra los factores de precio del dueño
 * (§Post-F9.125; hallazgo del reviewer de la 0.239).
 */
const DE_ADMINISTRAR: readonly (readonly [string, Peticion])[] = [
  ['POST /api/clientes', { method: 'POST', url: '/api/clientes', payload: { nombre: 'Nuevo' } }],
  [
    'PATCH /api/clientes/:id',
    { method: 'PATCH', url: '/api/clientes/1', payload: { activo: true } },
  ],
  ['DELETE /api/clientes/:id', { method: 'DELETE', url: '/api/clientes/1' }],
  [
    'POST /api/clientes/:idCliente/departamentos/fusionar/previa',
    {
      method: 'POST',
      url: '/api/clientes/1/departamentos/fusionar/previa',
      payload: { idDestino: 2, origenes: [3] },
    },
  ],
  [
    'POST /api/clientes/:idCliente/departamentos/fusionar',
    {
      method: 'POST',
      url: '/api/clientes/1/departamentos/fusionar',
      payload: { idDestino: 2, origenes: [3] },
    },
  ],
];

const TODAS = [...DE_MODIFICAR, ...DE_ADMINISTRAR];

describe('0.239 — las puertas HTTP de las mutaciones del cliente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el inventario es EXACTAMENTE lo que los plugins registran: toda ruta que no es lectura', async () => {
    // Se compara contra las rutas REALES (hook `onRoute`), no contra la propia matriz: una mutación
    // nueva que nadie clasifique —o una que desaparezca— rompe esta igualdad.
    const app = await appCon(con());
    await app.close();
    const mutaciones = rutasRegistradas
      .filter((ruta) => !/^(GET|HEAD|OPTIONS) /.test(ruta))
      .filter((ruta) => ruta.split(' ')[1]?.startsWith('/api/clientes') === true)
      .sort();
    expect(TODAS.map(([ruta]) => ruta).sort()).toEqual(mutaciones);
    expect(DE_MODIFICAR).toHaveLength(8);
    expect(DE_ADMINISTRAR).toHaveLength(5);
  });

  it.each(DE_MODIFICAR)('⭐ %s abre con SÓLO `clientes.modificar`', async (_n, peticion) => {
    expect(await codigo(con('clientes.modificar'), peticion)).toBe(418);
  });

  it.each(DE_ADMINISTRAR)(
    '⛔ %s NO abre con sólo `clientes.modificar` (403: alta, ficha, baja y fusión)',
    async (_n, peticion) => {
      expect(await codigo(con('clientes.modificar'), peticion)).toBe(403);
    },
  );

  it.each(TODAS)('✅ %s sigue abriendo con SÓLO `clientes.administrar`', async (_n, peticion) => {
    expect(await codigo(con('clientes.administrar'), peticion)).toBe(418);
  });

  it.each(TODAS)('⛔ %s se cierra sin ninguna de las dos (403)', async (_n, peticion) => {
    expect(await codigo(con(), peticion)).toBe(403);
  });
});
