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
import { cancelarEtapaMovimiento, registrarCorte, registrarEnvioMaquila } from './etapas.js';
import { wipDeOrden } from './wip.js';
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

  // Regla de Daniel (28-jul-2026): *"no puedo recibir un corte de un maquilero diferente al que se
  // lo entregué"*. El saldo se lleva POR MAQUILERO, no por proceso.
  it('RECHAZA recibirle a un maquilero al que NO se le entregó (y dice a quién sí)', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    const otro = await crearProveedorConRol('Otra Maquila SA', 'maquila-costura');

    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: otro.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/no se le entregó el corte.*Maquila Costura SA/s);

    expect(
      await cliente.etapaMovimiento.count({ where: { idOrden, tipo: 'recibo_maquila' } }),
    ).toBe(0);
  });

  it('con DOS maquileros, a cada uno solo se le recibe LO SUYO', async () => {
    await cortarBase();
    const otro = await crearProveedorConRol('Otra Maquila SA', 'maquila-costura');
    // 6 piezas a un maquilero y 4 al otro (10 cortadas de Rojo/CH).
    await enviar(procesoCostura, maquileroCostura, 6);
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: otro.id,
        fecha: '2026-06-19',
        precioPactado: 8,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
      },
      bd(),
    );

    // Antes: como el saldo se llevaba por PROCESO (10 enviadas en total), esto pasaba y le cargaba
    // a uno el trabajo del otro. Ahora se rechaza: ese maquilero solo tiene 4.
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: otro.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Lo suyo (4) sí entra, y el saldo del otro maquilero queda intacto.
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: otro.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
      },
      bd(),
    );
    expect(recibo.totalPiezas).toBe(4);

    const wip = await wipDeOrden(sesion(), idOrden, bd());
    const costura = wip.porRecibir.find((p) => p.generaEntradaPt);
    expect(costura?.totalPendiente).toBe(6); // 10 enviadas − 4 recibidas
    const desglose = new Map(costura?.porMaquilero.map((m) => [m.idMaquilero, m.totalPendiente]));
    expect(desglose.get(maquileroCostura.id)).toBe(6); // no le devolvió nada
    expect(desglose.get(otro.id)).toBe(0); // ya devolvió lo suyo
  });

  it('la misma regla aplica al ARTE (estampado): no se recibe de quien no se le entregó', async () => {
    await cortarBase();
    await enviar(procesoEstampado, estampador, 10);
    const otroArte = await crearProveedorConRol('Otro Estampado SA', 'estampado');

    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoEstampado.id,
          idMaquilero: otroArte.id,
          fecha: '2026-06-20',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/no se le entregó el corte.*Estampados SA/s);

    // Y al que SÍ se le entregó, sí (el arte no mete a PT: sin almacenes).
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
    expect(recibo.totalPiezas).toBe(10);
    expect(recibo.generaEntradaPt).toBe(false);
  });

  it('la LIGA a un envío tiene que ser del MISMO maquilero', async () => {
    await cortarBase();
    const otro = await crearProveedorConRol('Otra Maquila SA', 'maquila-costura');
    await enviar(procesoCostura, maquileroCostura, 6);
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: otro.id,
        fecha: '2026-06-19',
        precioPactado: 8,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
      },
      bd(),
    );
    const envioDelPrimero = await cliente.etapaMovimiento.findFirstOrThrow({
      where: {
        idOrden,
        tipo: 'envio_maquila',
        idTercero: maquileroCostura.id,
        canceladoEn: null,
      },
      select: { id: true },
    });

    // El saldo por tercero cuadraría (el otro tiene 4), pero la liga apuntaría al envío ajeno.
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: otro.id,
          idEtapaEnvio: envioDelPrimero.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/orden, proceso y maquilero/);
  });

  it('el saldo YA RECIBIDO también se cuenta por maquilero (dos recibos del mismo)', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    const recibir = (cantidad: number) =>
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad }] }],
        },
        bd(),
      );
    await recibir(6);
    await expect(recibir(5)).rejects.toBeInstanceOf(ErrorConflicto); // solo le quedan 4
    await expect(recibir(4)).resolves.toMatchObject({ totalPiezas: 4 });
  });

  it('el histórico SIN maquilero se DICE tal cual (no "no tiene ninguna entrega")', async () => {
    await cortarBase();
    // Entrega migrada sin tercero: el ETL las crea así cuando el Access no lo traía.
    await cliente.etapaMovimiento.create({
      data: {
        folio: 9001n,
        idEmpresa: empresa.id,
        idOrden,
        tipo: 'envio_maquila',
        idTipoProceso: procesoCostura.id,
        idTercero: null,
        fecha: new Date('2026-06-19T00:00:00.000Z'),
        detalles: {
          create: [{ idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 10 }],
        },
      },
    });

    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/SIN maquilero \(histórico migrado\)/);

    // Y el desglose del WIP lo MUESTRA (no lo esconde): el pendiente existe, sin tercero.
    const wip = await wipDeOrden(sesion(), idOrden, bd());
    const costura = wip.porRecibir.find((p) => p.generaEntradaPt);
    const huerfano = costura?.porMaquilero.find((m) => m.idMaquilero === null);
    expect(huerfano?.totalPendiente).toBe(10);
    expect(huerfano?.maquilero).toBe('Sin asignar');
  });

  it('un maquilero con RECIBO y sin envío aparece en el desglose (pendiente negativo)', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);
    const otro = await crearProveedorConRol('Otra Maquila SA', 'maquila-costura');
    // Recibo migrado de un tercero SIN envío (el Access los llevaba por separado).
    await cliente.etapaMovimiento.create({
      data: {
        folio: 9002n,
        idEmpresa: empresa.id,
        idOrden,
        tipo: 'recibo_maquila',
        idTipoProceso: procesoCostura.id,
        idTercero: otro.id,
        fecha: new Date('2026-06-20T00:00:00.000Z'),
        detalles: {
          create: [
            { idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 3, cantidadPrimeras: 3 },
          ],
        },
      },
    });

    const wip = await wipDeOrden(sesion(), idOrden, bd());
    const costura = wip.porRecibir.find((p) => p.generaEntradaPt);
    const desglose = new Map(costura?.porMaquilero.map((m) => [m.idMaquilero, m.totalPendiente]));
    expect(desglose.get(otro.id)).toBe(-3);
    // Σ del desglose == pendiente del proceso: las dos vistas del módulo no pueden contradecirse.
    const suma = (costura?.porMaquilero ?? []).reduce((s, m) => s + m.totalPendiente, 0);
    expect(suma).toBe(costura?.totalPendiente);
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

  it('la respuesta de la CANCELACION redacta precioPactado sin ver-precio-real; la captura no (R2 §4.4.3)', async () => {
    await cortarBase();
    await enviar(procesoEstampado, estampador, 10);

    // CAPTURA: quien lo tecleo lo ve en la respuesta aunque no tenga el permiso de ver reales.
    const reciboA = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    expect(reciboA.precioPactado).toBe(8);

    // CANCELACION sin `ordenes.ver-precio-real-maquila`: la respuesta va redactada (null)...
    const canceladoSinPermiso = await cancelarReciboMaquila(
      sesion(),
      reciboA.id,
      { motivo: 'reproceso' },
      bd(),
    );
    expect(canceladoSinPermiso.cancelado).toBe(true);
    expect(canceladoSinPermiso.precioPactado).toBeNull();
    // ...pero la BD lo CONSERVA intacto (es redaccion de salida, no borrado — D3).
    const enBd = await cliente.etapaMovimiento.findUniqueOrThrow({ where: { id: reciboA.id } });
    expect(enBd.precioPactado?.toNumber()).toBe(8);

    // CANCELACION con el permiso: la respuesta si trae el monto.
    const reciboB = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-21',
        precioPactado: 8,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    const canceladoConPermiso = await cancelarReciboMaquila(
      sesion([...PERM_TODOS, 'ordenes.ver-precio-real-maquila']),
      reciboB.id,
      { motivo: 'reproceso' },
      bd(),
    );
    expect(canceladoConPermiso.precioPactado).toBe(8);
  });
});

describe('Cancelación de ENVÍO con recibos vivos (D1)', () => {
  it('bloquea (409) cancelar un envío con recibos vivos; cancelado el recibo, el envío sí se cancela', async () => {
    await cortarBase();
    const envio = await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        precioPactado: 8,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        idEtapaEnvio: envio.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    // Con el recibo VIVO, cancelar el envío se bloquea (el recibido quedaría sin envío que lo sostenga).
    await expect(
      cancelarEtapaMovimiento(sesion(), envio.id, { motivo: 'maquilero equivocado' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // El envío siguió VIVO (el intento fallido no lo tocó — D3).
    const envioTrasIntento = await cliente.etapaMovimiento.findUniqueOrThrow({
      where: { id: envio.id },
    });
    expect(envioTrasIntento.canceladoEn).toBeNull();

    // Cancelado el recibo primero, el envío ya se puede cancelar.
    await cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'reproceso' }, bd());
    const cancelado = await cancelarEtapaMovimiento(
      sesion(),
      envio.id,
      { motivo: 'maquilero equivocado' },
      bd(),
    );
    expect(cancelado.cancelado).toBe(true);
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
  JOIN "movimiento_det_pt" AS orig ON orig."id_movimiento" = m_orig."id"
  WHERE inv."id_movimiento" = m_inv."id"
    AND orig."id_modelo" = inv."id_modelo"
    AND orig."id_color" = inv."id_color"
    AND orig."id_talla" = inv."id_talla"
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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// V1-E8k · PRENDAS INCOMPLETAS (§Post-F9.136)
//
// El ESTADO PROHIBIDO que estas pruebas vigilan: *una prenda incompleta que haya quedado sumada
// dentro de `EtapaMovimientoDet.cantidad` — y que por eso aparezca en el kardex de PT o en la
// cantidad del cargo al maquilero, o que haya cerrado el pendiente por recibir de la orden*.
//
// Las cuatro reglas de Daniel: se capturan · NO entran a inventario · NO cuentan como producidas ·
// NO se pagan. Y una quinta que se deriva de la opción A que eligió: el pendiente contra el
// maquilero se queda ABIERTO (por eso descartó la opción B).
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('V1-E8k · prendas incompletas (§Post-F9.136)', () => {
  /**
   * EL CASO DE DANIEL, tal cual lo contó: se mandan 10 a coser, vuelven 8 buenas + 2 incompletas.
   * Se verifican de una sola vez las cuatro reglas y la quinta derivada.
   */
  it('⭐ 10 enviadas → 8 buenas + 2 incompletas: no se inventarían, no se pagan, no se producen y el pendiente queda ABIERTO', async () => {
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
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [{ idTalla: tallaCH.id, cantidad: 8, cantidadIncompletas: 2 }],
          },
        ],
      },
      bd(),
    );

    // (1) SE CAPTURAN, y en su propio campo: el total recibido son 8, no 10.
    expect(recibo.totalPiezas).toBe(8);
    expect(recibo.totalIncompletas).toBe(2);
    expect(recibo.lineas[0]?.tallas[0]?.cantidadIncompletas).toBe(2);
    expect(recibo.lineas[0]?.totalIncompletas).toBe(2);
    // La invariante de calidad sigue en pie sobre las BUENAS, sin las incompletas.
    expect(recibo.totalPrimeras + recibo.totalSegundas).toBe(recibo.totalPiezas);

    // (2) NO ENTRAN A INVENTARIO: el kardex de PT recibió 8, no 10.
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(8);

    // (3) NO SE PAGAN: el cargo propone 8 × $8 = $64, y las incompletas viajan aparte.
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    expect(cola.filas).toHaveLength(1);
    expect(cola.filas[0]?.cantidadPropuesta).toBe(8);
    expect(cola.filas[0]?.importePropuesto).toBe(64);
    expect(cola.filas[0]?.incompletas).toBe(2);

    // (4) NO CUENTAN COMO PRODUCIDAS: el WIP dice recibido 8 de 10 enviadas.
    const wip = await wipDeOrden(sesion(), idOrden, bd());
    expect(wip.recibido).toBe(8);
    expect(wip.recibidoCostura).toBe(8);

    // (5) EL PENDIENTE QUEDA ABIERTO (decisión A; la opción B lo habría cerrado): siguen faltando
    // 2 piezas contra el maquilero, que es justo lo que Daniel necesita para cobrarle el faltante.
    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const costura = pend.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    expect(costura?.totalPendiente).toBe(2);
    expect(costura?.totalIncompletas).toBe(2);
    const celdaCH = costura?.celdas.find((c) => c.idTalla === tallaCH.id);
    expect(celdaCH?.cantidad).toBe(2);
    expect(celdaCH?.incompletas).toBe(2);
    // …y lo MISMO por maquilero, que es lo que la pantalla de captura usa como tope.
    const delMaquilero = costura?.porMaquilero.find((m) => m.idMaquilero === maquileroCostura.id);
    expect(delMaquilero?.totalPendiente).toBe(2);
    expect(delMaquilero?.totalIncompletas).toBe(2);
  });

  it('un recibo SOLO de incompletas se guarda y NO genera cargo EsMa', async () => {
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
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [{ idTalla: tallaCH.id, cantidad: 0, cantidadIncompletas: 3 }],
          },
        ],
      },
      bd(),
    );

    expect(recibo.totalPiezas).toBe(0);
    expect(recibo.totalIncompletas).toBe(3);
    // Nada que pagar: la cola de validación NO se ensucia con un cargo de cantidad 0.
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    expect(cola.filas).toHaveLength(0);
    // Ni almacén hizo falta (no metió nada a inventario) ni se creó movimiento de kardex.
    expect(recibo.idMovimientoEntrada).toBeNull();
    const movs = await cliente.movimiento.count({ where: { origenTipo: 'recibo-maquila' } });
    expect(movs).toBe(0);
  });

  it('MUTACIÓN «la que la QUITA»: sin el tope, buenas + incompletas podría exceder lo enviado', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);

    // 10 enviadas, se intentan devolver 9 buenas + 2 incompletas = 11 piezas físicas.
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [
            {
              idColor: colorRojo.id,
              tallas: [{ idTalla: tallaCH.id, cantidad: 9, cantidadIncompletas: 2 }],
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Y no quedó rastro: ni recibo, ni kardex, ni cargo (A2).
    expect(await cliente.etapaMovimiento.count({ where: { tipo: 'recibo_maquila' } })).toBe(0);
    expect(await cliente.esMaCargo.count()).toBe(0);
  });

  it('MUTACIÓN «la que la QUITA», acumulada: las incompletas YA entregadas consumen lo recibible', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);

    // Primero: 8 buenas + 2 incompletas = las 10 devueltas.
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [{ idTalla: tallaCH.id, cantidad: 8, cantidadIncompletas: 2 }],
          },
        ],
      },
      bd(),
    );

    // Ahora ya no queda NADA que devolver, aunque el pendiente por cobrar siga marcando 2: esas
    // 2 piezas ya salieron del taller como incompletas y no pueden reaparecer como buenas.
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-21',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 2 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // La existencia sigue siendo la del primer recibo: el rechazo no dejó nada a medias.
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(8);
  });

  it('MUTACIÓN «la que la EXCEDE»: el tope NO puede cerrarse de más — 8+2 sobre 10 enviadas SÍ pasa', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);

    // Exactamente en el límite (10 = 10). Un tope "cerrado de más" —por ejemplo, que contara las
    // incompletas dos veces, o que las restara también del enviado— rechazaría esto.
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [{ idTalla: tallaCH.id, cantidad: 8, cantidadIncompletas: 2 }],
          },
        ],
      },
      bd(),
    );
    expect(recibo.totalPiezas).toBe(8);

    // Y un recibo posterior SIN incompletas de OTRA talla no queda contaminado por el tope de CH.
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaM.id, cantidad: 5 }] }],
      },
      bd(),
    );
    const segundo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-21',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaM.id, cantidad: 5 }] }],
      },
      bd(),
    );
    expect(segundo.totalPiezas).toBe(5);
    expect(segundo.totalIncompletas).toBe(0);
  });

  it('MUTACIÓN «la que la EXCEDE»: un recibo normal SIN incompletas se comporta igual que antes', async () => {
    // La columna nueva no puede cambiar el 99 % de los recibos: sin `cantidadIncompletas`, el
    // detalle la guarda NULL y todos los derivados la leen como 0.
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
    expect(recibo.totalIncompletas).toBe(0);
    expect(recibo.lineas[0]?.tallas[0]?.cantidadIncompletas).toBe(0);
    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const costura = pend.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    // Sin pendiente y sin incompletas, la celda desaparece igual que siempre.
    expect(costura?.celdas.find((c) => c.idTalla === tallaCH.id)).toBeUndefined();
    expect(costura?.totalIncompletas).toBe(0);
  });

  it('las incompletas NO se pueden colar como calidad: primeras + segundas siguen sumando la cantidad', async () => {
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
          lineas: [
            {
              idColor: colorRojo.id,
              // 6 + 2 ≠ 10: el desglose de calidad NO admite que las incompletas tapen el hueco.
              tallas: [
                {
                  idTalla: tallaCH.id,
                  cantidad: 10,
                  cantidadPrimeras: 6,
                  cantidadSegundas: 2,
                  cantidadIncompletas: 2,
                },
              ],
            },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/incompletas NO van aquí/);
  });

  it('los recibos semanales reportan las incompletas APARTE del total recibido', async () => {
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
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [{ idTalla: tallaCH.id, cantidad: 8, cantidadIncompletas: 2 }],
          },
        ],
      },
      bd(),
    );
    const semanales = await recibosSemanalesPorMaquilero(
      sesion(),
      { idMaquilero: maquileroCostura.id },
      bd(),
    );
    expect(semanales.filas).toHaveLength(1);
    expect(semanales.filas[0]?.totalRecibido).toBe(8);
    expect(semanales.filas[0]?.totalIncompletas).toBe(2);
  });

  it('cancelar el recibo borra las incompletas de la conversación (y el pendiente vuelve a 10)', async () => {
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
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [{ idTalla: tallaCH.id, cantidad: 8, cantidadIncompletas: 2 }],
          },
        ],
      },
      bd(),
    );
    await cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'error de captura' }, bd());

    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const costura = pend.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    expect(costura?.totalPendiente).toBe(10);
    expect(costura?.totalIncompletas).toBe(0);

    // Y se puede volver a capturar el recibo entero: el tope ya no cuenta las incompletas muertas.
    const repetido = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-21',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(repetido.totalPiezas).toBe(10);
  });
});
