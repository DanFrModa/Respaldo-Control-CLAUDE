/**
 * ⭐ 0.227 (§Post-F9.244, etapa 2) — EL PARÁMETRO `cerradas` DE LOS DOS LISTADOS DE ÓRDENES.
 * Postgres efímero (testcontainers en CI; Postgres nativo en local).
 *
 * Lo que se fija, contra la base de verdad:
 *  1. **Sin el parámetro, NADA cambia** (`incluir`): las pantallas de CONSULTA siguen viendo las
 *     cerradas. Es la mitad de la regla de Daniel —*«no quisiera que las órdenes sean invisibles»*— y
 *     la que un default mal puesto rompería en silencio.
 *  2. `ocultar` deja SÓLO las abiertas (lo piden los selectores de captura).
 *  3. `solo` deja SÓLO las cerradas (el aviso de «lo que buscas está cerrado»), y se combina con la
 *     búsqueda: el aviso habla de LO BUSCADO, no de cualquier cerrada.
 *  4. El criterio es `cerradaEn`, no un espejo: una orden REABIERTA vuelve a contar como abierta.
 *  5. Las canceladas siguen fuera por su propio filtro, con cualquier valor de `cerradas`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, Modelo, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { esquemaConsultaOrdenes, esquemaListarOrdenes } from '../../contrato/index.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { cerrarOrden, reabrirOrden } from './cierre-orden.js';
import { consultarOrdenes } from './consultas.js';
import { listarOrdenes } from './ordenes.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let idClienteNegocio: number;
let idPedidoLinea: number;
/** Folios de las órdenes del escenario. */
const ABIERTA = 7001n;
const CERRADA = 7002n;
const REABIERTA = 7003n;
const CANCELADA = 7004n;
const ids = new Map<bigint, number>();

const PERMISOS: ClavePermiso[] = ['ordenes.ver', 'ordenes.cerrar', 'ordenes.reabrir'];
const sesion = (): ReturnType<typeof sesionDePrueba> =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERMISOS });
const bd = (): { cliente: PrismaClient } => ({ cliente });

async function crearOrden(folio: bigint, estado: 'completa' | 'cancelada'): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: empresa.id,
      idPedidoLinea,
      idModelo: modelo.id,
      idCliente: idClienteNegocio,
      estado,
    },
  });
  ids.set(folio, orden.id);
  return orden.id;
}

/** Folios (ordenados) que devuelve cada listado con el `cerradas` dado. */
async function foliosListar(
  parametros: Parameters<typeof listarOrdenes>[1] = {},
): Promise<number[]> {
  const pagina = await listarOrdenes(sesion(), { porPagina: 100, ...parametros }, bd());
  return pagina.datos.map((o) => Number(o.folio)).sort((a, b) => a - b);
}
async function foliosConsulta(
  parametros: Parameters<typeof consultarOrdenes>[1] = {},
): Promise<number[]> {
  const pagina = await consultarOrdenes(sesion(), { porPagina: 100, ...parametros }, bd());
  return pagina.datos.map((o) => Number(o.folio)).sort((a, b) => a - b);
}

/**
 * El `total` de la página (lo que pinta «N resultados» y decide si hay más páginas): tiene que contar
 * con el MISMO filtro que los datos. Se pide con `porPagina: 1` para que no coincida por casualidad
 * con el largo de `datos`.
 */
async function totalListar(parametros: Parameters<typeof listarOrdenes>[1] = {}): Promise<number> {
  return (await listarOrdenes(sesion(), { ...parametros, porPagina: 1 }, bd())).total;
}
async function totalConsulta(
  parametros: Parameters<typeof consultarOrdenes>[1] = {},
): Promise<number> {
  return (await consultarOrdenes(sesion(), { ...parametros, porPagina: 1 }, bd())).total;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  ids.clear();
  empresa = await crearEmpresaPrueba(cliente);
  idClienteNegocio = (await cliente.cliente.create({ data: { nombre: 'Liverpool' } })).id;
  modelo = await cliente.modelo.create({ data: { codigo: 'B-200', descripcion: 'Sudadera' } });
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: idClienteNegocio },
  });
  idPedidoLinea = (
    await cliente.pedidoLinea.create({
      data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 10, precio: 1 },
    })
  ).id;

  await crearOrden(ABIERTA, 'completa');
  const idCerrada = await crearOrden(CERRADA, 'completa');
  const idReabierta = await crearOrden(REABIERTA, 'completa');
  await crearOrden(CANCELADA, 'cancelada');

  // Por el acto REAL del dominio (no escribiendo `cerradaEn` a mano): así el filtro se mide contra lo
  // que de verdad deja un cierre y una reapertura.
  await cerrarOrden(sesion(), idCerrada, { motivo: 'ya se entregó' }, bd());
  await cerrarOrden(sesion(), idReabierta, { motivo: 'por error' }, bd());
  await reabrirOrden(sesion(), idReabierta, { motivo: 'faltaba un recibo' }, bd());
});

describe.each([
  ['listarOrdenes (GET /api/ordenes)', foliosListar, totalListar, listarOrdenes],
  ['consultarOrdenes (GET /api/ordenes/consulta)', foliosConsulta, totalConsulta, consultarOrdenes],
] as const)('%s — parámetro `cerradas`', (_nombre, folios, total, listado) => {
  it('el `total` cuenta con el MISMO filtro que los datos (incluir / ocultar / solo)', async () => {
    expect(await total()).toBe(3);
    expect(await total({ cerradas: 'incluir' })).toBe(3);
    expect(await total({ cerradas: 'ocultar' })).toBe(2);
    expect(await total({ cerradas: 'solo' })).toBe(1);
    expect(await total({ cerradas: 'solo', busqueda: '7001' })).toBe(0);
  });

  it('A9: `solo` no trae las cerradas de OTRA empresa (ni en datos ni en el total)', async () => {
    // Una cerrada en otra empresa, con el folio de la que se busca: no debe colarse.
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    const ajena = await cliente.orden.create({
      data: {
        folio: CERRADA,
        idEmpresa: otra.id,
        idPedidoLinea,
        idModelo: modelo.id,
        idCliente: idClienteNegocio,
        estado: 'completa',
      },
    });
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERMISOS });
    await cerrarOrden(sesionOtra, ajena.id, { motivo: 'de la otra empresa' }, bd());

    const pagina = await listado(sesion(), { cerradas: 'solo', porPagina: 100 }, bd());
    expect(pagina.datos.map((o) => o.id)).toEqual([ids.get(CERRADA)]);
    expect(pagina.total).toBe(1);
    // Y desde la otra empresa sólo se ve la suya.
    const paginaOtra = await listado(sesionOtra, { cerradas: 'solo', porPagina: 100 }, bd());
    expect(paginaOtra.datos.map((o) => o.id)).toEqual([ajena.id]);
    expect(paginaOtra.total).toBe(1);
  });

  it('SIN el parámetro trae abiertas Y cerradas (la consulta no cambia)', async () => {
    expect(await folios()).toEqual([7001, 7002, 7003]);
  });

  it('`incluir` explícito = lo mismo que no pasarlo', async () => {
    expect(await folios({ cerradas: 'incluir' })).toEqual(await folios());
  });

  it('`ocultar` deja SÓLO las abiertas (la reabierta cuenta como abierta)', async () => {
    expect(await folios({ cerradas: 'ocultar' })).toEqual([7001, 7003]);
  });

  it('`solo` deja SÓLO las cerradas', async () => {
    expect(await folios({ cerradas: 'solo' })).toEqual([7002]);
  });

  it('`solo` respeta la búsqueda: habla de LO BUSCADO, no de cualquier cerrada', async () => {
    expect(await folios({ cerradas: 'solo', busqueda: '7002' })).toEqual([7002]);
    expect(await folios({ cerradas: 'solo', busqueda: '7001' })).toEqual([]);
    // El caso del aviso: buscar la cerrada sin mostrar cerradas no la encuentra…
    expect(await folios({ cerradas: 'ocultar', busqueda: '7002' })).toEqual([]);
  });

  it('las canceladas siguen fuera con cualquier valor (su filtro es otro)', async () => {
    for (const cerradas of ['incluir', 'ocultar', 'solo'] as const) {
      expect(await folios({ cerradas })).not.toContain(7004);
    }
    expect(await folios({ incluirCanceladas: true, cerradas: 'ocultar' })).toEqual([
      7001, 7003, 7004,
    ]);
  });
});

describe('el contrato de la querystring', () => {
  it('los dos listados aceptan `cerradas` desde texto y por default valen `incluir`', () => {
    for (const esquema of [esquemaListarOrdenes, esquemaConsultaOrdenes]) {
      expect(esquema.parse({}).cerradas).toBe('incluir');
      expect(esquema.parse({ cerradas: 'ocultar' }).cerradas).toBe('ocultar');
      expect(esquema.parse({ cerradas: 'solo' }).cerradas).toBe('solo');
      expect(() => esquema.parse({ cerradas: 'todas' })).toThrow();
    }
  });

  it('el valor parseado de la URL viaja tal cual al dominio', async () => {
    const query = esquemaConsultaOrdenes.parse({ cerradas: 'ocultar', porPagina: '100' });
    expect(await foliosConsulta(query)).toEqual([7001, 7003]);
  });
});
