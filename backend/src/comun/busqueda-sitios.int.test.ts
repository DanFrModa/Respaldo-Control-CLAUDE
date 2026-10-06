/**
 * ⭐ **Fila 0.214 — «ambar» encuentra «ÁMBAR» en TODA búsqueda de texto, no sólo en los siete
 * typeaheads de catálogo.** Integración contra Postgres real (la extensión `unaccent` es parte de la
 * garantía: sin ella la consulta ni corre).
 *
 * Cubre, uno por FORMA de sitio (los 33 son repeticiones de estas formas):
 *  - **el octavo typeahead**: `SelectorOrden` → `listarOrdenes` → `armarBusqueda` de órdenes, que
 *    busca en TRES tablas vecinas (modelo, cliente, referencias) y se acota por EMPRESA;
 *  - **la caja del Centro de Órdenes** (`busquedaCentro`), con el caso medido de §Post-F9.238(b):
 *    «nino» daba CERO órdenes de «Niño Infantil»;
 *  - **los SINÓNIMOS de departamento**, cuya semilla también se sembraba con el `contains` viejo;
 *  - **una relación que ya es catálogo** (`listarPedidos` por nombre del cliente);
 *  - **un catálogo simple** (`listarTemporadas`);
 *  - **varias cajas que se cruzan** y una tabla vecina uno-a-muchos (el archivo histórico);
 *  - **el barrido de la whitelist**: cada catálogo de `busqueda.ts` corre contra el esquema real
 *    (un nombre de tabla o columna mal escrito sólo se ve aquí — la prueba pura no lo puede ver).
 *
 * Cada caso lleva su GEMELA de lo-que-NO-debe-encontrar: sin ella, un pre-filtro que devolviera
 * "todos los ids" pasaría el caso central sin filtrar nada.
 */
// Credenciales R2 FALSAS: `listarPedidos` construye el servicio de archivos (fotos del modelo)
// aunque aquí ningún modelo tenga fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  Prisma,
  type Cliente,
  type Empresa,
  type Modelo,
  type PrismaClient,
} from '../datos/index.js';
import { listarColores } from '../dominio/catalogos/colores.js';
import { listarHistoricoOrdenes } from '../dominio/consultas/historico-ordenes.js';
import { sinonimosDeDepartamentos } from '../dominio/catalogos/cliente-departamentos-sinonimos.js';
import { listarTemporadas } from '../dominio/catalogos/temporadas.js';
import { listarPedidos } from '../dominio/pedidos/pedidos.js';
import { centroComandoOrdenes } from '../dominio/produccion/centro-comando.js';
import { listarOrdenes } from '../dominio/produccion/ordenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sesionDePrueba } from '../pruebas/sesiones.js';

import {
  CATALOGOS_HABILITADOS,
  catalogoConEmpresa,
  condicionContieneSinAcentos,
  idsPorTextoSinAcentos,
  sqlIdsPorTextoSinAcentos,
} from './busqueda.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;

const bd = () => ({ cliente });
const sesion = (idEmpresaActiva = empresa.id) =>
  sesionDePrueba({
    idEmpresaActiva,
    permisos: ['ordenes.ver', 'pedidos.ver', 'temporadas.ver', 'colores.ver'],
  });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa SA');
});

// ── Fixtures de órdenes ───────────────────────────────────────────────────────────────────────

let clienteOscar: Cliente;
let clienteLiverpool: Cliente;
let modeloSudadera: Modelo;
let modeloPlayera: Modelo;

/** Una orden mínima, con referencias del cliente opcionales (D7). */
async function crearOrden(
  folio: number,
  datos: { modelo: Modelo; cliente: Cliente; referencias?: string[]; idEmpresa?: number },
): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: datos.idEmpresa ?? empresa.id,
      idModelo: datos.modelo.id,
      idCliente: datos.cliente.id,
    },
  });
  for (const [i, valor] of (datos.referencias ?? []).entries()) {
    const campo = await cliente.clienteCampo.create({
      data: { idCliente: datos.cliente.id, etiqueta: `Ref ${folio}-${i}` },
    });
    await cliente.ordenReferencia.create({
      data: { idOrden: orden.id, idClienteCampo: campo.id, valor },
    });
  }
  return orden.id;
}

async function sembrarOrdenes(): Promise<void> {
  clienteOscar = await cliente.cliente.create({ data: { nombre: 'Almacenes Óscar' } });
  clienteLiverpool = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  modeloSudadera = await cliente.modelo.create({
    data: { codigo: 'CAÑA-01', descripcion: 'Sudadera' },
  });
  modeloPlayera = await cliente.modelo.create({
    data: { codigo: '71002', descripcion: 'Playera' },
  });
  // 101: cliente con acento.  102: referencia con ñ (el departamento de la OC).  103: modelo con ñ.
  // 104: nada de eso (la gemela).  901: MISMO texto que 102, pero de OTRA empresa (A9).
  await crearOrden(101, { modelo: modeloPlayera, cliente: clienteOscar });
  await crearOrden(102, {
    modelo: modeloPlayera,
    cliente: clienteLiverpool,
    referencias: ['NIÑO INFANTIL'],
  });
  await crearOrden(103, { modelo: modeloSudadera, cliente: clienteLiverpool });
  await crearOrden(104, {
    modelo: modeloPlayera,
    cliente: clienteLiverpool,
    referencias: ['DAMAS'],
  });
  await crearOrden(901, {
    modelo: modeloPlayera,
    cliente: clienteLiverpool,
    referencias: ['NIÑO INFANTIL'],
    idEmpresa: otraEmpresa.id,
  });
}

/** Folios (como número) de una página de órdenes, ordenados. */
function folios(datos: readonly { folio: string | number | bigint }[]): number[] {
  return datos.map((o) => Number(o.folio)).sort((a, b) => a - b);
}

describe('ÓRDENES — el octavo typeahead (SelectorOrden → listarOrdenes → armarBusqueda)', () => {
  beforeEach(sembrarOrdenes);

  it('⭐ "nino" ENCUENTRA la orden cuya referencia dice «NIÑO INFANTIL»', async () => {
    const pagina = await listarOrdenes(sesion(), { busqueda: 'nino' }, bd());
    expect(folios(pagina.datos)).toEqual([102]);
  });

  it('⭐ "oscar" encuentra por el NOMBRE DEL CLIENTE «Almacenes Óscar»', async () => {
    const pagina = await listarOrdenes(sesion(), { busqueda: 'oscar' }, bd());
    expect(folios(pagina.datos)).toEqual([101]);
  });

  it('⭐ "cana" encuentra por el CÓDIGO DEL MODELO «CAÑA-01»', async () => {
    const pagina = await listarOrdenes(sesion(), { busqueda: 'cana' }, bd());
    expect(folios(pagina.datos)).toEqual([103]);
  });

  it('el FOLIO sigue siendo buscable (es igualdad, se queda en Prisma)', async () => {
    const pagina = await listarOrdenes(sesion(), { busqueda: '104' }, bd());
    expect(folios(pagina.datos)).toEqual([104]);
  });

  it('GEMELA: no arrastra lo que no casa', async () => {
    expect((await listarOrdenes(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
    expect(folios((await listarOrdenes(sesion(), { busqueda: 'damas' }, bd())).datos)).toEqual([
      104,
    ]);
    // "nina" dobla el acento, no adivina la palabra.
    expect((await listarOrdenes(sesion(), { busqueda: 'nina' }, bd())).total).toBe(0);
  });

  it('A9: la orden de OTRA empresa con el mismo texto NO sale', async () => {
    // La 901 dice «NIÑO INFANTIL» igual que la 102, pero es de la otra empresa.
    expect(folios((await listarOrdenes(sesion(), { busqueda: 'nino' }, bd())).datos)).toEqual([
      102,
    ]);
    expect(
      folios((await listarOrdenes(sesion(otraEmpresa.id), { busqueda: 'nino' }, bd())).datos),
    ).toEqual([901]);
  });

  it('A9 EN EL PROPIO PRE-FILTRO: los ids que devuelve son sólo de la empresa pedida', async () => {
    // El `where` del dominio también filtra por empresa, así que la prueba de arriba seguiría verde
    // aunque el pre-filtro olvidara la empresa. Ésta mide el pre-filtro solo.
    const ids = await idsPorTextoSinAcentos(cliente, 'orden', 'nino', { idEmpresa: empresa.id });
    const deLaOtra = await cliente.orden.findFirstOrThrow({ where: { folio: 901n } });
    expect(ids).not.toContain(deLaOtra.id);
    expect(ids).toHaveLength(1);
  });
});

describe('ÓRDENES — la caja del CENTRO (busquedaCentro, §Post-F9.238(b))', () => {
  beforeEach(sembrarOrdenes);

  it('⭐ "nino" en el Centro trae las órdenes de «NIÑO INFANTIL» (antes: CERO)', async () => {
    const pagina = await centroComandoOrdenes(sesion(), { busqueda: 'nino' }, bd());
    expect(folios(pagina.datos)).toEqual([102]);
  });

  it('el código del modelo también, sin acento', async () => {
    const pagina = await centroComandoOrdenes(sesion(), { busqueda: 'cana' }, bd());
    expect(folios(pagina.datos)).toEqual([103]);
  });

  it('GEMELA: el Centro NO busca por nombre de cliente (para eso está su select)', async () => {
    expect((await centroComandoOrdenes(sesion(), { busqueda: 'oscar' }, bd())).total).toBe(0);
    expect((await centroComandoOrdenes(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
  });
});

describe('SINÓNIMOS de departamento — la semilla también sin acentos', () => {
  it('⭐ "nino" siembra «Niño Infantil» y trae al departamento que se fusionó en él', async () => {
    const c = await cliente.cliente.create({ data: { nombre: 'Coppel' } });
    const canonico = await cliente.clienteDepartamento.create({
      data: { idCliente: c.id, nombre: 'Niño Infantil' },
    });
    await cliente.clienteDepartamento.create({
      data: { idCliente: c.id, nombre: '4-KIDS', idFusionadoEn: canonico.id },
    });
    // La semilla («Niño Infantil») no se devuelve: la búsqueda de texto ya la encuentra sola.
    expect(await sinonimosDeDepartamentos('nino', bd())).toEqual(['4-KIDS']);
    // Y al revés: el nombre viejo trae al canónico, CON su acento intacto (es nombre exacto).
    expect(await sinonimosDeDepartamentos('4-kids', bd())).toEqual(['Niño Infantil']);
    // GEMELA: sin coincidencia no hay sinónimos.
    expect(await sinonimosDeDepartamentos('nina', bd())).toEqual([]);
  });
});

describe('PEDIDOS — el nombre del cliente es un CATÁLOGO (se compone por idCliente)', () => {
  it('⭐ "oscar" encuentra los pedidos de «Almacenes Óscar»; el folio sigue', async () => {
    const oscar = await cliente.cliente.create({ data: { nombre: 'Almacenes Óscar' } });
    const otro = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
    await cliente.pedido.create({
      data: { folio: 1n, idEmpresa: empresa.id, idCliente: oscar.id },
    });
    await cliente.pedido.create({ data: { folio: 2n, idEmpresa: empresa.id, idCliente: otro.id } });
    await cliente.pedido.create({
      data: { folio: 3n, idEmpresa: otraEmpresa.id, idCliente: oscar.id },
    });

    const pagina = await listarPedidos(sesion(), { busqueda: 'oscar' }, bd());
    expect(pagina.datos.map((p) => Number(p.folio))).toEqual([1]);
    expect((await listarPedidos(sesion(), { busqueda: '2' }, bd())).total).toBe(1);
    // GEMELA.
    expect((await listarPedidos(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
  });
});

describe('CATÁLOGO SIMPLE — temporadas', () => {
  it('⭐ "otono" encuentra «OTOÑO-INVIERNO 2026», y el filtro de activas sigue mandando', async () => {
    await cliente.temporada.createMany({
      data: [{ nombre: 'OTOÑO-INVIERNO 2026' }, { nombre: 'PRIMAVERA-VERANO 2027' }],
    });
    const pagina = await listarTemporadas(sesion(), { busqueda: 'otono' }, bd());
    expect(pagina.datos.map((t) => t.nombre)).toEqual(['OTOÑO-INVIERNO 2026']);
    expect((await listarTemporadas(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);

    await cliente.temporada.updateMany({
      where: { nombre: { startsWith: 'OTO' } },
      data: { activo: false },
    });
    expect((await listarTemporadas(sesion(), { busqueda: 'otono' }, bd())).total).toBe(0);
  });
});

describe('ARCHIVO HISTÓRICO — tres cajas que se cruzan, y una tabla vecina uno-a-muchos', () => {
  beforeEach(async () => {
    const modelo = await cliente.modelo.create({
      data: { codigo: '50001', descripcion: 'Pijama niña' },
    });
    const a = await cliente.historicoOrdenV1.create({
      data: {
        idEmpresa: empresa.id,
        idOrdenV1: 'V1-1',
        numero: '7001',
        cliente: 'Suburbia Peñón',
        idModelo: modelo.id,
      },
    });
    await cliente.historicoOrdenV1Proceso.create({
      data: { idOrden: a.id, tipo: 'corte', cantidad: 10, tercero: 'Taller Muñoz' },
    });
    await cliente.historicoOrdenV1.create({
      data: { idEmpresa: empresa.id, idOrdenV1: 'V1-2', numero: '7002', cliente: 'Liverpool' },
    });
  });

  const historico = (filtros: Record<string, string>) =>
    listarHistoricoOrdenes(sesion(), filtros, bd());

  it('⭐ la caja libre alcanza la DESCRIPCIÓN DEL MODELO ligado, sin acento', async () => {
    const pagina = await historico({ busqueda: 'pijama nina' });
    expect(pagina.datos.map((o) => o.numero)).toEqual(['7001']);
  });

  it('⭐ el taller sale por un PROCESO (vecino uno-a-muchos), sin acento', async () => {
    expect((await historico({ maquilero: 'munoz' })).datos.map((o) => o.numero)).toEqual(['7001']);
  });

  it('las cajas se CRUZAN (AND), no se suman: cliente + búsqueda', async () => {
    expect((await historico({ cliente: 'penon', busqueda: '7001' })).total).toBe(1);
    expect((await historico({ cliente: 'penon', busqueda: '7002' })).total).toBe(0);
    expect((await historico({ cliente: 'liverpool' })).datos.map((o) => o.numero)).toEqual([
      '7002',
    ]);
  });

  it('A9: otra empresa no ve el archivo de ésta', async () => {
    expect(
      (await listarHistoricoOrdenes(sesion(otraEmpresa.id), { busqueda: '7001' }, bd())).total,
    ).toBe(0);
  });
});

describe('LA WHITELIST ENTERA corre contra el esquema real', () => {
  it.each(CATALOGOS_HABILITADOS)(
    '%s: su SQL es válido (tablas y columnas existen) y no casa con basura',
    async (catalogo) => {
      const opciones = catalogoConEmpresa(catalogo) ? { idEmpresa: empresa.id } : {};
      // Con la base vacía de este catálogo no hay qué encontrar: lo que se mide es que Postgres
      // ACEPTE la consulta (un identificador mal escrito truena aquí y en ningún otro sitio).
      await expect(
        cliente.$queryRaw(sqlIdsPorTextoSinAcentos(catalogo, 'zzz-no-existe', opciones)),
      ).resolves.toEqual([]);
    },
  );
});

/**
 * 🔴 Corrección del reviewer de la 0.214: los comodines se escapan DESPUÉS de `unaccent`. Al
 * principio se escapaban en JavaScript, ANTES, y `unaccent.rules` pliega los comodines de ancho
 * completo (`％`→`%`, `＿`→`_`, `＼`→`\`): un `％` tecleado pasaba el escape intacto y salía de
 * `unaccent` como un `%` VIVO. Medido: `100％` encontraba «ROJO 1000 CEREZA».
 *
 * Se mide por los DOS caminos, porque son dos funciones exportadas: el pre-filtro de ids (colores) y
 * la condición suelta del SQL crudo (`condicionContieneSinAcentos`).
 */
describe('COMODINES — se escapan después de unaccent (también los de ancho completo)', () => {
  beforeEach(async () => {
    await cliente.color.createMany({
      data: [
        { nombre: 'ROJO 1000 CEREZA' },
        { nombre: 'ROJO 100% ALGODÓN' },
        { nombre: 'AZUL_MARINO' },
        { nombre: 'AZULXMARINO' },
        { nombre: 'RUTA\\A' },
        { nombre: 'RUTAXA' },
      ],
    });
  });

  /** Lo que encuentra el pre-filtro de ids (vía el dominio de colores). */
  const porPreFiltro = async (texto: string) =>
    (await listarColores(sesion(), { busqueda: texto }, bd())).datos.map((c) => c.nombre).sort();

  /** Lo que encuentra la condición suelta del SQL crudo. */
  const porCondicion = async (texto: string) =>
    (
      await cliente.$queryRaw<{ nombre: string }[]>(
        Prisma.sql`SELECT c.nombre FROM "colores" c WHERE ${condicionContieneSinAcentos('c.nombre', texto)}`,
      )
    )
      .map((c) => c.nombre)
      .sort();

  it.each([
    ['porPreFiltro', porPreFiltro],
    ['porCondicion', porCondicion],
  ] as const)(
    '%s: «100» + el porciento (de ancho completo o ASCII) NO encuentra «ROJO 1000 CEREZA»',
    async (_nombre, buscar) => {
      // El `％` se pliega a `%` y se busca como TEXTO: casa con el «100%» literal, nada más.
      expect(await buscar('100％')).toEqual(['ROJO 100% ALGODÓN']);
      expect(await buscar('100%')).toEqual(['ROJO 100% ALGODÓN']);
    },
  );

  it.each([
    ['porPreFiltro', porPreFiltro],
    ['porCondicion', porCondicion],
  ] as const)('%s: «＿» y «_» son texto, no «cualquier carácter»', async (_nombre, buscar) => {
    expect(await buscar('AZUL＿')).toEqual(['AZUL_MARINO']);
    expect(await buscar('AZUL_')).toEqual(['AZUL_MARINO']);
  });

  it.each([
    ['porPreFiltro', porPreFiltro],
    ['porCondicion', porCondicion],
  ] as const)('%s: la barra (y su gemela «＼») es texto, no el escape', async (_nombre, buscar) => {
    expect(await buscar('TA\\A')).toEqual(['RUTA\\A']);
    expect(await buscar('TA＼A')).toEqual(['RUTA\\A']);
  });
});
