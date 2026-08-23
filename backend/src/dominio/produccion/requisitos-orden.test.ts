import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  cambiosEstadoPorRequisitos,
  realinearEstadoOrdenes,
  recalcularEstadoOrden,
  recalcularEstadoOrdenesDeModelo,
  requisitosOrden,
  textoFaltantesOrden,
  type InsumosRequisitosOrden,
} from './requisitos-orden.js';

/** Insumos de una orden que cumple TODO (matriz + receta liberada + arte, con modelo que lo lleva). */
function insumos(over: Partial<InsumosRequisitosOrden> = {}): InsumosRequisitosOrden {
  return { renglonesMatriz: 2, recetaLiberada: true, artesOrden: 1, llevaArte: true, ...over };
}

describe('requisitosOrden (regla "tallas + receta liberada, y arte si aplica" — V1-E3d)', () => {
  it('con matriz, receta liberada y arte: completa', () => {
    const r = requisitosOrden(insumos());
    expect(r).toEqual({
      tallas: true,
      receta: true,
      arte: true,
      completa: true,
      faltantes: [],
    });
  });

  it('el modelo NO lleva arte (casilla desmarcada): arte "no-aplica" y la orden se completa', () => {
    const r = requisitosOrden(insumos({ llevaArte: false, artesOrden: 0 }));
    expect(r.arte).toBe('no-aplica');
    expect(r.completa).toBe(true);
    expect(r.faltantes).toEqual([]);
  });

  it('el modelo LLEVA arte pero la receta de la OP no lo trae: FALTA arte (decisión de Daniel)', () => {
    const r = requisitosOrden(insumos({ llevaArte: true, artesOrden: 0 }));
    expect(r.arte).toBe(false);
    expect(r.completa).toBe(false);
    expect(r.faltantes).toEqual(['arte']);
  });

  it('el modelo lleva arte Y la receta de la OP lo tiene: requisito cumplido', () => {
    const r = requisitosOrden(insumos({ llevaArte: true, artesOrden: 2 }));
    expect(r.arte).toBe(true);
    expect(r.completa).toBe(true);
  });

  it('desmarcar "lleva arte" no borra el arte capturado, solo deja de exigirlo', () => {
    expect(requisitosOrden(insumos({ llevaArte: false, artesOrden: 3 })).arte).toBe('no-aplica');
  });

  it('sin matriz: falta tallas', () => {
    const r = requisitosOrden(insumos({ renglonesMatriz: 0 }));
    expect(r.tallas).toBe(false);
    expect(r.completa).toBe(false);
    expect(r.faltantes).toEqual(['tallas']);
  });

  it('receta SIN liberar: falta la receta (la puerta de Desarrollo, V1-E3d)', () => {
    const r = requisitosOrden(insumos({ recetaLiberada: false }));
    expect(r.receta).toBe(false);
    expect(r.completa).toBe(false);
    expect(r.faltantes).toEqual(['receta']);
  });

  it('⭐ el BOM del MODELO ya no interviene: dos órdenes del mismo modelo pueden diferir', () => {
    // Los MISMOS insumos de modelo (llevaArte) con recetas de orden distintas dan resultados
    // distintos. Antes esto era imposible: la respuesta la daba el modelo, igual para las dos.
    const conJareta = requisitosOrden(insumos({ recetaLiberada: true, artesOrden: 1 }));
    const sinLiberar = requisitosOrden(insumos({ recetaLiberada: false, artesOrden: 1 }));
    expect(conJareta.completa).toBe(true);
    expect(sinLiberar.completa).toBe(false);
  });

  it('sin matriz y sin receta liberada: faltan los dos, en orden', () => {
    const r = requisitosOrden(insumos({ renglonesMatriz: 0, recetaLiberada: false }));
    expect(r.faltantes).toEqual(['tallas', 'receta']);
    expect(r.completa).toBe(false);
  });

  it('prenda lisa sin matriz ni receta: el arte NO se suma a los faltantes', () => {
    const r = requisitosOrden({
      renglonesMatriz: 0,
      recetaLiberada: false,
      artesOrden: 0,
      llevaArte: false,
    });
    expect(r.arte).toBe('no-aplica');
    expect(r.faltantes).toEqual(['tallas', 'receta']);
  });

  it('los tres faltantes salen en orden: tallas, receta, arte', () => {
    const r = requisitosOrden({
      renglonesMatriz: 0,
      recetaLiberada: false,
      artesOrden: 0,
      llevaArte: true,
    });
    expect(r.faltantes).toEqual(['tallas', 'receta', 'arte']);
  });

  it('la matriz cuenta por renglones, no por piezas (1 renglón basta)', () => {
    expect(requisitosOrden(insumos({ renglonesMatriz: 1 })).tallas).toBe(true);
  });

  it('es PURA: no muta los insumos', () => {
    const dato = insumos();
    const copia = { ...dato };
    requisitosOrden(dato);
    expect(dato).toEqual(copia);
  });
});

describe('textoFaltantesOrden', () => {
  it('devuelve null cuando no falta nada', () => {
    expect(textoFaltantesOrden(requisitosOrden(insumos()))).toBeNull();
  });

  it('nombra el faltante en lenguaje de negocio', () => {
    expect(textoFaltantesOrden(requisitosOrden(insumos({ recetaLiberada: false })))).toBe(
      'Falta: liberar la receta',
    );
  });

  it('une dos faltantes con "y"', () => {
    expect(
      textoFaltantesOrden(requisitosOrden(insumos({ renglonesMatriz: 0, recetaLiberada: false }))),
    ).toBe('Falta: tallas y liberar la receta');
  });

  it('nombra el arte cuando el modelo lo lleva y la receta de la OP no lo trae', () => {
    expect(textoFaltantesOrden(requisitosOrden(insumos({ artesOrden: 0 })))).toBe('Falta: arte');
  });
});

// ── Transición de estado (lo que se guarda en la orden) ──────────────────────────────

describe('cambiosEstadoPorRequisitos (estado automático + sello de fechaCompletada)', () => {
  const AHORA = new Date('2026-07-26T12:00:00Z');
  const cumple = requisitosOrden(insumos());
  const noCumple = requisitosOrden(insumos({ recetaLiberada: false }));

  it('capturada que ya cumple → completa + sella fechaCompletada', () => {
    const r = cambiosEstadoPorRequisitos(
      { estado: 'capturada', fechaCompletada: null },
      cumple,
      AHORA,
    );
    expect(r).toEqual({ estado: 'completa', fechaCompletada: AHORA });
  });

  it('completa que sigue cumpliendo → no escribe nada', () => {
    const previa = new Date('2026-07-01T00:00:00Z');
    expect(
      cambiosEstadoPorRequisitos({ estado: 'completa', fechaCompletada: previa }, cumple, AHORA),
    ).toBeNull();
  });

  it('completa que DEJA de cumplir → vuelve a capturada y CONSERVA la fecha', () => {
    const previa = new Date('2026-07-01T00:00:00Z');
    const r = cambiosEstadoPorRequisitos(
      { estado: 'completa', fechaCompletada: previa },
      noCumple,
      AHORA,
    );
    // Solo cambia el estado: `fechaCompletada` no aparece → no se toca (jamás se borra).
    expect(r).toEqual({ estado: 'capturada' });
  });

  it('la fecha se sella UNA vez: si vuelve a completarse, no se re-sella', () => {
    const previa = new Date('2026-07-01T00:00:00Z');
    const r = cambiosEstadoPorRequisitos(
      { estado: 'capturada', fechaCompletada: previa },
      cumple,
      AHORA,
    );
    expect(r).toEqual({ estado: 'completa' });
  });

  it('capturada que sigue sin cumplir → no escribe nada', () => {
    expect(
      cambiosEstadoPorRequisitos({ estado: 'capturada', fechaCompletada: null }, noCumple, AHORA),
    ).toBeNull();
  });

  it('CANCELADA siempre gana: la regla no la toca, cumpla o no', () => {
    expect(
      cambiosEstadoPorRequisitos({ estado: 'cancelada', fechaCompletada: null }, cumple, AHORA),
    ).toBeNull();
    expect(
      cambiosEstadoPorRequisitos({ estado: 'cancelada', fechaCompletada: null }, noCumple, AHORA),
    ).toBeNull();
  });
});

// ── Guardas del DES-COMPLETAR y del recálculo por BOM (26-jul-2026, tras revisión) ───

/** Tx de mentira: conteos configurables + espías de escritura. */
function txFalsa(conteos: {
  renglonesMatriz?: number;
  recetaLiberada?: boolean;
  artesOrden?: number;
  llevaArte?: boolean;
  etapasVivas?: number;
  candidatas?: { id: number; fechaCompletada: Date | null; artesOrden?: number }[];
}) {
  const espias = {
    update: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({})),
    updateMany: vi.fn((_args: { where: unknown; data: Record<string, unknown> }) =>
      Promise.resolve({ count: 0 }),
    ),
    findMany: vi.fn((_args: { where: unknown }) =>
      Promise.resolve(
        (conteos.candidatas ?? []).map((c) => ({
          id: c.id,
          fechaCompletada: c.fechaCompletada,
          _count: { recetaArtes: c.artesOrden ?? 0 },
        })),
      ),
    ),
    bitacoraCreateMany: vi.fn((_args: { data: unknown[] }) => Promise.resolve({ count: 0 })),
  };
  const tx = {
    ordenLinea: { count: vi.fn(() => Promise.resolve(conteos.renglonesMatriz ?? 0)) },
    // V1-E3d: los insumos "receta liberada" y "arte" son de la ORDEN, no del modelo.
    ordenArte: { count: vi.fn(() => Promise.resolve(conteos.artesOrden ?? 0)) },
    // La bandera "lleva arte" del modelo; por default `false` en el stub para que los casos que no
    // hablan de arte no arrastren ese requisito.
    modelo: { findUnique: vi.fn(() => Promise.resolve({ llevaArte: conteos.llevaArte ?? false })) },
    etapaMovimiento: { count: vi.fn(() => Promise.resolve(conteos.etapasVivas ?? 0)) },
    orden: {
      update: espias.update,
      updateMany: espias.updateMany,
      findMany: espias.findMany,
      findUnique: vi.fn(() =>
        Promise.resolve({ recetaLiberadaEn: (conteos.recetaLiberada ?? true) ? new Date() : null }),
      ),
    },
    bitacora: { createMany: espias.bitacoraCreateMany },
  } as unknown as Tx;
  return { tx, espias };
}

const sesion = () => sesionDePrueba({ permisos: [] });

/** Orden COMPLETA que, con los insumos de hoy, ya no cumple (le quitaron la matriz). */
const completaSinMatriz = {
  id: 7,
  idModelo: 3,
  estado: 'completa' as const,
  fechaCompletada: new Date('2026-07-01T00:00:00Z'),
};

describe('recalcularEstadoOrden — cuándo se permite DES-COMPLETAR', () => {
  it('sin actividad de producción y por edición de matriz: SÍ degrada', async () => {
    const { tx, espias } = txFalsa({ recetaLiberada: true, renglonesMatriz: 0 });

    await recalcularEstadoOrden(tx, sesion(), completaSinMatriz);

    expect(espias.update).toHaveBeenCalledTimes(1);
    expect(espias.update.mock.calls[0]?.[0]).toMatchObject({ data: { estado: 'capturada' } });
  });

  it('CON actividad de producción viva: NO degrada (la orden está en curso)', async () => {
    const { tx, espias } = txFalsa({ recetaLiberada: true, renglonesMatriz: 0, etapasVivas: 1 });

    await recalcularEstadoOrden(tx, sesion(), completaSinMatriz);

    // Se escribe solo la auditoría del guardado; el estado se conserva.
    const data = espias.update.mock.calls[0]?.[0].data;
    expect(data).not.toHaveProperty('estado');
  });

  it('con `permitirDesCompletar: false` NO degrada aunque no haya actividad', async () => {
    const { tx, espias } = txFalsa({ recetaLiberada: true, renglonesMatriz: 0 });

    await recalcularEstadoOrden(tx, sesion(), completaSinMatriz, {
      permitirDesCompletar: false,
      tocarAuditoria: false,
    });

    expect(espias.update).not.toHaveBeenCalled();
  });

  it('COMPLETAR siempre se permite, aunque la orden tenga actividad', async () => {
    const { tx, espias } = txFalsa({ recetaLiberada: true, renglonesMatriz: 1, etapasVivas: 3 });

    await recalcularEstadoOrden(
      tx,
      sesion(),
      { id: 7, idModelo: 3, estado: 'capturada', fechaCompletada: null },
      { tocarAuditoria: false },
    );

    expect(espias.update.mock.calls[0]?.[0]).toMatchObject({ data: { estado: 'completa' } });
  });
});

describe('recalcularEstadoOrdenesDeModelo — SOLO completa, nunca degrada', () => {
  it('sin candidatas (ninguna capturada con matriz y receta liberada) no toca nada', async () => {
    const { tx, espias } = txFalsa({ candidatas: [] });

    const cambiadas = await recalcularEstadoOrdenesDeModelo(tx, sesion(), 3);

    expect(cambiadas).toBe(0);
    expect(espias.updateMany).not.toHaveBeenCalled();
  });

  it('el modelo LLEVA arte y la orden no lo trae en su receta: no se completa', async () => {
    const { tx, espias } = txFalsa({
      llevaArte: true,
      candidatas: [{ id: 11, fechaCompletada: null, artesOrden: 0 }],
    });

    const cambiadas = await recalcularEstadoOrdenesDeModelo(tx, sesion(), 3);

    expect(cambiadas).toBe(0);
    expect(espias.updateMany).not.toHaveBeenCalled();
  });

  it('completa las capturadas con receta liberada y deja bitácora POR ORDEN (A7)', async () => {
    const { tx, espias } = txFalsa({
      candidatas: [
        { id: 11, fechaCompletada: null },
        { id: 12, fechaCompletada: new Date('2026-01-01T00:00:00Z') },
      ],
    });

    const cambiadas = await recalcularEstadoOrdenesDeModelo(tx, sesion(), 3);

    expect(cambiadas).toBe(2);
    // Solo busca CAPTURADAS con matriz Y receta liberada (nunca completas, canceladas ni sin
    // renglones): el universo va en la consulta, no en memoria.
    expect(espias.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        idModelo: 3,
        estado: 'capturada',
        lineas: { some: {} },
        recetaLiberadaEn: { not: null },
      },
    });
    // Dos updateMany: las que sellan fecha y las que ya la traían.
    expect(espias.updateMany).toHaveBeenCalledTimes(2);
    for (const llamada of espias.updateMany.mock.calls) {
      expect(llamada[0].data).toMatchObject({ estado: 'completa' });
    }
    expect(espias.bitacoraCreateMany.mock.calls[0]?.[0].data).toHaveLength(2);
  });

  it('la bitácora nombra la causa REAL del recálculo (el motivo que pasa el llamador)', async () => {
    const { tx, espias } = txFalsa({
      candidatas: [{ id: 11, fechaCompletada: null }],
    });

    await recalcularEstadoOrdenesDeModelo(tx, sesion(), 3, 'lleva-arte');

    const renglones = espias.bitacoraCreateMany.mock.calls[0]?.[0].data as {
      datos: { motivo: string };
    }[];
    expect(renglones[0]?.datos.motivo).toBe('lleva-arte');
  });
});

// ── Realineado tras una carga de datos (motor del script de mantenimiento) ───────────

/** Tx de mentira para `realinearEstadoOrdenes`: órdenes + modelos + actividad, y espías. */
function txRealineado(datos: {
  ordenes: {
    id: number;
    idModelo: number;
    estado: 'capturada' | 'completa' | 'cancelada';
    fechaCompletada: Date | null;
    renglonesMatriz: number;
    /** V1-E3d: insumos de la ORDEN. Por default, receta liberada y sin arte. */
    recetaLiberada?: boolean;
    artesOrden?: number;
  }[];
  modelos: { id: number; llevaArte: boolean }[];
  conActividad?: number[];
}) {
  const espias = {
    updateMany: vi.fn((_args: { where: unknown; data: Record<string, unknown> }) =>
      Promise.resolve({ count: 0 }),
    ),
    bitacoraCreateMany: vi.fn((_args: { data: unknown[] }) => Promise.resolve({ count: 0 })),
  };
  const tx = {
    orden: {
      findMany: vi.fn(() =>
        Promise.resolve(
          datos.ordenes
            .filter((o) => o.estado !== 'cancelada')
            .map((o) => ({
              id: o.id,
              idModelo: o.idModelo,
              estado: o.estado,
              fechaCompletada: o.fechaCompletada,
              recetaLiberadaEn: (o.recetaLiberada ?? true) ? new Date() : null,
              _count: { lineas: o.renglonesMatriz, recetaArtes: o.artesOrden ?? 0 },
            })),
        ),
      ),
      updateMany: espias.updateMany,
    },
    modelo: {
      findMany: vi.fn(() =>
        Promise.resolve(datos.modelos.map((m) => ({ id: m.id, llevaArte: m.llevaArte }))),
      ),
    },
    etapaMovimiento: {
      groupBy: vi.fn(() =>
        Promise.resolve((datos.conActividad ?? []).map((idOrden) => ({ idOrden }))),
      ),
    },
    bitacora: { createMany: espias.bitacoraCreateMany },
  } as unknown as Tx;
  return { tx, espias };
}

/** Modelo de prenda LISA (no exige arte). */
const MODELO_OK = { id: 1, llevaArte: false };
/** Modelo que LLEVA arte: sus órdenes sin arte en la receta no pueden completarse. */
const MODELO_SIN_ARTE = { id: 2, llevaArte: true };

describe('realinearEstadoOrdenes (motor del script post-carga)', () => {
  it('degrada la `completa` que ya no cumple y completa la `capturada` que sí', async () => {
    const { tx, espias } = txRealineado({
      ordenes: [
        // Cargada como `completa` desde Access, pero su modelo lleva arte sin capturar.
        {
          id: 10,
          idModelo: 2,
          estado: 'completa',
          fechaCompletada: new Date(),
          renglonesMatriz: 1,
        },
        // Cargada como `capturada` aunque cumple todo.
        { id: 11, idModelo: 1, estado: 'capturada', fechaCompletada: null, renglonesMatriz: 3 },
      ],
      modelos: [MODELO_OK, MODELO_SIN_ARTE],
    });

    const r = await realinearEstadoOrdenes(tx, [10, 11]);

    expect(r).toMatchObject({
      revisadas: 2,
      degradadas: 1,
      completadas: 1,
      protegidasPorProduccion: 0,
    });
    const destinos = espias.updateMany.mock.calls.map((c) => c[0].data.estado);
    expect(destinos).toContain('capturada');
    expect(destinos).toContain('completa');
    // A7: una bitácora por orden tocada.
    expect(espias.bitacoraCreateMany.mock.calls[0]?.[0].data).toHaveLength(2);
  });

  it('NUNCA degrada una orden con producción viva (el cinturón, igual que el dominio)', async () => {
    const { tx, espias } = txRealineado({
      ordenes: [
        {
          id: 10,
          idModelo: 2,
          estado: 'completa',
          fechaCompletada: new Date(),
          renglonesMatriz: 1,
        },
      ],
      modelos: [MODELO_SIN_ARTE],
      conActividad: [10],
    });

    const r = await realinearEstadoOrdenes(tx, [10]);

    expect(r).toMatchObject({ revisadas: 1, degradadas: 0, protegidasPorProduccion: 1 });
    expect(espias.updateMany).not.toHaveBeenCalled();
    expect(espias.bitacoraCreateMany).not.toHaveBeenCalled();
  });

  it('es IDEMPOTENTE: si todo está al día no escribe nada', async () => {
    const { tx, espias } = txRealineado({
      ordenes: [
        {
          id: 10,
          idModelo: 1,
          estado: 'completa',
          fechaCompletada: new Date(),
          renglonesMatriz: 2,
        },
        { id: 11, idModelo: 2, estado: 'capturada', fechaCompletada: null, renglonesMatriz: 1 },
      ],
      modelos: [MODELO_OK, MODELO_SIN_ARTE],
    });

    const r = await realinearEstadoOrdenes(tx, [10, 11]);

    expect(r).toMatchObject({ revisadas: 2, degradadas: 0, completadas: 0 });
    expect(espias.updateMany).not.toHaveBeenCalled();
    expect(espias.bitacoraCreateMany).not.toHaveBeenCalled();
  });

  it('al completar por primera vez SELLA la fecha; si ya la traía, no la re-sella', async () => {
    const previa = new Date('2020-01-01T00:00:00Z');
    const { tx, espias } = txRealineado({
      ordenes: [
        { id: 10, idModelo: 1, estado: 'capturada', fechaCompletada: null, renglonesMatriz: 1 },
        { id: 11, idModelo: 1, estado: 'capturada', fechaCompletada: previa, renglonesMatriz: 1 },
      ],
      modelos: [MODELO_OK],
    });

    await realinearEstadoOrdenes(tx, [10, 11]);

    const conSello = espias.updateMany.mock.calls.find(
      (c) => c[0].data.fechaCompletada !== undefined,
    );
    const sinSello = espias.updateMany.mock.calls.find(
      (c) => c[0].data.fechaCompletada === undefined,
    );
    expect(conSello?.[0].where).toMatchObject({ id: { in: [10] } });
    expect(sinSello?.[0].where).toMatchObject({ id: { in: [11] } });
  });

  it('sin ids no toca la base', async () => {
    const { tx, espias } = txRealineado({ ordenes: [], modelos: [] });
    const r = await realinearEstadoOrdenes(tx, []);
    expect(r).toEqual({
      revisadas: 0,
      degradadas: 0,
      completadas: 0,
      protegidasPorProduccion: 0,
    });
    expect(espias.updateMany).not.toHaveBeenCalled();
  });
});
