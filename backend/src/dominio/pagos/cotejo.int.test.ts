/**
 * Tests de integración del COTEJO: **la factura del proveedor contra el documento que le emitimos**
 * (fila 0.117, §Post-F9.232). Postgres real, porque todo lo que decide aquí se decide en la base:
 * los folios por secuencia, las sumas de lo aplicado y el bloqueo del pago.
 *
 * Una invariante por `it`, a propósito: una prueba con cuatro `expect` de cosas distintas esconde
 * tres detrás de la primera que falla.
 *
 *  (a) el CIERRE reparte folios de documento, y sólo a quien le toca;
 *  (b) una factura sin orden de compra nace EN ROJO y frena el pago;
 *  (c) ligar los documentos exactos la pone en «cuadra»;
 *  (d) la tolerancia es UN PESO y muerde al centavo siguiente;
 *  (e) las guardas de la aplicación (más que la factura, más que el documento, otro proveedor);
 *  (f) atender la libera sin dejar de marcarla;
 *  (g) ⭐ EJECUTAR la corrida se rechaza NOMBRANDO al proveedor, y la relación SIN factura no.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient, Proveedor } from '../../datos/index.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { crearConceptoPago } from '../catalogos/conceptos-pago.js';
import { crearCuentaPagoProveedor } from '../catalogos/proveedor-cuentas-pago.js';
import {
  cancelarMovimientoTercero,
  registrarMovimientoTercero,
} from '../terceros/cuenta-terceros.js';
import {
  aplicarCotejo,
  atenderCotejo,
  bandejaDeCotejo,
  documentosEmitidosDeProveedor,
  TOPE_BANDEJA,
} from './cotejo.js';
import {
  cerrarCorrida,
  crearCorrida,
  ejecutarCorrida,
  guardarRenglonCorrida,
  obtenerCorridaDetalle,
} from './corrida.js';

let cliente: PrismaClient;
let empresa: Empresa;
let taller: Proveedor;
let otroTaller: Proveedor;

/** CLABE de PRUEBA: dígito de control válido y cuerpo evidentemente sintético (repo público). */
const CLABE_FISCAL = '002010077777777771';

const PERM_TODOS: ClavePermiso[] = [
  'pagos.corrida-armar',
  'pagos.corrida-ver',
  'conceptos-pago.ver',
  'conceptos-pago.administrar',
  'proveedores.ver',
  'proveedores.administrar',
  'esma.ver-pagos',
  'esma.revisar',
  'cxp.ver',
  'cxp.administrar',
  'terceros.ver',
  'terceros.administrar',
  'consultas.ver-importes',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/** Crea un maquilero que factura, con su cuenta FISCAL (la guarda del cierre la exige). */
async function crearMaquilero(nombre: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'maquila-costura' },
  });
  const proveedor = await cliente.proveedor.create({
    data: {
      nombre,
      modalidadFacturacion: 'ambos',
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
  await crearCuentaPagoProveedor(
    sesion(),
    proveedor.id,
    {
      beneficiario: nombre,
      banco: 'BANCO DEMO',
      tipoCuenta: 'clabe',
      cuenta: CLABE_FISCAL,
      esFiscal: true,
      alias: 'fiscal',
    },
    bd(),
  );
  return proveedor;
}

/**
 * Abre la corrida CON factura de la semana del 31-ago-2026, le pone un renglón a cada maquilero por
 * el monto dado y la CIERRA (que es cuando se reparten los folios de documento). Devuelve el id.
 */
async function corridaCerrada(montos: { proveedor: Proveedor; monto: number }[]): Promise<number> {
  const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: true }, bd());
  for (const { proveedor, monto } of montos) {
    const cuentas = await cliente.proveedorCuentaPago.findMany({
      where: { idProveedor: proveedor.id },
    });
    await guardarRenglonCorrida(
      sesion(),
      detalle.corrida.id,
      {
        idProveedor: proveedor.id,
        monto,
        formaPago: 'transferencia',
        idCuenta: cuentas[0]?.id,
      },
      undefined,
      bd(),
    );
  }
  await cerrarCorrida(sesion(), detalle.corrida.id, bd());
  return detalle.corrida.id;
}

/** El folio de documento del renglón de un proveedor en una corrida. */
async function folioDocumentoDe(idCorrida: number, proveedor: Proveedor): Promise<number | null> {
  const renglon = await cliente.renglonCorridaPago.findFirst({
    where: { idCorrida, idProveedor: proveedor.id },
  });
  return renglon?.folioDocumento === null || renglon === null
    ? null
    : Number(renglon.folioDocumento);
}

/** El id del renglón (documento) de un proveedor en una corrida. */
async function idDocumentoDe(idCorrida: number, proveedor: Proveedor): Promise<number> {
  const renglon = await cliente.renglonCorridaPago.findFirst({
    where: { idCorrida, idProveedor: proveedor.id },
  });
  if (renglon === null) throw new Error('El renglón de prueba no existe.');
  return renglon.id;
}

/**
 * Captura una FACTURA de proveedor SIN orden de compra: la que entra al cotejo.
 *
 * Va por `registrarMovimientoTercero` (el MOTOR) y no por `registrarMovimientoCxp` a propósito: la
 * captura de CxP **no admite** el origen `factura_proveedor` —una factura nace de su CFDI, no de
 * que alguien la teclee—, y el motor es justo por donde entra el importador. Es el mismo camino que
 * recorre la factura de verdad.
 */
async function facturaSinOc(proveedor: Proveedor, importe: number): Promise<number> {
  const movimiento = await registrarMovimientoTercero(
    sesion(),
    {
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      fecha: '2026-09-05',
      origen: 'factura_proveedor',
      importe,
      esFiscal: true,
    },
    bd(),
  );
  return movimiento.id;
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
  // Nombres INVENTADOS (fila 0.123: el repo es público).
  taller = await crearMaquilero('TALLER NORTE');
  otroTaller = await crearMaquilero('TALLER SUR');
});

describe('(a) el cierre reparte los folios de documento', () => {
  it('⭐ un renglón con monto de la corrida CON factura sale con su folio propio', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    expect(await folioDocumentoDe(idCorrida, taller)).toBe(1);
  });

  it('el folio es POR EMPRESA y consecutivo: la corrida siguiente sigue la serie', async () => {
    await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const segunda = await crearCorrida(sesion(), { semana: '2026-09-09', conFactura: true }, bd());
    const cuentas = await cliente.proveedorCuentaPago.findMany({
      where: { idProveedor: taller.id },
    });
    await guardarRenglonCorrida(
      sesion(),
      segunda.corrida.id,
      {
        idProveedor: taller.id,
        monto: 5_000,
        formaPago: 'transferencia',
        idCuenta: cuentas[0]?.id,
      },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), segunda.corrida.id, bd());
    expect(await folioDocumentoDe(segunda.corrida.id, taller)).toBe(2);
  });

  it('⭐ el folio es ÚNICO por empresa: la BASE rechaza dos documentos con el mismo número', async () => {
    // El dominio reparte por secuencia atómica (A3), pero el número acaba en manos de un tercero:
    // la unicidad se blinda también EN LA BASE (`@@unique([idEmpresa, folioDocumento])`). Se mide
    // por SQL crudo porque por el dominio no hay forma de pedir un folio repetido — que es el punto.
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const renglon = await cliente.renglonCorridaPago.findFirst({
      where: { idCorrida, origen: { not: 'concepto' } },
    });
    const segunda = await crearCorrida(sesion(), { semana: '2026-09-16', conFactura: true }, bd());
    const cuentas = await cliente.proveedorCuentaPago.findMany({
      where: { idProveedor: taller.id },
    });
    await guardarRenglonCorrida(
      sesion(),
      segunda.corrida.id,
      { idProveedor: taller.id, monto: 900, formaPago: 'transferencia', idCuenta: cuentas[0]?.id },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), segunda.corrida.id, bd());
    const otro = await cliente.renglonCorridaPago.findFirst({
      where: { idCorrida: segunda.corrida.id, origen: { not: 'concepto' } },
    });
    await expect(
      cliente.$executeRawUnsafe(
        `UPDATE "renglon_corrida_pago" SET "folio_documento" = $1 WHERE "id" = $2`,
        renglon?.folioDocumento,
        otro?.id,
      ),
    ).rejects.toThrow();
  });

  it('la corrida SIN factura NO reparte folios: ese segmento no lleva comprobante', async () => {
    const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: false }, bd());
    await guardarRenglonCorrida(
      sesion(),
      detalle.corrida.id,
      { idProveedor: taller.id, monto: 3_000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), detalle.corrida.id, bd());
    expect(await folioDocumentoDe(detalle.corrida.id, taller)).toBeNull();
  });

  it('un CONCEPTO del catálogo no recibe folio: no hay quién facture', async () => {
    await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica', predeterminado: true },
      bd(),
    );
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const concepto = await cliente.renglonCorridaPago.findFirst({
      where: { idCorrida, origen: 'concepto' },
    });
    expect(concepto?.folioDocumento).toBeNull();
  });
});

describe('(b) la factura sin orden de compra nace en rojo', () => {
  it('⭐ una factura de proveedor SIN OC entra marcada como descuadre', async () => {
    await facturaSinOc(taller, 11_600);
    const bandeja = await bandejaDeCotejo(sesion(), {}, bd());
    expect(bandeja.facturas.map((f) => f.estado)).toEqual(['descuadre']);
  });

  it('…y frena el pago mientras nadie la atienda', async () => {
    await facturaSinOc(taller, 11_600);
    const bandeja = await bandejaDeCotejo(sesion(), {}, bd());
    expect(bandeja.enRojo).toBe(1);
  });

  it('un PAGO no se coteja contra nada: no entra a la bandeja', async () => {
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: taller.id,
        fecha: '2026-09-05',
        origen: 'pago',
        importe: 500,
        esFiscal: true,
      },
      bd(),
    );
    const bandeja = await bandejaDeCotejo(sesion(), { filtro: 'todas' }, bd());
    expect(bandeja.facturas).toHaveLength(0);
  });

  it('la factura LIGADA a una orden de compra tampoco: ésa se coteja contra la OC', async () => {
    await registrarMovimientoTercero(
      sesion(),
      {
        tipoTercero: 'proveedor',
        idTercero: taller.id,
        fecha: '2026-09-05',
        origen: 'factura_proveedor',
        importe: 11_600,
        esFiscal: true,
        refTipo: 'orden-compra',
        refId: 1,
      },
      bd(),
    );
    const bandeja = await bandejaDeCotejo(sesion(), { filtro: 'todas' }, bd());
    expect(bandeja.facturas).toHaveLength(0);
  });
});

describe('(c)/(d) ligar los documentos y la tolerancia de UN PESO', () => {
  it('⭐ ligar el documento por su importe exacto la pone en «cuadra»', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idMovimiento = await facturaSinOc(taller, 11_600);
    const salida = await aplicarCotejo(
      sesion(),
      idMovimiento,
      { aplicaciones: [{ idRenglon: await idDocumentoDe(idCorrida, taller), importe: 11_600 }] },
      bd(),
    );
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.estado).toBe('cuadra');
  });

  it('…y con eso deja de frenar el pago', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idMovimiento = await facturaSinOc(taller, 11_600);
    const salida = await aplicarCotejo(
      sesion(),
      idMovimiento,
      { aplicaciones: [{ idRenglon: await idDocumentoDe(idCorrida, taller), importe: 11_600 }] },
      bd(),
    );
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.frenaElPago).toBe(false);
  });

  it('un PESO exacto de diferencia cuadra (lo que Daniel dijo)', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idMovimiento = await facturaSinOc(taller, 11_601);
    const salida = await aplicarCotejo(
      sesion(),
      idMovimiento,
      { aplicaciones: [{ idRenglon: await idDocumentoDe(idCorrida, taller), importe: 11_600 }] },
      bd(),
    );
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.estado).toBe('cuadra');
  });

  it('⭐ un peso con un centavo YA NO cuadra', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idMovimiento = await facturaSinOc(taller, 11_601.01);
    const salida = await aplicarCotejo(
      sesion(),
      idMovimiento,
      { aplicaciones: [{ idRenglon: await idDocumentoDe(idCorrida, taller), importe: 11_600 }] },
      bd(),
    );
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.estado).toBe('descuadre');
  });

  it('⭐ UNA factura puede cubrir DOS documentos (decisión (d): «como venga»)', async () => {
    const primera = await corridaCerrada([{ proveedor: taller, monto: 6_000 }]);
    const segunda = await crearCorrida(sesion(), { semana: '2026-09-09', conFactura: true }, bd());
    const cuentas = await cliente.proveedorCuentaPago.findMany({
      where: { idProveedor: taller.id },
    });
    await guardarRenglonCorrida(
      sesion(),
      segunda.corrida.id,
      {
        idProveedor: taller.id,
        monto: 5_600,
        formaPago: 'transferencia',
        idCuenta: cuentas[0]?.id,
      },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), segunda.corrida.id, bd());

    const idMovimiento = await facturaSinOc(taller, 11_600);
    const salida = await aplicarCotejo(
      sesion(),
      idMovimiento,
      {
        aplicaciones: [
          { idRenglon: await idDocumentoDe(primera, taller), importe: 6_000 },
          { idRenglon: await idDocumentoDe(segunda.corrida.id, taller), importe: 5_600 },
        ],
      },
      bd(),
    );
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.estado).toBe('cuadra');
  });

  it('⭐ y DOS facturas pueden repartirse UN documento', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idDocumento = await idDocumentoDe(idCorrida, taller);
    const primera = await facturaSinOc(taller, 6_000);
    const segunda = await facturaSinOc(taller, 5_600);
    await aplicarCotejo(
      sesion(),
      primera,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 6_000 }] },
      bd(),
    );
    const salida = await aplicarCotejo(
      sesion(),
      segunda,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 5_600 }] },
      bd(),
    );
    expect(salida.facturas.filter((f) => f.estado === 'cuadra')).toHaveLength(2);
  });

  it('volver a mandar la lista REEMPLAZA las ligas, no las suma', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idDocumento = await idDocumentoDe(idCorrida, taller);
    const idMovimiento = await facturaSinOc(taller, 11_600);
    await aplicarCotejo(
      sesion(),
      idMovimiento,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 5_000 }] },
      bd(),
    );
    const salida = await aplicarCotejo(
      sesion(),
      idMovimiento,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 11_600 }] },
      bd(),
    );
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.aplicado).toBe(11_600);
  });
});

describe('(e) las guardas de la aplicación', () => {
  it('no se puede aplicar MÁS de lo que dice la factura', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idMovimiento = await facturaSinOc(taller, 5_000);
    await expect(
      aplicarCotejo(
        sesion(),
        idMovimiento,
        { aplicaciones: [{ idRenglon: await idDocumentoDe(idCorrida, taller), importe: 11_600 }] },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('⭐ no se puede cubrir DOS VECES el mismo documento (suma directa bajo lock, D3)', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idDocumento = await idDocumentoDe(idCorrida, taller);
    const primera = await facturaSinOc(taller, 11_600);
    const segunda = await facturaSinOc(taller, 11_600);
    await aplicarCotejo(
      sesion(),
      primera,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 11_600 }] },
      bd(),
    );
    await expect(
      aplicarCotejo(
        sesion(),
        segunda,
        { aplicaciones: [{ idRenglon: idDocumento, importe: 11_600 }] },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('una factura no puede cubrir el documento de OTRO proveedor', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: otroTaller, monto: 11_600 }]);
    const idMovimiento = await facturaSinOc(taller, 11_600);
    await expect(
      aplicarCotejo(
        sesion(),
        idMovimiento,
        {
          aplicaciones: [
            { idRenglon: await idDocumentoDe(idCorrida, otroTaller), importe: 11_600 },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('un renglón SIN folio (corrida en borrador) no es un documento y no se puede ligar', async () => {
    const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: true }, bd());
    const cuentas = await cliente.proveedorCuentaPago.findMany({
      where: { idProveedor: taller.id },
    });
    await guardarRenglonCorrida(
      sesion(),
      detalle.corrida.id,
      {
        idProveedor: taller.id,
        monto: 11_600,
        formaPago: 'transferencia',
        idCuenta: cuentas[0]?.id,
      },
      undefined,
      bd(),
    );
    const idMovimiento = await facturaSinOc(taller, 11_600);
    await expect(
      aplicarCotejo(
        sesion(),
        idMovimiento,
        {
          aplicaciones: [
            { idRenglon: await idDocumentoDe(detalle.corrida.id, taller), importe: 11_600 },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });
});

describe('(f) atender el descuadre', () => {
  it('⭐ atender la libera: deja de frenar el pago', async () => {
    const idMovimiento = await facturaSinOc(taller, 11_600);
    const salida = await atenderCotejo(
      sesion(),
      idMovimiento,
      { nota: 'Le facturó un flete que va aparte; se revisó con él.' },
      bd(),
    );
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.frenaElPago).toBe(false);
  });

  it('…pero SIGUE marcada como descuadre: atender no la hace cuadrar', async () => {
    const idMovimiento = await facturaSinOc(taller, 11_600);
    const salida = await atenderCotejo(sesion(), idMovimiento, { nota: 'Revisada con él.' }, bd());
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.estado).toBe('descuadre');
  });

  it('atender deja escrito QUIÉN y POR QUÉ (A7)', async () => {
    const idMovimiento = await facturaSinOc(taller, 11_600);
    const salida = await atenderCotejo(sesion(), idMovimiento, { nota: 'Revisada con él.' }, bd());
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.nota).toBe(
      'Revisada con él.',
    );
  });

  it('no se atiende dos veces', async () => {
    const idMovimiento = await facturaSinOc(taller, 11_600);
    await atenderCotejo(sesion(), idMovimiento, { nota: 'Revisada con él.' }, bd());
    await expect(
      atenderCotejo(sesion(), idMovimiento, { nota: 'Otra vez.' }, bd()),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('⭐ recalcular NO borra lo atendido (el acto de una persona no se pisa)', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idMovimiento = await facturaSinOc(taller, 11_600);
    await atenderCotejo(sesion(), idMovimiento, { nota: 'Revisada con él.' }, bd());
    const salida = await aplicarCotejo(
      sesion(),
      idMovimiento,
      { aplicaciones: [{ idRenglon: await idDocumentoDe(idCorrida, taller), importe: 5_000 }] },
      bd(),
    );
    expect(salida.facturas.find((f) => f.idMovimiento === idMovimiento)?.atendida).toBe(true);
  });
});

describe('(f-bis) la factura cancelada', () => {
  it('una factura CANCELADA deja de frenar el pago aunque no cuadre', async () => {
    const idMovimiento = await facturaSinOc(taller, 11_600);
    await cancelarMovimientoTercero(
      sesion(),
      idMovimiento,
      { motivo: 'Se capturó dos veces.' },
      bd(),
    );
    const bandeja = await bandejaDeCotejo(sesion(), { filtro: 'todas' }, bd());
    expect(bandeja.facturas.find((f) => f.idMovimiento === idMovimiento)?.frenaElPago).toBe(false);
  });

  it('⭐⭐ CANCELAR una factura LIBERA el documento que tenía ligado', async () => {
    // Cancelar y reexpedir un CFDI es rutina. Si las ligas de la cancelada siguieran ocupando el
    // documento, éste quedaría en `disponible = 0` para siempre.
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idDocumento = await idDocumentoDe(idCorrida, taller);
    const idFactura = await facturaSinOc(taller, 11_600);
    await aplicarCotejo(
      sesion(),
      idFactura,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 11_600 }] },
      bd(),
    );
    const antes = await documentosEmitidosDeProveedor(sesion(), taller.id, bd());
    expect(antes.documentos.find((d) => d.idRenglon === idDocumento)?.disponible).toBe(0);

    await cancelarMovimientoTercero(sesion(), idFactura, { motivo: 'La reexpidieron.' }, bd());

    const despues = await documentosEmitidosDeProveedor(sesion(), taller.id, bd());
    expect(despues.documentos.find((d) => d.idRenglon === idDocumento)?.disponible).toBe(11_600);
  });

  it('⭐⭐ …y la factura de REEMPLAZO se puede ligar al mismo documento', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idDocumento = await idDocumentoDe(idCorrida, taller);
    const idPrimera = await facturaSinOc(taller, 11_600);
    await aplicarCotejo(
      sesion(),
      idPrimera,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 11_600 }] },
      bd(),
    );
    await cancelarMovimientoTercero(sesion(), idPrimera, { motivo: 'La reexpidieron.' }, bd());

    const idSegunda = await facturaSinOc(taller, 11_600);
    const bandeja = await aplicarCotejo(
      sesion(),
      idSegunda,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 11_600 }] },
      bd(),
    );
    expect(bandeja.facturas.find((f) => f.idMovimiento === idSegunda)?.estado).toBe('cuadra');
  });

  it('la liga de la cancelada NO se borra: sigue como rastro de lo que decía cubrir (D3)', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idDocumento = await idDocumentoDe(idCorrida, taller);
    const idFactura = await facturaSinOc(taller, 11_600);
    await aplicarCotejo(
      sesion(),
      idFactura,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 11_600 }] },
      bd(),
    );
    await cancelarMovimientoTercero(sesion(), idFactura, { motivo: 'La reexpidieron.' }, bd());

    const ligas = await cliente.cotejoFacturaDocumento.findMany({
      where: { idMovimiento: idFactura },
    });
    expect(ligas).toHaveLength(1);
  });

  it('lo APLICADO de una cancelada se pinta en cero: sus ligas ya no ocupan nada', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idDocumento = await idDocumentoDe(idCorrida, taller);
    const idFactura = await facturaSinOc(taller, 11_600);
    await aplicarCotejo(
      sesion(),
      idFactura,
      { aplicaciones: [{ idRenglon: idDocumento, importe: 11_600 }] },
      bd(),
    );
    await cancelarMovimientoTercero(sesion(), idFactura, { motivo: 'La reexpidieron.' }, bd());

    const bandeja = await bandejaDeCotejo(sesion(), { filtro: 'todas' }, bd());
    const fila = bandeja.facturas.find((f) => f.idMovimiento === idFactura);
    expect(fila?.aplicado).toBe(0);
    expect(fila?.cancelada).toBe(true);
  });
});

describe('(f-ter) la bandeja no miente cuando recorta (§Post-F9.87: sin topes silenciosos)', () => {
  /**
   * Siembra `cuantas` facturas en rojo POR SQL, sin pasar por el dominio: lo que se mide aquí es la
   * LECTURA de la bandeja, y capturar 600 facturas por el motor sólo haría la prueba lenta sin medir
   * nada más. El veredicto se escribe a mano porque es justo lo que el motor habría dejado.
   */
  async function sembrarFacturasEnRojo(cuantas: number): Promise<void> {
    await cliente.movimientoTercero.createMany({
      data: Array.from({ length: cuantas }, (_, i) => ({
        idEmpresa: empresa.id,
        folio: BigInt(1000 + i),
        tipoTercero: 'proveedor' as const,
        idProveedor: taller.id,
        fecha: new Date('2026-09-05'),
        origen: 'factura_proveedor' as const,
        monto: 100,
        esFiscal: true,
        estadoCotejo: 'descuadre' as const,
      })),
    });
  }

  it('⭐ el conteo de «frenan un pago» se cuenta CONTRA LA BASE, no sobre la lista recortada', async () => {
    // Con 600 en rojo y un tope de 500, contar lo que se ve afirmaría «500» como si fuera el dato.
    await sembrarFacturasEnRojo(600);
    const bandeja = await bandejaDeCotejo(sesion(), { filtro: 'pendientes' }, bd());
    expect(bandeja.facturas.length).toBe(500);
    expect(bandeja.enRojo).toBe(600);
  });

  it('⭐ …y avisa de que recortó (`hayMas`), en vez de callarlo', async () => {
    await sembrarFacturasEnRojo(600);
    const bandeja = await bandejaDeCotejo(sesion(), { filtro: 'pendientes' }, bd());
    expect(bandeja.hayMas).toBe(true);
  });

  it('⭐ EL BORDE EXACTO: con la lista JUSTO llena no falta nada, y no lo dice', async () => {
    // El fallo que acecha aquí es de un solo puesto: `>` contra `>=`. Con `>=`, exactamente
    // `TOPE_BANDEJA` facturas harían que la pantalla gritara «hay más, y lo que falta es lo viejo»
    // sin faltar ni una — y una gemela negativa con 3 filas está demasiado lejos para enterarse.
    // El tope se IMPORTA, no se teclea: así la prueba sigue midiendo el borde si un día cambia.
    await sembrarFacturasEnRojo(TOPE_BANDEJA);
    const bandeja = await bandejaDeCotejo(sesion(), { filtro: 'pendientes' }, bd());
    expect(bandeja.facturas.length).toBe(TOPE_BANDEJA);
    expect(bandeja.hayMas).toBe(false);
  });

  it('⭐ el CONTEO y el FILTRO contestan lo mismo: la atendida y la cancelada no cuentan', async () => {
    // `enRojo` y el filtro `pendientes` son la MISMA pregunta —«¿qué frena un pago?»— hecha dos
    // veces. Hoy comparten la constante `enRojoWhere`, pero eso es una garantía estructural, no una
    // medida: si mañana alguien le escribe al `count()` un `where` propio, esto se pone rojo. De las
    // tres sembradas sólo UNA frena: la otra la atendió alguien y la tercera está cancelada.
    await sembrarFacturasEnRojo(3);
    await cliente.movimientoTercero.updateMany({
      where: { idEmpresa: empresa.id, folio: 1001n },
      data: { cotejoAtendidoEn: new Date(), cotejoNota: 'Trae un flete de más.' },
    });
    await cliente.movimientoTercero.updateMany({
      where: { idEmpresa: empresa.id, folio: 1002n },
      data: { cancelado: true },
    });

    const bandeja = await bandejaDeCotejo(sesion(), { filtro: 'pendientes' }, bd());
    expect(bandeja.enRojo).toBe(1);
    expect(bandeja.facturas.map((f) => f.folio)).toEqual([1000]);
  });
});

describe('(g) el bloqueo del pago', () => {
  it('⭐ ejecutar se rechaza cuando el proveedor tiene una factura en rojo', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    await facturaSinOc(taller, 11_600);
    await expect(ejecutarCorrida(sesion(), idCorrida, bd())).rejects.toThrow(ErrorValidacion);
  });

  it('…y el rechazo dice el NOMBRE del proveedor', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    await facturaSinOc(taller, 11_600);
    await expect(ejecutarCorrida(sesion(), idCorrida, bd())).rejects.toThrow(/TALLER NORTE/);
  });

  it('el detalle publica el bloqueo para que la pantalla lo pinte', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    await facturaSinOc(taller, 11_600);
    const detalle = await obtenerCorridaDetalle(sesion(), idCorrida, bd());
    expect(detalle.bloqueosEjecucion.map((b) => b.nombre)).toEqual(['TALLER NORTE']);
  });

  it('⭐ con la factura ya cuadrada, la corrida se ejecuta', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: taller, monto: 11_600 }]);
    const idMovimiento = await facturaSinOc(taller, 11_600);
    await aplicarCotejo(
      sesion(),
      idMovimiento,
      { aplicaciones: [{ idRenglon: await idDocumentoDe(idCorrida, taller), importe: 11_600 }] },
      bd(),
    );
    const detalle = await ejecutarCorrida(sesion(), idCorrida, bd());
    expect(detalle.corrida.estado).toBe('ejecutada');
  });

  it('el proveedor SIN factura en rojo no se ve frenado por el de al lado', async () => {
    const idCorrida = await corridaCerrada([{ proveedor: otroTaller, monto: 3_000 }]);
    await facturaSinOc(taller, 11_600);
    const detalle = await obtenerCorridaDetalle(sesion(), idCorrida, bd());
    expect(detalle.bloqueosEjecucion).toEqual([]);
  });

  it('⭐ la relación SIN factura no se frena: es otro reparto de dinero', async () => {
    await facturaSinOc(taller, 11_600);
    const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: false }, bd());
    await guardarRenglonCorrida(
      sesion(),
      detalle.corrida.id,
      { idProveedor: taller.id, monto: 3_000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), detalle.corrida.id, bd());
    const ejecutada = await ejecutarCorrida(sesion(), detalle.corrida.id, bd());
    expect(ejecutada.corrida.estado).toBe('ejecutada');
  });
});
