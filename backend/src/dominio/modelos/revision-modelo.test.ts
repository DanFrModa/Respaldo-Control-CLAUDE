/**
 * ⭐ V1-E7d — LA REVISIÓN ANTES DE MANDAR A PRODUCIR (§Post-F9.110).
 *
 * Dos bloques, y la diferencia importa:
 *
 *  1. **LA COMPUERTA**, que es una función PURA: sin base, sin dobles, sin nada que pueda mentir.
 *     Aquí vive la regla entera —a quién alcanza, a quién NO, y qué dice cuando niega—.
 *  2. **Las dos FIRMAS** (aprobar / rechazar), contra un `tx` que es un **REGISTRADOR DE
 *     LLAMADAS**, no una imitación de Prisma. Sólo se afirma sobre lo que el registrador ve de
 *     verdad: QUÉ se llamó, con QUÉ argumentos y qué NO se llamó nunca. Nada que dependa de que el
 *     doble filtre un `where` (eso probaría la suposición del doble, no el sistema).
 *
 * Que la compuerta gobierne LOS DOS CAMINOS a producción se prueba aparte, donde de verdad se
 * puede romper: `nomenclatura.test.ts` (endpoint «pasar a producción») y
 * `../produccion/salida-produccion.test.ts` (**la puerta lateral**: generar la OP promueve el
 * modelo sola).
 */
import { describe, expect, it } from 'vitest';

import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  aprobarRevisionModelo,
  esVersionDeModelo,
  exigirRevisionAprobadaParaProducir,
  rechazarRevisionModelo,
  type RevisionDeModelo,
} from './revision-modelo.js';

// ── 1. LA COMPUERTA (pura) ────────────────────────────────────────────────────

/** Un modelo cualquiera; `extra` dice qué lo distingue en cada caso. */
function modelo(extra: Partial<RevisionDeModelo> = {}): RevisionDeModelo {
  return {
    codigo: 'CYA-26-71-001-01',
    idModeloPadre: 7,
    versionDesarrollo: 1,
    revisionEstado: null,
    revisadoEn: null,
    revisionNota: null,
    ...extra,
  };
}

describe('exigirRevisionAprobadaParaProducir — a quién NO alcanza', () => {
  it('⭐ un modelo que NO es versión pasa igual que siempre (los ~4,987 migrados del Access)', () => {
    // LA aserción que impide que esta etapa se ensanche sola: la revisión es de lo que nació de
    // una negociación. Si la compuerta dejara de mirar el linaje, TODO el catálogo dejaría de
    // poder pasar a producción — 4,987 modelos y todo desarrollo normal.
    expect(() =>
      exigirRevisionAprobadaParaProducir(
        modelo({ codigo: '71001', idModeloPadre: null, versionDesarrollo: null }),
      ),
    ).not.toThrow();
  });

  it('un modelo que no es versión pasa AUNQUE traiga un estado de revisión colgando', () => {
    // Defensa contra el orden de las condiciones: si alguien invirtiera "¿es versión?" y "¿está
    // aprobada?", un dato residual bloquearía un modelo normal.
    expect(() =>
      exigirRevisionAprobadaParaProducir(
        modelo({
          codigo: '71001',
          idModeloPadre: null,
          versionDesarrollo: null,
          revisionEstado: 'pendiente',
        }),
      ),
    ).not.toThrow();
  });
});

describe('exigirRevisionAprobadaParaProducir — a quién SÍ', () => {
  it('⭐ una versión PENDIENTE no puede mandarse a producir', () => {
    expect(() => exigirRevisionAprobadaParaProducir(modelo({ revisionEstado: 'pendiente' }))).toThrow(
      ErrorConflicto,
    );
  });

  it('⭐ una versión SIN estado (nacida antes de esta etapa) tampoco: null se lee como pendiente', () => {
    // Las versiones que ya existían cuando esto se desplegó tienen la columna en NULL. La lectura
    // conservadora es "nadie la firmó", nunca "se da por buena".
    expect(() => exigirRevisionAprobadaParaProducir(modelo({ revisionEstado: null }))).toThrow(
      ErrorConflicto,
    );
  });

  it('una versión RECHAZADA tampoco, y el mensaje trae el motivo y la fecha', () => {
    let mensaje = '';
    try {
      exigirRevisionAprobadaParaProducir(
        modelo({
          revisionEstado: 'rechazada',
          revisadoEn: new Date('2026-08-25T18:30:00.000Z'),
          revisionNota: 'le quitaron el cierre sin bajar el precio',
        }),
      );
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toContain('RECHAZADA');
    expect(mensaje).toContain('le quitaron el cierre sin bajar el precio');
    expect(mensaje).toContain('2026-08-25');
  });

  it('⭐ una versión APROBADA pasa (la firma es lo que abre la puerta)', () => {
    expect(() =>
      exigirRevisionAprobadaParaProducir(modelo({ revisionEstado: 'aprobada' })),
    ).not.toThrow();
  });

  it('basta CUALQUIERA de las dos columnas del linaje para caer bajo la revisión', () => {
    // Una versión cuyo código se capturó a mano puede no tener `versionDesarrollo`; una importada
    // puede no tener padre. Exigir las dos dejaría un hueco por el que se cuela sin firma.
    expect(() =>
      exigirRevisionAprobadaParaProducir(modelo({ versionDesarrollo: null })),
    ).toThrow(ErrorConflicto);
    expect(() => exigirRevisionAprobadaParaProducir(modelo({ idModeloPadre: null }))).toThrow(
      ErrorConflicto,
    );
  });

  it('el mensaje dice QUIÉN puede desatorarlo, no sólo que no se pudo', () => {
    let mensaje = '';
    try {
      exigirRevisionAprobadaParaProducir(modelo({ revisionEstado: 'pendiente' }));
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toContain('Aprobar receta');
    expect(mensaje).toContain('CYA-26-71-001-01');
  });
});

describe('esVersionDeModelo', () => {
  it('es versión si tiene padre O número de versión; si no, no', () => {
    expect(esVersionDeModelo({ idModeloPadre: 7, versionDesarrollo: 1 })).toBe(true);
    expect(esVersionDeModelo({ idModeloPadre: 7, versionDesarrollo: null })).toBe(true);
    expect(esVersionDeModelo({ idModeloPadre: null, versionDesarrollo: 2 })).toBe(true);
    expect(esVersionDeModelo({ idModeloPadre: null, versionDesarrollo: null })).toBe(false);
  });
});

// ── 2. Las FIRMAS (registrador de llamadas) ───────────────────────────────────

const SESION = sesionDePrueba({ permisos: ['modelos.aprobar-receta'] });

interface Llamada {
  metodo: string;
  args: unknown;
}

/** Lo que devuelve `modelo.findUnique` (el modelo que se va a firmar). */
function filaFalsa(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    codigo: 'CYA-26-71-001-01',
    origen: 'desarrollo',
    idModeloPadre: 7,
    versionDesarrollo: 1,
    revisionEstado: 'pendiente',
    idRevisadoPor: null,
    revisadoEn: null,
    revisionNota: null,
    revisadoPor: null,
    ...extra,
  };
}

/** `tx` de mentiras que REGISTRA cada llamada y devuelve el fixture que le toca. */
function txRegistrador(fila: Record<string, unknown> | null = filaFalsa()): {
  tx: Tx;
  llamadas: Llamada[];
} {
  const llamadas: Llamada[] = [];
  const reg = <T>(metodo: string, args: unknown, resultado: T): Promise<T> => {
    llamadas.push({ metodo, args });
    return Promise.resolve(resultado);
  };
  const tx = {
    modelo: {
      findUnique: (args: unknown) => reg('modelo.findUnique', args, fila),
      update: (args: unknown) => reg('modelo.update', args, {}),
      delete: (args: unknown) => reg('modelo.delete', args, {}),
      deleteMany: (args: unknown) => reg('modelo.deleteMany', args, { count: 0 }),
    },
    bitacora: { create: (args: unknown) => reg('bitacora.create', args, {}) },
  };
  return { tx: tx as unknown as Tx, llamadas };
}

/** Los `data` del `modelo.update` (lo que quedó escrito en la fila). */
function datosDelUpdate(llamadas: Llamada[]): Record<string, unknown> {
  const update = llamadas.find((l) => l.metodo === 'modelo.update');
  expect(update, 'no se escribió la firma en el modelo').toBeDefined();
  return (update?.args as { data: Record<string, unknown> }).data;
}

describe('aprobarRevisionModelo', () => {
  it('⭐ exige `modelos.aprobar-receta` (y NO se conforma con administrar modelos)', async () => {
    // El permiso se verifica ANTES de abrir la transacción, así que esto no toca la base. Y el
    // permiso es el de la RECETA: `listas.aprobar` es el PRECIO y es sólo del dueño — no se mezclan.
    const sinPermiso = sesionDePrueba({
      permisos: ['modelos.ver', 'modelos.administrar', 'listas.aprobar'],
    });
    const { tx, llamadas } = txRegistrador();
    await expect(aprobarRevisionModelo(sinPermiso, 42, {}, { tx })).rejects.toThrow(ErrorPermiso);
    expect(llamadas).toEqual([]);
  });

  it('⭐ escribe la firma COMPLETA: resultado + quién + cuándo (A7)', async () => {
    const { tx, llamadas } = txRegistrador();
    const antes = Date.now();
    const salida = await aprobarRevisionModelo(SESION, 42, { nota: 'la revisé con Daniel' }, { tx });

    const data = datosDelUpdate(llamadas);
    expect(data.revisionEstado).toBe('aprobada');
    expect(data.idRevisadoPor).toBe(SESION.id);
    expect(data.revisionNota).toBe('la revisé con Daniel');
    // "Cuándo" no es adorno: sin fecha, la firma no dice si se revisó ANTES o DESPUÉS del cambio.
    expect(data.revisadoEn).toBeInstanceOf(Date);
    expect((data.revisadoEn as Date).getTime()).toBeGreaterThanOrEqual(antes);

    expect(salida).toMatchObject({
      idModelo: 42,
      codigo: 'CYA-26-71-001-01',
      revisionEstado: 'aprobada',
      idRevisadoPor: SESION.id,
      revisadoPor: SESION.nombre,
    });
  });

  it('deja bitácora del acto, con el estado ANTERIOR (la secuencia no se pierde, D3)', async () => {
    const { tx, llamadas } = txRegistrador(
      filaFalsa({ revisionEstado: 'rechazada', revisionNota: 'faltó el cierre' }),
    );
    await aprobarRevisionModelo(SESION, 42, {}, { tx });

    const bitacora = llamadas.find((l) => l.metodo === 'bitacora.create');
    expect(bitacora?.args).toMatchObject({
      data: {
        entidad: 'Modelo',
        accion: 'MODIFICAR',
        datos: {
          operacion: 'aprobar-revision',
          codigo: 'CYA-26-71-001-01',
          // Lo que la FILA ya no guarda tras la firma nueva: de qué se venía. Con esto, la
          // bitácora sola cuenta la historia (rechazada por X → aprobada por Y).
          estadoAnterior: 'rechazada',
          notaAnterior: 'faltó el cierre',
        },
      },
    });
  });

  it('una nota en blanco se guarda como null (una nota vacía no es una nota)', async () => {
    const { tx, llamadas } = txRegistrador();
    await aprobarRevisionModelo(SESION, 42, { nota: '   ' }, { tx });
    expect(datosDelUpdate(llamadas).revisionNota).toBeNull();
  });

  it('⭐ aprobar DOS VECES es conflicto: la segunda firma borraría a quien firmó primero', async () => {
    const { tx, llamadas } = txRegistrador(filaFalsa({ revisionEstado: 'aprobada' }));
    await expect(aprobarRevisionModelo(SESION, 42, {}, { tx })).rejects.toThrow(ErrorConflicto);
    expect(llamadas.map((l) => l.metodo)).toEqual(['modelo.findUnique']);
  });

  it('⭐ un modelo que NO es versión no se firma: no lleva revisión', async () => {
    // Firmar un modelo cualquiera implicaría que el catálogo entero necesita firma — regla que
    // Daniel no ha pedido. Se rechaza diciendo que ese modelo puede producirse sin firma.
    const { tx } = txRegistrador(
      filaFalsa({ codigo: '71001', idModeloPadre: null, versionDesarrollo: null }),
    );
    await expect(aprobarRevisionModelo(SESION, 42, {}, { tx })).rejects.toThrow(ErrorValidacion);
  });

  it('un modelo YA en producción no se firma (la revisión es ANTES de mandar a producir)', async () => {
    const { tx } = txRegistrador(filaFalsa({ origen: 'produccion' }));
    await expect(aprobarRevisionModelo(SESION, 42, {}, { tx })).rejects.toThrow(ErrorConflicto);
  });

  it('un modelo que no existe es `ErrorNoEncontrado`, no un crash', async () => {
    const { tx } = txRegistrador(null);
    await expect(aprobarRevisionModelo(SESION, 42, {}, { tx })).rejects.toThrow(ErrorNoEncontrado);
  });
});

describe('rechazarRevisionModelo', () => {
  it('⭐ exige `modelos.aprobar-receta`', async () => {
    const sinPermiso = sesionDePrueba({ permisos: ['modelos.administrar'] });
    const { tx, llamadas } = txRegistrador();
    await expect(
      rechazarRevisionModelo(sinPermiso, 42, { motivo: 'x' }, { tx }),
    ).rejects.toThrow(ErrorPermiso);
    expect(llamadas).toEqual([]);
  });

  it('⭐ el MOTIVO es obligatorio, y sin él no se toca la base', async () => {
    // Un rechazo sin motivo no le dice nada a quien tiene que corregir la receta.
    const { tx, llamadas } = txRegistrador();
    await expect(rechazarRevisionModelo(SESION, 42, { motivo: '   ' }, { tx })).rejects.toThrow(
      ErrorValidacion,
    );
    expect(llamadas).toEqual([]);
  });

  it('escribe la firma completa con el motivo, y deja bitácora', async () => {
    const { tx, llamadas } = txRegistrador();
    const salida = await rechazarRevisionModelo(
      SESION,
      42,
      { motivo: 'el forro no aguanta el precio acordado' },
      { tx },
    );

    const data = datosDelUpdate(llamadas);
    expect(data.revisionEstado).toBe('rechazada');
    expect(data.idRevisadoPor).toBe(SESION.id);
    expect(data.revisionNota).toBe('el forro no aguanta el precio acordado');
    expect(data.revisadoEn).toBeInstanceOf(Date);
    expect(salida.revisionEstado).toBe('rechazada');

    expect(llamadas.find((l) => l.metodo === 'bitacora.create')?.args).toMatchObject({
      data: { datos: { operacion: 'rechazar-revision', motivo: 'el forro no aguanta el precio acordado' } },
    });
  });

  it('rechazar OTRA VEZ sí se permite, y el motivo anterior no se pierde', async () => {
    // Asimetría deliberada con `aprobar`: un segundo vistazo con otra observación es información
    // nueva. Lo que la fila sustituye, la bitácora lo conserva.
    const { tx, llamadas } = txRegistrador(
      filaFalsa({ revisionEstado: 'rechazada', revisionNota: 'faltó el cierre' }),
    );
    await rechazarRevisionModelo(SESION, 42, { motivo: 'y además el pantone' }, { tx });

    expect(datosDelUpdate(llamadas).revisionNota).toBe('y además el pantone');
    expect(llamadas.find((l) => l.metodo === 'bitacora.create')?.args).toMatchObject({
      data: { datos: { estadoAnterior: 'rechazada', notaAnterior: 'faltó el cierre' } },
    });
  });

  it('⭐ un modelo que NO es versión no se rechaza tampoco', async () => {
    const { tx } = txRegistrador(
      filaFalsa({ codigo: '71001', idModeloPadre: null, versionDesarrollo: null }),
    );
    await expect(rechazarRevisionModelo(SESION, 42, { motivo: 'x' }, { tx })).rejects.toThrow(
      ErrorValidacion,
    );
  });

  it('la firma NUNCA borra ni edita otra cosa del modelo: sólo un update', async () => {
    // D3: la versión rechazada sigue existiendo y sigue editándose; lo único que cambia es la
    // firma. Si alguna vez esto se "resolviera" descontinuando el modelo, aquí se ve.
    const { tx, llamadas } = txRegistrador();
    await rechazarRevisionModelo(SESION, 42, { motivo: 'x' }, { tx });
    expect(llamadas.map((l) => l.metodo)).toEqual([
      'modelo.findUnique',
      'modelo.update',
      'bitacora.create',
    ]);
  });
});
