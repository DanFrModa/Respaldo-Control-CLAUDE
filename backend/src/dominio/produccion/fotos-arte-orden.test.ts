import { describe, expect, it, vi } from 'vitest';

import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  leerArteOrdenParaImpreso,
  listarFotosArteOrden,
  mostrarFotoArteEnOrden,
  ocultarFotoArteEnOrden,
  quitarFotoArteOrden,
  solicitarSubidaFotoArteOrden,
} from './fotos-arte-orden.js';

/**
 * ⭐ §Post-F9.177 — LAS FOTOS DEL ARTE SON **DE LA OP**: heredar, apagar y agregar por renglón.
 * Unit del dominio SIN Postgres, sobre una transacción falsa que **sí respeta los `where`** (si no,
 * las pruebas pasarían por construcción del doble y no por la lógica — la lección de la 0.082).
 *
 * Lo que se prueba, y sobre todo lo que se prueba **en negativo** — el modo de fallo realista aquí
 * es *"añadí lo nuevo y dejé lo viejo debajo"*, es decir, que apagar termine borrando algo:
 *
 *  • **el arte del modelo NO se toca**: el doble hace ILEGALES `modeloArteFoto.delete/update` y
 *    `modeloArte.*`; si el dominio los llamara, la prueba revienta en el acto;
 *  • **apagar/encender NO tocan R2**: `archivo.delete` está INSTRUMENTADO (no prohibido, porque
 *    quitar una foto PROPIA sí debe borrarla) y cada prueba de apagar/encender comprueba que **no
 *    se llamó**. Además esas dos funciones **no aceptan un `ServicioArchivos` en su firma**: no hay
 *    por dónde llamar al bucket — eso lo sostiene el compilador, no esta prueba;
 *  • **otra orden del mismo modelo la sigue viendo**: la marca es por RENGLÓN, y cada orden tiene
 *    el suyo;
 *  • ⭐ **el caso del hijo POR COLOR** (V1-E9a/b cruzado con esto): la orden de un hijo trae la
 *    receta del PADRE, así que su traza apunta al arte del padre — apagar una de esas fotos tiene
 *    que funcionar, que es justo el caso que Daniel describe;
 *  • ⭐ **el arte AGREGADO A MANO**: no hereda nada (apagar → 404) pero SÍ puede subir foto propia,
 *    que es lo único que antes no podía hacer de ninguna forma;
 *  • **las dos ramas gemelas** (apagar / traer de vuelta) por separado, incluida la ASIMETRÍA
 *    deliberada del guard (ver la nota larga en `mostrarFotoArteEnOrden`).
 *
 * La integridad transaccional real, la llave única bajo carrera, los Cascade y el scope de empresa
 * contra Postgres viven en `fotos-arte-orden.int.test.ts` (CI).
 */

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['ordenes.ver', 'desarrollo.ver', 'desarrollo.administrar'] });
const sesionSoloOrdenes = () => sesionDePrueba({ permisos: ['ordenes.ver'] });
const sesionSoloDesarrolloVer = () => sesionDePrueba({ permisos: ['desarrollo.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

/** Estado inicial del doble. */
interface Escenario {
  /** Órdenes existentes (la sesión de prueba usa `idEmpresaActiva: 1`). */
  ordenes?: { id: number; idEmpresa: number; estado: string }[];
  /** Renglones de arte de esas órdenes (la traza YA viene resuelta por linaje). */
  renglones?: {
    id: number;
    idOrden: number;
    idModeloArte: number | null;
    descripcion: string;
    agregadoAMano?: boolean;
    excluido?: boolean;
  }[];
  /** Catálogo `ModeloArteFoto`: qué foto es de qué ARTE del modelo. */
  fotosModelo?: { id: number; idModeloArte: number; orden: number; nombre: string }[];
  /** Fotos PROPIAS ya subidas a un renglón. */
  fotosPropias?: { id: number; idOrdenArte: number; orden: number; idArchivo: string }[];
  /** Marcas ya existentes (renglón, foto del modelo). */
  ocultas?: { idOrdenArte: number; idModeloArteFoto: number }[];
}

/**
 * Transacción falsa que RESPETA los filtros (`idEmpresa`, `idOrden`, `idOrdenArte`, `idModeloArte`,
 * `excluido`…). Prohíbe explícitamente todo lo que destruiría datos de OTRO dueño: si el dominio
 * intentara borrar o editar la foto del arte del MODELO, la prueba truena en el acto en vez de
 * pasar en silencio.
 */
function bdFalsa(escenario: Escenario = {}) {
  const ordenes = escenario.ordenes ?? [{ id: 1, idEmpresa: 1, estado: 'abierta' }];
  const renglones = (
    escenario.renglones ?? [{ id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'Logo frente' }]
  ).map((r) => ({ agregadoAMano: false, excluido: false, ...r }));
  const fotosModelo = escenario.fotosModelo ?? [
    { id: 100, idModeloArte: 500, orden: 0, nombre: 'principal.jpg' },
    { id: 101, idModeloArte: 500, orden: 1, nombre: 'detalle.jpg' },
  ];
  const fotosPropias = [...(escenario.fotosPropias ?? [])];
  const ocultas: {
    id: number;
    idOrdenArte: number;
    idModeloArteFoto: number;
    creadoEn: Date;
  }[] = (escenario.ocultas ?? []).map((o, i) => ({
    id: i + 1,
    ...o,
    creadoEn: new Date(2026, 0, i + 1),
  }));

  const prohibido = (que: string) => (): never => {
    throw new Error(`PROHIBIDO: el dominio llamó a ${que} — la OP no manda sobre el modelo (D3).`);
  };

  const crearOculta = vi.fn(
    (args: {
      data: { idOrdenArte: number; idModeloArteFoto: number; creadoPorId: string | null };
    }) => {
      ocultas.push({
        id: ocultas.length + 1,
        idOrdenArte: args.data.idOrdenArte,
        idModeloArteFoto: args.data.idModeloArteFoto,
        creadoEn: new Date(2026, 5, 1),
      });
      return Promise.resolve(args.data);
    },
  );
  const crearPropia = vi.fn(
    (args: { data: { idOrdenArte: number; idArchivo: string; orden: number } }) => {
      const fila = { id: fotosPropias.length + 900, ...args.data };
      fotosPropias.push(fila);
      return Promise.resolve({ id: fila.id });
    },
  );
  // NO está prohibido: quitar una foto PROPIA sí debe borrar su `Archivo`. Se instrumenta para que
  // cada prueba de apagar/encender pueda exigir que NO se llamó.
  const archivoDelete = vi.fn((args: { where: { id: string } }) => Promise.resolve(args.where));
  // Instrumentada para poder exigir que un renglón AGREGADO A MANO ni siquiera PREGUNTE por el
  // catálogo del modelo: sin traza no hay nada que heredar, así que la consulta sobra.
  const buscarFotoModelo = vi.fn((args: { where: { id: number; idModeloArte: number } }) =>
    Promise.resolve(
      fotosModelo.find(
        (f) => f.id === args.where.id && f.idModeloArte === args.where.idModeloArte,
      ) ?? null,
    ),
  );
  const bitacoraCreate = vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args));

  const archivoDe = (idArchivo: string) => ({
    key: `orden-arte/${idArchivo}.jpg`,
    nombreOriginal: `${idArchivo}.jpg`,
  });

  const tx = {
    orden: {
      findFirst: (args: { where: { id: number; idEmpresa: number } }) =>
        Promise.resolve(
          ordenes.find((o) => o.id === args.where.id && o.idEmpresa === args.where.idEmpresa) ??
            null,
        ),
    },
    ordenArte: {
      findFirst: (args: {
        where: { id: number; idOrden: number; orden: { idEmpresa: number } };
      }) => {
        const r = renglones.find((x) => x.id === args.where.id && x.idOrden === args.where.idOrden);
        if (r === undefined) return Promise.resolve(null);
        const orden = ordenes.find(
          (o) => o.id === r.idOrden && o.idEmpresa === args.where.orden.idEmpresa,
        );
        // ⚠️ El filtro por empresa se aplica DE VERDAD: sin él, la prueba de A9 pasaría sola.
        if (orden === undefined) return Promise.resolve(null);
        return Promise.resolve({
          id: r.id,
          idModeloArte: r.idModeloArte,
          orden: { estado: orden.estado },
        });
      },
      findMany: (args: { where: { idOrden: number; excluido?: boolean } }) =>
        Promise.resolve(
          renglones
            .filter(
              (r) =>
                r.idOrden === args.where.idOrden &&
                (args.where.excluido === undefined || r.excluido === args.where.excluido),
            )
            .sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es') || a.id - b.id)
            .map((r) => ({
              id: r.id,
              idModeloArte: r.idModeloArte,
              descripcion: r.descripcion,
              agregadoAMano: r.agregadoAMano,
              fotosOcultas: ocultas
                .filter((o) => o.idOrdenArte === r.id)
                .sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime() || a.id - b.id)
                .map((o) => ({ idModeloArteFoto: o.idModeloArteFoto })),
              fotos: fotosPropias
                .filter((f) => f.idOrdenArte === r.id)
                .sort((a, b) => a.orden - b.orden || a.id - b.id)
                .map((f) => ({ id: f.id, archivo: archivoDe(f.idArchivo) })),
            })),
        ),
    },
    modeloArteFoto: {
      findFirst: buscarFotoModelo,
      findMany: (args: { where: { idModeloArte: { in: number[] } } }) =>
        Promise.resolve(
          fotosModelo
            .filter((f) => args.where.idModeloArte.in.includes(f.idModeloArte))
            .sort((a, b) => a.orden - b.orden || a.id - b.id)
            .map((f) => ({
              id: f.id,
              idModeloArte: f.idModeloArte,
              archivo: { key: `modelo-arte/${f.nombre}`, nombreOriginal: f.nombre },
            })),
        ),
      // La foto del ARTE DEL MODELO es de otro dueño: este módulo no la borra ni la edita, nunca.
      delete: prohibido('modeloArteFoto.delete'),
      deleteMany: prohibido('modeloArteFoto.deleteMany'),
      update: prohibido('modeloArteFoto.update'),
      updateMany: prohibido('modeloArteFoto.updateMany'),
    },
    modeloArte: {
      delete: prohibido('modeloArte.delete'),
      deleteMany: prohibido('modeloArte.deleteMany'),
      update: prohibido('modeloArte.update'),
      updateMany: prohibido('modeloArte.updateMany'),
    },
    ordenArteFotoOculta: {
      findUnique: (args: {
        where: {
          idOrdenArte_idModeloArteFoto: { idOrdenArte: number; idModeloArteFoto: number };
        };
      }) => {
        const { idOrdenArte, idModeloArteFoto } = args.where.idOrdenArte_idModeloArteFoto;
        return Promise.resolve(
          ocultas.find(
            (o) => o.idOrdenArte === idOrdenArte && o.idModeloArteFoto === idModeloArteFoto,
          ) ?? null,
        );
      },
      findMany: (args: { where: { idOrdenArte: number } }) =>
        Promise.resolve(
          ocultas
            .filter((o) => o.idOrdenArte === args.where.idOrdenArte)
            .sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime() || a.id - b.id),
        ),
      create: crearOculta,
      deleteMany: (args: { where: { idOrdenArte: number; idModeloArteFoto: number } }) => {
        const antes = ocultas.length;
        for (let i = ocultas.length - 1; i >= 0; i -= 1) {
          const fila = ocultas[i];
          if (
            fila !== undefined &&
            fila.idOrdenArte === args.where.idOrdenArte &&
            fila.idModeloArteFoto === args.where.idModeloArteFoto
          ) {
            ocultas.splice(i, 1);
          }
        }
        return Promise.resolve({ count: antes - ocultas.length });
      },
    },
    ordenArteFoto: {
      aggregate: (args: { where: { idOrdenArte: number } }) => {
        const suyas = fotosPropias.filter((f) => f.idOrdenArte === args.where.idOrdenArte);
        return Promise.resolve({
          _max: { orden: suyas.length === 0 ? null : Math.max(...suyas.map((f) => f.orden)) },
        });
      },
      create: crearPropia,
      findFirst: (args: { where: { id: number; idOrdenArte: number } }) => {
        const f = fotosPropias.find(
          (x) => x.id === args.where.id && x.idOrdenArte === args.where.idOrdenArte,
        );
        return Promise.resolve(
          f === undefined ? null : { idArchivo: f.idArchivo, archivo: archivoDe(f.idArchivo) },
        );
      },
    },
    archivo: {
      delete: archivoDelete,
      deleteMany: prohibido('archivo.deleteMany'),
      update: prohibido('archivo.update'),
    },
    bitacora: { create: bitacoraCreate },
  } as unknown as Tx;

  return {
    bd: { tx } as ContextoBd,
    tx,
    ocultas,
    fotosPropias,
    crearOculta,
    crearPropia,
    archivoDelete,
    buscarFotoModelo,
    bitacoraCreate,
  };
}

/** Un `ServicioArchivos` de mentira: firma URLs deterministas y anota los borrados de R2. */
function archivosFalsos() {
  const eliminados: string[] = [];
  const servicio = {
    solicitarSubida: vi.fn(
      (
        _tx: unknown,
        _sesion: unknown,
        datos: { nombreOriginal: string; carpeta: string; tipoMime: string; tamanoBytes: number },
      ) =>
        Promise.resolve({
          archivo: { id: `arch-${datos.nombreOriginal}`, key: `${datos.carpeta}/x` },
          urlSubida: `https://r2.local/PUT/${datos.carpeta}`,
          expiraEnSegundos: 900,
        }),
    ),
    urlDescarga: (key: string) => Promise.resolve(`https://r2.local/GET/${key}`),
    eliminarObjeto: (key: string) => {
      eliminados.push(key);
      return Promise.resolve();
    },
  } as unknown as ServicioArchivos;
  return { servicio, eliminados };
}

/** Las entradas de bitácora que este módulo escribió, ya desempaquetadas. */
function bitacorasDeFoto(
  bitacoraCreate: ReturnType<typeof bdFalsa>['bitacoraCreate'],
): { fotoArte: string; idOrdenArte: number }[] {
  return bitacoraCreate.mock.calls.map(
    (llamada) => (llamada[0].data as { datos: { fotoArte: string; idOrdenArte: number } }).datos,
  );
}

describe('fotos del arte de la OP — permisos (deny-by-default, A4)', () => {
  it('listar sin ordenes.ver NI desarrollo.ver → ErrorPermiso', async () => {
    const { bd } = bdFalsa();
    const { servicio } = archivosFalsos();
    await expect(listarFotosArteOrden(sesionSinNada(), 1, bd, servicio)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('⭐ listar acepta CUALQUIERA de los dos: ordenes.ver o desarrollo.ver (V1-E3j)', async () => {
    const { bd } = bdFalsa();
    const { servicio } = archivosFalsos();
    await expect(listarFotosArteOrden(sesionSoloOrdenes(), 1, bd, servicio)).resolves.toHaveLength(
      1,
    );
    await expect(
      listarFotosArteOrden(sesionSoloDesarrolloVer(), 1, bd, servicio),
    ).resolves.toHaveLength(1);
  });

  it.each([
    [
      'apagar una heredada',
      (bd: ContextoBd) =>
        ocultarFotoArteEnOrden(sesionSoloOrdenes(), 1, 10, { idModeloArteFoto: 100 }, bd),
    ],
    [
      'traerla de vuelta',
      (bd: ContextoBd) => mostrarFotoArteEnOrden(sesionSoloOrdenes(), 1, 10, 100, bd),
    ],
    [
      'subir una propia',
      (bd: ContextoBd) =>
        solicitarSubidaFotoArteOrden(
          sesionSoloOrdenes(),
          1,
          10,
          { nombreOriginal: 'a.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
          bd,
          archivosFalsos().servicio,
        ),
    ],
    [
      'quitar una propia',
      (bd: ContextoBd) =>
        quitarFotoArteOrden(sesionSoloOrdenes(), 1, 10, 900, bd, archivosFalsos().servicio),
    ],
  ])(
    '%s con SÓLO ordenes.ver → ErrorPermiso (mutar es desarrollo.administrar)',
    async (_que, ejecutar) => {
      const { bd, crearOculta, crearPropia, archivoDelete } = bdFalsa({
        ocultas: [{ idOrdenArte: 10, idModeloArteFoto: 100 }],
        fotosPropias: [{ id: 900, idOrdenArte: 10, orden: 0, idArchivo: 'arch-1' }],
      });
      await expect(ejecutar(bd)).rejects.toBeInstanceOf(ErrorPermiso);
      // Y no escribió NADA por el camino (el rechazo no puede haber tocado un dato).
      expect(crearOculta).not.toHaveBeenCalled();
      expect(crearPropia).not.toHaveBeenCalled();
      expect(archivoDelete).not.toHaveBeenCalled();
    },
  );

  it('🔴 ordenes.administrar NO alcanza: mutar el arte de la receta es desarrollo.administrar', async () => {
    const { bd } = bdFalsa();
    const sesion = sesionDePrueba({ permisos: ['ordenes.ver', 'ordenes.administrar'] });
    await expect(
      ocultarFotoArteEnOrden(sesion, 1, 10, { idModeloArteFoto: 100 }, bd),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('fotos del arte de la OP — validación de captura (A1)', () => {
  it.each([0, -3, 1.5])('apagar con idModeloArteFoto=%s → ErrorValidacion', async (id) => {
    const { bd } = bdFalsa();
    await expect(
      ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: id }, bd),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('subir un PDF (no imagen) → ErrorValidacion', async () => {
    const { bd, crearPropia } = bdFalsa();
    const { servicio } = archivosFalsos();
    await expect(
      solicitarSubidaFotoArteOrden(
        sesionAdmin(),
        1,
        10,
        { nombreOriginal: 'ficha.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd,
        servicio,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(crearPropia).not.toHaveBeenCalled();
  });
});

describe('fotos del arte de la OP — empresa activa (A9)', () => {
  it('un renglón de una orden de OTRA empresa → ErrorNoEncontrado (no 403)', async () => {
    const { bd, crearOculta } = bdFalsa({
      ordenes: [{ id: 1, idEmpresa: 2, estado: 'abierta' }],
    });
    await expect(
      ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 100 }, bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(crearOculta).not.toHaveBeenCalled();
  });

  it('listar una orden de OTRA empresa → ErrorNoEncontrado', async () => {
    const { bd } = bdFalsa({ ordenes: [{ id: 1, idEmpresa: 2, estado: 'abierta' }] });
    const { servicio } = archivosFalsos();
    await expect(listarFotosArteOrden(sesionAdmin(), 1, bd, servicio)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('un renglón que es de OTRA orden de la misma empresa → ErrorNoEncontrado', async () => {
    const { bd } = bdFalsa({
      ordenes: [
        { id: 1, idEmpresa: 1, estado: 'abierta' },
        { id: 2, idEmpresa: 1, estado: 'abierta' },
      ],
      renglones: [{ id: 10, idOrden: 2, idModeloArte: 500, descripcion: 'Logo frente' }],
    });
    await expect(
      ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 100 }, bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('fotos del arte de la OP — orden CANCELADA (misma regla que el resto del renglón)', () => {
  const cancelada: Escenario = { ordenes: [{ id: 1, idEmpresa: 1, estado: 'cancelada' }] };

  it.each([
    [
      'apagar',
      (bd: ContextoBd) =>
        ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 100 }, bd),
    ],
    ['traer de vuelta', (bd: ContextoBd) => mostrarFotoArteEnOrden(sesionAdmin(), 1, 10, 100, bd)],
    [
      'subir',
      (bd: ContextoBd) =>
        solicitarSubidaFotoArteOrden(
          sesionAdmin(),
          1,
          10,
          { nombreOriginal: 'a.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
          bd,
          archivosFalsos().servicio,
        ),
    ],
    [
      'quitar',
      (bd: ContextoBd) =>
        quitarFotoArteOrden(sesionAdmin(), 1, 10, 900, bd, archivosFalsos().servicio),
    ],
  ])('%s en una orden cancelada → ErrorConflicto', async (_que, ejecutar) => {
    const { bd } = bdFalsa({
      ...cancelada,
      ocultas: [{ idOrdenArte: 10, idModeloArteFoto: 100 }],
      fotosPropias: [{ id: 900, idOrdenArte: 10, orden: 0, idArchivo: 'arch-1' }],
    });
    await expect(ejecutar(bd)).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('⚠️ un renglón EXCLUIDO sí se deja tocar: es la regla de la casa para una lápida', async () => {
    // `editarRenglonReceta` permite editar una lápida («editar una LÁPIDA no cambia qué se compra»)
    // y sólo la pantalla esconde el control. Aquí igual: inventar un 409 que el resto de la receta
    // no tiene sería una regla nueva, no una consistencia.
    const { bd, ocultas } = bdFalsa({
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'Logo frente', excluido: true },
      ],
    });
    await expect(
      ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 100 }, bd),
    ).resolves.toEqual([100]);
    expect(ocultas).toHaveLength(1);
  });

  it('pero LISTAR una orden cancelada sí se puede (leer nunca estuvo prohibido)', async () => {
    const { bd } = bdFalsa(cancelada);
    const { servicio } = archivosFalsos();
    await expect(listarFotosArteOrden(sesionAdmin(), 1, bd, servicio)).resolves.toHaveLength(1);
  });
});

describe('⭐ apagar una foto HEREDADA — y el arte del modelo intacto (D3)', () => {
  it('apaga la foto, deja bitácora y NO toca ni el modelo ni R2', async () => {
    const { bd, ocultas, archivoDelete, bitacoraCreate } = bdFalsa();
    const resultado = await ocultarFotoArteEnOrden(
      sesionAdmin(),
      1,
      10,
      { idModeloArteFoto: 100 },
      bd,
    );

    expect(resultado).toEqual([100]);
    expect(ocultas).toHaveLength(1);
    // 🔴 EN NEGATIVO: no se borró ningún archivo (los `prohibido` del doble cubren el resto: si
    // hubiera tocado `modeloArteFoto` o `modeloArte`, la llamada habría reventado).
    expect(archivoDelete).not.toHaveBeenCalled();
    expect(bitacorasDeFoto(bitacoraCreate)).toEqual([
      { fotoArte: 'ocultar', idOrdenArte: 10, idModeloArteFoto: 100 },
    ]);
  });

  it('IDEMPOTENTE: apagar dos veces deja UNA marca y UNA bitácora', async () => {
    const { bd, ocultas, bitacoraCreate } = bdFalsa();
    await ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 100 }, bd);
    const segunda = await ocultarFotoArteEnOrden(
      sesionAdmin(),
      1,
      10,
      { idModeloArteFoto: 100 },
      bd,
    );
    expect(segunda).toEqual([100]);
    expect(ocultas).toHaveLength(1);
    expect(bitacoraCreate).toHaveBeenCalledTimes(1);
  });

  it('una foto que NO es de ese arte → ErrorNoEncontrado (y no deja marca)', async () => {
    const { bd, crearOculta } = bdFalsa({
      fotosModelo: [
        { id: 100, idModeloArte: 500, orden: 0, nombre: 'a.jpg' },
        // Foto de OTRO arte del modelo: este renglón no la enseña, así que no puede apagarla.
        { id: 777, idModeloArte: 999, orden: 0, nombre: 'ajena.jpg' },
      ],
    });
    await expect(
      ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 777 }, bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(crearOculta).not.toHaveBeenCalled();
  });

  it('🔴 OTRA ORDEN del mismo modelo la sigue viendo (la marca es por RENGLÓN)', async () => {
    const { bd } = bdFalsa({
      ordenes: [
        { id: 1, idEmpresa: 1, estado: 'abierta' },
        { id: 2, idEmpresa: 1, estado: 'abierta' },
      ],
      // Las dos órdenes son del mismo modelo: sus renglones apuntan al MISMO arte (500).
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'Logo frente' },
        { id: 20, idOrden: 2, idModeloArte: 500, descripcion: 'Logo frente' },
      ],
    });
    const { servicio } = archivosFalsos();
    await ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 100 }, bd);

    const otra = await listarFotosArteOrden(sesionAdmin(), 2, bd, servicio);
    expect(otra[0]?.fotos.map((f) => ({ id: f.idModeloArteFoto, oculta: f.oculta }))).toEqual([
      { id: 100, oculta: false },
      { id: 101, oculta: false },
    ]);
  });

  it('⭐⭐ el HIJO POR COLOR: la traza apunta al arte del PADRE y apagarla FUNCIONA', async () => {
    // La orden es de un modelo hijo por color (V1-E9a); su receta se copió del modelo de
    // DESARROLLO, así que `idModeloArte` señala el arte del PADRE (500). Un guard que comparara
    // contra el modelo de la orden daría un 404 absurdo justo en el caso que Daniel describe.
    const { bd, ocultas } = bdFalsa({
      renglones: [{ id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'Bordado pecho' }],
      fotosModelo: [{ id: 100, idModeloArte: 500, orden: 0, nombre: 'padre.jpg' }],
    });
    await expect(
      ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 100 }, bd),
    ).resolves.toEqual([100]);
    expect(ocultas).toHaveLength(1);
  });

  it('un arte AGREGADO A MANO no hereda nada: apagar → ErrorNoEncontrado', async () => {
    const { bd, crearOculta, buscarFotoModelo } = bdFalsa({
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: null, descripcion: 'Etiqueta', agregadoAMano: true },
      ],
    });
    await expect(
      ocultarFotoArteEnOrden(sesionAdmin(), 1, 10, { idModeloArteFoto: 100 }, bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(crearOculta).not.toHaveBeenCalled();
    // 🔴 Y ni siquiera PREGUNTA por el catálogo del modelo: sin traza no hay de quién heredar, así
    // que la consulta sobra. (Sin esta línea, un guard que dejara pasar el `null` a la consulta
    // pasaría igual — el `where` con `idModeloArte: null` no casa nada — y la prueba no notaría la
    // diferencia. Aquí sí se nota.)
    expect(buscarFotoModelo).not.toHaveBeenCalled();
  });
});

describe('⭐ traerla de vuelta — la rama gemela, probada aparte', () => {
  it('levanta la marca, deja bitácora y NO toca R2', async () => {
    const { bd, ocultas, archivoDelete, bitacoraCreate } = bdFalsa({
      ocultas: [{ idOrdenArte: 10, idModeloArteFoto: 100 }],
    });
    await expect(mostrarFotoArteEnOrden(sesionAdmin(), 1, 10, 100, bd)).resolves.toEqual([]);
    expect(ocultas).toHaveLength(0);
    expect(archivoDelete).not.toHaveBeenCalled();
    expect(bitacorasDeFoto(bitacoraCreate)).toEqual([
      { fotoArte: 'mostrar', idOrdenArte: 10, idModeloArteFoto: 100 },
    ]);
  });

  it('IDEMPOTENTE: encender algo que no estaba apagado no es error y no deja bitácora', async () => {
    const { bd, bitacoraCreate } = bdFalsa();
    await expect(mostrarFotoArteEnOrden(sesionAdmin(), 1, 10, 100, bd)).resolves.toEqual([]);
    expect(bitacoraCreate).not.toHaveBeenCalled();
  });

  it('ASIMETRÍA DELIBERADA: una marca INERTE se puede levantar aunque la foto ya no sea de ese arte', async () => {
    // La foto 777 nunca fue de este arte (o dejó de serlo). La marca no esconde nada, pero
    // levantarla no puede hacer daño: a lo sumo deja de esconder. Con el guard de `ocultar`
    // repetido aquí, quedaría atascada para siempre sin ganar ni una garantía.
    const { bd, ocultas } = bdFalsa({ ocultas: [{ idOrdenArte: 10, idModeloArteFoto: 777 }] });
    await expect(mostrarFotoArteEnOrden(sesionAdmin(), 1, 10, 777, bd)).resolves.toEqual([]);
    expect(ocultas).toHaveLength(0);
  });

  it('🔴 la marca de OTRO renglón no se toca (el `where` lleva el renglón, no sólo la foto)', async () => {
    const { bd, ocultas } = bdFalsa({
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'Logo frente' },
        { id: 11, idOrden: 1, idModeloArte: 500, descripcion: 'Logo espalda' },
      ],
      ocultas: [
        { idOrdenArte: 10, idModeloArteFoto: 100 },
        { idOrdenArte: 11, idModeloArteFoto: 100 },
      ],
    });
    await mostrarFotoArteEnOrden(sesionAdmin(), 1, 10, 100, bd);
    expect(ocultas.map((o) => o.idOrdenArte)).toEqual([11]);
  });
});

describe('⭐ subir una foto PROPIA — lo único que le da imagen al arte agregado a mano', () => {
  it('un arte AGREGADO A MANO sí puede subir foto (no hereda, pero pone la suya)', async () => {
    const { bd, fotosPropias, bitacoraCreate } = bdFalsa({
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: null, descripcion: 'Etiqueta', agregadoAMano: true },
      ],
    });
    const { servicio } = archivosFalsos();
    const subida = await solicitarSubidaFotoArteOrden(
      sesionAdmin(),
      1,
      10,
      { nombreOriginal: 'etiqueta.jpg', tipoMime: 'image/jpeg', tamanoBytes: 2048 },
      bd,
      servicio,
    );
    expect(subida.urlSubida).toContain('orden-arte/10');
    expect(fotosPropias).toHaveLength(1);
    expect(bitacorasDeFoto(bitacoraCreate)).toEqual([
      {
        fotoArte: 'agregar',
        idOrdenArte: 10,
        idFoto: subida.idFoto,
        archivo: 'etiqueta.jpg',
      },
    ]);
  });

  it('la segunda foto va AL FINAL (orden = máximo + 1), no pisa a la primera', async () => {
    const { bd, fotosPropias } = bdFalsa({
      fotosPropias: [{ id: 900, idOrdenArte: 10, orden: 4, idArchivo: 'arch-viejo' }],
    });
    const { servicio } = archivosFalsos();
    await solicitarSubidaFotoArteOrden(
      sesionAdmin(),
      1,
      10,
      { nombreOriginal: 'nueva.jpg', tipoMime: 'image/png', tamanoBytes: 10 },
      bd,
      servicio,
    );
    expect(fotosPropias.map((f) => f.orden)).toEqual([4, 5]);
  });
});

describe('⭐ quitar una foto PROPIA — ésta sí borra, y sólo ésta', () => {
  // ⚠️ El «tras el commit» NO se afirma aquí y no se podía: con `bd = { tx }`, `enTransaccion`
  // toma el atajo `fn(bd.tx)` y NO HAY COMMIT que observar — medido: mover el borrado de R2
  // dentro de la transacción deja este archivo entero en verde (44/44). Esa invariante vive en
  // `fotos-arte-orden-r2.test.ts`, con el guardián compartido de la 0.081(a).
  it('borra el Archivo, deja bitácora y borra el objeto de R2', async () => {
    const { bd, archivoDelete, bitacoraCreate } = bdFalsa({
      fotosPropias: [{ id: 900, idOrdenArte: 10, orden: 0, idArchivo: 'arch-1' }],
    });
    const { servicio, eliminados } = archivosFalsos();
    await quitarFotoArteOrden(sesionAdmin(), 1, 10, 900, bd, servicio);

    expect(archivoDelete).toHaveBeenCalledWith({ where: { id: 'arch-1' } });
    expect(eliminados).toEqual(['orden-arte/arch-1.jpg']);
    expect(bitacorasDeFoto(bitacoraCreate)).toEqual([
      { fotoArte: 'quitar', idOrdenArte: 10, idFoto: 900, archivo: 'arch-1.jpg' },
    ]);
  });

  it('🔴 una foto HEREDADA no entra por aquí: el id de una `ModeloArteFoto` → ErrorNoEncontrado', async () => {
    // 100 es una foto del ARTE DEL MODELO. Si `quitar` la alcanzara, la OP borraría el archivo de
    // otro dueño — exactamente lo que D3 prohíbe.
    const { bd, archivoDelete } = bdFalsa();
    const { servicio, eliminados } = archivosFalsos();
    await expect(
      quitarFotoArteOrden(sesionAdmin(), 1, 10, 100, bd, servicio),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminados).toEqual([]);
  });

  it('la foto propia de OTRO renglón → ErrorNoEncontrado', async () => {
    const { bd, archivoDelete } = bdFalsa({
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'Logo frente' },
        { id: 11, idOrden: 1, idModeloArte: 500, descripcion: 'Logo espalda' },
      ],
      fotosPropias: [{ id: 900, idOrdenArte: 11, orden: 0, idArchivo: 'arch-1' }],
    });
    const { servicio } = archivosFalsos();
    await expect(
      quitarFotoArteOrden(sesionAdmin(), 1, 10, 900, bd, servicio),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(archivoDelete).not.toHaveBeenCalled();
  });
});

describe('⭐ la LECTURA: qué enseña cada renglón', () => {
  it('heredadas primero (en el orden del modelo), propias después, y la ESTRELLA en la primera del modelo', async () => {
    const { bd } = bdFalsa({
      fotosPropias: [{ id: 900, idOrdenArte: 10, orden: 0, idArchivo: 'arch-1' }],
    });
    const { servicio } = archivosFalsos();
    const [arte] = await listarFotosArteOrden(sesionAdmin(), 1, bd, servicio);

    expect(arte?.fotos.map((f) => [f.origen, f.idModeloArteFoto, f.idFoto, f.principal])).toEqual([
      ['modelo', 100, null, true],
      ['modelo', 101, null, false],
      ['orden', null, 900, false],
    ]);
    expect(arte?.fotos[0]?.urlDescarga).toBe('https://r2.local/GET/modelo-arte/principal.jpg');
  });

  it('⭐ SER PRINCIPAL NO SE TRANSFIERE: apagada la primera, la segunda NO hereda la estrella', async () => {
    const { bd } = bdFalsa({ ocultas: [{ idOrdenArte: 10, idModeloArteFoto: 100 }] });
    const { servicio } = archivosFalsos();
    const [arte] = await listarFotosArteOrden(sesionAdmin(), 1, bd, servicio);

    expect(arte?.fotos.map((f) => [f.idModeloArteFoto, f.oculta, f.principal])).toEqual([
      [100, true, true],
      [101, false, false],
    ]);
  });

  it('las apagadas VIAJAN marcadas (no desaparecen): sin eso no habría cómo traerlas de vuelta', async () => {
    const { bd } = bdFalsa({ ocultas: [{ idOrdenArte: 10, idModeloArteFoto: 101 }] });
    const { servicio } = archivosFalsos();
    const [arte] = await listarFotosArteOrden(sesionAdmin(), 1, bd, servicio);
    expect(arte?.fotos.filter((f) => f.oculta).map((f) => f.idModeloArteFoto)).toEqual([101]);
  });

  it('un arte agregado a mano sólo enseña las suyas', async () => {
    const { bd } = bdFalsa({
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: null, descripcion: 'Etiqueta', agregadoAMano: true },
      ],
      fotosPropias: [{ id: 900, idOrdenArte: 10, orden: 0, idArchivo: 'arch-1' }],
    });
    const { servicio } = archivosFalsos();
    const [arte] = await listarFotosArteOrden(sesionAdmin(), 1, bd, servicio);
    expect(arte?.agregadoAMano).toBe(true);
    expect(arte?.fotos.map((f) => f.origen)).toEqual(['orden']);
  });

  it('🔴 CONVIVIENDO: el arte a mano NO se cuela las fotos del arte del modelo que va a su lado', async () => {
    // El caso realista de la orden de verdad: un arte del modelo y otro agregado a mano en la MISMA
    // receta. Sin renglón del modelo al lado, un reparto equivocado de las heredadas no se nota:
    // no hay ninguna que colarse.
    const { bd } = bdFalsa({
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'A · del modelo' },
        {
          id: 11,
          idOrden: 1,
          idModeloArte: null,
          descripcion: 'B · a mano',
          agregadoAMano: true,
        },
      ],
      fotosPropias: [{ id: 900, idOrdenArte: 11, orden: 0, idArchivo: 'arch-1' }],
    });
    const { servicio } = archivosFalsos();
    const artes = await listarFotosArteOrden(sesionAdmin(), 1, bd, servicio);

    expect(artes.map((a) => a.idOrdenArte)).toEqual([10, 11]);
    // El del modelo enseña SUS dos heredadas…
    expect(artes[0]?.fotos.map((f) => [f.origen, f.idModeloArteFoto])).toEqual([
      ['modelo', 100],
      ['modelo', 101],
    ]);
    // …y el de a mano, SÓLO la suya. Ni una heredada se le pega.
    expect(artes[1]?.fotos.map((f) => [f.origen, f.idFoto])).toEqual([['orden', 900]]);
  });

  it('🔴 dos artes del modelo distintos NO se prestan fotos entre sí', async () => {
    const { bd } = bdFalsa({
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'A · frente' },
        { id: 11, idOrden: 1, idModeloArte: 600, descripcion: 'B · espalda' },
      ],
      fotosModelo: [
        { id: 100, idModeloArte: 500, orden: 0, nombre: 'frente.jpg' },
        { id: 200, idModeloArte: 600, orden: 0, nombre: 'espalda.jpg' },
      ],
    });
    const { servicio } = archivosFalsos();
    const artes = await listarFotosArteOrden(sesionAdmin(), 1, bd, servicio);
    expect(artes.map((a) => a.fotos.map((f) => f.idModeloArteFoto))).toEqual([[100], [200]]);
  });

  it('un renglón EXCLUIDO sí sale en la pantalla (se pinta tachado) pero NO en el impreso', async () => {
    const escenario: Escenario = {
      renglones: [
        { id: 10, idOrden: 1, idModeloArte: 500, descripcion: 'Logo frente' },
        {
          id: 11,
          idOrden: 1,
          idModeloArte: null,
          descripcion: 'Quitado',
          excluido: true,
          agregadoAMano: true,
        },
      ],
    };
    const { bd, tx } = bdFalsa(escenario);
    const { servicio } = archivosFalsos();
    const pantalla = await listarFotosArteOrden(sesionAdmin(), 1, bd, servicio);
    expect(pantalla.map((a) => a.idOrdenArte)).toEqual([10, 11]);

    const papel = await leerArteOrdenParaImpreso(tx, 1);
    expect(papel.map((a) => a.idOrdenArte)).toEqual([10]);
  });
});

describe('⭐ lo que ve el IMPRESO (lectura de bajo nivel, sin permiso)', () => {
  it('devuelve la traza, las apagadas y las keys de las propias', async () => {
    const { tx } = bdFalsa({
      ocultas: [{ idOrdenArte: 10, idModeloArteFoto: 100 }],
      fotosPropias: [{ id: 900, idOrdenArte: 10, orden: 0, idArchivo: 'arch-1' }],
    });
    expect(await leerArteOrdenParaImpreso(tx, 1)).toEqual([
      {
        idOrdenArte: 10,
        idModeloArte: 500,
        descripcion: 'Logo frente',
        ocultas: [100],
        propias: [{ idFoto: 900, key: 'orden-arte/arch-1.jpg' }],
      },
    ]);
  });

  it('un renglón sin decisiones sale con las dos listas vacías (el caso de todo lo ya capturado)', async () => {
    const { tx } = bdFalsa();
    expect(await leerArteOrdenParaImpreso(tx, 1)).toEqual([
      {
        idOrdenArte: 10,
        idModeloArte: 500,
        descripcion: 'Logo frente',
        ocultas: [],
        propias: [],
      },
    ]);
  });
});
