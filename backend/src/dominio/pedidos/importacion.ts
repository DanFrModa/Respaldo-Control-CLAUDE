/**
 * IMPORTADOR del pedido del cliente (rediseño R8, B15 — proto §4.1 "Etapa 3"). El cliente manda su
 * Orden de Compra en SU formato (Excel); se le enseña UNA vez cómo mapear sus columnas (plantilla
 * por cliente, versionada) y las siguientes veces se importa solo. Al CONFIRMAR nace, en UNA
 * transacción (A2): pedido interno + una OP por modelo reconocido (con su matriz color×talla del
 * archivo) + su Ruta Crítica — REUSANDO `salidaAProduccion` (R3, B4).
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica AQUÍ; las rutas sólo validan permiso + Zod y delegan.
 *  • A2 — pedido + N líneas + N OPs + RC en UNA transacción (todo o nada); SIN I/O de red a R2
 *    dentro de la tx (el adjunto va aparte, ver abajo).
 *  • A3/A9 — folio por la secuencia atómica `"pedido"` de la empresa activa; el pedido nace en la
 *    empresa de la sesión.
 *  • A4 — SIN permisos nuevos: leer/guardar plantilla = `pedidos.*`; confirmar = `pedidos.administrar`
 *    Y `ordenes.administrar` (el mismo gate que el constructor/Generar OP de R3).
 *  • A5/B3 — el Excel original se adjunta al pedido por el flujo presigned ESTÁNDAR del repo (igual
 *    que todos los adjuntos): el CLIENTE lo sube tras el confirm, no el servidor. El confirm sólo
 *    parsea el archivo (para la matriz) y devuelve `idPedido` para que el cliente lo ligue.
 *  • A7 — auditoría uniforme (creado/modificadoPorId + Bitácora, incluye el nombre del archivo origen).
 *
 * Reconocimiento: modelo-del-cliente ↔ desarrollo por `Desarrollo.numeroCliente` (normalizado: sin
 * acentos, trim, minúsculas). Color y talla se resuelven por nombre normalizado contra el catálogo
 * (Color global, Talla global). Lo que no matchee se devuelve aparte para resolverlo a mano; los
 * modelos que quedan sin desarrollo se OMITEN (el resto sí se importa).
 */
import ExcelJS from 'exceljs';

import type {
  AnalizarImportacionSalida,
  CampoVariableImportacion,
  ConfirmarImportacionSalida,
  DatosAnalizarImportacion,
  DatosConfirmarImportacion,
  DatosPlantillaImportacionGuardar,
  FormatoImportacion,
  GrupoImportacion,
  MapeoColumna,
  MapeoImportacion,
  OrdenImportada,
  PlantillaImportacionSalida,
  PlantillaImportacionVigente,
  RolColumnaImportacion,
} from '../../contrato/index.js';
import {
  esquemaAnalizarImportacionCuerpo,
  esquemaCampoVariableImportacion,
  esquemaConfirmarImportacionCuerpo,
  esquemaFormatoImportacion,
  esquemaMapeoColumna,
  esquemaMapeoImportacion,
  esquemaPlantillaImportacionGuardar,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import type { PrismaClient } from '../../datos/index.js';

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

import { CLAVE_SECUENCIA_PEDIDO } from './pedidos.js';
import {
  cargarOcYaImportadas,
  claveOcCliente,
  describirExistente,
  NAMESPACE_LOCK_IMPORTACION,
} from './oc-duplicada.js';
import { salidaAProduccion } from '../produccion/salida-produccion.js';

/** Tope del archivo decodificado (los OCs son chicos; blinda memoria/parseo). */
const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024;

/** Cuántas filas de muestra se devuelven para el paso "Formato". */
const FILAS_MUESTRA = 5;

// ── Normalización y coerción ─────────────────────────────────────────────────

/** Clave de comparación: sin acentos/diacríticos, sin espacios en los extremos, en minúsculas. */
function normalizarClave(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Convierte el valor de una celda de exceljs (rich text, fórmula, fecha, número…) a texto plano. */
function celdaATexto(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'object') {
    const objeto = valor as unknown as Record<string, unknown>;
    if ('richText' in objeto && Array.isArray(objeto.richText)) {
      return objeto.richText
        .map((parte) => (parte as { text?: string }).text ?? '')
        .join('')
        .trim();
    }
    if ('result' in objeto) return celdaATexto(objeto.result as ExcelJS.CellValue);
    if ('text' in objeto && typeof objeto.text === 'string') return objeto.text.trim();
    // Cualquier otro objeto (error, fórmula compartida…) no aporta texto útil.
    return '';
  }
  return '';
}

/** Interpreta un texto como número (tolera separadores de miles/moneda); vacío/inválido → 0. */
function aNumero(texto: string): number {
  if (texto === '') return 0;
  const limpio = texto.replace(/[^0-9.-]/g, '');
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Interpreta la CANTIDAD de una celda distinguiendo tres casos (hallazgo del reviewer): vacío =
 * cero legítimo (fila sin ese renglón, no se avisa); texto presente PERO no numérico (p. ej. "N/A",
 * "pend.") = ILEGIBLE → se cuenta y se avisa en la vista previa para que no desaparezca en silencio;
 * texto numérico = su valor redondeado.
 */
function parsearCantidad(texto: string): { cantidad: number; ilegible: boolean } {
  const recortado = texto.trim();
  if (recortado === '') return { cantidad: 0, ilegible: false };
  const limpio = recortado.replace(/[^0-9.-]/g, '');
  if (limpio === '') return { cantidad: 0, ilegible: true };
  const numero = Number(limpio);
  if (!Number.isFinite(numero)) return { cantidad: 0, ilegible: true };
  return { cantidad: Math.round(numero), ilegible: false };
}

/** Decodifica el base64 (acepta prefijo `data:`) a Buffer, validando tamaño. */
function decodificarArchivo(base64: string): Buffer {
  const limpio =
    base64.startsWith('data:') && base64.includes(',')
      ? base64.slice(base64.indexOf(',') + 1)
      : base64;
  const buffer = Buffer.from(limpio, 'base64');
  if (buffer.length === 0) {
    throw new ErrorValidacion('El archivo del cliente está vacío o no se pudo leer.');
  }
  if (buffer.length > MAX_ARCHIVO_BYTES) {
    throw new ErrorValidacion('El archivo del cliente excede el máximo permitido (10 MB).');
  }
  return buffer;
}

// ── Parseo del Excel ─────────────────────────────────────────────────────────

/** Encabezados + filas (como texto) del archivo del cliente. */
interface ArchivoParseado {
  columnas: string[];
  filas: string[][];
}

/** Lee el Excel con exceljs: primera hoja, fila 1 = encabezados, resto = datos (omite filas vacías). */
async function parsearExcel(buffer: Buffer): Promise<ArchivoParseado> {
  const libro = new ExcelJS.Workbook();
  try {
    // Cast al tipo exacto que espera exceljs (skew de la genérica `Buffer<…>` entre @types/node
    // y el bundle de exceljs; en runtime es el mismo Buffer).
    await libro.xlsx.load(buffer as unknown as Parameters<typeof libro.xlsx.load>[0]);
  } catch {
    throw new ErrorValidacion('El archivo no es un Excel válido (.xlsx).');
  }
  const hoja = libro.worksheets[0];
  if (hoja === undefined) {
    throw new ErrorValidacion('El archivo de Excel no tiene hojas.');
  }
  const numColumnas = hoja.columnCount;
  if (numColumnas === 0) {
    throw new ErrorValidacion('El archivo de Excel no tiene columnas.');
  }
  const filaEncabezado = hoja.getRow(1);
  const columnas: string[] = [];
  for (let c = 1; c <= numColumnas; c++) {
    const texto = celdaATexto(filaEncabezado.getCell(c).value);
    columnas.push(texto === '' ? `Columna ${c}` : texto);
  }
  const filas: string[][] = [];
  for (let r = 2; r <= hoja.rowCount; r++) {
    const filaExcel = hoja.getRow(r);
    const valores: string[] = [];
    let vacia = true;
    for (let c = 1; c <= numColumnas; c++) {
      const texto = celdaATexto(filaExcel.getCell(c).value);
      if (texto !== '') vacia = false;
      valores.push(texto);
    }
    if (!vacia) filas.push(valores);
  }
  return { columnas, filas };
}

// ── Agrupación por modelo del cliente ────────────────────────────────────────

/** Un renglón crudo del archivo (ya con los roles extraídos por el mapeo). */
interface RenglonCrudo {
  color: string;
  talla: string;
  cantidad: number;
  precio: number;
}

/** Un grupo = un modelo del cliente con sus renglones. */
interface GrupoCrudo {
  modeloCliente: string;
  claveModelo: string;
  renglones: RenglonCrudo[];
  /** Filas de este modelo cuya CANTIDAD venía presente pero no numérica (se avisa en la vista previa). */
  cantidadesIlegibles: number;
}

/** Índice de columna por rol (‑1 = ausente). */
type IndicePorRol = Record<RolColumnaImportacion, number>;

/** Arma el índice columna→rol desde el mapeo (el índice manda al aplicar; el encabezado es cosmético). */
function indicePorRol(mapeo: MapeoImportacion): IndicePorRol {
  const indice: IndicePorRol = {
    modeloCliente: -1,
    color: -1,
    talla: -1,
    cantidad: -1,
    precio: -1,
    ignorar: -1,
  };
  for (const item of mapeo) {
    if (item.rol !== 'ignorar') indice[item.rol] = item.indice;
  }
  return indice;
}

/** Aplica el mapeo y agrupa las filas por modelo del cliente (conserva el orden de aparición). */
function agruparPorModelo(archivo: ArchivoParseado, mapeo: MapeoImportacion): GrupoCrudo[] {
  const indice = indicePorRol(mapeo);
  const celda = (fila: string[], columna: number): string =>
    columna >= 0 ? (fila[columna] ?? '') : '';

  const orden: string[] = [];
  const porClave = new Map<string, GrupoCrudo>();
  for (const fila of archivo.filas) {
    const modeloCliente = celda(fila, indice.modeloCliente).trim();
    if (modeloCliente === '') continue; // fila sin modelo → se ignora
    const claveModelo = normalizarClave(modeloCliente);
    let grupo = porClave.get(claveModelo);
    if (grupo === undefined) {
      grupo = { modeloCliente, claveModelo, renglones: [], cantidadesIlegibles: 0 };
      porClave.set(claveModelo, grupo);
      orden.push(claveModelo);
    }
    const cantidad =
      indice.cantidad >= 0
        ? parsearCantidad(celda(fila, indice.cantidad))
        : { cantidad: 0, ilegible: false };
    if (cantidad.ilegible) grupo.cantidadesIlegibles += 1;
    grupo.renglones.push({
      color: celda(fila, indice.color).trim(),
      talla: celda(fila, indice.talla).trim(),
      cantidad: cantidad.cantidad,
      precio: indice.precio >= 0 ? aNumero(celda(fila, indice.precio)) : 0,
    });
  }
  return orden.map((clave) => porClave.get(clave) as GrupoCrudo);
}

// ── Catálogos y desarrollos para el reconocimiento ───────────────────────────

/** Un desarrollo candidato para amarrar (del cliente + empresa activa, no apagado). */
interface DesarrolloAmarre {
  id: number;
  idModelo: number;
  numeroCliente: string | null;
  codigoModelo: string;
  descripcionModelo: string | null;
  numeroProduccion: number | null;
}

/** Diccionarios de reconocimiento (por nº de cliente + por id para las ligas manuales). */
interface Reconocedor {
  porNumeroCliente: Map<string, DesarrolloAmarre>;
  porId: Map<number, DesarrolloAmarre>;
  colores: Map<string, number>;
  tallas: Map<string, number>;
}

/** Carga los desarrollos del cliente y los catálogos de color/talla, normalizados para comparar. */
async function cargarReconocedor(
  bd: Tx | PrismaClient,
  idCliente: number,
  idEmpresa: number,
): Promise<Reconocedor> {
  const desarrollos = await bd.desarrollo.findMany({
    where: { apagado: false, proyecto: { idCliente, idEmpresa } },
    // `orderBy id asc` DETERMINISTA (hallazgo del reviewer + lección del repo): no hay unicidad de
    // `numeroCliente`, así que dos desarrollos podrían normalizar igual; sin orden, "el primero gana"
    // dependería del scan de Postgres y la vista previa podría amarrar un desarrollo distinto al del
    // confirmar. Con el orden estable, preview y confirmar eligen SIEMPRE el mismo (el de menor id).
    orderBy: { id: 'asc' },
    select: {
      id: true,
      idModelo: true,
      numeroCliente: true,
      modelo: { select: { codigo: true, descripcion: true, numeroProduccion: true } },
    },
  });
  const porNumeroCliente = new Map<string, DesarrolloAmarre>();
  const porId = new Map<number, DesarrolloAmarre>();
  for (const des of desarrollos) {
    const amarre: DesarrolloAmarre = {
      id: des.id,
      idModelo: des.idModelo,
      numeroCliente: des.numeroCliente,
      codigoModelo: des.modelo.codigo,
      descripcionModelo: des.modelo.descripcion,
      numeroProduccion: des.modelo.numeroProduccion,
    };
    porId.set(des.id, amarre);
    if (des.numeroCliente !== null) {
      const clave = normalizarClave(des.numeroCliente);
      // Ante colisión de `numeroCliente` normalizado, gana el de MENOR id (por el orderBy de arriba).
      if (clave !== '' && !porNumeroCliente.has(clave)) porNumeroCliente.set(clave, amarre);
    }
  }

  // `orderBy id asc` + "primero gana" DETERMINISTA (espejo del reconocimiento por desarrollo): el
  // nombre/etiqueta es @unique CON acentos y mayúsculas, pero `normalizarClave` los aplana → "Café"
  // y "Cafe" (o "M" y "m") pueden coexistir y normalizar igual. Sin orden + `Map.set` "último gana",
  // qué id gana dependería del scan de Postgres, y como `analizar` y `confirmar` cargan el reconocedor
  // por separado la matriz de la OP podría quedar con un id distinto al de la vista previa.
  const [colores, tallas] = await Promise.all([
    bd.color.findMany({
      where: { activo: true },
      orderBy: { id: 'asc' },
      select: { id: true, nombre: true },
    }),
    bd.talla.findMany({
      where: { activo: true },
      orderBy: { id: 'asc' },
      select: { id: true, etiqueta: true },
    }),
  ]);
  const mapaColores = new Map<string, number>();
  for (const color of colores) {
    const clave = normalizarClave(color.nombre);
    if (!mapaColores.has(clave)) mapaColores.set(clave, color.id);
  }
  const mapaTallas = new Map<string, number>();
  for (const talla of tallas) {
    const clave = normalizarClave(talla.etiqueta);
    if (!mapaTallas.has(clave)) mapaTallas.set(clave, talla.id);
  }

  return { porNumeroCliente, porId, colores: mapaColores, tallas: mapaTallas };
}

// ── Resolución de un grupo (reconocimiento + matriz) ─────────────────────────

/** Un grupo resuelto: su desarrollo (o null), su matriz para la OP y lo que no se pudo resolver. */
interface GrupoResuelto {
  modeloCliente: string;
  amarre: DesarrolloAmarre | null;
  totalPiezas: number;
  numRenglones: number;
  precio: number;
  matriz: { idColor: number; tallas: { idTalla: number; cantidad: number }[] }[];
  coloresNoResueltos: string[];
  tallasNoResueltas: string[];
  cantidadesIlegibles: number;
}

/**
 * Resuelve un grupo: amarra su desarrollo (liga manual si la hay, si no por nº de cliente), suma sus
 * piezas y arma la matriz color×talla resolviendo cada color/talla contra el catálogo. Los colores y
 * tallas que no existen se acumulan (bloquean la matriz — el confirmar los rechaza; la vista previa
 * los muestra).
 */
function resolverGrupo(
  grupo: GrupoCrudo,
  reconocedor: Reconocedor,
  ligaManual: Map<string, number>,
): GrupoResuelto {
  const idManual = ligaManual.get(grupo.claveModelo);
  const amarre =
    idManual !== undefined
      ? (reconocedor.porId.get(idManual) ??
        (() => {
          // La liga apunta a un desarrollo que NO es del cliente/empresa (o está apagado): no existe.
          throw new ErrorNoEncontrado('Desarrollo', idManual);
        })())
      : (reconocedor.porNumeroCliente.get(grupo.claveModelo) ?? null);

  let totalPiezas = 0;
  let precio = 0;
  const coloresNoResueltos = new Set<string>();
  const tallasNoResueltas = new Set<string>();
  // Matriz agrupada por idColor → idTalla (suma).
  const porColorTalla = new Map<number, Map<number, number>>();

  for (const renglon of grupo.renglones) {
    if (precio === 0 && renglon.precio > 0) precio = renglon.precio;
    if (renglon.cantidad <= 0) continue;
    totalPiezas += renglon.cantidad;

    const idColor =
      renglon.color === '' ? undefined : reconocedor.colores.get(normalizarClave(renglon.color));
    const idTalla =
      renglon.talla === '' ? undefined : reconocedor.tallas.get(normalizarClave(renglon.talla));
    if (idColor === undefined) {
      coloresNoResueltos.add(renglon.color === '' ? '(sin color)' : renglon.color);
    }
    if (idTalla === undefined) {
      tallasNoResueltas.add(renglon.talla === '' ? '(sin talla)' : renglon.talla);
    }
    if (idColor !== undefined && idTalla !== undefined) {
      const porTalla = porColorTalla.get(idColor) ?? new Map<number, number>();
      porTalla.set(idTalla, (porTalla.get(idTalla) ?? 0) + renglon.cantidad);
      porColorTalla.set(idColor, porTalla);
    }
  }

  const matriz = [...porColorTalla.entries()].map(([idColor, porTalla]) => ({
    idColor,
    tallas: [...porTalla.entries()].map(([idTalla, cantidad]) => ({ idTalla, cantidad })),
  }));

  return {
    modeloCliente: grupo.modeloCliente,
    amarre,
    totalPiezas,
    numRenglones: grupo.renglones.length,
    precio,
    matriz,
    coloresNoResueltos: [...coloresNoResueltos],
    tallasNoResueltas: [...tallasNoResueltas],
    cantidadesIlegibles: grupo.cantidadesIlegibles,
  };
}

// ── Proyección de la plantilla ───────────────────────────────────────────────

/** Forma de la fila `PlantillaImportacion` que se lee de BD. */
interface FilaPlantilla {
  id: number;
  idCliente: number;
  nombre: string;
  version: number;
  vigente: boolean;
  formato: string;
  mapeo: Prisma.JsonValue;
  camposVariables: Prisma.JsonValue;
  porcentajeAdicional: Prisma.Decimal;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

/** Proyecta una plantilla a la salida del contrato (validando los JSON de mapeo y campos variables). */
function aPlantillaSalida(fila: FilaPlantilla): PlantillaImportacionSalida {
  const mapeo = leerMapeoJson(fila.mapeo);
  // `formato` es texto en BD (para crecer sin migrar); si viniera un valor desconocido, cae a 'excel'.
  const formatoParseado = esquemaFormatoImportacion.safeParse(fila.formato);
  const formato: FormatoImportacion = formatoParseado.success ? formatoParseado.data : 'excel';
  return {
    id: fila.id,
    idCliente: fila.idCliente,
    nombre: fila.nombre,
    version: fila.version,
    vigente: fila.vigente,
    formato,
    mapeo,
    camposVariables: leerCamposVariablesJson(fila.camposVariables),
    porcentajeAdicional: fila.porcentajeAdicional.toNumber(),
    creadoEn: fila.creadoEn.toISOString(),
    creadoPorId: fila.creadoPorId,
    modificadoEn: fila.modificadoEn.toISOString(),
    modificadoPorId: fila.modificadoPorId,
  };
}

/** Lee/valida el JSON `mapeo` guardado (defensa: una plantilla vieja/corrupta no revienta la UI). */
function leerMapeoJson(json: Prisma.JsonValue): MapeoColumna[] {
  if (!Array.isArray(json)) return [];
  const salida: MapeoColumna[] = [];
  for (const item of json) {
    const parseado = esquemaMapeoColumna.safeParse(item);
    if (parseado.success) salida.push(parseado.data);
  }
  return salida;
}

/** Lee/valida el JSON `camposVariables` (null si vacío/ausente; descarta entradas corruptas). */
export function leerCamposVariablesJson(json: Prisma.JsonValue): CampoVariableImportacion[] | null {
  if (!Array.isArray(json)) return null;
  const salida: CampoVariableImportacion[] = [];
  for (const item of json) {
    const parseado = esquemaCampoVariableImportacion.safeParse(item);
    if (parseado.success) salida.push(parseado.data);
  }
  return salida.length === 0 ? null : salida;
}

// ── Operaciones: plantilla ───────────────────────────────────────────────────

/** Nombre por defecto de una plantilla según su formato (cuando el usuario no da uno). */
function nombreDefault(formato: FormatoImportacion, version: number): string {
  return formato === 'pdf-cya' ? `OC en PDF (C&A) v${version}` : `Formato del cliente v${version}`;
}

/** Obtiene la plantilla VIGENTE de un cliente (o null). Requiere `pedidos.ver`. */
export async function obtenerPlantillaVigente(
  sesion: SesionUsuario,
  idCliente: number,
  bd?: ContextoBd,
): Promise<PlantillaImportacionVigente> {
  verificarPermiso(sesion, 'pedidos.ver');
  const cliente = clienteLectura(bd);
  const fila = await cliente.plantillaImportacion.findFirst({
    where: { idCliente, vigente: true },
  });
  return { plantilla: fila === null ? null : aPlantillaSalida(fila) };
}

/**
 * Guarda una plantilla como versión NUEVA (no edita la vieja): en UNA transacción (A2) baja la
 * vigente actual, calcula la versión siguiente y crea la nueva vigente. Garantiza "una vigente por
 * cliente" bajo la transacción (como el borrador único de `Precosto`). Requiere `pedidos.administrar`.
 */
export async function guardarPlantilla(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: DatosPlantillaImportacionGuardar,
  bd?: ContextoBd,
): Promise<PlantillaImportacionSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const datos = validarEntrada(esquemaPlantillaImportacionGuardar, entrada);

  const id = await enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    // SERIALIZA las altas concurrentes de la MISMA plantilla-de-cliente (advisory lock transaccional,
    // patrón del kardex/reglas): sin él, dos guardados simultáneos podrían dejar DOS vigentes o
    // colisionar en `version` (write-skew). El lock se libera al commit/rollback de la tx.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${0x52440002}::int, ${idCliente}::int)`;
    const ultima = await tx.plantillaImportacion.findFirst({
      where: { idCliente },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (ultima?.version ?? 0) + 1;
    // Baja las vigentes anteriores (garantía "una vigente por cliente" bajo la tx + el lock).
    await tx.plantillaImportacion.updateMany({
      where: { idCliente, vigente: true },
      data: { vigente: false, ...datosModificacion(sesion) },
    });
    const creada = await tx.plantillaImportacion.create({
      data: {
        idCliente,
        nombre: datos.nombre ?? nombreDefault(datos.formato, version),
        version,
        vigente: true,
        formato: datos.formato,
        mapeo: datos.mapeo,
        // Los campos variables sólo aplican a pdf-cya; en excel se guardan como null (JSON nullable).
        camposVariables:
          datos.formato === 'pdf-cya' && datos.camposVariables != null
            ? datos.camposVariables
            : Prisma.DbNull,
        porcentajeAdicional: datos.porcentajeAdicional ?? 0,
        ...datosCreacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Cliente',
      idEntidad: idCliente,
      accion: 'MODIFICAR',
      datos: { operacion: 'plantilla-importacion-guardar', idPlantilla: creada.id, version },
    });
    return creada.id;
  }, bd);

  const fila = await clienteLectura(bd).plantillaImportacion.findUniqueOrThrow({ where: { id } });
  return aPlantillaSalida(fila);
}

// ── Operación: analizar / vista previa ───────────────────────────────────────

/**
 * Analiza el archivo del cliente: devuelve encabezados/muestras (para el paso "Formato"), la
 * plantilla vigente (si hay) y —si hay mapeo (el enviado o el de la plantilla vigente)— la VISTA
 * PREVIA con los modelos reconocidos/no-reconocidos. Requiere `pedidos.administrar` (sirve a la
 * captura). Solo LEE (no escribe nada).
 */
export async function analizarImportacion(
  sesion: SesionUsuario,
  entrada: DatosAnalizarImportacion,
  bd?: ContextoBd,
): Promise<AnalizarImportacionSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const datos = validarEntrada(esquemaAnalizarImportacionCuerpo, entrada);
  const cliente = clienteLectura(bd);
  const verImportes = tienePermiso(sesion, 'pedidos.importes');

  const archivo = await parsearExcel(decodificarArchivo(datos.archivoBase64));

  const filaPlantilla = await cliente.plantillaImportacion.findFirst({
    where: { idCliente: datos.idCliente, vigente: true },
  });
  const plantillaVigente = filaPlantilla === null ? null : aPlantillaSalida(filaPlantilla);

  const mapeo: MapeoImportacion | null = datos.mapeo ?? plantillaVigente?.mapeo ?? null;
  let preview: AnalizarImportacionSalida['preview'] = null;
  if (mapeo !== null && mapeo.length > 0) {
    // El mapeo de la plantilla puede ser incompleto (versión vieja): valida antes de armar la vista.
    const mapeoValido = esquemaMapeoImportacion.safeParse(mapeo);
    if (mapeoValido.success) {
      const reconocedor = await cargarReconocedor(cliente, datos.idCliente, sesion.idEmpresaActiva);
      const grupos = agruparPorModelo(archivo, mapeoValido.data).map((grupo) =>
        resolverGrupo(grupo, reconocedor, new Map()),
      );
      preview = aPreview(grupos, verImportes);
    }
  }

  return {
    columnas: archivo.columnas,
    muestras: archivo.filas.slice(0, FILAS_MUESTRA),
    totalFilas: archivo.filas.length,
    plantillaVigente,
    preview,
  };
}

/** Arma la vista previa (grupos + totales) desde los grupos resueltos. */
function aPreview(
  grupos: GrupoResuelto[],
  verImportes: boolean,
): NonNullable<AnalizarImportacionSalida['preview']> {
  const salida: GrupoImportacion[] = grupos.map((grupo) => ({
    modeloCliente: grupo.modeloCliente,
    reconocido: grupo.amarre !== null,
    idDesarrollo: grupo.amarre?.id ?? null,
    idModelo: grupo.amarre?.idModelo ?? null,
    codigoModelo: grupo.amarre?.codigoModelo ?? null,
    descripcionModelo: grupo.amarre?.descripcionModelo ?? null,
    numeroProduccion: grupo.amarre?.numeroProduccion ?? null,
    totalPiezas: grupo.totalPiezas,
    numRenglones: grupo.numRenglones,
    precio: verImportes ? (grupo.precio > 0 ? grupo.precio : null) : null,
    coloresNoResueltos: grupo.coloresNoResueltos,
    tallasNoResueltas: grupo.tallasNoResueltas,
    cantidadesIlegibles: grupo.cantidadesIlegibles,
  }));
  return {
    grupos: salida,
    totalGrupos: salida.length,
    totalReconocidos: salida.filter((grupo) => grupo.reconocido).length,
    totalPiezas: salida.reduce((suma, grupo) => suma + grupo.totalPiezas, 0),
  };
}

// ── Operación: confirmar la importación ──────────────────────────────────────

/**
 * Confirma la importación: crea el pedido interno + una OP por modelo RECONOCIDO (con su matriz +
 * liga + nº de producción + RC), reusando `salidaAProduccion`, en UNA transacción (A2). Los modelos
 * sin desarrollo (ni auto ni manual) se OMITEN y se devuelven en `noReconocidos`. Un modelo
 * reconocido con colores/tallas que no existen en el catálogo aborta TODO con un error claro (la
 * vista previa ya lo avisó). Requiere `pedidos.administrar` Y `ordenes.administrar`.
 *
 * El Excel original NO se adjunta aquí: el confirmar es una transacción A2 PURA sin I/O de red a R2.
 * El adjunto del pedido (B3) lo sube el CLIENTE por el flujo presigned estándar del repo (el mismo
 * de todos los adjuntos), después de este confirm y de forma NO-FATAL — se devuelve `idPedido` para
 * que pueda ligarlo. Aquí sólo se PARSEA el archivo (para la matriz, A1) y se guarda su nombre en la
 * bitácora (auditoría del origen, A7).
 */
export async function confirmarImportacion(
  sesion: SesionUsuario,
  entrada: DatosConfirmarImportacion,
  bd?: ContextoBd,
): Promise<ConfirmarImportacionSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaConfirmarImportacionCuerpo, entrada);

  const buffer = decodificarArchivo(datos.archivoBase64);
  const archivo = await parsearExcel(buffer);
  const gruposCrudos = agruparPorModelo(archivo, datos.mapeo);
  if (gruposCrudos.length === 0) {
    throw new ErrorValidacion('El archivo no tiene renglones con modelo del cliente.');
  }

  const ocCliente =
    datos.ocCliente === undefined || datos.ocCliente === null || datos.ocCliente === ''
      ? null
      : datos.ocCliente;

  const ligaManual = new Map<string, number>(
    datos.resoluciones.map((r) => [normalizarClave(r.modeloCliente), r.idDesarrollo]),
  );

  const resultado = await enTransaccion(async (tx) => {
    // Mismo candado por CLIENTE que el importador por PDF (V1-E4 punto 1): las dos rutas de
    // importación comparten namespace, así que confirmar el mismo papel por Excel y por PDF a la
    // vez tampoco puede colarse.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_IMPORTACION}::int, ${datos.idCliente}::int)`;
    await exigirClienteActivo(tx, datos.idCliente);
    await exigirOcNoImportada(tx, datos.idCliente, sesion.idEmpresaActiva, ocCliente);
    const reconocedor = await cargarReconocedor(tx, datos.idCliente, sesion.idEmpresaActiva);

    const resueltos = gruposCrudos.map((grupo) => resolverGrupo(grupo, reconocedor, ligaManual));
    const reconocidos = resueltos.filter((grupo) => grupo.amarre !== null);
    const noReconocidos = resueltos
      .filter((grupo) => grupo.amarre === null)
      .map((grupo) => grupo.modeloCliente);

    if (reconocidos.length === 0) {
      throw new ErrorValidacion(
        'Ningún modelo del archivo se reconoció ni se ligó a un desarrollo; liga al menos uno para importar.',
      );
    }

    // Un modelo reconocido con colores/tallas que no existen en el catálogo NO puede armar su
    // matriz: se rechaza TODO (A2) con un mensaje claro (la vista previa ya lo señaló).
    const conProblemas = reconocidos.find(
      (grupo) => grupo.coloresNoResueltos.length > 0 || grupo.tallasNoResueltas.length > 0,
    );
    if (conProblemas !== undefined) {
      const faltantes = [
        ...conProblemas.coloresNoResueltos.map((c) => `color "${c}"`),
        ...conProblemas.tallasNoResueltas.map((t) => `talla "${t}"`),
      ].join(', ');
      throw new ErrorValidacion(
        `El modelo "${conProblemas.modeloCliente}" trae ${faltantes} que no existen en el catálogo; agrégalos o corrige el archivo antes de importar.`,
      );
    }

    // Sólo los reconocidos CON piezas (matriz no vacía) generan OP; un modelo reconocido con todas
    // sus cantidades en 0 no crea una OP vacía (evita un `salidaAProduccion` sin matriz).
    const aGenerar = reconocidos.filter((grupo) => grupo.matriz.length > 0);
    if (aGenerar.length === 0) {
      throw new ErrorValidacion(
        'Los modelos reconocidos no traen piezas (todas las cantidades están en 0).',
      );
    }

    // Pedido interno (empresa activa A9, folio A3, OC del cliente B3).
    const folio = await siguienteFolio(tx, sesion.idEmpresaActiva, CLAVE_SECUENCIA_PEDIDO);
    const pedido = await tx.pedido.create({
      data: {
        folio,
        idEmpresa: sesion.idEmpresaActiva,
        idCliente: datos.idCliente,
        ocCliente,
        ...datosCreacion(sesion),
      },
    });

    // Una línea + una OP (salida a producción) por modelo reconocido con piezas, en ESTA transacción.
    const ordenes: OrdenImportada[] = [];
    for (const grupo of aGenerar) {
      const amarre = grupo.amarre as DesarrolloAmarre;
      const linea = await tx.pedidoLinea.create({
        data: {
          idPedido: pedido.id,
          idModelo: amarre.idModelo,
          idDesarrollo: amarre.id,
          cantidadPedida: grupo.totalPiezas,
          precio: grupo.precio,
          ...datosCreacion(sesion),
        },
      });
      const salida = await salidaAProduccion(sesion, linea.id, { lineas: grupo.matriz }, { tx });
      ordenes.push({
        idOrden: salida.orden.id,
        folio: salida.orden.folio,
        numeroProduccion: salida.numeroProduccion,
        codigoModelo: amarre.codigoModelo,
        modeloCliente: grupo.modeloCliente,
        totalPiezas: grupo.totalPiezas,
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: pedido.id,
      accion: 'CREAR',
      datos: {
        operacion: 'importar-pedido',
        folio: Number(folio),
        idCliente: datos.idCliente,
        archivo: datos.nombreArchivo,
        reconocidos: reconocidos.length,
        noReconocidos: noReconocidos.length,
      },
    });

    return {
      idPedido: pedido.id,
      folioPedido: Number(folio),
      ordenes,
      noReconocidos,
    };
  }, bd);

  // Las OPs encolaron sus eventos `orden-creada` en la MISMA tx (ya commiteada): dispara el relay.
  dispararPublicacion();
  return resultado;
}

// ── Helpers compartidos ──────────────────────────────────────────────────────

/**
 * Defensa V1-E4 (punto 1): exige que la OC del cliente NO se haya importado ya, POR NINGUNA DE LAS
 * DOS PUERTAS.
 *
 * ⚠️ En la primera ronda esta guarda solo miraba `Pedido.ocCliente`, mientras la del importador PDF
 * miraba `Orden.ocCliente`. Como el PDF guarda el nº de orden del papel ÚNICAMENTE en la OP (en el
 * pedido va la referencia general de la tanda), una OC importada por PDF se podía volver a importar
 * por Excel SIN QUE NADA AVISARA — y al revés sí se detectaba. Ahora las dos puertas comparten
 * `cargarOcYaImportadas`, que consulta ambas fuentes (ver `oc-duplicada.ts`).
 *
 * LÍMITE HONESTO: sin OC capturada no hay con qué comparar, así que una importación SIN referencia
 * sigue pudiendo repetirse. Es deliberado: inventar una identidad (nombre del archivo, fecha…)
 * bloquearía importaciones legítimas del mismo cliente el mismo día. El importador por PDF no tiene
 * ese hueco porque cada OP trae su propio nº de orden del papel.
 *
 * Debe llamarse DENTRO de la tx y DESPUÉS de tomar `NAMESPACE_LOCK_IMPORTACION`, o vuelve a haber
 * ventana de carrera.
 */
async function exigirOcNoImportada(
  tx: Tx,
  idCliente: number,
  idEmpresa: number,
  ocCliente: string | null,
): Promise<void> {
  if (claveOcCliente(ocCliente) === '') return;
  const yaImportadas = await cargarOcYaImportadas(tx, idCliente, idEmpresa, [ocCliente ?? '']);
  const existente = yaImportadas.get(claveOcCliente(ocCliente));
  if (existente !== undefined) {
    throw new ErrorConflicto(
      `La OC "${(ocCliente ?? '').trim()}" de este cliente YA se importó: nació ${describirExistente(existente)}. No se vuelve a importar (se duplicaría la producción); si de verdad es otra orden de compra, cámbiale la referencia.`,
    );
  }
}

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
