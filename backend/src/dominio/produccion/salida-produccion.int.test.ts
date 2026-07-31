/**
 * Tests de INTEGRACIÓN de la SALIDA A PRODUCCIÓN (rediseño R3, B4) contra el Postgres efímero
 * (testcontainers). Cubre lo que pidió la ficha:
 *  • MINTEO del nº interno de producción la 1ª vez + REUSO en la 2ª (secuencia A3),
 *  • SNAPSHOT `Pedido.ocCliente` → `Orden.ocCliente` (B3: editar el pedido después NO re-escribe),
 *  • LIGA `DesarrolloOrden` (núcleo de F8-E6) — y OP sin liga cuando el renglón no tiene desarrollo,
 *  • EVENTO outbox `orden-creada` encolado en la MISMA tx (B5),
 *  • modo MIGRACIÓN (`crearOrdenMigrada`) NO encola ni mintea,
 *  • TRANSACCIONALIDAD (A2): matriz inválida → rollback total (ni orden, ni liga, ni minteo, ni evento),
 *  • referencias del cliente (D7) capturadas en la misma operación.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearOrdenMigrada } from './migracion.js';
import { salidaAProduccion } from './salida-produccion.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idClienteNegocio: number;
let idColor: number;
let idTalla: number;

const PERMISOS: ClavePermiso[] = [
  'ordenes.ver',
  'ordenes.administrar',
  'pedidos.ver',
  'pedidos.administrar',
  'pedidos.importes',
];

const sesion = (): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...PERMISOS] });
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
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  idColor = color.id;
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  idTalla = talla.id;
});

/** Crea modelo + desarrollo (proyecto/departamento del cliente) y un pedido con un renglón. */
async function sembrarPedidoConDesarrollo(opciones: {
  codigoModelo: string;
  ocCliente?: string | null;
  conDesarrollo?: boolean;
}): Promise<{ idModelo: number; idDesarrollo: number | null; idPedido: number; idLinea: number }> {
  // El modelo nace CUMPLIENDO los requisitos del estado automático de la orden
  // (`requisitos-orden.ts`): receta de avíos de producción y `llevaArte: false` (prenda lisa), para
  // que la OP que salga a producción con su matriz nazca `completa` como espera esta prueba.
  const modelo = await cliente.modelo.create({
    data: { codigo: opciones.codigoModelo, descripcion: 'Playera', llevaArte: false },
  });
  const avio = await cliente.avio.create({
    data: { clave: `AV-${opciones.codigoModelo}`, descripcion: 'Hilo' },
  });
  await cliente.modeloAvio.create({
    data: { idModelo: modelo.id, idAvio: avio.id, consumoPorPrenda: 1, paraProduccion: true },
  });
  let idDesarrollo: number | null = null;
  if (opciones.conDesarrollo !== false) {
    const depto = await cliente.clienteDepartamento.create({
      data: { idCliente: idClienteNegocio, nombre: `Niños ${opciones.codigoModelo}` },
    });
    const proyecto = await cliente.proyecto.create({
      data: {
        folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
        idEmpresa,
        idCliente: idClienteNegocio,
        idClienteDepartamento: depto.id,
        nombre: 'Joggers PV26',
      },
    });
    const desarrollo = await cliente.desarrollo.create({
      data: { idProyecto: proyecto.id, idModelo: modelo.id, numeroCliente: 'CA-KM-114' },
    });
    idDesarrollo = desarrollo.id;
  }
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idCliente: idClienteNegocio,
      ocCliente: opciones.ocCliente ?? null,
      fechaHasta: new Date('2026-08-15T00:00:00.000Z'),
    },
  });
  const linea = await cliente.pedidoLinea.create({
    data: {
      idPedido: pedido.id,
      idModelo: modelo.id,
      cantidadPedida: 100,
      precio: 148,
      idDesarrollo,
    },
  });
  return { idModelo: modelo.id, idDesarrollo, idPedido: pedido.id, idLinea: linea.id };
}

/** Matriz mínima válida (Rojo/CH con `cantidad`). */
const matriz = (cantidad = 100) => [{ idColor, tallas: [{ idTalla, cantidad }] }];

describe('salidaAProduccion (R3, B4)', () => {
  it('crea la OP con matriz, snapshot de la OC, liga al desarrollo, mintea el nº y encola el evento', async () => {
    const { idModelo, idDesarrollo, idLinea } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'DEV-114',
      ocCliente: 'OC-CA-4471',
    });

    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    // La orden nació con su matriz y el SNAPSHOT de la OC del cliente (B3).
    expect(resultado.orden.idPedidoLinea).toBe(idLinea);
    expect(resultado.orden.totalPiezas).toBe(100);
    expect(resultado.orden.estado).toBe('completa');
    expect(resultado.orden.ocCliente).toBe('OC-CA-4471');
    // La OP hereda la ventana de entrega del pedido (fechaHasta).
    expect(resultado.orden.fechaEntrega).toBe('2026-08-15');

    // Liga al desarrollo (núcleo F8-E6).
    expect(resultado.ligaCreada).toBe(true);
    expect(resultado.idDesarrollo).toBe(idDesarrollo);
    const liga = await cliente.desarrolloOrden.findUnique({
      where: { idOrden: resultado.orden.id },
    });
    expect(liga?.idDesarrollo).toBe(idDesarrollo);

    // Nº interno de producción MINTEADO (1ª salida del modelo).
    expect(resultado.numeroProduccionMinteado).toBe(true);
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.numeroProduccion).toBe(resultado.numeroProduccion);

    // Evento outbox `orden-creada` en la MISMA tx (B5).
    const eventos = await cliente.eventoOutbox.findMany({ where: { tipo: 'orden-creada' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.payload).toMatchObject({ idOrden: resultado.orden.id, idEmpresa });
  });

  it('la 2ª salida del MISMO renglón (resurtido) reusa el nº de producción y liga la 2ª OP al mismo desarrollo', async () => {
    const { idLinea, idDesarrollo } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-115' });

    const primera = await salidaAProduccion(sesion(), idLinea, { lineas: matriz(60) }, bd());
    const segunda = await salidaAProduccion(sesion(), idLinea, { lineas: matriz(40) }, bd());

    expect(primera.numeroProduccionMinteado).toBe(true);
    expect(segunda.numeroProduccionMinteado).toBe(false);
    expect(segunda.numeroProduccion).toBe(primera.numeroProduccion);
    // Un desarrollo tiene N órdenes (resurtidos): ambas OPs quedan ligadas al MISMO desarrollo.
    expect(segunda.ligaCreada).toBe(true);
    expect(
      await cliente.desarrolloOrden.count({ where: { idDesarrollo: idDesarrollo ?? 0 } }),
    ).toBe(2);
  });

  it('editar la OC del pedido DESPUÉS no re-escribe el snapshot de la orden (B3)', async () => {
    const { idLinea, idPedido } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'DEV-116',
      ocCliente: 'OC-ORIGINAL',
    });
    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    await cliente.pedido.update({ where: { id: idPedido }, data: { ocCliente: 'OC-CAMBIADA' } });

    const orden = await cliente.orden.findUnique({ where: { id: resultado.orden.id } });
    expect(orden?.ocCliente).toBe('OC-ORIGINAL');
  });

  it('renglón SIN desarrollo (caso legado): la OP nace sin liga pero SÍ mintea el nº', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'LEG-001',
      conDesarrollo: false,
    });

    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    expect(resultado.ligaCreada).toBe(false);
    expect(resultado.idDesarrollo).toBeNull();
    expect(resultado.numeroProduccionMinteado).toBe(true);
    expect(await cliente.desarrolloOrden.count()).toBe(0);
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.numeroProduccion).toBe(resultado.numeroProduccion);
  });

  it('captura las referencias del cliente (D7) en la misma operación', async () => {
    const { idLinea } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-117' });
    const campo = await cliente.clienteCampo.create({
      data: { idCliente: idClienteNegocio, etiqueta: 'Ref. Monarch' },
    });

    const resultado = await salidaAProduccion(
      sesion(),
      idLinea,
      { lineas: matriz(), referencias: [{ idClienteCampo: campo.id, valor: 'MNCH-7' }] },
      bd(),
    );

    expect(resultado.orden.referencias).toHaveLength(1);
    expect(resultado.orden.referencias[0]?.valor).toBe('MNCH-7');
  });

  it('A2: matriz inválida (color repetido) → rollback TOTAL (ni orden, ni liga, ni minteo, ni evento)', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-118' });

    await expect(
      salidaAProduccion(
        sesion(),
        idLinea,
        {
          lineas: [
            { idColor, tallas: [{ idTalla, cantidad: 50 }] },
            { idColor, tallas: [{ idTalla, cantidad: 50 }] },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(await cliente.orden.count()).toBe(0);
    expect(await cliente.desarrolloOrden.count()).toBe(0);
    expect(await cliente.eventoOutbox.count({ where: { tipo: 'orden-creada' } })).toBe(0);
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.numeroProduccion).toBeNull();
  });

  it('matriz sin piezas (todo 0) → ErrorValidacion', async () => {
    const { idLinea } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-119' });
    await expect(
      salidaAProduccion(sesion(), idLinea, { lineas: matriz(0) }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('modo migración (crearOrdenMigrada) NO encola el evento ni mintea números (B5)', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'HIS-001' } });
    await crearOrdenMigrada(
      sesion(),
      {
        folio: 987654,
        idEmpresa,
        idPedidoLinea: null,
        idModelo: modelo.id,
        idCliente: idClienteNegocio,
        estado: 'completa',
        celdas: [{ idColor, idTalla, cantidad: 10 }],
      },
      bd(),
    );

    expect(await cliente.eventoOutbox.count({ where: { tipo: 'orden-creada' } })).toBe(0);
    const modeloTras = await cliente.modelo.findUnique({ where: { id: modelo.id } });
    expect(modeloTras?.numeroProduccion).toBeNull();
  });
});
