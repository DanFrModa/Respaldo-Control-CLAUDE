/**
 * Tests de INTEGRACIÓN del IMPORTADOR de OC por PDF (petición Daniel — plantilla C&A) contra el
 * Postgres efímero (testcontainers), usando el fixture REAL `__fixtures__/cya-620884.pdf`. Cubre:
 *  • CONFIRMAR 1 PDF: nace el pedido + su OP con UN RENGLÓN POR TENDIDO, todos del MISMO color
 *    (§Post-F9.10: los packs A/B/C nacen como tres líneas de "Blanco" con su campo `pack`; la letra
 *    no fabrica colores desde §Post-F9.129), el nº de orden de C&A en `Orden.ocCliente`, el
 *    departamento (División) + las referencias (D7) configuradas, el PDF ADJUNTO a la OP, y la LIGA
 *    aprendida (modelo del cliente → nuestro modelo),
 *  • COMPOSICIÓN (Daniel 24-jul-2026): la del MODELO manda; la del PDF sólo entra de RESPALDO
 *    (marcada como override) cuando el modelo no la tiene capturada,
 *  • MULTI-PDF (dos OC distintas en UNA tanda) → UN pedido con 2 OPs y catálogos REUSADOS dentro de
 *    la MISMA transacción; y el mismo papel repetido en la tanda → una sola OP + reporte,
 *  • APRENDIZAJE: con la liga ya guardada, `analizar` la PROPONE y `confirmar` corre sin liga manual,
 *  • SIN liga (ni aprendida ni manual) → no se importa nada (error claro),
 *  • A2: un modelo descontinuado revierta TODA la transacción (ni pedido, ni OP, ni catálogos creados),
 *  • IDEMPOTENCIA de catálogos (color/talla/departamento/campo ya existentes se REUSAN),
 *  • ⭐ V1-E4: la MISMA OC no se importa dos veces (ni re-importando, ni repetida en la tanda, ni
 *    bajo CARRERA de dos confirmaciones simultáneas),
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
import { crearColor, fusionarColores } from '../catalogos/colores.js';
import { analizarImportacionPdf, confirmarImportacionPdf } from './importacion-pdf.js';

const PDF_BASE64 = readFileSync(
  fileURLToPath(new URL('./__fixtures__/cya-620884.pdf', import.meta.url)),
).toString('base64');

/**
 * SEGUNDA OC de C&A (nº de orden 620885), idéntica al fixture real salvo ese número.
 *
 * Existe para poder probar la tanda multi-PDF REAL —dos órdenes de compra distintas de golpe, que
 * es como Daniel las suelta— sin que la defensa anti-duplicado de V1-E4 la confunda con el mismo
 * papel subido dos veces. Es el caso donde el resolve-or-create de catálogos tiene que reusar lo
 * que ÉL MISMO acaba de crear dentro de la misma transacción.
 */
const PDF2_BASE64 = readFileSync(
  fileURLToPath(new URL('./__fixtures__/cya-620885.pdf', import.meta.url)),
).toString('base64');

/** El SEGUNDO PDF (OC 620885) como archivo de entrada. */
function archivoPdf2(): { nombreArchivo: string; archivoBase64: string } {
  return { nombreArchivo: 'OC-620885.pdf', archivoBase64: PDF2_BASE64 };
}

/** El PDF de C&A del fixture como archivo de entrada. `n` distingue nombres en el multi-PDF. */
function archivoPdf(n = 1): { nombreArchivo: string; archivoBase64: string } {
  return { nombreArchivo: `OC-${n}.pdf`, archivoBase64: PDF_BASE64 };
}

let cliente: PrismaClient;
let idEmpresa: number;
let idClienteNegocio: number;
let idTipoProducto: number;
let idGenero: number;

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

/** Sesión del CATÁLOGO de colores (fusionar es de Daniel, no del importador: otro gate, A4). */
const sesionColores = (): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['colores.ver', 'colores.administrar'] });

/**
 * Contador de keys del fake de archivos, GLOBAL al archivo de pruebas.
 *
 * ⚠️ Estaba LOCAL a `archivosFalsos()` y cada llamada lo reiniciaba en 0. Como el helper se invoca
 * una vez POR IMPORTACIÓN, dos importaciones seguidas generaban la MISMA key
 * (`ordenes/fake/1/OC-1.pdf`) y la segunda reventaba con `Unique constraint failed on ('key')` de
 * `Archivo` — un fallo del ARNÉS que tumbaba las pruebas del re-import antes de que llegaran a
 * ejercitar el dominio. Global, las keys son únicas en toda la corrida.
 */
let secuenciaKeyFake = 0;

/** Servicio de archivos FALSO: `subirContenido` devuelve metadatos (key única), sin tocar R2. */
function archivosFalsos(): ServicioArchivos {
  return {
    solicitarSubida() {
      throw new Error('Este flujo usa subirContenido (server-side), no solicitarSubida.');
    },
    subirContenido(solicitud) {
      secuenciaKeyFake += 1;
      return Promise.resolve({
        bucket: 'control-v2-prueba',
        key: `ordenes/fake/${secuenciaKeyFake}/${solicitud.nombreOriginal}`,
        nombreOriginal: solicitud.nombreOriginal,
        tipoMime: solicitud.tipoMime,
        tamanoBytes: solicitud.contenido.byteLength,
      });
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    descargarContenido(key) {
      // El fake no guarda bytes: solo cumple el contrato del servicio (nadie lo usa aquí).
      return Promise.resolve(Buffer.from(`contenido-falso:${key}`, 'utf8'));
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

/**
 * Crea un modelo del catálogo (opcionalmente con composición del desarrollo) y devuelve su id.
 *
 * Nace PELADO a propósito (sin receta de avíos y con `llevaArte` en su default `true`): es el caso
 * REAL del importador de OC, donde el modelo se crea al capturar el pedido y la receta llega
 * después. Por eso las OP importadas nacen `capturada` con "Falta: avíos y arte" — estado
 * automático (`dominio/produccion/requisitos-orden.ts`), no un fallo, y no impide operarlas.
 */
/**
 * Modelo de DESARROLLO (V1-E3n): es el caso real del importador —la OC del cliente llega con
 * modelos que todavía están en desarrollo— y es el que hace que generar la OP los PASE a
 * producción con su nº de 5 dígitos. Lleva tipo de prenda + género porque de ahí salen los dos
 * primeros dígitos.
 */
async function crearModelo(codigo: string, composicion?: string): Promise<number> {
  const modelo = await cliente.modelo.create({
    data: {
      codigo,
      codigoDesarrollo: codigo,
      origen: 'desarrollo',
      idTipoProducto,
      idGenero,
      ...(composicion === undefined ? {} : { composicion }),
    },
  });
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
  // Dígitos de la nomenclatura (§Post-F9.34): pantalón (7) + caballero (1) → serie 71.
  const tipo = await cliente.tipoProducto.create({
    data: { nombre: 'Pantalón', digitoConcepto: 7 },
  });
  idTipoProducto = tipo.id;
  const genero = await cliente.genero.create({
    data: { nombre: 'Caballero', digitoNomenclatura: 1, digitoAlterno: 5 },
  });
  idGenero = genero.id;
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

    // La OP: nº de orden de C&A en ocCliente, composición del PDF, matriz color×talla (UN color).
    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: orden0.idOrden },
      include: {
        lineas: { include: { tallas: true, color: true } },
        archivos: true,
        referencias: true,
      },
    });
    expect(orden.ocCliente).toBe('620884');
    // Composición (Daniel 24-jul-2026): el modelo de esta prueba NO la tiene capturada, así que la
    // del PDF entra como RESPALDO y queda marcada como override (no deriva del modelo).
    expect(orden.composicion).toContain('ALGOD');
    expect(orden.compForzada).toBe(true);
    // ⭐ §Post-F9.10 — UN RENGLÓN POR TENDIDO, TODOS DEL MISMO COLOR: la OC 620884 trae 3 packs
    // (A/B/C) y nacen 3 líneas de "Blanco" con su `pack`. Antes de §Post-F9.129 nacían 3 COLORES de
    // catálogo ("Blanco A/B/C") y eso partía en tres las compras de una misma orden aguas abajo;
    // entre §Post-F9.129 y §Post-F9.10 nacía UNA sola línea y el tendido desaparecía del corte.
    expect(orden.lineas).toHaveLength(3);
    expect(orden.lineas.map((l) => l.color.nombre)).toEqual(['Blanco', 'Blanco', 'Blanco']);
    expect([...orden.lineas].map((l) => l.pack).sort()).toEqual(['A', 'B', 'C']);
    const totalMatriz = orden.lineas.reduce(
      (s, l) => s + l.tallas.reduce((ss, t) => ss + t.cantidad, 0),
      0,
    );
    expect(totalMatriz).toBe(1903);
    // La OC real de C&A NO trae pantone → los renglones del color quedan sin pantone.
    for (const l of orden.lineas) expect(l.pantone).toBeNull();
    // El desglose SKU/packs del cliente quedó persistido con la orden (aun sin % adicional).
    expect(orden.packsCliente).not.toBeNull();
    // El PDF quedó adjunto a SU orden.
    expect(orden.archivos).toHaveLength(1);

    // El color (D14c: abiertos capturados en la OP) y las tallas se resolvieron-o-crearon. UN SOLO
    // color: la letra del pack ya no fabrica catálogo ("Blanco", no "Blanco A/B/C").
    const coloresBlanco = await cliente.color.findMany({
      where: { nombre: { startsWith: 'BLANCO', mode: 'insensitive' } },
      select: { nombre: true },
    });
    expect(coloresBlanco.map((c) => c.nombre)).toEqual(['Blanco']);
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

    // ⭐⭐ V1-E3 (§Post-F9.172(b)): generar la OP hace NACER el modelo de producción DE ESE COLOR
    // —serie 71 vacía → 71001— y el DESARROLLO se queda como estaba, en su catálogo y con su código.
    // Éste es el camino que le importa a Daniel: un PDF de C&A = una OC = una OP = UN color.
    const desarrollo = await cliente.modelo.findUniqueOrThrow({ where: { id: idModelo } });
    expect(desarrollo.origen).toBe('desarrollo');
    expect(desarrollo.codigo).toBe('DEV-CYA-1');
    expect(desarrollo.numeroProduccion).toBeNull();

    const hijo = await cliente.modelo.findFirstOrThrow({ where: { idModeloDesarrollo: idModelo } });
    expect(hijo.numeroProduccion).toBe(71_001);
    expect(hijo.codigo).toBe('71001');
    expect(hijo.origen).toBe('produccion');
    // El color del PDF (uno solo por OP) es la IDENTIDAD del hijo…
    expect(hijo.idColor).not.toBeNull();
    // …y la ORDEN lleva al hijo, mientras el renglón del pedido sigue con su desarrollo.
    const ordenDelPdf = await cliente.orden.findFirstOrThrow({
      where: { idPedidoLinea: linea.id },
    });
    expect(ordenDelPdf.idModelo).toBe(hijo.id);
    // Evento outbox de la RC (orden-creada) encolado.
    const eventos = await cliente.eventoOutbox.count();
    expect(eventos).toBeGreaterThanOrEqual(1);
  });

  it('la composición del MODELO manda: el PDF del cliente NO la pisa (Daniel 24-jul-2026)', async () => {
    const idModelo = await crearModelo('DEV-CYA-COMP', '95% ALGODON 5% ELASTANO (DESARROLLO)');

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

    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: res.ordenes[0]!.idOrden },
    });
    // Heredada del modelo, SIN override: la del papel se descarta.
    expect(orden.composicion).toBe('95% ALGODON 5% ELASTANO (DESARROLLO)');
    expect(orden.compForzada).toBe(false);
  });
});

describe('confirmar importación por PDF (multi-PDF)', () => {
  /**
   * ⚠️ ESTA PRUEBA CAMBIÓ EN V1-E4 (punto 1). Antes subía el MISMO fixture dos veces y esperaba 2
   * OPs, llamándolo "resurtido" — que es justo el defecto que costaba tela y maquila: la misma OC
   * del cliente pariendo producción por duplicado. (El resurtido de VERDAD es generar otra OP del
   * mismo renglón desde la pantalla, punto 3 de la etapa, no re-importar el papel.) La tanda
   * multi-PDF legítima quedó cubierta arriba, con la segunda OC del fixture 620885.
   */
  /**
   * ⭐ EL FLUJO COTIDIANO (recuperado tras la revisión de V1-E4): Daniel suelta VARIAS OC de golpe.
   * Las dos nacen en la MISMA transacción, así que el resolve-or-create de colores/tallas/
   * departamento/campos tiene que reusar lo que ÉL MISMO acabó de crear en esta tx —no solo lo que
   * ya existía en la base—. Es cobertura distinta de la del describe «idempotencia de catálogos»,
   * que usa UN PDF contra catálogos PREEXISTENTES.
   */
  it('dos OC DISTINTAS en una tanda → UN pedido con 2 OPs y catálogos reusados en la MISMA tx', async () => {
    const idModelo = await crearModelo('DEV-CYA-MULTI');

    const res = await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [archivoPdf(1), archivoPdf2()],
        ligas: [{ modeloCliente: '3138277', idModelo }],
      },
      bd(),
      archivosFalsos(),
    );

    expect(res.ordenes).toHaveLength(2);
    expect(res.noReconocidos).toHaveLength(0);
    expect(res.ligasAprendidas).toBe(1); // el 2º upsert es no-op (misma liga aprendida)
    expect([...res.ordenes.map((o) => o.numeroOrden)].sort()).toEqual(['620884', '620885']);

    // UN solo pedido con 2 renglones, 2 OPs y sus 2 adjuntos.
    expect(await cliente.pedido.count()).toBe(1);
    expect(await cliente.pedidoLinea.count({ where: { idPedido: res.idPedido } })).toBe(2);
    expect(await cliente.ordenArchivo.count()).toBe(2);

    // ⭐ Catálogos REUSADOS dentro de la tx: el color BLANCO y la talla 5-6 se crean UNA vez en la
    // primera OP y la segunda los REUSA (1 color, no 2 — y ya no 3 ni 6: §Post-F9.129).
    expect(
      await cliente.color.count({
        where: { nombre: { startsWith: 'BLANCO', mode: 'insensitive' } },
      }),
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

  it('el MISMO papel dos veces en una tanda → UNA sola OP; el repetido se reporta', async () => {
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

    expect(res.ordenes).toHaveLength(1);
    expect(res.noReconocidos).toHaveLength(1);
    expect(res.noReconocidos[0]!.nombreArchivo).toBe('OC-2.pdf');
    expect(res.noReconocidos[0]!.motivo).toContain('OC-1.pdf');

    // UN pedido, UN renglón, UNA OP, UN adjunto: nada se duplicó.
    expect(await cliente.pedido.count()).toBe(1);
    expect(await cliente.pedidoLinea.count({ where: { idPedido: res.idPedido } })).toBe(1);
    expect(await cliente.orden.count()).toBe(1);
    expect(await cliente.ordenArchivo.count()).toBe(1);
  });
});

/**
 * ⭐ V1-E4 punto 1 — LA DEFENSA CENTRAL DE LA ETAPA. Importar dos veces la misma OC del cliente
 * creaba EN SILENCIO un segundo pedido, una segunda OP con su nº de producción, su ruta crítica y
 * su MRP; se descubría semanas después CORTANDO DOBLE. Nadie lo nota probando a mano (las dos
 * importaciones "funcionan"), así que la regresión vive aquí.
 */
describe('⭐ la misma OC del cliente NO se importa dos veces (V1-E4)', () => {
  /** Importa el fixture (OC 620884) y devuelve el resultado. */
  async function importar(idModelo: number): ReturnType<typeof confirmarImportacionPdf> {
    return confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [archivoPdf()],
        ligas: [{ modeloCliente: '3138277', idModelo }],
      },
      bd(),
      archivosFalsos(),
    );
  }

  it('la SEGUNDA importación del mismo papel no crea NADA y explica por qué', async () => {
    const idModelo = await crearModelo('DEV-CYA-DUP');
    const primera = await importar(idModelo);
    expect(primera.ordenes).toHaveLength(1);

    await expect(importar(idModelo)).rejects.toThrow(ErrorValidacion);

    // Lo que de verdad importa: NO nació un segundo pedido/OP/renglón (ni un nº de producción más).
    expect(await cliente.pedido.count()).toBe(1);
    expect(await cliente.orden.count()).toBe(1);
    expect(await cliente.pedidoLinea.count()).toBe(1);
  });

  it('la vista previa lo AVISA antes de confirmar (advertencia + la OP que ya existe)', async () => {
    const idModelo = await crearModelo('DEV-CYA-DUP-PREV');
    const primera = await importar(idModelo);
    const opCreada = primera.ordenes[0]!;

    const previa = await analizarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()] },
      bd(),
    );

    const renglon = previa.renglones[0]!;
    expect(renglon.yaImportado).toEqual({
      idOrden: opCreada.idOrden,
      folioOrden: opCreada.folio,
    });
    const aviso = renglon.advertencias.find((a) => a.tipo === 'duplicado');
    expect(aviso?.mensaje).toContain('620884');
  });

  it('si la OP anterior se CANCELÓ, re-importar el papel sí se permite', async () => {
    const idModelo = await crearModelo('DEV-CYA-DUP-CANCEL');
    const primera = await importar(idModelo);
    await cliente.orden.update({
      where: { id: primera.ordenes[0]!.idOrden },
      data: { estado: 'cancelada', motivoCancelada: 'prueba' },
    });

    const segunda = await importar(idModelo);

    expect(segunda.ordenes).toHaveLength(1);
    expect(await cliente.orden.count({ where: { estado: { not: 'cancelada' } } })).toBe(1);
  });

  /**
   * ⭐ EL CANDADO, BAJO CARRERA REAL. La defensa no vive en el filtro de arriba (que lee FUERA de la
   * transacción y por tanto tiene ventana), sino en el `pg_advisory_xact_lock` por cliente + la
   * re-verificación DENTRO de la tx. Sin él, dos confirmaciones simultáneas del mismo papel leerían
   * ambas "todavía no existe" (READ COMMITTED) y nacerían los dos pedidos duplicados — que es
   * exactamente el daño callado que la etapa vino a cerrar.
   *
   * Se lanzan las dos a la vez con `allSettled`: una gana y la otra tiene que fallar, y la base
   * queda con UN pedido y UNA OP.
   */
  it('⭐ dos confirmaciones SIMULTÁNEAS del mismo papel: gana una, la otra falla, 1 pedido y 1 OP', async () => {
    const idModelo = await crearModelo('DEV-CYA-CARRERA');

    const resultados = await Promise.allSettled([importar(idModelo), importar(idModelo)]);

    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const fallidas = resultados.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(fallidas).toHaveLength(1);

    // Lo que de verdad importa: la base NO quedó duplicada.
    expect(await cliente.pedido.count()).toBe(1);
    expect(await cliente.orden.count()).toBe(1);
    expect(await cliente.pedidoLinea.count()).toBe(1);
    // Y nació UN solo modelo de producción, con el primer libre de la serie (no el segundo).
    const hijos = await cliente.modelo.findMany({ where: { idModeloDesarrollo: idModelo } });
    expect(hijos).toHaveLength(1);
    expect(hijos[0]?.numeroProduccion).toBe(71_001);
  });

  it('la OC de OTRO cliente no bloquea (el nº de orden solo identifica dentro de su cliente)', async () => {
    const idModelo = await crearModelo('DEV-CYA-DUP-OTRO');
    await importar(idModelo);

    const otro = await cliente.cliente.create({ data: { nombre: 'Otro cliente' } });
    const res = await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: otro.id,
        archivos: [archivoPdf()],
        ligas: [{ modeloCliente: '3138277', idModelo }],
      },
      bd(),
      archivosFalsos(),
    );

    expect(res.ordenes).toHaveLength(1);
    expect(await cliente.orden.count()).toBe(2);
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
      include: { lineas: { include: { tallas: { include: { talla: true } }, color: true } } },
    });
    // ⭐ §Post-F9.10 — TRES renglones de "Blanco", uno por tendido, cada uno con SU corrida del
    // sobre-pedido POR PACK (A 119→127 = 254-127-127-381-381-254; B 57→61 = 61-0-0-122-122-122;
    // C SKU +7% = 11-7-11-18-20-14 — cementados pack por pack en el unit `sobrepedido-cya.test.ts`).
    // Entre §Post-F9.129 y §Post-F9.10 la OP recibía su SUMA en una sola línea y el tendido se
    // perdía; antes de §Post-F9.129, tres COLORES de catálogo distintos.
    expect(orden.lineas).toHaveLength(3);
    expect(new Set(orden.lineas.map((l) => l.color.nombre))).toEqual(new Set(['Blanco']));
    const porPack = new Map(
      orden.lineas.map(
        (l) =>
          [l.pack, new Map(l.tallas.map((t) => [t.talla.etiqueta, t.cantidad] as const))] as const,
      ),
    );
    const tallasCya = ['5-6', '6-7', '7-8', '9-10', '11-12', '13-14'];
    const corrida = (pack: string): number[] =>
      tallasCya.map((t) => porPack.get(pack)?.get(t) ?? 0);
    // 🔑 Cada tendido con LO SUYO, no la suma: si el importador siguiera fundiendo, estas tres
    // aserciones serían imposibles de satisfacer a la vez.
    expect(corrida('A')).toEqual([254, 127, 127, 381, 381, 254]);
    expect(corrida('B')).toEqual([61, 0, 0, 122, 122, 122]);
    expect(corrida('C')).toEqual([11, 7, 11, 18, 20, 14]);
    // Ninguna talla se duplicó DENTRO de un tendido (sería el defecto que `sincronizarMatriz` aborta).
    // El pack B trae dos tallas en 0, que no generan celda: 4, no 6.
    expect(orden.lineas.map((l) => `${l.pack}:${l.tallas.length}`).sort()).toEqual([
      'A:6',
      'B:4',
      'C:6',
    ]);
    const totalMatriz = orden.lineas.reduce(
      (s, l) => s + l.tallas.reduce((ss, t) => ss + t.cantidad, 0),
      0,
    );
    // Y la SUMA de los tres tendidos sigue siendo la propuesta total: 326-134-138-521-523-390.
    expect(
      tallasCya.map((t) => ['A', 'B', 'C'].reduce((s, p) => s + (porPack.get(p)?.get(t) ?? 0), 0)),
    ).toEqual([326, 134, 138, 521, 523, 390]);
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

  it('respeta los RENGLONES-PACK editados; un pack vaciado se integra en otro (el usuario decide)', async () => {
    const idModelo = await crearModelo('DEV-CYA-EDIT');

    const res = await confirmarImportacionPdf(
      sesion(),
      {
        idCliente: idClienteNegocio,
        archivos: [
          {
            ...archivoPdf(),
            // El usuario edita a mano: deja A y B con corridas propias e INTEGRA el pack C en A (C en 0).
            matriz: [
              {
                letra: 'A',
                tallas: [
                  { talla: '5-6', cantidad: 100 },
                  { talla: '6-7', cantidad: 100 },
                  { talla: '9-10', cantidad: 150 },
                  { talla: '13-14', cantidad: 150 },
                ],
              },
              {
                letra: 'B',
                tallas: [
                  { talla: '5-6', cantidad: 50 },
                  { talla: '9-10', cantidad: 50 },
                ],
              },
              // Pack C vaciado (todo en 0): NO genera línea (se integró en A).
              { letra: 'C', tallas: [{ talla: '5-6', cantidad: 0 }] },
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

    // La OP se fabrica con los renglones EDITADOS: A(500) + B(100) = 600 (ignora la propuesta 2032).
    expect(res.ordenes[0]!.totalPiezas).toBe(600);
    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: res.ordenes[0]!.idOrden },
      include: { lineas: { include: { tallas: { include: { talla: true } }, color: true } } },
    });
    // ⭐ §Post-F9.10 por la PUERTA DE LA MATRIZ EDITADA: nacen DOS renglones (A y B) del MISMO
    // color, cada uno con la corrida que tecleó el usuario. El pack C vaciado NO genera renglón:
    // así se "integra" un pack en otro. Antes de §Post-F9.129 salían 2 COLORES de catálogo
    // ("Blanco A" y "Blanco B"); entre §Post-F9.129 y §Post-F9.10, un solo renglón con la suma.
    expect(orden.lineas).toHaveLength(2);
    expect(new Set(orden.lineas.map((l) => l.color.nombre))).toEqual(new Set(['Blanco']));
    const porPack = new Map(
      orden.lineas.map(
        (l) =>
          [l.pack, new Map(l.tallas.map((t) => [t.talla.etiqueta, t.cantidad] as const))] as const,
      ),
    );
    expect([...porPack.keys()].sort()).toEqual(['A', 'B']);
    // A: 5-6 100, 6-7 100, 9-10 150, 13-14 150 — TAL CUAL, sin sumarle el B.
    expect([...(porPack.get('A') ?? [])].sort()).toEqual([
      ['13-14', 150],
      ['5-6', 100],
      ['6-7', 100],
      ['9-10', 150],
    ]);
    // B: 5-6 50, 9-10 50.
    expect([...(porPack.get('B') ?? [])].sort()).toEqual([
      ['5-6', 50],
      ['9-10', 50],
    ]);
    expect(
      orden.lineas.reduce((s, l) => s + l.tallas.reduce((ss, t) => ss + t.cantidad, 0), 0),
    ).toBe(600);
    // Y el color quedó UNO SOLO en el catálogo (la letra del pack ya no lo fabrica).
    expect(
      await cliente.color.count({
        where: { nombre: { startsWith: 'BLANCO', mode: 'insensitive' } },
      }),
    ).toBe(1);
    // El pantone editado se sella en TODOS los renglones (es UNO por OC, no por tendido).
    expect(orden.lineas.map((l) => l.pantone)).toEqual(['11-0601 TCX', '11-0601 TCX']);
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
      await cliente.color.count({
        where: { nombre: { startsWith: 'BLANCO', mode: 'insensitive' } },
      }),
    ).toBe(0);
    expect(await cliente.talla.count({ where: { etiqueta: '5-6' } })).toBe(0);
    expect(await cliente.clienteDepartamento.count()).toBe(0);
    expect(await cliente.clienteModeloLiga.count()).toBe(0);
  });
});

describe('idempotencia de catálogos', () => {
  it('reusa color/talla/departamento/campo ya existentes (no los duplica)', async () => {
    const idModelo = await crearModelo('DEV-CYA-IDEM');
    // El color ya existe (BLANCO, en MAYÚSCULAS) → se REUSA, no se duplica: `resolverOCrearColor`
    // busca sin distinguir mayúsculas, así que "Blanco" cae en el "BLANCO" ya sembrado.
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
      await cliente.color.count({
        where: { nombre: { startsWith: 'BLANCO', mode: 'insensitive' } },
      }),
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

  it('🔴 NO resucita un departamento DESACTIVADO: la fusión de §Post-F9.122(a) tiene que durar más que la siguiente OC', async () => {
    const idModelo = await crearModelo('DEV-CYA-FUSION');
    // Así queda un departamento ABSORBIDO por una fusión: existe, pero apagado (borrado suave, D3).
    const absorbido = await cliente.clienteDepartamento.create({
      data: { idCliente: idClienteNegocio, nombre: '3- KIDS', activo: false },
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

    // Sigue apagado: el importador lo REUSA (no duplica) pero ya no lo reactiva, que era como
    // deshacía la fusión en silencio y devolvía el catálogo revuelto que Daniel acababa de limpiar.
    const despues = await cliente.clienteDepartamento.findUnique({ where: { id: absorbido.id } });
    expect(despues?.activo).toBe(false);
    expect(
      await cliente.clienteDepartamento.count({ where: { idCliente: idClienteNegocio } }),
    ).toBe(1);
  });

  it('🔴🔴 NO resucita un COLOR absorbido: lo manda al canónico, y la fusión sigue siendo REPETIBLE', async () => {
    const idModelo = await crearModelo('DEV-CYA-COLOR-FUSION');
    // El mundo real: el PDF de C&A dice "BLANCO", y ese es justo el color que una importación
    // anterior dio de alta. Daniel lo declara duplicado y lo fusiona en su canónico.
    const absorbido = await crearColor(sesionColores(), { nombre: 'Blanco' }, bd());
    const canonico = await crearColor(sesionColores(), { nombre: 'Blanco Optico' }, bd());
    await fusionarColores(
      sesionColores(),
      { idDestino: canonico.id, origenes: [absorbido.id] },
      bd(),
    );

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

    // 1) El absorbido sigue APAGADO: la limpieza de Daniel dura más que la siguiente OC.
    const despues = await cliente.color.findUniqueOrThrow({ where: { id: absorbido.id } });
    expect(despues.activo).toBe(false);
    // 2) …y NO acumuló referencias nuevas (era la vuelta de tuerca de este resolver: el id se
    //    amarra a la matriz color×talla de la OP).
    expect(await cliente.ordenLinea.count({ where: { idColor: absorbido.id } })).toBe(0);
    // 3) La OP quedó amarrada al color BUENO, que es lo que la fusión quiso decir. Son TRES
    //    renglones —uno por tendido (§Post-F9.10)— pero del MISMO color, que es lo que se afirma.
    const lineas = await cliente.ordenLinea.findMany();
    expect(lineas).toHaveLength(3);
    expect(new Set(lineas.map((l) => l.idColor))).toEqual(new Set([canonico.id]));
    // 4) Tampoco se fabricó un color nuevo para esquivar el problema (`nombre` es único global).
    expect(await cliente.color.count()).toBe(2);
    // 5) 🔴 EL DESVÍO QUEDA ANOTADO (A7). Es el caso NORMAL —el canónico ya está activo, así que no
    //    se toca ningún `activo`— y sin esta bitácora el desvío pasaría en silencio: el papel dice
    //    «Blanco» y la OP dice «Blanco Optico», y nadie tendría dónde enterarse de por qué.
    const bitDesvio = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Color', idEntidad: String(absorbido.id), accion: 'OTRO' },
      orderBy: { id: 'desc' },
    });
    expect(bitDesvio.datos).toMatchObject({
      operacion: 'redirigido-por-fusion',
      a: { id: canonico.id, nombre: 'Blanco Optico' },
      origen: 'importacion-pdf',
    });
    expect(bitDesvio.idUsuario).toBe(sesion().id);
    // 6) ⭐ LA CORONA: la fusión sigue siendo REPETIBLE. Con el defecto, el color revivido ya
    //    tenía órdenes encima y §Post-F9.129 se negaba a fusionarlo NUNCA MÁS.
    await expect(
      fusionarColores(sesionColores(), { idDestino: canonico.id, origenes: [absorbido.id] }, bd()),
    ).resolves.toMatchObject({ id: canonico.id });
  });

  it('un color apagado A MANO (sin fusión) SÍ se reactiva: la guarda no se pasa de lista', async () => {
    const idModelo = await crearModelo('DEV-CYA-COLOR-APAGADO');
    // Nadie se lo llevó: lo apagó su dueño. No hay fusión que deshacer, y la matriz exige color
    // activo — no reactivarlo tumbaría el import por nada.
    const apagado = await cliente.color.create({ data: { nombre: 'Blanco', activo: false } });

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

    const despues = await cliente.color.findUniqueOrThrow({ where: { id: apagado.id } });
    expect(despues.activo).toBe(true);
    // Tres renglones (uno por tendido, §Post-F9.10), todos sobre ESE color reactivado.
    expect(await cliente.ordenLinea.count({ where: { idColor: apagado.id } })).toBe(3);
    // Y la reactivación quedó DICHA (A7), no en silencio.
    const bit = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Color', idEntidad: String(apagado.id), accion: 'MODIFICAR' },
    });
    expect(bit.datos).toMatchObject({ operacion: 'reactivar', origen: 'importacion-pdf' });
    // …y NO se anota ningún desvío: aquí no hubo fusión que seguir (la anotación tampoco se excede).
    expect(
      await cliente.bitacora.count({
        where: { entidad: 'Color', idEntidad: String(apagado.id), accion: 'OTRO' },
      }),
    ).toBe(0);
  });

  it('🔴🔴 la VISTA PREVIA avisa del desvío por fusión ANTES de confirmar (de ahí sale el precio)', async () => {
    // Mismo mundo que la prueba del confirm, pero mirando la PREVIA: el papel dice "BLANCO" y ese
    // color ya no existe por su cuenta. Hasta esta etapa la previa lo daba por bueno en silencio —
    // no lo marcaba ni lo advertía— y el desvío sólo constaba en la bitácora, DESPUÉS de confirmar.
    // Como el precio de la tela casa por NOMBRE de color, el precosto podía salir de otro renglón.
    const absorbido = await crearColor(sesionColores(), { nombre: 'Blanco' }, bd());
    const canonico = await crearColor(sesionColores(), { nombre: 'Blanco Optico' }, bd());
    await fusionarColores(
      sesionColores(),
      { idDestino: canonico.id, origenes: [absorbido.id] },
      bd(),
    );

    const previa = await analizarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()] },
      bd(),
    );

    const renglon = previa.renglones[0]!;
    // 1) Se MARCA, con el nombre del color en el que de verdad va a nacer la OP.
    expect(renglon.colorFusionadoEn).toBe('Blanco Optico');
    // 2) Y se ADVIERTE, nombrando los dos colores y por qué importa.
    const aviso = renglon.advertencias.find((a) => a.tipo === 'color-fusionado');
    expect(aviso?.mensaje).toContain('Blanco Optico');
    expect(aviso?.mensaje).toContain('POR NOMBRE');
    // 3) NO es un color "nuevo": existe, sólo que se lo llevaron. Confundirlos diría al usuario que
    //    se va a crear un color que no se va a crear.
    expect(renglon.colorNuevo).toBe(false);
    // 4) La previa sólo LEE: no reactiva, no crea, no desfusiona nada. Las tres se comprueban —
    //    `activo` no cubre la tercera: `actualizarColor` DESAMARRA el rastro al reactivar, así que
    //    un `idFusionadoEn` borrado con el color aún apagado sería una fusión deshecha a medias que
    //    esta prueba no vería si sólo mirara `activo`.
    const trasLaPrevia = await cliente.color.findUniqueOrThrow({ where: { id: absorbido.id } });
    expect(trasLaPrevia.activo).toBe(false);
    expect(trasLaPrevia.idFusionadoEn).toBe(canonico.id);
    expect(await cliente.color.count()).toBe(2);
  });

  it('⚠️ la RAMA GEMELA en la previa: un color apagado A MANO no dispara el aviso de fusión', async () => {
    // Apagado sin rastro de fusión: al confirmar se REACTIVA y la OP se queda en ÉL — mismo id,
    // mismo nombre, mismo precio. No hay desvío que avisar, y si esta prueba no existiera bastaría
    // con marcar "todo color inactivo" para que la de arriba pasara por la razón equivocada.
    const apagado = await cliente.color.create({ data: { nombre: 'Blanco', activo: false } });

    const previa = await analizarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()] },
      bd(),
    );

    const renglon = previa.renglones[0]!;
    expect(renglon.colorFusionadoEn).toBeNull();
    expect(renglon.advertencias.some((a) => a.tipo === 'color-fusionado')).toBe(false);
    expect(renglon.colorNuevo).toBe(false);
    expect((await cliente.color.findUniqueOrThrow({ where: { id: apagado.id } })).activo).toBe(
      false,
    );
  });

  it('un color que NO existe sigue saliendo como nuevo, sin aviso de fusión', async () => {
    // El tercer estado, para que "nuevo" y "fusionado" no se confundan entre sí: el catálogo está
    // vacío de "Blanco", así que se va a CREAR y no hay ningún desvío.
    const previa = await analizarImportacionPdf(
      sesion(),
      { idCliente: idClienteNegocio, archivos: [archivoPdf()] },
      bd(),
    );

    const renglon = previa.renglones[0]!;
    expect(renglon.colorNuevo).toBe(true);
    expect(renglon.colorFusionadoEn).toBeNull();
    expect(renglon.advertencias.some((a) => a.tipo === 'color-fusionado')).toBe(false);
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
