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
import {
  cancelarMovimientoMaterial,
  cancelarMovimientoPt as cancelarMovimientoPtMotor,
  registrarMovimientoPt as registrarMovimientoPtMotor,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type {
  Almacen,
  Cliente,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
  TipoProceso,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { completarProceso } from '../ruta-critica/cumplimiento.js';
import { generarRutaOrden } from '../ruta-critica/rutaOrden.js';
import { cerrarOrden } from '../produccion/cierre-orden.js';
import { salidaAProduccion } from '../produccion/salida-produccion.js';
import { cancelarPedido, crearPedido } from './pedidos.js';

/**
 * ⭐⭐ **FILA 0.150 — CANCELAR UN PEDIDO NO SE LLEVA LAS OP QUE YA TIENEN VIDA.**
 *
 * DANIEL, probando el flujo real: *«¿Qué pasa si me cancelan un pedido, pero la OC ya está
 * producida? **No quiero que se borren las OP en ese caso.** Pero si no hay nada comprado ni
 * producido y borra el pedido está bien cancelar en cascada.»*
 *
 * Hasta esta fila `cancelarPedido` tenía DOS guardas —pedido ya cancelado y orden CERRADA— y
 * ninguna más: marcando la casilla de cascada se cancelaba una OP **aunque ya estuviera cortada,
 * enviada, comprada y auditada**.
 *
 * Estas pruebas están escritas para MORDER: hay una por FAMILIA de señal (si mañana alguien quita
 * una del criterio, cae SU prueba y se sabe cuál), más las dos trampas medidas —los tres caminos
 * del kardex y el movimiento INVERSO que hace que un `count` pelón nunca dé cero— y el caso mixto
 * (dos OP, una viva y otra limpia) que es el que de verdad describe lo que pidió Daniel.
 *
 * ⚠️ Las señales se siembran con Prisma DIRECTO a propósito: lo que se prueba es que la GUARDA las
 * VE, no que cada módulo sepa escribirlas (eso ya lo prueba cada módulo). Las dos excepciones son
 * justamente las trampas: ahí se usan los motores REALES de cancelación (`cancelarMovimientoPt` /
 * `cancelarMovimientoMaterial`), porque el rastro que dejan es el objeto de la prueba.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let modelo: Modelo;
let color: Color;
let talla: Talla;
let proveedor: Proveedor;
let tipoProceso: TipoProceso;
let almacenPt: Almacen;
let almacenTela: Almacen;
let tela: Tela;

/** Servicio de archivos con credenciales falsas (firma local, sin red). */
function archivosDePrueba(): ServicioArchivos {
  const config = configR2DesdeEnv(process.env);
  return crearServicioArchivos({ cliente: crearClienteR2(config), bucket: config.bucket });
}
const archivos = archivosDePrueba();

const PERM: ClavePermiso[] = [
  'pedidos.ver',
  'pedidos.administrar',
  'pedidos.importes',
  'ordenes.ver',
  'ordenes.administrar',
  'ordenes.cancelar',
  'ordenes.cerrar',
  'inventario-pt.ver',
  'inventario-pt.mover',
];

const bd = () => ({ cliente });
const s = (): SesionUsuario => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });

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
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100' } });
  color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Maquilas del Norte' } });
  tipoProceso = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura' },
  });
  almacenPt = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almacenTela = await cliente.almacen.create({ data: { nombre: 'Telas', tipo: 'TELA' } });
  tela = await cliente.tela.create({ data: { nombre: 'Jersey 30/1' } });
  // Tipos de movimiento que los motores de kardex resuelven POR CÓDIGO (y sus inversos).
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
      { codigo: 'salida-a-orden', nombre: 'Salida a Orden', direccion: 'salida' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
      { codigo: 'error-salida', nombre: 'Error de Salida', direccion: 'entrada' },
    ],
  });
});

/** Una OP nacida de un pedido nuevo, LIMPIA (sin una sola señal de vida). */
async function pedidoConOps(cuantas = 1): Promise<{
  idPedido: number;
  ordenes: { id: number; folio: number }[];
}> {
  const sesion = s();
  const pedido = await crearPedido(
    sesion,
    {
      idCliente: clienteNegocio.id,
      lineas: Array.from({ length: cuantas }, () => ({
        idModelo: modelo.id,
        cantidadPedida: 100,
      })),
    },
    bd(),
    archivos,
  );
  const ordenes: { id: number; folio: number }[] = [];
  for (const linea of pedido.lineas) {
    const salida = await salidaAProduccion(
      sesion,
      linea.id,
      { lineas: [{ idColor: color.id, tallas: [{ idTalla: talla.id, cantidad: 100 }] }] },
      bd(),
    );
    ordenes.push({ id: salida.orden.id, folio: salida.orden.folio });
  }
  return { idPedido: pedido.id, ordenes };
}

/** Cancela el pedido PIDIENDO la cascada (la única rama donde el criterio decide). */
function cancelarEnCascada(idPedido: number) {
  return cancelarPedido(
    s(),
    idPedido,
    { cancelarOrdenes: true, motivo: 'El cliente canceló la compra' },
    bd(),
    archivos,
  );
}

/** ¿Cómo quedó la orden en la BD? (el estado guardado, no lo que dijo la respuesta). */
async function estadoDe(idOrden: number): Promise<string> {
  const orden = await cliente.orden.findUniqueOrThrow({ where: { id: idOrden } });
  return orden.estado;
}

// ── Sembradores de UNA señal cada uno (Prisma directo; ver la cabecera) ─────────────────

/** Corte capturado (la señal más común: `EtapaMovimiento` viva). */
async function sembrarProduccion(idOrden: number, canceladoEn: Date | null = null): Promise<void> {
  await cliente.etapaMovimiento.create({
    data: {
      // Folio derivado del id: `@@unique([idEmpresa, folio])` no perdona dos `1n` en el mismo test.
      folio: BigInt(idOrden),
      idEmpresa: empresa.id,
      idOrden,
      tipo: 'corte',
      fecha: new Date('2026-09-01'),
      ...(canceladoEn === null ? {} : { canceladoEn, motivoCancelacion: 'se deshizo' }),
    },
  });
}

/** Cierre de la orden con un maquilero. */
async function sembrarCierreMaquila(
  idOrden: number,
  deshechoEn: Date | null = null,
): Promise<void> {
  await cliente.cierreMaquilaOrden.create({
    data: {
      idEmpresa: empresa.id,
      idOrden,
      idMaquilero: proveedor.id,
      idTipoProceso: tipoProceso.id,
      fecha: new Date('2026-09-01'),
      desenlace: 'perdonado',
      ...(deshechoEn === null ? {} : { deshechoEn, motivoDeshacer: 'error' }),
    },
  });
}

/** Cargo en el estado de cuenta del maquilero. */
async function sembrarEsMa(idOrden: number, estado: 'propuesto' | 'cancelado'): Promise<void> {
  // ⚠️ `esma_cargo_proceso_o_servicio`: proceso XOR servicio, los dos NULL no pasan el CHECK.
  await cliente.esMaCargo.create({
    data: {
      idEmpresa: empresa.id,
      idOrden,
      idMaquilero: proveedor.id,
      idTipoProceso: tipoProceso.id,
      estado,
    },
  });
}

/**
 * Nota de salida de material con un renglón de esta orden (el camino del kardex de AVÍOS).
 *
 * ⚠️ El estado importa, y mucho: `confirmadaEn` es *«cuándo se confirmó (se descontaron los
 * avíos)»*. Una nota en BORRADOR no ha sacado NADA del almacén — y el rechazo de la 0.150 fue
 * justamente que este sembrador nunca ponía `confirmadaEn` y la prueba pasaba igual: no medía nada.
 */
async function sembrarNotaSalida(
  idOrden: number,
  estado: 'confirmada' | 'borrador' | 'cancelada' = 'confirmada',
): Promise<void> {
  await cliente.notaSalida.create({
    data: {
      numNota: BigInt(idOrden),
      idEmpresa: empresa.id,
      idMaquilero: proveedor.id,
      idAlmacen: almacenTela.id,
      fechaElaboracion: new Date('2026-09-01'),
      estatus: estado,
      ...(estado === 'borrador' ? {} : { confirmadaEn: new Date('2026-09-01') }),
      ...(estado === 'cancelada'
        ? { canceladaEn: new Date('2026-09-02'), motivoCancelacion: 'se deshizo' }
        : {}),
      lineas: { create: [{ idOrden, idTela: tela.id, cantidad: 10 }] },
    },
  });
}

/** Orden de compra que nombra a esta OP, con el estatus dado. */
async function sembrarCompra(
  idOrden: number,
  estatus: 'borrador' | 'autorizada' | 'cancelada',
): Promise<void> {
  await cliente.ordenCompra.create({
    data: {
      numCompra: BigInt(idOrden),
      idEmpresa: empresa.id,
      idProveedor: proveedor.id,
      estatus,
      lineas: { create: [{ idTela: tela.id, cantidad: 100, precio: 50, idOrden }] },
      ordenesLigadas: { create: [{ idOrden }] },
    },
  });
}

/** Entrada de PT ATRIBUIDA a la orden, por el motor real. Devuelve el id del movimiento. */
async function sembrarKardexPt(idOrden: number): Promise<number> {
  const tipo = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'inventario-inicial' },
  });
  const mov = await registrarMovimientoPtMotor(
    s(),
    {
      idEmpresa: empresa.id,
      idTipoMov: tipo.id,
      idAlmacen: almacenPt.id,
      fecha: new Date('2026-09-01'),
      origenTipo: ORIGEN.movimientoManual,
      lineas: [
        { idModelo: modelo.id, idColor: color.id, idTalla: talla.id, idOrden, cantidad: 10 },
      ],
    },
    bd(),
  );
  return mov.id;
}

/**
 * Salida de TELA a la orden. ⚠️ Aquí NO hay columna `idOrden`: la liga es la referencia
 * polimórfica `origenTipo` + `origenId`, y `origenId` es **TEXTO**.
 */
async function sembrarKardexTela(idOrden: number): Promise<number> {
  const tipo = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'salida-a-orden' },
  });
  const mov = await cliente.movimiento.create({
    data: {
      // Folio alto a propósito: el inverso que crea el motor toma el suyo de la SECUENCIA (que
      // arranca en 1), y `@@unique([idEmpresa, folio])` haría chocar a los dos.
      folio: BigInt(9000 + idOrden),
      idEmpresa: empresa.id,
      idTipoMov: tipo.id,
      idAlmacen: almacenTela.id,
      fecha: new Date('2026-09-01'),
      origenTipo: ORIGEN.salidaTelaOrden,
      origenId: String(idOrden),
      detallesTela: { create: [{ idTela: tela.id, cantidad: 25 }] },
    },
  });
  return mov.id;
}

/** Proceso de ruta crítica: `generado` (sin `fechaReal`) o CAPTURADO (con ella). */
async function sembrarRutaCritica(idOrden: number, capturado: boolean): Promise<void> {
  const proceso = await cliente.procesoDef.create({
    data: { codigo: `corte-${String(idOrden)}`, nombre: 'Corte' },
  });
  await cliente.rutaOrden.create({
    data: {
      idOrden,
      idProcesoDef: proceso.id,
      duracionDias: 3,
      ...(capturado ? { fechaReal: new Date('2026-09-01') } : {}),
    },
  });
}

/** Hito capturado en la orden. */
async function sembrarHito(idOrden: number, canceladoEn: Date | null = null): Promise<void> {
  await cliente.hitoOrden.create({
    data: {
      idEmpresa: empresa.id,
      idOrden,
      tipo: 'fit',
      fecha: new Date('2026-09-01'),
      ...(canceladoEn === null ? {} : { canceladoEn, motivoCancelacion: 'se deshizo' }),
    },
  });
}

/** Auditoría de calidad de la orden. */
async function sembrarAuditoria(idOrden: number, cancelada = false): Promise<void> {
  await cliente.auditoria.create({
    data: {
      numAuditoria: BigInt(idOrden),
      idEmpresa: empresa.id,
      idOrden,
      fechaElaboracion: new Date('2026-09-01'),
      fechaAuditoria: new Date('2026-09-01'),
      tamanoMuestra: 20,
      cancelada,
      ...(cancelada ? { canceladaEn: new Date('2026-09-02') } : {}),
    },
  });
}

/** Costo guardado de la orden. */
async function sembrarCosto(idOrden: number): Promise<void> {
  await cliente.costoOrden.create({
    data: { idOrden, idEmpresa: empresa.id, costoTotal: 120.5 },
  });
}

/** Renglón de estado de resultados de la orden. */
async function sembrarEdr(idOrden: number): Promise<void> {
  const edr = await cliente.edr.create({ data: { anio: 2026, mes: 9 } });
  await cliente.edrLinea.create({
    data: {
      idEdr: edr.id,
      idOrden,
      idEmpresa: empresa.id,
      idCliente: clienteNegocio.id,
      idModelo: modelo.id,
      cantVendida: 100,
      precioVenta: 90,
    },
  });
}

/** Snapshot del MRP: DERIVADO regenerable, NO una señal de vida. */
async function sembrarRequerimiento(idOrden: number): Promise<void> {
  await cliente.requerimientoOrden.create({
    data: { idOrden, idTela: tela.id, cantidadRequerida: 100, cantidadAComprar: 100 },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1) CADA FAMILIA DE SEÑAL DEJA LA OP VIVA
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('⭐⭐ 0.150 — cada familia de señal deja la OP VIVA (una prueba por familia)', () => {
  /**
   * El molde de todas: se siembra UNA señal, se pide la cascada, y la OP tiene que quedar viva,
   * nombrada por folio y con su porqué — mientras el PEDIDO sí se cancela.
   */
  async function esperaQueLaConserve(
    sembrar: (idOrden: number) => Promise<unknown>,
    trozoDelPorque: RegExp,
  ): Promise<void> {
    const { idPedido, ordenes } = await pedidoConOps();
    const op = ordenes[0] as { id: number; folio: number };
    await sembrar(op.id);

    const resultado = await cancelarEnCascada(idPedido);

    expect(resultado.pedido.pedCancelado).toBe(true);
    expect(resultado.foliosOrdenesCanceladas).toEqual([]);
    expect(resultado.ordenesConservadas).toHaveLength(1);
    expect(resultado.ordenesConservadas[0]?.folio).toBe(op.folio);
    expect(resultado.ordenesConservadas[0]?.porque).toMatch(trozoDelPorque);
    expect(resultado.aviso).toContain(String(op.folio));
    expect(await estadoDe(op.id)).not.toBe('cancelada');
  }

  it('producción capturada (EtapaMovimiento viva)', async () => {
    await esperaQueLaConserve((id) => sembrarProduccion(id), /producción capturada/);
  });

  it('kardex de PT — ⚠️ camino 1 de 3: la columna `MovimientoDetPt.idOrden`', async () => {
    await esperaQueLaConserve((id) => sembrarKardexPt(id), /producto terminado/);
  });

  it('kardex de TELA — ⚠️ camino 2 de 3: `origenTipo`/`origenId` (¡TEXTO!), sin columna', async () => {
    await esperaQueLaConserve((id) => sembrarKardexTela(id), /tela/);
  });

  it('kardex de AVÍOS — ⚠️ camino 3 de 3: por la nota de salida', async () => {
    await esperaQueLaConserve((id) => sembrarNotaSalida(id), /notas de salida/);
  });

  it('compras comprometidas (OC autorizada)', async () => {
    await esperaQueLaConserve((id) => sembrarCompra(id, 'autorizada'), /material comprado/);
  });

  it('cierre de maquila', async () => {
    await esperaQueLaConserve((id) => sembrarCierreMaquila(id), /maquilero/);
  });

  it('cargos EsMa', async () => {
    await esperaQueLaConserve((id) => sembrarEsMa(id, 'propuesto'), /cargos de maquila/);
  });

  it('auditorías de calidad', async () => {
    await esperaQueLaConserve((id) => sembrarAuditoria(id), /auditorías/);
  });

  it('ruta crítica CAPTURADA (`fechaReal`)', async () => {
    await esperaQueLaConserve((id) => sembrarRutaCritica(id, true), /ruta crítica/);
  });

  it('hitos de la orden', async () => {
    await esperaQueLaConserve((id) => sembrarHito(id), /hitos/);
  });

  it('costo guardado', async () => {
    await esperaQueLaConserve((id) => sembrarCosto(id), /costo/);
  });

  it('renglón de estado de resultados', async () => {
    await esperaQueLaConserve((id) => sembrarEdr(id), /estado de resultados/);
  });

  it('receta LIBERADA', async () => {
    await esperaQueLaConserve(
      (id) =>
        cliente.orden.update({
          where: { id },
          data: { recetaLiberadaEn: new Date('2026-09-01') },
        }),
      /receta ya está liberada/,
    );
  });

  it('receta ABIERTA para corregir', async () => {
    await esperaQueLaConserve(
      (id) =>
        cliente.orden.update({
          where: { id },
          data: { recetaAbiertaEn: new Date('2026-09-01') },
        }),
      /receta se abrió/,
    );
  });

  it('orden CERRADA (era la única guarda que existía, y rechazaba en vez de conservar)', async () => {
    await esperaQueLaConserve(
      (id) => cerrarOrden(s(), id, { motivo: 'temporada cerrada' }, bd()),
      /CERRADA/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2) LO QUE **NO** CUENTA — si algo de esto bloqueara, la guarda estaría mal escrita
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('⭐⭐ 0.150 — lo DESHECHO y lo DERIVADO no bloquean', () => {
  /** El molde inverso: se siembra algo que NO es vida y la OP tiene que cancelarse igual. */
  async function esperaQueLaCancele(sembrar: (idOrden: number) => Promise<unknown>): Promise<void> {
    const { idPedido, ordenes } = await pedidoConOps();
    const op = ordenes[0] as { id: number; folio: number };
    await sembrar(op.id);

    const resultado = await cancelarEnCascada(idPedido);

    expect(resultado.ordenesConservadas).toEqual([]);
    expect(resultado.aviso).toBeNull();
    expect(resultado.foliosOrdenesCanceladas).toEqual([op.folio]);
    expect(await estadoDe(op.id)).toBe('cancelada');
  }

  it('una OP totalmente limpia se cancela (el caso feliz de Daniel)', async () => {
    await esperaQueLaCancele(() => Promise.resolve());
  });

  it('⭐⭐ LA TRAMPA DEL INVERSO: un movimiento de PT CANCELADO no bloquea', async () => {
    // 🔴 `cancelarMovimientoPt` crea el inverso COPIANDO `idOrden` del detalle original: un `count`
    // pelón sobre `MovimientoDetPt.idOrden` pasa de 1 a **2** al cancelar, así que NUNCA da cero y
    // la guarda bloquearía PARA SIEMPRE una orden cuya actividad se deshizo entera.
    await esperaQueLaCancele(async (idOrden) => {
      const idMovimiento = await sembrarKardexPt(idOrden);
      const inverso = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
        where: { codigo: 'error-entrada' },
      });
      await cancelarMovimientoPtMotor(s(), idMovimiento, inverso.id, 'se deshizo', bd());
      // Se MIDE la trampa, no se supone: quedan DOS renglones con esta orden.
      const renglones = await cliente.movimientoDetPt.count({ where: { idOrden } });
      expect(renglones).toBe(2);
    });
  });

  it('⭐ la misma trampa en TELA: una salida a la orden ANULADA no bloquea', async () => {
    await esperaQueLaCancele(async (idOrden) => {
      const idMovimiento = await sembrarKardexTela(idOrden);
      const inverso = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
        where: { codigo: 'error-salida' },
      });
      await cancelarMovimientoMaterial(s(), idMovimiento, inverso.id, 'se deshizo', bd());
      // El ORIGINAL sigue ahí, con su `origenTipo`/`origenId` intactos: sólo el enlace al inverso
      // lo distingue de uno vivo.
      const vivos = await cliente.movimiento.count({
        where: { origenTipo: ORIGEN.salidaTelaOrden, origenId: String(idOrden) },
      });
      expect(vivos).toBe(1);
    });
  });

  it('una etapa CANCELADA no cuenta (esa actividad se deshizo)', async () => {
    await esperaQueLaCancele((id) => sembrarProduccion(id, new Date('2026-09-02')));
  });

  it('una nota de salida CANCELADA no cuenta', async () => {
    await esperaQueLaCancele((id) => sembrarNotaSalida(id, 'cancelada'));
  });

  /**
   * ⭐ RECHAZO de la 0.150 — defecto 2. `confirmadaEn` es *«cuándo se descontaron los avíos»*: una
   * nota nunca confirmada no sacó un solo avío del almacén. Es EL MISMO caso que el borrador de OC
   * que Daniel resolvió el mismo día (*«no cuenta como comprado»*), y la primera versión lo
   * contradecía sola: su comentario decía *«el descuento nace al confirmar»* y el código no lo
   * miraba.
   */
  it('⭐ una nota de salida en BORRADOR no cuenta (no ha salido un solo avío)', async () => {
    await esperaQueLaCancele((id) => sembrarNotaSalida(id, 'borrador'));
  });

  it('un cargo EsMa CANCELADO no cuenta', async () => {
    await esperaQueLaCancele((id) => sembrarEsMa(id, 'cancelado'));
  });

  it('un cierre de maquila DESHECHO no cuenta', async () => {
    await esperaQueLaCancele((id) => sembrarCierreMaquila(id, new Date('2026-09-02')));
  });

  it('un hito CANCELADO no cuenta', async () => {
    await esperaQueLaCancele((id) => sembrarHito(id, new Date('2026-09-02')));
  });

  it('una auditoría CANCELADA no cuenta', async () => {
    await esperaQueLaCancele((id) => sembrarAuditoria(id, true));
  });

  it('la ruta crítica GENERADA (sin `fechaReal`) no cuenta: es un derivado regenerable', async () => {
    await esperaQueLaCancele((id) => sembrarRutaCritica(id, false));
  });

  it('el snapshot del MRP (`RequerimientoOrden`) no cuenta: se borra y se recrea entero', async () => {
    await esperaQueLaCancele((id) => sembrarRequerimiento(id));
  });

  it('⭐ una OC en BORRADOR no cuenta — DANIEL: «no cuenta como comprado»', async () => {
    await esperaQueLaCancele((id) => sembrarCompra(id, 'borrador'));
  });

  it('una OC CANCELADA tampoco cuenta', async () => {
    await esperaQueLaCancele((id) => sembrarCompra(id, 'cancelada'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3) EL CASO DE DANIEL: dos OP del mismo pedido, una viva y otra limpia
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('⭐⭐ 0.150 — el caso mixto: se cancela la limpia y la producida se conserva NOMBRADA', () => {
  it('cancela UNA, conserva la otra y la nombra por folio con su porqué', async () => {
    const { idPedido, ordenes } = await pedidoConOps(2);
    const [primera, segunda] = ordenes as [
      { id: number; folio: number },
      { id: number; folio: number },
    ];
    // La PRIMERA ya se está produciendo; la SEGUNDA está limpia.
    await sembrarProduccion(primera.id);

    const resultado = await cancelarEnCascada(idPedido);

    // El pedido se cancela (lo que el usuario quería) …
    expect(resultado.pedido.pedCancelado).toBe(true);
    // … la limpia se arrastra …
    expect(resultado.foliosOrdenesCanceladas).toEqual([segunda.folio]);
    expect(await estadoDe(segunda.id)).toBe('cancelada');
    // … y la producida se queda VIVA, nombrada.
    expect(resultado.ordenesConservadas).toHaveLength(1);
    expect(resultado.ordenesConservadas[0]?.folio).toBe(primera.folio);
    expect(await estadoDe(primera.id)).not.toBe('cancelada');

    // El AVISO la nombra y ofrece la salida que SÍ existe (cancelarla a mano desde Órdenes).
    expect(resultado.aviso).toContain(String(primera.folio));
    expect(resultado.aviso).not.toContain(`${String(segunda.folio)} (`);
    expect(resultado.aviso).toMatch(/Órdenes/);

    // A7/D3 — la bitácora del pedido lleva el PAR SIMÉTRICO: qué se canceló y qué NO.
    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Pedido', idEntidad: String(idPedido), accion: 'CANCELAR' },
    });
    const datos = bitacora.datos as {
      ordenesCanceladas?: number[];
      ordenesConservadas?: { folio: number; porque: string }[];
    };
    expect(datos.ordenesCanceladas).toEqual([segunda.folio]);
    expect(datos.ordenesConservadas?.map((o) => o.folio)).toEqual([primera.folio]);

    // Y la OP cancelada dejó SU renglón; la conservada NO tiene ninguno (no pasó nada con ella).
    const bitacorasOrden = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', accion: 'CANCELAR' },
      select: { idEntidad: true },
    });
    expect(bitacorasOrden.map((b) => b.idEntidad)).toEqual([String(segunda.id)]);
  });

  it('con TODAS las OP vivas no se cancela ninguna, pero el pedido SÍ (nunca queda atrapado)', async () => {
    const { idPedido, ordenes } = await pedidoConOps(2);
    for (const op of ordenes) await sembrarProduccion(op.id);

    const resultado = await cancelarEnCascada(idPedido);

    expect(resultado.pedido.pedCancelado).toBe(true);
    expect(resultado.foliosOrdenesCanceladas).toEqual([]);
    expect(resultado.ordenesConservadas.map((o) => o.folio)).toEqual(ordenes.map((o) => o.folio));
    for (const op of ordenes) expect(await estadoDe(op.id)).not.toBe('cancelada');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4) ⭐⭐ LA TRAMPA 3, CONTRA EL GENERADOR REAL — programar la RC NO es haber producido
//
// Este bloque nació del RECHAZO de la 0.150. La primera versión sembraba `RutaOrden` con Prisma
// directo, así que nunca vio lo que hace `generarRutaOrden`: AUTO-COMPLETAR todo proceso de
// `duracionDias === 0` con `fechaReal`, `estado='completado'` y `origenCaptura='evento'`. Efecto
// medido: **programar la ruta crítica —en la planeación, antes de comprar y de cortar— conservaba
// la OP**, con un `porque` que decía «ya tiene procesos capturados» sobre una orden que nadie había
// tocado. Rompía la frase de Daniel en su caso de uso exacto.
//
// Por eso estas pruebas GENERAN la ruta de verdad y CAPTURAN de verdad: es la única forma de que la
// guarda quede atada al comportamiento del generador y no a lo que un sembrador crea de él.
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('⭐⭐ 0.150 — la RUTA CRÍTICA generada de verdad (rechazo, defecto 1)', () => {
  // `rc.fecha-libre-cumplimiento` (fila 0.175): las capturas de abajo fechan un día concreto de
  // 2026, fuera de la ventana; lo que se mide aquí es la cancelación, no la ventana de captura.
  const PERM_RC: ClavePermiso[] = [
    ...PERM,
    'rc.programar',
    'rc.capturar',
    'rc.fecha-libre-cumplimiento',
    // Fila 0.120: saltarse el filtro de responsabilidad de la RC dejó de colgar de
    // `roles.administrar` y tiene llave propia. Aquí se captura sobre procesos cuyos roles
    // responsables no son los de esta sesión, así que hace falta.
    'rc.capturar-cualquiera',
  ];
  const sesionRc = (): SesionUsuario =>
    sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_RC });

  /** Ids del catálogo de programación que `generarRutaOrden` exige. */
  let idArticuloRC: number;
  let idTipoTela: number;
  let idAplicacion: number;
  /** Los dos procesos de la plantilla: uno de 0 días (auto-completado) y uno normal. */
  let idProcesoCero: number;
  let idProcesoNormal: number;

  beforeEach(async () => {
    await cliente.configuracionEmpresa.create({
      data: { idEmpresa: empresa.id, colchonCostura: 2 },
    });
    await cliente.factorCantidad.createMany({
      data: [{ deCant: 1, aCant: 5000, factor: 1.0 }],
    });
    const familia = await cliente.familiaArticulo.create({ data: { nombre: 'Playeras' } });
    const articulo = await cliente.articuloRC.create({
      data: { nombre: 'SENCILLO 1/6', idFamiliaArticulo: familia.id },
    });
    idArticuloRC = articulo.id;
    const dTela = await cliente.duracionPorTipoTela.create({
      data: { nombre: 'Nacional', dias: 10, factorTela: 1 },
    });
    idTipoTela = dTela.id;
    const dAplic = await cliente.duracionPorAplicacion.create({
      data: { nombre: 'Sin Aplicacion', clave: 'A0', dias: 0 },
    });
    idAplicacion = dAplic.id;

    // ⚠️ `tiempoEstandar: 0` + `tipoDuracion: 'fija'` = duración 0 = el caso que auto-completa.
    const cero = await cliente.procesoDef.create({
      data: { codigo: 'revision-op', nombre: 'REVISION OP', tipoDuracion: 'fija' },
    });
    idProcesoCero = cero.id;
    const normal = await cliente.procesoDef.create({
      data: { codigo: 'corte-rc', nombre: 'CORTE', tipoDuracion: 'fija', ultimoProceso: true },
    });
    idProcesoNormal = normal.id;

    const plantilla = await cliente.plantillaRuta.create({
      data: { nombre: 'Plantilla playeras', idArticuloRC: articulo.id },
    });
    const rCero = await cliente.plantillaRutaProceso.create({
      data: { idPlantillaRuta: plantilla.id, idProcesoDef: cero.id, tiempoEstandar: 0, orden: 0 },
    });
    const rNormal = await cliente.plantillaRutaProceso.create({
      data: { idPlantillaRuta: plantilla.id, idProcesoDef: normal.id, tiempoEstandar: 3, orden: 1 },
    });
    await cliente.plantillaRutaDep.create({
      data: { idPlantillaRutaProceso: rNormal.id, idAntecesor: rCero.id },
    });
  });

  /** PROGRAMA la ruta de la orden por el camino real (nada de sembrar `RutaOrden` a mano). */
  async function programarRuta(idOrden: number): Promise<void> {
    await generarRutaOrden(
      sesionRc(),
      {
        idOrden,
        idArticuloRC,
        fechaEntregaRC: new Date('2026-12-01T00:00:00Z'),
        idTipoTela,
        idAplicacion,
        fechaInicioRC: new Date('2026-09-01T00:00:00Z'),
      },
      bd(),
    );
  }

  /** El renglón de ruta de un proceso de esta orden. */
  async function renglonDeRuta(idOrden: number, idProcesoDef: number) {
    return cliente.rutaOrden.findFirstOrThrow({ where: { idOrden, idProcesoDef } });
  }

  it('🔴 SÓLO programar la RC deja la OP cancelable (el defecto que rechazó la fila)', async () => {
    const { idPedido, ordenes } = await pedidoConOps();
    const op = ordenes[0] as { id: number; folio: number };

    await programarRuta(op.id);

    // Se MIDE la trampa antes de juzgarla: el proceso de 0 días nació COMPLETADO, con fecha real,
    // sin que nadie capturara nada — y `capturadoPorId` en null es lo que lo delata.
    const cero = await renglonDeRuta(op.id, idProcesoCero);
    expect(cero.duracionDias).toBe(0);
    expect(cero.fechaReal).not.toBeNull();
    expect(cero.estado).toBe('completado');
    expect(cero.origenCaptura).toBe('evento');
    expect(cero.capturadoPorId).toBeNull();
    // Y el proceso normal, en cambio, sigue pendiente: nadie ha hecho nada.
    const normal = await renglonDeRuta(op.id, idProcesoNormal);
    expect(normal.fechaReal).toBeNull();

    const resultado = await cancelarEnCascada(idPedido);

    // Nada comprado, nada producido ⇒ se cancela en cascada. Es la frase literal de Daniel.
    expect(resultado.ordenesConservadas).toEqual([]);
    expect(resultado.aviso).toBeNull();
    expect(resultado.foliosOrdenesCanceladas).toEqual([op.folio]);
    expect(await estadoDe(op.id)).toBe('cancelada');
  });

  it('⭐ pero si una PERSONA captura ese mismo proceso de 0 días, la OP se conserva', async () => {
    // La rama gemela, y la razón de que el criterio sea la TERNA y no `duracionDias: { not: 0 }`:
    // `completarProceso` no mira la duración ni el estado, así que capturar a mano un proceso de 0
    // días es posible — y es un acto humano que la guarda NO puede tirar a la basura.
    const { idPedido, ordenes } = await pedidoConOps();
    const op = ordenes[0] as { id: number; folio: number };
    await programarRuta(op.id);
    const cero = await renglonDeRuta(op.id, idProcesoCero);

    await completarProceso(sesionRc(), cero.id, new Date('2026-09-05T00:00:00Z'), bd());

    // El sello cambió: ya NO es el del generador (lo firma una persona).
    const tras = await renglonDeRuta(op.id, idProcesoCero);
    expect(tras.duracionDias).toBe(0);
    expect(tras.origenCaptura).toBe('manual');
    expect(tras.capturadoPorId).not.toBeNull();

    const resultado = await cancelarEnCascada(idPedido);

    expect(resultado.ordenesConservadas).toHaveLength(1);
    expect(resultado.ordenesConservadas[0]?.porque).toMatch(/ruta crítica/);
    expect(await estadoDe(op.id)).not.toBe('cancelada');
  });

  /**
   * ⭐ BLINDAJE de SQL, no de negocio. El criterio se escribe en POSITIVO (`OR` de «no es el sello
   * del generador») y no como `NOT {terna}` porque, medido sobre el SQL que emite Prisma,
   * `NOT (a AND b AND c)` con `origen_captura` NULL vale NULL y **tira la fila del conteo** — o
   * sea: la guarda dejaría de ver esa captura y cancelaría la OP, el lado caro del error.
   *
   * ⚠️ Se dice lo que es: HOY ningún camino del dominio deja `fechaReal` con `origenCaptura` NULL
   * (generador y auto-avance ponen `'evento'`; captura manual, checklist y ETL dejan `'manual'` o
   * `capturadoPorId`), así que el estado se fabrica a mano a propósito. Lo que esta prueba clava
   * no es un caso de uso: es que la FORMA del filtro no dependa de eso.
   */
  it('⭐ una fechaReal SIN sello de origen cuenta (el `NOT` de tres patas la perdía)', async () => {
    const { idPedido, ordenes } = await pedidoConOps();
    const op = ordenes[0] as { id: number; folio: number };
    await programarRuta(op.id);
    const cero = await renglonDeRuta(op.id, idProcesoCero);
    await cliente.rutaOrden.update({ where: { id: cero.id }, data: { origenCaptura: null } });

    const resultado = await cancelarEnCascada(idPedido);

    expect(resultado.ordenesConservadas).toHaveLength(1);
    expect(await estadoDe(op.id)).not.toBe('cancelada');
  });

  it('⭐ y capturar un proceso NORMAL (duración > 0) también la conserva', async () => {
    const { idPedido, ordenes } = await pedidoConOps();
    const op = ordenes[0] as { id: number; folio: number };
    await programarRuta(op.id);
    const normal = await renglonDeRuta(op.id, idProcesoNormal);
    expect(normal.duracionDias).toBeGreaterThan(0);

    await completarProceso(sesionRc(), normal.id, new Date('2026-09-05T00:00:00Z'), bd());

    const resultado = await cancelarEnCascada(idPedido);

    expect(resultado.ordenesConservadas).toHaveLength(1);
    expect(resultado.ordenesConservadas[0]?.porque).toMatch(/ruta crítica/);
    expect(await estadoDe(op.id)).not.toBe('cancelada');
  });
});
