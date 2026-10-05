/**
 * ⭐⭐ FILA 0.252 — LA FACTURA DEL MAQUILERO YA NO SE CUENTA COMO DEUDA DOS VECES (Postgres real).
 *
 * Daniel (5-oct-2026): la deuda con un maquilero nace en EsMa al validar el recibo; su CFDI es el
 * COMPROBANTE de esa deuda, no deuda nueva. Hasta la 0.252 el importador lo cargaba al motor de
 * terceros y el saldo salía al doble: recibo de $11,600 + su factura de $11,600 = $23,200.
 *
 * El escenario completo, de punta a punta, contra TODAS las sumas que leen el motor:
 *  (a) validado → 11,600; factura importada → **11,600** (no 23,200) en el saldo del tercero, su
 *      saldo fiscal, la bandeja de CxP, su resumen y el aging; la factura SÍ se lista;
 *  (b) pagado en EsMa → **0**, y sin días vencidos (el comprobante no envejece);
 *  (c) cancelar la factura → el saldo NO cambia (el inverso copia la marca);
 *  (d) nota de crédito del maquilero → tampoco resta (ni se come días vencidos);
 *  (e) reporte fiscal: la factura sigue LISTADA para el contador, y el saldo de salud fiscal no crece;
 *  (f) CONTROL: un proveedor que NO es de maquila no cambia en nada;
 *  (g) caso mixto (factura CON OC de un maquilero): sigue siendo deuda del motor — decisión 3 de
 *      Daniel, no se desarrolla nada para él;
 *  (h) la guarda: un cargo manual de CxP (entrada sin factura) a un maquilero se rechaza.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorValidacion } from '../../comun/errores.js';
import type { Cliente, Empresa, PrismaClient, Proveedor } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { construirCfdi } from '../../pruebas/cfdi-fixtures.js';

import {
  AVISO_AMPARA_ESMA,
  AVISO_PREVIO_AMPARA_ESMA,
  importarCfdi,
  previsualizarCfdi,
} from './cfdi/cfdi-proveedor.js';
import { MENSAJE_MAQUILA_SE_CAPTURA_EN_ESMA } from './ampara-esma.js';
import {
  calcularSaldoTercero,
  corregirMovimientoTercero,
  estadoDeCuentaTercero,
  registrarMovimientoTercero,
} from './cuenta-terceros.js';
import { bandejaPorPagar, cancelarMovimientoCxp, registrarMovimientoCxp } from './cxp/cxp.js';
import { diasVencidosPorProveedor } from './dias-vencidos.js';
import { reporteFiscal, saludFiscal } from './reportes/reportes-fiscales.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
/** Maquilero (rol de EsMa) con 8 días de crédito: su deuda vive en EsMa. */
let maquilero: Proveedor;
/** Proveedor de tela, SIN rol de maquila: el CONTROL. */
let telero: Proveedor;

const RFC_MAQUILERO = 'AAA010101AA1';
const RFC_TELERO = 'BBB010101BB1';

const PERM: ClavePermiso[] = [
  'cxp.ver',
  'cxp.administrar',
  'terceros.ver',
  'terceros.administrar',
  'terceros.fiscal',
  'consultas.ver-importes',
];
const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
const bd = () => ({ cliente });

/** Fake del motor de archivos: la importación sube el XML server-side; aquí no se toca R2. */
function archivosFalsos(): ServicioArchivos {
  return {
    solicitarSubida() {
      throw new Error('La importación de CFDI usa subirContenido.');
    },
    subirContenido(solicitud) {
      return Promise.resolve({
        bucket: 'control-v2-prueba',
        key: `${solicitud.carpeta ?? 'general'}/fake/${randomUUID()}/${solicitud.nombreOriginal}`,
        nombreOriginal: solicitud.nombreOriginal,
        tipoMime: solicitud.tipoMime,
        tamanoBytes: solicitud.contenido.byteLength,
      });
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    descargarContenido(key) {
      return Promise.resolve(Buffer.from(`contenido-falso:${key}`, 'utf8'));
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

/** Hace `dias` días, a medianoche UTC (la misma referencia que `CURRENT_DATE`). */
function haceDias(dias: number): Date {
  const hoy = new Date();
  const utc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return new Date(utc - dias * 86_400_000);
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa 0252');
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente Uno' } });
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'Maquila costura' },
  });
  // Un rol que NO es de EsMa: el telero tiene rol, sólo que no de maquila.
  const rolTela = await cliente.rolProveedor.upsert({
    where: { codigo: 'tela' },
    update: {},
    create: { codigo: 'tela', nombre: 'Tela' },
  });
  maquilero = await cliente.proveedor.create({
    data: {
      nombre: 'BORDA PRINT',
      rfc: RFC_MAQUILERO,
      modalidadFacturacion: 'ambos',
      diasCredito: 8,
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
  telero = await cliente.proveedor.create({
    data: {
      nombre: 'Telas del Norte SA',
      rfc: RFC_TELERO,
      modalidadFacturacion: 'ambos',
      diasCredito: 8,
      roles: { create: { idRolProveedor: rolTela.id } },
    },
  });
});

/** El recibo de maquila VALIDADO por $11,600 (con factura): ahí nace la deuda (EsMa). */
async function reciboValidado(importe = 11_600, hace = 20): Promise<void> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
  });
  const modelo = await cliente.modelo.create({ data: { codigo: 'MOD-1', descripcion: 'Modelo' } });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 10, precio: 100 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      estado: 'completa',
      fechaCompletada: new Date(),
    },
  });
  const tipoProceso = await cliente.tipoProceso.create({
    data: { codigo: 'costura-0252', nombre: 'Costura', generaEntradaPt: true },
  });
  await cliente.esMaCargo.create({
    data: {
      idEmpresa: empresa.id,
      idMaquilero: maquilero.id,
      idOrden: orden.id,
      idTipoProceso: tipoProceso.id,
      estado: 'validado',
      cantidadReal: 1,
      precioReal: importe,
      conFactura: true,
      creadoEn: haceDias(hace),
    },
  });
}

/** El pago de EsMa (lo que hace la corrida al maquilero), ya revisado. */
async function pagoEsMa(monto: number): Promise<void> {
  await cliente.pagoMaquilero.create({
    data: {
      idEmpresa: empresa.id,
      idMaquilero: maquilero.id,
      monto,
      fecha: haceDias(1),
      conFactura: true,
      estadoRevision: 'revisado',
    },
  });
}

/** Importa un CFDI (fake de R2). */
function importar(opciones: {
  idProveedor: number;
  rfc: string;
  total: string;
  tipo?: 'I' | 'E';
  refTipo?: 'orden-compra';
  refId?: number;
}) {
  return importarCfdi(
    sesion(),
    {
      xml: construirCfdi({
        uuid: randomUUID().toUpperCase(),
        emisorRfc: opciones.rfc,
        total: opciones.total,
        tipo: opciones.tipo ?? 'I',
      }),
      idProveedor: opciones.idProveedor,
      ...(opciones.refTipo === undefined ? {} : { refTipo: opciones.refTipo }),
      ...(opciones.refId === undefined ? {} : { refId: opciones.refId }),
    },
    bd(),
    archivosFalsos(),
  );
}

/** La fila de la bandeja de CxP de un proveedor (y el resumen), en el chip «todos». */
async function bandeja(idProveedor: number) {
  const b = await bandejaPorPagar(sesion(), { filtro: 'todos', porPagina: 100 }, bd());
  return { fila: b.filas.find((f) => f.idProveedor === idProveedor), resumen: b.resumen };
}

// ── (a)+(b) el escenario de Daniel ────────────────────────────────────────────────────────────────
describe('⭐ el escenario $11,600: validado → factura → pagado', () => {
  it('la factura del maquilero COMPRUEBA la deuda de EsMa: 11,600 y no 23,200, en todas las sumas', async () => {
    await reciboValidado();
    const antes = await calcularSaldoTercero(sesion(), 'proveedor', maquilero.id, bd());
    expect(antes.saldo).toBe(11_600);

    const res = await importar({
      idProveedor: maquilero.id,
      rfc: RFC_MAQUILERO,
      total: '11600.00',
    });
    expect(res.movimiento).toMatchObject({
      origen: 'factura_proveedor',
      esFiscal: true,
      amparaEsMa: true,
      monto: 11_600,
    });
    expect(res.avisos).toContain(AVISO_AMPARA_ESMA);

    // Saldo del tercero: operativo Y fiscal (el recibo es «con factura»).
    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', maquilero.id, bd());
    expect(saldo).toMatchObject({
      saldo: 11_600,
      saldoFiscal: 11_600,
      saldoMovimientos: 0,
      saldoEsMa: 11_600,
    });

    // El estado de cuenta SÍ lista la factura, marcada; el saldo de arriba es el mismo.
    const edc = await estadoDeCuentaTercero(sesion(), 'proveedor', maquilero.id, {}, bd());
    const renglon = edc.movimientos.find((m) => m.fuente === 'motor');
    expect(renglon).toMatchObject({ origen: 'factura_proveedor', amparaEsMa: true });
    expect(edc.movimientos.filter((m) => m.fuente === 'esma')).toHaveLength(1);
    expect(edc.saldo.saldo).toBe(11_600);

    // Bandeja de CxP (la misma cartera que lee la corrida) y su resumen: el aging del motor en
    // cero, la deuda en la cubeta de maquila. La factura es de julio con 8 días: si contara,
    // estaría en «más de 60».
    const { fila, resumen } = await bandeja(maquilero.id);
    expect(fila).toMatchObject({
      saldo: 11_600,
      corriente: 0,
      d1a30: 0,
      d31a60: 0,
      mas60: 0,
      maquila: 11_600,
      diasVencidos: 12,
    });
    expect(resumen).toMatchObject({ carteraTotal: 11_600, vencido: 0, maquilaTotal: 11_600 });
  });

  it('pagado en EsMa → saldo 0 y SIN días vencidos (el comprobante no envejece)', async () => {
    await reciboValidado();
    await importar({ idProveedor: maquilero.id, rfc: RFC_MAQUILERO, total: '11600.00' });
    await pagoEsMa(11_600);

    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', maquilero.id, bd());
    expect(saldo.saldo).toBe(0);
    expect(saldo.saldoFiscal).toBe(0);
    // Sin nada que envejecer, el proveedor NO aparece (null en la pantalla, no 0).
    const dias = await diasVencidosPorProveedor(cliente, empresa.id);
    expect(dias.has(maquilero.id)).toBe(false);
    const { fila, resumen } = await bandeja(maquilero.id);
    expect(fila?.saldo ?? 0).toBe(0);
    expect(resumen.carteraTotal).toBe(0);
  });
});

// ── (c) cancelación ─────────────────────────────────────────────────────────────────────────────
describe('cancelar la factura de un maquilero', () => {
  it('no mueve el saldo: el inverso COPIA la marca', async () => {
    await reciboValidado();
    const { movimiento } = await importar({
      idProveedor: maquilero.id,
      rfc: RFC_MAQUILERO,
      total: '11600.00',
    });

    const inverso = await cancelarMovimientoCxp(
      sesion(),
      movimiento.id,
      { motivo: 'Factura con error, el maquilero la sustituye' },
      bd(),
    );
    expect(inverso).toMatchObject({ amparaEsMa: true, monto: -11_600, esInverso: true });

    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', maquilero.id, bd());
    expect(saldo).toMatchObject({ saldo: 11_600, saldoFiscal: 11_600, saldoMovimientos: 0 });
    const { fila } = await bandeja(maquilero.id);
    expect(fila).toMatchObject({ saldo: 11_600, maquila: 11_600, diasVencidos: 12 });
  });
});

// ── (d) nota de crédito ─────────────────────────────────────────────────────────────────────────
describe('nota de crédito de un maquilero', () => {
  it('queda como comprobante: no resta del saldo ni se come los días vencidos', async () => {
    await reciboValidado();
    const nc = await importar({
      idProveedor: maquilero.id,
      rfc: RFC_MAQUILERO,
      total: '1000.00',
      tipo: 'E',
    });
    expect(nc.movimiento).toMatchObject({ origen: 'nota_credito', amparaEsMa: true, monto: -1000 });

    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', maquilero.id, bd());
    expect(saldo).toMatchObject({ saldo: 11_600, saldoFiscal: 11_600 });
    const { fila } = await bandeja(maquilero.id);
    expect(fila).toMatchObject({ saldo: 11_600, corriente: 0, diasVencidos: 12 });
  });

  it('el crédito de una NC comprobante NO se come el cargo de EsMa que sigue vivo', async () => {
    await reciboValidado(1000);
    await importar({ idProveedor: maquilero.id, rfc: RFC_MAQUILERO, total: '1000.00', tipo: 'E' });

    // Si la NC contara como crédito, se comería el único cargo y el maquilero «no debería nada».
    const dias = await diasVencidosPorProveedor(cliente, empresa.id);
    expect(dias.get(maquilero.id)).toBe(12);
  });
});

// ── (e) reporte fiscal ──────────────────────────────────────────────────────────────────────────
describe('reporte del contador y salud fiscal', () => {
  it('la factura sigue LISTADA para el contador, pero el saldo de salud fiscal no crece', async () => {
    await reciboValidado();
    const { movimiento } = await importar({
      idProveedor: maquilero.id,
      rfc: RFC_MAQUILERO,
      total: '11600.00',
    });

    const listado = await reporteFiscal(sesion(), {}, bd());
    expect(listado.filas.map((f) => f.id)).toContain(movimiento.id);
    expect(listado.totales.cargos).toBe(11_600);

    const salud = await saludFiscal(sesion(), {}, bd());
    // Es un CFDI vivo con su XML: cuenta en la conciliación…
    expect(salud).toMatchObject({ totalFiscales: 1, conCfdi: 1, conXml: 1 });
    // …pero no es deuda nueva: su saldo fiscal en el motor es 0 (la deuda vive en EsMa).
    const fila = salud.saldos.find((s) => s.idTercero === maquilero.id);
    expect(fila).toMatchObject({ saldoFiscal: 0, movimientos: 1 });
  });
});

// ── (f) control ─────────────────────────────────────────────────────────────────────────────────
describe('CONTROL: un proveedor que NO es de maquila', () => {
  it('su factura sin OC sigue siendo deuda del motor, en todas las sumas', async () => {
    const res = await importar({ idProveedor: telero.id, rfc: RFC_TELERO, total: '1060.00' });
    expect(res.movimiento.amparaEsMa).toBe(false);
    expect(res.avisos).not.toContain(AVISO_AMPARA_ESMA);

    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', telero.id, bd());
    expect(saldo).toMatchObject({ saldo: 1060, saldoFiscal: 1060, saldoMovimientos: 1060 });
    const { fila } = await bandeja(telero.id);
    expect(fila?.saldo).toBe(1060);
    expect(fila?.mas60).toBe(1060); // julio + 8 días: lleva más de 60 vencida
    const dias = await diasVencidosPorProveedor(cliente, empresa.id);
    expect(dias.get(telero.id)).toBeGreaterThan(60);
    const salud = await saludFiscal(sesion(), {}, bd());
    expect(salud.saldos.find((s) => s.idTercero === telero.id)?.saldoFiscal).toBe(1060);

    // Y su cargo manual (entrada sin factura) sigue entrando.
    const cargo = await registrarMovimientoCxp(
      sesion(),
      telero.id,
      { fecha: '2026-07-01', origen: 'entrada_sin_factura', importe: 500 },
      bd(),
    );
    expect(cargo.monto).toBe(500);
  });

  it('la previsualización avisa SÓLO cuando el proveedor sugerido es de maquila', async () => {
    const xmlMaquila = construirCfdi({ uuid: randomUUID(), emisorRfc: RFC_MAQUILERO });
    const xmlTela = construirCfdi({ uuid: randomUUID(), emisorRfc: RFC_TELERO });
    const deMaquila = await previsualizarCfdi(sesion(), { xml: xmlMaquila }, bd());
    const deTela = await previsualizarCfdi(sesion(), { xml: xmlTela }, bd());
    expect(deMaquila.avisos).toContain(AVISO_PREVIO_AMPARA_ESMA);
    expect(deTela.avisos).not.toContain(AVISO_PREVIO_AMPARA_ESMA);
  });
});

// ── (g) caso mixto ──────────────────────────────────────────────────────────────────────────────
describe('caso mixto: factura CON OC de un maquilero (decisión 3, no se desarrolla)', () => {
  it('sigue siendo deuda del motor (no se marca)', async () => {
    const oc = await cliente.ordenCompra.create({
      data: {
        numCompra: 7n,
        idEmpresa: empresa.id,
        idProveedor: maquilero.id,
        estatus: 'autorizada',
      },
    });
    const res = await importar({
      idProveedor: maquilero.id,
      rfc: RFC_MAQUILERO,
      total: '1060.00',
      refTipo: 'orden-compra',
      refId: oc.id,
    });
    expect(res.movimiento.amparaEsMa).toBe(false);
    expect(res.avisos).not.toContain(AVISO_AMPARA_ESMA);
    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', maquilero.id, bd());
    expect(saldo.saldoMovimientos).toBe(1060);
  });
});

// ── (h) la guarda ───────────────────────────────────────────────────────────────────────────────
describe('guarda: el cargo manual de CxP a un maquilero', () => {
  it('se rechaza la entrada sin factura y no queda nada escrito', async () => {
    await expect(
      registrarMovimientoCxp(
        sesion(),
        maquilero.id,
        { fecha: '2026-07-01', origen: 'entrada_sin_factura', importe: 300, esFiscal: false },
        bd(),
      ),
    ).rejects.toThrow(new ErrorValidacion(MENSAJE_MAQUILA_SE_CAPTURA_EN_ESMA));
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('también se rechazan el pago, el abono y el descuento manuales a un maquilero', async () => {
    for (const origen of ['pago', 'abono', 'descuento'] as const) {
      await expect(
        registrarMovimientoCxp(
          sesion(),
          maquilero.id,
          { fecha: '2026-07-01', origen, importe: 300, esFiscal: false },
          bd(),
        ),
      ).rejects.toThrow(new ErrorValidacion(MENSAJE_MAQUILA_SE_CAPTURA_EN_ESMA));
    }
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('control: el pago, el abono y el descuento a un proveedor que NO es de maquila sí pasan', async () => {
    for (const origen of ['pago', 'abono', 'descuento'] as const) {
      const mov = await registrarMovimientoCxp(
        sesion(),
        telero.id,
        { fecha: '2026-07-01', origen, importe: 300, esFiscal: false },
        bd(),
      );
      expect(mov.monto).toBe(-300);
    }
  });

  it('la corrida sí ejecuta el pago de un renglón congelado en «proveedores» (única exención)', async () => {
    const pago = await registrarMovimientoCxp(
      sesion(),
      maquilero.id,
      { fecha: '2026-07-01', origen: 'pago', importe: 300, esFiscal: false },
      bd(),
      { pagoDeRenglonCongelado: true },
    );
    expect(pago.monto).toBe(-300);
  });

  it('la exención de la corrida es SÓLO para un pago: con otro origen la guarda aplica igual', async () => {
    for (const origen of ['entrada_sin_factura', 'abono', 'descuento'] as const) {
      await expect(
        registrarMovimientoCxp(
          sesion(),
          maquilero.id,
          { fecha: '2026-07-01', origen, importe: 300, esFiscal: false },
          bd(),
          { pagoDeRenglonCongelado: true },
        ),
      ).rejects.toThrow(new ErrorValidacion(MENSAJE_MAQUILA_SE_CAPTURA_EN_ESMA));
    }
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });
});

// ── (i) la marca se GUARDA ──────────────────────────────────────────────────────────────────────
describe('la marca se guarda: corregir no la re-deriva', () => {
  it('el renglón corregido conserva la marca aunque el proveedor ya no tenga rol de maquila', async () => {
    // Factura sin factura fiscal y sin ref de un maquilero (la ruta genérica la deja así).
    const original = await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: maquilero.id,
        fecha: '2026-07-01',
        origen: 'factura_proveedor',
        importe: 500,
        esFiscal: false,
      },
      bd(),
    );
    expect(original.amparaEsMa).toBe(true);

    // Le quitan el rol de maquila: lo YA registrado no cambia de significado.
    await cliente.proveedorRol.deleteMany({ where: { idProveedor: maquilero.id } });
    const corrector = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: PERM,
      puedeCorregirSinFactura: true,
    });
    const corregido = await corregirMovimientoTercero(
      corrector,
      original.id,
      { importe: 600, motivo: 'Importe mal capturado' },
      bd(),
    );
    expect(corregido.amparaEsMa).toBe(true);
    const saldo = await calcularSaldoTercero(sesion(), 'proveedor', maquilero.id, bd());
    expect(saldo.saldoMovimientos).toBe(0);
  });
});

// ── (j) un CLIENTE nunca se toca ────────────────────────────────────────────────────────────────
describe('un cliente cuyo id coincide con el de un maquilero', () => {
  it('su nota de crédito NO se marca y su pago no se rechaza: los dos restan en CxC', async () => {
    // El id del cliente es el MISMO número que el del maquilero: si la regla mirara los roles por
    // id sin fijarse en el tipo de tercero, le leería los del maquilero.
    const espejo =
      clienteNegocio.id === maquilero.id
        ? clienteNegocio
        : await cliente.cliente.create({ data: { id: maquilero.id, nombre: 'Cliente Espejo' } });
    expect(espejo.id).toBe(maquilero.id);

    const alta = (origen: 'factura_cliente' | 'nota_credito' | 'pago', importe: number) =>
      registrarMovimientoTercero(
        sesion(),
        {
          tipoTercero: 'cliente',
          idTercero: espejo.id,
          fecha: '2026-07-01',
          origen,
          importe,
          esFiscal: false,
        },
        bd(),
      );
    await alta('factura_cliente', 1000);
    const nc = await alta('nota_credito', 300);
    await alta('pago', 100);

    expect(nc.amparaEsMa).toBe(false);
    const saldo = await calcularSaldoTercero(sesion(), 'cliente', espejo.id, bd());
    expect(saldo.saldo).toBe(600);
  });
});
