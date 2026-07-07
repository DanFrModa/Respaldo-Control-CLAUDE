import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarOrden,
  cancelarOrden,
  crearOrden,
  guardarMatrizOrden,
  listarOrdenes,
  obtenerOrden,
} from './ordenes.js';

/**
 * Unit del dominio de Órdenes (F2-E2) — SIN Postgres. Cubre lo que no necesita la base: el guard
 * de permisos (deny-by-default, A4), la validación de captura (Zod: orden SIN pedido rechazada,
 * cancelar SIN motivo rechazado) y la PROYECCIÓN del total DERIVADO por suma de tallas (D4). La
 * integridad transaccional real (folio por empresa, color duplicado, copiado por etiqueta,
 * referencia de otro cliente, búsqueda por referencia, estado derivado, bitácora) se prueba contra
 * Postgres en `ordenes.int.test.ts` (CI).
 */

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.administrar', 'ordenes.cancelar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['ordenes.ver'] });

/**
 * Stub de transacción para `crearOrden`: el renglón de pedido existe (empresa 1, pedido vivo,
 * modelo activo), la secuencia devuelve un folio, y al final `obtenerOrden` (mismo `tx`) trae una
 * orden con UNA matriz: color Rojo con tallas CH=10 y M=5 → total 15. Sirve para verificar la
 * proyección del total derivado.
 */
function bdParaCrear(): ContextoBd {
  const ordenDetallada = {
    id: 1,
    folio: 7n,
    idEmpresa: 1,
    estado: 'completa',
    idPedidoLinea: 50,
    idModelo: 9,
    cliente: { nombre: 'Liverpool' },
    modelo: { codigo: '501', descripcion: 'Playera' },
    maquilero: null,
    etiquetaMarca: null,
    tela: null,
    idCliente: 3,
    idMaquilero: null,
    idEtiquetaMarca: null,
    idTela: null,
    fecha: null,
    fechaEntrega: null,
    observaciones: null,
    composicion: null,
    compForzada: false,
    obsMaquila: null,
    noCostear: false,
    fechaCompletada: new Date('2026-06-16T00:00:00Z'),
    motivoCancelada: null,
    tallasV1: null,
    maquilaOrd: null,
    aplicacionOrd: null,
    pagada: null,
    enRiesgo: null,
    siRC: null,
    rcViva: null,
    lineas: [
      {
        id: 11,
        idColor: 2,
        color: { nombre: 'Rojo' },
        tallas: [
          { id: 100, idTalla: 1, cantidad: 10, talla: { etiqueta: 'CH' } },
          { id: 101, idTalla: 2, cantidad: 5, talla: { etiqueta: 'M' } },
        ],
      },
    ],
    referencias: [],
    comentarios: [],
    creadoEn: new Date('2026-06-16T00:00:00Z'),
    creadoPorId: 'usuario-prueba',
    modificadoEn: new Date('2026-06-16T00:00:00Z'),
    modificadoPorId: 'usuario-prueba',
  };

  const tx = {
    pedidoLinea: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          idModelo: 9,
          modelo: { activo: true, codigo: '501' },
          pedido: {
            idEmpresa: 1,
            idCliente: 3,
            pedCancelado: false,
            noProducir: false,
            folio: 100n,
          },
        }),
      ),
    },
    orden: {
      create: vi.fn(() => Promise.resolve({ id: 1 })),
      update: vi.fn(() => Promise.resolve({})),
      findFirst: vi.fn(() => Promise.resolve(ordenDetallada)),
    },
    bitacora: { create: vi.fn(() => Promise.resolve({})) },
    // `siguienteFolio` usa $queryRaw con tagged template → devuelve la fila con el folio.
    $queryRaw: vi.fn(() => Promise.resolve([{ valor: 7n }])),
  } as unknown as Tx;

  return { tx };
}

describe('dominio Órdenes (F2-E2) — permisos (deny-by-default, A4)', () => {
  it('crear sin permiso administrar → ErrorPermiso', async () => {
    await expect(crearOrden(sesionSoloVer(), { idPedidoLinea: 1 }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('actualizar sin permiso administrar → ErrorPermiso', async () => {
    await expect(actualizarOrden(sesionSoloVer(), { id: 1 }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('guardar matriz sin permiso administrar → ErrorPermiso', async () => {
    await expect(guardarMatrizOrden(sesionSoloVer(), 1, { lineas: [] }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('cancelar requiere permiso PROPIO ordenes.cancelar (administrar no basta)', async () => {
    const soloAdmin = sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.administrar'] });
    await expect(cancelarOrden(soloAdmin, 1, { motivo: 'x' }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('listar sin permiso ver → ErrorPermiso', async () => {
    await expect(listarOrdenes(sesionDePrueba({ permisos: [] }), {}, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('dominio Órdenes (F2-E2) — validación de captura (A1)', () => {
  it('crear SIN idPedidoLinea → ErrorValidacion (orden sin pedido = solo histórico, no captura)', async () => {
    await expect(crearOrden(sesionAdmin(), {} as never, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('crear con idPedidoLinea no positivo → ErrorValidacion', async () => {
    await expect(crearOrden(sesionAdmin(), { idPedidoLinea: 0 }, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('cancelar SIN motivo → ErrorValidacion (el motivo es obligatorio)', async () => {
    await expect(cancelarOrden(sesionAdmin(), 1, { motivo: '   ' }, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('matriz con cantidad negativa → ErrorValidacion', async () => {
    await expect(
      guardarMatrizOrden(
        sesionAdmin(),
        1,
        { lineas: [{ idColor: 2, tallas: [{ idTalla: 1, cantidad: -1 }] }] },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('dominio Órdenes (F2-E2) — total derivado por suma (D4)', () => {
  it('crear desde un renglón de pedido proyecta el total como Σ de las tallas', async () => {
    const salida = await crearOrden(sesionAdmin(), { idPedidoLinea: 50 }, bdParaCrear());
    expect(salida.folio).toBe(7);
    expect(salida.idModelo).toBe(9); // autorrellenado del renglón de pedido
    expect(salida.idCliente).toBe(3); // autorrellenado del pedido
    expect(salida.lineas).toHaveLength(1);
    expect(salida.lineas[0]?.totalPiezas).toBe(15); // 10 + 5
    expect(salida.totalPiezas).toBe(15); // total de la orden = Σ de todas las tallas
  });
});

describe('dominio Órdenes (R2) — redacción de precios en la salida (§4.4.3)', () => {
  /**
   * Desde R2 `maquilaOrd`/`aplicacionOrd` son el PRECIO REAL negociado: sin el permiso
   * `ordenes.ver-precio-real-maquila` van null en la salida (antes eran dato inerte del ETL).
   */
  function bdConPrecios(): ContextoBd {
    const bd = bdParaCrear();
    const tx = bd.tx as unknown as {
      orden: { findFirst: ReturnType<typeof vi.fn<() => Promise<Record<string, unknown>>>> };
    };
    // Envuelve el stub original y le pone precios reales capturados.
    const original = tx.orden.findFirst.getMockImplementation();
    tx.orden.findFirst.mockImplementation(async () => ({
      ...(await original?.()),
      maquilaOrd: { toNumber: () => 27.5 },
      aplicacionOrd: { toNumber: () => 6 },
    }));
    return bd;
  }

  it('sin ver-precio-real-maquila la salida oculta maquilaOrd/aplicacionOrd', async () => {
    const salida = await obtenerOrden(sesionSoloVer(), 1, bdConPrecios());
    expect(salida.maquilaOrd).toBeNull();
    expect(salida.aplicacionOrd).toBeNull();
  });

  it('con ver-precio-real-maquila la salida sí trae los montos', async () => {
    const sesion = sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.ver-precio-real-maquila'] });
    const salida = await obtenerOrden(sesion, 1, bdConPrecios());
    expect(salida.maquilaOrd).toBe(27.5);
    expect(salida.aplicacionOrd).toBe(6);
  });
});
