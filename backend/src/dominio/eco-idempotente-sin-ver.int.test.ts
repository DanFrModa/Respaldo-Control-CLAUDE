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

import { actualizarConceptoPago, crearConceptoPago } from './catalogos/conceptos-pago.js';
import { actualizarOC, crearOC } from './compras/ordenes-compra.js';
import {
  actualizarDesarrollo,
  apagarDesarrollo,
  crearDesarrollo,
  reactivarDesarrollo,
} from './desarrollo/desarrollos.js';
import {
  actualizarProyecto,
  archivarProyecto,
  crearProyecto,
  desarchivarProyecto,
} from './desarrollo/proyectos.js';
import { actualizarEncabezado, calcularEdr, generarEdrMes, proyectarEdr } from './edr/edr.js';
import { actualizarNotaSalida, crearNotaSalida } from './notas/notas-salida.js';
import { actualizarPedido, crearPedido } from './pedidos/pedidos.js';
import {
  actualizarPedidoReal,
  actualizarSeguimientoPedidoReal,
  crearPedidoReal,
} from './pedidos/pedidos-reales.js';
import {
  actualizarOrden,
  copiarDetalleOrden,
  guardarMatrizOrden,
  guardarReferenciasOrden,
} from './produccion/ordenes.js';
import {
  actualizarPreciosOrden,
  obtenerPreciosOrden,
  proyectarPreciosOrden,
} from './produccion/precios-orden.js';

/**
 * ⭐ Integración de «ESCRIBIR Y LUEGO NEGAR» en LO IDEMPOTENTE DE VERDAD (fila 0.198).
 *
 * Lo que aquí se mide es UNA frase: **lo que el sistema le contesta a quien edita dice lo mismo que
 * lo que quedó guardado** — en los DIECINUEVE sitios de esta fila. Hasta aquí los diecinueve abrían
 * con SU permiso de escritura (`ordenes.administrar`, `ordenes.precio-maquila`,
 * `compras.administrar`, `notas.administrar`, `pedidos.administrar`, `pedidos-reales.administrar`,
 * `desarrollo.administrar`, `conceptos-pago.administrar`, `edr.capturar`), escribían —transacción
 * CERRADA— y DESPUÉS proyectaban la respuesta con una consulta que exige OTRA llave (`ordenes.ver`,
 * `compras.ver`, `notas.ver`, `pedidos.ver`, `desarrollo.ver`, `conceptos-pago.ver`, `edr.ver`) ⇒
 * quien llevara la de escribir y no la de consultar recibía un **403 con el cambio ya guardado**.
 *
 * 📌 **Por qué esta fila es la de «lo idempotente»**, y en qué se diferencia de sus dos hermanas: son
 * PATCH/PUT que **no estampan folio ni publican evento**, así que reintentar tras el 403 no deja
 * documento de más ni evento duplicado. El daño se queda en que la pantalla dice «no tienes permiso»
 * sobre algo que **sí** se guardó — el sistema informando mal sobre su propio estado.
 *
 * Es la hermana de `dominio/eco-sin-ver.int.test.ts` (fila 0.197) y sigue su forma. Dieciséis de los
 * diecinueve reusan una proyectora que la 0.197 ya había extraído; los otros tres estrenan
 * {@link proyectarEdr} y {@link proyectarPreciosOrden}.
 *
 * 🔑 **POR QUÉ ESTA MITAD EXISTE, y no basta con la del API** (la trampa que documenta la 0.195):
 * por HTTP el 403 de la consulta suelta lo da el `preHandler`, así que quitarle el
 * `verificarPermiso` a una consulta **NO pone roja ninguna prueba de ruta** — el API seguiría verde
 * con la reja abierta de par en par. Aquí se llama al dominio a pelo, sin ruta de por medio, y por
 * eso los tres bloques se sostienen entre sí:
 *  - **el ECO**: cada escritura, con una sesión que NO lleva la llave de ver, devuelve su DTO;
 *  - **la REJA**: las dos consultas sueltas NUEVAS de esta fila (`calcularEdr`, `obtenerPreciosOrden`)
 *    siguen negando con ESA MISMA sesión (las otras siete las cubre el archivo de la 0.197);
 *  - **A9**: `proyectarPreciosOrden` conserva el filtro por empresa activa; `proyectarEdr` NO lo
 *    lleva, y eso se afirma A PROPÓSITO porque el EDR es global por mes.
 *
 * La mitad de PUERTA (que el `preHandler` de la consulta suelta no se volvió decorativo) la mide
 * `api/edicion-sin-ver.int.test.ts`.
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
const PRECIO_MAQUILA: ClavePermiso[] = ['ordenes.precio-maquila'];
const ADMIN_OC: ClavePermiso[] = ['compras.administrar'];
const ADMIN_NOTAS: ClavePermiso[] = ['notas.administrar'];
const ADMIN_PEDIDOS: ClavePermiso[] = ['pedidos.administrar'];
const ADMIN_REALES: ClavePermiso[] = ['pedidos-reales.administrar'];
const ADMIN_DESARROLLO: ClavePermiso[] = ['desarrollo.administrar'];
const ADMIN_CONCEPTOS: ClavePermiso[] = ['conceptos-pago.administrar'];
const CAPTURA_EDR: ClavePermiso[] = ['edr.capturar'];

// ── Datos de apoyo (se rehacen en cada test: `limpiarBaseDatos` vacía todo) ─────────────────────

interface Catalogos {
  idClienteNegocio: number;
  idDepartamento: number;
  idModelo: number;
  idModeloDesarrollo: number;
  idPedidoLinea: number;
  idOrden: number;
  idOrdenOrigen: number;
  idProveedor: number;
  idDireccionEntrega: number;
  idAvio: number;
  idAlmacenAvio: number;
  idColor: number;
  idTalla: number;
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
    { idCliente: cat.idClienteNegocio, idClienteDepartamento: cat.idDepartamento, nombre },
    bd(),
  );
  return proyecto.id;
}

/** Un desarrollo colgando de un proyecto nuevo, creado por el camino real. */
async function desarrolloNuevo(): Promise<number> {
  const idProyecto = await proyectoNuevo();
  const desarrollo = await crearDesarrollo(
    sesion(ADMIN_DESARROLLO),
    idProyecto,
    { idModelo: cat.idModeloDesarrollo },
    bd(),
  );
  return desarrollo.id;
}

/** El encabezado del EDR de un mes, creado por el camino real (`generarEdrMes` es idempotente). */
async function edrDelMes(anio = 2026, mes = 6): Promise<number> {
  await generarEdrMes(sesion(CAPTURA_EDR), anio, mes, bd());
  const edr = await cliente.edr.findFirstOrThrow({ where: { anio, mes }, select: { id: true } });
  return edr.id;
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
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra SA (eco 0.198)');

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
  // Segunda orden: es de la que `copiarDetalleOrden` copia la matriz.
  const ordenOrigen = await cliente.orden.create({
    data: {
      folio: 9_102n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
    },
  });

  const proveedor = await cliente.proveedor.create({ data: { nombre: 'Telas del Norte' } });
  const direccionEntrega = await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  const almacenAvio = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'AVIO' } });
  // La matriz color × talla (D4) NO la siembra el seed: se crea aquí para `guardarMatrizOrden`.
  const color = await cliente.color.create({ data: { nombre: 'Negro' } });
  const talla = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });

  cat = {
    idClienteNegocio: clienteNegocio.id,
    idDepartamento: departamento.id,
    idModelo: modelo.id,
    idModeloDesarrollo: modeloDesarrollo.id,
    idPedidoLinea: pedidoLinea.id,
    idOrden: orden.id,
    idOrdenOrigen: ordenOrigen.id,
    idProveedor: proveedor.id,
    idDireccionEntrega: direccionEntrega.id,
    idAvio: avio.id,
    idAlmacenAvio: almacenAvio.id,
    idColor: color.id,
    idTalla: talla.id,
  };
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  (a) LA ORDEN DE PRODUCCIÓN — cuatro ediciones, todas con `ordenes.administrar`
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('El eco de las ediciones de la orden (fila 0.198, grupo a)', () => {
  it('`actualizarOrden` contesta la orden editada sin `ordenes.ver`', async () => {
    const editada = await actualizarOrden(
      sesion(ADMIN_ORDENES),
      { id: cat.idOrden, observaciones: 'entra por la puerta 3' },
      bd(),
    );

    expect(editada.observaciones).toBe('entra por la puerta 3');
  });

  it('`actualizarOrden`: lo contestado dice LO MISMO que lo guardado', async () => {
    const editada = await actualizarOrden(
      sesion(ADMIN_ORDENES),
      { id: cat.idOrden, observaciones: 'entra por la puerta 3' },
      bd(),
    );

    const enBd = await cliente.orden.findUniqueOrThrow({ where: { id: cat.idOrden } });
    expect(enBd.observaciones).toBe(editada.observaciones);
  });

  it('`guardarMatrizOrden` contesta la orden con su matriz sin `ordenes.ver`', async () => {
    const conMatriz = await guardarMatrizOrden(
      sesion(ADMIN_ORDENES),
      cat.idOrden,
      { lineas: [{ idColor: cat.idColor, tallas: [{ idTalla: cat.idTalla, cantidad: 30 }] }] },
      bd(),
    );

    expect(conMatriz.lineas).toHaveLength(1);
  });

  it('`copiarDetalleOrden` contesta la orden destino sin `ordenes.ver`', async () => {
    await guardarMatrizOrden(
      sesion(ADMIN_ORDENES),
      cat.idOrdenOrigen,
      { lineas: [{ idColor: cat.idColor, tallas: [{ idTalla: cat.idTalla, cantidad: 30 }] }] },
      bd(),
    );

    const copiada = await copiarDetalleOrden(
      sesion(ADMIN_ORDENES),
      cat.idOrden,
      { idOrdenOrigen: cat.idOrdenOrigen },
      bd(),
    );

    expect(copiada.lineas).toHaveLength(1);
  });

  it('`guardarReferenciasOrden` contesta la orden con sus referencias sin `ordenes.ver`', async () => {
    const campo = await cliente.clienteCampo.create({
      data: { idCliente: cat.idClienteNegocio, etiqueta: 'Nº de orden' },
    });

    const conReferencias = await guardarReferenciasOrden(
      sesion(ADMIN_ORDENES),
      cat.idOrden,
      { referencias: [{ idClienteCampo: campo.id, valor: 'OC-778' }] },
      bd(),
    );

    expect(conReferencias.referencias).toHaveLength(1);
  });

  it('`actualizarPreciosOrden` contesta el resumen sin `ordenes.ver` (la llave que escribe es `ordenes.precio-maquila`)', async () => {
    const resumen = await actualizarPreciosOrden(
      sesion(PRECIO_MAQUILA),
      cat.idOrden,
      { campo: 'maquila', precio: 12.5 },
      bd(),
    );

    expect(resumen.idOrden).toBe(cat.idOrden);
  });

  it('`actualizarPreciosOrden`: quien capturó ve LO QUE ACABA DE TECLEAR aunque no vea los reales', async () => {
    const resumen = await actualizarPreciosOrden(
      sesion(PRECIO_MAQUILA),
      cat.idOrden,
      { campo: 'maquila', precio: 12.5 },
      bd(),
    );

    // La redacción blanda (`ordenes.ver-precio-real-maquila`) NO es la reja y se conserva: lo que se
    // devuelve es el monto que él mismo escribió, no una fuga de los demás.
    expect(resumen.maquilaReal).toBe(12.5);
  });

  it('`actualizarPreciosOrden`: el monto que NO capturó sigue oculto sin `ordenes.ver-precio-real-maquila`', async () => {
    await cliente.orden.update({
      where: { id: cat.idOrden },
      data: { aplicacionOrd: 9.75 },
    });

    const resumen = await actualizarPreciosOrden(
      sesion(PRECIO_MAQUILA),
      cat.idOrden,
      { campo: 'maquila', precio: 12.5 },
      bd(),
    );

    expect(resumen.aplicacionReal).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  (b) LOS DOCUMENTOS EN BORRADOR — compras, notas y pedidos
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('El eco de las ediciones de documentos (fila 0.198, grupo b)', () => {
  it('`actualizarOC` contesta la OC editada sin `compras.ver`', async () => {
    const idOc = await ocNueva();

    const editada = await actualizarOC(
      sesion(ADMIN_OC),
      idOc,
      { observaciones: 'urge para el lunes' },
      bd(),
    );

    expect(editada.observaciones).toBe('urge para el lunes');
  });

  it('`actualizarNotaSalida` contesta la nota editada sin `notas.ver`', async () => {
    const idNota = await notaNueva();

    const editada = await actualizarNotaSalida(
      sesion(ADMIN_NOTAS),
      idNota,
      { observaciones: 'va con el chofer de la tarde' },
      bd(),
    );

    expect(editada.observaciones).toBe('va con el chofer de la tarde');
  });

  it('`actualizarPedido` contesta el pedido editado sin `pedidos.ver`', async () => {
    const idPedido = await pedidoNuevo();

    const editado = await actualizarPedido(
      sesion(ADMIN_PEDIDOS),
      { id: idPedido, ocCliente: 'OC-4455' },
      bd(),
      archivos,
    );

    expect(editado.ocCliente).toBe('OC-4455');
  });

  it('`actualizarPedidoReal` contesta el pedido real editado sin `pedidos.ver`', async () => {
    const idPedido = await pedidoNuevo();
    const real = await crearPedidoReal(sesion(ADMIN_REALES), idPedido, {}, bd());

    const editado = await actualizarPedidoReal(
      sesion(ADMIN_REALES),
      real.id,
      { cedis: 'CEDIS Sur' },
      bd(),
    );

    expect(editado.cedis).toBe('CEDIS Sur');
  });

  it('`actualizarSeguimientoPedidoReal` contesta el pedido real con su captura sin `pedidos.ver`', async () => {
    const idPedido = await pedidoNuevo();
    const real = await crearPedidoReal(sesion(ADMIN_REALES), idPedido, {}, bd());

    const renglon = real.lineas[0];
    expect(renglon).toBeDefined();

    const conSeguimiento = await actualizarSeguimientoPedidoReal(
      sesion(ADMIN_REALES),
      real.id,
      { lineas: [{ id: renglon!.id, cantidadEnviada: 7 }] },
      bd(),
    );

    expect(conSeguimiento.lineas[0]?.cantidadEnviada).toBe(7);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  (c) DESARROLLO — seis ediciones con la MISMA llave (`desarrollo.administrar`)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('El eco de las ediciones de Desarrollo (fila 0.198, grupo c)', () => {
  it('`actualizarDesarrollo` contesta el desarrollo editado sin `desarrollo.ver`', async () => {
    const id = await desarrolloNuevo();

    const editado = await actualizarDesarrollo(
      sesion(ADMIN_DESARROLLO),
      id,
      { numeroCliente: 'CLI-99' },
      bd(),
    );

    expect(editado.numeroCliente).toBe('CLI-99');
  });

  it('`apagarDesarrollo` contesta el desarrollo apagado sin `desarrollo.ver`', async () => {
    const id = await desarrolloNuevo();

    const apagado = await apagarDesarrollo(
      sesion(ADMIN_DESARROLLO),
      id,
      { motivo: 'el cliente lo descartó' },
      bd(),
    );

    expect(apagado.apagado).toBe(true);
  });

  it('`reactivarDesarrollo` contesta el desarrollo revivido sin `desarrollo.ver`', async () => {
    const id = await desarrolloNuevo();
    await apagarDesarrollo(sesion(ADMIN_DESARROLLO), id, { motivo: 'se pausó' }, bd());

    const revivido = await reactivarDesarrollo(sesion(ADMIN_DESARROLLO), id, bd());

    expect(revivido.apagado).toBe(false);
  });

  it('`actualizarProyecto` contesta el proyecto editado sin `desarrollo.ver`', async () => {
    const id = await proyectoNuevo();

    const editado = await actualizarProyecto(
      sesion(ADMIN_DESARROLLO),
      id,
      { nombre: 'Joggers felpa' },
      bd(),
    );

    expect(editado.nombre).toBe('Joggers felpa');
  });

  it('`archivarProyecto` contesta el proyecto archivado sin `desarrollo.ver`', async () => {
    const id = await proyectoNuevo();

    const archivado = await archivarProyecto(sesion(ADMIN_DESARROLLO), id, bd());

    expect(archivado.archivado).toBe(true);
  });

  it('`desarchivarProyecto` contesta el proyecto devuelto a la mesa sin `desarrollo.ver`', async () => {
    const id = await proyectoNuevo();
    await archivarProyecto(sesion(ADMIN_DESARROLLO), id, bd());

    const devuelto = await desarchivarProyecto(sesion(ADMIN_DESARROLLO), id, bd());

    expect(devuelto.archivado).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  (d) LAS DOS LLAVES DE MÓDULOS APARTE — catálogo de conceptos y Estado de Resultados
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('El eco del catálogo y del EDR (fila 0.198, grupo d)', () => {
  it('`actualizarConceptoPago` contesta el concepto editado sin `conceptos-pago.ver`', async () => {
    const concepto = await crearConceptoPago(
      sesion(ADMIN_CONCEPTOS),
      { nombre: 'Luz', rubro: 'servicios' },
      bd(),
    );

    const editado = await actualizarConceptoPago(
      sesion(ADMIN_CONCEPTOS),
      concepto.id,
      { nombre: 'Luz y agua' },
      bd(),
    );

    expect(editado.nombre).toBe('Luz y agua');
  });

  it('`generarEdrMes` contesta el EDR del mes sin `edr.ver`', async () => {
    const generado = await generarEdrMes(sesion(CAPTURA_EDR), 2026, 6, bd());

    expect(generado.encabezado.mes).toBe(6);
  });

  it('`generarEdrMes` es IDEMPOTENTE: la segunda corrida contesta el MISMO encabezado', async () => {
    const primera = await generarEdrMes(sesion(CAPTURA_EDR), 2026, 6, bd());

    const segunda = await generarEdrMes(sesion(CAPTURA_EDR), 2026, 6, bd());

    expect(segunda.encabezado.id).toBe(primera.encabezado.id);
  });

  it('`actualizarEncabezado` contesta el EDR recalculado sin `edr.ver`', async () => {
    const idEdr = await edrDelMes();

    const editado = await actualizarEncabezado(
      sesion(CAPTURA_EDR),
      idEdr,
      { gastos: 1500, descOtros: 'fletes' },
      bd(),
    );

    expect(editado.gastos).toBe(1500);
  });

  it('`actualizarEncabezado`: lo contestado dice LO MISMO que lo guardado', async () => {
    const idEdr = await edrDelMes();

    const editado = await actualizarEncabezado(sesion(CAPTURA_EDR), idEdr, { gastos: 1500 }, bd());

    const enBd = await cliente.edr.findUniqueOrThrow({ where: { id: idEdr } });
    expect(enBd.gastos.toNumber()).toBe(editado.gastos);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  LA OTRA MITAD: ninguna reja se aflojó. Las dos consultas NUEVAS siguen pidiendo su llave.
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('La consulta suelta SIGUE cerrada (fila 0.198): el arreglo no abrió ninguna puerta', () => {
  it('`calcularEdr` niega a quien sólo captura el EDR', async () => {
    const idEdr = await edrDelMes();

    await expect(calcularEdr(sesion(CAPTURA_EDR), idEdr, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('`obtenerPreciosOrden` niega a quien sólo captura el precio de maquila', async () => {
    await expect(
      obtenerPreciosOrden(sesion(PRECIO_MAQUILA), cat.idOrden, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  A9: la proyectora NO es una puerta trasera a los datos de otra empresa (produce 404, no fuga).
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('Las proyectoras NUEVAS y el scope por empresa activa (A9, fila 0.198)', () => {
  it('`proyectarPreciosOrden`: una orden de otra empresa "no existe"', async () => {
    await expect(
      proyectarPreciosOrden(sesionAjena(PRECIO_MAQUILA), cat.idOrden, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('`proyectarEdr` NO filtra por empresa, y es correcto: el EDR es GLOBAL por mes (D2 #6)', async () => {
    const idEdr = await edrDelMes();

    // El encabezado `Edr` no lleva `idEmpresa` —el corte por empresa se DERIVA de sus líneas—, así
    // que una sesión parada en otra empresa lo ve. Se afirma A PROPÓSITO para que el día que el EDR
    // se parta por empresa esta prueba caiga y obligue a revisar la proyectora.
    await expect(proyectarEdr(sesionAjena(CAPTURA_EDR), idEdr, bd())).resolves.toMatchObject({
      encabezado: { id: idEdr },
    });
  });

  it('`proyectarEdr`: un EDR que no existe sigue dando 404 (la proyectora no inventa encabezados)', async () => {
    await expect(proyectarEdr(sesion(CAPTURA_EDR), 999_999, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});
