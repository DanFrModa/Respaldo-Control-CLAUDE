/**
 * Tests de integración de CxP — CUENTAS POR PAGAR (F9-E2). Postgres efímero (testcontainers). Cubre
 * lo específico de CxP que compone sobre el motor de terceros (F9-E1):
 *  (a) captura de movimientos por proveedor (cargo entrada + pago) → el saldo baja;
 *  (b) el cargo desde recepción liga la OC real (`refTipo='orden-compra'`/`refId`);
 *  (c) el AGING de la bandeja reparte por días de atraso y NETEA los pagos (más viejo primero);
 *  (d) el RESUMEN (cartera/vencido/% al corriente/# proveedores) se calcula server-side;
 *  (e) el proveedor INFORMAL (esFiscal=false) sale en la vista operativa y VACÍO en la fiscal;
 *  (f) el filtro "con-saldo" excluye a los proveedores con saldo 0; "todos" los incluye;
 *  (g) A9: la empresa ajena no se cuela en la bandeja;
 *  (h) A4: deny-by-default de `cxp.ver`/`cxp.administrar`, y defensa en profundidad (el motor exige
 *      además `terceros.administrar` → falla cerrado sin él);
 *  (i) la cancelación de CxP es por inverso auditado y rechaza un movimiento que NO es de proveedor;
 *  (j) el estado de cuenta del proveedor delega al motor (incluye la convivencia EsMa);
 *  (k) §Post-F9.188(a): el maquilero con TODO sin revisar NO desaparece de la bandeja (saldo 0 +
 *      «por revisar» explicado); los KPIs siguen contando sólo saldo ≠ 0.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient, Proveedor } from '../../../datos/index.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../../pruebas/contexto.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../../contrato/index.js';

import { registrarMovimientoTercero } from '../cuenta-terceros.js';
import {
  registrarMovimientoCxp,
  registrarCargoCompraCxp,
  cancelarMovimientoCxp,
  estadoCuentaProveedorCxp,
  bandejaPorPagar,
} from './cxp.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let proveedor: Proveedor;

const PERM_TODOS: ClavePermiso[] = [
  'cxp.ver',
  'cxp.administrar',
  'terceros.ver',
  'terceros.administrar',
  'terceros.fiscal',
  'consultas.ver-importes',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS, idEmpresaActiva = empresa.id) =>
  sesionDePrueba({ idEmpresaActiva, permisos });
const bd = () => ({ cliente });

/** `YYYY-MM-DD` de hace `dias` días (UTC), para fechar cargos dentro de una cubeta de aging. */
function hace(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa CxP');
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa CxP');
  // 5 días de crédito: los cargos caen holgadamente dentro de sus cubetas (5 días de margen a los bordes).
  proveedor = await cliente.proveedor.create({
    data: {
      modalidadFacturacion: 'ambos',
      nombre: 'Hilaturas del Norte',
      nombreCorto: 'HDN',
      diasCredito: 5,
    },
  });
});

// ── (a) captura: cargo + pago ────────────────────────────────────────────────────────────────────
describe('captura de movimientos de CxP', () => {
  it('una entrada sin factura carga y un pago abona; el saldo baja', async () => {
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 1000 },
      bd(),
    );
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'pago', importe: 300, esFiscal: false },
      bd(),
    );

    const cuenta = await estadoCuentaProveedorCxp(sesion(), proveedor.id, {}, bd());
    expect(cuenta.saldo.saldo).toBe(700);
    // Verificación independiente: Σ directo del libro.
    const suma = await cliente.movimientoTercero.aggregate({
      where: { idEmpresa: empresa.id, idProveedor: proveedor.id },
      _sum: { monto: true },
    });
    expect(suma._sum.monto?.toNumber()).toBe(700);
  });

  it('rechaza un origen que NO es de CxP (recibo_maquila / factura_proveedor)', async () => {
    await expect(
      registrarMovimientoCxp(
        sesion(),
        proveedor.id,
        // @ts-expect-error — origen fuera del enum de CxP (lo valida Zod).
        { fecha: hace(0), origen: 'recibo_maquila', importe: 100, esFiscal: false },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // ── (b) cargo desde recepción liga la OC real ─────────────────────────────────────────────────
  it('el cargo de compra liga la orden de compra real (refTipo/refId)', async () => {
    const oc = await cliente.ordenCompra.create({
      data: { numCompra: 1, idEmpresa: empresa.id, idProveedor: proveedor.id },
    });
    const mov = await registrarCargoCompraCxp(
      sesion(),
      proveedor.id,
      { importe: 2500, fecha: hace(0), idOrdenCompra: oc.id },
      bd(),
    );
    expect(mov).toMatchObject({
      origen: 'entrada_sin_factura',
      refTipo: 'orden-compra',
      refId: oc.id,
      esFiscal: false,
      monto: 2500,
    });
  });
});

// ── (c)+(d) aging + resumen ──────────────────────────────────────────────────────────────────────
describe('bandeja por pagar (aging + resumen server-side)', () => {
  async function sembrarCubetas(): Promise<void> {
    // diasCredito=5 → vencimiento = fecha+5; el atraso de cada cargo lo mete en su cubeta.
    for (const [dias, importe] of [
      [0, 100], // vence en +5 → corriente
      [20, 50], // atraso 15 → 1–30
      [50, 30], // atraso 45 → 31–60
      [95, 20], // atraso 90 → +60
    ] as const) {
      await registrarMovimientoCxp(
        sesion(),
        proveedor.id,
        { fecha: hace(dias), origen: 'entrada_sin_factura', importe },
        bd(),
      );
    }
  }

  it('reparte los cargos en sus cubetas y suma el saldo; el resumen cuadra', async () => {
    await sembrarCubetas();
    const bandeja = await bandejaPorPagar(sesion(), {}, bd());

    expect(bandeja.filas).toHaveLength(1);
    expect(bandeja.filas[0]).toMatchObject({
      idProveedor: proveedor.id,
      corriente: 100,
      d1a30: 50,
      d31a60: 30,
      mas60: 20,
      saldo: 200,
    });
    expect(bandeja.resumen).toMatchObject({
      carteraTotal: 200,
      vencido: 100, // 50 + 30 + 20
      maquilaTotal: 0, // sin maquila EsMa
      alCorrientePct: 50, // (200 − 100) / 200 (todo el saldo es del motor)
      proveedoresConSaldo: 1,
    });
  });

  it('un pago netea de la cubeta más vencida a la más nueva', async () => {
    await sembrarCubetas();
    // Pago de 60: salda +60 (20), 31–60 (30) y 10 de 1–30 → queda 1–30 en 40.
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'pago', importe: 60, esFiscal: false },
      bd(),
    );
    const bandeja = await bandejaPorPagar(sesion(), {}, bd());
    expect(bandeja.filas[0]).toMatchObject({
      corriente: 100,
      d1a30: 40,
      d31a60: 0,
      mas60: 0,
      saldo: 140,
    });
    expect(bandeja.resumen.vencido).toBe(40);
  });

  // ── (f) filtro con-saldo vs todos ─────────────────────────────────────────────────────────────
  it('"con-saldo" excluye a un proveedor con saldo 0; "todos" lo incluye', async () => {
    // Segundo proveedor: cargo 100 + pago 100 → saldo 0.
    const otro = await cliente.proveedor.create({
      data: { modalidadFacturacion: 'ambos', nombre: 'Saldado SA' },
    });
    await registrarMovimientoCxp(
      sesion(),
      otro.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 100 },
      bd(),
    );
    await registrarMovimientoCxp(
      sesion(),
      otro.id,
      { fecha: hace(0), origen: 'pago', importe: 100, esFiscal: false },
      bd(),
    );
    // El primero sí tiene saldo.
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 500 },
      bd(),
    );

    const conSaldo = await bandejaPorPagar(sesion(), { filtro: 'con-saldo' }, bd());
    expect(conSaldo.filas.map((f) => f.idProveedor)).toEqual([proveedor.id]);
    expect(conSaldo.resumen.proveedoresConSaldo).toBe(1);

    const todos = await bandejaPorPagar(sesion(), { filtro: 'todos' }, bd());
    expect(todos.filas.map((f) => f.idProveedor).sort()).toEqual([proveedor.id, otro.id].sort());
  });

  // ── (g) A9 ────────────────────────────────────────────────────────────────────────────────────
  it('A9: la empresa ajena no se cuela en la bandeja', async () => {
    // Movimiento del proveedor en OTRA empresa.
    await registrarMovimientoCxp(
      sesion(PERM_TODOS, otraEmpresa.id),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 999 },
      bd(),
    );
    // La bandeja de la empresa activa NO ve ese movimiento → no hay filas.
    const bandeja = await bandejaPorPagar(sesion(), {}, bd());
    expect(bandeja.filas).toHaveLength(0);
    expect(bandeja.resumen.proveedoresConSaldo).toBe(0);
  });
});

// ── (e) informal: operativa vs fiscal ────────────────────────────────────────────────────────────
describe('proveedor informal (sin factura)', () => {
  it('sus movimientos salen en la vista operativa y la fiscal queda vacía', async () => {
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 400, esFiscal: false },
      bd(),
    );
    const operativa = await estadoCuentaProveedorCxp(
      sesion(),
      proveedor.id,
      { vista: 'operativa' },
      bd(),
    );
    expect(operativa.movimientos.length).toBeGreaterThan(0);
    expect(operativa.saldo.saldo).toBe(400);

    const fiscal = await estadoCuentaProveedorCxp(
      sesion(),
      proveedor.id,
      { vista: 'fiscal' },
      bd(),
    );
    expect(fiscal.movimientos).toHaveLength(0);
    expect(fiscal.saldo.saldoFiscal).toBe(0);
  });
});

// ── (i) cancelación ──────────────────────────────────────────────────────────────────────────────
describe('cancelación de CxP (inverso auditado)', () => {
  it('cancela un movimiento de proveedor y el saldo se neta', async () => {
    const mov = await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 800 },
      bd(),
    );
    await cancelarMovimientoCxp(sesion(), mov.id, { motivo: 'error de captura' }, bd());
    const cuenta = await estadoCuentaProveedorCxp(sesion(), proveedor.id, {}, bd());
    expect(cuenta.saldo.saldo).toBe(0);
  });

  it('rechaza cancelar un movimiento que NO es de proveedor (CxC)', async () => {
    const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
    const movCliente = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'cliente',
        idTercero: clienteNegocio.id,
        fecha: hace(0),
        origen: 'factura_proveedor',
        importe: 100,
      },
      bd(),
    );
    await expect(
      cancelarMovimientoCxp(sesion(), movCliente.id, { motivo: 'no debería' }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

// ── (h) A4 deny-by-default + defensa en profundidad ──────────────────────────────────────────────
describe('RBAC de CxP (A4)', () => {
  it('sin `cxp.ver` no se ve la bandeja', async () => {
    await expect(
      bandejaPorPagar(sesion(['terceros.ver', 'consultas.ver-importes']), {}, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('sin `cxp.administrar` no se captura', async () => {
    await expect(
      registrarMovimientoCxp(
        sesion(['cxp.ver', 'terceros.ver']),
        proveedor.id,
        { fecha: hace(0), origen: 'pago', importe: 10, esFiscal: false },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('defensa en profundidad: `cxp.administrar` SIN `terceros.administrar` falla cerrado', async () => {
    await expect(
      registrarMovimientoCxp(
        sesion(['cxp.administrar', 'consultas.ver-importes']),
        proveedor.id,
        { fecha: hace(0), origen: 'pago', importe: 10, esFiscal: false },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

// ── (j) delegación al motor (convivencia EsMa) ───────────────────────────────────────────────────
describe('estado de cuenta del proveedor', () => {
  it('delega al motor: para un proveedor el saldo incluye la convivencia EsMa', async () => {
    const cuenta = await estadoCuentaProveedorCxp(sesion(), proveedor.id, {}, bd());
    // La convivencia EsMa está SIEMPRE activa para un proveedor (su math la cubre el motor F9-E1).
    expect(cuenta.saldo.incluyeEsMa).toBe(true);
  });
});

// ── (k) convivencia EsMa EN LA BANDEJA (cartera veraz + cubeta maquila, sin N+1) ──────────────────
describe('convivencia EsMa en la bandeja (cubeta maquila)', () => {
  /** Siembra un CARGO EsMa validado (cantidadReal × precioReal) para un maquilero → deuda de maquila. */
  async function sembrarCargoEsMa(
    idMaquilero: number,
    cantidadReal: number,
    precioReal: number,
  ): Promise<void> {
    const tipoProceso = await cliente.tipoProceso.create({
      data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
    });
    const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente Maq' } });
    const pedido = await cliente.pedido.create({
      data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
    });
    const modelo = await cliente.modelo.create({
      data: { codigo: 'MOD-1', descripcion: 'Modelo 1' },
    });
    const linea = await cliente.pedidoLinea.create({
      data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 10, precio: 100 },
    });
    const orden = await cliente.orden.create({
      data: {
        folio: 1n,
        idEmpresa: empresa.id,
        idPedidoLinea: linea.id,
        idModelo: modelo.id,
        idCliente: clienteNegocio.id,
        estado: 'completa',
        fechaCompletada: new Date(),
      },
    });
    await cliente.esMaCargo.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero,
        idOrden: orden.id,
        idTipoProceso: tipoProceso.id,
        estado: 'validado',
        cantidadReal,
        precioReal,
        conFactura: true,
      },
    });
  }

  it('un maquilero con deuda EsMa y 0 en el motor APARECE con su saldo en la cubeta maquila', async () => {
    const maquilero = await cliente.proveedor.create({
      data: { modalidadFacturacion: 'ambos', nombre: 'Maquilas del Sur', nombreCorto: 'MDS' },
    });
    await sembrarCargoEsMa(maquilero.id, 10, 50); // 500 de maquila, 0 en el motor

    const bandeja = await bandejaPorPagar(sesion(), {}, bd());
    const fila = bandeja.filas.find((f) => f.idProveedor === maquilero.id);
    expect(fila).toMatchObject({
      corriente: 0,
      d1a30: 0,
      d31a60: 0,
      mas60: 0,
      maquila: 500,
      saldo: 500,
    });
    // Sin cartera del motor (solo maquila) → el % es null ("—"), NUNCA 100%; la maquila va aparte.
    expect(bandeja.resumen.maquilaTotal).toBe(500);
    expect(bandeja.resumen.alCorrientePct).toBeNull();
  });

  it('carteraTotal INCLUYE el saldo EsMa (motor + maquila)', async () => {
    // proveedor (Hilaturas): 300 en el motor. maquilero: 500 de maquila.
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 300 },
      bd(),
    );
    const maquilero = await cliente.proveedor.create({
      data: { modalidadFacturacion: 'ambos', nombre: 'Maquilas del Sur' },
    });
    await sembrarCargoEsMa(maquilero.id, 10, 50);

    const bandeja = await bandejaPorPagar(sesion(), {}, bd());
    expect(bandeja.resumen.carteraTotal).toBe(800); // 300 motor + 500 maquila
    expect(bandeja.resumen.maquilaTotal).toBe(500); // la maquila, aparte
    // % SOLO sobre la cartera del motor (300, todo corriente) → 100%; la maquila no infla el %.
    expect(bandeja.resumen.alCorrientePct).toBe(100);
    expect(bandeja.resumen.proveedoresConSaldo).toBe(2);
  });

  it('la bandeja concuerda con el estado de cuenta del mismo proveedor (motor + maquila)', async () => {
    // El MISMO proveedor tiene motor (200, corriente) Y maquila (500).
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 200 },
      bd(),
    );
    await sembrarCargoEsMa(proveedor.id, 10, 50);

    const bandeja = await bandejaPorPagar(sesion(), {}, bd());
    const fila = bandeja.filas.find((f) => f.idProveedor === proveedor.id);
    expect(fila?.maquila).toBe(500);
    expect(fila?.saldo).toBe(700); // 200 motor + 500 maquila

    // El saldo del renglón == el saldo del estado de cuenta (mismo total, sin doble conteo).
    const cuenta = await estadoCuentaProveedorCxp(sesion(), proveedor.id, {}, bd());
    expect(fila?.saldo).toBe(cuenta.saldo.saldo);
  });

  // ── (k) §Post-F9.188(a) — el maquilero con todo sin revisar NO desaparece ─────────────────────
  //
  // Al saldo sólo entra lo REVISADO (V1, fila 0.115). Un maquilero cuyos movimientos están TODOS
  // capturados tiene saldo 0, y con el corte viejo (`saldo ≠ 0`) la bandeja lo hacía desaparecer —
  // justo cuando alguien tiene que decidir sobre ese dinero. Daniel: no debe desaparecer.

  /** Un movimiento PLANO de EsMa (abono/pago) en el estado de revisión que se pida. */
  async function sembrarPlano(
    concepto: 'abono' | 'pago',
    idMaquilero: number,
    monto: number,
    estadoRevision: 'capturado' | 'revisado',
  ): Promise<number> {
    const data = {
      idEmpresa: empresa.id,
      idMaquilero,
      monto,
      fecha: new Date('2026-06-01T00:00:00Z'),
      estadoRevision,
    };
    return concepto === 'abono'
      ? (await cliente.abonoMaquilero.create({ data })).id
      : (await cliente.pagoMaquilero.create({ data })).id;
  }

  /** Un maquilero limpio (sin nada en el motor). */
  async function maquileroNuevo(nombre: string): Promise<number> {
    return (await cliente.proveedor.create({ data: { modalidadFacturacion: 'ambos', nombre } })).id;
  }

  it('⭐ (k) el maquilero con TODO sin revisar SIGUE en la bandeja, con saldo 0 y su «por revisar»', async () => {
    const idMaquilero = await maquileroNuevo('Maquila Todo Capturado');
    await sembrarPlano('abono', idMaquilero, 400, 'capturado'); // no cuenta al saldo… todavía

    const bandeja = await bandejaPorPagar(sesion(), { filtro: 'con-saldo' }, bd());
    const fila = bandeja.filas.find((f) => f.idProveedor === idMaquilero);
    // Antes esta fila no existía: saldo 0 → fuera de "con saldo" → el dinero desaparecía de CxP.
    expect(fila).toBeDefined();
    expect(fila).toMatchObject({ saldo: 0, maquila: 0 });
    expect(fila?.maquilaPorRevisar).toEqual({
      abonos: 400,
      pagos: 0,
      descuentos: 0,
      neto: 400,
      partidas: 1,
    });
    // Los KPIs NO lo cuentan como deuda (lo pendiente aún no se debe)… pero el resumen lo declara.
    expect(bandeja.resumen.proveedoresConSaldo).toBe(0);
    expect(bandeja.resumen.carteraTotal).toBe(0);
    expect(bandeja.resumen.maquilaTotal).toBe(0);
    expect(bandeja.resumen.maquilaPorRevisar).toMatchObject({ neto: 400, partidas: 1 });
  });

  it('(k) sigue visible aunque sus partidas capturadas NETEEN cero (manda el conteo, no el importe)', async () => {
    const idMaquilero = await maquileroNuevo('Maquila Netea Cero');
    await sembrarPlano('abono', idMaquilero, 250, 'capturado');
    await sembrarPlano('pago', idMaquilero, 250, 'capturado');

    const bandeja = await bandejaPorPagar(sesion(), { filtro: 'con-saldo' }, bd());
    const fila = bandeja.filas.find((f) => f.idProveedor === idMaquilero);
    expect(fila).toBeDefined();
    expect(fila?.maquilaPorRevisar).toMatchObject({
      abonos: 250,
      pagos: 250,
      neto: 0,
      partidas: 2,
    });
  });

  it('(k) al revisarse, la partida pasa del «por revisar» al saldo y el maquilero ya cuenta como deuda', async () => {
    const idMaquilero = await maquileroNuevo('Maquila Ya Revisada');
    const idAbono = await sembrarPlano('abono', idMaquilero, 400, 'capturado');
    await cliente.abonoMaquilero.update({
      where: { id: idAbono },
      data: { estadoRevision: 'revisado' },
    });

    const bandeja = await bandejaPorPagar(sesion(), { filtro: 'con-saldo' }, bd());
    const fila = bandeja.filas.find((f) => f.idProveedor === idMaquilero);
    expect(fila).toMatchObject({ saldo: 400, maquila: 400 });
    expect(fila?.maquilaPorRevisar.partidas).toBe(0);
    expect(bandeja.resumen.proveedoresConSaldo).toBe(1);
    expect(bandeja.resumen.maquilaPorRevisar.partidas).toBe(0);
  });

  it('(k) sin `consultas.ver-importes` el «por revisar» viaja en null, pero el CONTEO sí (y la fila también)', async () => {
    const idMaquilero = await maquileroNuevo('Maquila Oculta');
    await sembrarPlano('pago', idMaquilero, 90, 'capturado');

    const bandeja = await bandejaPorPagar(
      sesion(['cxp.ver', 'terceros.ver']),
      { filtro: 'con-saldo' },
      bd(),
    );
    const fila = bandeja.filas.find((f) => f.idProveedor === idMaquilero);
    expect(fila).toBeDefined();
    expect(fila?.maquilaPorRevisar).toEqual({
      abonos: null,
      pagos: null,
      descuentos: null,
      neto: null,
      partidas: 1,
    });
    expect(bandeja.resumen.maquilaPorRevisar.partidas).toBe(1);
  });
});

// ── (g) SEGMENTACIÓN con/sin factura (V1-E3f pieza B, §Post-F9.57) ───────────────────────────────
//
// Daniel: *"hay proveedores de avíos o de telas que puede pasar que algunas cosas sean con factura
// y otras sin factura"*. El motor: el movimiento se MARCA con la modalidad del proveedor, el saldo
// se PARTE en dos y el estado de cuenta se consulta por segmento.
describe('segmentación con/sin factura en CxP', () => {
  /** Fija la modalidad de facturación del proveedor de la prueba. */
  async function conModalidad(m: 'solo_con' | 'solo_sin' | 'ambos' | null): Promise<void> {
    await cliente.proveedor.update({
      where: { id: proveedor.id },
      data: { modalidadFacturacion: m },
    });
  }

  it('la modalidad del proveedor MARCA el movimiento (solo_con → fiscal, solo_sin → no)', async () => {
    await conModalidad('solo_con');
    const conFactura = await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'nota_credito', importe: 100 },
      bd(),
    );
    await conModalidad('solo_sin');
    const sinFactura = await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      // Se pide `true` a propósito: la modalidad del proveedor manda sobre lo que pidió la pantalla.
      { fecha: hace(0), origen: 'nota_credito', importe: 50, esFiscal: true },
      bd(),
    );

    const enBd = await cliente.movimientoTercero.findMany({
      where: { id: { in: [conFactura.id, sinFactura.id] } },
      orderBy: { id: 'asc' },
      select: { esFiscal: true },
    });
    expect(enBd.map((m) => m.esFiscal)).toEqual([true, false]);
  });

  it('⭐ con modalidad `ambos` EXIGE indicar el segmento (no elige en silencio)', async () => {
    await conModalidad('ambos');
    await expect(
      registrarMovimientoCxp(
        sesion(),
        proveedor.id,
        { fecha: hace(0), origen: 'pago', importe: 10 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Indicándolo, pasa.
    await expect(
      registrarMovimientoCxp(
        sesion(),
        proveedor.id,
        { fecha: hace(0), origen: 'pago', importe: 10, esFiscal: true },
        bd(),
      ),
    ).resolves.toBeTruthy();
  });

  it('⭐ una entrada SIN factura no se vuelve fiscal ni con un proveedor `solo_con`', async () => {
    await conModalidad('solo_con');
    const mov = await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 1000 },
      bd(),
    );
    const enBd = await cliente.movimientoTercero.findUniqueOrThrow({
      where: { id: mov.id },
      select: { esFiscal: true },
    });
    expect(enBd.esFiscal).toBe(false);
  });

  it('el saldo se parte en dos y los dos segmentos SUMAN el total', async () => {
    await conModalidad('ambos');
    // 1,000 sin factura de mercancía + 400 con factura − 100 de pago sin factura.
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 1000 },
      bd(),
    );
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'nota_credito', importe: 400, esFiscal: true },
      bd(),
    );
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'pago', importe: 100, esFiscal: false },
      bd(),
    );

    const cuenta = await estadoCuentaProveedorCxp(sesion(), proveedor.id, {}, bd());
    expect(cuenta.saldo.saldo).toBe(500); // 1000 − 400 − 100
    expect(cuenta.saldo.saldoFiscal).toBe(-400);
    expect(cuenta.saldo.saldoSinFactura).toBe(900); // 1000 − 100
    // La partición es EXACTA: no hay dinero que se caiga de los dos lados.
    expect((cuenta.saldo.saldoFiscal ?? 0) + (cuenta.saldo.saldoSinFactura ?? 0)).toBe(
      cuenta.saldo.saldo,
    );
  });

  it('el estado de cuenta filtra los renglones por segmento', async () => {
    await conModalidad('ambos');
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'nota_credito', importe: 400, esFiscal: true },
      bd(),
    );
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'pago', importe: 100, esFiscal: false },
      bd(),
    );

    const todos = await estadoCuentaProveedorCxp(sesion(), proveedor.id, {}, bd());
    const con = await estadoCuentaProveedorCxp(sesion(), proveedor.id, { segmento: 'con' }, bd());
    const sin = await estadoCuentaProveedorCxp(sesion(), proveedor.id, { segmento: 'sin' }, bd());

    expect(todos.total).toBe(2);
    expect(con.total).toBe(1);
    expect(sin.total).toBe(1);
    expect(con.movimientos[0]?.origen).toBe('nota_credito');
    expect(sin.movimientos[0]?.origen).toBe('pago');
    expect(con.segmento).toBe('con');
  });

  it('⭐ el segmento NO exige el permiso del contador (`terceros.fiscal`), la vista fiscal SÍ', async () => {
    await conModalidad('solo_con');
    await registrarMovimientoCxp(
      sesion(),
      proveedor.id,
      { fecha: hace(0), origen: 'nota_credito', importe: 400 },
      bd(),
    );
    const sinFiscal = sesion(PERM_TODOS.filter((p) => p !== 'terceros.fiscal'));

    // La partición operativa que pidió Daniel NO puede quedar tras el candado del contador.
    await expect(
      estadoCuentaProveedorCxp(sinFiscal, proveedor.id, { segmento: 'con' }, bd()),
    ).resolves.toBeTruthy();
    await expect(
      estadoCuentaProveedorCxp(sinFiscal, proveedor.id, { vista: 'fiscal' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('vista fiscal + segmento "sin" es contradictorio y se rechaza (no devuelve vacío mudo)', async () => {
    await expect(
      estadoCuentaProveedorCxp(sesion(), proveedor.id, { vista: 'fiscal', segmento: 'sin' }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

// ── (l) ⭐ SEGMENTACIÓN sobre movimientos de EsMa: los "sin definir" NO se pueden caer ────────────
//
// El agujero que esto cierra: `EsMaCargo.conFactura` es NULLABLE —así quedaron los movimientos que
// migraron del Access, donde la pregunta nunca se hizo— y el encabezado los cuenta como SIN factura
// (`saldoSinFactura = saldo − saldoFiscal`). Si la LISTA los dejara fuera, el total y los renglones
// se contradirían y los dos segmentos no darían el saldo.
//
// Los movimientos del MOTOR no sirven para probar esto: su `esFiscal` es NOT NULL, así que la
// partición es exacta por construcción. Hace falta un cargo EsMa con `conFactura: null`.
describe('segmentación con/sin factura sobre movimientos de EsMa (conFactura NULLABLE)', () => {
  /** Siembra un cargo EsMa validado con la marca de factura que se le pida (incluido `null`). */
  async function cargoEsMa(conFactura: boolean | null, importe: number): Promise<void> {
    const tipoProceso = await cliente.tipoProceso.upsert({
      where: { codigo: 'costura' },
      update: {},
      create: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
    });
    const clienteNegocio = await cliente.cliente.create({
      data: { nombre: `Cliente ${String(importe)}-${String(conFactura)}` },
    });
    const pedido = await cliente.pedido.create({
      data: { folio: BigInt(importe), idEmpresa: empresa.id, idCliente: clienteNegocio.id },
    });
    const modelo = await cliente.modelo.create({
      data: { codigo: `MOD-${String(importe)}-${String(conFactura)}`, descripcion: 'Modelo' },
    });
    const linea = await cliente.pedidoLinea.create({
      data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 1, precio: importe },
    });
    const orden = await cliente.orden.create({
      data: {
        folio: BigInt(importe),
        idEmpresa: empresa.id,
        idPedidoLinea: linea.id,
        idModelo: modelo.id,
        idCliente: clienteNegocio.id,
        estado: 'completa',
        fechaCompletada: new Date(),
      },
    });
    await cliente.esMaCargo.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: proveedor.id,
        idOrden: orden.id,
        idTipoProceso: tipoProceso.id,
        estado: 'validado',
        cantidadReal: 1,
        precioReal: importe,
        conFactura,
      },
    });
  }

  it('⭐ un cargo EsMa SIN DEFINIR aparece en el segmento "sin", no se cae de los dos', async () => {
    await cargoEsMa(null, 300);

    const sin = await estadoCuentaProveedorCxp(sesion(), proveedor.id, { segmento: 'sin' }, bd());
    const con = await estadoCuentaProveedorCxp(sesion(), proveedor.id, { segmento: 'con' }, bd());

    expect(sin.total).toBe(1);
    expect(con.total).toBe(0);
  });

  it('⭐ con + sin SUMAN el total, con los tres estados de la marca mezclados', async () => {
    await cargoEsMa(true, 100); // con factura
    await cargoEsMa(false, 50); // sin factura
    await cargoEsMa(null, 300); // sin DEFINIR: cuenta como "sin"

    const todos = await estadoCuentaProveedorCxp(sesion(), proveedor.id, {}, bd());
    const con = await estadoCuentaProveedorCxp(sesion(), proveedor.id, { segmento: 'con' }, bd());
    const sin = await estadoCuentaProveedorCxp(sesion(), proveedor.id, { segmento: 'sin' }, bd());

    // Ni un renglón se pierde por el camino.
    expect(todos.total).toBe(3);
    expect(con.total + sin.total).toBe(todos.total);
    expect(con.total).toBe(1);
    expect(sin.total).toBe(2);

    // Y el ENCABEZADO cuadra con los renglones: el saldo se parte en dos exactas.
    expect(todos.saldo.saldo).toBe(450);
    expect(todos.saldo.saldoFiscal).toBe(100);
    expect(todos.saldo.saldoSinFactura).toBe(350); // 50 + 300 (el "sin definir" incluido)
    expect((todos.saldo.saldoFiscal ?? 0) + (todos.saldo.saldoSinFactura ?? 0)).toBe(
      todos.saldo.saldo,
    );
  });

  it('la vista fiscal (la del contador) sigue trayendo SOLO los que tienen factura', async () => {
    await cargoEsMa(true, 100);
    await cargoEsMa(null, 300);

    const fiscal = await estadoCuentaProveedorCxp(
      sesion(),
      proveedor.id,
      { vista: 'fiscal' },
      bd(),
    );
    expect(fiscal.total).toBe(1);
  });
});
