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
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { cancelarEtapaMovimiento, registrarCorte, registrarEnvioMaquila } from './etapas.js';
import { cancelarReciboMaquila, pendientesPorRecibir, registrarReciboMaquila } from './recibos.js';
import { wipDeOrden } from './wip.js';
import { registrarEntregaCliente } from './entregas-cliente.js';
import { registrarMovimientoPt } from '../inventarios/movimientos-pt.js';

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

const sesion = (): ReturnType<typeof sesionDePrueba> =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM_TODOS });
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

/** Envía piezas al estampador. `prendaTerminada` decide si sale del almacén (V1-E4b). */
async function enviarAEstampado(
  cantidad: number,
  opciones: { prendaTerminada?: boolean; idAlmacenOrigen?: number } = {},
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

  it('con DOS almacenes marcados como tránsito, el envío NO adivina: falla y lo dice', async () => {
    await cliente.almacen.create({
      data: { nombre: 'Tránsito 2', tipo: 'PT', esTransitoProceso: true },
    });
    await cortar100();
    await meterAPt(almPrimeras, 10);

    await expect(
      enviarAEstampado(10, { prendaTerminada: true, idAlmacenOrigen: almPrimeras.id }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await existencia(almPrimeras)).toBe(10);
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
