/**
 * Tests de INTEGRACIÓN del CIERRE DE ORDEN CON UN MAQUILERO (V1, fila 0.109). Postgres efímero
 * (testcontainers). Cubre lo que la fila exige, y en el orden en que Daniel lo dijo:
 *
 *  (a) el pendiente BAJA A CERO al cerrar — mientras `faltante ≡ pendiente`, cobrarlo no bajaba nada;
 *  (b) el FALTANTE se cobra al PRECIO PACTADO del envío, como un DESCUENTO `capturado`
 *      («propone, no cobra»): no entra al saldo hasta que alguien lo revisa;
 *  (c) las INCOMPLETAS no se cobran: quedan fuera del faltante saldado;
 *  (d) varios maquileros vivos ⇒ un cierre y un descuento POR CADA UNO;
 *  (e) PERDONAR salda igual y no propone ningún movimiento de dinero;
 *  (f) DESHACER revierte (las piezas vuelven al pendiente) y cancela el descuento propuesto;
 *  (g) DESHACER se RECHAZA si el descuento ya se revisó (ese dinero ya movió el saldo);
 *  (h) cerrar sin faltante no crea un acto vacío;
 *  (i) tras cerrar YA NO SE PUEDE RECIBIR (el saldado consume saldo igual que lo devuelto);
 *  (j) sin `precioPactado` en el envío (histórico migrado) el cierre SALDA y lo dice con nombre,
 *      sin inventar un precio;
 *  (k) el SIGNO: al revisar el descuento, el saldo del maquilero BAJA (un cargo lo habría subido).
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
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { revisarMovimiento } from '../esma/movimientos.js';
import { saldoDeMaquilero } from '../esma/saldos.js';
import { estadoCuentaMaquilero } from '../esma/estado-cuenta.js';

import {
  cerrarOrdenMaquila,
  deshacerCierreMaquila,
  listarCierresDeOrden,
} from './cierre-maquila.js';
import { cancelarEtapaMovimiento, registrarCorte, registrarEnvioMaquila } from './etapas.js';
import { pendientesPorRecibir, registrarReciboMaquila } from './recibos.js';
import { consultarExistenciaMaquilero, wipDeOrden } from './wip.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor;
let maquileroA: Proveedor;
let maquileroB: Proveedor;
let procesoCostura: TipoProceso;
let almPrimeras: Almacen;
let idOrden: number;
let clienteNegocioId: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.cancelar',
  'produccion.wip-ver',
  'ordenes.ver-precio-real-maquila',
  'esma.ver-pagos',
  'esma.modificar',
  // Autorizar una partida capturada es `esma.revisar` desde la fila 0.128 (capturar y validar
  // dejaron de ser el mismo permiso). Estas pruebas revisan como paso de arreglo, así que lo llevan.
  'esma.revisar',
  'consultas.ver-importes',
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
    data: {
      modalidadFacturacion: 'solo_sin',
      nombre,
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
}

/** Crea una orden con matriz: Rojo (CH 100, M 20). Devuelve su id. */
async function crearOrdenConMatriz(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 120, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 77n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 100 },
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

/** Tipos de movimiento que usa el recibo de costura (entrada + su inverso). */
async function sembrarTiposMovimiento(): Promise<void> {
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
    ],
  });
}

/** Corta Rojo CH 100 + M 20 (todo lo pedido). */
async function cortarBase(): Promise<void> {
  await registrarCorte(
    sesion(),
    {
      idOrden,
      idCortador: cortador.id,
      fecha: '2026-09-01',
      lineas: [
        {
          idColor: colorRojo.id,
          tallas: [
            { idTalla: tallaCH.id, cantidad: 100 },
            { idTalla: tallaM.id, cantidad: 20 },
          ],
        },
      ],
    },
    bd(),
  );
}

/** Envía `cantidadCH` piezas de Rojo/CH al maquilero dado, con (o sin) precio pactado. */
async function enviar(
  maquilero: Proveedor,
  cantidadCH: number,
  precioPactado: number | null = 8,
): Promise<number> {
  const envio = await registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquilero.id,
      fecha: '2026-09-02',
      ...(precioPactado === null ? {} : { precioPactado }),
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: cantidadCH }] }],
    },
    bd(),
  );
  return envio.id;
}

/** Recibe del maquilero: `buenas` piezas buenas y `incompletas` prendas incompletas, de Rojo/CH. */
async function recibir(maquilero: Proveedor, buenas: number, incompletas = 0): Promise<void> {
  await registrarReciboMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: procesoCostura.id,
      idMaquilero: maquilero.id,
      fecha: '2026-09-03',
      ...(buenas > 0 ? { idAlmacenPrimeras: almPrimeras.id } : {}),
      lineas: [
        {
          idColor: colorRojo.id,
          tallas: [
            {
              idTalla: tallaCH.id,
              cantidad: buenas,
              ...(incompletas > 0 ? { cantidadIncompletas: incompletas } : {}),
            },
          ],
        },
      ],
    },
    bd(),
  );
}

/** El pendiente de un maquilero en el proceso de costura, tal como lo ofrece la pantalla. */
async function pendienteDe(maquilero: Proveedor): Promise<number> {
  const pendientes = await pendientesPorRecibir(sesion(), idOrden, bd());
  const proceso = pendientes.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
  return proceso?.porMaquilero.find((m) => m.idMaquilero === maquilero.id)?.totalPendiente ?? 0;
}

/** Cierra con el maquilero cobrando el faltante. */
async function cerrarCobrando(maquilero: Proveedor, motivo?: string) {
  return cerrarOrdenMaquila(
    sesion(),
    idOrden,
    {
      idMaquilero: maquilero.id,
      idTipoProceso: procesoCostura.id,
      fecha: '2026-09-04',
      desenlace: 'cobrado',
      ...(motivo === undefined ? {} : { motivo }),
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  cortador = await crearProveedorConRol('Corte SA', 'corte');
  maquileroA = await crearProveedorConRol('Maquila Uno SA', 'maquila-costura');
  maquileroB = await crearProveedorConRol('Maquila Dos SA', 'maquila-costura');
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  await sembrarTiposMovimiento();
  idOrden = await crearOrdenConMatriz();
});

describe('Cerrar la orden con el maquilero: el faltante se salda y se PROPONE cobrar', () => {
  it('(a)(b) de 1000 entrego 995: el pendiente baja a 0 y nace un DESCUENTO capturado por 5 × precio', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    expect(await pendienteDe(maquileroA)).toBe(5);

    const cierre = await cerrarCobrando(maquileroA);

    expect(cierre.piezasFaltantes).toBe(5);
    expect(cierre.precioFaltante).toBe(8);
    expect(cierre.importe).toBe(40);
    expect(cierre.desenlace).toBe('cobrado');
    expect(cierre.idDescuento).not.toBeNull();
    expect(cierre.descuentoRevisado).toBe(false);
    // ⭐ LO QUE LA FILA VINO A ARREGLAR: el pendiente deja de crecer para siempre.
    expect(await pendienteDe(maquileroA)).toBe(0);

    const descuento = await cliente.descuentoMaquilero.findFirstOrThrow({
      where: { idCierreMaquila: cierre.id },
    });
    expect(descuento.monto.toNumber()).toBe(40);
    expect(descuento.idMaquilero).toBe(maquileroA.id);
    // «PROPONE, no cobra»: nace capturado, que es lo que NO cuenta al saldo.
    expect(descuento.estadoRevision).toBe('capturado');
    expect(descuento.observaciones).toContain('#77');
    expect(descuento.observaciones).toContain('Faltante');
  });

  it('(a) la orden deja de aparecer como pendiente en el WIP y en existencias del maquilero', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);

    const antes = await wipDeOrden(sesion(), idOrden, bd());
    expect(antes.pendientePorRecibir).toBe(5);
    const existenciasAntes = await consultarExistenciaMaquilero(sesion(), {}, bd());
    expect(existenciasAntes.totalEnPoder).toBe(5);

    await cerrarCobrando(maquileroA);

    const despues = await wipDeOrden(sesion(), idOrden, bd());
    expect(despues.pendientePorRecibir).toBe(0);
    expect(despues.faltantesSaldados).toBe(5);
    // La trazabilidad de las cuatro cubetas sigue cerrando: enviado = buenas + incompletas + faltantes.
    expect(despues.enviado).toBe(
      despues.recibido + despues.incompletas + despues.faltantesSaldados,
    );

    const existenciasDespues = await consultarExistenciaMaquilero(sesion(), {}, bd());
    expect(existenciasDespues.totalEnPoder).toBe(0);
    expect(existenciasDespues.filas).toHaveLength(0);
  });

  it('(c) las INCOMPLETAS no se cobran: sólo se salda —y se cobra— lo que nunca volvió', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    // 95 buenas + 3 incompletas (volvieron, no se cobran) + 2 faltantes (no volvieron, se cobran).
    await recibir(maquileroA, 95, 3);
    expect(await pendienteDe(maquileroA)).toBe(2);

    const cierre = await cerrarCobrando(maquileroA);

    expect(cierre.piezasFaltantes).toBe(2);
    expect(cierre.importe).toBe(16);
    const wip = await wipDeOrden(sesion(), idOrden, bd());
    expect(wip.incompletas).toBe(3);
    expect(wip.faltantesSaldados).toBe(2);
  });

  it('(d) con DOS maquileros vivos se cierra con cada uno, y cada uno tiene SU descuento', async () => {
    await cortarBase();
    await enviar(maquileroA, 60);
    await enviar(maquileroB, 40);
    await recibir(maquileroA, 55);
    await recibir(maquileroB, 38);

    const cierreA = await cerrarCobrando(maquileroA);
    const cierreB = await cerrarCobrando(maquileroB);

    expect(cierreA.piezasFaltantes).toBe(5);
    expect(cierreB.piezasFaltantes).toBe(2);
    expect(cierreA.idDescuento).not.toBe(cierreB.idDescuento);

    const descuentos = await cliente.descuentoMaquilero.findMany({
      where: { idEmpresa: empresa.id },
      orderBy: { id: 'asc' },
    });
    expect(descuentos).toHaveLength(2);
    expect(descuentos.map((d) => d.idMaquilero).sort()).toEqual(
      [maquileroA.id, maquileroB.id].sort(),
    );
    expect(descuentos.map((d) => d.monto.toNumber()).sort((x, y) => x - y)).toEqual([16, 40]);

    expect(await pendienteDe(maquileroA)).toBe(0);
    expect(await pendienteDe(maquileroB)).toBe(0);
  });

  it('(e) PERDONAR salda igual pero no propone ningún movimiento de dinero', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);

    const cierre = await cerrarOrdenMaquila(
      sesion(),
      idOrden,
      {
        idMaquilero: maquileroA.id,
        idTipoProceso: procesoCostura.id,
        fecha: '2026-09-04',
        desenlace: 'perdonado',
        motivo: 'Se le perdona por el retraso de la tela',
      },
      bd(),
    );

    expect(cierre.desenlace).toBe('perdonado');
    expect(cierre.piezasFaltantes).toBe(5);
    expect(cierre.idDescuento).toBeNull();
    expect(cierre.precioFaltante).toBeNull();
    expect(await pendienteDe(maquileroA)).toBe(0);
    expect(await cliente.descuentoMaquilero.count()).toBe(0);
  });

  it('(e) PERDONAR sin motivo se rechaza: perdonar dinero sin decir por qué no se audita', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);

    await expect(
      cerrarOrdenMaquila(
        sesion(),
        idOrden,
        {
          idMaquilero: maquileroA.id,
          idTipoProceso: procesoCostura.id,
          fecha: '2026-09-04',
          desenlace: 'perdonado',
        },
        bd(),
      ),
    ).rejects.toThrow();
  });

  it('(h) cerrar a quien no debe nada NO crea un acto vacío', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 100);

    await expect(cerrarCobrando(maquileroA)).rejects.toBeInstanceOf(ErrorConflicto);
    expect(await cliente.cierreMaquilaOrden.count()).toBe(0);
  });

  it('(i) tras cerrar YA NO se puede recibir: primero hay que deshacer el cierre', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    await cerrarCobrando(maquileroA);

    // Las 5 ya se saldaron: recibirlas ahora las contaría dos veces.
    await expect(recibir(maquileroA, 5)).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('(j) sin precio pactado en el envío, SALDA igual y lo dice con nombre (no inventa un precio)', async () => {
    await cortarBase();
    await enviar(maquileroA, 100, null);
    await recibir(maquileroA, 95);

    const cierre = await cerrarCobrando(maquileroA);

    expect(cierre.piezasFaltantes).toBe(5);
    expect(cierre.precioFaltante).toBeNull();
    expect(cierre.importe).toBeNull();
    expect(cierre.idDescuento).toBeNull();
    expect(await pendienteDe(maquileroA)).toBe(0);
    expect(await cliente.descuentoMaquilero.count()).toBe(0);
  });

  it('(b) ANTES de cerrar, el pendiente ya publica lo que se propondría cobrar (lo lee el diálogo)', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);

    // La confirmación del botón lee el pendiente del PANEL DE AVANCE (`wipDeOrden`), no otro
    // endpoint: los tres números que enseña (piezas, precio, importe) salen de aquí, derivados en
    // el servidor. Redactarlos «siempre por si acaso» dejaba el diálogo en blanco.
    const wip = await wipDeOrden(sesion(), idOrden, bd());
    const enWip = wip.porRecibir
      .find((p) => p.idTipoProceso === procesoCostura.id)
      ?.porMaquilero.find((m) => m.idMaquilero === maquileroA.id);
    expect(enWip?.totalPendiente).toBe(5);
    expect(enWip?.precioFaltante).toBe(8);
    expect(enWip?.importeFaltantePropuesto).toBe(40);

    // Y la otra pantalla de recibo dice EXACTAMENTE lo mismo (comparten el helper del dominio).
    const pendientes = await pendientesPorRecibir(sesion(), idOrden, bd());
    const enPendientes = pendientes.porRecibir
      .find((p) => p.idTipoProceso === procesoCostura.id)
      ?.porMaquilero.find((m) => m.idMaquilero === maquileroA.id);
    expect(enPendientes?.importeFaltantePropuesto).toBe(40);

    // Sin el permiso de precios, los dos números van en blanco y el de piezas NO.
    const sinPrecios = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['produccion.wip-ver'],
    });
    const wipSinPrecios = await wipDeOrden(sinPrecios, idOrden, bd());
    const redactado = wipSinPrecios.porRecibir
      .find((p) => p.idTipoProceso === procesoCostura.id)
      ?.porMaquilero.find((m) => m.idMaquilero === maquileroA.id);
    expect(redactado?.totalPendiente).toBe(5);
    expect(redactado?.precioFaltante).toBeNull();
    expect(redactado?.importeFaltantePropuesto).toBeNull();
  });

  it('(a) el pendiente saldado también desaparece del desglose por maquilero del WIP', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    await cerrarCobrando(maquileroA);

    const wip = await wipDeOrden(sesion(), idOrden, bd());
    const proceso = wip.porRecibir.find((p) => p.idTipoProceso === procesoCostura.id);
    const delMaquilero = proceso?.porMaquilero.find((m) => m.idMaquilero === maquileroA.id);
    // Sigue apareciendo —su historia es parte de la trazabilidad— pero YA NO DEBE NADA.
    expect(delMaquilero?.totalPendiente).toBe(0);
    expect(delMaquilero?.faltantesSaldados).toBe(5);
    expect(delMaquilero?.celdas).toHaveLength(0);
    expect(proceso?.totalPendiente).toBe(0);
  });

  it('(b) el precio va REDACTADO para quien no puede ver precios reales de maquila', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    await cerrarCobrando(maquileroA);

    const sinPrecios = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['produccion.wip-ver'],
    });
    const lista = await listarCierresDeOrden(sinPrecios, idOrden, bd());
    expect(lista.filas[0]?.piezasFaltantes).toBe(5);
    expect(lista.filas[0]?.precioFaltante).toBeNull();
    expect(lista.filas[0]?.importe).toBeNull();
  });
});

describe('Deshacer el cierre: acto inverso auditado (D3)', () => {
  it('(f) devuelve las piezas al pendiente y CANCELA el descuento propuesto', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const cierre = await cerrarCobrando(maquileroA);

    const deshecho = await deshacerCierreMaquila(
      sesion(),
      cierre.id,
      { motivo: 'El maquilero sí las trajo' },
      bd(),
    );

    expect(deshecho.deshecho).toBe(true);
    expect(deshecho.motivoDeshacer).toBe('El maquilero sí las trajo');
    expect(deshecho.idDescuento).toBeNull(); // el descuento cancelado ya no es dinero vivo
    expect(await pendienteDe(maquileroA)).toBe(5);

    // D3: el registro NO se borró — quedó cancelado, con su motivo.
    const descuento = await cliente.descuentoMaquilero.findFirstOrThrow({
      where: { idCierreMaquila: cierre.id },
    });
    expect(descuento.canceladoEn).not.toBeNull();
    expect(descuento.motivoCancelacion).toBe('El maquilero sí las trajo');
    // Y el cierre tampoco: sigue ahí, deshecho.
    expect(await cliente.cierreMaquilaOrden.count()).toBe(1);
    expect(await cliente.cierreMaquilaOrdenDet.count()).toBe(1);
  });

  it('(f) deshecho el cierre, las piezas se pueden recibir otra vez', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const cierre = await cerrarCobrando(maquileroA);
    await deshacerCierreMaquila(sesion(), cierre.id, { motivo: 'Aparecieron' }, bd());

    await recibir(maquileroA, 5);
    expect(await pendienteDe(maquileroA)).toBe(0);
  });

  it('(f) un cierre deshecho no se vuelve a deshacer', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const cierre = await cerrarCobrando(maquileroA);
    await deshacerCierreMaquila(sesion(), cierre.id, { motivo: 'Aparecieron' }, bd());

    await expect(
      deshacerCierreMaquila(sesion(), cierre.id, { motivo: 'Otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('(g) 🔴 se RECHAZA si el descuento YA se revisó: ese importe ya está en el saldo', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const cierre = await cerrarCobrando(maquileroA);

    await revisarMovimiento(sesion(), 'descuento', cierre.idDescuento as number, bd());

    await expect(
      deshacerCierreMaquila(sesion(), cierre.id, { motivo: 'Ya no' }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Nada se movió: ni el cierre ni el descuento.
    const vivo = await cliente.cierreMaquilaOrden.findFirstOrThrow({ where: { id: cierre.id } });
    expect(vivo.deshechoEn).toBeNull();
    expect(await pendienteDe(maquileroA)).toBe(0);
  });
});

describe('El SIGNO del cobro: al maquilero se le DESCUENTA, no se le carga', () => {
  it('(k) el descuento propuesto no mueve el saldo; al revisarlo, el saldo BAJA', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);

    const saldoAntes = await saldoDeMaquilero(sesion(), maquileroA.id, {}, bd());
    const cierre = await cerrarCobrando(maquileroA);

    // «Propone, no cobra»: capturado ⇒ el saldo NO se mueve, pero se ve como pendiente de revisión.
    const saldoPropuesto = await saldoDeMaquilero(sesion(), maquileroA.id, {}, bd());
    expect(saldoPropuesto.saldo).toBe(saldoAntes.saldo);
    // ⭐ DOS partidas, no una (V1, fila 0.111). La que mide esta prueba es el DESCUENTO capturado;
    // la otra es el CARGO `propuesto` que `recibir()` dejó al registrar el recibo de maquila, y que
    // desde la 0.111 también cuenta como algo esperando la decisión de Daniel. Antes existía igual
    // —el recibo estaba ahí— pero no lo contaba nadie: ése era justo el hueco de la fila.
    expect(saldoPropuesto.pendienteRevision.partidas).toBe(2);
    expect(saldoPropuesto.pendienteRevision.cargosPartidas).toBe(1);
    expect(saldoPropuesto.pendienteRevision.descuentos).toBe(40);

    // Y al revisarlo: BAJA 40. Un CARGO habría SUBIDO 40 — le habríamos pagado las prendas que no
    // devolvió, además de dejárselas. Ésa es la prueba del signo.
    await revisarMovimiento(sesion(), 'descuento', cierre.idDescuento as number, bd());
    const saldoRevisado = await saldoDeMaquilero(sesion(), maquileroA.id, {}, bd());
    expect(saldoRevisado.saldo).toBe((saldoAntes.saldo ?? 0) - 40);
    // El descuento salió del pendiente (se revisó); queda el cargo del recibo, que sigue sin validar.
    expect(saldoRevisado.pendienteRevision.partidas).toBe(1);
    expect(saldoRevisado.pendienteRevision.descuentos).toBe(0);
    expect(saldoRevisado.pendienteRevision.cargosPartidas).toBe(1);
  });

  it('(k) el estado de cuenta lo enseña con su OP y la palabra «faltante»; deshecho, desaparece', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const cierre = await cerrarCobrando(maquileroA);

    const cuenta = await estadoCuentaMaquilero(sesion(), maquileroA.id, {}, bd());
    const renglon = cuenta.movimientos.find((m) => m.concepto === 'descuento');
    expect(renglon).toBeDefined();
    expect(renglon?.referencia).toContain('Faltante');
    expect(renglon?.referencia).toContain('#77');
    expect(renglon?.pendienteRevision).toBe(true);
    expect(renglon?.monto).toBe(-40);

    await deshacerCierreMaquila(sesion(), cierre.id, { motivo: 'Aparecieron' }, bd());
    const cuentaDespues = await estadoCuentaMaquilero(sesion(), maquileroA.id, {}, bd());
    expect(cuentaDespues.movimientos.some((m) => m.concepto === 'descuento')).toBe(false);
    const saldoFinal = await saldoDeMaquilero(sesion(), maquileroA.id, {}, bd());
    // ⭐ Queda UNA partida, no cero (V1, fila 0.111): deshacer el cierre borra el DESCUENTO, no el
    // RECIBO —el maquilero entregó esas 95 prendas y hay que pagárselas—, y su cargo `propuesto`
    // sigue esperando validación. Lo que esta prueba mide es que el descuento desapareció, y eso se
    // asevera arriba por concepto; el conteo se ajusta para no fingir que no hay nada pendiente.
    expect(saldoFinal.pendienteRevision.partidas).toBe(1);
    expect(saldoFinal.pendienteRevision.cargosPartidas).toBe(1);
    expect(saldoFinal.pendienteRevision.descuentos).toBe(0);
  });
});

describe('B1 · lo que el diálogo enseña es lo que el servidor escribe (celdas negativas)', () => {
  it('⭐ con +5 en una talla y −5 en otra, el saldable son 5 y el botón SÍ se ofrece', async () => {
    // El histórico migrado deja recibos capturados en la talla equivocada: +5 en CH y −5 en M. La
    // suma PLANA (`totalPendiente`) da 0 ⇒ el botón no aparecería y esa orden nunca se cerraría.
    await cortarBase();
    await enviar(maquileroA, 100); // sólo CH
    await recibir(maquileroA, 95); // CH: quedan 5
    // Un recibo de M sin envío de M: imposible por el API (el tope lo rechaza), así que se fabrica
    // el renglón directo, que es exactamente como llega del ETL de Access.
    const recibo = await cliente.etapaMovimiento.findFirstOrThrow({
      where: { idOrden, tipo: 'recibo_maquila' },
    });
    await cliente.etapaMovimientoDet.create({
      data: { idEtapaMov: recibo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 5 },
    });

    const wip = await wipDeOrden(sesion(), idOrden, bd());
    const enWip = wip.porRecibir
      .find((p) => p.idTipoProceso === procesoCostura.id)
      ?.porMaquilero.find((m) => m.idMaquilero === maquileroA.id);
    expect(enWip?.totalPendiente).toBe(0); // la suma plana miente
    expect(enWip?.faltantesSaldables).toBe(5); // lo que de verdad se puede saldar
    expect(enWip?.importeFaltantePropuesto).toBe(40); // 5 × 8, NO 0 × 8

    // Y el servidor escribe EXACTAMENTE ese número.
    const cierre = await cerrarCobrando(maquileroA);
    expect(cierre.piezasFaltantes).toBe(5);
    expect(cierre.importe).toBe(40);
    const descuento = await cliente.descuentoMaquilero.findFirstOrThrow({
      where: { idCierreMaquila: cierre.id },
    });
    expect(descuento.monto.toNumber()).toBe(40);
  });

  it('⭐ con +5 y −3, lo saldable son 5 (la suma plana diría 2 y el cobro saldría por 5)', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const recibo = await cliente.etapaMovimiento.findFirstOrThrow({
      where: { idOrden, tipo: 'recibo_maquila' },
    });
    await cliente.etapaMovimientoDet.create({
      data: { idEtapaMov: recibo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 3 },
    });

    const wip = await wipDeOrden(sesion(), idOrden, bd());
    const enWip = wip.porRecibir
      .find((p) => p.idTipoProceso === procesoCostura.id)
      ?.porMaquilero.find((m) => m.idMaquilero === maquileroA.id);
    expect(enWip?.totalPendiente).toBe(2);
    expect(enWip?.faltantesSaldables).toBe(5);
    expect(enWip?.importeFaltantePropuesto).toBe(40);

    const cierre = await cerrarCobrando(maquileroA);
    expect(cierre.piezasFaltantes).toBe(5);
  });
});

describe('B2 · el ENVÍO también sostiene los cierres', () => {
  it('🔴 no se puede cancelar el envío de una orden ya CERRADA con ese maquilero', async () => {
    await cortarBase();
    const idEnvio = await enviar(maquileroA, 100);
    // Sin NINGÚN recibo: el guard viejo (que sólo mira recibos vivos) dejaba pasar la cancelación.
    const cierre = await cerrarCobrando(maquileroA);
    expect(cierre.piezasFaltantes).toBe(100);

    await expect(
      cancelarEtapaMovimiento(sesion(), idEnvio, { motivo: 'me equivoqué' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Y nada se movió: el pendiente sigue en 0 (no en −100) y el envío sigue vivo.
    const wip = await wipDeOrden(sesion(), idOrden, bd());
    expect(wip.pendientePorRecibir).toBe(0);
    expect(wip.enviado).toBe(100);
    expect(wip.faltantesSaldados).toBe(100);
    const envio = await cliente.etapaMovimiento.findFirstOrThrow({ where: { id: idEnvio } });
    expect(envio.canceladoEn).toBeNull();
  });

  it('deshecho el cierre, ese mismo envío ya se puede cancelar', async () => {
    await cortarBase();
    const idEnvio = await enviar(maquileroA, 100);
    const cierre = await cerrarCobrando(maquileroA);
    await deshacerCierreMaquila(sesion(), cierre.id, { motivo: 'Aparecieron' }, bd());

    await cancelarEtapaMovimiento(sesion(), idEnvio, { motivo: 'me equivoqué' }, bd());
    const envio = await cliente.etapaMovimiento.findFirstOrThrow({ where: { id: idEnvio } });
    expect(envio.canceladoEn).not.toBeNull();
  });

  it('el cierre de OTRO maquilero no bloquea la cancelación del envío de éste', async () => {
    await cortarBase();
    await enviar(maquileroA, 60);
    const idEnvioB = await enviar(maquileroB, 40);
    await cerrarCobrando(maquileroA); // se cierra con A, no con B

    await cancelarEtapaMovimiento(sesion(), idEnvioB, { motivo: 'B no lo recibió' }, bd());
    const envioB = await cliente.etapaMovimiento.findFirstOrThrow({ where: { id: idEnvioB } });
    expect(envioB.canceladoEn).not.toBeNull();
  });
});

describe('B3 · el descuento cancelado no se puede revisar, y el revisado no se puede cancelar', () => {
  it('🔴 revisar un descuento YA CANCELADO por un deshacer se rechaza (no queda fantasma)', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const cierre = await cerrarCobrando(maquileroA);
    const idDescuento = cierre.idDescuento as number;
    await deshacerCierreMaquila(sesion(), cierre.id, { motivo: 'Aparecieron' }, bd());

    await expect(
      revisarMovimiento(sesion(), 'descuento', idDescuento, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    // Sigue cancelado y CAPTURADO: nadie fabricó un «cancelado + revisado» que ninguna suma sabe leer.
    const descuento = await cliente.descuentoMaquilero.findFirstOrThrow({
      where: { id: idDescuento },
    });
    expect(descuento.canceladoEn).not.toBeNull();
    expect(descuento.estadoRevision).toBe('capturado');
  });

  it('revisar dos veces el mismo descuento se rechaza (idempotencia dura)', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const cierre = await cerrarCobrando(maquileroA);
    const idDescuento = cierre.idDescuento as number;

    await revisarMovimiento(sesion(), 'descuento', idDescuento, bd());
    await expect(
      revisarMovimiento(sesion(), 'descuento', idDescuento, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('R2 · RBAC deny-by-default de las tres operaciones nuevas', () => {
  it('sin `produccion.recibo` no se puede CERRAR', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const sin = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['produccion.wip-ver'] });
    await expect(
      cerrarOrdenMaquila(
        sin,
        idOrden,
        {
          idMaquilero: maquileroA.id,
          idTipoProceso: procesoCostura.id,
          fecha: '2026-09-04',
          desenlace: 'cobrado',
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(await cliente.cierreMaquilaOrden.count()).toBe(0);
  });

  it('sin `produccion.cancelar` no se puede DESHACER', async () => {
    await cortarBase();
    await enviar(maquileroA, 100);
    await recibir(maquileroA, 95);
    const cierre = await cerrarCobrando(maquileroA);
    const sin = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['produccion.recibo', 'produccion.wip-ver'],
    });
    await expect(
      deshacerCierreMaquila(sin, cierre.id, { motivo: 'no debería' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    const vivo = await cliente.cierreMaquilaOrden.findFirstOrThrow({ where: { id: cierre.id } });
    expect(vivo.deshechoEn).toBeNull();
  });

  it('sin `produccion.wip-ver` no se pueden LISTAR los cierres', async () => {
    const sin = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['produccion.recibo'] });
    await expect(listarCierresDeOrden(sin, idOrden, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
