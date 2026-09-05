/**
 * ⭐⭐ LA SALIDA QUE NO ES POR OP (fila 0.104) — integración contra Postgres efímero.
 *
 * Daniel: *«sí debe existir una salida por otro medio que sólo ajuste de inventario… siempre
 * autorizada sólo por mí. Nadie más»* (§Post-F9.193 resp. 12). Aquí se mide TODO lo que necesita
 * una base de datos de verdad — lo que la unit no puede tocar:
 *
 *  (a) la existencia BAJA, y baja **por el motor de kardex**: folio de la secuencia atómica (A3),
 *      renglones en `MovimientoDetTela`/`MovimientoDetAvio`, bitácora del movimiento (A7), y la
 *      Σ directa de movimientos (D3) refleja la resta — igual que la vista;
 *  (b) el CONCEPTO deja rastro: cada uno escribe su tipo de movimiento DEDICADO, así que en el
 *      kardex una devolución no se confunde con una venta ni con un ajuste de conteo;
 *  (c) NO se puede dejar el inventario en negativo, y cuando se rechaza **no queda nada escrito**;
 *  (d) CANCELAR deja el INVERSO y no borra nada (D3), y devuelve el material al inventario;
 *  (e) ⭐ cancelar una de estas salidas con sólo `inventario-*.mover` se RECHAZA **por las DOS
 *      puertas** (la del flujo por color y la LEGADA por lote, que acepta cualquier movimiento con
 *      renglones de tela) — y la cancelación normal de un ajuste sigue funcionando con `.mover`
 *      (esta fila no le cambia el gobierno a nadie más);
 *  (f) alcance por empresa (A9): ni se saca de un almacén privado de otra empresa, ni se cancela
 *      un movimiento de otra empresa;
 *  (g) ⛔ 2ª ronda — los DOS RÓTULOS están RESERVADOS: ninguno de los CUATRO escritores genéricos
 *      (ajuste de tela por color, ajuste LEGADO de tela por lote, ajuste de avíos y movimiento
 *      manual de PT) puede estamparlos, ni siquiera con la llave, y el API los marca
 *      `capturaManual: false` para que ninguna pantalla los ofrezca;
 *  (h) ⛔ 2ª ronda — cancelar el INVERSO de una salida sin orden también pide la llave (si no, el
 *      material vuelve a salir con sólo `.mover`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Almacen, Avio, Empresa, PrismaClient, Tela, TelaColor } from '../../datos/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { ORIGEN } from '../../comun/origenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';
import {
  ajustarInventarioAvio,
  cancelarMovimientoAvio,
  consultarExistenciasAvio,
  registrarSalidaAvioSinOrden,
} from './avios.js';
import { registrarMovimientoPt } from './movimientos-pt.js';
import { listarTiposMovimiento } from './tipos-movimiento.js';
import {
  ajustarInventarioTelaColor,
  cancelarMovimientoTelaColor,
  registrarSalidaTelaColorSinOrden,
  saldosTelaColorParaConteo,
  type EntradaSalidaTelaColorSinOrden,
} from './partidas-telas.js';
import { PERMISO_SALIDA_SIN_ORDEN } from './salida-sin-orden.js';
import { ajustarInventarioTela, cancelarMovimientoTela } from './telas.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let telaFelpa: Tela; // CON complemento
let colorMarino: TelaColor;
let avioCierre: Avio;
let almTela: Almacen;
let almAvio: Almacen;
let almTelaAjena: Almacen; // PRIVADO de la otra empresa (A9)
let idTipoAjusteEntrada: number;

/** Lo que tiene quien mueve inventario todos los días… y NADA más. */
const PERM_MOVER: ClavePermiso[] = [
  'inventario-telas.ver',
  'inventario-telas.mover',
  'inventario-avios.ver',
  'inventario-avios.mover',
  'telas.ver-totales',
];
/** Lo mismo + la llave que Daniel se reservó. */
const PERM_DUENO: ClavePermiso[] = [...PERM_MOVER, PERMISO_SALIDA_SIN_ORDEN];

const sesionMover = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_MOVER });
const sesionDueno = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_DUENO });
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
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
  telaFelpa = await cliente.tela.create({
    data: { nombre: 'Felpa Suiza', nombreCuerpo: 'Felpa', nombreComplemento: 'Cardigan' },
  });
  colorMarino = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Marino' },
  });
  avioCierre = await cliente.avio.create({ data: { clave: 'CIE-01', descripcion: 'Cierre 20cm' } });
  almTela = await cliente.almacen.create({ data: { nombre: 'Bodega Telas', tipo: 'TELA' } });
  almAvio = await cliente.almacen.create({ data: { nombre: 'Bodega Avíos', tipo: 'AVIO' } });
  almTelaAjena = await cliente.almacen.create({
    data: { nombre: 'Bodega de la otra', tipo: 'TELA', idEmpresa: otraEmpresa.id },
  });
  const tipos = await cliente.tipoMovimientoInventario.createManyAndReturn({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      // Los tres de la fila 0.104 (los dos nuevos + el «Otras Salidas» de siempre).
      { codigo: 'devolucion-proveedor', nombre: 'Devolución a Proveedor', direccion: 'salida' },
      { codigo: 'venta-material', nombre: 'Venta de Material', direccion: 'salida' },
      { codigo: 'otras-salidas', nombre: 'Otras Salidas', direccion: 'salida' },
    ],
  });
  idTipoAjusteEntrada = tipos.find((t) => t.codigo === 'ajuste-entrada')!.id;
});

/** Mete tela por color al almacén de telas (ajuste de entrada: crea su partida). */
async function entrarTela(cuerpo: number, complemento: number): Promise<void> {
  await ajustarInventarioTelaColor(
    sesionMover(),
    {
      idTipoMov: idTipoAjusteEntrada,
      idAlmacen: almTela.id,
      fecha: '2026-09-01',
      motivo: 'Conteo físico inicial',
      lineas: [{ idTelaColor: colorMarino.id, cantidad: cuerpo, cantidadComplemento: complemento }],
    },
    bd(),
  );
}

/** Mete avío al almacén de avíos. Devuelve el movimiento (para poder cancelarlo). */
async function entrarAvio(cantidad: number) {
  return ajustarInventarioAvio(
    sesionMover(),
    {
      idTipoMov: idTipoAjusteEntrada,
      idAlmacen: almAvio.id,
      fecha: '2026-09-01',
      motivo: 'Conteo físico inicial',
      lineas: [{ idAvio: avioCierre.id, cantidad }],
    },
    bd(),
  );
}

/** Saldo por Σ DIRECTA de movimientos (D3, nunca la vista) del color en el almacén de telas. */
async function saldoTela(): Promise<{ cuerpo: number; complemento: number }> {
  const { saldos } = await saldosTelaColorParaConteo(
    sesionMover(),
    { idAlmacen: almTela.id, idTelaColor: String(colorMarino.id) },
    bd(),
  );
  const fila = saldos[0];
  return { cuerpo: fila?.cuerpo ?? NaN, complemento: fila?.complemento ?? NaN };
}

/** Existencia del avío según la VISTA `existencia_avio` (la otra mitad de la comprobación). */
async function existenciaAvioEnLaVista(): Promise<number> {
  const { filas } = await consultarExistenciasAvio(
    sesionMover(),
    { idAvio: avioCierre.id, incluirCeros: true },
    bd(),
  );
  return filas.find((f) => f.idAlmacen === almAvio.id)?.existencia ?? 0;
}

/** Cuántos `Movimiento` hay en la base (para probar que un rechazo NO deja rastro). */
async function cuantosMovimientos(): Promise<number> {
  return cliente.movimiento.count();
}

/**
 * Existencia de producto terminado en un almacén, por Σ DIRECTA de `MovimientoDetPt` con el SIGNO
 * que le da la dirección del tipo de movimiento (D3 — nunca la vista; el mismo cálculo que
 * `comun/kardex.ts`, porque `cantidad` se guarda siempre positiva). Se usa para afirmar que un
 * rechazo no dejó NADA escrito, ni siquiera medio renglón.
 */
async function existenciaPtEnAlmacen(idAlmacen: number): Promise<number> {
  const filas = await cliente.$queryRaw<{ existencia: bigint | null }[]>`
    SELECT COALESCE(SUM(
      d."cantidad" * CASE t."direccion"
        WHEN 'entrada' THEN 1
        WHEN 'salida'  THEN -1
        ELSE 0
      END
    ), 0)::bigint AS existencia
    FROM "movimiento_det_pt" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE m."id_almacen" = ${idAlmacen}
  `;
  return Number(filas[0]?.existencia ?? 0n);
}

const salidaTelaBase: Omit<EntradaSalidaTelaColorSinOrden, 'idAlmacen' | 'lineas'> = {
  concepto: 'devolucion-proveedor',
  fecha: '2026-09-05',
  motivo: 'Devolución al proveedor: la felpa vino con fallas de tono',
};

describe('(a) la existencia BAJA, y lo hace por el MOTOR de kardex', () => {
  it('⭐ TELA: resta cuerpo y complemento, con folio, renglones, origen y bitácora', async () => {
    await entrarTela(100, 40);
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 40 });

    const mov = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30, cantidadComplemento: 12 }],
      },
      bd(),
    );

    // 1. La existencia bajó exactamente lo que se sacó (Σ DIRECTA de movimientos, no la vista).
    expect(await saldoTela()).toEqual({ cuerpo: 70, complemento: 28 });

    // 2. Y bajó ESCRIBIENDO UN MOVIMIENTO, no por ningún otro camino: folio de la secuencia
    //    atómica (A3), dirección salida, renglones de kardex y la traza de la fila.
    expect(mov.folio).toBeGreaterThan(0);
    expect(mov.direccion).toBe('salida');
    expect(mov.origenTipo).toBe(ORIGEN.salidaSinOrden);
    expect(mov.origenId, 'una salida sin orden no tiene entidad detrás').toBeNull();
    expect(mov.observaciones).toBe(salidaTelaBase.motivo);
    expect(mov.renglones).toHaveLength(1);
    expect(mov.renglones[0]?.cantidad).toBe(30);
    expect(mov.renglones[0]?.cantidadComplemento).toBe(12);
    // Sin partida: el consumo empareja por tela+color (la partida es la unidad de ENTRADA).
    expect(mov.renglones[0]?.idPartida).toBeNull();

    // 3. Auditoría uniforme (A7): el motor deja la bitácora del movimiento DENTRO de la
    //    transacción. Es lo que distingue «pasó por el motor» de «alguien escribió filas».
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Movimiento', idEntidad: String(mov.id), accion: 'CREAR' },
    });
    expect(bitacora, 'el movimiento no dejó bitácora: no pasó por el motor').not.toBeNull();

    // 4. El detalle está en la tabla de kardex, sellado con la empresa activa (A9).
    const detalles = await cliente.movimientoDetTela.findMany({ where: { idMovimiento: mov.id } });
    expect(detalles).toHaveLength(1);
    expect(detalles[0]?.idTelaColor).toBe(colorMarino.id);
    const enBd = await cliente.movimiento.findUniqueOrThrow({ where: { id: mov.id } });
    expect(enBd.idEmpresa).toBe(empresa.id);
  });

  it('⭐ AVÍO: resta la cantidad y la VISTA lo refleja igual que la Σ de movimientos', async () => {
    await entrarAvio(1000);
    expect(await existenciaAvioEnLaVista()).toBe(1000);

    const mov = await registrarSalidaAvioSinOrden(
      sesionDueno(),
      {
        concepto: 'venta',
        idAlmacen: almAvio.id,
        fecha: '2026-09-05',
        motivo: 'Venta de cierres descontinuados',
        lineas: [{ idAvio: avioCierre.id, cantidad: 250 }],
      },
      bd(),
    );

    expect(await existenciaAvioEnLaVista()).toBe(750);
    expect(mov.direccion).toBe('salida');
    expect(mov.origenTipo).toBe(ORIGEN.salidaSinOrden);
    expect(mov.totalCantidad).toBe(250);
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Movimiento', idEntidad: String(mov.id), accion: 'CREAR' },
    });
    expect(bitacora, 'el movimiento no dejó bitácora: no pasó por el motor').not.toBeNull();
  });
});

describe('(b) el CONCEPTO deja rastro en el kardex: devolución ≠ venta ≠ otra', () => {
  it('cada concepto escribe SU tipo de movimiento dedicado', async () => {
    await entrarTela(300, 0);

    const devolucion = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        concepto: 'devolucion-proveedor',
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 10 }],
      },
      bd(),
    );
    const venta = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        concepto: 'venta',
        motivo: 'Venta de saldo de felpa',
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 20 }],
      },
      bd(),
    );
    const otra = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        concepto: 'otro',
        motivo: 'Muestra para el laboratorio de pruebas',
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 5 }],
      },
      bd(),
    );

    const codigo = async (id: number): Promise<string> =>
      (
        await cliente.movimiento.findUniqueOrThrow({
          where: { id },
          select: { tipoMov: { select: { codigo: true } } },
        })
      ).tipoMov.codigo;

    expect(await codigo(devolucion.id)).toBe('devolucion-proveedor');
    expect(await codigo(venta.id)).toBe('venta-material');
    // «Otra causa» reusa el «Otras Salidas» de los 19 canónicos del sistema viejo (no estrena tipo).
    expect(await codigo(otra.id)).toBe('otras-salidas');
    // Y el nombre que se ve en el kardex distingue los tres.
    expect(new Set([devolucion.tipoMov, venta.tipoMov, otra.tipoMov]).size).toBe(3);
    expect(await saldoTela()).toEqual({ cuerpo: 265, complemento: 0 });
  });

  it('si el tipo de movimiento no está sembrado, avisa y NO escribe nada', async () => {
    await entrarTela(50, 0);
    await cliente.tipoMovimientoInventario.delete({ where: { codigo: 'venta-material' } });
    const antes = await cuantosMovimientos();

    await expect(
      registrarSalidaTelaColorSinOrden(
        sesionDueno(),
        {
          ...salidaTelaBase,
          concepto: 'venta',
          idAlmacen: almTela.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 5 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cuantosMovimientos()).toBe(antes);
    expect(await saldoTela()).toEqual({ cuerpo: 50, complemento: 0 });
  });
});

describe('(c) NO se deja el inventario en negativo (D3, bajo lock)', () => {
  it('⭐ TELA: sacar más cuerpo del que hay se rechaza y no escribe nada', async () => {
    await entrarTela(100, 40);
    const antes = await cuantosMovimientos();

    await expect(
      registrarSalidaTelaColorSinOrden(
        sesionDueno(),
        {
          ...salidaTelaBase,
          idAlmacen: almTela.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 101, cantidadComplemento: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    expect(await cuantosMovimientos(), 'el rechazo dejó un movimiento a medias').toBe(antes);
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 40 });
  });

  it('TELA: el COMPLEMENTO se valida aparte (alcanza el cuerpo, no el cardigan)', async () => {
    await entrarTela(100, 5);
    await expect(
      registrarSalidaTelaColorSinOrden(
        sesionDueno(),
        {
          ...salidaTelaBase,
          idAlmacen: almTela.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 10, cantidadComplemento: 6 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 5 });
  });

  it('⭐ AVÍO: sacar más de lo que hay se rechaza y no escribe nada', async () => {
    await entrarAvio(500);
    const antes = await cuantosMovimientos();

    await expect(
      registrarSalidaAvioSinOrden(
        sesionDueno(),
        {
          concepto: 'venta',
          idAlmacen: almAvio.id,
          fecha: '2026-09-05',
          motivo: 'Venta de cierres descontinuados',
          lineas: [{ idAvio: avioCierre.id, cantidad: 501 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    expect(await cuantosMovimientos()).toBe(antes);
    expect(await existenciaAvioEnLaVista()).toBe(500);
  });
});

describe('(d) CANCELAR deja el INVERSO y no borra nada (D3)', () => {
  it('⭐ TELA: el original sigue ahí, nace un movimiento de ENTRADA y el saldo vuelve', async () => {
    await entrarTela(100, 40);
    const salida = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30, cantidadComplemento: 12 }],
      },
      bd(),
    );
    expect(await saldoTela()).toEqual({ cuerpo: 70, complemento: 28 });

    const cancelado = await cancelarMovimientoTelaColor(
      sesionDueno(),
      salida.id,
      { motivo: 'Me equivoqué de color' },
      bd(),
    );

    // El ORIGINAL sigue existiendo, con sus mismas cantidades: no se editó ni se borró.
    const original = await cliente.movimiento.findUniqueOrThrow({
      where: { id: salida.id },
      include: { detallesTela: true },
    });
    expect(original.detallesTela).toHaveLength(1);
    expect(Number(original.detallesTela[0]?.cantidad)).toBe(30);
    expect(cancelado.cancelado).toBe(true);

    // Y nació un movimiento INVERSO, de dirección contraria, enlazado al original.
    const inverso = await cliente.movimiento.findFirstOrThrow({
      where: { idMovimientoInverso: salida.id },
      include: { tipoMov: true, detallesTela: true },
    });
    expect(inverso.tipoMov.direccion).toBe('entrada');
    expect(Number(inverso.detallesTela[0]?.cantidad)).toBe(30);
    expect(Number(inverso.detallesTela[0]?.cantidadComplemento)).toBe(12);

    // El material volvió al inventario.
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 40 });

    // Y no se re-cancela.
    await expect(
      cancelarMovimientoTelaColor(sesionDueno(), salida.id, { motivo: 'otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('AVÍO: mismo trato — inverso auditado, nada borrado, existencia de vuelta', async () => {
    await entrarAvio(1000);
    const salida = await registrarSalidaAvioSinOrden(
      sesionDueno(),
      {
        concepto: 'devolucion-proveedor',
        idAlmacen: almAvio.id,
        fecha: '2026-09-05',
        motivo: 'Devolución al proveedor de los cierres cortos',
        lineas: [{ idAvio: avioCierre.id, cantidad: 400 }],
      },
      bd(),
    );
    expect(await existenciaAvioEnLaVista()).toBe(600);

    await cancelarMovimientoAvio(sesionDueno(), salida.id, { motivo: 'Cargo mal capturado' }, bd());

    expect(await cliente.movimiento.findUnique({ where: { id: salida.id } })).not.toBeNull();
    const inverso = await cliente.movimiento.findFirstOrThrow({
      where: { idMovimientoInverso: salida.id },
      include: { tipoMov: true },
    });
    expect(inverso.tipoMov.direccion).toBe('entrada');
    expect(await existenciaAvioEnLaVista()).toBe(1000);
  });
});

describe('(e) ⭐ quién puede: la llave del dueño, también para la marcha atrás', () => {
  it('TELA: con sólo `inventario-telas.mover` NO se registra la salida', async () => {
    await entrarTela(100, 0);
    const antes = await cuantosMovimientos();
    await expect(
      registrarSalidaTelaColorSinOrden(
        sesionMover(),
        {
          ...salidaTelaBase,
          idAlmacen: almTela.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 10 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(await cuantosMovimientos()).toBe(antes);
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 0 });
  });

  it('⭐ TELA: con sólo `.mover` tampoco se CANCELA una salida sin orden', async () => {
    await entrarTela(100, 0);
    const salida = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30 }],
      },
      bd(),
    );

    await expect(
      cancelarMovimientoTelaColor(sesionMover(), salida.id, { motivo: 'lo deshago yo' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    // Nada se movió: ni inverso, ni saldo.
    expect(await cliente.movimiento.count({ where: { idMovimientoInverso: salida.id } })).toBe(0);
    expect(await saldoTela()).toEqual({ cuerpo: 70, complemento: 0 });
  });

  it('⭐ AVÍO: con sólo `.mover` tampoco se cancela una salida sin orden', async () => {
    await entrarAvio(1000);
    const salida = await registrarSalidaAvioSinOrden(
      sesionDueno(),
      {
        concepto: 'venta',
        idAlmacen: almAvio.id,
        fecha: '2026-09-05',
        motivo: 'Venta de cierres descontinuados',
        lineas: [{ idAvio: avioCierre.id, cantidad: 100 }],
      },
      bd(),
    );
    await expect(
      cancelarMovimientoAvio(sesionMover(), salida.id, { motivo: 'lo deshago yo' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(await existenciaAvioEnLaVista()).toBe(900);
  });

  it('🔴 TELA: la PUERTA DE ATRÁS también pide la llave (cancelación LEGADA por lote)', async () => {
    // `cancelarMovimientoTela` es la cancelación del flujo VIEJO por lote, pero acepta CUALQUIER
    // movimiento con renglones de tela — y los del flujo por color lo son. Si sólo se hubiera
    // guardado `cancelarMovimientoTelaColor`, esta puerta dejaría deshacer con `.mover` lo que sólo
    // el dueño puede autorizar.
    await entrarTela(100, 0);
    const salida = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30 }],
      },
      bd(),
    );

    await expect(
      cancelarMovimientoTela(sesionMover(), salida.id, { motivo: 'por la puerta de atrás' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(await cliente.movimiento.count({ where: { idMovimientoInverso: salida.id } })).toBe(0);
    expect(await saldoTela()).toEqual({ cuerpo: 70, complemento: 0 });

    // Y con la llave, sí: la puerta no queda tapiada, queda con cerradura.
    await cancelarMovimientoTela(sesionDueno(), salida.id, { motivo: 'me equivoqué' }, bd());
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 0 });
  });

  it('la fila NO le cambia el gobierno a nadie más: un AJUSTE normal se sigue cancelando con `.mover`', async () => {
    const ajuste = await entrarAvio(300);
    await cancelarMovimientoAvio(
      sesionMover(),
      ajuste.id,
      { motivo: 'Me equivoqué en el conteo' },
      bd(),
    );
    expect(await existenciaAvioEnLaVista()).toBe(0);
    const inverso = await cliente.movimiento.findFirstOrThrow({
      where: { idMovimientoInverso: ajuste.id },
      include: { tipoMov: true },
    });
    expect(inverso.tipoMov.direccion).toBe('salida');
  });
});

describe('(f) alcance por EMPRESA (A9)', () => {
  it('no se saca de un almacén PRIVADO de otra empresa', async () => {
    await expect(
      registrarSalidaTelaColorSinOrden(
        sesionDueno(),
        {
          ...salidaTelaBase,
          idAlmacen: almTelaAjena.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('⭐ no se cancela una salida de otra empresa (para esa sesión, no existe)', async () => {
    await entrarTela(100, 0);
    const salida = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 10 }],
      },
      bd(),
    );

    const desdeLaOtra = sesionDePrueba({
      idEmpresaActiva: otraEmpresa.id,
      permisos: PERM_DUENO,
    });
    await expect(
      cancelarMovimientoTelaColor(desdeLaOtra, salida.id, { motivo: 'no es mía' }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(await cliente.movimiento.count({ where: { idMovimientoInverso: salida.id } })).toBe(0);
  });

  it('el movimiento queda sellado con la empresa ACTIVA, y la otra empresa no lo ve', async () => {
    await entrarAvio(200);
    const salida = await registrarSalidaAvioSinOrden(
      sesionDueno(),
      {
        concepto: 'otro',
        idAlmacen: almAvio.id,
        fecha: '2026-09-05',
        motivo: 'Muestra para el cliente',
        lineas: [{ idAvio: avioCierre.id, cantidad: 20 }],
      },
      bd(),
    );
    const enBd = await cliente.movimiento.findUniqueOrThrow({ where: { id: salida.id } });
    expect(enBd.idEmpresa).toBe(empresa.id);

    const desdeLaOtra = sesionDePrueba({ idEmpresaActiva: otraEmpresa.id, permisos: PERM_DUENO });
    const { filas } = await consultarExistenciasAvio(
      desdeLaOtra,
      { idAvio: avioCierre.id, incluirCeros: true },
      bd(),
    );
    expect(filas, 'la otra empresa está viendo el inventario de ésta').toEqual([]);
  });
});

describe('(g) ⛔ los dos rótulos están RESERVADOS a la salida sin orden', () => {
  // 🔴 El hallazgo de la 2ª ronda. Los tipos de movimiento son un catálogo GLOBAL y los escritores
  // genéricos aceptan cualquier `idTipoMov` que no sea traspaso, así que recién sembrados estos dos
  // quedaban al alcance de los 8 perfiles con `inventario-*.mover` — y aparecían en el desplegable
  // de PT. Un rótulo que cualquiera puede estampar no clasifica mejor: clasifica igual de mal y con
  // más confianza, porque quien lea el kardex creerá que esa salida la autorizó el dueño.

  /** El id del tipo reservado que se quiere colar por la puerta genérica. */
  async function idTipoReservado(codigo: string): Promise<number> {
    return (await cliente.tipoMovimientoInventario.findUniqueOrThrow({ where: { codigo } })).id;
  }

  it('⭐ el AJUSTE de tela por color NO puede estampar «Venta de Material»', async () => {
    await entrarTela(100, 0);
    const antes = await cuantosMovimientos();
    await expect(
      ajustarInventarioTelaColor(
        // Ni siquiera con la llave: no hay camino alterno para escribir el mismo rótulo.
        sesionDueno(),
        {
          idTipoMov: await idTipoReservado('venta-material'),
          idAlmacen: almTela.id,
          fecha: '2026-09-05',
          motivo: 'colándome por el ajuste',
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 10 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cuantosMovimientos()).toBe(antes);
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 0 });
  });

  it('⭐ el AJUSTE de avíos NO puede estampar «Devolución a Proveedor» (ni con `.mover`)', async () => {
    await entrarAvio(500);
    const antes = await cuantosMovimientos();
    await expect(
      ajustarInventarioAvio(
        sesionMover(),
        {
          idTipoMov: await idTipoReservado('devolucion-proveedor'),
          idAlmacen: almAvio.id,
          fecha: '2026-09-05',
          motivo: 'colándome por el ajuste',
          lineas: [{ idAvio: avioCierre.id, cantidad: 50 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cuantosMovimientos()).toBe(antes);
    expect(await existenciaAvioEnLaVista()).toBe(500);
  });

  it('⭐ el movimiento manual de PRODUCTO TERMINADO tampoco los acepta', async () => {
    // El catálogo de tipos es global: sin esta guarda, la pantalla de movimientos de PT ofrecía los
    // dos rótulos a cualquiera con `inventario-pt.mover`. La venta de PT es otra fila (0.130).
    //
    // ⚠️ **Por qué se SIEMBRA existencia antes de intentar la salida.** Sin ella, el movimiento se
    // caía igual —pero por «no hay existencia suficiente»—, así que la prueba se apoyaba en
    // distinguir la CLASE del error y no en que la guarda fuera lo único que lo impedía. Con 10
    // piezas en el almacén, la salida de 5 se escribiría sin problema si el rechazo no existiera:
    // ésa es la condición que el reviewer midió («escribir Venta de Material: PERMITIDO»), y es la
    // que esta prueba tiene que reproducir para poder afirmar que ya no pasa.
    const almPt = await cliente.almacen.create({ data: { nombre: 'PT Primeras', tipo: 'PT' } });
    const modelo = await cliente.modelo.create({ data: { codigo: 'M-1', descripcion: 'Playera' } });
    const color = await cliente.color.create({ data: { nombre: 'Azul' } });
    const talla = await cliente.talla.create({ data: { etiqueta: 'M-0104', orden: 1 } });
    const quienMuevePt = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['inventario-pt.ver', 'inventario-pt.mover', PERMISO_SALIDA_SIN_ORDEN],
    });
    const capturaPt = {
      idAlmacen: almPt.id,
      idModelo: modelo.id,
      fecha: '2026-09-05',
      lineas: [{ idColor: color.id, tallas: [{ idTalla: talla.id, cantidad: 5 }] }],
    };

    await registrarMovimientoPt(
      quienMuevePt,
      {
        ...capturaPt,
        idTipoMov: idTipoAjusteEntrada,
        motivo: 'siembro para que HAYA de dónde sacar',
        lineas: [{ idColor: color.id, tallas: [{ idTalla: talla.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const antes = await cuantosMovimientos();
    const existenciaAntes = await existenciaPtEnAlmacen(almPt.id);
    expect(existenciaAntes).toBe(10);

    await expect(
      registrarMovimientoPt(
        quienMuevePt,
        {
          ...capturaPt,
          idTipoMov: await idTipoReservado('venta-material'),
          motivo: 'colándome por el movimiento manual',
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cuantosMovimientos()).toBe(antes);
    // Y la existencia sigue intacta: no se escribió media salida.
    expect(await existenciaPtEnAlmacen(almPt.id)).toBe(10);
  });

  it('🔴 la CUARTA puerta: el ajuste LEGADO por lote tampoco puede estamparlos', async () => {
    // ⚠️ Esta puerta NO estaba en la lista de tres del reviewer, y es la misma de siempre: además
    // del ajuste de tela POR COLOR (`partidas-telas.ts`), sigue viva la vista LEGADA por lote
    // (`telas.ts` → `POST /inventarios/telas/ajustes`), también con `inventario-telas.mover` y
    // también aceptando cualquier `idTipoMov` que no sea traspaso. Cerrar tres de cuatro puertas
    // deja el rótulo igual de falsificable: basta con entrar por la que quedó abierta.
    //
    // Es exactamente la simetría que esta fila ya reconoció para la CANCELACIÓN — el caso (e)
    // cierra «la puerta de atrás» por esta misma función legada—, sólo que del lado de la ESCRITURA
    // se había quedado sin cerrar.
    const colorCatalogo = await cliente.color.create({ data: { nombre: 'Marino (catálogo)' } });
    const entrada = await ajustarInventarioTela(
      sesionMover(),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almTela.id,
        fecha: '2026-09-01',
        motivo: 'inventario inicial por lote',
        lote: {
          idColor: colorCatalogo.id,
          factura: 'F-0104',
          componentes: [{ idTela: telaFelpa.id, cantidad: 100 }],
        },
      },
      bd(),
    );
    const idLote = entrada.renglones[0]?.idLote;
    // `toBe('number')` y no `not.toBeNull()`: con el `?.`, un `renglones` vacío daría `undefined`,
    // que NO es null — y entonces el `idLote!` de abajo viajaría vacío, la captura se caería por
    // validación y esta prueba pasaría por el motivo equivocado, sin haber llegado nunca a la
    // guarda que viene a medir.
    expect(typeof idLote, 'el lote se tuvo que crear').toBe('number');
    const antes = await cuantosMovimientos();

    // Con 100 kg en el lote, esta salida de 5 se escribiría sin problema si nada la parara: lo
    // único que la impide es la reserva del rótulo.
    await expect(
      ajustarInventarioTela(
        sesionMover(),
        {
          idTipoMov: await idTipoReservado('venta-material'),
          idAlmacen: almTela.id,
          fecha: '2026-09-05',
          motivo: 'colándome por la vista legada',
          lineas: [{ idTela: telaFelpa.id, idLote: idLote!, cantidad: 5 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cuantosMovimientos()).toBe(antes);
  });

  it('⭐ el API los marca `capturaManual: false` — la lista es la ÚNICA fuente de la pantalla', async () => {
    // El catálogo de tipos lo gobierna `inventario-pt.ver` (es compartido por los tres kardex).
    const quienLista = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: [...PERM_DUENO, 'inventario-pt.ver'],
    });
    const tipos = await listarTiposMovimiento(quienLista, {}, bd());
    const porCodigo = new Map(tipos.map((t) => [t.codigo, t.capturaManual]));
    expect(porCodigo.get('devolucion-proveedor')).toBe(false);
    expect(porCodigo.get('venta-material')).toBe(false);
    // Y NO se llevan por delante a los de siempre: «Otras Salidas» existía desde el sistema viejo
    // y el producto terminado lo usa con toda legitimidad.
    expect(porCodigo.get('otras-salidas')).toBe(true);
    expect(porCodigo.get('ajuste-salida')).toBe(true);
    expect(porCodigo.get('ajuste-entrada')).toBe(true);
  });
});

describe('(h) ⛔ cancelar el INVERSO también pide la llave', () => {
  it('⭐ TELA: con sólo `.mover` no se cancela el inverso (el material volvería a salir)', async () => {
    await entrarTela(100, 0);
    const salida = await registrarSalidaTelaColorSinOrden(
      sesionDueno(),
      {
        ...salidaTelaBase,
        idAlmacen: almTela.id,
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30 }],
      },
      bd(),
    );
    await cancelarMovimientoTelaColor(sesionDueno(), salida.id, { motivo: 'me equivoqué' }, bd());
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 0 });

    // El INVERSO nace con `origenTipo = cancelacion`, no con `salida-sin-orden`: mirando sólo el
    // origen del movimiento que se cancela, esta puerta quedaba abierta.
    const inverso = await cliente.movimiento.findFirstOrThrow({
      where: { idMovimientoInverso: salida.id },
      select: { id: true, origenTipo: true },
    });
    expect(inverso.origenTipo).toBe(ORIGEN.cancelacion);

    await expect(
      cancelarMovimientoTelaColor(
        sesionMover(),
        inverso.id,
        { motivo: 'que vuelva a salir' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(await saldoTela()).toEqual({ cuerpo: 100, complemento: 0 });

    // Con la llave sí: la puerta queda con cerradura, no tapiada.
    await cancelarMovimientoTelaColor(sesionDueno(), inverso.id, { motivo: 'sí sale' }, bd());
    expect(await saldoTela()).toEqual({ cuerpo: 70, complemento: 0 });
  });

  it('AVÍO: mismo trato para el inverso', async () => {
    await entrarAvio(1000);
    const salida = await registrarSalidaAvioSinOrden(
      sesionDueno(),
      {
        concepto: 'venta',
        idAlmacen: almAvio.id,
        fecha: '2026-09-05',
        motivo: 'Venta de cierres descontinuados',
        lineas: [{ idAvio: avioCierre.id, cantidad: 400 }],
      },
      bd(),
    );
    await cancelarMovimientoAvio(sesionDueno(), salida.id, { motivo: 'me equivoqué' }, bd());
    const inverso = await cliente.movimiento.findFirstOrThrow({
      where: { idMovimientoInverso: salida.id },
      select: { id: true },
    });
    await expect(
      cancelarMovimientoAvio(sesionMover(), inverso.id, { motivo: 'que vuelva a salir' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(await existenciaAvioEnLaVista()).toBe(1000);
  });

  it('la cadena NO estorba a lo demás: el inverso de un AJUSTE normal se cancela con `.mover`', async () => {
    const ajuste = await entrarAvio(300);
    await cancelarMovimientoAvio(sesionMover(), ajuste.id, { motivo: 'mal conteo' }, bd());
    const inverso = await cliente.movimiento.findFirstOrThrow({
      where: { idMovimientoInverso: ajuste.id },
      select: { id: true },
    });
    await cancelarMovimientoAvio(sesionMover(), inverso.id, { motivo: 'sí era' }, bd());
    expect(await existenciaAvioEnLaVista()).toBe(300);
  });
});
