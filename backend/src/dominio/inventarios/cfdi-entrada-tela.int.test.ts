import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Almacen, Empresa, PrismaClient, Proveedor, Tela } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { autorizarOC, crearOC } from '../compras/ordenes-compra.js';
import { leerCfdiParaEntradaTela } from './cfdi-entrada-tela.js';

/**
 * Integración de LEER LA FACTURA (XML del CFDI) para llenar la entrada de tela (§Post-F9.20).
 * Prueba lo que solo se ve con base: el proveedor se reconoce por su RFC, los conceptos se cruzan
 * con los renglones de OC pendientes, el UUID repetido se avisa, y NADA se escribe (es una lectura).
 */

let cliente: PrismaClient;
let empresa: Empresa;
let proveedor: Proveedor;
let telaFelpa: Tela;
let telaRib: Tela;
let almacen: Almacen;
let idDireccionEntrega: number;

const PERM: ClavePermiso[] = [
  'inventario-telas.ver',
  'inventario-telas.mover',
  'compras.ver',
  'compras.administrar',
  'compras.autorizar',
];

const sesion = (permisos: ClavePermiso[] = PERM): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/** CFDI 4.0 mínimo pero VÁLIDO para el parser: emisor, receptor, timbre y conceptos. */
function xmlCfdi(opciones: {
  emisorRfc: string;
  receptorRfc: string;
  uuid: string;
  conceptos: { descripcion: string; cantidad: number; valorUnitario: number }[];
  serie?: string;
  folio?: string;
}): string {
  const conceptos = opciones.conceptos
    .map(
      (c) =>
        `<cfdi:Concepto ClaveProdServ="53102500" Cantidad="${String(c.cantidad)}" ClaveUnidad="KGM" ` +
        `Descripcion="${c.descripcion}" ValorUnitario="${String(c.valorUnitario)}" ` +
        `Importe="${String(c.cantidad * c.valorUnitario)}" ObjetoImp="02"/>`,
    )
    .join('');
  const total = opciones.conceptos.reduce((s, c) => s + c.cantidad * c.valorUnitario, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" TipoDeComprobante="I" Fecha="2026-08-05T10:00:00" Moneda="MXN"
  ${opciones.serie === undefined ? '' : `Serie="${opciones.serie}"`}
  ${opciones.folio === undefined ? '' : `Folio="${opciones.folio}"`}
  SubTotal="${String(total)}" Total="${String(total)}">
  <cfdi:Emisor Rfc="${opciones.emisorRfc}" Nombre="Textiles del Norte SA" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${opciones.receptorRfc}" Nombre="FR Moda" UsoCFDI="G01"
    DomicilioFiscalReceptor="53000" RegimenFiscalReceptor="601"/>
  <cfdi:Conceptos>${conceptos}</cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${opciones.uuid}" FechaTimbrado="2026-08-05T10:05:00"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

/** Crea una OC autorizada con un renglón por tela dada. Devuelve la OC proyectada. */
async function ocAutorizada(lineas: { idTela: number; cantidad: number; precio: number }[]) {
  const oc = await crearOC(
    sesion(),
    {
      fechaEntrega: '2026-09-30',
      idDireccionEntrega,
      idProveedor: proveedor.id,
      lineas: lineas.map((l) => ({ ...l, unidad: 'kg' })),
    },
    bd(),
  );
  await autorizarOC(sesion(), oc.id, bd());
  return oc;
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
  await cliente.empresa.update({ where: { id: empresa.id }, data: { rfc: 'FRM900101AAA' } });
  proveedor = await cliente.proveedor.create({
    data: { nombre: 'Textiles del Norte', rfc: 'TNO850101BBB' },
  });
  telaFelpa = await cliente.tela.create({
    data: { nombre: 'Felpa Perchada', idProveedor: proveedor.id, unidadMedida: 'KG' },
  });
  telaRib = await cliente.tela.create({
    data: { nombre: 'Rib Algodon', idProveedor: proveedor.id, unidadMedida: 'KG' },
  });
  almacen = await cliente.almacen.create({ data: { nombre: 'Naucalpan', tipo: 'TELA' } });
  const direccion = await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  idDireccionEntrega = direccion.id;
  expect(almacen.id).toBeGreaterThan(0);
});

describe('Leer el CFDI para la entrada de tela (§Post-F9.20)', () => {
  it('reconoce al proveedor por su RFC y trae los conceptos de la factura', async () => {
    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      {
        xml: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid: '11111111-1111-1111-1111-111111111111',
          serie: 'A',
          folio: '1045',
          conceptos: [
            { descripcion: 'FELPA PERCHADA 100% ALG.', cantidad: 380, valorUnitario: 92 },
          ],
        }),
      },
      bd(),
    );

    expect(propuesta.idProveedor).toBe(proveedor.id);
    expect(propuesta.proveedor).toBe('Textiles del Norte');
    expect(propuesta.numeroDocumento).toBe('A1045');
    expect(propuesta.fecha).toBe('2026-08-05');
    expect(propuesta.conceptos).toHaveLength(1);
    expect(propuesta.conceptos[0]?.cantidad).toBe(380);
    expect(propuesta.conceptos[0]?.valorUnitario).toBe(92);
  });

  it('cruza cada concepto con su renglón de OC POR EL NOMBRE de la tela', async () => {
    const oc = await ocAutorizada([
      { idTela: telaFelpa.id, cantidad: 400, precio: 90 },
      { idTela: telaRib.id, cantidad: 100, precio: 70 },
    ]);

    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      {
        xml: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid: '22222222-2222-2222-2222-222222222222',
          conceptos: [
            // El proveedor escribe distinto que el catálogo: MAYÚSCULAS, acentos y texto de más.
            { descripcion: 'RIB ALGODÓN 1X1 TUBULAR', cantidad: 98, valorUnitario: 70 },
            { descripcion: 'Felpa perchada (rollo)', cantidad: 380, valorUnitario: 92 },
          ],
        }),
        idOrdenCompra: oc.id,
      },
      bd(),
    );

    const [rib, felpa] = propuesta.conceptos;
    expect(rib?.sugerencia?.tela).toBe('Rib Algodon');
    expect(rib?.sugerencia?.motivo).toBe('nombre-de-la-tela');
    expect(felpa?.sugerencia?.tela).toBe('Felpa Perchada');
    expect(felpa?.sugerencia?.numCompra).toBe(oc.numCompra);
  });

  it('no le asigna el MISMO renglón de OC a dos conceptos', async () => {
    await ocAutorizada([{ idTela: telaFelpa.id, cantidad: 400, precio: 90 }]);

    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      {
        xml: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid: '33333333-3333-3333-3333-333333333333',
          conceptos: [
            { descripcion: 'FELPA PERCHADA azul', cantidad: 200, valorUnitario: 90 },
            { descripcion: 'FELPA PERCHADA negra', cantidad: 180, valorUnitario: 90 },
          ],
        }),
      },
      bd(),
    );

    const asignados = propuesta.conceptos
      .map((c) => c.sugerencia?.idOrdenCompraLinea)
      .filter((x): x is number => x !== undefined);
    expect(new Set(asignados).size).toBe(asignados.length);
    // Y avisa que un concepto se quedó sin cruce, en vez de callarlo.
    expect(propuesta.avisos.join(' ')).toMatch(/no se pudieron cruzar/);
  });

  it('avisa cuando el RECEPTOR no es la empresa activa (factura de otra empresa)', async () => {
    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      {
        xml: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'OTRA010101XXX',
          uuid: '44444444-4444-4444-4444-444444444444',
          conceptos: [{ descripcion: 'Felpa Perchada', cantidad: 10, valorUnitario: 1 }],
        }),
      },
      bd(),
    );
    expect(propuesta.avisos.length).toBeGreaterThan(0);
  });

  it('avisa si NINGÚN proveedor tiene ese RFC (y no cruza nada)', async () => {
    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      {
        xml: xmlCfdi({
          emisorRfc: 'DESCONOCIDO999',
          receptorRfc: 'FRM900101AAA',
          uuid: '55555555-5555-5555-5555-555555555555',
          conceptos: [{ descripcion: 'Felpa Perchada', cantidad: 10, valorUnitario: 1 }],
        }),
      },
      bd(),
    );
    expect(propuesta.idProveedor).toBeNull();
    expect(propuesta.avisos.join(' ')).toMatch(/RFC del emisor/);
    expect(propuesta.conceptos[0]?.sugerencia).toBeNull();
  });

  it('avisa si esa MISMA factura ya se capturó en otra entrada', async () => {
    const uuid = '66666666-6666-6666-6666-666666666666';
    await cliente.entradaTela.create({
      data: {
        folio: 1n,
        idEmpresa: empresa.id,
        tipoDocumento: 'factura',
        numeroDocumento: 'A1045',
        uuidCfdi: uuid,
        idProveedor: proveedor.id,
        fecha: new Date('2026-08-05T00:00:00.000Z'),
        idAlmacen: almacen.id,
      },
    });

    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      {
        xml: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid,
          conceptos: [{ descripcion: 'Felpa Perchada', cantidad: 10, valorUnitario: 1 }],
        }),
      },
      bd(),
    );
    expect(propuesta.yaUsado).toBe(true);
    expect(propuesta.avisos.join(' ')).toMatch(/ya se capturó/);
  });

  it('es SOLO LECTURA: no deja nada escrito, y exige el permiso de mover inventario', async () => {
    const xml = xmlCfdi({
      emisorRfc: 'TNO850101BBB',
      receptorRfc: 'FRM900101AAA',
      uuid: '77777777-7777-7777-7777-777777777777',
      conceptos: [{ descripcion: 'Felpa Perchada', cantidad: 10, valorUnitario: 1 }],
    });

    await expect(
      leerCfdiParaEntradaTela(sesion(['inventario-telas.ver']), { xml }, bd()),
    ).rejects.toBeInstanceOf(Error);

    await leerCfdiParaEntradaTela(sesion(), { xml }, bd());
    expect(await cliente.entradaTela.count()).toBe(0);
    expect(await cliente.movimiento.count()).toBe(0);
  });
});
