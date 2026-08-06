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
 *  • El mapeo `MapeoMigracion` se persiste (entregable de E7/F2/F4/F10).
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
    // Fusión de terceros: Alsatex, Eticobar, Servicios Varios, "Telefono Largo" (data sucia,
    // teléfono truncado, NO aborta), Suano Mujica, Intersew, Jorge García (maquilero ==
    // estampador → 1), Carlos Núñez y "Decorador Solo" (maquilero con Proceso=1) = 9.
    expect(tras1.proveedores).toBe(9);
    expect(tras1.almacenes).toBe(4); // 3 PT (IPT) + 1 TELA activo (1 TELA inactivo no migra)
    expect(tras1.bordados).toBe(3); // incl. el duplicado de nombre desambiguado
    expect(tras1.avios).toBe(3);
    expect(tras1.colores).toBe(6); // Marino, Negro, Negro A, Negro B, Blanco, Rojo
    // Alsatex100 (unificada), Jersey Liso, Chifon Liso, FelpaSuelta (TelaDis sin Tela)
    expect(tras1.telas).toBe(4);

    // La UNIDAD sale de `Telas.Medida` del Access (-1/1 = Kilos, 0 = Metros): el chifón es plano y
    // se compra en metros. Sin esto, las 142 telas de metros del volcado real nacerían en kilos y
    // el stock, el consumo y el costo por prenda quedarían mal sin que nadie lo note.
    const porUnidad = await cliente.tela.findMany({
      select: { nombre: true, unidadMedida: true },
      orderBy: { nombre: 'asc' },
    });
    expect(porUnidad.find((t) => t.nombre === 'Chifon Liso')?.unidadMedida).toBe('M');
    expect(porUnidad.find((t) => t.nombre === 'Alsatex100')?.unidadMedida).toBe('KG');
    // La que solo existe en TelasDis no trae medida: queda en KG (y el loader lo reporta).
    expect(porUnidad.find((t) => t.nombre === 'FelpaSuelta')?.unidadMedida).toBe('KG');
    expect(tras1.telaColor).toBe(5);
    expect(tras1.tallas).toBe(6); // XC, CH, M, G, XG, EX (la cadena rara no carga)
    expect(tras1.curvas).toBe(2);
    expect(tras1.mapeos).toBeGreaterThan(0);

    // 2ª corrida: nada se duplica.
    await ejecutarEtl(cliente);
    expect(await conteos()).toEqual(tras1);
  }, 180_000);

  // Las telas cargadas ANTES del 30-jul-2026 quedaron TODAS en KG (default de la migración
  // `20260730120000_unidad_tela`, porque la unidad ni se migraba). Re-correr el ETL tiene que
  // CORREGIRLAS: si solo las creara, las 142 telas de metros del volcado real se quedarían mal para
  // siempre en una base ya cargada — y como todas dirían KG, nadie lo notaría (hallazgo del
  // reviewer, que además era lo que la migración prometía por escrito).
  it('al re-correrse CORRIGE la unidad de las telas ya migradas (no solo las crea)', async () => {
    await ejecutarEtl(cliente);
    const chifon = await cliente.tela.findFirstOrThrow({ where: { nombre: 'Chifon Liso' } });
    expect(chifon.unidadMedida).toBe('M');

    // Se simula el estado de una base cargada antes: la unidad quedó en KG.
    await cliente.tela.update({ where: { id: chifon.id }, data: { unidadMedida: 'KG' } });

    await ejecutarEtl(cliente);

    const corregida = await cliente.tela.findUniqueOrThrow({ where: { id: chifon.id } });
    expect(corregida.unidadMedida).toBe('M');
    // Y no duplicó la tela al pasar por la rama de "ya existe".
    expect(await cliente.tela.count({ where: { nombre: 'Chifon Liso' } })).toBe(1);
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

  it('NO aborta con data sucia: trunca el teléfono >100 chars y crea el proveedor', async () => {
    await ejecutarEtl(cliente);
    // "Telefono Largo" trae un teléfono de 146 chars en el fixture: debe existir, con el
    // teléfono recortado a ≤100 (regla Zod), en vez de abortar la corrida.
    const prov = await cliente.proveedor.findFirstOrThrow({
      where: { nombre: 'Telefono Largo' },
      select: { telefono: true },
    });
    expect(prov.telefono).not.toBeNull();
    expect((prov.telefono ?? '').length).toBeLessThanOrEqual(100);
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

  it('maquilero con Proceso=1 (decorado) → rol estampado, NO maquila-costura', async () => {
    await ejecutarEtl(cliente);
    // "Decorador Solo": Proceso=1, Costura=0 → debe quedar con `estampado` y sin costura.
    const deco = await cliente.proveedor.findFirstOrThrow({
      where: { nombre: 'Decorador Solo' },
      select: { roles: { select: { rol: { select: { codigo: true } } } } },
    });
    const codigos = deco.roles.map((r) => r.rol.codigo);
    expect(codigos).toContain('estampado');
    expect(codigos).not.toContain('maquila-costura');
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
  // R2-1 (lección del PR #153, §Post-F9.11): re-correr el ETL NO borra la depuración manual
  // del grid de colores — conserva casing corregido, pantone, liga legacy y colores
  // agregados a mano; SOLO refresca el precio que el CSV sí trae.
  it('al re-correrse CONSERVA la depuración manual de los colores de tela', async () => {
    await ejecutarEtl(cliente);

    // La tela unificada trae sus colores del CSV, ligados al catálogo de prenda.
    const alsatex = await cliente.tela.findFirstOrThrow({
      where: { nombre: { equals: 'Alsatex100', mode: 'insensitive' } },
      select: { id: true },
    });
    const marino = await cliente.telaColor.findFirstOrThrow({
      where: { idTela: alsatex.id, nombre: 'Marino' },
    });
    expect(marino.idColor).not.toBeNull(); // la liga legacy quedó puesta

    // DEPURACIÓN manual: casing corregido, pantone capturado, precio movido a mano (para
    // comprobar que el CSV lo re-impone) y un color NUEVO que el CSV no conoce.
    await cliente.telaColor.update({
      where: { id: marino.id },
      data: { nombre: 'MARINO', pantone: '19-4024 TCX', precio: 999 },
    });
    await cliente.telaColor.create({
      data: { idTela: alsatex.id, nombre: 'Agregado a mano', precio: 10 },
    });
    const totalAntes = await cliente.telaColor.count();

    // 2ª corrida.
    await ejecutarEtl(cliente);

    const tras = await cliente.telaColor.findUniqueOrThrow({ where: { id: marino.id } });
    expect(tras.nombre).toBe('MARINO'); // el casing corregido NO se pisa con el crudo del CSV
    expect(tras.pantone).toBe('19-4024 TCX'); // el pantone capturado a mano sobrevive
    expect(tras.idColor).toBe(marino.idColor); // la liga legacy sobrevive
    expect(tras.precio?.toNumber()).toBe(57); // el precio del CSV SÍ se re-impone (Marino=57)
    // El color agregado a mano NO se borró; no se duplicó nada.
    expect(
      await cliente.telaColor.count({ where: { idTela: alsatex.id, nombre: 'Agregado a mano' } }),
    ).toBe(1);
    expect(await cliente.telaColor.count()).toBe(totalAntes);
  }, 180_000);
});
