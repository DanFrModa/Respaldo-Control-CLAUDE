/**
 * Tests de integración del listado de Tipos de movimiento (F3-E1, solo lectura).
 *
 * ⭐ Fila 0.193 — aquí se mide **el DOMINIO SOLO**, sin ruta ni `preHandler` de por medio: es la
 * mitad que la prueba de `api/inventarios/tipos-movimiento-reja.int.test.ts` no puede medir (allí,
 * un 403 lo puede haber dictado la puerta). Las tres llaves de inventario abren, y la ausencia de
 * las tres cierra — y lo dice `exigirVerTiposMovimiento`, no el guard del API.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { listarTiposMovimiento } from './tipos-movimiento.js';

let cliente: PrismaClient;
const sesion = () => sesionDePrueba({ permisos: ['inventario-pt.ver'] });
/** Las TRES llaves que abren el catálogo global (fila 0.193), una por una. */
const LLAVES_QUE_ABREN = [
  'inventario-pt.ver',
  'inventario-telas.ver',
  'inventario-avios.ver',
] as const;
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

  it('con un permiso AJENO al inventario → ErrorPermiso (lo niega el DOMINIO, no la ruta)', async () => {
    const forastera = sesionDePrueba({ permisos: ['modelos.ver'] });
    await expect(listarTiposMovimiento(forastera, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  // Fila 0.193: el catálogo es GLOBAL (PT, telas y avíos comparten uno solo), así que CUALQUIERA de
  // las tres llaves de inventario lo abre — y la de telas y la de avíos chocaban antes con un 403
  // del dominio después de haber pasado la puerta.
  for (const llave of LLAVES_QUE_ABREN) {
    it(`con sólo \`${llave}\` lista el catálogo completo`, async () => {
      const solaUna = sesionDePrueba({ permisos: [llave] });
      const datos = await listarTiposMovimiento(solaUna, {}, bd());
      expect(datos.map((t) => t.codigo)).toEqual([
        'inventario-inicial',
        'entrega-cliente',
        'transferencia-almacenes',
      ]);
    });
  }

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
