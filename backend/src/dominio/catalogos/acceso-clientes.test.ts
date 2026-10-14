import { describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { exigirModificarCliente } from './acceso-clientes.js';
import * as moduloContactos from './cliente-contactos.js';
import * as moduloDepartamentos from './cliente-departamentos.js';
import * as moduloClientes from './clientes.js';
import { actualizarContactoCliente, crearContactoCliente } from './cliente-contactos.js';
import {
  actualizarDepartamentoCliente,
  agregarDepartamentoCliente,
  desactivarDepartamentoCliente,
  fusionarDepartamentosCliente,
  previsualizarFusionDepartamentos,
  reactivarDepartamentoCliente,
} from './cliente-departamentos.js';
import {
  actualizarCampoCliente,
  actualizarCliente,
  agregarCampoCliente,
  crearCliente,
  desactivarCampoCliente,
  desactivarCliente,
  reactivarCampoCliente,
  reactivarCliente,
} from './clientes.js';

/**
 * ⭐⭐ Fila 0.239 (§Post-F9.248(b)) — LA REJA DEL DOMINIO entre `clientes.modificar` y
 * `clientes.administrar`, probada SIN base de datos.
 *
 * Daniel, sobre Aurora: *«Administración o yo damos de alta al cliente. Ella puede meter información
 * de compradores, departamentos, datos de cada comprador»*. Lo que se fija aquí, operación por
 * operación:
 *  • las DIEZ de lo que cuelga del cliente (4 de departamentos, 2 de personas, 4 de campos) pasan
 *    con SÓLO `clientes.modificar`;
 *  • las SEIS reservadas (alta, edición de la ficha, desactivar y reactivar el cliente, y la FUSIÓN de
 *    departamentos con su previa, porque toca los factores del dueño) NO pasan con sólo
 *    `clientes.modificar`;
 *  • `clientes.administrar` sigue pudiendo las DIECISÉIS (nadie que ya lo hacía pierde nada);
 *  • sin ninguna de las dos, las DIECISÉIS se niegan (deny-by-default, A4).
 *
 * 🔑 **Cómo se sabe que la reja DEJÓ PASAR sin una base:** la «base» que recibe cada operación es una
 * transacción-trampa que, al primer acceso, lanza {@link PasoLaReja}. Llegar a ella = la reja ya se
 * cruzó (todas exigen el permiso en su primera línea, antes de validar o tocar datos). Una negación
 * es `ErrorPermiso` y nunca llega a la trampa. Las entradas son VÁLIDAS a propósito: así lo que se ve
 * es la trampa y no un `ErrorValidacion` que dejaría la prueba ambigua.
 *
 * La regla de cada operación contra Postgres de verdad (que se escriba, la bitácora, la unicidad) la
 * miden sus `.int.test.ts`; esto mide sólo QUIÉN entra.
 */

/** Lo que lanza la transacción-trampa: la operación cruzó la reja y fue a buscar datos. */
class PasoLaReja extends Error {
  constructor() {
    super('cruzó la reja de permisos y tocó la base');
  }
}

/** Una transacción en la que CUALQUIER acceso (`tx.cliente`, `tx.clienteDepartamento`…) lanza. */
function bdTrampa(): ContextoBd {
  const tx = new Proxy(
    {},
    {
      get() {
        throw new PasoLaReja();
      },
    },
  ) as Tx;
  return { tx };
}

type Operacion = (sesion: ReturnType<typeof sesionDePrueba>, bd: ContextoBd) => Promise<unknown>;

/** Lo que CUELGA del cliente: `clientes.modificar` (o `.administrar`, que lo implica). */
const DE_MODIFICAR: readonly (readonly [string, Operacion])[] = [
  [
    'agregarDepartamentoCliente',
    (s, bd) => agregarDepartamentoCliente(s, 1, { nombre: 'Dama' }, bd),
  ],
  [
    'actualizarDepartamentoCliente',
    (s, bd) => actualizarDepartamentoCliente(s, 1, { id: 2, nombre: 'Damas' }, bd),
  ],
  ['desactivarDepartamentoCliente', (s, bd) => desactivarDepartamentoCliente(s, 1, 2, bd)],
  ['reactivarDepartamentoCliente', (s, bd) => reactivarDepartamentoCliente(s, 1, 2, bd)],
  ['crearContactoCliente', (s, bd) => crearContactoCliente(s, 1, { nombre: 'Ana López' }, bd)],
  [
    'actualizarContactoCliente',
    (s, bd) => actualizarContactoCliente(s, 1, 4, { puesto: 'Compradora' }, bd),
  ],
  ['agregarCampoCliente', (s, bd) => agregarCampoCliente(s, 1, { etiqueta: 'Nº de OC' }, bd)],
  [
    'actualizarCampoCliente',
    (s, bd) => actualizarCampoCliente(s, 1, { id: 5, etiqueta: 'Nº de OC del cliente' }, bd),
  ],
  ['desactivarCampoCliente', (s, bd) => desactivarCampoCliente(s, 1, 5, bd)],
  ['reactivarCampoCliente', (s, bd) => reactivarCampoCliente(s, 1, 5, bd)],
];

/**
 * Sólo `clientes.administrar`: el cliente MISMO, y la FUSIÓN de departamentos con su previa —que
 * mueve o borra los factores de precio del absorbido, del dueño (§Post-F9.125); hallazgo del reviewer
 * de la 0.239—.
 */
const DE_ADMINISTRAR: readonly (readonly [string, Operacion])[] = [
  ['crearCliente', (s, bd) => crearCliente(s, { nombre: 'Cliente Nuevo' }, bd)],
  ['actualizarCliente', (s, bd) => actualizarCliente(s, { id: 1, nombre: 'Otro nombre' }, bd)],
  ['desactivarCliente', (s, bd) => desactivarCliente(s, 1, bd)],
  ['reactivarCliente', (s, bd) => reactivarCliente(s, 1, bd)],
  [
    'fusionarDepartamentosCliente',
    (s, bd) => fusionarDepartamentosCliente(s, 1, { idDestino: 2, origenes: [3] }, bd),
  ],
  [
    'previsualizarFusionDepartamentos',
    (s, bd) => previsualizarFusionDepartamentos(s, 1, { idDestino: 2, origenes: [3] }, bd),
  ],
];

/**
 * Las operaciones con reja de escritura que EXPORTAN DE VERDAD los tres módulos del cliente: toda
 * función exportada menos las de lectura (`listar*`, `obtener*`, que exigen `clientes.ver`). Se lee
 * del módulo, no de la matriz: así una función nueva que escriba y nadie clasifique pone esto en rojo.
 * (`previsualizarFusionDepartamentos` no escribe, pero lleva la reja de la operación que previsualiza
 * y por eso cuenta aquí.)
 */
function operacionesExportadas(): string[] {
  const esLectura = (nombre: string) => /^(listar|obtener)/.test(nombre);
  return [moduloClientes, moduloDepartamentos, moduloContactos]
    .flatMap((modulo) => Object.entries(modulo))
    .filter(([nombre, valor]) => typeof valor === 'function' && !esLectura(nombre))
    .map(([nombre]) => nombre)
    .sort();
}

const TODAS = [...DE_MODIFICAR, ...DE_ADMINISTRAR];

function con(...permisos: ClavePermiso[]) {
  return sesionDePrueba({ permisos: ['clientes.ver', ...permisos], idEmpresaActiva: 1 });
}

describe('0.239 — `clientes.modificar` captura lo que cuelga del cliente; el cliente mismo es de `administrar`', () => {
  it('el inventario es EXACTAMENTE lo que exportan los módulos: 10 de `modificar` + 6 de `administrar`', () => {
    // Se compara contra los exports REALES, no contra la propia matriz: una operación nueva que nadie
    // clasifique (o una que desaparezca) rompe esta igualdad y obliga a decidir de qué lado cae.
    const enMatriz = TODAS.map(([nombre]) => nombre).sort();
    expect(enMatriz).toEqual(operacionesExportadas());
    expect(DE_MODIFICAR).toHaveLength(10);
    expect(DE_ADMINISTRAR).toHaveLength(6);
  });

  it.each(DE_MODIFICAR)('⭐ %s pasa con SÓLO `clientes.modificar`', async (_nombre, operacion) => {
    await expect(operacion(con('clientes.modificar'), bdTrampa())).rejects.toBeInstanceOf(
      PasoLaReja,
    );
  });

  it.each(DE_ADMINISTRAR)(
    '⛔ %s NO pasa con sólo `clientes.modificar` (alta, ficha, baja y fusión son de `administrar`)',
    async (_nombre, operacion) => {
      await expect(operacion(con('clientes.modificar'), bdTrampa())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    },
  );

  it.each(TODAS)(
    '✅ %s sigue pasando con SÓLO `clientes.administrar` (administrar implica modificar)',
    async (_nombre, operacion) => {
      await expect(operacion(con('clientes.administrar'), bdTrampa())).rejects.toBeInstanceOf(
        PasoLaReja,
      );
    },
  );

  it.each(TODAS)('⛔ %s se niega sin ninguna de las dos', async (_nombre, operacion) => {
    await expect(operacion(con(), bdTrampa())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('la negación nombra `clientes.modificar`, que es la llave que hay que dar', () => {
    let error: unknown;
    try {
      exigirModificarCliente(con());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorPermiso);
    expect((error as ErrorPermiso).permiso).toBe('clientes.modificar');
  });
});
