import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { DesglosadoSalida } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';

import { excelEstadoCuenta } from './excel-estado-cuenta.js';

/**
 * Unit del export a Excel del ESTADO DE CUENTA (F6-E5) — SIN Postgres. Reusa el desglosado vía deps
 * inyectadas (un fake que no toca la BD) y verifica que se genera un `.xlsx` no vacío (firma ZIP "PK").
 */
function desglosadoFake(): DesglosadoSalida {
  return {
    idMaquilero: 5,
    maquilero: 'Maquila Costura SA',
    desde: null,
    hasta: null,
    conFactura: null,
    cargos: [
      {
        idCargo: 1,
        fecha: '2026-06-20',
        folioOrden: 100,
        codigoModelo: 'A-100',
        descripcionModelo: 'Playera',
        tipoProceso: 'Costura',
        cantidad: 10,
        precio: 8,
        importe: 80,
        sinCosto: false,
        conFactura: null,
      },
    ],
    // Un abono y un pago CAPTURADOS del mismo importe: netean cero pero son DOS partidas que el
    // detalle lista y el saldo no cuenta (V1, fila 0.115). Es el caso que hay que ver en el papel.
    abonos: [
      {
        id: 1,
        concepto: 'abono' as const,
        idEmpresa: 1,
        idMaquilero: 5,
        maquilero: 'Maquila Costura SA',
        monto: 500,
        fecha: '2026-06-21',
        conFactura: null,
        observaciones: 'Anticipo',
        estadoRevision: 'capturado' as const,
        creadoEn: '2026-06-21T00:00:00.000Z',
      },
    ],
    descuentos: [],
    pagos: [
      {
        id: 2,
        idEmpresa: 1,
        idMaquilero: 5,
        maquilero: 'Maquila Costura SA',
        monto: 500,
        fecha: '2026-06-22',
        conFactura: null,
        observaciones: null,
        estadoRevision: 'capturado' as const,
        aplicaciones: [],
        creadoEn: '2026-06-22T00:00:00.000Z',
      },
    ],
    // V1-E8k (§Post-F9.136): el fixture trae una entrega de prendas incompletas, que es como se ve
    // el mundo que Daniel describió — un recibo con lo bueno Y lo que no se pudo coser.
    incompletas: {
      filas: [
        {
          idRecibo: 77,
          folioRecibo: 77,
          fecha: '2026-06-20',
          idOrden: 9,
          folioOrden: 100,
          codigoModelo: 'A-100',
          descripcionModelo: 'Playera',
          tipoProceso: 'Costura',
          piezas: 5,
        },
      ],
      totalPiezas: 5,
    },
    saldo: {
      idMaquilero: 5,
      maquilero: 'Maquila Costura SA',
      conFactura: null,
      totalCargos: 80,
      totalAbonos: 0,
      totalPagos: 0,
      totalDescuentos: 0,
      saldo: 80,
      pendienteRevision: {
        abonos: 500,
        pagos: 500,
        descuentos: 0,
        cargos: 0,
        neto: 0,
        partidas: 2,
        cargosPartidas: 0,
        cargosSinPrecio: 0,
      },
    },
  };
}

describe('excel estado de cuenta (F6-E5)', () => {
  it('genera un .xlsx no vacío (firma ZIP "PK")', async () => {
    const sesionFake = {} as SesionUsuario;
    const { buffer } = await excelEstadoCuenta(sesionFake, 5, {}, undefined, {
      estadoCuentaDesglosado: () => Promise.resolve(desglosadoFake()),
    });
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('V1-E8k · la hoja de prendas incompletas se crea aunque no haya ninguna', async () => {
    // La forma del archivo no puede depender de si hubo incompletas: quien lo abre siempre
    // encuentra las mismas cuatro hojas.
    const sesionFake = {} as SesionUsuario;
    const { buffer } = await excelEstadoCuenta(sesionFake, 5, {}, undefined, {
      estadoCuentaDesglosado: () =>
        Promise.resolve({ ...desglosadoFake(), incompletas: { filas: [], totalPiezas: 0 } }),
    });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual([
      'Cargos',
      'Movimientos',
      'Prendas incompletas',
      'Resumen',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// V1 · fila 0.115 — EL EXCEL TAMBIÉN DICE QUÉ NO ENTRÓ AL SALDO
// Hasta esta ronda, el renglón «Por revisar» y la columna «Revisión» no tenían NINGUNA prueba: se
// podían borrar enteros y el CI seguía verde.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('el Excel declara lo que espera revisión', () => {
  /** Genera el libro con el desglosado dado y lo vuelve a abrir. */
  async function libroDe(desglosado: DesglosadoSalida): Promise<ExcelJS.Workbook> {
    const { buffer } = await excelEstadoCuenta({} as SesionUsuario, 5, {}, undefined, {
      estadoCuentaDesglosado: () => Promise.resolve(desglosado),
    });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    return libro;
  }

  /** El valor de una celda como texto plano (ExcelJS devuelve `unknown`: fórmulas, richText…). */
  function texto(valor: ExcelJS.CellValue): string {
    return typeof valor === 'object' && valor !== null
      ? JSON.stringify(valor)
      : String(valor ?? '');
  }

  /** Los pares concepto/valor de la hoja Resumen. */
  function resumen(libro: ExcelJS.Workbook): Map<string, ExcelJS.CellValue> {
    const hoja = libro.getWorksheet('Resumen');
    const pares = new Map<string, ExcelJS.CellValue>();
    hoja?.eachRow((fila, i) => {
      if (i === 1) return;
      pares.set(texto(fila.getCell(1).value), fila.getCell(2).value);
    });
    return pares;
  }

  /** Los encabezados de una hoja, ya como texto. */
  function encabezadosDe(hoja: ExcelJS.Worksheet | undefined): string[] {
    return ((hoja?.getRow(1).values ?? []) as ExcelJS.CellValue[]).map(texto);
  }

  it('⭐ el Resumen trae «Por revisar» y el CONTEO, aunque los importes neteen cero', async () => {
    const libro = await libroDe(desglosadoFake());
    const filas = resumen(libro);
    expect(filas.has('Por revisar (no suma)')).toBe(true);
    expect(filas.get('Por revisar (no suma)')).toBe(0); // netean entre sí…
    expect(filas.get('Partidas por revisar')).toBe(2); // …pero son dos partidas reales
    expect(filas.get('Saldo')).toBe(80);
  });

  it('la hoja de movimientos marca CUÁLES partidas están por revisar', async () => {
    const libro = await libroDe(desglosadoFake());
    const hoja = libro.getWorksheet('Movimientos');
    const encabezados = encabezadosDe(hoja);
    expect(encabezados).toContain('Revisión');
    const columna = encabezados.indexOf('Revisión');
    const marcas: string[] = [];
    hoja?.eachRow((fila, i) => {
      if (i === 1) return;
      marcas.push(texto(fila.getCell(columna).value));
    });
    // El abono y el pago del fixture están capturados: los dos renglones lo dicen.
    expect(marcas).toEqual(['Por revisar', 'Por revisar']);
  });

  it('con todo revisado, los renglones se marcan como revisados y el conteo es 0', async () => {
    const base = desglosadoFake();
    const libro = await libroDe({
      ...base,
      abonos: base.abonos.map((a) => ({ ...a, estadoRevision: 'revisado' as const })),
      pagos: base.pagos.map((p) => ({ ...p, estadoRevision: 'revisado' as const })),
      saldo: {
        ...base.saldo,
        pendienteRevision: {
          abonos: 0,
          pagos: 0,
          descuentos: 0,
          cargos: 0,
          neto: 0,
          partidas: 0,
          cargosPartidas: 0,
          cargosSinPrecio: 0,
        },
      },
    });
    expect(resumen(libro).get('Partidas por revisar')).toBe(0);
    const hoja = libro.getWorksheet('Movimientos');
    const encabezados = encabezadosDe(hoja);
    const columna = encabezados.indexOf('Revisión');
    expect(texto(hoja?.getRow(2).getCell(columna).value)).toBe('Revisado');
  });
});
