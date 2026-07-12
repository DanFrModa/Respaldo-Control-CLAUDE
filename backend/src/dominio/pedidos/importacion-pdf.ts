/**
 * IMPORTADOR de OC del cliente por PDF (petición Daniel — plantilla C&A). El flujo NATURAL de Daniel:
 * el usuario sube VARIOS PDFs de C&A → se parsean (extractor `parseo-pdf-cya.ts`) → vista previa (un
 * renglón por PDF) → al confirmar nace, en UNA transacción (A2): UN pedido interno donde cada PDF = 1
 * renglón + 1 OP (con su matriz color×talla del PDF) + su Ruta Crítica (reusando `salidaAProduccion`),
 * y cada PDF queda ADJUNTO a SU orden. El sistema APRENDE la liga modelo-del-cliente → nuestro modelo
 * (`ClienteModeloLiga`) para proponerla sola la próxima vez.
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica AQUÍ; las rutas sólo validan permiso + Zod y delegan.
 *  • A2 — pedido + N (renglón + OP + refs + adjunto) + ligas en UNA transacción (todo o nada). El
 *    SÓLO I/O de red a R2 (subir cada PDF) ocurre ANTES de la tx (patrón server-side de F9-E3): si la
 *    tx falla, los objetos quedan huérfanos en R2 (inocuo, trade-off aceptado en el repo).
 *  • A3/A9 — folio del pedido por la secuencia atómica de la empresa activa; nace en la empresa de la sesión.
 *  • A4 — SIN permisos nuevos: analizar → `pedidos.administrar`; confirmar → `pedidos.administrar` Y
 *    `ordenes.administrar` (el mismo gate que Generar OP; lo exige `salidaAProduccion`). La resolución
 *    de catálogos (color/talla/departamento/campo del cliente) es un EFECTO del import bajo ese gate,
 *    no una edición de catálogo (por eso no exige `colores.administrar`/`clientes.administrar`).
 *  • A7 — auditoría uniforme (creado/modificadoPorId + Bitácora, con el origen: PDF + nº de orden C&A).
 *
 * DECISIONES de negocio (petición Daniel):
 *  • Colores CAMPOS ABIERTOS de la OP (D14c): el color del PDF (BLANCO) se RESUELVE-O-CREA en el
 *    catálogo (igual las tallas 5-6, 6-7…), para que el import de C&A sea SIN fricción — la vista previa
 *    marca cuáles se van a crear (transparencia). El OP hereda ese color/talla.
 *  • División → departamento del cliente (`ClienteDepartamento`, resolver/crear por nombre) + también se
 *    guarda como REFERENCIA (D7) de la OP para que se vea en la orden (la orden no tiene FK a departamento).
 *  • Sub División y demás variables → REFERENCIAS del cliente (D7), configurables por cliente en la
 *    plantilla (`camposVariables`) — "poder poner más variables por cliente" SIN migración.
 *  • El nº de orden de C&A vive en `Orden.ocCliente` (uno por OP, cada PDF el suyo). La fecha de entrega
 *    de la OP = INICIO de la ventana "Entrega en DC".
 */
import type {
  AdvertenciaPdf,
  AnalizarPdfCyaSalida,
  CampoPdfCya,
  CampoVariableImportacion,
  ConfirmarPdfCyaSalida,
  DatosAnalizarPdfCya,
  DatosConfirmarPdfCya,
  OrdenPdfImportada,
  PdfNoReconocido,
  RenglonPdfPreview,
} from '../../contrato/index.js';
import { esquemaAnalizarPdfCyaCuerpo, esquemaConfirmarPdfCyaCuerpo } from '../../contrato/index.js';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { normalizarNombreColor } from '../catalogos/colores.js';
import { salidaAProduccion } from '../produccion/salida-produccion.js';

import { guardarPlantilla, leerCamposVariablesJson } from './importacion.js';
import { CLAVE_SECUENCIA_PEDIDO } from './pedidos.js';
import { parsearPdfCya, type RenglonPdfCyaParseado } from './parseo-pdf-cya.js';
import {
  calcularSobrepedidoCya,
  type GrupoPackEntrada,
  type PropuestaSobrepedido,
} from './sobrepedido-cya.js';

/** Tope del PDF decodificado (los OCs son chicos; espejo del parser). */
const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024;

/** Carpeta R2 de los adjuntos (la subida es server-side ANTES de la tx: no hay id de orden aún, A5). */
const CARPETA_ADJUNTOS = 'ordenes';

/**
 * Campos variables por DEFECTO de una OC de C&A (Daniel: capturables como referencia del cliente). Se
 * usan cuando la plantilla del cliente aún no define los suyos; al guardar el formato pdf-cya se
 * SIEMBRAN éstos para que queden editables (más variables sin migración).
 *
 * ORDEN IMPORTANTE (precisión de Daniel): la referencia PRINCIPAL del cliente es el NÚMERO DE ORDEN de
 * su OC (p. ej. 620884), NO el Modelo ID. El Centro de comando y el detalle muestran como "Pedido
 * cliente" la PRIMERA referencia de la orden (`referencias[0]`, ordenadas por id de creación), así que
 * el número de orden va PRIMERO. El resto (Modelo ID, División, Sub División, Código único, Semana C&A,
 * Descripción) quedan como referencias/campos ADICIONALES (información). El número de orden va ADEMÁS
 * en `Orden.ocCliente` (snapshot que alimenta la cadena de trazabilidad "OC cliente").
 */
export const CAMPOS_VARIABLES_DEFAULT_CYA: CampoVariableImportacion[] = [
  { campo: 'numeroOrden', etiqueta: 'Pedido cliente' },
  { campo: 'modeloCliente', etiqueta: 'Modelo ID' },
  { campo: 'division', etiqueta: 'División' },
  { campo: 'subDivision', etiqueta: 'Sub División' },
  { campo: 'descripcionArticulo', etiqueta: 'Descripción C&A' },
  { campo: 'codigoUnico', etiqueta: 'Código único' },
  { campo: 'semanaCliente', etiqueta: 'Semana C&A' },
];

/** Valor de un campo del PDF parseado (para armar las referencias configuradas). */
function valorCampo(campo: CampoPdfCya, r: RenglonPdfCyaParseado): string {
  switch (campo) {
    case 'numeroOrden':
      return r.numeroOrden;
    case 'modeloCliente':
      return r.modeloCliente;
    case 'division':
      return r.division;
    case 'subDivision':
      return r.subDivision;
    case 'descripcionArticulo':
      return r.descripcionArticulo;
    case 'codigoUnico':
      return r.codigoUnico;
    case 'semanaCliente':
      return r.semanaCliente;
    case 'idColorCliente':
      return r.idColorCliente;
    case 'colorGenerico':
      return r.colorGenerico;
  }
}

/** Clave de comparación de un modelo del cliente (trim; los IDs de C&A son numéricos y estables). */
function claveModeloCliente(texto: string): string {
  return texto.trim();
}

/** Suma de piezas de las tallas del PDF (lo que pidió el cliente). */
function sumaTallas(r: RenglonPdfCyaParseado): number {
  return r.tallas.reduce((s, t) => s + t.piezas, 0);
}

/** Mapea los packs del PDF parseado a la entrada del cálculo de sobre-pedido (dominio puro). */
function gruposDeParseado(r: RenglonPdfCyaParseado): GrupoPackEntrada[] {
  return r.packs.map((p) => ({
    grupo: p.pack,
    tipo: p.tipo,
    totalPacks: p.totalPacks,
    desglose: p.desglose.map((d) => ({ talla: d.talla, cantidad: d.cantidad })),
  }));
}

/**
 * Propuesta de sobre-pedido por PACKS del PDF (petición Daniel): el % adicional se aplica al NÚMERO de
 * packs (round), reconstruyendo la corrida con la proporción del pack; las piezas sueltas (SKU) se
 * redondean por talla. El renglón del pedido conserva lo pedido; la MATRIZ de la OP usa esta propuesta
 * (o la edición manual del usuario en la vista previa).
 */
function propuestaDe(r: RenglonPdfCyaParseado, pct: number): PropuestaSobrepedido {
  return calcularSobrepedidoCya(
    r.tallas.map((t) => ({ talla: t.talla, piezas: t.piezas })),
    gruposDeParseado(r),
    pct,
  );
}

/** Arma el desglose SKU/packs del cliente para PERSISTIRLO con la orden (base del módulo de empaque). */
function packsClienteJson(r: RenglonPdfCyaParseado): {
  tabla: { sku: string | null; talla: string; piezas: number }[];
  grupos: {
    grupo: string;
    packId: string | null;
    tipo: string;
    unidadesPack: number;
    totalPacks: number;
    totalUnidades: number;
    desglose: { talla: string; cantidad: number }[];
  }[];
} | null {
  if (r.tallas.length === 0 && r.packs.length === 0) return null;
  return {
    tabla: r.tallas.map((t) => ({ sku: t.sku, talla: t.talla, piezas: t.piezas })),
    grupos: r.packs.map((p) => ({
      grupo: p.pack,
      packId: p.packId,
      tipo: p.tipo,
      unidadesPack: p.unidadesPack,
      totalPacks: p.totalPacks,
      totalUnidades: p.totalUnidades,
      desglose: p.desglose.map((d) => ({ talla: d.talla, cantidad: d.cantidad })),
    })),
  };
}

/** Decodifica el base64 (acepta prefijo `data:`) a Buffer, validando tamaño. */
function decodificarArchivo(base64: string): Buffer {
  const limpio =
    base64.startsWith('data:') && base64.includes(',')
      ? base64.slice(base64.indexOf(',') + 1)
      : base64;
  const buffer = Buffer.from(limpio, 'base64');
  if (buffer.length === 0) {
    throw new ErrorValidacion('El PDF está vacío o no se pudo leer.');
  }
  if (buffer.length > MAX_ARCHIVO_BYTES) {
    throw new ErrorValidacion('El PDF excede el máximo permitido (10 MB).');
  }
  return buffer;
}

/** Un PDF ya decodificado + parseado (o con su error de parseo). */
interface PdfProcesado {
  nombreArchivo: string;
  buffer: Buffer;
  parseado: RenglonPdfCyaParseado | null;
  error: string | null;
}

/** Decodifica y parsea cada PDF (no lanza por-archivo: un PDF corrupto no tumba a los demás). */
async function procesarArchivos(
  archivos: { nombreArchivo: string; archivoBase64: string }[],
): Promise<PdfProcesado[]> {
  return Promise.all(
    archivos.map(async (a) => {
      try {
        const buffer = decodificarArchivo(a.archivoBase64);
        const parseado = await parsearPdfCya(buffer);
        return { nombreArchivo: a.nombreArchivo, buffer, parseado, error: null };
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : 'No se pudo leer el PDF.';
        return {
          nombreArchivo: a.nombreArchivo,
          buffer: Buffer.alloc(0),
          parseado: null,
          error: mensaje,
        };
      }
    }),
  );
}

// ── Resolvedores de catálogo (resolver-o-crear dentro de la tx) ──────────────

/**
 * Resuelve el color por nombre (insensible a mayúsculas) o lo CREA (D14c: colores abiertos capturados en
 * la OP). Si existe pero está desactivado, lo REACTIVA (la matriz exige color activo). Devuelve el id.
 */
async function resolverOCrearColor(
  tx: Tx,
  sesion: SesionUsuario,
  nombreCrudo: string,
): Promise<number> {
  const nombre = normalizarNombreColor(nombreCrudo === '' ? 'SIN COLOR' : nombreCrudo);
  const existente = await tx.color.findFirst({
    where: { nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    if (!existente.activo) {
      await tx.color.update({
        where: { id: existente.id },
        data: { activo: true, ...datosModificacion(sesion) },
      });
    }
    return existente.id;
  }
  const creado = await tx.color.create({ data: { nombre, ...datosCreacion(sesion) } });
  await registrarBitacora(tx, sesion, {
    entidad: 'Color',
    idEntidad: creado.id,
    accion: 'CREAR',
    datos: { nombre, origen: 'importacion-pdf' },
  });
  return creado.id;
}

/**
 * Resuelve la talla por etiqueta (insensible a mayúsculas) o la CREA. `orden` de despliegue = el número
 * inicial de la etiqueta si lo hay (C&A "5-6" → 5), para que las tallas de niño queden ordenadas.
 */
async function resolverOCrearTalla(
  tx: Tx,
  sesion: SesionUsuario,
  etiquetaCruda: string,
): Promise<number> {
  const etiqueta = etiquetaCruda.trim();
  const existente = await tx.talla.findFirst({
    where: { etiqueta: { equals: etiqueta, mode: 'insensitive' } },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    if (!existente.activo) {
      await tx.talla.update({
        where: { id: existente.id },
        data: { activo: true, ...datosModificacion(sesion) },
      });
    }
    return existente.id;
  }
  const orden = Number.parseInt(etiqueta, 10);
  const creada = await tx.talla.create({
    data: {
      etiqueta,
      orden: Number.isFinite(orden) ? orden : 0,
      ...datosCreacion(sesion),
    },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'Talla',
    idEntidad: creada.id,
    accion: 'CREAR',
    datos: { etiqueta, origen: 'importacion-pdf' },
  });
  return creada.id;
}

/** Resuelve (o crea) un departamento del cliente por nombre (insensible a mayúsculas). Idempotente. */
async function resolverOCrearDepartamento(
  tx: Tx,
  sesion: SesionUsuario,
  idCliente: number,
  nombre: string,
): Promise<void> {
  const existente = await tx.clienteDepartamento.findFirst({
    where: { idCliente, nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    if (!existente.activo) {
      await tx.clienteDepartamento.update({
        where: { id: existente.id },
        data: { activo: true, ...datosModificacion(sesion) },
      });
    }
    return;
  }
  const creado = await tx.clienteDepartamento.create({
    data: { idCliente, nombre, ...datosCreacion(sesion) },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'Cliente',
    idEntidad: idCliente,
    accion: 'MODIFICAR',
    datos: {
      departamento: 'agregar',
      idDepartamento: creado.id,
      nombre,
      origen: 'importacion-pdf',
    },
  });
}

/**
 * Resuelve (o crea) un campo de referencia del cliente (D7) por etiqueta (insensible a mayúsculas) y
 * devuelve su id. Si existe desactivado, lo REACTIVA (se va a usar). Idempotente por etiqueta.
 */
async function resolverOCrearCampo(
  tx: Tx,
  sesion: SesionUsuario,
  idCliente: number,
  etiqueta: string,
): Promise<number> {
  const existente = await tx.clienteCampo.findFirst({
    where: { idCliente, etiqueta: { equals: etiqueta, mode: 'insensitive' } },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    if (!existente.activo) {
      await tx.clienteCampo.update({
        where: { id: existente.id },
        data: { activo: true, ...datosModificacion(sesion) },
      });
    }
    return existente.id;
  }
  const creado = await tx.clienteCampo.create({
    data: { idCliente, etiqueta, ...datosCreacion(sesion) },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'Cliente',
    idEntidad: idCliente,
    accion: 'MODIFICAR',
    datos: { campo: 'agregar', idCampo: creado.id, etiqueta, origen: 'importacion-pdf' },
  });
  return creado.id;
}

/** Upsert de la liga aprendida modelo-del-cliente → nuestro modelo. Devuelve true si cambió/creó. */
async function aprenderLiga(
  tx: Tx,
  sesion: SesionUsuario,
  idCliente: number,
  modeloCliente: string,
  idModelo: number,
): Promise<boolean> {
  const clave = claveModeloCliente(modeloCliente);
  const existente = await tx.clienteModeloLiga.findUnique({
    where: { idCliente_modeloCliente: { idCliente, modeloCliente: clave } },
    select: { id: true, idModelo: true },
  });
  if (existente !== null) {
    if (existente.idModelo === idModelo) return false; // ya aprendida igual: nada que hacer
    await tx.clienteModeloLiga.update({
      where: { id: existente.id },
      data: { idModelo, ...datosModificacion(sesion) },
    });
    return true;
  }
  await tx.clienteModeloLiga.create({
    data: { idCliente, modeloCliente: clave, idModelo, ...datosCreacion(sesion) },
  });
  return true;
}

// ── Carga de reconocimiento (ligas aprendidas + catálogos para la preview) ───

/** Una liga aprendida resuelta (con el estado activo del modelo, para no sugerir descontinuados). */
interface LigaAprendida {
  idModelo: number;
  codigo: string;
  descripcion: string | null;
  activo: boolean;
}

/** Lee las ligas aprendidas de un cliente → mapa claveModeloCliente → liga (con `activo` del modelo). */
async function cargarLigasAprendidas(
  bd: ReturnType<typeof clienteLectura>,
  idCliente: number,
): Promise<Map<string, LigaAprendida>> {
  const ligas = await bd.clienteModeloLiga.findMany({
    where: { idCliente },
    select: {
      modeloCliente: true,
      idModelo: true,
      modelo: { select: { codigo: true, descripcion: true, activo: true } },
    },
  });
  const mapa = new Map<string, LigaAprendida>();
  for (const liga of ligas) {
    mapa.set(claveModeloCliente(liga.modeloCliente), {
      idModelo: liga.idModelo,
      codigo: liga.modelo.codigo,
      descripcion: liga.modelo.descripcion,
      activo: liga.modelo.activo,
    });
  }
  return mapa;
}

/** Config pdf-cya VIGENTE del cliente (campos variables + % adicional); defaults si no hay plantilla. */
async function leerConfigPlantillaPdf(
  bd: ReturnType<typeof clienteLectura>,
  idCliente: number,
): Promise<{ camposVariables: CampoVariableImportacion[]; porcentajeAdicional: number }> {
  const fila = await bd.plantillaImportacion.findFirst({
    where: { idCliente, vigente: true },
    select: { formato: true, camposVariables: true, porcentajeAdicional: true },
  });
  if (fila?.formato !== 'pdf-cya') {
    return { camposVariables: CAMPOS_VARIABLES_DEFAULT_CYA, porcentajeAdicional: 0 };
  }
  return {
    camposVariables: leerCamposVariablesJson(fila.camposVariables) ?? CAMPOS_VARIABLES_DEFAULT_CYA,
    porcentajeAdicional: fila.porcentajeAdicional.toNumber(),
  };
}

// ── Operación: analizar / vista previa ───────────────────────────────────────

/**
 * Analiza los PDFs del cliente y arma la VISTA PREVIA (un renglón por PDF): campos parseados, liga de
 * modelo SUGERIDA (aprendida), qué color/tallas NO existen aún (se crearán) y las advertencias de
 * cuadre. Sólo LEE. Requiere `pedidos.administrar`; los importes van gated por `pedidos.importes`.
 */
export async function analizarImportacionPdf(
  sesion: SesionUsuario,
  entrada: DatosAnalizarPdfCya,
  bd?: ContextoBd,
): Promise<AnalizarPdfCyaSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const datos = validarEntrada(esquemaAnalizarPdfCyaCuerpo, entrada);
  const cliente = clienteLectura(bd);
  const verImportes = tienePermiso(sesion, 'pedidos.importes');

  const procesados = await procesarArchivos(datos.archivos);
  const ligas = await cargarLigasAprendidas(cliente, datos.idCliente);
  // % adicional para la vista previa: el override del request manda; si no, el de la plantilla del cliente.
  const config = await leerConfigPlantillaPdf(cliente, datos.idCliente);
  const pct = datos.porcentajeAdicional ?? config.porcentajeAdicional;

  // Colores/tallas que ya existen en el catálogo (para marcar los "nuevos" en la vista previa).
  const nombresColor = new Set<string>();
  const etiquetasTalla = new Set<string>();
  for (const p of procesados) {
    if (p.parseado === null) continue;
    if (p.parseado.colorGenerico !== '') nombresColor.add(p.parseado.colorGenerico);
    for (const t of p.parseado.tallas) etiquetasTalla.add(t.talla);
  }
  const coloresExistentes = await catalogoColoresPorNombre(cliente, [...nombresColor]);
  const tallasExistentes = await catalogoTallasPorEtiqueta(cliente, [...etiquetasTalla]);

  const renglones: RenglonPdfPreview[] = procesados.map((p) => {
    if (p.parseado === null) {
      return renglonError(p.nombreArchivo, p.error ?? 'No se pudo leer el PDF.');
    }
    const r = p.parseado;
    const aprendida = ligas.get(claveModeloCliente(r.modeloCliente)) ?? null;
    // Sólo se SUGIERE una liga a un modelo ACTIVO: sugerir uno descontinuado haría reventar la tx al
    // confirmar. Si la liga aprendida apunta a un inactivo, el renglón llega SIN sugerencia + advertencia.
    const sugerida = aprendida !== null && aprendida.activo ? aprendida : null;
    const advertencias: AdvertenciaPdf[] = r.advertencias.map((a) => ({
      tipo: a.tipo,
      mensaje: a.mensaje,
    }));
    if (aprendida !== null && !aprendida.activo) {
      advertencias.push({
        tipo: 'liga-inactiva',
        mensaje: `El modelo antes ligado (#${aprendida.codigo}) quedó inactivo; elige otro.`,
      });
    }
    const colorNuevo =
      r.colorGenerico !== '' &&
      !coloresExistentes.has(normalizarNombreColor(r.colorGenerico).toLowerCase());
    const tallasNuevas = r.tallas
      .map((t) => t.talla)
      .filter((etq) => !tallasExistentes.has(etq.trim().toLowerCase()));
    // Sobre-pedido por packs (petición Daniel): propuesta por talla + desglose por grupo. Sus avisos
    // (packs que no cuadran / proporción no entera) se suman a las advertencias del renglón.
    const propuesta = propuestaDe(r, pct);
    const propuestaPorTalla = new Map(propuesta.totalPorTalla.map((c) => [c.talla, c.propuesta]));
    for (const mensaje of propuesta.advertencias) {
      advertencias.push({ tipo: 'sobrepedido', mensaje });
    }
    return {
      nombreArchivo: p.nombreArchivo,
      error: null,
      numeroOrden: r.numeroOrden,
      modeloCliente: r.modeloCliente,
      descripcionArticulo: r.descripcionArticulo,
      division: r.division,
      subDivision: r.subDivision,
      idColorCliente: r.idColorCliente,
      colorGenerico: r.colorGenerico,
      pantone: r.pantone,
      codigoUnico: r.codigoUnico,
      semanaCliente: r.semanaCliente,
      costoUnitario: verImportes ? r.costoUnitario : null,
      piezasTotales: r.piezasTotales,
      piezasFabricar: propuesta.totalPropuesta,
      montoTotal: verImportes ? r.montoTotal : null,
      fechaEntrega: r.fechaEntrega,
      tallas: r.tallas.map((t) => ({
        talla: t.talla,
        piezas: t.piezas,
        piezasFabricar: propuestaPorTalla.get(t.talla) ?? t.piezas,
      })),
      grupos: propuesta.grupos,
      idModeloSugerido: sugerida?.idModelo ?? null,
      codigoModeloSugerido: sugerida?.codigo ?? null,
      descripcionModeloSugerido: sugerida?.descripcion ?? null,
      colorNuevo,
      tallasNuevas: [...new Set(tallasNuevas)],
      advertencias,
    };
  });

  const totalPiezas = renglones.reduce(
    (s, r) => s + r.tallas.reduce((ss, t) => ss + t.piezas, 0),
    0,
  );
  const totalPiezasFabricar = renglones.reduce((s, r) => s + r.piezasFabricar, 0);
  const totalReconocidos = renglones.filter((r) => r.idModeloSugerido !== null).length;
  return {
    renglones,
    totalPiezas,
    totalPiezasFabricar,
    porcentajeAdicional: pct,
    totalReconocidos,
  };
}

/** Renglón de vista previa de un PDF que NO se pudo parsear (todo vacío + su error). */
function renglonError(nombreArchivo: string, error: string): RenglonPdfPreview {
  return {
    nombreArchivo,
    error,
    numeroOrden: '',
    modeloCliente: '',
    descripcionArticulo: '',
    division: '',
    subDivision: '',
    idColorCliente: '',
    colorGenerico: '',
    pantone: '',
    codigoUnico: '',
    semanaCliente: '',
    costoUnitario: null,
    piezasTotales: 0,
    piezasFabricar: 0,
    montoTotal: null,
    fechaEntrega: null,
    tallas: [],
    grupos: [],
    idModeloSugerido: null,
    codigoModeloSugerido: null,
    descripcionModeloSugerido: null,
    colorNuevo: false,
    tallasNuevas: [],
    advertencias: [{ tipo: 'parseo', mensaje: error }],
  };
}

/** Set de nombres de color existentes (normalizados) del subconjunto dado. */
async function catalogoColoresPorNombre(
  bd: ReturnType<typeof clienteLectura>,
  nombres: string[],
): Promise<Set<string>> {
  if (nombres.length === 0) return new Set();
  const colores = await bd.color.findMany({
    where: { nombre: { in: nombres.map((n) => normalizarNombreColor(n)), mode: 'insensitive' } },
    select: { nombre: true },
  });
  return new Set(colores.map((c) => normalizarNombreColor(c.nombre).toLowerCase()));
}

/** Set de etiquetas de talla existentes (minúsculas) del subconjunto dado. */
async function catalogoTallasPorEtiqueta(
  bd: ReturnType<typeof clienteLectura>,
  etiquetas: string[],
): Promise<Set<string>> {
  if (etiquetas.length === 0) return new Set();
  const tallas = await bd.talla.findMany({
    where: { etiqueta: { in: etiquetas.map((e) => e.trim()), mode: 'insensitive' } },
    select: { etiqueta: true },
  });
  return new Set(tallas.map((t) => t.etiqueta.trim().toLowerCase()));
}

// ── Operación: confirmar la importación ──────────────────────────────────────

/** Un PDF LISTO para importar (parseado, ligado y con su objeto R2 ya subido). */
interface PdfAImportar {
  nombreArchivo: string;
  r: RenglonPdfCyaParseado;
  idModelo: number;
  /** Matriz EDITADA en la vista previa (total por talla); si no viene, se usa la propuesta por packs. */
  matrizEditada: { talla: string; cantidad: number }[] | null;
  /** Pantone editado/prefilleado del color de la OP; null = sin pantone. */
  pantone: string | null;
  subido: {
    bucket: string;
    key: string;
    nombreOriginal: string;
    tipoMime: string;
    tamanoBytes: number;
  };
}

/**
 * Confirma la importación por PDF: crea el pedido interno + una OP por PDF ligado (matriz + refs + RC +
 * adjunto) + aprende las ligas, en UNA transacción (A2). Los PDFs sin liga (ni aprendida ni en `ligas`),
 * sin tallas o corruptos se OMITEN y se devuelven en `noReconocidos`. Requiere `pedidos.administrar` Y
 * `ordenes.administrar`. El servicio de archivos se INYECTA (default lazy) para tests sin R2.
 *
 * Orden seguro (A2 + sin I/O en la tx): se PARSEA y se SUBE cada PDF a R2 ANTES de abrir la transacción
 * (subida server-side, F9-E3); dentro de la tx sólo se escribe BD. Si la tx aborta, los objetos R2
 * quedan huérfanos (inocuo). Cada OP recibe SU objeto ya subido como `Archivo` + `OrdenArchivo`.
 */
export async function confirmarImportacionPdf(
  sesion: SesionUsuario,
  entrada: DatosConfirmarPdfCya,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<ConfirmarPdfCyaSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaConfirmarPdfCyaCuerpo, entrada);

  const cliente = clienteLectura(bd);
  const noReconocidos: PdfNoReconocido[] = [];

  // 1) Parsear todos los PDFs (puro) + cargar la config de la plantilla (campos variables + % adicional)
  //    y las ligas aprendidas. La plantilla se lee DIRECTO (no vía `obtenerPlantillaVigente`, que exige
  //    `pedidos.ver`): este confirm ya está gated por `pedidos.administrar`/`ordenes.administrar`. Si no
  //    hay plantilla pdf-cya se usan los defaults de C&A y 0% adicional.
  const procesados = await procesarArchivos(datos.archivos);
  const config = await leerConfigPlantillaPdf(cliente, datos.idCliente);
  const camposVariables = config.camposVariables;
  // % adicional: el override del request manda; si no, el de la plantilla del cliente.
  const pct = datos.porcentajeAdicional ?? config.porcentajeAdicional;
  const ligasAprendidas = await cargarLigasAprendidas(cliente, datos.idCliente);
  const ligasEntrada = new Map<string, number>(
    datos.ligas.map((l) => [claveModeloCliente(l.modeloCliente), l.idModelo]),
  );

  // 2) Resolver liga por PDF y SUBIR (server-side, ANTES de la tx) los que sí se importarán. El índice
  //    de `procesados` corresponde 1:1 con `datos.archivos` (mismo orden): de ahí sale el ajuste manual
  //    (matriz editada + pantone) de ESE PDF.
  const aImportar: PdfAImportar[] = [];
  for (let i = 0; i < procesados.length; i++) {
    const p = procesados[i]!;
    const ajuste = datos.archivos[i];
    if (p.parseado === null) {
      noReconocidos.push({
        nombreArchivo: p.nombreArchivo,
        modeloCliente: '',
        motivo: p.error ?? 'No se pudo leer el PDF.',
      });
      continue;
    }
    const r = p.parseado;
    const clave = claveModeloCliente(r.modeloCliente);
    // La liga MANUAL (de la vista previa) manda; sólo el selector ofrece modelos activos. La liga
    // APRENDIDA a un modelo INACTIVO no se usa: reventaría la tx al confirmar → el PDF se OMITE con un
    // motivo claro (el usuario lo religa). Una liga manual a inactivo (raro) la ataja `salidaAProduccion`.
    const manual = ligasEntrada.get(clave);
    const aprendida = ligasAprendidas.get(clave);
    const idModelo =
      manual ?? (aprendida !== undefined && aprendida.activo ? aprendida.idModelo : null);
    if (idModelo === null) {
      noReconocidos.push({
        nombreArchivo: p.nombreArchivo,
        modeloCliente: r.modeloCliente,
        motivo:
          aprendida !== undefined && !aprendida.activo
            ? `El modelo antes ligado (#${aprendida.codigo}) quedó inactivo; lígalo a otro en la vista previa.`
            : 'Sin liga a un modelo; lígalo en la vista previa.',
      });
      continue;
    }
    if (sumaTallas(r) <= 0) {
      noReconocidos.push({
        nombreArchivo: p.nombreArchivo,
        modeloCliente: r.modeloCliente,
        motivo: 'El PDF no trae tallas con piezas.',
      });
      continue;
    }
    const subido = await archivos.subirContenido({
      nombreOriginal: p.nombreArchivo,
      tipoMime: 'application/pdf',
      carpeta: CARPETA_ADJUNTOS,
      contenido: p.buffer,
    });
    // Ajuste manual de la vista previa: la matriz editada (si el usuario la tocó) y el pantone. La
    // matriz sólo cuenta las tallas con cantidad > 0 (una celda en 0 no entra a la OP).
    const matrizEditada =
      ajuste?.matriz !== undefined
        ? ajuste.matriz
            .filter((t) => t.cantidad > 0)
            .map((t) => ({ talla: t.talla, cantidad: t.cantidad }))
        : null;
    const pantone =
      ajuste?.pantone !== undefined && ajuste.pantone !== ''
        ? ajuste.pantone
        : r.pantone !== ''
          ? r.pantone
          : null;
    aImportar.push({ nombreArchivo: p.nombreArchivo, r, idModelo, matrizEditada, pantone, subido });
  }

  if (aImportar.length === 0) {
    throw new ErrorValidacion(
      'Ningún PDF se pudo importar (sin liga a un modelo, sin tallas o ilegible). Liga al menos uno.',
    );
  }

  // 3) Transacción A2: pedido + N (renglón + OP + refs + adjunto) + ligas aprendidas. La validez del
  //    modelo (existe + activo) la impone `salidaAProduccion` (resolverOrigenPedido) DENTRO del loop,
  //    igual que el importador Excel: si un modelo está descontinuado, toda la tx se revierte (A2).
  const resultado = await enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, datos.idCliente);

    const referenciaGeneral =
      datos.referenciaGeneral === undefined ||
      datos.referenciaGeneral === null ||
      datos.referenciaGeneral === ''
        ? null
        : datos.referenciaGeneral;

    const folio = await siguienteFolio(tx, sesion.idEmpresaActiva, CLAVE_SECUENCIA_PEDIDO);
    const pedido = await tx.pedido.create({
      data: {
        folio,
        idEmpresa: sesion.idEmpresaActiva,
        idCliente: datos.idCliente,
        ocCliente: referenciaGeneral,
        ...datosCreacion(sesion),
      },
    });

    const ordenes: OrdenPdfImportada[] = [];
    let ligasContador = 0;

    for (const item of aImportar) {
      const orden = await crearOrdenDesdePdf(tx, sesion, {
        idPedido: pedido.id,
        idModelo: item.idModelo,
        r: item.r,
        camposVariables,
        porcentajeAdicional: pct,
        matrizEditada: item.matrizEditada,
        pantone: item.pantone,
        idCliente: datos.idCliente,
        subido: item.subido,
      });
      ordenes.push({
        ...orden,
        nombreArchivo: item.nombreArchivo,
        modeloCliente: item.r.modeloCliente,
      });
      if (await aprenderLiga(tx, sesion, datos.idCliente, item.r.modeloCliente, item.idModelo)) {
        ligasContador += 1;
      }
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: pedido.id,
      accion: 'CREAR',
      datos: {
        operacion: 'importar-pedido-pdf',
        folio: Number(folio),
        idCliente: datos.idCliente,
        pdfs: aImportar.length,
        noReconocidos: noReconocidos.length,
      },
    });

    return {
      idPedido: pedido.id,
      folioPedido: Number(folio),
      ordenes,
      noReconocidos,
      ligasAprendidas: ligasContador,
    };
  }, bd);

  // Las OPs encolaron sus eventos `orden-creada` en la MISMA tx (ya commiteada): dispara el relay.
  dispararPublicacion();

  // RECUERDA el % adicional en la plantilla del cliente (para la próxima importación) si el usuario lo
  // cambió respecto a lo guardado. Best-effort y FUERA de la tx de importación (la importación ya está
  // commiteada; si esto falla, sólo no se recuerda el %). Reusa `guardarPlantilla` (versión nueva pdf-cya,
  // conservando los campos variables vigentes).
  if (
    datos.porcentajeAdicional !== undefined &&
    datos.porcentajeAdicional !== config.porcentajeAdicional
  ) {
    try {
      await guardarPlantilla(
        sesion,
        datos.idCliente,
        {
          formato: 'pdf-cya',
          mapeo: [],
          camposVariables: config.camposVariables,
          porcentajeAdicional: datos.porcentajeAdicional,
        },
        bd,
      );
    } catch (error) {
      console.warn(`No se pudo recordar el % adicional del cliente ${datos.idCliente}.`, error);
    }
  }

  return resultado;
}

/**
 * Crea, dentro de la tx, la OP de UN PDF: resuelve/crea color + tallas (matriz), departamento y campos
 * de referencia (D7), crea el renglón, la OP (reusa `salidaAProduccion` → RC), sella el nº de orden C&A
 * y la composición en la OP, y adjunta el PDF (ya subido) a la orden. Devuelve la traza de la OP.
 */
async function crearOrdenDesdePdf(
  tx: Tx,
  sesion: SesionUsuario,
  args: {
    idPedido: number;
    idModelo: number;
    idCliente: number;
    r: RenglonPdfCyaParseado;
    camposVariables: CampoVariableImportacion[];
    porcentajeAdicional: number;
    /** Matriz editada por el usuario (total por talla); null = usar la propuesta por packs. */
    matrizEditada: { talla: string; cantidad: number }[] | null;
    /** Pantone del color de la OP (editado/prefilleado), o null. */
    pantone: string | null;
    subido: PdfAImportar['subido'];
  },
): Promise<Omit<OrdenPdfImportada, 'nombreArchivo' | 'modeloCliente'>> {
  const { r } = args;

  // FABRICAR por talla: si el usuario EDITÓ la matriz en la vista previa manda su edición; si no, la
  // PROPUESTA de sobre-pedido por packs (petición Daniel: el % se aplica al nº de packs, no talla por
  // talla). El renglón del pedido conserva la cantidad ORIGINAL del cliente (lo contractual).
  const propuesta = propuestaDe(r, args.porcentajeAdicional);
  const fabricarPorTalla = new Map<string, number>(
    args.matrizEditada !== null
      ? args.matrizEditada.map((t) => [t.talla.trim(), t.cantidad])
      : propuesta.totalPorTalla.map((c) => [c.talla, c.propuesta]),
  );
  const totalCliente = r.tallas.reduce((s, t) => s + Math.max(0, t.piezas), 0);

  // Matriz: un color (abierto, D14c) × las tallas a fabricar (resolver-o-crear cada una). Se recorren
  // TODAS las tallas involucradas (las del PDF + cualquier talla extra que la edición manual agregue).
  const idColor = await resolverOCrearColor(tx, sesion, r.colorGenerico);
  const etiquetasTalla = [
    ...new Set([...r.tallas.map((t) => t.talla), ...fabricarPorTalla.keys()]),
  ];
  const tallas: { idTalla: number; cantidad: number }[] = [];
  for (const etiqueta of etiquetasTalla) {
    const cantidad = fabricarPorTalla.get(etiqueta) ?? 0;
    if (cantidad <= 0) continue;
    const idTalla = await resolverOCrearTalla(tx, sesion, etiqueta);
    tallas.push({ idTalla, cantidad });
  }
  // El pantone viaja EN la línea de la matriz (mismo camino que la captura general): `sincronizarMatriz`
  // lo sella en el `OrdenLinea` del color. Null si la OC no lo trae ni el usuario lo capturó.
  const matriz = [{ idColor, tallas, pantone: args.pantone }];
  const totalFabricar = tallas.reduce((s, t) => s + t.cantidad, 0);

  // Departamento del cliente (División) + referencias configuradas (D7).
  if (r.division !== '') {
    await resolverOCrearDepartamento(tx, sesion, args.idCliente, r.division);
  }
  const referencias: { idClienteCampo: number; valor: string }[] = [];
  for (const cv of args.camposVariables) {
    const valor = valorCampo(cv.campo, r).trim();
    if (valor === '') continue;
    const idClienteCampo = await resolverOCrearCampo(tx, sesion, args.idCliente, cv.etiqueta);
    // Un mismo campo no puede repetirse en la orden (regla de `sincronizarReferencias`): si dos
    // configuraciones apuntan a la misma etiqueta, gana la primera.
    if (!referencias.some((x) => x.idClienteCampo === idClienteCampo)) {
      referencias.push({ idClienteCampo, valor });
    }
  }

  // Renglón del pedido + OP (reusa salidaAProduccion: folio A3, RC B5, nº de producción). El renglón
  // guarda la cantidad ORIGINAL del cliente (`totalCliente`); la OP se fabrica con el % adicional.
  const linea = await tx.pedidoLinea.create({
    data: {
      idPedido: args.idPedido,
      idModelo: args.idModelo,
      cantidadPedida: totalCliente,
      precio: r.costoUnitario,
      ...datosCreacion(sesion),
    },
  });
  const salida = await salidaAProduccion(
    sesion,
    linea.id,
    {
      lineas: matriz,
      referencias,
      ...(r.fechaEntrega !== null ? { fechaEntrega: r.fechaEntrega } : {}),
    },
    { tx },
  );

  // El nº de orden de C&A vive en la OP (cada PDF el suyo) + la composición del PDF. `crearOrden` copió
  // `Pedido.ocCliente` (la referencia general); aquí se SOBREESCRIBE con el nº de orden propio del PDF.
  // También se PERSISTE el desglose SKU/packs del cliente (base del futuro módulo de empaque), en ESTA
  // misma tx: si el alta se revierte, el desglose tampoco queda (A2).
  const packs = packsClienteJson(r);
  await tx.orden.update({
    where: { id: salida.orden.id },
    data: {
      ocCliente: r.numeroOrden,
      ...(r.composicion !== '' ? { composicion: r.composicion } : {}),
      ...(packs !== null ? { packsCliente: packs } : {}),
      ...datosModificacion(sesion),
    },
  });

  // Adjunta el PDF (ya subido server-side ANTES de la tx) a SU orden: Archivo + puente OrdenArchivo.
  const archivo = await tx.archivo.create({
    data: {
      bucket: args.subido.bucket,
      key: args.subido.key,
      nombreOriginal: args.subido.nombreOriginal,
      tipoMime: args.subido.tipoMime,
      tamanoBytes: args.subido.tamanoBytes,
      subidoPorId: sesion.id,
    },
  });
  await tx.ordenArchivo.create({
    data: { idOrden: salida.orden.id, idArchivo: archivo.id, creadoPorId: sesion.id },
  });

  return {
    idOrden: salida.orden.id,
    folio: salida.orden.folio,
    numeroProduccion: salida.numeroProduccion,
    codigoModelo: salida.orden.codigoModelo,
    numeroOrden: r.numeroOrden,
    totalPiezas: totalFabricar,
    adjuntado: true,
  };
}

// ── Helpers compartidos ──────────────────────────────────────────────────────

/** Exige que el cliente exista y esté ACTIVO (no se importan pedidos a un cliente desactivado). */
async function exigirClienteActivo(tx: Tx, idCliente: number): Promise<void> {
  const cliente = await tx.cliente.findUnique({
    where: { id: idCliente },
    select: { activo: true, nombre: true },
  });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  if (!cliente.activo) {
    throw new ErrorConflicto(
      `El cliente "${cliente.nombre}" está desactivado; reactívalo para importarle pedidos.`,
    );
  }
}
