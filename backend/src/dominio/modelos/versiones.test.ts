/**
 * ⭐ V1-E7b — Reglas del SUFIJO de versión de un modelo (§Post-F9.110).
 *
 * Dos bloques, y la diferencia entre ellos importa:
 *
 *  1. **Reglas puras** (`raizDeCodigoDesarrollo`, `siguienteVersion`, `codigoDeVersion`): sin base
 *     y sin dobles. Aquí vive la regla 2 de Daniel —PLANO, nunca anidado— y la trampa del `-001`.
 *  2. **Orquestación**, contra un `tx` que es un **REGISTRADOR DE LLAMADAS**, no una imitación de
 *     Prisma. Sólo se afirma sobre lo que el registrador ve de verdad: QUÉ se llamó, EN QUÉ ORDEN,
 *     con QUÉ argumentos, y qué NO se llamó nunca. Deliberadamente NO se afirma nada que dependa
 *     de que el doble filtre un `where` (eso probaría la suposición del doble, no el sistema): la
 *     semántica de las consultas —que el `insensitive` de verdad absorba una colisión de
 *     mayúsculas, que el lock de verdad serialice dos transacciones— se demuestra contra Postgres
 *     real en `versiones.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  codigoDeVersion,
  crearVersionDeModelo,
  mintearVersionDeModelo,
  raizDeCodigoDesarrollo,
  siguienteVersion,
  sufijoTexto,
} from './versiones.js';

// ── 1. Reglas puras ───────────────────────────────────────────────────────────

describe('raizDeCodigoDesarrollo', () => {
  it('⚠️ NO confunde el consecutivo `-001` con un sufijo de versión', () => {
    // LA trampa del módulo: el código base YA termina en `-NNN`. Si se recortara a ciegas, la
    // familia entera cambiaría de raíz (`CYA-26-71` en vez de `CYA-26-71-001`).
    expect(raizDeCodigoDesarrollo('CYA-26-71-001')).toEqual({
      raiz: 'CYA-26-71-001',
      version: null,
    });
    expect(raizDeCodigoDesarrollo('LIV-30-52-047')).toEqual({
      raiz: 'LIV-30-52-047',
      version: null,
    });
    // Consecutivo de más de tres dígitos (`armarCodigoDesarrollo` no lo trunca): tampoco es sufijo.
    expect(raizDeCodigoDesarrollo('CYA-26-71-1000')).toEqual({
      raiz: 'CYA-26-71-1000',
      version: null,
    });
  });

  it('lee la raíz y la versión de un código YA versionado', () => {
    expect(raizDeCodigoDesarrollo('CYA-26-71-001-01')).toEqual({
      raiz: 'CYA-26-71-001',
      version: 1,
    });
    expect(raizDeCodigoDesarrollo('CYA-26-71-001-12')).toEqual({
      raiz: 'CYA-26-71-001',
      version: 12,
    });
  });

  it('la versión GUARDADA manda sobre el texto (códigos no canónicos)', () => {
    // Un `codigoDesarrollo` capturado a mano no tiene la forma `CYA-26-71-001`; el texto no se
    // puede interpretar sin adivinar, pero el número de versión sí se sabe y recorta exacto.
    expect(raizDeCodigoDesarrollo('MODELO RARO-01', 1)).toEqual({
      raiz: 'MODELO RARO',
      version: 1,
    });
    // Sin versión conocida, un código no canónico es su propia raíz (nunca se le inventa una).
    expect(raizDeCodigoDesarrollo('MODELO RARO')).toEqual({ raiz: 'MODELO RARO', version: null });
  });
});

describe('siguienteVersion / codigoDeVersion', () => {
  it('la primera versión de una familia es la 1 (`-01`)', () => {
    expect(siguienteVersion([])).toBe(1);
    expect(codigoDeVersion('CYA-26-71-001', 1)).toBe('CYA-26-71-001-01');
  });

  it('avanza sobre el MÁXIMO usado, aunque haya huecos', () => {
    expect(siguienteVersion([1, 2])).toBe(3);
    // Con un hueco (alguien descontinuó la `-02`), NO se reusa el número: el `-02` ya fue.
    expect(siguienteVersion([1, 3])).toBe(4);
  });

  it('el sufijo se escribe a dos dígitos y no se trunca al pasar de 99', () => {
    expect(sufijoTexto(1)).toBe('01');
    expect(sufijoTexto(12)).toBe('12');
    expect(codigoDeVersion('CYA-26-71-001', 100)).toBe('CYA-26-71-001-100');
  });
});

// ── 2. Orquestación (registrador de llamadas) ─────────────────────────────────

const SESION = sesionDePrueba({ permisos: ['modelos.aprobar-receta'] });

/** Un modelo padre mínimo, con todo lo que el minteo lee de él. */
function padreFalso(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    codigo: 'CYA-26-71-001',
    codigoDesarrollo: 'CYA-26-71-001',
    versionDesarrollo: null,
    descripcion: 'Sudadera con cierre',
    composicion: '80% algodón',
    maquilaBase: 35,
    corteBase: 4,
    idTemporada: 2,
    idCurvaTalla: 3,
    idGenero: 4,
    idTipoProducto: 5,
    idMaquileroCotizado: 6,
    numOperaciones: 21,
    secuenciaEstampado: 'antes',
    llevaArte: true,
    ...extra,
  };
}

interface Llamada {
  metodo: string;
  args: unknown;
}

interface Fixtures {
  padre?: Record<string, unknown> | null;
  /** Lo que devuelve `modelo.findMany` (la familia de la raíz). */
  familia?: { codigoDesarrollo: string | null; versionDesarrollo: number | null }[];
  /** Lo que devuelve `modelo.findFirst` (centinela de código ocupado), llamada por llamada. */
  ocupado?: ({ id: number } | null)[];
  telas?: Record<string, unknown>[];
  avios?: Record<string, unknown>[];
  medidas?: Record<string, unknown>[];
  artes?: Record<string, unknown>[];
}

/**
 * `tx` de mentira que REGISTRA cada llamada y devuelve el fixture que le toca. No filtra, no
 * ordena y no valida: por eso las aserciones de abajo miran llamadas, no resultados de consulta.
 */
function txRegistrador(f: Fixtures = {}): { tx: Tx; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const reg = <T>(metodo: string, args: unknown, resultado: T): Promise<T> => {
    llamadas.push({ metodo, args });
    return Promise.resolve(resultado);
  };
  let nOcupado = 0;

  const tx = {
    $executeRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$executeRaw', { sql: plantilla.join('?'), valores }, 1),
    modelo: {
      findUnique: (args: unknown) =>
        reg('modelo.findUnique', args, f.padre === undefined ? padreFalso() : f.padre),
      findMany: (args: unknown) => reg('modelo.findMany', args, f.familia ?? []),
      findFirst: (args: unknown) => {
        const r = f.ocupado?.[nOcupado] ?? null;
        nOcupado += 1;
        return reg('modelo.findFirst', args, r);
      },
      create: (args: unknown) => reg('modelo.create', args, { id: 99 }),
      update: (args: unknown) => reg('modelo.update', args, {}),
      updateMany: (args: unknown) => reg('modelo.updateMany', args, { count: 0 }),
      delete: (args: unknown) => reg('modelo.delete', args, {}),
      deleteMany: (args: unknown) => reg('modelo.deleteMany', args, { count: 0 }),
    },
    modeloTela: {
      findMany: (args: unknown) => reg('modeloTela.findMany', args, f.telas ?? []),
      createMany: (args: unknown) => reg('modeloTela.createMany', args, { count: 0 }),
      deleteMany: (args: unknown) => reg('modeloTela.deleteMany', args, { count: 0 }),
    },
    modeloAvio: {
      findMany: (args: unknown) => reg('modeloAvio.findMany', args, f.avios ?? []),
      createMany: (args: unknown) => reg('modeloAvio.createMany', args, { count: 0 }),
      deleteMany: (args: unknown) => reg('modeloAvio.deleteMany', args, { count: 0 }),
    },
    modeloAvioTalla: {
      findMany: (args: unknown) => reg('modeloAvioTalla.findMany', args, f.medidas ?? []),
      createMany: (args: unknown) => reg('modeloAvioTalla.createMany', args, { count: 0 }),
    },
    modeloArte: {
      findMany: (args: unknown) => reg('modeloArte.findMany', args, f.artes ?? []),
      create: (args: unknown) => reg('modeloArte.create', args, { id: 1 }),
      deleteMany: (args: unknown) => reg('modeloArte.deleteMany', args, { count: 0 }),
    },
    modeloFoto: {
      findMany: (args: unknown) => reg('modeloFoto.findMany', args, []),
      createMany: (args: unknown) => reg('modeloFoto.createMany', args, { count: 0 }),
    },
    bitacora: { create: (args: unknown) => reg('bitacora.create', args, {}) },
  };
  return { tx: tx as unknown as Tx, llamadas };
}

/** Los `data` con los que se llamó a `modelo.create` (el modelo NUEVO). */
function datosDelCreate(llamadas: Llamada[]): Record<string, unknown> {
  const create = llamadas.find((l) => l.metodo === 'modelo.create');
  expect(create, 'no se creó el modelo de la versión').toBeDefined();
  return (create?.args as { data: Record<string, unknown> }).data;
}

describe('mintearVersionDeModelo — el código que nace', () => {
  it('la primera versión de un modelo raíz es `-01` y hereda la ficha del padre', async () => {
    const { tx, llamadas } = txRegistrador();
    await mintearVersionDeModelo(tx, SESION, 7);

    const data = datosDelCreate(llamadas);
    expect(data.codigo).toBe('CYA-26-71-001-01');
    // Mientras el modelo es de desarrollo, el código VIGENTE y el de desarrollo valen lo mismo.
    expect(data.codigoDesarrollo).toBe('CYA-26-71-001-01');
    expect(data.versionDesarrollo).toBe(1);
    expect(data.idModeloPadre).toBe(7);
    expect(data.origen).toBe('desarrollo');
    // Nace SIN nº de producción: el sufijo vive en el mundo de desarrollo (regla 4 de Daniel).
    expect(data.numeroProduccion).toBeNull();
    // ⭐ V1-E7d (regla 5) — y nace PENDIENTE DE REVISIÓN: la receta se acordó frente al cliente y
    // no puede mandarse a producir hasta que alguien la firme. `pendiente` y no `null`: `null` es
    // "no lleva revisión" (los modelos que no son versiones), que es otra cosa.
    expect(data.revisionEstado).toBe('pendiente');
    // Herencia de ficha (una muestra de cada tipo de campo).
    expect(data.descripcion).toBe('Sudadera con cierre');
    expect(data.composicion).toBe('80% algodón');
    expect(data.maquilaBase).toBe(35);
    expect(data.idCurvaTalla).toBe(3);
    expect(data.llevaArte).toBe(true);
  });

  it('⭐ PLANO, NUNCA ANIDADO: versionar un `-02` da `-03`, no `-02-01`', async () => {
    // El padre YA es una versión, y la familia tiene la 1 y la 2.
    const { tx, llamadas } = txRegistrador({
      padre: padreFalso({
        codigo: 'CYA-26-71-001-02',
        codigoDesarrollo: 'CYA-26-71-001-02',
        versionDesarrollo: 2,
      }),
      familia: [
        { codigoDesarrollo: 'CYA-26-71-001-01', versionDesarrollo: 1 },
        { codigoDesarrollo: 'CYA-26-71-001-02', versionDesarrollo: 2 },
      ],
    });
    await mintearVersionDeModelo(tx, SESION, 7);

    const data = datosDelCreate(llamadas);
    expect(data.codigo).toBe('CYA-26-71-001-03');
    expect(data.versionDesarrollo).toBe(3);
    // La afirmación que de verdad duele si se rompe la regla:
    expect(String(data.codigo)).not.toContain('-02-');
  });

  it('cuenta la familia por la RAÍZ, no por el padre (la busca con el prefijo de la raíz)', async () => {
    const { tx, llamadas } = txRegistrador({
      padre: padreFalso({
        codigo: 'CYA-26-71-001-01',
        codigoDesarrollo: 'CYA-26-71-001-01',
        versionDesarrollo: 1,
      }),
      familia: [{ codigoDesarrollo: 'CYA-26-71-001-01', versionDesarrollo: 1 }],
    });
    await mintearVersionDeModelo(tx, SESION, 7);

    const familia = llamadas.find((l) => l.metodo === 'modelo.findMany');
    expect(familia?.args).toMatchObject({
      where: { codigoDesarrollo: { startsWith: 'CYA-26-71-001-', mode: 'insensitive' } },
    });
  });

  it('absorbe un código ocupado avanzando al siguiente sufijo (no revienta la transacción)', async () => {
    // Cicatriz de V1-E3n: dejar que la colisión llegue al `@unique` abortaba la transacción entera.
    const { tx, llamadas } = txRegistrador({ ocupado: [{ id: 3 }, null] });
    await mintearVersionDeModelo(tx, SESION, 7);

    expect(datosDelCreate(llamadas).codigo).toBe('CYA-26-71-001-02');
  });

  it('el centinela de código ocupado compara SIN distinguir mayúsculas', async () => {
    const { tx, llamadas } = txRegistrador();
    await mintearVersionDeModelo(tx, SESION, 7);

    const centinela = llamadas.find((l) => l.metodo === 'modelo.findFirst');
    expect(centinela?.args).toMatchObject({
      where: {
        OR: [
          { codigo: { equals: 'CYA-26-71-001-01', mode: 'insensitive' } },
          { codigoDesarrollo: { equals: 'CYA-26-71-001-01', mode: 'insensitive' } },
        ],
      },
    });
  });
});

describe('mintearVersionDeModelo — el lock y el padre', () => {
  it('⭐ toma el advisory lock ANTES de leer la familia', async () => {
    // Sin esto, dos personas versionando el mismo padre leen ambas "no hay ninguna" y sacan las
    // dos `-01`. Que el lock de verdad serialice se mide contra Postgres en el `.int.test.ts`;
    // aquí se fija lo que sí se puede fijar sin base: que se pide, y que se pide PRIMERO.
    const { tx, llamadas } = txRegistrador();
    await mintearVersionDeModelo(tx, SESION, 7);

    const iLock = llamadas.findIndex((l) => l.metodo === '$executeRaw');
    const iFamilia = llamadas.findIndex((l) => l.metodo === 'modelo.findMany');
    expect(iLock, 'no se tomó ningún advisory lock').toBeGreaterThanOrEqual(0);
    expect(iFamilia).toBeGreaterThanOrEqual(0);
    expect(iLock).toBeLessThan(iFamilia);
    expect((llamadas[iLock]?.args as { sql: string }).sql).toContain('pg_advisory_xact_lock');
  });

  it('la llave del lock sale de la RAÍZ: el padre y su versión piden LA MISMA', async () => {
    // Si la llave saliera del id del padre, versionar el original y versionar su `-01` a la vez
    // NO se esperarían, y las dos sacarían el mismo sufijo.
    const desdeRaiz = txRegistrador();
    await mintearVersionDeModelo(desdeRaiz.tx, SESION, 7);

    const desdeVersion = txRegistrador({
      padre: padreFalso({
        id: 8,
        codigo: 'CYA-26-71-001-01',
        codigoDesarrollo: 'CYA-26-71-001-01',
        versionDesarrollo: 1,
      }),
      familia: [{ codigoDesarrollo: 'CYA-26-71-001-01', versionDesarrollo: 1 }],
    });
    await mintearVersionDeModelo(desdeVersion.tx, SESION, 8);

    const llave = (ll: Llamada[]): unknown =>
      (ll.find((l) => l.metodo === '$executeRaw')?.args as { valores: unknown[] }).valores[1];
    expect(llave(desdeVersion.llamadas)).toBe(llave(desdeRaiz.llamadas));
  });

  it('⭐ el modelo PADRE no se toca: ni un update, ni un delete', async () => {
    // La regla de Daniel entera: *"el modelo original queda igual"*.
    const { tx, llamadas } = txRegistrador({
      telas: [{ idTela: 1, consumoPorPrenda: 2, paraPreCosto: true }],
      artes: [{ descripcion: 'Logo', orden: 0, fotos: [] }],
    });
    await mintearVersionDeModelo(tx, SESION, 7);

    const escrituras = llamadas
      .map((l) => l.metodo)
      .filter((m) => /update|delete/i.test(m) || m === 'modelo.create');
    expect(escrituras).toEqual(['modelo.create']);
  });

  it('deja bitácora del acto con el padre y la raíz de los que salió', async () => {
    const { tx, llamadas } = txRegistrador();
    await mintearVersionDeModelo(tx, SESION, 7);

    const bitacora = llamadas.find((l) => l.metodo === 'bitacora.create');
    expect(bitacora?.args).toMatchObject({
      data: {
        entidad: 'Modelo',
        accion: 'CREAR',
        datos: {
          operacion: 'crear-version',
          codigo: 'CYA-26-71-001-01',
          version: 1,
          idModeloPadre: 7,
          raiz: 'CYA-26-71-001',
        },
      },
    });
  });
});

describe('mintearVersionDeModelo — la receta se COPIA, no se referencia', () => {
  it('copia telas, avíos, medidas por talla y arte al modelo NUEVO', async () => {
    const { tx, llamadas } = txRegistrador({
      telas: [
        {
          idTela: 11,
          consumoPorPrenda: 2,
          paraPreCosto: true,
          paraProduccion: true,
          paraCosto: true,
          idTelaProveedor: 55,
        },
      ],
      avios: [
        {
          idAvio: 22,
          consumoPorPrenda: 1,
          paraPreCosto: true,
          paraProduccion: true,
          paraCosto: true,
          consumoPorTalla: true,
          idAvioProveedor: 66,
        },
      ],
      medidas: [{ idAvio: 22, idTalla: 33, consumo: 0.5, idAvioMedida: 44 }],
      artes: [
        {
          descripcion: 'Logo pecho',
          posicion: 'frente',
          puntadas: 5000,
          precio: 3,
          idTipoArte: 1,
          idProveedor: 2,
          orden: 0,
          fotos: [{ idArchivo: 'arch-1', orden: 0 }],
        },
      ],
    });
    await mintearVersionDeModelo(tx, SESION, 7);

    const porMetodo = (m: string): Llamada | undefined => llamadas.find((l) => l.metodo === m);

    // El AMARRE de precio viaja con el renglón (R17): heredar la receta y perder el proveedor
    // amarrado dejaría a la versión costeando con el precio genérico sin avisar.
    expect(porMetodo('modeloTela.createMany')?.args).toMatchObject({
      data: [{ idModelo: 99, idTela: 11, idTelaProveedor: 55 }],
    });
    expect(porMetodo('modeloAvio.createMany')?.args).toMatchObject({
      data: [{ idModelo: 99, idAvio: 22, consumoPorTalla: true, idAvioProveedor: 66 }],
    });
    // Sin las medidas, la versión heredaría el toggle "por talla" con la matriz VACÍA.
    expect(porMetodo('modeloAvioTalla.createMany')?.args).toMatchObject({
      data: [{ idModelo: 99, idAvio: 22, idTalla: 33, idAvioMedida: 44 }],
    });
    // La foto del arte se COMPARTE (mismo `Archivo`): no se duplica ningún objeto de R2.
    expect(porMetodo('modeloArte.create')?.args).toMatchObject({
      data: {
        idModelo: 99,
        descripcion: 'Logo pecho',
        precio: 3,
        fotos: { create: [{ idArchivo: 'arch-1', orden: 0 }] },
      },
    });
  });

  it('las FOTOS del modelo no se copian (son de ESE modelo; la versión sube las suyas)', async () => {
    const { tx, llamadas } = txRegistrador();
    await mintearVersionDeModelo(tx, SESION, 7);

    expect(llamadas.map((l) => l.metodo)).not.toContain('modeloFoto.createMany');
  });
});

describe('mintearVersionDeModelo — lo que rechaza', () => {
  it('⭐ rechaza un modelo SIN código de desarrollo (los migrados de producción)', async () => {
    const { tx, llamadas } = txRegistrador({ padre: padreFalso({ codigoDesarrollo: null }) });

    await expect(mintearVersionDeModelo(tx, SESION, 7)).rejects.toThrow(ErrorValidacion);
    // Y no deja nada a medias: ni siquiera pide el lock.
    expect(llamadas.map((l) => l.metodo)).toEqual(['modelo.findUnique']);
  });

  it('el mensaje del rechazo dice qué hacer, no sólo que no se pudo', async () => {
    const { tx } = txRegistrador({ padre: padreFalso({ codigoDesarrollo: null }) });
    await expect(mintearVersionDeModelo(tx, SESION, 7)).rejects.toThrow(/Desarrollo/);
  });

  it('un modelo que no existe es `ErrorNoEncontrado`, no un crash', async () => {
    const { tx } = txRegistrador({ padre: null });
    await expect(mintearVersionDeModelo(tx, SESION, 7)).rejects.toThrow(ErrorNoEncontrado);
  });

  it('si ningún sufijo queda libre avisa en vez de dar vueltas para siempre', async () => {
    const { tx } = txRegistrador({ ocupado: Array.from({ length: 60 }, () => ({ id: 1 })) });
    await expect(mintearVersionDeModelo(tx, SESION, 7)).rejects.toThrow(ErrorValidacion);
  });
});

describe('crearVersionDeModelo — la puerta', () => {
  it('⭐ exige `modelos.aprobar-receta` (y no cualquier permiso de modelos)', async () => {
    // El permiso se verifica ANTES de abrir la transacción, así que esto no toca la base.
    const sinPermiso = sesionDePrueba({ permisos: ['modelos.ver', 'modelos.administrar'] });
    await expect(crearVersionDeModelo(sinPermiso, 7)).rejects.toThrow(ErrorPermiso);
  });
});
