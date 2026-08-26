/**
 * ⭐⭐ V1-E7d — **LA PUERTA LATERAL** (§Post-F9.110). La prueba más importante de la etapa.
 *
 * Daniel pidió una REVISIÓN antes de mandar a producir lo que salió de una negociación. Pero
 * «mandar a producir» tiene DOS puertas, no una:
 *
 *  1. El endpoint «pasar a producción» (`modelos/nomenclatura.ts`, probado en su propio archivo).
 *  2. **Generar la OP**: `salidaAProduccion` paso 4 llama al MISMO núcleo y **promueve el modelo
 *     sola**. Ésta es la puerta por la que una versión sin revisar llegaría a producción sin que
 *     nadie la firmara — y es la única razón por la que la compuerta vive en
 *     `promoverAProduccionNucleo` y no en el endpoint. *Esconder un botón es cortesía; negar la
 *     operación es la regla.*
 *
 * Si este archivo desaparece, la etapa no está hecha.
 *
 * ⚠️ **Qué se dobla y qué NO.** Se mockean los COLABORADORES que no son la regla —`crearOrden`
 * (que abre media base de datos), la liga al desarrollo y el disparo del outbox— y se le pasa al
 * servicio una transacción de mentiras por `bd.tx` (composición A2). La compuerta corre **de
 * verdad**: `promoverAProduccionNucleo` es código real leyendo el modelo real del doble. Un doble
 * que mockeara la compuerta probaría la suposición del doble, no el sistema.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorConflicto } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

const crearOrden = vi.fn();
const obtenerOrden = vi.fn();
const ligarOrdenNucleo = vi.fn();

vi.mock('./ordenes.js', () => ({
  crearOrden: (...a: unknown[]) => crearOrden(...a) as unknown,
  obtenerOrden: (...a: unknown[]) => obtenerOrden(...a) as unknown,
  sincronizarReferencias: vi.fn(),
  validarReferencias: vi.fn(),
}));

vi.mock('../desarrollo/liga-orden.js', () => ({
  ligarOrdenNucleo: (...a: unknown[]) => ligarOrdenNucleo(...a) as unknown,
}));

vi.mock('../../comun/cola-eventos.js', () => ({ dispararPublicacion: vi.fn() }));

const { salidaAProduccion } = await import('./salida-produccion.js');

const SESION = sesionDePrueba({ permisos: ['ordenes.administrar'] });

/** La matriz mínima que el servicio exige (piezas > 0). */
const MATRIZ = { lineas: [{ idColor: 3, tallas: [{ idTalla: 9, cantidad: 120 }] }] };

/**
 * Modelo tal como lo lee el paso 4. `extra` dice qué lo distingue en cada caso; por defecto es una
 * VERSIÓN de desarrollo sin revisar — el caso que esta etapa vino a impedir.
 */
function modeloFalso(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    codigo: 'CYA-26-71-001-01',
    codigoDesarrollo: 'CYA-26-71-001-01',
    origen: 'desarrollo',
    numeroProduccion: null,
    idTipoProducto: 5,
    idGenero: 4,
    idModeloPadre: 7,
    versionDesarrollo: 1,
    revisionEstado: 'pendiente',
    revisadoEn: null,
    revisionNota: null,
    ...extra,
  };
}

/**
 * `tx` de mentiras que REGISTRA cada llamada. Emula lo mínimo que recorre el camino completo: el
 * renglón de pedido, el modelo (dos lecturas: la del paso 4 y la del núcleo), los dígitos del par,
 * el lock, la ocupación de la serie (`$queryRaw` vacío = todo libre), el centinela de choque, la
 * escritura y la bitácora. No filtra `where`: por eso se afirma QUÉ se llamó y qué NO.
 */
function txRegistrador(modelo: Record<string, unknown>): {
  tx: Tx;
  llamadas: { metodo: string; args: unknown }[];
} {
  const llamadas: { metodo: string; args: unknown }[] = [];
  const reg = <T>(metodo: string, args: unknown, resultado: T): Promise<T> => {
    llamadas.push({ metodo, args });
    return Promise.resolve(resultado);
  };
  const tx = {
    pedidoLinea: {
      findFirst: (args: unknown) =>
        reg('pedidoLinea.findFirst', args, {
          id: 1,
          idModelo: 42,
          // Sin desarrollo: la liga no es lo que se prueba aquí (y su núcleo está mockeado).
          idDesarrollo: null,
          pedido: {
            id: 10,
            folio: 500n,
            fechaDe: new Date('2026-09-01T00:00:00.000Z'),
            fechaHasta: new Date('2026-09-30T00:00:00.000Z'),
          },
        }),
    },
    modelo: {
      findUniqueOrThrow: (args: unknown) => reg('modelo.findUniqueOrThrow', args, modelo),
      findUnique: (args: unknown) => reg('modelo.findUnique', args, modelo),
      findFirst: (args: unknown) => reg('modelo.findFirst', args, null),
      update: (args: unknown) => reg('modelo.update', args, {}),
    },
    tipoProducto: {
      findUnique: (args: unknown) =>
        reg('tipoProducto.findUnique', args, { nombre: 'Pantalón', digitoConcepto: 7 }),
    },
    genero: {
      findUnique: (args: unknown) =>
        reg('genero.findUnique', args, {
          nombre: 'Caballero',
          digitoNomenclatura: 1,
          digitoAlterno: 5,
        }),
    },
    $executeRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$executeRaw', { sql: plantilla.join('?'), valores }, 1),
    $queryRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$queryRaw', { sql: plantilla.join('?'), valores }, []),
    bitacora: { create: (args: unknown) => reg('bitacora.create', args, {}) },
  };
  return { tx: tx as unknown as Tx, llamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
  crearOrden.mockResolvedValue({ id: 900, folio: 5558, idCliente: 3 });
  obtenerOrden.mockResolvedValue({ id: 900, folio: 5558, idCliente: 3 });
});

describe('salidaAProduccion — LA PUERTA LATERAL de la revisión (V1-E7d)', () => {
  it('⭐⭐ generar la OP de una versión SIN REVISAR se NIEGA', async () => {
    // Ésta es LA prueba. Con la compuerta puesta sólo en el endpoint «pasar a producción», este
    // camino promovería la versión igual y la etapa entera sería decorativa.
    const { tx } = txRegistrador(modeloFalso());
    await expect(salidaAProduccion(SESION, 1, MATRIZ, { tx })).rejects.toThrow(ErrorConflicto);
  });

  it('⭐⭐ el mensaje es el de la revisión, no un error cualquiera', async () => {
    const { tx } = txRegistrador(modeloFalso());
    await expect(salidaAProduccion(SESION, 1, MATRIZ, { tx })).rejects.toThrow(
      /nació de una negociación y su receta todavía NO pasa la REVISIÓN/,
    );
  });

  it('⭐ el modelo NO se promueve: no se escribe ni se toma el lock del par', async () => {
    // Todo el paso 4 corre dentro de la transacción del servicio (A2): al lanzar, nada persiste.
    // Pero además la compuerta corta ANTES de escribir, y eso se ve en las llamadas.
    const { tx, llamadas } = txRegistrador(modeloFalso());
    await expect(salidaAProduccion(SESION, 1, MATRIZ, { tx })).rejects.toThrow();

    expect(llamadas.map((l) => l.metodo)).not.toContain('modelo.update');
    expect(llamadas.map((l) => l.metodo)).not.toContain('$executeRaw');
  });

  it('una versión RECHAZADA tampoco genera OP, y el motivo llega al mensaje', async () => {
    const { tx } = txRegistrador(
      modeloFalso({
        revisionEstado: 'rechazada',
        revisadoEn: new Date('2026-08-25T00:00:00.000Z'),
        revisionNota: 'el cierre que se quitó sí costaba',
      }),
    );
    await expect(salidaAProduccion(SESION, 1, MATRIZ, { tx })).rejects.toThrow(
      /el cierre que se quitó sí costaba/,
    );
  });

  it('⭐ una versión APROBADA sí genera su OP y estrena su número de 5 dígitos', async () => {
    const { tx, llamadas } = txRegistrador(modeloFalso({ revisionEstado: 'aprobada' }));
    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });

    expect(salida.numeroProduccion).toBe(71_001);
    expect(salida.numeroProduccionMinteado).toBe(true);
    expect(salida.codigoModeloAnterior).toBe('CYA-26-71-001-01');
    expect(llamadas.find((l) => l.metodo === 'modelo.update')?.args).toMatchObject({
      data: { origen: 'produccion', numeroProduccion: 71_001 },
    });
  });

  it('⭐ un modelo que NO es versión genera su OP como siempre (conducta intacta)', async () => {
    // Los ~4,987 migrados del Access y todo desarrollo normal: esta etapa NO les puso compuerta.
    const { tx } = txRegistrador(
      modeloFalso({
        codigo: 'CYA-26-71-001',
        codigoDesarrollo: 'CYA-26-71-001',
        idModeloPadre: null,
        versionDesarrollo: null,
        revisionEstado: null,
      }),
    );
    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });
    expect(salida.numeroProduccion).toBe(71_001);
    expect(salida.numeroProduccionMinteado).toBe(true);
  });

  it('un modelo YA en producción genera su OP sin tocar la revisión', async () => {
    // Aquí el núcleo ni se llama: la OP hereda el número que el modelo ya tenía. Sirve de control
    // negativo — si la compuerta se colara en este camino, este caso se rompería.
    const { tx } = txRegistrador(
      modeloFalso({ origen: 'produccion', codigo: '71001', numeroProduccion: 71_001 }),
    );
    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });
    expect(salida.numeroProduccion).toBe(71_001);
    expect(salida.numeroProduccionMinteado).toBe(false);
  });
});
