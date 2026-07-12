/**
 * Tests de INTEGRACIÓN del IMPORTADOR de OC por PDF (petición Daniel — plantilla C&A) contra el
 * Postgres efímero (testcontainers), usando el fixture REAL `__fixtures__/cya-620884.pdf`. Cubre:
 *  • CONFIRMAR 1 PDF: nace el pedido + su OP con matriz (color BLANCO × 6 tallas, resuelto-o-creado),
 *    el nº de orden de C&A en `Orden.ocCliente`, el departamento (División) + las referencias (D7)
 *    configuradas, el PDF ADJUNTO a la OP, y la LIGA aprendida (modelo del cliente → nuestro modelo),
 *  • MULTI-PDF → UN pedido con 2 OPs (resurtido), catálogos REUSADOS (color/talla no se duplican),
 *  • APRENDIZAJE: con la liga ya guardada, `analizar` la PROPONE y `confirmar` corre sin liga manual,
 *  • SIN liga (ni aprendida ni manual) → no se importa nada (error claro),
 *  • A2: un modelo descontinuado revierta TODA la transacción (ni pedido, ni OP, ni catálogos creados),
 *  • IDEMPOTENCIA de catálogos (color/talla/departamento/campo ya existentes se REUSAN),
 *  • RBAC: confirmar sin `ordenes.administrar` → denegado.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { analizarImportacionPdf, confirmarImportacionPdf } from './importacion-pdf.js';

const PDF_BASE64 = readFileSync(
  fileURLToPath(new URL('./__fixtures__/cya-620884.pdf', import.meta.url)),
).toString('base64');

/** El PDF de C&A del fixture como archivo de entrada. `n` distingue nombres en el multi-PDF. */
function archivoPdf(n = 1): { nombreArchivo: string; archivoBase64: string } {
  return { nombreArchivo: `OC-${n}.pdf`, archivoBase64: PDF_BASE64 };
}

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

const sesion = (permisos: ClavePermiso[] = PERMISOS): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...permisos] });
const bd = () => ({ cliente });

/** Servicio de archivos FALSO: `subirContenido` devuelve metadatos (key única), sin tocar R2. */
function archivosFalsos(): ServicioArchivos {
  let n = 0;
  return {
    solicitarSubida() {
      throw new Error('Este flujo usa subirContenido (server-side), no solicitarSubida.');
    },
    subirContenido(solicitud) {
      n += 1;
      return Promise.resolve({
        bucket: 'control-v2-prueba',
        key: `ordenes/fake/${n}/${solicitud.nombreOriginal}`,
        nombreOriginal: solicitud.nombreOriginal,
        tipoMime: solicitud.tipoMime,
        tamanoBytes: solicitud.contenido.byteLength,
      });
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

/** Crea un modelo del catálogo y devuelve su id. */
async function crearModelo(codigo: string): Promise<number> {
  const modelo = await cliente.modelo.create({ data: { codigo } });
  return modelo.id;
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
});

describe('confirmar importación por PDF (1 PDF)', () => {
  it('crea el pedido + la OP con matriz/adjunto/referencias/departamento + aprende la liga', async () => {
    const idModelo = await crearModelo('DEV-CYA-1');

    const res = await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [archivoPdf()],
        ligas: [{ modeloCliente: '3138277', idModelo }],
      },
      bd(),
      archivosFalsos(),
    );

    expect(res.ordenes).toHaveLength(1);
    expect(res.noReconocidos).toHaveLength(0);
    expect(res.ligasAprendidas).toBe(1);
    const orden0 = res.ordenes[0]!;
    expect(orden0.numeroOrden).toBe('620884');
    expect(orden0.totalPiezas).toBe(1903);
    expect(orden0.adjuntado).toBe(true);

    // La OP: nº de orden de C&A en ocCliente, composición del PDF, matriz color×talla.
    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: orden0.idOrden },
      include: { lineas: { include: { tallas: true } }, archivos: true, referencias: true },
    });
    expect(orden.ocCliente).toBe('620884');
    expect(orden.composicion).toContain('ALGOD');
    expect(orden.lineas).toHaveLength(1); // un solo color (BLANCO)
    expect(orden.lineas[0]!.tallas).toHaveLength(6);
    const piezas = orden.lineas[0]!.tallas.reduce((s, t) => s + t.cantidad, 0);
    expect(piezas).toBe(1903);
    // La OC real de C&A NO trae pantone → el color de la OP queda sin pantone.
    expect(orden.lineas[0]!.pantone).toBeNull();
    // El desglose SKU/packs del cliente quedó persistido con la orden (aun sin % adicional).
    expect(orden.packsCliente).not.toBeNull();
    // El PDF quedó adjunto a SU orden.
    expect(orden.archivos).toHaveLength(1);

    // Color y tallas se resolvieron-o-crearon (D14c: colores abiertos capturados en la OP).
    const color = await cliente.color.findFirst({
      where: { nombre: { equals: 'BLANCO', mode: 'insensitive' } },
    });
    expect(color).not.toBeNull();
    const tallas = await cliente.talla.findMany({ where: { etiqueta: { in: ['5-6', '13-14'] } } });
    expect(tallas).toHaveLength(2);

    // División → departamento del cliente.
    const depto = await cliente.clienteDepartamento.findFirst({
      where: { idCliente: idClienteNegocio, nombre: { equals: '3- KIDS', mode: 'insensitive' } },
    });
    expect(depto).not.toBeNull();

    // Referencias (D7) configuradas (defaults C&A). La Sub División es "34- NIÑO" (valor-antes-de-etiqueta).
    const refs = await cliente.ordenReferencia.findMany({
      where: { idOrden: orden0.idOrden },
      orderBy: { id: 'asc' },
      include: { clienteCampo: true },
    });
    const etiquetas = [...refs.map((r) => r.clienteCampo.etiqueta)].sort();
    expect(etiquetas).toEqual([
      'Código único',
      'Descripción C&A',
      'División',
      'Modelo ID',
      'Pedido cliente',
      'Semana C&A',
      'Sub División',
    ]);
    // PRECISIÓN de Daniel: la referencia PRINCIPAL (la PRIMERA, la que el Centro pinta como "Pedido
    // cliente") = el NÚMERO DE ORDEN de C&A (620884), NO el Modelo ID.
    expect(refs[0]!.clienteCampo.etiqueta).toBe('Pedido cliente');
    expect(refs[0]!.valor).toBe('620884');
    const semana = refs.find((r) => r.clienteCampo.etiqueta === 'Semana C&A');
    expect(semana?.valor).toBe('202646');
    const subDiv = refs.find((r) => r.clienteCampo.etiqueta === 'Sub División');
    expect(subDiv?.valor).toBe('34- NIÑO');
    // Modelo ID queda como referencia ADICIONAL (información), no como la principal.
    const modeloRef = refs.find((r) => r.clienteCampo.etiqueta === 'Modelo ID');
    expect(modeloRef?.valor).toBe('3138277');

    // El renglón del pedido: precio (FOB) y cantidad = Σ tallas.
    const linea = await cliente.pedidoLinea.findFirstOrThrow({ where: { idPedido: res.idPedido } });
    expect(Number(linea.precio)).toBe(97);
    expect(linea.cantidadPedida).toBe(1903);
    expect(linea.idModelo).toBe(idModelo);

    // La liga quedó aprendida.
    const liga = await cliente.clienteModeloLiga.findUnique({
      where: { idCliente_modeloCliente: { idCliente: idClienteNegocio, modeloCliente: '3138277' } },
    });
    expect(liga?.idModelo).toBe(idModelo);

    // Nº interno de producción minteado al modelo (primera salida).
    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id: idModelo } });
    expect(modelo.numeroProduccion).not.toBeNull();
    // Evento outbox de la RC (orden-creada) encolado.
    const eventos = await cliente.eventoOutbox.count();
    expect(eventos).toBeGreaterThanOrEqual(1);
  });
});

describe('confirmar importación por PDF (multi-PDF)', () => {
  it('dos PDFs → UN pedido con 2 OPs (resurtido) y catálogos REUSADOS', async () => {
    const idModelo = await crearModelo('DEV-CYA-2');

    const res = await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [archivoPdf(1), archivoPdf(2)],
        ligas: [{ modeloCliente: '3138277', idModelo }],
      },
      bd(),
      archivosFalsos(),
    );

    expect(res.ordenes).toHaveLength(2);
    expect(res.ligasAprendidas).toBe(1); // el 2º upsert es no-op (misma liga)

    // UN solo pedido con 2 renglones y 2 OPs.
    const pedidos = await cliente.pedido.count();
    expect(pedidos).toBe(1);
    const lineas = await cliente.pedidoLinea.count({ where: { idPedido: res.idPedido } });
    expect(lineas).toBe(2);
    const adjuntos = await cliente.ordenArchivo.count();
    expect(adjuntos).toBe(2);

    // El color BLANCO y la talla 5-6 se crearon UNA vez y se reusaron en la 2ª OP.
    const colores = await cliente.color.count({
      where: { nombre: { equals: 'BLANCO', mode: 'insensitive' } },
    });
    expect(colores).toBe(1);
    const tallas56 = await cliente.talla.count({ where: { etiqueta: '5-6' } });
    expect(tallas56).toBe(1);
  });
});

describe('sobre-pedido por packs (C&A = 7%)', () => {
  it('la matriz de la OP usa la PROPUESTA por packs (7% al nº de packs); el renglón conserva lo pedido', async () => {
    const idModelo = await crearModelo('DEV-CYA-PCT');

    const res = await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [archivoPdf()],
        ligas: [{ modeloCliente: '3138277', idModelo }],
        porcentajeAdicional: 7,
      },
      bd(),
      archivosFalsos(),
    );

    // La OP reporta las piezas A FABRICAR (propuesta por packs): 2032 (1903 pedidas).
    expect(res.ordenes[0]!.totalPiezas).toBe(2032);

    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: res.ordenes[0]!.idOrden },
      include: { lineas: { include: { tallas: { include: { talla: true } } } } },
    });
    const porTalla = new Map(
      orden.lineas[0]!.tallas.map((t) => [t.talla.etiqueta, t.cantidad] as const),
    );
    // Totales por talla del sobre-pedido por packs (packs A 119→127, B 57→61, SKU +7%).
    expect(porTalla.get('5-6')).toBe(326);
    expect(porTalla.get('6-7')).toBe(134);
    expect(porTalla.get('7-8')).toBe(138);
    expect(porTalla.get('9-10')).toBe(521);
    expect(porTalla.get('11-12')).toBe(523);
    expect(porTalla.get('13-14')).toBe(390);
    const totalMatriz = orden.lineas[0]!.tallas.reduce((s, t) => s + t.cantidad, 0);
    expect(totalMatriz).toBe(2032);

    // El RENGLÓN del pedido conserva la cantidad ORIGINAL del cliente (lo contractual) y el precio.
    const linea = await cliente.pedidoLinea.findFirstOrThrow({ where: { idPedido: res.idPedido } });
    expect(linea.cantidadPedida).toBe(1903);
    expect(Number(linea.precio)).toBe(97);

    // El desglose SKU/packs del cliente quedó PERSISTIDO con la orden (base del módulo de empaque).
    const packs = orden.packsCliente as {
      tabla: { sku: string; talla: string; piezas: number }[];
      grupos: { grupo: string; tipo: string; totalPacks: number }[];
    } | null;
    expect(packs).not.toBeNull();
    expect(packs?.tabla).toHaveLength(6);
    expect(packs?.grupos.map((g) => g.grupo)).toEqual(['A', 'B', 'C']);

    // El % adicional queda RECORDADO en la plantilla del cliente (formato pdf-cya).
    const plantilla = await cliente.plantillaImportacion.findFirst({
      where: { idCliente: idClienteNegocio, vigente: true },
    });
    expect(plantilla?.formato).toBe('pdf-cya');
    expect(Number(plantilla?.porcentajeAdicional)).toBe(7);
  });

  it('la vista previa muestra pedidas vs propuesta con el desglose por packs', async () => {
    const preview = await analizarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()], porcentajeAdicional: 7 },
      bd(),
    );
    expect(preview.porcentajeAdicional).toBe(7);
    expect(preview.totalPiezas).toBe(1903); // pedidas
    expect(preview.totalPiezasFabricar).toBe(2032); // propuesta a fabricar (+7% por packs)
    const fila = preview.renglones[0]!;
    expect(fila.piezasTotales).toBe(1903);
    expect(fila.piezasFabricar).toBe(2032);
    const t56 = fila.tallas.find((t) => t.talla === '5-6');
    expect(t56?.piezas).toBe(305);
    expect(t56?.piezasFabricar).toBe(326);
    // El desglose por grupo (de dónde sale la propuesta): A 119→127, B 57→61, C (SKU) 1.
    expect(fila.grupos.map((g) => [g.grupo, g.packsPropuestos])).toEqual([
      ['A', 127],
      ['B', 61],
      ['C', 1],
    ]);
  });

  it('respeta la MATRIZ editada por el usuario en la vista previa (el sistema propone, él decide)', async () => {
    const idModelo = await crearModelo('DEV-CYA-EDIT');

    const res = await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [
          {
            ...archivoPdf(),
            // El usuario integró todo a mano: 4 tallas, total 500 (ignora la propuesta por packs).
            matriz: [
              { talla: '5-6', cantidad: 100 },
              { talla: '6-7', cantidad: 100 },
              { talla: '9-10', cantidad: 150 },
              { talla: '13-14', cantidad: 150 },
            ],
            pantone: '11-0601 TCX',
          },
        ],
        ligas: [{ modeloCliente: '3138277', idModelo }],
        porcentajeAdicional: 7,
      },
      bd(),
      archivosFalsos(),
    );

    // La OP se fabrica con los totales EDITADOS (500), no con la propuesta (2032).
    expect(res.ordenes[0]!.totalPiezas).toBe(500);
    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: res.ordenes[0]!.idOrden },
      include: { lineas: { include: { tallas: { include: { talla: true } } } } },
    });
    expect(orden.lineas[0]!.tallas).toHaveLength(4);
    // El pantone editado quedó sellado en el color de la OP.
    expect(orden.lineas[0]!.pantone).toBe('11-0601 TCX');
    // El renglón del pedido SIGUE conservando lo pedido (1903).
    const linea = await cliente.pedidoLinea.findFirstOrThrow({ where: { idPedido: res.idPedido } });
    expect(linea.cantidadPedida).toBe(1903);
  });

  it('sin % adicional (default 0) la matriz = la cantidad original', async () => {
    const idModelo = await crearModelo('DEV-CYA-PCT0');
    const res = await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [archivoPdf()],
        ligas: [{ modeloCliente: '3138277', idModelo }],
      },
      bd(),
      archivosFalsos(),
    );
    expect(res.ordenes[0]!.totalPiezas).toBe(1903);
    const linea = await cliente.pedidoLinea.findFirstOrThrow({ where: { idPedido: res.idPedido } });
    expect(linea.cantidadPedida).toBe(1903);
  });
});

describe('aprendizaje de la liga', () => {
  it('analizar PROPONE la liga aprendida y confirmar corre sin liga manual', async () => {
    const idModelo = await crearModelo('DEV-CYA-3');
    await cliente.clienteModeloLiga.create({
      data: { idCliente: idClienteNegocio, modeloCliente: '3138277', idModelo },
    });

    // La vista previa sugiere el modelo aprendido.
    const preview = await analizarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()] },
      bd(),
    );
    expect(preview.renglones).toHaveLength(1);
    expect(preview.renglones[0]!.idModeloSugerido).toBe(idModelo);
    expect(preview.renglones[0]!.colorNuevo).toBe(true); // BLANCO no existe aún
    expect(preview.renglones[0]!.tallasNuevas).toContain('5-6');
    expect(preview.totalReconocidos).toBe(1);

    // Confirmar SIN ligas manuales usa la aprendida.
    const res = await confirmarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()], ligas: [] },
      bd(),
      archivosFalsos(),
    );
    expect(res.ordenes).toHaveLength(1);
    expect(res.ligasAprendidas).toBe(0); // ya estaba aprendida igual
  });

  it('una liga aprendida a un modelo INACTIVO no se sugiere (advierte) y no se importa', async () => {
    const idModelo = await crearModelo('DEV-CYA-OFF-LIGA');
    await cliente.clienteModeloLiga.create({
      data: { idCliente: idClienteNegocio, modeloCliente: '3138277', idModelo },
    });
    // El modelo antes ligado se DESCONTINÚA después de aprender la liga.
    await cliente.modelo.update({ where: { id: idModelo }, data: { activo: false } });

    // La vista previa NO propone la liga inactiva y avisa.
    const preview = await analizarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()] },
      bd(),
    );
    expect(preview.renglones[0]!.idModeloSugerido).toBeNull();
    expect(preview.totalReconocidos).toBe(0);
    expect(preview.renglones[0]!.advertencias.map((a) => a.tipo)).toContain('liga-inactiva');

    // Confirmar SIN liga manual NO usa la aprendida inactiva → el PDF queda fuera (no revienta la tx).
    await expect(
      confirmarImportacionPdf(
        sesion(),
        { idCliente: idClienteNegocio, archivos: [archivoPdf()], ligas: [] },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toThrow(ErrorValidacion);
    expect(await cliente.pedido.count()).toBe(0);
  });
});

describe('sin reconocer y transaccionalidad', () => {
  it('sin liga (ni aprendida ni manual) no importa nada y avisa', async () => {
    await expect(
      confirmarImportacionPdf(
        sesion(),
        { idCliente: idClienteNegocio, archivos: [archivoPdf()], ligas: [] },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toThrow(ErrorValidacion);
    // El preview marca el PDF como no reconocido (sin modelo sugerido).
    const preview = await analizarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()] },
      bd(),
    );
    expect(preview.renglones[0]!.idModeloSugerido).toBeNull();
    expect(preview.totalReconocidos).toBe(0);
  });

  it('A2: un modelo descontinuado revierta TODA la transacción (nada persiste)', async () => {
    const idModelo = await crearModelo('DEV-CYA-OFF');
    await cliente.modelo.update({ where: { id: idModelo }, data: { activo: false } });

    await expect(
      confirmarImportacionPdf(
        sesion(),
        {
          idCliente: idClienteNegocio,
          archivos: [archivoPdf()],
          ligas: [{ modeloCliente: '3138277', idModelo }],
        },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toThrow(ErrorConflicto);

    // NADA persistió: ni pedido, ni OP, ni catálogos creados en la tx, ni la liga.
    expect(await cliente.pedido.count()).toBe(0);
    expect(await cliente.orden.count()).toBe(0);
    expect(
      await cliente.color.count({ where: { nombre: { equals: 'BLANCO', mode: 'insensitive' } } }),
    ).toBe(0);
    expect(await cliente.talla.count({ where: { etiqueta: '5-6' } })).toBe(0);
    expect(await cliente.clienteDepartamento.count()).toBe(0);
    expect(await cliente.clienteModeloLiga.count()).toBe(0);
  });
});

describe('idempotencia de catálogos', () => {
  it('reusa color/talla/departamento/campo ya existentes (no los duplica)', async () => {
    const idModelo = await crearModelo('DEV-CYA-IDEM');
    await cliente.color.create({ data: { nombre: 'BLANCO' } });
    await cliente.talla.create({ data: { etiqueta: '5-6', orden: 5 } });
    await cliente.clienteDepartamento.create({
      data: { idCliente: idClienteNegocio, nombre: '3- KIDS' },
    });
    await cliente.clienteCampo.create({
      data: { idCliente: idClienteNegocio, etiqueta: 'Semana C&A' },
    });

    await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [archivoPdf()],
        ligas: [{ modeloCliente: '3138277', idModelo }],
      },
      bd(),
      archivosFalsos(),
    );

    expect(
      await cliente.color.count({ where: { nombre: { equals: 'BLANCO', mode: 'insensitive' } } }),
    ).toBe(1);
    expect(await cliente.talla.count({ where: { etiqueta: '5-6' } })).toBe(1);
    expect(
      await cliente.clienteDepartamento.count({ where: { idCliente: idClienteNegocio } }),
    ).toBe(1);
    expect(
      await cliente.clienteCampo.count({
        where: { idCliente: idClienteNegocio, etiqueta: 'Semana C&A' },
      }),
    ).toBe(1);
  });
});

describe('RBAC', () => {
  it('confirmar sin ordenes.administrar es denegado', async () => {
    const idModelo = await crearModelo('DEV-CYA-RBAC');
    await expect(
      confirmarImportacionPdf(
        sesion(['pedidos.ver', 'pedidos.administrar']),
        {
          idCliente: idClienteNegocio,
          archivos: [archivoPdf()],
          ligas: [{ modeloCliente: '3138277', idModelo }],
        },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toThrow(ErrorPermiso);
  });
});
