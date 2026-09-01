/**
 * ⭐⭐ **GENERAR LA OP PROMUEVE EL MODELO SOLA** — y desde V1-E9c (§Post-F9.169) lo hace **haya o no
 * haya revisión firmada**.
 *
 * `salidaAProduccion` paso 4 llama al MISMO núcleo que el endpoint «pasar a producción»
 * (`promoverAProduccionNucleo`), así que este archivo prueba el segundo de los dos caminos que
 * promueven.
 *
 * 🔴 **Este bloque decía lo contrario hasta V1-E9c.** V1-E7d lo escribió como *"la puerta
 * lateral"*: aquí se demostraba que una versión sin revisar NO podía generar su OP. Daniel disolvió
 * esa compuerta: *«Todo lo que no está firmado simplemente no se puede comprar. **Pero no detiene
 * ni la producción** ni los demás renglones ya firmados.»* Las pruebas se dieron **vuelta**, no se
 * borraron: recorren las mismas poblaciones y ahora exigen que la OP **salga igual** y que el
 * modelo se promueva. Si alguien vuelve a colgar una guarda de revisión de este camino, este bloque
 * muere.
 *
 * ⚠️ **Qué se dobla y qué NO.** Se mockean los COLABORADORES que no son la regla —`crearOrden`
 * (que abre media base de datos), la liga al desarrollo y el disparo del outbox— y se le pasa al
 * servicio una transacción de mentiras por `bd.tx` (composición A2). La promoción corre **de
 * verdad**: `promoverAProduccionNucleo` es código real leyendo el modelo real del doble.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    idModeloDesarrollo: null,
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

describe('salidaAProduccion — la REVISIÓN ya NO detiene generar la OP (V1-E9c)', () => {
  /** Genera la OP y comprueba que el modelo se promovió de verdad (no sólo que no lanzó). */
  async function generaYPromueve(modelo: Record<string, unknown>): Promise<void> {
    const { tx, llamadas } = txRegistrador(modelo);
    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });

    expect(salida.numeroProduccion).toBe(71_001);
    expect(salida.numeroProduccionMinteado).toBe(true);
    expect(salida.codigoModeloAnterior).toBe(modelo.codigo);
    expect(llamadas.find((l) => l.metodo === 'modelo.update')?.args).toMatchObject({
      data: { origen: 'produccion', numeroProduccion: 71_001 },
    });
  }

  it('⭐⭐ la OP de una versión SIN REVISAR se genera, y el modelo se promueve', async () => {
    // 🔴 LA PRUEBA DE LA ETAPA. Antes esto era `rejects.toThrow(ErrorConflicto)`: la orden entra
    // con la receta pendiente de revisar, y lo que se frena renglón por renglón es COMPRAR.
    await generaYPromueve(modeloFalso());
  });

  it('⭐ una versión SIN estado de revisión (null) también genera su OP', async () => {
    await generaYPromueve(modeloFalso({ revisionEstado: null }));
  });

  it('⭐⭐ una versión RECHAZADA también genera su OP: el rechazo no detiene producir', async () => {
    await generaYPromueve(
      modeloFalso({
        revisionEstado: 'rechazada',
        revisadoEn: new Date('2026-08-25T00:00:00.000Z'),
        revisionNota: 'el cierre que se quitó sí costaba',
      }),
    );
  });

  it('una versión APROBADA genera su OP y estrena su número de 5 dígitos, como siempre', async () => {
    await generaYPromueve(modeloFalso({ revisionEstado: 'aprobada' }));
  });

  it('⭐ un modelo que NO es versión genera su OP como siempre (conducta intacta)', async () => {
    // Los ~4,987 migrados del Access y todo desarrollo normal: nunca llevaron revisión.
    await generaYPromueve(
      modeloFalso({
        codigo: 'CYA-26-71-001',
        codigoDesarrollo: 'CYA-26-71-001',
        idModeloPadre: null,
        versionDesarrollo: null,
        revisionEstado: null,
      }),
    );
  });

  it('un modelo YA en producción hereda su número, sin volver a promoverse', async () => {
    // Aquí el núcleo ni se llama: la OP hereda el número que el modelo ya tenía. Control negativo
    // del camino entero — si `salidaAProduccion` empezara a promover lo ya promovido, cae aquí.
    const { tx } = txRegistrador(
      modeloFalso({ origen: 'produccion', codigo: '71001', numeroProduccion: 71_001 }),
    );
    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });
    expect(salida.numeroProduccion).toBe(71_001);
    expect(salida.numeroProduccionMinteado).toBe(false);
  });
});
