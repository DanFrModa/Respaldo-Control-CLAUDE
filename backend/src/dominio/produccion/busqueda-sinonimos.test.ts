import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { Prisma } from '../../datos/index.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { listarCostos } from '../costos/costo-orden.js';

import { centroComandoOrdenes } from './centro-comando.js';
import { buscarOrdenesGlobal, consultarOrdenes } from './consultas.js';
import {
  armarBusqueda,
  armarBusquedaConSinonimos,
  condicionSinonimosDepartamento,
  listarOrdenes,
} from './ordenes.js';
import { consultarWip } from './wip.js';

/**
 * ⭐⭐ Unit de LA BÚSQUEDA QUE ENTIENDE LOS DOS NOMBRES (§Post-F9.172(a)) — SIN Postgres.
 *
 * Verifica que la condición del sinónimo **llega al `where` de verdad** por los DOS embudos que
 * leen `OrdenReferencia.valor`, y son dos porque el proyecto los tiene separados a propósito:
 *   • `armarBusqueda` — listado, consultas ligeras, buscador global, tablero WIP y lista de costos;
 *   • `busquedaCentro` (dentro de `centroComandoOrdenes`) — el Centro de Órdenes, que busca SIN
 *     nombre de cliente y por eso nunca compartió esta función.
 *
 * 🔴 Cada embudo lleva su prueba SEPARADA. Arreglar uno y no el otro habría pasado en verde con una
 * prueba compartida, y habría dejado sin arreglo justo la pantalla que más se usa.
 */

const sesionVer = () => sesionDePrueba({ permisos: ['ordenes.ver'], idEmpresaActiva: 1 });

/** «2-HOMBRE» REALMENTE absorbido por «Caballeros» (el `idFusionadoEn` es lo que lo hace fusión). */
const CATALOGO_FUSIONADO = [
  { id: 1, nombre: 'Caballeros', idFusionadoEn: null },
  { id: 2, nombre: '2-HOMBRE', idFusionadoEn: 1 },
];

/** Los mismos dos departamentos SIN fusionar: el control que desenmascara un fixture mentiroso. */
const CATALOGO_SIN_FUSION = [
  { id: 1, nombre: 'Caballeros', idFusionadoEn: null },
  { id: 2, nombre: '2-HOMBRE', idFusionadoEn: null },
];

interface WhereCatalogo {
  OR?: WhereCatalogo[];
  nombre?: { contains?: string; mode?: string };
  id?: { in?: number[] };
  idFusionadoEn?: { in?: number[] };
}

interface FilaCatalogo {
  id: number;
  nombre: string;
  idFusionadoEn: number | null;
}

function casaCatalogo(fila: FilaCatalogo, where: WhereCatalogo): boolean {
  if (where.OR !== undefined) return where.OR.some((w) => casaCatalogo(fila, w));
  if (where.nombre?.contains !== undefined) {
    return fila.nombre.toLocaleLowerCase().includes(where.nombre.contains.toLocaleLowerCase());
  }
  if (where.id?.in !== undefined) return where.id.in.includes(fila.id);
  if (where.idFusionadoEn?.in !== undefined) {
    return fila.idFusionadoEn !== null && where.idFusionadoEn.in.includes(fila.idFusionadoEn);
  }
  throw new Error(`where de catálogo no soportado: ${JSON.stringify(where)}`);
}

/** Sin acentos y en minúsculas: lo que hace `lower(unaccent())` en el pre-filtro real. */
function comparable(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Emula el PRE-FILTRO sin acentos (fila 0.214) sobre el catálogo de departamentos: la semilla de los
 * sinónimos ya no es un `findMany` con `contains`, es un `$queryRaw` de `comun/busqueda.ts`. El
 * texto llega CRUDO como el último parámetro (los comodines los escapa el SQL). Cualquier otro
 * pre-filtro (el de órdenes) devuelve CERO ids: aquí no hay órdenes, se mide el `where`.
 */
function preFiltroStub(catalogo: FilaCatalogo[]) {
  return vi.fn((consulta: Prisma.Sql) => {
    if (!consulta.text.includes('"cliente_departamento"')) return Promise.resolve([]);
    // El texto viaja CRUDO (el escape de comodines lo hace el SQL, después de `unaccent`).
    const texto = comparable(String(consulta.values[consulta.values.length - 1]));
    return Promise.resolve(
      catalogo.filter((f) => comparable(f.nombre).includes(texto)).map((f) => ({ id: f.id })),
    );
  });
}

/**
 * Stub de lectura: catálogo de departamentos vivo (para que el resolver camine de verdad) y CERO
 * órdenes — lo que se mide aquí es el `where` que se emite, no la proyección.
 */
function bdStub(catalogo: FilaCatalogo[] = CATALOGO_FUSIONADO) {
  const count = vi.fn(() => Promise.resolve(0));
  const findMany = vi.fn(() => Promise.resolve([]));
  const departamentos = vi.fn((args: { where: WhereCatalogo }) =>
    Promise.resolve(catalogo.filter((f) => casaCatalogo(f, args.where))),
  );
  const contarCostos = vi.fn(() => Promise.resolve(0));
  const tx = {
    orden: { count, findMany },
    clienteDepartamento: { findMany: departamentos },
    ordenLineaTalla: {
      groupBy: vi.fn(() => Promise.resolve([])),
      aggregate: vi.fn(() => Promise.resolve({ _sum: { cantidad: null } })),
    },
    ordenLinea: { findMany: vi.fn(() => Promise.resolve([])) },
    etapaMovimiento: { findMany: vi.fn(() => Promise.resolve([])) },
    ordenCompraLinea: { findMany: vi.fn(() => Promise.resolve([])) },
    // Agregados del tablero WIP y de la lista de costos (universo vacío: aquí se mide el `where`).
    etapaMovimientoDet: { aggregate: vi.fn(() => Promise.resolve({ _sum: { cantidad: null } })) },
    // Los FALTANTES SALDADOS del agregado WIP (V1, fila 0.109): universo vacío, igual que el resto.
    cierreMaquilaOrdenDet: {
      aggregate: vi.fn(() => Promise.resolve({ _sum: { cantidadFaltantes: null } })),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    cierreMaquilaOrden: { findMany: vi.fn(() => Promise.resolve([])) },
    costoOrden: {
      count: vi.fn(() => Promise.resolve(0)),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    $queryRaw: preFiltroStub(catalogo),
  };
  tx.costoOrden.count = contarCostos;
  const bd: ContextoBd = { tx: tx as unknown as Tx };
  return { bd, count, findMany, departamentos, contarCostos, queryRaw: tx.$queryRaw };
}

/** El `where` con el que se pidió el CONTEO (el mismo del `findMany`, por construcción). */
function whereDelConteo(count: ReturnType<typeof vi.fn>): Prisma.OrdenWhereInput {
  const [args] = count.mock.calls[0] as unknown as [{ where: Prisma.OrdenWhereInput }];
  return args.where;
}

/** Todas las cláusulas `OR` del where, vengan sueltas o dentro del `AND` que arma el Centro. */
function clausulas(where: Prisma.OrdenWhereInput): Prisma.OrdenWhereInput[] {
  const propias = where.OR ?? [];
  const deAnd = Array.isArray(where.AND) ? where.AND : [];
  return [...(Array.isArray(propias) ? propias : [propias]), ...deAnd.flatMap((c) => c.OR ?? [])];
}

/** ¿El where busca alguna referencia IGUAL a este nombre de departamento? */
function buscaReferenciaIgualA(where: Prisma.OrdenWhereInput, nombre: string): boolean {
  return clausulas(where).some((c) => {
    const some = c.referencias?.some;
    const or = some?.OR;
    const lista = or === undefined ? [] : Array.isArray(or) ? or : [or];
    return lista.some((x) => {
      const valor = x.valor;
      return typeof valor === 'object' && valor !== null && valor.equals === nombre;
    });
  });
}

// ── La función pura ────────────────────────────────────────────────────────────────

describe('armarBusqueda — la forma (fila 0.214: el texto llega como ids sin acentos)', () => {
  it('sin sinónimos emite UNA cláusula: los ids que el pre-filtro sin acentos encontró', () => {
    const where = armarBusqueda('Caballeros', [7, 9]);
    expect(where.OR).toEqual([{ id: { in: [7, 9] } }]);
    expect(buscaReferenciaIgualA(where, '2-HOMBRE')).toBe(false);
  });

  it('⭐ ya NO compara texto con `contains` (ILIKE no dobla acentos: «nino» ≠ «Niño»)', () => {
    expect(JSON.stringify(armarBusqueda('nino', [], ['2-HOMBRE']))).not.toContain('contains');
  });

  it('búsqueda vacía sigue siendo un where vacío, aunque le pasen ids y sinónimos', () => {
    expect(armarBusqueda('', [1], ['2-HOMBRE'])).toEqual({});
    expect(armarBusqueda(undefined, [1], ['2-HOMBRE'])).toEqual({});
  });

  it('con sinónimos agrega UNA cláusula más, sin tocar la de los ids', () => {
    const where = armarBusqueda('Caballeros', [], ['2-HOMBRE']);
    expect(where.OR).toHaveLength(2);
    expect(buscaReferenciaIgualA(where, '2-HOMBRE')).toBe(true);
  });

  it('el folio (búsqueda entera) sigue entrando como IGUALDAD', () => {
    expect(armarBusqueda('104', []).OR).toContainEqual({ folio: 104n });
  });

  it('⭐ el sinónimo se compara por IGUALDAD, nunca por `contains` (es un nombre exacto del catálogo)', () => {
    const where = armarBusqueda('Caballeros', [], ['2-HOMBRE']);
    const clausula = clausulas(where).find((c) => c.referencias?.some?.OR !== undefined);
    const or = clausula?.referencias?.some?.OR;
    const lista = or === undefined ? [] : Array.isArray(or) ? or : [or];
    expect(lista).toHaveLength(1);
    expect(lista[0]?.valor).toEqual({ equals: '2-HOMBRE', mode: 'insensitive' });
  });

  it('sin sinónimos NO se cuela un `OR` vacío (que en Prisma no casaría nada)', () => {
    expect(condicionSinonimosDepartamento([])).toBeNull();
  });
});

// ── El embudo compartido: armarBusquedaConSinonimos ─────────────────────────────────

describe('armarBusquedaConSinonimos — resuelve contra el catálogo', () => {
  it('DESTINO → ORIGEN: buscar «Caballeros» agrega la referencia «2-HOMBRE»', async () => {
    const { bd } = bdStub();
    expect(
      buscaReferenciaIgualA(await armarBusquedaConSinonimos('Caballeros', 1, bd), '2-HOMBRE'),
    ).toBe(true);
  });

  it('ORIGEN → DESTINO: buscar «2-HOMBRE» agrega la referencia «Caballeros»', async () => {
    const { bd } = bdStub();
    expect(
      buscaReferenciaIgualA(await armarBusquedaConSinonimos('2-HOMBRE', 1, bd), 'Caballeros'),
    ).toBe(true);
  });

  it('⭐ SIN fusión no agrega nada (mismos nombres, mismo texto: cambia sólo el rastro)', async () => {
    const { bd } = bdStub(CATALOGO_SIN_FUSION);
    const where = await armarBusquedaConSinonimos('Caballeros', 1, bd);
    expect(where.OR).toHaveLength(1);
    expect(buscaReferenciaIgualA(where, '2-HOMBRE')).toBe(false);
  });

  it('búsqueda vacía no consulta el catálogo ni corre el pre-filtro', async () => {
    const { bd, departamentos, queryRaw } = bdStub();
    expect(await armarBusquedaConSinonimos('', 1, bd)).toEqual({});
    expect(departamentos).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('⭐ fila 0.214: la SEMILLA es sin acentos — «nino» encuentra «Niño Infantil» y su fusión', async () => {
    const { bd } = bdStub([
      { id: 1, nombre: 'Niño Infantil', idFusionadoEn: null },
      { id: 2, nombre: '4-KIDS', idFusionadoEn: 1 },
    ]);
    expect(buscaReferenciaIgualA(await armarBusquedaConSinonimos('nino', 1, bd), '4-KIDS')).toBe(
      true,
    );
  });

  it('el pre-filtro de órdenes se acota a la EMPRESA que se le pasa (A9)', async () => {
    const { bd, queryRaw } = bdStub();
    await armarBusquedaConSinonimos('Caballeros', 42, bd);
    const deOrdenes = queryRaw.mock.calls
      .map(([consulta]) => consulta)
      .find((consulta) => consulta.text.includes('"ordenes" t'));
    expect(deOrdenes?.text).toContain('t.id_empresa = $1');
    expect(deOrdenes?.values[0]).toBe(42);
  });
});

// ── Embudo 1: listado / consultas ligeras / buscador global ─────────────────────────

describe('el sinónimo LLEGA al where — listado de órdenes', () => {
  it('DESTINO → ORIGEN', async () => {
    const { bd, count } = bdStub();
    await listarOrdenes(sesionVer(), { busqueda: 'Caballeros' }, bd);
    expect(buscaReferenciaIgualA(whereDelConteo(count), '2-HOMBRE')).toBe(true);
  });

  it('ORIGEN → DESTINO', async () => {
    const { bd, count } = bdStub();
    await listarOrdenes(sesionVer(), { busqueda: '2-HOMBRE' }, bd);
    expect(buscaReferenciaIgualA(whereDelConteo(count), 'Caballeros')).toBe(true);
  });

  it('⭐ sin fusión, el where queda EXACTAMENTE como antes de esta etapa', async () => {
    const { bd, count } = bdStub(CATALOGO_SIN_FUSION);
    await listarOrdenes(sesionVer(), { busqueda: 'Caballeros' }, bd);
    expect(whereDelConteo(count).OR).toHaveLength(1);
  });

  it('la consulta LIGERA comparte el arreglo (mismo embudo)', async () => {
    const { bd, count } = bdStub();
    await consultarOrdenes(sesionVer(), { busqueda: 'Caballeros' }, bd);
    expect(buscaReferenciaIgualA(whereDelConteo(count), '2-HOMBRE')).toBe(true);
  });

  it('el BUSCADOR GLOBAL del layout también lo entiende', async () => {
    const { bd, findMany } = bdStub();
    await buscarOrdenesGlobal(sesionVer(), { q: 'Caballeros' }, bd);
    const [args] = findMany.mock.calls[0] as unknown as [{ where: Prisma.OrdenWhereInput }];
    expect(buscaReferenciaIgualA(args.where, '2-HOMBRE')).toBe(true);
  });
});

// ── Embudo 2: el Centro de Órdenes (función propia, sin nombre de cliente) ──────────

describe('el sinónimo LLEGA al where — Centro de Órdenes (el OTRO embudo)', () => {
  it('DESTINO → ORIGEN', async () => {
    const { bd, count } = bdStub();
    await centroComandoOrdenes(sesionVer(), { busqueda: 'Caballeros' }, bd);
    expect(buscaReferenciaIgualA(whereDelConteo(count), '2-HOMBRE')).toBe(true);
  });

  it('ORIGEN → DESTINO', async () => {
    const { bd, count } = bdStub();
    await centroComandoOrdenes(sesionVer(), { busqueda: '2-HOMBRE' }, bd);
    expect(buscaReferenciaIgualA(whereDelConteo(count), 'Caballeros')).toBe(true);
  });

  it('sigue SIN buscar por nombre de cliente (el sinónimo no le cambió el criterio)', async () => {
    const { bd, count, queryRaw } = bdStub();
    await centroComandoOrdenes(sesionVer(), { busqueda: 'Caballeros' }, bd);
    expect(clausulas(whereDelConteo(count)).some((c) => c.cliente !== undefined)).toBe(false);
    // Y su pre-filtro sin acentos (fila 0.214) es el del CENTRO: modelo + referencias, sin clientes.
    const deOrdenes = queryRaw.mock.calls
      .map(([consulta]) => consulta)
      .find((consulta) => consulta.text.includes('"ordenes" t'));
    expect(deOrdenes?.text).toContain('"orden_referencia"');
    expect(deOrdenes?.text).not.toContain('"clientes"');
  });

  it('⭐ sin fusión, el Centro queda EXACTAMENTE como antes de esta etapa', async () => {
    const { bd, count } = bdStub(CATALOGO_SIN_FUSION);
    await centroComandoOrdenes(sesionVer(), { busqueda: 'Caballeros' }, bd);
    expect(clausulas(whereDelConteo(count))).toHaveLength(1); // los ids de modelo + referencia
  });
});

// ── Los otros dos consumidores del mismo embudo (tablero WIP y lista de costos) ─────

describe('el sinónimo LLEGA al where — los consumidores restantes de `armarBusqueda`', () => {
  it('tablero WIP: DESTINO → ORIGEN', async () => {
    const { bd, count } = bdStub();
    const sesion = sesionDePrueba({ permisos: ['produccion.wip-ver'], idEmpresaActiva: 1 });
    await consultarWip(sesion, { busqueda: 'Caballeros' }, bd);
    expect(buscaReferenciaIgualA(whereDelConteo(count), '2-HOMBRE')).toBe(true);
  });

  it('tablero WIP: ORIGEN → DESTINO', async () => {
    const { bd, count } = bdStub();
    const sesion = sesionDePrueba({ permisos: ['produccion.wip-ver'], idEmpresaActiva: 1 });
    await consultarWip(sesion, { busqueda: '2-HOMBRE' }, bd);
    expect(buscaReferenciaIgualA(whereDelConteo(count), 'Caballeros')).toBe(true);
  });

  it('lista de costos: el sinónimo entra por la orden anidada (DESTINO → ORIGEN)', async () => {
    const { bd, contarCostos } = bdStub();
    const sesion = sesionDePrueba({ permisos: ['costos.ver'], idEmpresaActiva: 1 });
    await listarCostos(sesion, { busqueda: 'Caballeros' }, bd);
    const [args] = contarCostos.mock.calls[0] as unknown as [
      { where: { orden?: Prisma.OrdenWhereInput } },
    ];
    expect(args.where.orden).toBeDefined();
    expect(buscaReferenciaIgualA(args.where.orden ?? {}, '2-HOMBRE')).toBe(true);
  });

  it('lista de costos: ORIGEN → DESTINO', async () => {
    const { bd, contarCostos } = bdStub();
    const sesion = sesionDePrueba({ permisos: ['costos.ver'], idEmpresaActiva: 1 });
    await listarCostos(sesion, { busqueda: '2-HOMBRE' }, bd);
    const [args] = contarCostos.mock.calls[0] as unknown as [
      { where: { orden?: Prisma.OrdenWhereInput } },
    ];
    expect(buscaReferenciaIgualA(args.where.orden ?? {}, 'Caballeros')).toBe(true);
  });
});

// ── La red contra el olvido: nadie vuelve al embudo ciego ───────────────────────────

/** Todos los `.ts` de `src/` menos los generados de Prisma. */
function fuentesDelServidor(): { ruta: string; texto: string }[] {
  const raiz = fileURLToPath(new URL('../..', import.meta.url));
  const archivos: { ruta: string; texto: string }[] = [];
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) {
        if (entrada.name !== 'generated') recorrer(ruta);
      } else if (entrada.name.endsWith('.ts')) {
        archivos.push({ ruta: ruta.slice(raiz.length), texto: readFileSync(ruta, 'utf8') });
      }
    }
  };
  recorrer(raiz);
  return archivos;
}

describe('⭐ red contra el olvido: nadie usa la búsqueda de órdenes SIN sinónimos', () => {
  it('`armarBusqueda` (la versión cruda) sólo la usan su propio módulo y esta prueba', () => {
    const fuentes = fuentesDelServidor();
    // La prueba se protege de sí misma: si el barrido dejara de encontrar archivos, esto lo delata.
    expect(fuentes.length).toBeGreaterThan(200);

    // `\b…\(` casa la LLAMADA, no el nombre citado en un comentario — y tampoco
    // `armarBusquedaConSinonimos`, porque entre la 'a' y la 'C' no hay frontera de palabra.
    // Los `armarBusqueda` PRIVADOS de compras y de notas de salida son de OTROS modelos
    // (`OrdenCompra`/`NotaSalida`), no leen referencias de orden, y se distinguen porque no
    // importan nada de `ordenes.js`.
    const culpables = fuentes
      .filter(({ texto }) => /\barmarBusqueda\(/.test(texto))
      .filter(
        ({ texto }) =>
          /from '\.[^']*ordenes\.js'/.test(texto) ||
          texto.includes('export function armarBusqueda'),
      )
      .map(({ ruta }) => ruta)
      .filter((ruta) => !ruta.endsWith('dominio/produccion/ordenes.ts'))
      .filter((ruta) => !ruta.endsWith('busqueda-sinonimos.test.ts'));

    // Si esto se pone rojo: la pantalla nueva debe usar `armarBusquedaConSinonimos`, o —si arma su
    // propio `OR`, como el Centro de Órdenes— `condicionSinonimosDepartamento`. Usar la cruda le
    // quita el arreglo a esa pantalla EN SILENCIO.
    expect(culpables).toEqual([]);
  });
});
