/**
 * Tests UNITARIOS de los impresos de la LISTA DE PRECIOS (F8-E4). Sin BD: se inyecta un `obtenerLista`
 * fake. Cubre que el PDF sale (buffer con firma %PDF) y que el Excel sale y CUADRA (el precio impreso
 * = `precioAprobado ?? precioCalculado`, verificado al re-leer el libro).
 */
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';

import type { ListaPreciosDetalle } from '../../../contrato/esquemas/lista-precios.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { cerrarPoolPdf } from '../../../comun/pdf-worker.js';

import { impresoListaPrecios } from './impreso-lista-precios.js';
import { excelListaPrecios } from './excel-lista-precios.js';

/** Una lista de detalle de ejemplo con un renglón aprobado (137) y otro solo calculado (100). */
function listaEjemplo(): ListaPreciosDetalle {
  return {
    id: 1,
    folio: 7,
    idCliente: 1,
    nombreCliente: 'C&A',
    idClienteDepartamento: 1,
    nombreDepartamento: 'NIÑOS',
    fecha: '2026-07-06',
    idEstadoLista: 1,
    codigoEstado: 'abierta',
    nombreEstado: 'Abierta',
    margenPct: 50,
    descuentosPct: 10,
    regaliasPct: 5,
    costoVentasPct: 5,
    notas: 'Temporada otoño',
    lineas: [
      {
        id: 10,
        idDesarrollo: 100,
        idPrecosto: 1000,
        versionPrecosto: 1,
        codigoModelo: 'MOD-A',
        descripcionModelo: 'Jogger',
        numeroCliente: 'CA-001',
        costoUnit: 40,
        precioCalculado: 100,
        precioAprobado: 137,
        aprobado: true,
        aprobadoPorId: 'u1',
        aprobadoEn: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 11,
        idDesarrollo: 101,
        idPrecosto: 1001,
        versionPrecosto: 2,
        codigoModelo: 'MOD-B',
        descripcionModelo: null,
        numeroCliente: null,
        costoUnit: 40,
        precioCalculado: 100,
        precioAprobado: null,
        aprobado: false,
        aprobadoPorId: null,
        aprobadoEn: null,
      },
    ],
    creadoEn: '2026-07-06T00:00:00.000Z',
    creadoPorId: 'u1',
    modificadoEn: '2026-07-06T00:00:00.000Z',
    modificadoPorId: 'u1',
  };
}

const sesion = sesionDePrueba({ permisos: ['listas.ver', 'consultas.ver-importes'] });
const fakeObtener = () => Promise.resolve(listaEjemplo());

afterAll(async () => {
  await cerrarPoolPdf();
});

describe('impresoListaPrecios (PDF)', () => {
  it('genera un PDF no vacío con la firma %PDF y el folio en el nombre', async () => {
    const { buffer, folio } = await impresoListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtener,
    });
    expect(folio).toBe(7);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 20_000); // orquestador → render en worker (arranque en frío del pool bajo carga de tests).
});

describe('excelListaPrecios (Excel)', () => {
  it('genera un .xlsx cuyo precio = precioAprobado ?? precioCalculado', async () => {
    const { buffer, folio } = await excelListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtener,
    });
    expect(folio).toBe(7);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.worksheets[0]!;
    // Fila 1 = encabezado; fila 2 = MOD-A (aprobado 137); fila 3 = MOD-B (calculado 100).
    expect(hoja.getCell('A2').value).toBe('MOD-A');
    expect(Number(hoja.getCell('D2').value)).toBe(137);
    expect(hoja.getCell('E2').value).toBe('Aprobado');
    expect(hoja.getCell('A3').value).toBe('MOD-B');
    expect(Number(hoja.getCell('D3').value)).toBe(100);
    expect(hoja.getCell('E3').value).toBe('Calculado');
  }, 20_000); // orquestador → construcción en worker (arranque en frío del pool bajo carga de tests).
});
