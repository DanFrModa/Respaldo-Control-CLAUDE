/**
 * ⭐⭐ 0.226a (§Post-F9.244) — «CERRADA» BLOQUEA DE VERDAD: las puertas, las excepciones y la carrera.
 * Postgres efímero (testcontainers en CI; Postgres nativo en local).
 *
 * Tres cosas se amarran aquí, contra la BASE:
 *
 *  1. **Cada puerta (A) del peinado rechaza una orden CERRADA** con `ErrorOrdenCerrada` (que ES un
 *     `ErrorConflicto`: 409, contrato intacto). Las de 0.061 (corte, envío, recibo, entrega, matriz,
 *     precios…) ya tienen su prueba en `transito.int.test.ts` y `costos.int.test.ts`; éstas son las
 *     de los SIETE módulos que no la llamaban: inventarios, notas, compras, calidad y la receta
 *     congelada por la puerta de atrás (más C5, que se construyó con default BLOQUEAR).
 *  2. **Las EXCEPCIONES de Daniel PASAN sobre la orden cerrada** (decisiones 2 y 3): validar el
 *     cargo EsMa, completar un proceso de la RC y explotar el MRP. (El EDR sobre una orden cerrada
 *     ya lo amarra `edr.int.test.ts` — «el costo del EDR usa el divisor CONGELADO».) Si alguien les
 *     mete la guarda, estas pruebas se ponen rojas.
 *  3. **La carrera**: una captura en vuelo sostiene el candado COMPARTIDO y el cierre (EXCLUSIVO) la
 *     ESPERA, así que el costo congelado la INCLUYE; y una captura que llega durante el cierre lo
 *     espera y después se rechaza.
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
} from '../../datos/index.js';
import { ErrorConflicto } from '../../comun/errores.js';
import { ORIGEN } from '../../comun/origenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { cerrarOrden, ErrorOrdenCerrada, reabrirOrden } from './cierre-orden.js';
import { registrarCorte } from './etapas.js';
import {
  cancelarMovimientoPt,
  registrarMovimientoPt,
  registrarTraspasoPt,
} from '../inventarios/movimientos-pt.js';
import {
  cancelarMovimientoTelaColor,
  registrarSalidaTelaColorAOrden,
} from '../inventarios/partidas-telas.js';
import { cancelarMovimientoTela, registrarSalidaTelaAOrden } from '../inventarios/telas.js';
import {
  actualizarEntradaTela,
  cancelarEntradaTela,
  confirmarEntradaTela,
  crearEntradaTela,
} from '../inventarios/entradas-tela.js';
import {
  actualizarNotaSalida,
  cancelarNotaSalida,
  confirmarNotaSalida,
  crearNotaSalida,
} from '../notas/notas-salida.js';
import { actualizarOC, autorizarOC, crearOC } from '../compras/ordenes-compra.js';
import { recibirCompra, reversarRecepcion } from '../compras/recepciones.js';
import { asignarColorDeTela } from '../compras/color-de-la-tela.js';
import {
  asignarProveedorDeMaterial,
  asignarProveedorDeMaterialEnBloque,
} from '../compras/proveedor-de-orden.js';
import { explosionarOrden } from '../compras/mrp.js';
import {
  cancelarAuditoria,
  capturarResultado,
  crearAuditoria,
  modificarAuditoria,
  reclasificar,
} from '../calidad/auditorias.js';
import { ligarOrden, quitarLiga } from '../desarrollo/liga-orden.js';
import { validarCargoEsMa } from '../esma/cargos.js';
import { completarProceso } from '../ruta-critica/cumplimiento.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let cortador: Proveedor;
let proveedor: Proveedor;
let almPrimeras: Almacen;
let almSegundas: Almacen;
let almAvio: Almacen;
let almTela: Almacen;
let idOrden: number;
let folioOrden: bigint;
let clienteNegocioId: number;

const PERMISOS: ClavePermiso[] = [
  'ordenes.cerrar',
  'ordenes.reabrir',
  'ordenes.ver',
  'produccion.corte',
  'produccion.cancelar',
  'inventario-pt.ver',
  'inventario-pt.mover',
  'ipt.fecha-libre',
  'inventario-telas.mover',
  'notas.administrar',
  'notas.cancelar',
  'compras.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.recibir',
  'calidad.ver',
  'calidad.generar-auditorias',
  'calidad.actualizar-auditorias',
  'calidad.modificar-auditorias',
  'desarrollo.administrar',
  'esma.cargo-validar',
  'rc.capturar',
  'rc.capturar-cualquiera',
  'rc.fecha-libre-cumplimiento',
];

const sesion = (): ReturnType<typeof sesionDePrueba> =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERMISOS });
const bd = (): { cliente: PrismaClient } => ({ cliente });

/** Folio suelto para los fixtures directos (las tablas llevan único por empresa). */
let folioFixture = 100n;
const siguienteFolioFixture = (): bigint => {
  folioFixture += 1n;
  return folioFixture;
};

/** Lo que se espera de CADA puerta sobre la orden cerrada: el error único, nombrando su folio. */
async function rechazaPorCerrada(promesa: Promise<unknown>): Promise<void> {
  const error: unknown = await promesa.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'la puerta DEJÓ escribir sobre una orden cerrada').toBeInstanceOf(
    ErrorOrdenCerrada,
  );
  // Sigue siendo un 409 de los de siempre (contrato de errores intacto)…
  expect(error).toBeInstanceOf(ErrorConflicto);
  // …y le dice al usuario QUÉ orden y CÓMO salir.
  expect((error as Error).message).toContain(`La orden ${String(folioOrden)} está CERRADA`);
  expect((error as Error).message).toContain('primero hay que reabrirla');
}

async function cerrar(): Promise<void> {
  await cerrarOrden(sesion(), idOrden, { motivo: 'ya terminó' }, bd());
}

/**
 * ⭐ H6 — LA PUERTA CON SU CONTROL POSITIVO. Cerrada, la operación se rechaza con `ErrorOrdenCerrada`;
 * reabierta, la MISMA operación (mismos datos) PASA. Sin la segunda mitad, una prueba cuyos datos
 * estuvieran mal fallaría igual con la orden abierta —y mataría la mutación «quitar la guarda» por
 * la razón equivocada—.
 */
async function cerradaRechazaYReabiertaPasa(op: () => Promise<unknown>): Promise<void> {
  await cerrar();
  await rechazaPorCerrada(op());
  await reabrirOrden(sesion(), idOrden, { motivo: 'control positivo de la prueba' }, bd());
  await expect(op(), 'reabierta, la misma operación tenía que PASAR').resolves.toBeDefined();
}

async function crearProveedorConRol(nombre: string, codigoRol: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: codigoRol },
    update: {},
    create: { codigo: codigoRol, nombre: codigoRol },
  });
  return cliente.proveedor.create({
    data: {
      nombre,
      modalidadFacturacion: 'solo_sin',
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
}

async function sembrarTiposMovimiento(): Promise<void> {
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'transferencia-salida', nombre: 'Transferencia (Salida)', direccion: 'salida' },
      { codigo: 'transferencia-entrada', nombre: 'Transferencia (Entrada)', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
      { codigo: 'error-salida', nombre: 'Error de Salida', direccion: 'entrada' },
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'salida-a-orden', nombre: 'Salida a Orden', direccion: 'salida' },
      { codigo: 'salida-por-nota', nombre: 'Salida por Nota', direccion: 'salida' },
      { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción', direccion: 'entrada' },
    ],
    skipDuplicates: true,
  });
}

async function tipo(codigo: string): Promise<number> {
  return (await cliente.tipoMovimientoInventario.findUniqueOrThrow({ where: { codigo } })).id;
}

/** La orden del escenario: 100 piezas de Rojo/CH, RC activa. */
async function crearOrden100(): Promise<{ id: number; folio: bigint }> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 100, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1515n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      rcActiva: true,
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 100 }] } },
        ],
      },
    },
  });
  return { id: orden.id, folio: orden.folio };
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  cortador = await crearProveedorConRol('Corte SA', 'corte');
  proveedor = await crearProveedorConRol('Avíos y Telas SA', 'maquila-costura');
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almSegundas = await cliente.almacen.create({ data: { nombre: 'Segundas', tipo: 'PT' } });
  almAvio = await cliente.almacen.create({ data: { nombre: 'Avíos', tipo: 'AVIO' } });
  almTela = await cliente.almacen.create({ data: { nombre: 'Telas', tipo: 'TELA' } });
  await sembrarTiposMovimiento();
  const orden = await crearOrden100();
  idOrden = orden.id;
  folioOrden = orden.folio;
});

// ── Fixtures directos (el ESTADO previo de cada puerta; lo que se prueba es la puerta) ─────────

async function telaConColor(): Promise<{ idTela: number; idTelaColor: number }> {
  const tela = await cliente.tela.create({
    data: { nombre: `Felpa ${String(siguienteFolioFixture())}` },
  });
  const color = await cliente.telaColor.create({ data: { idTela: tela.id, nombre: 'Marino' } });
  return { idTela: tela.id, idTelaColor: color.id };
}

/** Un movimiento de SALIDA DE TELA A ESTA ORDEN (como el que deja `registrarSalidaTelaColorAOrden`). */
async function salidaDeTelaAOrden(): Promise<number> {
  const { idTela, idTelaColor } = await telaConColor();
  const mov = await cliente.movimiento.create({
    data: {
      folio: 9001n,
      idEmpresa: empresa.id,
      idTipoMov: await tipo('salida-a-orden'),
      idAlmacen: almTela.id,
      fecha: new Date('2026-08-17T00:00:00.000Z'),
      origenTipo: ORIGEN.salidaTelaOrden,
      origenId: String(idOrden),
      detallesTela: { create: [{ idTela, idTelaColor, cantidad: 10 }] },
    },
  });
  return mov.id;
}

/** OC con UN renglón de avío ligado a la orden. */
async function ocConRenglon(
  estatus: 'borrador' | 'autorizada',
): Promise<{ idOC: number; idLinea: number; idAvio: number }> {
  const avio = await cliente.avio.create({
    data: { clave: `BOT-1-${String(siguienteFolioFixture())}`, descripcion: 'Botón' },
  });
  const oc = await cliente.ordenCompra.create({
    data: {
      numCompra: siguienteFolioFixture(),
      idEmpresa: empresa.id,
      idProveedor: proveedor.id,
      estatus,
    },
  });
  const linea = await cliente.ordenCompraLinea.create({
    data: { idOrdenCompra: oc.id, idAvio: avio.id, idOrden, cantidad: 100, precio: 2 },
  });
  return { idOC: oc.id, idLinea: linea.id, idAvio: avio.id };
}

/** OC con UN renglón de TELA ligado a la orden (para la entrada de tela). */
async function ocDeTela(): Promise<{ idLinea: number; idTelaColor: number }> {
  const { idTela, idTelaColor } = await telaConColor();
  const oc = await cliente.ordenCompra.create({
    data: {
      numCompra: siguienteFolioFixture(),
      idEmpresa: empresa.id,
      idProveedor: proveedor.id,
      estatus: 'autorizada',
    },
  });
  const linea = await cliente.ordenCompraLinea.create({
    data: { idOrdenCompra: oc.id, idTela, idTelaColor, idOrden, cantidad: 50, precio: 30 },
  });
  return { idLinea: linea.id, idTelaColor };
}

async function entradaDeTela(estatus: 'borrador' | 'confirmada'): Promise<number> {
  const { idLinea, idTelaColor } = await ocDeTela();
  const entrada = await cliente.entradaTela.create({
    data: {
      folio: siguienteFolioFixture(),
      idEmpresa: empresa.id,
      tipoDocumento: 'remision',
      numeroDocumento: `R-${String(folioFixture)}`,
      idProveedor: proveedor.id,
      fecha: new Date('2026-08-17T00:00:00.000Z'),
      idAlmacen: almTela.id,
      estatus,
      lineas: { create: [{ idTelaColor, cantidad: 10, idOrdenCompraLinea: idLinea }] },
    },
  });
  return entrada.id;
}

async function notaDeSalida(estatus: 'borrador' | 'confirmada'): Promise<number> {
  const avio = await cliente.avio.create({
    data: { clave: `ETQ-1-${String(siguienteFolioFixture())}`, descripcion: 'Etiqueta' },
  });
  const nota = await cliente.notaSalida.create({
    data: {
      numNota: siguienteFolioFixture(),
      idEmpresa: empresa.id,
      idMaquilero: proveedor.id,
      idAlmacen: almAvio.id,
      fechaElaboracion: new Date('2026-08-17T00:00:00.000Z'),
      estatus,
      lineas: { create: [{ idOrden, idAvio: avio.id, cantidad: 5 }] },
    },
  });
  // Existencia del avío en el almacén de la nota: confirmarla tiene que poder DESCONTAR (el control
  // positivo de H6 la confirma de verdad).
  await cliente.movimiento.create({
    data: {
      folio: siguienteFolioFixture(),
      idEmpresa: empresa.id,
      idTipoMov: await tipo('ajuste-entrada'),
      idAlmacen: almAvio.id,
      fecha: new Date('2026-08-16T00:00:00.000Z'),
      origenTipo: ORIGEN.movimientoManual,
      detallesAvio: { create: [{ idAvio: avio.id, cantidad: 100 }] },
    },
  });
  return nota.id;
}

async function auditoria(): Promise<number> {
  const a = await cliente.auditoria.create({
    data: {
      numAuditoria: 1n,
      idEmpresa: empresa.id,
      idOrden,
      fechaElaboracion: new Date('2026-08-17T00:00:00.000Z'),
      fechaAuditoria: new Date('2026-08-17T00:00:00.000Z'),
      tamanoMuestra: 13,
    },
  });
  return a.id;
}

/** Mete 10 piezas de Rojo/CH de ESTA orden a Primeras (movimiento manual con su bucket). */
async function meterAPt(): Promise<number> {
  const mov = await registrarMovimientoPt(
    sesion(),
    {
      idTipoMov: await tipo('ajuste-entrada'),
      idAlmacen: almPrimeras.id,
      idModelo: modelo.id,
      fecha: '2026-08-17',
      motivo: 'Alta para la prueba',
      lineas: [{ idColor: colorRojo.id, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
    },
    bd(),
  );
  return mov.id;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (1) LAS PUERTAS (A): cada una rechaza la orden CERRADA
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('Inventarios: la orden CERRADA no admite movimientos', () => {
  it('salida de tela POR COLOR a la orden', async () => {
    const { idTelaColor } = await telaConColor();
    await cerrar();
    await rechazaPorCerrada(
      registrarSalidaTelaColorAOrden(
        sesion(),
        {
          idOrden,
          idAlmacen: almTela.id,
          fecha: '2026-08-17',
          lineas: [{ idTelaColor, cantidad: 5 }],
        },
        bd(),
      ),
    );
  });

  it('cancelar una salida de tela a la orden (puerta por color)', async () => {
    const idMov = await salidaDeTelaAOrden();
    await cerrar();
    await rechazaPorCerrada(
      cancelarMovimientoTelaColor(sesion(), idMov, { motivo: 'error de captura' }, bd()),
    );
  });

  it('las gemelas LEGADAS por lote tampoco son puerta trasera (salida y cancelación)', async () => {
    const idMov = await salidaDeTelaAOrden();
    const tela = await cliente.tela.create({ data: { nombre: 'Rib' } });
    const lote = await cliente.lote.create({
      data: { clave: `L-1-${String(siguienteFolioFixture())}`, idColor: colorRojo.id },
    });
    await cerrar();
    await rechazaPorCerrada(
      registrarSalidaTelaAOrden(
        sesion(),
        {
          idOrden,
          idAlmacen: almTela.id,
          fecha: '2026-08-17',
          lineas: [{ idTela: tela.id, idLote: lote.id, cantidad: 5 }],
        },
        bd(),
      ),
    );
    await rechazaPorCerrada(
      cancelarMovimientoTela(sesion(), idMov, { motivo: 'error de captura' }, bd()),
    );
  });

  it('movimiento manual de PT al bucket de la orden', async () => {
    await cerrar();
    await rechazaPorCerrada(meterAPt());
  });

  it('traspaso de PT del bucket de la orden', async () => {
    await meterAPt();
    await cerrar();
    await rechazaPorCerrada(
      registrarTraspasoPt(
        sesion(),
        {
          idAlmacenOrigen: almPrimeras.id,
          idAlmacenDestino: almSegundas.id,
          idModelo: modelo.id,
          fecha: '2026-08-17',
          motivo: 'reacomodo',
          lineas: [
            { idColor: colorRojo.id, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
          ],
        },
        bd(),
      ),
    );
  });

  it('cancelar un movimiento de PT de la orden', async () => {
    const idMov = await meterAPt();
    await cerrar();
    await rechazaPorCerrada(
      cancelarMovimientoPt(sesion(), idMov, { motivo: 'error de captura' }, bd()),
    );
  });

  it('el bucket SIN ORDEN sigue libre (la guarda no toca lo que no es de la orden)', async () => {
    await cerrar();
    await expect(
      registrarMovimientoPt(
        sesion(),
        {
          idTipoMov: await tipo('ajuste-entrada'),
          idAlmacen: almPrimeras.id,
          idModelo: modelo.id,
          fecha: '2026-08-17',
          motivo: 'stock sin orden',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 3 }] }],
        },
        bd(),
      ),
    ).resolves.toBeDefined();
  });

  it('entrada de tela: crear, editar, confirmar y cancelar la confirmada', async () => {
    const { idLinea, idTelaColor } = await ocDeTela();
    const idBorrador = await entradaDeTela('borrador');
    const idConfirmada = await entradaDeTela('confirmada');
    await cerrar();
    const captura = {
      tipoDocumento: 'remision' as const,
      numeroDocumento: 'R-9',
      idProveedor: proveedor.id,
      fecha: '2026-08-17',
      idAlmacen: almTela.id,
      lineas: [{ idTelaColor, cantidad: 10, idOrdenCompraLinea: idLinea }],
    };
    await rechazaPorCerrada(crearEntradaTela(sesion(), captura, bd()));
    await rechazaPorCerrada(actualizarEntradaTela(sesion(), idBorrador, captura, bd()));
    await rechazaPorCerrada(confirmarEntradaTela(sesion(), idBorrador, bd()));
    await rechazaPorCerrada(
      cancelarEntradaTela(sesion(), idConfirmada, { motivo: 'error de captura' }, bd()),
    );
  });
});

describe('Notas de salida: la orden CERRADA no admite surtido', () => {
  it('crear y editar renglones', async () => {
    const idBorrador = await notaDeSalida('borrador');
    const avio = await cliente.avio.create({
      data: { clave: `HIL-1-${String(siguienteFolioFixture())}`, descripcion: 'Hilo' },
    });
    await cerrar();
    const renglones = [{ idOrden, idAvio: avio.id, cantidad: 5, unidad: 'pza' }];
    await rechazaPorCerrada(
      crearNotaSalida(
        sesion(),
        {
          idMaquilero: proveedor.id,
          idAlmacen: almAvio.id,
          fechaElaboracion: '2026-08-17',
          lineas: renglones,
        },
        bd(),
      ),
    );
    await rechazaPorCerrada(
      actualizarNotaSalida(sesion(), idBorrador, { lineas: renglones }, bd()),
    );
  });

  it('confirmar (control: reabierta, SÍ descuenta)', async () => {
    const idBorrador = await notaDeSalida('borrador');
    await cerradaRechazaYReabiertaPasa(() => confirmarNotaSalida(sesion(), idBorrador, bd()));
  });

  it('cancelar la CONFIRMADA (control: reabierta, SÍ se cancela)', async () => {
    const idConfirmada = await notaDeSalida('confirmada');
    await cerradaRechazaYReabiertaPasa(() =>
      cancelarNotaSalida(sesion(), idConfirmada, { motivo: 'error de captura' }, bd()),
    );
  });

  it('cancelar un BORRADOR sigue libre (no mueve nada — duda C2, default LIBRE)', async () => {
    const idBorrador = await notaDeSalida('borrador');
    await cerrar();
    await expect(
      cancelarNotaSalida(sesion(), idBorrador, { motivo: 'ya no' }, bd()),
    ).resolves.toBeDefined();
  });
});

describe('Compras: no se le compra ni se le recibe a una orden CERRADA', () => {
  it('crear y editar una OC con renglones de la orden', async () => {
    const { idOC, idAvio } = await ocConRenglon('borrador');
    await cerrar();
    const lineas = [{ idAvio, idOrden, cantidad: 10, precio: 2 }];
    await rechazaPorCerrada(
      crearOC(
        sesion(),
        { fechaEntrega: '2026-09-30', idDireccionEntrega: 1, idProveedor: proveedor.id, lineas },
        bd(),
      ),
    );
    await rechazaPorCerrada(actualizarOC(sesion(), idOC, { lineas }, bd()));
  });

  it('autorizar una OC ligada a la orden', async () => {
    const { idOC } = await ocConRenglon('borrador');
    await cerrar();
    await rechazaPorCerrada(autorizarOC(sesion(), idOC, bd()));
  });

  it('recibir material de un renglón de la orden (control: reabierta, SÍ se recibe)', async () => {
    const { idOC, idLinea } = await ocConRenglon('autorizada');
    await cerradaRechazaYReabiertaPasa(() =>
      recibirCompra(
        sesion(),
        {
          idOrdenCompra: idOC,
          idAlmacen: almAvio.id,
          fecha: '2026-08-17',
          lineas: [{ idOrdenCompraLinea: idLinea, cantidad: 5 }],
        },
        bd(),
      ),
    );
  });

  it('reversar una recepción de la orden (control: reabierta, SÍ se reversa)', async () => {
    const { idOC, idLinea } = await ocConRenglon('autorizada');
    const recepcion = await cliente.recepcionCompra.create({
      data: {
        folio: siguienteFolioFixture(),
        idEmpresa: empresa.id,
        idOrdenCompra: idOC,
        idAlmacen: almAvio.id,
        fecha: new Date('2026-08-17T00:00:00.000Z'),
        lineas: { create: [{ idOrdenCompraLinea: idLinea, cantidadRecibida: 10 }] },
      },
    });
    await cerradaRechazaYReabiertaPasa(() =>
      reversarRecepcion(sesion(), recepcion.id, { motivo: 'error de captura' }, bd()),
    );
  });

  it('PUERTA DE ATRÁS de la receta: asignar proveedor, de uno y en bloque (con control)', async () => {
    const avio = await cliente.avio.create({
      data: { clave: `CIE-1-${String(siguienteFolioFixture())}`, descripcion: 'Cierre' },
    });
    // El avío ESTÁ en la receta de la orden: abierta, la asignación tiene que pasar.
    await cliente.ordenAvio.create({ data: { idOrden, idAvio: avio.id, consumoPorPrenda: 1 } });
    await cerradaRechazaYReabiertaPasa(() =>
      asignarProveedorDeMaterial(
        sesion(),
        idOrden,
        { tipo: 'avio', idMaterial: avio.id, idProveedor: proveedor.id },
        bd(),
      ),
    );
    await cerradaRechazaYReabiertaPasa(() =>
      asignarProveedorDeMaterialEnBloque(
        sesion(),
        {
          idProveedor: proveedor.id,
          asignaciones: [{ idOrden, tipo: 'avio', idMaterial: avio.id }],
        },
        bd(),
      ),
    );
  });

  it('PUERTA DE ATRÁS de la receta: amarrar el color de compra de la tela (con control)', async () => {
    const { idTela, idTelaColor } = await telaConColor();
    // La tela ESTÁ en la receta y el color de prenda en la matriz: abierta, tiene que pasar.
    await cliente.ordenTela.create({ data: { idOrden, idTela, consumoPorPrenda: 1.5 } });
    await cerradaRechazaYReabiertaPasa(() =>
      asignarColorDeTela(sesion(), idOrden, { idTela, idColor: colorRojo.id, idTelaColor }, bd()),
    );
  });
});

describe('Calidad: la orden CERRADA no se audita', () => {
  it('crear, capturar, modificar y cancelar', async () => {
    const idAuditoria = await auditoria();
    await cerrar();
    await rechazaPorCerrada(crearAuditoria(sesion(), { idOrden }, bd()));
    await rechazaPorCerrada(
      capturarResultado(sesion(), idAuditoria, { resultado: 'aprobado', defectos: [] }, bd()),
    );
    await rechazaPorCerrada(
      modificarAuditoria(sesion(), idAuditoria, { fechaElaboracion: '2026-08-18' }, bd()),
    );
    await rechazaPorCerrada(
      cancelarAuditoria(sesion(), idAuditoria, { motivo: 'error de captura' }, bd()),
    );
  });
});

describe('Calidad: reclasificar, con su control', () => {
  it('reclasificar PT de la orden (control: reabierta, SÍ se reclasifica)', async () => {
    const idAuditoria = await auditoria();
    await meterAPt(); // 10 primeras de la orden: reclasificar 1 a segundas tiene de dónde salir
    await cerradaRechazaYReabiertaPasa(() =>
      reclasificar(
        sesion(),
        idAuditoria,
        {
          sentido: 'a-segundas',
          fecha: '2026-08-17',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    );
  });
});

describe('Desarrollo (duda C5 — default BLOQUEAR, pendiente de Daniel)', () => {
  it('ligar y desligar una orden cerrada se rechaza', async () => {
    await cerrar();
    await rechazaPorCerrada(ligarOrden(sesion(), idOrden, { idDesarrollo: 1 }, bd()));
    await rechazaPorCerrada(quitarLiga(sesion(), idOrden, bd()));
  });
});

describe('El mensaje en LOTE nombra TODAS las cerradas', () => {
  it('una OC que le compra a DOS órdenes cerradas las nombra a las dos', async () => {
    const otra = await cliente.orden.create({
      data: {
        folio: 1516n,
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
      },
    });
    await cerrar();
    await cerrarOrden(sesion(), otra.id, {}, bd());
    const avio = await cliente.avio.create({
      data: { clave: `X-1-${String(siguienteFolioFixture())}`, descripcion: 'X' },
    });
    const error: unknown = await crearOC(
      sesion(),
      {
        fechaEntrega: '2026-09-30',
        idDireccionEntrega: 1,
        idProveedor: proveedor.id,
        lineas: [
          { idAvio: avio.id, idOrden, cantidad: 1, precio: 1 },
          { idAvio: avio.id, idOrden: otra.id, cantidad: 1, precio: 1 },
        ],
      },
      bd(),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorOrdenCerrada);
    expect((error as Error).message).toContain('Las órdenes 1515 y 1516 están CERRADAS');
    expect((error as ErrorOrdenCerrada).folios).toEqual(['1515', '1516']);
  });
});

describe('REABRIR vuelve a dejar capturar (el bloqueo es del cierre, no del histórico)', () => {
  it('cerrar → la nota se rechaza; reabrir → la misma nota entra', async () => {
    const avio = await cliente.avio.create({
      data: { clave: `HIL-2-${String(siguienteFolioFixture())}`, descripcion: 'Hilo' },
    });
    const nota = {
      idMaquilero: proveedor.id,
      idAlmacen: almAvio.id,
      fechaElaboracion: '2026-08-17',
      lineas: [{ idOrden, idAvio: avio.id, cantidad: 5, unidad: 'pza' }],
    };
    await cerrar();
    await rechazaPorCerrada(crearNotaSalida(sesion(), nota, bd()));
    await reabrirOrden(sesion(), idOrden, { motivo: 'faltaba surtir' }, bd());
    await expect(crearNotaSalida(sesion(), nota, bd())).resolves.toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (2) LAS EXCEPCIONES DE DANIEL: PASAN sobre la orden cerrada
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('Excepciones (decisiones 2 y 3): Finanzas, RC y MRP siguen vivos con la orden cerrada', () => {
  it('FINANZAS: validar el cargo EsMa de una orden cerrada (el maquilero no se queda sin cobrar)', async () => {
    const proceso = await cliente.tipoProceso.create({
      data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
    });
    const cargo = await cliente.esMaCargo.create({
      data: {
        idEmpresa: empresa.id,
        idMaquilero: proveedor.id,
        idOrden,
        idTipoProceso: proceso.id,
      },
    });
    await cerrar();
    const validado = await validarCargoEsMa(
      sesion(),
      cargo.id,
      { cantidadReal: 100, precioReal: 12.5 },
      bd(),
    );
    expect(validado.estado).toBe('validado');
  });

  it('RC: completar un proceso de una orden cerrada (la RC se captura tarde a propósito)', async () => {
    const proc = await cliente.procesoDef.create({
      data: { codigo: 'empaque', nombre: 'EMPAQUE' },
    });
    const ruta = await cliente.rutaOrden.create({
      data: { idOrden, idProcesoDef: proc.id, secuencia: 0, duracionDias: 1, estado: 'activo' },
    });
    await cerrar();
    await completarProceso(sesion(), ruta.id, new Date('2026-08-20T00:00:00Z'), bd());
    const fila = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: ruta.id } });
    expect(fila.estado).toBe('completado');
  });

  it('MRP: explotar una orden cerrada (marca, no esconde)', async () => {
    const avio = await cliente.avio.create({
      data: { clave: `BOT-9-${String(siguienteFolioFixture())}`, descripcion: 'Botón' },
    });
    await cliente.ordenAvio.create({
      data: { idOrden, idAvio: avio.id, consumoPorPrenda: 2, liberadoEn: new Date() },
    });
    await cerrar();
    const explosion = await explosionarOrden(sesion(), idOrden, bd());
    expect(explosion.idOrden).toBe(idOrden);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (3) LA CARRERA: candado COMPARTIDO en la captura, EXCLUSIVO en el cierre
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Espera (con tope) a que haya un candado CONSULTIVO esperando en la base. */
async function hayCandadoEsperando(topeMs = 15_000): Promise<boolean> {
  const desde = Date.now();
  while (Date.now() - desde < topeMs) {
    const filas = await cliente.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
    `;
    if ((filas[0]?.n ?? 0) > 0) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/** Corre `p` con tope: si no termina en `ms`, devuelve `'TOPE'` (para no colgar la suite). */
async function conTope<T>(p: Promise<T>, ms = 15_000): Promise<T | 'TOPE'> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<'TOPE'>((r) => {
    reloj = setTimeout(() => {
      r('TOPE');
    }, ms);
  });
  try {
    return await Promise.race([p, tope]);
  } finally {
    clearTimeout(reloj);
  }
}

describe('⭐ La carrera captura ↔ cierre', () => {
  const datosCorte = () => ({
    fecha: '2026-08-17',
    idOrden,
    idCortador: cortador.id,
    lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 100 }] }],
  });

  it('🔴 una captura EN VUELO hace esperar al cierre, y el costo congelado la INCLUYE', async () => {
    // Base de prorrateo = CORTADO: el congelado tiene que ver las 100 que la captura en vuelo cortó.
    await cliente.costoOrden.create({
      data: { idOrden, idEmpresa: empresa.id, costoTotal: 1000, baseProrrateo: 'cortado' },
    });

    let soltar: () => void = () => undefined;
    const suelta = new Promise<void>((r) => {
      soltar = r;
    });
    let avisarCapturado: () => void = () => undefined;
    const capturado = new Promise<void>((r) => {
      avisarCapturado = r;
    });

    const captura = cliente.$transaction(
      async (tx) => {
        await registrarCorte(sesion(), datosCorte(), { tx });
        avisarCapturado();
        await suelta; // sostiene la transacción (y su candado COMPARTIDO) abierta
      },
      { timeout: 60_000, maxWait: 60_000 },
    );
    const pendientes: Promise<unknown>[] = [captura];
    try {
      await capturado;
      let cerro = false;
      const cierre = cerrarOrden(sesion(), idOrden, {}, bd()).then((o) => {
        cerro = true;
        return o;
      });
      pendientes.push(cierre);
      // El cierre tiene que quedarse ESPERANDO el candado (no cerrar «encima» de la captura).
      expect(await hayCandadoEsperando(), 'el cierre NO esperó a la captura en vuelo').toBe(true);
      expect(cerro).toBe(false);
      soltar();
      await captura;
      await cierre;
    } finally {
      // Pase lo que pase, nada se queda colgado para la prueba siguiente.
      soltar();
      await Promise.allSettled(pendientes);
    }

    const fila = await cliente.costoOrden.findUniqueOrThrow({ where: { idOrden } });
    // Sin el candado, el cierre congelaba con base 0 (la captura aún no se veía): el costo se
    // habría congelado SIN la captura que ya estaba hecha.
    expect(fila.cantidadBaseCongelada).toBe(100);
  });

  it('🔴 una captura que llega DURANTE el cierre lo espera, y después se rechaza', async () => {
    let soltar: () => void = () => undefined;
    const suelta = new Promise<void>((r) => {
      soltar = r;
    });
    let avisarCerrado: () => void = () => undefined;
    const cerrado = new Promise<void>((r) => {
      avisarCerrado = r;
    });

    const cierre = cliente.$transaction(
      async (tx) => {
        await cerrarOrden(sesion(), idOrden, {}, { tx });
        avisarCerrado();
        await suelta; // el cierre todavía NO confirma
      },
      { timeout: 60_000, maxWait: 60_000 },
    );
    const pendientes: Promise<unknown>[] = [cierre];
    try {
      await cerrado;
      const captura = registrarCorte(sesion(), datosCorte(), bd()).then(
        () => null,
        (e: unknown) => e,
      );
      pendientes.push(captura);
      expect(await hayCandadoEsperando(), 'la captura NO esperó al cierre').toBe(true);
      soltar();
      await cierre;
      const error = await captura;
      expect(error).toBeInstanceOf(ErrorOrdenCerrada);
    } finally {
      soltar();
      await Promise.allSettled(pendientes);
    }
    expect(await cliente.etapaMovimiento.count({ where: { idOrden } })).toBe(0);
  });

  it('dos capturas de la MISMA orden no se estorban (compartido + compartido)', async () => {
    let soltar: () => void = () => undefined;
    const suelta = new Promise<void>((r) => {
      soltar = r;
    });
    let avisar: () => void = () => undefined;
    const enVuelo = new Promise<void>((r) => {
      avisar = r;
    });
    const primera = cliente.$transaction(
      async (tx) => {
        await registrarCorte(sesion(), datosCorte(), { tx });
        avisar();
        await suelta;
      },
      { timeout: 60_000, maxWait: 60_000 },
    );
    try {
      await enVuelo;
      // La segunda captura NO espera a la primera por el candado de la orden cerrada (si la guarda
      // tomara el EXCLUSIVO, se quedaría esperando: el tope lo convierte en un rojo rápido).
      const segunda = await conTope(meterAPt());
      expect(segunda, 'dos capturas de la misma orden se bloquearon entre sí').not.toBe('TOPE');
    } finally {
      soltar();
      await Promise.allSettled([primera]);
    }
    await primera;
  });
});
