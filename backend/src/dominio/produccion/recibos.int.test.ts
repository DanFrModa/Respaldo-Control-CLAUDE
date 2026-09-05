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
import type { CargoEsMaSalida, ClavePermiso } from '../../contrato/index.js';
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
    data: {
      modalidadFacturacion: 'solo_sin',
      nombre,
      roles: { create: { idRolProveedor: rol.id } },
    },
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
/**
 * ⭐ fila 0.114 — LOS CARGOS DE **MAQUILA**, sin el que dejó el corte.
 *
 * Desde 0.114 **todo corte genera su propio `EsMaCargo`** (`servicio: 'corte'`), porque el cortador
 * se paga desde la orden igual que un maquilero. Como casi todos los escenarios de este archivo
 * arrancan con `cortarBase()`, contar cargos «a secas» dejó de medir lo que estas pruebas quieren
 * medir: preguntan por lo que produce EL RECIBO. `servicio === null` es exactamente eso — la marca
 * de un cargo de maquila (el CHECK `esma_cargo_proceso_o_servicio` garantiza que uno de los dos
 * está lleno). Filtrar NO debilita nada: el conteo esperado sigue siendo el mismo número de antes.
 */
function cargosDeMaquila(filas: readonly CargoEsMaSalida[]): CargoEsMaSalida[] {
  return filas.filter((f) => f.servicio === null);
}

/** fila 0.114 — Los cargos que dejó un CORTE (para afirmar que existen, no sólo descartarlos). */
function cargosDeCorte(filas: readonly CargoEsMaSalida[]): CargoEsMaSalida[] {
  return filas.filter((f) => f.servicio === 'corte');
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
    // fila 0.114: en la cola hay DOS cargos —el del corte de `cortarBase()` y el de este recibo—; se
    // afirman los dos por separado, que dice más que el «uno» de antes.
    expect(cargosDeCorte(cola.filas)).toHaveLength(1);
    const deMaquila = cargosDeMaquila(cola.filas);
    expect(deMaquila).toHaveLength(1);
    expect(deMaquila[0]?.idEtapaRecibo).toBe(recibo.id);
    expect(deMaquila[0]?.cantidadPropuesta).toBe(10);
    expect(deMaquila[0]?.precioPropuesto).toBe(8);
    expect(deMaquila[0]?.importePropuesto).toBe(80);

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
    // fila 0.114: el cargo del corte también está en la cola; el de MAQUILA es el de este recibo.
    expect(cargosDeCorte(cola.filas)).toHaveLength(1);
    const deMaquila = cargosDeMaquila(cola.filas);
    expect(deMaquila).toHaveLength(1);
    expect(deMaquila[0]?.idEtapaRecibo).toBe(recibo.id);
    expect(deMaquila[0]?.tipoProceso).toBe('Estampado');
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
    // fila 0.114: lo que NO se escribió es el cargo del RECIBO (`servicio: null` = maquila); el del
    // corte sí está, y tiene que estar — su transacción cerró antes y nada la revierte.
    const cargos = await cliente.esMaCargo.count({
      where: { idEmpresa: empresa.id, servicio: null },
    });
    expect(cargos).toBe(0);
    expect(await cliente.esMaCargo.count({ where: { servicio: 'corte' } })).toBe(1);
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
    // fila 0.114: el espía sobre `esMaCargo.create` se instala DESPUÉS de `cortarBase()` y sólo se
    // le pasa a `registrarReciboMaquila`, así que el create que truena es el del RECIBO — la
    // atomicidad que mide esta prueba es la de siempre. Lo que cambia es el conteo: el cargo del
    // corte quedó COMITEADO en su propia transacción y el rollback del recibo NO puede llevárselo.
    const cargos = await cliente.esMaCargo.count({
      where: { idEmpresa: empresa.id, servicio: null },
    });
    expect(cargos).toBe(0);
    expect(await cliente.esMaCargo.count({ where: { servicio: 'corte' } })).toBe(1);
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
    // fila 0.114: se cancela el del RECIBO, NO el del corte — cancelar un recibo no le quita al
    // cortador lo que ya cortó. Por eso el filtro y la afirmación de que el otro sigue propuesto.
    expect(cargosDeMaquila(cola.filas)).toHaveLength(0);
    expect(cargosDeCorte(cola.filas)).toHaveLength(1);

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
    // fila 0.114: se valida el cargo del RECIBO, no el del corte que dejó `cortarBase()` (antes
    // `filas[0]` era el único; ahora hay dos y tomar el primero sería una lotería por `creadoEn`).
    const idCargo = cargosDeMaquila(cola.filas)[0]?.id as number;

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
    // fila 0.114: el que salió de la cola es el de MAQUILA; validar uno no valida el del corte.
    expect(cargosDeMaquila(propuestos.filas)).toHaveLength(0);
    expect(cargosDeCorte(propuestos.filas)).toHaveLength(1);
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
        motivo: 'Alta de existencia para la prueba',
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
  it('⭐ 10 enviadas → 8 buenas + 2 incompletas: no se inventarían, no se pagan, no se producen y SALEN DEL TRÁNSITO (el pendiente se cierra)', async () => {
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
    // fila 0.114: el cargo que se mide es el del RECIBO (el del corte también está en la cola).
    const deMaquila = cargosDeMaquila(cola.filas);
    expect(deMaquila).toHaveLength(1);
    expect(deMaquila[0]?.cantidadPropuesta).toBe(8);
    expect(deMaquila[0]?.importePropuesto).toBe(64);
    expect(deMaquila[0]?.incompletas).toBe(2);

    // (4) NO CUENTAN COMO PRODUCIDAS: el WIP dice recibido 8 de 10 enviadas.
    const wip = await wipDeOrden(sesion(), idOrden, bd());
    expect(wip.recibido).toBe(8);
    expect(wip.recibidoCostura).toBe(8);

    // (5) ⭐ EL PENDIENTE SE CIERRA (V1-E8v, §Post-F9.147 — esto CORRIGE la decisión A de
    // §Post-F9.136, que lo dejaba abierto "para cobrar el faltante" confundiendo la incompleta con
    // el faltante). DANIEL: *"Al registrarlas como incompletas entregadas, dejan de estar en la
    // maquila. El ya termino de entregar las 100"*. De 10 enviadas volvieron 8 buenas + 2
    // incompletas = 10 piezas: NO falta ninguna, y el pendiente queda en 0.
    // ⚠️ La celda NO desaparece: sigue listada con pendiente 0 e incompletas 2, que es su historia.
    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const costura = pend.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    expect(costura?.totalPendiente).toBe(0);
    expect(costura?.totalIncompletas).toBe(2);
    const celdaCH = costura?.celdas.find((c) => c.idTalla === tallaCH.id);
    expect(celdaCH?.cantidad).toBe(0);
    expect(celdaCH?.incompletas).toBe(2);
    // …y lo MISMO por maquilero.
    const delMaquilero = costura?.porMaquilero.find((m) => m.idMaquilero === maquileroCostura.id);
    expect(delMaquilero?.totalPendiente).toBe(0);
    expect(delMaquilero?.totalIncompletas).toBe(2);

    // (6) ⭐ LA PUERTA QUE DE VERDAD ALIMENTA LA PANTALLA: `wipDeOrden` (→ `pendientePorMaquilero`
    // en `wip.ts`), que es lo que consume `AvanceProduccion.tsx` vía `useWipOrden` para topar la
    // matriz de captura. `pendientesPorRecibir` —lo aseverado arriba— tiene endpoint y hook
    // (`usePendientesRecibir`) pero NINGUNA pantalla lo usa: aseverar sólo ahí dejaba la puerta del
    // MEDIO sin quien la mate, y la matriz podría volver a ofrecer piezas que el servidor rechaza
    // bajo lock —justo la deriva (B) que esta etapa vino a cerrar— con la suite entera en verde.
    const procesoWip = wip.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    const maqWip = procesoWip?.porMaquilero.find((m) => m.idMaquilero === maquileroCostura.id);
    const celdaWip = maqWip?.celdas.find((c) => c.idTalla === tallaCH.id);
    // El PENDIENTE es 0 y es EL MISMO número que el tope de captura: desde V1-E8v ya no hay dos
    // cifras (`cantidad` vs. `recibible`), hay una. Ya devolvió las 10 (8 buenas + 2 incompletas).
    expect(celdaWip?.cantidad).toBe(0);
    expect(celdaWip?.incompletas).toBe(2);
    expect(maqWip?.totalPendiente).toBe(0);
    expect(maqWip?.totalIncompletas).toBe(2);
    // Y el WIP de la orden cierra las CUATRO CUBETAS: enviado = buenas + incompletas + faltante.
    expect(wip.enviado).toBe(10);
    expect(wip.incompletas).toBe(2);
    expect(wip.pendientePorRecibir).toBe(0);
    expect(wip.recibido + wip.incompletas + wip.pendientePorRecibir).toBe(wip.enviado);
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
    // fila 0.114: se mira SÓLO el cargo de maquila — el del corte sí existe y no tiene nada que ver
    // con esta regla (el cortador cortó 30 piezas; lo que no se paga es la maquila de las 3 incompletas).
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    expect(cargosDeMaquila(cola.filas)).toHaveLength(0);
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
    // fila 0.114: «ni cargo» es «ni cargo DE MAQUILA»; el del corte de `cortarBase()` sigue vivo.
    expect(await cliente.esMaCargo.count({ where: { servicio: null } })).toBe(0);
    expect(await cliente.esMaCargo.count({ where: { servicio: 'corte' } })).toBe(1);
  });

  it('MUTACIÓN «la que la QUITA», acumulada: las incompletas YA entregadas consumen el pendiente', async () => {
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

    // Ahora ya no queda NADA que devolver —y el pendiente cerró en 0 (V1-E8v): esas
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

  it('MUTACIÓN «la que la EXCEDE», acumulada: las incompletas cuentan UNA vez, no dos', async () => {
    // ⚠️ ESTA PRUEBA NACIÓ DE UNA MUTACIÓN QUE SOBREVIVIÓ. Contar las incompletas DOS veces en el
    // "ya devuelto" (el error natural al implementar esto: sumarlas en el acumulado Y en la captura
    // del momento) pasaba las 33 pruebas anteriores, porque todas medían el PRIMER recibo — y ahí
    // el acumulado está vacío, así que el doble conteo no se nota. El defecto solo aparece en el
    // SEGUNDO recibo: cerraría de más y bloquearía piezas que el maquilero sí puede devolver.
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);

    // Primer recibo: 5 buenas + 2 incompletas = 7 devueltas de 10 ⇒ quedan 3 pendientes.
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
            tallas: [{ idTalla: tallaCH.id, cantidad: 5, cantidadIncompletas: 2 }],
          },
        ],
      },
      bd(),
    );

    // Segundo recibo por esas 3: DEBE pasar. Con las incompletas contadas dos veces el disponible
    // sería 1 y esto se rechazaría — cerrando de más contra el maquilero.
    const segundo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-21',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 3 }] }],
      },
      bd(),
    );
    expect(segundo.totalPiezas).toBe(3);

    // Y ni una más: 5 + 3 buenas + 2 incompletas = 10 devueltas de 10.
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-22',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // El PENDIENTE que publica `pendientesPorRecibir` dice lo mismo: 0 (V1-E8v — es UN solo
    // número; el campo `recibible` desapareció al volverse idéntico). ⚠️ OJO: este endpoint NO es
    // el que topa la pantalla —ninguna la usa; la de captura come de `wipDeOrden`—, así que la
    // puerta del medio se asevera aparte, en la prueba ⭐ de arriba.
    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const costura = pend.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    const celda = costura?.celdas.find((c) => c.idTalla === tallaCH.id);
    expect(celda?.cantidad).toBe(0);
    expect(celda?.incompletas).toBe(2);
  });

  it('MUTACIÓN «la que la EXCEDE»: un recibo normal SIN incompletas se comporta igual que antes', async () => {
    // La columna nueva no puede cambiar el 99 % de los recibos: sin `cantidadIncompletas`, el
    // dominio persiste **0** (no NULL — `aplanarYValidar` normaliza la ausencia a 0) y todos los
    // derivados lo leen como 0. NULL queda sólo en lo MIGRADO y en lo escrito antes de V1-E8k.
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

  // El nombre dice EXACTAMENTE lo que mide: el WIP. Que la cancelación también las saque del
  // ESTADO DE CUENTA —«la conversación» con el maquilero— lo asevera `esma-estado-cuenta.int.test.ts`
  // («cancelar el recibo las SACA del estado de cuenta»), que es donde vive ese filtro.
  it('cancelar el recibo devuelve el pendiente del WIP a 10 y deja recapturarlo entero', async () => {
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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐⭐ EL PACK / TENDIDO EN EL RECIBO (§Post-F9.10) — la convivencia CON pack / SIN pack
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 DANIEL: *«Creo que sí es importante que viaje el pack al menos en el corte, entrega a maquila…
// y que sea **opcional al recibir**.»* Y, con eso, la parte difícil que él mismo resolvió:
//
//   *«Con el recibo opcional, el saldo «recibido ≤ enviado» no puede llevarse sólo por pack. Un
//   recibo SIN pack consume del saldo agregado de todos los packs de esa orden y proceso; uno CON
//   pack, del suyo. Hay que definir (y **probar**) que las dos formas convivan sin permitir recibir
//   de más en total.»*
//
// La aritmética se prueba pura en `packs.test.ts`; aquí se prueba CONTRA POSTGRES, que es donde
// viven el lock, las cancelaciones, el filtro por maquilero y la persistencia de la columna.
describe('Recibo por PACK (§Post-F9.10)', () => {
  /** Orden con DOS tendidos del MISMO color: pack A (CH 5) y pack B (CH 5). */
  async function crearOrdenConPacks(): Promise<number> {
    const pedido = await cliente.pedido.create({
      data: { folio: 90n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
    });
    const linea = await cliente.pedidoLinea.create({
      data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 10, precio: 10 },
    });
    const orden = await cliente.orden.create({
      data: {
        folio: 90n,
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
              pack: 'A',
              tallas: { create: [{ idTalla: tallaCH.id, cantidad: 5 }] },
            },
            {
              idColor: colorRojo.id,
              pack: 'B',
              tallas: { create: [{ idTalla: tallaCH.id, cantidad: 5 }] },
            },
          ],
        },
      },
    });
    return orden.id;
  }

  /** Corta y envía a costura los 5 de cada pack (el punto de partida de casi todo). */
  async function cortarYEnviarLosDosPacks(idOrdenPacks: number): Promise<void> {
    await registrarCorte(
      sesion(),
      {
        idOrden: idOrdenPacks,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [
          { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
          { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
        ],
      },
      bd(),
    );
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden: idOrdenPacks,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        precioPactado: 8,
        lineas: [
          { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
          { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
        ],
      },
      bd(),
    );
  }

  /** Un recibo de costura de `cantidad` piezas de Rojo/CH, con o sin pack. */
  const recibir = async (
    idOrdenPacks: number,
    pack: string | undefined,
    cantidad: number,
    fecha = '2026-06-20',
  ) =>
    registrarReciboMaquila(
      sesion(),
      {
        idOrden: idOrdenPacks,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha,
        precioPactado: 8,
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [
          {
            idColor: colorRojo.id,
            ...(pack === undefined ? {} : { pack }),
            tallas: [{ idTalla: tallaCH.id, cantidad }],
          },
        ],
      },
      bd(),
    );

  it('CON pack: el saldo se lleva por tendido — no se recibe de A lo que se envió de B', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);

    // 10 enviadas en total (5 + 5). Pedir 10 CON pack A cuadra en el agregado y NO en el pack.
    await expect(recibir(id, 'A', 10)).rejects.toThrow(ErrorConflicto);
    await expect(recibir(id, 'A', 10)).rejects.toThrow(/pack "A"/);

    // Los 5 de A sí caben, y el detalle guarda su pack.
    const recibo = await recibir(id, 'A', 5);
    expect(recibo.totalPiezas).toBe(5);
    expect(recibo.lineas).toHaveLength(1);
    expect(recibo.lineas[0]?.pack).toBe('A');

    // Y A queda cerrado: ni una más de ESE pack…
    await expect(recibir(id, 'A', 1, '2026-06-21')).rejects.toThrow(/pack "A"/);
    // …aunque B siga entero.
    const deB = await recibir(id, 'B', 5, '2026-06-21');
    expect(deB.lineas[0]?.pack).toBe('B');
  });

  it('SIN pack: consume del saldo AGREGADO de todos los packs (los devolvió revueltos)', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);

    // 10 sin pack = todo lo enviado, aunque NINGÚN pack tenga 10 por sí solo.
    const recibo = await recibir(id, undefined, 10);
    expect(recibo.totalPiezas).toBe(10);
    expect(recibo.lineas[0]?.pack).toBe('');

    // Y ya no queda nada: el agregado está en cero.
    await expect(recibir(id, undefined, 1, '2026-06-21')).rejects.toThrow(ErrorConflicto);
  });

  it('SIN pack tampoco puede pasarse del agregado', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);
    await expect(recibir(id, undefined, 11)).rejects.toThrow(/quedan 10 enviada/);
  });

  it('⭐ LAS DOS FORMAS JUNTAS no dejan recibir de más EN TOTAL (pack + pack, luego sin pack)', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);

    await recibir(id, 'A', 5, '2026-06-20');
    await recibir(id, 'B', 5, '2026-06-21');

    // Los dos tendidos están cerrados ⇒ un recibo SIN pack no puede colarse. Sin la condición
    // AGREGADA, este renglón no dispararía ninguna guarda (no declara pack) y pasarían 5 de más.
    await expect(recibir(id, undefined, 5, '2026-06-22')).rejects.toThrow(ErrorConflicto);
    await expect(recibir(id, undefined, 1, '2026-06-22')).rejects.toThrow(/quedan 0 enviada/);
  });

  it('⭐ …y al revés: lo devuelto SIN pack le baja el saldo a un recibo CON pack', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);

    // Devolvió las 10 revueltas. El saldo POR PACK de A sigue diciendo 5 (nadie le imputó nada),
    // pero el agregado está en 0 y es el que manda.
    await recibir(id, undefined, 10);
    await expect(recibir(id, 'A', 1, '2026-06-21')).rejects.toThrow(ErrorConflicto);
  });

  it('⭐ en UNA MISMA captura, los renglones de la misma celda se topan JUNTOS', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);

    // 5 de A + 5 de B + 1 sin pack = 11 sobre 10 enviadas. Cada renglón cabe por su lado; el
    // conjunto no. Topar renglón por renglón (como antes de §Post-F9.10, cuando una celda no podía
    // repetirse en una captura) habría dejado pasar las 11.
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden: id,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-20',
          precioPactado: 8,
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [
            { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
            { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
            { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);

    // Nada quedó a medias (A2): la orden sigue sin un solo recibo.
    expect(
      await cliente.etapaMovimiento.count({ where: { idOrden: id, tipo: 'recibo_maquila' } }),
    ).toBe(0);

    // Y la MISMA captura sin el renglón de sobra sí cabe entera, en los dos tendidos.
    const bueno = await registrarReciboMaquila(
      sesion(),
      {
        idOrden: id,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [
          { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
          { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
        ],
      },
      bd(),
    );
    expect(bueno.totalPiezas).toBe(10);
    // Dos renglones del MISMO color, uno por tendido: es justo lo que esta etapa vino a permitir.
    expect(bueno.lineas.map((l) => l.pack).sort()).toEqual(['A', 'B']);
    expect(new Set(bueno.lineas.map((l) => l.idColor)).size).toBe(1);
  });

  it('🔴 el INVENTARIO no maneja packs: los dos tendidos entran al kardex como UN solo renglón', async () => {
    // §Post-F9.10 — *«Arte · entrega a cliente · inventario PT: no aplica, ahí ya es sólo color»*.
    // Un recibo con pack A (5 CH) y pack B (5 CH) mete 10 CH al almacén, en UN movimiento con UN
    // renglón. Sin plegar el pack, el kardex habría recibido dos renglones de la MISMA llave
    // (mismo modelo/color/talla/orden): la existencia habría cuadrado igual —es Σ de movimientos
    // (D3)— pero el movimiento quedaría partido en dos y el lock del artículo tomado dos veces.
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);

    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden: id,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        precioPactado: 8,
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [
          { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
          { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
        ],
      },
      bd(),
    );
    expect(recibo.totalPiezas).toBe(10);

    const movimientos = await cliente.movimiento.findMany({
      where: { origenTipo: 'recibo-maquila', origenId: String(recibo.id) },
      include: { detallesPt: true },
    });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]?.detallesPt).toHaveLength(1);
    expect(movimientos[0]?.detallesPt[0]?.cantidad).toBe(10);

    // Y la existencia dice 10 en primeras, como cualquier recibo de 10.
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    const enPrimeras = existencias.filas.filter((f) => f.idAlmacen === almPrimeras.id);
    expect(enPrimeras.reduce((sum, f) => sum + f.existencia, 0)).toBe(10);
  });

  it('cancelar un recibo CON pack le devuelve su saldo a ESE tendido', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);
    const recibo = await recibir(id, 'A', 5);
    await expect(recibir(id, 'A', 1, '2026-06-21')).rejects.toThrow(ErrorConflicto);

    await cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'error de captura' }, bd());
    const otraVez = await recibir(id, 'A', 5, '2026-06-22');
    expect(otraVez.totalPiezas).toBe(5);
  });

  it('rechaza un pack que la orden no tiene, y dice cuáles sí', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);
    await expect(recibir(id, 'Z', 1)).rejects.toThrow(/"A", "B"/);
  });

  it('el desglose por recibir se parte por tendido, y el bucket sin pack sale NEGATIVO al revolverlos', async () => {
    const id = await crearOrdenConPacks();
    await cortarYEnviarLosDosPacks(id);
    await recibir(id, undefined, 4);

    const pend = await pendientesPorRecibir(sesion(), id, bd());
    const costura = pend.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    // Los dos tendidos siguen enteros (nadie les imputó nada) y lo devuelto revuelto vive en su
    // propio renglón, en negativo: así Σ celdas = totalPendiente y el desglose no contradice al total.
    const porPack = new Map(costura?.celdas.map((c) => [c.pack, c.cantidad]));
    expect(porPack.get('A')).toBe(5);
    expect(porPack.get('B')).toBe(5);
    expect(porPack.get('')).toBe(-4);
    // …y ese renglón se rotula con el color REAL, no con el respaldo defensivo «Color 7»: es una
    // fila que el operador va a ver.
    const sinPack = costura?.celdas.find((c) => c.pack === '');
    expect(sinPack?.color).toBe('Rojo');
    expect(sinPack?.etiquetaTalla).toBe('CH');
    expect(costura?.totalPendiente).toBe(6);
    expect((costura?.celdas ?? []).reduce((s, c) => s + c.cantidad, 0)).toBe(
      costura?.totalPendiente,
    );
  });

  it('🔴 una orden SIN packs se comporta EXACTAMENTE igual que antes: el pack sobra y se rechaza', async () => {
    await cortarBase();
    await enviar(procesoCostura, maquileroCostura, 10);

    // Mandar un pack a una orden que no los maneja es un error de captura, no un dato que se ignore.
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
            { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/no se fabrica por packs/);

    // Y sin pack, todo sigue igual: se recibe lo enviado y ni una pieza más.
    const recibo = await recibir(idOrden, undefined, 10);
    expect(recibo.totalPiezas).toBe(10);
    expect(recibo.lineas[0]?.pack).toBe('');
    await expect(recibir(idOrden, undefined, 1, '2026-06-21')).rejects.toThrow(ErrorConflicto);
  });
});
