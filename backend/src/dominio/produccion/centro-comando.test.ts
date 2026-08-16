import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { centroComandoOrdenes } from './centro-comando.js';

/**
 * Unit del CENTRO DE COMANDO de órdenes (rediseño R2, §4.2) — SIN Postgres. Cubre el guard de
 * permiso (A4), la validación de filtros, el corto-circuito A9 (idEmpresa ≠ activa → página vacía
 * SIN tocar la base) y la PROYECCIÓN/agregación por lote (Σ cortada, primer maquilero de costura +
 * distintos, primer aplicador, OC de tela más reciente, mes de entrega). Los filtros contra datos
 * reales (envíos cancelados fuera, OC en borrador no cuenta, mes por EXTRACT) viven en
 * `centro-comando.int.test.ts` (CI).
 */

const sesionVer = () => sesionDePrueba({ permisos: ['ordenes.ver'] });

/**
 * Fila cruda de la orden del stub (lo que devuelve `findMany` con el select del centro). Vive
 * fuera de `bdStub` para que un test pueda re-emitirla con un cambio puntual.
 */
function ordenBase() {
  return {
    id: 10,
    folio: 5424n,
    estado: 'completa',
    idEmpresa: 1,
    empresa: { nombre: 'FR Moda' },
    idModelo: 3,
    // Insumos de la regla de "orden completa" (`requisitos-orden.ts`). V1-E3d: la casilla del
    // MODELO + los datos de la ORDEN. Esta orden NO tiene su receta liberada → `faltantes: ['receta']`.
    modelo: { codigo: '62182', descripcion: 'Sudadera', llevaArte: false },
    recetaLiberadaEn: null as Date | null,
    _count: { lineas: 3, recetaArtes: 2 },
    idMaquilero: 77,
    maquilero: { nombre: 'Asignado SA' },
    fechaEntrega: new Date('2026-07-04T00:00:00Z'),
    idCliente: 4,
    cliente: { nombre: 'C&A' },
    pedidoLinea: { pedido: { id: 9, folio: 1485n } },
    referencias: [{ valor: '613609' }],
  };
}

/** Stub de lectura: 1 orden con cortes (2 vivos), envíos a 2 maquileros + 1 estampador y 2 OC. */
function bdStub() {
  const orden = ordenBase();
  const tx = {
    orden: {
      count: vi.fn(() => Promise.resolve(1)),
      findMany: vi.fn(() => Promise.resolve([orden])),
    },
    // totalesPorOrden (consultas.ts): groupBy por renglón + mapeo renglón→orden.
    ordenLineaTalla: {
      groupBy: vi.fn(() => Promise.resolve([{ idOrdenLinea: 100, _sum: { cantidad: 1726 } }])),
    },
    ordenLinea: {
      findMany: vi.fn(() => Promise.resolve([{ id: 100, idOrden: 10 }])),
    },
    etapaMovimiento: {
      findMany: vi.fn((args: { where: { tipo: string } }) => {
        if (args.where.tipo === 'corte') {
          return Promise.resolve([
            { idOrden: 10, detalles: [{ cantidad: 1000 }, { cantidad: 500 }] },
            { idOrden: 10, detalles: [{ cantidad: 226 }] },
          ]);
        }
        // Envíos vivos ordenados por folio asc: costura a 2 maquileros + aplicación a 1.
        return Promise.resolve([
          {
            idOrden: 10,
            idTercero: 7,
            tercero: { nombre: 'Óscar Jiménez' },
            tipoProceso: { generaEntradaPt: true },
          },
          {
            idOrden: 10,
            idTercero: 8,
            tercero: { nombre: 'Rima Textil' },
            tipoProceso: { generaEntradaPt: true },
          },
          {
            idOrden: 10,
            idTercero: 9,
            tercero: { nombre: 'Estampados Rico' },
            tipoProceso: { generaEntradaPt: false },
          },
        ]);
      }),
    },
    // OC de tela ordenadas por idOrdenCompra DESC: la primera (más reciente) gana.
    ordenCompraLinea: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { idOrden: 10, idOrdenCompra: 52, ordenCompra: { numCompra: 7654n } },
          { idOrden: 10, idOrdenCompra: 40, ordenCompra: { numCompra: 7600n } },
        ]),
      ),
    },
    $queryRaw: vi.fn(() => Promise.resolve([])),
  };
  const bd: ContextoBd = { tx: tx as unknown as Tx };
  return { bd, tx };
}

describe('centro de comando — permisos y validación (A4/A1)', () => {
  it('sin ordenes.ver → ErrorPermiso', async () => {
    await expect(centroComandoOrdenes(sesionDePrueba({ permisos: [] }), {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('mesEntrega fuera de rango → ErrorValidacion', async () => {
    await expect(centroComandoOrdenes(sesionVer(), { mesEntrega: 13 })).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});

describe('centro de comando — A9 (empresa activa manda)', () => {
  it('idEmpresa distinto de la activa → página VACÍA sin tocar la base', async () => {
    const { bd, tx } = bdStub();
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, { idEmpresa: 99 }, bd);
    expect(pagina.datos).toEqual([]);
    expect(pagina.total).toBe(0);
    expect(tx.orden.count).not.toHaveBeenCalled();
    expect(tx.orden.findMany).not.toHaveBeenCalled();
  });
});

describe('centro de comando — proyección de las 13 columnas (agregado por lote)', () => {
  it('deriva cortada (Σ cortes), maquilero del PRIMER envío costura, ×N, estampador, OC y mes', async () => {
    const { bd } = bdStub();
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    expect(pagina.total).toBe(1);
    const fila = pagina.datos[0];
    expect(fila).toBeDefined();
    if (fila === undefined) return;

    expect(fila.folio).toBe(5424);
    expect(fila.empresa).toBe('FR Moda');
    expect(fila.codigoModelo).toBe('62182');
    expect(fila.pedidoCliente).toBe('613609'); // primera referencia D7
    expect(fila.cantOrdenada).toBe(1726); // Σ matriz
    expect(fila.cantCortada).toBe(1726); // Σ de los 2 cortes vivos (1000+500+226)
    // Al que SE MANDÓ: primer envío de costura vivo (no el asignado del encabezado).
    expect(fila.maquilero).toBe('Óscar Jiménez');
    expect(fila.idMaquilero).toBe(7);
    expect(fila.numMaquileros).toBe(2); // badge ×2
    expect(fila.estampador).toBe('Estampados Rico');
    expect(fila.folioPedido).toBe(1485); // el "-F"
    expect(fila.idPedido).toBe(9);
    expect(fila.ocTelaFolio).toBe(7654); // la OC de tela más reciente
    expect(fila.idOcTela).toBe(52);
    expect(fila.mesEntrega).toBe(7); // julio (de fechaEntrega)
    expect(fila.fechaEntrega).toBe('2026-07-04');
    expect(fila.cliente).toBe('C&A');
    // Transparencia del estado: la orden del stub tiene matriz y arte pero su receta NO está
    // liberada por Desarrollo (V1-E3d).
    expect(fila.faltantes).toEqual(['receta']);
  });

  it('faltantes: vacío cuando Desarrollo ya liberó la receta de la orden (V1-E3d)', async () => {
    const { bd, tx } = bdStub();
    tx.orden.findMany.mockImplementation(() =>
      Promise.resolve([{ ...ordenBase(), recetaLiberadaEn: new Date('2026-08-15T00:00:00Z') }]),
    );
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    expect(pagina.datos[0]?.faltantes).toEqual([]);
  });

  it('faltantes: una orden CANCELADA no lista requisitos (su estado no lo manda la regla)', async () => {
    const { bd, tx } = bdStub();
    tx.orden.findMany.mockImplementation(() =>
      Promise.resolve([
        { ...ordenBase(), estado: 'cancelada', _count: { lineas: 0, recetaArtes: 0 } },
      ]),
    );
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, { incluirCanceladas: true }, bd);
    expect(pagina.datos[0]?.faltantes).toEqual([]);
  });

  it('sin envíos ni OC: cae al maquilero ASIGNADO, numMaquileros 0 y ocTela null ("falta")', async () => {
    const { bd, tx } = bdStub();
    tx.etapaMovimiento.findMany.mockImplementation(() => Promise.resolve([]));
    tx.ordenCompraLinea.findMany.mockImplementation(() => Promise.resolve([]));
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    const fila = pagina.datos[0];
    if (fila === undefined) throw new Error('fila esperada');
    expect(fila.maquilero).toBe('Asignado SA');
    expect(fila.idMaquilero).toBe(77);
    expect(fila.numMaquileros).toBe(0);
    expect(fila.estampador).toBeNull();
    expect(fila.cantCortada).toBe(0);
    expect(fila.ocTelaFolio).toBeNull();
    expect(fila.idOcTela).toBeNull();
  });
});
