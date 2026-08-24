/**
 * Resolución del tercero de un movimiento de cuenta corriente: **los días de crédito del CLIENTE**
 * (§Post-F9.98). Prueba unitaria (sin BD) con un `tx` falso; la de integración vive en
 * `terceros-motor.int.test.ts` / `cxc/cxc.int.test.ts`.
 *
 * ⚠️ El `tx` falso **respeta el `select`**: sólo devuelve los campos que la consulta pidió, igual que
 * Prisma. Eso es lo que le da valor a la prueba — si alguien vuelve a dejar `diasCredito` fuera del
 * `select` del cliente, la fila llega sin el campo y el plazo se cae a 0, que es exactamente el
 * defecto que esta prueba existe para no repetir.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { type Tx } from '../../comun/transaccion.js';

import { exigirTercero } from './terceros.js';

type FilaFalsa = Record<string, unknown>;

/** Proyecta la fila por el `select` recibido (lo que Prisma haría): lo no pedido, no llega. */
function proyectar(fila: FilaFalsa, select: Record<string, boolean> | undefined): FilaFalsa {
  const salida: FilaFalsa = {};
  for (const [campo, pedido] of Object.entries(select ?? {})) {
    if (pedido && campo in fila) {
      salida[campo] = fila[campo];
    }
  }
  return salida;
}

/** `tx` falso con UNA fila en la tabla indicada (o ninguna, para el caso "no existe"). */
function txCon(tabla: 'cliente' | 'proveedor', fila: FilaFalsa | null): Tx {
  const findUnique = vi.fn((args: { select?: Record<string, boolean> }) =>
    Promise.resolve(fila === null ? null : proyectar(fila, args.select)),
  );
  const vacia = { findUnique: vi.fn(() => Promise.resolve(null)) };
  return {
    cliente: tabla === 'cliente' ? { findUnique } : vacia,
    proveedor: tabla === 'proveedor' ? { findUnique } : vacia,
  } as unknown as Tx;
}

describe('exigirTercero — días de crédito (D15d, §Post-F9.98)', () => {
  it('devuelve los días de crédito CAPTURADOS del cliente (no 0)', async () => {
    const tx = txCon('cliente', { nombre: 'Boutique Aurora', activo: true, diasCredito: 45 });

    const tercero = await exigirTercero(tx, 'cliente', 7);

    expect(tercero.diasCredito).toBe(45);
    expect(tercero.nombre).toBe('Boutique Aurora');
    expect(tercero.idTercero).toBe(7);
  });

  it('un cliente SIN plazo capturado (null) es de contado: 0 días', async () => {
    const tx = txCon('cliente', { nombre: 'Cliente Migrado', activo: true, diasCredito: null });

    expect((await exigirTercero(tx, 'cliente', 3)).diasCredito).toBe(0);
  });

  it('lee el plazo del cliente IGUAL que el del proveedor (una sola regla, A1)', async () => {
    const comoCliente = await exigirTercero(
      txCon('cliente', { nombre: 'X', activo: true, diasCredito: 30 }),
      'cliente',
      1,
    );
    const comoProveedor = await exigirTercero(
      txCon('proveedor', { nombre: 'X', activo: true, diasCredito: 30 }),
      'proveedor',
      1,
    );
    expect(comoCliente.diasCredito).toBe(comoProveedor.diasCredito);

    const clienteNull = await exigirTercero(
      txCon('cliente', { nombre: 'X', activo: true, diasCredito: null }),
      'cliente',
      1,
    );
    const proveedorNull = await exigirTercero(
      txCon('proveedor', { nombre: 'X', activo: true, diasCredito: null }),
      'proveedor',
      1,
    );
    expect(clienteNull.diasCredito).toBe(proveedorNull.diasCredito);
  });

  it('el cliente inexistente y el desactivado siguen cortando el paso', async () => {
    await expect(exigirTercero(txCon('cliente', null), 'cliente', 9)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    await expect(
      exigirTercero(
        txCon('cliente', { nombre: 'Cerrada', activo: false, diasCredito: 30 }),
        'cliente',
        9,
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});
