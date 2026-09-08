/**
 * Tests de integración de LOS DÍAS VENCIDOS (fila 0.121, §Post-F9.218(a)) contra Postgres real.
 *
 * Lo que aquí se mide —y no se puede medir con una prueba pura— es que el **agregado SQL** lea las
 * tres fuentes de cargo y las dos de crédito, y que el vencimiento de un cargo de EsMa se **derive**
 * del plazo del proveedor. Es justo el hueco que la fila cierra: los cargos de maquila no viven en
 * el motor, sus tablas **no tienen columna de vencimiento**, y la convivencia los proyectaba con
 * `fechaVencimiento: null` ⇒ Daniel envejece a sus maquileros con plazo y el sistema no.
 *
 * Cubre:
 *  (a) un CARGO DE MAQUILA de un proveedor con plazo trae días vencidos (antes: null, sin edad);
 *  (b) el plazo del proveedor MUEVE la respuesta (8 días de crédito ⇒ 8 días menos de atraso);
 *  (c) los créditos se comen lo más viejo primero (misma convención que las cubetas), y se mide
 *      CADA UNA de las fuentes: pago de EsMa, descuento de EsMa y crédito del MOTOR — las tres, más
 *      las tres de cargo (motor · cargo EsMa · abono EsMa), son las CINCO ramas del agregado;
 *  (d) el proveedor pagado por completo no tiene días (null, no 0);
 *  (e) el estado de cuenta ya enseña la FECHA DE VENCIMIENTO derivada en el renglón de EsMa, y el
 *      abono de EsMa —que allí SUMA— también la trae, mientras que pago y descuento siguen sin ella;
 *  (f) el segmento (con/sin factura) parte los días igual que parte la cartera;
 *  (g) A9: los movimientos de otra empresa no se cuelan.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Cliente, Empresa, PrismaClient, Proveedor } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { crearCorrida, obtenerCorridaDetalle } from '../pagos/corrida.js';
import { registrarMovimientoTercero, estadoDeCuentaTercero } from './cuenta-terceros.js';
import { diasVencidosPorProveedor } from './dias-vencidos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;
/** Maquilero CON plazo pactado (8 días) — el caso de la fila: Daniel SÍ lo envejece. */
let maquilero: Proveedor;

const PERM: ClavePermiso[] = [
  'terceros.ver',
  'terceros.administrar',
  'consultas.ver-importes',
  'esma.ver-pagos',
  'pagos.corrida-armar',
  'pagos.corrida-ver',
];
const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
const bd = () => ({ cliente });

/** Hace `dias` días, a medianoche UTC (la misma referencia que usa `CURRENT_DATE`). */
function haceDias(dias: number): Date {
  const hoy = new Date();
  const utc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return new Date(utc - dias * 86_400_000);
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa Dias');
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa Dias');
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente Uno' } });
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'Maquila costura' },
  });
  maquilero = await cliente.proveedor.create({
    data: {
      nombre: 'BORDA PRINT',
      modalidadFacturacion: 'ambos',
      diasCredito: 8,
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
});

/** Crea la orden mínima de la que puede colgar un cargo de EsMa. */
async function crearOrden(folio: bigint, idEmpresa: number): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio, idEmpresa, idCliente: clienteNegocio.id },
  });
  const modelo = await cliente.modelo.create({
    data: { codigo: `MOD-${String(folio)}`, descripcion: 'Modelo' },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 10, precio: 100 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      estado: 'completa',
      fechaCompletada: new Date(),
    },
  });
  return orden.id;
}

/** Un cargo de maquila VALIDADO, fechado `hace` días (su fecha es `creadoEn`: no tiene otra). */
async function cargoMaquila(opciones: {
  hace: number;
  importe: number;
  conFactura?: boolean | null;
  idEmpresa?: number;
  idMaquilero?: number;
  folio: bigint;
}): Promise<void> {
  const idEmpresa = opciones.idEmpresa ?? empresa.id;
  const tipoProceso = await cliente.tipoProceso.create({
    data: {
      codigo: `costura-${String(opciones.folio)}`,
      nombre: 'Costura',
      generaEntradaPt: true,
    },
  });
  await cliente.esMaCargo.create({
    data: {
      idEmpresa,
      idMaquilero: opciones.idMaquilero ?? maquilero.id,
      idOrden: await crearOrden(opciones.folio, idEmpresa),
      idTipoProceso: tipoProceso.id,
      estado: 'validado',
      cantidadReal: 1,
      precioReal: opciones.importe,
      conFactura: opciones.conFactura ?? false,
      creadoEn: haceDias(opciones.hace),
    },
  });
}

// ── (a)+(b) el hueco de la fila: la maquila SÍ envejece, y el plazo manda ────────────────────────
describe('⭐ un cargo de MAQUILA envejece (antes se iba a una cubeta sin edad)', () => {
  it('cargo de hace 20 días con 8 de plazo ⇒ 12 días vencido', async () => {
    await cargoMaquila({ hace: 20, importe: 1000, folio: 1n });

    const dias = await diasVencidosPorProveedor(cliente, empresa.id);

    expect(dias.get(maquilero.id)).toBe(12);
  });

  it('🔒 EL PLAZO ES DEL PROVEEDOR: cambiarlo cambia la edad, sin tocar el cargo', async () => {
    await cargoMaquila({ hace: 20, importe: 1000, folio: 1n });
    await cliente.proveedor.update({ where: { id: maquilero.id }, data: { diasCredito: 30 } });

    // 20 días de antigüedad contra 30 de plazo: debe, pero está dentro de su plazo ⇒ 0, no null.
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(0);

    // Sin plazo capturado = contado: vence el mismo día que se recibe.
    await cliente.proveedor.update({ where: { id: maquilero.id }, data: { diasCredito: null } });
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(20);
  });

  it('un cargo del MOTOR usa su fecha de vencimiento ya sellada', async () => {
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: maquilero.id,
        fecha: haceDias(50).toISOString().slice(0, 10),
        origen: 'factura_proveedor',
        importe: 500,
        // El proveedor es `ambos`: el motor exige decir de qué lado va (no lo elige en silencio).
        esFiscal: false,
      },
      bd(),
    );
    // 50 días de antigüedad − 8 de plazo = 42.
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(42);
  });

  it('motor y maquila se miran JUNTOS: manda el más viejo de los dos', async () => {
    await cargoMaquila({ hace: 20, importe: 1000, folio: 1n });
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: maquilero.id,
        fecha: haceDias(50).toISOString().slice(0, 10),
        origen: 'factura_proveedor',
        importe: 500,
        // El proveedor es `ambos`: el motor exige decir de qué lado va (no lo elige en silencio).
        esFiscal: false,
      },
      bd(),
    );
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(42);
  });
});

// ── (c)+(d) los pagos se comen lo más viejo primero ──────────────────────────────────────────────
describe('los pagos se aplican de más viejo a más nuevo (convención de las cubetas)', () => {
  it('el pago que cubre el cargo viejo deja a la vista la edad del siguiente', async () => {
    await cargoMaquila({ hace: 50, importe: 1000, folio: 1n });
    await cargoMaquila({ hace: 20, importe: 1000, folio: 2n });
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(42);

    await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'revisado',
        monto: 1000,
        fecha: haceDias(1),
        conFactura: false,
      },
    });
    // Se fue el de 50 días (42 de atraso); queda el de 20 (12 de atraso).
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(12);
  });

  it('⭐ y el CRÉDITO DEL MOTOR salda igual — la quinta fuente del agregado', async () => {
    // Gemela de las dos de arriba, con la ÚLTIMA fuente que quedaba sin medir: el movimiento
    // negativo del motor (`origen: 'pago'`), no un pago de EsMa. Existe porque neutralizar esa rama
    // con `AND FALSE` dejaba las 17 pruebas en verde. ⚠️ La consecuencia es la misma que la del
    // descuento: **un proveedor de CxP ya pagado arrastraría días vencidos para siempre** en la
    // pantalla con la que Daniel decide a quién le paga.
    //
    // Y de paso fija algo que ninguna otra prueba dice: el crédito del motor **netea contra cargos
    // de EsMa**. Las dos fuentes se miran juntas — es la misma cuenta del mismo proveedor (D15a).
    await cargoMaquila({ hace: 50, importe: 1000, folio: 1n });
    await cargoMaquila({ hace: 20, importe: 1000, folio: 2n });
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(42);

    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: maquilero.id,
        fecha: haceDias(1).toISOString().slice(0, 10),
        origen: 'pago',
        importe: 1000,
        // El proveedor es `ambos`: el motor exige decir de qué lado va (no lo elige en silencio).
        esFiscal: false,
      },
      bd(),
    );
    // Se fue el de 50 días (42 de atraso); queda el de 20 (12 de atraso).
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(12);
  });

  it('⭐ el DESCUENTO también salda, y también de lo más viejo primero', async () => {
    // Gemela de la de arriba, con `descuentoMaquilero` en vez de `pagoMaquilero`. Existe porque una
    // MUTACIÓN sobrevivió: borrando entera la rama `descuento_maquilero` del agregado de créditos
    // no se ponía roja ni una prueba. ⚠️ Lo que estaría en juego no es cosmético — un maquilero al
    // que se le saldó la deuda con un descuento arrastraría **días vencidos para siempre** en la
    // pantalla con la que Daniel decide a quién le paga.
    await cargoMaquila({ hace: 50, importe: 1000, folio: 1n });
    await cargoMaquila({ hace: 20, importe: 1000, folio: 2n });
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(42);

    await cliente.descuentoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'revisado',
        monto: 1000,
        fecha: haceDias(1),
        conFactura: false,
      },
    });
    // Se fue el de 50 días (42 de atraso); queda el de 20 (12 de atraso).
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(12);
  });

  it('⭐ y un descuento que cubre TODO deja al maquilero sin días, no con los de siempre', async () => {
    await cargoMaquila({ hace: 50, importe: 1000, folio: 1n });
    await cliente.descuentoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'revisado',
        monto: 1000,
        fecha: haceDias(1),
        conFactura: false,
      },
    });
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).has(maquilero.id)).toBe(false);
  });

  it('pagado todo ⇒ NO aparece (no hay nada que envejecer), que no es lo mismo que 0', async () => {
    await cargoMaquila({ hace: 50, importe: 1000, folio: 1n });
    await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'revisado',
        monto: 1000,
        fecha: haceDias(1),
        conFactura: false,
      },
    });
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).has(maquilero.id)).toBe(false);
  });

  it('un pago SIN revisar todavía no cuenta: la deuda sigue vieja', async () => {
    await cargoMaquila({ hace: 50, importe: 1000, folio: 1n });
    await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'capturado',
        monto: 1000,
        fecha: haceDias(1),
        conFactura: false,
      },
    });
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(42);
  });

  it('⚠️ el ABONO de EsMa SUMA (es un cargo extra): envejece, no netea', async () => {
    await cliente.abonoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'revisado',
        monto: 300,
        fecha: haceDias(40),
        conFactura: false,
      },
    });
    // Si se hubiera tratado como crédito, este proveedor no saldría en el mapa.
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(32);
  });
});

// ── (e) la fecha de vencimiento derivada, ya visible en el estado de cuenta ──────────────────────
describe('⭐ el estado de cuenta ya enseña el vencimiento de los renglones de EsMa', () => {
  it('el cargo y el abono lo traen; el pago y el descuento no (son créditos)', async () => {
    await cargoMaquila({ hace: 20, importe: 1000, folio: 1n });
    await cliente.abonoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'revisado',
        monto: 300,
        fecha: haceDias(10),
        conFactura: false,
      },
    });
    await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'revisado',
        monto: 100,
        fecha: haceDias(5),
        conFactura: false,
      },
    });
    await cliente.descuentoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        estadoRevision: 'revisado',
        monto: 50,
        fecha: haceDias(5),
        conFactura: false,
      },
    });

    const estado = await estadoDeCuentaTercero(sesion(), 'proveedor', maquilero.id, {}, bd());
    const porOrigen = new Map(
      estado.movimientos
        .filter((m) => m.fuente === 'esma')
        .map((m) => [m.origen, m.fechaVencimiento]),
    );

    // El cargo se fechó hace 20 días y el proveedor tiene 8 de plazo.
    expect(porOrigen.get('recibo_maquila')).toBe(haceDias(12).toISOString().slice(0, 10));
    // El abono de EsMa SUMA ⇒ vence (hace 10 días + 8 de plazo = hace 2).
    expect(porOrigen.get('abono')).toBe(haceDias(2).toISOString().slice(0, 10));
    // Los créditos no vencen.
    expect(porOrigen.get('pago')).toBeNull();
    expect(porOrigen.get('descuento')).toBeNull();
  });
});

// ── (f) segmento y (g) A9 ────────────────────────────────────────────────────────────────────────
describe('segmento y empresa', () => {
  it('el segmento parte los días de MAQUILA igual que parte la cartera', async () => {
    await cargoMaquila({ hace: 50, importe: 1000, conFactura: true, folio: 1n });
    await cargoMaquila({ hace: 20, importe: 1000, conFactura: false, folio: 2n });

    expect((await diasVencidosPorProveedor(cliente, empresa.id, 'con')).get(maquilero.id)).toBe(42);
    expect((await diasVencidosPorProveedor(cliente, empresa.id, 'sin')).get(maquilero.id)).toBe(12);
    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(42);
  });

  it('⭐ y el segmento del MOTOR también: la factura vieja no se cuela en la relación sin factura', async () => {
    // Esta prueba existe por una MUTACIÓN que se escapó: quitar el filtro `es_fiscal` del motor
    // dejaba la anterior en verde, porque toda su deuda era de maquila (que filtra por su propia
    // columna). Las dos fuentes tienen que segmentarse, y cada una se mide.
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: maquilero.id,
        fecha: haceDias(100).toISOString().slice(0, 10),
        origen: 'factura_proveedor',
        importe: 700,
        esFiscal: true,
      },
      bd(),
    );
    await cargoMaquila({ hace: 20, importe: 1000, conFactura: false, folio: 2n });

    // Con factura: sólo la factura de hace 100 días (−8 de plazo = 92).
    expect((await diasVencidosPorProveedor(cliente, empresa.id, 'con')).get(maquilero.id)).toBe(92);
    // Sin factura: sólo el cargo de maquila de hace 20 (−8 = 12). Si la factura se colara, diría 92.
    expect((await diasVencidosPorProveedor(cliente, empresa.id, 'sin')).get(maquilero.id)).toBe(12);
  });

  it('A9: un cargo de OTRA empresa no cuenta', async () => {
    await cargoMaquila({ hace: 90, importe: 1000, idEmpresa: otraEmpresa.id, folio: 9n });
    await cargoMaquila({ hace: 20, importe: 1000, folio: 1n });

    expect((await diasVencidosPorProveedor(cliente, empresa.id)).get(maquilero.id)).toBe(12);
  });
});

// ── LA PANTALLA DE LOS JUEVES, de punta a punta ─────────────────────────────────────────────────
describe('⭐ la corrida semanal (la pantalla donde Daniel decide) trae los días vencidos', () => {
  it('el renglón del MAQUILERO los enseña — antes esa columna no existía para él', async () => {
    await cargoMaquila({ hace: 20, importe: 1000, folio: 1n });

    const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: false }, bd());
    const completo = await obtenerCorridaDetalle(sesion(), detalle.corrida.id, bd());
    const fila = completo.secciones
      .flatMap((s) => s.filas)
      .find((f) => f.idProveedor === maquilero.id);

    expect(fila?.origen).toBe('maquila');
    expect(fila?.diasVencidos).toBe(12);
    // 🔴 Y la columna vieja sigue en null para la maquila: `vencido` son las CUBETAS del motor, que
    // no reparten EsMa. Si algún día se llenara, sería otra decisión — no un efecto lateral.
    expect(fila?.vencido).toBeNull();
  });

  it('⭐ y el renglón del PROVEEDOR CxP también — la columna vale igual para las dos secciones', async () => {
    // Existe porque una MUTACIÓN sobrevivió: dejar `diasVencidos` en null para todo lo que NO fuera
    // maquila —o sea, la sección de proveedores SIEMPRE en «—»— no ponía roja ni una prueba. La de
    // arriba assertea `origen === 'maquila'`, así que medía sólo la mitad del cableado, justo en la
    // columna que este mismo archivo declara «la única de referencia que vale igual para un
    // maquilero y para un proveedor».
    const proveedorSimple = await cliente.proveedor.create({
      data: { nombre: 'AVIOS DEL CENTRO', modalidadFacturacion: 'solo_sin', diasCredito: 15 },
    });
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: proveedorSimple.id,
        fecha: haceDias(45).toISOString().slice(0, 10),
        origen: 'entrada_sin_factura',
        importe: 2_500,
      },
      bd(),
    );

    const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: false }, bd());
    const completo = await obtenerCorridaDetalle(sesion(), detalle.corrida.id, bd());
    const fila = completo.secciones
      .flatMap((s) => s.filas)
      .find((f) => f.idProveedor === proveedorSimple.id);

    // No tiene rol de maquila: cae en la sección de proveedores…
    expect(fila?.origen).toBe('proveedor');
    expect(fila?.rubro).toBe('proveedores');
    // …y trae SU edad: 45 días de antigüedad − 15 de plazo = 30.
    expect(fila?.diasVencidos).toBe(30);
    // Y aquí `vencido` SÍ viaja (son las cubetas del motor): las dos columnas conviven.
    expect(fila?.vencido).toBe(2_500);
  });

  it('un beneficiario sin deuda envejecible sale con `null`, no con 0', async () => {
    const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: false }, bd());
    const completo = await obtenerCorridaDetalle(sesion(), detalle.corrida.id, bd());
    for (const fila of completo.secciones.flatMap((s) => s.filas)) {
      expect(fila.diasVencidos).toBeNull();
    }
  });
});
