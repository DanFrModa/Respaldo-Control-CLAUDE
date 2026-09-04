/**
 * ⭐ EL SALDO DEL MAQUILERO SE CALCULA IGUAL EN LOS TRES CAMINOS (V1, fila 0.115).
 *
 * El defecto que estas pruebas cuidan NO era "un filtro mal escrito": era que la MISMA fórmula
 * estaba escrita tres veces —Prisma en `saldos.ts`, y dos SQL crudos en `saldos-todos.ts` (el
 * tablero y el lote de la bandeja de CxP)— y el estado de revisión sólo mandaba en los cargos. Como
 * cada pantalla usaba su copia, arreglar UN archivo habría pasado en verde con los otros dos mal.
 *
 * Por eso la prueba central corre las TRES implementaciones sobre el MISMO fixture y exige que
 * coincidan al centavo: si mañana alguien arregla una y deja otra atrás, esto se pone rojo.
 *
 * Lo demás que se asevera aquí:
 *  • un abono/pago/descuento CAPTURADO no mueve el saldo; al revisarlo lo mueve por su importe exacto;
 *  • lo capturado no desaparece: sale en `pendienteRevision` con el signo que le toca;
 *  • un maquilero cuyo ÚNICO movimiento está sin revisar SIGUE APARECIENDO en el tablero (saldo 0
 *    pero pendiente ≠ 0) — si el corte fuera sólo `saldo <> 0` se volvería invisible, que es justo
 *    el caso que hay que ver;
 *  • la convivencia con CxP/terceros (F9) sigue cuadrando: Σ de los renglones = el saldo.
 *
 * Postgres efímero (testcontainers). La parte PURA —que el SQL y el Prisma salen del mismo
 * criterio— vive en `formula-saldo.test.ts` y corre sin base de datos.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type {
  Empresa,
  PrismaClient,
  Proveedor,
  ServicioOrden,
  TipoProceso,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { estadoDeCuentaTercero } from '../terceros/cuenta-terceros.js';
import { aporteEsMaSaldo, aportesEsMaSaldoLote } from '../terceros/convivencia-esma.js';
import { estadoCuentaDesglosado, estadoCuentaMaquilero } from './estado-cuenta.js';
import { revisarMovimiento } from './movimientos.js';
import { saldoDeMaquilero } from './saldos.js';
import { saldosDeTodosMaquileros, saldosEsMaPorMaquilero } from './saldos-todos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let maquilero: Proveedor;
let procesoCostura: TipoProceso;
let idOrden: number;
let color: { id: number };
let talla: { id: number };
/** Folio correlativo de las etapas que crea `cargoPropuesto` (la tabla lo exige único por empresa). */
let folioEtapa = 0n;

const PERMISOS: ClavePermiso[] = [
  'esma.ver-pagos',
  'esma.modificar',
  'consultas.ver-importes',
  'terceros.ver',
];

const sesion = (permisos: ClavePermiso[] = PERMISOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/** Proveedor con rol de maquila (el tablero sólo lista maquileros activos). */
async function crearMaquilero(nombre: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'Maquila costura' },
  });
  return cliente.proveedor.create({
    data: { nombre, roles: { create: { idRolProveedor: rol.id } } },
  });
}

/** Orden mínima: sólo existe para colgarle los cargos EsMa (FK obligatoria). */
async function crearOrden(): Promise<number> {
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 30, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
    },
  });
  return orden.id;
}

/** Cargo EsMa VALIDADO por `cantidad × precio` (el único concepto que ya respetaba su estado). */
async function cargoValidado(
  idMaquilero: number,
  cantidad: number,
  precio: number,
  conFactura?: boolean,
): Promise<number> {
  const cargo = await cliente.esMaCargo.create({
    data: {
      idEmpresa: empresa.id,
      idMaquilero,
      idOrden,
      idTipoProceso: procesoCostura.id,
      estado: 'validado',
      cantidadReal: cantidad,
      precioReal: precio,
      // La modalidad se fija al VALIDAR; sin ella el cargo cae en el segmento SIN factura.
      ...(conFactura === undefined ? {} : { conFactura }),
    },
  });
  return cargo.id;
}

/**
 * Cargo EsMa **PROPUESTO** (el recibo esperando validación, fila 0.111). Se le puede dar:
 *  • `piezas` → crea el recibo con un detalle de esa cantidad (la cantidad propuesta sale de ahí);
 *  • `precioOrden` → escribe `maquilaOrd` en la orden (el precio de referencia de COSTURA);
 *  • `precioPactado` → precio del recibo, la caída cuando la orden no trae precio;
 *  • `sinCosto` → para medir que una segunda que no se paga NO cuenta como pendiente.
 *
 * Sin `precioOrden` ni `precioPactado` el cargo NO se puede valuar: cuenta como partida y suma a
 * `cargosSinPrecio`, nunca a un importe inventado.
 */
async function cargoPropuesto(
  idMaquilero: number,
  opciones: {
    piezas?: number;
    precioOrden?: number;
    precioPactado?: number;
    sinCosto?: boolean;
    estado?: 'propuesto' | 'cancelado';
  } = {},
): Promise<number> {
  if (opciones.precioOrden !== undefined) {
    await cliente.orden.update({
      where: { id: idOrden },
      data: { maquilaOrd: opciones.precioOrden },
    });
  }
  let idEtapaRecibo: number | undefined;
  if (opciones.piezas !== undefined || opciones.precioPactado !== undefined) {
    folioEtapa += 1n;
    const recibo = await cliente.etapaMovimiento.create({
      data: {
        folio: folioEtapa,
        idEmpresa: empresa.id,
        idOrden,
        tipo: 'recibo_maquila',
        idTipoProceso: procesoCostura.id,
        idTercero: idMaquilero,
        fecha: new Date('2026-06-21T00:00:00Z'),
        ...(opciones.precioPactado === undefined ? {} : { precioPactado: opciones.precioPactado }),
        ...(opciones.piezas === undefined
          ? {}
          : {
              detalles: {
                create: { idColor: color.id, idTalla: talla.id, cantidad: opciones.piezas },
              },
            }),
      },
    });
    idEtapaRecibo = recibo.id;
  }
  const cargo = await cliente.esMaCargo.create({
    data: {
      idEmpresa: empresa.id,
      idMaquilero,
      idOrden,
      idTipoProceso: procesoCostura.id,
      estado: opciones.estado ?? 'propuesto',
      sinCosto: opciones.sinCosto ?? false,
      ...(idEtapaRecibo === undefined ? {} : { idEtapaRecibo }),
    },
  });
  return cargo.id;
}

/**
 * Cargo EsMa **PROPUESTO** de un SERVICIO sobre la orden (0.114): un CORTE o un EMPAQUE. No es una
 * maquila de ida y vuelta —no cuelga de ningún `TipoProceso`, y el CHECK
 * `esma_cargo_proceso_o_servicio` exige que lleve `servicio` en su lugar—, así que su precio de
 * referencia es SÓLO el `precioPactado` de su etapa: la orden trae `maquilaOrd`/`aplicacionOrd`, que
 * son precios de MAQUILA, y ninguno de los dos es un precio de corte ni de empaque.
 *
 * Calca lo que hace el dominio real (`produccion/etapas.ts::registrarCorte` +
 * `crearCargoDeServicio`): etapa del tipo del servicio, sin proceso, con el tercero y el pactado; y
 * el cargo `propuesto` colgado de ella con `idTipoProceso` en NULL.
 */
async function cargoServicioPropuesto(
  idMaquilero: number,
  servicio: ServicioOrden,
  opciones: { piezas: number; precioPactado?: number },
): Promise<number> {
  folioEtapa += 1n;
  const etapa = await cliente.etapaMovimiento.create({
    data: {
      folio: folioEtapa,
      idEmpresa: empresa.id,
      idOrden,
      tipo: servicio,
      idTercero: idMaquilero,
      fecha: new Date('2026-09-04T00:00:00Z'),
      ...(opciones.precioPactado === undefined ? {} : { precioPactado: opciones.precioPactado }),
      detalles: { create: { idColor: color.id, idTalla: talla.id, cantidad: opciones.piezas } },
    },
  });
  const cargo = await cliente.esMaCargo.create({
    data: {
      idEmpresa: empresa.id,
      idMaquilero,
      idOrden,
      // Excluyentes por CHECK: servicio SÍ, proceso NO.
      servicio,
      estado: 'propuesto',
      idEtapaRecibo: etapa.id,
    },
  });
  return cargo.id;
}

/** Alta directa de un movimiento plano en el estado de revisión que se quiera medir. */
async function crearPlano(
  concepto: 'abono' | 'pago' | 'descuento',
  idMaquilero: number,
  monto: number,
  estadoRevision: 'capturado' | 'revisado',
): Promise<number> {
  const data = {
    idEmpresa: empresa.id,
    idMaquilero,
    monto,
    fecha: new Date('2026-06-21T00:00:00Z'),
    estadoRevision,
  };
  if (concepto === 'abono') {
    return (await cliente.abonoMaquilero.create({ data })).id;
  }
  if (concepto === 'pago') {
    return (await cliente.pagoMaquilero.create({ data })).id;
  }
  return (await cliente.descuentoMaquilero.create({ data })).id;
}

/** El saldo del maquilero visto por los TRES caminos (el del tablero puede no traer fila). */
async function saldoPorLosTresCaminos(idMaquilero: number): Promise<{
  prisma: number;
  tablero: number | undefined;
  loteCxp: number | undefined;
}> {
  const uno = await saldoDeMaquilero(sesion(), idMaquilero, {}, bd());
  const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
  const lote = await saldosEsMaPorMaquilero(cliente, empresa.id);
  return {
    prisma: uno.saldo as number,
    tablero: todos.filas.find((f) => f.idMaquilero === idMaquilero)?.saldo ?? undefined,
    loteCxp: lote.get(idMaquilero)?.saldo,
  };
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  maquilero = await crearMaquilero('Maquila Costura SA');
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  idOrden = await crearOrden();
  color = await cliente.color.create({ data: { nombre: 'Negro' } });
  talla = await cliente.talla.create({ data: { etiqueta: 'M' } });
  folioEtapa = 0n;
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ LA PRUEBA QUE MATA LA CLASE DE DEFECTO
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('⭐ las TRES implementaciones de la fórmula sobre el MISMO fixture', () => {
  it('dan el MISMO saldo con los cuatro conceptos mezclando revisados y capturados', async () => {
    // Cargo 10 × 8 = 80 (validado, cuenta).
    await cargoValidado(maquilero.id, 10, 8);
    // Revisados (cuentan): +15 abono, −48 pago, −5 descuento  → saldo 42.
    await crearPlano('abono', maquilero.id, 15, 'revisado');
    await crearPlano('pago', maquilero.id, 48, 'revisado');
    await crearPlano('descuento', maquilero.id, 5, 'revisado');
    // Capturados (NO cuentan): si alguna implementación los sumara, se separaría de las otras.
    await crearPlano('abono', maquilero.id, 111, 'capturado');
    await crearPlano('pago', maquilero.id, 222, 'capturado');
    await crearPlano('descuento', maquilero.id, 333, 'capturado');

    const { prisma, tablero, loteCxp } = await saldoPorLosTresCaminos(maquilero.id);
    expect(prisma).toBe(42);
    expect(tablero).toBe(42);
    expect(loteCxp).toBe(42);
    // Y la convivencia con CxP (que reusa la de Prisma) dice lo mismo.
    await expect(aporteEsMaSaldo(cliente, empresa.id, maquilero.id, false)).resolves.toBe(42);
  });

  it('siguen coincidiendo con importes de centavos (mismo redondeo por subtotal)', async () => {
    // Tres cargos que sueltan decimales al multiplicar: el SQL y el Prisma deben redondear igual.
    await cargoValidado(maquilero.id, 3, 3.33);
    await cargoValidado(maquilero.id, 7, 1.11);
    await crearPlano('abono', maquilero.id, 0.05, 'revisado');
    await crearPlano('descuento', maquilero.id, 0.02, 'revisado');

    const { prisma, tablero, loteCxp } = await saldoPorLosTresCaminos(maquilero.id);
    // 9.99 + 7.77 + 0.05 − 0.02 = 17.79
    expect(prisma).toBe(17.79);
    expect(tablero).toBe(prisma);
    expect(loteCxp).toBe(prisma);
  });

  it('coinciden también cuando TODO está capturado (las tres dicen 0, ninguna cuela el importe)', async () => {
    await crearPlano('abono', maquilero.id, 500, 'capturado');
    await crearPlano('pago', maquilero.id, 200, 'capturado');
    await crearPlano('descuento', maquilero.id, 100, 'capturado');

    const uno = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(uno.saldo).toBe(0);
    expect(uno.totalAbonos).toBe(0);
    expect(uno.totalPagos).toBe(0);
    expect(uno.totalDescuentos).toBe(0);
    // Los tres caminos dicen 0 (ninguno cuela el importe de lo capturado)…
    const { prisma, tablero, loteCxp } = await saldoPorLosTresCaminos(maquilero.id);
    expect(prisma).toBe(0);
    expect(tablero).toBe(0);
    expect(loteCxp).toBe(0);
    // …y el maquilero NO desaparece por tener saldo 0 (§Post-F9.188a, decisión de Daniel): el lote
    // de CxP lo devuelve igual, con su pendiente desglosado, porque alguien tiene que decidir sobre
    // ese dinero. 500 − 200 − 100 = 200, con los MISMOS signos del saldo, en 3 partidas.
    const lote = await saldosEsMaPorMaquilero(cliente, empresa.id);
    expect(lote.get(maquilero.id)).toEqual({
      saldo: 0,
      pendiente: {
        abonos: 500,
        pagos: 200,
        descuentos: 100,
        cargos: 0,
        neto: 200,
        partidas: 3,
        cargosPartidas: 0,
        cargosSinPrecio: 0,
      },
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// EL ESTADO DE REVISIÓN MANDA EN LOS CUATRO CONCEPTOS
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('capturado no mueve el saldo; revisado lo mueve por la cantidad exacta', () => {
  it.each([
    ['abono', 40, 40],
    ['pago', 40, -40],
    ['descuento', 40, -40],
  ] as const)('%s de %d capturado → 0; revisado → %d', async (concepto, monto, esperado) => {
    const id = await crearPlano(concepto, maquilero.id, monto, 'capturado');

    const antes = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(antes.saldo).toBe(0);

    await revisarMovimiento(sesion(), concepto, id, bd());

    const despues = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(despues.saldo).toBe(esperado);
    // El tablero y el lote de CxP se mueven exactamente igual (los tres caminos, otra vez).
    const { tablero, loteCxp } = await saldoPorLosTresCaminos(maquilero.id);
    expect(tablero).toBe(esperado);
    expect(loteCxp).toBe(esperado);
  });

  it('un cargo PROPUESTO no cuenta al saldo, pero SÍ es una partida pendiente (fila 0.111)', async () => {
    await cargoPropuesto(maquilero.id, { piezas: 10, precioOrden: 8 });
    const saldo = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(saldo.totalCargos).toBe(0);
    expect(saldo.saldo).toBe(0);
    // …y no desaparece: 10 piezas × $8 de la orden = $80 esperando la decisión de Daniel.
    expect(saldo.pendienteRevision.cargos).toBe(80);
    expect(saldo.pendienteRevision.neto).toBe(80);
    expect(saldo.pendienteRevision.partidas).toBe(1);
    expect(saldo.pendienteRevision.cargosPartidas).toBe(1);
    expect(saldo.pendienteRevision.cargosSinPrecio).toBe(0);
  });

  it('una segunda SIN COSTO validada no le cobra nada al maquilero', async () => {
    await cliente.esMaCargo.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        idOrden,
        idTipoProceso: procesoCostura.id,
        estado: 'validado',
        sinCosto: true,
        cantidadReal: 10,
        precioReal: 8,
      },
    });
    const { prisma, loteCxp } = await saldoPorLosTresCaminos(maquilero.id);
    expect(prisma).toBe(0);
    // Aquí el lote SÍ lo omite, y no por el corte viejo: una segunda sin costo ya validada no cuenta
    // al saldo NI está pendiente de nada (su pendiente es el cargo `propuesto`, y éste ya se validó).
    // Sin saldo y sin partidas por revisar no hay nada que enseñar — a diferencia del maquilero con
    // todo capturado, que sí sale con saldo 0 (§Post-F9.188a).
    expect(loteCxp).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// EL DINERO EXCLUIDO SE VE (no desaparece sin explicación)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('el pendiente de revisión acompaña al saldo', () => {
  it('desglosa lo capturado por concepto y lo neta con el signo del saldo', async () => {
    await crearPlano('abono', maquilero.id, 100, 'capturado');
    await crearPlano('pago', maquilero.id, 30, 'capturado');
    await crearPlano('descuento', maquilero.id, 20, 'capturado');
    // Uno revisado de cada lado, para que el pendiente NO se lo lleve por delante.
    await crearPlano('abono', maquilero.id, 7, 'revisado');

    const saldo = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(saldo.saldo).toBe(7);
    expect(saldo.pendienteRevision.abonos).toBe(100);
    expect(saldo.pendienteRevision.pagos).toBe(30);
    expect(saldo.pendienteRevision.descuentos).toBe(20);
    // Mismo criterio de signo que el saldo: 100 − 30 − 20 = 50.
    expect(saldo.pendienteRevision.neto).toBe(50);
    // Y el CONTEO: tres partidas capturadas (el abono revisado NO cuenta como pendiente).
    expect(saldo.pendienteRevision.partidas).toBe(3);
  });

  it('al revisar, el importe PASA del pendiente al saldo (no se cuenta dos veces)', async () => {
    const id = await crearPlano('abono', maquilero.id, 60, 'capturado');

    const antes = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(antes.saldo).toBe(0);
    expect(antes.pendienteRevision.neto).toBe(60);

    await revisarMovimiento(sesion(), 'abono', id, bd());

    const despues = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(despues.saldo).toBe(60);
    expect(despues.pendienteRevision.neto).toBe(0);
    expect(despues.pendienteRevision.abonos).toBe(0);
  });

  it('el tablero trae el pendiente por fila y su total', async () => {
    await cargoValidado(maquilero.id, 10, 8); // saldo 80
    await crearPlano('descuento', maquilero.id, 25, 'capturado');

    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === maquilero.id);
    expect(fila?.saldo).toBe(80);
    expect(fila?.pendienteRevision.descuentos).toBe(25);
    expect(fila?.pendienteRevision.neto).toBe(-25);
    expect(todos.totalSaldo).toBe(80);
    expect(todos.totalPendienteNeto).toBe(-25);
  });

  it('el detalle marca «pendiente» exactamente los renglones que el saldo no cuenta', async () => {
    await crearPlano('abono', maquilero.id, 100, 'capturado');
    await crearPlano('abono', maquilero.id, 7, 'revisado');

    const edc = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    const pendientes = edc.movimientos.filter((m) => m.pendienteRevision);
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]?.monto).toBe(100);
    // Y el saldo del encabezado NO lo incluye, pero lo declara aparte.
    expect(edc.saldo.saldo).toBe(7);
    expect(edc.saldo.pendienteRevision.neto).toBe(100);
  });

  it('el detalle imprimible lista los cargos REVISADOS y deja fuera los propuestos', async () => {
    // El desglosado (fuente del PDF y del Excel) pide su criterio a la definición única. Si alguien
    // le quita el filtro, empieza a imprimir cargos que el saldo no cuenta y la hoja se contradice.
    await cargoValidado(maquilero.id, 10, 8);
    await cliente.esMaCargo.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        idOrden,
        idTipoProceso: procesoCostura.id,
        estado: 'propuesto',
      },
    });

    const desglosado = await estadoCuentaDesglosado(sesion(), maquilero.id, {}, bd());
    expect(desglosado.cargos).toHaveLength(1);
    expect(desglosado.cargos[0]?.importe).toBe(80);
  });

  it('⭐ el maquilero cuyo ÚNICO movimiento está pendiente SIGUE saliendo en el tablero', async () => {
    // Con el corte viejo (`saldo <> 0`) éste desaparecía con saldo 0 — justo el que hay que ver.
    await crearPlano('abono', maquilero.id, 90, 'capturado');

    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === maquilero.id);
    expect(fila).toBeDefined();
    expect(fila?.saldo).toBe(0);
    expect(fila?.pendienteRevision.neto).toBe(90);
  });

  it('⭐ sigue visible aunque los SUBTOTALES neteen cero (montos negativos del ETL)', async () => {
    // El ETL carga a propósito montos negativos ("saldo anterior" del Access), así que dos abonos
    // capturados de +500 y −500 dejan el subtotal de abonos en 0 y el neto en 0. Con el conteo la
    // respuesta es exacta: hay DOS partidas esperando decisión y el maquilero tiene que verse.
    await crearPlano('abono', maquilero.id, 500, 'capturado');
    await crearPlano('abono', maquilero.id, -500, 'capturado');

    const uno = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(uno.pendienteRevision.abonos).toBe(0);
    expect(uno.pendienteRevision.neto).toBe(0);
    expect(uno.pendienteRevision.partidas).toBe(2);

    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === maquilero.id);
    expect(fila).toBeDefined();
    expect(fila?.pendienteRevision.partidas).toBe(2);
  });

  it('el conteo del tablero y el de uno en uno coinciden', async () => {
    await crearPlano('abono', maquilero.id, 10, 'capturado');
    await crearPlano('pago', maquilero.id, 20, 'capturado');
    await crearPlano('descuento', maquilero.id, 30, 'revisado'); // revisado: NO es pendiente

    const uno = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === maquilero.id);
    expect(uno.pendienteRevision.partidas).toBe(2);
    expect(fila?.pendienteRevision.partidas).toBe(uno.pendienteRevision.partidas);
  });

  it('sigue visible aunque el pendiente NETEE cero (un abono y un pago capturados iguales)', async () => {
    // Si el corte mirara el neto, estas dos partidas se cancelarían y el maquilero desaparecería
    // con todo en ceros — sin que nadie sepa que hay dos cosas por decidir.
    await crearPlano('abono', maquilero.id, 30, 'capturado');
    await crearPlano('pago', maquilero.id, 30, 'capturado');

    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === maquilero.id);
    expect(fila).toBeDefined();
    expect(fila?.saldo).toBe(0);
    expect(fila?.pendienteRevision.neto).toBe(0);
    expect(fila?.pendienteRevision.abonos).toBe(30);
    expect(fila?.pendienteRevision.pagos).toBe(30);
    expect(fila?.pendienteRevision.partidas).toBe(2);
  });

  it('un maquilero sin nada (saldo 0 y pendiente 0) sigue fuera del tablero', async () => {
    const otro = await crearMaquilero('Maquila Vacía SA');
    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    expect(todos.filas.some((f) => f.idMaquilero === otro.id)).toBe(false);
  });

  it('sin permiso de ver importes, el pendiente también viaja en null', async () => {
    await crearPlano('abono', maquilero.id, 90, 'capturado');
    const saldo = await saldoDeMaquilero(sesion(['esma.ver-pagos']), maquilero.id, {}, bd());
    expect(saldo.saldo).toBeNull();
    expect(saldo.pendienteRevision.neto).toBeNull();
    expect(saldo.pendienteRevision.abonos).toBeNull();

    const todos = await saldosDeTodosMaquileros(sesion(['esma.ver-pagos']), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === maquilero.id);
    // El maquilero SIGUE apareciendo (el corte lo hace el servidor con los importes reales).
    expect(fila).toBeDefined();
    expect(fila?.pendienteRevision.neto).toBeNull();
    expect(todos.totalPendienteNeto).toBeNull();
    // El CONTEO sí viaja: no es un importe, y sin él quien no ve dinero tampoco sabría que hay algo
    // esperando decisión.
    expect(saldo.pendienteRevision.partidas).toBe(1);
    expect(fila?.pendienteRevision.partidas).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// LA CONVIVENCIA CON CxP / TERCEROS (F9) SIGUE CUADRANDO
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('convivencia con el motor de terceros (F9)', () => {
  it('Σ de los renglones del estado de cuenta del proveedor = su saldo, con partidas pendientes', async () => {
    // ⚠️ Los TRES conceptos planos llevan una partida capturada. Antes esta prueba sólo dejaba
    // pendientes un pago y un descuento, y la rama del ABONO no la tocaba nadie: forzarla a contar
    // dejaba la suite en verde. Cada concepto tiene su propia rama en el proyector, así que cada
    // concepto necesita su propio renglón pendiente aquí.
    await cargoValidado(maquilero.id, 10, 5); // +50 (cuenta)
    await crearPlano('abono', maquilero.id, 20, 'revisado'); // +20 (cuenta)
    await crearPlano('abono', maquilero.id, 77, 'capturado'); // no cuenta
    await crearPlano('pago', maquilero.id, 15, 'capturado'); // no cuenta
    await crearPlano('descuento', maquilero.id, 5, 'capturado'); // no cuenta

    const estado = await estadoDeCuentaTercero(
      sesion(),
      'proveedor',
      maquilero.id,
      { porPagina: 100 },
      bd(),
    );
    // Los 5 renglones se ven (nadie los esconde)…
    expect(estado.movimientos).toHaveLength(5);
    // …pero los TRES pendientes van SIN importe y lo dicen en su texto, uno por concepto.
    const sinImporte = estado.movimientos.filter((m) => m.monto === null);
    expect(sinImporte).toHaveLength(3);
    expect(sinImporte.map((m) => m.origen).sort()).toEqual(['abono', 'descuento', 'pago']);
    for (const m of sinImporte) {
      expect(m.observaciones).toContain('pendiente de revisión');
    }
    // Y los que SÍ cuentan conservan su importe con su signo (nadie los borró de más).
    const conImporte = estado.movimientos.filter((m) => m.monto !== null);
    expect(conImporte.map((m) => m.monto).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([20, 50]);
    // Y la promesa del libro se sostiene: Σ renglones = saldo.
    const suma = estado.movimientos.reduce((s, m) => s + (m.monto ?? 0), 0);
    expect(Math.round(suma * 100) / 100).toBe(70);
    expect(estado.saldo.saldo).toBe(70);
    expect(estado.saldo.saldoEsMa).toBe(70);
  });

  it('cada concepto plano pendiente se apaga POR SEPARADO en el detalle de CxP', async () => {
    // Una prueba por rama: si alguien "arregla" sólo el abono, el pago o el descuento, esto lo dice
    // con nombre y apellido en vez de fallar en un total agregado.
    for (const concepto of ['abono', 'pago', 'descuento'] as const) {
      const otro = await crearMaquilero(`Maquila ${concepto} SA`);
      await crearPlano(concepto, otro.id, 100, 'capturado');

      const estado = await estadoDeCuentaTercero(
        sesion(),
        'proveedor',
        otro.id,
        { porPagina: 100 },
        bd(),
      );
      expect(estado.movimientos, concepto).toHaveLength(1);
      expect(estado.movimientos[0]?.origen, concepto).toBe(concepto);
      expect(estado.movimientos[0]?.monto, concepto).toBeNull();
      expect(estado.movimientos[0]?.observaciones, concepto).toContain('pendiente de revisión');
      expect(estado.saldo.saldoEsMa, concepto).toBe(0);
    }
  });

  it('el lote de la bandeja de CxP y el saldo de uno en uno dan lo mismo', async () => {
    const otro = await crearMaquilero('Maquila Dos SA');
    await cargoValidado(maquilero.id, 4, 10); // 40
    await crearPlano('pago', maquilero.id, 10, 'revisado'); // −10 → 30
    await crearPlano('abono', otro.id, 25, 'revisado'); // 25
    await crearPlano('abono', otro.id, 999, 'capturado'); // no cuenta

    const lote = await aportesEsMaSaldoLote(cliente, empresa.id);
    expect(lote.get(maquilero.id)?.saldo).toBe(30);
    expect(lote.get(otro.id)?.saldo).toBe(25);
    // Y el 999 capturado de `otro` no se perdió: viaja como pendiente, con su conteo.
    expect(lote.get(otro.id)?.pendiente).toMatchObject({ abonos: 999, neto: 999, partidas: 1 });
    for (const [id, aporte] of lote) {
      await expect(aporteEsMaSaldo(cliente, empresa.id, id, false)).resolves.toBe(aporte.saldo);
    }
  });

  it('⭐ el lote NO pierde al maquilero con TODO sin revisar (§Post-F9.188a)', async () => {
    // Saldo 0 y una partida capturada: con el corte viejo (`saldo ≠ 0`) el lote no lo devolvía y la
    // bandeja de CxP lo hacía desaparecer. Daniel: no debe desaparecer.
    const soloPendiente = await crearMaquilero('Maquila Todo Capturado SA');
    await crearPlano('pago', soloPendiente.id, 120, 'capturado');

    const lote = await aportesEsMaSaldoLote(cliente, empresa.id);
    expect(lote.get(soloPendiente.id)).toEqual({
      saldo: 0,
      pendiente: {
        abonos: 0,
        pagos: 120,
        descuentos: 0,
        cargos: 0,
        neto: -120,
        partidas: 1,
        cargosPartidas: 0,
        cargosSinPrecio: 0,
      },
    });
    // Y el que no tiene NADA sigue fuera (ni saldo ni partidas).
    const vacio = await crearMaquilero('Maquila Vacía SA');
    expect((await aportesEsMaSaldoLote(cliente, empresa.id)).has(vacio.id)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ LOS RECIBOS SIN VALIDAR TAMBIÉN ESPERAN UNA DECISIÓN (V1, fila 0.111)
//
// El hueco que Daniel describió el 3-sep: *«cada semana me pueda meter a algún lugar donde estén
// todos los maquileros que tengan algo pendiente por pagar o por descontar»*, y *«no quiero otra
// pantalla»*. Un maquilero con diez recibos sin validar y NADA más tenía saldo 0, pendiente 0 y era
// invisible en las tres puertas del dinero: el tablero de EsMa, la bandeja de CxP y la corrida.
//
// Aquí se mide que las TRES lo vean, que valúen IGUAL (la regla del precio vive en un solo sitio) y
// que lo que no se le va a pagar —cancelado, sin costo— siga fuera.
//
// ⭐ Y desde la 0.114 «recibo por validar» ya no es sólo el de una maquila: el CORTE y el EMPAQUE
// generan su propio cargo `propuesto`, sin `TipoProceso` y con su `precioPactado` como único precio.
// Ésos son los que un INNER JOIN sobre `tipos_proceso` borraría del agregado sin decir nada, así que
// cada caso se cruza contra el saldo de uno en uno (Prisma), que no une ninguna tabla.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('⭐ el maquilero con SÓLO recibos por validar se ve en las tres puertas', () => {
  it('con precio en la orden: aparece con su partida y su importe derivado', async () => {
    const soloRecibos = await crearMaquilero('Maquila Sólo Recibos SA');
    await cargoPropuesto(soloRecibos.id, { piezas: 10, precioOrden: 8 });
    await cargoPropuesto(soloRecibos.id, { piezas: 5, precioOrden: 8 });

    // (1) EL TABLERO de EsMa: saldo 0 y aun así la fila existe, con 2 partidas y $120.
    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === soloRecibos.id);
    expect(fila?.saldo).toBe(0);
    expect(fila?.pendienteRevision.cargos).toBe(120);
    expect(fila?.pendienteRevision.partidas).toBe(2);
    expect(fila?.pendienteRevision.cargosPartidas).toBe(2);
    expect(fila?.pendienteRevision.cargosSinPrecio).toBe(0);
    // El pie de la pantalla lo agrega el servidor, no la tabla del cliente (y es EXACTO: el otro
    // maquilero del fixture no tiene movimientos, así que ni siquiera sale en la lista).
    expect(todos.totalCargosPorValidar).toBe(2);

    // (2) EL LOTE que alimenta la BANDEJA de CxP («maquila por revisar») lo trae igual.
    const lote = await aportesEsMaSaldoLote(cliente, empresa.id);
    expect(lote.get(soloRecibos.id)?.saldo).toBe(0);
    expect(lote.get(soloRecibos.id)?.pendiente.cargos).toBe(120);
    expect(lote.get(soloRecibos.id)?.pendiente.partidas).toBe(2);

    // (3) Y EL SALDO DE UNO EN UNO (Prisma) dice exactamente lo mismo: la regla del precio y el
    // criterio son los mismos en los tres caminos, no tres copias que se van separando.
    const uno = await saldoDeMaquilero(sesion(), soloRecibos.id, {}, bd());
    expect(uno.pendienteRevision).toEqual(fila?.pendienteRevision);
    expect(lote.get(soloRecibos.id)?.pendiente.neto).toBe(uno.pendienteRevision.neto);
  });

  it('SIN precio en ningún lado: cuenta como partida y se anuncia que no se puede valuar', async () => {
    // La orden no trae precio y el recibo tampoco: NO se inventa un importe, pero la decisión
    // sigue encima de Daniel — así que la partida cuenta y el cargo se anota aparte.
    const sinPrecio = await crearMaquilero('Maquila Sin Precio SA');
    await cargoPropuesto(sinPrecio.id, { piezas: 12 });

    const fila = (await saldosDeTodosMaquileros(sesion(), {}, bd())).filas.find(
      (f) => f.idMaquilero === sinPrecio.id,
    );
    expect(fila?.pendienteRevision.cargos).toBe(0);
    expect(fila?.pendienteRevision.partidas).toBe(1);
    expect(fila?.pendienteRevision.cargosSinPrecio).toBe(1);

    const uno = await saldoDeMaquilero(sesion(), sinPrecio.id, {}, bd());
    expect(uno.pendienteRevision).toEqual(fila?.pendienteRevision);
  });

  it('el precio CAE al pactado del recibo cuando la orden no lo trae (misma regla en los dos caminos)', async () => {
    const conPactado = await crearMaquilero('Maquila Precio Pactado SA');
    await cargoPropuesto(conPactado.id, { piezas: 4, precioPactado: 7.5 });

    const fila = (await saldosDeTodosMaquileros(sesion(), {}, bd())).filas.find(
      (f) => f.idMaquilero === conPactado.id,
    );
    expect(fila?.pendienteRevision.cargos).toBe(30);
    expect(fila?.pendienteRevision.cargosSinPrecio).toBe(0);

    const uno = await saldoDeMaquilero(sesion(), conPactado.id, {}, bd());
    expect(uno.pendienteRevision.cargos).toBe(30);
    expect(uno.pendienteRevision).toEqual(fila?.pendienteRevision);
  });

  it('el precio de la ORDEN gana sobre el pactado del recibo (decisión (e) de F6-E4)', async () => {
    const conAmbos = await crearMaquilero('Maquila Ambos Precios SA');
    await cargoPropuesto(conAmbos.id, { piezas: 10, precioOrden: 8, precioPactado: 3 });

    const uno = await saldoDeMaquilero(sesion(), conAmbos.id, {}, bd());
    expect(uno.pendienteRevision.cargos).toBe(80);
  });

  it('⭐ un CORTE por validar (servicio, 0.114) también espera decisión, con SU precio pactado', async () => {
    // Desde la 0.114 el corte y el empaque se pagan como maquila pero NO son procesos de maquila:
    // el cargo lleva `servicio` y su `id_tipo_proceso` va en NULL. Ese NULL es justo el que se cae
    // de un INNER JOIN — y con él, el cortador entero desaparecería de las tres puertas.
    // La orden trae precios de MAQUILA a propósito: si alguno se le prestara al corte, aquí
    // saldrían 10 × 99 (costura) o 10 × 77 (aplicación) en lugar de 10 × 3.5.
    await cliente.orden.update({
      where: { id: idOrden },
      data: { maquilaOrd: 99, aplicacionOrd: 77 },
    });
    const cortador = await crearMaquilero('Taller de Corte SA');
    await cargoServicioPropuesto(cortador.id, 'corte', { piezas: 10, precioPactado: 3.5 });

    // (1) EL TABLERO: el cortador existe, con saldo 0 y su partida esperando decisión.
    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === cortador.id);
    expect(fila).toBeDefined();
    expect(fila?.saldo).toBe(0);
    expect(fila?.pendienteRevision.cargos).toBe(35);
    expect(fila?.pendienteRevision.neto).toBe(35);
    expect(fila?.pendienteRevision.partidas).toBe(1);
    expect(fila?.pendienteRevision.cargosPartidas).toBe(1);
    expect(fila?.pendienteRevision.cargosSinPrecio).toBe(0);

    // (2) EL LOTE de la bandeja de CxP.
    const lote = await aportesEsMaSaldoLote(cliente, empresa.id);
    expect(lote.get(cortador.id)?.pendiente.cargos).toBe(35);
    expect(lote.get(cortador.id)?.pendiente.partidas).toBe(1);

    // (3) Y EL SALDO DE UNO EN UNO (Prisma), que no une ninguna tabla y por eso es el testigo: si
    // el SQL dejara fuera a los servicios, este `toEqual` se pondría rojo con la diferencia exacta.
    const uno = await saldoDeMaquilero(sesion(), cortador.id, {}, bd());
    expect(uno.pendienteRevision.cargos).toBe(35);
    expect(uno.pendienteRevision).toEqual(fila?.pendienteRevision);
  });

  it('⭐ un EMPAQUE sin precio pactado NO hereda el de la orden: partida sin importe', async () => {
    // REGLA 0-B: lo que falta se tolera, no se rellena. Sin pactado el empaque no se puede valuar,
    // y la partida sigue contando para que alguien la decida.
    await cliente.orden.update({
      where: { id: idOrden },
      data: { maquilaOrd: 99, aplicacionOrd: 77 },
    });
    const empacador = await crearMaquilero('Taller de Empaque SA');
    await cargoServicioPropuesto(empacador.id, 'empaque', { piezas: 20 });

    const fila = (await saldosDeTodosMaquileros(sesion(), {}, bd())).filas.find(
      (f) => f.idMaquilero === empacador.id,
    );
    expect(fila).toBeDefined();
    // Ni 20 × 99 ni 20 × 77: sin pactado NO hay precio, y no se inventa uno.
    expect(fila?.pendienteRevision.cargos).toBe(0);
    expect(fila?.pendienteRevision.partidas).toBe(1);
    expect(fila?.pendienteRevision.cargosPartidas).toBe(1);
    expect(fila?.pendienteRevision.cargosSinPrecio).toBe(1);

    const uno = await saldoDeMaquilero(sesion(), empacador.id, {}, bd());
    expect(uno.pendienteRevision).toEqual(fila?.pendienteRevision);
  });

  it('⭐ maquila y servicio en el MISMO maquilero: los dos caminos suman exactamente igual', async () => {
    // El cruce que caza el defecto de raíz. Aquí el maquilero se ve de todas formas (tiene su
    // recibo de costura), así que lo único que delata un agregado que se coma los servicios es que
    // los DOS números dejen de coincidir: 115 y 2 partidas contra 80 y 1.
    const mixto = await crearMaquilero('Maquila y Corte SA');
    await cargoPropuesto(mixto.id, { piezas: 10, precioOrden: 8 });
    await cargoServicioPropuesto(mixto.id, 'corte', { piezas: 10, precioPactado: 3.5 });

    const fila = (await saldosDeTodosMaquileros(sesion(), {}, bd())).filas.find(
      (f) => f.idMaquilero === mixto.id,
    );
    expect(fila).toBeDefined();
    // 10 × 8 (costura, precio de la orden) + 10 × 3.5 (corte, precio pactado) = 115.
    expect(fila?.pendienteRevision.cargos).toBe(115);
    expect(fila?.pendienteRevision.cargosPartidas).toBe(2);
    expect(fila?.pendienteRevision.partidas).toBe(2);

    const uno = await saldoDeMaquilero(sesion(), mixto.id, {}, bd());
    expect(uno.pendienteRevision.cargos).toBe(115);
    expect(uno.pendienteRevision).toEqual(fila?.pendienteRevision);

    const lote = await aportesEsMaSaldoLote(cliente, empresa.id);
    expect(lote.get(mixto.id)?.pendiente.cargos).toBe(115);
    expect(lote.get(mixto.id)?.pendiente.partidas).toBe(2);
  });

  it('un cargo CANCELADO o SIN COSTO no espera ninguna decisión: fuera de las tres', async () => {
    const cancelado = await crearMaquilero('Maquila Cancelada SA');
    await cargoPropuesto(cancelado.id, { piezas: 10, precioOrden: 8, estado: 'cancelado' });
    const segunda = await crearMaquilero('Maquila Segunda Sin Costo SA');
    await cargoPropuesto(segunda.id, { piezas: 10, precioOrden: 8, sinCosto: true });

    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    expect(todos.filas.some((f) => f.idMaquilero === cancelado.id)).toBe(false);
    expect(todos.filas.some((f) => f.idMaquilero === segunda.id)).toBe(false);

    const lote = await aportesEsMaSaldoLote(cliente, empresa.id);
    expect(lote.has(cancelado.id)).toBe(false);
    expect(lote.has(segunda.id)).toBe(false);
  });

  it('las prendas INCOMPLETAS no se pagan, así que tampoco se valúan (§Post-F9.136)', async () => {
    // `cantidad` es lo que se paga; `cantidadIncompletas` viaja aparte y NUNCA se le suma. Si
    // entrara, acabaría multiplicada por el precio y el pendiente cobraría de más.
    const conIncompletas = await crearMaquilero('Maquila Con Incompletas SA');
    await cargoPropuesto(conIncompletas.id, { piezas: 10, precioOrden: 8 });
    await cliente.etapaMovimientoDet.updateMany({ data: { cantidadIncompletas: 4 } });

    const uno = await saldoDeMaquilero(sesion(), conIncompletas.id, {}, bd());
    expect(uno.pendienteRevision.cargos).toBe(80);
  });

  it('el recibo sin validar NO tiene todavía modalidad de factura: cae entero en el segmento SIN', async () => {
    // `conFactura` se fija al VALIDAR el cargo, así que un propuesto lo tiene sin definir — y «sin
    // factura» = false **o sin definir** (la partición única de formula-saldo.ts §segmento). Nadie
    // ha decidido aún cómo se le va a pagar, y las dos relaciones de la semana tienen que sumar el
    // total: si los propuestos quedaran fuera de las dos, nadie los vería nunca.
    const propuesto = await crearMaquilero('Maquila Segmento SA');
    await cargoPropuesto(propuesto.id, { piezas: 10, precioOrden: 8 });

    const sinFactura = await saldoDeMaquilero(sesion(), propuesto.id, { conFactura: 'sin' }, bd());
    expect(sinFactura.pendienteRevision.cargosPartidas).toBe(1);
    expect(sinFactura.pendienteRevision.cargos).toBe(80);

    const conFactura = await saldoDeMaquilero(sesion(), propuesto.id, { conFactura: 'con' }, bd());
    expect(conFactura.pendienteRevision.cargosPartidas).toBe(0);

    // Y el tablero segmentado dice lo mismo que el saldo de uno en uno (las dos implementaciones).
    const filaSin = (
      await saldosDeTodosMaquileros(sesion(), { conFactura: 'sin' }, bd())
    ).filas.find((f) => f.idMaquilero === propuesto.id);
    expect(filaSin?.pendienteRevision).toEqual(sinFactura.pendienteRevision);
  });

  it('⭐ el TABLERO también segmenta los propuestos: en la relación CON factura no sale ninguno', async () => {
    // 🔴 Esta prueba existe porque sin ella el `${factura}` del agregado SQL no lo medía NADIE: se
    // podía borrar de `sqlCargosPropuestosPorMaquilero` y las 35 pruebas de este archivo seguían
    // verdes, porque todas piden el segmento SIN —donde el propuesto (con `conFactura` NULL) cae
    // igual con filtro o sin él—. Con esa regresión el mismo cargo saldría en las DOS relaciones
    // semanales de Daniel, que es justo la partición que la fila 0.113 sostiene.
    const mixto = await crearMaquilero('Maquila Dos Segmentos SA');
    // Un cargo VALIDADO con factura: pone al maquilero en la relación CON, con saldo 80.
    await cargoValidado(mixto.id, 10, 8, true);
    // Y un cargo PROPUESTO, que por no estar validado no tiene modalidad todavía → segmento SIN.
    await cargoPropuesto(mixto.id, { piezas: 10, precioOrden: 8 });

    // (1) EN LA RELACIÓN CON FACTURA la fila EXISTE —por eso la aserción muerde— y su «por revisar»
    //     está en CERO: ninguno de sus propuestos pertenece a este segmento.
    const filaCon = (
      await saldosDeTodosMaquileros(sesion(), { conFactura: 'con' }, bd())
    ).filas.find((f) => f.idMaquilero === mixto.id);
    if (filaCon === undefined) throw new Error('el tablero CON factura no trajo al maquilero');
    expect(filaCon.saldo).toBe(80);
    expect(filaCon.pendienteRevision.cargosPartidas).toBe(0);
    expect(filaCon.pendienteRevision.cargos).toBe(0);
    expect(filaCon.pendienteRevision.partidas).toBe(0);

    // (2) EN LA RELACIÓN SIN FACTURA pasa lo contrario: saldo 0 (el validado con factura no cuenta
    //     aquí) y el propuesto entero esperando decisión.
    const filaSin = (
      await saldosDeTodosMaquileros(sesion(), { conFactura: 'sin' }, bd())
    ).filas.find((f) => f.idMaquilero === mixto.id);
    if (filaSin === undefined) throw new Error('el tablero SIN factura no trajo al maquilero');
    expect(filaSin.saldo).toBe(0);
    expect(filaSin.pendienteRevision.cargosPartidas).toBe(1);
    expect(filaSin.pendienteRevision.cargos).toBe(80);

    // (3) Y las dos implementaciones siguen coincidiendo DENTRO de cada segmento.
    const unoCon = await saldoDeMaquilero(sesion(), mixto.id, { conFactura: 'con' }, bd());
    expect(unoCon.pendienteRevision).toEqual(filaCon.pendienteRevision);
    const unoSin = await saldoDeMaquilero(sesion(), mixto.id, { conFactura: 'sin' }, bd());
    expect(unoSin.pendienteRevision).toEqual(filaSin.pendienteRevision);

    // (4) Y sin segmentar, el total: el propuesto se cuenta UNA vez, no dos.
    const filaTodo = (await saldosDeTodosMaquileros(sesion(), {}, bd())).filas.find(
      (f) => f.idMaquilero === mixto.id,
    );
    expect(filaTodo?.saldo).toBe(80);
    expect(filaTodo?.pendienteRevision.cargosPartidas).toBe(1);
  });

  it('al VALIDARLO, el importe pasa del pendiente al saldo (no se cuenta dos veces)', async () => {
    const validable = await crearMaquilero('Maquila Por Validar SA');
    const idCargo = await cargoPropuesto(validable.id, { piezas: 10, precioOrden: 8 });

    const antes = await saldoDeMaquilero(sesion(), validable.id, {}, bd());
    expect(antes.saldo).toBe(0);
    expect(antes.pendienteRevision.cargos).toBe(80);

    await cliente.esMaCargo.update({
      where: { id: idCargo },
      data: { estado: 'validado', cantidadReal: 10, precioReal: 8 },
    });

    const despues = await saldoDeMaquilero(sesion(), validable.id, {}, bd());
    expect(despues.saldo).toBe(80);
    expect(despues.pendienteRevision.cargos).toBe(0);
    expect(despues.pendienteRevision.partidas).toBe(0);
  });

  it('sin permiso de ver importes, el importe del recibo se oculta y los conteos NO', async () => {
    const oculto = await crearMaquilero('Maquila Oculta SA');
    // Uno valuable por el precio PACTADO de su recibo y otro sin precio en ningún lado. El precio
    // pactado (y no el de la orden) porque la orden es COMPARTIDA en este fixture: ponérselo a una
    // dejaría de existir el caso «sin precio».
    await cargoPropuesto(oculto.id, { piezas: 10, precioPactado: 8 });
    await cargoPropuesto(oculto.id, { piezas: 3 });

    const sinDinero = sesion(['esma.ver-pagos']);
    const uno = await saldoDeMaquilero(sinDinero, oculto.id, {}, bd());
    expect(uno.pendienteRevision.cargos).toBeNull();
    expect(uno.pendienteRevision.neto).toBeNull();
    // Los conteos son los que hacen que se sepa que hay dos decisiones encima.
    expect(uno.pendienteRevision.partidas).toBe(2);
    expect(uno.pendienteRevision.cargosPartidas).toBe(2);
    expect(uno.pendienteRevision.cargosSinPrecio).toBe(1);

    const fila = (await saldosDeTodosMaquileros(sinDinero, {}, bd())).filas.find(
      (f) => f.idMaquilero === oculto.id,
    );
    expect(fila?.pendienteRevision).toEqual(uno.pendienteRevision);
  });
});
