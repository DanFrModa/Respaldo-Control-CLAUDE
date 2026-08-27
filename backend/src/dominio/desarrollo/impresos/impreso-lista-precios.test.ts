/**
 * Tests UNITARIOS de los impresos de la LISTA DE PRECIOS (F8-E4). Sin BD: se inyecta un `obtenerLista`
 * fake. Cubre que el PDF sale (buffer con firma %PDF) y que el Excel sale y CUADRA (el precio impreso
 * = el APROBADO, verificado al re-leer el libro).
 *
 * ⭐ **V1-E8b (§Post-F9.125(c)):** de una lista con renglones SIN APROBAR no sale papel — ni PDF ni
 * Excel. La lista de ejemplo de esta suite tenía a propósito un renglón sin firmar (`MOD-B`), y con
 * ella los dos impresos salían tan campantes con su `precioCalculado`: eso era precisamente el
 * defecto. Hoy la lista base va COMPLETA y el caso a medio firmar tiene su propia prueba, que exige
 * el rechazo.
 */
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';

import type { ListaPreciosDetalle } from '../../../contrato/esquemas/lista-precios.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { ErrorConflicto } from '../../../comun/errores.js';
import { cerrarPoolPdf } from '../../../comun/pdf-worker.js';

import { impresoListaPrecios } from './impreso-lista-precios.js';
import { excelListaPrecios } from './excel-lista-precios.js';

/** Una lista de ejemplo COMPLETAMENTE aprobada (137 y 155): la única de la que sale papel. */
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
        avisoCostoViejo: null,
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
        precioAprobado: 155,
        aprobado: true,
        aprobadoPorId: 'u1',
        aprobadoEn: '2026-07-06T00:00:00.000Z',
        avisoCostoViejo: null,
      },
    ],
    creadoEn: '2026-07-06T00:00:00.000Z',
    creadoPorId: 'u1',
    modificadoEn: '2026-07-06T00:00:00.000Z',
    modificadoPorId: 'u1',
  };
}

/** La MISMA lista, pero con `MOD-B` todavía sin firmar (el caso que hoy se rechaza). */
function listaAMedioFirmar(): ListaPreciosDetalle {
  const lista = listaEjemplo();
  const segunda = lista.lineas[1]!;
  segunda.precioAprobado = null;
  segunda.aprobado = false;
  segunda.aprobadoPorId = null;
  segunda.aprobadoEn = null;
  return lista;
}

const sesion = sesionDePrueba({ permisos: ['listas.ver', 'consultas.ver-importes'] });
const fakeObtener = () => Promise.resolve(listaEjemplo());
const fakeObtenerAMedias = () => Promise.resolve(listaAMedioFirmar());

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
  });
});

describe('excelListaPrecios (Excel)', () => {
  it('genera un .xlsx cuyo precio es el APROBADO de cada renglón', async () => {
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
    expect(Number(hoja.getCell('D3').value)).toBe(155);
    expect(hoja.getCell('E3').value).toBe('Aprobado');
  });
});

// ── 🔴 V1-E8b (§Post-F9.125(c)): ni un borrador de una lista sin aprobar ──────────────

describe('🔴 Sin aprobación no sale documento, ni borrador (§Post-F9.125(c))', () => {
  it('el PDF se rechaza NOMBRANDO el modelo que falta', async () => {
    await expect(
      impresoListaPrecios(sesion, 1, undefined, { obtenerLista: fakeObtenerAMedias }),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    let mensaje = '';
    try {
      await impresoListaPrecios(sesion, 1, undefined, { obtenerLista: fakeObtenerAMedias });
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    // El que lo pidió necesita saber CUÁL abrir, no un "falta 1".
    expect(mensaje).toContain('MOD-B');
    expect(mensaje).not.toContain('MOD-A');
    expect(mensaje).toContain('bajar el impreso de la lista');
  });

  it('el Excel se rechaza igual: era la ventana al lado de la puerta cerrada', async () => {
    await expect(
      excelListaPrecios(sesion, 1, undefined, { obtenerLista: fakeObtenerAMedias }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('una lista VACÍA tampoco produce papel (una hoja en blanco no es una oferta)', async () => {
    const vacia = () => Promise.resolve({ ...listaEjemplo(), lineas: [] });
    await expect(
      excelListaPrecios(sesion, 1, undefined, { obtenerLista: vacia }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});
