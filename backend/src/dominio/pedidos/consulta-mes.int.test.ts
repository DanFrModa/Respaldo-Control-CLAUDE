/**
 * Tests de INTEGRACIÓN de la consulta PEDIDOS POR MES (rediseño R3, B6) contra el Postgres
 * efímero. Cubre: el agrupado pedido→renglones con No. orden/corte (agregados en servidor), el
 * filtro por MES/AÑO de entrega (`fechaHasta ?? fechaDe` vía SQL crudo), el filtro de estatus, la
 * barra de totales del filtro COMPLETO, el ocultamiento de importes sin `pedidos.importes` y el
 * caso A9 (idEmpresa ajeno → vacío).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { PrismaClient } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { pedidosPorMes } from './consulta-mes.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idClienteNegocio: number;
let idModelo: number;
let idColor: number;
let idTalla: number;

const sesion = (permisos: ClavePermiso[] = ['pedidos.ver', 'pedidos.importes']): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const empresa = await crearEmpresaPrueba(cliente);
  idEmpresa = empresa.id;
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  idClienteNegocio = clienteNegocio.id;
  const modelo = await cliente.modelo.create({ data: { codigo: 'M-100' } });
  idModelo = modelo.id;
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  idColor = color.id;
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  idTalla = talla.id;
});

/** Crea un pedido con un renglón; opcionalmente una OP viva del renglón con un corte registrado. */
async function sembrarPedido(opciones: {
  folio: number;
  fechaHasta?: string;
  ocCliente?: string;
  cantidad?: number;
  precio?: number;
  cancelado?: boolean;
  conOrden?: { folio: number; cortado?: number };
}): Promise<{ idPedido: number; idLinea: number; idOrden?: number }> {
  const cantidad = opciones.cantidad ?? 100;
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(opciones.folio),
      idEmpresa,
      idCliente: idClienteNegocio,
      ocCliente: opciones.ocCliente ?? null,
      fechaHasta:
        opciones.fechaHasta === undefined ? null : new Date(`${opciones.fechaHasta}T00:00:00.000Z`),
      pedCancelado: opciones.cancelado ?? false,
    },
  });
  const linea = await cliente.pedidoLinea.create({
    data: {
      idPedido: pedido.id,
      idModelo,
      cantidadPedida: cantidad,
      precio: opciones.precio ?? 148,
    },
  });
  let idOrden: number | undefined;
  if (opciones.conOrden !== undefined) {
    const orden = await cliente.orden.create({
      data: {
        folio: BigInt(opciones.conOrden.folio),
        idEmpresa,
        idPedidoLinea: linea.id,
        idModelo,
        idCliente: idClienteNegocio,
        estado: 'completa',
      },
    });
    idOrden = orden.id;
    if (opciones.conOrden.cortado !== undefined && opciones.conOrden.cortado > 0) {
      await cliente.etapaMovimiento.create({
        data: {
          folio: BigInt(opciones.conOrden.folio),
          idEmpresa,
          idOrden: orden.id,
          tipo: 'corte',
          fecha: new Date('2026-07-01T00:00:00.000Z'),
          detalles: {
            create: [{ idColor, idTalla, cantidad: opciones.conOrden.cortado }],
          },
        },
      });
    }
  }
  return { idPedido: pedido.id, idLinea: linea.id, ...(idOrden === undefined ? {} : { idOrden }) };
}

describe('pedidosPorMes (R3, B6)', () => {
  it('agrupa pedido→renglones con No. orden, corte y totales del filtro', async () => {
    const conOrden = await sembrarPedido({
      folio: 10,
      fechaHasta: '2026-08-15',
      ocCliente: 'OC-CA-4471',
      cantidad: 100,
      precio: 148,
      conOrden: { folio: 5001, cortado: 40 },
    });
    await sembrarPedido({ folio: 11, fechaHasta: '2026-08-20', cantidad: 50, precio: 100 });

    const salida = await pedidosPorMes(sesion(), { anio: 2026, mes: 8 }, bd());

    expect(salida.total).toBe(2);
    expect(salida.datos).toHaveLength(2);
    // Orden folio desc: el pedido 11 va primero.
    const fila = salida.datos.find((p) => p.id === conOrden.idPedido);
    expect(fila?.ocCliente).toBe('OC-CA-4471');
    expect(fila?.cantidadTotal).toBe(100);
    expect(fila?.cortadoTotal).toBe(40);
    expect(fila?.importeTotal).toBe(14800);
    expect(fila?.renglones[0]?.folioOrden).toBe(5001);
    expect(fila?.renglones[0]?.numOrdenes).toBe(1);
    expect(fila?.renglones[0]?.cortado).toBe(40);

    // Totales del filtro COMPLETO.
    expect(salida.totales).toEqual({
      pedidos: 2,
      ordenes: 1,
      piezas: 150,
      cortado: 40,
      avancePct: 27, // 40/150 redondeado
      importe: 14800 + 5000,
    });
  });

  it('filtra por MES de entrega (fechaHasta ?? fechaDe); sin ventana cae al mes de su captura', async () => {
    await sembrarPedido({ folio: 20, fechaHasta: '2026-08-15' });
    await sembrarPedido({ folio: 21, fechaHasta: '2026-09-10' });
    const sinVentana = await sembrarPedido({ folio: 22 }); // sin ventana de entrega

    const agosto = await pedidosPorMes(sesion(), { anio: 2026, mes: 8 }, bd());
    expect(agosto.datos.map((p) => p.folio)).toEqual([20]);

    const todos = await pedidosPorMes(sesion(), {}, bd());
    expect(todos.total).toBe(3);

    // Sin ventana de entrega: el pedido cae al mes/año de su CAPTURA (creadoEn = hoy) — bajo el
    // filtro de año en curso sigue alcanzable (ningún pedido queda huérfano de las tabs).
    const hoy = new Date();
    const anioActual = await pedidosPorMes(
      sesion(),
      { anio: hoy.getUTCFullYear(), mes: hoy.getUTCMonth() + 1 },
      bd(),
    );
    expect(anioActual.datos.some((p) => p.id === sinVentana.idPedido)).toBe(true);
  });

  it('estatus: vigentes excluye cancelados; cancelados solo los cancelados', async () => {
    await sembrarPedido({ folio: 30, fechaHasta: '2026-08-01' });
    await sembrarPedido({ folio: 31, fechaHasta: '2026-08-02', cancelado: true });

    const vigentes = await pedidosPorMes(sesion(), { estatus: 'vigentes' }, bd());
    expect(vigentes.datos.map((p) => p.folio)).toEqual([30]);
    expect(vigentes.datos[0]?.estatus).toBe('vigente');

    const cancelados = await pedidosPorMes(sesion(), { estatus: 'cancelados' }, bd());
    expect(cancelados.datos.map((p) => p.folio)).toEqual([31]);
    expect(cancelados.datos[0]?.estatus).toBe('cancelado');
  });

  it('las órdenes CANCELADAS no cuentan (ni como No. orden ni en cortado)', async () => {
    const { idOrden } = await sembrarPedido({
      folio: 40,
      fechaHasta: '2026-08-01',
      conOrden: { folio: 6001, cortado: 25 },
    });
    await cliente.orden.update({
      where: { id: idOrden ?? 0 },
      data: { estado: 'cancelada', motivoCancelada: 'prueba' },
    });

    const salida = await pedidosPorMes(sesion(), {}, bd());
    expect(salida.datos[0]?.renglones[0]?.idOrden).toBeNull();
    expect(salida.datos[0]?.renglones[0]?.numOrdenes).toBe(0);
    expect(salida.totales.ordenes).toBe(0);
  });

  it('sin `pedidos.importes` los importes van en null (también en los totales)', async () => {
    await sembrarPedido({ folio: 50, fechaHasta: '2026-08-01' });

    const salida = await pedidosPorMes(sesion(['pedidos.ver']), {}, bd());
    expect(salida.datos[0]?.importeTotal).toBeNull();
    expect(salida.datos[0]?.renglones[0]?.precio).toBeNull();
    expect(salida.datos[0]?.renglones[0]?.importe).toBeNull();
    expect(salida.totales.importe).toBeNull();
  });

  it('A9: un idEmpresa distinto de la empresa activa devuelve vacío', async () => {
    await sembrarPedido({ folio: 60, fechaHasta: '2026-08-01' });
    const salida = await pedidosPorMes(sesion(), { idEmpresa: idEmpresa + 999 }, bd());
    expect(salida.total).toBe(0);
    expect(salida.datos).toHaveLength(0);
  });
});
