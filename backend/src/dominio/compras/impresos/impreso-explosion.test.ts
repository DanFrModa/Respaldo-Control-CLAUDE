/**
 * Pruebas unitarias del impreso de la EXPLOSIÓN de materiales (F4-E4). No tocan BD: ejercitan
 *  • `generarPdfExplosion` — devuelve un Buffer PDF real (cabecera `%PDF`), incluso con grupos
 *    vacíos, genéricos y sin proveedor.
 *  • `armarDatosImpresoExplosion` — reúsa `explosionarOrden` (inyectado), proyecta los grupos y
 *    propaga el 404 (A9).
 */
import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ExplosionSalida } from '../../../contrato/index.js';

import {
  armarDatosImpresoExplosion,
  generarPdfExplosion,
  type DepsImpresoExplosion,
} from './impreso-explosion.js';

function sesionConVer(): SesionUsuario {
  return {
    id: 'u1',
    username: 'tester',
    nombre: 'Tester',
    idEmpresaActiva: 1,
    nombreEmpresaActiva: 'FR Moda',
    permisos: new Set(['compras.ver']),
  } as unknown as SesionUsuario;
}

function explosionBase(over: Partial<ExplosionSalida> = {}): ExplosionSalida {
  return {
    idOrden: 50,
    folioOrden: 1001,
    idModelo: 9,
    modelo: 'A-100',
    totalPiezas: 30,
    huboCambios: false,
    regenerado: false,
    avisos: [],
    // V1-E3d: la explosión trae la desalineación contra el BOM vivo (el impreso no la pinta).
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
    grupos: [
      {
        idProveedor: 7,
        proveedor: 'Avíos Baratos',
        renglones: [
          {
            id: 1,
            tipo: 'avio',
            idTela: null,
            idAvio: 3,
            material: 'BOT-01 — Botón',
            cantidadRequerida: 180,
            unidad: 'pza',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 180,
            idProveedorSugerido: 7,
            proveedorSugerido: 'Avíos Baratos',
            precioSugerido: 2,
            diff: 'sin-cambio',
            cambiosReceta: [],
          },
        ],
      },
      {
        idProveedor: null,
        proveedor: 'Sin proveedor sugerido',
        renglones: [
          {
            id: 2,
            tipo: 'tela',
            idTela: 4,
            idAvio: null,
            material: 'Felpa',
            cantidadRequerida: 45,
            unidad: 'm',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 45,
            idProveedorSugerido: null,
            proveedorSugerido: null,
            precioSugerido: null,
            diff: 'sin-cambio',
            cambiosReceta: [],
          },
        ],
      },
    ],
    ...over,
  };
}

function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('generarPdfExplosion', () => {
  it('devuelve un Buffer no vacío con cabecera %PDF', async () => {
    const buffer = await generarPdfExplosion(
      await armarDatosImpresoExplosion(sesionConVer(), 50, undefined, {
        explosionarOrden: () => Promise.resolve(explosionBase()),
      }),
    );
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza sin grupos (orden sin requerimientos)', async () => {
    const datos = await armarDatosImpresoExplosion(sesionConVer(), 50, undefined, {
      explosionarOrden: () => Promise.resolve(explosionBase({ grupos: [] })),
    });
    expect(esPdf(await generarPdfExplosion(datos))).toBe(true);
  });
});

describe('armarDatosImpresoExplosion', () => {
  it('reúsa explosionarOrden y proyecta los grupos', async () => {
    const datos = await armarDatosImpresoExplosion(sesionConVer(), 50, undefined, {
      explosionarOrden: () => Promise.resolve(explosionBase()),
    });
    expect(datos.empresa).toBe('FR Moda');
    expect(datos.folioOrden).toBe(1001);
    expect(datos.modelo).toBe('A-100');
    expect(datos.grupos).toHaveLength(2);
    expect(datos.grupos[0]?.lineas[0]?.material).toBe('BOT-01 — Botón');
    expect(datos.grupos[0]?.lineas[0]?.aComprar).toBe(180);
  });

  it('propaga el ErrorNoEncontrado de explosionarOrden (orden de otra empresa → 404)', async () => {
    const deps: DepsImpresoExplosion = {
      explosionarOrden: () => Promise.reject(new ErrorNoEncontrado('Orden', 999)),
    };
    await expect(
      armarDatosImpresoExplosion(sesionConVer(), 999, undefined, deps),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
