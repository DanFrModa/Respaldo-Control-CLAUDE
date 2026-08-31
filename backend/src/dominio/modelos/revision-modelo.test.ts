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
 * Que la compuerta gobierne los dos caminos que PROMUEVEN se prueba aparte, donde de verdad se
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
  invalidarRevisionSiAprobada,
  rechazarRevisionModelo,
  revisionBloqueaProduccion,
  textoDelCambioDeReceta,
  tocarModeloPorCambioDeReceta,
  type CambioDeReceta,
  type RevisionDeModelo,
} from './revision-modelo.js';

// ── 1. LA COMPUERTA (pura) ────────────────────────────────────────────────────

/** Un modelo cualquiera; `extra` dice qué lo distingue en cada caso. */
function modelo(extra: Partial<RevisionDeModelo> = {}): RevisionDeModelo {
  return {
    codigo: 'CYA-26-71-001-01',
    idModeloPadre: 7,
    versionDesarrollo: 1,
    idModeloDesarrollo: null,
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
    expect(() =>
      exigirRevisionAprobadaParaProducir(modelo({ revisionEstado: 'pendiente' })),
    ).toThrow(ErrorConflicto);
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
    expect(mensaje).toContain('25/8/2026');
  });

  it('⭐ la fecha del mensaje es la de MÉXICO, no la del servidor (que corre en UTC)', () => {
    // Un rechazo firmado a las 20:00 de Ciudad de México cae ya en el día 26 en UTC. Con
    // `toISOString()` el mensaje decía "26/8" y la ficha del modelo —que lo pinta con
    // `toLocaleDateString('es-MX')` en el navegador— decía "25/8": dos fechas para el mismo acto,
    // y quien tiene que corregir buscando el rechazo en la bitácora se va al día equivocado.
    let mensaje = '';
    try {
      exigirRevisionAprobadaParaProducir(
        modelo({
          revisionEstado: 'rechazada',
          revisadoEn: new Date('2026-08-26T02:00:00.000Z'),
          revisionNota: 'firmado tarde',
        }),
      );
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toContain('25/8/2026');
    expect(mensaje).not.toContain('26/8/2026');
  });

  it('⭐ una versión APROBADA pasa (la firma es lo que abre la puerta)', () => {
    expect(() =>
      exigirRevisionAprobadaParaProducir(modelo({ revisionEstado: 'aprobada' })),
    ).not.toThrow();
  });

  it('basta CUALQUIERA de las dos columnas del linaje para caer bajo la revisión', () => {
    // Una versión cuyo código se capturó a mano puede no tener `versionDesarrollo`; una importada
    // puede no tener padre. Exigir las dos dejaría un hueco por el que se cuela sin firma.
    expect(() => exigirRevisionAprobadaParaProducir(modelo({ versionDesarrollo: null }))).toThrow(
      ErrorConflicto,
    );
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
    const sinHijo = { idModeloDesarrollo: null };
    expect(esVersionDeModelo({ idModeloPadre: 7, versionDesarrollo: 1, ...sinHijo })).toBe(true);
    expect(esVersionDeModelo({ idModeloPadre: 7, versionDesarrollo: null, ...sinHijo })).toBe(true);
    expect(esVersionDeModelo({ idModeloPadre: null, versionDesarrollo: 2, ...sinHijo })).toBe(true);
    expect(esVersionDeModelo({ idModeloPadre: null, versionDesarrollo: null, ...sinHijo })).toBe(
      false,
    );
  });

  /**
   * ⭐⭐ V1-E9a (§Post-F9.167 punto 2) — EL CHIP FANTASMA QUE NUNCA VA A EXISTIR.
   *
   * Un HIJO del linaje 1:N (`idModeloDesarrollo` puesto) **no es una versión**, pase lo que pase con
   * las otras dos columnas. La aserción que importa es la de la PRIMERA línea: un hijo al que
   * alguna etapa futura le ponga además `idModeloPadre` —para "guardar de dónde salió"— seguiría
   * sin ser versión. Sin esa exclusión, la ficha le pintaría *«Revisión pendiente · no puede
   * mandarse a producir»* **sin ningún botón para arreglarlo**, sobre un modelo que YA está en
   * producción (`exigirVersionRevisable` rechaza firmar cualquier cosa de producción): la cicatriz
   * de §Post-F9.119 otra vez.
   *
   * ⚠️ Hoy `derivarModeloDeProduccion` hace nacer al hijo con las DOS columnas de versión en
   * `null`, así que las tres primeras aserciones describen combinaciones que el dominio todavía no
   * produce: son **la guarda escrita**, no el retrato del dato de hoy. La última sí es el hijo tal
   * como nace.
   */
  it('⭐ un HIJO del linaje 1:N NO es versión, aunque lleve las columnas de versión puestas', () => {
    expect(
      esVersionDeModelo({ idModeloPadre: 7, versionDesarrollo: 1, idModeloDesarrollo: 9 }),
    ).toBe(false);
    expect(
      esVersionDeModelo({ idModeloPadre: 7, versionDesarrollo: null, idModeloDesarrollo: 9 }),
    ).toBe(false);
    expect(
      esVersionDeModelo({ idModeloPadre: null, versionDesarrollo: 2, idModeloDesarrollo: 9 }),
    ).toBe(false);
    // Y así es como nace de verdad hoy: sin padre, sin sufijo, con el vínculo de receta.
    expect(
      esVersionDeModelo({ idModeloPadre: null, versionDesarrollo: null, idModeloDesarrollo: 9 }),
    ).toBe(false);
  });

  /**
   * La compuerta ENTERA sobre un hijo: no basta con que el predicado diga `false` — lo que hay que
   * demostrar es que un hijo con la revisión SIN FIRMAR (el estado en que nacen todos, `null`)
   * **no queda bloqueado** ni por `revisionBloqueaProduccion` ni por la compuerta que lanza.
   */
  /**
   * 🔴 EL MODO DE FALLO QUE IMPORTA, PINCHADO. La exclusión de los hijos es lo único de este
   * predicado que puede ABRIR la compuerta, así que tiene que fallar del lado seguro: una fila a la
   * que le FALTE la columna (`undefined`, no `null`) **no** cuenta como hijo, y la versión sigue
   * necesitando su firma. Con un `!== null` en vez del `typeof`, esta prueba se pone roja — y con
   * ella se pusieron rojas, de verdad, siete pruebas de `promoverAProduccionNucleo` y
   * `salidaAProduccion` que arman la fila como `Record<string, unknown>`, donde TypeScript no llega.
   */
  it('⭐ una fila SIN la columna del linaje 1:N sigue siendo versión (lo que no se sabe, no excluye)', () => {
    const sinLaColumna = { idModeloPadre: 7, versionDesarrollo: 1 } as unknown as {
      idModeloPadre: number | null;
      versionDesarrollo: number | null;
      idModeloDesarrollo: number | null;
    };
    expect(esVersionDeModelo(sinLaColumna)).toBe(true);
    expect(revisionBloqueaProduccion({ ...sinLaColumna, revisionEstado: null })).toBe(true);
  });

  it('⭐ a un HIJO del linaje 1:N la revisión no le bloquea nada (su firma es la del padre)', () => {
    const hijo = {
      idModeloPadre: 7,
      versionDesarrollo: 1,
      idModeloDesarrollo: 9,
      revisionEstado: null,
    };
    expect(revisionBloqueaProduccion(hijo)).toBe(false);
    // Y la versión equivalente SIN el vínculo sí queda bloqueada: si las dos dieran lo mismo, este
    // par de aserciones pasaría con el predicado roto.
    expect(revisionBloqueaProduccion({ ...hijo, idModeloDesarrollo: null })).toBe(true);
    expect(() =>
      exigirRevisionAprobadaParaProducir(modelo({ idModeloDesarrollo: 9, revisionEstado: null })),
    ).not.toThrow();
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
    idModeloDesarrollo: null,
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
    const salida = await aprobarRevisionModelo(
      SESION,
      42,
      { nota: 'la revisé con Daniel' },
      { tx },
    );

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
    await expect(rechazarRevisionModelo(sinPermiso, 42, { motivo: 'x' }, { tx })).rejects.toThrow(
      ErrorPermiso,
    );
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
      data: {
        datos: { operacion: 'rechazar-revision', motivo: 'el forro no aguanta el precio acordado' },
      },
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

  it('un modelo YA en producción tampoco se rechaza (gemela de la de aprobar)', async () => {
    // El guard vive en `exigirVersionRevisable`, que las dos firmas comparten, así que hoy la
    // conducta ya está. La prueba existe para que siga estándolo el día que alguna de las dos se
    // salga del helper: un rechazo firmado DESPUÉS de producir no gobierna nada y sólo dejaría un
    // dato mentiroso colgando de un modelo que ya se está fabricando.
    const { tx } = txRegistrador(filaFalsa({ origen: 'produccion' }));
    await expect(rechazarRevisionModelo(SESION, 42, { motivo: 'x' }, { tx })).rejects.toThrow(
      ErrorConflicto,
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

// ── 3. ⭐ V1-E7e: LA APROBACIÓN SE INVALIDA SI LA RECETA CAMBIA (§Post-F9.116) ──
//
// Aquí el `tx` YA NO es sólo un registrador: es una **base de una tabla** que guarda de verdad lo
// que se escribe y lo devuelve al siguiente `findUnique`, respetando el `select` y el `where.id`.
// Hace falta así porque lo que se prueba es un CICLO —firmar, cambiar la receta, volver a leer— y
// un doble que devolviera siempre el mismo fixture probaría el fixture, no el ciclo.
//
// Para que el doble no pueda mentir con el `where`, la base arranca SIEMPRE con dos filas: la
// versión firmada y un modelo migrado del Access. Si `findUnique`/`update` ignoraran el `where`,
// el migrado se movería — y hay una aserción que lo vigila en cada prueba del ciclo.

const ID_VERSION = 42;
const ID_MIGRADO = 900;

/** El aprobador anterior: quien firmó ANTES de que alguien moviera la receta. */
const AURORA = 'usuario-aurora';
const APROBADA_EN = new Date('2026-08-12T17:00:00.000Z');

/** La versión tal como queda tras una aprobación (el punto de partida de la invalidación). */
function versionAprobada(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return filaFalsa({
    id: ID_VERSION,
    revisionEstado: 'aprobada',
    idRevisadoPor: AURORA,
    revisadoEn: APROBADA_EN,
    revisionNota: 'la revisé con Daniel',
    ...extra,
  });
}

/** Uno de los ~4,987 migrados del Access: sin linaje y sin revisión. Aquí sólo sirve de testigo. */
function modeloMigrado(): Record<string, unknown> {
  return filaFalsa({
    id: ID_MIGRADO,
    codigo: '71001',
    origen: 'produccion',
    idModeloPadre: null,
    versionDesarrollo: null,
    revisionEstado: null,
    idRevisadoPor: null,
    revisadoEn: null,
    revisionNota: null,
  });
}

/** Deja de la fila SÓLO las columnas del `select`, como haría Prisma. */
function proyectar(
  fila: Record<string, unknown>,
  select: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (select === undefined) return { ...fila };
  const salida: Record<string, unknown> = {};
  for (const [clave, pedida] of Object.entries(select)) {
    if (pedida === true) salida[clave] = fila[clave];
  }
  return salida;
}

/**
 * `tx` que se comporta como una tabla `modelo` de verdad para lo único que estas funciones hacen
 * con ella: leer por id con `select` y actualizar por id fusionando el `data`. Devuelve también
 * las filas vivas, para poder mirar cómo quedó cada una al final del ciclo.
 */
function baseFalsa(filasIniciales: Record<string, unknown>[]): {
  tx: Tx;
  llamadas: Llamada[];
  fila: (id: number) => Record<string, unknown>;
} {
  const filas = new Map<number, Record<string, unknown>>(
    filasIniciales.map((f) => [f.id as number, { ...f }]),
  );
  const llamadas: Llamada[] = [];

  const tx = {
    modelo: {
      findUnique: (args: { where: { id: number }; select?: Record<string, unknown> }) => {
        llamadas.push({ metodo: 'modelo.findUnique', args });
        const encontrada = filas.get(args.where.id);
        return Promise.resolve(
          encontrada === undefined ? null : proyectar(encontrada, args.select),
        );
      },
      update: (args: { where: { id: number }; data: Record<string, unknown> }) => {
        llamadas.push({ metodo: 'modelo.update', args });
        const encontrada = filas.get(args.where.id);
        if (encontrada === undefined) {
          // Lo mismo que hace Prisma (P2025): actualizar lo que no existe truena.
          return Promise.reject(new Error('P2025: no existe el modelo ' + String(args.where.id)));
        }
        Object.assign(encontrada, args.data);
        return Promise.resolve({ ...encontrada });
      },
    },
    bitacora: {
      create: (args: unknown) => {
        llamadas.push({ metodo: 'bitacora.create', args });
        return Promise.resolve({});
      },
    },
  };

  return {
    tx: tx as unknown as Tx,
    llamadas,
    fila: (id: number) => {
      const encontrada = filas.get(id);
      expect(encontrada, `la base falsa no tiene la fila ${id}`).toBeDefined();
      return encontrada as Record<string, unknown>;
    },
  };
}

/** El que mueve la receta NO es el que firmó: sólo administra modelos. */
const QUIEN_CAMBIA = sesionDePrueba({
  id: 'usuario-gabriel',
  permisos: ['modelos.ver', 'modelos.administrar'],
});

/** La fila viva, leída como la lee la compuerta pura. */
function comoLaVeLaCompuerta(fila: Record<string, unknown>): RevisionDeModelo {
  return {
    codigo: fila.codigo as string,
    idModeloPadre: fila.idModeloPadre as number | null,
    versionDesarrollo: fila.versionDesarrollo as number | null,
    idModeloDesarrollo: (fila.idModeloDesarrollo ?? null) as number | null,
    revisionEstado: fila.revisionEstado as RevisionDeModelo['revisionEstado'],
    revisadoEn: fila.revisadoEn as Date | null,
    revisionNota: fila.revisionNota as string | null,
  };
}

/** Los `datos` del renglón de bitácora que se escribió (el último). */
function datosDeLaBitacora(llamadas: Llamada[]): Record<string, unknown> {
  const renglon = llamadas.filter((l) => l.metodo === 'bitacora.create').at(-1);
  expect(renglon, 'no se escribió el renglón de bitácora').toBeDefined();
  return (renglon?.args as { data: { datos: Record<string, unknown> } }).data.datos;
}

describe('El doble de base sí se comporta como Prisma (si esto falla, lo de abajo no prueba nada)', () => {
  it('respeta el `select`, el `where.id` y PERSISTE lo que se escribe', async () => {
    const { tx, fila } = baseFalsa([versionAprobada(), modeloMigrado()]);
    const leido = (await (
      tx as unknown as {
        modelo: {
          findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
        };
      }
    ).modelo.findUnique({ where: { id: ID_VERSION }, select: { codigo: true } })) as Record<
      string,
      unknown
    >;
    expect(Object.keys(leido)).toEqual(['codigo']);

    await (tx as unknown as { modelo: { update: (a: unknown) => Promise<unknown> } }).modelo.update(
      { where: { id: ID_VERSION }, data: { revisionNota: 'escrita' } },
    );
    expect(fila(ID_VERSION).revisionNota).toBe('escrita');
    expect(fila(ID_MIGRADO).revisionNota).toBeNull();
  });
});

describe('invalidarRevisionSiAprobada — a quién NO toca', () => {
  it('⭐ un modelo MIGRADO (revisión en null) no cambia de conducta: ni un update, ni una bitácora', async () => {
    // El alcance que fijó Daniel: la revisión es de las VERSIONES. Si esto se ensanchara, los
    // ~4,987 migrados del Access empezarían a caer a "pendiente" cada vez que alguien les toca
    // una tela — y el catálogo entero se volvería infirmable.
    const { tx, llamadas, fila } = baseFalsa([modeloMigrado()]);
    const invalido = await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_MIGRADO, 'telas');

    expect(invalido).toBe(false);
    expect(fila(ID_MIGRADO).revisionEstado).toBeNull();
    expect(llamadas.filter((l) => l.metodo === 'modelo.update')).toEqual([]);
    expect(llamadas.filter((l) => l.metodo === 'bitacora.create')).toEqual([]);
  });

  it('una versión PENDIENTE se queda como está (no hay firma que tumbar)', async () => {
    const { tx, llamadas } = baseFalsa([versionAprobada({ revisionEstado: 'pendiente' })]);
    expect(await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_VERSION, 'arte')).toBe(false);
    expect(llamadas.filter((l) => l.metodo === 'modelo.update')).toEqual([]);
  });

  it('⭐ una versión RECHAZADA conserva su MOTIVO intacto', async () => {
    // Pisar el motivo del rechazo con el de la invalidación borraría lo único que le sirve a quien
    // tiene que corregir la receta — y no habría firma que caer, porque no había firma.
    const { tx, fila } = baseFalsa([
      versionAprobada({ revisionEstado: 'rechazada', revisionNota: 'el cierre sí costaba' }),
    ]);
    expect(await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_VERSION, 'avios')).toBe(false);
    expect(fila(ID_VERSION).revisionNota).toBe('el cierre sí costaba');
    expect(fila(ID_VERSION).revisionEstado).toBe('rechazada');
  });

  it('un modelo que no existe no revienta aquí (quien llamó ya lo exigió)', async () => {
    const { tx } = baseFalsa([versionAprobada()]);
    expect(await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, 12_345, 'telas')).toBe(false);
  });
});

describe('invalidarRevisionSiAprobada — la firma que se cae', () => {
  it('⭐ devuelve la revisión a PENDIENTE y borra de la fila a quien firmó (nadie revisó ESTA receta)', async () => {
    const { tx, fila } = baseFalsa([versionAprobada(), modeloMigrado()]);
    expect(await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_VERSION, 'telas')).toBe(true);

    const version = fila(ID_VERSION);
    expect(version.revisionEstado).toBe('pendiente');
    // Dejar a Aurora aquí sería la firma-adorno que esta etapa vino a matar: ella no ha visto
    // la receta que hay AHORA.
    expect(version.idRevisadoPor).toBeNull();
    expect(version.revisadoEn).toBeNull();
    // Y la auditoría A7 apunta a quien la movió, que es quien la dejó pendiente.
    expect(version.modificadoPorId).toBe(QUIEN_CAMBIA.id);

    // El testigo migrado no se movió: el `where` es de verdad.
    expect(fila(ID_MIGRADO).revisionEstado).toBeNull();
  });

  it('⭐ (b) la NOTA dice qué la invalidó y cuándo, y de cuándo era la firma que tumbó', async () => {
    const { tx, fila } = baseFalsa([versionAprobada()]);
    await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_VERSION, 'telas');

    const nota = fila(ID_VERSION).revisionNota as string;
    expect(nota).toContain('INVALIDÓ');
    expect(nota).toContain('TELAS');
    // ⚠️ Las fechas van en el formato de MÉXICO, no en ISO. Lo cambió V1-E7d al arreglar que el
    // mensaje y la ficha enseñaran DÍAS DISTINTOS para el mismo acto: el servidor corre en UTC, así
    // que un acto de las 20:00 en México salía con la fecha del día siguiente. `fechaDelActo` fija
    // el huso a `America/Mexico_City` y es el MISMO cálculo que hace la pantalla.
    //
    // Esta prueba afirmaba el formato ISO —era cierto cuando se escribió— y se actualiza, no se
    // afloja: sigue exigiendo las dos fechas, sólo que en la forma en que el usuario las lee.
    const hoyEnMexico = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
    expect(nota).toContain(hoyEnMexico);
    expect(nota).toContain(
      APROBADA_EN.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' }),
    );
    // Y dice qué hacer, no sólo qué pasó.
    expect(nota).toContain('volver a revisarla');
  });

  it('⭐ (c) la BITÁCORA se lleva la firma vieja entera: quién la aprobó y cuándo', async () => {
    // "Aurora la aprobó el 12, se le cambió la tela el 14": el 'quién' y el 'cuándo' salen de la
    // fila ANTES de sobrescribirla. Sin esto, la secuencia se pierde para siempre (D3).
    const { tx, llamadas } = baseFalsa([versionAprobada()]);
    await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_VERSION, 'arte');

    const datos = datosDeLaBitacora(llamadas);
    expect(datos.operacion).toBe('invalidar-revision');
    expect(datos.cambio).toBe('arte');
    expect(datos.estadoAnterior).toBe('aprobada');
    expect(datos.idAprobadorAnterior).toBe(AURORA);
    expect(datos.aprobadaEn).toBe(APROBADA_EN.toISOString());
    expect(datos.notaAnterior).toBe('la revisé con Daniel');
  });

  it('la nota nombra CADA parte de la receta por su nombre, no en clave', async () => {
    const esperado: Record<CambioDeReceta, string> = {
      telas: 'TELAS',
      avios: 'AVÍOS',
      'medidas-por-talla': 'MEDIDAS POR TALLA',
      arte: 'el ARTE',
      'copia-de-otro-modelo': 'se copió la de otro modelo',
    };
    for (const [cambio, trozo] of Object.entries(esperado) as [CambioDeReceta, string][]) {
      const { tx, fila } = baseFalsa([versionAprobada()]);
      await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_VERSION, cambio);
      expect(fila(ID_VERSION).revisionNota as string, `motivo ${cambio}`).toContain(trozo);
    }
  });
});

describe('tocarModeloPorCambioDeReceta — el embudo', () => {
  it('marca la auditoría del modelo AUNQUE no haya firma que tumbar (A7 no depende de la revisión)', async () => {
    const { tx, fila } = baseFalsa([modeloMigrado()]);
    await tocarModeloPorCambioDeReceta(tx, QUIEN_CAMBIA, ID_MIGRADO, 'avios');
    expect(fila(ID_MIGRADO).modificadoPorId).toBe(QUIEN_CAMBIA.id);
    expect(fila(ID_MIGRADO).revisionEstado).toBeNull();
  });

  it('⭐ cuando la había, la tumba Y marca la auditoría, en la misma llamada', async () => {
    const { tx, fila } = baseFalsa([versionAprobada()]);
    await tocarModeloPorCambioDeReceta(tx, QUIEN_CAMBIA, ID_VERSION, 'medidas-por-talla');
    expect(fila(ID_VERSION).revisionEstado).toBe('pendiente');
    expect(fila(ID_VERSION).modificadoPorId).toBe(QUIEN_CAMBIA.id);
  });

  // ── ⭐ V1-E8d (§Post-F9.127): la MARCA DE AGUA de la receta ────────────────────

  it('⭐ sella `recetaTocadaEn` + `recetaTocadaCambio`: la señal del aviso de costo viejo', async () => {
    const { tx, fila } = baseFalsa([modeloMigrado()]);
    const antes = Date.now();
    await tocarModeloPorCambioDeReceta(tx, QUIEN_CAMBIA, ID_MIGRADO, 'telas');

    expect(fila(ID_MIGRADO).recetaTocadaEn).toBeInstanceOf(Date);
    expect((fila(ID_MIGRADO).recetaTocadaEn as Date).getTime()).toBeGreaterThanOrEqual(antes);
    // El QUÉ no es adorno: es lo que el aviso le dice a quien tiene que decidir si recostea.
    expect(fila(ID_MIGRADO).recetaTocadaCambio).toBe('telas');
  });

  it('⭐ la sella TAMBIÉN en un modelo normal, no sólo en las versiones', async () => {
    // La revisión del modelo (V1-E7e) sólo alcanza a las VERSIONES; el precio se le pone a
    // CUALQUIER desarrollo. Si la marca de agua se escribiera dentro de `invalidarRevisionSiAprobada`
    // —que sale temprano cuando no hay firma— los ~4,987 modelos migrados y todo desarrollo normal
    // no avisarían jamás. Por eso vive en el `update` del embudo, que siempre corre.
    const { tx, fila } = baseFalsa([modeloMigrado()]);
    await tocarModeloPorCambioDeReceta(tx, QUIEN_CAMBIA, ID_MIGRADO, 'arte');
    expect(fila(ID_MIGRADO).revisionEstado).toBeNull();
    expect(fila(ID_MIGRADO).recetaTocadaCambio).toBe('arte');
  });

  it('cada cambio de receta guarda SU código, no uno genérico', async () => {
    for (const cambio of [
      'telas',
      'avios',
      'medidas-por-talla',
      'arte',
      'copia-de-otro-modelo',
    ] as CambioDeReceta[]) {
      const { tx, fila } = baseFalsa([modeloMigrado()]);
      await tocarModeloPorCambioDeReceta(tx, QUIEN_CAMBIA, ID_MIGRADO, cambio);
      expect(fila(ID_MIGRADO).recetaTocadaCambio, `cambio ${cambio}`).toBe(cambio);
    }
  });
});

describe('textoDelCambioDeReceta — el catálogo de textos es UNO', () => {
  it('traduce cada código a la MISMA frase que usa la nota de la invalidación', async () => {
    // Si nacieran dos tablas de textos, la primera corrección las desincroniza y el mismo hecho se
    // leería distinto en la ficha del modelo y en la lista de precios.
    const { tx, fila } = baseFalsa([versionAprobada()]);
    await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_VERSION, 'telas');
    expect(fila(ID_VERSION).revisionNota as string).toContain(textoDelCambioDeReceta('telas'));
  });

  it('un código desconocido (o null) da una frase honesta, nunca "undefined"', () => {
    expect(textoDelCambioDeReceta(null)).toBe('la receta');
    expect(textoDelCambioDeReceta('lo-que-sea')).toBe('la receta');
  });
});

// ── ⭐ EL CICLO COMPLETO: firmar → mover la receta → ya no se puede producir ────

/**
 * La prueba que decide la etapa, una por cada tipo de cambio de receta. Encadena las TRES piezas
 * reales sobre la MISMA fila viva —la firma de V1-E7d, el embudo de V1-E7e y la compuerta de
 * V1-E7d— porque el agujero que Daniel mandó cerrar sólo aparece al recorrerlas en ese orden: la
 * firma sola está bien, el cambio de receta solo está bien, y juntos mandaban a producir una
 * receta que nadie miró.
 *
 * Que cada PUERTA real (el PUT de telas, el de avíos, las medidas, el arte, el copiado) pase de
 * verdad por el embudo se demuestra contra Postgres en `versiones.int.test.ts`; aquí se demuestra
 * que el embudo hace lo que tiene que hacer y que la compuerta vuelve a morder.
 */
describe.each<[CambioDeReceta, string]>([
  ['telas', 'le cambian el consumo de una TELA'],
  ['avios', 'le agregan un AVÍO'],
  ['medidas-por-talla', 'le mueven las MEDIDAS POR TALLA'],
  ['arte', 'le mueven el ARTE'],
  ['copia-de-otro-modelo', 'le COPIAN la receta de otro modelo'],
])('⭐ EL CICLO — aprobada y luego %s', (cambio, relato) => {
  it(`ya NO puede mandarse a producir cuando ${relato}`, async () => {
    const { tx, fila } = baseFalsa([
      filaFalsa({ id: ID_VERSION, revisionEstado: 'pendiente' }),
      modeloMigrado(),
    ]);

    // 1. Aurora la revisa y la firma.
    await aprobarRevisionModelo(SESION, ID_VERSION, { nota: 'la revisé con Daniel' }, { tx });
    expect(fila(ID_VERSION).revisionEstado).toBe('aprobada');

    // 2. Con la firma puesta, la compuerta la deja pasar a producción.
    expect(() =>
      exigirRevisionAprobadaParaProducir(comoLaVeLaCompuerta(fila(ID_VERSION))),
    ).not.toThrow();

    // 3. Alguien MÁS le mueve la receta (no el que firmó).
    await tocarModeloPorCambioDeReceta(tx, QUIEN_CAMBIA, ID_VERSION, cambio);

    // 4. ⭐ LA AFIRMACIÓN DE LA ETAPA: la compuerta vuelve a morder. Sin la invalidación, esta
    //    línea pasa —y la OP sale sobre una receta que Aurora nunca vio—.
    expect(() => exigirRevisionAprobadaParaProducir(comoLaVeLaCompuerta(fila(ID_VERSION)))).toThrow(
      ErrorConflicto,
    );

    // 5. (d) No es un callejón sin salida: se vuelve a firmar con el MISMO permiso y vuelve a
    //    pasar. Un estado muerto sería tan defecto como el agujero.
    await aprobarRevisionModelo(SESION, ID_VERSION, {}, { tx });
    expect(fila(ID_VERSION).revisionEstado).toBe('aprobada');
    expect(() =>
      exigirRevisionAprobadaParaProducir(comoLaVeLaCompuerta(fila(ID_VERSION))),
    ).not.toThrow();

    // El testigo migrado no se movió en todo el ciclo.
    expect(fila(ID_MIGRADO).revisionEstado).toBeNull();
  });
});
