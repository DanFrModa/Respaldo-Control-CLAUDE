/**
 * Tests de integración del RECIBO de maquila (F3-E4, etapa ⭐ central). Postgres efímero
 * (testcontainers). Cubre lo que la ficha exige:
 *  (a) recibo de COSTURA produce los 3 efectos atómicos (WIP baja pendiente + entrada PT sube
 *      existencia + cargo EsMa propuesto);
 *  (b) recibo de ESTAMPADO sube WIP + cargo PERO NO crea Movimiento ni altera existencias;
 *  (c) atomicidad: si falla un paso (recibido > enviado), no queda ni recibo ni entrada ni cargo;
 *  (d) concurrencia: dos recibos simultáneos no exceden lo enviado (suma directa bajo lock);
 *  (e) recibido > enviado → rechazado (estricto, decisión (g));
 *  (f) cancelar recibo de COSTURA revierte kardex con inverso; cancelar ESTAMPADO no toca kardex;
 *  (g) folios A3 consecutivos.
 * Y de paso: calidad primeras/segundas a almacenes separados, pendientes por recibir y la cola EsMa.
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
import {
  cancelarReciboMaquila,
  pendientesPorRecibir,
  recibosSemanalesPorMaquilero,
  registrarReciboMaquila,
} from './recibos.js';
import { registrarCorte, registrarEnvioMaquila } from './etapas.js';
import { consultarExistenciasPt, registrarMovimientoPt } from '../inventarios/movimientos-pt.js';
import { listarCargosEsMa, validarCargoEsMa } from '../esma/cargos.js';

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
let almSegundas: Almacen;
let idOrden: number;
let clienteNegocioId: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.cancelar',
  'produccion.wip-ver',
  'inventario-pt.ver',
  'esma.cargo-validar',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/** Crea un proveedor con un rol dado (vía RolProveedor). */
async function crearProveedorConRol(nombre: string, codigoRol: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: codigoRol },
    update: {},
    create: { codigo: codigoRol, nombre: codigoRol },
  });
  return cliente.proveedor.create({
    data: { nombre, roles: { create: { idRolProveedor: rol.id } } },
  });
}

/** Crea una orden con matriz: Rojo (CH 10, M 20). Devuelve su id. */
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

/** Crea los tipos de movimiento que usa el recibo de costura (entrada + inverso). */
async function sembrarTiposMovimiento(): Promise<void> {
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
    ],
  });
}

/** Corta Rojo CH 10 + M 20 (todo lo pedido). */
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

/** Envía `cantidadCH` piezas de Rojo/CH al proceso dado (con su maquilero). */
async function enviar(
  proceso: TipoProceso,
  maquilero: Proveedor,
  cantidadCH: number,
): Promise<void> {
  await registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: proceso.id,
      idMaquilero: maquilero.id,
      fecha: '2026-06-19',
      precioPactado: 8,
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: cantidadCH }] }],
    },
    bd(),
  );
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
  almSegundas = await cliente.almacen.create({ data: { nombre: 'Segundas', tipo: 'PT' } });
  await sembrarTiposMovimiento();
  idOrden = await crearOrdenConMatriz();
});

describe('Recibo de COSTURA (F3-E4)', () => {
  it('(a) produce los 3 efectos atómicos: WIP recibido + entrada PT + cargo EsMa propuesto', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);

    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    // (1) WIP: el recibo existe, mete a PT y deriva el total.
    expect(recibo.folio).toBeGreaterThan(0);
    expect(recibo.totalPiezas).toBe(10);
    expect(recibo.totalPrimeras).toBe(10);
    expect(recibo.totalSegundas).toBe(0);
    expect(recibo.generaEntradaPt).toBe(true);
    expect(recibo.idMovimientoEntrada).not.toBeNull();

    // (2) Entrada a PT: existencia de Rojo/CH en Primeras = 10.
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(10);
    const fila = existencias.filas.find((f) => f.idAlmacen === almPrimeras.id);
    expect(fila?.existencia).toBe(10);

    // (2b) PT por orden (F6-E2): la entrada quedó ETIQUETADA con la orden del recibo (detalle y vista).
    expect(fila?.idOrden).toBe(idOrden);
    const detsPt = await cliente.movimientoDetPt.findMany({
      where: { movimiento: { origenTipo: 'recibo-maquila' } },
      select: { idOrden: true },
    });
    expect(detsPt.length).toBeGreaterThan(0);
    expect(detsPt.every((d) => d.idOrden === idOrden)).toBe(true);

    // (3) Cargo EsMa propuesto: cantidad propuesta = 10, precio = 8.
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    expect(cola.filas).toHaveLength(1);
    expect(cola.filas[0]?.cantidadPropuesta).toBe(10);
    expect(cola.filas[0]?.precioPropuesto).toBe(8);
    expect(cola.filas[0]?.importePropuesto).toBe(80);

    // WIP baja pendiente: ya no queda nada por recibir de costura en CH.
    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const costura = pend.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    const celdaCH = costura?.celdas.find((c) => c.idTalla === tallaCH.id);
    expect(celdaCH).toBeUndefined(); // 0 → se omite
  });

  it('reparte primeras y segundas a sus almacenes separados', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);

    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        idAlmacenSegundas: almSegundas.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10, cantidadPrimeras: 7, cantidadSegundas: 3 },
            ],
          },
        ],
      },
      bd(),
    );

    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    const enPrimeras = existencias.filas.find((f) => f.idAlmacen === almPrimeras.id);
    const enSegundas = existencias.filas.find((f) => f.idAlmacen === almSegundas.id);
    expect(enPrimeras?.existencia).toBe(7);
    expect(enSegundas?.existencia).toBe(3);
  });

  it('(g) folios A3 consecutivos por empresa', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    const r1 = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
      },
      bd(),
    );
    const r2 = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 3 }] }],
      },
      bd(),
    );
    expect(r2.folio).toBe(r1.folio + 1);
  });
});

describe('Recibo de ESTAMPADO (F3-E4)', () => {
  it('(b) sube WIP + cargo PERO NO crea Movimiento ni altera existencias', async () => {
    await cortarBase();
    await enviar(procesoEstampado, estampador, 10);

    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-20',
        precioPactado: 3,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    expect(recibo.generaEntradaPt).toBe(false);
    expect(recibo.idMovimientoEntrada).toBeNull();

    // NO hay movimientos de kardex.
    const movs = await cliente.movimiento.count({ where: { idEmpresa: empresa.id } });
    expect(movs).toBe(0);
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(0);

    // SÍ hay cargo EsMa propuesto.
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    expect(cola.filas).toHaveLength(1);
    expect(cola.filas[0]?.tipoProceso).toBe('Estampado');
  });
});

describe('recibido ≤ enviado y atomicidad (F3-E4)', () => {
  it('(e) RECHAZA recibir más de lo enviado (estricto, decisión g)', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 11 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('(c) atomicidad — rechazo PREVIO (recibido > enviado): no escribe nada', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 99 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    const recibos = await cliente.etapaMovimiento.count({
      where: { idOrden, tipo: 'recibo_maquila' },
    });
    expect(recibos).toBe(0);
    const movs = await cliente.movimiento.count({ where: { idEmpresa: empresa.id } });
    expect(movs).toBe(0);
    const cargos = await cliente.esMaCargo.count({ where: { idEmpresa: empresa.id } });
    expect(cargos).toBe(0);
  });

  it('(c2) atomicidad REAL — un fallo TARDÍO (en esMaCargo.create) revierte recibo + kardex ya escritos', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);

    // Cliente que deja pasar TODO menos `esMaCargo.create`, que truena. Como ese create ocurre
    // DESPUÉS de crear el recibo (`etapaMovimiento.create`) y los movimientos de kardex (la entrada
    // a PT), el fallo obliga al `$transaction` a revertir filas YA ESCRITAS: es el caso que respalda
    // la garantía A2 (no el rechazo previo de la validación). El extension corre dentro de la misma
    // transacción interactiva que abre `enTransaccion(fn, { cliente })`.
    const fallaEnCargo = 'fallo inyectado en esMaCargo.create (prueba de rollback)';
    const clienteQueFalla = cliente.$extends({
      query: {
        esMaCargo: {
          create() {
            throw new Error(fallaEnCargo);
          },
        },
      },
    }) as unknown as typeof cliente;

    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        { cliente: clienteQueFalla },
      ),
    ).rejects.toThrow(fallaEnCargo);

    // NADA quedó persistido (rollback de filas ya escritas): los 3 conteos en 0.
    const recibos = await cliente.etapaMovimiento.count({
      where: { idOrden, tipo: 'recibo_maquila' },
    });
    expect(recibos).toBe(0);
    const movs = await cliente.movimiento.count({ where: { idEmpresa: empresa.id } });
    expect(movs).toBe(0);
    const detalles = await cliente.movimientoDetPt.count();
    expect(detalles).toBe(0);
    const cargos = await cliente.esMaCargo.count({ where: { idEmpresa: empresa.id } });
    expect(cargos).toBe(0);
    // La existencia sigue en 0 (la entrada a PT se revirtió con el resto).
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(0);
  });

  it('(d) dos recibos CONCURRENTES no exceden lo enviado', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    // Dos recibos de 6 (12 > 10): a lo sumo UNO pasa.
    const intento = () =>
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 6 }] }],
        },
        bd(),
      );
    const resultados = await Promise.allSettled([intento(), intento()]);
    const exitosos = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(exitosos).toBe(1);

    const filas = await cliente.etapaMovimientoDet.findMany({
      where: { etapaMov: { idOrden, tipo: 'recibo_maquila', canceladoEn: null } },
    });
    const totalRecibido = filas.reduce((s, f) => s + f.cantidad, 0);
    expect(totalRecibido).toBeLessThanOrEqual(10);
  });
});

describe('Cancelación de recibos (F3-E4)', () => {
  it('(f) cancelar recibo de COSTURA revierte el kardex con inverso (existencia vuelve a 0)', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    const antes = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(antes.totalExistencia).toBe(10);

    const cancelado = await cancelarReciboMaquila(
      sesion(),
      recibo.id,
      { motivo: 'piezas rechazadas por calidad' },
      bd(),
    );
    expect(cancelado.cancelado).toBe(true);

    // La existencia vuelve a 0 (inverso neutraliza la entrada; ambos movimientos siguen ahí, D3).
    const despues = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(despues.totalExistencia).toBe(0);
    const movs = await cliente.movimiento.count({ where: { idEmpresa: empresa.id } });
    expect(movs).toBe(2); // entrada + inverso

    // El cargo EsMa quedó cancelado.
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    expect(cola.filas).toHaveLength(0);

    // El pendiente por recibir vuelve a 10 (el recibo cancelado deja de contar).
    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const costura = pend.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    expect(costura?.totalPendiente).toBe(10);
  });

  it('(f) cancelar recibo de ESTAMPADO NO toca el kardex', async () => {
    await cortarBase();
    await enviar(procesoEstampado, estampador, 10);
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-20',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    await cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'reproceso' }, bd());
    const movs = await cliente.movimiento.count({ where: { idEmpresa: empresa.id } });
    expect(movs).toBe(0);
  });
});

describe('Cola de validación EsMa y recibos semanales (F3-E4)', () => {
  it('valida un cargo propuesto ajustando cantidad y precio', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    const idCargo = cola.filas[0]?.id as number;

    const validado = await validarCargoEsMa(
      sesion(),
      idCargo,
      { cantidadReal: 9, precioReal: 8.5 },
      bd(),
    );
    expect(validado.estado).toBe('validado');
    expect(validado.cantidadReal).toBe(9);
    expect(validado.precioReal).toBe(8.5);
    expect(validado.importeReal).toBe(76.5);

    // Ya no está en la cola de propuestos.
    const propuestos = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    expect(propuestos.filas).toHaveLength(0);
  });

  it('agrupa recibos semanales por maquilero con su calidad', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        idAlmacenSegundas: almSegundas.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10, cantidadPrimeras: 8, cantidadSegundas: 2 },
            ],
          },
        ],
      },
      bd(),
    );
    const semanal = await recibosSemanalesPorMaquilero(sesion(), {}, bd());
    expect(semanal.filas).toHaveLength(1);
    expect(semanal.filas[0]?.maquilero).toBe('Maquila Costura SA');
    expect(semanal.filas[0]?.totalRecibido).toBe(10);
    expect(semanal.filas[0]?.totalPrimeras).toBe(8);
    expect(semanal.filas[0]?.totalSegundas).toBe(2);
    expect(semanal.filas[0]?.numRecibos).toBe(1);
  });
});

// El BACKFILL de la migración `20260627120000_f6_e2_pt_por_orden` (copiado AQUÍ verbatim) repuebla el
// `id_orden` de los movimientos de PT que ya estaban en `prueba` antes de la columna. Se prueba
// simulando el estado pre-migración (poner `id_orden = NULL` en lo que el dominio ya etiquetó) y
// corriendo los dos UPDATE; deben re-derivar la orden del recibo/entrega y de su cancelación.
const SQL_BACKFILL_RECIBO_ENTREGA = `
  UPDATE "movimiento_det_pt" AS d
  SET "id_orden" = em."id_orden"
  FROM "movimientos" AS m
  JOIN "etapa_movimiento" AS em ON em."id"::text = m."origen_id"
  WHERE d."id_movimiento" = m."id"
    AND m."origen_tipo" IN ('recibo-maquila', 'entrega-cliente')
    AND m."origen_id" IS NOT NULL
    AND d."id_orden" IS NULL
`;
const SQL_BACKFILL_CANCELACION = `
  UPDATE "movimiento_det_pt" AS inv
  SET "id_orden" = orig."id_orden"
  FROM "movimientos" AS m_inv
  JOIN "movimientos" AS m_orig ON m_orig."id"::text = m_inv."origen_id"
  JOIN "movimiento_det_pt" AS orig
    ON orig."id_movimiento" = m_orig."id"
    AND orig."id_modelo" = inv."id_modelo"
    AND orig."id_color" = inv."id_color"
    AND orig."id_talla" = inv."id_talla"
  WHERE inv."id_movimiento" = m_inv."id"
    AND m_inv."origen_tipo" = 'cancelacion'
    AND inv."id_orden" IS NULL
    AND orig."id_orden" IS NOT NULL
`;

describe('Backfill PT por orden (migración F6-E2)', () => {
  it('repuebla id_orden de un recibo a partir de su etapa (origen → orden)', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    // Simula el estado PRE-migración: borra el id_orden que el dominio ya puso.
    await cliente.movimientoDetPt.updateMany({ data: { idOrden: null } });
    expect(await cliente.movimientoDetPt.count({ where: { idOrden: { not: null } } })).toBe(0);

    await cliente.$executeRawUnsafe(SQL_BACKFILL_RECIBO_ENTREGA);

    const dets = await cliente.movimientoDetPt.findMany({ select: { idOrden: true } });
    expect(dets.length).toBeGreaterThan(0);
    expect(dets.every((d) => d.idOrden === idOrden)).toBe(true);
  });

  it('la cancelación de un recibo hereda el id_orden del original (backfill en 2 pasos)', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    await cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'prueba backfill' }, bd());

    // Estado pre-migración: original (recibo) + inverso (cancelación), ambos sin id_orden.
    await cliente.movimientoDetPt.updateMany({ data: { idOrden: null } });
    await cliente.$executeRawUnsafe(SQL_BACKFILL_RECIBO_ENTREGA); // (a) primero el original
    await cliente.$executeRawUnsafe(SQL_BACKFILL_CANCELACION); // (b) luego el inverso

    const dets = await cliente.movimientoDetPt.findMany({ select: { idOrden: true } });
    expect(dets.length).toBeGreaterThan(0);
    // TODO renglón (original e inverso) quedó etiquetado con la orden → la existencia por orden cuadra.
    expect(dets.every((d) => d.idOrden === idOrden)).toBe(true);
  });

  it('NO toca un movimiento MANUAL de PT: su id_orden sigue NULL tras el backfill', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    // Recibo de costura: su entrada a PT nace ETIQUETADA con la orden (el dominio pone id_orden).
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    // Movimiento MANUAL de PT (entrada suelta, SIN orden): su detalle nace con id_orden NULL.
    const tipoEntrada = await cliente.tipoMovimientoInventario.findFirstOrThrow({
      where: { codigo: 'entrada-maquila' },
    });
    await registrarMovimientoPt(
      sesion(['inventario-pt.mover']),
      {
        idTipoMov: tipoEntrada.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-06-21',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );

    // Estado PRE-migración: anula el id_orden que el dominio ya puso (el manual ya era NULL).
    await cliente.movimientoDetPt.updateMany({ data: { idOrden: null } });
    await cliente.$executeRawUnsafe(SQL_BACKFILL_RECIBO_ENTREGA);
    await cliente.$executeRawUnsafe(SQL_BACKFILL_CANCELACION);

    // El recibo SÍ recuperó su orden…
    const detsRecibo = await cliente.movimientoDetPt.findMany({
      where: { movimiento: { origenTipo: 'recibo-maquila' } },
      select: { idOrden: true },
    });
    expect(detsRecibo.length).toBeGreaterThan(0);
    expect(detsRecibo.every((d) => d.idOrden === idOrden)).toBe(true);

    // …pero el MANUAL sigue SIN orden: el backfill solo toca recibo/entrega y su cancelación.
    const detsManual = await cliente.movimientoDetPt.findMany({
      where: { movimiento: { origenTipo: 'movimiento-manual' } },
      select: { idOrden: true },
    });
    expect(detsManual.length).toBeGreaterThan(0);
    expect(detsManual.every((d) => d.idOrden === null)).toBe(true);
  });
});
