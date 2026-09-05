/**
 * Tests de integración de la EXPERIENCIA DE USUARIO de EsMa (F6-E5). Postgres efímero
 * (testcontainers). Cubre lo que la ficha exige:
 *  (a) estado de cuenta unificado: los 4 conceptos por fecha (orden determinista) + signo contable +
 *      ocultamiento de importes;
 *  (b) saldos de todos: SQL agregado == fórmula de `saldoDeMaquilero`, excluye saldo 0;
 *  (c) pagos semanales y recibos semanales: agregación correcta por periodo;
 *  (d) revisión de una partida: transición capturado→revisado + bitácora + 409 al re-revisar;
 *  (e) desglosado: detalle por orden/modelo/cantidad/precio/importe;
 *  (f) selector de maquileros: filtra activos + tipo (costura/estampado).
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
import { ErrorConflicto } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { registrarCorte, registrarEnvioMaquila } from '../produccion/etapas.js';
import { cancelarReciboMaquila, registrarReciboMaquila } from '../produccion/recibos.js';
import { listarCargosEsMa, validarCargoEsMa } from './cargos.js';
import { crearAbonoMaquilero, crearDescuentoMaquilero, revisarMovimiento } from './movimientos.js';
import { crearPagoMaquilero } from './pagos.js';
import { saldoDeMaquilero } from './saldos.js';
import { saldosDeTodosMaquileros } from './saldos-todos.js';
import { estadoCuentaMaquilero, estadoCuentaDesglosado } from './estado-cuenta.js';
import { pagosSemanales, recibosSemanalesMaquilaEsMa } from './semanales.js';
import { listarMaquilerosEsMa } from './maquileros.js';

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
let almPrimeras: Almacen;
let clienteNegocioId: number;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.cancelar',
  'produccion.wip-ver',
  'inventario-pt.ver',
  'esma.cargo-validar',
  'esma.modificar',
  // Autorizar una partida capturada es `esma.revisar` desde la fila 0.128 (capturar y validar
  // dejaron de ser el mismo permiso). Estas pruebas revisan como paso de arreglo, así que lo llevan.
  'esma.revisar',
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
      // El INVERSO que necesita cancelar un recibo que metió a PT (`transito.ts::tipoInverso`).
      // El fixture sólo sembraba la entrada: alcanzaba mientras nada cancelara aquí, pero el
      // catálogo real (seed) sí lo trae — y la prueba de cancelación de V1-E8k lo destapó. Se
      // ACERCA el fixture al mundo; no se baja la comprobación.
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

async function cargoValidado(
  proceso: TipoProceso,
  maquilero: Proveedor,
  cant: number,
  cantidadReal: number,
  precioReal: number,
): Promise<number> {
  await enviar(proceso, maquilero, cant);
  await recibir(proceso, maquilero, cant);
  const cola = await listarCargosEsMa(
    sesion(),
    { estado: 'propuesto', idMaquilero: maquilero.id },
    bd(),
  );
  const idCargo = cola.filas[0]?.id as number;
  await validarCargoEsMa(sesion(), idCargo, { cantidadReal, precioReal }, bd());
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
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  await sembrarTiposMovimiento();
  idOrden = await crearOrdenConMatriz();
  await cortarBase();
});

describe('Estado de cuenta unificado (F6-E5)', () => {
  it('(a) fusiona los 4 conceptos por fecha, con signo contable y saldo derivado', async () => {
    const idCargo = await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8); // +80
    await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquileroCostura.id, monto: 15, fecha: '2020-01-01' },
      bd(),
    );
    await crearDescuentoMaquilero(
      sesion(),
      { idMaquilero: maquileroCostura.id, monto: 5, fecha: '2030-12-31' },
      bd(),
    );
    await crearPagoMaquilero(
      sesion(),
      {
        idMaquilero: maquileroCostura.id,
        fecha: '2030-12-31',
        aplicaciones: [{ idCargo, cantidad: 6 }],
      },
      bd(),
    );

    const edc = await estadoCuentaMaquilero(sesion(), maquileroCostura.id, {}, bd());
    // 4 conceptos presentes.
    const conceptos = edc.movimientos.map((m) => m.concepto);
    expect(conceptos).toContain('cargo');
    expect(conceptos).toContain('abono');
    expect(conceptos).toContain('descuento');
    expect(conceptos).toContain('pago');
    // Orden ascendente por fecha.
    for (let i = 1; i < edc.movimientos.length; i += 1) {
      const a = edc.movimientos[i - 1];
      const b = edc.movimientos[i];
      if (a && b) {
        expect(a.fecha.localeCompare(b.fecha)).toBeLessThanOrEqual(0);
      }
    }
    // Signo contable: cargo/abono positivos; pago/descuento negativos.
    const cargo = edc.movimientos.find((m) => m.concepto === 'cargo');
    const pago = edc.movimientos.find((m) => m.concepto === 'pago');
    const descuento = edc.movimientos.find((m) => m.concepto === 'descuento');
    expect(cargo?.monto).toBe(80);
    expect(pago?.monto).toBe(-48);
    expect(descuento?.monto).toBe(-5);
    // El saldo coincide con saldoDeMaquilero.
    const saldo = await saldoDeMaquilero(sesion(), maquileroCostura.id, {}, bd());
    expect(edc.saldo.saldo).toBe(saldo.saldo);
  });

  it('oculta los importes sin consultas.ver-importes (montos y saldo null)', async () => {
    await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8);
    const edc = await estadoCuentaMaquilero(
      sesion(['esma.ver-pagos']),
      maquileroCostura.id,
      {},
      bd(),
    );
    expect(edc.saldo.saldo).toBeNull();
    for (const m of edc.movimientos) {
      expect(m.monto).toBeNull();
    }
  });
});

describe('Saldos de todos los maquileros (F6-E5)', () => {
  it('(b) SQL agregado == fórmula, excluye saldo 0', async () => {
    await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8); // saldo 80

    const todos = await saldosDeTodosMaquileros(sesion(), {}, bd());
    const fila = todos.filas.find((f) => f.idMaquilero === maquileroCostura.id);
    const saldoUno = await saldoDeMaquilero(sesion(), maquileroCostura.id, {}, bd());
    expect(fila?.saldo).toBe(saldoUno.saldo);
    // El estampador (rol maquila, sin movimientos → saldo 0 y nada pendiente) NO aparece.
    expect(todos.filas.some((f) => f.idMaquilero === estampador.id)).toBe(false);
    // ⭐ EL CORTADOR SÍ APARECE, y esta aserción está INVERTIDA a propósito (V1, fila 0.111).
    //
    // Decía que no aparecía «porque el rol `corte` no es maquila». Eso dejó de ser cierto en la
    // 0.114: `ROLES_MAQUILA_ESMA` (`esma/maquileros.ts`) incluye hoy `corte` y `empaque` —*«corte es
    // parte de maquilas, no de proveedores»*, Daniel—, y `cortarBase()` del `beforeEach` le crea un
    // CARGO DE SERVICIO `propuesto`. Hasta la 0.111 ese cargo no lo contaba nadie, así que el
    // cortador seguía invisible por un segundo motivo (saldo 0 y pendiente 0) que tapaba al primero.
    // Ahora se ve, que es exactamente lo que Daniel pidió: quien tenga algo esperando su decisión
    // sale en el tablero.
    const filaCortador = todos.filas.find((f) => f.idMaquilero === cortador.id);
    expect(filaCortador).toBeDefined();
    expect(filaCortador?.saldo).toBe(0);
    // Un cargo por validar, y sin precio: `registrarCorte` no capturó `precioPactado`, y la orden
    // no tiene precio de corte que prestarle (REGLA 0-B: no se inventa uno).
    expect(filaCortador?.pendienteRevision.cargosPartidas).toBe(1);
    expect(filaCortador?.pendienteRevision.partidas).toBe(1);
    expect(filaCortador?.pendienteRevision.cargos).toBe(0);
    expect(filaCortador?.pendienteRevision.cargosSinPrecio).toBe(1);
  });
});

describe('Consultas semanales (F6-E5)', () => {
  it('(c) pagos semanales suman el periodo', async () => {
    const idCargo = await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8);
    await crearPagoMaquilero(
      sesion(),
      {
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-22',
        aplicaciones: [{ idCargo, cantidad: 5 }],
      },
      bd(),
    );
    const semana = await pagosSemanales(
      sesion(),
      { desde: '2026-06-22', hasta: '2026-06-22' },
      bd(),
    );
    expect(semana.filas).toHaveLength(1);
    expect(semana.total).toBe(40); // 5 × 8
    // Fuera de la semana: vacío.
    const otra = await pagosSemanales(sesion(), { desde: '2026-07-01', hasta: '2026-07-07' }, bd());
    expect(otra.filas).toHaveLength(0);
  });

  it('recibos semanales valúan al precio pactado', async () => {
    await enviar(procesoCostura, maquileroCostura, 10);
    await recibir(procesoCostura, maquileroCostura, 10);
    const rec = await recibosSemanalesMaquilaEsMa(
      sesion(),
      { desde: '2026-06-20', hasta: '2026-06-20' },
      bd(),
    );
    expect(rec.filas.length).toBeGreaterThanOrEqual(1);
    expect(rec.totalCantidad).toBe(10);
    expect(rec.totalImporte).toBe(80); // 10 × 8
  });
});

describe('Revisión de una partida (F6-E5)', () => {
  it('(d) capturado → revisado + bitácora; re-revisar → 409', async () => {
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquileroCostura.id, monto: 30, fecha: '2026-06-21' },
      bd(),
    );
    expect(abono.estadoRevision).toBe('capturado');

    const resultado = await revisarMovimiento(sesion(), 'abono', abono.id, bd());
    expect(resultado.estadoRevision).toBe('revisado');

    const enBd = await cliente.abonoMaquilero.findUniqueOrThrow({ where: { id: abono.id } });
    expect(enBd.estadoRevision).toBe('revisado');

    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'AbonoMaquilero', idEntidad: String(abono.id), accion: 'MODIFICAR' },
    });
    expect(bitacora).not.toBeNull();

    await expect(revisarMovimiento(sesion(), 'abono', abono.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });
});

describe('Desglosado (F6-E5)', () => {
  it('(e) detalla los cargos por orden/modelo/cantidad/precio/importe', async () => {
    await cargoValidado(procesoCostura, maquileroCostura, 10, 10, 8);
    const desg = await estadoCuentaDesglosado(sesion(), maquileroCostura.id, {}, bd());
    expect(desg.cargos).toHaveLength(1);
    const c = desg.cargos[0];
    expect(c?.codigoModelo).toBe('A-100');
    expect(c?.cantidad).toBe(10);
    expect(c?.precio).toBe(8);
    expect(c?.importe).toBe(80);
  });
});

describe('Selector de maquileros (F6-E5)', () => {
  it('(f) filtra activos + tipo (costura/estampado)', async () => {
    const costura = await listarMaquilerosEsMa(sesion(), { tipo: 'costura' }, bd());
    expect(costura.filas.some((m) => m.id === maquileroCostura.id)).toBe(true);
    expect(costura.filas.some((m) => m.id === estampador.id)).toBe(false);
    // El cortador tampoco: NO porque «corte no sea maquila» —desde la 0.114 sí lo es, está en
    // `ROLES_MAQUILA_ESMA`— sino porque el filtro pide `tipo: 'costura'`, que resuelve al único rol
    // `maquila-costura`. Sin filtro sí saldría.
    expect(costura.filas.some((m) => m.id === cortador.id)).toBe(false);

    const estamp = await listarMaquilerosEsMa(sesion(), { tipo: 'estampado' }, bd());
    expect(estamp.filas.some((m) => m.id === estampador.id)).toBe(true);
    expect(estamp.filas.some((m) => m.id === maquileroCostura.id)).toBe(false);

    // Sin tipo: ambos maquileros.
    const todos = await listarMaquilerosEsMa(sesion(), {}, bd());
    expect(todos.filas.some((m) => m.id === maquileroCostura.id)).toBe(true);
    expect(todos.filas.some((m) => m.id === estampador.id)).toBe(true);

    // Un maquilero desactivado no aparece.
    await cliente.proveedor.update({
      where: { id: maquileroCostura.id },
      data: { activo: false },
    });
    const trasApagar = await listarMaquilerosEsMa(sesion(), { tipo: 'costura' }, bd());
    expect(trasApagar.filas.some((m) => m.id === maquileroCostura.id)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// V1-E8k · DÓNDE SE VEN LAS PRENDAS INCOMPLETAS (§Post-F9.136, regla 4)
//
// *"Sólo quisiera ver reflejado en algún lado que sí las entrego, para revisar los temas de pago."*
// El sitio elegido es el estado de cuenta del maquilero, FUERA del cargo y SIN afectar el saldo.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('V1-E8k · prendas incompletas en el estado de cuenta (§Post-F9.136)', () => {
  /** Recibe `buenas` piezas + `incompletas` prendas sin terminar, del proceso de costura. */
  async function recibirConIncompletas(buenas: number, inc: number): Promise<void> {
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        ...(buenas > 0 ? { idAlmacenPrimeras: almPrimeras.id } : {}),
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [{ idTalla: tallaCH.id, cantidad: buenas, cantidadIncompletas: inc }],
          },
        ],
      },
      bd(),
    );
  }

  it('⭐ salen en las DOS vistas del estado de cuenta, con su orden y modelo, y NO tocan el saldo', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await recibirConIncompletas(8, 2);

    const antes = await saldoDeMaquilero(sesion(), maquileroCostura.id, {}, bd());

    const unificado = await estadoCuentaMaquilero(sesion(), maquileroCostura.id, {}, bd());
    expect(unificado.incompletas.totalPiezas).toBe(2);
    expect(unificado.incompletas.filas).toHaveLength(1);
    expect(unificado.incompletas.filas[0]?.folioOrden).toBe(1);
    expect(unificado.incompletas.filas[0]?.codigoModelo).toBe('A-100');
    expect(unificado.incompletas.filas[0]?.tipoProceso).toBe('Costura');
    expect(unificado.incompletas.filas[0]?.piezas).toBe(2);
    // El saldo NO se movió por las incompletas (el cargo del recibo sigue `propuesto`, sin importe).
    expect(unificado.saldo.saldo).toBe(antes.saldo);
    // Y NO se colaron entre los movimientos: no son dinero, no llevan signo contable.
    expect(unificado.movimientos.every((m) => m.concepto !== 'cargo' || m.monto === null)).toBe(
      true,
    );

    // El desglosado —fuente del PDF y del Excel— dice EXACTAMENTE lo mismo (misma función).
    const desglosado = await estadoCuentaDesglosado(sesion(), maquileroCostura.id, {}, bd());
    expect(desglosado.incompletas).toEqual(unificado.incompletas);
  });

  it('un recibo SOLO de incompletas aparece aunque no haya cargo que mostrar', async () => {
    // El agujero que un bloque colgado del CARGO habría dejado: sin cargo no habría fila, y es
    // justo la entrega que Daniel describió («me traen las 5 que no pudieron coser»).
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await recibirConIncompletas(0, 5);

    const cola = await listarCargosEsMa(
      sesion(),
      { estado: 'propuesto', idMaquilero: maquileroCostura.id },
      bd(),
    );
    expect(cola.filas).toHaveLength(0);

    const edc = await estadoCuentaMaquilero(sesion(), maquileroCostura.id, {}, bd());
    expect(edc.incompletas.totalPiezas).toBe(5);
    expect(edc.incompletas.filas).toHaveLength(1);
  });

  it('cancelar el recibo las SACA del estado de cuenta (la «conversación» con el maquilero)', async () => {
    // `incompletasDeMaquilero` filtra `canceladoEn: null`, y hasta aquí NADA lo medía: la prueba
    // que suena a cubrirlo (`recibos.int.test.ts`, «cancelar el recibo…») sólo mira el pendiente
    // del WIP. El estado de cuenta ES la conversación con el maquilero —y es lo que el HISTORIAL le
    // promete a Daniel: *"si fue un error de captura, cancela el recibo… al cancelarlo las
    // incompletas dejan de contar"*—, así que se asevera aquí.
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await recibirConIncompletas(8, 2);

    const antes = await estadoCuentaMaquilero(sesion(), maquileroCostura.id, {}, bd());
    expect(antes.incompletas.totalPiezas).toBe(2);

    const recibo = await cliente.etapaMovimiento.findFirstOrThrow({
      where: { tipo: 'recibo_maquila', idTercero: maquileroCostura.id, canceladoEn: null },
      select: { id: true },
      orderBy: { id: 'desc' },
    });
    await cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'error de captura' }, bd());

    const despues = await estadoCuentaMaquilero(sesion(), maquileroCostura.id, {}, bd());
    expect(despues.incompletas.totalPiezas).toBe(0);
    expect(despues.incompletas.filas).toEqual([]);
    // Y el desglosado —fuente del PDF y del Excel— tampoco las sigue enseñando.
    const desglosado = await estadoCuentaDesglosado(sesion(), maquileroCostura.id, {}, bd());
    expect(desglosado.incompletas.totalPiezas).toBe(0);
  });

  it('el periodo filtra por la FECHA del recibo, y un maquilero sin incompletas trae el bloque vacío', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await recibirConIncompletas(8, 2);

    // Dentro del periodo.
    const dentro = await estadoCuentaMaquilero(
      sesion(),
      maquileroCostura.id,
      { desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );
    expect(dentro.incompletas.totalPiezas).toBe(2);

    // Fuera del periodo.
    const fuera = await estadoCuentaMaquilero(
      sesion(),
      maquileroCostura.id,
      { desde: '2026-07-01', hasta: '2026-07-31' },
      bd(),
    );
    expect(fuera.incompletas.totalPiezas).toBe(0);
    expect(fuera.incompletas.filas).toEqual([]);

    // Otro maquilero: bloque vacío, nunca `undefined` (el contrato lo exige siempre presente).
    const otro = await estadoCuentaMaquilero(sesion(), estampador.id, {}, bd());
    expect(otro.incompletas).toEqual({ filas: [], totalPiezas: 0 });
  });
});
