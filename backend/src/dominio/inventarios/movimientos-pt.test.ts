import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  cancelarMovimientoPt,
  consultarExistenciasPt,
  kardexPt,
  registrarMovimientoPt,
  registrarTraspasoPt,
} from './movimientos-pt.js';

/**
 * Unit del dominio de Inventario PT (F3-E3) — SIN Postgres. Cubre las reglas PURAS: el guard de
 * permisos (deny-by-default, A4), la validación de captura (Zod) y el rechazo de la dirección
 * `traspaso` como movimiento manual. La integridad transaccional real (no-negativo bajo lock,
 * traspaso atómico, inverso de cancelación, concurrencia, existencia = suma) se prueba contra
 * Postgres en `movimientos-pt.int.test.ts` (CI).
 */

const sesionMover = () =>
  sesionDePrueba({ permisos: ['inventario-pt.ver', 'inventario-pt.mover'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['inventario-pt.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

/** Stub de `tx` donde el tipo de movimiento dado es de dirección `traspaso` (para el rechazo). */
function bdTipoTraspaso(): ContextoBd {
  const tx = {
    tipoMovimientoInventario: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          id: 9,
          nombre: 'Transferencia entre almacenes',
          direccion: 'traspaso',
          activo: true,
        }),
      ),
    },
  } as unknown as Tx;
  return { tx };
}

describe('dominio Inventario PT (F3-E3) — permisos (deny-by-default, A4)', () => {
  it('registrar movimiento sin inventario-pt.mover → ErrorPermiso', async () => {
    await expect(
      registrarMovimientoPt(
        sesionSoloVer(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-06-19',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('traspaso sin inventario-pt.mover → ErrorPermiso', async () => {
    await expect(
      registrarTraspasoPt(
        sesionSoloVer(),
        {
          idAlmacenOrigen: 1,
          idAlmacenDestino: 2,
          idModelo: 1,
          fecha: '2026-06-19',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('cancelar sin inventario-pt.mover → ErrorPermiso', async () => {
    await expect(
      cancelarMovimientoPt(sesionSoloVer(), 1, { motivo: 'error de captura' }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('consultar existencias sin inventario-pt.ver → ErrorPermiso', async () => {
    await expect(consultarExistenciasPt(sesionSinNada(), {}, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('kardex sin inventario-pt.ver → ErrorPermiso', async () => {
    await expect(kardexPt(sesionSinNada(), { idModelo: 1 }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('dominio Inventario PT (F3-E3) — validación de captura (A1)', () => {
  it('movimiento manual con un tipo de dirección "traspaso" → ErrorValidacion', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 9, // el stub lo resuelve como dirección "traspaso"
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-06-19',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        bdTipoTraspaso(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('traspaso con origen = destino → ErrorValidacion (no toca BD)', async () => {
    await expect(
      registrarTraspasoPt(
        sesionMover(),
        {
          idAlmacenOrigen: 1,
          idAlmacenDestino: 1, // mismo almacén
          idModelo: 1,
          fecha: '2026-06-19',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('movimiento manual sin renglones → ErrorValidacion (Zod)', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-06-19',
          lineas: [],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('movimiento manual con cantidad negativa → ErrorValidacion (Zod)', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-06-19',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: -3 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('movimiento manual con fecha mal formada → ErrorValidacion (Zod)', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '19-06-2026',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('kardex sin idModelo → ErrorValidacion (Zod)', async () => {
    await expect(kardexPt(sesionMover(), {} as never, {})).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
