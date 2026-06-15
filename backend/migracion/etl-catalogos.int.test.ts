/**
 * Integración del ETL de catálogos (F1-E6) — corre en CI (testcontainers), NO en local.
 *
 * IMPORTANTE (CI): la carpeta `Respaldo CLAUDE/TABLAS/` está gitignored y NO existe en CI ni
 * en Railway (vive solo en local y en la rama `fuente-sistema-viejo`). Por eso este test NO
 * lee los CSV reales: apunta el ETL a **fixtures CSV pequeños COMMITEADOS**
 * (`migracion/__fixtures__/tablas/`) vía la variable `TABLAS_DIR`. Las mini-tablas cubren los
 * casos representativos (TipoProv H/T/S, un maquilero que también es estampador para probar
 * la fusión, una tela con su TelaDis y otra sin pareja, un avío con proveedor con match y
 * otro sin match, colores con variante A/B, una cadena de tallas válida y una rara,
 * Temporadas vacío, empresas activa/inactiva, etc.). El ETL real sigue default-leyendo de
 * `Respaldo CLAUDE/TABLAS/`.
 *
 * Verifica:
 *  • Idempotencia: cargar dos veces NO duplica (conteos idénticos en la 2ª corrida).
 *  • Cargas end-to-end vía servicios de dominio, con conteos EXACTOS deterministas de los
 *    fixtures (cada uno ejercita un escenario: fusión de terceros, rol por TipoProv,
 *    fallback de precio de avío, unificación de telas, variantes A/B, tallas raras).
 *  • El mapeo `MapeoMigracion` se persiste (entregable de E7/F2/F4/F9).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtl } from './etl-catalogos.js';
import { ENTIDAD_MAPEO } from './comun/mapeo.js';

let cliente: PrismaClient;

/** Carpeta de fixtures CSV COMMITEADOS (mini-tablas del viejo) para el ETL en CI. */
const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas', import.meta.url));

let tablasDirPrevio: string | undefined;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

/**
 * Siembra lo mínimo que el ETL necesita: empresa FR Moda (favorita) + TODOS los roles de
 * proveedor que la carga usa (incluidos los comerciales `vende-telas`/`vende-avios`, que el
 * loader asigna según `TipoProv`).
 */
async function sembrarMinimo(): Promise<void> {
  await sembrarPermisos(cliente);
  await cliente.empresa.upsert({
    where: { nombre: 'FR Moda' },
    update: {},
    create: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  const roles = [
    { codigo: 'maquila-costura', nombre: 'Maquila (costura)' },
    { codigo: 'corte', nombre: 'Corte' },
    { codigo: 'estampado', nombre: 'Estampado' },
    { codigo: 'vende-telas', nombre: 'Vende telas' },
    { codigo: 'vende-avios', nombre: 'Vende avíos' },
    { codigo: 'otros-servicios', nombre: 'Otros servicios' },
  ];
  for (const r of roles) {
    await cliente.rolProveedor.upsert({ where: { codigo: r.codigo }, update: {}, create: r });
  }
}

beforeEach(async () => {
  // Apunta el lector de CSV a los fixtures COMMITEADOS (no a la carpeta real, ausente en CI).
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  await sembrarMinimo();
});

afterEach(() => {
  if (tablasDirPrevio === undefined) {
    delete process.env.TABLAS_DIR;
  } else {
    process.env.TABLAS_DIR = tablasDirPrevio;
  }
});

/** Snapshot de los conteos de todos los catálogos (para idempotencia y aserciones exactas). */
async function conteos(): Promise<Record<string, number>> {
  return {
    empresas: await cliente.empresa.count(),
    clientes: await cliente.cliente.count(),
    etiquetas: await cliente.etiquetaMarca.count(),
    generos: await cliente.genero.count(),
    temporadas: await cliente.temporada.count(),
    telaCategorias: await cliente.telaCategoria.count(),
    proveedores: await cliente.proveedor.count(),
    almacenes: await cliente.almacen.count(),
    bordados: await cliente.bordado.count(),
    avios: await cliente.avio.count(),
    colores: await cliente.color.count(),
    telas: await cliente.tela.count(),
    telaColor: await cliente.telaColor.count(),
    tallas: await cliente.talla.count(),
    curvas: await cliente.curvaTalla.count(),
    mapeos: await cliente.mapeoMigracion.count(),
  };
}

describe('ETL de catálogos F1-E6 (integración, fixtures committeados)', () => {
  it('carga end-to-end con conteos EXACTOS y es IDEMPOTENTE (2ª corrida no duplica)', async () => {
    await ejecutarEtl(cliente);
    const tras1 = await conteos();

    // Conteos deterministas de los fixtures (cada uno ejercita un escenario):
    expect(tras1.clientes).toBe(2);
    // Empresas: FR Moda (seed) + Marilyn Fitness (activa); Marilyn (inactiva) NO migra.
    expect(tras1.empresas).toBe(2);
    expect(tras1.etiquetas).toBe(2); // Marilyn (activa) + Cherokee (creada y desactivada)
    expect(tras1.generos).toBe(2);
    expect(tras1.temporadas).toBe(0); // fuente VACÍA
    expect(tras1.telaCategorias).toBe(1); // Felpa (la de nombre vacío se limpia)
    // Fusión de terceros: Alsatex, Eticobar, Servicios Varios, Suano Mujica, Intersew,
    // Jorge García (maquilero == estampador → 1) y Carlos Núñez = 7.
    expect(tras1.proveedores).toBe(7);
    expect(tras1.almacenes).toBe(4); // 3 PT (IPT) + 1 TELA activo (1 TELA inactivo no migra)
    expect(tras1.bordados).toBe(3); // incl. el duplicado de nombre desambiguado
    expect(tras1.avios).toBe(3);
    expect(tras1.colores).toBe(6); // Marino, Negro, Negro A, Negro B, Blanco, Rojo
    expect(tras1.telas).toBe(3); // Alsatex100 (unificada), Jersey Liso, FelpaSuelta (TelaDis sin Tela)
    expect(tras1.telaColor).toBe(5);
    expect(tras1.tallas).toBe(6); // XC, CH, M, G, XG, EX (la cadena rara no carga)
    expect(tras1.curvas).toBe(2);
    expect(tras1.mapeos).toBeGreaterThan(0);

    // 2ª corrida: nada se duplica.
    await ejecutarEtl(cliente);
    expect(await conteos()).toEqual(tras1);
  }, 180_000);

  it('asigna el ROL de proveedor según TipoProv (T→vende-telas, H→vende-avios, S→otros)', async () => {
    await ejecutarEtl(cliente);

    const rolDe = async (nombre: string): Promise<string[]> => {
      const p = await cliente.proveedor.findFirstOrThrow({
        where: { nombre },
        select: { roles: { select: { rol: { select: { codigo: true } } } } },
      });
      return p.roles.map((r) => r.rol.codigo);
    };

    expect(await rolDe('Alsatex')).toContain('vende-telas'); // TipoProv = T
    expect(await rolDe('Eticobar')).toContain('vende-avios'); // TipoProv = H
    expect(await rolDe('Servicios Varios')).toContain('otros-servicios'); // TipoProv = S
  });

  it('fusiona terceros: Jorge García queda con maquila-costura Y estampado', async () => {
    await ejecutarEtl(cliente);
    const jorge = await cliente.proveedor.findFirstOrThrow({
      where: { nombre: { contains: 'Jorge', mode: 'insensitive' } },
      select: { roles: { select: { rol: { select: { codigo: true } } } } },
    });
    const codigos = jorge.roles.map((r) => r.rol.codigo).sort();
    expect(codigos).toContain('maquila-costura');
    expect(codigos).toContain('estampado');
  });

  it('avío con proveedor que matchea → AvioProveedor; sin match → precioReferencia (fallback)', async () => {
    await ejecutarEtl(cliente);
    // E01 → proveedor Eticobar (match): renglón AvioProveedor con precio, sin precioReferencia.
    const e01 = await cliente.avio.findFirstOrThrow({
      where: { clave: 'E01' },
      select: { precioReferencia: true, proveedores: { select: { precio: true } } },
    });
    expect(e01.proveedores).toHaveLength(1);
    expect(e01.precioReferencia).toBeNull();
    // B08 → proveedor inexistente: precio va a precioReferencia, sin renglón AvioProveedor.
    const b08 = await cliente.avio.findFirstOrThrow({
      where: { clave: 'B08' },
      select: { precioReferencia: true, proveedores: { select: { precio: true } } },
    });
    expect(b08.proveedores).toHaveLength(0);
    expect(b08.precioReferencia).not.toBeNull();
    expect(Number(b08.precioReferencia)).toBe(0.5);
  });

  it('unifica Alsatex100 (Telas+TelasDis) en UNA tela; FelpaSuelta (TelaDis sin Tela) existe', async () => {
    await ejecutarEtl(cliente);
    const alsatex = await cliente.tela.count({
      where: { nombre: { equals: 'Alsatex100', mode: 'insensitive' } },
    });
    expect(alsatex).toBe(1); // unificada (no duplicada por la pareja TelaDis)
    const felpaSuelta = await cliente.tela.count({
      where: { nombre: { equals: 'FelpaSuelta', mode: 'insensitive' } },
    });
    expect(felpaSuelta).toBe(1); // TelaDis sin Tela base → creada como Tela propia
  });

  it('siembra el campo D7 "No. de pedido del cliente" por cliente', async () => {
    await ejecutarEtl(cliente);
    const campos = await cliente.clienteCampo.count({
      where: { etiqueta: { equals: 'No. de pedido del cliente', mode: 'insensitive' } },
    });
    expect(campos).toBe(await cliente.cliente.count());
  });

  it('persiste mapeos consultables (texto→idColor y tela vieja→idTela)', async () => {
    await ejecutarEtl(cliente);
    expect(
      await cliente.mapeoMigracion.count({ where: { entidad: ENTIDAD_MAPEO.color } }),
    ).toBeGreaterThan(0);
    expect(
      await cliente.mapeoMigracion.count({ where: { entidad: ENTIDAD_MAPEO.telaPorIdTelas } }),
    ).toBeGreaterThan(0);
  });
});
