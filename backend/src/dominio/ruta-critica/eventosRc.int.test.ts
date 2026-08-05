import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TipoEventoProceso } from '../../datos/index.js';
import type {
  Almacen,
  Avio,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
} from '../../datos/index.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto } from '../../comun/errores.js';
import type { MensajeEventoDominio } from '../../comun/cola-eventos.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { autorizarOC, cancelarOC, crearOC } from '../compras/ordenes-compra.js';
import { cancelarNotaSalida, confirmarNotaSalida, crearNotaSalida } from '../notas/notas-salida.js';
import { capturarResultado, crearAuditoria } from '../calidad/auditorias.js';
import { ajustarInventarioAvio } from '../inventarios/avios.js';
import { cancelarHito, registrarHito } from './hitosOrden.js';
import { procesarEventoAutoAvance } from './autoAvance.js';

/**
 * Integración de los EMISORES de eventos de la RC que faltaban (post-F9) contra Postgres efímero
 * (testcontainers). Cubre el cierre del hueco: hechos estructurados y hitos que Daniel dictó
 * AUTOMÁTICOS ahora auto-completan (y des-completan) su proceso de la Ruta Crítica vía el auto-avance:
 *  • autorizar una OC de tela ligada a la orden → completa `compraTela`; cancelarla → des-completa.
 *  • confirmar una nota de salida con avíos de la orden → completa `surtidoAvios`; cancelar → des-completa.
 *  • capturar una auditoría de CORTE aprobada → completa `auditoriaCorte`.
 *  • registrar el hito `arte` → completa el proceso `autorizacion-arte`; cancelarlo → des-completa.
 *  • doble registro del mismo hito → ErrorConflicto.
 *
 * Como en `autoAvance.int.test.ts`, la cola está inactiva: el evento se ESCRIBE en el outbox al
 * registrar el hecho (igual que prod) y aquí se DRENA invocando `procesarEventoAutoAvance` con la fila.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let proveedor: Proveedor;
let tela: Tela;
let avio: Avio;
let almacen: Almacen;
let clienteNegocioId: number;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  'compras.ver',
  'compras.administrar',
  'compras.autorizar',
  'compras.cancelar',
  'notas.ver',
  'notas.administrar',
  'notas.cancelar',
  'calidad.ver',
  'calidad.generar-auditorias',
  'calidad.actualizar-auditorias',
  'inventario-avios.ver',
  'inventario-avios.mover',
  'rc.capturar',
  'rc.ruta-ver',
  'roles.administrar',
];

const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_TODOS });
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Proveedor / Maquila SA' } });
  tela = await cliente.tela.create({ data: { nombre: 'Felpa', unidadMedida: 'M' } });
  avio = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'AVIO' } });
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'salida-por-nota', nombre: 'Salida de Avío por Nota', direccion: 'salida' },
    ],
  });
  idOrden = await crearOrdenConMatriz();
});

async function crearOrdenConMatriz(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 10, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      rcActiva: true,
      fechaEntregaRC: new Date('2026-07-31T00:00:00Z'),
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 10 }] } },
        ],
      },
    },
  });
  return orden.id;
}

/** Crea un `ProcesoDef` con un `tipoEvento` y un renglón `RutaOrden` ACTIVO de la orden de prueba. */
async function crearRenglonRuta(codigo: string, tipoEvento: TipoEventoProceso): Promise<number> {
  const proceso = await cliente.procesoDef.create({
    data: { codigo, nombre: codigo.toUpperCase(), tipoEvento },
  });
  const renglon = await cliente.rutaOrden.create({
    data: { idOrden, idProcesoDef: proceso.id, secuencia: 0, duracionDias: 1, estado: 'activo' },
  });
  return renglon.id;
}

/** Drena la ÚLTIMA fila del outbox de un `tipo` dado por el handler del auto-avance. */
async function drenarUltimoEvento(tipo: string): Promise<void> {
  const fila = await cliente.eventoOutbox.findFirstOrThrow({
    where: { tipo },
    orderBy: { id: 'desc' },
  });
  const mensaje: MensajeEventoDominio = {
    id: fila.id,
    tipo: fila.tipo,
    version: fila.version,
    idEmpresa: fila.idEmpresa,
    payload: fila.payload,
  };
  await procesarEventoAutoAvance(mensaje, bd());
}

async function renglon(idRuta: number) {
  return cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
}

// ── compraTela (OC de tela) ──────────────────────────────────────────────────────────────────────

describe('compraTela: OC de tela autorizada/cancelada (post-F9)', () => {
  it('autorizar la OC de tela ligada completa el proceso; cancelarla lo des-completa', async () => {
    const idRuta = await crearRenglonRuta('orden-compra-tela', TipoEventoProceso.compraTela);

    const oc = await crearOC(
      sesion(),
      {
        idProveedor: proveedor.id,
        lineas: [{ idTela: tela.id, cantidad: 100, precio: 12, idOrden }],
      },
      bd(),
    );
    // Antes de autorizar, el proceso sigue activo (la OC en borrador no completa nada).
    expect((await renglon(idRuta)).estado).toBe('activo');

    await autorizarOC(sesion(), oc.id, bd());
    await drenarUltimoEvento('oc-tela-resuelta');
    let r = await renglon(idRuta);
    expect(r.estado).toBe('completado');
    expect(r.origenCaptura).toBe('evento');

    await cancelarOC(sesion(), oc.id, { motivo: 'cambio de proveedor' }, bd());
    await drenarUltimoEvento('oc-tela-resuelta');
    r = await renglon(idRuta);
    expect(r.estado).not.toBe('completado');
    expect(r.fechaReal).toBeNull();
  });
});

// ── surtidoAvios (nota de salida de avíos) ─────────────────────────────────────────────────────────

describe('surtidoAvios: nota de avíos confirmada/cancelada (post-F9)', () => {
  it('confirmar la nota con avíos de la orden completa el proceso; cancelarla lo des-completa', async () => {
    const idRuta = await crearRenglonRuta('surtido-avios', TipoEventoProceso.surtidoAvios);

    // Existencia de avío para poder confirmar la nota (D3: no dejar negativo).
    const tipoEntrada = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
      where: { codigo: 'ajuste-entrada' },
    });
    await ajustarInventarioAvio(
      sesion(),
      {
        idTipoMov: tipoEntrada.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        motivo: 'Conteo inicial de prueba',
        lineas: [{ idAvio: avio.id, cantidad: 100 }],
      },
      bd(),
    );

    const nota = await crearNotaSalida(
      sesion(),
      {
        idMaquilero: proveedor.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-22',
        lineas: [{ idOrden, idAvio: avio.id, cantidad: 10 }],
      },
      bd(),
    );
    expect((await renglon(idRuta)).estado).toBe('activo');

    await confirmarNotaSalida(sesion(), nota.id, bd());
    await drenarUltimoEvento('surtido-avios-resuelto');
    let r = await renglon(idRuta);
    expect(r.estado).toBe('completado');
    expect(r.origenCaptura).toBe('evento');

    await cancelarNotaSalida(sesion(), nota.id, { motivo: 'error de captura' }, bd());
    await drenarUltimoEvento('surtido-avios-resuelto');
    r = await renglon(idRuta);
    expect(r.estado).not.toBe('completado');
    expect(r.fechaReal).toBeNull();
  });
});

// ── auditoriaCorte (auditoría de corte aprobada) ───────────────────────────────────────────────────

describe('auditoriaCorte: auditoría de corte aprobada (post-F9)', () => {
  it('una auditoría de tipo corte APROBADA completa el proceso auditoriaCorte', async () => {
    const idRuta = await crearRenglonRuta('auditoria-corte', TipoEventoProceso.auditoriaCorte);

    const auditoria = await crearAuditoria(
      sesion(),
      { idOrden, tipoAuditoria: 'corte', fechaAuditoria: '2026-06-19' },
      bd(),
    );
    // Sin resultado aún: el proceso sigue activo.
    expect((await renglon(idRuta)).estado).toBe('activo');

    await capturarResultado(sesion(), auditoria.id, { resultado: 'aprobado', defectos: [] }, bd());
    await drenarUltimoEvento('auditoria-calidad-resuelta');

    const r = await renglon(idRuta);
    expect(r.estado).toBe('completado');
    expect(r.origenCaptura).toBe('evento');
    expect(r.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-19');
  });
});

// ── Hitos de la orden ──────────────────────────────────────────────────────────────────────────────

describe('hitos de la orden (post-F9)', () => {
  it('registrar el hito arte completa el proceso autorizacion-arte; cancelarlo lo des-completa', async () => {
    const idRuta = await crearRenglonRuta('autorizacion-arte', TipoEventoProceso.autorizacionArte);

    const hitos = await registrarHito(
      sesion(),
      idOrden,
      { tipo: 'arte', fecha: '2026-06-15' },
      bd(),
    );
    expect(hitos).toHaveLength(1);
    await drenarUltimoEvento('hito-orden-resuelto');
    let r = await renglon(idRuta);
    expect(r.estado).toBe('completado');
    expect(r.origenCaptura).toBe('evento');
    expect(r.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-15');

    const idHito = hitos[0]!.id;
    await cancelarHito(sesion(), idOrden, idHito, { motivo: 'arte rechazado' }, bd());
    await drenarUltimoEvento('hito-orden-resuelto');
    r = await renglon(idRuta);
    expect(r.estado).not.toBe('completado');
    expect(r.fechaReal).toBeNull();
  });

  it('registrar dos veces el mismo hito vivo es ErrorConflicto', async () => {
    await registrarHito(sesion(), idOrden, { tipo: 'fit' }, bd());
    await expect(registrarHito(sesion(), idOrden, { tipo: 'fit' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });
});
