/**
 * Tests de integración de CxC — CUENTAS POR COBRAR (F9-E4). Postgres efímero (testcontainers). Cubre lo
 * específico de CxC que compone sobre el motor de terceros (F9-E1), espejo de CxP pero SIN convivencia
 * EsMa (los clientes no maquilan):
 *  (a) captura de movimientos por cliente (cargo + cobro) → el saldo baja;
 *  (b) el AGING de la bandeja reparte por días de atraso y NETEA los cobros (más viejo primero);
 *  (c) el RESUMEN (cartera/vencido/% al corriente/# clientes) se calcula server-side sobre TODA la cartera;
 *  (d) el cliente con movimiento no fiscal sale en la vista operativa y VACÍO en la fiscal;
 *  (e) el filtro "con-saldo" excluye a los clientes con saldo 0; "todos" los incluye;
 *  (f) A9: la empresa ajena no se cuela en la bandeja;
 *  (g) A4: deny-by-default de `cxc.ver`/`cxc.administrar`, y defensa en profundidad (el motor exige
 *      además `terceros.administrar` → falla cerrado sin él);
 *  (h) la cancelación de CxC es por inverso auditado y rechaza un movimiento que NO es de cliente.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Cliente, Empresa, PrismaClient } from '../../../datos/index.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../../pruebas/contexto.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../../contrato/index.js';

import { registrarMovimientoTercero } from '../cuenta-terceros.js';
import {
  registrarMovimientoCxc,
  cancelarMovimientoCxc,
  estadoCuentaClienteCxc,
  bandejaPorCobrar,
} from './cxc.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteFr: Cliente;

const PERM_TODOS: ClavePermiso[] = [
  'cxc.ver',
  'cxc.administrar',
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
  empresa = await crearEmpresaPrueba(cliente, 'Empresa CxC');
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa CxC');
  // 5 días de crédito: los cargos caen holgadamente dentro de sus cubetas (5 días de margen a los bordes).
  clienteFr = await cliente.cliente.create({
    data: { nombre: 'Tiendas del Centro', diasCredito: 5 },
  });
});

// ── (a) captura: cargo + cobro ────────────────────────────────────────────────────────────────────
describe('captura de movimientos de CxC', () => {
  it('un cargo sin factura carga y un cobro abona; el saldo baja', async () => {
    await registrarMovimientoCxc(
      sesion(),
      clienteFr.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 1000 },
      bd(),
    );
    await registrarMovimientoCxc(
      sesion(),
      clienteFr.id,
      { fecha: hace(0), origen: 'pago', importe: 300 },
      bd(),
    );

    const cuenta = await estadoCuentaClienteCxc(sesion(), clienteFr.id, {}, bd());
    expect(cuenta.saldo.saldo).toBe(700);
    // Verificación independiente: Σ directo del libro.
    const suma = await cliente.movimientoTercero.aggregate({
      where: { idEmpresa: empresa.id, idCliente: clienteFr.id },
      _sum: { monto: true },
    });
    expect(suma._sum.monto?.toNumber()).toBe(700);
    // El cliente no maquila: sin aporte EsMa.
    expect(cuenta.saldo.incluyeEsMa).toBe(false);
    expect(cuenta.saldo.saldoEsMa).toBe(0);
  });

  it('rechaza un origen que NO es de CxC (recibo_maquila / factura_cliente)', async () => {
    await expect(
      registrarMovimientoCxc(
        sesion(),
        clienteFr.id,
        // @ts-expect-error — origen fuera del enum de CxC (lo valida Zod).
        { fecha: hace(0), origen: 'factura_cliente', importe: 100 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

// ── (b)/(c) aging + resumen server-side ──────────────────────────────────────────────────────────
describe('bandeja "por cobrar" (aging + resumen server-side)', () => {
  it('reparte por cubeta de atraso y calcula el resumen sobre toda la cartera', async () => {
    // Cargo corriente (hoy) + cargo vencido +60 (fechado hace 80 días → atraso 75).
    await registrarMovimientoCxc(
      sesion(),
      clienteFr.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 500 },
      bd(),
    );
    await registrarMovimientoCxc(
      sesion(),
      clienteFr.id,
      { fecha: hace(80), origen: 'entrada_sin_factura', importe: 300 },
      bd(),
    );

    const bandeja = await bandejaPorCobrar(sesion(), {}, bd());
    const fila = bandeja.filas.find((f) => f.idCliente === clienteFr.id);
    expect(fila).toBeDefined();
    expect(fila?.corriente).toBe(500);
    expect(fila?.mas60).toBe(300);
    expect(fila?.saldo).toBe(800);

    expect(bandeja.resumen.carteraTotal).toBe(800);
    expect(bandeja.resumen.vencido).toBe(300);
    // % al corriente = (800 − 300) / 800 = 62.5 → 63.
    expect(bandeja.resumen.alCorrientePct).toBe(63);
    expect(bandeja.resumen.clientesConSaldo).toBe(1);
  });

  /**
   * ⭐ La cubeta que DISCRIMINA el defecto de §Post-F9.98. El test de arriba fecha los cargos con
   * holgura (hoy y hace 80 días), así que caen en la misma cubeta con plazo 5 y con plazo 0 — pasaba
   * igual con el motor roto. Aquí el cargo se fecha DENTRO del plazo del cliente (30 días de crédito,
   * cargo de hace 20): leyendo el plazo vence en 10 días → atraso negativo → `corriente` y
   * `vencido = 0`; ignorándolo (el defecto: `diasCredito: 0` a fuego) venció hace 20 días → `d1a30`,
   * que es exactamente cómo la cartera entera envejecía como si todo cliente fuera de contado.
   *
   * Se elige 30/20 y no el borde exacto (cargo de hace `diasCredito` días) a propósito: el borde deja
   * el resultado a un día de cambiar de cubeta y ata la prueba a que `CURRENT_DATE` del servidor y la
   * fecha UTC del cargo caigan el mismo día. Con 10 días de margen a cada lado la prueba distingue lo
   * mismo sin poder ponerse en rojo por la hora a la que corra el CI.
   */
  it('un cargo dentro del plazo del cliente sigue CORRIENTE, no vencido (§Post-F9.98)', async () => {
    const clienteA30 = await cliente.cliente.create({
      data: { nombre: 'Boutique a 30 días', diasCredito: 30 },
    });
    await registrarMovimientoCxc(
      sesion(),
      clienteA30.id,
      { fecha: hace(20), origen: 'entrada_sin_factura', importe: 400 },
      bd(),
    );

    const bandeja = await bandejaPorCobrar(sesion(), {}, bd());
    const fila = bandeja.filas.find((f) => f.idCliente === clienteA30.id);
    expect(fila?.corriente).toBe(400);
    expect(fila?.d1a30).toBe(0);
    expect(bandeja.resumen.vencido).toBe(0);
    expect(bandeja.resumen.alCorrientePct).toBe(100);
  });

  // ── (e) filtro con-saldo / todos ──────────────────────────────────────────────────────────────
  it('el filtro con-saldo excluye a los clientes con saldo 0; "todos" los incluye', async () => {
    // Cliente con cargo y cobro que lo dejan en cero.
    await registrarMovimientoCxc(
      sesion(),
      clienteFr.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 200 },
      bd(),
    );
    await registrarMovimientoCxc(
      sesion(),
      clienteFr.id,
      { fecha: hace(0), origen: 'pago', importe: 200 },
      bd(),
    );

    const conSaldo = await bandejaPorCobrar(sesion(), { filtro: 'con-saldo' }, bd());
    expect(conSaldo.filas.some((f) => f.idCliente === clienteFr.id)).toBe(false);

    const todos = await bandejaPorCobrar(sesion(), { filtro: 'todos' }, bd());
    expect(todos.filas.some((f) => f.idCliente === clienteFr.id)).toBe(true);
  });

  // ── (f) A9: empresa ajena no se cuela ─────────────────────────────────────────────────────────
  it('A9: los movimientos de otra empresa no se cuelan en la bandeja', async () => {
    // Cargo del cliente en OTRA empresa.
    await registrarMovimientoCxc(
      sesion(PERM_TODOS, otraEmpresa.id),
      clienteFr.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 999 },
      bd(),
    );

    const bandeja = await bandejaPorCobrar(sesion(), {}, bd());
    expect(bandeja.filas.some((f) => f.idCliente === clienteFr.id)).toBe(false);
  });
});

// ── (d) vista fiscal ─────────────────────────────────────────────────────────────────────────────
describe('vista operativa vs fiscal', () => {
  it('el cargo no fiscal sale en la operativa y no en la fiscal', async () => {
    await registrarMovimientoCxc(
      sesion(),
      clienteFr.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 400, esFiscal: false },
      bd(),
    );

    const operativa = await estadoCuentaClienteCxc(
      sesion(),
      clienteFr.id,
      { vista: 'operativa' },
      bd(),
    );
    expect(operativa.movimientos.length).toBe(1);
    expect(operativa.saldo.saldo).toBe(400);

    const fiscal = await estadoCuentaClienteCxc(sesion(), clienteFr.id, { vista: 'fiscal' }, bd());
    expect(fiscal.movimientos.length).toBe(0);
    expect(fiscal.saldo.saldoFiscal).toBe(0);
  });
});

// ── (g) A4: RBAC + defensa en profundidad ────────────────────────────────────────────────────────
describe('RBAC (deny-by-default, A4)', () => {
  it('sin `cxc.administrar` no se captura', async () => {
    await expect(
      registrarMovimientoCxc(
        sesion(['cxc.ver', 'terceros.ver']),
        clienteFr.id,
        { fecha: hace(0), origen: 'pago', importe: 10 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('sin `cxc.ver` no se ve la bandeja', async () => {
    await expect(bandejaPorCobrar(sesion([]), {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('defensa en profundidad: con `cxc.administrar` pero SIN `terceros.administrar` falla cerrado', async () => {
    await expect(
      registrarMovimientoCxc(
        sesion(['cxc.administrar']),
        clienteFr.id,
        { fecha: hace(0), origen: 'entrada_sin_factura', importe: 10 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

// ── (h) cancelación por inverso + guarda de tipo de tercero ──────────────────────────────────────
describe('cancelación (inverso auditado)', () => {
  it('cancela por inverso: el saldo neta a 0 y no borra el original', async () => {
    const cargo = await registrarMovimientoCxc(
      sesion(),
      clienteFr.id,
      { fecha: hace(0), origen: 'entrada_sin_factura', importe: 250 },
      bd(),
    );
    await cancelarMovimientoCxc(sesion(), cargo.id, { motivo: 'error de captura' }, bd());

    const cuenta = await estadoCuentaClienteCxc(sesion(), clienteFr.id, {}, bd());
    expect(cuenta.saldo.saldo).toBe(0);
    // El original sigue existiendo (marcado cancelado) + su inverso: 2 renglones.
    expect(cuenta.movimientos.length).toBe(2);
  });

  it('la ruta de CxC NO cancela un movimiento que es de un PROVEEDOR (404)', async () => {
    const proveedor = await cliente.proveedor.create({
      data: { modalidadFacturacion: 'solo_sin', nombre: 'Prov X', diasCredito: 0 },
    });
    const movProv = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: hace(0),
        origen: 'pago',
        importe: 50,
      },
      bd(),
    );
    await expect(
      cancelarMovimientoCxc(sesion(), movProv.id, { motivo: 'no aplica' }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
