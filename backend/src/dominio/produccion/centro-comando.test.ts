import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../../datos/index.js';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { centroComandoOrdenes } from './centro-comando.js';

/**
 * Unit del CENTRO DE COMANDO de órdenes (rediseño R2, §4.2) — SIN Postgres. Cubre el guard de
 * permiso (A4), la validación de filtros, el corto-circuito A9 (idEmpresa ≠ activa → página vacía
 * SIN tocar la base) y la PROYECCIÓN/agregación por lote (Σ cortada, primer maquilero de costura +
 * distintos, primer aplicador, OC de tela más reciente, mes de entrega). Los filtros contra datos
 * reales (envíos cancelados fuera, OC en borrador no cuenta, mes por EXTRACT) viven en
 * `centro-comando.int.test.ts` (CI).
 */

const sesionVer = () => sesionDePrueba({ permisos: ['ordenes.ver'] });

/**
 * Fila cruda de la orden del stub (lo que devuelve `findMany` con el select del centro). Vive
 * fuera de `bdStub` para que un test pueda re-emitirla con un cambio puntual.
 */
function ordenBase() {
  return {
    id: 10,
    folio: 5424n,
    estado: 'completa',
    idEmpresa: 1,
    empresa: { nombre: 'FR Moda' },
    idModelo: 3,
    // Insumos de la regla de "orden completa" (`requisitos-orden.ts`). V1-E3d: la casilla del
    // MODELO + los datos de la ORDEN. Esta orden NO tiene su receta liberada → `faltantes: ['receta']`.
    modelo: { codigo: '62182', descripcion: 'Sudadera', llevaArte: false },
    recetaLiberadaEn: null as Date | null,
    _count: { lineas: 3, recetaArtes: 2 },
    idMaquilero: 77,
    maquilero: { nombre: 'Asignado SA' },
    fechaEntrega: new Date('2026-07-04T00:00:00Z'),
    idCliente: 4,
    cliente: { nombre: 'C&A' },
    pedidoLinea: { pedido: { id: 9, folio: 1485n } },
    referencias: [{ valor: '613609' }],
  };
}

/**
 * Un renglón de tela congelado, como lo lee la comparación con las hermanas (fila 0.068 (a)).
 *
 * `excluido` viaja porque **no es cosmético**: una LÁPIDA (el renglón que vino del modelo y esta
 * orden decidió no llevar — la jareta) cuenta como *«no lo lleva»*, que es justo la diferencia que
 * hay que ver. Y la fila sigue estando ahí, así que la orden **sí tiene receta congelada**.
 */
function telaCongelada(
  idOrden: number,
  idTela: number,
  consumo: number,
  extra: {
    nombre?: string;
    excluido?: boolean;
    deLaMigracion?: boolean;
    /** `ajustado` = la tocó una persona. En una lápida, es la marca de «quitar es decidir». */
    estado?: 'sin_revisar' | 'revisado' | 'ajustado';
  } = {},
) {
  return {
    idOrden,
    idTela,
    excluido: extra.excluido ?? false,
    estado: extra.estado ?? 'sin_revisar',
    ...firma(extra.deLaMigracion ?? false),
    consumoPorPrenda: new Prisma.Decimal(consumo),
    tela: { nombre: extra.nombre ?? 'Jersey' },
  };
}

/**
 * ⭐⭐ LA FIRMA del renglón, que es lo que distingue una receta ESCRITA POR EL ETL de una que
 * decidió una persona: `liberadoEn` sellado con `liberadoPorId` en NULL = *«la liberó la
 * migración»* (`20260815140000_receta_en_la_orden/migration.sql:25`). Una receta migrada **no
 * vota**: si votara, N órdenes históricas señalarían a la OP nueva.
 */
function firma(deLaMigracion: boolean): { liberadoEn: Date | null; liberadoPorId: string | null } {
  return deLaMigracion
    ? { liberadoEn: new Date('2026-08-15T00:00:00Z'), liberadoPorId: null }
    : { liberadoEn: null, liberadoPorId: null };
}

/** Un renglón de AVÍO congelado — la gemela de {@link telaCongelada}, con su modo de captura R18. */
function avioCongelado(
  idOrden: number,
  idAvio: number,
  consumo: number,
  extra: { clave?: string; excluido?: boolean } = {},
) {
  return {
    idOrden,
    idAvio,
    excluido: extra.excluido ?? false,
    estado: 'sin_revisar',
    ...firma(false),
    consumoPorPrenda: new Prisma.Decimal(consumo),
    consumoPorTalla: false,
    avio: { clave: extra.clave ?? 'BOT-01', descripcion: 'Botón' },
    tallas: [] as { idTalla: number; consumo: Prisma.Decimal }[],
  };
}

/**
 * Un renglón de ARTE congelado — la TERCERA gemela. `idModeloArte` null = agregado a mano, y
 * entonces su identidad es la descripción normalizada (ver `claveArte`).
 */
function arteCongelado(
  idOrden: number,
  descripcion: string,
  extra: { idModeloArte?: number | null; excluido?: boolean } = {},
) {
  return {
    idOrden,
    idModeloArte: extra.idModeloArte ?? null,
    excluido: extra.excluido ?? false,
    estado: 'sin_revisar',
    ...firma(false),
    descripcion,
  };
}

/**
 * Stub de lectura: por omisión 1 orden con cortes (2 vivos), envíos a 2 maquileros + 1 estampador
 * y 2 OC.
 *
 * ⭐ fila 0.068 (a): `orden.findMany` atiende TRES consultas distintas —la del centro y las dos del
 * linaje— y las distingue como lo haría Postgres (ver el comentario de dentro). `telas`/`avios`/
 * `artes` alimentan las recetas congeladas de la familia; vacías = ninguna orden tiene receta
 * congelada ⇒ no hay nada que comparar (el caso del histórico migrado del Access).
 */
function bdStub(
  opciones: {
    filas?: ReturnType<typeof ordenBase>[];
    /** Toda la familia (linaje) que ve la comparación, incluidas las que no están en la página. */
    familia?: { id: number; folio: bigint; idModelo: number }[];
    telas?: ReturnType<typeof telaCongelada>[];
    avios?: ReturnType<typeof avioCongelado>[];
    artes?: ReturnType<typeof arteCongelado>[];
  } = {},
) {
  const filas = opciones.filas ?? [ordenBase()];
  const telas = opciones.telas ?? [];
  const avios = opciones.avios ?? [];
  const artes = opciones.artes ?? [];
  const familia =
    opciones.familia ?? filas.map((f) => ({ id: f.id, folio: f.folio, idModelo: f.idModelo }));
  const delLinaje = familia.map((f) => ({
    id: f.id,
    folio: f.folio,
    // `idModeloDesarrollo: null` = «la receta es la mía» ⇒ el linaje es el propio modelo.
    modelo: { id: f.idModelo, idModeloDesarrollo: null },
  }));
  const tx = {
    orden: {
      count: vi.fn(() => Promise.resolve(filas.length)),
      // Tres consultas distintas caen aquí y el stub las distingue como lo haría Postgres:
      //  • la del CENTRO — es la única que pide `empresa` en su `select`;
      //  • la de «el linaje de LAS ÓRDENES PEDIDAS» — filtra por `where.id.in`, y el stub **lo
      //    respeta**: si no, pasarle media página al comparador se vería igual que pasársela
      //    entera y la prueba no podría distinguirlas (medido con mutación);
      //  • la de «toda la familia» — sin `id`, devuelve el linaje completo.
      findMany: vi.fn(
        (args: { select?: Record<string, unknown>; where?: { id?: { in?: number[] } } }) => {
          if (args.select !== undefined && 'empresa' in args.select) return Promise.resolve(filas);
          const pedidos = args.where?.id?.in;
          return Promise.resolve(
            pedidos === undefined ? delLinaje : delLinaje.filter((o) => pedidos.includes(o.id)),
          );
        },
      ),
    },
    // Recetas congeladas de la familia (fila 0.068 (a)). Sirven a las dos lecturas del módulo:
    // la de los renglones vivos y la de «¿esta orden tiene receta congelada?».
    ordenTela: { findMany: vi.fn(() => Promise.resolve(telas)) },
    ordenAvio: { findMany: vi.fn(() => Promise.resolve(avios)) },
    ordenArte: { findMany: vi.fn(() => Promise.resolve(artes)) },
    // totalesPorOrden (consultas.ts): groupBy por renglón + mapeo renglón→orden.
    ordenLineaTalla: {
      groupBy: vi.fn(() => Promise.resolve([{ idOrdenLinea: 100, _sum: { cantidad: 1726 } }])),
    },
    ordenLinea: {
      findMany: vi.fn(() => Promise.resolve([{ id: 100, idOrden: 10 }])),
    },
    etapaMovimiento: {
      findMany: vi.fn((args: { where: { tipo: string } }) => {
        if (args.where.tipo === 'corte') {
          return Promise.resolve([
            { idOrden: 10, detalles: [{ cantidad: 1000 }, { cantidad: 500 }] },
            { idOrden: 10, detalles: [{ cantidad: 226 }] },
          ]);
        }
        // Envíos vivos ordenados por folio asc: costura a 2 maquileros + aplicación a 1.
        return Promise.resolve([
          {
            idOrden: 10,
            idTercero: 7,
            tercero: { nombre: 'Óscar Jiménez' },
            tipoProceso: { generaEntradaPt: true },
          },
          {
            idOrden: 10,
            idTercero: 8,
            tercero: { nombre: 'Rima Textil' },
            tipoProceso: { generaEntradaPt: true },
          },
          {
            idOrden: 10,
            idTercero: 9,
            tercero: { nombre: 'Estampados Rico' },
            tipoProceso: { generaEntradaPt: false },
          },
        ]);
      }),
    },
    // OC de tela ordenadas por idOrdenCompra DESC: la primera (más reciente) gana.
    ordenCompraLinea: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { idOrden: 10, idOrdenCompra: 52, ordenCompra: { numCompra: 7654n } },
          { idOrden: 10, idOrdenCompra: 40, ordenCompra: { numCompra: 7600n } },
        ]),
      ),
    },
    $queryRaw: vi.fn(() => Promise.resolve([])),
  };
  const bd: ContextoBd = { tx: tx as unknown as Tx };
  return { bd, tx };
}

describe('centro de comando — permisos y validación (A4/A1)', () => {
  it('sin ordenes.ver → ErrorPermiso', async () => {
    await expect(centroComandoOrdenes(sesionDePrueba({ permisos: [] }), {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('mesEntrega fuera de rango → ErrorValidacion', async () => {
    await expect(centroComandoOrdenes(sesionVer(), { mesEntrega: 13 })).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});

describe('centro de comando — A9 (empresa activa manda)', () => {
  it('idEmpresa distinto de la activa → página VACÍA sin tocar la base', async () => {
    const { bd, tx } = bdStub();
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, { idEmpresa: 99 }, bd);
    expect(pagina.datos).toEqual([]);
    expect(pagina.total).toBe(0);
    expect(tx.orden.count).not.toHaveBeenCalled();
    expect(tx.orden.findMany).not.toHaveBeenCalled();
  });
});

describe('centro de comando — proyección de las 13 columnas (agregado por lote)', () => {
  it('deriva cortada (Σ cortes), maquilero del PRIMER envío costura, ×N, estampador, OC y mes', async () => {
    const { bd } = bdStub();
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    expect(pagina.total).toBe(1);
    const fila = pagina.datos[0];
    expect(fila).toBeDefined();
    if (fila === undefined) return;

    expect(fila.folio).toBe(5424);
    expect(fila.empresa).toBe('FR Moda');
    expect(fila.codigoModelo).toBe('62182');
    expect(fila.pedidoCliente).toBe('613609'); // primera referencia D7
    expect(fila.cantOrdenada).toBe(1726); // Σ matriz
    expect(fila.cantCortada).toBe(1726); // Σ de los 2 cortes vivos (1000+500+226)
    // Al que SE MANDÓ: primer envío de costura vivo (no el asignado del encabezado).
    expect(fila.maquilero).toBe('Óscar Jiménez');
    expect(fila.idMaquilero).toBe(7);
    expect(fila.numMaquileros).toBe(2); // badge ×2
    expect(fila.estampador).toBe('Estampados Rico');
    expect(fila.folioPedido).toBe(1485); // el "-F"
    expect(fila.idPedido).toBe(9);
    expect(fila.ocTelaFolio).toBe(7654); // la OC de tela más reciente
    expect(fila.idOcTela).toBe(52);
    expect(fila.mesEntrega).toBe(7); // julio (de fechaEntrega)
    expect(fila.fechaEntrega).toBe('2026-07-04');
    expect(fila.cliente).toBe('C&A');
    // Transparencia del estado: la orden del stub tiene matriz y arte pero su receta NO está
    // liberada por Desarrollo (V1-E3d).
    expect(fila.faltantes).toEqual(['receta']);
  });

  it('faltantes: vacío cuando Desarrollo ya liberó la receta de la orden (V1-E3d)', async () => {
    const { bd } = bdStub({
      filas: [{ ...ordenBase(), recetaLiberadaEn: new Date('2026-08-15T00:00:00Z') }],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    expect(pagina.datos[0]?.faltantes).toEqual([]);
  });

  it('faltantes: una orden CANCELADA no lista requisitos (su estado no lo manda la regla)', async () => {
    const { bd } = bdStub({
      filas: [{ ...ordenBase(), estado: 'cancelada', _count: { lineas: 0, recetaArtes: 0 } }],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, { incluirCanceladas: true }, bd);
    expect(pagina.datos[0]?.faltantes).toEqual([]);
  });

  it('sin envíos ni OC: cae al maquilero ASIGNADO, numMaquileros 0 y ocTela null ("falta")', async () => {
    const { bd, tx } = bdStub();
    tx.etapaMovimiento.findMany.mockImplementation(() => Promise.resolve([]));
    tx.ordenCompraLinea.findMany.mockImplementation(() => Promise.resolve([]));
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    const fila = pagina.datos[0];
    if (fila === undefined) throw new Error('fila esperada');
    expect(fila.maquilero).toBe('Asignado SA');
    expect(fila.idMaquilero).toBe(77);
    expect(fila.numMaquileros).toBe(0);
    expect(fila.estampador).toBeNull();
    expect(fila.cantCortada).toBe(0);
    expect(fila.ocTelaFolio).toBeNull();
    expect(fila.idOcTela).toBeNull();
  });
});

/**
 * ⭐⭐ fila 0.068 (a) — **EL AVISO DE LA OP QUE SE DESVÍA DEL GRUPO, EN LA FAMILIA.**
 *
 * El Centro es la única pantalla que enseña juntas todas las OP de un modelo, así que es donde se
 * reconoce a la que se salió del grupo. El agregado va **por lote de la página**, y eso abre un
 * fallo muy concreto que estos tests cierran: **que el lote le dé a una orden el aviso de OTRA**.
 */
describe('centro de comando — cómo va cada OP frente a sus hermanas (fila 0.068 (a))', () => {
  /** Tres OP del mismo modelo (mismo linaje): dos con 1.5 de tela y la tercera con 2. */
  function familiaDeTres() {
    const filas = [10, 11, 12].map((id) => ({
      ...ordenBase(),
      id,
      folio: BigInt(5400 + id),
    }));
    return bdStub({
      filas,
      telas: [telaCongelada(10, 7, 1.5), telaCongelada(11, 7, 1.5), telaCongelada(12, 7, 2)],
    });
  }

  it('marca SÓLO a la que se desvía, y el aviso dice QUÉ lleva distinto', async () => {
    const { bd } = familiaDeTres();
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    expect(porId.get(12)?.aviso).toContain('no va igual que sus 2 hermanas');
    expect(porId.get(12)?.aviso).toContain('Jersey');
    expect(porId.get(12)?.diferencias[0]?.detalle).toBe(
      '«Jersey»: esta OP lleva 2 · OP 5410, 5411 llevan 1.5.',
    );
    expect(porId.get(12)?.hermanas).toBe(2);
  });

  it('🔴 CONTROL NEGATIVO: las dos que van igual quedan LIMPIAS (el lote no les pasa el aviso ajeno)', async () => {
    const { bd } = familiaDeTres();
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    for (const id of [10, 11]) {
      expect(porId.get(id)?.aviso).toBeNull();
      expect(porId.get(id)?.diferencias).toEqual([]);
      // Pero sí saben que tienen grupo: el silencio no es «no hay hermanas».
      expect(porId.get(id)?.hermanas).toBe(2);
    }
  });

  it('🔴 el aviso viaja por ID, no por POSICIÓN: reordenar la página no lo mueve de fila', async () => {
    // El fallo que esto caza: leer el agregado por índice (`avisos[i]`) en vez de por `fila.id`.
    // Con la página al revés, un lote posicional le pondría el aviso de la 12 a la 10.
    const filas = [12, 11, 10].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      telas: [telaCongelada(10, 7, 1.5), telaCongelada(11, 7, 1.5), telaCongelada(12, 7, 2)],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    expect(pagina.datos[0]?.id).toBe(12);
    expect(pagina.datos[0]?.frenteAlGrupo.aviso).not.toBeNull();
    expect(pagina.datos[2]?.id).toBe(10);
    expect(pagina.datos[2]?.frenteAlGrupo.aviso).toBeNull();
  });

  it('compara contra TODA la familia, no sólo contra lo que cabe en la página', async () => {
    // La página trae UNA orden; sus dos hermanas están fuera. Si la comparación se limitara a la
    // página, esta OP se vería sola y el aviso nunca saldría — que es el caso real de una búsqueda.
    const { bd } = bdStub({
      filas: [{ ...ordenBase(), id: 12, folio: 5412n }],
      familia: [
        { id: 10, folio: 5410n, idModelo: 3 },
        { id: 11, folio: 5411n, idModelo: 3 },
        { id: 12, folio: 5412n, idModelo: 3 },
      ],
      telas: [telaCongelada(10, 7, 1.5), telaCongelada(11, 7, 1.5), telaCongelada(12, 7, 2)],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    expect(pagina.datos).toHaveLength(1);
    expect(pagina.datos[0]?.frenteAlGrupo.hermanas).toBe(2);
    expect(pagina.datos[0]?.frenteAlGrupo.aviso).toContain('no va igual que sus 2 hermanas');
    // Y NO se publica el resto de la familia: se cargó para comparar, no para enseñarla.
    expect(pagina.datos.map((f) => f.id)).toEqual([12]);
  });

  it('⭐ la LÁPIDA (el renglón excluido) cuenta como «no lo lleva», no como que lo lleva', async () => {
    // El caso de la jareta: la 12 tiene el renglón, pero EXCLUIDO ⇒ esta OP no lo lleva.
    const filas = [10, 11, 12].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      telas: [
        telaCongelada(10, 7, 1.5),
        telaCongelada(11, 7, 1.5),
        telaCongelada(12, 7, 1.5, { excluido: true }),
      ],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);

    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    expect(porId.get(12)?.diferencias[0]).toMatchObject({ que: 'no-la-lleva', material: 'Jersey' });
    expect(porId.get(12)?.diferencias[0]?.detalle).toBe(
      '«Jersey»: esta OP no lo lleva · OP 5410, 5411 llevan 1.5.',
    );
    // 🔴 Y la lápida NO la saca del grupo: la orden SÍ tiene receta congelada, sólo que vacía.
    expect(porId.get(12)?.hermanas).toBe(2);
    expect(porId.get(12)?.fueraDeLaComparacion).toBe(0);
    // Las otras dos siguen limpias.
    expect(porId.get(10)?.aviso).toBeNull();
    expect(porId.get(11)?.aviso).toBeNull();
  });

  it('⭐ la lápida de un AVÍO también cuenta como «no lo lleva» (gemela de la tela)', async () => {
    const filas = [10, 11, 12].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      avios: [
        avioCongelado(10, 3, 2),
        avioCongelado(11, 3, 2),
        avioCongelado(12, 3, 2, { excluido: true }),
      ],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    expect(porId.get(12)?.diferencias[0]).toMatchObject({ tipo: 'avio', que: 'no-la-lleva' });
    expect(porId.get(10)?.aviso).toBeNull();
  });

  it('⭐ la lápida de un ARTE también cuenta (la TERCERA gemela)', async () => {
    const filas = [10, 11, 12].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      artes: [
        arteCongelado(10, 'Bordado pecho', { idModeloArte: 4 }),
        arteCongelado(11, 'Bordado pecho', { idModeloArte: 4 }),
        arteCongelado(12, 'Bordado pecho', { idModeloArte: 4, excluido: true }),
      ],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    expect(porId.get(12)?.diferencias[0]).toMatchObject({ tipo: 'arte', que: 'no-la-lleva' });
    expect(porId.get(12)?.diferencias[0]?.detalle).toBe(
      '«Bordado pecho»: esta OP no lo lleva · OP 5410, 5411 lo llevan.',
    );
    expect(porId.get(10)?.aviso).toBeNull();
  });

  it('⭐ el arte AGREGADO A MANO se identifica por su descripción, no todos por igual', async () => {
    // Dos artes escritos distinto son DOS artes: si todos los agregados a mano compartieran clave,
    // estas dos OP se verían iguales y la diferencia real se perdería.
    const filas = [10, 11].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      artes: [arteCongelado(10, 'Etiqueta especial'), arteCongelado(11, 'Bordado manga')],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    // Empate 1-1 en cada arte ⇒ no hay norma y las dos avisan, nombrando los DOS artes.
    expect(porId.get(10)?.aviso).toContain('Etiqueta especial');
    expect(porId.get(10)?.aviso).toContain('Bordado manga');
    expect(porId.get(11)?.aviso).toContain('Etiqueta especial');
  });

  it('🔴 CONTROL NEGATIVO: el mismo arte a mano escrito con otras mayúsculas/espacios es el MISMO', async () => {
    const filas = [10, 11].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      artes: [arteCongelado(10, 'Etiqueta especial'), arteCongelado(11, '  ETIQUETA   Especial ')],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    for (const f of pagina.datos) expect(f.frenteAlGrupo.aviso).toBeNull();
  });

  it('🔴🔴 el HISTÓRICO MIGRADO no vota: tres OP del ETL no señalan a la OP nueva', async () => {
    /*
     * El caso que motiva la exclusión, en la pantalla de la familia. Tres OP históricas con la copia
     * del día del ETL (consumo 1.5) y una OP nueva con el consumo que el BOM tiene HOY (2). Si las
     * migradas votaran habría 3-a-1 y la señalada sería **la nueva**, que es la correcta.
     */
    const filas = [10, 11, 12, 13].map((id) => ({
      ...ordenBase(),
      id,
      folio: BigInt(5400 + id),
    }));
    const { bd } = bdStub({
      filas,
      telas: [
        telaCongelada(10, 7, 1.5, { deLaMigracion: true }),
        telaCongelada(11, 7, 1.5, { deLaMigracion: true }),
        telaCongelada(12, 7, 1.5, { deLaMigracion: true }),
        telaCongelada(13, 7, 2),
      ],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));

    expect(porId.get(13)?.aviso).toBeNull();
    expect(porId.get(13)?.hermanas).toBe(0);
    // Y el silencio se EXPLICA: no es que la familia esté conforme, es que no entró.
    expect(porId.get(13)?.fueraDeLaComparacion).toBe(3);
    expect(porId.get(13)?.notaFueraDeLaComparacion).toContain('3 OP del modelo quedaron fuera');
    for (const id of [10, 11, 12]) expect(porId.get(id)?.aviso).toBeNull();
  });

  it('🔴 CONTROL: las MISMAS recetas sin la firma del ETL sí señalan a la nueva', async () => {
    // Prueba que lo único que cambia el resultado es la marca de la migración.
    const filas = [10, 11, 12, 13].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      telas: [
        telaCongelada(10, 7, 1.5),
        telaCongelada(11, 7, 1.5),
        telaCongelada(12, 7, 1.5),
        telaCongelada(13, 7, 2),
      ],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    expect(porId.get(13)?.aviso).not.toBeNull();
    expect(porId.get(13)?.hermanas).toBe(3);
  });

  it('una receta migrada que alguien YA firmó a su nombre vuelve a votar', async () => {
    // Tocar un renglón revoca su firma; volver a firmarlo la pone a nombre de la persona. Desde ahí
    // la receta es una decisión, no una copia del ETL, y tiene que contar.
    const filas = [10, 11].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      telas: [
        { ...telaCongelada(10, 7, 1.5, { deLaMigracion: true }), liberadoPorId: 'usr-daniel' },
        telaCongelada(11, 7, 2),
      ],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    expect(porId.get(10)?.hermanas).toBe(1);
    expect(porId.get(10)?.aviso).not.toBeNull();
  });

  it('⭐⭐ LA JARETA: una lápida DECIDIDA devuelve la OP migrada al grupo', async () => {
    /*
     * `quitarRenglonReceta` deja `excluido: true, estado: 'ajustado'` y **no revoca la firma**. Sin
     * mirar la lápida, los vivos de esa OP seguían siendo todos del backfill y la OP quedaba fuera
     * de la comparación — peor que el caso del cierre café, donde al menos entra.
     */
    const filas = [10, 11].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      telas: [
        // La 10 es migrada y le quitaron el jersey (lápida ajustada, con la firma del backfill).
        telaCongelada(10, 7, 1.5, { deLaMigracion: true, excluido: true, estado: 'ajustado' }),
        telaCongelada(10, 8, 2, { deLaMigracion: true, nombre: 'Rib' }),
        // La 11 la firmó una persona.
        telaCongelada(11, 7, 1.5),
        telaCongelada(11, 8, 2, { nombre: 'Rib' }),
      ],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    /*
     * ⚠️ `hermanas` NO discrimina: cuenta las comparables del grupo y vale 1 esté la 10 dentro o
     * fuera. Lo que separa los dos mundos es que la 10 **produzca diferencias** y que la 11 **no
     * cuente a nadie apartado**.
     */
    expect(porId.get(10)?.diferencias[0]).toMatchObject({ que: 'no-la-lleva', material: 'Jersey' });
    expect(porId.get(11)?.fueraDeLaComparacion).toBe(0);
    expect(porId.get(11)?.diferencias[0]).toMatchObject({ que: 'solo-esta', material: 'Jersey' });
  });

  it('🔴 CONTROL (defensa en profundidad): una lápida SIN `ajustado` no la devuelve', async () => {
    /*
     * Separa «hay una lápida» de «una persona la decidió»: es lo que hace que la prueba de arriba
     * pueda fallar, en vez de pasar por el mero hecho de existir una fila excluida.
     *
     * ⚠️ **El estado que monta NO lo produce el dominio hoy**, y hay que decirlo: enumerados los
     * escritores de `excluido: true`, el único es `quitarRenglonReceta` y siempre pone `ajustado`.
     * Esto fija la DEFENSA —que un escritor futuro de lápidas no entre solo al grupo—, no un caso
     * de la vida real.
     */
    const filas = [10, 11].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      telas: [
        telaCongelada(10, 7, 1.5, { deLaMigracion: true, excluido: true }),
        telaCongelada(10, 8, 2, { deLaMigracion: true, nombre: 'Rib' }),
        telaCongelada(11, 7, 1.5),
        telaCongelada(11, 8, 2, { nombre: 'Rib' }),
      ],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    // La 10 sigue APARTADA: ni produce diferencias, ni la 11 tiene con quién compararse.
    expect(porId.get(10)?.diferencias).toEqual([]);
    expect(porId.get(10)?.aviso).toBeNull();
    expect(porId.get(11)?.fueraDeLaComparacion).toBe(1);
    expect(porId.get(11)?.aviso).toBeNull();
  });

  it('🔴 una receta MIXTA (un renglón del ETL y otro que tocó una persona) SÍ vota', async () => {
    // La marca se exige en TODOS los renglones vivos: con «alguno» bastaría un resto del ETL para
    // apartar para siempre una orden que alguien ya curó.
    const filas = [10, 11].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({
      filas,
      telas: [
        telaCongelada(10, 7, 1.5, { deLaMigracion: true }),
        telaCongelada(11, 7, 1.5, { deLaMigracion: true }),
      ],
      // La 10 lleva además un avío que alguien agregó a mano: SIN firma del ETL.
      avios: [avioCongelado(10, 3, 2)],
    });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    /*
     * ⚠️ **QUIÉN DEMUESTRA QUÉ, medido — porque aquí es contraintuitivo.** De las tres cantidades de
     * la 10, **ninguna distingue** que haya vuelto al grupo: `hermanas` vale 0 en los dos mundos
     * (excluye a la propia orden, así que su membresía no mueve su conteo) y `fueraDeLaComparacion`
     * vale 1 en los dos (por `fuera` si está dentro, por `fuera − 1` si está fuera: coinciden).
     *
     * El único discriminador es **`fueraDeLaComparacion` de la 11**: 0 si la 10 entró (queda una
     * sola apartada, ella misma, y no se cuenta) y 1 si no entró. Las tres primeras se dejan como
     * contexto; la que prueba es la última.
     */
    expect(porId.get(10)?.hermanas).toBe(0);
    expect(porId.get(10)?.fueraDeLaComparacion).toBe(1);
    expect(porId.get(10)?.aviso).toBeNull();
    expect(porId.get(11)?.fueraDeLaComparacion).toBe(0);
  });

  it('🔴 CONTROL NEGATIVO: sin NINGUNA fila congelada no se inventa un aviso', async () => {
    // ⚠️ Ojo con la premisa: el ETL **sí** escribe recetas congeladas (por el dominio). Las que se
    // quedan sin ni una fila son las órdenes del viejo **cuyo modelo no tenía BOM** — 2 577 de las
    // ~3 900, según `dominio/produccion/migracion.ts`—, porque su copia sólo pudo nacer vacía.
    // Leer ese hueco como «no lleva nada» encendería un aviso enorme y falso contra cada una.
    const filas = [10, 11].map((id) => ({ ...ordenBase(), id, folio: BigInt(5400 + id) }));
    const { bd } = bdStub({ filas, telas: [] });
    const s = sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });
    const pagina = await centroComandoOrdenes(s, {}, bd);
    for (const fila of pagina.datos) {
      expect(fila.frenteAlGrupo.aviso).toBeNull();
      expect(fila.frenteAlGrupo.hermanas).toBe(0);
    }
  });
});
