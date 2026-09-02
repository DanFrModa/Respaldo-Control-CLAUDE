/**
 * ⭐ LA REVISIÓN DE LA RECETA DE UNA VERSIÓN — V1-E7d (§Post-F9.110), **hoy un REGISTRO y ya no una
 * compuerta** (V1-E9c, §Post-F9.169).
 *
 * Dos bloques, y la diferencia importa:
 *
 *  1. **EL PREDICADO** `revisionSinAprobar`, que es una función PURA: sin base, sin dobles, sin
 *     nada que pueda mentir. Es lo que la BANDEJA «Recetas por revisar» y el chip de la ficha
 *     preguntan, y aquí vive su regla entera —a quién alcanza y a quién NO—.
 *  2. **Las dos FIRMAS** (aprobar / rechazar), contra un `tx` que es un **REGISTRADOR DE
 *     LLAMADAS**, no una imitación de Prisma. Sólo se afirma sobre lo que el registrador ve de
 *     verdad: QUÉ se llamó, con QUÉ argumentos y qué NO se llamó nunca. Nada que dependa de que el
 *     doble filtre un `where` (eso probaría la suposición del doble, no el sistema).
 *
 * 🔴 **Lo que estas pruebas YA NO afirman, y por qué.** Hasta V1-E9c había un tercer bloque sobre
 * `exigirRevisionAprobadaParaProducir` —la compuerta que le negaba producción a la versión sin
 * firma— con sus mensajes de rechazo. Daniel la disolvió (*"no detiene ni la producción ni los
 * demás renglones ya firmados"*) y la función se retiró entera, así que sus pruebas se fueron con
 * ella. Que producir NO se detenga se afirma ahora en positivo, donde se rompería:
 * `nomenclatura.test.ts` (promover y derivar) y `../produccion/salida-produccion.test.ts` (generar
 * la OP). Lo que sí frena el gasto —la liberación por renglón— vive en
 * `../produccion/receta-orden*.test.ts` y no se tocó.
 */
import { describe, expect, it } from 'vitest';

import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { Prisma } from '../../datos/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

/** La SQL cruda que reciben los dobles de `$queryRaw` (alias para no repetir el namespace). */
type PrismaSql = Prisma.Sql;

import {
  aprobarRevisionModelo,
  esVersionDeModelo,
  invalidarRevisionSiAprobada,
  rechazarRevisionModelo,
  revisionSinAprobar,
  textoDelCambioDeReceta,
  tocarModeloPorCambioDeReceta,
  type CambioDeReceta,
  type RevisionDeModelo,
} from './revision-modelo.js';

// ── 1. EL PREDICADO (puro) ────────────────────────────────────────────────────

/** Un modelo cualquiera; `extra` dice qué lo distingue en cada caso. */
function modelo(extra: Partial<RevisionDeModelo> = {}): RevisionDeModelo {
  return {
    idModeloPadre: 7,
    versionDesarrollo: 1,
    idModeloDesarrollo: null,
    revisionEstado: null,
    ...extra,
  };
}

describe('revisionSinAprobar — a quién NO alcanza', () => {
  it('⭐ un modelo que NO es versión no lleva revisión (los ~4,987 migrados del Access)', () => {
    // LA aserción que impide que esto se ensanche solo: la revisión es de lo que nació de una
    // negociación. Si el predicado dejara de mirar el linaje, el catálogo entero aparecería en la
    // bandeja pidiendo una firma que Daniel nunca pidió.
    expect(revisionSinAprobar(modelo({ idModeloPadre: null, versionDesarrollo: null }))).toBe(
      false,
    );
  });

  it('un modelo que no es versión queda fuera AUNQUE traiga un estado de revisión colgando', () => {
    // El linaje manda sobre el estado: un `revisionEstado` puesto a mano en un modelo normal no lo
    // convierte en algo que espera firma.
    expect(
      revisionSinAprobar(
        modelo({ idModeloPadre: null, versionDesarrollo: null, revisionEstado: 'pendiente' }),
      ),
    ).toBe(false);
  });

  it('⭐ una versión APROBADA ya no espera nada (la firma es lo que la saca de la cola)', () => {
    expect(revisionSinAprobar(modelo({ revisionEstado: 'aprobada' }))).toBe(false);
  });
});

describe('revisionSinAprobar — a quién SÍ', () => {
  it('⭐ una versión PENDIENTE espera firma', () => {
    expect(revisionSinAprobar(modelo({ revisionEstado: 'pendiente' }))).toBe(true);
  });

  it('⭐ una versión SIN estado (nacida antes de V1-E7d) también: null se lee como pendiente', () => {
    // Las versiones que ya existían al desplegarse V1-E7d tienen la columna en NULL. Si el
    // predicado preguntara `=== 'pendiente'`, quedarían sin firmar Y invisibles a la vez.
    expect(revisionSinAprobar(modelo({ revisionEstado: null }))).toBe(true);
  });

  it('una versión RECHAZADA también: un rechazo es lo contrario de una firma', () => {
    expect(revisionSinAprobar(modelo({ revisionEstado: 'rechazada' }))).toBe(true);
  });

  it('basta CUALQUIERA de las dos columnas del linaje para llevar revisión', () => {
    // Una versión cuyo código se capturó a mano puede no tener `versionDesarrollo`; una importada
    // puede no tener padre. Exigir las dos dejaría versiones fuera de la bandeja.
    expect(revisionSinAprobar(modelo({ versionDesarrollo: null }))).toBe(true);
    expect(revisionSinAprobar(modelo({ idModeloPadre: null }))).toBe(true);
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
   * sin ser versión. Sin esa exclusión, la ficha le pintaría *«Revisión pendiente»* y la bandeja lo
   * listaría pidiendo una firma que no le toca: su receta es la del padre, y firmarla en el hijo
   * sería firmar dos veces lo mismo.
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
   * 🔴 EL MODO DE FALLO QUE IMPORTA, PINCHADO. La exclusión de los hijos es lo único de este
   * predicado que puede DEJAR FUERA a un modelo, así que tiene que fallar del lado seguro: una fila a la
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
    expect(revisionSinAprobar({ ...sinLaColumna, revisionEstado: null })).toBe(true);
  });

  /**
   * El predicado ENTERO sobre un hijo: no basta con que `esVersionDeModelo` diga `false` — lo que
   * hay que demostrar es que un hijo con la revisión SIN FIRMAR (el estado en que nacen todos,
   * `null`) **no aparece como pendiente de firma**, que es lo que decide la bandeja y el chip.
   */
  it('⭐ a un HIJO del linaje 1:N la revisión no le pide nada (su firma es la del padre)', () => {
    const hijo = {
      idModeloPadre: 7,
      versionDesarrollo: 1,
      idModeloDesarrollo: 9,
      revisionEstado: null,
    };
    expect(revisionSinAprobar(hijo)).toBe(false);
    // Y la versión equivalente SIN el vínculo sí espera firma: si las dos dieran lo mismo, este
    // par de aserciones pasaría con el predicado roto.
    expect(revisionSinAprobar({ ...hijo, idModeloDesarrollo: null })).toBe(true);
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
    // ⭐⭐ V1-E9p — el DESENLACE de la promesa. En null = nadie lo declaró, que es el estado del
    // 100 % de lo firmado antes de esa etapa.
    metaResultado: null,
    metaCostoPrometido: null,
    metaCostoConseguido: null,
    metaNota: null,
    ...extra,
  };
}

/**
 * ⭐⭐ V1-E9p — LA META que la mesa dejó guardada, tal como la devolvería `resolverCostoPrometido`.
 *
 * El doble **no puede pasar por construcción**: exige que la SQL que recibe lleve de verdad el id
 * del modelo, el de la empresa, el ancla en los ANCESTROS del linaje y la CTE que la alimenta (que
 * es de donde sale la meta por el camino normal, porque el expediente vive en la raíz). Si alguien
 * desconecta el cableado, esto truena en vez de devolver un número cómodo.
 */
function queryRawDeLaMeta(costoPrometido: number | null, idModelo: number) {
  return (sql: PrismaSql): Promise<{ costoPrometido: Prisma.Decimal | null }[]> => {
    if (!sql.values.includes(idModelo)) {
      throw new Error('la consulta de la meta no lleva el id del modelo');
    }
    if (!sql.values.includes(SESION.idEmpresaActiva)) {
      throw new Error('la consulta de la meta no lleva el id de la empresa (A9)');
    }
    if (!sql.text.includes('d."id_modelo" = ln."id_ancestro"')) {
      throw new Error('la consulta de la meta no se ancla en los ancestros del linaje');
    }
    if (!sql.text.includes('WITH RECURSIVE "linaje"')) {
      throw new Error('la consulta de la meta no lleva la CTE del linaje');
    }
    return Promise.resolve(
      costoPrometido === null ? [] : [{ costoPrometido: new Prisma.Decimal(costoPrometido) }],
    );
  };
}

/** `tx` de mentiras que REGISTRA cada llamada y devuelve el fixture que le toca. */
function txRegistrador(
  fila: Record<string, unknown> | null = filaFalsa(),
  costoPrometido: number | null = null,
): {
  tx: Tx;
  llamadas: Llamada[];
} {
  const llamadas: Llamada[] = [];
  const reg = <T>(metodo: string, args: unknown, resultado: T): Promise<T> => {
    llamadas.push({ metodo, args });
    return Promise.resolve(resultado);
  };
  const idFila = (fila?.id ?? 42) as number;
  const consultarMeta = queryRawDeLaMeta(costoPrometido, idFila);
  const tx = {
    modelo: {
      findUnique: (args: unknown) => reg('modelo.findUnique', args, fila),
      update: (args: unknown) => reg('modelo.update', args, {}),
      delete: (args: unknown) => reg('modelo.delete', args, {}),
      deleteMany: (args: unknown) => reg('modelo.deleteMany', args, { count: 0 }),
    },
    bitacora: { create: (args: unknown) => reg('bitacora.create', args, {}) },
    $queryRaw: (sql: PrismaSql) => {
      llamadas.push({ metodo: '$queryRaw', args: sql });
      return consultarMeta(sql);
    },
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

  it('⭐⭐ un modelo YA en producción SÍ se firma, y la bitácora dice desde dónde (V1-E9c)', async () => {
    // 🔴 LA PRUEBA DE LA DECISIÓN (a) DE §Post-F9.169. Hasta aquí esto era `ErrorConflicto`
    // —"la revisión es ANTES de mandar a producir"—, y tenía sentido mientras la firma abriera una
    // compuerta. Sin compuerta, generar la OP promueve la versión con la revisión en `pendiente`:
    // si firmarla siguiera prohibida, quedaría un acto de negocio que existe y que NADIE puede
    // ejecutar nunca. Si alguien reinstala aquel guard, esta prueba muere.
    const { tx, llamadas } = txRegistrador(filaFalsa({ origen: 'produccion', codigo: '71001' }));

    const salida = await aprobarRevisionModelo(
      SESION,
      42,
      { nota: 'revisada con la OP corriendo' },
      { tx },
    );

    expect(salida.revisionEstado).toBe('aprobada');
    expect(llamadas.map((l) => l.metodo)).toContain('modelo.update');
    // Y el acto queda distinguible del que se firma antes de promover: la fila sólo guarda el
    // ÚLTIMO acto (D3), así que el "desde dónde" sólo puede vivir en la bitácora.
    expect(datosDeLaBitacora(llamadas).origenAlFirmar).toBe('produccion');
  });

  it('y el que se firma ANTES de promover queda marcado como tal (si no, el dato no distingue nada)', async () => {
    const { tx, llamadas } = txRegistrador(filaFalsa({ origen: 'desarrollo' }));
    await aprobarRevisionModelo(SESION, 42, {}, { tx });
    expect(datosDeLaBitacora(llamadas).origenAlFirmar).toBe('desarrollo');
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

  it('⭐ un modelo YA en producción también se RECHAZA (gemela de la de aprobar, V1-E9c)', async () => {
    // Las dos firmas comparten `exigirVersionRevisable`, así que la conducta viene de ahí. La
    // prueba existe para que las dos se muevan juntas: si alguna volviera a prohibirlo, revisar una
    // versión con su OP ya corriendo sólo se podría hacer a medias — aprobar sí, observar no—, que
    // es peor que las dos cerradas.
    const { tx, llamadas } = txRegistrador(filaFalsa({ origen: 'produccion', codigo: '71001' }));
    const salida = await rechazarRevisionModelo(
      SESION,
      42,
      { motivo: 'la tela que se acordó no la surte nadie' },
      { tx },
    );
    expect(salida.revisionEstado).toBe('rechazada');

    // 🔴 Y el rechazo deja el MISMO rastro que la aprobación: desde dónde se firmó. Sin esta línea
    // el campo quedaba SIN NINGUNA aserción en esta rama —comprobado: borrarlo dejaba las 48
    // pruebas en verde—, que es exactamente el hueco que esta etapa encontró en la ficha del
    // modelo. La fila sólo guarda el ÚLTIMO acto (D3): si el dato no está aquí, después no hay
    // forma de distinguir el rechazo puesto antes de promover del puesto con la OP corriendo.
    expect(datosDeLaBitacora(llamadas).origenAlFirmar).toBe('produccion');
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
function baseFalsa(
  filasIniciales: Record<string, unknown>[],
  costoPrometido: number | null = null,
): {
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
    // ⭐⭐ V1-E9p — la META de la mesa. Mismo doble anti-trampa que arriba: si la consulta no lleva
    // el id del modelo, el de la empresa y el trozo del padre, truena en vez de devolver un número.
    $queryRaw: (sql: PrismaSql) => {
      llamadas.push({ metodo: '$queryRaw', args: sql });
      return queryRawDeLaMeta(costoPrometido, ID_VERSION)(sql);
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

/** La fila viva, leída como la lee el predicado puro. */
function comoLaVeElPredicado(fila: Record<string, unknown>): RevisionDeModelo {
  return {
    idModeloPadre: fila.idModeloPadre as number | null,
    versionDesarrollo: fila.versionDesarrollo as number | null,
    idModeloDesarrollo: (fila.idModeloDesarrollo ?? null) as number | null,
    revisionEstado: fila.revisionEstado as RevisionDeModelo['revisionEstado'],
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

// ── ⭐ EL CICLO COMPLETO: firmar → mover la receta → la firma se cae y vuelve a la cola ────

/**
 * La prueba que decide la etapa de V1-E7e, una por cada tipo de cambio de receta. Encadena las
 * piezas reales sobre la MISMA fila viva —la firma de V1-E7d y el embudo de V1-E7e— porque el
 * agujero que Daniel mandó cerrar sólo aparece al recorrerlas en ese orden: la firma sola está
 * bien, el cambio de receta solo está bien, y juntos dejaban una versión marcada como *revisada*
 * con una receta que nadie miró.
 *
 * 🔴 **V1-E9c cambió lo que se afirma al final, y no es un aflojamiento.** Antes se cerraba con
 * *"la compuerta vuelve a morder"* (la promoción rebotaba); esa compuerta ya no existe
 * (§Post-F9.169). Lo que sigue en pie —y es lo único que la invalidación de verdad prometía— es
 * que **la firma se cae**: el registro deja de decir "revisada" y la versión **vuelve a la cola**
 * que la bandeja lista, preguntada con el MISMO predicado que la bandeja usa. Sin la invalidación,
 * el paso 4 falla igual que antes.
 *
 * Que cada PUERTA real (el PUT de telas, el de avíos, las medidas, el arte, el copiado) pase de
 * verdad por el embudo se demuestra contra Postgres en `versiones.int.test.ts`; aquí se demuestra
 * que el embudo hace lo que tiene que hacer.
 */
describe.each<[CambioDeReceta, string]>([
  ['telas', 'le cambian el consumo de una TELA'],
  ['avios', 'le agregan un AVÍO'],
  ['medidas-por-talla', 'le mueven las MEDIDAS POR TALLA'],
  ['arte', 'le mueven el ARTE'],
  ['copia-de-otro-modelo', 'le COPIAN la receta de otro modelo'],
])('⭐ EL CICLO — aprobada y luego %s', (cambio, relato) => {
  it(`la firma se cae y vuelve a la cola cuando ${relato}`, async () => {
    const { tx, fila } = baseFalsa([
      filaFalsa({ id: ID_VERSION, revisionEstado: 'pendiente' }),
      modeloMigrado(),
    ]);

    // 1. Aurora la revisa y la firma.
    await aprobarRevisionModelo(SESION, ID_VERSION, { nota: 'la revisé con Daniel' }, { tx });
    expect(fila(ID_VERSION).revisionEstado).toBe('aprobada');

    // 2. Con la firma puesta sale de la cola: la bandeja ya no la lista.
    expect(revisionSinAprobar(comoLaVeElPredicado(fila(ID_VERSION)))).toBe(false);

    // 3. Alguien MÁS le mueve la receta (no el que firmó).
    await tocarModeloPorCambioDeReceta(tx, QUIEN_CAMBIA, ID_VERSION, cambio);

    // 4. ⭐ LA AFIRMACIÓN DE LA ETAPA: la firma se cayó y la versión VOLVIÓ a la cola. Sin la
    //    invalidación, esta línea pasa —y el sistema seguiría presentándola como revisada—.
    expect(fila(ID_VERSION).revisionEstado).toBe('pendiente');
    expect(revisionSinAprobar(comoLaVeElPredicado(fila(ID_VERSION)))).toBe(true);
    // Y nadie firmó la receta que hay AHORA: el firmante se soltó de la fila.
    expect(fila(ID_VERSION).idRevisadoPor).toBeNull();

    // 5. (d) No es un callejón sin salida: se vuelve a firmar con el MISMO permiso y vuelve a
    //    salir de la cola. Un estado muerto sería tan defecto como el agujero.
    await aprobarRevisionModelo(SESION, ID_VERSION, {}, { tx });
    expect(fila(ID_VERSION).revisionEstado).toBe('aprobada');
    expect(revisionSinAprobar(comoLaVeElPredicado(fila(ID_VERSION)))).toBe(false);

    // El testigo migrado no se movió en todo el ciclo.
    expect(fila(ID_MIGRADO).revisionEstado).toBeNull();
  });
});

// ── 4. ⭐⭐ V1-E9p: EL SEGUNDO FINAL — «¿se logró lo prometido?» (§Post-F9.144(b)) ──────────────
//
// Daniel re-encuadró el problema: *«todo eso se intentará hacer así, pero **no es seguro que se
// consiga**»*. Un estimado de mesa es una PROMESA, y su desenlace tiene DOS finales. Lo que estas
// pruebas cementan es, sobre todo, **lo que NO cambia**: sin desenlace declarado, la firma se
// comporta EXACTAMENTE como antes de esta etapa; y declarar «no se consiguió» **no rechaza ni
// bloquea nada**.

/** Las cuatro columnas del desenlace, tal como quedaron escritas en el `update`. */
function desenlaceDelUpdate(llamadas: Llamada[]): Record<string, unknown> {
  const data = datosDelUpdate(llamadas);
  return {
    metaResultado: data.metaResultado,
    metaCostoPrometido: data.metaCostoPrometido,
    metaCostoConseguido: data.metaCostoConseguido,
    metaNota: data.metaNota,
  };
}

/** Un `Decimal` escrito en la fila, leído como número (o null). */
function decimalEscrito(valor: unknown): number | null {
  return valor == null ? null : (valor as Prisma.Decimal).toNumber();
}

describe('aprobarRevisionModelo — el DESENLACE de la promesa', () => {
  it('⭐⭐ «NO se consiguió» se guarda con la META CONGELADA de la mesa, y NO es un rechazo', async () => {
    const { tx, llamadas } = txRegistrador(filaFalsa(), 43);
    const salida = await aprobarRevisionModelo(
      SESION,
      42,
      {
        meta: {
          lograda: false,
          costoConseguido: 45,
          nota: 'ninguna maquila bajó de $18 con la jareta nueva',
        },
      },
      { tx },
    );

    const data = datosDelUpdate(llamadas);
    // 🔴 LA aserción de la etapa: la revisión queda APROBADA (la receta está bien y sale de la
    // cola) y a la vez consta que la promesa NO se cumplió. Si alguien "resolviera" esto marcando
    // `rechazada`, la versión volvería a la cola a corregir una receta que no tiene nada malo.
    expect(data.revisionEstado).toBe('aprobada');
    // `toBe` y no `toContain`: 'no_lograda' CONTIENE 'lograda' — una aserción por subcadena pasaría
    // con la lógica invertida.
    expect(data.metaResultado).toBe('no_lograda');
    expect(decimalEscrito(data.metaCostoPrometido)).toBe(43);
    expect(decimalEscrito(data.metaCostoConseguido)).toBe(45);
    expect(data.metaNota).toBe('ninguna maquila bajó de $18 con la jareta nueva');

    expect(salida.revisionEstado).toBe('aprobada');
    expect(salida.metaResultado).toBe('no_lograda');
    expect(salida.metaCostoPrometido).toBe(43);
    expect(salida.metaCostoConseguido).toBe(45);
  });

  it('⭐ «sí se consiguió» se guarda igual de explícito (el «sí» también es una respuesta)', async () => {
    const { tx, llamadas } = txRegistrador(filaFalsa(), 43);
    await aprobarRevisionModelo(SESION, 42, { meta: { lograda: true } }, { tx });

    const data = datosDelUpdate(llamadas);
    expect(data.metaResultado).toBe('lograda');
    expect(decimalEscrito(data.metaCostoPrometido)).toBe(43);
  });

  /**
   * 🔴 EL MODO DE FALLO REALISTA de esta etapa: *«añadí lo nuevo y dejé lo viejo debajo»*. Una firma
   * sin desenlace tiene que comportarse **exactamente** como antes de V1-E9p — y ni siquiera ir a
   * preguntar la meta, que sería trabajo y una consulta de más por cada firma normal.
   */
  it('⭐⭐ SIN desenlace declarado: la firma es la de siempre, y NO consulta la meta', async () => {
    const { tx, llamadas } = txRegistrador(filaFalsa(), 43);
    const salida = await aprobarRevisionModelo(
      SESION,
      42,
      { nota: 'la revisé con Daniel' },
      { tx },
    );

    const data = datosDelUpdate(llamadas);
    expect(data.revisionEstado).toBe('aprobada');
    expect(data.revisionNota).toBe('la revisé con Daniel');
    expect(desenlaceDelUpdate(llamadas)).toEqual({
      metaResultado: null,
      metaCostoPrometido: null,
      metaCostoConseguido: null,
      metaNota: null,
    });
    expect(salida.metaResultado).toBeNull();
    // Ni una consulta de la meta: contestar la pregunta es opcional, y no contestarla no cuesta.
    expect(llamadas.filter((l) => l.metodo === '$queryRaw')).toEqual([]);
  });

  it('⭐ una firma MUDA BORRA el desenlace anterior: el acto nuevo sustituye al anterior COMPLETO', async () => {
    // Sin esto, una segunda firma sin contestar dejaría viva la brecha de la primera — colgada de
    // un acto que no la declaró. Es la misma regla de la tupla mentirosa que gobierna la revisión.
    const { tx, llamadas } = txRegistrador(
      filaFalsa({
        revisionEstado: 'rechazada',
        metaResultado: 'no_lograda',
        metaCostoPrometido: new Prisma.Decimal(43),
        metaCostoConseguido: new Prisma.Decimal(45),
        metaNota: 'no se consiguió la maquila',
      }),
      43,
    );
    await aprobarRevisionModelo(SESION, 42, {}, { tx });

    expect(desenlaceDelUpdate(llamadas)).toEqual({
      metaResultado: null,
      metaCostoPrometido: null,
      metaCostoConseguido: null,
      metaNota: null,
    });
    // Y lo que se borró queda en la bitácora (D3): la secuencia no se pierde.
    expect(datosDeLaBitacora(llamadas)).toMatchObject({
      metaResultadoAnterior: 'no_lograda',
      metaCostoPrometidoAnterior: 43,
      metaCostoConseguidoAnterior: 45,
      metaNotaAnterior: 'no se consiguió la maquila',
    });
  });

  it('⭐ SIN mesa registrada se declara igual, con la meta en null (REGLA 0-B)', async () => {
    // La versión no vino de una negociación guardada. Bloquear el desenlace aquí devolvería el
    // incumplimiento al silencio, que es justo lo que la etapa vino a matar.
    const { tx, llamadas } = txRegistrador(filaFalsa(), null);
    await aprobarRevisionModelo(
      SESION,
      42,
      { meta: { lograda: false, costoConseguido: 45, nota: 'la tela no existe en ese gramaje' } },
      { tx },
    );

    const data = datosDelUpdate(llamadas);
    expect(data.metaResultado).toBe('no_lograda');
    expect(data.metaCostoPrometido).toBeNull();
    expect(decimalEscrito(data.metaCostoConseguido)).toBe(45);
  });

  it('un «no» incompleto se rechaza ANTES de escribir nada (nada a medias, A2)', async () => {
    const { tx, llamadas } = txRegistrador(filaFalsa(), 43);
    await expect(
      aprobarRevisionModelo(SESION, 42, { meta: { lograda: false, nota: 'no se pudo' } }, { tx }),
    ).rejects.toThrow(ErrorValidacion);
    expect(llamadas.filter((l) => l.metodo === 'modelo.update')).toEqual([]);
    expect(llamadas.filter((l) => l.metodo === 'bitacora.create')).toEqual([]);
  });

  it('deja el desenlace declarado en la bitácora, junto al acto', async () => {
    const { tx, llamadas } = txRegistrador(filaFalsa(), 43);
    await aprobarRevisionModelo(
      SESION,
      42,
      { meta: { lograda: false, costoConseguido: 45, nota: 'no bajó la maquila' } },
      { tx },
    );
    expect(datosDeLaBitacora(llamadas)).toMatchObject({
      operacion: 'aprobar-revision',
      metaResultado: 'no_lograda',
      metaCostoPrometido: 43,
      metaCostoConseguido: 45,
    });
  });
});

describe('rechazarRevisionModelo — la RAMA GEMELA: también borra el desenlace', () => {
  /**
   * 🔴 **La rama gemela es el defecto característico de este repo**, y aquí las ramas son TRES
   * (aprobar / rechazar / invalidar). Rechazar dice *«corrige esta receta»*: dejar viva una brecha
   * medida sobre la receta anterior le enseñaría al dueño un incumplimiento de algo que ya se va a
   * cambiar — y sobre una versión que además vuelve a la cola.
   */
  it('⭐⭐ borra las CUATRO columnas del desenlace y se las lleva a la bitácora', async () => {
    const { tx, llamadas } = txRegistrador(
      filaFalsa({
        revisionEstado: 'aprobada',
        metaResultado: 'no_lograda',
        metaCostoPrometido: new Prisma.Decimal(43),
        metaCostoConseguido: new Prisma.Decimal(45),
        metaNota: 'no bajó la maquila',
      }),
    );
    const salida = await rechazarRevisionModelo(SESION, 42, { motivo: 'falta el forro' }, { tx });

    const data = datosDelUpdate(llamadas);
    expect(data.revisionEstado).toBe('rechazada');
    expect(desenlaceDelUpdate(llamadas)).toEqual({
      metaResultado: null,
      metaCostoPrometido: null,
      metaCostoConseguido: null,
      metaNota: null,
    });
    // La salida tiene que decir lo MISMO que la fila: si se re-armara aparte, la pantalla podría
    // enseñar un desenlace que ya no existe.
    expect(salida.metaResultado).toBeNull();
    expect(salida.metaCostoConseguido).toBeNull();

    expect(datosDeLaBitacora(llamadas)).toMatchObject({
      operacion: 'rechazar-revision',
      metaResultadoAnterior: 'no_lograda',
      metaCostoPrometidoAnterior: 43,
      metaCostoConseguidoAnterior: 45,
    });
  });

  it('y rechazar NO acepta declarar un desenlace: el «no se consiguió» va con la firma', async () => {
    // Asimetría DELIBERADA, y su argumento tiene que ser cierto: el desenlace habla de una receta
    // ya cuadrada. Un rechazo dice que todavía no lo está, así que no hay nada que declarar.
    const { tx, llamadas } = txRegistrador();
    await rechazarRevisionModelo(SESION, 42, { motivo: 'falta el forro' }, { tx });
    expect(llamadas.filter((l) => l.metodo === '$queryRaw')).toEqual([]);
  });
});

describe('invalidarRevisionSiAprobada — la TERCERA rama: el desenlace se cae con la firma', () => {
  it('⭐⭐ CICLO COMPLETO: firmo con brecha → cambian la tela → se cae la firma Y la brecha', async () => {
    const { tx, llamadas, fila } = baseFalsa([versionAprobada(), modeloMigrado()], 43);

    // 1) La firma declara que NO se consiguió lo prometido (prometí 43, conseguí 45).
    //    Se parte de `pendiente` porque aprobar dos veces es conflicto.
    Object.assign(fila(ID_VERSION), { revisionEstado: 'pendiente' });
    await aprobarRevisionModelo(
      SESION,
      ID_VERSION,
      { meta: { lograda: false, costoConseguido: 45, nota: 'no bajó la maquila' } },
      { tx },
    );
    expect(fila(ID_VERSION).metaResultado).toBe('no_lograda');

    // 2) Alguien le mueve la TELA a la receta ya firmada.
    await tocarModeloPorCambioDeReceta(tx, QUIEN_CAMBIA, ID_VERSION, 'telas');

    // 3) La firma se cayó… y la brecha con ella: medía una receta que ya no existe, y la versión
    //    vuelve a estar `pendiente` — o sea, NADIE la ha revisado.
    const despues = fila(ID_VERSION);
    expect(despues.revisionEstado).toBe('pendiente');
    expect(despues.metaResultado).toBeNull();
    expect(despues.metaCostoPrometido).toBeNull();
    expect(despues.metaCostoConseguido).toBeNull();
    expect(despues.metaNota).toBeNull();
    // Y el predicado la devuelve a la bandeja, como siempre.
    expect(revisionSinAprobar(comoLaVeElPredicado(despues))).toBe(true);

    // El testigo no se movió: el doble respetó el `where` (si lo ignorara, esto lo delata).
    expect(fila(ID_MIGRADO).revisionEstado).toBeNull();

    // Lo que se borró quedó en la bitácora de la invalidación (D3).
    expect(datosDeLaBitacora(llamadas)).toMatchObject({
      operacion: 'invalidar-revision',
      metaResultadoAnterior: 'no_lograda',
      metaCostoPrometidoAnterior: 43,
      metaCostoConseguidoAnterior: 45,
    });
  });

  it('⭐ y NO toca el desenlace de una versión que no estaba aprobada (no hay firma que caer)', async () => {
    // Sin esta pareja, «borra siempre» pasaría la prueba de arriba con una regla distinta: la
    // invalidación sólo actúa sobre una firma viva, y no puede pisar nada más.
    const { tx, fila } = baseFalsa([
      versionAprobada({ revisionEstado: 'rechazada', revisionNota: 'falta el forro' }),
      modeloMigrado(),
    ]);
    const tumbo = await invalidarRevisionSiAprobada(tx, QUIEN_CAMBIA, ID_VERSION, 'telas');

    expect(tumbo).toBe(false);
    expect(fila(ID_VERSION).revisionEstado).toBe('rechazada');
    expect(fila(ID_VERSION).revisionNota).toBe('falta el forro');
  });
});
