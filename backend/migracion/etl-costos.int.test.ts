/**
 * Integración del ETL de COSTOS (F7-E6) — corre en CI (testcontainers), NO en local.
 *
 * Fixtures committeados en `migracion/__fixtures__/tablas-f7-costos/` (apuntados por `TABLAS_DIR`).
 * Siembra el estado que consume: permisos, empresa, cliente/modelo y 3 órdenes con su mapeo de F2
 * (10 costeable, 11 costeable con regalía, 12 marcada `noCostear`). La orden 999 del CSV no se mapea.
 *
 * Verifica: conteos + IDEMPOTENCIA; el mapeo D2 (procesos = maquila + bordado; avíos = habilitación;
 * REGALÍA fuera → costoTotal la EXCLUYE); orden `noCostear` OMITIDA; orden sin mapeo OMITIDA; y el
 * análisis de regalías del cuadre (el `Costo` viejo incluía la regalía → delta esperado).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlCostos } from './etl-costos.js';
import { analizarRegalias, calcularCuadreF7 } from './cuadre-f7.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';

let cliente: PrismaClient;
const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f7-costos', import.meta.url));
let tablasDirPrevio: string | undefined;

let idEmpresa: number;
let idOrden10: number;
let idOrden11: number;
let idOrden12: number;

beforeEach(async () => {
  cliente = clientePruebas();
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  await sembrarEstado();
});

afterAll(async () => {
  if (tablasDirPrevio === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = tablasDirPrevio;
  await cliente.$disconnect();
});

async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);
  const empresa = await cliente.empresa.create({
    data: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresa = empresa.id;
  const cli = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'M100' } });

  idOrden10 = await crearOrden(cli.id, modelo.id, 100, false);
  idOrden11 = await crearOrden(cli.id, modelo.id, 101, false);
  idOrden12 = await crearOrden(cli.id, modelo.id, 102, true); // noCostear
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 10, idOrden10);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 11, idOrden11);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 12, idOrden12);
  // La orden 999 del CSV queda sin mapeo a propósito.
}

async function crearOrden(
  idCliente: number,
  idModelo: number,
  folio: number,
  noCostear: boolean,
): Promise<number> {
  const o = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa,
      idModelo,
      idCliente,
      estado: 'completa',
      fechaCompletada: new Date(),
      noCostear,
    },
  });
  return o.id;
}

describe('ETL de costos F7-E6 (integración, fixtures committeados)', () => {
  it('carga con conteos EXACTOS y es IDEMPOTENTE', async () => {
    await ejecutarEtlCostos(cliente);
    expect(await cliente.costoOrden.count()).toBe(2); // 10 y 11 (12 noCostear, 999 sin mapeo)
    await ejecutarEtlCostos(cliente);
    expect(await cliente.costoOrden.count()).toBe(2);
  }, 120_000);

  it('MAPEO D2: procesos = maquila + bordado; avíos = habilitación; costoTotal EXCLUYE la regalía', async () => {
    await ejecutarEtlCostos(cliente);
    const c10 = await cliente.costoOrden.findUniqueOrThrow({ where: { idOrden: idOrden10 } });
    expect(Number(c10.telaCost)).toBe(20.3);
    expect(Number(c10.aviosCost)).toBe(1.79);
    expect(Number(c10.procesosCost)).toBe(9.5); // 7.00 maquila + 2.50 bordado
    expect(Number(c10.costoTotal)).toBe(31.59);

    const c11 = await cliente.costoOrden.findUniqueOrThrow({ where: { idOrden: idOrden11 } });
    expect(Number(c11.procesosCost)).toBe(8); // 5 maquila + 3 bordado
    // costoTotal = 10 + 8 + 2 + 0 = 20 (la regalía 7.00 NO entra — D2). El Costo viejo era 27.
    expect(Number(c11.costoTotal)).toBe(20);
  });

  it('orden noCostear y orden sin mapeo NO se costean', async () => {
    await ejecutarEtlCostos(cliente);
    expect(await cliente.costoOrden.count({ where: { idOrden: idOrden12 } })).toBe(0);
  });

  it('CUADRE de regalías: el Costo viejo INCLUÍA la regalía (delta esperado = Σ RegaliasCost)', async () => {
    const reg = analizarRegalias();
    expect(reg.conRegalia).toBe(1); // solo IdCostoOrd=2 trae regalía
    expect(reg.costoIncluyeRegalia).toBe(1); // 27 == 10+2+3+5+7+0
    expect(reg.costoExcluyeRegalia).toBe(0);
    expect(reg.sumaRegalias).toBe(7);

    await ejecutarEtlCostos(cliente);
    const cuadre = await calcularCuadreF7(cliente);
    expect(cuadre.costosV2.sumaCostoTotal).toBe(51.59); // 31.59 + 20 (sin regalía)
  });
});
