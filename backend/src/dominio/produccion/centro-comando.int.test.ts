import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Cliente,
  Color,
  Empresa,
  Modelo,
  Orden,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
  TipoProceso,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { centroComandoOrdenes } from './centro-comando.js';

/**
 * Integración del CENTRO DE COMANDO (rediseño R2, §4.2) contra el Postgres efímero (CI). Cubre lo
 * que SOLO la base valida: las etapas CANCELADAS no cuentan en Σ cortada ni en maquileros; la OC
 * de tela en BORRADOR/CANCELADA no marca "comprada" (y una de avío tampoco); el filtro por mes de
 * entrega usa EXTRACT(MONTH) sobre cualquier año; el filtro por maquilero alcanza al ASIGNADO y al
 * ENVIADO; la búsqueda encuentra por referencia del cliente (D7); y A9 (otra empresa no existe).
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tela: Tela;
let costura: TipoProceso;
let estampado: TipoProceso;
let maquileroA: Proveedor;
let maquileroB: Proveedor;
let estampador: Proveedor;
let proveedorOc: Proveedor;

function sesion(idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos: ['ordenes.ver'] });
}

const bd = () => ({ cliente });

let folioEtapa = 0;

/** Crea una orden con matriz (Rojo×CH = cantidad) y devuelve la orden. */
async function crearOrdenConMatriz(
  folio: number,
  cantidad: number,
  opciones: { fechaEntrega?: Date; idEmpresa?: number; referencia?: string } = {},
): Promise<Orden> {
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: opciones.idEmpresa ?? empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      fechaEntrega: opciones.fechaEntrega ?? null,
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad }] } },
        ],
      },
    },
  });
  if (opciones.referencia !== undefined) {
    const campo = await cliente.clienteCampo.create({
      data: { idCliente: clienteNegocio.id, etiqueta: `Ref ${folio}` },
    });
    await cliente.ordenReferencia.create({
      data: { idOrden: orden.id, idClienteCampo: campo.id, valor: opciones.referencia },
    });
  }
  return orden;
}

/** Crea una etapa (corte o envío) con un solo renglón Rojo×CH. */
async function crearEtapa(
  idOrden: number,
  tipo: 'corte' | 'envio_maquila',
  cantidad: number,
  opciones: { idTercero?: number; idTipoProceso?: number; cancelada?: boolean } = {},
): Promise<void> {
  folioEtapa += 1;
  await cliente.etapaMovimiento.create({
    data: {
      folio: BigInt(folioEtapa),
      idEmpresa: empresa.id,
      idOrden,
      tipo,
      idTipoProceso: opciones.idTipoProceso ?? null,
      idTercero: opciones.idTercero ?? null,
      fecha: new Date('2026-07-01T00:00:00Z'),
      canceladoEn: opciones.cancelada === true ? new Date() : null,
      detalles: { create: [{ idColor: colorRojo.id, idTalla: tallaCH.id, cantidad }] },
    },
  });
}

/** Crea una OC con UNA línea (tela o avío) ligada a la orden. */
async function crearOcTela(
  idOrden: number,
  numCompra: number,
  estatus: 'borrador' | 'autorizada' | 'cancelada',
  material: 'tela' | 'libre' = 'tela',
): Promise<void> {
  await cliente.ordenCompra.create({
    data: {
      numCompra: BigInt(numCompra),
      idEmpresa: empresa.id,
      idProveedor: proveedorOc.id,
      estatus,
      lineas: {
        create: [
          {
            idOrden,
            cantidad: 100,
            precio: 50,
            ...(material === 'tela' ? { idTela: tela.id } : { descripcionLibre: 'Servicio' }),
          },
        ],
      },
    },
  });
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  folioEtapa = 0;
  empresa = await crearEmpresaPrueba(cliente);
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa de Prueba');
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  modelo = await cliente.modelo.create({ data: { codigo: '62182', descripcion: 'Sudadera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tela = await cliente.tela.create({ data: { nombre: 'Felpa' } });
  costura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  estampado = await cliente.tipoProceso.create({
    data: { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  });
  maquileroA = await cliente.proveedor.create({ data: { nombre: 'Óscar Jiménez' } });
  maquileroB = await cliente.proveedor.create({ data: { nombre: 'Rima Textil' } });
  estampador = await cliente.proveedor.create({ data: { nombre: 'Estampados Rico' } });
  proveedorOc = await cliente.proveedor.create({ data: { nombre: 'Telas del Norte' } });
});

describe('centro de comando — agregados contra datos reales', () => {
  it('Σ cortada EXCLUYE cortes cancelados; maquileros distintos y estampador salen de envíos VIVOS', async () => {
    const orden = await crearOrdenConMatriz(5424, 1726, { referencia: '613609' });
    await crearEtapa(orden.id, 'corte', 1000);
    await crearEtapa(orden.id, 'corte', 726);
    await crearEtapa(orden.id, 'corte', 500, { cancelada: true }); // NO cuenta
    await crearEtapa(orden.id, 'envio_maquila', 800, {
      idTercero: maquileroA.id,
      idTipoProceso: costura.id,
    });
    await crearEtapa(orden.id, 'envio_maquila', 400, {
      idTercero: maquileroB.id,
      idTipoProceso: costura.id,
    });
    await crearEtapa(orden.id, 'envio_maquila', 300, {
      idTercero: estampador.id,
      idTipoProceso: estampado.id,
    });
    // Envío cancelado a un tercero distinto: no cuenta ni para el badge.
    await crearEtapa(orden.id, 'envio_maquila', 100, {
      idTercero: proveedorOc.id,
      idTipoProceso: costura.id,
      cancelada: true,
    });

    const pagina = await centroComandoOrdenes(sesion(), {}, bd());
    expect(pagina.total).toBe(1);
    const fila = pagina.datos[0];
    if (fila === undefined) throw new Error('fila esperada');
    expect(fila.cantOrdenada).toBe(1726);
    expect(fila.cantCortada).toBe(1726); // 1000 + 726 (el cancelado fuera)
    expect(fila.maquilero).toBe('Óscar Jiménez'); // primer envío costura vivo
    expect(fila.numMaquileros).toBe(2); // A y B (el cancelado fuera)
    expect(fila.estampador).toBe('Estampados Rico');
    expect(fila.pedidoCliente).toBe('613609');
  });

  it('OC de tela: la AUTORIZADA marca comprada; borrador/cancelada/avío NO cuentan', async () => {
    const conOc = await crearOrdenConMatriz(1, 100);
    const sinOc = await crearOrdenConMatriz(2, 100);
    const soloBorrador = await crearOrdenConMatriz(3, 100);
    await crearOcTela(conOc.id, 7654, 'autorizada');
    await crearOcTela(soloBorrador.id, 7700, 'borrador');
    await crearOcTela(soloBorrador.id, 7701, 'cancelada');
    await crearOcTela(sinOc.id, 7702, 'autorizada', 'libre'); // línea sin tela: no marca

    const pagina = await centroComandoOrdenes(
      sesion(),
      { ordenarPor: 'folio', direccion: 'asc' },
      bd(),
    );
    const [f1, f2, f3] = pagina.datos;
    expect(f1?.ocTelaFolio).toBe(7654);
    expect(f2?.ocTelaFolio).toBeNull();
    expect(f3?.ocTelaFolio).toBeNull();

    // Filtro con/sin OC de tela.
    const con = await centroComandoOrdenes(sesion(), { ocTela: 'con' }, bd());
    expect(con.datos.map((f) => f.folio)).toEqual([1]);
    const sin = await centroComandoOrdenes(sesion(), { ocTela: 'sin' }, bd());
    expect(sin.datos.map((f) => f.folio).sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it('filtro por MES de entrega (EXTRACT, cualquier año) y mesEntrega derivado', async () => {
    await crearOrdenConMatriz(1, 10, { fechaEntrega: new Date('2026-07-04T00:00:00Z') });
    await crearOrdenConMatriz(2, 10, { fechaEntrega: new Date('2025-07-20T00:00:00Z') });
    await crearOrdenConMatriz(3, 10, { fechaEntrega: new Date('2026-10-01T00:00:00Z') });
    await crearOrdenConMatriz(4, 10); // sin fecha de entrega

    const julio = await centroComandoOrdenes(sesion(), { mesEntrega: 7 }, bd());
    expect(julio.datos.map((f) => f.folio).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(julio.datos[0]?.mesEntrega).toBe(7);

    const abril = await centroComandoOrdenes(sesion(), { mesEntrega: 4 }, bd());
    expect(abril.total).toBe(0);
  });

  it('filtro por maquilero alcanza al ASIGNADO del encabezado Y al de envíos vivos', async () => {
    const asignada = await crearOrdenConMatriz(1, 10);
    await cliente.orden.update({
      where: { id: asignada.id },
      data: { idMaquilero: maquileroA.id },
    });
    const enviada = await crearOrdenConMatriz(2, 10);
    await crearEtapa(enviada.id, 'corte', 10);
    await crearEtapa(enviada.id, 'envio_maquila', 10, {
      idTercero: maquileroA.id,
      idTipoProceso: costura.id,
    });
    await crearOrdenConMatriz(3, 10); // ni asignada ni enviada

    const pagina = await centroComandoOrdenes(sesion(), { idMaquilero: maquileroA.id }, bd());
    expect(pagina.datos.map((f) => f.folio).sort((a, b) => a - b)).toEqual([1, 2]);

    const porEstampador = await centroComandoOrdenes(
      sesion(),
      { idEstampador: maquileroA.id },
      bd(),
    );
    expect(porEstampador.total).toBe(0); // costura NO cuenta como aplicación
  });

  it('búsqueda por folio OP, modelo y referencia del cliente (D7); canceladas fuera por default', async () => {
    await crearOrdenConMatriz(5424, 10, { referencia: '613609' });
    const cancelada = await crearOrdenConMatriz(5425, 10);
    await cliente.orden.update({ where: { id: cancelada.id }, data: { estado: 'cancelada' } });

    const porFolio = await centroComandoOrdenes(sesion(), { busqueda: '5424' }, bd());
    expect(porFolio.total).toBe(1);
    const porModelo = await centroComandoOrdenes(sesion(), { busqueda: '62182' }, bd());
    expect(porModelo.total).toBe(1); // la cancelada queda fuera
    const porReferencia = await centroComandoOrdenes(sesion(), { busqueda: '613609' }, bd());
    expect(porReferencia.total).toBe(1);
    expect(porReferencia.datos[0]?.folio).toBe(5424);

    const conCanceladas = await centroComandoOrdenes(sesion(), { incluirCanceladas: true }, bd());
    expect(conCanceladas.total).toBe(2);
  });

  it('A9: las órdenes de OTRA empresa no existen para la sesión', async () => {
    await crearOrdenConMatriz(1, 10);
    await crearOrdenConMatriz(2, 10, { idEmpresa: otraEmpresa.id });

    const pagina = await centroComandoOrdenes(sesion(), {}, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]?.folio).toBe(1);

    const vacia = await centroComandoOrdenes(sesion(), { idEmpresa: otraEmpresa.id }, bd());
    expect(vacia.total).toBe(0);
  });

  it('pedido interno -F: folio e id del pedido salen del renglón de origen', async () => {
    const pedido = await cliente.pedido.create({
      data: { folio: 1485n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
    });
    const linea = await cliente.pedidoLinea.create({
      data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 100, precio: 50 },
    });
    const orden = await crearOrdenConMatriz(1, 10);
    await cliente.orden.update({ where: { id: orden.id }, data: { idPedidoLinea: linea.id } });

    const pagina = await centroComandoOrdenes(sesion(), {}, bd());
    expect(pagina.datos[0]?.folioPedido).toBe(1485);
    expect(pagina.datos[0]?.idPedido).toBe(pedido.id);
  });
});
