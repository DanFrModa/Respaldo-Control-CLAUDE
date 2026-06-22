/**
 * Integración del ETL de inventario de TELAS (kardex histórico, F4-E6 Pieza B) — corre en CI
 * (testcontainers), NO en local.
 *
 * Como en F3, la carpeta `Respaldo CLAUDE/TABLAS/` NO existe en CI: este test apunta el ETL a
 * fixtures CSV pequeños COMMITEADOS (`migracion/__fixtures__/tablas-f4-telas/`) vía `TABLAS_DIR`, y
 * siembra a mano el ESTADO que el ETL consume (permisos, empresa favorita + mapeo, almacenes de tela
 * + mapeo, telas por código + mapeo, colores + mapeo, una orden + su mapeo, tipos de movimiento).
 *
 * Verifica:
 *  • CLASIFICACIÓN: 1 par de traspaso detectado; 3 entradas de compra; 1 salida a orden; 1 salida sin
 *    clasificar (ajuste-salida). 7 movimientos de kardex de tela en total (2 patas por traspaso).
 *  • ENTRADA de compra SIN RecepcionCompra (cero recepciones creadas).
 *  • SALIDA ligada a ORDEN: origenTipo='salida-tela-orden', origenId=idOrden, empresa de la orden.
 *  • LOTE de 2 componentes: la tela de 2 partes (Felpa+Cardigan) suma TelaEnt1+TelaEnt2 en la cantidad
 *    del kardex; el lote legacy se sintetiza por color y se reusa por entradas/salidas del color.
 *  • EXISTENCIA = Σ de movimientos (D3): la suma por color×almacén es la esperada; el cuadre lista el
 *    único descuadre (saldo viejo editado a mano) sin corregirlo.
 *  • IDEMPOTENCIA: 2ª corrida no duplica.
 *  • CUADRE F4 (telas): NO doble conteo (0 movimientos de tela con origen recepcion-compra).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DireccionMovimiento, type PrismaClient } from '../src/datos/index.js';
import { ORIGEN } from '../src/comun/origenes.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { calcularCuadreF4 } from './cuadre-f4.js';
import { ejecutarEtlTelas } from './etl-telas.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';

let cliente: PrismaClient;

const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f4-telas', import.meta.url));
let tablasDirPrevio: string | undefined;

let idEmpresaFR: number;
let idAlmA: number; // alm v1 = 2
let idAlmB: number; // alm v1 = 3
let idTela10: number; // tela de 2 componentes (Felpa+Cardigan)
let idOrden7: number;

/** Tipos de movimiento de tela que el ETL resuelve por código (subconjunto del seed). */
const TIPOS: { codigo: string; nombre: string; direccion: DireccionMovimiento }[] = [
  {
    codigo: 'entrada-recepcion',
    nombre: 'Entrada por Recepción de Compra',
    direccion: DireccionMovimiento.entrada,
  },
  {
    codigo: 'salida-a-orden',
    nombre: 'Salida de Tela a Orden',
    direccion: DireccionMovimiento.salida,
  },
  {
    codigo: 'ajuste-salida',
    nombre: 'Ajuste de Inventario (Salida)',
    direccion: DireccionMovimiento.salida,
  },
  {
    codigo: 'transferencia-salida',
    nombre: 'Transferencia (Salida)',
    direccion: DireccionMovimiento.salida,
  },
  {
    codigo: 'transferencia-entrada',
    nombre: 'Transferencia (Entrada)',
    direccion: DireccionMovimiento.entrada,
  },
];

/** Siembra el estado de F1/F2 que el ETL de telas consume. */
async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);

  const empresa = await cliente.empresa.create({
    data: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresaFR = empresa.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.empresa, 8, empresa.id);

  // Almacenes de TELA (globales) + mapeo Almacen:Tela (IdAlmacenes 2 y 3).
  const a = await cliente.almacen.create({
    data: { nombre: 'Naucalpan', tipo: 'TELA', idEmpresa: null },
  });
  const b = await cliente.almacen.create({
    data: { nombre: 'Oscar', tipo: 'TELA', idEmpresa: null },
  });
  idAlmA = a.id;
  idAlmB = b.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.almacenTela, 2, a.id);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.almacenTela, 3, b.id);

  // Telas por IdTelas (mapeo Tela:IdTelas). 10 = 2 componentes; 20 = simple.
  const t10 = await cliente.tela.create({
    data: { nombre: 'Felpa Doble', tipoComponente: 'CUERPO' },
  });
  const t20 = await cliente.tela.create({
    data: { nombre: 'Licra Simple', tipoComponente: 'OTRO' },
  });
  idTela10 = t10.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelas, 10, t10.id);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelas, 20, t20.id);

  // Colores + mapeo Color (texto → idColor): Marino(100), Blanco(101), Negro(200).
  for (const nombre of ['Marino', 'Blanco', 'Negro']) {
    const c = await cliente.color.create({ data: { nombre } });
    await guardarMapeo(cliente, ENTIDAD_MAPEO.color, nombre, c.id);
  }

  // Una orden (IdOrdenes=7) para la salida ligada a orden + su mapeo.
  const cli = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'MOD-7' } });
  const orden = await cliente.orden.create({
    data: { folio: 1n, idEmpresa: idEmpresaFR, idModelo: modelo.id, idCliente: cli.id },
  });
  idOrden7 = orden.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 7, orden.id);

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
  if (tablasDirPrevio === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = tablasDirPrevio;
});

/** Σ del kardex por (idLote del color, idAlmacen) — entrada +, salida − (D3). */
async function existenciaColor(idTelasColores: string, idAlmacen: number): Promise<number> {
  const idLote = await cliente.mapeoMigracion.findUnique({
    where: {
      entidad_claveVieja: { entidad: ENTIDAD_MAPEO.loteLegacyTela, claveVieja: idTelasColores },
    },
    select: { idNuevo: true },
  });
  if (idLote === null) return 0;
  const filas = await cliente.$queryRaw<{ existencia: string | null }[]>`
    SELECT COALESCE(SUM(d."cantidad" * CASE t."direccion"
      WHEN 'entrada' THEN 1 WHEN 'salida' THEN -1 ELSE 0 END), 0)::text AS existencia
    FROM "movimiento_det_tela" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE d."id_lote" = ${Number(idLote.idNuevo)} AND m."id_almacen" = ${idAlmacen}
  `;
  return Number(filas[0]?.existencia ?? '0');
}

describe('ETL de inventario de TELAS (kardex histórico) F4-E6 Pieza B (integración, fixtures)', () => {
  it('CLASIFICA, migra con conteos EXACTOS y es IDEMPOTENTE; existencias = Σ movimientos (D3)', async () => {
    await ejecutarEtlTelas(cliente);

    // 7 movimientos de kardex de tela: 3 entradas + 1 salida-a-orden + 1 ajuste-salida + 2 patas traspaso.
    const movs = await cliente.movimiento.count({ where: { detallesTela: { some: {} } } });
    expect(movs).toBe(7);

    // Patas de traspaso (origen + destino).
    const patas = await cliente.movimiento.count({
      where: { detallesTela: { some: {} }, origenTipo: ORIGEN.traspaso },
    });
    expect(patas).toBe(2);

    // NINGUNA RecepcionCompra creada (entradas legacy van directo al kardex).
    expect(await cliente.recepcionCompra.count()).toBe(0);

    // Existencias = Σ de movimientos por color×almacén:
    //  (100,A) +145 −45 = 100 ; (101,A) +25 = 25 ; (200,A) +20 −5 −5 = 10 ; (200,B) +5 = 5.
    expect(await existenciaColor('100', idAlmA)).toBeCloseTo(100, 4);
    expect(await existenciaColor('101', idAlmA)).toBeCloseTo(25, 4);
    expect(await existenciaColor('200', idAlmA)).toBeCloseTo(10, 4);
    expect(await existenciaColor('200', idAlmB)).toBeCloseTo(5, 4);

    // Idempotencia: 2ª corrida no duplica.
    await ejecutarEtlTelas(cliente);
    expect(await cliente.movimiento.count({ where: { detallesTela: { some: {} } } })).toBe(7);
  }, 180_000);

  it('LOTE de 2 componentes: la cantidad del kardex suma TelaEnt1+TelaEnt2', async () => {
    await ejecutarEtlTelas(cliente);
    // Entrada 1 de la tela 10 (2 componentes) a (100,A): TelaEnt1=130 + TelaEnt2=15 = 145.
    const entrada = await cliente.movimiento.findFirstOrThrow({
      where: {
        origenTipo: ORIGEN.migracion,
        tipoMov: { direccion: DireccionMovimiento.entrada },
        idAlmacen: idAlmA,
        detallesTela: { some: { idTela: idTela10 } },
      },
      include: { detallesTela: true },
    });
    const det = entrada.detallesTela.find((d) => d.idTela === idTela10);
    expect(det).toBeDefined();
    expect(Number(det?.cantidad)).toBeCloseTo(145, 4);
    // El costoUnit de la entrada de compra viene de TelasColores.Precio (Marino=57).
    expect(Number(det?.costoUnit)).toBeCloseTo(57, 4);
  });

  it('SALIDA ligada a ORDEN: origenTipo=salida-tela-orden, origenId=idOrden, empresa de la orden', async () => {
    await ejecutarEtlTelas(cliente);
    const salida = await cliente.movimiento.findFirstOrThrow({
      where: { origenTipo: ORIGEN.salidaTelaOrden },
      select: { origenId: true, idEmpresa: true },
    });
    expect(salida.origenId).toBe(String(idOrden7));
    expect(salida.idEmpresa).toBe(idEmpresaFR);
  });

  it('TRASPASO pareado: una pata de salida del origen y una de entrada al destino', async () => {
    await ejecutarEtlTelas(cliente);
    const patas = await cliente.movimiento.findMany({
      where: { detallesTela: { some: {} }, origenTipo: ORIGEN.traspaso },
      select: { idAlmacen: true, idTipoMov: true, tipoMov: { select: { direccion: true } } },
    });
    expect(patas).toHaveLength(2);
    const almacenes = patas.map((p) => p.idAlmacen).sort((a, b) => a - b);
    expect(almacenes).toEqual([idAlmA, idAlmB].sort((a, b) => a - b));
    const direcciones = patas.map((p) => p.tipoMov.direccion).sort();
    expect(direcciones).toEqual([DireccionMovimiento.entrada, DireccionMovimiento.salida].sort());
  });

  it('CUADRE F4: NO doble conteo (0 movimientos de tela con origen recepcion-compra) y lista el descuadre', async () => {
    await ejecutarEtlTelas(cliente);
    const cuadre = await calcularCuadreF4(cliente);

    // (3) No doble conteo.
    expect(cuadre.noDobleConteo.totalKardex).toBe(7);
    expect(cuadre.noDobleConteo.conOrigenRecepcion).toBe(0);
    expect(cuadre.noDobleConteo.inconsistencias).toHaveLength(0);

    // (2) Existencias: 4 combinaciones (saldo≠0) comparables — (100,A),(101,A),(200,A),(200,B);
    //     (100,B) tiene saldo 0 → no se compara. Cuadran 3, descuadra 1 (101,A: v2=25 vs v1=30).
    expect(cuadre.existencias.comparadas).toBe(4);
    expect(cuadre.existencias.cuadran).toBe(3);
    expect(cuadre.existencias.descuadran).toBe(1);
    expect(cuadre.existencias.descuadres.some((d) => d.includes('IdTelasColores=101'))).toBe(true);
  });
});
