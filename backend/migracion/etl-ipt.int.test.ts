/**
 * Integración del ETL de inventario PT (kardex histórico, F3-E6 Pieza B) — corre en CI
 * (testcontainers), NO en local.
 *
 * Como en F1/F2, la carpeta `Respaldo CLAUDE/TABLAS/` NO existe en CI: este test apunta el ETL a
 * fixtures CSV pequeños COMMITEADOS (`migracion/__fixtures__/tablas-f3/`) vía `TABLAS_DIR`, y siembra
 * a mano el ESTADO que el ETL de F3 consume (permisos, empresa + mapeo, almacenes PT + mapeo, modelos
 * por código, tipos de movimiento), para no depender de los ETL de F1/F2.
 *
 * Verifica:
 *  • Conteos EXACTOS deterministas (movimientos creados/omitidos según los escenarios del fixture).
 *  • SENTINELA (c): el Color/Talla `(sin especificar)` se crea INACTIVO y todo el kardex lo usa.
 *  • EMPRESA del modelo: un modelo con empresa sin mapeo → movimiento OMITIDO (no se inventa empresa).
 *  • TIPO 0/vacío → tipo derivado de EnSa (Otras Entradas/Salidas); dirección discordante (tipo 9
 *    traspaso) → se carga por EnSa y se cuenta como discordante.
 *  • EXISTENCIA = Σ de movimientos (D3): la suma del kardex por modelo×almacén es la esperada.
 *  • IDEMPOTENCIA: 2ª corrida no duplica.
 *  • CUADRE F3: el bloque de NO DOBLE CONTEO da verde (todo el kardex es origen 'migracion').
 */
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DireccionMovimiento, type PrismaClient } from '../src/datos/index.js';
import { ORIGEN } from '../src/comun/origenes.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { calcularCuadreF3 } from './cuadre-f3.js';
import { ejecutarEtlIpt } from './etl-ipt.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';
import { COLOR_SENTINELA, TALLA_SENTINELA } from './loaders/ipt-kardex.js';

let cliente: PrismaClient;

const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f3', import.meta.url));
let tablasDirPrevio: string | undefined;

/** Empresa FR Moda (IdEmpresas=8 en el fixture → id nuevo). */
let idEmpresaFR: number;
let idAlmPrimeras: number;
let idAlmSegundas: number;
let idModeloM001: number;
let idModeloM002: number;

/** Los tipos de movimiento que el ETL resuelve por código (subconjunto del seed canónico). */
const TIPOS: { codigo: string; nombre: string; direccion: DireccionMovimiento }[] = [
  {
    codigo: 'inventario-inicial',
    nombre: 'Inventario Inicial',
    direccion: DireccionMovimiento.entrada,
  },
  {
    codigo: 'entrada-maquila',
    nombre: 'Entrada de Maquila',
    direccion: DireccionMovimiento.entrada,
  },
  { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: DireccionMovimiento.salida },
  {
    codigo: 'transferencia-almacenes',
    nombre: 'Transferencia entre almacenes',
    direccion: DireccionMovimiento.traspaso,
  },
  { codigo: 'otras-entradas', nombre: 'Otras Entradas', direccion: DireccionMovimiento.entrada },
  { codigo: 'otras-salidas', nombre: 'Otras Salidas', direccion: DireccionMovimiento.salida },
];

/** Siembra el estado de F1/F2 que el ETL de F3 (IPT) consume. */
async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);

  const empresa = await cliente.empresa.create({
    data: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresaFR = empresa.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.empresa, 8, empresa.id);
  // Empresa 0 (modelo 4 del fixture) NO se mapea a propósito → su movimiento se omite.

  // Almacenes PT (globales) + mapeo Almacen:IPT (IdIPT_Almacenes 1=Primeras, 2=Segundas).
  const prim = await cliente.almacen.create({
    data: { nombre: 'Primeras', tipo: 'PT', idEmpresa: null },
  });
  const seg = await cliente.almacen.create({
    data: { nombre: 'Segundas', tipo: 'PT', idEmpresa: null },
  });
  idAlmPrimeras = prim.id;
  idAlmSegundas = seg.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.almacenIpt, 1, prim.id);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.almacenIpt, 2, seg.id);

  // Modelos por código (= IPT_Modelos.NumMod). M999/M004 del fixture NO existen.
  const m1 = await cliente.modelo.create({ data: { codigo: 'M001' } });
  const m2 = await cliente.modelo.create({ data: { codigo: 'M002' } });
  idModeloM001 = m1.id;
  idModeloM002 = m2.id;

  // Tipos de movimiento (subconjunto del seed canónico que el fixture ejercita).
  await cliente.tipoMovimientoInventario.createMany({ data: TIPOS });
}

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  await sembrarEstado();
});

afterEach(() => {
  if (tablasDirPrevio === undefined) {
    delete process.env.TABLAS_DIR;
  } else {
    process.env.TABLAS_DIR = tablasDirPrevio;
  }
});

/** Σ del kardex por modelo×almacén (entrada +, salida −), directo del detalle (D3). */
async function existencia(idModelo: number, idAlmacen: number): Promise<number> {
  const filas = await cliente.$queryRaw<{ existencia: bigint | null }[]>`
    SELECT COALESCE(SUM(d."cantidad" * CASE t."direccion"
      WHEN 'entrada' THEN 1 WHEN 'salida' THEN -1 ELSE 0 END), 0)::bigint AS existencia
    FROM "movimiento_det_pt" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE d."id_modelo" = ${idModelo} AND m."id_almacen" = ${idAlmacen}
  `;
  return Number(filas[0]?.existencia ?? 0n);
}

describe('ETL de inventario PT (kardex histórico) F3-E6 Pieza B (integración, fixtures)', () => {
  it('carga con conteos EXACTOS y es IDEMPOTENTE; existencias = Σ movimientos (D3)', async () => {
    await ejecutarEtlIpt(cliente);

    // De 9 IPT_MovsDet: 5 se crean (100,101,102,103,104); 4 se omiten:
    //  106 (modelo M999 sin código en v2), 107 (modelo de empresa 0 no mapeada),
    //  108 (CantMov 0), 109 (IdIPT_Mod_Alm 999 inexistente).
    const movimientos = await cliente.movimiento.count({ where: { origenTipo: ORIGEN.migracion } });
    expect(movimientos).toBe(5);
    const dets = await cliente.movimientoDetPt.count();
    expect(dets).toBe(5);

    // Existencias = Σ de movimientos:
    //  M001/Primeras: +100 (inv inicial) −10 (entrega) = 90.
    //  M001/Segundas: +5 (inv inicial segundas) = 5.
    //  M002/Primeras: +40 (tipo 0 → otras-entradas) +8 (tipo 9 → otras-entradas por EnSa) = 48.
    expect(await existencia(idModeloM001, idAlmPrimeras)).toBe(90);
    expect(await existencia(idModeloM001, idAlmSegundas)).toBe(5);
    expect(await existencia(idModeloM002, idAlmPrimeras)).toBe(48);

    // Idempotencia: 2ª corrida no duplica.
    await ejecutarEtlIpt(cliente);
    expect(await cliente.movimiento.count({ where: { origenTipo: ORIGEN.migracion } })).toBe(5);
    expect(await cliente.movimientoDetPt.count()).toBe(5);
  }, 180_000);

  it('SENTINELA (c): Color/Talla "(sin especificar)" INACTIVOS y usados por TODO el kardex', async () => {
    await ejecutarEtlIpt(cliente);

    const color = await cliente.color.findUniqueOrThrow({ where: { nombre: COLOR_SENTINELA } });
    const talla = await cliente.talla.findUniqueOrThrow({ where: { etiqueta: TALLA_SENTINELA } });
    expect(color.activo).toBe(false);
    expect(talla.activo).toBe(false);

    // TODOS los renglones de detalle usan el color/talla sentinela.
    const dets = await cliente.movimientoDetPt.findMany({
      select: { idColor: true, idTalla: true },
    });
    expect(dets).toHaveLength(5);
    for (const d of dets) {
      expect(d.idColor).toBe(color.id);
      expect(d.idTalla).toBe(talla.id);
    }
  });

  it('EMPRESA del modelo manda: el movimiento se sella con la empresa del modelo viejo', async () => {
    await ejecutarEtlIpt(cliente);
    const movs = await cliente.movimiento.findMany({
      where: { origenTipo: ORIGEN.migracion },
      select: { idEmpresa: true },
    });
    expect(movs.every((m) => m.idEmpresa === idEmpresaFR)).toBe(true);
  });

  it('TIPO 0/vacío → derivado de EnSa; dirección discordante (tipo 9) → por EnSa', async () => {
    await ejecutarEtlIpt(cliente);
    // Det 103 (Mov 4, tipo 0, EnSa 1) → otras-entradas (entrada).
    const otrasEnt = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
      where: { codigo: 'otras-entradas' },
    });
    const m4 = await cliente.movimiento.findFirstOrThrow({ where: { origenId: '103' } });
    expect(m4.idTipoMov).toBe(otrasEnt.id);
    // Det 104 (Mov 5, tipo 9 traspaso, EnSa 1) → también otras-entradas (discordante).
    const m5 = await cliente.movimiento.findFirstOrThrow({ where: { origenId: '104' } });
    expect(m5.idTipoMov).toBe(otrasEnt.id);
  });

  it('CONSERVA IdRecibos como referencia informativa en observaciones (NO FK ni efecto)', async () => {
    await ejecutarEtlIpt(cliente);
    // Mov 4 (IdRecibos=555) → su detalle 103.
    const m4 = await cliente.movimiento.findFirstOrThrow({ where: { origenId: '103' } });
    expect(m4.observaciones).toContain('IdRecibos=555');
  });

  it('CUADRE F3: NO doble conteo (todo el kardex es origen migración) y existencias listan descuadres', async () => {
    await ejecutarEtlIpt(cliente);
    const cuadre = await calcularCuadreF3(cliente);

    // (3) No doble conteo: todos los movimientos de kardex son origen 'migracion'; 0 de recibo.
    expect(cuadre.noDobleConteo.totalKardex).toBe(5);
    expect(cuadre.noDobleConteo.conOrigenMigracion).toBe(5);
    expect(cuadre.noDobleConteo.conOrigenRecibo).toBe(0);
    expect(cuadre.noDobleConteo.conOtroOrigen).toBe(0);
    expect(cuadre.noDobleConteo.inconsistencias).toHaveLength(0);

    // (2) Existencias: M001/Primeras (90) y M001/Segundas (5) cuadran; M002/Primeras descuadra
    //     (kardex 48 vs Existencia 40 del viejo) → se LISTA, no se corrige.
    expect(cuadre.existencias.cuadran).toBe(2);
    expect(cuadre.existencias.descuadran).toBe(1);
    expect(cuadre.existencias.descuadres.some((d) => d.includes('Δ=8'))).toBe(true);
    // IPT_Mod_Alm 13 (M999) y 14 (M004 empresa 0) no son mapeables.
    expect(cuadre.existencias.noMapeables).toBe(2);
  });
});
