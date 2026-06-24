/**
 * Tests UNITARIOS del impreso de envío a maquila (F3-E2). No tocan BD ni red: prueban el armado de
 * la tabla color×talla (función pura) y la generación del PDF con datos resueltos (Buffer no vacío).
 */
import { describe, expect, it } from 'vitest';

import {
  armarTablaEtapa,
  generarPdfEnvio,
  generarPdfFichaEstampado,
  type DatosImpresoEnvio,
} from './impreso-envio-maquila.js';

describe('armarTablaEtapa (F3-E2)', () => {
  it('proyecta la matriz a columnas (tallas) y filas (colores) con totales correctos', () => {
    const tabla = armarTablaEtapa([
      {
        idColor: 1,
        color: 'Rojo',
        totalPiezas: 30,
        tallas: [
          { idTalla: 1, etiquetaTalla: 'CH', cantidad: 10 },
          { idTalla: 2, etiquetaTalla: 'M', cantidad: 20 },
        ],
      },
      {
        idColor: 2,
        color: 'Azul',
        totalPiezas: 5,
        tallas: [{ idTalla: 2, etiquetaTalla: 'M', cantidad: 5 }],
      },
    ]);

    expect(tabla.tallas).toEqual(['CH', 'M']);
    expect(tabla.renglones).toEqual([
      { color: 'Rojo', cantidades: [10, 20], totalFila: 30 },
      { color: 'Azul', cantidades: [0, 5], totalFila: 5 },
    ]);
    expect(tabla.totalesColumna).toEqual([10, 25]);
    expect(tabla.totalPiezas).toBe(35);
  });

  it('matriz vacía → sin tallas, sin renglones, total 0', () => {
    const tabla = armarTablaEtapa([]);
    expect(tabla.tallas).toEqual([]);
    expect(tabla.renglones).toEqual([]);
    expect(tabla.totalPiezas).toBe(0);
  });
});

const DATOS: DatosImpresoEnvio = {
  empresa: 'FR Moda SA de CV',
  folio: 7,
  fecha: '2026-06-19',
  fechaCompromiso: '2026-06-26',
  maquilero: 'Maquila Costura SA',
  proceso: 'Costura',
  folioOrden: 42,
  precioPactado: 12.5,
  observaciones: 'Coser con hilo rojo',
  cancelado: false,
  tallas: ['CH', 'M'],
  renglones: [{ color: 'Rojo', cantidades: [10, 20], totalFila: 30 }],
  totalesColumna: [10, 20],
  totalPiezas: 30,
};

describe('generación de PDFs (F3-E2)', () => {
  it('el documento de envío genera un PDF no vacío', async () => {
    const buffer = await generarPdfEnvio(DATOS);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('la ficha de estampado genera un PDF no vacío', async () => {
    const buffer = await generarPdfFichaEstampado({ ...DATOS, proceso: 'Estampado' });
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
