/**
 * Tests UNITARIOS del impreso de la COTIZACIÓN (V1-E7c) — el papel que ve el cliente. Sin BD: se
 * inyecta un `obtenerCotizacion` fake.
 *
 * Lo que se blinda:
 *  • 🔴 El impreso arma sus datos desde el DOCUMENTO (valores congelados), no desde la lista: dos
 *    llamadas con el mismo documento dan el mismo papel aunque la lista se haya seguido negociando.
 *  • Van TODOS los modelos (regla de Daniel: la cotización se lee sola).
 *  • Una cotización CANCELADA se sigue imprimiendo, con su banda y su motivo (D3).
 *  • El PDF sale de verdad (firma %PDF) y el folio viaja para el nombre del archivo.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { CotizacionDetalle } from '../../../contrato/esquemas/cotizacion.js';
import { cerrarPoolPdf } from '../../../comun/pdf-worker.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';

import {
  armarDatosImpresoCotizacion,
  generarPdfCotizacion,
  impresoCotizacion,
} from './impreso-cotizacion.js';

/** Una cotización emitida el 12 de marzo con tres modelos (la foto que debe seguir diciendo lo mismo). */
function cotizacionEjemplo(parcial: Partial<CotizacionDetalle> = {}): CotizacionDetalle {
  return {
    id: 500,
    folio: 41,
    idLista: 7,
    folioLista: 7,
    idCliente: 3,
    nombreCliente: 'C&A',
    idClienteDepartamento: 4,
    nombreDepartamento: 'NIÑOS',
    fecha: '2026-03-12',
    estado: 'emitida',
    notas: 'Vigencia 30 días',
    motivoCancelacion: null,
    canceladaPorId: null,
    canceladaEn: null,
    lineas: [
      {
        id: 900,
        idListaLinea: 10,
        idPrecosto: 1010,
        versionPrecosto: 1,
        codigoModelo: 'MOD-A',
        descripcionModelo: 'Jogger',
        numeroCliente: 'CA-001',
        precioUnit: 137,
      },
      {
        id: 901,
        idListaLinea: 11,
        idPrecosto: 1011,
        versionPrecosto: 2,
        codigoModelo: 'MOD-B',
        descripcionModelo: null,
        numeroCliente: null,
        precioUnit: 210,
      },
      {
        id: 902,
        idListaLinea: 12,
        idPrecosto: 1012,
        versionPrecosto: 1,
        codigoModelo: 'MOD-C',
        descripcionModelo: 'Pants',
        numeroCliente: 'CA-003',
        precioUnit: 95.5,
      },
    ],
    total: 442.5,
    creadoEn: '2026-03-12T10:00:00.000Z',
    creadoPorId: 'u1',
    ...parcial,
  };
}

const sesion = sesionDePrueba({ permisos: ['listas.ver', 'consultas.ver-importes'] });

/** Fake de `obtenerCotizacion` con la forma que espera el impreso. */
function fakeObtener(cotizacion: CotizacionDetalle) {
  return (() => Promise.resolve(cotizacion)) as never;
}

afterAll(async () => {
  await cerrarPoolPdf();
});

describe('armarDatosImpresoCotizacion — el papel sale del DOCUMENTO congelado', () => {
  it('imprime los precios y textos del documento, no los de la lista', async () => {
    const datos = await armarDatosImpresoCotizacion(sesion, 500, undefined, {
      obtenerCotizacion: fakeObtener(cotizacionEjemplo()),
    });
    expect(datos.folio).toBe(41);
    expect(datos.folioLista).toBe(7);
    expect(datos.cliente).toBe('C&A');
    expect(datos.departamento).toBe('NIÑOS');
    expect(datos.fecha).toBe('2026-03-12');
    expect(datos.total).toBe(442.5);
    expect(datos.renglones.map((r) => [r.codigoModelo, r.precio])).toEqual([
      ['MOD-A', 137],
      ['MOD-B', 210],
      ['MOD-C', 95.5],
    ]);
    // El nº del cliente se imprime tal cual (es como él lee su propia orden de compra).
    expect(datos.renglones[0]?.numeroCliente).toBe('CA-001');
    expect(datos.renglones[1]?.descripcionModelo).toBeNull();
  });

  it('van TODOS los modelos: la cotización se lee sola, sin la vuelta anterior al lado', async () => {
    const datos = await armarDatosImpresoCotizacion(sesion, 500, undefined, {
      obtenerCotizacion: fakeObtener(cotizacionEjemplo()),
    });
    expect(datos.renglones).toHaveLength(3);
  });

  it('una cotización CANCELADA se sigue imprimiendo, con su motivo (D3)', async () => {
    const datos = await armarDatosImpresoCotizacion(sesion, 500, undefined, {
      obtenerCotizacion: fakeObtener(
        cotizacionEjemplo({
          estado: 'cancelada',
          motivoCancelacion: 'El cliente cambió la curva de tallas',
        }),
      ),
    });
    expect(datos.cancelada).toBe(true);
    expect(datos.motivoCancelacion).toBe('El cliente cambió la curva de tallas');
    // Y lo que se ofreció sigue ahí: cancelar dice "ya no está vigente", no "no pasó".
    expect(datos.renglones).toHaveLength(3);
    expect(datos.renglones[0]?.precio).toBe(137);
  });

  it('una cotización emitida NO se marca como cancelada', async () => {
    const datos = await armarDatosImpresoCotizacion(sesion, 500, undefined, {
      obtenerCotizacion: fakeObtener(cotizacionEjemplo()),
    });
    expect(datos.cancelada).toBe(false);
  });
});

describe('impresoCotizacion (PDF)', () => {
  it('genera un PDF no vacío con la firma %PDF y el folio para el nombre del archivo', async () => {
    const { buffer, folio } = await impresoCotizacion(sesion, 500, undefined, {
      obtenerCotizacion: fakeObtener(cotizacionEjemplo()),
    });
    expect(folio).toBe(41);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('la versión CANCELADA también renderiza (con banda) — no revienta por la banda de estado', async () => {
    const datos = await armarDatosImpresoCotizacion(sesion, 500, undefined, {
      obtenerCotizacion: fakeObtener(
        cotizacionEjemplo({ estado: 'cancelada', motivoCancelacion: 'Duplicada' }),
      ),
    });
    const buffer = await generarPdfCotizacion(datos);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
