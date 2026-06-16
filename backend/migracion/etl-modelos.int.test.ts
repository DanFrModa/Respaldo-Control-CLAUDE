/**
 * Integración del ETL de modelos (F1-E7) — corre en CI (testcontainers), NO en local.
 *
 * Patrón idéntico a `etl-catalogos.int.test.ts`:
 *  • Apunta el ETL a fixtures CSV COMMITEADOS (`migracion/__fixtures__/tablas/`).
 *  • Siembra primero E6 (catálogos/materiales) para que los mapeos estén disponibles.
 *  • Luego corre el ETL de E7 y verifica: conteos exactos + IDEMPOTENCIA (2ª corrida = mismos).
 *
 * Verifica:
 *  • Carga de modelos vía dominio (A1): conteos deterministas de los fixtures.
 *  • Idempotencia: dos corridas NO duplican nada.
 *  • BOM: renglones de tela/avío/bordado cargados correctamente con mapeos.
 *  • Renglones sin mapeo (IdModelos=99, IdTelasDis/IdHabilitacion/IdBordados inválidos)
 *    se OMITEN sin abortar (§7 — no null silencioso, reportados al reporte).
 *  • Modelo con `Activo=0` → descontinuado (borrado suave).
 *  • Código duplicado: el segundo se omite (ErrorConflicto reportado).
 *  • Mapeo `Modelo` persistido (`MapeoMigracion`).
 *
 * NO corre ni verifica fotos (dependen de R2 + carpeta física → unitarios de fotos.test.ts).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtl as ejecutarEtlCatalogos } from './etl-catalogos.js';
import { ejecutarEtlModelos } from './etl-modelos.js';
import { cargarModelos } from './loaders/modelos.js';
import { cargarBom } from './loaders/bom-modelos.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { ENTIDAD_MAPEO } from './comun/mapeo.js';

let cliente: PrismaClient;

const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas', import.meta.url));

let tablasDirPrevio: string | undefined;
// Desactivar fotos en los tests de integración (no hay carpetas físicas en CI).
let fotosMod: string | undefined;
let fotosBor: string | undefined;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

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
  tablasDirPrevio = process.env.TABLAS_DIR;
  fotosMod = process.env.ETL_FOTOS_MOD_DIR;
  fotosBor = process.env.ETL_FOTOS_BOR_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  // Sin fotos en CI — el ETL las salta limpio con aviso.
  delete process.env.ETL_FOTOS_MOD_DIR;
  delete process.env.ETL_FOTOS_BOR_DIR;

  await limpiarBaseDatos(cliente);
  await sembrarMinimo();
  // E7 depende de los mapeos de E6 → correr E6 primero.
  await ejecutarEtlCatalogos(cliente);
});

afterEach(() => {
  if (tablasDirPrevio === undefined) {
    delete process.env.TABLAS_DIR;
  } else {
    process.env.TABLAS_DIR = tablasDirPrevio;
  }
  if (fotosMod === undefined) {
    delete process.env.ETL_FOTOS_MOD_DIR;
  } else {
    process.env.ETL_FOTOS_MOD_DIR = fotosMod;
  }
  if (fotosBor === undefined) {
    delete process.env.ETL_FOTOS_BOR_DIR;
  } else {
    process.env.ETL_FOTOS_BOR_DIR = fotosBor;
  }
});

/** Snapshot de los conteos de E7 (para idempotencia). */
async function conteosE7(): Promise<Record<string, number>> {
  return {
    modelos: await cliente.modelo.count(),
    modelosActivos: await cliente.modelo.count({ where: { activo: true } }),
    bomTelas: await cliente.modeloTela.count(),
    bomAvios: await cliente.modeloAvio.count(),
    bomBordados: await cliente.modeloBordado.count(),
    fotoModelo: await cliente.modeloFoto.count(),
    mapeos: await cliente.mapeoMigracion.count({ where: { entidad: ENTIDAD_MAPEO.modelo } }),
  };
}

describe('ETL de modelos F1-E7 (integración, fixtures commiteados)', () => {
  it('carga modelos con conteos EXACTOS y es IDEMPOTENTE', async () => {
    await ejecutarEtlModelos(cliente);
    const tras1 = await conteosE7();

    // Fixtures: 5 filas. M001/M002 = activos (creados), M003 = inactivo (creado y descontinuado),
    // M-DUP dos veces: el primero (IdModelos=4) se crea, el segundo (IdModelos=5) da
    // ErrorConflicto (código duplicado) y se OMITE.
    expect(tras1.modelos).toBe(4); // M001, M002, M003, M-DUP (primer ocurrencia)
    expect(tras1.modelosActivos).toBe(3); // M001, M002, M-DUP (M003 descontinuado)
    // El mapeo persiste solo los creados correctamente (4 mapeos de Modelo).
    expect(tras1.mapeos).toBe(4);

    // 2ª corrida: nada se duplica (idempotencia).
    await ejecutarEtlModelos(cliente);
    expect(await conteosE7()).toEqual(tras1);
  }, 120_000);

  it('carga el BOM con renglones de tela/avío/bordado correctamente', async () => {
    await ejecutarEtlModelos(cliente);
    const tras1 = await conteosE7();

    // ModelosTela.csv: 4 filas, 1 con IdModelos=99 (sin mapeo → omitida).
    // M001↔tela1, M002↔tela1, M003↔tela2 = 3 renglones válidos.
    expect(tras1.bomTelas).toBe(3);

    // ModelosHab.csv: 5 filas, 1 con IdModelos=99 (sin mapeo → omitida).
    // M001↔avío1+avío2 (2 renglones), M002↔avío1 (1), M003↔avío2 (1) = 4 válidos.
    expect(tras1.bomAvios).toBe(4);

    // ModelosBor.csv: 4 filas. IdModelos=0 omitido, IdModelos=99 omitido.
    // M001↔bordado1 (1), M002↔bordado2 (1) = 2 renglones válidos.
    expect(tras1.bomBordados).toBe(2);

    // 2ª corrida: idempotente.
    await ejecutarEtlModelos(cliente);
    expect(await conteosE7()).toEqual(tras1);
  }, 120_000);

  it('el conteo del BOM es HONESTO: 1ª corrida creados>0/existentes=0; 2ª creados=0/existentes>0', async () => {
    // Cargar modelos primero (el BOM necesita el mapeo Modelo).
    await cargarModelos(sesionEtl(), cliente, new Reporte());

    // 1ª corrida del BOM: todo nuevo → creados>0, existentes=0.
    const bom1 = await cargarBom(sesionEtl(), cliente, new Reporte());
    expect(bom1.telas.creados).toBe(3);
    expect(bom1.telas.existentes).toBe(0);
    expect(bom1.avios.creados).toBe(4);
    expect(bom1.avios.existentes).toBe(0);
    expect(bom1.bordados.creados).toBe(2);
    expect(bom1.bordados.existentes).toBe(0);

    // 2ª corrida idempotente: nada nuevo → creados=0, existentes = los mismos N (NO infla).
    const bom2 = await cargarBom(sesionEtl(), cliente, new Reporte());
    expect(bom2.telas.creados).toBe(0);
    expect(bom2.telas.existentes).toBe(3);
    expect(bom2.avios.creados).toBe(0);
    expect(bom2.avios.existentes).toBe(4);
    expect(bom2.bordados.creados).toBe(0);
    expect(bom2.bordados.existentes).toBe(2);
  }, 120_000);

  it('modelo con Activo=0 queda descontinuado (borrado suave)', async () => {
    await ejecutarEtlModelos(cliente);
    const m003 = await cliente.modelo.findFirst({ where: { codigo: 'M003' } });
    expect(m003).not.toBeNull();
    expect(m003?.activo).toBe(false);
  }, 60_000);

  it('código duplicado: el segundo modelo (M-DUP IdModelos=5) se omite con reporte', async () => {
    await ejecutarEtlModelos(cliente);
    const dups = await cliente.modelo.findMany({ where: { codigo: 'M-DUP' } });
    // Solo uno de los dos M-DUP se crea.
    expect(dups).toHaveLength(1);
    // El primero (IdModelos=4) tiene mapeo.
    const mapeo4 = await cliente.mapeoMigracion.findUnique({
      where: { entidad_claveVieja: { entidad: ENTIDAD_MAPEO.modelo, claveVieja: '4' } },
    });
    expect(mapeo4).not.toBeNull();
    // El segundo (IdModelos=5) NO tiene mapeo (omitido por conflicto).
    const mapeo5 = await cliente.mapeoMigracion.findUnique({
      where: { entidad_claveVieja: { entidad: ENTIDAD_MAPEO.modelo, claveVieja: '5' } },
    });
    expect(mapeo5).toBeNull();
  }, 60_000);

  it('renglones BOM con IdModelos=0 o sin mapeo se omiten sin abortar', async () => {
    // El test de idempotencia ya verifica los conteos; este confirma que el ETL
    // NO lanza excepción aunque haya renglones inválidos en los CSV.
    await expect(ejecutarEtlModelos(cliente)).resolves.not.toThrow();
  }, 60_000);

  it('fotos omitidas limpiamente cuando ETL_FOTOS_MOD_DIR y ETL_FOTOS_BOR_DIR no están', async () => {
    await ejecutarEtlModelos(cliente);
    // Sin carpetas configuradas → cero ModeloFoto.
    expect(await cliente.modeloFoto.count()).toBe(0);
  }, 60_000);
});
