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
 *
 * ⭐ **FILA 0.099 — LAS TRES DIMENSIONES.** A lo anterior (todo de PT) se suman:
 *  (h) el AVISO de «el almacén se movió» (§Post-F9.193 punto 6) end-to-end: el caso EXACTO del
 *      dueño (100 congelado, 95 contado, 20 que entraron de verdad) NO escribe nada sin
 *      `confirmarMovimiento` y SÍ escribe con él — en PT, en TELAS y en AVÍOS;
 *  (i) hojas de TELA (dos componentes, D5) y de AVÍO completas: alta → captura → aviso → confirmar,
 *      verificando el MOVIMIENTO de kardex que quedó (su tipo `ajuste-ciclico-*`, su detalle y la
 *      existencia resultante);
 *  (j) el ajuste de telas/avíos exige ADEMÁS el `.mover` de su dimensión (`permisoAjuste`);
 *  (k) renglones AGREGADOS A MANO: teórico 0, duplicado, llave de otra dimensión y congelado bajo
 *      lock de lo que HAYA;
 *  (l) el ajuste de un cíclico NO se cancela desde Inventarios (las tres puertas de material);
 *  (m) quién lleva SEGUNDO COMPONENTE lo dice el teórico CONGELADO, no el catálogo de hoy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Avio,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Talla,
  Tela,
  TelaColor,
  TipoMovimientoInventario,
} from '../../datos/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import {
  registrarMovimientoAvio,
  registrarMovimientoPt as registrarMovimientoPtMotor,
  registrarMovimientoTela,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { cancelarMovimientoAvio } from '../inventarios/avios.js';
import { DONDE_CANCELAR_AJUSTE_CICLICO } from '../inventarios/cancelacion-comun.js';
import { cancelarMovimientoTelaColor } from '../inventarios/partidas-telas.js';
import { cancelarMovimientoTela } from '../inventarios/telas.js';

import {
  agregarRenglonCiclico,
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
// Fila 0.099 — las otras dos dimensiones.
let telaFelpa: Tela; // CON complemento ("Cardigan")
let telaLisa: Tela; // SIN complemento
let colorMarino: TelaColor; // de la felpa
let colorNegro: TelaColor; // de la lisa
let almTelas: Almacen;
let avioCierre: Avio;
let almAvios: Almacen;

/**
 * Permisos del capturista completo. Desde la fila 0.099 el ajuste de TELAS y AVÍOS exige ADEMÁS el
 * `.mover` de esa dimensión (`AdaptadorCiclico.permisoAjuste`): el ajuste escribe en SU kardex, y
 * abrir el cíclico a telas no debía regalarle esa llave a quien no la tenía.
 */
const PERM: ClavePermiso[] = [
  'indicadores.ciclicos-alta',
  'indicadores.ciclicos-conteo',
  'indicadores.ciclicos-consulta',
  'inventario-telas.mover',
  'inventario-avios.mover',
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
  almTelas = await cliente.almacen.create({ data: { nombre: 'Bodega de telas', tipo: 'TELA' } });
  almAvios = await cliente.almacen.create({ data: { nombre: 'Bodega de avíos', tipo: 'AVIO' } });
  telaFelpa = await cliente.tela.create({
    data: {
      nombre: 'Felpa Suiza',
      nombreCuerpo: 'Felpa',
      nombreComplemento: 'Cardigan',
      unidadMedida: 'KG',
    },
  });
  telaLisa = await cliente.tela.create({ data: { nombre: 'Lisa Algodón', unidadMedida: 'M' } });
  colorMarino = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Marino' },
  });
  colorNegro = await cliente.telaColor.create({ data: { idTela: telaLisa.id, nombre: 'Negro' } });
  avioCierre = await cliente.avio.create({
    data: { clave: 'CIE-01', descripcion: 'Cierre 20 cm', unidad: 'pza' },
  });
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
      // Los tipos del INVERSO de las cancelaciones de material. Se siembran para que el rechazo del
      // ajuste cíclico no pueda pasar por la razón equivocada («falta el tipo de movimiento»).
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
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

// ── Helpers de las otras dos dimensiones (fila 0.099) ────────────────────────────────────────────

/** Mueve TELA por COLOR (flujo nuevo): cuerpo + complemento viajan juntos en el mismo renglón. */
async function moverTela(
  color: TelaColor,
  cantidad: number,
  cantidadComplemento: number | null = null,
  tipo: TipoMovimientoInventario = tEntradaInicial,
): Promise<void> {
  await registrarMovimientoTela(
    sesion(),
    {
      idEmpresa: empresa.id,
      idTipoMov: tipo.id,
      idAlmacen: almTelas.id,
      fecha: new Date('2026-07-01T00:00:00.000Z'),
      origenTipo: ORIGEN.movimientoManual,
      lineas: [{ idTela: color.idTela, idTelaColor: color.id, cantidad, cantidadComplemento }],
    },
    bd(),
  );
}

/** Mueve AVÍO en la bodega de avíos. */
async function moverAvio(
  cantidad: number,
  tipo: TipoMovimientoInventario = tEntradaInicial,
): Promise<void> {
  await registrarMovimientoAvio(
    sesion(),
    {
      idEmpresa: empresa.id,
      idTipoMov: tipo.id,
      idAlmacen: almAvios.id,
      fecha: new Date('2026-07-01T00:00:00.000Z'),
      origenTipo: ORIGEN.movimientoManual,
      lineas: [{ idAvio: avioCierre.id, cantidad }],
    },
    bd(),
  );
}

/** Existencia ACTUAL (vista) de un color de tela en la bodega de telas: sus DOS componentes. */
async function existenciaTela(color: TelaColor): Promise<{ cuerpo: number; complemento: number }> {
  const filas = await cliente.$queryRaw<{ cuerpo: number; complemento: number }[]>`
    SELECT COALESCE(SUM("existencia_cuerpo"), 0)::float8 AS cuerpo,
           COALESCE(SUM("existencia_complemento"), 0)::float8 AS complemento
    FROM "existencia_tela_color"
    WHERE "id_empresa" = ${empresa.id} AND "id_almacen" = ${almTelas.id}
      AND "id_tela_color" = ${color.id}`;
  return { cuerpo: filas[0]?.cuerpo ?? 0, complemento: filas[0]?.complemento ?? 0 };
}

/** Existencia ACTUAL (vista) del avío en la bodega de avíos. */
async function existenciaAvio(): Promise<number> {
  const filas = await cliente.$queryRaw<{ existencia: number }[]>`
    SELECT COALESCE(SUM("existencia"), 0)::float8 AS existencia
    FROM "existencia_avio"
    WHERE "id_empresa" = ${empresa.id} AND "id_almacen" = ${almAvios.id}
      AND "id_avio" = ${avioCierre.id}`;
  return filas[0]?.existencia ?? 0;
}

/** Los movimientos de ajuste cíclico de la empresa (con su tipo y su detalle de cada dimensión). */
async function movimientosDeAjuste() {
  return cliente.movimiento.findMany({
    where: { idEmpresa: empresa.id, origenTipo: ORIGEN.ajusteCiclico },
    include: {
      detallesPt: true,
      detallesTela: true,
      detallesAvio: true,
      tipoMov: { select: { codigo: true, direccion: true } },
    },
  });
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

  it('PERMITE el alta de una hoja VACÍA (§Post-F9.193: se anota mercancía con existencia CERO)', async () => {
    // Hasta la fila 0.099 esto se rechazaba con ErrorConflicto. Ya no: contar un almacén que el
    // sistema cree vacío —el día del arranque, exactamente— es el caso de uso, no un error. La hoja
    // nace abierta y sin renglones, y se llena a mano con `agregarRenglonCiclico`.
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    expect(inv.estado).toBe('abierto');
    expect(inv.totalRenglones).toBe(0);
    expect(inv.renglonesContados).toBe(0);
    // Y una hoja vacía NO puede ajustarse: no hay nada que reconciliar.
    await expect(generarAjusteCiclico(sesion(), inv.id, {}, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
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
    const trasAjuste = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(trasAjuste.aplicado).toBe(true);
    expect(trasAjuste.aviso).toBeNull(); // nada se movió entre el alta y el cierre
    expect(trasAjuste.exactitud.estado).toBe('cerrado');

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

    // El renglón queda enlazado a su movimiento de ajuste (traza de la exactitud).
    expect(trasAjuste.exactitud.renglones[0]!.ajustes).toEqual([
      { id: movs[0]!.id, folio: Number(movs[0]!.folio), direccion: 'entrada' },
    ]);

    // No se re-genera un ajuste ya cerrado.
    await expect(generarAjusteCiclico(sesion(), inv.id, {}, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('genera el ajuste de SALIDA cuando lo contado es MENOS que el teórico', async () => {
    await mover(tEntradaInicial, 10); // teórico 10, existencia 10
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 6 }] }, bd());

    await generarAjusteCiclico(sesion(), inv.id, {}, bd());
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
    // El almacén SÍ se movió (10 → 2), así que el primer intento sale con el AVISO, no con el
    // rechazo: el aviso se evalúa ANTES de escribir nada, que es justo lo que evita el negativo.
    const aviso = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(aviso.aplicado).toBe(false);
    expect(aviso.aviso?.articulos[0]).toMatchObject({
      existenciaActual: 2,
      existenciaResultante: -7,
    });
    // Y si aun así se confirma, la guarda del no-negativo (D3) lo para en seco.
    await expect(
      generarAjusteCiclico(sesion(), inv.id, { confirmarMovimiento: true }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

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
    await expect(generarAjusteCiclico(sesion(), inv.id, {}, bd())).rejects.toBeInstanceOf(
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
      generarAjusteCiclico(sesion(), inv.id, {}, bd()),
      generarAjusteCiclico(sesion(), inv.id, {}, bd()),
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FILA 0.099 — EL AVISO DE «EL ALMACÉN SE MOVIÓ» (§Post-F9.193 punto 6)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('(h) El almacén se movió entre el alta y el cierre: AVISA y deja decidir, NO bloquea', () => {
  it('PT — el caso exacto del dueño: 100 congelado, 95 contado, 20 que entraron de verdad', async () => {
    await mover(tEntradaInicial, 100); // el sistema tiene 100
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;

    // Mientras la hoja está abierta ENTRAN 20 piezas de verdad: el anaquel tiene 120 y el conteo,
    // hecho antes, dice 95. Hasta esta fila el sistema escribía −5 en silencio y dejaba 115.
    await mover(tEntradaInicial, 20);
    expect(await existencia()).toBe(120);
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 95 }] }, bd());

    // 1er intento: SIN confirmar → avisa y NO escribe nada.
    const aviso = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(aviso.aplicado).toBe(false);
    expect(aviso.aviso?.articulos).toHaveLength(1);
    expect(aviso.aviso?.articulos[0]).toMatchObject({
      idDet,
      componente: 'cuerpo',
      cantTeorica: 100,
      existenciaActual: 120,
      cantReal: 95,
      ajuste: -5,
      existenciaResultante: 115, // ⭐ en cuánto quedaría: lo que hace falta para decidir
    });
    expect(await existencia()).toBe(120); // nada escrito
    expect(await movimientosDeAjuste()).toHaveLength(0);
    expect(aviso.exactitud.estado).toBe('contado'); // la hoja sigue viva

    // 2º intento: el usuario ya vio el aviso y decide aplicar.
    const aplicado = await generarAjusteCiclico(
      sesion(),
      inv.id,
      { confirmarMovimiento: true },
      bd(),
    );
    expect(aplicado.aplicado).toBe(true);
    expect(aplicado.aviso?.articulos).toHaveLength(1); // el aviso VIAJA también cuando se aplica
    expect(aplicado.exactitud.estado).toBe('cerrado');
    expect(await existencia()).toBe(115);
    const movs = await movimientosDeAjuste();
    expect(movs).toHaveLength(1);
    expect(movs[0]!.tipoMov.codigo).toBe('ajuste-ciclico-salida');
    expect(movs[0]!.detallesPt[0]!.cantidad).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FILA 0.099 — HOJA DE TELAS (dos componentes, D5)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('(i) Hoja de TELA — alta, captura con el saldo a la vista, aviso y ajuste al kardex', () => {
  it('cuenta tela×color, avisa del movimiento y al confirmar escribe UN movimiento con los dos componentes', async () => {
    await moverTela(colorMarino, 100, 40);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    expect(inv.dimension).toBe('TELA'); // la manda el TIPO DEL ALMACÉN, no un campo del usuario
    expect(inv.totalRenglones).toBe(1);

    // El conteo de telas NO es ciego: el saldo del sistema va A LA VISTA (§Post-F9.193 punto 4).
    const conteo = await obtenerConteo(sesion(), inv.id, bd());
    const renglon = conteo.renglones[0]!;
    expect(renglon.cantTeorica).toBe(100);
    expect(renglon.cantTeoricaComplemento).toBe(40);
    expect(renglon.nombreComplemento).toBe('Cardigan');
    expect(renglon.unidad).toBe('kg');

    // Entran 20 kg de cuerpo mientras se cuenta.
    await moverTela(colorMarino, 20, 0);
    await capturarConteo(
      sesion(),
      inv.id,
      { renglones: [{ idDet: renglon.idDet, cantReal: 95, cantRealComplemento: 38 }] },
      bd(),
    );

    const aviso = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(aviso.aplicado).toBe(false);
    expect(aviso.aviso?.articulos).toHaveLength(1); // sólo el CUERPO se movió
    expect(aviso.aviso?.articulos[0]).toMatchObject({
      titulo: 'Felpa Suiza',
      subtitulo: 'Marino',
      componente: 'cuerpo',
      cantTeorica: 100,
      existenciaActual: 120,
      existenciaResultante: 115,
    });
    expect(await movimientosDeAjuste()).toHaveLength(0);

    const aplicado = await generarAjusteCiclico(
      sesion(),
      inv.id,
      { confirmarMovimiento: true },
      bd(),
    );
    expect(aplicado.aplicado).toBe(true);
    expect(aplicado.exactitud.estado).toBe('cerrado');

    // ⭐ El efecto EN EL KARDEX: un solo movimiento de salida con los dos componentes.
    const movs = await movimientosDeAjuste();
    expect(movs).toHaveLength(1);
    expect(movs[0]!.tipoMov.codigo).toBe('ajuste-ciclico-salida');
    expect(movs[0]!.origenId).toBe(String(inv.id));
    expect(movs[0]!.detallesTela).toHaveLength(1);
    expect(Number(movs[0]!.detallesTela[0]!.cantidad)).toBe(5); // 95 − 100
    expect(Number(movs[0]!.detallesTela[0]!.cantidadComplemento)).toBe(2); // 38 − 40
    expect(movs[0]!.detallesTela[0]!.idTelaColor).toBe(colorMarino.id);
    expect(await existenciaTela(colorMarino)).toEqual({ cuerpo: 115, complemento: 38 });

    // Y el renglón queda enlazado a SU movimiento (traza de la exactitud).
    expect(aplicado.exactitud.renglones[0]!.ajustes).toEqual([
      { id: movs[0]!.id, folio: Number(movs[0]!.folio), direccion: 'salida' },
    ]);
  });

  it('el alcance de una hoja de telas se acota con TELAS: mandar modelos o avíos se rechaza', async () => {
    await moverTela(colorMarino, 10, 5);
    await expect(
      crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id, idsModelo: [modelo.id] }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('(j) el ajuste de TELAS exige ADEMÁS inventario-telas.mover', async () => {
    await moverTela(colorNegro, 10);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 8 }] }, bd());

    const sinLlave: ClavePermiso[] = [
      'indicadores.ciclicos-alta',
      'indicadores.ciclicos-conteo',
      'indicadores.ciclicos-consulta',
    ];
    await expect(
      generarAjusteCiclico(sesion(empresa.id, sinLlave), inv.id, {}, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(await movimientosDeAjuste()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FILA 0.099 — HOJA DE AVÍOS
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('(i) Hoja de AVÍO — alta, captura, aviso y ajuste al kardex', () => {
  it('cuenta avíos, avisa del movimiento y al confirmar escribe el movimiento de salida', async () => {
    await moverAvio(500);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almAvios.id }, bd());
    expect(inv.dimension).toBe('AVIO');
    const conteo = await obtenerConteo(sesion(), inv.id, bd());
    const renglon = conteo.renglones[0]!;
    expect(renglon.titulo).toBe('CIE-01');
    expect(renglon.cantTeorica).toBe(500); // saldo a la vista (no es ciego)
    expect(renglon.nombreComplemento).toBeNull(); // un avío no tiene segundo componente

    await moverAvio(100); // el almacén se mueve mientras se cuenta: 600
    await capturarConteo(
      sesion(),
      inv.id,
      { renglones: [{ idDet: renglon.idDet, cantReal: 480 }] },
      bd(),
    );

    const aviso = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(aviso.aplicado).toBe(false);
    expect(aviso.aviso?.articulos[0]).toMatchObject({
      cantTeorica: 500,
      existenciaActual: 600,
      cantReal: 480,
      ajuste: -20,
      existenciaResultante: 580,
    });
    expect(await existenciaAvio()).toBe(600);

    await generarAjusteCiclico(sesion(), inv.id, { confirmarMovimiento: true }, bd());
    const movs = await movimientosDeAjuste();
    expect(movs).toHaveLength(1);
    expect(movs[0]!.tipoMov.codigo).toBe('ajuste-ciclico-salida');
    expect(movs[0]!.detallesAvio).toHaveLength(1);
    expect(Number(movs[0]!.detallesAvio[0]!.cantidad)).toBe(20);
    expect(await existenciaAvio()).toBe(580);
  });

  it('un conteo que SOBREPASA el sistema entra por ajuste-ciclico-entrada (decimales incluidos)', async () => {
    await moverAvio(100);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almAvios.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    // Un avío se mide en su unidad de consumo: los decimales son `Decimal(14,4)`, no piezas.
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 112.5 }] }, bd());

    const res = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(res.aplicado).toBe(true);
    expect(res.aviso).toBeNull(); // el almacén NO se movió
    const movs = await movimientosDeAjuste();
    expect(movs[0]!.tipoMov.codigo).toBe('ajuste-ciclico-entrada');
    expect(Number(movs[0]!.detallesAvio[0]!.cantidad)).toBe(12.5);
    expect(await existenciaAvio()).toBe(112.5);
  });

  it('(j) el ajuste de AVÍOS exige ADEMÁS inventario-avios.mover', async () => {
    await moverAvio(100);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almAvios.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 90 }] }, bd());
    const sinLlave: ClavePermiso[] = ['indicadores.ciclicos-consulta'];
    await expect(
      generarAjusteCiclico(sesion(empresa.id, sinLlave), inv.id, {}, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FILA 0.099 — RENGLONES AGREGADOS A MANO (§Post-F9.193: mercancía con existencia CERO)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('(k) Renglón agregado a mano', () => {
  it('anota mercancía que el sistema cree que NO tiene: nace con teórico 0 y su ajuste ENTRA al kardex', async () => {
    // Almacén que el sistema cree vacío → hoja vacía (el día del arranque, exactamente).
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    expect(inv.totalRenglones).toBe(0);

    const tras = await agregarRenglonCiclico(
      sesion(),
      inv.id,
      { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaCH.id },
      bd(),
    );
    expect(tras.renglones).toHaveLength(1);
    const idDet = tras.renglones[0]!.idDet;
    const det = await cliente.inventarioCiclicoDet.findUniqueOrThrow({ where: { id: idDet } });
    expect(det.cantTeorica).toBe(0);

    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 7 }] }, bd());
    const res = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(res.aplicado).toBe(true);
    expect(await existencia()).toBe(7);
    const movs = await movimientosDeAjuste();
    expect(movs[0]!.tipoMov.codigo).toBe('ajuste-ciclico-entrada');
    expect(movs[0]!.detallesPt[0]!.cantidad).toBe(7);
  });

  it('CONGELA bajo lock lo que HAYA, no un 0 a la fuerza', async () => {
    // El alta acota a otro modelo, así que A-100 (que sí tiene 10) queda fuera de la enumeración.
    const otro = await cliente.modelo.create({ data: { codigo: 'B-200', descripcion: 'Short' } });
    await mover(tEntradaInicial, 10);
    const inv = await crearInventarioCiclico(
      sesion(),
      { idAlmacen: almPrimeras.id, idsModelo: [otro.id] },
      bd(),
    );
    expect(inv.totalRenglones).toBe(0);

    const tras = await agregarRenglonCiclico(
      sesion(),
      inv.id,
      { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaCH.id },
      bd(),
    );
    const det = await cliente.inventarioCiclicoDet.findUniqueOrThrow({
      where: { id: tras.renglones[0]!.idDet },
    });
    // Congelar un 0 inventado sería inventar un teórico que la BD desmiente.
    expect(det.cantTeorica).toBe(10);
  });

  it('rechaza el DUPLICADO (aunque en PT la unicidad de la BD no lo cubra: id_orden es NULL)', async () => {
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const llave = { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaCH.id };
    await agregarRenglonCiclico(sesion(), inv.id, llave, bd());
    await expect(agregarRenglonCiclico(sesion(), inv.id, llave, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    expect((await obtenerConteo(sesion(), inv.id, bd())).renglones).toHaveLength(1);
  });

  it('rechaza la llave de OTRA dimensión, en los dos sentidos', async () => {
    const invPt = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    // Hoja de PT con llave de tela.
    await expect(
      agregarRenglonCiclico(sesion(), invPt.id, { idTelaColor: colorMarino.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    const invTela = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    // Hoja de telas con llave de PT.
    await expect(
      agregarRenglonCiclico(
        sesion(),
        invTela.id,
        { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaCH.id },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Y una hoja de telas SÍ admite su propia llave, con teórico 0.
    const tras = await agregarRenglonCiclico(
      sesion(),
      invTela.id,
      { idTelaColor: colorNegro.id },
      bd(),
    );
    expect(tras.renglones[0]!.cantTeorica).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FILA 0.099 — EL AJUSTE DE UN CÍCLICO NO SE DESHACE DESDE INVENTARIOS
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('(l) El movimiento de un ajuste cíclico NO se cancela por la vía normal', () => {
  /** Cierra un cíclico de la dimensión pedida y devuelve el id del movimiento que escribió. */
  async function ajusteCerrado(dimension: 'TELA' | 'AVIO'): Promise<number> {
    if (dimension === 'TELA') {
      await moverTela(colorMarino, 100, 40);
      const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
      const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
      await capturarConteo(
        sesion(),
        inv.id,
        { renglones: [{ idDet, cantReal: 90, cantRealComplemento: 35 }] },
        bd(),
      );
      await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    } else {
      await moverAvio(500);
      const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almAvios.id }, bd());
      const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
      await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 480 }] }, bd());
      await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    }
    const movs = await movimientosDeAjuste();
    expect(movs).toHaveLength(1);
    return movs[0]!.id;
  }

  const motivo = { motivo: 'Me equivoqué al contar' };

  it('TELAS por COLOR (partidas-telas) — rechaza y dice qué hacer en su lugar', async () => {
    const idMov = await ajusteCerrado('TELA');
    await expect(cancelarMovimientoTelaColor(sesion(), idMov, motivo, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
    await expect(cancelarMovimientoTelaColor(sesion(), idMov, motivo, bd())).rejects.toThrow(
      DONDE_CANCELAR_AJUSTE_CICLICO,
    );
    // Y no dejó ningún inverso: el kardex sigue contando la misma historia que la hoja.
    expect(await existenciaTela(colorMarino)).toEqual({ cuerpo: 90, complemento: 35 });
  });

  it('TELAS por LOTE (la puerta LEGADA de telas.ts) — la misma llave se pide en TODAS las puertas', async () => {
    const idMov = await ajusteCerrado('TELA');
    await expect(cancelarMovimientoTela(sesion(), idMov, motivo, bd())).rejects.toThrow(
      DONDE_CANCELAR_AJUSTE_CICLICO,
    );
  });

  it('AVÍOS — rechaza igual que las telas (el texto vive una sola vez)', async () => {
    const idMov = await ajusteCerrado('AVIO');
    await expect(cancelarMovimientoAvio(sesion(), idMov, motivo, bd())).rejects.toThrow(
      DONDE_CANCELAR_AJUSTE_CICLICO,
    );
    expect(await existenciaAvio()).toBe(480);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FILA 0.099 — EL SEGUNDO COMPONENTE LO DICE LO CONGELADO, NO EL CATÁLOGO DE HOY
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('(m) La forma de una hoja abierta la fija el teórico CONGELADO', () => {
  it('poner nombreComplemento a la tela DESPUÉS del alta no obliga a capturar un segundo número', async () => {
    // La lisa NO lleva complemento: la hoja se congela con un solo componente.
    await moverTela(colorNegro, 60);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;

    // Alguien edita el CATÁLOGO con la hoja ya abierta.
    await cliente.tela.update({
      where: { id: telaLisa.id },
      data: { nombreComplemento: 'Cardigan' },
    });

    // La hoja no cambia de forma: sigue pidiendo UN número, porque es el único que el ajuste puede
    // mover. Antes de la fila 0.099 esto exigía el segundo… y el ajuste lo ignoraba en silencio.
    const conteo = await obtenerConteo(sesion(), inv.id, bd());
    expect(conteo.renglones[0]!.nombreComplemento).toBeNull();
    expect(conteo.renglones[0]!.cantTeoricaComplemento).toBeUndefined();
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 58 }] }, bd());

    const res = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(res.aplicado).toBe(true);
    const movs = await movimientosDeAjuste();
    expect(Number(movs[0]!.detallesTela[0]!.cantidad)).toBe(2);
    expect(movs[0]!.detallesTela[0]!.cantidadComplemento).toBeNull();
    expect(await existenciaTela(colorNegro)).toEqual({ cuerpo: 58, complemento: 0 });
  });

  it('quitarle el nombreComplemento a la tela DESPUÉS del alta no borra el componente congelado', async () => {
    await moverTela(colorMarino, 100, 40);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;

    await cliente.tela.update({
      where: { id: telaFelpa.id },
      data: { nombreComplemento: null },
    });

    // El teórico del complemento SÍ se congeló, así que se sigue pidiendo (con etiqueta genérica):
    // el ajuste puede moverlo, y dejarlo sin contar lo sacaría del ajuste sin que nadie lo note.
    const conteo = await obtenerConteo(sesion(), inv.id, bd());
    expect(conteo.renglones[0]!.nombreComplemento).toBe('complemento');
    expect(conteo.renglones[0]!.cantTeoricaComplemento).toBe(40);
    await expect(
      capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 95 }] }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    await capturarConteo(
      sesion(),
      inv.id,
      { renglones: [{ idDet, cantReal: 95, cantRealComplemento: 38 }] },
      bd(),
    );
    await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(await existenciaTela(colorMarino)).toEqual({ cuerpo: 95, complemento: 38 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FILA 0.099 — LA GUARDA DEL ALMACÉN, EN LAS DOS PUERTAS DONDE PUEDE PASAR ALGO
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `exigirAlmacenDelTipo` se pasa TRES veces: al dar de alta, al agregar un renglón a mano y al
 * cerrar. Aquí se fijan **las dos últimas**, que son las únicas que pueden fallar de verdad: una
 * hoja vive días, y en ese rato el almacén pudo **desactivarse** o **cambiar de tipo** (el catálogo
 * lo permite mientras no tenga movimientos). Y **no hay una segunda barrera más abajo**: el motor de
 * kardex no mira el almacén, así que si estas guardas se caen, el conteo escribiría en un almacén
 * desactivado o del tipo equivocado sin que nada lo pare.
 *
 * ⚠️ **La del ALTA no se prueba, y es a propósito:** ahí el tipo exigido sale de `dimensionDeAlmacen`
 * del MISMO almacén que se acaba de leer, así que la comparación no puede fallar — es tautológica.
 * Lo que sí cubre esa llamada (existe, activo, de esta empresa) ya lo cubre `tipoDeAlmacenUsable`
 * una línea antes.
 */
describe('(n) La guarda del almacén después del alta (fila 0.137, tercera y segunda puerta)', () => {
  it('AGREGAR RENGLÓN — rechaza si el almacén se DESACTIVÓ con la hoja abierta', async () => {
    await mover(tEntradaInicial, 10);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());

    await cliente.almacen.update({ where: { id: almPrimeras.id }, data: { activo: false } });

    await expect(
      agregarRenglonCiclico(
        sesion(),
        inv.id,
        { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Y no se coló: la hoja sigue con el único renglón que enumeró el alta.
    expect(
      await cliente.inventarioCiclicoDet.count({ where: { idInventarioCiclico: inv.id } }),
    ).toBe(1);
  });

  it('AGREGAR RENGLÓN — rechaza si al almacén le CAMBIARON EL TIPO (la hoja del arranque)', async () => {
    // Caso realista: se abre la hoja de un almacén de telas VACÍO (el día del arranque) y, como no
    // tiene movimientos, el catálogo permite corregirle el tipo. La hoja ya nació TELA.
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    expect(inv.dimension).toBe('TELA');
    expect(inv.totalRenglones).toBe(0);

    await cliente.almacen.update({ where: { id: almTelas.id }, data: { tipo: 'AVIO' } });

    await expect(
      agregarRenglonCiclico(sesion(), inv.id, { idTelaColor: colorMarino.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(
      await cliente.inventarioCiclicoDetTela.count({ where: { idInventarioCiclico: inv.id } }),
    ).toBe(0);
  });

  it('CERRAR — rechaza si el almacén se DESACTIVÓ, y no escribe NADA ni cierra la hoja', async () => {
    await mover(tEntradaInicial, 10);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almPrimeras.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;
    await capturarConteo(sesion(), inv.id, { renglones: [{ idDet, cantReal: 13 }] }, bd());

    await cliente.almacen.update({ where: { id: almPrimeras.id }, data: { activo: false } });

    await expect(
      generarAjusteCiclico(sesion(), inv.id, { confirmarMovimiento: true }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // El kardex NO valida el almacén: si la guarda no estuviera, esto habría escrito +3 en una
    // bodega desactivada. Todo o nada (A2): ni movimiento, ni cierre, ni existencia movida.
    expect(await movimientosDeAjuste()).toHaveLength(0);
    expect(await existencia()).toBe(10);
    const trasIntento = await cliente.inventarioCiclico.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(trasIntento.estado).toBe('contado');
  });

  it('CERRAR — rechaza si al almacén le CAMBIARON EL TIPO (telas), sin escribir ni cerrar', async () => {
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    const tras = await agregarRenglonCiclico(
      sesion(),
      inv.id,
      { idTelaColor: colorNegro.id },
      bd(),
    );
    await capturarConteo(
      sesion(),
      inv.id,
      { renglones: [{ idDet: tras.renglones[0]!.idDet, cantReal: 25 }] },
      bd(),
    );

    // Sin movimientos en el almacén, el catálogo deja corregirle el tipo.
    await cliente.almacen.update({ where: { id: almTelas.id }, data: { tipo: 'AVIO' } });

    await expect(
      generarAjusteCiclico(sesion(), inv.id, { confirmarMovimiento: true }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await movimientosDeAjuste()).toHaveLength(0);
    expect(await existenciaTela(colorNegro)).toEqual({ cuerpo: 0, complemento: 0 });
    const trasIntento = await cliente.inventarioCiclico.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(trasIntento.estado).toBe('contado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FILA 0.099 — LA ESCALA DE TELAS, EL COMPLEMENTO NO PEDIDO Y EL ALCANCE
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('(o) La tela se cuenta en DECIMALES (escala 4), no en piezas', () => {
  it('cuerpo 12.5 kg de más y complemento 2.75 kg de menos: el kardex guarda las dos cifras EXACTAS', async () => {
    await moverTela(colorMarino, 100, 40);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    const idDet = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!.idDet;

    // Se pesa el anaquel: sobra cuerpo y falta cardigan, los dos con fracción de kilo. Con la
    // escala equivocada (0, la de producto terminado) esto escribiría 13 y 3 — o sea, kilos
    // inventados en la dimensión que se mide en kilos, y en la pantalla del ARRANQUE.
    await capturarConteo(
      sesion(),
      inv.id,
      { renglones: [{ idDet, cantReal: 112.5, cantRealComplemento: 37.25 }] },
      bd(),
    );
    const res = await generarAjusteCiclico(sesion(), inv.id, {}, bd());
    expect(res.aplicado).toBe(true);

    const movs = await movimientosDeAjuste();
    const entrada = movs.find((m) => m.tipoMov.codigo === 'ajuste-ciclico-entrada')!;
    const salida = movs.find((m) => m.tipoMov.codigo === 'ajuste-ciclico-salida')!;
    expect(Number(entrada.detallesTela[0]!.cantidad)).toBe(12.5); // 112.5 − 100
    expect(Number(entrada.detallesTela[0]!.cantidadComplemento)).toBe(0);
    expect(Number(salida.detallesTela[0]!.cantidad)).toBe(0);
    expect(Number(salida.detallesTela[0]!.cantidadComplemento)).toBe(2.75); // 40 − 37.25
    expect(await existenciaTela(colorMarino)).toEqual({ cuerpo: 112.5, complemento: 37.25 });

    // Y la exactitud enseña la misma fracción, no una pieza redondeada.
    expect(res.exactitud.renglones[0]).toMatchObject({
      exactitud: 12.5,
      exactitudComplemento: -2.75,
      unidad: 'kg',
    });
  });
});

describe('(p) Capturar un complemento que la hoja NO congeló se RECHAZA', () => {
  it('la tela sin complemento no admite el segundo número (en TELA es la única defensa)', async () => {
    // La lisa no lleva cardigan: la hoja congela un solo componente.
    await moverTela(colorNegro, 60);
    const inv = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    const renglon = (await obtenerConteo(sesion(), inv.id, bd())).renglones[0]!;
    expect(renglon.nombreComplemento).toBeNull();

    // ⚠️ `guardarConteo` de telas NO tiene segundo cinturón (PT y avíos sí): si esta guarda del
    // motor se cayera, se escribiría `cant_real_complemento` en un renglón cuyo teórico de
    // complemento es NULL y `planearAjuste` lo ignoraría EN SILENCIO — la mitad espejo del defecto
    // que esta fila vino a matar.
    await expect(
      capturarConteo(
        sesion(),
        inv.id,
        { renglones: [{ idDet: renglon.idDet, cantReal: 58, cantRealComplemento: 3 }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // No escribió NADA: el renglón sigue sin contar y la hoja sigue abierta.
    const det = await cliente.inventarioCiclicoDetTela.findFirstOrThrow({
      where: { idInventarioCiclico: inv.id },
    });
    expect(det.cantReal).toBeNull();
    expect(det.cantRealComplemento).toBeNull();
    expect((await obtenerConteo(sesion(), inv.id, bd())).estado).toBe('abierto');
  });
});

describe('(q) El ALCANCE del alta filtra de verdad', () => {
  it('TELAS — `idsTela` deja fuera los colores de las demás telas', async () => {
    await moverTela(colorMarino, 100, 40); // Felpa Suiza
    await moverTela(colorNegro, 60); // Lisa Algodón

    const todas = await crearInventarioCiclico(sesion(), { idAlmacen: almTelas.id }, bd());
    expect(todas.totalRenglones).toBe(2); // sin alcance: el almacén entero

    const soloFelpa = await crearInventarioCiclico(
      sesion(),
      { idAlmacen: almTelas.id, idsTela: [telaFelpa.id] },
      bd(),
    );
    const conteo = await obtenerConteo(sesion(), soloFelpa.id, bd());
    expect(conteo.renglones).toHaveLength(1);
    expect(conteo.renglones[0]!.titulo).toBe('Felpa Suiza');
  });

  it('AVÍOS — `idsAvio` deja fuera los demás avíos', async () => {
    const avioBoton = await cliente.avio.create({
      data: { clave: 'BOT-01', descripcion: 'Botón nácar', unidad: 'pza' },
    });
    await moverAvio(500);
    await registrarMovimientoAvio(
      sesion(),
      {
        idEmpresa: empresa.id,
        idTipoMov: tEntradaInicial.id,
        idAlmacen: almAvios.id,
        fecha: new Date('2026-07-01T00:00:00.000Z'),
        origenTipo: ORIGEN.movimientoManual,
        lineas: [{ idAvio: avioBoton.id, cantidad: 300 }],
      },
      bd(),
    );

    const todos = await crearInventarioCiclico(sesion(), { idAlmacen: almAvios.id }, bd());
    expect(todos.totalRenglones).toBe(2);

    const soloCierre = await crearInventarioCiclico(
      sesion(),
      { idAlmacen: almAvios.id, idsAvio: [avioCierre.id] },
      bd(),
    );
    const conteo = await obtenerConteo(sesion(), soloCierre.id, bd());
    expect(conteo.renglones).toHaveLength(1);
    expect(conteo.renglones[0]!.titulo).toBe('CIE-01');
  });
});
