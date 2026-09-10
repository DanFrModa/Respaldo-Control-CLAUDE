/**
 * Tests de integración del MOTOR de cuenta corriente de terceros (F9-E1). Postgres efímero
 * (testcontainers). Cubre las invariantes del motor central que la ficha exige:
 *  (a) saldo = Σ monto por suma directa (nunca editable, D3);
 *  (b) la NOTA DE CRÉDITO baja el saldo;
 *  (c) cancelación = INVERSO auditado (nunca borra/edita); no se re-cancela ni se cancela un inverso;
 *      dos cancelaciones CONCURRENTES del mismo movimiento crean UN solo inverso (lock + unique, D3);
 *  (d) vista FISCAL ⊂ operativa (solo movimientos con CFDI);
 *  (e) transacción A2: un alta que falla a mitad NO deja rastro NI consume folio (falle ANTES o
 *      DESPUÉS de tomar el folio — p.ej. uuidCfdi duplicado);
 *  (f) folio A3 sin huecos ni duplicados bajo concurrencia;
 *  (g) A9: la empresa ajena no se cuela;
 *  (h) A4: deny-by-default de ver/administrar/fiscal;
 *  (i) NO-REGRESIÓN EsMa: el saldo de maquilero de F6 se calcula IGUAL vía el motor (convivencia), y
 *      el estado de cuenta del proveedor INCLUYE los movimientos EsMa (Σ renglones = saldo);
 *  (j) exclusividad del tercero (D15a): el CHECK impide poblar ambas FKs;
 *  (k) importe mínimo (D1): un sub-centavo se rechaza como validación (no revienta el CHECK monto<>0).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Cliente, Empresa, PrismaClient, Proveedor } from '../../datos/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { saldoDeMaquilero } from '../esma/saldos.js';
import {
  registrarMovimientoTercero,
  cancelarMovimientoTercero,
  calcularSaldoTercero,
  estadoDeCuentaTercero,
} from './cuenta-terceros.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;
let proveedor: Proveedor;

const PERM_TODOS: ClavePermiso[] = [
  'terceros.ver',
  'terceros.administrar',
  'terceros.fiscal',
  'consultas.ver-importes',
  'esma.ver-pagos',
  'esma.modificar',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS, idEmpresaActiva = empresa.id) =>
  sesionDePrueba({ idEmpresaActiva, permisos });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa Terceros');
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente Uno' } });
  proveedor = await cliente.proveedor.create({
    data: { modalidadFacturacion: 'solo_sin', nombre: 'Proveedor Uno', diasCredito: 30 },
  });
});

// ── (a) saldo = Σ monto ──────────────────────────────────────────────────────────────────────────
describe('saldo = Σ monto (D3)', () => {
  it('un cargo suma y un pago resta; el saldo cuadra por suma directa', async () => {
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 1000,
      },
      bd(),
    );
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-05',
        origen: 'pago',
        importe: 300,
      },
      bd(),
    );

    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd());
    expect(saldo.saldoMovimientos).toBe(700);
    expect(saldo.saldo).toBe(700);

    // Verificación independiente: Σ directo del libro en BD.
    const suma = await cliente.movimientoTercero.aggregate({
      where: { idEmpresa: empresa.id, idProveedor: proveedor.id },
      _sum: { monto: true },
    });
    expect(suma._sum.monto?.toNumber()).toBe(700);
  });

  it('el importe llega positivo; el servidor le pone el signo por el origen', async () => {
    const cargo = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'cliente',
        idTercero: clienteNegocio.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor', // cargo → +
        importe: 500,
      },
      bd(),
    );
    const pago = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'cliente',
        idTercero: clienteNegocio.id,
        fecha: '2026-07-02',
        origen: 'pago', // abono → −
        importe: 200,
      },
      bd(),
    );
    expect(cargo.monto).toBe(500);
    expect(pago.monto).toBe(-200);
    const saldo = await calcularSaldoTercero(sesion(), 'cliente', clienteNegocio.id, bd());
    expect(saldo.saldo).toBe(300);
    expect(saldo.saldoEsMa).toBe(0); // clientes no tienen EsMa
    expect(saldo.incluyeEsMa).toBe(false);
  });

  it('deriva la fecha de vencimiento del cargo por los días de crédito (D15d)', async () => {
    const cargo = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id, // diasCredito = 30
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 100,
      },
      bd(),
    );
    expect(cargo.fechaVencimiento).toBe('2026-07-31');

    // Un pago no vence.
    const pago = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-10',
        origen: 'pago',
        importe: 50,
      },
      bd(),
    );
    expect(pago.fechaVencimiento).toBeNull();
  });

  /**
   * ⭐ PRUEBA DISCRIMINANTE del defecto de §Post-F9.98: el motor ignoraba `Cliente.diasCredito` y
   * devolvía 0 a fuego, así que TODA factura de cliente nacía vencida el mismo día y el aging de CxC
   * era falso. La prueba de arriba no lo veía porque mide por PROVEEDOR (la rama que sí leía el
   * plazo). Aquí el plazo del cliente es 45 y el vencimiento DEBE ser fecha+45: con el defecto sería
   * la fecha del cargo (2026-07-01) y esta aserción se pone en rojo.
   */
  it('el CLIENTE deriva su vencimiento por SUS días de crédito, igual que el proveedor (§Post-F9.98)', async () => {
    const clienteA45 = await cliente.cliente.create({
      data: { nombre: 'Cliente a 45 días', diasCredito: 45 },
    });

    const cargo = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'cliente',
        idTercero: clienteA45.id, // diasCredito = 45
        fecha: '2026-07-01',
        origen: 'factura_cliente',
        importe: 100,
      },
      bd(),
    );
    expect(cargo.fechaVencimiento).toBe('2026-08-15'); // 1-jul + 45 días

    // Y el sello queda EN la fila (no se recalcula al leer): de ahí sale lo PROSPECTIVO de
    // §Post-F9.98 (a)/(e) — mover el plazo del catálogo no puede tocar este cargo.
    const fila = await cliente.movimientoTercero.findUniqueOrThrow({
      where: { id: cargo.id },
      select: { fechaVencimiento: true },
    });
    expect(fila.fechaVencimiento?.toISOString().slice(0, 10)).toBe('2026-08-15');

    await cliente.cliente.update({ where: { id: clienteA45.id }, data: { diasCredito: 90 } });
    const filaTrasCambio = await cliente.movimientoTercero.findUniqueOrThrow({
      where: { id: cargo.id },
      select: { fechaVencimiento: true },
    });
    expect(filaTrasCambio.fechaVencimiento?.toISOString().slice(0, 10)).toBe('2026-08-15');
  });

  it('un cliente SIN plazo capturado (null) es de CONTADO: el cargo vence el mismo día', async () => {
    // `clienteNegocio` se crea sin `diasCredito` → null.
    const cargo = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'cliente',
        idTercero: clienteNegocio.id,
        fecha: '2026-07-01',
        origen: 'factura_cliente',
        importe: 100,
      },
      bd(),
    );
    expect(cargo.fechaVencimiento).toBe('2026-07-01');
  });
});

// ── (b) nota de crédito baja el saldo ────────────────────────────────────────────────────────────
describe('nota de crédito', () => {
  it('baja el saldo del tercero', async () => {
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 1000,
      },
      bd(),
    );
    const antes = await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd());
    expect(antes.saldo).toBe(1000);

    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-03',
        origen: 'nota_credito',
        importe: 150,
      },
      bd(),
    );
    const despues = await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd());
    expect(despues.saldo).toBe(850);
  });
});

// ── (c) cancelación = inverso auditado ───────────────────────────────────────────────────────────
describe('cancelación por inverso auditado (D3)', () => {
  it('crea el inverso, marca el original y el saldo vuelve; nunca borra/edita', async () => {
    const cargo = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 400,
      },
      bd(),
    );
    expect((await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd())).saldo).toBe(400);

    const inverso = await cancelarMovimientoTercero(
      sesion(),
      cargo.id,
      { motivo: 'Error de captura' },
      bd(),
    );
    expect(inverso.monto).toBe(-400);
    expect(inverso.esInverso).toBe(true);

    // El original SIGUE existiendo (no se borró) y quedó marcado cancelado.
    const original = await cliente.movimientoTercero.findUnique({ where: { id: cargo.id } });
    expect(original).not.toBeNull();
    expect(original?.cancelado).toBe(true);
    expect(original?.monto.toNumber()).toBe(400); // NO se editó el monto

    // El saldo neta a 0 (original + inverso).
    expect((await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd())).saldo).toBe(0);
  });

  it('no se puede cancelar dos veces ni cancelar un inverso', async () => {
    const cargo = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 100,
      },
      bd(),
    );
    const inverso = await cancelarMovimientoTercero(sesion(), cargo.id, { motivo: 'x' }, bd());
    await expect(
      cancelarMovimientoTercero(sesion(), cargo.id, { motivo: 'otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(
      cancelarMovimientoTercero(sesion(), inverso.id, { motivo: 'cancelar el inverso' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('dos cancelaciones CONCURRENTES del mismo movimiento crean UN solo inverso (D3)', async () => {
    const cargo = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 400,
      },
      bd(),
    );

    // Se disparan las dos cancelaciones a la vez: el advisory lock las serializa y el índice único
    // sobre idMovimientoInverso es la red de seguridad → exactamente UNA gana, la otra falla limpio.
    const resultados = await Promise.allSettled([
      cancelarMovimientoTercero(sesion(), cargo.id, { motivo: 'A' }, bd()),
      cancelarMovimientoTercero(sesion(), cargo.id, { motivo: 'B' }, bd()),
    ]);
    const oks = resultados.filter((r) => r.status === 'fulfilled');
    const fallos = resultados.filter((r) => r.status === 'rejected');
    expect(oks).toHaveLength(1);
    expect(fallos).toHaveLength(1);
    // La que perdió falla con ErrorConflicto (vio el original ya cancelado tras el lock), no con un
    // error crudo de BD.
    expect((fallos[0] as PromiseRejectedResult).reason).toBeInstanceOf(ErrorConflicto);

    // Solo existe UN inverso apuntando al original, y el saldo neta a 0 (no −400).
    const inversos = await cliente.movimientoTercero.count({
      where: { idMovimientoInverso: cargo.id },
    });
    expect(inversos).toBe(1);
    expect((await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd())).saldo).toBe(0);
  });
});

// ── (d) vista fiscal ⊂ operativa ─────────────────────────────────────────────────────────────────
describe('vista fiscal ⊂ operativa', () => {
  it('un movimiento no fiscal aparece en operativa pero NO en fiscal', async () => {
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 800,
        esFiscal: true,
        uuidCfdi: 'AAAAAAAA-0000-0000-0000-000000000001',
        rfcTercero: 'XAXX010101000',
      },
      bd(),
    );
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-02',
        origen: 'entrada_sin_factura',
        importe: 200, // informal, no fiscal
      },
      bd(),
    );

    const operativa = await estadoDeCuentaTercero(
      sesion(),
      'proveedor',
      proveedor.id,
      { vista: 'operativa' },
      bd(),
    );
    const fiscal = await estadoDeCuentaTercero(
      sesion(),
      'proveedor',
      proveedor.id,
      { vista: 'fiscal' },
      bd(),
    );

    expect(operativa.movimientos).toHaveLength(2);
    expect(fiscal.movimientos).toHaveLength(1);
    expect(fiscal.movimientos.every((m) => m.esFiscal)).toBe(true);

    // El saldo operativo trae los dos; el fiscal, solo el fiscal.
    expect(operativa.saldo.saldo).toBe(1000);
    expect(operativa.saldo.saldoFiscal).toBe(800);
  });
});

// ── (e) transacción A2 ───────────────────────────────────────────────────────────────────────────
describe('transacción A2 (o todo o nada)', () => {
  it('un alta para un tercero inexistente no deja rastro NI consume folio', async () => {
    // Consume folio 1 con un alta válida.
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 10,
      },
      bd(),
    );
    // Alta que falla (tercero inexistente) DESPUÉS de resolver el tercero → rollback total.
    await expect(
      registrarMovimientoTercero(
        sesion(),
        {
          tipoTercero: 'proveedor',
          idTercero: 999_999,
          fecha: '2026-07-02',
          origen: 'factura_proveedor',
          importe: 20,
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    const filas = await cliente.movimientoTercero.count({ where: { idEmpresa: empresa.id } });
    expect(filas).toBe(1);
    // El siguiente folio válido es 2 (el fallido no consumió folio: su tx se revirtió).
    const otro = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-03',
        origen: 'factura_proveedor',
        importe: 30,
      },
      bd(),
    );
    expect(otro.folio).toBe(2);
  });

  it('un fallo DESPUÉS de tomar el folio (uuidCfdi duplicado) no deja rastro NI fuga el folio', async () => {
    const uuid = 'BBBBBBBB-0000-0000-0000-000000000001';
    // Folio 1: alta fiscal válida.
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 100,
        esFiscal: true,
        uuidCfdi: uuid,
      },
      bd(),
    );
    // Segundo alta con el MISMO uuid: el fallo ocurre en el `create` (unique global), DESPUÉS de
    // `siguienteFolio` → la tx entera se revierte y el folio tomado NO se fuga (vuelve atrás con ella).
    await expect(
      registrarMovimientoTercero(
        sesion(),
        {
          tipoTercero: 'proveedor',
          idTercero: proveedor.id,
          fecha: '2026-07-02',
          origen: 'factura_proveedor',
          importe: 200,
          esFiscal: true,
          uuidCfdi: uuid,
        },
        bd(),
      ),
    ).rejects.toThrow();

    const filas = await cliente.movimientoTercero.count({ where: { idEmpresa: empresa.id } });
    expect(filas).toBe(1);
    // El siguiente folio válido es 2 (el intento fallido no consumió folio).
    const otro = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-03',
        origen: 'factura_proveedor',
        importe: 30,
      },
      bd(),
    );
    expect(otro.folio).toBe(2);
  });
});

// ── (f) folio A3 bajo concurrencia ───────────────────────────────────────────────────────────────
describe('folio A3 (secuencia atómica)', () => {
  it('N altas concurrentes producen N folios distintos y consecutivos', async () => {
    const N = 12;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        registrarMovimientoTercero(
          sesion(),
          {
            tipoTercero: 'proveedor',
            idTercero: proveedor.id,
            fecha: '2026-07-01',
            origen: 'factura_proveedor',
            importe: i + 1,
          },
          bd(),
        ),
      ),
    );
    const filas = await cliente.movimientoTercero.findMany({
      where: { idEmpresa: empresa.id },
      select: { folio: true },
      orderBy: { folio: 'asc' },
    });
    const folios = filas.map((f) => Number(f.folio));
    expect(folios).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(folios).size).toBe(N);
  });
});

// ── (g) A9 empresa ajena ─────────────────────────────────────────────────────────────────────────
describe('A9 (multi-empresa)', () => {
  it('la empresa ajena no ve el saldo de otra', async () => {
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 500,
      },
      bd(),
    );
    // Sesión de OTRA empresa: no ve el movimiento.
    const saldoAjeno = await calcularSaldoTercero(
      sesion(PERM_TODOS, otraEmpresa.id),
      'proveedor',
      proveedor.id,
      bd(),
    );
    expect(saldoAjeno.saldo).toBe(0);
    const estado = await estadoDeCuentaTercero(
      sesion(PERM_TODOS, otraEmpresa.id),
      'proveedor',
      proveedor.id,
      {},
      bd(),
    );
    expect(estado.movimientos).toHaveLength(0);
  });
});

// ── (h) A4 deny-by-default ───────────────────────────────────────────────────────────────────────
describe('A4 (deny-by-default)', () => {
  it('sin terceros.administrar no se registra; sin terceros.ver no se consulta el saldo', async () => {
    await expect(
      registrarMovimientoTercero(
        sesion(['terceros.ver']),
        {
          tipoTercero: 'proveedor',
          idTercero: proveedor.id,
          fecha: '2026-07-01',
          origen: 'pago',
          importe: 10,
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    await expect(
      calcularSaldoTercero(sesion([]), 'proveedor', proveedor.id, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('la vista fiscal exige terceros.fiscal (la operativa no)', async () => {
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 100,
      },
      bd(),
    );
    // Sin terceros.fiscal: la vista operativa sí, la fiscal no.
    const soloVer: ClavePermiso[] = ['terceros.ver', 'consultas.ver-importes', 'esma.ver-pagos'];
    await expect(
      estadoDeCuentaTercero(
        sesion(soloVer),
        'proveedor',
        proveedor.id,
        { vista: 'operativa' },
        bd(),
      ),
    ).resolves.toBeDefined();
    await expect(
      estadoDeCuentaTercero(sesion(soloVer), 'proveedor', proveedor.id, { vista: 'fiscal' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

// ── (i) NO-REGRESIÓN EsMa (convivencia, opción b) ────────────────────────────────────────────────
describe('no-regresión EsMa (convivencia)', () => {
  /** Siembra datos EsMa reales (cargo validado + abono + pago + descuento) para un proveedor. */
  async function sembrarEsMa(idProveedor: number): Promise<void> {
    const tipoProceso = await cliente.tipoProceso.create({
      data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
    });
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
    // Cargo validado: cantidadReal 10 × precioReal 5 = 50. (EsMaCargo no tiene `fecha`: su fecha es creadoEn.)
    await cliente.esMaCargo.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: idProveedor,
        idOrden: orden.id,
        idTipoProceso: tipoProceso.id,
        estado: 'validado',
        cantidadReal: 10,
        precioReal: 5,
        conFactura: true,
      },
    });
    await cliente.abonoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: idProveedor,
        // REVISADO a propósito: desde V1 (fila 0.115) un movimiento plano sólo cuenta al saldo si
        // ya se revisó. El fixture mide la convivencia, no la cola de revisión.
        estadoRevision: 'revisado',
        monto: 20,
        fecha: new Date('2026-06-02T00:00:00Z'),
        conFactura: false,
      },
    });
    await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: idProveedor,
        // REVISADO a propósito: desde V1 (fila 0.115) un movimiento plano sólo cuenta al saldo si
        // ya se revisó. El fixture mide la convivencia, no la cola de revisión.
        estadoRevision: 'revisado',
        monto: 15,
        fecha: new Date('2026-06-03T00:00:00Z'),
        conFactura: false,
      },
    });
    await cliente.descuentoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: idProveedor,
        // REVISADO a propósito: desde V1 (fila 0.115) un movimiento plano sólo cuenta al saldo si
        // ya se revisó. El fixture mide la convivencia, no la cola de revisión.
        estadoRevision: 'revisado',
        monto: 5,
        fecha: new Date('2026-06-04T00:00:00Z'),
        conFactura: false,
      },
    });
    // Saldo EsMa esperado = 50 + 20 − 15 − 5 = 50.
  }

  it('el saldo de maquilero de F6 se calcula IGUAL vía el motor (mismo número)', async () => {
    await sembrarEsMa(proveedor.id);

    const esMaViejo = await saldoDeMaquilero(sesion(), proveedor.id, {}, bd());
    const terceros = await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd());

    expect(esMaViejo.saldo).toBe(50);
    // Sin movimientos del motor nuevo, el saldo del tercero = el aporte EsMa = el saldo viejo.
    expect(terceros.saldoEsMa).toBe(50);
    expect(terceros.saldoMovimientos).toBe(0);
    expect(terceros.saldo).toBe(50);
    expect(terceros.incluyeEsMa).toBe(true);
  });

  it('el estado de cuenta del proveedor INCLUYE los movimientos EsMa (Σ renglones = saldo)', async () => {
    await sembrarEsMa(proveedor.id);
    // + un movimiento del motor nuevo.
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 100,
      },
      bd(),
    );

    const estado = await estadoDeCuentaTercero(
      sesion(),
      'proveedor',
      proveedor.id,
      { porPagina: 100 },
      bd(),
    );
    // 4 renglones EsMa (cargo/abono/pago/descuento) + 1 del motor = 5.
    expect(estado.movimientos).toHaveLength(5);
    expect(estado.movimientos.some((m) => m.fuente === 'esma')).toBe(true);
    expect(estado.movimientos.some((m) => m.fuente === 'motor')).toBe(true);

    // Σ de TODOS los renglones (con signo) = el saldo total (motor 100 + EsMa 50 = 150).
    const suma = estado.movimientos.reduce((s, m) => s + (m.monto ?? 0), 0);
    expect(Math.round(suma * 100) / 100).toBe(150);
    expect(estado.saldo.saldo).toBe(150);
    expect(estado.saldo.saldoMovimientos).toBe(100);
    expect(estado.saldo.saldoEsMa).toBe(50);
  });
});

// ── (j) exclusividad del tercero (D15a, CHECK) ───────────────────────────────────────────────────
describe('exclusividad del tercero (D15a)', () => {
  it('un movimiento de proveedor tiene idProveedor y NO idCliente', async () => {
    const mov = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedor.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 10,
      },
      bd(),
    );
    const fila = await cliente.movimientoTercero.findUnique({ where: { id: mov.id } });
    expect(fila?.idProveedor).toBe(proveedor.id);
    expect(fila?.idCliente).toBeNull();
  });

  it('el CHECK de BD impide poblar ambas FKs a la vez', async () => {
    await expect(
      cliente.$executeRaw`
        INSERT INTO "movimientos_tercero"
          ("id_empresa","folio","tipo_tercero","id_cliente","id_proveedor","fecha","origen","monto","es_fiscal","cancelado","modificado_en")
        VALUES (${empresa.id}, 999, 'proveedor'::"tipo_tercero", ${clienteNegocio.id}, ${proveedor.id}, '2026-07-01', 'pago'::"origen_movimiento_tercero", -10, false, false, NOW())
      `,
    ).rejects.toThrow();
  });
});

// ── (k) importe mínimo (D1): un sub-centavo se rechaza como validación ────────────────────────────
describe('importe mínimo (D1)', () => {
  it('un importe sub-centavo se rechaza como validación (no revienta el CHECK monto<>0)', async () => {
    // 0.004 redondearía a 0 → violaría el CHECK monto<>0 como error crudo de BD. Se corta antes con
    // una validación limpia (importe ≥ 0.01) y no deja rastro.
    await expect(
      registrarMovimientoTercero(
        sesion(),
        {
          tipoTercero: 'proveedor',
          idTercero: proveedor.id,
          fecha: '2026-07-01',
          origen: 'factura_proveedor',
          importe: 0.004,
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    const filas = await cliente.movimientoTercero.count({ where: { idEmpresa: empresa.id } });
    expect(filas).toBe(0);
  });
});

// ── ⭐ SEGMENTO con/sin factura DERIVADO por el motor (fila 0.110, §Post-F9.186(a)) ───────────────
//
// Lo que estas pruebas defienden NO es la función pura —eso ya lo cubre `segmento-motor.test.ts`—
// sino que **el motor la LLAME de verdad**. Sin el positivo de abajo, cambiar la escritura a
// `esFiscal: datos.esFiscal ?? false` deja `resolverEsFiscalMotor` de adorno y TODA la suite pasa
// en verde: el mismo defecto que esta fila vino a cerrar, escondido un nivel más abajo.
//
// Por qué importa en dinero (Daniel, §Post-F9.184(f)): la marca con/sin factura decide de dónde
// sale el pago del proveedor —CON factura, del estado de cuenta del BANCO; SIN factura, de la
// RELACIÓN que él define y que se ejecuta tal cual—. Un movimiento sin clasificar deja al sistema
// sin saber por cuál de los dos caminos meterlo: ese pago se pierde o se duplica.
describe('el motor DERIVA el segmento con/sin factura de la modalidad del proveedor', () => {
  /** Alta de proveedor con la modalidad que pida la prueba (incluida `null`, el migrado). */
  async function proveedorConModalidad(
    nombre: string,
    modalidadFacturacion: 'solo_con' | 'solo_sin' | 'ambos' | null,
  ): Promise<Proveedor> {
    return cliente.proveedor.create({ data: { nombre, modalidadFacturacion } });
  }

  /** Alta de movimiento de proveedor por el motor, con o sin `esFiscal`. */
  async function alta(idProveedor: number, esFiscal?: boolean) {
    return registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: idProveedor,
        fecha: '2026-09-03',
        origen: 'factura_proveedor',
        importe: 500,
        ...(esFiscal === undefined ? {} : { esFiscal }),
      },
      bd(),
    );
  }

  it('⭐ (b) POSITIVO: `solo_con` sin decir nada nace CON factura — la derivación OCURRE', async () => {
    // ⚠️ Ésta es la prueba que impide que `resolverEsFiscalMotor` quede desconectado: con la
    // escritura vieja (`datos.esFiscal ?? false`) el movimiento nacería `false` y esto fallaría.
    const prov = await proveedorConModalidad('Siempre Factura SA', 'solo_con');
    const mov = await alta(prov.id);

    const enBd = await cliente.movimientoTercero.findUniqueOrThrow({
      where: { id: mov.id },
      select: { esFiscal: true },
    });
    expect(enBd.esFiscal).toBe(true);

    // Y la BITÁCORA cuenta lo MISMO que la fila (A7). Es la rama gemela de esta misma función: el
    // `esFiscal` se escribe en DOS sitios —la fila y el registro de auditoría— y con el valor sin
    // resolver la auditoría diría "sin factura" de un movimiento que nació con ella. Una auditoría
    // que contradice al dato es peor que no tenerla.
    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'MovimientoTercero', idEntidad: String(mov.id), accion: 'CREAR' },
    });
    expect(bitacora.datos).toMatchObject({ esFiscal: true });
  });

  it('(b2) y `solo_sin` sin decir nada nace SIN factura (la otra mitad de la derivación)', async () => {
    const prov = await proveedorConModalidad('Nunca Factura SA', 'solo_sin');
    const mov = await alta(prov.id);

    const enBd = await cliente.movimientoTercero.findUniqueOrThrow({
      where: { id: mov.id },
      select: { esFiscal: true },
    });
    expect(enBd.esFiscal).toBe(false);
  });

  it('⭐ (a) un proveedor SIN modalidad no admite el movimiento, y NO deja fila (A2)', async () => {
    const migrado = await proveedorConModalidad('Migrado de Access', null);
    await expect(alta(migrado.id)).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.movimientoTercero.count({ where: { idProveedor: migrado.id } })).toBe(0);
  });

  it('un proveedor `ambos` sin indicar el segmento tampoco pasa (nadie más puede decidirlo)', async () => {
    const prov = await proveedorConModalidad('Las Dos Formas SA', 'ambos');
    await expect(alta(prov.id)).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('lo que el llamador SÍ dice se respeta: el catálogo no degrada un movimiento marcado', async () => {
    // La evidencia manda sobre el catálogo: es lo que protege a un CFDI real de un proveedor mal
    // capturado como `solo_sin` (`cfdi-proveedor.ts` y `entradas-tela.ts` mandan `true` con su UUID).
    const prov = await proveedorConModalidad('Mal Capturado SA', 'solo_sin');
    const mov = await alta(prov.id, true);

    const enBd = await cliente.movimientoTercero.findUniqueOrThrow({
      where: { id: mov.id },
      select: { esFiscal: true },
    });
    expect(enBd.esFiscal).toBe(true);
  });

  it('⚠️ REGLA 0-B: al proveedor migrado se le puede LEER el saldo, aunque no capturarle nada', async () => {
    // Su ficha y su cuenta se consultan con toda normalidad: lo único vedado es el movimiento nuevo.
    const migrado = await proveedorConModalidad('Migrado Legible', null);
    await expect(
      calcularSaldoTercero(sesion(), 'proveedor', migrado.id, bd()),
    ).resolves.toMatchObject({ saldo: 0 });
  });
});
