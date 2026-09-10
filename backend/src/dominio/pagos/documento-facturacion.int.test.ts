/**
 * Tests de integración del DOCUMENTO PARA FACTURAR (fila 0.118). Postgres efímero (testcontainers).
 *
 * Las reglas puras —quién factura, qué falta, cómo se parte el IVA— ya se miden sin base en
 * `documento-facturacion.test.ts`. Aquí se mide lo que SÓLO se puede medir con base:
 *
 *  (a) una corrida CERRADA con un proveedor completo produce el documento, con los datos VIVOS del
 *      catálogo y del registro de la empresa;
 *  (b) ⭐ el proveedor SIN RFC no produce documento y el aviso dice su NOMBRE;
 *  (c) ⭐ los huecos de la EMPRESA (los dos campos fiscales nuevos) bloquean igual que los del
 *      proveedor, y el aviso manda a Administración › Empresas;
 *  (d) la reja: sin `consultas.ver-importes` no hay documento (lleva dinero);
 *  (e) el CONCENTRADO trae la facturabilidad de cada renglón resuelta (para pintar los botones);
 *  (f) la corrida entera reparte los renglones entre emitidos y «no se emitieron».
 *
 * 🔒 Nombres y RFC INVENTADOS (el repo es público, fila 0.123): «TALLER EJEMPLO UNO/DOS»,
 * «EMPRESA DEMO SA DE CV», RFC con forma válida pero sintética y CLABEs de un dígito repetido.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { Empresa, PrismaClient, Proveedor } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { crearCuentaPagoProveedor } from '../catalogos/proveedor-cuentas-pago.js';
import {
  cerrarCorrida,
  concentradoDeCorrida,
  crearCorrida,
  guardarRenglonCorrida,
} from './corrida.js';
import { datosDocumentoFacturacion, documentosDeCorrida } from './documento-facturacion.js';

let cliente: PrismaClient;
let empresa: Empresa;
let taller: Proveedor;

/** CLABE válida (dígito de control correcto) y evidentemente sintética: todo el cuerpo repetido. */
const CLABE_FISCAL = '002010077777777771';

const PERM_TODOS: ClavePermiso[] = [
  'pagos.corrida-armar',
  'pagos.corrida-ver',
  'proveedores.ver',
  'conceptos-pago.ver',
  'conceptos-pago.administrar',
  'proveedores.administrar',
  'esma.ver-pagos',
  'cxp.ver',
  'cxp.administrar',
  'terceros.ver',
  'terceros.administrar',
  'consultas.ver-importes',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/** Los cuatro datos fiscales que el RECEPTOR necesita (los dos últimos nacieron con esta fila). */
const FISCAL_EMPRESA = {
  razonSocial: 'EMPRESA DEMO SA DE CV',
  rfc: 'EDE010101AAA',
  regimenFiscalSat: '601',
  codigoPostalFiscal: '11000',
};

/** Los cuatro del EMISOR, más su uso de CFDI habitual. */
const FISCAL_PROVEEDOR = {
  razonSocial: 'TALLER EJEMPLO UNO SA DE CV',
  rfc: 'TEU010101AAA',
  regimenFiscalSat: '626',
  codigoPostalExpedicion: '54000',
  usoCfdiHabitual: 'G03',
};

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  empresa = await cliente.empresa.update({ where: { id: empresa.id }, data: FISCAL_EMPRESA });
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'Maquila de costura' },
  });
  taller = await cliente.proveedor.create({
    data: {
      nombre: 'TALLER EJEMPLO UNO',
      modalidadFacturacion: 'ambos',
      ...FISCAL_PROVEEDOR,
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
});

/**
 * Abre la corrida CON factura de la semana del 31-ago-2026, le mete un renglón por transferencia a
 * la cuenta fiscal del taller y la CIERRA. Devuelve la corrida y el renglón.
 */
async function corridaCerradaConUnPago(
  monto = 11_600,
  opciones: { concepto?: string; referencia?: string } = {},
): Promise<{ idCorrida: number; idRenglon: number }> {
  const cuenta = await crearCuentaPagoProveedor(
    sesion(),
    taller.id,
    {
      beneficiario: 'TALLER EJEMPLO UNO',
      tipoCuenta: 'clabe',
      cuenta: CLABE_FISCAL,
      esFiscal: true,
    },
    bd(),
  );
  const abierta = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: true }, bd());
  const idCorrida = abierta.corrida.id;
  const conRenglon = await guardarRenglonCorrida(
    sesion(),
    idCorrida,
    {
      idProveedor: taller.id,
      monto,
      formaPago: 'transferencia',
      idCuenta: cuenta.id,
      ...(opciones.concepto === undefined ? {} : { concepto: opciones.concepto }),
      ...(opciones.referencia === undefined ? {} : { referencia: opciones.referencia }),
    },
    undefined,
    bd(),
  );
  const idRenglon = conRenglon.secciones.flatMap((s) => s.filas.flatMap((f) => f.renglones))[0]?.id;
  if (idRenglon === undefined) {
    throw new Error('el renglón no se guardó: la prueba no puede seguir');
  }
  await cerrarCorrida(sesion(), idCorrida, bd());
  return { idCorrida, idRenglon };
}

describe('(a) el documento de un renglón facturable', () => {
  it('⭐ sale con los datos de los DOS lados, la referencia y el IVA desglosado', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago(11_600, {
      concepto: 'Maquila de la semana',
      referencia: '7909 y 7888',
    });

    const salida = await datosDocumentoFacturacion(sesion(), idCorrida, idRenglon, bd());
    expect(salida.facturable).toBe(true);
    expect(salida.motivo).toBeNull();
    const doc = salida.documento;
    if (doc === null) {
      throw new Error('se esperaba documento');
    }
    expect(doc.emisor).toEqual({
      razonSocial: 'TALLER EJEMPLO UNO SA DE CV',
      rfc: 'TEU010101AAA',
      regimenFiscalSat: '626',
      codigoPostal: '54000',
    });
    expect(doc.receptor).toEqual({
      razonSocial: 'EMPRESA DEMO SA DE CV',
      rfc: 'EDE010101AAA',
      regimenFiscalSat: '601',
      codigoPostal: '11000',
    });
    expect(doc.concepto).toBe('Maquila de la semana');
    expect(doc.referencia).toBe('7909 y 7888');
    expect(doc.semana).toBe('2026-08-31');
    expect({ subtotal: doc.subtotal, iva: doc.iva, total: doc.total }).toEqual({
      subtotal: 10_000,
      iva: 1600,
      total: 11_600,
    });
    expect(doc.formaPagoSat).toBe('03');
    expect(doc.usoCfdi).toBe('G03');
    expect(doc.usoCfdiSugerido).toBe(false);
  });

  it('⭐ los datos fiscales se leen VIVOS: cambiar el régimen del proveedor cambia el documento', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago();
    await cliente.proveedor.update({
      where: { id: taller.id },
      data: { regimenFiscalSat: '612' },
    });
    const salida = await datosDocumentoFacturacion(sesion(), idCorrida, idRenglon, bd());
    // Lo contrario del destino del dinero (que va CONGELADO): la factura que va a emitir hoy lleva
    // su régimen de hoy, y uno viejo le impediría timbrar.
    expect(salida.documento?.emisor.regimenFiscalSat).toBe('612');
  });

  it('sin concepto capturado, el documento arma uno por rubro con la semana', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago();
    const salida = await datosDocumentoFacturacion(sesion(), idCorrida, idRenglon, bd());
    expect(salida.documento?.concepto).toBe('Servicios de maquila — semana del 2026-08-31');
  });

  it('un renglón de OTRA corrida (o inexistente) da 404, no un documento vacío', async () => {
    const { idCorrida } = await corridaCerradaConUnPago();
    await expect(datosDocumentoFacturacion(sesion(), idCorrida, 999_999, bd())).rejects.toThrow(
      /RenglonCorridaPago/,
    );
  });
});

describe('(b) ⭐ el proveedor SIN RFC no produce documento y se dice CUÁL falta', () => {
  it('el aviso lleva el nombre del proveedor, y el documento va en null', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago();
    await cliente.proveedor.update({ where: { id: taller.id }, data: { rfc: null } });

    const salida = await datosDocumentoFacturacion(sesion(), idCorrida, idRenglon, bd());
    expect(salida.facturable).toBe(false);
    expect(salida.motivo).toBe('faltantes');
    expect(salida.documento).toBeNull();
    expect(salida.faltantes).toEqual([
      { quien: 'proveedor', campo: 'rfc', texto: 'Falta el RFC del proveedor TALLER EJEMPLO UNO' },
    ]);
  });
});

describe('(c) ⭐ los campos fiscales NUEVOS de la empresa bloquean igual', () => {
  it('sin régimen fiscal ni CP fiscal de la empresa, no se emite y se dice a dónde ir', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago();
    await cliente.empresa.update({
      where: { id: empresa.id },
      data: { regimenFiscalSat: null, codigoPostalFiscal: null },
    });

    const salida = await datosDocumentoFacturacion(sesion(), idCorrida, idRenglon, bd());
    expect(salida.facturable).toBe(false);
    expect(salida.documento).toBeNull();
    expect(salida.faltantes.map((f) => `${f.quien}:${f.campo}`)).toEqual([
      'empresa:regimenFiscalSat',
      'empresa:codigoPostalFiscal',
    ]);
    expect(salida.faltantes.every((f) => f.texto.includes('Administración › Empresas'))).toBe(true);
  });
});

describe('(d) la reja: el documento lleva dinero', () => {
  it('sin `consultas.ver-importes` no hay documento (403), aunque se pueda ver la corrida', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago();
    const sinImportes = sesion(['pagos.corrida-ver']);
    await expect(
      datosDocumentoFacturacion(sinImportes, idCorrida, idRenglon, bd()),
    ).rejects.toThrow(ErrorPermiso);
  });

  it('sin ningún permiso de corrida tampoco (deny-by-default, A4)', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago();
    await expect(
      datosDocumentoFacturacion(sesion(['consultas.ver-importes']), idCorrida, idRenglon, bd()),
    ).rejects.toThrow(ErrorPermiso);
  });

  it('⭐ una corrida de OTRA empresa no se ve (A9): 404, no 403', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago();
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa de Prueba');
    const ajena = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM_TODOS });
    await expect(datosDocumentoFacturacion(ajena, idCorrida, idRenglon, bd())).rejects.toThrow(
      /CorridaPago/,
    );
  });
});

describe('(e) ⭐ el CONCENTRADO trae la facturabilidad resuelta', () => {
  it('cada renglón dice si se puede facturar, sin una llamada por renglón', async () => {
    const { idCorrida, idRenglon } = await corridaCerradaConUnPago();
    const concentrado = await concentradoDeCorrida(sesion(), idCorrida, bd());
    const renglon = concentrado.secciones.flatMap((s) => s.renglones)[0];
    expect(renglon?.id).toBe(idRenglon);
    expect(renglon?.facturacion.facturable).toBe(true);
    expect(renglon?.facturacion.faltantes).toEqual([]);
  });

  it('y cuando falta un dato, el concentrado ya trae el aviso para el tooltip del botón', async () => {
    const { idCorrida } = await corridaCerradaConUnPago();
    await cliente.proveedor.update({ where: { id: taller.id }, data: { rfc: null } });
    const concentrado = await concentradoDeCorrida(sesion(), idCorrida, bd());
    const renglon = concentrado.secciones.flatMap((s) => s.renglones)[0];
    expect(renglon?.facturacion.facturable).toBe(false);
    expect(renglon?.facturacion.motivo).toBe('faltantes');
    expect(renglon?.facturacion.faltantes[0]?.texto).toContain('TALLER EJEMPLO UNO');
  });
});

describe('(f) la corrida entera: emitidos y «no se emitieron»', () => {
  it('⭐ reparte los renglones y explica cada uno de los que se quedaron fuera', async () => {
    const { idCorrida } = await corridaCerradaConUnPago();

    // Todo capturado: se emite y no hay nadie fuera.
    const completa = await documentosDeCorrida(sesion(), idCorrida, bd());
    expect(completa.documentos).toHaveLength(1);
    expect(completa.noEmitidos).toEqual([]);
    expect(completa.membrete).toBe('EMPRESA DEMO SA DE CV');
    expect(completa.folioCorrida).toBeGreaterThan(0);

    // Le quitamos el RFC al proveedor: el mismo renglón pasa al otro lado, con su porqué.
    await cliente.proveedor.update({ where: { id: taller.id }, data: { rfc: null } });
    const incompleta = await documentosDeCorrida(sesion(), idCorrida, bd());
    expect(incompleta.documentos).toEqual([]);
    expect(incompleta.noEmitidos).toHaveLength(1);
    expect(incompleta.noEmitidos[0]?.nombre).toBe('TALLER EJEMPLO UNO');
    expect(incompleta.noEmitidos[0]?.motivo).toBe('faltantes');
    expect(incompleta.noEmitidos[0]?.monto).toBe(11_600);
    expect(incompleta.noEmitidos[0]?.faltantes[0]?.campo).toBe('rfc');
  });

  it('⭐ una corrida en BORRADOR no emite nada todavía (los montos aún se mueven)', async () => {
    const abierta = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: true }, bd());
    const cuenta = await crearCuentaPagoProveedor(
      sesion(),
      taller.id,
      {
        beneficiario: 'TALLER EJEMPLO UNO',
        tipoCuenta: 'clabe',
        cuenta: CLABE_FISCAL,
        esFiscal: true,
      },
      bd(),
    );
    await guardarRenglonCorrida(
      sesion(),
      abierta.corrida.id,
      { idProveedor: taller.id, monto: 1000, formaPago: 'transferencia', idCuenta: cuenta.id },
      undefined,
      bd(),
    );

    const datos = await documentosDeCorrida(sesion(), abierta.corrida.id, bd());
    expect(datos.documentos).toEqual([]);
    expect(datos.noEmitidos).toHaveLength(1);
    expect(datos.noEmitidos[0]?.motivo).toBe('estado');
  });
});
