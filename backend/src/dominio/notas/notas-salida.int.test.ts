import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
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
  cancelarNotaSalida,
  confirmarNotaSalida,
  crearNotaSalida,
  listarNotasSalida,
} from './notas-salida.js';

/**
 * Integración del dominio de NOTAS DE SALIDA (F4-E5) contra Postgres efímero (testcontainers). Cubre
 * lo que SOLO la base valida (NO corre en local — usa Docker; lo corre el CI):
 *  • Folio NumNota consecutivo POR EMPRESA bajo CONCURRENCIA (A3).
 *  • Descuento EXACTO de AVÍOS al confirmar (`salida-por-nota`); existencia = Σ movimientos (D3).
 *  • Atomicidad (A2): si un avío no alcanza, NO queda nota confirmada NI movimiento (rollback).
 *  • Reverso al cancelar: la existencia del avío regresa vía inverso visible; nada se borra (D3).
 *  • ANTI-DOBLE-DESCUENTO de TELA: registrar una salida-a-orden y luego incluir esa tela en una nota
 *    → la existencia de la tela baja UNA sola vez (la nota REFERENCIA, no descuenta — decisión e).
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
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', unidadMedida: 'm' } });
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

describe('Notas de salida (F4-E5) — ANTI-DOBLE-DESCUENTO de TELA (decisión e)', () => {
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

    // 2) La nota REFERENCIA esa salida-a-orden (NO debe descontar otra vez).
    const nota = await crearNotaSalida(
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
    );
    await confirmarNotaSalida(sesion(PERM_ADMIN), nota.id, bd());

    // La existencia de la tela quedó IGUAL que tras la salida-a-orden (NO bajó otra vez).
    expect(await existenciaTela(telaFelpa.id, loteRojo.id)).toBe(300);
    // No hay ningún movimiento de tela atribuido a la nota.
    const movsNotaTela = await cliente.movimientoDetTela.count({
      where: { movimiento: { origenTipo: 'nota-salida' } },
    });
    expect(movsNotaTela).toBe(0);
  });

  it('renglón de tela SIN movimiento de salida-a-orden referenciado → ErrorValidacion', async () => {
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
              cantidad: 10,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
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

    // Una nota NO puede documentar un envío sobre una salida anulada.
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
              cantidad: 150,
              unidad: 'm',
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
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
    ).rejects.toBeInstanceOf(ErrorValidacion);
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
    await expect(
      crearNotaSalida(
        sesion(PERM_ADMIN),
        {
          idMaquilero: maquilero.id,
          idAlmacen: almacen.id,
          fechaElaboracion: '2026-06-21',
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
    ).rejects.toBeInstanceOf(ErrorValidacion);
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
