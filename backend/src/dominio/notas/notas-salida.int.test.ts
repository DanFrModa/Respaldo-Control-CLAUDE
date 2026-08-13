import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { existenciaAvioBloqueada, existenciaTelaBloqueada } from '../../comun/kardex.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Almacen,
  Avio,
  Color,
  Empresa,
  Lote,
  PrismaClient,
  Proveedor,
  Tela,
} from '../../datos/index.js';
import { ajustarInventarioAvio } from '../inventarios/avios.js';
import { cancelarMovimientoTela, registrarSalidaTelaAOrden } from '../inventarios/telas.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarNotaSalida,
  cancelarNotaSalida,
  confirmarNotaSalida,
  crearNotaSalida,
  listarNotasSalida,
  resumenNotasSalida,
} from './notas-salida.js';

/**
 * Integración del dominio de NOTAS DE SALIDA (F4-E5) contra Postgres efímero (testcontainers). Cubre
 * lo que SOLO la base valida (NO corre en local — usa Docker; lo corre el CI):
 *  • Folio NumNota consecutivo POR EMPRESA bajo CONCURRENCIA (A3).
 *  • Descuento EXACTO de AVÍOS al confirmar (`salida-por-nota`); existencia = Σ movimientos (D3).
 *  • Atomicidad (A2): si un avío no alcanza, NO queda nota confirmada NI movimiento (rollback).
 *  • Reverso al cancelar: la existencia del avío regresa vía inverso visible; nada se borra (D3).
 *  • §Post-F9.38 (V1-E3b) — el ALTA **rechaza** todo renglón de TELA: una nota nueva es de AVÍOS
 *    (la salida de tela a una orden no lleva nota). Incluye que una nota solo de avíos siga naciendo.
 *  • ANTI-DOBLE-DESCUENTO de TELA (decisión e): registrar una salida-a-orden y luego incluir esa tela
 *    en una nota → la existencia de la tela baja UNA sola vez (la nota REFERENCIA, no descuenta).
 *    Estas pruebas entran por una nota que YA TRAÍA el renglón de tela (sembrado directo en la BD,
 *    como una nota vieja) y lo RE-GUARDA: es el único camino que sigue vivo. Incluye las dos caras
 *    de la excepción — re-guardar NO le borra el renglón, y agregar una tela que NO estaba se
 *    RECHAZA (por ese hueco nacía una nota de tela nueva por la puerta de atrás).
 *  • Consulta "Notas por orden de producción" (listar por idOrden).
 */

let cliente: PrismaClient;
let empresa: Empresa;
let maquilero: Proveedor;
let clienteNegocioId: number;
let modeloId: number;
let ordenId: number;
let colorRojo: Color;
let almacen: Almacen;
let telaFelpa: Tela;
let avioBoton: Avio;
let loteRojo: Lote;

const PERM_ADMIN: ClavePermiso[] = ['notas.ver', 'notas.administrar'];
const PERM_CANCELAR: ClavePermiso[] = ['notas.ver', 'notas.cancelar'];
const PERM_TELAS: ClavePermiso[] = ['inventario-telas.ver', 'inventario-telas.mover'];
const PERM_AVIOS: ClavePermiso[] = ['inventario-avios.ver', 'inventario-avios.mover'];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

/** Existencia de un avío en el almacén (Σ movimientos, D3). */
async function existenciaAvio(idAvio: number): Promise<number> {
  return cliente.$transaction((tx) => existenciaAvioBloqueada(tx, empresa.id, almacen.id, idAvio));
}

/** Existencia de una tela/lote en el almacén (Σ movimientos, D3). */
async function existenciaTela(idTela: number, idLote: number): Promise<number> {
  return cliente.$transaction((tx) =>
    existenciaTelaBloqueada(tx, empresa.id, almacen.id, idTela, idLote),
  );
}

/** Mete `cantidad` del avío al almacén con un ajuste de entrada (deja existencia para descontar). */
async function sembrarAvio(cantidad: number): Promise<void> {
  const tipoEntrada = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'ajuste-entrada' },
  });
  await ajustarInventarioAvio(
    sesion(PERM_AVIOS),
    {
      idTipoMov: tipoEntrada.id,
      idAlmacen: almacen.id,
      fecha: '2026-06-21',
      motivo: 'Conteo inicial de prueba',
      lineas: [{ idAvio: avioBoton.id, cantidad }],
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
  maquilero = await cliente.proveedor.create({ data: { nombre: 'Maquila del Sur' } });
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'AVIO' } });
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', unidadMedida: 'M' } });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  loteRojo = await cliente.lote.create({
    data: { clave: 'LOTE-ROJO-1', idColor: colorRojo.id },
  });

  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  modeloId = modelo.id;
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idModelo: modeloId,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
    },
  });
  ordenId = orden.id;

  // Tipos de movimiento que el dominio de notas/telas/avíos resuelve por código.
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'salida-a-orden', nombre: 'Salida de Tela a Orden', direccion: 'salida' },
      { codigo: 'salida-por-nota', nombre: 'Salida de Avío por Nota', direccion: 'salida' },
    ],
  });
});

/** Mete tela al lote en el almacén (ajuste de entrada sobre el lote existente). */
async function sembrarTela(cantidad: number): Promise<void> {
  const tipoEntrada = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'ajuste-entrada' },
  });
  // El motor de tela permite un ajuste de entrada sobre un lote existente vía `lineas`.
  await cliente.$transaction(async (tx) => {
    const folioFila = await tx.$queryRaw<{ valor: bigint }[]>`
      INSERT INTO "secuencias" ("id_empresa", "clave", "valor")
      VALUES (${empresa.id}, 'movimiento', 1)
      ON CONFLICT ("id_empresa", "clave") DO UPDATE SET "valor" = "secuencias"."valor" + 1
      RETURNING "valor"
    `;
    const folio = folioFila[0]!.valor;
    await tx.movimiento.create({
      data: {
        folio,
        idEmpresa: empresa.id,
        idTipoMov: tipoEntrada.id,
        idAlmacen: almacen.id,
        fecha: new Date('2026-06-21T00:00:00.000Z'),
        origenTipo: 'movimiento-manual',
        idUsuario: 'usuario-prueba',
        creadoPorId: 'usuario-prueba',
        modificadoPorId: 'usuario-prueba',
        detallesTela: {
          create: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad }],
        },
      },
    });
  });
}

describe('Notas de salida (F4-E5) — folio NumNota consecutivo por empresa (A3)', () => {
  it('dos notas seguidas sacan folios 1 y 2', async () => {
    const n1 = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 5, unidad: 'pza' }],
      },
      bd(),
    );
    const n2 = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 3, unidad: 'pza' }],
      },
      bd(),
    );
    expect(n1.numNota).toBe(1);
    expect(n2.numNota).toBe(2);
  });

  it('N creaciones CONCURRENTES sacan N folios distintos y consecutivos (sin duplicados, A3)', async () => {
    const N = 8;
    const resultados = await Promise.all(
      Array.from({ length: N }, () =>
        crearNotaSalida(
          sesion(PERM_ADMIN),
          {
            idMaquilero: maquilero.id,
            idAlmacen: almacen.id,
            fechaElaboracion: '2026-06-21',
            lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 1, unidad: 'pza' }],
          },
          bd(),
        ),
      ),
    );
    const folios = resultados.map((n) => n.numNota).sort((a, b) => a - b);
    expect(folios).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(folios).size).toBe(N);
  });
});

describe('Notas de salida (F4-E5) — confirmar descuenta AVÍOS (R4, D3)', () => {
  it('confirmar descuenta exactamente lo capturado y queda Σ movimientos (D3)', async () => {
    await sembrarAvio(620);
    expect(await existenciaAvio(avioBoton.id)).toBe(620);

    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 100, unidad: 'pza' }],
      },
      bd(),
    );
    const confirmada = await confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd());

    expect(confirmada.estatus).toBe('confirmada');
    expect(confirmada.confirmadaEn).not.toBeNull();
    // El renglón quedó ligado a su movimiento de descuento (traza, R4).
    expect(confirmada.lineas[0]!.idMovimientoAvio).not.toBeNull();
    expect(await existenciaAvio(avioBoton.id)).toBe(520);
  });

  it('atomicidad (A2): confirmar con avío insuficiente NO confirma la nota NI mueve kardex', async () => {
    await sembrarAvio(50);
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 100, unidad: 'pza' }],
      },
      bd(),
    );
    await expect(confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // La existencia no se tocó y la nota sigue en borrador (rollback total).
    expect(await existenciaAvio(avioBoton.id)).toBe(50);
    const enBd = await cliente.notaSalida.findUniqueOrThrow({ where: { id: nota.id } });
    expect(enBd.estatus).toBe('borrador');
    const movs = await cliente.movimiento.count({
      where: { origenTipo: 'nota-salida', origenId: String(nota.id) },
    });
    expect(movs).toBe(0);
  });

  it('crear con un almacén inexistente → ErrorNoEncontrado (decisión g)', async () => {
    await expect(
      crearNotaSalida(
        sesion(PERM_ADMIN),
        {
          idMaquilero: maquilero.id,
          idAlmacen: 999999,
          fechaElaboracion: '2026-06-21',
          lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 10, unidad: 'pza' }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('crear con un almacén DESACTIVADO → ErrorValidacion (decisión g)', async () => {
    const almacenInactivo = await cliente.almacen.create({
      data: { nombre: 'Bodega vieja', tipo: 'AVIO', activo: false },
    });
    await expect(
      crearNotaSalida(
        sesion(PERM_ADMIN),
        {
          idMaquilero: maquilero.id,
          idAlmacen: almacenInactivo.id,
          fechaElaboracion: '2026-06-21',
          lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 10, unidad: 'pza' }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('confirmar con el almacén DESACTIVADO entre el borrador y la confirmación → ErrorValidacion y NO descuenta (decisión g)', async () => {
    await sembrarAvio(100);
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 30, unidad: 'pza' }],
      },
      bd(),
    );

    // El almacén se DESACTIVA después de tener la nota en borrador, antes de confirmar.
    await cliente.almacen.update({ where: { id: almacen.id }, data: { activo: false } });

    await expect(confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );

    // La nota sigue en borrador y NO se descontó el avío (la existencia se reactiva sobre el mismo
    // almacén para poder medirla; sin la re-validación se habría sacado de un almacén inactivo).
    const enBd = await cliente.notaSalida.findUniqueOrThrow({ where: { id: nota.id } });
    expect(enBd.estatus).toBe('borrador');
    await cliente.almacen.update({ where: { id: almacen.id }, data: { activo: true } });
    expect(await existenciaAvio(avioBoton.id)).toBe(100);
    const movs = await cliente.movimiento.count({
      where: { origenTipo: 'nota-salida', origenId: String(nota.id) },
    });
    expect(movs).toBe(0);
  });

  it('no se re-confirma una nota ya confirmada', async () => {
    await sembrarAvio(100);
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 10, unidad: 'pza' }],
      },
      bd(),
    );
    await confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd());
    await expect(confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });
});

describe('Notas de salida (F4-E5) — doble-confirmación CONCURRENTE de la misma nota (lock)', () => {
  it('dos confirmaciones EN PARALELO: una descuenta UNA sola vez, la otra falla (sin doble descuento)', async () => {
    await sembrarAvio(500);
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 100, unidad: 'pza' }],
      },
      bd(),
    );

    // Dos `confirmarNotaSalida` EN PARALELO sobre la MISMA nota en borrador. Sin el lock + la
    // relectura del estatus bajo lock, ambas verían `borrador` y descontarían el avío DOS veces
    // (doble juego de movimientos). Con el lock, la 2ª espera al commit de la 1ª, ya ve
    // `confirmada` y se rechaza con ErrorConflicto.
    const resultados = await Promise.allSettled([
      confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd()),
      confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd()),
    ]);
    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const fallos = resultados.filter((r) => r.status === 'rejected');
    expect(exitos).toHaveLength(1);
    expect(fallos).toHaveLength(1);
    expect((fallos[0] as PromiseRejectedResult).reason).toBeInstanceOf(ErrorConflicto);

    // El avío se descontó UNA sola vez (500 − 100 = 400), Σ movimientos (D3).
    expect(await existenciaAvio(avioBoton.id)).toBe(400);

    // Existe UN solo juego de movimientos `salida-por-nota` para esa nota (no se duplicó).
    const movs = await cliente.movimiento.count({
      where: { origenTipo: 'nota-salida', origenId: String(nota.id) },
    });
    expect(movs).toBe(1);

    // La nota quedó confirmada.
    const enBd = await cliente.notaSalida.findUniqueOrThrow({ where: { id: nota.id } });
    expect(enBd.estatus).toBe('confirmada');
  });
});

describe('Notas de salida (F4-E5) — cancelar reversa los AVÍOS (D3)', () => {
  it('cancelar una nota confirmada regresa el avío vía inverso (nada se borra)', async () => {
    await sembrarAvio(200);
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 80, unidad: 'pza' }],
      },
      bd(),
    );
    await confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd());
    expect(await existenciaAvio(avioBoton.id)).toBe(120);

    const cancelada = await cancelarNotaSalida(
      sesion(PERM_CANCELAR),
      nota.id,
      { motivo: 'Se canceló el envío' },
      bd(),
    );
    expect(cancelada.estatus).toBe('cancelada');
    expect(cancelada.motivoCancelacion).toBe('Se canceló el envío');
    // La existencia regresa al original; el inverso es un movimiento NUEVO (nada se borra, D3).
    expect(await existenciaAvio(avioBoton.id)).toBe(200);
    const movs = await cliente.movimiento.count({
      where: { origenTipo: 'nota-salida', origenId: String(nota.id) },
    });
    expect(movs).toBe(1); // el salida-por-nota original sigue vivo (su inverso lo neutraliza)
  });

  it('cancelar una nota en borrador no toca kardex y la deja cancelada', async () => {
    await sembrarAvio(100);
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 10, unidad: 'pza' }],
      },
      bd(),
    );
    const cancelada = await cancelarNotaSalida(
      sesion(PERM_CANCELAR),
      nota.id,
      { motivo: 'Sin enviar' },
      bd(),
    );
    expect(cancelada.estatus).toBe('cancelada');
    expect(await existenciaAvio(avioBoton.id)).toBe(100);
  });

  it('no se cancela dos veces', async () => {
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 1, unidad: 'pza' }],
      },
      bd(),
    );
    await cancelarNotaSalida(sesion(PERM_CANCELAR), nota.id, { motivo: 'x' }, bd());
    await expect(
      cancelarNotaSalida(sesion(PERM_CANCELAR), nota.id, { motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Notas de salida (V1-E3b) — el ALTA rechaza la TELA (§Post-F9.38)', () => {
  /**
   * Daniel cerró que la salida de tela a una orden NO lleva nota: una nota NUEVA es de AVÍOS. El
   * dominio lo impide en el ALTA (`rechazarTelaEnAlta`) — la UI ya no lo ofrece, pero la puerta del
   * API también queda cerrada. La EDICIÓN es el caso simétrico y se prueba en el describe siguiente.
   */
  it('rechaza un renglón de tela AUNQUE sea válido (referencia una salida-a-orden real)', async () => {
    await sembrarTela(500);
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden: ordenId,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad: 200 }],
      },
      bd(),
    );

    await expect(
      crearNotaSalida(
        sesion(PERM_ADMIN),
        {
          idMaquilero: maquilero.id,
          idAlmacen: almacen.id,
          fechaElaboracion: '2026-06-21',
          lineas: [
            {
              idOrden: ordenId,
              idTela: telaFelpa.id,
              idLote: loteRojo.id,
              idMovimientoSalidaTela: salida.id,
              cantidad: 200,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // Y no quedó ninguna nota a medias (el rechazo es antes de tomar folio y escribir).
    expect(await cliente.notaSalida.count()).toBe(0);
  });

  it('rechaza también el renglón de tela mezclado con avíos (no se cuela en una nota mixta)', async () => {
    await sembrarTela(500);
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden: ordenId,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad: 100 }],
      },
      bd(),
    );

    await expect(
      crearNotaSalida(
        sesion(PERM_ADMIN),
        {
          idMaquilero: maquilero.id,
          idAlmacen: almacen.id,
          fechaElaboracion: '2026-06-21',
          lineas: [
            { idOrden: ordenId, idAvio: avioBoton.id, cantidad: 5, unidad: 'pza' },
            {
              idOrden: ordenId,
              idTela: telaFelpa.id,
              idLote: loteRojo.id,
              idMovimientoSalidaTela: salida.id,
              cantidad: 100,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.notaSalida.count()).toBe(0);
  });

  it('una nota SOLO de avíos se sigue creando igual (la puerta cerrada no estorba lo vivo)', async () => {
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 5, unidad: 'pza' }],
      },
      bd(),
    );
    expect(nota.lineas).toHaveLength(1);
    expect(nota.lineas[0]!.tipo).toBe('avio');
  });
});

describe('Notas de salida (F4-E5/V1-E3b) — ANTI-DOBLE-DESCUENTO de TELA (decisión e), por RE-GUARDADO', () => {
  /**
   * §Post-F9.38 (corregido en la revisión de V1-E3b) — el ALTA rechaza la tela y la EDICIÓN solo
   * acepta la que YA ESTABA en esa nota. Editar REEMPLAZA el SET COMPLETO de renglones, así que si
   * la edición la rechazara del todo, un borrador viejo con tela quedaría inguardable (o la
   * perdería en silencio); pero aceptar tela NUEVA dejaba abierta la puerta de atrás (crear un
   * borrador con un avío y meterle tela editando → nacía una nota de tela nueva, con folio).
   *
   * Por eso estas pruebas —que fijan las reglas del renglón de tela (decisión e)— siembran el
   * renglón DIRECTAMENTE EN LA BD, como lo trae una nota vieja (su captura existió hasta el
   * rediseño R6), y luego la RE-GUARDAN: ese es el único camino que sigue vivo. Además cada una
   * afirma sobre el MENSAJE del error, para que ninguna pueda pasar "por la razón equivocada"
   * (la del renglón que no estaba en la nota).
   */

  /** Crea el borrador de avíos sobre el que se siembra (o no) el renglón de tela. */
  async function borradorDeAvios(): Promise<number> {
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 1, unidad: 'pza' }],
      },
      bd(),
    );
    return nota.id;
  }

  /**
   * Siembra un renglón de TELA directo en la BD — así se ve una nota VIEJA que ya lo traía. No pasa
   * por el dominio a propósito: hoy ningún camino del dominio crea un renglón de tela (esa es
   * justamente la regla que se está probando).
   */
  async function sembrarRenglonTelaLegacy(
    idNota: number,
    renglon: { idMovimientoSalidaTela: number | null; cantidad: number },
  ): Promise<void> {
    await cliente.notaSalidaLinea.create({
      data: {
        idNotaSalida: idNota,
        idOrden: ordenId,
        idTela: telaFelpa.id,
        idLote: loteRojo.id,
        idMovimientoSalidaTela: renglon.idMovimientoSalidaTela,
        cantidad: renglon.cantidad,
        unidad: 'm',
        creadoPorId: 'usuario-prueba',
        modificadoPorId: 'usuario-prueba',
      },
    });
  }

  it('salida-a-orden + nota que la referencia → la tela baja UNA sola vez', async () => {
    await sembrarTela(500);
    expect(await existenciaTela(telaFelpa.id, loteRojo.id)).toBe(500);

    // 1) La tela SALE hacia la orden (E1) — ESTO es lo que descuenta el inventario.
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden: ordenId,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad: 200 }],
      },
      bd(),
    );
    expect(await existenciaTela(telaFelpa.id, loteRojo.id)).toBe(300);

    // 2) La nota REFERENCIA esa salida-a-orden (NO debe descontar otra vez). La nota YA traía el
    //    renglón (sembrado como una nota vieja) y solo se RE-GUARDA: es el camino que quedó vivo
    //    (§Post-F9.38 — agregar una tela que no estaba se rechaza, y eso se prueba aparte).
    const idNota = await borradorDeAvios();
    await sembrarRenglonTelaLegacy(idNota, { idMovimientoSalidaTela: salida.id, cantidad: 200 });
    const editada = await actualizarNotaSalida(
      sesion(PERM_ADMIN),
      idNota,
      {
        lineas: [
          {
            idOrden: ordenId,
            idTela: telaFelpa.id,
            idLote: loteRojo.id,
            idMovimientoSalidaTela: salida.id,
            cantidad: 200,
            unidad: 'm',
          },
        ],
      },
      bd(),
    );
    expect(editada.lineas).toHaveLength(1);
    expect(editada.lineas[0]!.tipo).toBe('tela');
    await confirmarNotaSalida(sesion(PERM_ADMIN), idNota, bd());

    // La existencia de la tela quedó IGUAL que tras la salida-a-orden (NO bajó otra vez).
    expect(await existenciaTela(telaFelpa.id, loteRojo.id)).toBe(300);
    // No hay ningún movimiento de tela atribuido a la nota.
    const movsNotaTela = await cliente.movimientoDetTela.count({
      where: { movimiento: { origenTipo: 'nota-salida' } },
    });
    expect(movsNotaTela).toBe(0);
  });

  it('un borrador VIEJO con tela se puede RE-GUARDAR sin perder su renglón (la razón de la excepción)', async () => {
    await sembrarTela(500);
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden: ordenId,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad: 120 }],
      },
      bd(),
    );
    // La nota nace como las de antes del rediseño R6: con su renglón de tela YA persistido (se
    // siembra directo en la BD porque hoy ningún camino del dominio lo crea — ese es el punto).
    const idNota = await borradorDeAvios();
    await sembrarRenglonTelaLegacy(idNota, { idMovimientoSalidaTela: salida.id, cantidad: 120 });
    const renglonTela = {
      idOrden: ordenId,
      idTela: telaFelpa.id,
      idLote: loteRojo.id,
      idMovimientoSalidaTela: salida.id,
      cantidad: 120,
      unidad: 'm',
    };

    // El usuario vuelve a guardar (p. ej. corrigió la fecha) mandando el SET COMPLETO, tela incluida.
    const reguardada = await actualizarNotaSalida(
      sesion(PERM_ADMIN),
      idNota,
      {
        fechaEnvio: '2026-06-22',
        lineas: [
          renglonTela,
          { idOrden: ordenId, idAvio: avioBoton.id, cantidad: 3, unidad: 'pza' },
        ],
      },
      bd(),
    );
    expect(reguardada.fechaEnvio).toBe('2026-06-22');
    // El renglón de tela SIGUE AHÍ (no se borró en silencio) junto al avío nuevo.
    expect(reguardada.lineas.map((l) => l.tipo).sort()).toEqual(['avio', 'tela']);
  });

  it('la EDICIÓN RECHAZA una tela que NO estaba en la nota (no nace una nota de tela por la puerta de atrás)', async () => {
    await sembrarTela(500);
    // La salida-a-orden es IMPECABLE (viva, de esta orden, de esta tela/lote): lo único que falla es
    // que ese renglón NO estaba en la nota. Antes de esta corrección, así nacía una nota de tela.
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden: ordenId,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad: 100 }],
      },
      bd(),
    );
    const idNota = await borradorDeAvios(); // nace SOLO con el avío: no tiene tela ninguna

    await expect(
      actualizarNotaSalida(
        sesion(PERM_ADMIN),
        idNota,
        {
          lineas: [
            {
              idOrden: ordenId,
              idTela: telaFelpa.id,
              idLote: loteRojo.id,
              idMovimientoSalidaTela: salida.id,
              cantidad: 100,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/NO estaba en esta nota/);

    // Y la nota quedó INTACTA (A2: la edición se hace en transacción — no perdió su avío).
    const renglones = await cliente.notaSalidaLinea.findMany({ where: { idNotaSalida: idNota } });
    expect(renglones).toHaveLength(1);
    expect(renglones[0]!.idAvio).toBe(avioBoton.id);
    expect(renglones[0]!.idTela).toBeNull();
  });

  it('renglón de tela SIN movimiento de salida-a-orden referenciado → ErrorValidacion', async () => {
    // La nota YA traía ese renglón (sin movimiento, como pudo quedar uno viejo): así el rechazo es
    // por la regla de la decisión (e) y no por "la tela no estaba en la nota".
    const idNota = await borradorDeAvios();
    await sembrarRenglonTelaLegacy(idNota, { idMovimientoSalidaTela: null, cantidad: 10 });
    await expect(
      actualizarNotaSalida(
        sesion(PERM_ADMIN),
        idNota,
        {
          lineas: [
            {
              idOrden: ordenId,
              idTela: telaFelpa.id,
              idLote: loteRojo.id,
              cantidad: 10,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/idMovimientoSalidaTela/);
  });

  it('renglón de tela que referencia una salida-a-orden YA REVERSADA → ErrorValidacion', async () => {
    await sembrarTela(500);
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden: ordenId,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad: 150 }],
      },
      bd(),
    );
    // Se reversa la salida-a-orden (el material regresó al inventario).
    await cancelarMovimientoTela(sesion(PERM_TELAS), salida.id, { motivo: 'devuelta' }, bd());

    // Una nota NO puede documentar un envío sobre una salida anulada — ni siquiera al RE-GUARDAR un
    // renglón que ya traía (por eso se siembra: el rechazo tiene que ser por la anulación).
    const idNota = await borradorDeAvios();
    await sembrarRenglonTelaLegacy(idNota, { idMovimientoSalidaTela: salida.id, cantidad: 150 });
    await expect(
      actualizarNotaSalida(
        sesion(PERM_ADMIN),
        idNota,
        {
          lineas: [
            {
              idOrden: ordenId,
              idTela: telaFelpa.id,
              idLote: loteRojo.id,
              idMovimientoSalidaTela: salida.id,
              cantidad: 150,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/reversada/);
  });

  it('dos renglones de tela que apuntan al MISMO movimiento de salida → ErrorValidacion', async () => {
    await sembrarTela(500);
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden: ordenId,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad: 200 }],
      },
      bd(),
    );
    // El renglón YA estaba en la nota (se siembra): lo que se prueba es que DUPLICARLO se rechaza.
    const idNota = await borradorDeAvios();
    await sembrarRenglonTelaLegacy(idNota, { idMovimientoSalidaTela: salida.id, cantidad: 200 });
    await expect(
      actualizarNotaSalida(
        sesion(PERM_ADMIN),
        idNota,
        {
          lineas: [
            {
              idOrden: ordenId,
              idTela: telaFelpa.id,
              idLote: loteRojo.id,
              idMovimientoSalidaTela: salida.id,
              cantidad: 100,
              unidad: 'm',
            },
            {
              idOrden: ordenId,
              idTela: telaFelpa.id,
              idLote: loteRojo.id,
              idMovimientoSalidaTela: salida.id,
              cantidad: 100,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/ya fue referenciado/);
  });

  it('renglón de tela que referencia una salida-a-orden de OTRA orden → ErrorValidacion', async () => {
    await sembrarTela(500);
    const salida = await registrarSalidaTelaAOrden(
      sesion(PERM_TELAS),
      {
        idOrden: ordenId,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idTela: telaFelpa.id, idLote: loteRojo.id, cantidad: 100 }],
      },
      bd(),
    );
    // Otra orden distinta.
    const otraOrden = await cliente.orden.create({
      data: {
        folio: 2n,
        idEmpresa: empresa.id,
        idModelo: modeloId,
        idCliente: clienteNegocioId,
        estado: 'completa',
        fechaCompletada: new Date(),
      },
    });
    // La terna tela/lote/movimiento SÍ estaba en la nota (se siembra); lo que cambia —y lo que se
    // rechaza— es la orden a la que se le quiere colgar el envío.
    const idNota = await borradorDeAvios();
    await sembrarRenglonTelaLegacy(idNota, { idMovimientoSalidaTela: salida.id, cantidad: 100 });
    await expect(
      actualizarNotaSalida(
        sesion(PERM_ADMIN),
        idNota,
        {
          lineas: [
            {
              idOrden: otraOrden.id,
              idTela: telaFelpa.id,
              idLote: loteRojo.id,
              idMovimientoSalidaTela: salida.id,
              cantidad: 100,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/otra orden/);
  });
});

describe('Notas de salida (F4-E5) — consultas', () => {
  it('listar por idOrden trae las notas que envían material a esa orden', async () => {
    await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 5, unidad: 'pza' }],
      },
      bd(),
    );
    const pagina = await listarNotasSalida(sesion(PERM_ADMIN), { idOrden: ordenId }, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]!.lineas[0]!.idOrden).toBe(ordenId);
  });

  it('crear una nota con un maquilero inexistente → ErrorNoEncontrado', async () => {
    await expect(
      crearNotaSalida(
        sesion(PERM_ADMIN),
        {
          idMaquilero: 999999,
          idAlmacen: almacen.id,
          fechaElaboracion: '2026-06-21',
          lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 5 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('Notas de salida — resumen de cabecera (KPIs vNotasSalida, R9)', () => {
  /** Crea una nota (un renglón de avío por orden) y devuelve su id. */
  async function crearNota(idsOrden: number[]): Promise<number> {
    const nota = await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: idsOrden.map((idOrden) => ({
          idOrden,
          idAvio: avioBoton.id,
          cantidad: 5,
          unidad: 'pza',
        })),
      },
      bd(),
    );
    return nota.id;
  }

  /** Otra orden del mismo modelo/cliente (folios distintos para no chocar con la del beforeEach). */
  async function crearOrden(folio: number): Promise<number> {
    const orden = await cliente.orden.create({
      data: {
        folio: BigInt(folio),
        idEmpresa: empresa.id,
        idModelo: modeloId,
        idCliente: clienteNegocioId,
        estado: 'completa',
        fechaCompletada: new Date(),
      },
    });
    return orden.id;
  }

  it('cuenta por estatus y las órdenes surtidas DISTINTAS de notas confirmadas (sumas a mano)', async () => {
    await sembrarAvio(1000);
    const orden2 = await crearOrden(2);
    const orden3 = await crearOrden(3);

    // A mano: 1 borrador + 2 confirmadas + 1 cancelada = 4 notas.
    await crearNota([ordenId]); // borrador
    const n2 = await crearNota([ordenId]);
    await confirmarNotaSalida(sesion(PERM_ADMIN), n2, bd());
    const n3 = await crearNota([ordenId, orden2]); // 2 renglones, 2 órdenes
    await confirmarNotaSalida(sesion(PERM_ADMIN), n3, bd());
    const n4 = await crearNota([orden3]);
    await confirmarNotaSalida(sesion(PERM_ADMIN), n4, bd());
    await cancelarNotaSalida(
      sesion(PERM_CANCELAR),
      n4,
      { motivo: 'Se equivocó el capturista' },
      bd(),
    );

    const resumen = await resumenNotasSalida(sesion(PERM_ADMIN), {}, bd());
    expect(resumen.notas).toBe(4);
    expect(resumen.borradores).toBe(1);
    expect(resumen.confirmadas).toBe(2);
    // Órdenes surtidas = {ordenId, orden2} de las CONFIRMADAS; la orden3 NO cuenta (su nota se
    // canceló y el material regresó) aunque la nota sí cuenta en el total.
    expect(resumen.ordenesSurtidas).toBe(2);
  });

  it('acota el universo con los MISMOS filtros del listado (maquilero) y por empresa (A9)', async () => {
    await sembrarAvio(1000);
    const otroMaquilero = await cliente.proveedor.create({ data: { nombre: 'Maquila del Norte' } });

    const n1 = await crearNota([ordenId]);
    await confirmarNotaSalida(sesion(PERM_ADMIN), n1, bd());
    await crearNotaSalida(
      sesion(PERM_ADMIN),
      {
        idMaquilero: otroMaquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: ordenId, idAvio: avioBoton.id, cantidad: 5, unidad: 'pza' }],
      },
      bd(),
    );

    // Filtro por maquilero: solo el universo del Norte (1 borrador, 0 confirmadas).
    const porMaquilero = await resumenNotasSalida(
      sesion(PERM_ADMIN),
      { idMaquilero: otroMaquilero.id },
      bd(),
    );
    expect(porMaquilero).toEqual({ notas: 1, borradores: 1, confirmadas: 0, ordenesSurtidas: 0 });

    // Búsqueda por nombre (mismo criterio que el listado).
    const porBusqueda = await resumenNotasSalida(sesion(PERM_ADMIN), { busqueda: 'Sur' }, bd());
    expect(porBusqueda.notas).toBe(1);
    expect(porBusqueda.confirmadas).toBe(1);

    // Otra empresa NO ve nada (A9).
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    const deOtraEmpresa = await resumenNotasSalida(sesion(PERM_ADMIN, otraEmpresa.id), {}, bd());
    expect(deOtraEmpresa).toEqual({ notas: 0, borradores: 0, confirmadas: 0, ordenesSurtidas: 0 });
  });

  it('deny-by-default (A4): sin `notas.ver` el resumen se rechaza', async () => {
    await expect(resumenNotasSalida(sesion([]), {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
