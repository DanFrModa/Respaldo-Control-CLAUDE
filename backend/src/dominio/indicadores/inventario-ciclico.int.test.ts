/**
 * Tests de INTEGRACIÓN del INVENTARIO CÍCLICO (F7-E5) contra Postgres efímero (testcontainers).
 * Ejercitan el DOMINIO (no HTTP) y verifican las garantías del negocio (D6/D3/D4):
 *  (a) el ALTA CONGELA el teórico: un movimiento POSTERIOR al alta NO cambia `cantTeorica`;
 *  (b) conteo CIEGO: la vista de conteo NO expone `cantTeorica`;
 *  (c) exactitud = cantReal − cantTeorica; estado abierto→contado al terminar el conteo;
 *  (d) el ajuste se aplica SOLO como MOVIMIENTO de kardex (aparece un `Movimiento` con el delta) y la
 *      existencia solo cambia por ese movimiento; re-generar el ajuste se rechaza;
 *  (e) un ajuste de SALIDA que dejaría negativo se rechaza (no crea movimiento, no cierra);
 *  (f) A9: otra empresa no ve el cíclico.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Talla,
  TipoMovimientoInventario,
} from '../../datos/index.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { registrarMovimientoPt as registrarMovimientoPtMotor } from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import {
  cancelarInventarioCiclico,
  capturarConteo,
  consultarExactitud,
  crearInventarioCiclico,
  generarAjusteCiclico,
  listarInventariosCiclicos,
  obtenerConteo,
} from './inventario-ciclico.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let almPrimeras: Almacen;
let tEntradaInicial: TipoMovimientoInventario;
let tEntregaCliente: TipoMovimientoInventario;

const PERM: ClavePermiso[] = [
  'indicadores.ciclicos-alta',
  'indicadores.ciclicos-conteo',
  'indicadores.ciclicos-consulta',
];
const sesion = (idEmpresa = empresa.id, permisos: ClavePermiso[] = PERM) =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos });
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
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  const tipos = await cliente.tipoMovimientoInventario.createManyAndReturn({
    data: [
      { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
      { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
      {
        codigo: 'ajuste-ciclico-entrada',
        nombre: 'Ajuste por Cíclico (Entrada)',
        direccion: 'entrada',
      },
      {
        codigo: 'ajuste-ciclico-salida',
        nombre: 'Ajuste por Cíclico (Salida)',
        direccion: 'salida',
      },
    ],
  });
  tEntradaInicial = tipos.find((t) => t.codigo === 'inventario-inicial')!;
  tEntregaCliente = tipos.find((t) => t.codigo === 'entrega-cliente')!;
});

/** Registra un movimiento de PT (para preparar/alterar la existencia del artículo Rojo/talla). */
async function mover(
  tipo: TipoMovimientoInventario,
  cantidad: number,
  idTalla = tallaCH.id,
): Promise<void> {
  await registrarMovimientoPtMotor(
    sesion(),
    {
      idEmpresa: empresa.id,
      idTipoMov: tipo.id,
      idAlmacen: almPrimeras.id,
      fecha: new Date('2026-07-01T00:00:00.000Z'),
      origenTipo: ORIGEN.movimientoManual,
      lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla, cantidad }],
    },
    bd(),
  );
}

/** Existencia ACTUAL (Σ de la vista) del artículo Rojo/talla en Primeras. */
async function existencia(idTalla = tallaCH.id): Promise<number> {
  const filas = await cliente.$queryRaw<{ existencia: bigint }[]>`
    SELECT COALESCE(SUM("existencia"), 0)::bigint AS existencia
    FROM "existencia_pt"
    WHERE "id_empresa" = ${empresa.id} AND "id_almacen" = ${almPrimeras.id}
      AND "id_color" = ${colorRojo.id} AND "id_talla" = ${idTalla}`;
  return Number(filas[0]?.existencia ?? 0n);
}

describe('Alta — congela el teórico (D6)', () => {
  it('(a) un movimiento POSTERIOR al alta NO cambia el teórico congelado', async () => {
    await mover(tEntradaInicial, 10); // existencia = 10
    const inv = await crearInventarioCiclico(
      sesion(),
      { idAlmacen: almPrimeras.id, idsModelo: [modelo.id] },
      bd(),
    );
    expect(inv.estado).toBe('abierto');
    expect(inv.totalRenglones).toBe(1);

    const det1 = await cliente.inventarioCiclicoDet.findFirstOrThrow({
      where: { idInventarioCiclico: inv.id },
    });
    expect(det1.cantTeorica).toBe(10);

    // Cambia la existencia DESPUÉS del alta: el teórico congelado NO debe moverse.
    await mover(tEntradaInicial, 5); // existencia real = 15
    expect(await existencia()).toBe(15);
    const det2 = await cliente.inventarioCiclicoDet.findFirstOrThrow({ where: { id: det1.id } });
    expect(det2.cantTeorica).toBe(10);
  });

  it('rechaza el alta si el alcance no tiene existencias', async () => {
    await expect(
      crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Conteo ciego (D6)', () => {
  it('(b) la vista de conteo NO expone el teórico', async () => {
    await mover(tEntradaInicial, 8);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const conteo = await obtenerConteo(sesion(), inv.id, bd());
    expect(conteo.renglones).toHaveLength(1);
    const renglon = conteo.renglones[0]!;
    expect(Object.prototype.hasOwnProperty.call(renglon, 'cantTeorica')).toBe(false);
    expect(renglon.cantReal).toBeNull();
    expect(renglon.contado).toBe(false);
  });

  it('(c) captura el conteo, pasa a estado "contado" y calcula la exactitud', async () => {
    await mover(tEntradaInicial, 10); // teórico 10
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const conteo = await obtenerConteo(sesion(), inv.id, bd());
    const idDet = conteo.renglones[0]!.idDet;

    const trasConteo = await capturarConteo(
      sesion(),
      inv.id,
      { renglones: [{ idDet, cantReal: 12 }] },
      bd(),
    );
    expect(trasConteo.estado).toBe('contado');

    const exactitud = await consultarExactitud(sesion(), inv.id, bd());
    expect(exactitud.renglones[0]!.cantTeorica).toBe(10);
    expect(exactitud.renglones[0]!.cantReal).toBe(12);
    expect(exactitud.renglones[0]!.exactitud).toBe(2);
    expect(exactitud.totales).toMatchObject({
      total: 1,
      contados: 1,
      diferencias: 1,
      teorico: 10,
      real: 12,
    });
  });
});

describe('Ajuste — solo por MOVIMIENTO de kardex (D3)', () => {
  it('(d) genera el ajuste de ENTRADA, cierra, enlaza el movimiento y no re-genera', async () => {
    await mover(tEntradaInicial, 10); // teórico 10
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 13 }] }, bd());

    const antes = await existencia();
    const trasAjuste = await generarAjusteCiclico(sesion(), inv.id, bd());
    expect(trasAjuste.estado).toBe('cerrado');

    // La existencia cambió EXACTAMENTE por el delta (+3), vía un MOVIMIENTO nuevo.
    expect(await existencia()).toBe(antes + 3);

    const movs = await cliente.movimiento.findMany({
      where: { idEmpresa: empresa.id, origenTipo: ORIGEN.ajusteCiclico },
      include: { detallesPt: true, tipoMov: { select: { codigo: true, direccion: true } } },
    });
    expect(movs).toHaveLength(1);
    expect(movs[0]!.tipoMov.codigo).toBe('ajuste-ciclico-entrada');
    expect(movs[0]!.origenId).toBe(String(inv.id));
    expect(movs[0]!.detallesPt[0]!.cantidad).toBe(3);

    // El renglón queda enlazado a su movimiento de ajuste.
    expect(trasAjuste.renglones[0]!.idMovimientoAjuste).toBe(movs[0]!.id);

    // No se re-genera un ajuste ya cerrado.
    await expect(generarAjusteCiclico(sesion(), inv.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('genera el ajuste de SALIDA cuando lo contado es MENOS que el teórico', async () => {
    await mover(tEntradaInicial, 10); // teórico 10, existencia 10
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 6 }] }, bd());

    await generarAjusteCiclico(sesion(), inv.id, bd());
    expect(await existencia()).toBe(6); // 10 − 4

    const mov = await cliente.movimiento.findFirstOrThrow({
      where: { idEmpresa: empresa.id, origenTipo: ORIGEN.ajusteCiclico },
      include: { detallesPt: true, tipoMov: { select: { codigo: true } } },
    });
    expect(mov.tipoMov.codigo).toBe('ajuste-ciclico-salida');
    expect(mov.detallesPt[0]!.cantidad).toBe(4);
  });

  it('(e) rechaza un ajuste de SALIDA que dejaría el inventario en negativo', async () => {
    await mover(tEntradaInicial, 10); // teórico congelado = 10
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    // Después del alta se entrega casi todo: existencia real baja a 2.
    await mover(tEntregaCliente, 8);
    expect(await existencia()).toBe(2);
    // Se cuenta 1 → delta = 1 − 10 = −9 (salida 9) > existencia 2 → rechazo.
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 1 }] }, bd());
    await expect(generarAjusteCiclico(sesion(), inv.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // No cerró ni creó movimiento de ajuste (todo o nada, A2).
    const inv2 = await cliente.inventarioCiclico.findUniqueOrThrow({ where: { id: inv.id } });
    expect(inv2.estado).toBe('contado');
    const ajustes = await cliente.movimiento.count({
      where: { idEmpresa: empresa.id, origenTipo: ORIGEN.ajusteCiclico },
    });
    expect(ajustes).toBe(0);
  });

  it('rechaza generar el ajuste si el conteo no está completo', async () => {
    await mover(tEntradaInicial, 5, tallaCH.id);
    await mover(tEntradaInicial, 7, tallaM.id);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    expect(inv.totalRenglones).toBe(2);
    const conteo = await obtenerConteo(sesion(), inv.id, bd());
    // Cuenta solo UNO de los dos renglones → sigue "abierto".
    const tras = await capturarConteo(
      sesion(),
      inv.id,
      { renglones: [{ idDet: conteo.renglones[0]!.idDet, cantReal: 5 }] },
      bd(),
    );
    expect(tras.estado).toBe('abierto');
    await expect(generarAjusteCiclico(sesion(), inv.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('(g) B1 — DOS ajustes CONCURRENTES del mismo cíclico: exactamente UNO tiene éxito', async () => {
    await mover(tEntradaInicial, 10); // teórico 10, existencia 10
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 13 }] }, bd());

    // Dos generaciones EN PARALELO contra la BD real: el `FOR UPDATE` del encabezado serializa; el 2º
    // ve "cerrado" y aborta. El delta (+3) NO se aplica 2× (existencia final 13, un solo movimiento).
    const resultados = await Promise.allSettled([
      generarAjusteCiclico(sesion(), inv.id, bd()),
      generarAjusteCiclico(sesion(), inv.id, bd()),
    ]);
    const exitosos = resultados.filter((r) => r.status === 'fulfilled');
    const fallidos = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(exitosos).toHaveLength(1);
    expect(fallidos).toHaveLength(1);
    expect(fallidos[0]!.reason).toBeInstanceOf(ErrorConflicto);

    // El ajuste se aplicó UNA sola vez (no doble): existencia 10 + 3 y un único movimiento de ajuste.
    expect(await existencia()).toBe(13);
    const ajustes = await cliente.movimiento.count({
      where: { idEmpresa: empresa.id, origenTipo: ORIGEN.ajusteCiclico },
    });
    expect(ajustes).toBe(1);
  });
});

describe('Cancelación y A9', () => {
  it('cancela (suave) y ya no admite conteo', async () => {
    await mover(tEntradaInicial, 4);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    const cancelado = await cancelarInventarioCiclico(
      sesion(),
      inv.id,
      { motivo: 'Duplicado' },
      bd(),
    );
    expect(cancelado.estado).toBe('cancelado');
    expect(cancelado.motivoCancelacion).toBe('Duplicado');
    await expect(
      capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 4 }] }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('(f) otra empresa NO ve el cíclico', async () => {
    await mover(tEntradaInicial, 4);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    await expect(consultarExactitud(sesion(otra.id), inv.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    const lista = await listarInventariosCiclicos(sesion(otra.id), {}, bd());
    expect(lista.total).toBe(0);
  });
});
