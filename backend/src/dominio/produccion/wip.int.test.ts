/**
 * Tests de INTEGRACIÓN del TABLERO WIP + existencias en poder del maquilero (F3-E5). Postgres
 * efímero (testcontainers). Arma una orden y la avanza con las operaciones REALES de F3 (corte →
 * envío → recibo) más una entrega capturada a mano (la captura de entrega es de la Pieza A; aquí se
 * inserta la etapa `entrega_cliente` directo para verificar que el WIP la LEE). Verifica:
 *  (a) los totales y pendientes derivados cuadran EXACTO en cada etapa (tablero + drill-down);
 *  (b) el drill-down baja a color×talla con el faltante real por celda;
 *  (c) enviado − recibido por maquilero cuadra (existencias en poder);
 *  (d) las etapas CANCELADAS no cuentan en ninguna suma;
 *  (e) `soloPendientes` filtra las órdenes 100% cerradas;
 *  (f) la consulta filtra por empresa activa (A9) y exige el permiso (A4).
 * Llama al DOMINIO directamente (no HTTP).
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
  TipoMovimientoInventario,
  TipoProceso,
} from '../../datos/index.js';
import { TipoEtapaMovimiento } from '../../datos/index.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { registrarCorte, registrarEnvioMaquila } from './etapas.js';
import { registrarReciboMaquila } from './recibos.js';
import { consultarExistenciaMaquilero, consultarWip, wipDeOrden } from './wip.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let colorAzul: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor;
let maquileroCostura: Proveedor;
let estampador: Proveedor;
let procesoCostura: TipoProceso;
let procesoEstampado: TipoProceso;
let almacenPrimeras: Almacen;
let almacenSegundas: Almacen;
let clienteNegocioId: number;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.cancelar',
  'produccion.wip-ver',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

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

/** Asegura un tipo de movimiento de inventario (para el kardex del recibo de costura). */
async function asegurarTipoMov(
  codigo: string,
  direccion: 'entrada' | 'salida' | 'traspaso',
): Promise<TipoMovimientoInventario> {
  return cliente.tipoMovimientoInventario.upsert({
    where: { codigo },
    update: {},
    create: { codigo, nombre: codigo, direccion },
  });
}

/** Crea una orden con matriz: Rojo (CH 10, M 20) + Azul (M 5) = 35. Devuelve su id. */
async function crearOrdenConMatriz(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 35, precio: 10 },
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
      fecha: new Date('2026-06-01T00:00:00.000Z'),
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
          { idColor: colorAzul.id, tallas: { create: [{ idTalla: tallaM.id, cantidad: 5 }] } },
        ],
      },
    },
  });
  return orden.id;
}

/**
 * Inserta una etapa `entrega_cliente` a mano (la captura de entrega la construye la Pieza A; el WIP
 * solo necesita LEERLA). Folio alto para no chocar con la secuencia de las otras etapas.
 */
async function capturarEntregaCliente(
  celdas: { idColor: number; idTalla: number; cantidad: number }[],
  folio: bigint,
): Promise<number> {
  const etapa = await cliente.etapaMovimiento.create({
    data: {
      folio,
      idEmpresa: empresa.id,
      idOrden,
      tipo: TipoEtapaMovimiento.entrega_cliente,
      fecha: new Date('2026-06-20T00:00:00.000Z'),
      detalles: { create: celdas },
    },
  });
  return etapa.id;
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  cortador = await crearProveedorConRol('Corte SA', 'corte');
  maquileroCostura = await crearProveedorConRol('Maquila Costura SA', 'maquila-costura');
  estampador = await crearProveedorConRol('Estampados SA', 'estampado');
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  procesoEstampado = await cliente.tipoProceso.create({
    data: { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  });
  almacenPrimeras = await cliente.almacen.create({
    data: { nombre: 'PT primeras', tipo: 'PT' },
  });
  almacenSegundas = await cliente.almacen.create({
    data: { nombre: 'PT segundas', tipo: 'PT' },
  });
  await asegurarTipoMov('entrada-maquila', 'entrada');
  await asegurarTipoMov('error-entrada', 'salida');
  idOrden = await crearOrdenConMatriz();
});

/** Corta Rojo CH 10 + M 20 (=30). */
async function cortar30(): Promise<void> {
  await registrarCorte(
    sesion(),
    {
      idOrden,
      idCortador: cortador.id,
      fecha: '2026-06-02',
      lineas: [
        {
          idColor: colorRojo.id,
          tallas: [
            { idTalla: tallaCH.id, cantidad: 10 },
            { idTalla: tallaM.id, cantidad: 20 },
          ],
        },
      ],
    },
    bd(),
  );
}

/** Envía a costura Rojo CH 10 + M 20 (=30). */
async function enviarCostura30(): Promise<number> {
  const envio = await registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquileroCostura.id,
      fecha: '2026-06-03',
      precioPactado: 12,
      lineas: [
        {
          idColor: colorRojo.id,
          tallas: [
            { idTalla: tallaCH.id, cantidad: 10 },
            { idTalla: tallaM.id, cantidad: 20 },
          ],
        },
      ],
    },
    bd(),
  );
  return envio.id;
}

describe('Tablero WIP (totales y pendientes derivados)', () => {
  it('una orden recién creada: pedido lleno, todo lo demás 0 y pendiente de cortar', async () => {
    const pagina = await consultarWip(sesion(), {}, bd());
    expect(pagina.total).toBe(1);
    const fila = pagina.datos[0];
    expect(fila?.idOrden).toBe(idOrden);
    expect(fila?.pedido).toBe(35);
    expect(fila?.cortado).toBe(0);
    expect(fila?.porCortar).toBe(35);
    expect(fila?.enviado).toBe(0);
    expect(fila?.recibido).toBe(0);
    expect(fila?.entregado).toBe(0);
  });

  it('avance corte→envío→recibo→entrega: cada total y pendiente cuadra EXACTO', async () => {
    await cortar30(); // cortado 30 (pedido 35 → porCortar 5)
    await enviarCostura30(); // enviado 30 (cortadoPorEnviar 0; porRecibir 30)
    // Recibe 25 de costura (10 CH + 15 M), todas primeras → entra a PT.
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-10',
        idAlmacenPrimeras: almacenPrimeras.id,
        idAlmacenSegundas: almacenSegundas.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10 },
              { idTalla: tallaM.id, cantidad: 15 },
            ],
          },
        ],
      },
      bd(),
    );
    // Entrega 20 al cliente (10 CH + 10 M).
    await capturarEntregaCliente(
      [
        { idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 10 },
        { idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 10 },
      ],
      1000n,
    );

    const pagina = await consultarWip(sesion(), {}, bd());
    const fila = pagina.datos.find((f) => f.idOrden === idOrden);
    expect(fila?.pedido).toBe(35);
    expect(fila?.cortado).toBe(30);
    expect(fila?.porCortar).toBe(5); // 35 − 30
    expect(fila?.enviado).toBe(30);
    expect(fila?.cortadoPorEnviar).toBe(0); // 30 − 30
    expect(fila?.recibido).toBe(25);
    expect(fila?.recibidoCostura).toBe(25);
    expect(fila?.porRecibir).toBe(5); // 30 − 25
    expect(fila?.entregado).toBe(20);
    expect(fila?.porEntregar).toBe(5); // recibidoCostura 25 − entregado 20
  });

  it('el drill-down baja a color×talla con el faltante real por celda', async () => {
    await cortar30(); // Rojo CH10/M20 (Azul M5 sin cortar)
    await enviarCostura30();

    const detalle = await wipDeOrden(sesion(), idOrden, bd());
    expect(detalle.idOrden).toBe(idOrden);
    expect(detalle.pedido).toBe(35);
    expect(detalle.cortado).toBe(30);

    // porCortar: Azul M5 falta (las Rojo van en 0 y se omiten del total negativo pero salen aquí).
    const azul = detalle.porCortar.find(
      (c) => c.idColor === colorAzul.id && c.idTalla === tallaM.id,
    );
    expect(azul?.cantidad).toBe(5);
    const rojoCh = detalle.porCortar.find(
      (c) => c.idColor === colorRojo.id && c.idTalla === tallaCH.id,
    );
    expect(rojoCh?.cantidad).toBe(0); // 10 pedido − 10 cortado

    // cortadoPorEnviar costura: 30 − 30 = 0 (sin celdas pendientes ≠ 0).
    const costuraEnviar = detalle.cortadoPorEnviar.find(
      (p) => p.idTipoProceso === procesoCostura.id,
    );
    expect(costuraEnviar?.totalPendiente).toBe(0);
    expect(costuraEnviar?.celdas).toHaveLength(0);

    // porRecibir costura: enviado 30 − recibido 0 = 30, por celda.
    const costuraRecibir = detalle.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    expect(costuraRecibir?.totalPendiente).toBe(30);
    const recCh = costuraRecibir?.celdas.find((c) => c.idTalla === tallaCH.id);
    expect(recCh?.cantidad).toBe(10);
    const recM = costuraRecibir?.celdas.find((c) => c.idTalla === tallaM.id);
    expect(recM?.cantidad).toBe(20);
  });

  it('costura y estampado: porRecibir es POR proceso (independientes)', async () => {
    await cortar30();
    await enviarCostura30(); // costura 30
    // Estampado del mismo cortado (flujos paralelos): CH 10.
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-03',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    const detalle = await wipDeOrden(sesion(), idOrden, bd());
    expect(detalle.porRecibir).toHaveLength(2);
    const costura = detalle.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    const estamp = detalle.porRecibir.find((p) => p.idTipoProceso === procesoEstampado.id);
    expect(costura?.totalPendiente).toBe(30);
    expect(costura?.generaEntradaPt).toBe(true);
    expect(estamp?.totalPendiente).toBe(10);
    expect(estamp?.generaEntradaPt).toBe(false);
    // El tablero suma todos los procesos: enviado total 40, recibido 0 → porRecibir 40.
    const pagina = await consultarWip(sesion(), {}, bd());
    const fila = pagina.datos.find((f) => f.idOrden === idOrden);
    expect(fila?.enviado).toBe(40);
    expect(fila?.porRecibir).toBe(40);
  });

  it('las etapas CANCELADAS no cuentan en ninguna suma', async () => {
    await cortar30();
    const idEnvio = await enviarCostura30();
    // Cancela el envío directamente (suave) y verifica que enviado vuelve a 0.
    await cliente.etapaMovimiento.update({
      where: { id: idEnvio },
      data: { canceladoEn: new Date(), motivoCancelacion: 'prueba' },
    });
    const fila = (await consultarWip(sesion(), {}, bd())).datos.find((f) => f.idOrden === idOrden);
    expect(fila?.cortado).toBe(30);
    expect(fila?.enviado).toBe(0); // el envío cancelado no cuenta
    expect(fila?.cortadoPorEnviar).toBe(30);

    const detalle = await wipDeOrden(sesion(), idOrden, bd());
    // Sin envíos vivos, no hay procesos en porRecibir.
    expect(detalle.porRecibir).toHaveLength(0);
  });

  it('soloPendientes filtra las órdenes 100% cerradas', async () => {
    // Segunda orden, totalmente cerrada (pedido = cortado = enviado = recibido(costura) = entregado).
    const ped2 = await cliente.pedido.create({
      data: { folio: 2n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
    });
    const lin2 = await cliente.pedidoLinea.create({
      data: { idPedido: ped2.id, idModelo: modelo.id, cantidadPedida: 5, precio: 10 },
    });
    const orden2 = await cliente.orden.create({
      data: {
        folio: 2n,
        idEmpresa: empresa.id,
        idPedidoLinea: lin2.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
        estado: 'completa',
        fecha: new Date('2026-06-01T00:00:00.000Z'),
        lineas: {
          create: [
            { idColor: colorAzul.id, tallas: { create: [{ idTalla: tallaM.id, cantidad: 5 }] } },
          ],
        },
      },
    });
    // Avanza la orden 2 a cerrada por completo.
    const corte2 = await registrarCorte(
      sesion(),
      {
        idOrden: orden2.id,
        idCortador: cortador.id,
        fecha: '2026-06-02',
        lineas: [{ idColor: colorAzul.id, tallas: [{ idTalla: tallaM.id, cantidad: 5 }] }],
      },
      bd(),
    );
    expect(corte2.totalPiezas).toBe(5);
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden: orden2.id,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-03',
        lineas: [{ idColor: colorAzul.id, tallas: [{ idTalla: tallaM.id, cantidad: 5 }] }],
      },
      bd(),
    );
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden: orden2.id,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-10',
        idAlmacenPrimeras: almacenPrimeras.id,
        lineas: [{ idColor: colorAzul.id, tallas: [{ idTalla: tallaM.id, cantidad: 5 }] }],
      },
      bd(),
    );
    await cliente.etapaMovimiento.create({
      data: {
        folio: 2000n,
        idEmpresa: empresa.id,
        idOrden: orden2.id,
        tipo: TipoEtapaMovimiento.entrega_cliente,
        fecha: new Date('2026-06-20T00:00:00.000Z'),
        detalles: { create: [{ idColor: colorAzul.id, idTalla: tallaM.id, cantidad: 5 }] },
      },
    });

    // Sin filtro: las dos órdenes salen.
    expect((await consultarWip(sesion(), {}, bd())).total).toBe(2);
    // Con soloPendientes: solo la orden 1 (la 2 está cerrada).
    const conPendiente = await consultarWip(sesion(), { soloPendientes: true }, bd());
    expect(conPendiente.total).toBe(1);
    expect(conPendiente.datos[0]?.idOrden).toBe(idOrden);
  });
});

describe('Existencias en poder del maquilero (enviado − recibido)', () => {
  it('cuadra enviado − recibido por maquilero × proceso × orden, omitiendo el saldo 0', async () => {
    await cortar30();
    await enviarCostura30(); // costura: 30 en poder del maquilero de costura
    // Recibe 25 → en poder 5.
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-10',
        idAlmacenPrimeras: almacenPrimeras.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10 },
              { idTalla: tallaM.id, cantidad: 15 },
            ],
          },
        ],
      },
      bd(),
    );

    const lista = await consultarExistenciaMaquilero(sesion(), {}, bd());
    expect(lista.filas).toHaveLength(1);
    const fila = lista.filas[0];
    expect(fila?.idMaquilero).toBe(maquileroCostura.id);
    expect(fila?.idTipoProceso).toBe(procesoCostura.id);
    expect(fila?.idOrden).toBe(idOrden);
    expect(fila?.enviado).toBe(30);
    expect(fila?.recibido).toBe(25);
    expect(fila?.enPoder).toBe(5);
    expect(lista.totalEnPoder).toBe(5);
  });

  it('un maquilero que ya devolvió todo NO aparece (saldo 0)', async () => {
    await cortar30();
    await enviarCostura30();
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-10',
        idAlmacenPrimeras: almacenPrimeras.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10 },
              { idTalla: tallaM.id, cantidad: 20 },
            ],
          },
        ],
      },
      bd(),
    );
    const lista = await consultarExistenciaMaquilero(sesion(), {}, bd());
    expect(lista.filas).toHaveLength(0);
    expect(lista.totalEnPoder).toBe(0);
  });

  it('filtra por maquilero', async () => {
    await cortar30();
    await enviarCostura30();
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-03',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const soloEstampador = await consultarExistenciaMaquilero(
      sesion(),
      { idMaquilero: estampador.id },
      bd(),
    );
    expect(soloEstampador.filas).toHaveLength(1);
    expect(soloEstampador.filas[0]?.idMaquilero).toBe(estampador.id);
    expect(soloEstampador.filas[0]?.enPoder).toBe(10);
  });
});

describe('Aislamiento por empresa (A9) y permisos (A4)', () => {
  it('una orden de otra empresa no existe en el drill-down → 404', async () => {
    await expect(wipDeOrden(sesion(), 999_999, bd())).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('el tablero solo trae órdenes de la empresa activa', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM_TODOS });
    const pagina = await consultarWip(sesionOtra, {}, bd());
    expect(pagina.total).toBe(0);
  });

  it('sin produccion.wip-ver, todas las consultas se rechazan', async () => {
    await expect(consultarWip(sesion([]), {}, bd())).rejects.toBeInstanceOf(Error);
    await expect(wipDeOrden(sesion([]), idOrden, bd())).rejects.toBeInstanceOf(Error);
    await expect(consultarExistenciaMaquilero(sesion([]), {}, bd())).rejects.toBeInstanceOf(Error);
  });
});
