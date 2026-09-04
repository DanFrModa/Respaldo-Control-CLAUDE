import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Almacen, Empresa, PrismaClient, Proveedor, Tela } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { autorizarOC, crearOC } from '../compras/ordenes-compra.js';
import { leerCfdiParaEntradaTela } from './cfdi-entrada-tela.js';
import {
  actualizarEntradaTela,
  cancelarEntradaTela,
  confirmarEntradaTela,
  crearEntradaTela,
} from './entradas-tela.js';

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

/**
 * Servicio de archivos FALSO (en las pruebas no hay R2), **calcado del real en lo que importa**: la
 * key lleva un **segmento único por subida** (`carpeta/uuid/nombre`, ver `comun/archivos.ts`).
 *
 * POR QUÉ ASÍ Y NO `cfdi/<nombre>` (lección del CI del 11-ago-2026): con una key DETERMINISTA, subir
 * dos veces el mismo XML —que es justo lo que prueba "volver a subir el MISMO XML a la MISMA
 * entrada"— chocaba con el unique de `Archivo.key` y la prueba fallaba **por el doble**, no por el
 * sistema (el real nunca colisiona: mete un `randomUUID()` en la key). Un doble que no puede
 * colisionar esconde colisiones; uno que colisiona donde el real no, inventa fallos.
 *
 * Uno solo para TODO el archivo: tres copias divergentes era exactamente el terreno del defecto.
 */
const archivosFalsos = {
  subirContenido: (datos: { nombreOriginal: string; tipoMime: string; carpeta: string }) =>
    Promise.resolve({
      bucket: 'pruebas',
      key: `${datos.carpeta}/${randomUUID()}/${datos.nombreOriginal}`,
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: 100,
    }),
} as unknown as Parameters<typeof crearEntradaTela>[3];

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

/**
 * §Post-F9.159(a) — **NO SE RECIBE TELA SIN OC**: toda entrada de este archivo nace contra un
 * renglón de orden de compra AUTORIZADA, y éste lo crea.
 *
 * Se crea **bajo demanda, nunca en el `beforeEach`**, a propósito: las pruebas de "Leer el CFDI"
 * miden EXACTAMENTE qué renglones pendientes se cruzan con qué conceptos, y una OC de más en el
 * fixture les cambiaría la respuesta en silencio.
 *
 * Cantidad enorme: la orden nunca llega a `recibida_total`, así que sigue siendo recibible por la
 * siguiente entrada de la misma prueba (`ESTATUS_RECIBIBLES` = autorizada | recibida_parcial).
 */
async function renglonOc(
  opciones: { idTela?: number; idProveedor?: number; conComplemento?: boolean } = {},
): Promise<number> {
  const oc = await crearOC(
    sesion(),
    {
      fechaEntrega: '2026-09-30',
      idDireccionEntrega,
      idProveedor: opciones.idProveedor ?? proveedor.id,
      lineas: [
        {
          idTela: opciones.idTela ?? telaFelpa.id,
          cantidad: 100_000,
          precio: 1,
          unidad: 'kg',
          ...(opciones.conComplemento === true ? { cantidadComplemento: 5_000 } : {}),
        },
      ],
    },
    bd(),
  );
  await autorizarOC(sesion(), oc.id, bd());
  const linea = oc.lineas[0]?.id;
  if (linea === undefined) {
    throw new Error('Fixture roto: la OC no devolvió su renglón de tela.');
  }
  return linea;
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
  // Confirmar una entrada mueve el kardex, y el motor exige el tipo de movimiento sembrado (nunca
  // lo inventa). `limpiarBaseDatos` se lleva el catálogo, así que se re-siembra en cada prueba.
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
    ],
  });
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

  it('RECHAZA una factura dirigida a OTRA empresa (no la avisa: la rechaza)', async () => {
    // Regla heredada de F9 (`validarReceptorCfdi`) y correcta aquí también: recibir mercancía
    // contra el comprobante de alguien más no es un aviso, es un error.
    await expect(
      leerCfdiParaEntradaTela(
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
      ),
    ).rejects.toThrow(/no al de tu empresa/);
  });

  it('si la EMPRESA aún no captura su RFC, avisa en vez de trabar la captura', async () => {
    await cliente.empresa.update({ where: { id: empresa.id }, data: { rfc: null } });
    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      {
        xml: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'OTRA010101XXX',
          uuid: '88888888-8888-8888-8888-888888888888',
          conceptos: [{ descripcion: 'Felpa Perchada', cantidad: 10, valorUnitario: 1 }],
        }),
      },
      bd(),
    );
    expect(propuesta.avisos.join(' ')).toMatch(/RFC del receptor/);
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

/**
 * 🔴🔴 **EL AVISO NO PUEDE AFIRMAR MÁS DE LO QUE SE PREGUNTÓ** (§Post-F9.159(a), segundo hallazgo
 * del reviewer).
 *
 * `lineasTelaPendientesDeProveedor` se llama ACOTADA a una orden cuando la lectura llegó desde ella
 * (`entrada.idOrdenCompra`, §Post-F9.15). Su vacío significa entonces «esta orden no tiene tela
 * pendiente», y **no** «este proveedor no tiene nada»: decir lo segundo es falso, y mandar a
 * «levanta (o autoriza) la orden» lo es doblemente, porque a ese camino sólo se llega desde una OC
 * YA autorizada.
 */
describe('§Post-F9.159(a): el aviso de "no hay pendientes" dice hasta dónde se preguntó', () => {
  const xmlSuelto = (uuid: string) =>
    xmlCfdi({
      emisorRfc: 'TNO850101BBB',
      receptorRfc: 'FRM900101AAA',
      uuid,
      conceptos: [{ descripcion: 'FELPA PERCHADA', cantidad: 10, valorUnitario: 90 }],
    });

  it('SIN acotar (captura desde cero): ahí sí se preguntó por TODO el proveedor', async () => {
    // Sin una sola OC abierta: el vacío cubre al proveedor entero y la frase puede nombrarlo.
    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      { xml: xmlSuelto('aaaaaaaa-0000-0000-0000-000000000001') },
      bd(),
    );

    const avisos = propuesta.avisos.join(' ');
    expect(avisos).toMatch(/Ese proveedor no tiene renglones de tela pendientes/);
    expect(avisos).toMatch(/Levanta \(o autoriza\)/);
  });

  it('🔴 ACOTADO a una OC: habla de ESA ORDEN, no del proveedor — y no manda a autorizar lo ya autorizado', async () => {
    // La configuración CORRIENTE que lo destapa: una OC con TELA y un renglón que no es tela, cuya
    // tela YA llegó completa. El botón «Dar entrada a la tela» no mira el pendiente, así que la
    // sigue ofreciendo… y la consulta acotada vuelve vacía.
    const ocRecibida = await crearOC(
      sesion(),
      {
        fechaEntrega: '2026-09-30',
        idDireccionEntrega,
        idProveedor: proveedor.id,
        lineas: [
          { idTela: telaFelpa.id, cantidad: 100, precio: 90, unidad: 'kg' },
          { descripcionLibre: 'Fletes', cantidad: 1, precio: 500, unidad: 'servicio' },
        ],
      },
      bd(),
    );
    await autorizarOC(sesion(), ocRecibida.id, bd());
    const idLineaTela = ocRecibida.lineas.find((l) => l.idTela !== null)?.id;
    if (idLineaTela === undefined) {
      throw new Error('Fixture roto: la OC no devolvió su renglón de tela.');
    }
    // Y el proveedor SÍ tiene pendiente en OTRA orden: si el aviso hablara de él, mentiría.
    await ocAutorizada([{ idTela: telaRib.id, cantidad: 300, precio: 70 }]);

    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: 'Marino recibido' },
    });
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'R-77',
        idProveedor: proveedor.id,
        fecha: '2026-08-05',
        idAlmacen: almacen.id,
        lineas: [
          { idTelaColor: color.id, cantidad: 100, precioUnit: 90, idOrdenCompraLinea: idLineaTela },
        ],
      },
      bd(),
      archivosFalsos,
    );
    await confirmarEntradaTela(sesion(), entrada.id, bd());

    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      { xml: xmlSuelto('aaaaaaaa-0000-0000-0000-000000000002'), idOrdenCompra: ocRecibida.id },
      bd(),
    );

    const avisos = propuesta.avisos.join(' ');
    expect(avisos).toMatch(/Esta orden de compra ya no tiene renglones de tela pendientes/);
    // Las dos mitades que eran falsas: el proveedor (al que no se le preguntó) y el imperativo
    // imposible (la orden por la que se preguntó ya está autorizada).
    expect(avisos).not.toMatch(/Ese proveedor no tiene/);
    expect(avisos).not.toMatch(/Levanta \(o autoriza\)/);
  });
});

describe('La CxP nace al CONFIRMAR la entrada (§Post-F9.21)', () => {
  /**
   * Captura una entrada CON su XML y devuelve el documento creado. El color se deriva del uuid
   * (unique `(idTela, nombre)`): así llamarlo dos veces en una prueba nunca choca en el catálogo.
   */
  async function capturarConXml(uuid: string, valorUnitario = 92) {
    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: `Marino ${uuid.slice(0, 8)}` },
    });
    const idOrdenCompraLinea = await renglonOc();
    return crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'A1045',
        idProveedor: proveedor.id,
        fecha: '2026-08-05',
        idAlmacen: almacen.id,
        xmlCfdi: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid,
          conceptos: [{ descripcion: 'FELPA PERCHADA', cantidad: 10, valorUnitario }],
        }),
        lineas: [
          { idTelaColor: color.id, cantidad: 10, precioUnit: valorUnitario, idOrdenCompraLinea },
        ],
      },
      bd(),
      archivosFalsos,
    );
  }

  it('en BORRADOR no hay cargo; al confirmar nace FISCAL por el TOTAL del CFDI', async () => {
    const entrada = await capturarConXml('99999999-9999-9999-9999-999999999999');
    expect(entrada.uuidCfdi).toBe('99999999-9999-9999-9999-999999999999');
    // El total del CFDI (10 × 92 = 920) es la verdad fiscal, no la suma de renglones sin impuestos.
    expect(entrada.totalCfdi).toBe(920);
    expect(await cliente.movimientoTercero.count()).toBe(0);

    await confirmarEntradaTela(sesion(), entrada.id, bd());

    const cargos = await cliente.movimientoTercero.findMany();
    expect(cargos).toHaveLength(1);
    expect(cargos[0]?.esFiscal).toBe(true);
    expect(Number(cargos[0]?.monto)).toBe(920);
    expect(cargos[0]?.uuidCfdi).toBe('99999999-9999-9999-9999-999999999999');
    expect(cargos[0]?.idProveedor).toBe(proveedor.id);
    // Queda ligado a la entrada que lo originó (traza, punto (b) de §Post-F9.15).
    expect(cargos[0]?.refTipo).toBe('entrada-tela');
    expect(cargos[0]?.refId).toBe(entrada.id);
    expect(cargos[0]?.idArchivoCfdi).not.toBeNull();
    // El RFC del EMISOR viaja al cargo, igual que en una importación de CFDI de F9: es lo que el
    // reporte fiscal del contador imprime (sin él salía "—" según por dónde hubiera entrado).
    expect(cargos[0]?.rfcTercero).toBe('TNO850101BBB');
  });

  it('un cargo FISCAL sin RFC del emisor NO se confirma: la última red falla CERRADA', async () => {
    // Hoy este estado es inalcanzable —el mismo sello escribe `totalCfdi` y `rfcCfdi` juntos—, así
    // que se fabrica a mano tocando la fila. Es justo lo que la red existe para atajar: si mañana
    // apareciera un camino que sella sin RFC, el cargo fiscal nacería a nombre de nadie y el UUID
    // quedaría consumido para siempre. Una comprobación que no puede comprobar no deja pasar (A4).
    const entrada = await capturarConXml('abababab-abab-abab-abab-abababababab');
    await cliente.entradaTela.update({ where: { id: entrada.id }, data: { rfcCfdi: null } });

    await expect(confirmarEntradaTela(sesion(), entrada.id, bd())).rejects.toThrow(/RFC/);
    // Y nada quedó a medias: sin cargo, y la entrada sigue en borrador.
    expect(await cliente.movimientoTercero.count()).toBe(0);
    const enBd = await cliente.entradaTela.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBd.estatus).toBe('borrador');
  });

  it('NO se puede confirmar si Finanzas importó esa MISMA factura mientras tanto', async () => {
    const uuid = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const entrada = await capturarConXml(uuid);
    // Entre el guardado y la confirmación (pueden pasar días), alguien importa el CFDI a CxP: la
    // unique global del UUID reventaría con un P2002 opaco y la TELA no podría entrar al almacén.
    await cliente.movimientoTercero.create({
      data: {
        idEmpresa: empresa.id,
        folio: 1n,
        tipoTercero: 'proveedor',
        idProveedor: proveedor.id,
        fecha: new Date('2026-08-05T00:00:00.000Z'),
        origen: 'factura_proveedor',
        monto: 920,
        esFiscal: true,
        uuidCfdi: uuid,
      },
    });

    await expect(confirmarEntradaTela(sesion(), entrada.id, bd())).rejects.toThrow(
      /ya está registrada en Cuentas por pagar/,
    );
    // …y el mensaje dice la ÚNICA salida que de verdad existe. La anterior proponía dos caminos
    // imposibles ("cancela el movimiento en Finanzas" no libera el UUID —la unique es global y el
    // inverso no lo suelta— y "quítale la factura" ya no se puede: el uuid salió del PUT).
    await expect(confirmarEntradaTela(sesion(), entrada.id, bd())).rejects.toThrow(
      /CANCELA este borrador/,
    );
    // Y la entrada sigue en borrador (la transacción no dejó nada a medias).
    const despues = await cliente.entradaTela.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(despues.estatus).toBe('borrador');
  });

  it('cancelar la entrada cancela el cargo por su INVERSO (nunca lo borra, D3)', async () => {
    const entrada = await capturarConXml('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    await confirmarEntradaTela(sesion(), entrada.id, bd());

    await cancelarEntradaTela(sesion(), entrada.id, { motivo: 'La tela venía manchada' }, bd());

    const cargos = await cliente.movimientoTercero.findMany({ orderBy: { id: 'asc' } });
    expect(cargos).toHaveLength(2); // el original + su inverso
    expect(cargos[0]?.cancelado).toBe(true);
    expect(Number(cargos[1]?.monto)).toBe(-920);
    // El saldo del proveedor vuelve a cero: original + inverso suman 0.
    expect(cargos.reduce((s, c) => s + Number(c.monto), 0)).toBe(0);
  });

  it('SIN CFDI (remisión capturada a mano) NO se inventa cargo', async () => {
    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: 'Blanco' },
    });
    const idOrdenCompraLinea = await renglonOc();
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'R-77',
        idProveedor: proveedor.id,
        fecha: '2026-08-05',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: color.id, cantidad: 5, precioUnit: 10, idOrdenCompraLinea }],
      },
      bd(),
      archivosFalsos,
    );
    await confirmarEntradaTela(sesion(), entrada.id, bd());
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('RECHAZA subir un XML a un proveedor SIN RFC capturado (con los migrados era un NO-OP)', async () => {
    // El caso REAL del día 1: los 155 proveedores que sobreviven a la depuración (§Post-F9.23)
    // vienen del Access con TODO lo fiscal en 0 %, así que ninguno tiene RFC. Cuando la comparación
    // "el emisor debe ser el proveedor" solo corría *si el proveedor tenía RFC*, se podía leer el
    // XML de "Textiles del Norte", elegir a mano a este otro y confirmar → cargo FISCAL contra
    // quien no facturó, con el RFC del emisor pegado. Ahora se corta al guardar.
    const migrado = await cliente.proveedor.create({
      data: { nombre: 'Avios del Centro (migrado)' }, // rfc NULL, factura NULL (no-definida)
    });
    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: 'Arena' },
    });
    const idOrdenCompraLinea = await renglonOc();
    await expect(
      crearEntradaTela(
        sesion(),
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A-77',
          idProveedor: migrado.id,
          fecha: '2026-08-05',
          idAlmacen: almacen.id,
          xmlCfdi: xmlCfdi({
            emisorRfc: 'TNO850101BBB',
            receptorRfc: 'FRM900101AAA',
            uuid: 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
            conceptos: [{ descripcion: 'Felpa', cantidad: 1, valorUnitario: 1 }],
          }),
          lineas: [{ idTelaColor: color.id, cantidad: 1, precioUnit: 1, idOrdenCompraLinea }],
        },
        bd(),
        archivosFalsos,
      ),
    ).rejects.toThrow(/no tiene RFC capturado/);
    // Nada quedó escrito: ni la entrada, ni el cargo, ni el UUID consumido.
    expect(await cliente.entradaTela.count()).toBe(0);
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('rechaza el XML de un emisor que NO es el proveedor de la entrada', async () => {
    const otro = await cliente.proveedor.create({
      data: { nombre: 'Otro Proveedor', rfc: 'OTR990101ZZZ' },
    });
    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: 'Rojo' },
    });
    const idOrdenCompraLinea = await renglonOc();
    await expect(
      crearEntradaTela(
        sesion(),
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A-9',
          idProveedor: otro.id,
          fecha: '2026-08-05',
          idAlmacen: almacen.id,
          xmlCfdi: xmlCfdi({
            emisorRfc: 'TNO850101BBB',
            receptorRfc: 'FRM900101AAA',
            uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            conceptos: [{ descripcion: 'Felpa', cantidad: 1, valorUnitario: 1 }],
          }),
          lineas: [{ idTelaColor: color.id, cantidad: 1, precioUnit: 1, idOrdenCompraLinea }],
        },
        bd(),
        archivosFalsos,
      ),
    ).rejects.toThrow(/la entrada es del proveedor/);
    expect(await cliente.entradaTela.count()).toBe(0);
  });
});

describe('Proveedor que NO factura (§Post-F9.22)', () => {
  /**
   * Un tercero informal: se da de alta con «¿Cómo factura?» en *solo sin factura*.
   *
   * 🔴 Fila 0.124 — la intención se expresa con `modalidadFacturacion: 'solo_sin'`, que es HOY la
   * única fuente de verdad (`emiteFactura`). Antes esta fixture ponía `factura: false`: esa columna
   * ya no la lee nadie, así que el proveedor quedaba como "modalidad sin definir" —que NO es lo
   * mismo que "no factura"— y el dominio lo trataba como formal.
   */
  async function proveedorInformal() {
    return cliente.proveedor.create({
      data: { nombre: 'Talleres Don Chuy', modalidadFacturacion: 'solo_sin' },
    });
  }

  /**
   * El informal LISTO para recibirle: su proveedor, **su propia tela**, su color y el renglón de OC
   * autorizada contra el que se le va a recibir.
   *
   * 🔴 Desde §Post-F9.159(a) las tres cosas van juntas y la tela **tiene que ser suya**: no hay
   * entrada sin OC, la OC tiene que ser del MISMO proveedor que la factura
   * (`registrarRecepcionesDesdeEntradaTela`) y `crearOC` rechaza poner en ella la tela de otro dueño.
   * Antes, estas pruebas recibían la felpa de "Textiles del Norte" facturada por el informal —una
   * combinación que ya no puede existir.
   */
  async function informalListoParaRecibir(nombreTela: string, conComplemento = false) {
    const informal = await proveedorInformal();
    const tela = await cliente.tela.create({
      data: {
        nombre: nombreTela,
        idProveedor: informal.id,
        unidadMedida: 'KG',
        ...(conComplemento ? { nombreComplemento: 'Cardigan' } : {}),
      },
    });
    const color = await cliente.telaColor.create({ data: { idTela: tela.id, nombre: 'Único' } });
    const idOrdenCompraLinea = await renglonOc({
      idTela: tela.id,
      idProveedor: informal.id,
      conComplemento,
    });
    return { informal, color, idOrdenCompraLinea };
  }

  it('al confirmar le nace su CxP NO FISCAL, por la suma de los renglones capturados a mano', async () => {
    const { informal, color, idOrdenCompraLinea } =
      await informalListoParaRecibir('Manta Don Chuy');
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'NOTA-31',
        idProveedor: informal.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: color.id, cantidad: 12, precioUnit: 45.5, idOrdenCompraLinea }],
      },
      bd(),
      archivosFalsos,
    );
    expect(entrada.uuidCfdi).toBeNull();

    await confirmarEntradaTela(sesion(), entrada.id, bd());

    const cargos = await cliente.movimientoTercero.findMany();
    expect(cargos).toHaveLength(1);
    // 12 × 45.50 = 546. Sin IVA que sumar: esa suma ES lo que se le debe.
    expect(Number(cargos[0]?.monto)).toBe(546);
    expect(cargos[0]?.esFiscal).toBe(false);
    expect(cargos[0]?.uuidCfdi).toBeNull();
    expect(cargos[0]?.idProveedor).toBe(informal.id);
    expect(cargos[0]?.refTipo).toBe('entrada-tela');
  });

  it('el complemento (cardigan) también suma a lo que se le debe', async () => {
    const { informal, color, idOrdenCompraLinea } = await informalListoParaRecibir(
      'Felpa con Cardigan',
      true,
    );
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'NOTA-32',
        idProveedor: informal.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [
          {
            idTelaColor: color.id,
            cantidad: 10,
            precioUnit: 100,
            cantidadComplemento: 2,
            precioUnitComplemento: 50,
            idOrdenCompraLinea,
          },
        ],
      },
      bd(),
      archivosFalsos,
    );
    await confirmarEntradaTela(sesion(), entrada.id, bd());

    const cargos = await cliente.movimientoTercero.findMany();
    // 10×100 (cuerpo) + 2×50 (cardigan) = 1100.
    expect(Number(cargos[0]?.monto)).toBe(1100);
  });

  it('sin precios capturados NO se inventa una deuda de cero', async () => {
    const { informal, color, idOrdenCompraLinea } = await informalListoParaRecibir('Popelina Chuy');
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'NOTA-33',
        idProveedor: informal.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: color.id, cantidad: 7, idOrdenCompraLinea }],
      },
      bd(),
      archivosFalsos,
    );
    await confirmarEntradaTela(sesion(), entrada.id, bd());
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('cancelar la entrada también revierte el cargo NO fiscal', async () => {
    const { informal, color, idOrdenCompraLinea } =
      await informalListoParaRecibir('Gabardina Chuy');
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'remision',
        numeroDocumento: 'NOTA-34',
        idProveedor: informal.id,
        fecha: '2026-08-06',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor: color.id, cantidad: 4, precioUnit: 25, idOrdenCompraLinea }],
      },
      bd(),
      archivosFalsos,
    );
    await confirmarEntradaTela(sesion(), entrada.id, bd());
    await cancelarEntradaTela(sesion(), entrada.id, { motivo: 'Se devolvió' }, bd());

    const cargos = await cliente.movimientoTercero.findMany({ orderBy: { id: 'asc' } });
    expect(cargos).toHaveLength(2);
    expect(cargos.reduce((s, c) => s + Number(c.monto), 0)).toBe(0);
  });

  it('NO se le puede capturar el documento como FACTURA', async () => {
    const { informal, color, idOrdenCompraLinea } = await informalListoParaRecibir('Tafeta Chuy');
    await expect(
      crearEntradaTela(
        sesion(),
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'F-1',
          idProveedor: informal.id,
          fecha: '2026-08-06',
          idAlmacen: almacen.id,
          lineas: [{ idTelaColor: color.id, cantidad: 1, precioUnit: 1, idOrdenCompraLinea }],
        },
        bd(),
        archivosFalsos,
      ),
    ).rejects.toThrow(/NUNCA factura/);
    expect(await cliente.entradaTela.count()).toBe(0);
  });

  it('RECHAZA subirle un XML, aunque la pantalla lo hubiera dejado pasar', async () => {
    const informal = await cliente.proveedor.create({
      data: { nombre: 'Informal con RFC', rfc: 'TNO850101BBB', modalidadFacturacion: 'solo_sin' },
    });
    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: 'Café' },
    });
    // El renglón de OC es de "Textiles del Norte" y da igual: esta captura se rechaza ANTES, al
    // sellar el XML (el proveedor no factura). Va sólo para que el contrato pase (§Post-F9.159(a)).
    const idOrdenCompraLinea = await renglonOc();
    await expect(
      crearEntradaTela(
        sesion(),
        {
          tipoDocumento: 'remision',
          numeroDocumento: 'NOTA-35',
          idProveedor: informal.id,
          fecha: '2026-08-06',
          idAlmacen: almacen.id,
          xmlCfdi: xmlCfdi({
            emisorRfc: 'TNO850101BBB',
            receptorRfc: 'FRM900101AAA',
            uuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            conceptos: [{ descripcion: 'Felpa', cantidad: 1, valorUnitario: 1 }],
          }),
          lineas: [{ idTelaColor: color.id, cantidad: 1, precioUnit: 1, idOrdenCompraLinea }],
        },
        bd(),
        archivosFalsos,
      ),
    ).rejects.toThrow(/NUNCA factura/);
    expect(await cliente.entradaTela.count()).toBe(0);
  });

  it('RECHAZA tambien el UUID SUELTO (folio fiscal sin XML): era la puerta del doble cargo', async () => {
    // Sin XML pero con folio fiscal tecleado, el alta no pasaba por esta guarda: al confirmar nacía
    // un cargo NO fiscal (por precios capturados) SIN el uuid en el `MovimientoTercero`, y Finanzas
    // podía importar después ese mismo CFDI — dos cargos por la misma factura.
    const informal = await cliente.proveedor.create({
      data: { nombre: 'Informal con folio', modalidadFacturacion: 'solo_sin' },
    });
    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: 'Verde' },
    });
    // Igual que arriba: se rechaza antes de llegar al embudo, el renglón va para pasar el contrato.
    const idOrdenCompraLinea = await renglonOc();
    await expect(
      crearEntradaTela(
        sesion(),
        {
          tipoDocumento: 'remision',
          numeroDocumento: 'NOTA-36',
          idProveedor: informal.id,
          fecha: '2026-08-06',
          idAlmacen: almacen.id,
          uuidCfdi: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
          lineas: [{ idTelaColor: color.id, cantidad: 1, precioUnit: 1, idOrdenCompraLinea }],
        },
        bd(),
        archivosFalsos,
      ),
    ).rejects.toThrow(/NUNCA factura/);
    expect(await cliente.entradaTela.count()).toBe(0);
  });

  it('leer un CFDI de un proveedor marcado "no factura" AVISA para corregir el catálogo', async () => {
    await cliente.proveedor.update({
      where: { id: proveedor.id },
      data: { modalidadFacturacion: 'solo_sin' },
    });
    const propuesta = await leerCfdiParaEntradaTela(
      sesion(),
      {
        xml: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          conceptos: [{ descripcion: 'Felpa', cantidad: 1, valorUnitario: 1 }],
        }),
      },
      bd(),
    );
    expect(propuesta.avisos.some((a) => /NUNCA factura/.test(a))).toBe(true);
  });
});

describe('EDITAR el borrador NO puede perder ni desviar la factura (§Post-F9.21)', () => {
  const UUID = 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';

  /**
   * Captura un borrador CON su XML y devuelve el documento y el color usado.
   *
   * El COLOR se deriva del uuid: hay pruebas que llaman a este helper DOS veces (dos entradas con
   * facturas distintas) y `TelaColor` tiene unique `(idTela, nombre)` — con el nombre fijo, la
   * segunda llamada reventaba en el `create` y la prueba fallaba antes de llegar a lo que verifica.
   */
  async function borradorConFactura(uuid = UUID) {
    const color = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: `Marino ${uuid.slice(0, 8)}` },
    });
    // §Post-F9.159(a): la entrada nace contra su OC, y el renglón viaja de vuelta porque cada
    // prueba de EDICIÓN lo tiene que volver a mandar (el PUT reemplaza los renglones completos).
    const idOrdenCompraLinea = await renglonOc();
    const entrada = await crearEntradaTela(
      sesion(),
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'A1045',
        idProveedor: proveedor.id,
        fecha: '2026-08-05',
        idAlmacen: almacen.id,
        xmlCfdi: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid,
          conceptos: [{ descripcion: 'FELPA PERCHADA', cantidad: 10, valorUnitario: 92 }],
        }),
        lineas: [{ idTelaColor: color.id, cantidad: 10, precioUnit: 92, idOrdenCompraLinea }],
      },
      bd(),
      archivosFalsos,
    );
    return { entrada, idTelaColor: color.id, idOrdenCompraLinea };
  }

  it('editar SIN volver a subir el XML conserva el sello, y la CxP sí nace al confirmar', async () => {
    const { entrada, idTelaColor, idOrdenCompraLinea } = await borradorConFactura();

    // Así edita la pantalla un borrador: cabecera + renglones, sin el XML (que ya está guardado).
    const editada = await actualizarEntradaTela(
      sesion(),
      entrada.id,
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'A1045',
        idProveedor: proveedor.id,
        fecha: '2026-08-05',
        idAlmacen: almacen.id,
        lineas: [{ idTelaColor, cantidad: 12, precioUnit: 92, idOrdenCompraLinea }],
      },
      bd(),
    );

    expect(editada.uuidCfdi).toBe(UUID);
    expect(editada.totalCfdi).toBe(920);
    const enBd = await cliente.entradaTela.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBd.idArchivoCfdi).not.toBeNull();
    expect(enBd.rfcCfdi).toBe('TNO850101BBB');

    await confirmarEntradaTela(sesion(), entrada.id, bd());
    const cargos = await cliente.movimientoTercero.findMany();
    expect(cargos).toHaveLength(1);
    expect(cargos[0]?.esFiscal).toBe(true);
    expect(Number(cargos[0]?.monto)).toBe(920);
    expect(cargos[0]?.rfcTercero).toBe('TNO850101BBB');
  });

  it('editar NO puede cambiar el proveedor dejando amarrada la factura de otro', async () => {
    const { entrada, idTelaColor, idOrdenCompraLinea } = await borradorConFactura();
    const otro = await cliente.proveedor.create({
      data: { nombre: 'Avios del Centro', rfc: 'ACE010101QQQ' },
    });

    await expect(
      actualizarEntradaTela(
        sesion(),
        entrada.id,
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A1045',
          idProveedor: otro.id,
          fecha: '2026-08-05',
          idAlmacen: almacen.id,
          lineas: [{ idTelaColor, cantidad: 10, precioUnit: 92, idOrdenCompraLinea }],
        },
        bd(),
      ),
    ).rejects.toThrow(/quedaría a nombre del proveedor/);

    // Nada cambió: ni el proveedor ni el sello.
    const enBd = await cliente.entradaTela.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBd.idProveedor).toBe(proveedor.id);
    expect(enBd.uuidCfdi).toBe(UUID);
  });

  it('editar tampoco puede pasársela a un proveedor SIN RFC (el hueco de los migrados)', async () => {
    // Mismo agujero que al dar de alta, por la otra puerta: el sello ya está guardado y la edición
    // solo cambia el proveedor. Como el migrado no tiene RFC, la comparación contra `rfcCfdi` se
    // saltaba sola y al confirmar nacía el cargo FISCAL contra él, con el RFC de Textiles del Norte.
    const { entrada, idTelaColor, idOrdenCompraLinea } = await borradorConFactura();
    const migrado = await cliente.proveedor.create({
      data: { nombre: 'Avios del Centro (migrado)' }, // rfc NULL
    });

    await expect(
      actualizarEntradaTela(
        sesion(),
        entrada.id,
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A1045',
          idProveedor: migrado.id,
          fecha: '2026-08-05',
          idAlmacen: almacen.id,
          lineas: [{ idTelaColor, cantidad: 10, precioUnit: 92, idOrdenCompraLinea }],
        },
        bd(),
      ),
    ).rejects.toThrow(/no tiene RFC capturado/);

    // El documento sigue con su proveedor y su sello intactos.
    const enBd = await cliente.entradaTela.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBd.idProveedor).toBe(proveedor.id);
    expect(enBd.uuidCfdi).toBe(UUID);
  });

  it('editar tampoco puede dejársela a un proveedor que NO factura', async () => {
    const { entrada, idTelaColor, idOrdenCompraLinea } = await borradorConFactura();
    const informal = await cliente.proveedor.create({
      data: { nombre: 'Talleres Don Chuy', modalidadFacturacion: 'solo_sin' },
    });

    await expect(
      actualizarEntradaTela(
        sesion(),
        entrada.id,
        {
          tipoDocumento: 'remision',
          numeroDocumento: 'NOTA-9',
          idProveedor: informal.id,
          fecha: '2026-08-05',
          idAlmacen: almacen.id,
          lineas: [{ idTelaColor, cantidad: 10, precioUnit: 92, idOrdenCompraLinea }],
        },
        bd(),
      ),
    ).rejects.toThrow(/NUNCA factura/);
  });

  it('editar CON un XML nuevo re-sella (y pasa por las MISMAS guardas del alta)', async () => {
    const { entrada, idTelaColor, idOrdenCompraLinea } = await borradorConFactura();
    const uuidNuevo = 'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2';

    const editada = await actualizarEntradaTela(
      sesion(),
      entrada.id,
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'A1046',
        idProveedor: proveedor.id,
        fecha: '2026-08-05',
        idAlmacen: almacen.id,
        xmlCfdi: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid: uuidNuevo,
          conceptos: [{ descripcion: 'FELPA PERCHADA', cantidad: 5, valorUnitario: 100 }],
        }),
        lineas: [{ idTelaColor, cantidad: 5, precioUnit: 100, idOrdenCompraLinea }],
      },
      bd(),
      archivosFalsos,
    );

    expect(editada.uuidCfdi).toBe(uuidNuevo);
    expect(editada.totalCfdi).toBe(500); // el total lo dice el XML, nunca el cliente

    // Y el XML de OTRO emisor se sigue rechazando al editar, igual que al dar de alta.
    await expect(
      actualizarEntradaTela(
        sesion(),
        entrada.id,
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A1047',
          idProveedor: proveedor.id,
          fecha: '2026-08-05',
          idAlmacen: almacen.id,
          xmlCfdi: xmlCfdi({
            emisorRfc: 'XXX010101YYY',
            receptorRfc: 'FRM900101AAA',
            uuid: 'f3f3f3f3-f3f3-f3f3-f3f3-f3f3f3f3f3f3',
            conceptos: [{ descripcion: 'FELPA', cantidad: 1, valorUnitario: 1 }],
          }),
          lineas: [{ idTelaColor, cantidad: 1, precioUnit: 1, idOrdenCompraLinea }],
        },
        bd(),
        archivosFalsos,
      ),
    ).rejects.toThrow(/la entrada es del proveedor/);
  });

  it('re-sellar con el XML de una factura YA capturada en otra entrada da conflicto legible', async () => {
    const primera = await borradorConFactura();
    const segunda = await borradorConFactura('f4f4f4f4-f4f4-f4f4-f4f4-f4f4f4f4f4f4');

    await expect(
      actualizarEntradaTela(
        sesion(),
        segunda.entrada.id,
        {
          tipoDocumento: 'factura',
          numeroDocumento: 'A1045',
          idProveedor: proveedor.id,
          fecha: '2026-08-05',
          idAlmacen: almacen.id,
          xmlCfdi: xmlCfdi({
            emisorRfc: 'TNO850101BBB',
            receptorRfc: 'FRM900101AAA',
            uuid: UUID, // el de la PRIMERA entrada
            conceptos: [{ descripcion: 'FELPA PERCHADA', cantidad: 10, valorUnitario: 92 }],
          }),
          lineas: [
            {
              idTelaColor: segunda.idTelaColor,
              cantidad: 10,
              precioUnit: 92,
              idOrdenCompraLinea: segunda.idOrdenCompraLinea,
            },
          ],
        },
        bd(),
        archivosFalsos,
      ),
    ).rejects.toThrow(/ya se capturó en la entrada/);
    expect(primera.entrada.uuidCfdi).toBe(UUID);
  });

  it('volver a subir el MISMO XML a la MISMA entrada no se toma por duplicado', async () => {
    const { entrada, idTelaColor, idOrdenCompraLinea } = await borradorConFactura();

    const editada = await actualizarEntradaTela(
      sesion(),
      entrada.id,
      {
        tipoDocumento: 'factura',
        numeroDocumento: 'A1045',
        idProveedor: proveedor.id,
        fecha: '2026-08-05',
        idAlmacen: almacen.id,
        xmlCfdi: xmlCfdi({
          emisorRfc: 'TNO850101BBB',
          receptorRfc: 'FRM900101AAA',
          uuid: UUID,
          conceptos: [{ descripcion: 'FELPA PERCHADA', cantidad: 10, valorUnitario: 92 }],
        }),
        lineas: [{ idTelaColor, cantidad: 10, precioUnit: 92, idOrdenCompraLinea }],
      },
      bd(),
      archivosFalsos,
    );
    expect(editada.uuidCfdi).toBe(UUID);
  });
});
