/**
 * Tests de integración de la ENTREGA a cliente (F3-E5, cierre del ciclo). Postgres efímero
 * (testcontainers). Cubre lo que la ficha exige:
 *  (a) entregar BAJA la existencia PT (salida de kardex);
 *  (b) entregar > existencia → RECHAZADO (no-negativo estricto, decisión b);
 *  (c) DOS entregas CONCURRENTES del mismo artículo NO dejan negativo (suma directa bajo lock);
 *  (d) cancelar entrega = inverso que NEUTRALIZA el saldo y DEVUELVE el pendiente del pedido (derivado);
 *  (e) costoUnit NULL en F3;
 *  (f) folios A3 consecutivos.
 * Y de paso: seguimiento del pedido derivado (pedido/entregado/faltante) e historial.
 *
 * Las funciones de DOMINIO se llaman DIRECTO (no por HTTP) — no depende del registro de rutas. La
 * existencia inicial de PT se siembra con un recibo de costura (la vía real de entrada a PT en F3).
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
  cancelarEntregaCliente,
  listarEntregasOrden,
  registrarEntregaCliente,
  seguimientoEntregaOrden,
} from './entregas-cliente.js';
import { registrarCorte, registrarEnvioMaquila } from './etapas.js';
import { registrarReciboMaquila } from './recibos.js';
import { consultarExistenciasPt } from '../inventarios/movimientos-pt.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor;
let maquileroCostura: Proveedor;
let procesoCostura: TipoProceso;
let almacen: Almacen;
let idOrden: number;
let clienteNegocioId: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.entrega',
  'produccion.cancelar',
  'produccion.wip-ver',
  'inventario-pt.ver',
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

/** Crea una orden con matriz: Rojo (CH 10, M 20). Devuelve su id. `folio` distingue varias órdenes. */
async function crearOrdenConMatriz(folio = 1n): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 30, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio,
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

/** Crea los tipos de movimiento que usan el recibo (entrada) y la entrega (salida + inversos). */
async function sembrarTiposMovimiento(): Promise<void> {
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
      { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
      { codigo: 'error-salida', nombre: 'Error de Salida', direccion: 'entrada' },
    ],
  });
}

/**
 * Mete `cantidadCH` piezas de Rojo/CH al inventario PT (el `almacen`) por la vía real: corte →
 * envío costura → recibo de costura. Deja la existencia en `almacen` lista para entregar.
 */
async function meterAInventario(cantidadCH: number): Promise<void> {
  await registrarCorte(
    sesion(),
    {
      idOrden,
      idCortador: cortador.id,
      fecha: '2026-06-18',
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: cantidadCH }] }],
    },
    bd(),
  );
  await registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquileroCostura.id,
      fecha: '2026-06-19',
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: cantidadCH }] }],
    },
    bd(),
  );
  await registrarReciboMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquileroCostura.id,
      fecha: '2026-06-20',
      idAlmacenPrimeras: almacen.id,
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
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  almacen = await cliente.almacen.create({ data: { nombre: 'PT Central', tipo: 'PT' } });
  await sembrarTiposMovimiento();
  idOrden = await crearOrdenConMatriz();
});

/** Atajo: entrega `cantidad` piezas de Rojo/CH del almacén. */
async function entregar(cantidad: number) {
  return registrarEntregaCliente(
    sesion(),
    {
      idOrden,
      idAlmacen: almacen.id,
      fecha: '2026-06-21',
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad }] }],
    },
    bd(),
  );
}

describe('Entrega a cliente — salida de PT (F3-E5)', () => {
  it('(a) entregar BAJA la existencia PT y deriva totales', async () => {
    await meterAInventario(10);
    const antes = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(antes.totalExistencia).toBe(10);

    const entrega = await entregar(6);
    expect(entrega.folio).toBeGreaterThan(0);
    expect(entrega.totalPiezas).toBe(6);
    expect(entrega.idMovimientoSalida).not.toBeNull();
    expect(entrega.cliente).toBe('Liverpool');
    expect(entrega.modelo).toBe('A-100');
    expect(entrega.idAlmacen).toBe(almacen.id);

    const despues = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(despues.totalExistencia).toBe(4);
  });

  it('(b) RECHAZA entregar más de la existencia (no-negativo estricto)', async () => {
    await meterAInventario(10);
    await expect(entregar(11)).rejects.toBeInstanceOf(ErrorConflicto);

    // No quedó ni entrega ni movimiento de salida: la existencia sigue intacta.
    const entregas = await cliente.etapaMovimiento.count({
      where: { idOrden, tipo: 'entrega_cliente' },
    });
    expect(entregas).toBe(0);
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(10);
  });

  it('(c) dos entregas CONCURRENTES del mismo artículo NO dejan negativo', async () => {
    await meterAInventario(10);
    // Dos entregas de 6 (12 > 10): a lo sumo UNA pasa.
    const resultados = await Promise.allSettled([entregar(6), entregar(6)]);
    const exitosos = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(exitosos).toBe(1);

    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBeGreaterThanOrEqual(0);
    expect(existencias.totalExistencia).toBe(4);
  });

  it('(e) costoUnit queda NULL en la salida de la entrega (F3)', async () => {
    await meterAInventario(10);
    const entrega = await entregar(5);
    const detalles = await cliente.movimientoDetPt.findMany({
      where: { movimiento: { origenTipo: 'entrega-cliente', origenId: String(entrega.id) } },
      select: { costoUnit: true, cantidad: true },
    });
    expect(detalles.length).toBeGreaterThan(0);
    for (const d of detalles) {
      expect(d.costoUnit).toBeNull();
    }
  });

  it('(f) folios A3 consecutivos por empresa', async () => {
    await meterAInventario(10);
    const e1 = await entregar(3);
    const e2 = await entregar(2);
    expect(e2.folio).toBe(e1.folio + 1);
  });

  it('(g) PT por orden: la entrega valida contra la ORDEN, no contra el total del modelo', async () => {
    // 10 piezas de Rojo/CH entran a PT en el bucket de `idOrden` (vía su recibo de costura).
    await meterAInventario(10);

    // Una SEGUNDA orden del MISMO modelo, sin stock propio en PT.
    const idOrden2 = await crearOrdenConMatriz(2n);

    // Entregar desde la 2ª orden DEBE fallar: su bucket de existencia está en 0, aunque el modelo
    // tenga 10 en el almacén (pertenecen a la 1ª orden). Esto es el objetivo de "PT por orden".
    await expect(
      registrarEntregaCliente(
        sesion(),
        {
          idOrden: idOrden2,
          idAlmacen: almacen.id,
          fecha: '2026-06-21',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // El stock de la 1ª orden sigue intacto y la existencia trae la orden + su folio desglosados.
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(10);
    const fila = existencias.filas.find((f) => f.idTalla === tallaCH.id);
    expect(fila?.idOrden).toBe(idOrden);
    expect(fila?.folioOrden).toBe(1);

    // Filtrar la consulta por la 2ª orden devuelve 0 filas (no tiene existencia).
    const dosVacia = await consultarExistenciasPt(
      sesion(),
      { idModelo: modelo.id, idOrden: idOrden2 },
      bd(),
    );
    expect(dosVacia.totalExistencia).toBe(0);
  });
});

describe('Cancelación de entregas (F3-E5)', () => {
  it('(d) cancelar entrega = inverso que devuelve la existencia y el pendiente del pedido', async () => {
    await meterAInventario(10);
    const entrega = await entregar(10);

    const tras = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(tras.totalExistencia).toBe(0);

    const cancelada = await cancelarEntregaCliente(
      sesion(),
      entrega.id,
      { motivo: 'el cliente devolvió la mercancía' },
      bd(),
    );
    expect(cancelada.cancelado).toBe(true);

    // La existencia vuelve a 10 (el inverso re-entra lo que salió; ambos movimientos quedan, D3).
    const despues = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(despues.totalExistencia).toBe(10);

    // El seguimiento del pedido: entregado vuelve a 0, faltante regresa (derivado).
    const seg = await seguimientoEntregaOrden(sesion(), idOrden, {}, bd());
    expect(seg.totalEntregado).toBe(0);
    const celdaCH = seg.celdas.find((c) => c.idTalla === tallaCH.id);
    expect(celdaCH?.entregado).toBe(0);
    expect(celdaCH?.faltante).toBe(10);
  });

  it('no se puede cancelar dos veces la misma entrega', async () => {
    await meterAInventario(10);
    const entrega = await entregar(5);
    await cancelarEntregaCliente(sesion(), entrega.id, { motivo: 'error de captura' }, bd());
    await expect(
      cancelarEntregaCliente(sesion(), entrega.id, { motivo: 'reintento' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Seguimiento del pedido derivado e historial (F3-E5)', () => {
  it('seguimiento: pedido − entregado por celda, con disponible del almacén', async () => {
    await meterAInventario(10);
    await entregar(4);

    const seg = await seguimientoEntregaOrden(sesion(), idOrden, { idAlmacen: almacen.id }, bd());
    expect(seg.totalPedido).toBe(30); // CH 10 + M 20
    expect(seg.totalEntregado).toBe(4);
    expect(seg.totalFaltante).toBe(26);

    const celdaCH = seg.celdas.find((c) => c.idTalla === tallaCH.id);
    expect(celdaCH?.pedido).toBe(10);
    expect(celdaCH?.entregado).toBe(4);
    expect(celdaCH?.faltante).toBe(6);
    expect(celdaCH?.disponible).toBe(6); // 10 metidos − 4 entregados

    // La talla M nunca se metió ni se entregó: disponible 0, faltante = pedido.
    const celdaM = seg.celdas.find((c) => c.idTalla === tallaM.id);
    expect(celdaM?.entregado).toBe(0);
    expect(celdaM?.faltante).toBe(20);
    expect(celdaM?.disponible).toBe(0);
  });

  it('historial: lista entregas vivas y canceladas, marcadas', async () => {
    await meterAInventario(10);
    const viva = await entregar(3);
    const aCancelar = await entregar(2);
    await cancelarEntregaCliente(sesion(), aCancelar.id, { motivo: 'duplicada' }, bd());

    const historial = await listarEntregasOrden(sesion(), idOrden, bd());
    expect(historial.entregas).toHaveLength(2);
    const vivaEnLista = historial.entregas.find((e) => e.id === viva.id);
    const canceladaEnLista = historial.entregas.find((e) => e.id === aCancelar.id);
    expect(vivaEnLista?.cancelado).toBe(false);
    expect(canceladaEnLista?.cancelado).toBe(true);
    expect(canceladaEnLista?.motivoCancelacion).toBe('duplicada');
  });
});
