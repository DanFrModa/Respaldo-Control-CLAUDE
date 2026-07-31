/**
 * Tests de INTEGRACIÓN del IMPORTADOR del pedido del cliente (rediseño R8, B15) contra el Postgres
 * efímero (testcontainers). Cubre lo que pidió la ficha:
 *  • PLANTILLA versionada — guardar v1, guardar v2 (baja la vigente anterior; una vigente por cliente),
 *  • PARSEO + MAPEO del Excel (exceljs) → agrupa por modelo del cliente,
 *  • RECONOCIMIENTO por `Desarrollo.numeroCliente` (normalizado): reconocido / no-reconocido,
 *  • VISTA PREVIA (analizar) con la plantilla vigente pre-aplicada,
 *  • ALTA TRANSACCIONAL (confirmar): pedido interno + OPs con matriz + RC (evento outbox), con un
 *    no-reconocido resuelto a mano. (El adjunto de la OC lo sube el CLIENTE por el flujo presigned
 *    DESPUÉS del confirm — no es parte de esta transacción; ver el módulo).
 *  • TRANSACCIONALIDAD (A2): un modelo reconocido con color inexistente → rollback TOTAL,
 *  • ROLLBACK a MITAD del loop: 2 reconocidos, el 2º descontinuado → ni el pedido ni la 1ª OP ya
 *    creadas persisten (prueba real de A2, no un abort antes de crear nada).
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  analizarImportacion,
  confirmarImportacion,
  guardarPlantilla,
  obtenerPlantillaVigente,
} from './importacion.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idClienteNegocio: number;

const PERMISOS: ClavePermiso[] = [
  'ordenes.ver',
  'ordenes.administrar',
  'pedidos.ver',
  'pedidos.administrar',
  'pedidos.importes',
];

const sesion = (): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...PERMISOS] });
const bd = () => ({ cliente });

/** Columnas del archivo demo (estilo C&A: Estilo · Color · Talla · Piezas · Precio). */
const MAPEO_DEMO = [
  { indice: 0, columna: 'Estilo', rol: 'modeloCliente' as const },
  { indice: 1, columna: 'Color', rol: 'color' as const },
  { indice: 2, columna: 'Talla', rol: 'talla' as const },
  { indice: 3, columna: 'Piezas', rol: 'cantidad' as const },
  { indice: 4, columna: 'Precio', rol: 'precio' as const },
];

/** Construye un .xlsx en memoria y lo devuelve como base64 (lo que viaja por la API). */
async function construirXlsxBase64(filas: (string | number)[][]): Promise<string> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('OC');
  hoja.addRow(['Estilo', 'Color', 'Talla', 'Piezas', 'Precio']);
  for (const fila of filas) hoja.addRow(fila);
  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer).toString('base64');
}

/** Filas del archivo demo: CA-KM-114 y CA-KM-115 reconocidos; CA-KM-999 sin reconocer. */
const FILAS_DEMO: (string | number)[][] = [
  ['CA-KM-114', 'Rojo', 'CH', 400, 168],
  ['CA-KM-114', 'Rojo', 'M', 600, 168],
  ['CA-KM-114', 'Azul marino', 'G', 500, 168],
  ['CA-KM-115', 'Negro', 'CH', 300, 154],
  ['CA-KM-115', 'Negro', 'M', 400, 154],
  ['CA-KM-999', 'Blanco', 'M', 200, 140],
];

/**
 * Crea un modelo + su desarrollo (proyecto/departamento del cliente) y devuelve sus ids.
 *
 * El modelo nace PELADO a propósito (sin receta de avíos y con `llevaArte` en su default `true`),
 * que es el caso REAL del importador: Daniel crea los modelos al capturar el pedido y la receta se
 * llena después. Consecuencia esperada: las OP que salgan de aquí nacen `capturada` con "Falta:
 * avíos y arte" — es el estado automático (`dominio/produccion/requisitos-orden.ts`), NO un fallo
 * del importador, y no impide operarlas. El estado se prueba en `produccion/ordenes.int.test.ts`.
 */
async function sembrarDesarrollo(
  codigoModelo: string,
  numeroCliente: string | null,
): Promise<{ idModelo: number; idDesarrollo: number }> {
  const modelo = await cliente.modelo.create({ data: { codigo: codigoModelo } });
  const depto = await cliente.clienteDepartamento.create({
    data: { idCliente: idClienteNegocio, nombre: `Depto ${codigoModelo}` },
  });
  const proyecto = await cliente.proyecto.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idCliente: idClienteNegocio,
      idClienteDepartamento: depto.id,
      nombre: `Proyecto ${codigoModelo}`,
    },
  });
  const desarrollo = await cliente.desarrollo.create({
    data: { idProyecto: proyecto.id, idModelo: modelo.id, numeroCliente },
  });
  return { idModelo: modelo.id, idDesarrollo: desarrollo.id };
}

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const empresa = await crearEmpresaPrueba(cliente);
  idEmpresa = empresa.id;
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  idClienteNegocio = clienteNegocio.id;
  // Catálogo de colores/tallas que el archivo referencia (por nombre normalizado).
  for (const nombre of ['Rojo', 'Azul marino', 'Negro', 'Blanco']) {
    await cliente.color.create({ data: { nombre } });
  }
  let orden = 0;
  for (const etiqueta of ['CH', 'M', 'G']) {
    await cliente.talla.create({ data: { etiqueta, orden: orden++ } });
  }
});

describe('plantilla de importación (versionada, una vigente)', () => {
  it('guardar v2 baja la vigente anterior; obtenerPlantillaVigente devuelve la última', async () => {
    const v1 = await guardarPlantilla(sesion(), idClienteNegocio, { mapeo: MAPEO_DEMO }, bd());
    expect(v1.version).toBe(1);
    expect(v1.vigente).toBe(true);

    const v2 = await guardarPlantilla(
      sesion(),
      idClienteNegocio,
      { nombre: 'Formato nuevo', mapeo: MAPEO_DEMO },
      bd(),
    );
    expect(v2.version).toBe(2);
    expect(v2.vigente).toBe(true);

    const vigente = await obtenerPlantillaVigente(sesion(), idClienteNegocio, bd());
    expect(vigente.plantilla?.id).toBe(v2.id);
    // Sólo UNA vigente por cliente.
    const vigentes = await cliente.plantillaImportacion.count({
      where: { idCliente: idClienteNegocio, vigente: true },
    });
    expect(vigentes).toBe(1);
  });
});

describe('analizar / vista previa', () => {
  it('devuelve columnas y, con plantilla vigente, la vista previa con reconocidos/no', async () => {
    await sembrarDesarrollo('DEV-114', 'CA-KM-114');
    await sembrarDesarrollo('DEV-115', 'CA-KM-115');
    await guardarPlantilla(sesion(), idClienteNegocio, { mapeo: MAPEO_DEMO }, bd());
    const archivoBase64 = await construirXlsxBase64(FILAS_DEMO);

    const salida = await analizarImportacion(
      sesion(),
      { idCliente: idClienteNegocio, nombreArchivo: 'oc.xlsx', archivoBase64 },
      bd(),
    );

    expect(salida.columnas).toEqual(['Estilo', 'Color', 'Talla', 'Piezas', 'Precio']);
    expect(salida.totalFilas).toBe(6);
    expect(salida.plantillaVigente).not.toBeNull();
    expect(salida.preview).not.toBeNull();
    const preview = salida.preview as NonNullable<typeof salida.preview>;
    expect(preview.totalGrupos).toBe(3);
    expect(preview.totalReconocidos).toBe(2);
    const noReconocido = preview.grupos.find((g) => g.modeloCliente === 'CA-KM-999');
    expect(noReconocido?.reconocido).toBe(false);
    const reconocido = preview.grupos.find((g) => g.modeloCliente === 'CA-KM-114');
    expect(reconocido?.reconocido).toBe(true);
    expect(reconocido?.totalPiezas).toBe(1500);
    expect(reconocido?.coloresNoResueltos).toEqual([]);
  });

  it('sin mapeo ni plantilla vigente: columnas sí, preview null', async () => {
    const archivoBase64 = await construirXlsxBase64(FILAS_DEMO);
    const salida = await analizarImportacion(
      sesion(),
      { idCliente: idClienteNegocio, nombreArchivo: 'oc.xlsx', archivoBase64 },
      bd(),
    );
    expect(salida.columnas.length).toBe(5);
    expect(salida.preview).toBeNull();
    expect(salida.plantillaVigente).toBeNull();
  });
});

describe('confirmar importación (alta transaccional)', () => {
  it('crea el pedido + una OP por modelo reconocido; el no-reconocido queda fuera', async () => {
    const dev114 = await sembrarDesarrollo('DEV-114', 'CA-KM-114');
    await sembrarDesarrollo('DEV-115', 'CA-KM-115');
    const archivoBase64 = await construirXlsxBase64(FILAS_DEMO);

    const resultado = await confirmarImportacion(
      sesion(),
      {
        idCliente: idClienteNegocio,
        nombreArchivo: 'OC C&A julio.xlsx',
        archivoBase64,
        mapeo: MAPEO_DEMO,
        ocCliente: 'OC-CA-4471',
        resoluciones: [],
      },
      bd(),
    );

    // Nació el pedido con 2 OPs (114, 115); CA-KM-999 quedó fuera.
    expect(resultado.ordenes).toHaveLength(2);
    expect(resultado.noReconocidos).toEqual(['CA-KM-999']);
    // Devuelve idPedido para que el cliente le suba el adjunto (OC) por el flujo presigned.
    expect(resultado.idPedido).toBeGreaterThan(0);

    // Cada OP: snapshot de la OC, matriz con piezas y liga al desarrollo.
    const op114 = resultado.ordenes.find((o) => o.modeloCliente === 'CA-KM-114');
    expect(op114).toBeDefined();
    expect(op114?.totalPiezas).toBe(1500);
    const orden114 = await cliente.orden.findUnique({
      where: { id: op114?.idOrden ?? 0 },
      include: { lineas: { include: { tallas: true } } },
    });
    expect(orden114?.ocCliente).toBe('OC-CA-4471');
    // 2 colores (Rojo, Azul marino) en la matriz.
    expect(orden114?.lineas).toHaveLength(2);
    const liga = await cliente.desarrolloOrden.findUnique({
      where: { idOrden: op114?.idOrden ?? 0 },
    });
    expect(liga?.idDesarrollo).toBe(dev114.idDesarrollo);

    // Nº de producción minteado y RC encolada (un evento por OP).
    expect(op114?.numeroProduccion).toBeGreaterThan(0);
    const eventos = await cliente.eventoOutbox.count({ where: { tipo: 'orden-creada' } });
    expect(eventos).toBe(2);
  });

  it('con resolución MANUAL del no-reconocido: nacen las 3 OPs', async () => {
    await sembrarDesarrollo('DEV-114', 'CA-KM-114');
    await sembrarDesarrollo('DEV-115', 'CA-KM-115');
    // Desarrollo sin numeroCliente (no auto-reconocible): se liga a mano.
    const dev999 = await sembrarDesarrollo('DEV-999', null);
    const archivoBase64 = await construirXlsxBase64(FILAS_DEMO);

    const resultado = await confirmarImportacion(
      sesion(),
      {
        idCliente: idClienteNegocio,
        nombreArchivo: 'oc.xlsx',
        archivoBase64,
        mapeo: MAPEO_DEMO,
        resoluciones: [{ modeloCliente: 'CA-KM-999', idDesarrollo: dev999.idDesarrollo }],
      },
      bd(),
    );

    expect(resultado.ordenes).toHaveLength(3);
    expect(resultado.noReconocidos).toEqual([]);
  });

  it('A2: un modelo reconocido con COLOR inexistente → rollback TOTAL (ni pedido, ni OP)', async () => {
    await sembrarDesarrollo('DEV-114', 'CA-KM-114');
    // El archivo usa un color que NO está en el catálogo.
    const archivoBase64 = await construirXlsxBase64([['CA-KM-114', 'Fucsia neón', 'CH', 100, 168]]);

    await expect(
      confirmarImportacion(
        sesion(),
        {
          idCliente: idClienteNegocio,
          nombreArchivo: 'oc.xlsx',
          archivoBase64,
          mapeo: MAPEO_DEMO,
          resoluciones: [],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(await cliente.pedido.count()).toBe(0);
    expect(await cliente.orden.count()).toBe(0);
    expect(await cliente.eventoOutbox.count({ where: { tipo: 'orden-creada' } })).toBe(0);
  });

  it('A2: falla a MITAD del loop (2º modelo descontinuado) → rollback del pedido y de la 1ª OP YA creada', async () => {
    // Dos modelos RECONOCIDOS; el 1º (114) genera su OP bien, el 2º (115) está descontinuado
    // (`Modelo.activo=false`): se reconoce y pasa la vista previa (colores/tallas sí existen), pero
    // `crearOrden` lo rechaza DENTRO del loop, DESPUÉS de que el pedido y la 1ª OP ya se crearon en
    // la MISMA tx → debe revertirse TODO (no queda pedido ni la 1ª OP). Prueba REAL de A2 (el error
    // ocurre a media tanda, no antes de crear nada).
    await sembrarDesarrollo('DEV-114', 'CA-KM-114');
    const dev115 = await sembrarDesarrollo('DEV-115', 'CA-KM-115');
    await cliente.modelo.update({ where: { id: dev115.idModelo }, data: { activo: false } });

    const archivoBase64 = await construirXlsxBase64([
      ['CA-KM-114', 'Rojo', 'CH', 400, 168],
      ['CA-KM-115', 'Negro', 'M', 300, 154],
    ]);

    await expect(
      confirmarImportacion(
        sesion(),
        {
          idCliente: idClienteNegocio,
          nombreArchivo: 'oc.xlsx',
          archivoBase64,
          mapeo: MAPEO_DEMO,
          resoluciones: [],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // NADA persistió: ni el pedido, ni la 1ª OP (CA-KM-114), ni sus eventos.
    expect(await cliente.pedido.count()).toBe(0);
    expect(await cliente.orden.count()).toBe(0);
    expect(await cliente.eventoOutbox.count({ where: { tipo: 'orden-creada' } })).toBe(0);
  });

  it('ningún modelo reconocido → ErrorValidacion y nada se crea', async () => {
    const archivoBase64 = await construirXlsxBase64([['CA-KM-999', 'Blanco', 'M', 200, 140]]);
    await expect(
      confirmarImportacion(
        sesion(),
        {
          idCliente: idClienteNegocio,
          nombreArchivo: 'oc.xlsx',
          archivoBase64,
          mapeo: MAPEO_DEMO,
          resoluciones: [],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.pedido.count()).toBe(0);
  });
});
