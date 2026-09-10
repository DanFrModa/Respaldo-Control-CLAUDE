import { describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { Prisma } from '../../datos/index.js';
import { cancelarPedido, crearPedido, listarPedidos } from './pedidos.js';

/**
 * Unit del dominio de Pedidos (F2-E1) — SIN Postgres. Cubre lo que no necesita la base: el
 * guard de permisos (deny-by-default, A4), la validación de captura (Zod) y, sobre todo, el
 * OCULTAMIENTO DE IMPORTES server-side (doc 02-Pedidos §3): la salida NO trae `precio`/`importe`
 * cuando la sesión no tiene `pedidos.importes`. La integridad transaccional real (folio por
 * empresa sin colisión, copiado de renglones seleccionados, réplica del pedido real, cancelación
 * suave) se prueba contra Postgres en `pedidos.int.test.ts` (CI).
 */

const sesionAdmin = (extra: ('pedidos.importes' | 'pedidos-reales.administrar')[] = []) =>
  sesionDePrueba({ permisos: ['pedidos.ver', 'pedidos.administrar', ...extra] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['pedidos.ver'] });

/** Servicio de archivos simulado: el listado/obtener no usan fotos en estos tests. */
const archivosStub = {
  urlDescarga: vi.fn(() => Promise.resolve('https://r2/firmada')),
} as unknown as ServicioArchivos;

/**
 * Stub de transacción para `crearPedido`: el cliente existe y activo, la secuencia devuelve un
 * folio, y al final `obtenerPedido` (que reusa el mismo `tx`) trae un pedido con UN renglón con
 * precio 50 × 10 = 500. `modeloFoto.findMany` vacío (sin fotos). Sirve para verificar la
 * proyección (importes visibles u ocultos).
 */
function bdParaCrear(): ContextoBd {
  const pedidoDetallado = {
    id: 1,
    folio: 7n,
    idEmpresa: 1,
    idCliente: 3,
    cliente: { nombre: 'Liverpool' },
    fechaPedido: null,
    fechaDe: null,
    fechaHasta: null,
    fechaTela: null,
    fechaElaboracion: null,
    entregadoTienda: false,
    noProducir: false,
    pedCancelado: false,
    idOrdCompraV1: null,
    creadoEn: new Date('2026-06-15T00:00:00Z'),
    creadoPorId: 'usuario-prueba',
    modificadoEn: new Date('2026-06-15T00:00:00Z'),
    modificadoPorId: 'usuario-prueba',
    lineas: [
      {
        id: 11,
        idModelo: 9,
        cantidadPedida: 10,
        precio: new Prisma.Decimal('50.00'),
        entregadoParcialV1: null,
        cantFaltanteV1: null,
        idDesarrollo: null,
        // V1-E3: el renglón apunta a un modelo de DESARROLLO → su nº es null para siempre.
        modelo: { codigo: 'CYA-26-71-009', descripcion: 'Playera', numeroProduccion: null },
      },
    ],
  };

  /**
   * ⭐⭐ V1-E3 — las OPs VIVAS del renglón 11, para el agregado de `numerosProduccion`.
   *
   * 🔴 **El doble FILTRA por los ids que le piden** (no devuelve la lista fija pase lo que pase):
   * si el dominio dejara de pasar los renglones de la página —o pasara otros— este stub devolvería
   * `[]` y la prueba se pondría ROJA. Un doble que ignora su argumento habría dejado pasar el
   * cableado roto en verde.
   *
   * Las tres filas cubren de una vez las tres reglas: **desordenadas** (71002 antes que 71001),
   * con un **resurtido** del mismo modelo (que NO debe repetir su número) y con una OP de un modelo
   * **SIN número** (el histórico `M-18`, que no puede meter un `null` en un `number[]`).
   */
  const opsVivasPorLinea = new Map([
    [
      11,
      [
        { idPedidoLinea: 11, modelo: { numeroProduccion: 71_002 } },
        { idPedidoLinea: 11, modelo: { numeroProduccion: 71_001 } },
        { idPedidoLinea: 11, modelo: { numeroProduccion: 71_002 } },
        { idPedidoLinea: 11, modelo: { numeroProduccion: null } },
      ],
    ],
  ]);

  const tx = {
    orden: {
      findMany: vi.fn((args: { where: { idPedidoLinea: { in: number[] } } }) =>
        Promise.resolve(
          args.where.idPedidoLinea.in.flatMap((id) => opsVivasPorLinea.get(id) ?? []),
        ),
      ),
    },
    cliente: { findUnique: vi.fn(() => Promise.resolve({ activo: true, nombre: 'Liverpool' })) },
    modelo: {
      findMany: vi.fn(() => Promise.resolve([{ id: 9, activo: true, codigo: '501' }])),
    },
    pedido: {
      create: vi.fn(() => Promise.resolve({ id: 1 })),
      findFirst: vi.fn(() => Promise.resolve(pedidoDetallado)),
    },
    pedidoLinea: {
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args.data)),
    },
    modeloFoto: { findMany: vi.fn(() => Promise.resolve([])) },
    bitacora: { create: vi.fn(() => Promise.resolve({})) },
    // `siguienteFolio` usa $queryRaw con tagged template → devuelve la fila con el folio.
    $queryRaw: vi.fn(() => Promise.resolve([{ valor: 7n }])),
  } as unknown as Tx;

  return { tx };
}

describe('dominio Pedidos (F2-E1) — permisos (deny-by-default, A4)', () => {
  it('crear sin permiso administrar → ErrorPermiso', async () => {
    await expect(
      crearPedido(sesionSoloVer(), { idCliente: 1, lineas: [] }, {}, archivosStub),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('cancelar sin permiso administrar → ErrorPermiso', async () => {
    await expect(cancelarPedido(sesionSoloVer(), 1, {}, {}, archivosStub)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('listar sin permiso ver → ErrorPermiso', async () => {
    await expect(
      listarPedidos(sesionDePrueba({ permisos: [] }), {}, {}, archivosStub),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('dominio Pedidos (F2-E1) — validación de captura (A1)', () => {
  it('crear sin cliente → ErrorValidacion', async () => {
    await expect(
      crearPedido(sesionAdmin(), { lineas: [] } as never, {}, archivosStub),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear con cantidad 0 en un renglón → ErrorValidacion', async () => {
    await expect(
      crearPedido(
        sesionAdmin(),
        { idCliente: 1, lineas: [{ idModelo: 9, cantidadPedida: 0, precio: 10 }] },
        {},
        archivosStub,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear con precio negativo → ErrorValidacion', async () => {
    await expect(
      crearPedido(
        sesionAdmin(),
        { idCliente: 1, lineas: [{ idModelo: 9, cantidadPedida: 1, precio: -1 }] },
        {},
        archivosStub,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('dominio Pedidos (F2-E1) — ocultamiento de importes server-side (doc 02 §3)', () => {
  const entrada = {
    idCliente: 3,
    lineas: [{ idModelo: 9, cantidadPedida: 10, precio: 50 }],
  };

  it('CON permiso pedidos.importes: el JSON trae precio, importe y total', async () => {
    const salida = await crearPedido(
      sesionAdmin(['pedidos.importes']),
      entrada,
      bdParaCrear(),
      archivosStub,
    );
    expect(salida.lineas[0]?.precio).toBe(50);
    expect(salida.lineas[0]?.importe).toBe(500);
    expect(salida.totalImporte).toBe(500);
    // Las piezas se ven SIEMPRE (no son importe en $).
    expect(salida.totalPiezas).toBe(10);
  });

  it('SIN permiso pedidos.importes: el JSON NO trae precio/importe/total (en null, no solo oculto en UI)', async () => {
    const salida = await crearPedido(sesionAdmin(), entrada, bdParaCrear(), archivosStub);
    expect(salida.lineas[0]?.precio).toBeNull();
    expect(salida.lineas[0]?.importe).toBeNull();
    expect(salida.totalImporte).toBeNull();
    // Las piezas SÍ se ven aunque no pueda ver importes.
    expect(salida.totalPiezas).toBe(10);
  });
});

/**
 * ⭐⭐ V1-E3 (§Post-F9.172(b)) — **el nº de 5 dígitos que el detalle del pedido había perdido.**
 *
 * Hasta V1-E3 el renglón lo enseñaba por accidente (pintaba `codigoModelo`, que *era* el de
 * producción porque generar la OP transformaba el modelo). Hoy el desarrollo NO se transforma:
 * `numeroProduccion` del renglón es null para siempre y los números están en los modelos POR COLOR
 * de sus OPs. La vista del MES ya los traía; el detalle no, y ésta es la mitad que faltaba.
 */
describe('⭐⭐ Pedidos — nº de producción por color en el detalle (V1-E3)', () => {
  const entrada = { idCliente: 3, lineas: [{ idModelo: 9, cantidadPedida: 10, precio: 50 }] };

  it('agrega los nº de las OPs vivas: ordenados, SIN repetir y sin colar un null', async () => {
    const salida = await crearPedido(sesionAdmin(), entrada, bdParaCrear(), archivosStub);

    // El renglón sigue siendo del DESARROLLO, que no tiene número…
    expect(salida.lineas[0]?.codigoModelo).toBe('CYA-26-71-009');
    expect(salida.lineas[0]?.numeroProduccion).toBeNull();
    // …y lo que se enseña son los de sus modelos por color. El 71002 venía repetido (resurtido) y
    // primero; la OP del modelo sin número (`M-18`) no aporta un `null` al `number[]` del contrato.
    expect(salida.lineas[0]?.numerosProduccion).toEqual([71_001, 71_002]);
  });

  it('🔴 LA GEMELA — un renglón SIN OPs vivas sale VACÍO, no con un hueco ni un cero', async () => {
    const bd = bdParaCrear();
    // Mismo camino, misma proyección; lo único que cambia es que no hay ninguna OP que agregar.
    (bd.tx as unknown as { orden: { findMany: ReturnType<typeof vi.fn> } }).orden.findMany = vi.fn(
      () => Promise.resolve([]),
    );

    const salida = await crearPedido(sesionAdmin(), entrada, bd, archivosStub);

    expect(salida.lineas[0]?.numerosProduccion).toEqual([]);
    expect(salida.lineas[0]?.numeroProduccion).toBeNull();
  });
});
