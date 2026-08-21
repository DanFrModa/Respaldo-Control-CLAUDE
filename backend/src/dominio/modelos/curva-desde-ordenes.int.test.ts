/**
 * Pruebas del JALÓN DE LA CURVA DESDE LAS ÓRDENES (V1-E3r, §Post-F9.81 punto 3) y del filtro de
 * EMPRESA que lo gobierna (A9).
 *
 * 🔴 **Por qué el fixture monta DOS EMPRESAS.** La función que lee las órdenes de un modelo recibe
 * `idEmpresa` obligatorio y sin default. Con una sola empresa, quitar ese filtro no cambiaría NADA y
 * la prueba pasaría igual: el escenario no puede expresar la fuga. Con dos, la orden de la empresa
 * ajena es la que delata el defecto — y es un defecto serio, porque lo que se propone acaba ESCRITO
 * en el catálogo. (El catálogo de tallas SÍ es global, ADR-0007: lo que no puede ser global es leer
 * las ÓRDENES de otra empresa.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { Empresa, PrismaClient } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { obtenerRecetaOrden } from '../produccion/receta-orden.js';
import { curvaQueCubreExactamente } from '../catalogos/curvas-de-la-orden.js';
import { obtenerMedidasAvio } from './medidas-avio-talla.js';
import { obtenerFichaModelo } from './bom-modelo.js';
import { asignarCurvaDesdeOrdenes, curvasSugeridasDelModelo } from './curva-desde-ordenes.js';

let cliente: PrismaClient;
let empresaA: Empresa;
let empresaB: Empresa;
let idModelo: number;
let idCliente: number;
let idColor: number;
const talla: Record<string, number> = {};

const PERM: ClavePermiso[] = [
  'modelos.ver',
  'modelos.administrar',
  'tallas.ver',
  'tallas.administrar',
];

const bd = () => ({ cliente });

function sesion(permisos: ClavePermiso[] = PERM, idEmpresaActiva = empresaA.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

/** Crea una orden del modelo con la matriz color×talla dada (una talla por renglón). */
async function crearOrden(
  folio: bigint,
  etiquetas: string[],
  opciones: { idEmpresa?: number; estado?: 'capturada' | 'cancelada' } = {},
): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: opciones.idEmpresa ?? empresaA.id,
      idModelo,
      idCliente,
      estado: opciones.estado ?? 'capturada',
      lineas: {
        create: [
          {
            idColor,
            tallas: {
              create: etiquetas.map((e) => ({ idTalla: talla[e] ?? 0, cantidad: 10 })),
            },
          },
        ],
      },
    },
  });
  return orden.id;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresaA = await crearEmpresaPrueba(cliente, 'FR Moda');
  empresaB = await crearEmpresaPrueba(cliente, 'Otra Empresa');
  idCliente = (await cliente.cliente.create({ data: { nombre: 'C&A' } })).id;
  idColor = (await cliente.color.create({ data: { nombre: 'Rojo' } })).id;
  for (const [etiqueta, orden] of [
    ['CH', 1040],
    ['M', 1050],
    ['G', 1060],
    ['EX', 1070],
    ['3M', 3],
    ['6M', 6],
    ['9M', 9],
  ] as const) {
    talla[etiqueta] = (await cliente.talla.create({ data: { etiqueta, orden } })).id;
  }
  idModelo = (await cliente.modelo.create({ data: { codigo: 'MOD-1', descripcion: 'Playera' } }))
    .id;
});

describe('curvasSugeridasDelModelo (§Post-F9.81 punto 3)', () => {
  describe('permisos en servidor (§Post-F9.68: esconder Y bloquear)', () => {
    it('sin `modelos.ver` no se pueden ni consultar', async () => {
      await expect(curvasSugeridasDelModelo(sesion([]), idModelo, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });

    it('sin `modelos.administrar` no se puede asignar (aunque se pueda ver)', async () => {
      await crearOrden(1n, ['CH', 'M', 'G']);
      await expect(
        asignarCurvaDesdeOrdenes(sesion(['modelos.ver']), idModelo, [talla.CH ?? 0], bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
    });
  });

  it('sin órdenes no propone nada', async () => {
    const s = await curvasSugeridasDelModelo(sesion(), idModelo, bd());
    expect(s.yaTieneCurva).toBe(false);
    expect(s.sugerencias).toEqual([]);
  });

  it('propone la curva de la OP, con sus tallas EN ORDEN canónico', async () => {
    // La matriz se captura en desorden a propósito: la propuesta debe salir ordenada.
    await crearOrden(1n, ['G', 'CH', 'M']);
    const s = await curvasSugeridasDelModelo(sesion(), idModelo, bd());
    expect(s.sugerencias).toHaveLength(1);
    expect(s.sugerencias[0]?.etiquetas).toEqual(['CH', 'M', 'G']);
    expect(s.sugerencias[0]?.ordenes).toBe(1);
    expect(s.sugerencias[0]?.folios).toEqual([1]);
  });

  /*
   * ⚠️ El caso que hace valer la decisión: si varias OP usan curvas distintas se enseñan TODAS. Una
   * regla de desempate inventada ("la más reciente") fallaría EN SILENCIO justo aquí — y aquí es
   * exactamente donde Daniel se topó con el problema (un modelo de bebés con receta de caballero).
   */
  it('si varias OP usan curvas DISTINTAS, las enseña TODAS con cuántas OP usa cada una', async () => {
    await crearOrden(1n, ['CH', 'M', 'G']);
    await crearOrden(2n, ['CH', 'M', 'G']);
    await crearOrden(3n, ['3M', '6M', '9M']);

    const s = await curvasSugeridasDelModelo(sesion(), idModelo, bd());
    expect(s.sugerencias).toHaveLength(2);
    expect(s.sugerencias.map((x) => x.etiquetas)).toEqual([
      ['CH', 'M', 'G'],
      ['3M', '6M', '9M'],
    ]);
    expect(s.sugerencias.map((x) => x.ordenes)).toEqual([2, 1]);
  });

  it('las órdenes CANCELADAS no proponen nada (sus tallas no comprometen a nadie)', async () => {
    await crearOrden(1n, ['3M', '6M', '9M'], { estado: 'cancelada' });
    const s = await curvasSugeridasDelModelo(sesion(), idModelo, bd());
    expect(s.sugerencias).toEqual([]);
  });

  it('si el modelo YA tiene curva no propone nada (esta puerta sólo llena huecos)', async () => {
    await crearOrden(1n, ['CH', 'M', 'G']);
    const curva = await cliente.curvaTalla.create({
      data: { nombre: 'Dama', items: { create: [{ idTalla: talla.CH ?? 0, posicion: 0 }] } },
    });
    await cliente.modelo.update({
      where: { id: idModelo },
      data: { idCurvaTalla: curva.id },
    });

    const s = await curvasSugeridasDelModelo(sesion(), idModelo, bd());
    expect(s.yaTieneCurva).toBe(true);
    expect(s.sugerencias).toEqual([]);
  });

  // 🔴 A9 — LA FUGA DE EMPRESA. Necesita DOS empresas para poder expresarse.
  describe('A9 — las órdenes de OTRA empresa no cuentan', () => {
    it('una OP de la empresa B no se le propone a quien mira desde la A', async () => {
      await crearOrden(1n, ['3M', '6M', '9M'], { idEmpresa: empresaB.id });

      const desdeA = await curvasSugeridasDelModelo(sesion(PERM, empresaA.id), idModelo, bd());
      expect(desdeA.sugerencias).toEqual([]);

      // Y desde B sí se ve: la orden existe, lo que no existe es el derecho a verla desde A.
      const desdeB = await curvasSugeridasDelModelo(sesion(PERM, empresaB.id), idModelo, bd());
      expect(desdeB.sugerencias.map((x) => x.etiquetas)).toEqual([['3M', '6M', '9M']]);
    });

    it('con órdenes en las dos empresas, cada una ve SÓLO la suya', async () => {
      await crearOrden(1n, ['CH', 'M', 'G'], { idEmpresa: empresaA.id });
      await crearOrden(2n, ['3M', '6M', '9M'], { idEmpresa: empresaB.id });

      const desdeA = await curvasSugeridasDelModelo(sesion(PERM, empresaA.id), idModelo, bd());
      expect(desdeA.sugerencias.map((x) => x.etiquetas)).toEqual([['CH', 'M', 'G']]);

      const desdeB = await curvasSugeridasDelModelo(sesion(PERM, empresaB.id), idModelo, bd());
      expect(desdeB.sugerencias.map((x) => x.etiquetas)).toEqual([['3M', '6M', '9M']]);
    });

    it('y la ASIGNACIÓN re-valida con la empresa de la sesión, no con lo que mande el cliente', async () => {
      await crearOrden(1n, ['3M', '6M', '9M'], { idEmpresa: empresaB.id });
      const idsDeB = [talla['3M'] ?? 0, talla['6M'] ?? 0, talla['9M'] ?? 0];

      // Desde A, ese conjunto NO es una propuesta válida aunque exista en la base.
      await expect(
        asignarCurvaDesdeOrdenes(sesion(PERM, empresaA.id), idModelo, idsDeB, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);

      const sinCurva = await cliente.modelo.findUniqueOrThrow({ where: { id: idModelo } });
      expect(sinCurva.idCurvaTalla).toBeNull();
    });

    it('la FICHA del modelo tampoco avisa con órdenes de otra empresa', async () => {
      const curva = await cliente.curvaTalla.create({
        data: {
          nombre: 'Caballero',
          items: {
            create: [
              { idTalla: talla.CH ?? 0, posicion: 0 },
              { idTalla: talla.M ?? 0, posicion: 1 },
            ],
          },
        },
      });
      await cliente.modelo.update({ where: { id: idModelo }, data: { idCurvaTalla: curva.id } });
      await crearOrden(1n, ['3M', '6M', '9M'], { idEmpresa: empresaB.id });

      const desdeA = await obtenerFichaModelo(sesion(PERM, empresaA.id), idModelo, bd());
      expect(desdeA.avisosCurva).toEqual([]);

      const desdeB = await obtenerFichaModelo(sesion(PERM, empresaB.id), idModelo, bd());
      expect(desdeB.avisosCurva).toHaveLength(1);
      expect(desdeB.avisosCurva[0]).toContain('Caballero');
    });
  });
});

describe('asignarCurvaDesdeOrdenes — se propone, la persona confirma', () => {
  it('crea la curva en el catálogo y se la asigna al modelo', async () => {
    await crearOrden(1n, ['CH', 'M', 'G']);
    const ids = [talla.CH ?? 0, talla.M ?? 0, talla.G ?? 0];

    const resultado = await asignarCurvaDesdeOrdenes(sesion(), idModelo, ids, bd());
    expect(resultado.curvaCreada).toBe(true);
    expect(resultado.etiquetas).toEqual(['CH', 'M', 'G']);
    expect(resultado.nombreCurva).toBe('Curva CH-M-G');

    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id: idModelo } });
    expect(modelo.idCurvaTalla).toBe(resultado.idCurvaTalla);

    // La curva la creó `crearCurva`, su módulo dueño: sus reglas SIGUEN puestas.
    const items = await cliente.curvaTallaItem.findMany({
      where: { idCurva: resultado.idCurvaTalla },
      orderBy: { posicion: 'asc' },
    });
    expect(items.map((i) => i.posicion)).toEqual([0, 1, 2]); // posiciones 0-based
    expect(items.every((i) => i.creadoPorId !== null)).toBe(true); // `creadoPorId` en los items
  });

  it('deja constancia en la bitácora (A7, D3: el catálogo no cambia en silencio)', async () => {
    await crearOrden(1n, ['CH', 'M', 'G']);
    await asignarCurvaDesdeOrdenes(
      sesion(),
      idModelo,
      [talla.CH ?? 0, talla.M ?? 0, talla.G ?? 0],
      bd(),
    );
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Modelo', idEntidad: String(idModelo), accion: 'MODIFICAR' },
    });
    expect(JSON.stringify(bitacora?.datos)).toContain('curva-jalada-de-las-ordenes');
  });

  it('REUSA la curva del catálogo cuando ya existe una con exactamente esas tallas', async () => {
    await crearOrden(1n, ['CH', 'M', 'G']);
    const existente = await cliente.curvaTalla.create({
      data: {
        nombre: 'Dama básica',
        items: {
          create: [
            { idTalla: talla.CH ?? 0, posicion: 0 },
            { idTalla: talla.M ?? 0, posicion: 1 },
            { idTalla: talla.G ?? 0, posicion: 2 },
          ],
        },
      },
    });

    const resultado = await asignarCurvaDesdeOrdenes(
      sesion(),
      idModelo,
      [talla.CH ?? 0, talla.M ?? 0, talla.G ?? 0],
      bd(),
    );
    expect(resultado.curvaCreada).toBe(false);
    expect(resultado.idCurvaTalla).toBe(existente.id);
    expect(await cliente.curvaTalla.count()).toBe(1);
  });

  /*
   * ⚠️ El nombre determinista puede chocar con una curva de OTRAS tallas que se llame igual. Antes
   * eso reventaba con un P2002 (un 500 en la cara de quien sólo confirmó una propuesta); ahora se
   * desambigua, y la unicidad la sigue defendiendo `crearCurva`.
   */
  it('si el nombre determinista ya está tomado por OTRA curva, desambigua en vez de reventar', async () => {
    await crearOrden(1n, ['CH', 'M', 'G']);
    await cliente.curvaTalla.create({
      data: {
        nombre: 'Curva CH-M-G',
        items: { create: [{ idTalla: talla.EX ?? 0, posicion: 0 }] },
      },
    });

    const resultado = await asignarCurvaDesdeOrdenes(
      sesion(),
      idModelo,
      [talla.CH ?? 0, talla.M ?? 0, talla.G ?? 0],
      bd(),
    );
    expect(resultado.curvaCreada).toBe(true);
    expect(resultado.nombreCurva).toBe('Curva CH-M-G (2)');
  });

  describe('la puerta SÓLO llena huecos', () => {
    it('rechaza si el modelo YA tiene curva → ErrorConflicto', async () => {
      await crearOrden(1n, ['CH', 'M', 'G']);
      const curva = await cliente.curvaTalla.create({
        data: { nombre: 'Ya tiene', items: { create: [{ idTalla: talla.EX ?? 0, posicion: 0 }] } },
      });
      await cliente.modelo.update({ where: { id: idModelo }, data: { idCurvaTalla: curva.id } });

      await expect(
        asignarCurvaDesdeOrdenes(
          sesion(),
          idModelo,
          [talla.CH ?? 0, talla.M ?? 0, talla.G ?? 0],
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorConflicto);

      const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id: idModelo } });
      expect(modelo.idCurvaTalla).toBe(curva.id);
    });

    it('rechaza un conjunto que NO es ninguno de los propuestos (no se inyectan tallas)', async () => {
      await crearOrden(1n, ['CH', 'M', 'G']);
      await expect(
        asignarCurvaDesdeOrdenes(sesion(), idModelo, [talla.EX ?? 0], bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.curvaTalla.count()).toBe(0);
    });

    it('rechaza un SUPERCONJUNTO de un propuesto (colar una talla de más)', async () => {
      await crearOrden(1n, ['CH', 'M', 'G']);
      await expect(
        asignarCurvaDesdeOrdenes(
          sesion(),
          idModelo,
          [talla.CH ?? 0, talla.M ?? 0, talla.G ?? 0, talla.EX ?? 0],
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza un SUBCONJUNTO de un propuesto', async () => {
      await crearOrden(1n, ['CH', 'M', 'G']);
      await expect(
        asignarCurvaDesdeOrdenes(sesion(), idModelo, [talla.CH ?? 0, talla.M ?? 0], bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('acepta el conjunto propuesto aunque venga en otro orden (es un CONJUNTO)', async () => {
      await crearOrden(1n, ['CH', 'M', 'G']);
      const resultado = await asignarCurvaDesdeOrdenes(
        sesion(),
        idModelo,
        [talla.G ?? 0, talla.CH ?? 0, talla.M ?? 0],
        bd(),
      );
      // Y la curva se crea en el orden CANÓNICO, no en el que mandó el cliente.
      expect(resultado.etiquetas).toEqual(['CH', 'M', 'G']);
    });
  });
});

/*
 * 🔴 LA GUARDA DE EXACTITUD. La búsqueda compara la FIRMA COMPLETA del conjunto (los ids ordenados),
 * no el conteo ni un filtro parcial en la base: una curva con parte del conjunto tiene otra firma,
 * una con las mismas tallas más una de sobra también, y una curva de CERO items nunca llega (ni la
 * trae el `some`, ni su firma vacía puede coincidir con un conjunto pedido).
 *
 * ⚠️ El fixture incluye a propósito una curva de CERO items porque la implementación obvia —
 * `items: { every: { idTalla: { in: … } } }`— es una TRAMPA: `every` en Prisma es *vacuously true*
 * para una relación vacía, así que una curva sin tallas "cumpliría" cubrir cualquier conjunto. Con
 * una curva de tres tallas ese defecto pasaría vivo; con la vacía, no.
 */
describe('curvaQueCubreExactamente — la guarda de exactitud', () => {
  it('NO devuelve una curva de CERO items (la trampa del `every` vacuously true)', async () => {
    await cliente.curvaTalla.create({ data: { nombre: 'Vacía' } });

    const encontrada = await curvaQueCubreExactamente(cliente, [talla.CH ?? 0, talla.M ?? 0]);
    expect(encontrada).toBeNull();
  });

  it('NO devuelve una curva que sólo cubre PARTE del conjunto', async () => {
    await cliente.curvaTalla.create({
      data: { nombre: 'Sólo CH', items: { create: [{ idTalla: talla.CH ?? 0, posicion: 0 }] } },
    });
    expect(await curvaQueCubreExactamente(cliente, [talla.CH ?? 0, talla.M ?? 0])).toBeNull();
  });

  it('NO devuelve una curva con las MISMAS tallas más una de sobra', async () => {
    await cliente.curvaTalla.create({
      data: {
        nombre: 'CH-M-G',
        items: {
          create: [
            { idTalla: talla.CH ?? 0, posicion: 0 },
            { idTalla: talla.M ?? 0, posicion: 1 },
            { idTalla: talla.G ?? 0, posicion: 2 },
          ],
        },
      },
    });
    expect(await curvaQueCubreExactamente(cliente, [talla.CH ?? 0, talla.M ?? 0])).toBeNull();
  });

  it('sí devuelve la que cubre EXACTAMENTE el conjunto, aun con la vacía de por medio', async () => {
    await cliente.curvaTalla.create({ data: { nombre: 'Vacía' } });
    const buena = await cliente.curvaTalla.create({
      data: {
        nombre: 'CH-M',
        items: {
          create: [
            { idTalla: talla.CH ?? 0, posicion: 0 },
            { idTalla: talla.M ?? 0, posicion: 1 },
          ],
        },
      },
    });
    expect(await curvaQueCubreExactamente(cliente, [talla.M ?? 0, talla.CH ?? 0])).toEqual({
      id: buena.id,
      nombre: 'CH-M',
    });
  });

  /*
   * El camino por LOTE: las sugerencias resuelven el nombre de TODOS los conjuntos en una consulta.
   * Cada uno tiene que recibir el SUYO — si el lote se cruzara, la propuesta enseñaría un nombre que
   * no es el de esas tallas, que es peor que no enseñar ninguno.
   */
  it('con VARIOS conjuntos, cada uno recibe el nombre de SU curva (resolución por lote)', async () => {
    await cliente.curvaTalla.create({ data: { nombre: 'Vacía' } });
    await cliente.curvaTalla.create({
      data: {
        nombre: 'Caballero',
        items: {
          create: [
            { idTalla: talla.CH ?? 0, posicion: 0 },
            { idTalla: talla.M ?? 0, posicion: 1 },
            { idTalla: talla.G ?? 0, posicion: 2 },
          ],
        },
      },
    });
    await crearOrden(1n, ['CH', 'M', 'G']);
    await crearOrden(2n, ['3M', '6M', '9M']);

    const s = await curvasSugeridasDelModelo(sesion(), idModelo, bd());
    const porEtiquetas = new Map(s.sugerencias.map((x) => [x.etiquetas.join('-'), x]));
    expect(porEtiquetas.get('CH-M-G')?.nombre).toBe('Caballero');
    expect(porEtiquetas.get('CH-M-G')?.idCurvaExistente).not.toBeNull();
    // El que NO existe en el catálogo se rotula con el nombre determinista, no con el del otro.
    expect(porEtiquetas.get('3M-6M-9M')?.nombre).toBe('Curva 3M-6M-9M');
    expect(porEtiquetas.get('3M-6M-9M')?.idCurvaExistente).toBeNull();
  });

  it('las curvas DESACTIVADAS no cuentan', async () => {
    await cliente.curvaTalla.create({
      data: {
        nombre: 'Apagada',
        activo: false,
        items: { create: [{ idTalla: talla.CH ?? 0, posicion: 0 }] },
      },
    });
    expect(await curvaQueCubreExactamente(cliente, [talla.CH ?? 0])).toBeNull();
  });
});

/*
 * ⭐ EL AVISO DE CURVA DISTINTA EN SUS TRES SUPERFICIES (§Post-F9.81 punto 2). Daniel lo pidió
 * donde LO ENCONTRÓ —la captura de medidas por talla del avío— y tiene que estar también en la
 * receta de la OP y en la ficha del modelo, que son los otros dos sitios donde se ven las dos
 * curvas a la vez.
 */
describe('el aviso de curva distinta, en las tres superficies', () => {
  /** Deja el modelo con curva de caballero (CH-M-G) y una OP de bebés (3M-6M-9M). */
  async function escenarioDeDaniel(): Promise<number> {
    const curva = await cliente.curvaTalla.create({
      data: {
        nombre: 'Caballero básica',
        items: {
          create: [
            { idTalla: talla.CH ?? 0, posicion: 0 },
            { idTalla: talla.M ?? 0, posicion: 1 },
            { idTalla: talla.G ?? 0, posicion: 2 },
          ],
        },
      },
    });
    await cliente.modelo.update({ where: { id: idModelo }, data: { idCurvaTalla: curva.id } });
    return crearOrden(1n, ['3M', '6M', '9M']);
  }

  it('la RECETA DE LA OP avisa, con las dos curvas y las dos direcciones', async () => {
    const idOrden = await escenarioDeDaniel();
    const receta = await obtenerRecetaOrden(sesion([...PERM, 'ordenes.ver']), idOrden, bd());

    expect(receta.avisoCurva).not.toBeNull();
    expect(receta.avisoCurva).toContain('Caballero básica');
    expect(receta.avisoCurva).toContain('3M, 6M, 9M');
    expect(receta.avisoCurva).toContain('CH, M, G');
    expect(receta.avisoCurva).toContain('No bloquea');
  });

  it('🔴 y NO bloquea: la receta se lee igual de bien (nada lanza)', async () => {
    const idOrden = await escenarioDeDaniel();
    await expect(
      obtenerRecetaOrden(sesion([...PERM, 'ordenes.ver']), idOrden, bd()),
    ).resolves.toBeTruthy();
  });

  it('la CAPTURA DE MEDIDAS POR TALLA del avío avisa (donde Daniel lo encontró)', async () => {
    await escenarioDeDaniel();
    const avio = await cliente.avio.create({
      data: { clave: 'CIE-01', descripcion: 'Cierre', unidad: 'pza', precioReferencia: 5 },
    });
    await cliente.modeloAvio.create({
      data: { idModelo, idAvio: avio.id, consumoPorPrenda: 1, consumoPorTalla: true },
    });

    const medidas = await obtenerMedidasAvio(sesion(), idModelo, avio.id, bd());
    expect(medidas.avisos.some((a) => a.includes('Caballero básica'))).toBe(true);
  });

  it('la FICHA del modelo avisa', async () => {
    await escenarioDeDaniel();
    const ficha = await obtenerFichaModelo(sesion(), idModelo, bd());
    expect(ficha.avisosCurva).toHaveLength(1);
    expect(ficha.avisosCurva[0]).toContain('Caballero básica');
  });

  it('cuando SÍ coinciden, no avisa nada en ninguna de las tres', async () => {
    const curva = await cliente.curvaTalla.create({
      data: {
        nombre: 'Caballero básica',
        items: {
          create: [
            { idTalla: talla.CH ?? 0, posicion: 0 },
            { idTalla: talla.M ?? 0, posicion: 1 },
            { idTalla: talla.G ?? 0, posicion: 2 },
          ],
        },
      },
    });
    await cliente.modelo.update({ where: { id: idModelo }, data: { idCurvaTalla: curva.id } });
    const idOrden = await crearOrden(1n, ['CH', 'M', 'G']);

    const receta = await obtenerRecetaOrden(sesion([...PERM, 'ordenes.ver']), idOrden, bd());
    expect(receta.avisoCurva).toBeNull();
    const ficha = await obtenerFichaModelo(sesion(), idModelo, bd());
    expect(ficha.avisosCurva).toEqual([]);
  });

  it('sin curva en el modelo NO avisa (no hay dos curvas: hay un hueco, y lo llena la propuesta)', async () => {
    const idOrden = await crearOrden(1n, ['3M', '6M', '9M']);
    const receta = await obtenerRecetaOrden(sesion([...PERM, 'ordenes.ver']), idOrden, bd());
    expect(receta.avisoCurva).toBeNull();

    const s = await curvasSugeridasDelModelo(sesion(), idModelo, bd());
    expect(s.sugerencias).toHaveLength(1);
  });

  /*
   * ⚠️ El universo comparado tiene que ser EL MISMO con el que se arma la matriz que el usuario ve
   * debajo. Si el aviso hablara de otro conjunto (la unión de las OP del modelo, por ejemplo),
   * sería una segunda contradicción encima de la primera.
   */
  it('compara contra la matriz de ESTA orden, no contra la de las otras OP del modelo', async () => {
    await escenarioDeDaniel(); // OP 1: 3M-6M-9M
    const idOtra = await crearOrden(2n, ['CH', 'M', 'G']); // OP 2: coincide con la curva

    const receta = await obtenerRecetaOrden(sesion([...PERM, 'ordenes.ver']), idOtra, bd());
    expect(receta.avisoCurva).toBeNull();
  });
});
