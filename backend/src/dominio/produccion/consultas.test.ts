import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  DIAS_AMARILLO_ORDEN,
  DIAS_URGENTE_ORDEN,
  agruparPorMes,
  buscarOrdenesGlobal,
  consultarIncompletas,
  consultarOrdenes,
  semaforoPorDias,
  tableroPedidosPorMes,
} from './consultas.js';

/**
 * Unit del dominio de CONSULTAS de Órdenes (F2-E4) — SIN Postgres. Cubre lo que no necesita la
 * base: el guard de permisos (deny-by-default, A4), la validación de captura del buscador, la
 * DERIVACIÓN del semáforo de antigüedad (fronteras de la regla `EsUrgente` del viejo), la AGRUPACIÓN
 * del tablero por mes (función pura), la PROYECCIÓN ligera (con el total agregado) y la búsqueda
 * combinada. La integridad real contra BD (índices, agregados SQL) se prueba en `*.int.test.ts` (CI).
 */

const sesionVer = () => sesionDePrueba({ permisos: ['ordenes.ver'] });
const sesionSin = () => sesionDePrueba({ permisos: [] });

// ── Permisos (deny-by-default, A4) ──────────────────────────────────────────────────

describe('dominio Consultas Órdenes (F2-E4) — permisos (A4)', () => {
  it('consultar sin permiso ver → ErrorPermiso', async () => {
    await expect(consultarOrdenes(sesionSin(), {}, vacio())).rejects.toBeInstanceOf(ErrorPermiso);
  });
  it('incompletas sin permiso ver → ErrorPermiso', async () => {
    await expect(consultarIncompletas(sesionSin(), {}, vacio())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
  it('tablero sin permiso ver → ErrorPermiso', async () => {
    await expect(tableroPedidosPorMes(sesionSin(), {}, vacio())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
  it('buscar sin permiso ver → ErrorPermiso', async () => {
    await expect(buscarOrdenesGlobal(sesionSin(), { q: 'x' }, vacio())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

// ── Validación de captura del buscador ───────────────────────────────────────────────

describe('dominio Consultas Órdenes (F2-E4) — validación', () => {
  it('buscar con q vacío → ErrorValidacion', async () => {
    await expect(buscarOrdenesGlobal(sesionVer(), { q: '   ' }, vacio())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});

// ── Semáforo de antigüedad (regla EsUrgente, fronteras) ──────────────────────────────

describe('dominio Consultas Órdenes (F2-E4) — semáforo de antigüedad', () => {
  it('hasta 3 días → verde', () => {
    expect(semaforoPorDias(0)).toBe('verde');
    expect(semaforoPorDias(DIAS_AMARILLO_ORDEN)).toBe('verde'); // 3 días aún es verde
  });
  it('entre 4 y 7 días → amarillo', () => {
    expect(semaforoPorDias(DIAS_AMARILLO_ORDEN + 1)).toBe('amarillo'); // 4
    expect(semaforoPorDias(DIAS_URGENTE_ORDEN)).toBe('amarillo'); // 7 días: frontera, aún amarillo
  });
  it('más de 7 días → urgente', () => {
    expect(semaforoPorDias(DIAS_URGENTE_ORDEN + 1)).toBe('urgente'); // 8
    expect(semaforoPorDias(30)).toBe('urgente');
  });
});

// ── Agrupación del tablero por mes (función pura) ────────────────────────────────────

describe('dominio Consultas Órdenes (F2-E4) — agrupación del tablero por mes', () => {
  it('agrupa por mes con número de órdenes y Σ de piezas, en orden cronológico', () => {
    const filas = [
      { fecha: new Date(Date.UTC(2026, 5, 10)), idOrden: 1, totalPiezas: 100 }, // jun
      { fecha: new Date(Date.UTC(2026, 5, 20)), idOrden: 2, totalPiezas: 50 }, // jun
      { fecha: new Date(Date.UTC(2026, 0, 5)), idOrden: 3, totalPiezas: 30 }, // ene
    ];
    const resultado = agruparPorMes(filas);
    expect(resultado).toHaveLength(2);
    // Orden cronológico: enero antes que junio.
    expect(resultado[0]?.clave).toBe('2026-01');
    expect(resultado[0]?.numOrdenes).toBe(1);
    expect(resultado[0]?.totalPiezas).toBe(30);
    expect(resultado[1]?.clave).toBe('2026-06');
    expect(resultado[1]?.numOrdenes).toBe(2);
    expect(resultado[1]?.totalPiezas).toBe(150);
    expect(resultado[1]?.etiqueta).toBe('jun 2026');
  });

  it('ignora las órdenes sin fecha (no caen en ningún mes)', () => {
    const filas = [
      { fecha: null, idOrden: 1, totalPiezas: 99 },
      { fecha: new Date(Date.UTC(2026, 5, 1)), idOrden: 2, totalPiezas: 10 },
    ];
    const resultado = agruparPorMes(filas);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]?.totalPiezas).toBe(10);
  });
});

// ── Proyección ligera + total agregado (consultar) ───────────────────────────────────

describe('dominio Consultas Órdenes (F2-E4) — proyección ligera con total agregado', () => {
  it('consultar proyecta filas ligeras con su total Σ de tallas (agregado, no la matriz)', async () => {
    const salida = await consultarOrdenes(sesionVer(), {}, bdConsulta());
    expect(salida.total).toBe(1);
    expect(salida.datos).toHaveLength(1);
    const fila = salida.datos[0];
    expect(fila?.folio).toBe(7);
    expect(fila?.codigoModelo).toBe('501');
    expect(fila?.cliente).toBe('Liverpool');
    // total agregado: renglón 11 → 10 + 5 = 15.
    expect(fila?.totalPiezas).toBe(15);
    // La proyección ligera NO trae matriz ni referencias.
    expect(fila).not.toHaveProperty('lineas');
    expect(fila).not.toHaveProperty('referencias');
  });
});

// ── Incompletas: antigüedad + semáforo derivado ──────────────────────────────────────

describe('dominio Consultas Órdenes (F2-E4) — incompletas con semáforo', () => {
  it('deriva diasAntiguedad y semaforo URGENTE para una orden vieja (>7d)', async () => {
    // `creadoEn` hace 10 días respecto al "ahora" inyectado.
    const ahora = new Date('2026-06-16T00:00:00Z');
    const creadoEn = new Date('2026-06-06T00:00:00Z'); // 10 días
    const salida = await consultarIncompletas(sesionVer(), {}, bdIncompletas(creadoEn), ahora);
    expect(salida.datos).toHaveLength(1);
    expect(salida.datos[0]?.diasAntiguedad).toBe(10);
    expect(salida.datos[0]?.semaforo).toBe('urgente');
    expect(salida.datos[0]?.totalPiezas).toBe(0); // esta incompleta aún no tiene matriz
  });
});

// ── Stubs de BD ──────────────────────────────────────────────────────────────────────

/** ContextoBd vacío (los servicios fallan ANTES de tocar la BD: permisos/validación). */
function vacio(): ContextoBd {
  return { tx: {} as unknown as Tx };
}

/** Una fila ligera cruda (lo que devuelve `findMany` con la selección ligera). */
function filaLigera(creadoEn = new Date('2026-06-16T00:00:00Z')) {
  return {
    id: 1,
    folio: 7n,
    estado: 'completa' as const,
    fecha: new Date('2026-06-15T00:00:00Z'),
    fechaEntrega: null,
    creadoEn,
    idModelo: 9,
    modelo: { codigo: '501', descripcion: 'Playera' },
    idCliente: 3,
    cliente: { nombre: 'Liverpool' },
    idMaquilero: null,
    maquilero: null,
  };
}

/** Stub para `consultarOrdenes`: 1 orden + su agregado de tallas (renglón 11 → 15 piezas). */
function bdConsulta(): ContextoBd {
  const tx = {
    orden: {
      count: vi.fn(() => Promise.resolve(1)),
      findMany: vi.fn(() => Promise.resolve([filaLigera()])),
    },
    ordenLineaTalla: {
      groupBy: vi.fn(() => Promise.resolve([{ idOrdenLinea: 11, _sum: { cantidad: 15 } }])),
    },
    ordenLinea: {
      findMany: vi.fn(() => Promise.resolve([{ id: 11, idOrden: 1 }])),
    },
  } as unknown as Tx;
  return { tx };
}

/** Stub para `consultarIncompletas`: 1 orden `capturada` con la `creadoEn` dada (aquí, sin matriz). */
function bdIncompletas(creadoEn: Date): ContextoBd {
  const tx = {
    orden: {
      count: vi.fn(() => Promise.resolve(1)),
      findMany: vi.fn(() =>
        Promise.resolve([{ ...filaLigera(creadoEn), estado: 'capturada' as const }]),
      ),
    },
    // Desde que el estado es automático, una incompleta PUEDE tener matriz (le puede faltar que la
    // receta esté liberada, o el arte): las piezas se agregan igual que en el listado normal. Aquí
    // no tiene.
    ordenLineaTalla: { groupBy: vi.fn(() => Promise.resolve([])) },
    ordenLinea: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as Tx;
  return { tx };
}
