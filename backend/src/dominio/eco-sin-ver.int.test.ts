// Credenciales R2 FALSAS, fijadas ANTES de importar el dominio (`servicioArchivos` es lazy y el
// dominio de Pedidos lo toca al proyectar las fotos del modelo).
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
} from '../comun/archivos.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../comun/errores.js';
import type { SesionUsuario } from '../comun/permisos.js';
import type { ClavePermiso } from '../contrato/index.js';
import type { Empresa, PrismaClient } from '../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sesionDePrueba } from '../pruebas/sesiones.js';

import {
  obtenerConceptoPago,
  crearConceptoPago,
  proyectarConceptoPago,
} from './catalogos/conceptos-pago.js';
import {
  autorizarOC,
  cancelarOC,
  crearOC,
  desautorizarOC,
  obtenerOC,
  proyectarOC,
} from './compras/ordenes-compra.js';
import {
  crearDesarrollo,
  crearDesarrolloConModeloNuevo,
  obtenerDesarrollo,
  proyectarDesarrollo,
} from './desarrollo/desarrollos.js';
import { crearProyecto, obtenerProyecto, proyectarProyecto } from './desarrollo/proyectos.js';
import {
  forzarOrdenPagada,
  obtenerOrdenPagada,
  proyectarOrdenPagada,
} from './esma/orden-pagada.js';
import { ajustarInventarioAvio } from './inventarios/avios.js';
import {
  cancelarNotaSalida,
  confirmarNotaSalida,
  crearNotaSalida,
  obtenerNotaSalida,
  proyectarNotaSalida,
} from './notas/notas-salida.js';
import {
  cancelarPedido,
  copiarPedido,
  crearPedido,
  obtenerPedido,
  proyectarPedido,
} from './pedidos/pedidos.js';
import {
  cancelarPedidoReal,
  crearPedidoReal,
  obtenerPedidoReal,
  proyectarPedidoReal,
} from './pedidos/pedidos-reales.js';
import {
  agregarComentarioOrden,
  cancelarOrden,
  crearOrden,
  obtenerOrden,
  proyectarOrden,
} from './produccion/ordenes.js';

/**
 * ⭐ Integración de «ESCRIBIR Y LUEGO NEGAR» en todo lo que deja RASTRO NUEVO (fila 0.197).
 *
 * Lo que aquí se mide es UNA frase: **lo que el sistema le contesta a quien escribe dice lo mismo
 * que lo que quedó escrito** — en los VEINTE sitios de esta fila. Hasta aquí los veinte abrían
 * con SU permiso de escritura (`ordenes.administrar`/`.cancelar`, `compras.administrar`/
 * `.autorizar`/`.desautorizar`/`.cancelar`, `notas.administrar`/`.cancelar`,
 * `pedidos.administrar`, `pedidos-reales.administrar`, `esma.modificar`,
 * `desarrollo.administrar`, `conceptos-pago.administrar`), escribían —transacción CERRADA, folio
 * A3 estampado, evento de outbox publicado— y DESPUÉS proyectaban la respuesta con un `obtener*`
 * que exige OTRA llave (`ordenes.ver`, `compras.ver`, `notas.ver`, `pedidos.ver`,
 * `esma.ver-pagos`, `desarrollo.ver`, `conceptos-pago.ver`) ⇒ quien llevara la de escribir y no la
 * de consultar recibía un **403 con el documento ya guardado**. Leía «no tienes permiso», concluía
 * que no se guardó y volvía a capturar: segundo folio quemado, segundo documento, segundo evento.
 *
 * Es la hermana de `api/ruta-critica/captura-sin-ver.int.test.ts` (fila 0.195) y de
 * `api/produccion/captura-sin-wip-ver.int.test.ts` (fila 0.196), por el lado del DOMINIO.
 *
 * 🔑 **POR QUÉ ESTA MITAD EXISTE, y no basta con la del API** (la trampa que documenta la 0.195):
 * por HTTP el 403 de la consulta suelta lo da el `preHandler`, así que quitarle el
 * `verificarPermiso` a un `obtener*` **NO pone roja ninguna prueba de ruta** — el API seguiría
 * verde con la reja abierta de par en par. Aquí se llama al dominio a pelo, sin ruta de por medio,
 * y por eso estos tres bloques se sostienen entre sí:
 *  - **el ECO**: cada escritura, con una sesión que NO lleva la llave de ver, devuelve su DTO;
 *  - **la REJA**: el `obtener*` correspondiente, con ESA MISMA sesión, sigue negando (`ErrorPermiso`);
 *  - **A9**: la proyectora conserva el filtro por empresa activa — un documento ajeno «no existe».
 *
 * La mitad de PUERTA (que el `preHandler` de la consulta suelta no se volvió decorativo) la mide
 * `api/escritura-sin-ver.int.test.ts`.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;

/** Servicio de archivos con credenciales falsas (firma local, sin red). */
function archivosDePrueba(): ServicioArchivos {
  const config = configR2DesdeEnv(process.env);
  return crearServicioArchivos({ cliente: crearClienteR2(config), bucket: config.bucket });
}
const archivos = archivosDePrueba();

const bd = () => ({ cliente });

/** Sesión sobre la empresa de prueba con EXACTAMENTE los permisos dados (deny-by-default, A4). */
function sesion(permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}

/** La MISMA sesión, pero parada en OTRA empresa: es la que mide A9. */
function sesionAjena(permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: otraEmpresa.id, permisos });
}

// ── Las sesiones bajo prueba: llave de ESCRIBIR, SIN la de VER ───────────────────────────────────

const ADMIN_ORDENES: ClavePermiso[] = ['ordenes.administrar'];
const CANCELA_ORDENES: ClavePermiso[] = ['ordenes.cancelar'];
const ADMIN_OC: ClavePermiso[] = ['compras.administrar'];
const AUTORIZA_OC: ClavePermiso[] = ['compras.autorizar'];
const DESAUTORIZA_OC: ClavePermiso[] = ['compras.desautorizar'];
const CANCELA_OC: ClavePermiso[] = ['compras.cancelar'];
const ADMIN_NOTAS: ClavePermiso[] = ['notas.administrar'];
const CANCELA_NOTAS: ClavePermiso[] = ['notas.cancelar'];
const ADMIN_PEDIDOS: ClavePermiso[] = ['pedidos.administrar'];
const ADMIN_REALES: ClavePermiso[] = ['pedidos-reales.administrar'];
const MODIFICA_ESMA: ClavePermiso[] = ['esma.modificar'];
const ADMIN_DESARROLLO: ClavePermiso[] = ['desarrollo.administrar'];
const ADMIN_DESARROLLO_Y_MODELOS: ClavePermiso[] = [
  'desarrollo.administrar',
  'modelos.administrar',
];
const ADMIN_CONCEPTOS: ClavePermiso[] = ['conceptos-pago.administrar'];

// ── Datos de apoyo (se rehacen en cada test: `limpiarBaseDatos` vacía todo) ─────────────────────

interface Catalogos {
  idClienteNegocio: number;
  idDepartamento: number;
  idModelo: number;
  idModeloDesarrollo: number;
  idPedidoLinea: number;
  idOrden: number;
  idProveedor: number;
  idDireccionEntrega: number;
  idTela: number;
  idAvio: number;
  idAlmacenAvio: number;
  idTipoProducto: number;
  idGenero: number;
}

let cat: Catalogos;

/** Encabezado mínimo que TODA OC nueva necesita (§Post-F9.18). */
const encabezadoOc = () => ({
  fechaEntrega: '2026-09-30',
  idDireccionEntrega: cat.idDireccionEntrega,
});

/** Una OC en borrador, creada por el camino real. */
async function ocNueva(): Promise<number> {
  const oc = await crearOC(
    sesion(ADMIN_OC),
    { ...encabezadoOc(), idProveedor: cat.idProveedor, lineas: [] },
    bd(),
  );
  return oc.id;
}

/** Una nota de salida en BORRADOR, creada por el camino real. */
async function notaNueva(): Promise<number> {
  const nota = await crearNotaSalida(
    sesion(ADMIN_NOTAS),
    {
      idMaquilero: cat.idProveedor,
      idAlmacen: cat.idAlmacenAvio,
      fechaElaboracion: '2026-06-21',
      lineas: [{ idOrden: cat.idOrden, idAvio: cat.idAvio, cantidad: 5, unidad: 'pza' }],
    },
    bd(),
  );
  return nota.id;
}

/** Un pedido interno con UN renglón, creado por el camino real. */
async function pedidoNuevo(): Promise<number> {
  const pedido = await crearPedido(
    sesion(ADMIN_PEDIDOS),
    {
      idCliente: cat.idClienteNegocio,
      lineas: [{ idModelo: cat.idModelo, cantidadPedida: 10, precio: 50 }],
    },
    bd(),
    archivos,
  );
  return pedido.id;
}

/** Un proyecto de desarrollo, creado por el camino real (consume folio de la secuencia). */
async function proyectoNuevo(nombre = 'Joggers'): Promise<number> {
  const proyecto = await crearProyecto(
    sesion(ADMIN_DESARROLLO),
    {
      idCliente: cat.idClienteNegocio,
      idClienteDepartamento: cat.idDepartamento,
      nombre,
    },
    bd(),
  );
  return proyecto.id;
}

/** Deja `cantidad` piezas del avío en el almacén (setup: NO es lo que se mide). */
async function sembrarAvio(cantidad: number): Promise<void> {
  const tipoEntrada = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'ajuste-entrada' },
  });
  await ajustarInventarioAvio(
    sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['inventario-avios.mover', 'inventario-avios.ver'],
    }),
    {
      idTipoMov: tipoEntrada.id,
      idAlmacen: cat.idAlmacenAvio,
      fecha: '2026-06-21',
      motivo: 'Conteo inicial de prueba',
      lineas: [{ idAvio: cat.idAvio, cantidad }],
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
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra SA (eco 0.197)');

  const clienteNegocio = await cliente.cliente.create({
    data: { nombre: 'C&A', abreviatura: 'CYA' },
  });
  const departamento = await cliente.clienteDepartamento.create({
    data: { idCliente: clienteNegocio.id, nombre: 'NIÑOS' },
  });
  // Modelo BASE: sin arte (prenda lisa) y con receta de avíos, para que el estado derivado de la
  // orden no dependa de un requisito que esta fila no mide.
  const modelo = await cliente.modelo.create({
    data: { codigo: 'A-100', descripcion: 'Playera', llevaArte: false },
  });
  const modeloDesarrollo = await cliente.modelo.create({
    data: { codigo: 'B-200', descripcion: 'Jogger', llevaArte: false },
  });
  const avio = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  await cliente.modeloAvio.create({
    data: { idModelo: modelo.id, idAvio: avio.id, consumoPorPrenda: 1, paraProduccion: true },
  });

  const pedidoOrigen = await cliente.pedido.create({
    data: { folio: 9_001n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
  });
  const pedidoLinea = await cliente.pedidoLinea.create({
    data: { idPedido: pedidoOrigen.id, idModelo: modelo.id, cantidadPedida: 100, precio: 50 },
  });

  const orden = await cliente.orden.create({
    data: {
      folio: 9_101n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
    },
  });

  const proveedor = await cliente.proveedor.create({ data: { nombre: 'Telas del Norte' } });
  const direccionEntrega = await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  const tela = await cliente.tela.create({ data: { nombre: 'Felpa' } });
  const almacenAvio = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'AVIO' } });
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'salida-por-nota', nombre: 'Salida de Avío por Nota', direccion: 'salida' },
    ],
  });

  const tipoProducto = await cliente.tipoProducto.create({
    data: { nombre: 'Pantalón', digitoConcepto: 7 },
  });
  const genero = await cliente.genero.create({
    data: { nombre: 'Caballero', digitoNomenclatura: 1, digitoAlterno: 5 },
  });

  cat = {
    idClienteNegocio: clienteNegocio.id,
    idDepartamento: departamento.id,
    idModelo: modelo.id,
    idModeloDesarrollo: modeloDesarrollo.id,
    idPedidoLinea: pedidoLinea.id,
    idOrden: orden.id,
    idProveedor: proveedor.id,
    idDireccionEntrega: direccionEntrega.id,
    idTela: tela.id,
    idAvio: avio.id,
    idAlmacenAvio: almacenAvio.id,
    idTipoProducto: tipoProducto.id,
    idGenero: genero.id,
  };
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  (a) CREAN DOCUMENTO CON FOLIO — repetir dejaría un DUPLICADO con su folio quemado
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('El eco de las escrituras con folio (fila 0.197, grupo a)', () => {
  it('`crearOrden` contesta su orden sin `ordenes.ver` (y el folio del eco es el de la base)', async () => {
    const creada = await crearOrden(
      sesion(ADMIN_ORDENES),
      { idPedidoLinea: cat.idPedidoLinea },
      bd(),
    );

    const enBd = await cliente.orden.findUniqueOrThrow({ where: { id: creada.id } });
    expect(Number(enBd.folio)).toBe(creada.folio);
  });

  it('`crearOC` contesta su OC sin `compras.ver`', async () => {
    const oc = await crearOC(
      sesion(ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: cat.idProveedor,
        lineas: [{ idTela: cat.idTela, cantidad: 10, precio: 25, unidad: 'm' }],
      },
      bd(),
    );

    expect(oc.numCompra).toBe(1);
  });

  it('`crearNotaSalida` contesta su nota sin `notas.ver`', async () => {
    const nota = await crearNotaSalida(
      sesion(ADMIN_NOTAS),
      {
        idMaquilero: cat.idProveedor,
        idAlmacen: cat.idAlmacenAvio,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: cat.idOrden, idAvio: cat.idAvio, cantidad: 5, unidad: 'pza' }],
      },
      bd(),
    );

    expect(nota.numNota).toBe(1);
  });

  it('`crearPedido` contesta su pedido sin `pedidos.ver`', async () => {
    const pedido = await crearPedido(
      sesion(ADMIN_PEDIDOS),
      {
        idCliente: cat.idClienteNegocio,
        lineas: [{ idModelo: cat.idModelo, cantidadPedida: 10, precio: 50 }],
      },
      bd(),
      archivos,
    );

    expect(pedido.lineas).toHaveLength(1);
  });

  it('`copiarPedido` contesta la copia sin `pedidos.ver`', async () => {
    const idOriginal = await pedidoNuevo();

    const copia = await copiarPedido(sesion(ADMIN_PEDIDOS), idOriginal, {}, bd(), archivos);

    expect(copia.id).not.toBe(idOriginal);
  });

  it('`crearPedidoReal` contesta su pedido real sin `pedidos.ver`', async () => {
    const idPedido = await pedidoNuevo();

    const real = await crearPedidoReal(
      sesion(ADMIN_REALES),
      idPedido,
      { cedis: 'CEDIS Norte' },
      bd(),
    );

    expect(real.cedis).toBe('CEDIS Norte');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  (b) CAMBIAN ESTADO PUBLICANDO EVENTO — repetir da un 409 de estado, con el evento ya fuera
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('El eco de los cambios de estado con evento (fila 0.197, grupo b)', () => {
  it('`autorizarOC` contesta la OC autorizada sin `compras.ver`', async () => {
    const idOc = await ocNueva();

    const autorizada = await autorizarOC(sesion(AUTORIZA_OC), idOc, bd());

    expect(autorizada.estatus).toBe('autorizada');
  });

  it('`desautorizarOC` contesta la OC devuelta a borrador sin `compras.ver`', async () => {
    const idOc = await ocNueva();
    await autorizarOC(sesion(AUTORIZA_OC), idOc, bd());

    const devuelta = await desautorizarOC(
      sesion(DESAUTORIZA_OC),
      idOc,
      { motivo: 'se pidió de más' },
      bd(),
    );

    expect(devuelta.estatus).toBe('borrador');
  });

  it('`cancelarOC` contesta la OC cancelada sin `compras.ver`', async () => {
    const idOc = await ocNueva();

    const cancelada = await cancelarOC(
      sesion(CANCELA_OC),
      idOc,
      { motivo: 'el proveedor no surtió' },
      bd(),
    );

    expect(cancelada.estatus).toBe('cancelada');
  });

  it('`confirmarNotaSalida` contesta la nota confirmada sin `notas.ver`', async () => {
    await sembrarAvio(100);
    const idNota = await notaNueva();

    const confirmada = await confirmarNotaSalida(sesion(ADMIN_NOTAS), idNota, bd());

    expect(confirmada.estatus).toBe('confirmada');
  });

  it('`cancelarNotaSalida` contesta la nota cancelada sin `notas.ver`', async () => {
    const idNota = await notaNueva();

    const cancelada = await cancelarNotaSalida(
      sesion(CANCELA_NOTAS),
      idNota,
      { motivo: 'se surtió de otro almacén' },
      bd(),
    );

    expect(cancelada.canceladaEn).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  (c) CANCELACIONES CON EFECTO DE NEGOCIO
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('El eco de las cancelaciones con efecto (fila 0.197, grupo c)', () => {
  it('`cancelarOrden` contesta la orden cancelada sin `ordenes.ver`', async () => {
    const cancelada = await cancelarOrden(
      sesion(CANCELA_ORDENES),
      cat.idOrden,
      { motivo: 'el cliente bajó el pedido' },
      bd(),
    );

    expect(cancelada.estado).toBe('cancelada');
  });

  it('`cancelarPedido` contesta el pedido cancelado sin `pedidos.ver`', async () => {
    const idPedido = await pedidoNuevo();

    const desenlace = await cancelarPedido(sesion(ADMIN_PEDIDOS), idPedido, {}, bd(), archivos);

    expect(desenlace.pedido.pedCancelado).toBe(true);
  });

  it('`cancelarPedidoReal` contesta el pedido real cancelado sin `pedidos.ver`', async () => {
    const idPedido = await pedidoNuevo();
    const real = await crearPedidoReal(sesion(ADMIN_REALES), idPedido, {}, bd());

    const cancelado = await cancelarPedidoReal(
      sesion(ADMIN_REALES),
      real.id,
      { motivo: 'se adelantó la entrega' },
      bd(),
    );

    expect(cancelado.cancelado).toBe(true);
  });

  it('`forzarOrdenPagada` contesta el override sin `esma.ver-pagos` (dos llaves de módulos distintos)', async () => {
    const forzada = await forzarOrdenPagada(
      sesion(MODIFICA_ESMA),
      cat.idOrden,
      { pagadaForzada: true },
      bd(),
    );

    expect(forzada.pagada).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  (d) LAS CINCO QUE CREAN FILA
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('El eco de las altas que crean fila (fila 0.197, grupo d)', () => {
  it('`crearDesarrollo` contesta su desarrollo sin `desarrollo.ver`', async () => {
    const idProyecto = await proyectoNuevo();

    const desarrollo = await crearDesarrollo(
      sesion(ADMIN_DESARROLLO),
      idProyecto,
      { idModelo: cat.idModeloDesarrollo, numeroCliente: 'CLI-77' },
      bd(),
    );

    expect(desarrollo.idModelo).toBe(cat.idModeloDesarrollo);
  });

  it('`crearDesarrolloConModeloNuevo` contesta su desarrollo sin `desarrollo.ver`', async () => {
    const idProyecto = await proyectoNuevo();

    const desarrollo = await crearDesarrolloConModeloNuevo(
      sesion(ADMIN_DESARROLLO_Y_MODELOS),
      idProyecto,
      {
        anioEntrega: 2026,
        idTipoProducto: cat.idTipoProducto,
        idGenero: cat.idGenero,
        descripcion: 'Jogger felpa',
      },
      bd(),
    );

    expect(desarrollo.codigoModelo).toBe('CYA-26-71-001');
  });

  it('`crearProyecto` contesta su proyecto sin `desarrollo.ver` (y con el folio que quemó)', async () => {
    const proyecto = await crearProyecto(
      sesion(ADMIN_DESARROLLO),
      {
        idCliente: cat.idClienteNegocio,
        idClienteDepartamento: cat.idDepartamento,
        nombre: 'Joggers',
      },
      bd(),
    );

    expect(proyecto.folio).toBe(1);
  });

  it('`crearConceptoPago` contesta su concepto sin `conceptos-pago.ver`', async () => {
    const concepto = await crearConceptoPago(
      sesion(ADMIN_CONCEPTOS),
      { nombre: 'Luz', rubro: 'servicios' },
      bd(),
    );

    expect(concepto.nombre).toBe('Luz');
  });

  it('`agregarComentarioOrden` contesta la orden con su comentario sin `ordenes.ver`', async () => {
    const conComentario = await agregarComentarioOrden(
      sesion(ADMIN_ORDENES),
      cat.idOrden,
      { comentario: 'falta la tela del forro' },
      bd(),
    );

    expect(conComentario.comentarios).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  LA OTRA MITAD: ninguna reja se aflojó. La consulta suelta sigue pidiendo su llave.
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('La consulta suelta SIGUE cerrada (fila 0.197): el arreglo no abrió ninguna puerta', () => {
  it('`obtenerOrden` niega a quien sólo administra órdenes', async () => {
    await expect(obtenerOrden(sesion(ADMIN_ORDENES), cat.idOrden, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('`obtenerOC` niega a quien sólo administra compras', async () => {
    const idOc = await ocNueva();
    await expect(obtenerOC(sesion(ADMIN_OC), idOc, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('`obtenerNotaSalida` niega a quien sólo administra notas', async () => {
    const idNota = await notaNueva();
    await expect(obtenerNotaSalida(sesion(ADMIN_NOTAS), idNota, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('`obtenerPedido` niega a quien sólo administra pedidos', async () => {
    const idPedido = await pedidoNuevo();
    await expect(
      obtenerPedido(sesion(ADMIN_PEDIDOS), idPedido, bd(), archivos),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('`obtenerPedidoReal` niega a quien sólo administra pedidos reales', async () => {
    const idPedido = await pedidoNuevo();
    const real = await crearPedidoReal(sesion(ADMIN_REALES), idPedido, {}, bd());
    await expect(obtenerPedidoReal(sesion(ADMIN_REALES), real.id, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('`obtenerOrdenPagada` niega a quien sólo modifica EsMa', async () => {
    await expect(
      obtenerOrdenPagada(sesion(MODIFICA_ESMA), cat.idOrden, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('`obtenerDesarrollo` niega a quien sólo administra desarrollo', async () => {
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(
      sesion(ADMIN_DESARROLLO),
      idProyecto,
      { idModelo: cat.idModeloDesarrollo },
      bd(),
    );
    await expect(
      obtenerDesarrollo(sesion(ADMIN_DESARROLLO), desarrollo.id, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('`obtenerProyecto` niega a quien sólo administra desarrollo', async () => {
    const idProyecto = await proyectoNuevo();
    await expect(
      obtenerProyecto(sesion(ADMIN_DESARROLLO), idProyecto, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('`obtenerConceptoPago` niega a quien sólo administra conceptos', async () => {
    const concepto = await crearConceptoPago(
      sesion(ADMIN_CONCEPTOS),
      { nombre: 'Luz', rubro: 'servicios' },
      bd(),
    );
    await expect(
      obtenerConceptoPago(sesion(ADMIN_CONCEPTOS), concepto.id, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  A9: la proyectora NO es una puerta trasera a los datos de otra empresa (produce 404, no fuga).
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('Las proyectoras conservan el scope por empresa activa (A9, fila 0.197)', () => {
  it('`proyectarOrden`: una orden de otra empresa "no existe"', async () => {
    await expect(
      proyectarOrden(sesionAjena(ADMIN_ORDENES), cat.idOrden, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('`proyectarOC`: una OC de otra empresa "no existe"', async () => {
    const idOc = await ocNueva();
    await expect(proyectarOC(sesionAjena(ADMIN_OC), idOc, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('`proyectarNotaSalida`: una nota de otra empresa "no existe"', async () => {
    const idNota = await notaNueva();
    await expect(
      proyectarNotaSalida(sesionAjena(ADMIN_NOTAS), idNota, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('`proyectarPedido`: un pedido de otra empresa "no existe"', async () => {
    const idPedido = await pedidoNuevo();
    await expect(
      proyectarPedido(sesionAjena(ADMIN_PEDIDOS), idPedido, bd(), archivos),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('`proyectarPedidoReal`: un pedido real de otra empresa "no existe" (A9 por el pedido padre)', async () => {
    const idPedido = await pedidoNuevo();
    const real = await crearPedidoReal(sesion(ADMIN_REALES), idPedido, {}, bd());
    await expect(
      proyectarPedidoReal(sesionAjena(ADMIN_REALES), real.id, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('`proyectarOrdenPagada`: una orden de otra empresa "no existe"', async () => {
    await expect(
      proyectarOrdenPagada(sesionAjena(MODIFICA_ESMA), cat.idOrden, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('`proyectarDesarrollo`: un desarrollo de otra empresa "no existe" (A9 por el proyecto)', async () => {
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(
      sesion(ADMIN_DESARROLLO),
      idProyecto,
      { idModelo: cat.idModeloDesarrollo },
      bd(),
    );
    await expect(
      proyectarDesarrollo(sesionAjena(ADMIN_DESARROLLO), desarrollo.id, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('`proyectarProyecto`: un proyecto de otra empresa "no existe"', async () => {
    const idProyecto = await proyectoNuevo();
    await expect(
      proyectarProyecto(sesionAjena(ADMIN_DESARROLLO), idProyecto, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('`proyectarConceptoPago` NO filtra por empresa, y es correcto: el catálogo es GLOBAL (A9/ADR-0007)', async () => {
    const concepto = await crearConceptoPago(
      sesion(ADMIN_CONCEPTOS),
      { nombre: 'Luz', rubro: 'servicios' },
      bd(),
    );

    // Un concepto de pago no tiene `idEmpresa` que filtrar —igual que el resto de los catálogos de
    // F1—, así que una sesión parada en otra empresa lo ve. Se afirma A PROPÓSITO para que el día
    // que el catálogo se parta por empresa esta prueba caiga y obligue a revisar la proyectora.
    await expect(
      proyectarConceptoPago(sesionAjena(ADMIN_CONCEPTOS), concepto.id, bd()),
    ).resolves.toMatchObject({ id: concepto.id });
  });
});
