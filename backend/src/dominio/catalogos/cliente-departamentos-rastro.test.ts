import { describe, expect, it, vi } from 'vitest';

import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  actualizarDepartamentoCliente,
  fusionarDepartamentosCliente,
} from './cliente-departamentos.js';

/**
 * ⭐⭐ Unit del RASTRO de la fusión de departamentos (§Post-F9.172(a)) — SIN Postgres.
 *
 * Mide **lo que la fusión ESCRIBE** en `ClienteDepartamento.idFusionadoEn`, que es de dónde sale
 * todo lo demás: si el rastro no se sella, la búsqueda por sinónimo queda muerta aunque su
 * algoritmo esté perfecto. Las tres reglas:
 *   1. cada absorbido queda apuntando al canónico —**aunque ya estuviera apagado**—;
 *   2. al canónico se le LIMPIA el suyo (a él no lo absorbe nadie);
 *   3. reactivar a mano lo BORRA (reactivar es deshacer la fusión).
 * Las dos últimas juntas son las que impiden que el dominio cierre un anillo.
 *
 * La integridad real contra la base (que la FK exista, que la cadena sobreviva, que la bitácora
 * quede) se prueba en `cliente-departamentos-fusion.int.test.ts` (CI). Aquí se mide el `data` con
 * el que se llama a Prisma, que es lo que se puede verificar sin contenedor.
 */

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['clientes.ver', 'clientes.administrar'], idEmpresaActiva: 1 });

const ID_CLIENTE = 7;
const ID_DESTINO = 1;
const ID_ORIGEN = 2;

/** Departamentos que ve el stub, por id. Se puede tocar `activo` para el caso "ya estaba apagado". */
function bdStub(departamentos: Record<number, { nombre: string; activo: boolean }>) {
  const actualizar = vi.fn((args: { where: { id: number }; data: Record<string, unknown> }) =>
    Promise.resolve({
      id: args.where.id,
      idCliente: ID_CLIENTE,
      nombre: departamentos[args.where.id]?.nombre ?? '?',
      activo: true,
      idFusionadoEn: null,
    }),
  );
  const bitacora = vi.fn(() => Promise.resolve({}));
  const sinFilas = vi.fn(() => Promise.resolve({ count: 0 }));
  const tx = {
    cliente: { findUnique: vi.fn(() => Promise.resolve({ nombre: 'C&A', activo: true })) },
    clienteDepartamento: {
      findFirst: vi.fn((args: { where: { id: number } }) => {
        const d = departamentos[args.where.id];
        return Promise.resolve(
          d === undefined
            ? null
            : { id: args.where.id, idCliente: ID_CLIENTE, idFusionadoEn: null, ...d },
        );
      }),
      update: actualizar,
    },
    proyecto: { updateMany: sinFilas },
    listaPrecios: { updateMany: sinFilas },
    cotizacion: { updateMany: sinFilas },
    clienteContacto: { updateMany: sinFilas },
    clienteFactores: { findFirst: vi.fn(() => Promise.resolve(null)), updateMany: sinFilas },
    bitacora: { create: bitacora },
  };
  const bd: ContextoBd = { tx: tx as unknown as Tx };
  return { bd, actualizar, bitacora };
}

/** El `data` con el que se actualizó ESE departamento. */
function datosDe(
  actualizar: ReturnType<typeof vi.fn>,
  id: number,
): Record<string, unknown> | undefined {
  const llamada = (
    actualizar.mock.calls as unknown as [{ where: { id: number }; data: Record<string, unknown> }][]
  ).find(([args]) => args.where.id === id);
  return llamada?.[0].data;
}

describe('rastro de la fusión de departamentos — lo que la fusión ESCRIBE', () => {
  it('⭐ sella el rastro del absorbido apuntando al canónico, y lo apaga', async () => {
    const { bd, actualizar } = bdStub({
      [ID_DESTINO]: { nombre: 'Caballeros', activo: true },
      [ID_ORIGEN]: { nombre: '2-HOMBRE', activo: true },
    });
    await fusionarDepartamentosCliente(
      sesionAdmin(),
      ID_CLIENTE,
      { idDestino: ID_DESTINO, origenes: [ID_ORIGEN] },
      bd,
    );
    const datos = datosDe(actualizar, ID_ORIGEN);
    expect(datos?.activo).toBe(false);
    expect(datos?.fusionadoEn).toEqual({ connect: { id: ID_DESTINO } });
  });

  it('⭐ un absorbido que YA estaba apagado también recibe el rastro', async () => {
    // Antes, el borrado suave sólo se escribía `if (origen.activo)`: sin este caso, un departamento
    // apagado a mano y luego fusionado se quedaría SIN rastro, y la búsqueda no lo entendería.
    const { bd, actualizar } = bdStub({
      [ID_DESTINO]: { nombre: 'Caballeros', activo: true },
      [ID_ORIGEN]: { nombre: '2-HOMBRE', activo: false },
    });
    await fusionarDepartamentosCliente(
      sesionAdmin(),
      ID_CLIENTE,
      { idDestino: ID_DESTINO, origenes: [ID_ORIGEN] },
      bd,
    );
    expect(datosDe(actualizar, ID_ORIGEN)?.fusionadoEn).toEqual({ connect: { id: ID_DESTINO } });
  });

  it('⭐ al CANÓNICO se le limpia el suyo (a él no lo absorbe nadie)', async () => {
    const { bd, actualizar } = bdStub({
      [ID_DESTINO]: { nombre: 'Caballeros', activo: true },
      [ID_ORIGEN]: { nombre: '2-HOMBRE', activo: true },
    });
    await fusionarDepartamentosCliente(
      sesionAdmin(),
      ID_CLIENTE,
      { idDestino: ID_DESTINO, origenes: [ID_ORIGEN] },
      bd,
    );
    const datos = datosDe(actualizar, ID_DESTINO);
    expect(datos?.activo).toBe(true);
    expect(datos?.fusionadoEn).toEqual({ disconnect: true });
  });
});

describe('rastro de la fusión de departamentos — reactivar a mano lo deshace', () => {
  it('⭐ reactivar BORRA el rastro', async () => {
    const { bd, actualizar } = bdStub({ [ID_ORIGEN]: { nombre: '2-HOMBRE', activo: false } });
    await actualizarDepartamentoCliente(
      sesionAdmin(),
      ID_CLIENTE,
      { id: ID_ORIGEN, activo: true },
      bd,
    );
    expect(datosDe(actualizar, ID_ORIGEN)?.fusionadoEn).toEqual({ disconnect: true });
  });

  it('DESACTIVAR no toca el rastro (apagar a mano no es deshacer una fusión)', async () => {
    const { bd, actualizar } = bdStub({ [ID_ORIGEN]: { nombre: '2-HOMBRE', activo: true } });
    await actualizarDepartamentoCliente(
      sesionAdmin(),
      ID_CLIENTE,
      { id: ID_ORIGEN, activo: false },
      bd,
    );
    const datos = datosDe(actualizar, ID_ORIGEN);
    expect(datos?.activo).toBe(false);
    expect(datos).not.toHaveProperty('fusionadoEn');
  });

  it('cambiar sólo el NOMBRE no toca el rastro', async () => {
    const { bd, actualizar } = bdStub({ [ID_ORIGEN]: { nombre: '2-HOMBRE', activo: true } });
    await actualizarDepartamentoCliente(
      sesionAdmin(),
      ID_CLIENTE,
      { id: ID_ORIGEN, nombre: 'HOMBRES' },
      bd,
    );
    expect(datosDe(actualizar, ID_ORIGEN)).not.toHaveProperty('fusionadoEn');
  });
});
