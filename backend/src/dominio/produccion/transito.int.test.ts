/**
 * Tests de integración del TRÁNSITO DE PRENDAS A PROCESO EXTERNO (V1-E4b — §Post-F9.61). Postgres
 * efímero (testcontainers en CI; Postgres nativo en local).
 *
 * El escenario que motivó la etapa, tal como lo planteó Daniel, es el test central: se mandan 100
 * prendas YA TERMINADAS al estampador, vuelven 95 primeras + 3 segundas y faltan 2. Antes de esta
 * etapa el almacén seguía diciendo 100 primeras y las segundas y los faltantes no existían en
 * ningún lado. Aquí se comprueba, contra la BASE, que ahora sí existen:
 *   Primeras 100 → envío → Primeras 0, Tránsito 100
 *                → recibo (95 P + 3 S) → Primeras 95, Segundas 3, Tránsito 2 (el faltante, VIVO).
 *
 * Y lo que NO puede romperse: el flujo de siempre (envío de bultos cortados) sigue sin tocar el
 * kardex, letra por letra.
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
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { registrarMovimientoPt as registrarMovimientoPtMotor } from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { cerrarOrden, reabrirOrden } from './cierre-orden.js';
// 0.061: las puertas de escritura de la ORDEN misma (no de sus etapas), que también respetan el
// cierre. Van aquí, junto a la prueba de la guarda, para que la lista de puertas sea UNA sola.
import {
  actualizarOrden,
  cancelarOrden,
  guardarMatrizOrden,
  guardarReferenciasOrden,
} from './ordenes.js';
import { actualizarPreciosOrden } from './precios-orden.js';
import { cancelarEtapaMovimiento, registrarCorte, registrarEnvioMaquila } from './etapas.js';
import { cancelarReciboMaquila, pendientesPorRecibir, registrarReciboMaquila } from './recibos.js';
import { wipDeOrden } from './wip.js';
import { registrarEntregaCliente } from './entregas-cliente.js';
import {
  cancelarMovimientoPt as cancelarMovimientoPtManual,
  registrarMovimientoPt,
} from '../inventarios/movimientos-pt.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let cortador: Proveedor;
let estampador: Proveedor;
let maquileroCostura: Proveedor;
let procesoEstampado: TipoProceso;
let procesoCostura: TipoProceso;
let almPrimeras: Almacen;
let almSegundas: Almacen;
let almTransito: Almacen;
let idOrden: number;
let clienteNegocioId: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.cancelar',
  'produccion.wip-ver',
  'inventario-pt.ver',
  'inventario-pt.mover',
  'produccion.entrega',
];

/** Sesión de prueba; con `permisos` se pide un juego distinto (p. ej. + `ordenes.cerrar`, 0.061). */
const sesion = (permisos: ClavePermiso[] = PERM_TODOS): ReturnType<typeof sesionDePrueba> =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = (): { cliente: PrismaClient } => ({ cliente });

/** Crea un proveedor con un rol dado (vía RolProveedor). */
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

/** Orden de 100 piezas de Rojo/CH (la matriz del escenario de Daniel). */
async function crearOrden100(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 100, precio: 10 },
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
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 100 }] } },
        ],
      },
    },
  });
  return orden.id;
}

/** Tipos de movimiento que ejercita el tránsito (patas del traspaso + inversos + entrada). */
async function sembrarTiposMovimiento(): Promise<void> {
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'transferencia-salida', nombre: 'Transferencia (Salida)', direccion: 'salida' },
      { codigo: 'transferencia-entrada', nombre: 'Transferencia (Entrada)', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
      { codigo: 'error-salida', nombre: 'Error de Salida', direccion: 'entrada' },
      { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
      // ⭐ 0.061: la salida del tránsito de las prendas INCOMPLETAS (§Post-F9.154(a)).
      { codigo: 'merma-incompletas', nombre: 'Merma por prendas incompletas', direccion: 'salida' },
    ],
  });
}

/** Corta las 100 piezas de la orden (el envío se topa contra lo cortado, decisión (g)). */
async function cortar100(): Promise<void> {
  await registrarCorte(
    sesion(),
    {
      idOrden,
      idCortador: cortador.id,
      fecha: '2026-08-17',
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 100 }] }],
    },
    bd(),
  );
}

/**
 * Mete `cantidad` piezas de Rojo/CH de ESTA orden al almacén dado, como lo haría el recibo de
 * costura (movimiento manual etiquetado con la orden — F6-E2 "PT por orden").
 */
async function meterAPt(almacen: Almacen, cantidad: number): Promise<void> {
  const tipo = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'ajuste-entrada' },
  });
  await registrarMovimientoPt(
    sesion(),
    {
      idTipoMov: tipo.id,
      idAlmacen: almacen.id,
      idModelo: modelo.id,
      fecha: '2026-08-17',
      lineas: [
        {
          idColor: colorRojo.id,
          idOrden,
          tallas: [{ idTalla: tallaCH.id, cantidad }],
        },
      ],
    },
    bd(),
  );
}

/**
 * Mete `cantidad` piezas de Rojo/CH al almacén dado en el bucket «SIN ORDEN ASIGNADA» (`idOrden`
 * NULL): así entra TODO el histórico migrado (`migracion/loaders/ipt-kardex.ts` no etiqueta orden)
 * y así va a entrar el inventario físico de arranque de Daniel. Es el stock que existe el día uno.
 */
async function meterAPtSinOrden(almacen: Almacen, cantidad: number): Promise<void> {
  const tipo = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'ajuste-entrada' },
  });
  await registrarMovimientoPt(
    sesion(),
    {
      idTipoMov: tipo.id,
      idAlmacen: almacen.id,
      idModelo: modelo.id,
      fecha: '2026-08-17',
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad }] }],
    },
    bd(),
  );
}

/** Envía piezas al estampador. `prendaTerminada` decide si sale del almacén (V1-E4b). */
async function enviarAEstampado(
  cantidad: number,
  opciones: { prendaTerminada?: boolean; idAlmacenOrigen?: number; stockSinOrden?: boolean } = {},
): Promise<{ id: number }> {
  return registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoEstampado.id,
      idMaquilero: estampador.id,
      fecha: '2026-08-17',
      ...(opciones.prendaTerminada === undefined
        ? {}
        : { prendaTerminada: opciones.prendaTerminada }),
      ...(opciones.stockSinOrden === undefined ? {} : { stockSinOrden: opciones.stockSinOrden }),
      ...(opciones.idAlmacenOrigen === undefined
        ? {}
        : { idAlmacenOrigen: opciones.idAlmacenOrigen }),
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad }] }],
    },
    bd(),
  );
}

/**
 * Existencia REAL de Rojo/CH de esta orden en un almacén, sumando `MovimientoDetPt` con el signo de
 * la dirección — la MISMA cuenta que hace el motor (D3), no la vista.
 */
async function existencia(almacen: Almacen): Promise<number> {
  const filas = await cliente.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(
      d."cantidad" * CASE t."direccion" WHEN 'entrada' THEN 1 WHEN 'salida' THEN -1 ELSE 0 END
    ), 0)::bigint AS total
    FROM "movimiento_det_pt" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE m."id_almacen" = ${almacen.id} AND d."id_orden" = ${idOrden}
  `;
  return Number(filas[0]?.total ?? 0n);
}

/** Lo mismo pero del bucket «SIN ORDEN ASIGNADA» (`id_orden IS NULL`). */
async function existenciaSinOrden(almacen: Almacen): Promise<number> {
  const filas = await cliente.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(
      d."cantidad" * CASE t."direccion" WHEN 'entrada' THEN 1 WHEN 'salida' THEN -1 ELSE 0 END
    ), 0)::bigint AS total
    FROM "movimiento_det_pt" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE m."id_almacen" = ${almacen.id} AND d."id_orden" IS NULL
  `;
  return Number(filas[0]?.total ?? 0n);
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
  estampador = await crearProveedorConRol('Estampados SA', 'estampado');
  maquileroCostura = await crearProveedorConRol('Maquila Costura SA', 'maquila-costura');
  procesoEstampado = await cliente.tipoProceso.create({
    data: { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  });
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almSegundas = await cliente.almacen.create({ data: { nombre: 'Segundas', tipo: 'PT' } });
  almTransito = await cliente.almacen.create({
    data: { nombre: 'Tránsito', tipo: 'PT', esTransitoProceso: true },
  });
  await sembrarTiposMovimiento();
  idOrden = await crearOrden100();
});

describe('⭐ El escenario de Daniel: 100 al estampador, vuelven 95 + 3 segundas y faltan 2', () => {
  it('el envío SACA del almacén y deja las prendas en tránsito', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 100);
    expect(await existencia(almPrimeras)).toBe(100);

    await enviarAEstampado(100, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });

    expect(await existencia(almPrimeras)).toBe(0);
    expect(await existencia(almTransito)).toBe(100);
  });

  it('el recibo devuelve 95 primeras + 3 segundas y deja los 2 faltantes VIVOS en tránsito', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 100);
    await enviarAEstampado(100, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });

    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        idAlmacenSegundas: almSegundas.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 98, cantidadPrimeras: 95, cantidadSegundas: 3 },
            ],
          },
        ],
      },
      bd(),
    );

    expect(recibo.totalPrimeras).toBe(95);
    expect(recibo.totalSegundas).toBe(3);

    // ⭐ Lo que antes no existía en ningún lado, ahora existe y cuadra:
    expect(await existencia(almPrimeras)).toBe(95);
    expect(await existencia(almSegundas)).toBe(3);
    expect(await existencia(almTransito)).toBe(2); // el FALTANTE, vivo a cargo del estampador

    // Y el WIP sigue diciendo a QUIÉN se le reclaman esas 2 (el kardex dice cuántas, no de quién).
    const wip = await wipDeOrden(sesion(), idOrden, bd());
    const proc = wip.porRecibir.find((p) => p.idTipoProceso === procesoEstampado.id);
    expect(proc?.totalPendiente).toBe(2);
    expect(proc?.porMaquilero.find((m) => m.idMaquilero === estampador.id)?.totalPendiente).toBe(2);
  });

  it('la prenda que salió PRIMERA y vuelve SEGUNDA se reclasifica sin editar ningún saldo', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });

    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        idAlmacenSegundas: almSegundas.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10, cantidadPrimeras: 0, cantidadSegundas: 10 },
            ],
          },
        ],
      },
      bd(),
    );

    expect(await existencia(almPrimeras)).toBe(0);
    expect(await existencia(almSegundas)).toBe(10);
    expect(await existencia(almTransito)).toBe(0);
    // D3: nada se editó — todo son movimientos (2 del envío + 2 del recibo + el alta inicial).
    const movimientos = await cliente.movimiento.count();
    expect(movimientos).toBe(5);
  });
});

describe('Reglas del envío de prendas terminadas', () => {
  it('rechaza enviar más prendas de las que el almacén tiene (D3: nunca negativo)', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 40);

    await expect(
      enviarAEstampado(50, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id }),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Atomicidad (A2): ni etapa ni movimientos a medias.
    expect(await existencia(almPrimeras)).toBe(40);
    expect(await existencia(almTransito)).toBe(0);
    expect(await cliente.etapaMovimiento.count({ where: { tipo: 'envio_maquila' } })).toBe(0);
  });

  it('exige el almacén de origen cuando se mandan prendas terminadas', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await expect(enviarAEstampado(10, { prendaTerminada: true })).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('rechaza el almacén de origen cuando NO son prendas terminadas (no descontaría nada)', async () => {
    await cortar100();
    await expect(
      enviarAEstampado(10, { prendaTerminada: false, idAlmacenOrigen: almPrimeras.id }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un proceso que CREA producto terminado (costura) no puede enviar prenda terminada', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await expect(
      registrarEnvioMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-08-17',
          prendaTerminada: true,
          idAlmacenOrigen: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('no deja MEZCLAR las dos formas en la misma orden+proceso', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });

    await expect(enviarAEstampado(5, { prendaTerminada: false })).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('sin almacén de tránsito marcado, el envío NO pasa (y no deja etapa a medias)', async () => {
    await cliente.almacen.update({
      where: { id: almTransito.id },
      data: { esTransitoProceso: false },
    });
    await cortar100();
    await meterAPt(almPrimeras, 10);

    await expect(
      enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.etapaMovimiento.count({ where: { tipo: 'envio_maquila' } })).toBe(0);
    expect(await existencia(almPrimeras)).toBe(10);
  });

  it('la BASE impide que existan DOS almacenes de tránsito (índice único parcial, H7)', async () => {
    // Antes esto solo se DETECTABA al enviar; y como la bandera la pone el seed y no hay pantalla
    // para moverla, un segundo tránsito solo se arreglaba con SQL a mano. Ahora es imposible.
    await expect(
      cliente.almacen.create({
        data: { nombre: 'Tránsito 2', tipo: 'PT', esTransitoProceso: true },
      }),
    ).rejects.toThrowError(/almacen_transito_unico|[Uu]nique/);

    // Y el flujo sigue funcionando con el único que hay.
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    expect(await existencia(almTransito)).toBe(10);
  });

  it('REGRESIÓN — el envío de bultos cortados (el flujo de siempre) NO toca el kardex', async () => {
    await cortar100();
    await enviarAEstampado(30);

    expect(await cliente.movimiento.count()).toBe(0);
    const envio = await cliente.etapaMovimiento.findFirstOrThrow({
      where: { tipo: 'envio_maquila' },
    });
    expect(envio.prendaTerminada).toBe(false);
    expect(envio.idAlmacenOrigen).toBeNull();
  });
});

describe('Reglas del recibo que devuelve del tránsito', () => {
  it('exige almacén destino aunque el proceso NO cree producto terminado', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });

    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoEstampado.id,
          idMaquilero: estampador.id,
          fecha: '2026-08-18',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('los pendientes por recibir avisan que este proceso DEVUELVE a PT', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });

    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const proc = pend.porRecibir.find((p) => p.idTipoProceso === procesoEstampado.id);
    expect(proc?.generaEntradaPt).toBe(false);
    expect(proc?.devuelveAPt).toBe(true);

    const wip = await wipDeOrden(sesion(), idOrden, bd());
    expect(wip.porRecibir.find((p) => p.idTipoProceso === procesoEstampado.id)?.devuelveAPt).toBe(
      true,
    );
  });

  it('REGRESIÓN — el recibo de un estampado ANTES de costura sigue sin tocar el kardex', async () => {
    await cortar100();
    await enviarAEstampado(10);
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(await cliente.movimiento.count()).toBe(0);
  });
});

describe('El tránsito no es una bodega: nadie más lo usa como origen ni como destino', () => {
  it('no se le entrega al cliente desde el tránsito', async () => {
    // El escenario se arma para que la entrega fuera VÁLIDA por todo lo demás: la orden ya tiene
    // producto terminado recibido de costura (el tope del WIP "no entregues lo que no recibiste")
    // y el tránsito tiene las piezas (el tope del kardex). Lo ÚNICO que la detiene es el candado
    // del almacén: sin él, la entrega pasaría y el cliente se llevaría prendas que están en el
    // taller del estampador.
    await cortar100();
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-08-17',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 100 }] }],
      },
      bd(),
    );
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 20 }] }],
      },
      bd(),
    );
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    expect(await existencia(almPrimeras)).toBe(10);
    expect(await existencia(almTransito)).toBe(10);

    await expect(
      registrarEntregaCliente(
        sesion(),
        {
          idOrden,
          idAlmacen: almTransito.id,
          fecha: '2026-08-19',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toThrowError(/TR[ÁA]NSITO a proceso externo/);
    expect(await existencia(almTransito)).toBe(10);

    // Y para que no queden dudas de que lo demás SÍ estaba en regla: la misma entrega, desde el
    // almacén de primeras, pasa sin problema.
    const entrega = await registrarEntregaCliente(
      sesion(),
      {
        idOrden,
        idAlmacen: almPrimeras.id,
        fecha: '2026-08-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(entrega.totalPiezas).toBe(10);
    expect(await existencia(almPrimeras)).toBe(0);
  });

  it('un recibo de costura no puede meter producto terminado al tránsito', async () => {
    await cortar100();
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-08-17',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-08-18',
          idAlmacenPrimeras: almTransito.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await existencia(almTransito)).toBe(0);
  });
});

describe('Cancelaciones (D3: inverso auditado, jamás edición)', () => {
  it('cancelar el ENVÍO regresa las prendas del tránsito a su almacén', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    const envio = await enviarAEstampado(10, {
      prendaTerminada: true,
      idAlmacenOrigen: almPrimeras.id,
    });
    expect(await existencia(almTransito)).toBe(10);

    await cancelarEtapaMovimiento(sesion(), envio.id, { motivo: 'Se capturó mal' }, bd());

    expect(await existencia(almPrimeras)).toBe(10);
    expect(await existencia(almTransito)).toBe(0);
    // Los movimientos originales SIGUEN ahí, anulados por un inverso enlazado (nunca borrados).
    const anulados = await cliente.movimiento.count({
      where: { idMovimientoInverso: { not: null } },
    });
    expect(anulados).toBe(2);
  });

  it('cancelar el RECIBO devuelve las prendas al tránsito (de donde salieron)', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(await existencia(almPrimeras)).toBe(10);

    await cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'No era esta orden' }, bd());

    expect(await existencia(almPrimeras)).toBe(0);
    expect(await existencia(almTransito)).toBe(10);
  });

  it('cancelar un recibo cuyas prendas YA salieron del almacén no deja el inventario en negativo', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    // Alguien saca las prendas del almacén (una entrega, una salida manual… da igual).
    const tipoSalida = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
      where: { codigo: 'ajuste-salida' },
    });
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tipoSalida.id,
        idAlmacen: almPrimeras.id,
        idModelo: modelo.id,
        fecha: '2026-08-19',
        lineas: [
          { idColor: colorRojo.id, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] },
        ],
      },
      bd(),
    );

    await expect(
      cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'Ya no están' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Nada quedó a medias: el recibo sigue vivo y el almacén en 0 (no en −10).
    expect(await existencia(almPrimeras)).toBe(0);
    const reciboBd = await cliente.etapaMovimiento.findUniqueOrThrow({ where: { id: recibo.id } });
    expect(reciboBd.canceladoEn).toBeNull();
  });
});

/**
 * ⭐ H1 del reviewer — EL STOCK DEL BUCKET «SIN ORDEN ASIGNADA».
 *
 * La existencia de PT es por modelo×color×talla×**ORDEN**×almacén (F6-E2). El bucket `id_orden =
 * NULL` es donde cae TODO el histórico migrado (`migracion/loaders/ipt-kardex.ts` no etiqueta
 * orden) y TODO lo que Daniel capture en el inventario físico de arranque: o sea, es el stock que
 * hay el DÍA UNO. Sin poder elegirlo, el envío de prendas terminadas chocaba contra un saldo de 0
 * mientras la pantalla de existencias mostraba las piezas.
 */
describe('H1 · el envío puede sacar del bucket «sin orden asignada»', () => {
  it('con el stock SIN orden, el envío del bucket de la orden falla y el error DICE dónde están', async () => {
    await cortar100();
    await meterAPtSinOrden(almPrimeras, 100);
    expect(await existenciaSinOrden(almPrimeras)).toBe(100);
    expect(await existencia(almPrimeras)).toBe(0);

    // El default (stock de la orden) no alcanza…
    await expect(
      enviarAEstampado(100, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id }),
    ).rejects.toThrowError(/otros buckets/);
    // …y el mensaje dice CUÁNTAS hay en el otro bucket, en vez de un "0" que el almacén contradice.
    await expect(
      enviarAEstampado(100, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id }),
    ).rejects.toThrowError(/100 pza\(s\) del mismo artículo/);
  });

  it('eligiendo el bucket «sin orden», el envío SÍ sale y el recibo lo devuelve al MISMO bucket', async () => {
    await cortar100();
    await meterAPtSinOrden(almPrimeras, 100);

    await enviarAEstampado(100, {
      prendaTerminada: true,
      idAlmacenOrigen: almPrimeras.id,
      stockSinOrden: true,
    });
    expect(await existenciaSinOrden(almPrimeras)).toBe(0);
    expect(await existenciaSinOrden(almTransito)).toBe(100);
    // No se reetiquetó nada al bucket de la orden por el camino.
    expect(await existencia(almTransito)).toBe(0);

    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        idAlmacenSegundas: almSegundas.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 98, cantidadPrimeras: 95, cantidadSegundas: 3 },
            ],
          },
        ],
      },
      bd(),
    );

    // Vuelven al MISMO bucket del que salieron: el tránsito no reetiqueta mercancía.
    expect(await existenciaSinOrden(almPrimeras)).toBe(95);
    expect(await existenciaSinOrden(almSegundas)).toBe(3);
    expect(await existenciaSinOrden(almTransito)).toBe(2);
    expect(await existencia(almPrimeras)).toBe(0);
    expect(await existencia(almSegundas)).toBe(0);
  });

  it('el WIP/pendientes publican de qué bucket salió, para que la captura no lo adivine', async () => {
    await cortar100();
    await meterAPtSinOrden(almPrimeras, 10);
    await enviarAEstampado(10, {
      prendaTerminada: true,
      idAlmacenOrigen: almPrimeras.id,
      stockSinOrden: true,
    });

    const pend = await pendientesPorRecibir(sesion(), idOrden, bd());
    const proc = pend.porRecibir.find((p) => p.idTipoProceso === procesoEstampado.id);
    expect(proc?.devuelveAPt).toBe(true);
    expect(proc?.stockSinOrden).toBe(true);

    const wip = await wipDeOrden(sesion(), idOrden, bd());
    expect(wip.porRecibir.find((p) => p.idTipoProceso === procesoEstampado.id)?.stockSinOrden).toBe(
      true,
    );
  });

  it('no deja MEZCLAR buckets distintos en la misma orden+proceso', async () => {
    await cortar100();
    await meterAPtSinOrden(almPrimeras, 10);
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, {
      prendaTerminada: true,
      idAlmacenOrigen: almPrimeras.id,
      stockSinOrden: true,
    });

    await expect(
      enviarAEstampado(5, {
        prendaTerminada: true,
        idAlmacenOrigen: almPrimeras.id,
        stockSinOrden: false,
      }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('el bucket «sin orden» solo aplica a prendas terminadas (con bultos cortados se rechaza)', async () => {
    await cortar100();
    await expect(
      enviarAEstampado(10, { prendaTerminada: false, stockSinOrden: true }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

/**
 * ⭐ H4 del reviewer — el NO-NEGATIVO de la pata de VUELTA tenía cobertura cero. Es un invariante
 * D3: si alguien saca piezas del tránsito por otro lado, el recibo no puede devolver más de las que
 * quedan (dejaría el tránsito negativo y el faltante dejaría de cuadrar).
 */
describe('H4 · el recibo no puede devolver más de lo que queda en tránsito', () => {
  it('con el tránsito vaciado a mano, el recibo se rechaza y no deja nada a medias', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    expect(await existencia(almTransito)).toBe(10);

    // Alguien da de baja 6 piezas del tránsito con un movimiento manual (la vía legítima del
    // faltante que ya no va a volver).
    const tipoSalida = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
      where: { codigo: 'ajuste-salida' },
    });
    await registrarMovimientoPt(
      sesion(),
      {
        idTipoMov: tipoSalida.id,
        idAlmacen: almTransito.id,
        idModelo: modelo.id,
        fecha: '2026-08-19',
        lineas: [
          { idColor: colorRojo.id, idOrden, tallas: [{ idTalla: tallaCH.id, cantidad: 6 }] },
        ],
      },
      bd(),
    );
    expect(await existencia(almTransito)).toBe(4);

    // El WIP todavía cree que el maquilero debe 10, así que el recibo de 10 pasa sus validaciones
    // de WIP… y lo detiene el kardex: en tránsito solo quedan 4.
    await expect(
      registrarReciboMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoEstampado.id,
          idMaquilero: estampador.id,
          fecha: '2026-08-20',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Atomicidad (A2): ni recibo, ni movimientos, ni cargo EsMa a medias.
    expect(await existencia(almTransito)).toBe(4);
    expect(await existencia(almPrimeras)).toBe(0);
    expect(await cliente.etapaMovimiento.count({ where: { tipo: 'recibo_maquila' } })).toBe(0);

    // Y recibir lo que SÍ queda pasa sin problema.
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-20',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
      },
      bd(),
    );
    expect(await existencia(almTransito)).toBe(0);
    expect(await existencia(almPrimeras)).toBe(4);
  });
});

/**
 * ⭐ H2 del reviewer — LA PUERTA DE ATRÁS. Cancelando desde Inventarios UNA sola pata del traspaso
 * que hace el envío, quedaban `primeras = 0` y `tránsito = 0` mientras el WIP seguía reclamándole
 * 100 piezas al estampador: cien prendas desaparecidas del kardex, que es exactamente la enfermedad
 * que esta etapa vino a curar. Ahora a mano solo se cancela lo que se capturó a mano.
 */
describe('H2 · los movimientos que generó un hecho no se cancelan sueltos', () => {
  it('no se puede cancelar a mano una pata del traspaso del envío (y dice dónde sí)', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 100);
    const envio = await enviarAEstampado(100, {
      prendaTerminada: true,
      idAlmacenOrigen: almPrimeras.id,
    });

    const patas = await cliente.movimiento.findMany({
      where: { origenTipo: 'envio-maquila', origenId: String(envio.id) },
      select: { id: true, idAlmacen: true },
      orderBy: { id: 'asc' },
    });
    expect(patas).toHaveLength(2);

    for (const pata of patas) {
      await expect(
        cancelarMovimientoPtManual(sesion(), pata.id, { motivo: 'me equivoqué' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    }
    await expect(
      cancelarMovimientoPtManual(sesion(), patas[0]?.id ?? 0, { motivo: 'me equivoqué' }, bd()),
    ).rejects.toThrowError(/ENTREGA de prendas a proceso/);

    // El inventario quedó intacto: nada desapareció por la puerta de atrás.
    expect(await existencia(almPrimeras)).toBe(0);
    expect(await existencia(almTransito)).toBe(100);

    // Y la vía correcta —cancelar la ENTREGA— sí regresa las piezas.
    await cancelarEtapaMovimiento(sesion(), envio.id, { motivo: 'se capturó mal' }, bd());
    expect(await existencia(almPrimeras)).toBe(100);
    expect(await existencia(almTransito)).toBe(0);
  });

  it('tampoco se cancela suelto lo que generó un RECIBO (va por el recibo)', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const mov = await cliente.movimiento.findFirstOrThrow({
      where: { origenTipo: 'recibo-maquila', origenId: String(recibo.id) },
      select: { id: true },
    });
    await expect(
      cancelarMovimientoPtManual(sesion(), mov.id, { motivo: 'a mano no' }, bd()),
    ).rejects.toThrowError(/RECIBO de maquila/);
  });

  it('el movimiento MANUAL sí se sigue cancelando a mano (no se rompió lo que funcionaba)', async () => {
    await meterAPt(almPrimeras, 10);
    const manual = await cliente.movimiento.findFirstOrThrow({
      where: { origenTipo: 'movimiento-manual' },
      select: { id: true },
    });
    const cancelado = await cancelarMovimientoPtManual(
      sesion(),
      manual.id,
      { motivo: 'captura equivocada' },
      bd(),
    );
    expect(cancelado.cancelado).toBe(true);
    expect(await existencia(almPrimeras)).toBe(0);
  });
});

/**
 * ⭐ H6 del reviewer — LA BITÁCORA NO PUEDE MENTIR (A7: auditoría uniforme).
 *
 * Antes de V1-E4b, "el recibo metió a inventario" y "el TipoProceso genera entrada a PT" eran la
 * misma cosa, y la bitácora anotaba `generaEntradaPt: meteAPt` sin conflicto. Ya no lo son: un
 * estampado DESPUÉS de costura mete mercancía a inventario (la devuelve del tránsito) con su
 * `TipoProceso.generaEntradaPt` en `false`. Un campo llamado `generaEntradaPt` no puede llevar otro
 * valor que el de la bandera; por eso ahora son tres campos y cada uno dice lo suyo.
 *
 * (El patrón de aserción es el mismo que ya usan `admin/almacenes.int.test.ts:151`,
 * `modelos/arte-modelo.int.test.ts:207` y varios más: `expect(bitacora.datos).toMatchObject({…})`.)
 */
describe('H6 · la bitácora del recibo dice la verdad de cada campo', () => {
  it('estampado DESPUÉS de costura: generaEntradaPt=false, devuelveDeTransito=true, meteAInventario=true', async () => {
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'EtapaMovimiento', idEntidad: String(recibo.id), accion: 'CREAR' },
    });
    expect(bitacora.datos).toMatchObject({
      tipo: 'recibo_maquila',
      // El valor REAL de la bandera del TipoProceso, no "si metió a inventario".
      generaEntradaPt: false,
      devuelveDeTransito: true,
      meteAInventario: true,
    });
  });

  it('recibo de COSTURA: generaEntradaPt=true y devuelveDeTransito=false (no se invirtió el sentido)', async () => {
    await cortar100();
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-08-17',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'EtapaMovimiento', idEntidad: String(recibo.id), accion: 'CREAR' },
    });
    expect(bitacora.datos).toMatchObject({
      generaEntradaPt: true,
      devuelveDeTransito: false,
      meteAInventario: true,
    });
  });

  it('estampado ANTES de costura: no mete nada a inventario y la bitácora lo dice', async () => {
    await cortar100();
    await enviarAEstampado(10);
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'EtapaMovimiento', idEntidad: String(recibo.id), accion: 'CREAR' },
    });
    expect(bitacora.datos).toMatchObject({
      generaEntradaPt: false,
      devuelveDeTransito: false,
      meteAInventario: false,
    });
  });

  it('el ENVÍO de prendas terminadas también deja el bucket en su bitácora', async () => {
    await cortar100();
    await meterAPtSinOrden(almPrimeras, 10);
    const envio = await enviarAEstampado(10, {
      prendaTerminada: true,
      idAlmacenOrigen: almPrimeras.id,
      stockSinOrden: true,
    });

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'EtapaMovimiento', idEntidad: String(envio.id), accion: 'CREAR' },
    });
    expect(bitacora.datos).toMatchObject({
      tipo: 'envio_maquila',
      prendaTerminada: true,
      stockSinOrden: true,
      idAlmacenOrigen: almPrimeras.id,
    });
  });
});

/**
 * F1 del reviewer — EL MENSAJE NO PUEDE MANDAR A UNA PUERTA CERRADA CON LLAVE.
 *
 * El guard de H2 rechaza cancelar a mano lo que generó un hecho y le dice al usuario dónde SÍ. Para
 * el ajuste de un inventario cíclico esa frase decía "se corrige desde el cíclico", y es falso: el
 * ajuste deja el conteo en `cerrado` y `cancelarInventarioCiclico` rechaza justo ese estado, así
 * que el único momento en el que existe un movimiento `ajuste-ciclico` es el momento en el que el
 * cíclico se niega. La salida real es un movimiento manual NUEVO — igual que con lo migrado.
 */
describe('F1 · el mensaje de "dónde sí se cancela" tiene que ser cierto', () => {
  it('el ajuste de un cíclico NO manda al cíclico: manda a un movimiento manual nuevo', async () => {
    const tipoEntrada = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
      where: { codigo: 'ajuste-entrada' },
    });
    // Se registra por el MOTOR para poder sellar el origen del cíclico sin montar un conteo entero
    // (el dominio manual siempre sella `movimiento-manual`).
    const mov = await registrarMovimientoPtMotor(
      sesion(),
      {
        idEmpresa: empresa.id,
        idTipoMov: tipoEntrada.id,
        idAlmacen: almPrimeras.id,
        fecha: new Date('2026-08-17T00:00:00.000Z'),
        origenTipo: ORIGEN.ajusteCiclico,
        origenId: '1',
        lineas: [
          {
            idModelo: modelo.id,
            idColor: colorRojo.id,
            idTalla: tallaCH.id,
            idOrden,
            cantidad: 5,
          },
        ],
      },
      bd(),
    );

    const fallo = cancelarMovimientoPtManual(sesion(), mov.id, { motivo: 'estuvo mal' }, bd());
    await expect(fallo).rejects.toBeInstanceOf(ErrorConflicto);
    // Dice que no hay marcha atrás y a dónde ir…
    await expect(fallo).rejects.toThrowError(/movimiento manual NUEVO/);
    // …y NO manda de vuelta al cíclico, que rechazaría por estar cerrado.
    await expect(fallo).rejects.not.toThrowError(/se corrige desde el cíclico/);
  });
});

// ── ⭐⭐ 0.061 · LA INCOMPLETA SALE DEL TRÁNSITO COMO MERMA (§Post-F9.154(a)) ────────────────────

describe('La prenda INCOMPLETA sale sola del tránsito, como merma', () => {
  /** Existencia de Rojo/CH en un almacén contando SÓLO los movimientos de un tipo. */
  async function existenciaPorTipo(almacen: Almacen, codigoTipo: string): Promise<number> {
    const filas = await cliente.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(d."cantidad"), 0)::bigint AS total
      FROM "movimiento_det_pt" d
      JOIN "movimientos" m ON m."id" = d."id_movimiento"
      JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
      WHERE m."id_almacen" = ${almacen.id} AND t."codigo" = ${codigoTipo}
    `;
    return Number(filas[0]?.total ?? 0n);
  }

  it('⭐ 10 al estampador → 7 primeras + 1 segunda + 2 INCOMPLETAS: el tránsito queda en 0', async () => {
    // Antes de 0.061 esas 2 se quedaban en tránsito PARA SIEMPRE: nadie las iba a devolver y la
    // única salida era un movimiento manual que nadie hacía. Ahora salen solas, como merma.
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    expect(await existencia(almTransito)).toBe(10);

    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        idAlmacenSegundas: almSegundas.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              {
                idTalla: tallaCH.id,
                cantidad: 8,
                cantidadPrimeras: 7,
                cantidadSegundas: 1,
                cantidadIncompletas: 2,
              },
            ],
          },
        ],
      },
      bd(),
    );

    // Las buenas vuelven a su almacén…
    expect(await existencia(almPrimeras)).toBe(7);
    expect(await existencia(almSegundas)).toBe(1);
    // …y las 2 incompletas SALEN: el tránsito queda en 0 (10 = 7 + 1 + 2, nada atorado).
    expect(await existencia(almTransito)).toBe(0);
    // Y salieron con SU tipo de movimiento, no disfrazadas de otra cosa.
    expect(await existenciaPorTipo(almTransito, 'merma-incompletas')).toBe(2);

    // NO entraron a ningún inventario: 7 + 1 = 8 piezas en total, no 10.
    expect((await existencia(almPrimeras)) + (await existencia(almSegundas))).toBe(8);
  });

  it('CANCELAR el recibo devuelve las incompletas al tránsito (D3, sin código propio)', async () => {
    // La reversión sale gratis porque la merma queda sellada con el origen DEL RECIBO y
    // `revertirMovimientosDeHecho` revierte por origen con el inverso de la dirección opuesta.
    // Esto lo DEMUESTRA en vez de confiar en que así sea.
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });
    const recibo = await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 8, cantidadPrimeras: 8, cantidadIncompletas: 2 },
            ],
          },
        ],
      },
      bd(),
    );
    expect(await existencia(almTransito)).toBe(0);

    await cancelarReciboMaquila(sesion(), recibo.id, { motivo: 'mal capturado' }, bd());

    // Todo vuelve a como estaba ANTES del recibo: las 10 en tránsito, el almacén en 0.
    expect(await existencia(almTransito)).toBe(10);
    expect(await existencia(almPrimeras)).toBe(0);
    // D3: el movimiento original NO se borró — se anuló con su inverso.
    const movs = await cliente.movimiento.count({
      where: { origenTipo: ORIGEN.reciboMaquila, origenId: String(recibo.id) },
    });
    expect(movs).toBeGreaterThan(0);
  });

  it('un recibo de SÓLO incompletas también las saca (no exige almacén destino)', async () => {
    // `meteAPt` pide `totalRecibido > 0`; la merma es INDEPENDIENTE de eso, y este es el caso que
    // lo prueba: el maquilero devolvió las 3 que no pudo terminar y nada más.
    await cortar100();
    await meterAPt(almPrimeras, 10);
    await enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id });

    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [{ idTalla: tallaCH.id, cantidad: 0, cantidadIncompletas: 3 }],
          },
        ],
      },
      bd(),
    );

    expect(await existencia(almTransito)).toBe(7); // 10 − 3 mermadas; las 7 siguen pendientes
    expect(await existencia(almPrimeras)).toBe(0);
  });

  it('en un recibo de COSTURA no hay merma: esas piezas nunca estuvieron en el kardex', async () => {
    // El envío mandó BULTOS CORTADOS, que no son PT. Meter una salida dejaría el tránsito NEGATIVO
    // por una pieza que jamás estuvo ahí.
    await cortar100();
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-08-17',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 8, cantidadPrimeras: 8, cantidadIncompletas: 2 },
            ],
          },
        ],
      },
      bd(),
    );

    expect(await existencia(almPrimeras)).toBe(8); // la costura CREA las 8 buenas
    expect(await existencia(almTransito)).toBe(0); // y el tránsito ni se toca
    expect(await existenciaPorTipo(almTransito, 'merma-incompletas')).toBe(0);
  });

  it('sale del MISMO bucket del que salieron (stock «sin orden asignada»)', async () => {
    // Si el envío tomó del bucket «sin orden», la merma tiene que salir de ahí — no reetiquetarse
    // a la orden, que sería mover saldo entre buckets sin que nadie lo pidiera.
    await cortar100();
    await registrarMovimientoPtMotor(
      sesion(),
      {
        idEmpresa: empresa.id,
        idTipoMov: (
          await cliente.tipoMovimientoInventario.findUniqueOrThrow({
            where: { codigo: 'ajuste-entrada' },
          })
        ).id,
        idAlmacen: almPrimeras.id,
        fecha: new Date('2026-08-16T00:00:00.000Z'),
        origenTipo: ORIGEN.movimientoManual,
        origenId: 'siembra-sin-orden',
        lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 10 }],
      },
      bd(),
    );
    await enviarAEstampado(10, {
      prendaTerminada: true,
      idAlmacenOrigen: almPrimeras.id,
      stockSinOrden: true,
    });
    expect(await existenciaSinOrden(almTransito)).toBe(10);

    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-08-18',
        idAlmacenPrimeras: almPrimeras.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 8, cantidadPrimeras: 8, cantidadIncompletas: 2 },
            ],
          },
        ],
      },
      bd(),
    );

    expect(await existenciaSinOrden(almTransito)).toBe(0); // 8 devueltas + 2 mermadas
    expect(await existencia(almTransito)).toBe(0); // y el bucket de la ORDEN ni se tocó
  });
});

// ── ⭐⭐ 0.061 · LA ORDEN CERRADA NO ADMITE CAPTURA (§Post-F9.154(c)) ────────────────────────────

describe('La guarda de la orden CERRADA, puerta por puerta', () => {
  // ⚠️ Lleva TAMBIÉN `ordenes.ver`: `cerrarOrden`/`reabrirOrden` devuelven la orden y la leen con
  // `obtenerOrden`, que lo exige (y lo comprueba ANTES de escribir — ver `costos.int.test.ts`).
  const sesionCierre = () => sesion([...PERM_TODOS, 'ordenes.cerrar', 'ordenes.ver']);

  it('cerrar la orden RECHAZA corte, envío, recibo, entrega y las cancelaciones', async () => {
    // La guarda es UNA sola (`exigirOrdenAbierta`) aplicada en cada puerta de escritura. Esta
    // prueba recorre las puertas: si alguien agrega una y se olvida de la guarda, aquí NO se
    // entera — pero al menos las que existen hoy quedan amarradas.
    await cortar100();
    await meterAPt(almPrimeras, 10);
    const envio = await enviarAEstampado(10, {
      prendaTerminada: true,
      idAlmacenOrigen: almPrimeras.id,
    });

    await cerrarOrden(sesionCierre(), idOrden, { motivo: 'ya terminó' }, bd());

    // (1) CORTE
    await expect(
      registrarCorte(
        sesionCierre(),
        {
          idOrden,
          idCortador: cortador.id,
          fecha: '2026-08-19',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // (2) ENVÍO
    await expect(
      enviarAEstampado(1, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id }),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // (3) RECIBO
    await expect(
      registrarReciboMaquila(
        sesionCierre(),
        {
          idOrden,
          idTipoProceso: procesoEstampado.id,
          idMaquilero: estampador.id,
          fecha: '2026-08-19',
          idAlmacenPrimeras: almPrimeras.id,
          lineas: [
            {
              idColor: colorRojo.id,
              tallas: [{ idTalla: tallaCH.id, cantidad: 1, cantidadPrimeras: 1 }],
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // (4) ENTREGA A CLIENTE
    await expect(
      registrarEntregaCliente(
        sesionCierre(),
        {
          idOrden,
          fecha: '2026-08-19',
          idAlmacen: almPrimeras.id,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // (5) CANCELAR UNA ETAPA (mueve las cantidades ⇒ movería el costo congelado)
    await expect(
      cancelarEtapaMovimiento(sesionCierre(), envio.id, { motivo: 'ups' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('REABRIRLA vuelve a dejar capturar (el bloqueo es del cierre, no del histórico)', async () => {
    await cortar100();
    await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    await reabrirOrden(sesionCierre(), idOrden, { motivo: 'faltaba una etapa' }, bd());

    await meterAPt(almPrimeras, 10);
    await expect(
      enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id }),
    ).resolves.toBeDefined();
  });

  it('⭐ y RECHAZA también las puertas de la ORDEN: encabezado, matriz, referencias, precios y cancelar', async () => {
    // Las etapas eran la mitad del cierre; la otra mitad es la orden MISMA. Sin esto, una orden
    // cerrada seguía admitiendo que le cambiaran la matriz (las piezas pedidas), el precio de
    // maquila (un componente del costo) o que la CANCELARAN — y eso último dejaba el `estado` en
    // `cancelada` mientras `cerradaEn` seguía puesta: dos finales a la vez.
    const s = sesion([
      ...PERM_TODOS,
      'ordenes.cerrar',
      'ordenes.ver',
      'ordenes.administrar',
      'ordenes.cancelar',
      'ordenes.precio-maquila',
    ]);
    await cerrarOrden(s, idOrden, {}, bd());

    // (1) ENCABEZADO
    await expect(
      actualizarOrden(s, { id: idOrden, observaciones: 'nueva nota' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // (2) MATRIZ (las piezas pedidas — moverlas movería el costo)
    await expect(
      guardarMatrizOrden(
        s,
        idOrden,
        { lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 50 }] }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // (3) REFERENCIAS del cliente (D7)
    await expect(
      guardarReferenciasOrden(s, idOrden, { referencias: [] }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // (4) PRECIO real de maquila (componente del costo congelado)
    await expect(
      actualizarPreciosOrden(s, idOrden, { campo: 'maquila', precio: 12.5 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // (5) CANCELAR la orden
    await expect(cancelarOrden(s, idOrden, { motivo: 'ya no' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // Y la rama gemela: reabierta, la MISMA llamada pasa (el bloqueo era del cierre).
    await reabrirOrden(s, idOrden, { motivo: 'hay que corregir el encabezado' }, bd());
    await expect(
      actualizarOrden(s, { id: idOrden, observaciones: 'nueva nota' }, bd()),
    ).resolves.toBeDefined();
  });

  it('el mensaje del rechazo NOMBRA la salida (reabrir), que el usuario no puede adivinar', async () => {
    await cortar100();
    await cerrarOrden(sesionCierre(), idOrden, {}, bd());
    await expect(
      registrarCorte(
        sesionCierre(),
        {
          idOrden,
          idCortador: cortador.id,
          fecha: '2026-08-19',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/reábrela/i);
  });
});
