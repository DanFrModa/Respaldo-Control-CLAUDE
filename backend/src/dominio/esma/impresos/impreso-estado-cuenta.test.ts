import { describe, expect, it } from 'vitest';

import type { DesglosadoSalida } from '../../../contrato/index.js';

import {
  avisoTruncadoTexto,
  columnasBloqueSaldo,
  generarPdfEstadoCuenta,
  marcaPendiente,
  type DatosImpresoEstadoCuenta,
} from './impreso-estado-cuenta.js';

/**
 * Unit del impreso del ESTADO DE CUENTA (F6-E5, R9) — SIN Postgres. Cubre que el PDF se genera con el
 * PAGADOR de la empresa (no hardcodeado) y con el detalle del desglosado.
 */
function desglosadoDePrueba(): DesglosadoSalida {
  return {
    idMaquilero: 5,
    maquilero: 'Maquila Costura SA',
    desde: '2026-06-01',
    hasta: '2026-06-30',
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
    abonos: [
      {
        id: 1,
        concepto: 'abono',
        idEmpresa: 1,
        idMaquilero: 5,
        maquilero: 'Maquila Costura SA',
        monto: 15,
        fecha: '2026-06-21',
        conFactura: null,
        observaciones: 'Anticipo',
        estadoRevision: 'capturado',
        creadoEn: '2026-06-21T00:00:00.000Z',
      },
    ],
    descuentos: [],
    pagos: [],
    // V1-E8k: el maquilero de verdad trae incompletas junto con lo bueno (§Post-F9.136). El fixture
    // las incluye para que el PDF se ejercite como se va a usar, no como se usaba antes de existir.
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
      // El abono de arriba está `capturado`: NO entra al saldo, entra al pendiente (fila 0.115).
      totalAbonos: 0,
      totalPagos: 0,
      totalDescuentos: 0,
      saldo: 80,
      pendienteRevision: {
        abonos: 15,
        pagos: 0,
        descuentos: 0,
        cargos: 0,
        neto: 15,
        partidas: 1,
        cargosPartidas: 0,
        cargosSinPrecio: 0,
      },
    },
  };
}

describe('impreso estado de cuenta (F6-E5)', () => {
  it('genera un PDF (buffer que empieza con %PDF)', async () => {
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: desglosadoDePrueba(),
      totales: { cargos: 1, abonos: 1, descuentos: 0, pagos: 0, incompletas: 1 },
    };
    const buffer = await generarPdfEstadoCuenta(datos);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('no avisa truncado cuando cada sección se muestra completa', () => {
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: desglosadoDePrueba(),
      totales: { cargos: 1, abonos: 1, descuentos: 0, pagos: 0, incompletas: 1 },
    };
    expect(avisoTruncadoTexto(datos)).toBeNull();
  });

  it('avisa las secciones truncadas y remite al Excel (totales del universo)', () => {
    // Se dibujó 1 cargo pero el universo tenía 300 → el aviso lo dice; el saldo NO se toca.
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: desglosadoDePrueba(),
      totales: { cargos: 300, abonos: 1, descuentos: 0, pagos: 0, incompletas: 1 },
    };
    const aviso = avisoTruncadoTexto(datos);
    expect(aviso).toContain('cargos 1 de 300');
    expect(aviso).toContain('Excel');
  });

  it('V1-E8k · avisa también cuando se truncan las PRENDAS INCOMPLETAS', () => {
    // Sin esta rama, un estado de cuenta con cientos de entregas incompletas mostraría 200 y
    // callaría las demás — el mismo bache que el aviso arregla para cargos/abonos/pagos.
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: desglosadoDePrueba(),
      totales: { cargos: 1, abonos: 1, descuentos: 0, pagos: 0, incompletas: 42 },
    };
    expect(avisoTruncadoTexto(datos)).toContain('prendas incompletas 1 de 42');
  });

  it('V1-E8k · el PDF se genera igual cuando NO hubo incompletas (la sección se omite)', async () => {
    const desglosado = desglosadoDePrueba();
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: { ...desglosado, incompletas: { filas: [], totalPiezas: 0 } },
      totales: { cargos: 1, abonos: 1, descuentos: 0, pagos: 0, incompletas: 0 },
    };
    const buffer = await generarPdfEstadoCuenta(datos);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// V1 · fila 0.115 — EL PAPEL TIENE QUE DECIR QUÉ NO ENTRÓ AL SALDO
//
// El estado de cuenta impreso LISTA las partidas capturadas y el saldo NO las cuenta. Si el pie no
// lo dijera, el maquilero vería un total más chico sin explicación — y el papel es la superficie
// menos recuperable de todas: se firma. Esto no lo cubría NINGUNA prueba hasta esta ronda.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('el pie del estado de cuenta declara lo que espera revisión', () => {
  /** El pie con el `pendienteRevision` que se le pase. */
  function etiquetas(pendiente: DesglosadoSalida['saldo']['pendienteRevision']): string[] {
    const d = desglosadoDePrueba();
    return columnasBloqueSaldo({ ...d.saldo, pendienteRevision: pendiente }).map((c) => c.etiqueta);
  }

  it('trae la columna «Por revisar» cuando hay partidas capturadas', () => {
    const columnas = columnasBloqueSaldo(desglosadoDePrueba().saldo);
    expect(columnas.map((c) => c.etiqueta)).toContain('Por revisar');
    expect(columnas.find((c) => c.etiqueta === 'Por revisar')?.valor).toBe(15);
    // Y el saldo sigue siendo la columna destacada del final.
    expect(columnas.at(-1)?.etiqueta).toBe('Saldo');
  });

  it('⭐ la trae TAMBIÉN cuando los importes netean cero (el caso que el neto escondía)', () => {
    // Abono capturado de 500 y pago capturado de 500: el neto es 0, pero son DOS partidas que el
    // detalle lista y los totales excluyen. Guiarse por el neto dejaba la hoja sin explicación.
    expect(
      etiquetas({
        abonos: 500,
        pagos: 500,
        descuentos: 0,
        cargos: 0,
        neto: 0,
        partidas: 2,
        cargosPartidas: 0,
        cargosSinPrecio: 0,
      }),
    ).toContain('Por revisar');
    // Y hasta cuando los tres subtotales netean cero entre sí (montos negativos del ETL).
    expect(
      etiquetas({
        abonos: 0,
        pagos: 0,
        descuentos: 0,
        cargos: 0,
        neto: 0,
        partidas: 2,
        cargosPartidas: 0,
        cargosSinPrecio: 0,
      }),
    ).toContain('Por revisar');
  });

  it('⭐ la trae cuando lo único pendiente son RECIBOS SIN VALIDAR (fila 0.111)', () => {
    // El pie se guía por el CONTEO de partidas, y desde la 0.111 ese conteo incluye los cargos
    // `propuesto`. Un maquilero cuyo único pendiente son recibos tiene que verlo en el papel que
    // se firma — es exactamente el caso que Daniel revisa cada semana.
    expect(
      etiquetas({
        abonos: 0,
        pagos: 0,
        descuentos: 0,
        cargos: 1200,
        neto: 1200,
        partidas: 3,
        cargosPartidas: 3,
        cargosSinPrecio: 0,
      }),
    ).toContain('Por revisar');
    // Y también cuando NINGUNO se puede valuar: el importe es 0 pero hay tres decisiones encima.
    expect(
      etiquetas({
        abonos: 0,
        pagos: 0,
        descuentos: 0,
        cargos: 0,
        neto: 0,
        partidas: 3,
        cargosPartidas: 3,
        cargosSinPrecio: 3,
      }),
    ).toContain('Por revisar');
  });

  it('NO la trae cuando no hay nada esperando revisión (el 99 % de los estados de cuenta)', () => {
    expect(
      etiquetas({
        abonos: 0,
        pagos: 0,
        descuentos: 0,
        cargos: 0,
        neto: 0,
        partidas: 0,
        cargosPartidas: 0,
        cargosSinPrecio: 0,
      }),
    ).not.toContain('Por revisar');
  });

  it('cada renglón dice si es él el que está por revisar (en el papel no hay botón)', () => {
    expect(marcaPendiente('capturado')).toContain('por revisar');
    expect(marcaPendiente('revisado')).toBe('');
  });

  it('el PDF se genera con partidas por revisar dentro', async () => {
    const datos: DatosImpresoEstadoCuenta = {
      pagador: 'FR MODA SA DE CV',
      desglosado: desglosadoDePrueba(),
      totales: { cargos: 1, abonos: 1, descuentos: 0, pagos: 0, incompletas: 1 },
    };
    const buffer = await generarPdfEstadoCuenta(datos);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
