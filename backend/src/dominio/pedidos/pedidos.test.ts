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
        modelo: { codigo: '501', descripcion: 'Playera' },
      },
    ],
  };

  const tx = {
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
    await expect(cancelarPedido(sesionSoloVer(), 1, {}, archivosStub)).rejects.toBeInstanceOf(
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
