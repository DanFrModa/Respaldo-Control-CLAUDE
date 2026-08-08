/**
 * Tests de integración de la ENTRADA DE TELA por FACTURA/REMISIÓN sin orden de compra (etapa B1 —
 * Daniel §Post-F9.9 punto 7). Postgres efímero (testcontainers; NO corre en local — lo corre CI).
 * Cubre lo que sólo la base valida:
 *  (a) folio del DOCUMENTO por secuencia atómica por empresa (A3) y aislamiento por empresa (A9);
 *  (b) el borrador NO toca el inventario; CONFIRMAR crea UNA partida por renglón + UN movimiento
 *      de kardex, y la existencia por color = Σ de movimientos (D3);
 *  (c) el PRECIO viaja al kardex como `costoUnit` del cuerpo; un renglón de SOLO complemento entra
 *      sin costo (el kardex valúa costoUnit × cuerpo) y el precio del cardigan vive en el documento;
 *  (d) el mismo tela+color repetido en dos renglones = DOS partidas (§Post-F9.11 p.4);
 *  (e) una tela SIN complemento rechaza cantidad de complemento;
 *  (f) CANCELAR una entrada confirmada = movimiento INVERSO auditado (nada se edita/borra, D3) y
 *      la existencia vuelve a 0; cancelar un borrador no genera movimiento;
 *  (g) una entrada confirmada YA NO se edita ni se re-cancela;
 *  (h) el listado filtra/busca y pagina por empresa activa;
 *  (i) el AVISO SUAVE de factura repetida (mismo proveedor + mismo número) avisa pero NO bloquea;
 *  (j) §Post-F9.14 — la liga con la ORDEN DE COMPRA: confirmar la factura genera la RECEPCIÓN de
 *      cada OC surtida, marca su estatus (R7), emite el evento del outbox y NO cuenta la tela dos
 *      veces; cancelarla reversa esas recepciones y la OC vuelve a quedar pendiente.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { existenciaTelaColorBloqueada } from '../../comun/kardex.js';
import type {
  Almacen,
  Empresa,
  PrismaClient,
  Proveedor,
  Tela,
  TelaColor,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearOC, autorizarOC } from '../compras/ordenes-compra.js';
import { kardexTelaColor } from './partidas-telas.js';
import {
  actualizarEntradaTela,
  cancelarEntradaTela,
  confirmarEntradaTela,
  crearEntradaTela,
  listarEntradasTela,
  obtenerEntradaTela,
} from './entradas-tela.js';

let cliente: PrismaClient;
let empresa: Empresa;
let proveedor: Proveedor;
let telaFelpa: Tela; // CON complemento ("Cardigan")
let telaLisa: Tela; // SIN complemento
let colorMarino: TelaColor; // de la felpa
let colorBlanco: TelaColor; // de la felpa
let colorNegroLisa: TelaColor; // de la lisa
let almacen: Almacen;

const PERM: ClavePermiso[] = [
  'inventario-telas.ver',
  'inventario-telas.mover',
  'telas.ver-totales',
];
const sesion = (permisos: ClavePermiso[] = PERM, idEmpresaActiva?: number) =>
  sesionDePrueba({ idEmpresaActiva: idEmpresaActiva ?? empresa.id, permisos });
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
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Textiles del Norte' } });
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
    data: { idTela: telaFelpa.id, nombre: 'Marino Alsa 3040', pantone: '19-3920' },
  });
  colorBlanco = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Blanco' },
  });
  colorNegroLisa = await cliente.telaColor.create({
    data: { idTela: telaLisa.id, nombre: 'Negro' },
  });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega Telas', tipo: 'TELA' } });
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
    ],
  });
});

/** Existencia (cuerpo + complemento) de un color en el almacén (Σ movimientos directa, D3). */
async function existencia(idTelaColor: number): Promise<{ cuerpo: number; complemento: number }> {
  return cliente.$transaction((tx) =>
    existenciaTelaColorBloqueada(tx, empresa.id, almacen.id, idTelaColor),
  );
}

/**
 * Captura una entrada en borrador con un renglón de la felpa marino. `complemento` (cantidad +
 * precio del cardigan) es opcional: los casos que no lo necesitan quedan igual de simples.
 */
async function capturarSimple(
  cantidad = 100,
  precioUnit = 12,
  complemento?: { cantidad: number; precio: number },
) {
  return crearEntradaTela(
    sesion(),
    {
      tipoDocumento: 'factura',
      numeroDocumento: 'A-1001',
      idProveedor: proveedor.id,
      fecha: '2026-08-06',
      idAlmacen: almacen.id,
      lineas: [
        {
          idTelaColor: colorMarino.id,
          cantidad,
          precioUnit,
          loteProveedor: 'L-77',
          ...(complemento === undefined
            ? {}
            : {
                cantidadComplemento: complemento.cantidad,
                precioUnitComplemento: complemento.precio,
              }),
        },
      ],
    },
    bd(),
  );
}

describe('Entrada de tela (B1) — captura en borrador y folio atómico (A3/A9)', () => {
  it('el folio arranca en 1 por empresa y avanza de uno en uno', async () => {
    const primera = await capturarSimple();
    const segunda = await capturarSimple();
    expect(primera.folio).toBe(1);
    expect(segunda.folio).toBe(2);
    expect(primera.estatus).toBe('borrador');
    expect(primera.idMovimiento).toBeNull();

    // OTRA empresa: su numeración es independiente (A3/A9).
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    const deOtra = await crearEntradaTela(
      sesion(PERM, otra.id),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'R-1',
        idProveedor: proveedor.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 5 }],
      },
      bd(),
    );
    expect(deOtra.folio).toBe(1);

    // Y no se ve desde la empresa original (A9).
    await expect(obtenerEntradaTela(sesion(), deOtra.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('el BORRADOR no toca el inventario ni crea partidas', async () => {
    await capturarSimple(250);
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 0, complemento: 0 });
    expect(await cliente.partidaTela.count()).toBe(0);
    expect(await cliente.movimiento.count()).toBe(0);
  });

  it('una tela SIN complemento rechaza la cantidad de complemento', async () => {
    await expect(
      crearEntradaTela(
        sesion(),
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A-2',
          idProveedor: proveedor.id,
          fecha: '2026-08-06',
          idAlmacen: almacen.id,
          lineas: [{ idTelaColor: colorNegroLisa.id, cantidad: 10, cantidadComplemento: 3 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.entradaTela.count()).toBe(0);
  });

  it('un almacén desactivado se rechaza (A9/B1)', async () => {
    const inactivo = await cliente.almacen.create({
      data: { nombre: 'Bodega vieja', tipo: 'TELA', activo: false },
    });
    await expect(
      crearEntradaTela(
        sesion(),
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A-3',
          idProveedor: proveedor.id,
          fecha: '2026-08-06',
          idAlmacen: inactivo.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 10 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('editar el borrador reemplaza cabecera y renglones', async () => {
    const entrada = await capturarSimple(100);
    const editada = await actualizarEntradaTela(
      sesion(),
      entrada.id,
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'R-999',
        idProveedor: proveedor.id,
        fecha: '2026-08-07',
        idAlmacen: almacen.id,
        lineas: [
          { idTelaColor: colorMarino.id, cantidad: 40 },
          { idTelaColor: colorBlanco.id, cantidad: 60, cantidadComplemento: 10 },
        ],
      },
      bd(),
    );
    expect(editada.tipoDocumento).toBe('remision');
    expect(editada.numeroDocumento).toBe('R-999');
    expect(editada.lineas).toHaveLength(2);
    expect(editada.totalCuerpo).toBe(100);
    expect(editada.totalComplemento).toBe(10);
    // El folio NO cambia al editar.
    expect(editada.folio).toBe(entrada.folio);
  });
});

describe('Entrada de tela (B1) — confirmar: partidas + kardex + costo (A2/A3/D1/D3)', () => {
  it('crea UNA partida por renglón, UN movimiento y la existencia = Σ movimientos', async () => {
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'F-5000',
        idProveedor: proveedor.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        observaciones: 'Llegó completo',
        lineas: [
          {
            idTelaColor: colorMarino.id,
            cantidad: 300,
            cantidadComplemento: 45,
            precioUnit: 90,
            precioUnitComplemento: 120,
            loteProveedor: 'L-A',
          },
          { idTelaColor: colorBlanco.id, cantidad: 100, precioUnit: 85, loteProveedor: 'L-B' },
        ],
      },
      bd(),
    );

    const confirmada = await confirmarEntradaTela(sesion(), entrada.id, bd());
    expect(confirmada.estatus).toBe('confirmada');
    expect(confirmada.idMovimiento).not.toBeNull();
    expect(confirmada.confirmadaEn).not.toBeNull();

    // Dos partidas con folio consecutivo, selladas con el número del documento.
    const partidas = await cliente.partidaTela.findMany({ orderBy: { folio: 'asc' } });
    expect(partidas).toHaveLength(2);
    expect(partidas.map((p) => Number(p.folio))).toEqual([1, 2]);
    expect(partidas.every((p) => p.factura === 'F-5000')).toBe(true);
    expect(partidas[0]!.loteProveedor).toBe('L-A');
    // Cada renglón quedó ligado a SU partida (traza).
    expect(confirmada.lineas.map((l) => l.idPartida)).toEqual(partidas.map((p) => p.id));
    expect(confirmada.lineas[0]!.partidaFolio).toBe(1);

    // UN solo movimiento con los dos renglones y el costo del CUERPO (D1).
    expect(await cliente.movimiento.count()).toBe(1);
    const dets = await cliente.movimientoDetTela.findMany({ orderBy: { id: 'asc' } });
    expect(dets).toHaveLength(2);
    expect(Number(dets[0]!.costoUnit)).toBe(90);
    expect(Number(dets[0]!.cantidadComplemento)).toBe(45);
    expect(dets[0]!.idTelaColor).toBe(colorMarino.id);
    expect(dets[0]!.idLote).toBeNull(); // el flujo nuevo NO crea lotes

    // Existencia = Σ movimientos por color (D3).
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 300, complemento: 45 });
    expect(await existencia(colorBlanco.id)).toEqual({ cuerpo: 100, complemento: 0 });

    // El importe del documento SÍ suma el complemento con su propio precio (el kardex, no).
    expect(confirmada.totalImporte).toBe(300 * 90 + 45 * 120 + 100 * 85);
  });

  it('el MISMO tela+color en dos renglones crea DOS partidas (dos lotes de una factura)', async () => {
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'F-6000',
        idProveedor: proveedor.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [
          { idTelaColor: colorMarino.id, cantidad: 50, loteProveedor: 'L-1' },
          { idTelaColor: colorMarino.id, cantidad: 70, loteProveedor: 'L-2' },
        ],
      },
      bd(),
    );
    const confirmada = await confirmarEntradaTela(sesion(), entrada.id, bd());
    const partidas = await cliente.partidaTela.findMany({ orderBy: { folio: 'asc' } });
    expect(partidas).toHaveLength(2);
    expect(partidas.map((p) => p.loteProveedor)).toEqual(['L-1', 'L-2']);
    expect(new Set(confirmada.lineas.map((l) => l.idPartida)).size).toBe(2);
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 120, complemento: 0 });
  });

  it('un renglón de SOLO complemento (cuerpo 0) SÍ queda valuado en el kardex (costoUnitComplemento, B1)', async () => {
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'R-77',
        idProveedor: proveedor.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [
          {
            idTelaColor: colorMarino.id,
            cantidad: 0,
            cantidadComplemento: 25,
            precioUnitComplemento: 150,
          },
        ],
      },
      bd(),
    );
    const confirmada = await confirmarEntradaTela(sesion(), entrada.id, bd());
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 0, complemento: 25 });
    const det = await cliente.movimientoDetTela.findFirstOrThrow();
    // Sin cuerpo no hay costo de cuerpo, pero el CARDIGAN sí viaja valuado (ya no se pierde).
    expect(det.costoUnit).toBeNull();
    expect(Number(det.costoUnitComplemento)).toBe(150);
    expect(confirmada.lineas[0]!.precioUnitComplemento).toBe(150);
    expect(confirmada.totalImporte).toBe(25 * 150);
  });

  it('los DOS precios viajan al kardex y el kardex por color valúa AMBOS componentes (B1)', async () => {
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'F-777',
        idProveedor: proveedor.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [
          {
            idTelaColor: colorMarino.id,
            cantidad: 100,
            cantidadComplemento: 20,
            precioUnit: 90,
            precioUnitComplemento: 130,
          },
        ],
      },
      bd(),
    );
    await confirmarEntradaTela(sesion(), entrada.id, bd());

    const det = await cliente.movimientoDetTela.findFirstOrThrow();
    expect(Number(det.costoUnit)).toBe(90);
    expect(Number(det.costoUnitComplemento)).toBe(130);

    // El KARDEX por color expone ambos costos y su importe suma los dos componentes.
    const kardex = await kardexTelaColor(sesion(), { idTelaColor: colorMarino.id }, bd());
    expect(kardex.renglones[0]!.costoUnit).toBe(90);
    expect(kardex.renglones[0]!.costoUnitComplemento).toBe(130);
    expect(kardex.renglones[0]!.importe).toBe(100 * 90 + 20 * 130);
  });

  it('una entrada confirmada YA NO se edita ni se re-confirma (inmutable, D3)', async () => {
    const entrada = await capturarSimple();
    await confirmarEntradaTela(sesion(), entrada.id, bd());
    await expect(
      actualizarEntradaTela(
        sesion(),
        entrada.id,
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A-1001',
          idProveedor: proveedor.id,
          fecha: '2026-08-06',
          idAlmacen: almacen.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(confirmarEntradaTela(sesion(), entrada.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    // Sólo hay UN movimiento (no se duplicó el inventario).
    expect(await cliente.movimiento.count()).toBe(1);
  });

  it('una entrada CANCELADA tampoco se confirma ni se edita (D3)', async () => {
    const entrada = await capturarSimple();
    await cancelarEntradaTela(sesion(), entrada.id, { motivo: 'llegó mal' }, bd());
    await expect(confirmarEntradaTela(sesion(), entrada.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    await expect(
      actualizarEntradaTela(
        sesion(),
        entrada.id,
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A-1001',
          idProveedor: proveedor.id,
          fecha: '2026-08-06',
          idAlmacen: almacen.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // Nada entró al inventario: la cancelada nunca se confirmó.
    expect(await cliente.movimiento.count()).toBe(0);
    expect(await cliente.partidaTela.count()).toBe(0);
  });

  it('sin permiso `inventario-telas.mover` no se captura ni se confirma (A4)', async () => {
    const soloVer = sesion(['inventario-telas.ver']);
    await expect(
      crearEntradaTela(
        soloVer,
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'X',
          idProveedor: proveedor.id,
          fecha: '2026-08-06',
          idAlmacen: almacen.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toThrow();
    const entrada = await capturarSimple();
    await expect(confirmarEntradaTela(soloVer, entrada.id, bd())).rejects.toThrow();
  });
});

describe('Entrada de tela (B1) — aviso SUAVE de factura repetida (no bloquea)', () => {
  it('capturar dos veces el MISMO documento del MISMO proveedor avisa, pero deja guardar y confirmar', async () => {
    const primera = await capturarSimple(); // factura A-1001 del proveedor base
    expect(primera.avisos).toHaveLength(0);

    // La MISMA factura otra vez: se guarda (no hay unique duro) pero AVISA en las dos.
    const repetida = await capturarSimple();
    expect(repetida.avisos).toHaveLength(1);
    expect(repetida.avisos[0]).toContain('A-1001');
    expect((await obtenerEntradaTela(sesion(), primera.id, bd())).avisos).toHaveLength(1);
    // Y el listado también lo trae (una sola consulta para toda la página).
    const lista = await listarEntradasTela(sesion(), {}, bd());
    expect(lista.datos.every((d) => d.avisos.length === 1)).toBe(true);

    // El aviso NO bloquea: la repetida se confirma igual (a veces sí son dos entregas).
    const confirmada = await confirmarEntradaTela(sesion(), repetida.id, bd());
    expect(confirmada.estatus).toBe('confirmada');
  });

  it('no avisa si el documento repetido está CANCELADO, ni entre proveedores distintos', async () => {
    const primera = await capturarSimple();
    const segunda = await capturarSimple();
    await cancelarEntradaTela(sesion(), segunda.id, { motivo: 'captura duplicada' }, bd());
    // Con la copia cancelada, la viva ya no molesta con el aviso.
    expect((await obtenerEntradaTela(sesion(), primera.id, bd())).avisos).toHaveLength(0);

    // Mismo número, OTRO proveedor: no es duplicado.
    const otroProveedor = await cliente.proveedor.create({ data: { nombre: 'Otro Textil' } });
    const deOtro = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'A-1001',
        idProveedor: otroProveedor.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 5 }],
      },
      bd(),
    );
    expect(deOtro.avisos).toHaveLength(0);
  });
});

describe('Entrada de tela (B1) — cancelación = inverso auditado (D3/A7)', () => {
  it('cancelar una CONFIRMADA genera el inverso: existencia a 0, nada se borra', async () => {
    // Con COMPLEMENTO y su propio precio: así el inverso tiene que copiar las CUATRO dimensiones
    // nuevas (color, partida, cantidad y costo del complemento) para neutralizar el par.
    const entrada = await capturarSimple(200, 10, { cantidad: 30, precio: 140 });
    const confirmada = await confirmarEntradaTela(sesion(), entrada.id, bd());
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 200, complemento: 30 });

    const cancelada = await cancelarEntradaTela(
      sesion(),
      entrada.id,
      { motivo: 'la factura venía mal' },
      bd(),
    );
    expect(cancelada.estatus).toBe('cancelada');
    expect(cancelada.motivoCancelacion).toBe('la factura venía mal');

    // El par entrada + inverso se neutraliza POR COLOR (ambos componentes) y los DOS movimientos
    // siguen vivos (D3).
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 0, complemento: 0 });
    expect(await cliente.movimiento.count()).toBe(2);
    const inverso = await cliente.movimiento.findFirstOrThrow({
      where: { idMovimientoInverso: confirmada.idMovimiento! },
      include: { detallesTela: true },
    });
    expect(inverso.detallesTela[0]!.idTelaColor).toBe(colorMarino.id);
    expect(inverso.detallesTela[0]!.idPartida).toBe(confirmada.lineas[0]!.idPartida);
    expect(Number(inverso.detallesTela[0]!.cantidadComplemento)).toBe(30);
    // El inverso copia también AMBOS costos (el par original+inverso se neutraliza también en $).
    expect(Number(inverso.detallesTela[0]!.costoUnit)).toBe(10);
    expect(Number(inverso.detallesTela[0]!.costoUnitComplemento)).toBe(140);
    // La partida se CONSERVA (es la traza de lo que llegó).
    expect(await cliente.partidaTela.count()).toBe(1);
    // El documento tampoco se borró.
    expect(await cliente.entradaTela.count()).toBe(1);
  });

  it('cancelar un BORRADOR no genera movimiento; y una cancelada no se re-cancela', async () => {
    const entrada = await capturarSimple();
    const cancelada = await cancelarEntradaTela(sesion(), entrada.id, { motivo: 'error' }, bd());
    expect(cancelada.estatus).toBe('cancelada');
    expect(await cliente.movimiento.count()).toBe(0);
    await expect(
      cancelarEntradaTela(sesion(), entrada.id, { motivo: 'otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Entrada de tela (B1) — listado: filtros, búsqueda y paginación (A9)', () => {
  it('filtra por estatus/proveedor y busca por folio, documento o proveedor', async () => {
    const uno = await capturarSimple(); // A-1001, factura, borrador
    await confirmarEntradaTela(sesion(), uno.id, bd());
    await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'REM-42',
        idProveedor: proveedor.id,
        fecha: '2026-08-08',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: colorBlanco.id, cantidad: 15 }],
      },
      bd(),
    );

    const todas = await listarEntradasTela(sesion(), {}, bd());
    expect(todas.total).toBe(2);
    expect(todas.datos[0]!.folio).toBe(2); // orden por folio desc por defecto

    const confirmadas = await listarEntradasTela(sesion(), { estatus: 'confirmada' }, bd());
    expect(confirmadas.total).toBe(1);
    expect(confirmadas.datos[0]!.numeroDocumento).toBe('A-1001');

    const porTipo = await listarEntradasTela(sesion(), { tipoDocumento: 'remision' }, bd());
    expect(porTipo.total).toBe(1);

    const porTexto = await listarEntradasTela(sesion(), { busqueda: 'REM-4' }, bd());
    expect(porTexto.total).toBe(1);
    const porFolio = await listarEntradasTela(sesion(), { busqueda: '1' }, bd());
    expect(porFolio.total).toBe(1);
    const porProveedor = await listarEntradasTela(sesion(), { busqueda: 'Textiles' }, bd());
    expect(porProveedor.total).toBe(2);

    // Rango de fechas.
    const desde = await listarEntradasTela(sesion(), { fechaDesde: '2026-08-07' }, bd());
    expect(desde.total).toBe(1);
  });

  it('el listado sólo ve las entradas de la empresa activa (A9)', async () => {
    await capturarSimple();
    const otra = await crearEmpresaPrueba(cliente, 'Empresa Dos');
    await crearEntradaTela(
      sesion(PERM, otra.id),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'Z-1',
        idProveedor: proveedor.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: colorNegroLisa.id, cantidad: 3 }],
      },
      bd(),
    );
    expect((await listarEntradasTela(sesion(), {}, bd())).total).toBe(1);
    expect((await listarEntradasTela(sesion(PERM, otra.id), {}, bd())).total).toBe(1);
  });

  it('sin `telas.ver-totales` los precios/importes viajan en null (ex-acceso #7)', async () => {
    const entrada = await capturarSimple(10, 33);
    const sinTotales = await obtenerEntradaTela(sesion(['inventario-telas.ver']), entrada.id, bd());
    expect(sinTotales.lineas[0]!.precioUnit).toBeNull();
    expect(sinTotales.totalImporte).toBeNull();
    // Con el permiso, sí.
    const conTotales = await obtenerEntradaTela(sesion(), entrada.id, bd());
    expect(conTotales.lineas[0]!.precioUnit).toBe(33);
    expect(conTotales.totalImporte).toBe(330);
  });
});

describe('Entrada de tela (§Post-F9.14) — la liga con la ORDEN DE COMPRA', () => {
  const PERM_COMPRAS: ClavePermiso[] = [
    ...PERM,
    'compras.ver',
    'compras.administrar',
    'compras.autorizar',
  ];

  /** OC autorizada del proveedor base con una línea de la felpa. */
  async function ocFelpaAutorizada(cantidad = 100, precio = 12) {
    const oc = await crearOC(
      sesion(PERM_COMPRAS),
      {
        idProveedor: proveedor.id,
        lineas: [{ idTela: telaFelpa.id, cantidad, precio, unidad: 'kg' }],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_COMPRAS), oc.id, bd());
    return oc;
  }

  /** Captura una entrada de 1 renglón ligado al renglón de OC dado. */
  async function capturarConOC(idOrdenCompraLinea: number, cantidad: number, precioUnit = 12) {
    return crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'F-500',
        idProveedor: proveedor.id,
        fecha: '2026-08-07',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad, precioUnit, idOrdenCompraLinea }],
      },
      bd(),
    );
  }

  it('confirmar la factura marca la OC como recibida y NO cuenta la tela dos veces', async () => {
    const oc = await ocFelpaAutorizada(100, 12);
    const idLineaOC = oc.lineas[0]!.id;
    const entrada = await capturarConOC(idLineaOC, 100);

    // En BORRADOR la OC no se entera de nada.
    expect((await cliente.ordenCompra.findUnique({ where: { id: oc.id } }))?.estatus).toBe(
      'autorizada',
    );
    expect(await cliente.recepcionCompra.count()).toBe(0);

    await confirmarEntradaTela(sesion(), entrada.id, bd());

    // La OC quedó RECIBIDA TOTAL y existe SU recibo, ligado al documento de entrada.
    expect((await cliente.ordenCompra.findUnique({ where: { id: oc.id } }))?.estatus).toBe(
      'recibida_total',
    );
    const recepciones = await cliente.recepcionCompra.findMany({
      where: { idOrdenCompra: oc.id },
      include: { lineas: true },
    });
    expect(recepciones).toHaveLength(1);
    expect(recepciones[0]?.idEntradaTela).toBe(entrada.id);
    expect(recepciones[0]?.factura).toBe('F-500');
    expect(Number(recepciones[0]?.lineas[0]?.cantidadRecibida)).toBe(100);

    // La tela entró UNA sola vez: un movimiento de kardex y la existencia = 100.
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(1);
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 100, complemento: 0 });
    // Y el renglón de la recepción apunta a ESE movimiento y a la partida de la entrada.
    expect(recepciones[0]?.lineas[0]?.idMovimiento).not.toBeNull();
    expect(recepciones[0]?.lineas[0]?.idPartida).not.toBeNull();

    // El evento del outbox salió (la Ruta Crítica se entera igual que por la otra puerta).
    const eventos = await cliente.eventoOutbox.findMany({
      where: { idEmpresa: empresa.id, tipo: 'material-recibido' },
    });
    expect(eventos).toHaveLength(1);
  });

  it('surtir de menos deja la OC en parcial; una segunda factura la completa', async () => {
    const oc = await ocFelpaAutorizada(100, 12);
    const idLineaOC = oc.lineas[0]!.id;

    const primera = await capturarConOC(idLineaOC, 40);
    await confirmarEntradaTela(sesion(), primera.id, bd());
    expect((await cliente.ordenCompra.findUnique({ where: { id: oc.id } }))?.estatus).toBe(
      'recibida_parcial',
    );

    const segunda = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'F-501',
        idProveedor: proveedor.id,
        fecha: '2026-08-08',
        idAlmacen: almacen.id,
        lineas: [
          {
            idTelaColor: colorMarino.id,
            cantidad: 60,
            precioUnit: 12,
            idOrdenCompraLinea: idLineaOC,
          },
        ],
      },
      bd(),
    );
    await confirmarEntradaTela(sesion(), segunda.id, bd());
    expect((await cliente.ordenCompra.findUnique({ where: { id: oc.id } }))?.estatus).toBe(
      'recibida_total',
    );
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 100, complemento: 0 });
  });

  it('una factura puede surtir DOS órdenes de compra distintas (liga por renglón)', async () => {
    const ocA = await ocFelpaAutorizada(30, 12);
    const ocB = await ocFelpaAutorizada(50, 12);

    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'F-600',
        idProveedor: proveedor.id,
        fecha: '2026-08-07',
        idAlmacen: almacen.id,
        lineas: [
          {
            idTelaColor: colorMarino.id,
            cantidad: 30,
            precioUnit: 12,
            idOrdenCompraLinea: ocA.lineas[0]!.id,
          },
          {
            idTelaColor: colorBlanco.id,
            cantidad: 50,
            precioUnit: 12,
            idOrdenCompraLinea: ocB.lineas[0]!.id,
          },
          // …y un tercer renglón SIN orden de compra: tela suelta en la misma factura.
          { idTelaColor: colorBlanco.id, cantidad: 5, precioUnit: 12 },
        ],
      },
      bd(),
    );
    await confirmarEntradaTela(sesion(), entrada.id, bd());

    // Una recepción POR OC, las dos ligadas al mismo documento.
    const recepciones = await cliente.recepcionCompra.findMany({ orderBy: { id: 'asc' } });
    expect(recepciones).toHaveLength(2);
    expect(recepciones.every((r) => r.idEntradaTela === entrada.id)).toBe(true);
    for (const oc of [ocA, ocB]) {
      expect((await cliente.ordenCompra.findUnique({ where: { id: oc.id } }))?.estatus).toBe(
        'recibida_total',
      );
    }
    // El renglón suelto entró al inventario igual, sin recepción que lo respalde.
    expect(await existencia(colorBlanco.id)).toEqual({ cuerpo: 55, complemento: 0 });
  });

  it('cancelar la factura reversa la recepción y la OC vuelve a quedar pendiente', async () => {
    const oc = await ocFelpaAutorizada(100, 12);
    const entrada = await capturarConOC(oc.lineas[0]!.id, 100);
    await confirmarEntradaTela(sesion(), entrada.id, bd());

    await cancelarEntradaTela(sesion(), entrada.id, { motivo: 'la tela llegó manchada' }, bd());

    // La OC regresa a "autorizada" (ya no tiene nada recibido) y la recepción queda REVERSADA,
    // no borrada (D3).
    expect((await cliente.ordenCompra.findUnique({ where: { id: oc.id } }))?.estatus).toBe(
      'autorizada',
    );
    const recepcion = await cliente.recepcionCompra.findFirstOrThrow();
    expect(recepcion.reversadaEn).not.toBeNull();
    expect(recepcion.motivoReverso).toContain('la tela llegó manchada');
    // Existencia de vuelta en 0 por el inverso, con los DOS movimientos vivos.
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 0, complemento: 0 });
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(2);
  });

  it('rechaza ligar a una OC de OTRO proveedor', async () => {
    const otro = await cliente.proveedor.create({ data: { nombre: 'Otro Proveedor' } });
    const ocAjena = await crearOC(
      sesion(PERM_COMPRAS),
      { idProveedor: otro.id, lineas: [{ idTela: telaFelpa.id, cantidad: 10, precio: 1 }] },
      bd(),
    );
    await autorizarOC(sesion(PERM_COMPRAS), ocAjena.id, bd());

    const entrada = await capturarConOC(ocAjena.lineas[0]!.id, 10);
    await expect(confirmarEntradaTela(sesion(), entrada.id, bd())).rejects.toThrow(
      /otro proveedor/,
    );
    // Y NADA quedó escrito: la transacción entera se revirtió (A2).
    expect(await cliente.recepcionCompra.count()).toBe(0);
    expect(await cliente.partidaTela.count()).toBe(0);
    expect(await existencia(colorMarino.id)).toEqual({ cuerpo: 0, complemento: 0 });
  });

  it('rechaza un color que no es de la tela que pide la OC', async () => {
    const ocLisa = await crearOC(
      sesion(PERM_COMPRAS),
      { idProveedor: proveedor.id, lineas: [{ idTela: telaLisa.id, cantidad: 10, precio: 1 }] },
      bd(),
    );
    await autorizarOC(sesion(PERM_COMPRAS), ocLisa.id, bd());

    // El renglón trae un color de la FELPA contra una OC de la LISA.
    const entrada = await capturarConOC(ocLisa.lineas[0]!.id, 10);
    await expect(confirmarEntradaTela(sesion(), entrada.id, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('rechaza una OC que todavía NO está autorizada', async () => {
    const borrador = await crearOC(
      sesion(PERM_COMPRAS),
      { idProveedor: proveedor.id, lineas: [{ idTela: telaFelpa.id, cantidad: 10, precio: 1 }] },
      bd(),
    );
    const entrada = await capturarConOC(borrador.lineas[0]!.id, 10);
    await expect(confirmarEntradaTela(sesion(), entrada.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });
});
