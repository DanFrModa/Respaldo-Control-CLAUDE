/**
 * Pruebas unitarias del impreso de la NOTA DE SALIDA (F4-E5). No tocan BD: ejercitan
 *  • `generarPdfNotaSalida` — devuelve un Buffer PDF real (cabecera `%PDF`), incluso con nota
 *    cancelada, renglones de avío + tela/lote, sin renglones o sin observaciones.
 *  • `armarDatosImpresoNotaSalida` — reúsa `obtenerNotaSalida` (inyectado), proyecta material
 *    (avío/tela), lote y cantidad; propaga el 404 de `obtenerNotaSalida` (A9).
 */
import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { NotaSalidaSalida } from '../../../contrato/index.js';

import {
  armarDatosImpresoNotaSalida,
  generarPdfNotaSalida,
  type DatosImpresoNotaSalida,
  type DepsImpresoNotaSalida,
} from './impreso-nota-salida.js';

/** Sesión de prueba con el permiso `notas.ver`. */
function sesionConVer(): SesionUsuario {
  return {
    id: 'u1',
    username: 'tester',
    nombre: 'Tester',
    idEmpresaActiva: 1,
    nombreEmpresaActiva: 'FR Moda',
    permisos: new Set(['notas.ver']),
  } as unknown as SesionUsuario;
}

/** Datos de impreso mínimos, con overrides puntuales. */
function datosBase(over: Partial<DatosImpresoNotaSalida> = {}): DatosImpresoNotaSalida {
  return {
    empresa: 'FR Moda',
    numNota: 77,
    estatus: 'confirmada',
    cancelada: false,
    motivoCancelacion: null,
    maquilero: 'Costuras del Bajío',
    almacen: 'Almacén central',
    fechaElaboracion: '2026-06-20',
    fechaEnvio: '2026-06-21',
    observaciones: 'Sale en la ruta del martes.',
    lineas: [
      {
        folioOrden: 1001,
        tipo: 'avio',
        material: 'BOT-01 — Botón',
        lote: null,
        cantidad: 120,
        unidad: 'pza',
      },
      {
        folioOrden: 1001,
        tipo: 'tela',
        material: 'Felpa francesa',
        lote: 'L-2026-09',
        cantidad: 30,
        unidad: 'm',
      },
    ],
    ...over,
  };
}

/** ¿El Buffer empieza con la firma de un PDF? */
function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('generarPdfNotaSalida', () => {
  it('devuelve un Buffer no vacío con cabecera %PDF', async () => {
    const buffer = await generarPdfNotaSalida(datosBase());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza una nota CANCELADA con su motivo, sin truncar', async () => {
    const buffer = await generarPdfNotaSalida(
      datosBase({ cancelada: true, estatus: 'cancelada', motivoCancelacion: 'envío equivocado' }),
    );
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza sin observaciones (campo opcional)', async () => {
    const buffer = await generarPdfNotaSalida(datosBase({ observaciones: null }));
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza sin renglones (nota vacía)', async () => {
    const buffer = await generarPdfNotaSalida(datosBase({ lineas: [] }));
    expect(esPdf(buffer)).toBe(true);
  });
});

describe('armarDatosImpresoNotaSalida', () => {
  /** Nota mínima tal como la devuelve `obtenerNotaSalida` (solo los campos que usa el impreso). */
  function notaSalida(over: Partial<NotaSalidaSalida> = {}): NotaSalidaSalida {
    return {
      id: 5,
      numNota: 77,
      idEmpresa: 1,
      estatus: 'confirmada',
      idMaquilero: 9,
      maquilero: 'Costuras del Bajío',
      idAlmacen: 2,
      almacen: 'Almacén central',
      fechaElaboracion: '2026-06-20',
      fechaEnvio: '2026-06-21',
      observaciones: null,
      confirmadaEn: '2026-06-20T10:00:00.000Z',
      confirmadaPorId: 'u9',
      canceladaEn: null,
      canceladaPorId: null,
      motivoCancelacion: null,
      lineas: [
        {
          id: 1,
          idOrden: 50,
          folioOrden: 1001,
          tipo: 'avio',
          idAvio: 3,
          avio: 'BOT-01 — Botón',
          idTela: null,
          tela: null,
          idLote: null,
          loteClave: null,
          idMovimientoSalidaTela: null,
          folioMovimientoSalidaTela: null,
          idMovimientoAvio: 200,
          folioMovimientoAvio: 200,
          cantidad: 120,
          unidad: 'pza',
          descripcionLegacy: null,
        },
        {
          id: 2,
          idOrden: 50,
          folioOrden: 1001,
          tipo: 'tela',
          idAvio: null,
          avio: null,
          idTela: 7,
          tela: 'Felpa francesa',
          idLote: 11,
          loteClave: 'L-2026-09',
          idMovimientoSalidaTela: 300,
          folioMovimientoSalidaTela: 300,
          idMovimientoAvio: null,
          folioMovimientoAvio: null,
          cantidad: 30,
          unidad: 'm',
          descripcionLegacy: null,
        },
      ],
      creadoEn: '2026-06-20T09:00:00.000Z',
      creadoPorId: 'u1',
      modificadoEn: '2026-06-20T09:00:00.000Z',
      modificadoPorId: 'u1',
      ...over,
    };
  }

  function depsCon(nota: NotaSalidaSalida): DepsImpresoNotaSalida {
    return { obtenerNotaSalida: () => Promise.resolve(nota) };
  }

  it('reúsa obtenerNotaSalida y proyecta material (avío/tela), lote y cantidad', async () => {
    const datos = await armarDatosImpresoNotaSalida(
      sesionConVer(),
      5,
      undefined,
      depsCon(notaSalida()),
    );

    expect(datos.empresa).toBe('FR Moda');
    expect(datos.numNota).toBe(77);
    expect(datos.maquilero).toBe('Costuras del Bajío');
    expect(datos.almacen).toBe('Almacén central');
    expect(datos.lineas).toHaveLength(2);
    // Renglón de avío: material = clave/descripción del avío; sin lote.
    expect(datos.lineas[0]?.tipo).toBe('avio');
    expect(datos.lineas[0]?.material).toBe('BOT-01 — Botón');
    expect(datos.lineas[0]?.lote).toBeNull();
    expect(datos.lineas[0]?.folioOrden).toBe(1001);
    // Renglón de tela: material = nombre de la tela; con lote.
    expect(datos.lineas[1]?.tipo).toBe('tela');
    expect(datos.lineas[1]?.material).toBe('Felpa francesa');
    expect(datos.lineas[1]?.lote).toBe('L-2026-09');

    // El PDF se genera con esos datos.
    const buffer = await generarPdfNotaSalida(datos);
    expect(esPdf(buffer)).toBe(true);
  });

  // V1-E3b — el renglón MIGRADO (sin avío ni tela) trae su TEXTO LIBRE: antes caía en la rama de
  // tela y salía impreso con el material EN BLANCO.
  it('el renglón MIGRADO imprime su descripcionLegacy como material', async () => {
    const nota = notaSalida({
      lineas: [
        {
          id: 3,
          idOrden: 50,
          folioOrden: 1001,
          tipo: 'historico',
          idAvio: null,
          avio: null,
          idTela: null,
          tela: null,
          idLote: null,
          loteClave: null,
          idMovimientoSalidaTela: null,
          folioMovimientoSalidaTela: null,
          idMovimientoAvio: null,
          folioMovimientoAvio: null,
          cantidad: 0,
          unidad: null,
          descripcionLegacy: '3 conos hilo negro y etiquetas',
        },
      ],
    });
    const datos = await armarDatosImpresoNotaSalida(sesionConVer(), 5, undefined, depsCon(nota));

    expect(datos.lineas[0]?.tipo).toBe('historico');
    expect(datos.lineas[0]?.material).toBe('3 conos hilo negro y etiquetas');
    const buffer = await generarPdfNotaSalida(datos);
    expect(esPdf(buffer)).toBe(true);
  });

  it('marca cancelada cuando el estatus es "cancelada"', async () => {
    const nota = notaSalida({ estatus: 'cancelada', motivoCancelacion: 'duplicada' });
    const datos = await armarDatosImpresoNotaSalida(sesionConVer(), 5, undefined, depsCon(nota));
    expect(datos.cancelada).toBe(true);
    expect(datos.motivoCancelacion).toBe('duplicada');
  });

  it('propaga el ErrorNoEncontrado de obtenerNotaSalida (nota de otra empresa → 404)', async () => {
    const deps: DepsImpresoNotaSalida = {
      obtenerNotaSalida: () => Promise.reject(new ErrorNoEncontrado('NotaSalida', 999)),
    };
    await expect(
      armarDatosImpresoNotaSalida(sesionConVer(), 999, undefined, deps),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
