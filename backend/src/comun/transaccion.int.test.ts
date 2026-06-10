import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../datos/index.js';
import { crearAlmacen } from '../dominio/admin/almacenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sesionDePrueba } from '../pruebas/sesiones.js';
import { registrarBitacora } from './auditoria.js';
import { enTransaccion } from './transaccion.js';

let cliente: PrismaClient;
let empresa: Empresa;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
});

describe('enTransaccion (A2: todo multi-tabla en una transacción)', () => {
  it('si la función lanza, NADA persiste (entidad y bitácora se revierten juntas)', async () => {
    const sesion = sesionDePrueba({ idEmpresaActiva: empresa.id });

    await expect(
      enTransaccion(
        async (tx) => {
          const almacen = await tx.almacen.create({
            data: { nombre: 'Temporal', tipo: 'PT', idEmpresa: empresa.id },
          });
          await registrarBitacora(tx, sesion, {
            entidad: 'Almacen',
            idEntidad: almacen.id,
            accion: 'CREAR',
          });
          throw new Error('falla a media operación');
        },
        { cliente },
      ),
    ).rejects.toThrow('falla a media operación');

    expect(await cliente.almacen.count()).toBe(0);
    expect(await cliente.bitacora.count()).toBe(0);
  });

  it('si la función termina, entidad y bitácora quedan juntas', async () => {
    const sesion = sesionDePrueba({ idEmpresaActiva: empresa.id });

    await enTransaccion(
      async (tx) => {
        const almacen = await tx.almacen.create({
          data: { nombre: 'Definitivo', tipo: 'PT', idEmpresa: empresa.id },
        });
        await registrarBitacora(tx, sesion, {
          entidad: 'Almacen',
          idEntidad: almacen.id,
          accion: 'CREAR',
        });
      },
      { cliente },
    );

    expect(await cliente.almacen.count()).toBe(1);
    expect(await cliente.bitacora.count()).toBe(1);
  });

  it('CRÍTICO: un SERVICIO compuesto en la transacción del llamador se revierte con ella (A2)', async () => {
    const sesion = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['almacenes.administrar'],
    });

    await expect(
      enTransaccion(
        async (tx) => {
          // El servicio completo (validaciones + almacén + bitácora) corre DENTRO
          // de la transacción del llamador vía bd.tx — composición A2.
          const almacen = await crearAlmacen(sesion, { nombre: 'Bodega PT', tipo: 'PT' }, { tx });
          expect(almacen.id).toBeGreaterThan(0);
          throw new Error('el paso siguiente del llamador falló');
        },
        { cliente },
      ),
    ).rejects.toThrow('el paso siguiente del llamador falló');

    // El almacén que el servicio "creó" y SU bitácora desaparecieron juntos.
    expect(await cliente.almacen.count()).toBe(0);
    expect(await cliente.bitacora.count()).toBe(0);
  });

  it('registrarBitacora exige sesión o null explícito (procesos de sistema)', async () => {
    await enTransaccion(
      async (tx) => {
        await registrarBitacora(tx, null, {
          entidad: 'Sistema',
          idEntidad: 'job-1',
          accion: 'OTRO',
          datos: { detalle: 'proceso nocturno' },
        });
      },
      { cliente },
    );

    const renglon = await cliente.bitacora.findFirstOrThrow();
    expect(renglon.idUsuario).toBeNull();
    expect(renglon.accion).toBe('OTRO');
  });
});
