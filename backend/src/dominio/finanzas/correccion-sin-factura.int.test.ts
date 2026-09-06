/**
 * Tests de integración de la CORRECCIÓN de un movimiento SIN FACTURA (fila 0.145; §Post-F9.203).
 * Postgres efímero. Cubre lo que la fila promete y lo que se negó a prometer:
 *
 *  (a) la FORMA: un gesto, dos hechos — el viejo queda cancelado (con su inverso en el motor) y
 *      nace el bueno LIGADO a él; el saldo queda como si sólo existiera el bueno (D3);
 *  (b) la BANDERA de la persona: sin ella no se corrige NADA, ni con todos los permisos del
 *      sistema; y con ella, sigue haciendo falta el permiso del módulo (falla cerrado);
 *  (c) «SIN FACTURA» es del MOVIMIENTO, no del proveedor: en un proveedor `ambos`, el renglón con
 *      factura queda intocable y el de al lado —del MISMO proveedor— sí se corrige;
 *  (d) NO se cambia de proveedor ni de tipo de movimiento (el cuerpo es `strict`), y una corrección
 *      que no cambia nada se rechaza;
 *  (e) ⭐⭐ EL CASO DIFÍCIL: corregir un PAGO ya APLICADO a cargos deshace su aplicación y la vuelve
 *      a hacer — las «prendas por pagar» del cargo NO se duplican ni se pierden, y el estatus
 *      `Orden.pagada` sobrevive. Y su importe NO se corrige (límite declarado);
 *  (f) A2: todo en UNA transacción — se FUERZA el escenario real (el pago ya se canceló y las
 *      prendas ya se liberaron, y entonces la recaptura truena) y se comprueba que no queda nada a
 *      medias;
 *  (g) A7: la bitácora guarda QUÉ DECÍA ANTES;
 *  (h) A9: un movimiento de otra empresa no se corrige.
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
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { registrarCorte, registrarEnvioMaquila } from '../produccion/etapas.js';
import { registrarReciboMaquila } from '../produccion/recibos.js';
import { listarCargosEsMa, validarCargoEsMa } from '../esma/cargos.js';
import { corregirMovimientoEsMa } from '../esma/correccion.js';
import { estadoCuentaMaquilero } from '../esma/estado-cuenta.js';
import { crearAbonoMaquilero, revisarMovimiento } from '../esma/movimientos.js';
import {
  armarDatosImpresoReciboPago,
  textoSelloAnulado,
} from '../esma/impresos/impreso-recibo-pago.js';
import { crearPagoMaquilero, obtenerPagoMaquilero } from '../esma/pagos.js';
import { pagosSemanales } from '../esma/semanales.js';
import { obtenerOrdenPagada } from '../esma/orden-pagada.js';
import { saldoDeMaquilero } from '../esma/saldos.js';
import {
  corregirMovimientoTercero,
  estadoDeCuentaTercero,
  calcularSaldoTercero,
  registrarMovimientoTercero,
} from '../terceros/cuenta-terceros.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let proveedor: Proveedor;
let proveedorAmbos: Proveedor;

// Escenario EsMa (sólo lo montan las pruebas que lo necesitan).
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor;
let maquilero: Proveedor;
let procesoCostura: TipoProceso;
let almPrimeras: Almacen;
let clienteNegocioId: number;
let idOrden: number;

/** Todos los permisos que este archivo necesita. La BANDERA va aparte, a propósito. */
const PERM_TODOS: ClavePermiso[] = [
  'terceros.ver',
  'terceros.administrar',
  'consultas.ver-importes',
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.wip-ver',
  'inventario-pt.ver',
  'esma.cargo-validar',
  'esma.modificar',
  'esma.revisar',
  'esma.ver-pagos',
];

/**
 * Sesión de prueba. `corrector` es la BANDERA `Usuario.puedeCorregirSinFactura` — que NO es un
 * permiso y por eso no puede entrar en la lista de arriba: ése es justamente el punto de la fila.
 */
const sesion = (
  opciones: { permisos?: ClavePermiso[]; corrector?: boolean; idEmpresaActiva?: number } = {},
) =>
  sesionDePrueba({
    idEmpresaActiva: opciones.idEmpresaActiva ?? empresa.id,
    permisos: opciones.permisos ?? PERM_TODOS,
    puedeCorregirSinFactura: opciones.corrector ?? true,
  });

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa Corrección');
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
  proveedor = await cliente.proveedor.create({
    data: { nombre: 'Avíos del Norte', modalidadFacturacion: 'solo_sin', diasCredito: 30 },
  });
  proveedorAmbos = await cliente.proveedor.create({
    data: { nombre: 'Telas Mixtas', modalidadFacturacion: 'ambos', diasCredito: 0 },
  });
});

/** Registra un movimiento de CxP del motor y devuelve su id. */
async function movimientoCxp(
  datos: {
    idProveedor?: number;
    importe: number;
    fecha?: string;
    esFiscal?: boolean;
    observaciones?: string;
    refTipo?: string;
    refId?: number;
  },
  quien = sesion(),
): Promise<number> {
  const mov = await registrarMovimientoTercero(
    quien,
    {
      tipoTercero: 'proveedor',
      idTercero: datos.idProveedor ?? proveedor.id,
      fecha: datos.fecha ?? '2026-09-01',
      origen: 'pago',
      importe: datos.importe,
      esFiscal: datos.esFiscal ?? false,
      ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      ...(datos.refTipo === undefined ? {} : { refTipo: datos.refTipo }),
      ...(datos.refId === undefined ? {} : { refId: datos.refId }),
    },
    bd(),
  );
  return mov.id;
}

// ── (a) LA FORMA: un gesto, dos hechos ───────────────────────────────────────────────────────────

describe('(a) la forma: se anula el viejo y nace el bueno, ligados', () => {
  it('corrige el importe: el saldo queda como si sólo existiera el bueno', async () => {
    // Un pago de 1000 que en realidad era de 250.
    const id = await movimientoCxp({ importe: 1000 });
    const antes = await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd());
    expect(antes.saldo).toBe(-1000); // un pago BAJA lo que se le debe al proveedor

    const nuevo = await corregirMovimientoTercero(
      sesion(),
      id,
      { importe: 250, motivo: 'se tecleó de más' },
      bd(),
    );

    const despues = await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd());
    expect(despues.saldo).toBe(-250);
    expect(nuevo.idMovimientoCorregido).toBe(id);
    expect(nuevo.monto).toBe(-250);

    // D3: el viejo SIGUE AHÍ, cancelado, con su inverso. Nada se editó ni se borró.
    const viejo = await cliente.movimientoTercero.findUniqueOrThrow({ where: { id } });
    expect(viejo.cancelado).toBe(true);
    expect(viejo.monto.toNumber()).toBe(-1000);
    const inverso = await cliente.movimientoTercero.findFirst({
      where: { idMovimientoInverso: id },
    });
    expect(inverso?.monto.toNumber()).toBe(1000);
    expect(inverso?.observaciones).toBe('se tecleó de más');

    // Tres renglones en el libro (viejo + inverso + bueno), tres folios distintos (A3).
    const todos = await cliente.movimientoTercero.findMany({
      where: { idProveedor: proveedor.id },
    });
    expect(todos).toHaveLength(3);
    expect(new Set(todos.map((m) => m.folio.toString())).size).toBe(3);
  });

  it('corrige fecha y observaciones sin tocar el importe', async () => {
    const id = await movimientoCxp({ importe: 500, fecha: '2026-09-01', observaciones: 'sem 35' });
    const nuevo = await corregirMovimientoTercero(
      sesion(),
      id,
      { fecha: '2026-09-08', observaciones: 'sem 36', motivo: 'era de la otra semana' },
      bd(),
    );
    expect(nuevo.monto).toBe(-500);
    expect(nuevo.fecha).toBe('2026-09-08');
    expect(nuevo.observaciones).toBe('sem 36');
  });

  it('el corregido CONSERVA la referencia a la operación que lo originó (refTipo/refId)', async () => {
    // La liga de la corrección vive en su propia columna justamente para no pisar ésta: el nuevo
    // pago sigue siendo el pago de esa corrida, no un renglón huérfano.
    const id = await movimientoCxp({ importe: 300, refTipo: 'corrida-pago', refId: 77 });
    const nuevo = await corregirMovimientoTercero(
      sesion(),
      id,
      { importe: 310, motivo: 'ajuste' },
      bd(),
    );
    expect(nuevo.refTipo).toBe('corrida-pago');
    expect(nuevo.refId).toBe(77);
    expect(nuevo.idMovimientoCorregido).toBe(id);
  });

  it('una corrección se puede volver a corregir (se encadenan), pero el corregido ya no', async () => {
    const id1 = await movimientoCxp({ importe: 100 });
    const m2 = await corregirMovimientoTercero(sesion(), id1, { importe: 200, motivo: 'a' }, bd());
    const m3 = await corregirMovimientoTercero(
      sesion(),
      m2.id,
      { importe: 300, motivo: 'b' },
      bd(),
    );
    expect(m3.idMovimientoCorregido).toBe(m2.id);
    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', proveedor.id, bd());
    expect(saldo.saldo).toBe(-300);

    // El primero ya está cancelado: corregirlo otra vez es un conflicto, no un segundo sustituto.
    await expect(
      corregirMovimientoTercero(sesion(), id1, { importe: 400, motivo: 'c' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

// ── (b) LA BANDERA ───────────────────────────────────────────────────────────────────────────────

describe('(b) la bandera de la persona: «sólo yo, ni con permiso»', () => {
  it('🔴 SIN la bandera no se corrige, aunque se tengan TODOS los permisos', async () => {
    const id = await movimientoCxp({ importe: 100 });
    await expect(
      corregirMovimientoTercero(
        sesion({ corrector: false }),
        id,
        { importe: 50, motivo: 'x' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    // Y no dejó rastro: el movimiento sigue vivo y el saldo intacto.
    const mov = await cliente.movimientoTercero.findUniqueOrThrow({ where: { id } });
    expect(mov.cancelado).toBe(false);
    expect(await cliente.movimientoTercero.count({ where: { idProveedor: proveedor.id } })).toBe(1);
  });

  it('CON la bandera pero sin el permiso del módulo tampoco: la bandera no exime, suma', async () => {
    const id = await movimientoCxp({ importe: 100 });
    await expect(
      corregirMovimientoTercero(
        sesion({ permisos: ['terceros.ver'], corrector: true }),
        id,
        { importe: 50, motivo: 'x' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('sin la bandera, el estado de cuenta marca TODOS los renglones como no corregibles', async () => {
    await movimientoCxp({ importe: 100 });
    const sinBandera = await estadoDeCuentaTercero(
      sesion({ corrector: false }),
      'proveedor',
      proveedor.id,
      {},
      bd(),
    );
    expect(sinBandera.movimientos.every((m) => !m.corregible)).toBe(true);

    const conBandera = await estadoDeCuentaTercero(sesion(), 'proveedor', proveedor.id, {}, bd());
    expect(conBandera.movimientos.filter((m) => m.corregible)).toHaveLength(1);
  });
});

// ── (c) «SIN FACTURA» es del MOVIMIENTO, no del proveedor ───────────────────────────────────────

describe('(c) el segmento es del MOVIMIENTO', () => {
  it('🔴 un renglón CON factura no se corrige…', async () => {
    const id = await movimientoCxp({
      idProveedor: proveedorAmbos.id,
      importe: 900,
      esFiscal: true,
    });
    await expect(
      corregirMovimientoTercero(sesion(), id, { importe: 100, motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('…y el de al lado, del MISMO proveedor, sí: el proveedor `ambos` tiene de los dos', async () => {
    const conFactura = await movimientoCxp({
      idProveedor: proveedorAmbos.id,
      importe: 900,
      esFiscal: true,
    });
    const sinFactura = await movimientoCxp({
      idProveedor: proveedorAmbos.id,
      importe: 400,
      esFiscal: false,
    });

    const nuevo = await corregirMovimientoTercero(
      sesion(),
      sinFactura,
      { importe: 450, motivo: 'ajuste' },
      bd(),
    );
    expect(nuevo.esFiscal).toBe(false);
    // El fiscal no se tocó.
    const fiscal = await cliente.movimientoTercero.findUniqueOrThrow({ where: { id: conFactura } });
    expect(fiscal.cancelado).toBe(false);

    // Y el estado de cuenta lo dice antes de que nadie lo intente.
    const edc = await estadoDeCuentaTercero(sesion(), 'proveedor', proveedorAmbos.id, {}, bd());
    const filaFiscal = edc.movimientos.find((m) => m.id === conFactura);
    expect(filaFiscal?.corregible).toBe(false);
  });
});

// ── (d) lo que NO se puede cambiar ──────────────────────────────────────────────────────────────

describe('(d) proveedor y tipo de movimiento no se corrigen; y sin cambios no hay corrección', () => {
  it('🔴 mandar otro proveedor en el cuerpo se rechaza (400, no se ignora en silencio)', async () => {
    const id = await movimientoCxp({ importe: 100 });
    await expect(
      corregirMovimientoTercero(
        sesion(),
        id,
        { importe: 50, motivo: 'x', idProveedor: proveedorAmbos.id } as never,
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('🔴 mandar otro origen también', async () => {
    const id = await movimientoCxp({ importe: 100 });
    await expect(
      corregirMovimientoTercero(
        sesion(),
        id,
        { importe: 50, motivo: 'x', origen: 'abono' } as never,
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('el tercero y el origen del corregido son los del corregido, no los de nadie más', async () => {
    const id = await movimientoCxp({ importe: 100 });
    const nuevo = await corregirMovimientoTercero(sesion(), id, { importe: 50, motivo: 'x' }, bd());
    expect(nuevo.idTercero).toBe(proveedor.id);
    expect(nuevo.origen).toBe('pago');
  });

  it('una corrección que no cambia nada se rechaza (no quema dos folios por gusto)', async () => {
    const id = await movimientoCxp({ importe: 100, fecha: '2026-09-01' });
    await expect(
      corregirMovimientoTercero(
        sesion(),
        id,
        { importe: 100, fecha: '2026-09-01', motivo: 'x' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.movimientoTercero.count({ where: { idProveedor: proveedor.id } })).toBe(1);
  });
});

// ── (g)/(h) bitácora y empresa ──────────────────────────────────────────────────────────────────

describe('(g) A7 y (h) A9', () => {
  it('la bitácora guarda QUÉ DECÍA ANTES, qué dice ahora y por qué', async () => {
    const id = await movimientoCxp({ importe: 1000, observaciones: 'sem 35' });
    await corregirMovimientoTercero(
      sesion(),
      id,
      { importe: 250, motivo: 'se tecleó de más' },
      bd(),
    );
    const filas = await cliente.bitacora.findMany({
      where: { entidad: 'MovimientoTercero', idEntidad: String(id), accion: 'MODIFICAR' },
    });
    expect(filas).toHaveLength(1);
    const datos = filas[0]?.datos as Record<string, unknown>;
    expect(datos.operacion).toBe('corregir-sin-factura');
    expect(datos.motivo).toBe('se tecleó de más');
    expect(datos.antes).toMatchObject({ monto: 1000, observaciones: 'sem 35' });
    expect(datos.despues).toMatchObject({ monto: 250 });
  });

  it('un movimiento de OTRA empresa no existe para esta sesión', async () => {
    const id = await movimientoCxp({ importe: 100 });
    await expect(
      corregirMovimientoTercero(
        sesion({ idEmpresaActiva: otraEmpresa.id }),
        id,
        { importe: 50, motivo: 'x' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

// ── EsMa ────────────────────────────────────────────────────────────────────────────────────────

/** Monta el escenario de maquila (orden cortada) que necesitan los cargos y los pagos. */
async function montarEsMa(): Promise<void> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'Maquila costura' },
  });
  const rolCorte = await cliente.rolProveedor.upsert({
    where: { codigo: 'corte' },
    update: {},
    create: { codigo: 'corte', nombre: 'Corte' },
  });
  cortador = await cliente.proveedor.create({
    data: {
      nombre: 'Corte SA',
      modalidadFacturacion: 'solo_sin',
      roles: { create: { idRolProveedor: rolCorte.id } },
    },
  });
  maquilero = await cliente.proveedor.create({
    data: {
      nombre: 'Maquila Costura SA',
      modalidadFacturacion: 'solo_sin',
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
    ],
  });

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
  idOrden = orden.id;

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

/** Envía, recibe y valida un cargo de costura de `cant` prendas a `precio`. Devuelve su id. */
async function cargoValidado(cant: number, precio: number): Promise<number> {
  await registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquilero.id,
      fecha: '2026-06-19',
      precioPactado: precio,
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: cant }] }],
    },
    bd(),
  );
  await registrarReciboMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquilero.id,
      fecha: '2026-06-20',
      precioPactado: precio,
      idAlmacenPrimeras: almPrimeras.id,
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: cant }] }],
    },
    bd(),
  );
  const cola = await listarCargosEsMa(
    sesion(),
    { estado: 'propuesto', idMaquilero: maquilero.id },
    bd(),
  );
  const idCargo = cola.filas[0]?.id as number;
  await validarCargoEsMa(sesion(), idCargo, { cantidadReal: cant, precioReal: precio }, bd());
  return idCargo;
}

describe('EsMa · abonos y descuentos', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  it('corregir un ABONO: el viejo deja de contar al saldo y el bueno lo sustituye', async () => {
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01', observaciones: 'flete' },
      bd(),
    );
    await revisarMovimiento(sesion(), 'abono', abono.id, bd());
    const antes = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(antes.saldo).toBe(500);

    const r = await corregirMovimientoEsMa(
      sesion(),
      'abono',
      abono.id,
      { importe: 120, motivo: 'era el flete chico' },
      bd(),
    );
    expect(r.idCorregido).toBe(abono.id);

    // 🔴 El saldo NO suma los dos: el viejo está cancelado y el criterio único lo excluye.
    const despues = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(despues.saldo).toBe(120);

    // El nuevo hereda el estado de revisión (si no, corregir un movimiento ya autorizado lo sacaría
    // del saldo a escondidas).
    const nuevo = await cliente.abonoMaquilero.findUniqueOrThrow({ where: { id: r.idNuevo } });
    expect(nuevo.estadoRevision).toBe('revisado');
    expect(nuevo.idAbonoCorregido).toBe(abono.id);
    expect(nuevo.conFactura).toBe(false);

    // D3: el viejo sigue en la tabla, cancelado y con su motivo.
    const viejo = await cliente.abonoMaquilero.findUniqueOrThrow({ where: { id: abono.id } });
    expect(viejo.canceladoEn).not.toBeNull();
    expect(viejo.motivoCancelacion).toBe('era el flete chico');
    expect(viejo.monto.toNumber()).toBe(500);
  });

  it('🔴 un abono CANCELADO tampoco cuenta como PENDIENTE de revisión', async () => {
    // La condición de estar vivo va en los DOS criterios: si sólo fuera en el del saldo, el tablero
    // enseñaría para siempre una partida «por revisar» que ya no existe.
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    await corregirMovimientoEsMa(sesion(), 'abono', abono.id, { importe: 120, motivo: 'x' }, bd());
    const saldo = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(saldo.pendienteRevision.partidas).toBe(1);
    expect(saldo.pendienteRevision.abonos).toBe(120);
  });

  it('un abono cancelado desaparece del estado de cuenta y el bueno ocupa su lugar', async () => {
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    const r = await corregirMovimientoEsMa(
      sesion(),
      'abono',
      abono.id,
      { importe: 120, motivo: 'x' },
      bd(),
    );
    const edc = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    const abonos = edc.movimientos.filter((m) => m.concepto === 'abono');
    expect(abonos).toHaveLength(1);
    expect(abonos[0]?.id).toBe(r.idNuevo);
    expect(abonos[0]?.corregible).toBe(true);
  });

  it('🔴 el DESCUENTO que propuso un CIERRE de orden no se corrige suelto', async () => {
    // Su liga al cierre es única e intransferible: el sustituto no podría heredarla y el deshacer
    // del cierre se quedaría buscando un descuento que ya nadie usa. Se arregla deshaciendo el cierre.
    const cierre = await cliente.cierreMaquilaOrden.create({
      data: {
        idEmpresa: empresa.id,
        idOrden,
        idMaquilero: maquilero.id,
        idTipoProceso: procesoCostura.id,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        desenlace: 'cobrado',
        precioFaltante: 8,
      },
    });
    const descuento = await cliente.descuentoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: 80,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: false,
        idCierreMaquila: cierre.id,
      },
    });
    await expect(
      corregirMovimientoEsMa(
        sesion(),
        'descuento',
        descuento.id,
        { importe: 40, motivo: 'x' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

// ── (e) ⭐⭐ EL CASO DIFÍCIL: el pago aplicado a cargos ───────────────────────────────────────────

describe('(e) ⭐⭐ corregir un PAGO aplicado a cargos', () => {
  let idCargo: number;
  let idPago: number;

  beforeEach(async () => {
    await montarEsMa();
    idCargo = await cargoValidado(10, 8); // 10 prendas × $8 = $80
    const pago = await crearPagoMaquilero(
      sesion(),
      {
        idMaquilero: maquilero.id,
        fecha: '2026-09-01',
        aplicaciones: [{ idCargo, cantidad: 10 }],
        observaciones: 'pago sem 35',
      },
      bd(),
    );
    idPago = pago.id;
  });

  it('el arreglo deja la orden PAGADA y el cargo cubierto', async () => {
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.cantidadPagada.toNumber()).toBe(10);
    expect((await obtenerOrdenPagada(sesion(), idOrden, bd())).pagada).toBe(true);
  });

  it('🔴 corregir su IMPORTE se rechaza: sale de las prendas aplicadas, no es un dato suelto', async () => {
    await expect(
      corregirMovimientoEsMa(sesion(), 'pago', idPago, { importe: 50, motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // Y no dejó nada a medias: el pago sigue vivo y el cargo sigue cubierto (A2).
    const pago = await cliente.pagoMaquilero.findUniqueOrThrow({ where: { id: idPago } });
    expect(pago.canceladoEn).toBeNull();
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.cantidadPagada.toNumber()).toBe(10);
  });

  it('⭐⭐ corregir su FECHA re-aplica los MISMOS cargos: las prendas no se duplican ni se pierden', async () => {
    const r = await corregirMovimientoEsMa(
      sesion(),
      'pago',
      idPago,
      { fecha: '2026-09-08', motivo: 'era de la otra semana' },
      bd(),
    );

    // El pago viejo queda cancelado; el bueno lo sustituye y vale lo mismo (Σ de sus aplicaciones).
    const viejo = await cliente.pagoMaquilero.findUniqueOrThrow({ where: { id: idPago } });
    expect(viejo.canceladoEn).not.toBeNull();
    const nuevo = await cliente.pagoMaquilero.findUniqueOrThrow({
      where: { id: r.idNuevo },
      include: { aplicaciones: true },
    });
    expect(nuevo.idPagoCorregido).toBe(idPago);
    expect(nuevo.monto.toNumber()).toBe(80);
    expect(nuevo.aplicaciones).toHaveLength(1);
    expect(nuevo.aplicaciones[0]?.cantidad.toNumber()).toBe(10);

    // 🔴 EL PUNTO DE TODO ESTO: el cargo NO quedó pagado dos veces. `cantidadPagada` sigue en 10
    // (no 20), que es lo que la suma VIVA de aplicaciones dice.
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.cantidadPagada.toNumber()).toBe(10);
    const vivas = await cliente.pagoAplicacion.aggregate({
      where: { idCargo, pago: { canceladoEn: null } },
      _sum: { cantidad: true },
    });
    expect(vivas._sum.cantidad?.toNumber()).toBe(10);

    // …y las aplicaciones del pago cancelado NO se borraron (D3: siguen como rastro).
    expect(await cliente.pagoAplicacion.count({ where: { idPago } })).toBe(1);

    // 🔴 Y el saldo tampoco cuenta el pago dos veces. ⚠️ OJO CON EL BOLSILLO: un pago capturado con
    // `crearPagoMaquilero` nace `capturado` (fila 0.128 — capturar no es validar), así que NO entra
    // en `totalPagos` sino en lo PENDIENTE DE REVISIÓN. Ahí es donde hay que mirar el doble conteo:
    // si el pago cancelado siguiera contando, serían 160 en dos partidas.
    const saldo = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(saldo.totalPagos).toBe(0);
    expect(saldo.pendienteRevision.pagos).toBe(80);
    expect(saldo.pendienteRevision.partidas).toBe(1);

    // Y la orden sigue pagada (el estatus derivado sobrevivió al ida y vuelta).
    expect((await obtenerOrdenPagada(sesion(), idOrden, bd())).pagada).toBe(true);
  });

  it('🔴 después de corregir, el cargo NO admite un segundo pago por las mismas prendas', async () => {
    // Si la corrección hubiera «liberado» las prendas sin volver a ocuparlas, aquí se podría pagar
    // otra vez lo mismo: el maquilero cobraría doble.
    await corregirMovimientoEsMa(
      sesion(),
      'pago',
      idPago,
      { fecha: '2026-09-08', motivo: 'x' },
      bd(),
    );
    await expect(
      crearPagoMaquilero(
        sesion(),
        {
          idMaquilero: maquilero.id,
          fecha: '2026-09-09',
          aplicaciones: [{ idCargo, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('un pago A CUENTA (sin aplicaciones) SÍ cambia de importe', async () => {
    const aCuenta = await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: 300,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: false,
        estadoRevision: 'revisado',
      },
    });
    const r = await corregirMovimientoEsMa(
      sesion(),
      'pago',
      aCuenta.id,
      { importe: 250, motivo: 'se le dio menos' },
      bd(),
    );
    const nuevo = await cliente.pagoMaquilero.findUniqueOrThrow({ where: { id: r.idNuevo } });
    expect(nuevo.monto.toNumber()).toBe(250);
    expect(nuevo.estadoRevision).toBe('revisado');
    // Los dos pagos a cuenta NO se suman: sólo cuenta el VIVO (250; el de 300 quedó cancelado).
    // El pago APLICADO de 80 no aparece aquí porque nació `capturado`: vive en el pendiente.
    const saldo = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(saldo.totalPagos).toBe(250);
    expect(saldo.pendienteRevision.pagos).toBe(80);
  });

  it('heredar `revisado` exige `esma.revisar` (regla de la fila 0.128)', async () => {
    const aCuenta = await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: 300,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: false,
        estadoRevision: 'revisado',
      },
    });
    const sinRevisar = PERM_TODOS.filter((p) => p !== 'esma.revisar');
    await expect(
      corregirMovimientoEsMa(
        sesion({ permisos: sinRevisar }),
        'pago',
        aCuenta.id,
        { importe: 250, motivo: 'x' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el estado de cuenta avisa que ese pago no admite cambio de importe', async () => {
    const edc = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    const fila = edc.movimientos.find((m) => m.concepto === 'pago' && m.id === idPago);
    expect(fila?.corregible).toBe(true);
    expect(fila?.importeCorregible).toBe(false);
  });

  it('🔴 el CARGO nunca es corregible: nace de un recibo, no se «mete» en el estado de cuenta', async () => {
    const edc = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    const cargo = edc.movimientos.find((m) => m.concepto === 'cargo');
    expect(cargo?.corregible).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 LOS SEIS MUTANTES QUE SOBREVIVIERON A LA PRIMERA REVISIÓN (0.145, ronda de corrección)
//
// Cada `it` de aquí abajo mata a uno. No son pruebas "de más": son exactamente las guardas que la
// fila promete y que nada vigilaba — incluida la que Daniel puso como condición («sin factura»),
// que en EsMa se podía borrar entera con la suite en verde.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('🔴 las guardas de EsMa que nada vigilaba (mutantes m17, m18, m11)', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  /** Un abono del maquilero `ambos`, con el segmento que se le pida. */
  async function abonoConSegmento(conFactura: boolean): Promise<number> {
    const mixto = await cliente.proveedor.update({
      where: { id: maquilero.id },
      data: { modalidadFacturacion: 'ambos' },
    });
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: mixto.id, monto: 500, fecha: '2026-09-01', conFactura },
      bd(),
    );
    return abono.id;
  }

  it('🔴 m17 · un movimiento de MAQUILA **CON FACTURA** NO se corrige', async () => {
    // Es la condición que puso Daniel, y en EsMa se podía quitar la guarda entera con la suite en
    // verde. Detrás de un movimiento con factura hay un CFDI: se cancela ante el SAT, no se edita.
    const id = await abonoConSegmento(true);
    await expect(
      corregirMovimientoEsMa(sesion(), 'abono', id, { importe: 120, motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // Y no dejó rastro: el abono sigue vivo y no nació ningún sustituto.
    const vivo = await cliente.abonoMaquilero.findUniqueOrThrow({ where: { id } });
    expect(vivo.canceladoEn).toBeNull();
    expect(await cliente.abonoMaquilero.count({ where: { idMaquilero: maquilero.id } })).toBe(1);
  });

  it('…y el de al lado, SIN factura y del MISMO maquilero, sí (es del movimiento, no del proveedor)', async () => {
    const conFactura = await abonoConSegmento(true);
    const sinFactura = await abonoConSegmento(false);
    const r = await corregirMovimientoEsMa(
      sesion(),
      'abono',
      sinFactura,
      { importe: 120, motivo: 'x' },
      bd(),
    );
    expect(r.idNuevo).toBeGreaterThan(0);
    expect(
      (await cliente.abonoMaquilero.findUniqueOrThrow({ where: { id: conFactura } })).canceladoEn,
    ).toBeNull();
  });

  it('🔴 m18 · el estado de cuenta de maquila NO ofrece «Corregir» sobre un renglón con factura', async () => {
    // La pantalla no re-deriva la regla: obedece el `corregible` del servidor. Si éste ignorara el
    // segmento, se ofrecería un botón que el servidor rechaza — y peor: que parecería permitido.
    const conFactura = await abonoConSegmento(true);
    const sinFactura = await abonoConSegmento(false);
    const edc = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    expect(
      edc.movimientos.find((m) => m.concepto === 'abono' && m.id === conFactura)?.corregible,
    ).toBe(false);
    expect(
      edc.movimientos.find((m) => m.concepto === 'abono' && m.id === sinFactura)?.corregible,
    ).toBe(true);
  });

  it('🔴 m11 · en EsMa la bandera TAMPOCO exime del permiso del módulo', async () => {
    // El gemelo de la prueba del motor, que sólo cubría aquel lado. `esma.ver-pagos` deja LEER el
    // estado de cuenta; capturar un abono es `esma.modificar`, y corregirlo también.
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    const sinModificar = PERM_TODOS.filter((p) => p !== 'esma.modificar');
    await expect(
      corregirMovimientoEsMa(
        sesion({ permisos: sinModificar, corrector: true }),
        'abono',
        abono.id,
        { importe: 120, motivo: 'x' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(
      (await cliente.abonoMaquilero.findUniqueOrThrow({ where: { id: abono.id } })).canceladoEn,
    ).toBeNull();
  });
});

describe('🔴 lo cancelado no puede reaparecer (mutantes m7, m8, m16)', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  it('🔴 m7 · el abono corregido NO reaparece en el estado de cuenta de CxP junto a su sustituto', async () => {
    // La convivencia proyecta los movimientos de EsMa dentro de la cuenta del proveedor. Sin el
    // filtro de vivos, el proveedor mostraría el viejo Y el nuevo: la misma deuda, dos veces.
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    const r = await corregirMovimientoEsMa(
      sesion(),
      'abono',
      abono.id,
      { importe: 120, motivo: 'x' },
      bd(),
    );
    const edc = await estadoDeCuentaTercero(sesion(), 'proveedor', maquilero.id, {}, bd());
    const abonos = edc.movimientos.filter((m) => m.fuente === 'esma' && m.origen === 'abono');
    expect(abonos).toHaveLength(1);
    expect(abonos[0]?.id).toBe(r.idNuevo);
  });

  it('🔴 m8 · el pago corregido NO se cuenta dos veces en el corte de caja de la semana', async () => {
    // Lo dice el propio TSDoc de `semanales.ts`: sin el filtro de vivos, la semana contaría dos
    // veces el mismo dinero. Un pago anulado NUNCA salió de la chequera.
    const aCuenta = await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: 300,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: false,
        estadoRevision: 'revisado',
      },
    });
    await corregirMovimientoEsMa(
      sesion(),
      'pago',
      aCuenta.id,
      { importe: 250, motivo: 'se le dio menos' },
      bd(),
    );
    const semana = await pagosSemanales(
      sesion(),
      { desde: '2026-09-01', hasta: '2026-09-07' },
      bd(),
    );
    expect(semana.filas).toHaveLength(1);
    expect(semana.filas[0]?.monto).toBe(250);
    expect(semana.total).toBe(250);
  });

  it('🔴 m16 · un abono ya ANULADO no se puede «revisar»', async () => {
    // Revisar es el acto que mete la partida al saldo. Hacerlo sobre un renglón muerto dejaría el
    // fantasma «cancelado + revisado» que ninguna suma sabe leer (la cicatriz de la fila 0.109).
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    await corregirMovimientoEsMa(sesion(), 'abono', abono.id, { importe: 120, motivo: 'x' }, bd());
    await expect(revisarMovimiento(sesion(), 'abono', abono.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    const muerto = await cliente.abonoMaquilero.findUniqueOrThrow({ where: { id: abono.id } });
    expect(muerto.estadoRevision).toBe('capturado');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 (f) A2 DE VERDAD — la prueba que el TSDoc de este archivo declaraba y NO existía
//
// La cabecera prometía «si la RECAPTURA falla, no queda el pago cancelado ni el cargo liberado», y
// lo único que había era un rechazo que ocurre ANTES de escribir nada. Esto fuerza el escenario
// real: el pago SÍ se cancela y las prendas SÍ se liberan… y entonces la recaptura truena. Si la
// transacción no fuera atómica, el maquilero se quedaría con un pago anulado, sin sustituto, y con
// sus prendas cobrables otra vez.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('🔴 (f) A2 · si la RECAPTURA falla, la corrección entera se deshace', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  it('un cargo que deja de estar validado entre medias: nada queda a medias', async () => {
    const idCargo = await cargoValidado(10, 8); // 10 pzas × $8
    const pago = await crearPagoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, fecha: '2026-09-01', aplicaciones: [{ idCargo, cantidad: 10 }] },
      bd(),
    );

    // ⭐ EL DISPARO: el cargo se cancela DESPUÉS de que el pago lo cubriera. Ahora la corrección
    // llega hasta el paso 4 —ya canceló el pago y ya liberó las prendas— y ahí revienta al
    // re-aplicar, porque un cargo cancelado no se paga.
    await cliente.esMaCargo.update({ where: { id: idCargo }, data: { estado: 'cancelado' } });

    await expect(
      corregirMovimientoEsMa(
        sesion(),
        'pago',
        pago.id,
        { fecha: '2026-09-08', motivo: 'era de la otra semana' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // 🔴 LO QUE A2 GARANTIZA, medido pieza por pieza:
    const vivo = await cliente.pagoMaquilero.findUniqueOrThrow({ where: { id: pago.id } });
    expect(vivo.canceladoEn).toBeNull(); // el pago NO quedó anulado
    expect(await cliente.pagoMaquilero.count({ where: { idMaquilero: maquilero.id } })).toBe(1);
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.cantidadPagada.toNumber()).toBe(10); // las prendas NO se liberaron
    const vivas = await cliente.pagoAplicacion.aggregate({
      where: { idCargo, pago: { canceladoEn: null } },
      _sum: { cantidad: true },
    });
    expect(vivas._sum.cantidad?.toNumber()).toBe(10);
  });

  it('🟡 y el mensaje habla de CORREGIR, no de «no se puede pagar»', async () => {
    // Quien sólo quería mover una fecha recibía un error sobre pagar un cargo. Falla cerrado en los
    // dos casos; lo que cambia es que ahora dice la verdad de lo que pasó.
    const idCargo = await cargoValidado(10, 8);
    const pago = await crearPagoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, fecha: '2026-09-01', aplicaciones: [{ idCargo, cantidad: 10 }] },
      bd(),
    );
    await cliente.esMaCargo.update({ where: { id: idCargo }, data: { estado: 'cancelado' } });
    await expect(
      corregirMovimientoEsMa(sesion(), 'pago', pago.id, { fecha: '2026-09-08', motivo: 'x' }, bd()),
    ).rejects.toThrow(/no se puede corregir/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🟡 A7 · el movimiento NUEVO también tiene que poder contestar «¿quién me creó?»
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('🟡 A7 · el abono corregido deja su propia entrada CREAR', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  it('el sustituto no queda con cero renglones propios en la bitácora', async () => {
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    const r = await corregirMovimientoEsMa(
      sesion(),
      'abono',
      abono.id,
      { importe: 120, motivo: 'era el flete chico' },
      bd(),
    );

    // El NUEVO: su CREAR, igual que si se hubiera capturado a mano, y con la liga a quien sustituye.
    const creado = await cliente.bitacora.findMany({
      where: { entidad: 'AbonoMaquilero', idEntidad: String(r.idNuevo) },
    });
    expect(creado).toHaveLength(1);
    expect(creado[0]?.accion).toBe('CREAR');
    expect(creado[0]?.datos as Record<string, unknown>).toMatchObject({ correccionDe: abono.id });

    // El VIEJO: su MODIFICAR con lo que decía antes.
    const corregido = await cliente.bitacora.findMany({
      where: { entidad: 'AbonoMaquilero', idEntidad: String(abono.id) },
    });
    expect(corregido.map((b) => b.accion)).toContain('MODIFICAR');
    const mod = corregido.find((b) => b.accion === 'MODIFICAR')?.datos as Record<string, unknown>;
    expect(mod.antes).toMatchObject({ monto: 500 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 EL RECIBO EN PDF DE UN PAGO ANULADO — que no se pueda cobrar dos veces
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('🔴 el recibo de un pago corregido sale MARCADO', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  it('obtener el pago anulado lo devuelve, pero diciendo que está anulado', async () => {
    const aCuenta = await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: 900,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: false,
        estadoRevision: 'revisado',
      },
    });
    await corregirMovimientoEsMa(
      sesion(),
      'pago',
      aCuenta.id,
      { importe: 500, motivo: 'se tecleó de más' },
      bd(),
    );

    const viejo = await obtenerPagoMaquilero(sesion(), aCuenta.id, bd());
    expect(viejo.monto).toBe(900); // sigue existiendo: es el rastro (D3)
    expect(viejo.canceladoEn).not.toBeNull(); // …pero viene MARCADO
    expect(viejo.motivoCancelacion).toBe('se tecleó de más');

    // Y los datos del RECIBO —el papel que se le entrega al maquilero— llevan el sello.
    const datos = await armarDatosImpresoReciboPago(sesion(), aCuenta.id, bd());
    expect(datos.canceladoEn).not.toBeNull();
    const sello = textoSelloAnulado(datos);
    expect(sello?.titulo).toContain('NO ES COMPROBANTE DE PAGO');
  });

  it('el recibo del pago BUENO no lleva sello', async () => {
    const aCuenta = await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: 900,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: false,
        estadoRevision: 'revisado',
      },
    });
    const r = await corregirMovimientoEsMa(
      sesion(),
      'pago',
      aCuenta.id,
      { importe: 500, motivo: 'x' },
      bd(),
    );
    const datos = await armarDatosImpresoReciboPago(sesion(), r.idNuevo, bd());
    expect(datos.monto).toBe(500);
    expect(textoSelloAnulado(datos)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 EL IMPORTE DEL RENGLÓN SIN REVISAR — el caso CENTRAL de la fila, medido en el SERVIDOR
//
// Un movimiento «capturado por error» es, por definición, uno que **aún no se revisó**. Para ésos el
// `monto` viaja VACÍO a propósito (no aporta al saldo todavía), y el cajón de corrección arrancaba de
// ahí: dejaba el importe intocable y lo explicaba con un mensaje sobre permisos que era FALSO.
//
// ⚠️ Las pruebas de pantalla no bastan para esto: usan un fixture escrito a mano, así que pasan
// aunque el SERVIDOR mande mal el dato. Esto lo mide donde se decide.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('🔴 `importeGuardado` no se vacía por estar sin revisar (sólo por permiso)', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  it('en el estado de cuenta de CxP: `monto` va vacío, pero el importe SÍ viaja', async () => {
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    const edc = await estadoDeCuentaTercero(sesion(), 'proveedor', maquilero.id, {}, bd());
    const fila = edc.movimientos.find((m) => m.fuente === 'esma' && m.id === abono.id);

    expect(fila?.monto).toBeNull(); // capturado y sin revisar: no aporta al saldo
    expect(fila?.importeGuardado).toBe(500); // …pero se puede corregir, y por 500
    expect(fila?.corregible).toBe(true);
    expect(fila?.importeCorregible).toBe(true);
  });

  it('y en el de maquila también: el `monto` resta, pero el importe guardado va POSITIVO', async () => {
    const descuento = await cliente.descuentoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: 300,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: false,
        estadoRevision: 'revisado',
      },
    });
    const edc = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    const fila = edc.movimientos.find((m) => m.concepto === 'descuento' && m.id === descuento.id);
    // ⚠️ OJO: este caso NO demuestra la positividad — el descuento está GUARDADO en positivo, así que
    // pasaría igual sin normalizar nada. Lo que sí demuestra es que `monto` e `importeGuardado` son
    // números DISTINTOS. La positividad la prueba el bloque de los movimientos MIGRADOS, abajo.
    expect(fila?.monto).toBe(-300);
    expect(fila?.importeGuardado).toBe(300);
  });

  it('sin `consultas.ver-importes` sí se vacía — ahí el mensaje de la pantalla es verdad', async () => {
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    const sinImportes = PERM_TODOS.filter((p) => p !== 'consultas.ver-importes');
    const edc = await estadoDeCuentaTercero(
      sesion({ permisos: sinImportes }),
      'proveedor',
      maquilero.id,
      {},
      bd(),
    );
    expect(edc.movimientos.find((m) => m.id === abono.id)?.importeGuardado).toBeNull();
  });

  it('🔴 y el importe corregido del renglón sin revisar llega de verdad al saldo', async () => {
    // El cierre del círculo: si el servidor no mandara el importe, esta corrección nunca se
    // intentaría desde la pantalla. Aquí se comprueba que además funciona de punta a punta.
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    const r = await corregirMovimientoEsMa(
      sesion(),
      'abono',
      abono.id,
      { importe: 120, motivo: 'era el flete chico' },
      bd(),
    );
    await revisarMovimiento(sesion(), 'abono', r.idNuevo, bd());
    const saldo = await saldoDeMaquilero(sesion(), maquilero.id, {}, bd());
    expect(saldo.totalAbonos).toBe(120);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 LOS MOVIMIENTOS MIGRADOS, QUE ESTÁN GUARDADOS EN NEGATIVO
//
// El ETL de EsMa carga los «saldo anterior» del sistema viejo TAL CUAL, y el viejo SÍ tiene montos
// negativos (`dominio/esma/migracion.ts`: *«los servicios normales rechazarían montos negativos, que
// el viejo SÍ tiene»*). Además llegan con `conFactura = null`, que cuenta como SIN factura ⇒ son
// CORREGIBLES.
//
// 🔴 Si el importe llegara a la pantalla en negativo, el cajón cortaría al guardar con «captura un
// importe mayor a 0» **aunque sólo se hubiera cambiado la fecha**: el botón «Corregir» no serviría
// para nada justo sobre los renglones viejos que más se van a querer tocar. Y REGLA 0-B lo exige al
// revés de como suena: ante un dato migrado, la función nueva **no debe tronar**.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('🔴 un movimiento MIGRADO con monto negativo se corrige igual', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  /** Un abono como los que deja el ETL: monto NEGATIVO y sin modalidad definida. */
  async function abonoMigradoNegativo(): Promise<number> {
    const abono = await cliente.abonoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: -1234.5,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: null,
        estadoRevision: 'revisado',
        observaciones: 'saldo anterior',
      },
    });
    return abono.id;
  }

  it('🔴 en el estado de cuenta de MAQUILA el importe llega en POSITIVO', async () => {
    const id = await abonoMigradoNegativo();
    const edc = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    const fila = edc.movimientos.find((m) => m.concepto === 'abono' && m.id === id);
    expect(fila?.corregible).toBe(true); // `conFactura: null` cuenta como SIN factura
    expect(fila?.monto).toBe(-1234.5); // su aportación al saldo sigue siendo negativa
    expect(fila?.importeGuardado).toBe(1234.5); // …pero lo que se corrige va en positivo
  });

  it('🔴 y en el de CxP también (las seis ramas de EsMa, no sólo una)', async () => {
    const id = await abonoMigradoNegativo();
    const edc = await estadoDeCuentaTercero(sesion(), 'proveedor', maquilero.id, {}, bd());
    const fila = edc.movimientos.find((m) => m.fuente === 'esma' && m.id === id);
    expect(fila?.corregible).toBe(true);
    expect(fila?.importeGuardado).toBe(1234.5);
  });

  it('🔴 el MOTOR hace lo mismo (es de donde salió la regla)', async () => {
    const id = await movimientoCxp({ importe: 700 }); // origen `pago` ⇒ se guarda como −700
    const edc = await estadoDeCuentaTercero(sesion(), 'proveedor', proveedor.id, {}, bd());
    const fila = edc.movimientos.find((m) => m.id === id && m.fuente === 'motor');
    expect(fila?.monto).toBe(-700);
    expect(fila?.importeGuardado).toBe(700);
  });

  it('⭐ y el descuento y el pago migrados, también (las otras cuatro ramas)', async () => {
    const descuento = await cliente.descuentoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: -50.25,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: null,
        estadoRevision: 'revisado',
      },
    });
    const pago = await cliente.pagoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: -80.75,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: null,
        estadoRevision: 'revisado',
      },
    });
    const maquila = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    expect(maquila.movimientos.find((m) => m.concepto === 'descuento')?.importeGuardado).toBe(
      50.25,
    );
    expect(maquila.movimientos.find((m) => m.concepto === 'pago')?.importeGuardado).toBe(80.75);

    const cxp = await estadoDeCuentaTercero(sesion(), 'proveedor', maquilero.id, {}, bd());
    expect(
      cxp.movimientos.find((m) => m.id === descuento.id && m.origen === 'descuento')
        ?.importeGuardado,
    ).toBe(50.25);
    expect(
      cxp.movimientos.find((m) => m.id === pago.id && m.origen === 'pago')?.importeGuardado,
    ).toBe(80.75);
  });

  it('⭐⭐ y CORREGIR SÓLO LA FECHA funciona: era justo lo que el cajón hacía imposible', async () => {
    const id = await abonoMigradoNegativo();
    const r = await corregirMovimientoEsMa(
      sesion(),
      'abono',
      id,
      { fecha: '2026-09-08', motivo: 'era de la otra semana' },
      bd(),
    );
    const nuevo = await cliente.abonoMaquilero.findUniqueOrThrow({ where: { id: r.idNuevo } });
    // El importe se conserva TAL CUAL (negativo incluido): corregir la fecha no lo toca.
    expect(nuevo.monto.toNumber()).toBe(-1234.5);
    expect(nuevo.fecha.toISOString().slice(0, 10)).toBe('2026-09-08');
  });

  it('🔴 y el importe 0 viaja como 0, NO como `null` (el ETL carga los vacíos así)', async () => {
    // `migracion/loaders/esma-cargos.ts:545`: `parsearDinero(...) ?? 0`. El 0 es FALSY, así que
    // basta un `monto ? … : null` mal puesto para que el renglón llegue como «no puedes ver
    // importes» —una mentira sobre los permisos de quien mira— y para que el cajón deje de dejar
    // tocar el importe. El defecto gemelo del negativo, del lado de la pantalla, lo cubre
    // `EstadoCuentaProveedorPagina.test.tsx`: con 0 se corrige la fecha igual.
    const abono = await cliente.abonoMaquilero.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: maquilero.id,
        monto: 0,
        fecha: new Date('2026-09-01T00:00:00.000Z'),
        conFactura: null,
        estadoRevision: 'revisado',
      },
    });
    const edc = await estadoCuentaMaquilero(sesion(), maquilero.id, {}, bd());
    const fila = edc.movimientos.find((m) => m.concepto === 'abono' && m.id === abono.id);
    expect(fila?.corregible).toBe(true);
    expect(fila?.importeGuardado).toBe(0);
    expect(fila?.importeGuardado).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🟠 LA COMPUERTA DE PRIVACIDAD DEL MOTOR — su candado no estaba probado (mutante n7)
//
// El `importeGuardado` es un dato de DINERO. La prueba que había buscaba la fila por el id de un
// abono de EsMa, así que sólo ejercitaba esa rama: borrar el `puedeVerImportes ?` del MOTOR dejaba
// la suite entera en verde. No había fuga, pero un edit futuro habría pasado el CI.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('🟠 sin `consultas.ver-importes`, el importe se oculta en LAS DOS fuentes', () => {
  beforeEach(async () => {
    await montarEsMa();
  });

  it('🔴 el renglón del MOTOR no filtra el importe', async () => {
    const id = await movimientoCxp({ importe: 700, idProveedor: proveedor.id });
    const sinImportes = PERM_TODOS.filter((p) => p !== 'consultas.ver-importes');
    const edc = await estadoDeCuentaTercero(
      sesion({ permisos: sinImportes }),
      'proveedor',
      proveedor.id,
      {},
      bd(),
    );
    const fila = edc.movimientos.find((m) => m.id === id && m.fuente === 'motor');
    expect(fila).toBeDefined(); // el renglón se ve…
    expect(fila?.importeGuardado).toBeNull(); // …pero su importe, no
    expect(fila?.monto).toBeNull();
  });

  it('y el renglón de ESMA tampoco', async () => {
    const abono = await crearAbonoMaquilero(
      sesion(),
      { idMaquilero: maquilero.id, monto: 500, fecha: '2026-09-01' },
      bd(),
    );
    const sinImportes = PERM_TODOS.filter((p) => p !== 'consultas.ver-importes');
    const maquila = await estadoCuentaMaquilero(
      sesion({ permisos: sinImportes }),
      maquilero.id,
      {},
      bd(),
    );
    expect(maquila.movimientos.find((m) => m.id === abono.id)?.importeGuardado).toBeNull();
  });
});
