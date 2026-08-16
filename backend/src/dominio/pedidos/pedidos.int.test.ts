// Credenciales R2 FALSAS, fijadas ANTES de importar el dominio (servicioArchivos lazy).
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  configR2DesdeEnv,
  crearClienteR2,
  crearServicioArchivos,
  type ServicioArchivos,
} from '../../comun/archivos.js';
import type { ClavePermiso } from '../../contrato/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Cliente, Empresa, Modelo, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarPedido,
  cancelarPedido,
  copiarPedido,
  crearPedido,
  listarPedidos,
  obtenerPedido,
} from './pedidos.js';
import {
  actualizarPedidoReal,
  actualizarSeguimientoPedidoReal,
  cancelarPedidoReal,
  crearPedidoReal,
  listarPedidosReales,
} from './pedidos-reales.js';
import { salidaAProduccion } from '../produccion/salida-produccion.js';

/**
 * Integración del dominio de Pedidos (F2-E1) contra el Postgres efímero (testcontainers).
 * Cubre lo que SOLO la base valida: folio por empresa sin colisión bajo concurrencia (A3/A9),
 * copiado transaccional de renglones seleccionados, réplica automática del pedido real (§4.4),
 * ocultamiento de importes server-side y cancelación suave. NO corre en local (usa Docker): el CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let modeloA: Modelo;
let modeloB: Modelo;

/** Servicio de archivos con credenciales falsas (firma local, sin red). */
function archivosDePrueba(): ServicioArchivos {
  const config = configR2DesdeEnv(process.env);
  return crearServicioArchivos({ cliente: crearClienteR2(config), bucket: config.bucket });
}
const archivos = archivosDePrueba();

/** Sesión sobre la empresa de prueba con los permisos dados. */
function sesion(permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}

const PERM_TODOS: ClavePermiso[] = [
  'pedidos.ver',
  'pedidos.administrar',
  'pedidos.importes',
  'pedidos-reales.administrar',
];

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  modeloA = await cliente.modelo.create({ data: { codigo: 'A-100' } });
  modeloB = await cliente.modelo.create({ data: { codigo: 'B-200' } });
});

describe('Pedidos (F2-E1) — permisos (deny-by-default, A4)', () => {
  it('sin permiso administrar no se puede crear; sin ver no se puede listar', async () => {
    await expect(
      crearPedido(
        sesion(['pedidos.ver']),
        { idCliente: clienteNegocio.id, lineas: [] },
        bd(),
        archivos,
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarPedidos(sesion([]), {}, bd(), archivos)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('Pedidos (F2-E1) — folio por empresa (A3/A9)', () => {
  it('asigna folios consecutivos por empresa', async () => {
    const s = sesion([...PERM_TODOS]);
    const p1 = await crearPedido(s, { idCliente: clienteNegocio.id, lineas: [] }, bd(), archivos);
    const p2 = await crearPedido(s, { idCliente: clienteNegocio.id, lineas: [] }, bd(), archivos);
    expect(p1.folio).toBe(1);
    expect(p2.folio).toBe(2);
  });

  it('CRÍTICO: 10 pedidos CONCURRENTES no colisionan de folio', async () => {
    const s = sesion([...PERM_TODOS]);
    const pedidos = await Promise.all(
      Array.from({ length: 10 }, () =>
        crearPedido(s, { idCliente: clienteNegocio.id, lineas: [] }, bd(), archivos),
      ),
    );
    const folios = pedidos.map((p) => p.folio);
    expect(new Set(folios).size).toBe(10);
    expect([...folios].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('cada empresa lleva su propia numeración (A9)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Segunda Empresa');
    const sA = sesion([...PERM_TODOS]);
    const sB = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: [...PERM_TODOS] });
    await crearPedido(sA, { idCliente: clienteNegocio.id, lineas: [] }, bd(), archivos);
    const enB = await crearPedido(sB, { idCliente: clienteNegocio.id, lineas: [] }, bd(), archivos);
    expect(enB.folio).toBe(1); // numeración independiente por empresa
  });
});

describe('Pedidos (F2-E1) — alta y edición de renglones (A2)', () => {
  it('crea encabezado + renglones en una transacción y suma piezas/importe', async () => {
    const s = sesion([...PERM_TODOS]);
    const pedido = await crearPedido(
      s,
      {
        idCliente: clienteNegocio.id,
        lineas: [
          { idModelo: modeloA.id, cantidadPedida: 10, precio: 50 },
          { idModelo: modeloB.id, cantidadPedida: 5, precio: 100 },
        ],
      },
      bd(),
      archivos,
    );
    expect(pedido.lineas).toHaveLength(2);
    expect(pedido.totalPiezas).toBe(15);
    expect(pedido.totalImporte).toBe(10 * 50 + 5 * 100);
  });

  it('sincroniza el set de renglones al editar (agrega/edita/quita)', async () => {
    const s = sesion([...PERM_TODOS]);
    const pedido = await crearPedido(
      s,
      {
        idCliente: clienteNegocio.id,
        lineas: [{ idModelo: modeloA.id, cantidadPedida: 10, precio: 50 }],
      },
      bd(),
      archivos,
    );
    const idLinea = pedido.lineas[0]?.id;
    const editado = await actualizarPedido(
      s,
      {
        id: pedido.id,
        // conserva el primero (con id), cambia cantidad, y agrega un segundo renglón nuevo
        lineas: [
          { id: idLinea, idModelo: modeloA.id, cantidadPedida: 20, precio: 50 },
          { idModelo: modeloB.id, cantidadPedida: 3, precio: 80 },
        ],
      },
      bd(),
      archivos,
    );
    expect(editado.lineas).toHaveLength(2);
    expect(editado.totalPiezas).toBe(23);
  });

  it('rechaza pedir un modelo descontinuado', async () => {
    const s = sesion([...PERM_TODOS]);
    await cliente.modelo.update({ where: { id: modeloB.id }, data: { activo: false } });
    await expect(
      crearPedido(
        s,
        {
          idCliente: clienteNegocio.id,
          lineas: [{ idModelo: modeloB.id, cantidadPedida: 1, precio: 10 }],
        },
        bd(),
        archivos,
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Pedidos (F2-E1) — copiar (renglones seleccionados, folio nuevo)', () => {
  it('copia SOLO los renglones seleccionados en un pedido nuevo con folio nuevo', async () => {
    const s = sesion([...PERM_TODOS]);
    const original = await crearPedido(
      s,
      {
        idCliente: clienteNegocio.id,
        lineas: [
          { idModelo: modeloA.id, cantidadPedida: 10, precio: 50 },
          { idModelo: modeloB.id, cantidadPedida: 5, precio: 100 },
        ],
      },
      bd(),
      archivos,
    );
    const idPrimera = original.lineas[0]?.id as number;

    const copia = await copiarPedido(s, original.id, { idLineas: [idPrimera] }, bd(), archivos);
    expect(copia.id).not.toBe(original.id);
    expect(copia.folio).toBe(original.folio + 1); // folio nuevo de la secuencia
    expect(copia.idCliente).toBe(original.idCliente);
    expect(copia.lineas).toHaveLength(1); // solo el renglón seleccionado
    expect(copia.lineas[0]?.idModelo).toBe(modeloA.id);
  });

  it('sin selección copia TODOS los renglones', async () => {
    const s = sesion([...PERM_TODOS]);
    const original = await crearPedido(
      s,
      {
        idCliente: clienteNegocio.id,
        lineas: [
          { idModelo: modeloA.id, cantidadPedida: 10, precio: 50 },
          { idModelo: modeloB.id, cantidadPedida: 5, precio: 100 },
        ],
      },
      bd(),
      archivos,
    );
    const copia = await copiarPedido(s, original.id, {}, bd(), archivos);
    expect(copia.lineas).toHaveLength(2);
  });
});

describe('Pedidos (F2-E1) — pedido real (réplica automática §4.4)', () => {
  it('replica un renglón por cada renglón del pedido interno', async () => {
    const s = sesion([...PERM_TODOS]);
    const pedido = await crearPedido(
      s,
      {
        idCliente: clienteNegocio.id,
        lineas: [
          { idModelo: modeloA.id, cantidadPedida: 10, precio: 50 },
          { idModelo: modeloB.id, cantidadPedida: 5, precio: 100 },
        ],
      },
      bd(),
      archivos,
    );
    const real = await crearPedidoReal(s, pedido.id, { cedis: 'CEDIS Norte' }, bd());
    expect(real.cedis).toBe('CEDIS Norte');
    expect(real.lineas).toHaveLength(2); // un renglón por cada renglón interno
    // cada renglón del real apunta a un renglón interno y nace con cantidades en 0
    expect(real.lineas.every((l) => l.cantidadPR === 0)).toBe(true);
    expect(real.lineas.map((l) => l.idModelo).sort()).toEqual([modeloA.id, modeloB.id].sort());

    const lista = await listarPedidosReales(s, pedido.id, bd());
    expect(lista).toHaveLength(1);
  });

  it('no permite crear un pedido real de un pedido SIN renglones', async () => {
    const s = sesion([...PERM_TODOS]);
    const pedido = await crearPedido(
      s,
      { idCliente: clienteNegocio.id, lineas: [] },
      bd(),
      archivos,
    );
    await expect(crearPedidoReal(s, pedido.id, {}, bd())).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Pedidos (F2-E1) — ocultamiento de importes server-side (doc 02 §3)', () => {
  it('SIN pedidos.importes la respuesta NO trae precio/importe/total (en null)', async () => {
    const sAdmin = sesion([...PERM_TODOS]);
    const pedido = await crearPedido(
      sAdmin,
      {
        idCliente: clienteNegocio.id,
        lineas: [{ idModelo: modeloA.id, cantidadPedida: 10, precio: 50 }],
      },
      bd(),
      archivos,
    );

    const sinImportes = sesion(['pedidos.ver']);
    const visto = await obtenerPedido(sinImportes, pedido.id, bd(), archivos);
    expect(visto.lineas[0]?.precio).toBeNull();
    expect(visto.lineas[0]?.importe).toBeNull();
    expect(visto.totalImporte).toBeNull();
    expect(visto.totalPiezas).toBe(10); // piezas SÍ se ven

    const conImportes = sesion(['pedidos.ver', 'pedidos.importes']);
    const vistoFull = await obtenerPedido(conImportes, pedido.id, bd(), archivos);
    expect(vistoFull.lineas[0]?.precio).toBe(50);
    expect(vistoFull.totalImporte).toBe(500);
  });

  // Fix del reviewer (BLOQUEANTE): un usuario con `pedidos.administrar` pero SIN
  // `pedidos.importes` (rol Ventas) edita cantidades/fechas → el precio de los renglones
  // EXISTENTES debe conservarse (jamás un 0 falso encima del precio real). Un renglón NUEVO de
  // ese usuario sí puede quedar en 0.
  it('editar un pedido como usuario SIN pedidos.importes NO altera el precio de los renglones existentes (y un alta sí puede quedar en 0)', async () => {
    // Lo crea un admin CON importes: el renglón nace con precio 50.
    const sAdmin = sesion([...PERM_TODOS]);
    const pedido = await crearPedido(
      sAdmin,
      {
        idCliente: clienteNegocio.id,
        lineas: [{ idModelo: modeloA.id, cantidadPedida: 10, precio: 50 }],
      },
      bd(),
      archivos,
    );
    const idLinea = pedido.lineas[0]?.id as number;

    // Ventas: administra pedidos pero NO ve importes. El front NO manda `precio` del renglón
    // existente; aquí se simula el ataque vía API directa (manda precio: 0) para probar la
    // defensa server-side: el dominio IGNORA el precio entrante del renglón existente.
    const ventas = sesion(['pedidos.ver', 'pedidos.administrar']);
    await actualizarPedido(
      ventas,
      {
        id: pedido.id,
        lineas: [
          // renglón existente: cambia la cantidad y trata de poner precio 0 (debe IGNORARSE)
          { id: idLinea, idModelo: modeloA.id, cantidadPedida: 30, precio: 0 },
          // renglón NUEVO sin precio: un alta de un usuario sin importes → queda en 0
          { idModelo: modeloB.id, cantidadPedida: 5 },
        ],
      },
      bd(),
      archivos,
    );

    // Verificado con un admin (que sí ve importes): el precio del renglón existente sigue en 50.
    const verificado = await obtenerPedido(sAdmin, pedido.id, bd(), archivos);
    const renglonExistente = verificado.lineas.find((l) => l.id === idLinea);
    expect(renglonExistente?.cantidadPedida).toBe(30); // la cantidad SÍ cambió
    expect(renglonExistente?.precio).toBe(50); // el precio NO se pisó (conservado)

    const renglonNuevo = verificado.lineas.find((l) => l.idModelo === modeloB.id);
    expect(renglonNuevo?.precio).toBe(0); // el alta sin importes quedó en 0
  });
});

describe('Pedidos (F2-E1) — cancelación suave (doc 02 §4.2)', () => {
  it('cancela sin borrar: el pedido sigue consultable y no se vuelve a cancelar', async () => {
    const s = sesion([...PERM_TODOS]);
    const pedido = await crearPedido(
      s,
      { idCliente: clienteNegocio.id, lineas: [] },
      bd(),
      archivos,
    );

    const cancelado = await cancelarPedido(s, pedido.id, {}, bd(), archivos);
    expect(cancelado.pedCancelado).toBe(true);

    // sigue consultable
    const visto = await obtenerPedido(s, pedido.id, bd(), archivos);
    expect(visto.pedCancelado).toBe(true);

    // por defecto el listado NO lo trae; con incluirCancelados sí
    const sinCancelados = await listarPedidos(s, {}, bd(), archivos);
    expect(sinCancelados.datos.some((p) => p.id === pedido.id)).toBe(false);
    const conCancelados = await listarPedidos(s, { incluirCancelados: true }, bd(), archivos);
    expect(conCancelados.datos.some((p) => p.id === pedido.id)).toBe(true);

    // cancelar dos veces es conflicto
    await expect(cancelarPedido(s, pedido.id, {}, bd(), archivos)).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });
});

describe('Pedidos (R3, B4) — coherencia de los amarres a desarrollo (H1 del reviewer)', () => {
  /** Siembra depto + proyecto (empresa de prueba) + desarrollo del cliente/modelo dados. */
  async function sembrarDesarrollo(idCliente: number, idModelo: number): Promise<number> {
    const depto = await cliente.clienteDepartamento.create({
      data: { idCliente, nombre: `Depto ${String(Date.now())}-${String(Math.random())}` },
    });
    const proyecto = await cliente.proyecto.create({
      data: {
        folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
        idEmpresa: empresa.id,
        idCliente,
        idClienteDepartamento: depto.id,
        nombre: 'Joggers PV26',
      },
    });
    const desarrollo = await cliente.desarrollo.create({
      data: { idProyecto: proyecto.id, idModelo },
    });
    return desarrollo.id;
  }

  it('H1a: cambiar el CLIENTE del pedido sin re-mandar renglones rechaza si hay amarres al cliente anterior', async () => {
    const s = sesion([...PERM_TODOS]);
    const idDesarrollo = await sembrarDesarrollo(clienteNegocio.id, modeloA.id);
    const otroCliente = await cliente.cliente.create({ data: { nombre: 'Suburbia' } });

    const pedido = await crearPedido(
      s,
      {
        idCliente: clienteNegocio.id,
        lineas: [{ idModelo: modeloA.id, cantidadPedida: 10, precio: 50, idDesarrollo }],
      },
      bd(),
      archivos,
    );

    // Sin `lineas` en el PATCH: el amarre persistido al desarrollo del cliente VIEJO bloquea el
    // cambio con un error claro (jamás se auto-desliga en silencio).
    await expect(
      actualizarPedido(s, { id: pedido.id, idCliente: otroCliente.id }, bd(), archivos),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Nada cambió (A2): el pedido conserva su cliente y su amarre.
    const intacto = await obtenerPedido(s, pedido.id, bd(), archivos);
    expect(intacto.idCliente).toBe(clienteNegocio.id);
    expect(intacto.lineas[0]?.idDesarrollo).toBe(idDesarrollo);

    // Desligando el renglon (idDesarrollo: null) el cambio de cliente ya procede.
    const idLinea = pedido.lineas[0]?.id as number;
    await actualizarPedido(
      s,
      {
        id: pedido.id,
        lineas: [{ id: idLinea, idModelo: modeloA.id, cantidadPedida: 10, idDesarrollo: null }],
      },
      bd(),
      archivos,
    );
    const cambiado = await actualizarPedido(
      s,
      { id: pedido.id, idCliente: otroCliente.id },
      bd(),
      archivos,
    );
    expect(cambiado.idCliente).toBe(otroCliente.id);
  });

  it('H1b: cambiar el MODELO de un renglon omitiendo idDesarrollo rechaza (conservaria el amarre del modelo viejo)', async () => {
    const s = sesion([...PERM_TODOS]);
    const idDesarrollo = await sembrarDesarrollo(clienteNegocio.id, modeloA.id);

    const pedido = await crearPedido(
      s,
      {
        idCliente: clienteNegocio.id,
        lineas: [{ idModelo: modeloA.id, cantidadPedida: 10, precio: 50, idDesarrollo }],
      },
      bd(),
      archivos,
    );
    const idLinea = pedido.lineas[0]?.id as number;

    // Omitir idDesarrollo = "no tocar" (M1): el amarre PERSISTIDO se valida contra el modelo NUEVO.
    await expect(
      actualizarPedido(
        s,
        { id: pedido.id, lineas: [{ id: idLinea, idModelo: modeloB.id, cantidadPedida: 10 }] },
        bd(),
        archivos,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    const intacto = await obtenerPedido(s, pedido.id, bd(), archivos);
    expect(intacto.lineas[0]?.idModelo).toBe(modeloA.id);
    expect(intacto.lineas[0]?.idDesarrollo).toBe(idDesarrollo);

    // Desligando en el MISMO patch (idDesarrollo: null), el cambio de modelo procede.
    const cambiado = await actualizarPedido(
      s,
      {
        id: pedido.id,
        lineas: [{ id: idLinea, idModelo: modeloB.id, cantidadPedida: 10, idDesarrollo: null }],
      },
      bd(),
      archivos,
    );
    expect(cambiado.lineas[0]?.idModelo).toBe(modeloB.id);
    expect(cambiado.lineas[0]?.idDesarrollo).toBeNull();
  });
});

/**
 * ⭐ V1-E4 punto 5 — «Cancelar pedido» MENTÍA. La pantalla prometía que el pedido "deja de
 * producirse" y cancelar solo ponía `pedCancelado = true`: sus OPs seguían vivas, en el centro de
 * órdenes, en el WIP y en el MRP, cortándose. Nadie lo nota probando a mano (la cancelación
 * "funciona"): el descubrimiento llega cuando alguien corta un pedido cancelado.
 */
describe('⭐ cancelar un pedido dice la verdad sobre sus OPs (V1-E4)', () => {
  const PERM_CON_CANCELAR: ClavePermiso[] = [...PERM_TODOS, 'ordenes.ver', 'ordenes.administrar'];

  /** Crea un pedido con un renglón y le genera su OP. Devuelve los ids. */
  async function pedidoConOp(): Promise<{ idPedido: number; idOrden: number; folioOrden: number }> {
    const s = sesion([...PERM_CON_CANCELAR, 'ordenes.cancelar']);
    const pedido = await crearPedido(
      s,
      { idCliente: clienteNegocio.id, lineas: [{ idModelo: modeloA.id, cantidadPedida: 100 }] },
      bd(),
      archivos,
    );
    const color = await cliente.color.create({ data: { nombre: `Color ${String(Date.now())}` } });
    const talla = await cliente.talla.create({
      data: { etiqueta: `T${String(Date.now())}`, orden: 1 },
    });
    const salida = await salidaAProduccion(
      s,
      pedido.lineas[0]!.id,
      { lineas: [{ idColor: color.id, tallas: [{ idTalla: talla.id, cantidad: 100 }] }] },
      bd(),
    );
    return {
      idPedido: pedido.id,
      idOrden: salida.orden.id,
      folioOrden: salida.orden.folio,
    };
  }

  it('con OPs vivas y SIN pedir cancelarlas: se RECHAZA, nombrándolas, y nada cambia', async () => {
    const s = sesion([...PERM_CON_CANCELAR, 'ordenes.cancelar']);
    const { idPedido, idOrden, folioOrden } = await pedidoConOp();

    const error = await cancelarPedido(s, idPedido, {}, bd(), archivos).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorConflicto);
    expect((error as Error).message).toContain(String(folioOrden));
    // NADA se movió: ni el pedido ni la OP.
    const pedido = await cliente.pedido.findUniqueOrThrow({ where: { id: idPedido } });
    expect(pedido.pedCancelado).toBe(false);
    const orden = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    expect(orden.estado).not.toBe('cancelada');
  });

  it('con `cancelarOrdenes` + motivo: se cancelan el pedido Y sus OPs, en la misma transacción', async () => {
    const s = sesion([...PERM_CON_CANCELAR, 'ordenes.cancelar']);
    const { idPedido, idOrden } = await pedidoConOp();

    const resultado = await cancelarPedido(
      s,
      idPedido,
      { cancelarOrdenes: true, motivo: 'El cliente canceló la compra' },
      bd(),
      archivos,
    );

    expect(resultado.pedCancelado).toBe(true);
    const orden = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    expect(orden.estado).toBe('cancelada');
    expect(orden.motivoCancelada).toContain('El cliente canceló la compra');
    // D3/A7: cada OP cancelada dejó SU propio renglón de bitácora (no un "se cancelaron N").
    const bitacoraOrden = await cliente.bitacora.findFirst({
      where: { entidad: 'Orden', idEntidad: String(idOrden), accion: 'CANCELAR' },
    });
    expect(bitacoraOrden).not.toBeNull();
    expect((bitacoraOrden?.datos as { origen?: string }).origen).toBe('cancelar-pedido');
  });

  it('sin `ordenes.cancelar` NO se pueden arrastrar las OPs (403 antes de tocar nada)', async () => {
    const { idPedido, idOrden } = await pedidoConOp();
    const sinCancelarOrdenes = sesion(PERM_CON_CANCELAR); // sin `ordenes.cancelar`

    await expect(
      cancelarPedido(
        sinCancelarOrdenes,
        idPedido,
        { cancelarOrdenes: true, motivo: 'x' },
        bd(),
        archivos,
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    const orden = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
    expect(orden.estado).not.toBe('cancelada');
  });

  it('cancelar las OPs sin motivo se rechaza (toda orden cancelada lleva su porqué)', async () => {
    const s = sesion([...PERM_CON_CANCELAR, 'ordenes.cancelar']);
    const { idPedido } = await pedidoConOp();

    await expect(
      cancelarPedido(s, idPedido, { cancelarOrdenes: true }, bd(), archivos),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('las OPs YA canceladas no estorban: el pedido se cancela sin pedir nada más', async () => {
    const s = sesion([...PERM_CON_CANCELAR, 'ordenes.cancelar']);
    const { idPedido, idOrden } = await pedidoConOp();
    await cliente.orden.update({
      where: { id: idOrden },
      data: { estado: 'cancelada', motivoCancelada: 'cancelada antes' },
    });

    const resultado = await cancelarPedido(s, idPedido, {}, bd(), archivos);

    expect(resultado.pedCancelado).toBe(true);
  });
});

/**
 * ⭐ V1-E4 punto 6 — CANCELAR EL PEDIDO REAL. Lo decidió Daniel en §Post-F9.37 punto 9 (*"Sí."*),
 * cerrando el TODO que llevaba abierto desde F2-E1. Suave y con motivo (D3).
 */
describe('⭐ cancelar el pedido real (V1-E4)', () => {
  /** Crea un pedido con un renglón y su pedido real. */
  async function pedidoRealNuevo(): Promise<{ idPedido: number; idReal: number }> {
    const s = sesion([...PERM_TODOS]);
    const pedido = await crearPedido(
      s,
      { idCliente: clienteNegocio.id, lineas: [{ idModelo: modeloA.id, cantidadPedida: 50 }] },
      bd(),
      archivos,
    );
    const real = await crearPedidoReal(s, pedido.id, { numPedReal: 'PR-77' }, bd());
    return { idPedido: pedido.id, idReal: real.id };
  }

  it('cancela suave con motivo: sigue consultable, marcado y con su porqué', async () => {
    const s = sesion([...PERM_TODOS]);
    const { idPedido, idReal } = await pedidoRealNuevo();

    const cancelado = await cancelarPedidoReal(
      s,
      idReal,
      { motivo: 'Se adelantó la entrega' },
      bd(),
    );

    expect(cancelado.cancelado).toBe(true);
    expect(cancelado.motivoCancelada).toBe('Se adelantó la entrega');
    // NO se borró: sigue en el listado del pedido.
    const listado = await listarPedidosReales(s, idPedido, bd());
    expect(listado.some((r) => r.id === idReal && r.cancelado)).toBe(true);
    // Bitácora (A7).
    const registro = await cliente.bitacora.findFirst({
      where: { entidad: 'PedidoReal', idEntidad: String(idReal), accion: 'CANCELAR' },
    });
    expect(registro).not.toBeNull();
    expect((registro?.datos as { motivo?: string }).motivo).toBe('Se adelantó la entrega');
  });

  it('cancelar dos veces es conflicto', async () => {
    const s = sesion([...PERM_TODOS]);
    const { idReal } = await pedidoRealNuevo();
    await cancelarPedidoReal(s, idReal, { motivo: 'a' }, bd());
    await expect(cancelarPedidoReal(s, idReal, { motivo: 'b' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('sin motivo NO se cancela (mismo criterio que cancelar una orden)', async () => {
    const s = sesion([...PERM_TODOS]);
    const { idReal } = await pedidoRealNuevo();
    await expect(cancelarPedidoReal(s, idReal, { motivo: '   ' }, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('cancelado ya no se edita ni se le captura seguimiento (la cancelación no es decorativa)', async () => {
    const s = sesion([...PERM_TODOS]);
    const { idReal } = await pedidoRealNuevo();
    const antes = await cancelarPedidoReal(s, idReal, { motivo: 'ya no va' }, bd());

    await expect(
      actualizarPedidoReal(s, idReal, { cedis: 'CEDIS NUEVO' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(
      actualizarSeguimientoPedidoReal(
        s,
        idReal,
        { lineas: [{ id: antes.lineas[0]!.id, cantidadPR: 10 }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('RBAC + A9: sin pedidos-reales.administrar no se cancela; el de otra empresa no existe', async () => {
    const { idReal } = await pedidoRealNuevo();

    await expect(
      cancelarPedidoReal(sesion(['pedidos.ver']), idReal, { motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa PR');
    const sesionOtra = sesionDePrueba({
      idEmpresaActiva: otra.id,
      permisos: [...PERM_TODOS],
    });
    // A9: 404, NUNCA 409 (un 409 confirmaría que existe).
    await expect(
      cancelarPedidoReal(sesionOtra, idReal, { motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
