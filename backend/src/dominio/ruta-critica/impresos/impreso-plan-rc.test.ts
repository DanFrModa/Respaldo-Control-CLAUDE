/**
 * Pruebas UNITARIAS del impreso "Plan de la RC por orden" (F5-E5, R9). No tocan BD: ejercitan
 *  • `generarPdfPlanRc` — devuelve un Buffer PDF real (cabecera `%PDF`), con procesos críticos,
 *    responsables múltiples, fechas null y los tres estados de avance.
 *  • `armarDatosImpresoPlanRc` — cuando la ruta NO tiene procesos (orden sin RC) lanza
 *    `ErrorValidacion` ANTES de tocar la BD (se inyecta un `obtenerRutaOrden` fake).
 *
 * El camino feliz de `armarDatosImpresoPlanRc` (que consulta encabezado + responsables) se cubre en el
 * test de integración (`impreso-plan-rc.int.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../../comun/errores.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { RutaOrdenDto } from '../rutaOrden.js';

import {
  armarDatosImpresoPlanRc,
  generarPdfPlanRc,
  type DatosImpresoPlanRc,
  type DepsImpresoPlanRc,
} from './impreso-plan-rc.js';

/** Sesión de prueba con el permiso `rc.ruta-ver`. */
function sesionConVer(): SesionUsuario {
  return {
    id: 'u1',
    username: 'tester',
    nombre: 'Tester',
    idEmpresaActiva: 1,
    nombreEmpresaActiva: 'FR Moda',
    permisos: new Set(['rc.ruta-ver']),
  } as unknown as SesionUsuario;
}

/** Datos de impreso mínimos, con overrides puntuales. */
function datosBase(over: Partial<DatosImpresoPlanRc> = {}): DatosImpresoPlanRc {
  return {
    empresa: 'FR Moda',
    idOrden: 5,
    folioOrden: 1042,
    cliente: 'Boutique Aurora',
    modelo: 'MOD-1 — Blusa',
    fechaEntregaRC: '2026-07-10',
    fechaInicioRC: '2026-06-25',
    semaforo: 'enRiesgo',
    esResurtido: false,
    procesos: [
      {
        secuencia: 0,
        nombreProceso: 'Corte',
        critico: true,
        fechaPlaneada: '2026-06-26',
        duracionDias: 2,
        responsables: ['Cortadores', 'Supervisión'],
        estado: 'completado',
        fechaReal: '2026-06-26',
      },
      {
        secuencia: 1,
        nombreProceso: 'Costura',
        critico: false,
        fechaPlaneada: '2026-07-02',
        duracionDias: 5,
        responsables: ['Maquila'],
        estado: 'activo',
        fechaReal: null,
      },
      {
        secuencia: 2,
        nombreProceso: 'Acabado',
        critico: false,
        fechaPlaneada: null,
        duracionDias: 1,
        responsables: [],
        estado: 'pendiente',
        fechaReal: null,
      },
    ],
    ...over,
  };
}

/** ¿El Buffer empieza con la firma de un PDF? */
function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('generarPdfPlanRc', () => {
  it('devuelve un Buffer no vacío con cabecera %PDF', async () => {
    const buffer = await generarPdfPlanRc(datosBase());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza con semáforo atrasado y resurtido', async () => {
    const buffer = await generarPdfPlanRc(datosBase({ semaforo: 'atrasado', esResurtido: true }));
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza un solo proceso sin responsables ni fechas', async () => {
    const buffer = await generarPdfPlanRc(
      datosBase({
        procesos: [
          {
            secuencia: 0,
            nombreProceso: 'Único',
            critico: false,
            fechaPlaneada: null,
            duracionDias: 0,
            responsables: [],
            estado: 'pendiente',
            fechaReal: null,
          },
        ],
      }),
    );
    expect(esPdf(buffer)).toBe(true);
  });
});

describe('armarDatosImpresoPlanRc — orden sin RC', () => {
  /** Ruta vacía (orden nunca programada): `obtenerRutaOrden` devuelve procesos = []. */
  function rutaVacia(): RutaOrdenDto {
    return {
      idOrden: 5,
      rcActiva: false,
      fechaInicioRC: null,
      fechaEntregaRC: null,
      fechaProgramada: null,
      esResurtido: false,
      idArticuloRC: null,
      idTipoTela: null,
      idAplicacion: null,
      estadoRecalculo: 'sin-ruta',
      semaforo: 'aTiempo',
      procesos: [],
      advertencias: [],
    };
  }

  it('lanza ErrorValidacion (sin tocar BD) cuando la ruta no tiene procesos', async () => {
    const deps: DepsImpresoPlanRc = { obtenerRutaOrden: () => Promise.resolve(rutaVacia()) };
    await expect(
      armarDatosImpresoPlanRc(sesionConVer(), 5, undefined, deps),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
