/**
 * Tests de INTEGRACIÓN del AUTO-AVANCE de la RC (F5-E6). Postgres efímero (testcontainers). Cubre lo
 * que pide la ficha:
 *  • el evento de un RECIBO de COSTURA cuadra WIP + IPT + EsMa + RC en UNA transacción (punto de
 *    integración central, PLANMAESTRO §5) y auto-completa el proceso `reciboCostura`;
 *  • PARCIAL: una remesa parcial NO completa y marca `parcialEnCurso`; la remesa que completa SÍ marca
 *    `completado` y limpia `parcialEnCurso`, activando sucesores;
 *  • evento DUPLICADO = 1 efecto (idempotencia);
 *  • evento sobre fecha MANUAL la PISA (origenCaptura='evento') y deja rastro en Bitácora (decisión e);
 *  • CANCELACIÓN del recibo des-completa el proceso y revisa los sucesores ya activados (decisión f);
 *  • `corte-registrado` auto-completa el proceso `corte`.
 *
 * El motor de jobs y la cola están INACTIVOS en tests (no hay pg-boss vivo): el evento se ESCRIBE en
 * el outbox al registrar el hecho (mismo patrón que prod) y aquí se DRENA invocando el handler
 * `procesarEventoAutoAvance` directo con la fila del outbox — igual que `cumplimiento.int.test.ts`
 * ejercita el CPM llamando `recalcularRutaOrden` directo.
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
  TipoProceso,
} from '../../datos/index.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { cancelarReciboMaquila, registrarReciboMaquila } from '../produccion/recibos.js';
import { registrarCorte, registrarEnvioMaquila } from '../produccion/etapas.js';
import { consultarExistenciasPt } from '../inventarios/movimientos-pt.js';
import { listarCargosEsMa } from '../esma/cargos.js';
import { completarProceso } from './cumplimiento.js';
import { procesarEventoAutoAvance } from './autoAvance.js';
import type { MensajeEventoDominio } from '../../comun/cola-eventos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor;
let maquileroCostura: Proveedor;
let procesoCostura: TipoProceso;
let almPrimeras: Almacen;
let clienteNegocioId: number;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.cancelar',
  'produccion.wip-ver',
  'inventario-pt.ver',
  'esma.cargo-validar',
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
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  cortador = await crearProveedorConRol('Corte SA', 'corte');
  maquileroCostura = await crearProveedorConRol('Maquila Costura SA', 'maquila-costura');
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  await sembrarTiposMovimiento();
  idOrden = await crearOrdenConMatriz(); // Rojo CH 10, M 20 (30 piezas).
});

// ── Helpers de mundo ──────────────────────────────────────────────────────────────────────────

async function crearProveedorConRol(nombre: string, codigoRol: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: codigoRol },
    update: {},
    create: { codigo: codigoRol, nombre: codigoRol },
  });
  return cliente.proveedor.create({
    data: { nombre, roles: { create: { idRolProveedor: rol.id } } },
  });
}

async function crearOrdenConMatriz(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 30, precio: 10 },
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
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 10 },
                { idTalla: tallaM.id, cantidad: 20 },
              ],
            },
          },
        ],
      },
    },
  });
  return orden.id;
}

async function sembrarTiposMovimiento(): Promise<void> {
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
    ],
  });
}

/** Crea un proceso del catálogo con un `tipoEvento` dado. */
async function crearProcesoDef(
  codigo: string,
  tipoEvento: 'corte' | 'reciboCostura',
  opciones: { ultimoProceso?: boolean } = {},
): Promise<number> {
  const p = await cliente.procesoDef.create({
    data: {
      codigo,
      nombre: codigo.toUpperCase(),
      tipoEvento,
      ultimoProceso: opciones.ultimoProceso ?? false,
    },
  });
  return p.id;
}

/** Crea un renglón de RutaOrden para la orden de prueba. */
async function crearRenglon(
  idProcesoDef: number,
  opciones: {
    secuencia: number;
    estado?: 'pendiente' | 'activo' | 'completado';
    ultimoProceso?: boolean;
  },
): Promise<number> {
  const r = await cliente.rutaOrden.create({
    data: {
      idOrden,
      idProcesoDef,
      secuencia: opciones.secuencia,
      duracionDias: 1,
      estado: opciones.estado ?? 'activo',
      ultimoProceso: opciones.ultimoProceso ?? false,
    },
  });
  return r.id;
}

/** Corta Rojo CH `ch` + M `m`. */
async function cortar(ch: number, m: number): Promise<void> {
  const tallas = [];
  if (ch > 0) tallas.push({ idTalla: tallaCH.id, cantidad: ch });
  if (m > 0) tallas.push({ idTalla: tallaM.id, cantidad: m });
  await registrarCorte(
    sesion(),
    {
      idOrden,
      idCortador: cortador.id,
      fecha: '2026-06-18',
      lineas: [{ idColor: colorRojo.id, tallas }],
    },
    bd(),
  );
}

/** Envía a costura Rojo CH `ch` + M `m`. */
async function enviarCostura(ch: number, m: number): Promise<void> {
  const tallas = [];
  if (ch > 0) tallas.push({ idTalla: tallaCH.id, cantidad: ch });
  if (m > 0) tallas.push({ idTalla: tallaM.id, cantidad: m });
  await registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquileroCostura.id,
      fecha: '2026-06-19',
      precioPactado: 8,
      lineas: [{ idColor: colorRojo.id, tallas }],
    },
    bd(),
  );
}

/** Recibe de costura Rojo CH `ch` + M `m`; devuelve el id del recibo. */
async function recibirCostura(ch: number, m: number): Promise<number> {
  const tallas = [];
  if (ch > 0) tallas.push({ idTalla: tallaCH.id, cantidad: ch });
  if (m > 0) tallas.push({ idTalla: tallaM.id, cantidad: m });
  const recibo = await registrarReciboMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquileroCostura.id,
      fecha: '2026-06-20',
      precioPactado: 8,
      idAlmacenPrimeras: almPrimeras.id,
      lineas: [{ idColor: colorRojo.id, tallas }],
    },
    bd(),
  );
  return recibo.id;
}

/**
 * Toma la ÚLTIMA fila del outbox con un `tipo` dado y la pasa al handler del auto-avance (drena la
 * cola "a mano", ya que pg-boss está inactivo en tests). Devuelve el mensaje procesado.
 */
async function drenarUltimoEvento(tipo: string): Promise<MensajeEventoDominio> {
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
  return mensaje;
}

async function renglon(idRuta: number) {
  return cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
}

// ── Tests ──────────────────────────────────────────────────────────────────────────────────────

describe('recibo de costura: cuadra WIP+IPT+EsMa+RC y auto-completa (F5-E6)', () => {
  it('el recibo COMPLETO cuadra los 3 efectos en una tx y auto-completa el proceso reciboCostura', async () => {
    const procReciboId = await crearProcesoDef('recibo-costura', 'reciboCostura');
    const idRuta = await crearRenglon(procReciboId, { secuencia: 0 });

    await cortar(10, 20);
    await enviarCostura(10, 20);
    const idRecibo = await recibirCostura(10, 20); // recibe TODO lo pedido.

    // (Punto de integración central) los 3 efectos del recibo cuadraron en su propia transacción:
    const existencias = await consultarExistenciasPt(sesion(), { idModelo: modelo.id }, bd());
    expect(existencias.totalExistencia).toBe(30); // IPT subió.
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    // fila 0.114: en la cola hay DOS cargos propuestos —el del CORTE, que desde esa fila también se
    // paga desde la orden, y el del RECIBO—. Lo que este punto de integración mide es el del recibo,
    // así que se elige por su etapa en vez de contar «uno» (y de paso se afirma el del corte).
    expect(cola.filas.filter((f) => f.servicio === 'corte')).toHaveLength(1);
    const cargosDelRecibo = cola.filas.filter((f) => f.idEtapaRecibo === idRecibo);
    expect(cargosDelRecibo).toHaveLength(1); // EsMa propuesto.
    expect(idRecibo).toBeGreaterThan(0); // WIP (recibo) existe.

    // Antes de drenar, la RC sigue activa (el outbox aún no se consumió).
    expect((await renglon(idRuta)).estado).toBe('activo');

    // Drena el evento del outbox → auto-avance.
    const msg = await drenarUltimoEvento('recibo-maquila-registrado');
    expect(msg.tipo).toBe('recibo-maquila-registrado');

    const r = await renglon(idRuta);
    expect(r.estado).toBe('completado');
    expect(r.origenCaptura).toBe('evento');
    // fechaReal = la fecha FÍSICA del recibo (2026-06-20), NO hoy (reloj del servidor).
    expect(r.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-20');
    expect(r.parcialEnCurso).toBe(false);
  });

  it('PARCIAL no completa y marca parcialEnCurso; la remesa que completa marca completado y limpia la marca + activa sucesor', async () => {
    const procReciboId = await crearProcesoDef('recibo-costura', 'reciboCostura');
    const procSigId = await crearProcesoDef('aceptacion', 'corte', { ultimoProceso: false }); // sucesor (tipoEvento irrelevante)
    const idRuta = await crearRenglon(procReciboId, { secuencia: 0 });
    const idSuc = await crearRenglon(procSigId, { secuencia: 1, estado: 'pendiente' });
    await cliente.rutaOrdenDep.create({ data: { idRutaOrden: idSuc, idAntecesor: idRuta } });

    await cortar(10, 20);
    await enviarCostura(10, 20);

    // Primera remesa PARCIAL: solo CH (10 de 30).
    await recibirCostura(10, 0);
    await drenarUltimoEvento('recibo-maquila-registrado');
    let r = await renglon(idRuta);
    expect(r.estado).toBe('activo'); // NO completa.
    expect(r.parcialEnCurso).toBe(true); // marca parcial.
    expect((await renglon(idSuc)).estado).toBe('pendiente'); // el sucesor sigue pendiente.

    // Segunda remesa que COMPLETA: M (20).
    await recibirCostura(0, 20);
    await drenarUltimoEvento('recibo-maquila-registrado');
    r = await renglon(idRuta);
    expect(r.estado).toBe('completado');
    expect(r.parcialEnCurso).toBe(false);
    // fechaReal = la fecha física de la remesa que completó (2026-06-20).
    expect(r.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-20');
    expect((await renglon(idSuc)).estado).toBe('activo'); // sucesor activado.
  });

  it('evento DUPLICADO = 1 efecto (idempotente)', async () => {
    const procReciboId = await crearProcesoDef('recibo-costura', 'reciboCostura');
    const idRuta = await crearRenglon(procReciboId, { secuencia: 0 });
    await cortar(10, 20);
    await enviarCostura(10, 20);
    await recibirCostura(10, 20);

    await drenarUltimoEvento('recibo-maquila-registrado');
    const r1 = await renglon(idRuta);
    // Re-procesa el MISMO evento: no cambia el estado ni re-escribe fechaReal a otra cosa.
    await drenarUltimoEvento('recibo-maquila-registrado');
    const r2 = await renglon(idRuta);
    expect(r2.estado).toBe('completado');
    expect(r2.fechaReal?.toISOString()).toBe(r1.fechaReal?.toISOString());

    // Solo hay un registro de bitácora de "auto-avance-completar" (el 2º re-proceso es no-op).
    const bitacoras = await cliente.bitacora.findMany({
      where: { entidad: 'RutaOrden', idEntidad: String(idRuta) },
    });
    const completares = bitacoras.filter(
      (b) => (b.datos as { operacion?: string } | null)?.operacion === 'auto-avance-completar',
    );
    expect(completares).toHaveLength(1);
  });

  it('el evento PISA una fecha capturada MANUALMENTE y deja rastro en Bitácora (decisión e)', async () => {
    const procReciboId = await crearProcesoDef('recibo-costura', 'reciboCostura');
    const idRuta = await crearRenglon(procReciboId, { secuencia: 0, estado: 'activo' });

    // Captura MANUAL previa con fecha concreta.
    await completarProceso(sesion(), idRuta, new Date('2026-06-10T00:00:00Z'), bd());
    let r = await renglon(idRuta);
    expect(r.origenCaptura).toBe('manual');
    expect(r.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-10');

    // Llega el recibo COMPLETO → el evento PISA la fecha manual.
    await cortar(10, 20);
    await enviarCostura(10, 20);
    await recibirCostura(10, 20);
    await drenarUltimoEvento('recibo-maquila-registrado');

    r = await renglon(idRuta);
    expect(r.estado).toBe('completado');
    expect(r.origenCaptura).toBe('evento'); // el automático ganó.
    // El evento pisó la fecha manual (2026-06-10) con la fecha FÍSICA del recibo (2026-06-20).
    expect(r.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-20');

    // La Bitácora guarda que había una captura manual (rastro, decisión e).
    const bitacoras = await cliente.bitacora.findMany({
      where: { entidad: 'RutaOrden', idEntidad: String(idRuta) },
    });
    const conRastro = bitacoras.some(
      (b) => (b.datos as { pisoCapturaManual?: boolean } | null)?.pisoCapturaManual === true,
    );
    expect(conRastro).toBe(true);
  });

  it('CANCELAR el recibo des-completa el proceso y revisa los sucesores activados (decisión f)', async () => {
    const procReciboId = await crearProcesoDef('recibo-costura', 'reciboCostura');
    const procSigId = await crearProcesoDef('empaque', 'corte');
    const idRuta = await crearRenglon(procReciboId, { secuencia: 0 });
    const idSuc = await crearRenglon(procSigId, { secuencia: 1, estado: 'pendiente' });
    await cliente.rutaOrdenDep.create({ data: { idRutaOrden: idSuc, idAntecesor: idRuta } });

    await cortar(10, 20);
    await enviarCostura(10, 20);
    const idRecibo = await recibirCostura(10, 20);
    await drenarUltimoEvento('recibo-maquila-registrado');
    expect((await renglon(idRuta)).estado).toBe('completado');
    expect((await renglon(idSuc)).estado).toBe('activo'); // sucesor se activó.

    // Cancela el recibo → emite evento de cancelación → des-completa y revisa sucesores.
    await cancelarReciboMaquila(sesion(), idRecibo, { motivo: 'rechazo calidad' }, bd());
    await drenarUltimoEvento('recibo-maquila-cancelado');

    const r = await renglon(idRuta);
    expect(r.estado).not.toBe('completado'); // des-completado.
    expect(r.fechaReal).toBeNull();
    expect(r.origenCaptura).toBeNull();
    // El sucesor que se había activado vuelve a pendiente (su antecesor ya no está completo).
    expect((await renglon(idSuc)).estado).toBe('pendiente');
  });
});

describe('corte: auto-completa el proceso corte (F5-E6)', () => {
  it('el corte COMPLETO auto-completa el proceso de tipoEvento=corte', async () => {
    const procCorteId = await crearProcesoDef('corte', 'corte');
    const idRuta = await crearRenglon(procCorteId, { secuencia: 0 });

    await cortar(10, 20); // corta TODO lo pedido.
    await drenarUltimoEvento('corte-registrado');

    const r = await renglon(idRuta);
    expect(r.estado).toBe('completado');
    expect(r.origenCaptura).toBe('evento');
    // fechaReal = la fecha física del corte (2026-06-18), no hoy.
    expect(r.fechaReal?.toISOString().slice(0, 10)).toBe('2026-06-18');
  });

  it('un corte PARCIAL marca parcialEnCurso y NO completa', async () => {
    const procCorteId = await crearProcesoDef('corte', 'corte');
    const idRuta = await crearRenglon(procCorteId, { secuencia: 0 });

    await cortar(10, 0); // solo CH (10 de 30).
    await drenarUltimoEvento('corte-registrado');

    const r = await renglon(idRuta);
    expect(r.estado).toBe('activo');
    expect(r.parcialEnCurso).toBe(true);
  });
});
