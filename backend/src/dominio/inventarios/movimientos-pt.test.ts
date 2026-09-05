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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
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
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('kardex sin idModelo → ErrorValidacion (Zod)', async () => {
    await expect(kardexPt(sesionMover(), {} as never, {})).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // §Post-F9.40 — la ORDEN del renglón (de qué producción salen las piezas).
  it('movimiento manual con un idOrden inválido (0/negativo) → ErrorValidacion (Zod)', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-08-12',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, idOrden: 0, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('traspaso con un idOrden inválido → ErrorValidacion (Zod), sin tocar BD', async () => {
    await expect(
      registrarTraspasoPt(
        sesionMover(),
        {
          idAlmacenOrigen: 1,
          idAlmacenDestino: 2,
          idModelo: 1,
          fecha: '2026-08-12',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, idOrden: -7, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

/**
 * `tx` de mentiras que resuelve los tipos de movimiento del traspaso y devuelve, para cada id de
 * almacén, la fila que diga `porAlmacen` (o una de PT usable, si no está en el mapa). Sirve para
 * pinchar el guard de tipo (fila 0.137) SIN Postgres: se corta en la primera lectura de almacén.
 */
function bdConAlmacenes(porAlmacen: Record<number, { nombre: string; tipo: string }>): {
  bd: ContextoBd;
  almacenesLeidos: number[];
} {
  const almacenesLeidos: number[] = [];
  const tx = {
    tipoMovimientoInventario: {
      findUnique: vi.fn(({ where }: { where: { codigo: string } }) =>
        Promise.resolve({
          id: where.codigo === 'transferencia-salida' ? 1 : 2,
          nombre: where.codigo,
          direccion: where.codigo === 'transferencia-salida' ? 'salida' : 'entrada',
          activo: true,
        }),
      ),
    },
    almacen: {
      findUnique: vi.fn(({ where }: { where: { id: number } }) => {
        almacenesLeidos.push(where.id);
        const fila = porAlmacen[where.id] ?? { nombre: `Almacén ${String(where.id)}`, tipo: 'PT' };
        return Promise.resolve({ ...fila, activo: true, idEmpresa: null });
      }),
    },
  } as unknown as Tx;
  return { bd: { tx }, almacenesLeidos };
}

describe('Motivo OBLIGATORIO al mover PT a mano (fila 0.100, §Post-F9.193 decisión 3)', () => {
  // El motivo lo exige el DOMINIO (`validarEntrada` corre AQUÍ, no solo en el Zod de la ruta — A1),
  // así que estas pruebas pasan `{}` como `bd`: revientan ANTES de tocar la base.
  const movimiento = {
    idTipoMov: 1,
    idAlmacen: 1,
    idModelo: 1,
    fecha: '2026-09-04',
    lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
  };
  const traspaso = {
    idAlmacenOrigen: 1,
    idAlmacenDestino: 2,
    idModelo: 1,
    fecha: '2026-09-04',
    lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
  };

  it('un movimiento manual SIN motivo se rechaza', async () => {
    await expect(
      registrarMovimientoPt(sesionMover(), movimiento as never, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  /** Captura el error de una promesa para poder inspeccionar sus `detalles` (patrón de telas). */
  async function errorDe(promesa: Promise<unknown>): Promise<unknown> {
    return promesa.then(
      () => null,
      (e: unknown) => e,
    );
  }

  it('un movimiento manual con motivo DEMASIADO CORTO se rechaza (mínimo 3, como en telas)', async () => {
    // El mensaje LEGIBLE por campo viaja en `detalles.fieldErrors` (formato de `validarEntrada`):
    // el `message` del error es siempre el genérico, así que afirmar sobre él no probaría nada.
    const error = await errorDe(
      registrarMovimientoPt(sesionMover(), { ...movimiento, motivo: 'ab' }, {}),
    );
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { motivo: ['Explica el motivo (mínimo 3 caracteres)'] },
    });
  });

  it('un motivo de PUROS ESPACIOS se rechaza (se recorta antes de medir)', async () => {
    await expect(
      registrarMovimientoPt(sesionMover(), { ...movimiento, motivo: '     ' }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un traspaso SIN motivo se rechaza', async () => {
    await expect(registrarTraspasoPt(sesionMover(), traspaso as never, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('un traspaso con motivo DEMASIADO CORTO se rechaza', async () => {
    const error = await errorDe(
      registrarTraspasoPt(sesionMover(), { ...traspaso, motivo: 'ab' }, {}),
    );
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { motivo: ['Explica el motivo (mínimo 3 caracteres)'] },
    });
  });

  it('un motivo de MÁS de 500 caracteres se rechaza', async () => {
    const error = await errorDe(
      registrarMovimientoPt(sesionMover(), { ...movimiento, motivo: 'x'.repeat(501) }, {}),
    );
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { motivo: ['El motivo no puede tener más de 500 caracteres'] },
    });
  });
});

describe('Traspaso de PT — el guard de TIPO cubre LAS DOS patas (fila 0.137)', () => {
  const traspaso = {
    idModelo: 1,
    fecha: '2026-06-20',
    motivo: 'Ajuste de la prueba',
    lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
  };

  it('el ORIGEN de TELA se rechaza', async () => {
    const { bd } = bdConAlmacenes({ 1: { nombre: 'Naucalpan', tipo: 'TELA' } });
    await expect(
      registrarTraspasoPt(
        sesionMover(),
        { ...traspaso, idAlmacenOrigen: 1, idAlmacenDestino: 2 },
        bd,
      ),
    ).rejects.toThrow(/"Naucalpan" es de telas; este movimiento es de producto terminado/);
  });

  it('el DESTINO de TELA se rechaza (el origen sí es de PT)', async () => {
    // Éste es el que se cuela si alguien valida solo el origen: el destino no se lee nunca.
    const { bd, almacenesLeidos } = bdConAlmacenes({ 2: { nombre: 'Naucalpan', tipo: 'TELA' } });
    await expect(
      registrarTraspasoPt(
        sesionMover(),
        { ...traspaso, idAlmacenOrigen: 1, idAlmacenDestino: 2 },
        bd,
      ),
    ).rejects.toThrow(/"Naucalpan" es de telas; este movimiento es de producto terminado/);
    expect(almacenesLeidos).toEqual([1, 2]);
  });
});
