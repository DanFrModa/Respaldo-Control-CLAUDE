import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Cliente,
  Empresa,
  Modelo,
  Orden,
  PrismaClient,
  Proveedor,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarPreciosOrden,
  listarEventosPrecioOrden,
  obtenerPreciosOrden,
} from './precios-orden.js';

/**
 * Integración del dominio de PRECIOS de la orden (rediseño R2, §4.4.3) contra el Postgres efímero
 * (testcontainers, CI). Cubre lo que SOLO la base valida: el evento inmutable con anterior→nuevo
 * encadenado entre capturas (D3/A7), la bitácora en la MISMA transacción (A2), la orden de otra
 * empresa = 404 (A9), la cancelada = 409, el proveedor inexistente/inactivo rechazado, y la
 * resolución del NOMBRE de quien capturó contra la tabla de usuarios.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;
let modelo: Modelo;
let proveedor: Proveedor;
let proveedorInactivo: Proveedor;
let orden: Orden;

const PERMISOS: ClavePermiso[] = [
  'ordenes.ver',
  'ordenes.precio-maquila',
  'ordenes.ver-precio-real-maquila',
];

function sesion(permisos: ClavePermiso[] = PERMISOS, idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

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
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa de Prueba');
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  modelo = await cliente.modelo.create({
    data: { codigo: '62182', descripcion: 'Sudadera', maquilaBase: 23.5 },
  });
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Óscar Jiménez' } });
  proveedorInactivo = await cliente.proveedor.create({
    data: { nombre: 'Proveedor Apagado', activo: false },
  });
  orden = await cliente.orden.create({
    data: {
      folio: 5424n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
    },
  });
  // El usuario de la sesión de prueba, para resolver `capturadoPor` por nombre.
  await cliente.usuario.create({
    data: {
      id: 'usuario-prueba',
      username: 'prueba',
      nombre: 'Usuario de Prueba',
      email: 'prueba@control.local',
    },
  });
});

describe('precios de la orden — captura con rastro inmutable (A2/A7, D3)', () => {
  it('actualiza maquilaOrd, inserta el evento (null→27.5) y deja bitácora en la misma tx', async () => {
    await actualizarPreciosOrden(
      sesion(),
      orden.id,
      { campo: 'maquila', precio: 27.5, idProveedor: proveedor.id, nota: 'Temporada alta' },
      bd(),
    );

    const guardada = await cliente.orden.findUniqueOrThrow({ where: { id: orden.id } });
    expect(guardada.maquilaOrd?.toNumber()).toBe(27.5);
    expect(guardada.aplicacionOrd).toBeNull();

    const eventos = await cliente.ordenPrecioEvento.findMany({ where: { idOrden: orden.id } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.campo).toBe('maquila');
    expect(eventos[0]?.precioAnterior).toBeNull();
    expect(eventos[0]?.precioNuevo.toNumber()).toBe(27.5);
    expect(eventos[0]?.idProveedor).toBe(proveedor.id);
    expect(eventos[0]?.nota).toBe('Temporada alta');
    expect(eventos[0]?.capturadoPorId).toBe('usuario-prueba');

    const bitacoras = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: String(orden.id), accion: 'MODIFICAR' },
    });
    expect(bitacoras).toHaveLength(1);
  });

  it('la SEGUNDA captura encadena anterior→nuevo y el historial sale más reciente primero', async () => {
    await actualizarPreciosOrden(sesion(), orden.id, { campo: 'maquila', precio: 25 }, bd());
    await actualizarPreciosOrden(
      sesion(),
      orden.id,
      { campo: 'maquila', precio: 27.5, idProveedor: proveedor.id },
      bd(),
    );

    const lista = await listarEventosPrecioOrden(sesion(), orden.id, bd());
    expect(lista.folioOrden).toBe(5424);
    expect(lista.eventos).toHaveLength(2);
    expect(lista.eventos[0]?.precioAnterior).toBe(25); // el más reciente primero
    expect(lista.eventos[0]?.precioNuevo).toBe(27.5);
    expect(lista.eventos[0]?.proveedor).toBe('Óscar Jiménez');
    expect(lista.eventos[0]?.capturadoPor).toBe('Usuario de Prueba');
    expect(lista.eventos[1]?.precioAnterior).toBeNull();
    expect(lista.eventos[1]?.precioNuevo).toBe(25);
  });

  it('dos capturas CONCURRENTES del mismo campo se serializan: el historial encadena de verdad', async () => {
    // Sin el advisory lock, ambas leerían el MISMO "anterior" (READ COMMITTED) y el historial
    // mentiría (A→B, A→C). Con el lock: A→B→C, gane quien gane la carrera.
    await Promise.all([
      actualizarPreciosOrden(sesion(), orden.id, { campo: 'maquila', precio: 25 }, bd()),
      actualizarPreciosOrden(sesion(), orden.id, { campo: 'maquila', precio: 27.5 }, bd()),
    ]);

    const eventos = await cliente.ordenPrecioEvento.findMany({
      where: { idOrden: orden.id },
      orderBy: { id: 'asc' },
    });
    expect(eventos).toHaveLength(2);
    const [primero, segundo] = eventos;
    if (primero === undefined || segundo === undefined) throw new Error('eventos esperados');
    // El primero arranca de null; el segundo ENCADENA con el precio que dejó el primero.
    expect(primero.precioAnterior).toBeNull();
    expect(segundo.precioAnterior?.toNumber()).toBe(primero.precioNuevo.toNumber());
    // Y el precio vigente de la orden es el del ÚLTIMO evento.
    const guardada = await cliente.orden.findUniqueOrThrow({ where: { id: orden.id } });
    expect(guardada.maquilaOrd?.toNumber()).toBe(segundo.precioNuevo.toNumber());
  });

  it('maquila y aplicación llevan rastros INDEPENDIENTES', async () => {
    await actualizarPreciosOrden(sesion(), orden.id, { campo: 'maquila', precio: 25 }, bd());
    await actualizarPreciosOrden(sesion(), orden.id, { campo: 'aplicacion', precio: 6 }, bd());

    const guardada = await cliente.orden.findUniqueOrThrow({ where: { id: orden.id } });
    expect(guardada.maquilaOrd?.toNumber()).toBe(25);
    expect(guardada.aplicacionOrd?.toNumber()).toBe(6);

    const resumen = await obtenerPreciosOrden(sesion(), orden.id, bd());
    expect(resumen.maquilaReal).toBe(25);
    expect(resumen.aplicacionReal).toBe(6);
    expect(resumen.maquilaReferencia).toBe(23.5);
    expect(resumen.ultimoEventoMaquila?.capturadoPor).toBe('Usuario de Prueba');
    expect(resumen.ultimoEventoAplicacion).not.toBeNull();
  });
});

describe('precios de la orden — reglas de negocio (A9, 409, proveedor)', () => {
  it('orden de OTRA empresa: para esta sesión no existe (404, A9)', async () => {
    const ajena = await cliente.orden.create({
      data: {
        folio: 1n,
        idEmpresa: otraEmpresa.id,
        idModelo: modelo.id,
        idCliente: clienteNegocio.id,
      },
    });
    await expect(
      actualizarPreciosOrden(sesion(), ajena.id, { campo: 'maquila', precio: 10 }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(obtenerPreciosOrden(sesion(), ajena.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    await expect(listarEventosPrecioOrden(sesion(), ajena.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('orden CANCELADA → 409 (no se le capturan precios)', async () => {
    await cliente.orden.update({ where: { id: orden.id }, data: { estado: 'cancelada' } });
    await expect(
      actualizarPreciosOrden(sesion(), orden.id, { campo: 'maquila', precio: 10 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('proveedor inexistente → 404; inactivo → 409; y NADA persiste (rollback A2)', async () => {
    await expect(
      actualizarPreciosOrden(
        sesion(),
        orden.id,
        { campo: 'maquila', precio: 10, idProveedor: 99_999 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      actualizarPreciosOrden(
        sesion(),
        orden.id,
        { campo: 'maquila', precio: 10, idProveedor: proveedorInactivo.id },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    const guardada = await cliente.orden.findUniqueOrThrow({ where: { id: orden.id } });
    expect(guardada.maquilaOrd).toBeNull();
    expect(await cliente.ordenPrecioEvento.count()).toBe(0);
  });
});

describe('precios de la orden — gateo de lectura contra datos reales (§4.4.3)', () => {
  it('sin ver-precio-real-maquila el resumen oculta los montos aunque existan en BD', async () => {
    await actualizarPreciosOrden(sesion(), orden.id, { campo: 'maquila', precio: 25 }, bd());

    const resumen = await obtenerPreciosOrden(sesion(['ordenes.ver']), orden.id, bd());
    expect(resumen.puedeVerReales).toBe(false);
    expect(resumen.maquilaReal).toBeNull();
    expect(resumen.aplicacionReal).toBeNull();
    // El rastro (quién/cuándo/proveedor) sí se muestra: no expone montos.
    expect(resumen.ultimoEventoMaquila?.capturadoPor).toBe('Usuario de Prueba');
  });

  it('precioVenta sale del renglón del pedido SOLO con pedidos.importes', async () => {
    const pedido = await cliente.pedido.create({
      data: { folio: 1485n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
    });
    const linea = await cliente.pedidoLinea.create({
      data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 100, precio: 148 },
    });
    await cliente.orden.update({ where: { id: orden.id }, data: { idPedidoLinea: linea.id } });

    const sinImportes = await obtenerPreciosOrden(sesion(['ordenes.ver']), orden.id, bd());
    expect(sinImportes.precioVenta).toBeNull();

    const conImportes = await obtenerPreciosOrden(
      sesion(['ordenes.ver', 'pedidos.importes']),
      orden.id,
      bd(),
    );
    expect(conImportes.precioVenta).toBe(148);
  });
});
