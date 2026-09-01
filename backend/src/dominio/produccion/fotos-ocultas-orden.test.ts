import { describe, expect, it, vi } from 'vitest';

import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  leerIdsFotosOcultasOrden,
  listarFotosOcultasOrden,
  mostrarFotoModeloEnOrden,
  ocultarFotoModeloEnOrden,
} from './fotos-ocultas-orden.js';

/**
 * ⭐ §Post-F9.169(b) — QUITAR DE LA OP UNA FOTO HEREDADA DEL MODELO, **sin borrarla del modelo**.
 * Unit del dominio SIN Postgres, sobre una transacción falsa que sí respeta los `where` (si no, las
 * pruebas pasarían por construcción del doble y no por la lógica).
 *
 * Lo que se prueba, y sobre todo lo que se prueba **en negativo** — el modo de fallo realista aquí
 * es *"añadí lo nuevo y dejé lo viejo debajo"*, es decir, que ocultar termine borrando algo:
 *
 *  • **la foto del modelo NO se toca**: el doble hace ILEGALES `modeloFoto.delete/update` y
 *    `archivo.delete/update`; si el dominio los llamara, la prueba revienta en el acto;
 *  • **R2 no se toca jamás**: la puerta al bucket es el registro `Archivo`, y ésa está tapiada
 *    arriba. (Además, el módulo ni siquiera acepta un `ServicioArchivos` en su firma: no hay por
 *    dónde llamarlo — eso lo sostiene el compilador, no esta prueba.);
 *  • **otra orden del mismo modelo la sigue viendo**: la marca es por *(orden, foto)*;
 *  • **las dos ramas gemelas** (quitar / traer de vuelta) se prueban por separado, incluida la
 *    ASIMETRÍA deliberada del guard: `mostrar` no lo repite porque ese guard sólo podría rechazar un
 *    no-op (ver la nota larga en `mostrarFotoModeloEnOrden`).
 *
 * La integridad transaccional real, la llave única bajo carrera y el scope de empresa contra
 * Postgres viven en `fotos-ocultas-orden.int.test.ts` (CI).
 */

const sesionAdmin = () => sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['ordenes.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

/** Estado inicial del doble: el catálogo de fotos, las órdenes y las marcas ya puestas. */
interface Escenario {
  /** Órdenes existentes (la sesión de prueba usa `idEmpresaActiva: 1`). */
  ordenes?: { id: number; idEmpresa: number; idModelo: number }[];
  /** Modelos, con su linaje (`idModeloDesarrollo`) para el caso del hijo por color. */
  modelos?: { id: number; idModeloDesarrollo: number | null }[];
  /** Catálogo `ModeloFoto`: qué foto es de qué modelo. */
  fotos?: { id: number; idModelo: number }[];
  /** Marcas ya existentes (orden, foto). */
  ocultas?: { idOrden: number; idModeloFoto: number }[];
}

/**
 * Transacción falsa que RESPETA los filtros (`idEmpresa`, `idModelo`, `idOrden`…). Prohíbe
 * explícitamente todo lo que destruiría datos ajenos: si el dominio intentara borrar o editar la
 * foto del modelo —o su `Archivo`— la prueba truena en el acto en vez de pasar en silencio.
 */
function bdFalsa(escenario: Escenario = {}) {
  const ordenes = escenario.ordenes ?? [{ id: 1, idEmpresa: 1, idModelo: 10 }];
  const modelos = escenario.modelos ?? [{ id: 10, idModeloDesarrollo: null }];
  const fotos = escenario.fotos ?? [{ id: 100, idModelo: 10 }];
  const ocultas: { id: number; idOrden: number; idModeloFoto: number; creadoEn: Date }[] = (
    escenario.ocultas ?? []
  ).map((o, i) => ({ id: i + 1, ...o, creadoEn: new Date(2026, 0, i + 1) }));

  const prohibido = (que: string) => (): never => {
    throw new Error(`PROHIBIDO: el dominio llamó a ${que} — ocultar NO es borrar (D3).`);
  };

  const crearOculta = vi.fn(
    (args: { data: { idOrden: number; idModeloFoto: number; creadoPorId: string | null } }) => {
      ocultas.push({
        id: ocultas.length + 1,
        idOrden: args.data.idOrden,
        idModeloFoto: args.data.idModeloFoto,
        creadoEn: new Date(2026, 5, 1),
      });
      return Promise.resolve(args.data);
    },
  );
  const bitacoraCreate = vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args));

  const tx = {
    orden: {
      findFirst: (args: { where: { id: number; idEmpresa: number } }) =>
        Promise.resolve(
          ordenes.find((o) => o.id === args.where.id && o.idEmpresa === args.where.idEmpresa) ??
            null,
        ),
    },
    modelo: {
      findUnique: (args: { where: { id: number } }) =>
        Promise.resolve(modelos.find((m) => m.id === args.where.id) ?? null),
    },
    modeloFoto: {
      count: (args: { where: { idModelo: number } }) =>
        Promise.resolve(fotos.filter((f) => f.idModelo === args.where.idModelo).length),
      findFirst: (args: { where: { id: number; idModelo: number } }) =>
        Promise.resolve(
          fotos.find((f) => f.id === args.where.id && f.idModelo === args.where.idModelo) ?? null,
        ),
      // La foto del MODELO es de otro dueño: este módulo no la borra ni la edita, nunca.
      delete: prohibido('modeloFoto.delete'),
      deleteMany: prohibido('modeloFoto.deleteMany'),
      update: prohibido('modeloFoto.update'),
      updateMany: prohibido('modeloFoto.updateMany'),
    },
    // El registro del objeto en R2. Tocarlo sería destruir el archivo para TODO el sistema.
    archivo: {
      delete: prohibido('archivo.delete'),
      deleteMany: prohibido('archivo.deleteMany'),
      update: prohibido('archivo.update'),
    },
    ordenFotoOculta: {
      findUnique: (args: {
        where: { idOrden_idModeloFoto: { idOrden: number; idModeloFoto: number } };
      }) => {
        const { idOrden, idModeloFoto } = args.where.idOrden_idModeloFoto;
        return Promise.resolve(
          ocultas.find((o) => o.idOrden === idOrden && o.idModeloFoto === idModeloFoto) ?? null,
        );
      },
      findMany: (args: { where: { idOrden: number } }) =>
        Promise.resolve(
          ocultas
            .filter((o) => o.idOrden === args.where.idOrden)
            .sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime() || a.id - b.id),
        ),
      create: crearOculta,
      deleteMany: (args: { where: { idOrden: number; idModeloFoto: number } }) => {
        const antes = ocultas.length;
        for (let i = ocultas.length - 1; i >= 0; i -= 1) {
          const fila = ocultas[i];
          if (
            fila !== undefined &&
            fila.idOrden === args.where.idOrden &&
            fila.idModeloFoto === args.where.idModeloFoto
          ) {
            ocultas.splice(i, 1);
          }
        }
        return Promise.resolve({ count: antes - ocultas.length });
      },
    },
    bitacora: { create: bitacoraCreate },
  } as unknown as Tx;

  return { bd: { tx } as ContextoBd, tx, ocultas, crearOculta, bitacoraCreate };
}

/** Las entradas de bitácora que este módulo escribió, ya desempaquetadas. */
function bitacorasDeFoto(
  bitacoraCreate: ReturnType<typeof bdFalsa>['bitacoraCreate'],
): { fotoModelo: string; idModeloFoto: number }[] {
  return bitacoraCreate.mock.calls.map(
    (llamada) => (llamada[0].data as { datos: { fotoModelo: string; idModeloFoto: number } }).datos,
  );
}

describe('fotos ocultas de la orden — permisos (deny-by-default, A4)', () => {
  it('listar sin ordenes.ver → ErrorPermiso', async () => {
    const { bd } = bdFalsa();
    await expect(listarFotosOcultasOrden(sesionSinNada(), 1, bd)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('quitar una foto de la OP sin ordenes.administrar → ErrorPermiso', async () => {
    const { bd, crearOculta } = bdFalsa();
    await expect(
      ocultarFotoModeloEnOrden(sesionSoloVer(), 1, { idModeloFoto: 100 }, bd),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    // Y no escribió nada por el camino.
    expect(crearOculta).not.toHaveBeenCalled();
  });

  it('traerla de vuelta sin ordenes.administrar → ErrorPermiso', async () => {
    const { bd } = bdFalsa({ ocultas: [{ idOrden: 1, idModeloFoto: 100 }] });
    await expect(mostrarFotoModeloEnOrden(sesionSoloVer(), 1, 100, bd)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    // 🔴 En NEGATIVO: la marca sigue puesta (el rechazo no puede haber borrado nada).
    expect(await leerIdsFotosOcultasOrden(bd.tx as Tx, 1)).toEqual([100]);
  });
});

describe('fotos ocultas de la orden — validación de captura (A1)', () => {
  it.each([0, -3, 1.5])('quitar con idModeloFoto=%s → ErrorValidacion', async (idModeloFoto) => {
    const { bd } = bdFalsa();
    await expect(
      ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto }, bd),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('fotos ocultas de la orden — empresa activa (A9)', () => {
  it('quitar una foto en una orden de OTRA empresa → ErrorNoEncontrado', async () => {
    const { bd, crearOculta } = bdFalsa({
      ordenes: [{ id: 1, idEmpresa: 2, idModelo: 10 }],
    });
    await expect(
      ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(crearOculta).not.toHaveBeenCalled();
  });

  it('listar las fotos ocultas de una orden de OTRA empresa → ErrorNoEncontrado', async () => {
    const { bd } = bdFalsa({ ordenes: [{ id: 1, idEmpresa: 2, idModelo: 10 }] });
    await expect(listarFotosOcultasOrden(sesionAdmin(), 1, bd)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});

describe('⭐ quitar de la OP una foto heredada del modelo', () => {
  it('pone la marca, la audita (A7) y NO toca la foto del modelo ni su archivo (D3)', async () => {
    const { bd, crearOculta, bitacoraCreate } = bdFalsa();

    const resultado = await ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd);

    expect(crearOculta).toHaveBeenCalledTimes(1);
    expect(crearOculta.mock.calls[0]?.[0].data).toEqual({
      idOrden: 1,
      idModeloFoto: 100,
      creadoPorId: 'usuario-prueba',
    });
    expect(bitacorasDeFoto(bitacoraCreate)).toEqual([{ fotoModelo: 'ocultar', idModeloFoto: 100 }]);
    // Devuelve el estado resultante, ya leído dentro de la misma transacción.
    expect(resultado.map((f) => f.idModeloFoto)).toEqual([100]);
    // 🔴 Lo que NO pasó: el doble hace reventar `modeloFoto.delete/update` y `archivo.delete`. Que
    // la prueba llegue hasta aquí ES la aserción de que la foto del modelo quedó intacta.
  });

  it('🔴 OTRA ORDEN DEL MISMO MODELO LA SIGUE VIENDO (la marca es por orden)', async () => {
    const { bd, tx } = bdFalsa({
      ordenes: [
        { id: 1, idEmpresa: 1, idModelo: 10 },
        { id: 2, idEmpresa: 1, idModelo: 10 },
      ],
    });

    await ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd);

    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([100]);
    // La orden 2, del MISMO modelo y la misma foto, no oculta nada.
    expect(await leerIdsFotosOcultasOrden(tx, 2)).toEqual([]);
    expect(await listarFotosOcultasOrden(sesionAdmin(), 2, bd)).toEqual([]);
  });

  it('es IDEMPOTENTE: quitarla dos veces deja UNA marca y UNA sola entrada de bitácora', async () => {
    const { bd, tx, crearOculta, bitacoraCreate } = bdFalsa();

    await ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd);
    const segunda = await ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd);

    expect(crearOculta).toHaveBeenCalledTimes(1);
    expect(bitacoraCreate).toHaveBeenCalledTimes(1);
    expect(segunda.map((f) => f.idModeloFoto)).toEqual([100]);
    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([100]);
  });

  it('🔴 en NEGATIVO: una foto que NO es del modelo de la orden → 404 y no se marca nada', async () => {
    const { bd, tx, crearOculta } = bdFalsa({
      fotos: [
        { id: 100, idModelo: 10 },
        // Foto de OTRO modelo: esta orden no la enseña, así que no puede "quitarla".
        { id: 999, idModelo: 77 },
      ],
    });

    await expect(
      ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 999 }, bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(crearOculta).not.toHaveBeenCalled();
    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([]);
  });

  it('⭐⭐ una foto HEREDADA DEL PADRE (hijo por color sin fotos propias) sí se puede quitar', async () => {
    // El modelo 11 nació por color del desarrollo 10 y no tiene fotos propias: en pantalla enseña
    // las del padre. Si el guard mirara sólo `idModelo === 11`, quitarla rebotaría con un 404
    // absurdo justo en el caso que Daniel describe.
    const { bd, tx } = bdFalsa({
      ordenes: [{ id: 1, idEmpresa: 1, idModelo: 11 }],
      modelos: [
        { id: 10, idModeloDesarrollo: null },
        { id: 11, idModeloDesarrollo: 10 },
      ],
      fotos: [{ id: 100, idModelo: 10 }],
    });

    await ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd);

    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([100]);
  });

  it('🔴 y si el hijo YA tiene fotos propias, gana la suya: la del padre ya no es "suya" (404)', async () => {
    // Rama gemela de la anterior — el mismo `idModeloDeLasFotos`, decidido al revés. Sin esta, un
    // guard que resolviera SIEMPRE al padre pasaría la prueba de arriba y estaría mal.
    const { bd, crearOculta } = bdFalsa({
      ordenes: [{ id: 1, idEmpresa: 1, idModelo: 11 }],
      modelos: [
        { id: 10, idModeloDesarrollo: null },
        { id: 11, idModeloDesarrollo: 10 },
      ],
      fotos: [
        { id: 100, idModelo: 10 },
        { id: 200, idModelo: 11 },
      ],
    });

    // La propia (200) sí se puede quitar…
    await ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 200 }, bd);
    expect(crearOculta).toHaveBeenCalledTimes(1);
    // …y la del padre (100), que ya no se enseña, no.
    await expect(
      ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(crearOculta).toHaveBeenCalledTimes(1);
  });
});

describe('⭐ traerla de vuelta (la rama gemela)', () => {
  it('levanta la marca y lo audita; la lista queda vacía', async () => {
    const { bd, tx, bitacoraCreate } = bdFalsa({ ocultas: [{ idOrden: 1, idModeloFoto: 100 }] });

    const resultado = await mostrarFotoModeloEnOrden(sesionAdmin(), 1, 100, bd);

    expect(resultado).toEqual([]);
    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([]);
    expect(bitacorasDeFoto(bitacoraCreate)).toEqual([{ fotoModelo: 'mostrar', idModeloFoto: 100 }]);
  });

  it('es IDEMPOTENTE: traer de vuelta algo que no estaba quitado no falla y NO audita', async () => {
    const { bd, bitacoraCreate } = bdFalsa();

    await expect(mostrarFotoModeloEnOrden(sesionAdmin(), 1, 100, bd)).resolves.toEqual([]);

    expect(bitacoraCreate).not.toHaveBeenCalled();
  });

  it('🔴 solo levanta la marca de ESA orden (no la de otra orden con la misma foto)', async () => {
    const { bd, tx } = bdFalsa({
      ordenes: [
        { id: 1, idEmpresa: 1, idModelo: 10 },
        { id: 2, idEmpresa: 1, idModelo: 10 },
      ],
      ocultas: [
        { idOrden: 1, idModeloFoto: 100 },
        { idOrden: 2, idModeloFoto: 100 },
      ],
    });

    await mostrarFotoModeloEnOrden(sesionAdmin(), 1, 100, bd);

    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([]);
    expect(await leerIdsFotosOcultasOrden(tx, 2)).toEqual([100]);
  });

  it('⭐ levanta la marca aunque la foto ya no sea de las que la orden enseña (no deja filas atascadas)', async () => {
    // El escenario que distingue las dos ramas: la marca se puso sobre una foto HEREDADA del padre y
    // después al hijo se le subió su primera foto propia. El dueño de la galería cambió, así que el
    // guard de `ocultar` diría 404 aquí.
    //
    // 🔑 Ojo con lo que esto NO significa (medición del reviewer, 1-sep-2026): la marca ya es INERTE
    // —la OP dejó de enseñar esa foto, así que no esconde nada— y volvería a ser borrable en cuanto
    // volviera a esconder algo, porque el guard usa la MISMA condición con la que la lectura decide
    // qué pinta. Lo que se prueba aquí no es un rescate: es que levantar una marca no se hace pedir
    // permiso a un guard que sólo puede rechazar un no-op, y que la tabla no acumula filas
    // atascadas.
    const { bd, tx } = bdFalsa({
      ordenes: [{ id: 1, idEmpresa: 1, idModelo: 11 }],
      modelos: [
        { id: 10, idModeloDesarrollo: null },
        { id: 11, idModeloDesarrollo: 10 },
      ],
      fotos: [
        { id: 100, idModelo: 10 },
        { id: 200, idModelo: 11 },
      ],
      ocultas: [{ idOrden: 1, idModeloFoto: 100 }],
    });

    await mostrarFotoModeloEnOrden(sesionAdmin(), 1, 100, bd);

    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([]);
  });

  it('sigue exigiendo la ORDEN de la empresa activa (A9): no se destapa lo de otra empresa', async () => {
    const { bd, tx } = bdFalsa({
      ordenes: [{ id: 1, idEmpresa: 2, idModelo: 10 }],
      ocultas: [{ idOrden: 1, idModeloFoto: 100 }],
    });

    await expect(mostrarFotoModeloEnOrden(sesionAdmin(), 1, 100, bd)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([100]);
  });
});

describe('ida y vuelta completa', () => {
  it('quitar → traer de vuelta → quitar deja la marca puesta y TRES entradas de bitácora', async () => {
    const { bd, tx, bitacoraCreate } = bdFalsa();

    await ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd);
    await mostrarFotoModeloEnOrden(sesionAdmin(), 1, 100, bd);
    await ocultarFotoModeloEnOrden(sesionAdmin(), 1, { idModeloFoto: 100 }, bd);

    expect(await leerIdsFotosOcultasOrden(tx, 1)).toEqual([100]);
    expect(bitacorasDeFoto(bitacoraCreate)).toEqual([
      { fotoModelo: 'ocultar', idModeloFoto: 100 },
      { fotoModelo: 'mostrar', idModeloFoto: 100 },
      { fotoModelo: 'ocultar', idModeloFoto: 100 },
    ]);
  });
});
