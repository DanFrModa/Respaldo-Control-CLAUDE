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
 * cancelar SIN motivo rechazado), la PROYECCIÓN del total DERIVADO por suma de tallas (D4) y la
 * HERENCIA de la composición desde la ficha del modelo con su override por orden (Daniel
 * 24-jul-2026). La integridad transaccional real (folio por empresa, color duplicado, copiado por
 * etiqueta, referencia de otro cliente, búsqueda por referencia, estado derivado, bitácora) se
 * prueba contra Postgres en `ordenes.int.test.ts` (CI).
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
    ocCliente: null,
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
          // La composición del MODELO es la fuente de la de la orden (Daniel 24-jul-2026).
          modelo: { activo: true, codigo: '501', composicion: '100% ALGODÓN (MODELO)' },
          pedido: {
            idEmpresa: 1,
            idCliente: 3,
            pedCancelado: false,
            noProducir: false,
            folio: 100n,
            ocCliente: null,
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
    // El alta escribe el evento outbox `orden-creada` en la MISMA tx (R3, B5).
    eventoOutbox: { create: vi.fn(() => Promise.resolve({ id: 1 })) },
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

describe('dominio Órdenes — COMPOSICIÓN heredada del modelo (Daniel 24-jul-2026)', () => {
  /** Lee el `data` con el que se creó la orden en el stub. */
  function datosDelCreate(bd: ContextoBd): { composicion: string | null; compForzada: boolean } {
    const tx = bd.tx as unknown as {
      orden: { create: ReturnType<typeof vi.fn<(args: unknown) => Promise<unknown>>> };
    };
    const args = tx.orden.create.mock.calls[0]?.[0] as {
      data: { composicion: string | null; compForzada: boolean };
    };
    return args.data;
  }

  it('el alta SIN composición capturada hereda la del modelo (sin override)', async () => {
    const bd = bdParaCrear();
    await crearOrden(sesionAdmin(), { idPedidoLinea: 50 }, bd);
    expect(datosDelCreate(bd)).toMatchObject({
      composicion: '100% ALGODÓN (MODELO)',
      compForzada: false,
    });
  });

  it('el alta CON composición capturada la respeta y la marca como override', async () => {
    const bd = bdParaCrear();
    await crearOrden(sesionAdmin(), { idPedidoLinea: 50, composicion: '50/50 (A MANO)' }, bd);
    expect(datosDelCreate(bd)).toMatchObject({
      composicion: '50/50 (A MANO)',
      compForzada: true,
    });
  });

  /**
   * Stub para `actualizarOrden`: la orden guardada (findFirst) y el modelo con SU composición.
   * Devuelve el contexto + un lector del `data` con que se actualizó.
   */
  function bdParaActualizar(
    guardada: { composicion: string | null; compForzada: boolean },
    composicionModelo: string | null = '100% ALGODÓN (MODELO)',
  ): {
    bd: ContextoBd;
    cambios: () => Record<string, unknown>;
  } {
    const bd = bdParaCrear();
    const tx = bd.tx as unknown as {
      orden: {
        findFirst: ReturnType<typeof vi.fn<() => Promise<Record<string, unknown>>>>;
        update: ReturnType<typeof vi.fn<(args: unknown) => Promise<unknown>>>;
      };
      modelo?: unknown;
    };
    const original = tx.orden.findFirst.getMockImplementation();
    tx.orden.findFirst.mockImplementation(async () => ({ ...(await original?.()), ...guardada }));
    tx.modelo = {
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ composicion: composicionModelo })),
    };
    return {
      bd,
      cambios: () => (tx.orden.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data,
    };
  }

  it('editar la composición a mano la vuelve override (ya no se pisa con la del modelo)', async () => {
    const { bd, cambios } = bdParaActualizar({
      composicion: '100% ALGODÓN (MODELO)',
      compForzada: false,
    });
    await actualizarOrden(sesionAdmin(), { id: 1, composicion: 'MEZCLA ESPECIAL' }, bd);
    expect(cambios()).toMatchObject({ composicion: 'MEZCLA ESPECIAL', compForzada: true });
  });

  it('re-guardar el encabezado SIN tocar el campo NO convierte la heredada en override', async () => {
    const { bd, cambios } = bdParaActualizar({
      composicion: 'VIEJA DEL MODELO',
      compForzada: false,
    });
    // La UI reenvía el mismo texto que estaba: no es una captura, es el mismo valor.
    await actualizarOrden(sesionAdmin(), { id: 1, composicion: 'VIEJA DEL MODELO' }, bd);
    // Sigue sin override → se RE-DERIVA de la ficha del modelo (que ya cambió).
    expect(cambios()).toMatchObject({ composicion: '100% ALGODÓN (MODELO)', compForzada: false });
  });

  it('vaciar la composición la devuelve a la del modelo', async () => {
    const { bd, cambios } = bdParaActualizar({ composicion: 'MEZCLA ESPECIAL', compForzada: true });
    await actualizarOrden(sesionAdmin(), { id: 1, composicion: null }, bd);
    expect(cambios()).toMatchObject({ composicion: '100% ALGODÓN (MODELO)', compForzada: false });
  });

  it('con override, guardar el encabezado sin tocar la composición la CONSERVA', async () => {
    const { bd, cambios } = bdParaActualizar({ composicion: 'MEZCLA ESPECIAL', compForzada: true });
    await actualizarOrden(sesionAdmin(), { id: 1, composicion: 'MEZCLA ESPECIAL' }, bd);
    expect(cambios()).toMatchObject({ composicion: 'MEZCLA ESPECIAL', compForzada: true });
  });

  it('teclear EXACTAMENTE la del modelo NO desconecta la orden (sigue heredada)', async () => {
    const { bd, cambios } = bdParaActualizar({ composicion: null, compForzada: false });
    await actualizarOrden(sesionAdmin(), { id: 1, composicion: '100% ALGODÓN (MODELO)' }, bd);
    expect(cambios()).toMatchObject({
      composicion: '100% ALGODÓN (MODELO)',
      compForzada: false,
    });
  });

  // 🔒 Guard anti-pérdida: el caso REAL de las OPs históricas y las importadas por PDF, cuyo
  // modelo todavía no tiene composición capturada.
  it('guardar el encabezado de una OP histórica NO borra su composición si el modelo no tiene', async () => {
    const { bd, cambios } = bdParaActualizar(
      { composicion: '80% ALGODÓN 20% POLIÉSTER', compForzada: false },
      null, // el modelo NO tiene composición (la migración aditiva no hizo backfill)
    );
    // La UI reenvía el encabezado completo aunque el usuario solo cambió la fecha de entrega.
    await actualizarOrden(
      sesionAdmin(),
      { id: 1, fechaEntrega: '2026-08-01', composicion: '80% ALGODÓN 20% POLIÉSTER' },
      bd,
    );
    expect(cambios()).toMatchObject({
      composicion: '80% ALGODÓN 20% POLIÉSTER',
      compForzada: false,
    });
  });

  it('pero si el usuario VACÍA el campo a propósito y el modelo no tiene, sí queda vacía', async () => {
    const { bd, cambios } = bdParaActualizar(
      { composicion: '80% ALGODÓN 20% POLIÉSTER', compForzada: false },
      null,
    );
    await actualizarOrden(sesionAdmin(), { id: 1, composicion: null }, bd);
    expect(cambios()).toMatchObject({ composicion: null, compForzada: false });
  });

  it('con `compForzada: false` EXPLÍCITO manda la re-derivación, no el guard', async () => {
    const { bd, cambios } = bdParaActualizar(
      { composicion: '80% ALGODÓN 20% POLIÉSTER', compForzada: false },
      null, // el modelo no tiene composición
    );
    // El cuerpo pide explícitamente "sin override" Y un texto nuevo: gana lo pedido (re-derivar del
    // modelo). El guard NO se mete: solo cubre el guardado que no tocó el campo.
    await actualizarOrden(
      sesionAdmin(),
      { id: 1, composicion: 'TEXTO NUEVO', compForzada: false },
      bd,
    );
    expect(cambios()).toMatchObject({ composicion: null, compForzada: false });
  });

  it('el guard tampoco pisa un OVERRIDE cuando el modelo no tiene composición', async () => {
    const { bd, cambios } = bdParaActualizar(
      { composicion: 'MEZCLA ESPECIAL', compForzada: true },
      null,
    );
    await actualizarOrden(sesionAdmin(), { id: 1, composicion: 'MEZCLA ESPECIAL' }, bd);
    expect(cambios()).toMatchObject({ composicion: 'MEZCLA ESPECIAL', compForzada: true });
  });
});
