/**
 * Tests de integración del CORAZÓN CONTABLE de EsMa (F6-E4). Postgres efímero (testcontainers).
 * Cubre lo que la ficha exige:
 *  (a) fórmula del saldo con nulos=0 (Σcargos + Σabonos − Σpagos − Σdescuentos);
 *  (b) segundas SIN COSTO excluidas del saldo y del pago;
 *  (c) prendas por pagar: pagar consume, re-pagar lo ya pagado → error (bloqueo duro, decisión g);
 *  (d) el cargo de ESTAMPADO usa aplicacionOrd; el de COSTURA usa maquilaOrd (decisión e);
 *  (e) Orden.pagada DERIVADA (todos los cargos pagados) + override forzado (decisión f);
 *  (f) conciliación: faltantes por cargar + cargos sin recibo;
 *  (g) facturación "ambos" obliga a elegir con/sin (decisión h).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  TipoProceso,
} from '../../datos/index.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { registrarCorte, registrarEnvioMaquila } from '../produccion/etapas.js';
import { registrarReciboMaquila } from '../produccion/recibos.js';
import { listarCargosEsMa, validarCargoEsMa } from './cargos.js';
import { crearAbonoMaquilero, crearDescuentoMaquilero } from './movimientos.js';
import { crearPagoMaquilero } from './pagos.js';
import { saldoDeMaquilero } from './saldos.js';
import { conciliarEsMa } from './conciliacion.js';
import { forzarOrdenPagada, obtenerOrdenPagada } from './orden-pagada.js';
import { crearCargoEsMaMigrado } from './migracion.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor;
let maquileroCostura: Proveedor;
let estampador: Proveedor;
let procesoCostura: TipoProceso;
let procesoEstampado: TipoProceso;
let almPrimeras: Almacen;
let clienteNegocioId: number;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  // Permisos de los PASOS DE ARRANGE (corte/envío/recibo mueven WIP + kardex PT): mismos que
  // `recibos.int.test.ts` (que sí pasa) — incluye `produccion.wip-ver` (obtenerRecibo lo exige) y
  // `inventario-pt.ver`.
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.cancelar',
  'produccion.wip-ver',
  'inventario-pt.ver',
  'esma.cargo-validar',
  'esma.modificar',
  'esma.ver-pagos',
  'consultas.ver-importes',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

async function crearProveedorConRol(nombre: string, codigoRol: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: codigoRol },
    update: {},
    create: { codigo: codigoRol, nombre: codigoRol },
  });
  return cliente.proveedor.create({
    data: {
      modalidadFacturacion: 'solo_sin',
      nombre,
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
}

/** Orden Rojo (CH 10, M 20), con maquilaOrd=10 (costura) y aplicacionOrd=5 (estampado). */
async function crearOrdenConMatriz(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
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
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      maquilaOrd: 10,
      aplicacionOrd: 5,
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 10 },
                { idTalla: tallaM.id, cantidad: 20 },
              ],
            },
          },
        ],
      },
    },
  });
  return orden.id;
}

async function sembrarTiposMovimiento(): Promise<void> {
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
    ],
  });
}

async function cortarBase(): Promise<void> {
  await registrarCorte(
    sesion(),
    {
      idOrden,
      idCortador: cortador.id,
      fecha: '2026-06-18',
      lineas: [
        {
          idColor: colorRojo.id,
          tallas: [
            { idTalla: tallaCH.id, cantidad: 10 },
            { idTalla: tallaM.id, cantidad: 20 },
          ],
        },
      ],
    },
    bd(),
  );
}

async function enviar(proceso: TipoProceso, maquilero: Proveedor, cantCH: number): Promise<void> {
  await registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: proceso.id,
      idMaquilero: maquilero.id,
      fecha: '2026-06-19',
      precioPactado: 8,
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: cantCH }] }],
    },
    bd(),
  );
}

/** Recibe `cantCH` de Rojo/CH del proceso; costura lleva almacén de primeras. Devuelve nada. */
async function recibir(proceso: TipoProceso, maquilero: Proveedor, cantCH: number): Promise<void> {
  await registrarReciboMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: proceso.id,
      idMaquilero: maquilero.id,
      fecha: '2026-06-20',
      precioPactado: 8,
      ...(proceso.generaEntradaPt ? { idAlmacenPrimeras: almPrimeras.id } : {}),
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: cantCH }] }],
    },
    bd(),
  );
}

/** Corta, envía y recibe `cant` de un proceso; valida el cargo con cantidad/precio reales dados. */
async function cargoValidado(
  proceso: TipoProceso,
  maquilero: Proveedor,
  cant: number,
  cantidadReal: number,
  precioReal: number,
  extra: { sinCosto?: boolean } = {},
): Promise<number> {
  await enviar(proceso, maquilero, cant);
  await recibir(proceso, maquilero, cant);
  const cola = await listarCargosEsMa(
    sesion(),
    { estado: 'propuesto', idMaquilero: maquilero.id },
    bd(),
  );
  const idCargo = cola.filas[0]?.id as number;
  await validarCargoEsMa(sesion(), idCargo, { cantidadReal, precioReal, ...extra }, bd());
  return idCargo;
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  cortador = await crearProveedorConRol('Corte SA', 'corte');
  maquileroCostura = await crearProveedorConRol('Maquila Costura SA', 'maquila-costura');
  estampador = await crearProveedorConRol('Estampados SA', 'estampado');
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  procesoEstampado = await cliente.tipoProceso.create({
    data: { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  await sembrarTiposMovimiento();
  idOrden = await crearOrdenConMatriz();
  await cortarBase();
});

describe('Precio de referencia por proceso (decisión e)', () => {
  it('costura → maquilaOrd (10); estampado → aplicacionOrd (5)', async () => {
    await enviar(procesoCostura, maquileroCostura, 10);
    await recibir(procesoCostura, maquileroCostura, 10);
    await enviar(procesoEstampado, estampador, 10);
    await recibir(procesoEstampado, estampador, 10);

    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    const costura = cola.filas.find((f) => f.tipoProceso === 'Costura');
    const estampado = cola.filas.find((f) => f.tipoProceso === 'Estampado');
    expect(costura?.precioPropuesto).toBe(10); // maquilaOrd
    expect(estampado?.precioPropuesto).toBe(5); // aplicacionOrd (NO maquilaOrd — corrige bug v1)
  });
});

describe('Saldo derivado (decisión: fórmula EsMa_SaldosMaq con nulos=0)', () => {
  it('(a) saldo = Σcargos + Σabonos − Σpagos − Σdescuentos', async () => {
    // Cargo validado 10 × 8 = 80.
    const idCargo = await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8);
    // Abono 15, descuento 5.
    await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquileroCostura.id, monto: 15, fecha: '2026-06-21' },
      bd(),
    );
    await crearDescuentoMaquilero(
      sesion(),
      { idMaquilero: maquileroCostura.id, monto: 5, fecha: '2026-06-21' },
      bd(),
    );
    // Pago de 6 prendas × 8 = 48.
    await crearPagoMaquilero(
      sesion(),
      {
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-22',
        aplicaciones: [{ idCargo, cantidad: 6 }],
      },
      bd(),
    );

    const saldo = await saldoDeMaquilero(sesion(), maquileroCostura.id, {}, bd());
    // 80 + 15 − 48 − 5 = 42
    expect(saldo.totalCargos).toBe(80);
    expect(saldo.totalAbonos).toBe(15);
    expect(saldo.totalPagos).toBe(48);
    expect(saldo.totalDescuentos).toBe(5);
    expect(saldo.saldo).toBe(42);
  });

  it('(b) segundas SIN COSTO se excluyen del saldo', async () => {
    await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8, { sinCosto: true });
    const saldo = await saldoDeMaquilero(sesion(), maquileroCostura.id, {}, bd());
    expect(saldo.totalCargos).toBe(0);
    expect(saldo.saldo).toBe(0);
  });

  it('oculta importes sin consultas.ver-importes (todo null)', async () => {
    await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8);
    const permsSinImportes: ClavePermiso[] = ['esma.ver-pagos'];
    const saldo = await saldoDeMaquilero(sesion(permsSinImportes), maquileroCostura.id, {}, bd());
    expect(saldo.saldo).toBeNull();
    expect(saldo.totalCargos).toBeNull();
  });
});

describe('Prendas por pagar / anti-doble-pago (decisión g)', () => {
  it('(c) pagar consume prendas; re-pagar lo ya pagado → ErrorConflicto', async () => {
    const idCargo = await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8);

    // Paga 6 de 10.
    await crearPagoMaquilero(
      sesion(),
      {
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-22',
        aplicaciones: [{ idCargo, cantidad: 6 }],
      },
      bd(),
    );
    const tras6 = await listarCargosEsMa(sesion(), { estado: 'validado' }, bd());
    const c6 = tras6.filas.find((f) => f.id === idCargo);
    expect(c6?.cantidadPagada).toBe(6);
    expect(c6?.porPagar).toBe(4);
    expect(c6?.pagado).toBe(false);

    // Paga las 4 restantes → queda pagado.
    await crearPagoMaquilero(
      sesion(),
      {
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-23',
        aplicaciones: [{ idCargo, cantidad: 4 }],
      },
      bd(),
    );
    const tras10 = await listarCargosEsMa(sesion(), { estado: 'validado' }, bd());
    const c10 = tras10.filas.find((f) => f.id === idCargo);
    expect(c10?.cantidadPagada).toBe(10);
    expect(c10?.porPagar).toBe(0);
    expect(c10?.pagado).toBe(true);
    expect(c10?.estadoConciliacion).toBe('pagado');

    // Re-pagar 1 más → bloqueo duro.
    await expect(
      crearPagoMaquilero(
        sesion(),
        {
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-24',
          aplicaciones: [{ idCargo, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('pagar de una vez más de lo que hay por pagar → ErrorConflicto', async () => {
    const idCargo = await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8);
    await expect(
      crearPagoMaquilero(
        sesion(),
        {
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-22',
          aplicaciones: [{ idCargo, cantidad: 20 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('un cargo SIN COSTO no se puede pagar → ErrorConflicto', async () => {
    const idCargo = await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8, {
      sinCosto: true,
    });
    await expect(
      crearPagoMaquilero(
        sesion(),
        {
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-22',
          aplicaciones: [{ idCargo, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Orden pagada: derivada + override (decisión f)', () => {
  it('(e) al pagar todos los cargos, la orden queda pagada (derivada)', async () => {
    const idCargo = await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8);
    let estatus = await obtenerOrdenPagada(sesion(), idOrden, bd());
    expect(estatus.cargosPagables).toBe(1);
    expect(estatus.pagadaDerivada).toBe(false);

    await crearPagoMaquilero(
      sesion(),
      {
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-22',
        aplicaciones: [{ idCargo, cantidad: 10 }],
      },
      bd(),
    );
    estatus = await obtenerOrdenPagada(sesion(), idOrden, bd());
    expect(estatus.pagadaDerivada).toBe(true);
    expect(estatus.pagada).toBe(true);

    // La columna cache de la orden quedó en true.
    const orden = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    expect(orden.pagada).toBe(true);
  });

  it('override manual fuerza el estatus y null vuelve a la derivación', async () => {
    await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8); // no pagado → derivada false
    const forzada = await forzarOrdenPagada(sesion(), idOrden, { pagadaForzada: true }, bd());
    expect(forzada.pagada).toBe(true);
    expect(forzada.pagadaForzada).toBe(true);
    expect(forzada.pagadaDerivada).toBe(false);

    const limpia = await forzarOrdenPagada(sesion(), idOrden, { pagadaForzada: null }, bd());
    expect(limpia.pagadaForzada).toBeNull();
    expect(limpia.pagada).toBe(false); // vuelve a la derivación (no pagado)
  });
});

describe('Conciliación EsMa vs recibos (decisión: CuantasFaltan unificada)', () => {
  it('(f) faltante por cargar = recibido − cargado; y cargos sin recibo', async () => {
    // Recibe costura 10 (cargo propuesto, aún NO validado → cargado 0).
    await enviar(procesoCostura, maquileroCostura, 10);
    await recibir(procesoCostura, maquileroCostura, 10);

    let conc = await conciliarEsMa(sesion(), {}, bd());
    const fila = conc.filas.find((f) => f.idTipoProceso === procesoCostura.id);
    expect(fila?.recibido).toBe(10);
    expect(fila?.cargado).toBe(0);
    expect(fila?.faltantePorCargar).toBe(10);

    // Al validar el cargo, cargado sube a 10 y el faltante se cierra.
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    await validarCargoEsMa(
      sesion(),
      cola.filas[0]?.id as number,
      { cantidadReal: 10, precioReal: 8 },
      bd(),
    );
    conc = await conciliarEsMa(sesion(), {}, bd());
    const fila2 = conc.filas.find((f) => f.idTipoProceso === procesoCostura.id);
    expect(fila2?.cargado).toBe(10);
    expect(fila2?.faltantePorCargar).toBe(0);

    // Un cargo histórico SIN recibo ligado aparece en cargosSinRecibo.
    await crearCargoEsMaMigrado(
      sesion(),
      {
        idEmpresa: empresa.id,
        idMaquilero: maquileroCostura.id,
        idOrden,
        idTipoProceso: procesoCostura.id,
        cantidadReal: 5,
        precioReal: 8,
        estado: 'validado',
      },
      bd(),
    );
    conc = await conciliarEsMa(sesion(), {}, bd());
    expect(conc.totales.numCargosSinRecibo).toBe(1);
    expect(conc.cargosSinRecibo[0]?.cantidad).toBe(5);
  });
});

describe('Facturación por movimiento (decisión h)', () => {
  it('(g) proveedor "ambos" sin elegir con/sin factura → ErrorValidacion', async () => {
    await cliente.proveedor.update({
      where: { id: maquileroCostura.id },
      data: { modalidadFacturacion: 'ambos' },
    });
    await expect(
      crearAbonoMaquilero(
        sesion(),
        { idMaquilero: maquileroCostura.id, monto: 10, fecha: '2026-06-21' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // Con la elección explícita, sí entra.
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquileroCostura.id, monto: 10, fecha: '2026-06-21', conFactura: true },
      bd(),
    );
    expect(abono.conFactura).toBe(true);
  });

  it('el saldo se segmenta por facturación (con/sin)', async () => {
    // Proveedor "ambos": un cargo con factura, un abono sin factura.
    await cliente.proveedor.update({
      where: { id: maquileroCostura.id },
      data: { modalidadFacturacion: 'ambos' },
    });
    // Cargo validado CON factura (10 × 8 = 80).
    await enviar(procesoCostura, maquileroCostura, 10);
    await recibir(procesoCostura, maquileroCostura, 10);
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    await validarCargoEsMa(
      sesion(),
      cola.filas[0]?.id as number,
      { cantidadReal: 10, precioReal: 8, conFactura: true },
      bd(),
    );
    // Abono SIN factura (20).
    await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquileroCostura.id, monto: 20, fecha: '2026-06-21', conFactura: false },
      bd(),
    );

    const conFac = await saldoDeMaquilero(
      sesion(),
      maquileroCostura.id,
      { conFactura: 'con' },
      bd(),
    );
    expect(conFac.totalCargos).toBe(80);
    expect(conFac.totalAbonos).toBe(0);
    expect(conFac.saldo).toBe(80);

    const sinFac = await saldoDeMaquilero(
      sesion(),
      maquileroCostura.id,
      { conFactura: 'sin' },
      bd(),
    );
    expect(sinFac.totalCargos).toBe(0);
    expect(sinFac.totalAbonos).toBe(20);
    expect(sinFac.saldo).toBe(20);
  });
});
