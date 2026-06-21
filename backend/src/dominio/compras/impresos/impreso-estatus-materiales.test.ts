/**
 * Pruebas unitarias del impreso del ESTATUS de materiales (F4-E4, R7). No tocan BD: ejercitan
 *  • `generarPdfEstatusMateriales` — Buffer PDF real (cabecera `%PDF`), con/ sin snapshot, con
 *    'no-identificado', sin filas.
 *  • `armarDatosImpresoEstatus` — reúsa `estatusMaterialesOrden` (inyectado) y propaga el 404 (A9).
 */
import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { EstatusMaterialesSalida } from '../../../contrato/index.js';

import {
  armarDatosImpresoEstatus,
  generarPdfEstatusMateriales,
  type DepsImpresoEstatus,
} from './impreso-estatus-materiales.js';

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

function estatusBase(over: Partial<EstatusMaterialesSalida> = {}): EstatusMaterialesSalida {
  return {
    idOrden: 50,
    folioOrden: 1001,
    tieneSnapshot: true,
    filas: [
      {
        tipo: 'avio',
        idTela: null,
        idAvio: 3,
        material: 'BOT-01 — Botón',
        unidad: 'pza',
        requerido: 180,
        enOc: 180,
        recibido: 90,
        estatus: 'recibido-parcial',
      },
      {
        tipo: 'tela',
        idTela: 4,
        idAvio: null,
        material: 'Felpa',
        unidad: 'm',
        requerido: 45,
        enOc: 0,
        recibido: 0,
        estatus: 'pendiente',
      },
      {
        tipo: 'no-identificado',
        idTela: null,
        idAvio: null,
        material: 'Flete',
        unidad: null,
        requerido: 0,
        enOc: 1,
        recibido: 0,
        estatus: 'en-oc',
      },
    ],
    ...over,
  };
}

function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('generarPdfEstatusMateriales', () => {
  it('devuelve un Buffer no vacío con cabecera %PDF', async () => {
    const datos = await armarDatosImpresoEstatus(sesionConVer(), 50, undefined, {
      estatusMaterialesOrden: () => Promise.resolve(estatusBase()),
    });
    expect(esPdf(await generarPdfEstatusMateriales(datos))).toBe(true);
  });

  it('renderiza sin snapshot (aviso) y sin filas', async () => {
    const datos = await armarDatosImpresoEstatus(sesionConVer(), 50, undefined, {
      estatusMaterialesOrden: () =>
        Promise.resolve(estatusBase({ tieneSnapshot: false, filas: [] })),
    });
    expect(esPdf(await generarPdfEstatusMateriales(datos))).toBe(true);
  });
});

describe('armarDatosImpresoEstatus', () => {
  it('reúsa estatusMaterialesOrden y proyecta las filas (incluida no-identificado)', async () => {
    const datos = await armarDatosImpresoEstatus(sesionConVer(), 50, undefined, {
      estatusMaterialesOrden: () => Promise.resolve(estatusBase()),
    });
    expect(datos.folioOrden).toBe(1001);
    expect(datos.lineas).toHaveLength(3);
    expect(datos.lineas[2]?.estatus).toBe('no-identificado-en-oc');
  });

  it('propaga el ErrorNoEncontrado (orden de otra empresa → 404)', async () => {
    const deps: DepsImpresoEstatus = {
      estatusMaterialesOrden: () => Promise.reject(new ErrorNoEncontrado('Orden', 999)),
    };
    await expect(armarDatosImpresoEstatus(sesionConVer(), 999, undefined, deps)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});
