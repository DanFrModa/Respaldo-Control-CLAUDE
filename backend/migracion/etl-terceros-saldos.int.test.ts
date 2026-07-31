/**
 * Integración del ETL de SALDOS INICIALES de terceros (F9-E6) — Postgres efímero (testcontainers).
 * Fixture CSV committeado (`__fixtures__/tablas-f9-saldos/saldos.csv`). Verifica:
 *  • los dos modos (detalle con/ sin UUID, saldo neto ±) crean el movimiento correcto (origen/signo/fiscal);
 *  • el SALDO por tercero = Σ monto del motor (D3) y el AGING (fechaVencimiento = fecha + días de crédito);
 *  • el tercero que no está en el catálogo se OMITE (no aborta la corrida);
 *  • IDEMPOTENCIA: la 2ª corrida NO crea nada nuevo (0 duplicados);
 *  • el CUADRE F9 cuadra el corte (saldoEsperado) contra las aperturas cargadas.
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { registrarMovimientoTercero } from '../src/dominio/terceros/cuenta-terceros.js';
import { insertarAperturasMigradas } from '../src/dominio/terceros/migracion.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlTercerosSaldos } from './etl-terceros-saldos.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { ENTIDAD_MAPEO } from './comun/mapeo.js';
import { calcularCuadreF9 } from './cuadre-f9.js';

let cliente: PrismaClient;
const FIXTURE = fileURLToPath(
  new URL('./__fixtures__/tablas-f9-saldos/saldos.csv', import.meta.url),
);
const CORTE = new Date('2026-06-30T00:00:00.000Z');

let idEmpresa: number;
let idP1: number; // Telas del Norte (rfc AAA…, 30 días)
let idP2: number; // Proveedor Dos (rfc BBB…, contado)
let idC1: number; // Cliente Uno (rfc XAXX…, 15 días)

beforeEach(async () => {
  cliente = clientePruebas();
  await limpiarBaseDatos(cliente);
  await sembrarPermisos(cliente);

  const empresa = await cliente.empresa.create({
    data: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true, rfc: 'FRM010101AAA' },
  });
  idEmpresa = empresa.id;

  idP1 = (
    await cliente.proveedor.create({
      data: { nombre: 'Telas del Norte', rfc: 'AAA010101AA1', diasCredito: 30 },
    })
  ).id;
  idP2 = (
    await cliente.proveedor.create({
      data: { nombre: 'Proveedor Dos', rfc: 'BBB020202BB2', diasCredito: 0 },
    })
  ).id;
  idC1 = (
    await cliente.cliente.create({
      data: { nombre: 'Cliente Uno', rfc: 'XAXX010101000', diasCredito: 15 },
    })
  ).id;
});

afterAll(async () => {
  await cliente.$disconnect();
});

/** Σ monto (saldo derivado, D3) de un tercero. */
async function saldo(campo: 'idProveedor' | 'idCliente', id: number): Promise<number> {
  const r = await cliente.movimientoTercero.aggregate({
    where: { [campo]: id },
    _sum: { monto: true },
  });
  return Number(r._sum.monto ?? 0);
}

describe('ETL de saldos iniciales F9-E6 (integración)', () => {
  it('carga los dos modos con origen/signo/fiscal correctos y es IDEMPOTENTE', async () => {
    await ejecutarEtlTercerosSaldos(cliente, FIXTURE, { corte: CORTE });

    // 6 movimientos: P1 (2 facturas + 1 sin factura), C1 (1 factura + 1 anticipo), P2 (1 neto).
    // El proveedor ZZZ (no en catálogo) se OMITE.
    expect(await cliente.movimientoTercero.count()).toBe(6);

    // Saldos = Σ monto (cargos + / abonos −).
    expect(await saldo('idProveedor', idP1)).toBe(1750); // 1000 + 500 + 250
    expect(await saldo('idCliente', idC1)).toBe(500); // 800 − 300
    expect(await saldo('idProveedor', idP2)).toBe(2000);

    // Los dos con UUID son FISCALES; el de folio, NO fiscal.
    const facturaU1 = await cliente.movimientoTercero.findFirstOrThrow({
      where: { uuidCfdi: 'U1' },
    });
    expect(facturaU1.origen).toBe('factura_proveedor');
    expect(facturaU1.esFiscal).toBe(true);
    expect(facturaU1.rfcTercero).toBe('AAA010101AA1');

    const facturaVenta = await cliente.movimientoTercero.findFirstOrThrow({
      where: { uuidCfdi: 'U3' },
    });
    expect(facturaVenta.origen).toBe('factura_cliente');
    expect(facturaVenta.tipoTercero).toBe('cliente');
    expect(Number(facturaVenta.monto)).toBe(800);

    const sinFactura = await cliente.movimientoTercero.findFirstOrThrow({
      where: { idProveedor: idP1, esFiscal: false },
    });
    expect(sinFactura.origen).toBe('entrada_sin_factura');
    expect(sinFactura.uuidCfdi).toBeNull();

    // El anticipo del cliente es un ABONO (baja el saldo).
    const anticipo = await cliente.movimientoTercero.findFirstOrThrow({
      where: { idCliente: idC1, origen: 'abono' },
    });
    expect(Number(anticipo.monto)).toBe(-300);

    // Idempotencia: 2ª corrida no crea nada.
    await ejecutarEtlTercerosSaldos(cliente, FIXTURE, { corte: CORTE });
    expect(await cliente.movimientoTercero.count()).toBe(6);
  }, 120_000);

  it('deriva el AGING (fechaVencimiento = fecha + días de crédito; los abonos no vencen)', async () => {
    await ejecutarEtlTercerosSaldos(cliente, FIXTURE, { corte: CORTE });

    // Factura U1: 2026-01-15 + 30 días = 2026-02-14.
    const u1 = await cliente.movimientoTercero.findFirstOrThrow({ where: { uuidCfdi: 'U1' } });
    expect(u1.fechaVencimiento?.toISOString().slice(0, 10)).toBe('2026-02-14');

    // Venta U3: 2026-02-01 + 15 días = 2026-02-16.
    const u3 = await cliente.movimientoTercero.findFirstOrThrow({ where: { uuidCfdi: 'U3' } });
    expect(u3.fechaVencimiento?.toISOString().slice(0, 10)).toBe('2026-02-16');

    // Saldo neto de P2 (contado): vence el mismo día del corte.
    const neto = await cliente.movimientoTercero.findFirstOrThrow({ where: { idProveedor: idP2 } });
    expect(neto.fecha.toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(neto.fechaVencimiento?.toISOString().slice(0, 10)).toBe('2026-06-30');

    // El abono NO vence.
    const abono = await cliente.movimientoTercero.findFirstOrThrow({
      where: { idCliente: idC1, origen: 'abono' },
    });
    expect(abono.fechaVencimiento).toBeNull();
  });

  it('folios consecutivos por empresa (A3) y bitácora de migración (A7)', async () => {
    await ejecutarEtlTercerosSaldos(cliente, FIXTURE, { corte: CORTE });
    const movs = await cliente.movimientoTercero.findMany({
      select: { folio: true, idEmpresa: true },
    });
    expect(movs.every((m) => m.idEmpresa === idEmpresa)).toBe(true);
    const folios = movs.map((m) => Number(m.folio)).sort((a, b) => a - b);
    // Los bloques reservados son contiguos y disjuntos → la unión es exactamente 1..6 (A3).
    expect(folios).toEqual([1, 2, 3, 4, 5, 6]);
    // Bitácora de la migración (una por bloque).
    const bitacora = await cliente.bitacora.count({ where: { entidad: 'MovimientoTercero' } });
    expect(bitacora).toBeGreaterThan(0);
  });

  it('coexistencia migración↔captura: el bloque de aperturas arranca en V+1 (A3, una sola numeración)', async () => {
    // Escenario go-live F10: la BD ya tiene movimientos capturados cuando llega el corte. Este caso usa
    // una EMPRESA y un TERCERO PROPIOS (y claves de idempotencia propias), AISLADO del fixture que
    // consumen los demás tests — así no altera el estado que ve el cuadre.
    const empresaCoex = await cliente.empresa.create({
      data: { nombre: 'Coexistencia SA', paraIpt: true, paraEdr: true, favorita: false },
    });
    const provCoex = await cliente.proveedor.create({
      data: { nombre: 'Proveedor Coex', rfc: 'COE010101AA1', diasCredito: 30 },
    });

    // Una CAPTURA normal (vía el motor) AVANZA la secuencia de ESA empresa → folio V (=1).
    const captura = await registrarMovimientoTercero(
      sesionEtl(empresaCoex.id),
      {
        tipoTercero: 'proveedor',
        idTercero: provCoex.id,
        fecha: '2026-06-01',
        origen: 'pago',
        importe: 100,
        esFiscal: false,
      },
      { cliente }, // enruta al cliente de testcontainers (como los demás int tests)
    );
    expect(Number(captura.folio)).toBe(1);

    // El MODO MIGRACIÓN corre DESPUÉS: reserva su bloque sobre la MISMA serie de esa empresa → arranca
    // en V+1 (=2), contiguo y sin solaparse con la captura previa (una sola numeración por empresa, A3).
    const res = await insertarAperturasMigradas(
      sesionEtl(empresaCoex.id),
      empresaCoex.id,
      { tipoTercero: 'proveedor', idTercero: provCoex.id, diasCredito: 30 },
      ENTIDAD_MAPEO.aperturaTercero,
      [
        {
          origen: 'entrada_sin_factura',
          fecha: new Date('2026-05-01T00:00:00.000Z'),
          importe: 500,
          esFiscal: false,
          claveFuente: 'coex:1',
        },
        {
          origen: 'entrada_sin_factura',
          fecha: new Date('2026-05-02T00:00:00.000Z'),
          importe: 700,
          esFiscal: false,
          claveFuente: 'coex:2',
        },
      ],
      { cliente },
    );
    expect(Number(res.folioDesde)).toBe(2); // arranca en V+1
    expect(Number(res.folioHasta)).toBe(3);

    const folios = (
      await cliente.movimientoTercero.findMany({
        where: { idEmpresa: empresaCoex.id },
        select: { folio: true },
      })
    )
      .map((m) => Number(m.folio))
      .sort((a, b) => a - b);
    expect(folios).toEqual([1, 2, 3]); // captura(1) + 2 aperturas contiguas, sin solape
  });

  it('CUADRE F9: el corte (saldoEsperado) cuadra contra las aperturas cargadas', async () => {
    await ejecutarEtlTercerosSaldos(cliente, FIXTURE, { corte: CORTE });
    const c = await calcularCuadreF9(cliente, FIXTURE, { corte: CORTE });

    // 3 terceros comparados (P1, P2, C1), todos cuadran.
    expect(c.comparados).toBe(3);
    expect(c.cuadran).toBe(3);
    expect(c.descuadran).toBe(0);
    expect(c.totalEsperado).toBe(4250); // 1750 + 500 + 2000
    expect(c.totalV2).toBe(4250);
    expect(c.aperturasCargadas).toBe(6);
    // El proveedor ZZZ del CSV no resuelve → fuera del comparado.
    expect(c.filasSinResolver).toBe(1);
  });
});
