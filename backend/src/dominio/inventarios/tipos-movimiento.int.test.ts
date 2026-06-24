/**
 * Tests de integración del listado de Tipos de movimiento (F3-E1, solo lectura).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { listarTiposMovimiento } from './tipos-movimiento.js';

let cliente: PrismaClient;
const sesion = () => sesionDePrueba({ permisos: ['inventario-pt.ver'] });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
      { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
      {
        codigo: 'transferencia-almacenes',
        nombre: 'Transferencia entre almacenes',
        direccion: 'traspaso',
      },
      { codigo: 'inactivo', nombre: 'Inactivo', direccion: 'entrada', activo: false },
    ],
  });
});

describe('listarTiposMovimiento (F3-E1, solo lectura)', () => {
  it('sin permiso → ErrorPermiso', async () => {
    await expect(listarTiposMovimiento(sesionDePrueba(), {}, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('lista solo activos por defecto, ordenados por id', async () => {
    const datos = await listarTiposMovimiento(sesion(), {}, bd());
    expect(datos).toHaveLength(3);
    expect(datos.map((t) => t.codigo)).toEqual([
      'inventario-inicial',
      'entrega-cliente',
      'transferencia-almacenes',
    ]);
  });

  it('incluye inactivos cuando se pide', async () => {
    expect(await listarTiposMovimiento(sesion(), { incluirInactivos: true }, bd())).toHaveLength(4);
  });

  it('filtra por dirección', async () => {
    const salidas = await listarTiposMovimiento(sesion(), { direccion: 'salida' }, bd());
    expect(salidas.map((t) => t.codigo)).toEqual(['entrega-cliente']);
  });
});
