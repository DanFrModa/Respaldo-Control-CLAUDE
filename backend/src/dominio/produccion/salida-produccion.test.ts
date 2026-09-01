/**
 * ⭐⭐ **GENERAR LA OP HACE NACER EL MODELO DE PRODUCCIÓN DE ESE COLOR** (V1-E3, §Post-F9.172(b)) —
 * y lo hace **haya o no haya revisión firmada** (V1-E9c, §Post-F9.169).
 *
 * Este archivo cubre el paso 1 de `salidaAProduccion`: **de qué modelo es la OP**. Son tres ramas y
 * las tres tienen que poder caer por separado:
 *
 *  1. **`nacido`** — el renglón apunta a un modelo de DESARROLLO y ese color todavía no tiene
 *     modelo ⇒ nace uno, con su nº de 5 dígitos, apuntando al desarrollo y **con el color grabado**.
 *  2. **`reusado`** — ese color YA tenía modelo ⇒ se usa el suyo y **no nace nada**. Es la frase de
 *     Daniel (*«se reúsa cuando sea el mismo modelo»*) y, de paso, la ÚNICA idempotencia del camino:
 *     antes de V1-E3 el freno del doble clic era un efecto de borde (la 1ª salida promovía el
 *     modelo), y con el linaje el desarrollo **se queda en desarrollo para siempre**.
 *  3. **`heredado`** — 🔴 **LA RAMA LEGADO**: el renglón ya apunta a un modelo de producción (los
 *     ~4,987 migrados del Access). La OP lo lleva tal cual. Sin ella, `derivarModeloDeProduccion`
 *     lanzaría 409 y **ningún modelo migrado podría producir**.
 *
 * 🔴 **Y la aserción que resume la etapa entera**: la ORDEN se sella con el modelo HIJO
 * (`crearOrden` recibe `idModeloDeLaOrden`), mientras el RENGLÓN del pedido sigue apuntando a su
 * desarrollo — que es de donde salen la receta y el precio.
 *
 * 🔴 **Este bloque decía otra cosa hasta V1-E9c.** V1-E7d lo escribió como *"la puerta lateral"*:
 * aquí se demostraba que una versión sin revisar NO podía generar su OP. Daniel disolvió esa
 * compuerta: *«Todo lo que no está firmado simplemente no se puede comprar. **Pero no detiene ni la
 * producción** ni los demás renglones ya firmados.»* Las pruebas se dieron **vuelta**, no se
 * borraron; V1-E3 las conserva y les cambia el efecto que exigen (antes un `update` que promovía;
 * ahora un `create` que hace nacer).
 *
 * ⚠️ **Qué se dobla y qué NO.** Se mockean los COLABORADORES que no son la regla —`crearOrden`
 * (que abre media base de datos), la liga al desarrollo y el disparo del outbox— y se le pasa al
 * servicio una transacción de mentiras por `bd.tx` (composición A2). La resolución del modelo corre
 * **de verdad**: `obtenerODerivarModeloDeProduccion` y `derivarModeloDeProduccion` son código real
 * leyendo el modelo real del doble.
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

const { colorDeIdentidad, salidaAProduccion } = await import('./salida-produccion.js');

const SESION = sesionDePrueba({ permisos: ['ordenes.administrar'] });

/** Id del modelo HIJO que devuelve el doble cuando el alta lo crea. */
const ID_HIJO = 77;

/** La matriz mínima que el servicio exige (piezas > 0), de UN SOLO color (el caso de C&A). */
const MATRIZ = { lineas: [{ idColor: 3, tallas: [{ idTalla: 9, cantidad: 120 }] }] };

/**
 * Modelo del RENGLÓN tal como lo lee el paso 1. `extra` dice qué lo distingue en cada caso; por
 * defecto es una VERSIÓN de desarrollo sin revisar — el caso que V1-E7d vino a impedir y que
 * V1-E9c volvió a permitir.
 */
function modeloFalso(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    codigo: 'CYA-26-71-001-01',
    codigoDesarrollo: 'CYA-26-71-001-01',
    origen: 'desarrollo',
    activo: true,
    numeroProduccion: null,
    idTipoProducto: 5,
    idGenero: 4,
    idModeloPadre: 7,
    versionDesarrollo: 1,
    idModeloDesarrollo: null,
    revisionEstado: 'pendiente',
    revisadoEn: null,
    revisionNota: null,
    descripcion: 'Playera',
    composicion: null,
    maquilaBase: null,
    corteBase: null,
    idTemporada: null,
    idCurvaTalla: null,
    idMaquileroCotizado: null,
    numOperaciones: null,
    secuenciaEstampado: 'antes',
    llevaArte: true,
    ...extra,
  };
}

/**
 * `tx` de mentiras que REGISTRA cada llamada. Emula lo que recorre el camino completo: el renglón
 * de pedido, el modelo del renglón, el color de la matriz, los dígitos del par, los DOS locks
 * (el del desarrollo y el de la serie), la ocupación de la serie (`$queryRaw` vacío = todo libre),
 * los centinelas y el alta del hijo. No filtra por `where` salvo donde hace falta distinguir; por
 * eso se afirma QUÉ se llamó y qué NO.
 */
function txRegistrador(
  modelo: Record<string, unknown>,
  /** ⭐ V1-E3: el hijo que YA existe para ese (desarrollo, color) — el camino de REUSO. */
  hijoExistente: Record<string, unknown> | null = null,
): {
  tx: Tx;
  llamadas: { metodo: string; args: unknown }[];
} {
  const llamadas: { metodo: string; args: unknown }[] = [];
  const reg = <T>(metodo: string, args: unknown, resultado: T): Promise<T> => {
    llamadas.push({ metodo, args });
    return Promise.resolve(resultado);
  };
  const activo = { nombre: 'X', activo: true };
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
      // Dos llamadas MUY distintas comparten el método: la del paso 1 (el modelo del renglón) y la
      // relectura con `include` del final del alta, que devuelve EL HIJO. Sin distinguirlas, el
      // servicio creería que la OP es del padre y la aserción central no probaría nada.
      findUniqueOrThrow: (args: unknown) =>
        reg(
          'modelo.findUniqueOrThrow',
          args,
          (args as { include?: unknown }).include === undefined
            ? modelo
            : { id: ID_HIJO, codigo: '71001' },
        ),
      findUnique: (args: unknown) => reg('modelo.findUnique', args, modelo),
      // Tres centinelas comparten `findFirst` y se distinguen por su `where` (ver `txDerivacion`
      // en `nomenclatura.test.ts`, misma lección): el hijo del color, el número repetido y el
      // código libre.
      findFirst: (args: unknown) => {
        const donde = (args as { where?: { idModeloDesarrollo?: number } }).where;
        return reg(
          'modelo.findFirst',
          args,
          donde?.idModeloDesarrollo === undefined ? null : hijoExistente,
        );
      },
      create: (args: unknown) => reg('modelo.create', args, { id: ID_HIJO, codigo: '71001' }),
      update: (args: unknown) => reg('modelo.update', args, {}),
    },
    color: {
      findUnique: (args: unknown) => reg('color.findUnique', args, { nombre: 'Rojo' }),
    },
    tipoProducto: {
      findUnique: (args: unknown) =>
        reg('tipoProducto.findUnique', args, {
          nombre: 'Pantalón',
          digitoConcepto: 7,
          activo: true,
        }),
    },
    genero: {
      findUnique: (args: unknown) =>
        reg('genero.findUnique', args, {
          nombre: 'Caballero',
          digitoNomenclatura: 1,
          digitoAlterno: 5,
          activo: true,
        }),
    },
    temporada: { findUnique: (args: unknown) => reg('temporada.findUnique', args, activo) },
    curvaTalla: { findUnique: (args: unknown) => reg('curvaTalla.findUnique', args, activo) },
    proveedor: { findFirst: (args: unknown) => reg('proveedor.findFirst', args, activo) },
    $executeRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$executeRaw', { sql: plantilla.join('?'), valores }, 1),
    $queryRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$queryRaw', { sql: plantilla.join('?'), valores }, []),
    bitacora: { create: (args: unknown) => reg('bitacora.create', args, {}) },
  };
  return { tx: tx as unknown as Tx, llamadas };
}

/** El `data` del `modelo.create`, o `undefined` si no nació nada. */
function datosDelAlta(
  llamadas: { metodo: string; args: unknown }[],
): Record<string, unknown> | undefined {
  const create = llamadas.find((l) => l.metodo === 'modelo.create')?.args as
    | { data: Record<string, unknown> }
    | undefined;
  return create?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  crearOrden.mockResolvedValue({ id: 900, folio: 5558, idCliente: 3 });
  obtenerOrden.mockResolvedValue({ id: 900, folio: 5558, idCliente: 3 });
});

describe('colorDeIdentidad — de qué color es el modelo que nace', () => {
  it('un solo color con piezas: ése es la identidad del modelo', () => {
    expect(colorDeIdentidad([{ idColor: 3, tallas: [{ idTalla: 9, cantidad: 120 }] }])).toBe(3);
  });

  it('⭐ VARIOS colores: null — "el color del que nació" no tiene referente, y el modelo no lleva dos', () => {
    // Es el importador por EXCEL, que agrupa por MODELO: su matriz trae todos los colores en UNA OP.
    expect(
      colorDeIdentidad([
        { idColor: 3, tallas: [{ idTalla: 9, cantidad: 60 }] },
        { idColor: 4, tallas: [{ idTalla: 9, cantidad: 60 }] },
      ]),
    ).toBeNull();
  });

  it('⭐ los colores SIN piezas no cuentan: agregar una fila y vaciarla no cambia qué modelo nace', () => {
    expect(
      colorDeIdentidad([
        { idColor: 3, tallas: [{ idTalla: 9, cantidad: 120 }] },
        { idColor: 4, tallas: [{ idTalla: 9, cantidad: 0 }] },
        { idColor: 5, tallas: [] },
      ]),
    ).toBe(3);
  });

  it('el MISMO color repetido sigue siendo UN color (a la matriz repetida la rebota `sincronizarMatriz`)', () => {
    expect(
      colorDeIdentidad([
        { idColor: 3, tallas: [{ idTalla: 9, cantidad: 60 }] },
        { idColor: 3, tallas: [{ idTalla: 10, cantidad: 60 }] },
      ]),
    ).toBe(3);
  });

  it('matriz entera en ceros: null (y el servicio la rebota antes por "sin piezas")', () => {
    expect(colorDeIdentidad([{ idColor: 3, tallas: [{ idTalla: 9, cantidad: 0 }] }])).toBeNull();
  });
});

describe('salidaAProduccion — NACE el modelo de producción de ese color (V1-E3)', () => {
  /** Genera la OP y comprueba que el modelo del color NACIÓ de verdad (no sólo que no lanzó). */
  async function generaYHaceNacer(modelo: Record<string, unknown>): Promise<void> {
    const { tx, llamadas } = txRegistrador(modelo);
    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });

    expect(salida.numeroProduccion).toBe(71_001);
    expect(salida.modeloDeProduccion).toBe('nacido');
    expect(salida.idModeloProduccion).toBe(ID_HIJO);
    expect(salida.codigoModeloProduccion).toBe('71001');
    expect(salida.idModeloDesarrollo).toBe(42);
    expect(salida.codigoModeloDesarrollo).toBe(modelo.codigo);
    expect(datosDelAlta(llamadas)).toMatchObject({
      origen: 'produccion',
      numeroProduccion: 71_001,
      idModeloDesarrollo: 42,
      idColor: 3,
    });
    // 🔴 Y el desarrollo NO se toca: es lo único que permite que de él salgan cuatro modelos.
    expect(llamadas.filter((l) => l.metodo === 'modelo.update')).toEqual([]);
  }

  it('⭐⭐ la OP de una versión SIN REVISAR se genera, y el modelo del color nace', async () => {
    // 🔴 LA PRUEBA DE V1-E9c, conservada: la orden entra con la receta pendiente de revisar, y lo
    // que se frena renglón por renglón es COMPRAR.
    await generaYHaceNacer(modeloFalso());
  });

  it('⭐ una versión SIN estado de revisión (null) también genera su OP', async () => {
    await generaYHaceNacer(modeloFalso({ revisionEstado: null }));
  });

  it('⭐⭐ una versión RECHAZADA también genera su OP: el rechazo no detiene producir', async () => {
    await generaYHaceNacer(
      modeloFalso({
        revisionEstado: 'rechazada',
        revisadoEn: new Date('2026-08-25T00:00:00.000Z'),
        revisionNota: 'el cierre que se quitó sí costaba',
      }),
    );
  });

  it('una versión APROBADA genera su OP y estrena su número de 5 dígitos, como siempre', async () => {
    await generaYHaceNacer(modeloFalso({ revisionEstado: 'aprobada' }));
  });

  it('⭐ un modelo que NO es versión genera su OP como siempre (conducta intacta)', async () => {
    await generaYHaceNacer(
      modeloFalso({
        codigo: 'CYA-26-71-001',
        codigoDesarrollo: 'CYA-26-71-001',
        idModeloPadre: null,
        versionDesarrollo: null,
        revisionEstado: null,
      }),
    );
  });

  it('🔴 la ORDEN se sella con el modelo HIJO, no con el del renglón', async () => {
    // La aserción que resume la etapa. Sin ella, todo lo demás podría estar bien y la OP seguir
    // saliendo con el modelo de desarrollo — que es justo lo que Daniel encontró en la OP 5558.
    const { tx } = txRegistrador(modeloFalso());
    await salidaAProduccion(SESION, 1, MATRIZ, { tx });

    expect(crearOrden).toHaveBeenCalledTimes(1);
    expect(crearOrden.mock.calls[0]?.[3]).toEqual({ idModeloDeLaOrden: ID_HIJO });
    // Y el renglón del pedido NO se re-apunta: sigue con su desarrollo (de ahí salen receta y precio).
    expect(crearOrden.mock.calls[0]?.[1]).toMatchObject({ idPedidoLinea: 1 });
  });

  it('⭐ el hijo se bautiza con el COLOR para que el catálogo se pueda leer', async () => {
    const { tx, llamadas } = txRegistrador(modeloFalso());
    await salidaAProduccion(SESION, 1, MATRIZ, { tx });
    // Cuatro renglones 71001…71004 con la MISMA descripción heredada serían indistinguibles.
    expect(datosDelAlta(llamadas)).toMatchObject({ descripcion: 'Playera · Rojo' });
  });

  it('⭐ matriz MULTICOLOR: el hijo nace SIN color (y no se inventa uno)', async () => {
    const { tx, llamadas } = txRegistrador(modeloFalso());
    await salidaAProduccion(
      SESION,
      1,
      {
        lineas: [
          { idColor: 3, tallas: [{ idTalla: 9, cantidad: 60 }] },
          { idColor: 4, tallas: [{ idTalla: 9, cantidad: 60 }] },
        ],
      },
      { tx },
    );
    expect(datosDelAlta(llamadas)).toMatchObject({ idColor: null });
    // Sin color que nombrar, la descripción se HEREDA tal cual del padre.
    expect(datosDelAlta(llamadas)).toMatchObject({ descripcion: 'Playera' });
    expect(llamadas.filter((l) => l.metodo === 'color.findUnique')).toEqual([]);
  });
});

describe('salidaAProduccion — REUSA el modelo cuando ese color ya lo tiene (§Post-F9.172(b))', () => {
  const hijoDelColor = { id: 99, codigo: '71007', numeroProduccion: 71_007, activo: true };

  it('⭐⭐ segunda salida del mismo color: la OP lleva el modelo que YA existía y no nace nada', async () => {
    const { tx, llamadas } = txRegistrador(modeloFalso(), hijoDelColor);

    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });

    expect(salida.modeloDeProduccion).toBe('reusado');
    expect(salida.idModeloProduccion).toBe(99);
    expect(salida.numeroProduccion).toBe(71_007);
    expect(salida.codigoModeloProduccion).toBe('71007');
    expect(salida.idModeloDesarrollo).toBe(42);
    // 🔴 La idempotencia: dos clics NO queman dos de los 999 números del par.
    expect(datosDelAlta(llamadas)).toBeUndefined();
    expect(crearOrden.mock.calls[0]?.[3]).toEqual({ idModeloDeLaOrden: 99 });
  });

  it('⭐ el nº capturado que no se pudo usar sale como AVISO (no en silencio, y sin bloquear)', async () => {
    const { tx } = txRegistrador(modeloFalso(), hijoDelColor);
    const salida = await salidaAProduccion(
      SESION,
      1,
      { ...MATRIZ, numeroProduccion: 71_050 },
      { tx },
    );
    expect(salida.numeroProduccion).toBe(71_007);
    expect(salida.avisosNumeroProduccion).toHaveLength(1);
    expect(salida.avisosNumeroProduccion[0]).toContain('71050');
  });
});

describe('salidaAProduccion — 🔴 LA RAMA LEGADO: el modelo YA de producción se hereda', () => {
  it('un modelo ya de producción se lleva a la OP tal cual, sin derivar ni promover', async () => {
    // Los ~4,987 migrados del Access. Sin esta rama, `derivarModeloDeProduccion` lanzaría 409 (exige
    // un padre de DESARROLLO) y NINGUNO de ellos podría generar una OP.
    const { tx, llamadas } = txRegistrador(
      modeloFalso({ origen: 'produccion', codigo: '71001', numeroProduccion: 71_001 }),
    );
    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });

    expect(salida.modeloDeProduccion).toBe('heredado');
    expect(salida.numeroProduccion).toBe(71_001);
    expect(salida.idModeloProduccion).toBe(42);
    expect(salida.codigoModeloProduccion).toBe('71001');
    expect(salida.idModeloDesarrollo).toBeNull();
    expect(salida.codigoModeloDesarrollo).toBeNull();
    expect(datosDelAlta(llamadas)).toBeUndefined();
    // Ni siquiera se toma el lock del linaje: por esta rama no se decide ningún número.
    expect(llamadas.filter((l) => l.metodo === '$executeRaw')).toEqual([]);
    // Y la orden se sella con ESE modelo, el del renglón.
    expect(crearOrden.mock.calls[0]?.[3]).toEqual({ idModeloDeLaOrden: 42 });
  });

  it('modelo histórico de producción SIN número (`M-18`): la OP sale y no se le inventa uno', async () => {
    const { tx } = txRegistrador(
      modeloFalso({ origen: 'produccion', codigo: 'M-18', numeroProduccion: null }),
    );
    const salida = await salidaAProduccion(SESION, 1, MATRIZ, { tx });

    expect(salida.modeloDeProduccion).toBe('heredado');
    expect(salida.numeroProduccion).toBeNull();
    expect(salida.codigoModeloProduccion).toBe('M-18');
  });
});
