/**
 * Loader de FOTOS masivas de MODELOS y BORDADOS (F1-E7, R2).
 *
 * FOTOS DE MODELOS (~9,000 archivos):
 *  • Directorio configurado por env `ETL_FOTOS_MOD_DIR` (ruta absoluta a la carpeta de imágenes).
 *  • Convención del viejo (doc 01-Modelos §4): `Foto1` = nombre del archivo de frente,
 *    `Foto2` = nombre del archivo de espalda (frecuente: código-P). Los valores vienen en los
 *    campos `Foto1`/`Foto2` del CSV de Modelos.  El loader busca en el directorio un archivo
 *    cuyo nombre (sin extensión) coincida con el valor de `Foto1`/`Foto2`, y acepta cualquier
 *    extensión de imagen conocida (`.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`).
 *  • ORDEN R2-primero: sube el objeto a R2 con `PutObjectCommand` (el ETL corre en servidor,
 *    no en navegador) y SOLO si la subida fue OK crea `Archivo` + `ModeloFoto` en la BD. Así,
 *    si R2 falla, NO queda fila huérfana apuntando a un objeto inexistente, y re-correr reintenta
 *    limpio. (Un objeto R2 huérfano de un intento previo es inofensivo: la key lleva `randomUUID`.)
 *  • IDEMPOTENTE: salta la foto si ya existe un `ModeloFoto` de tipo FRENTE/ESPALDA para ese
 *    modelo cuyo `Archivo.key` empiece con `modelos/<idModelo>/etl-`.
 *  • Si `ETL_FOTOS_MOD_DIR` NO está seteado, el loader se SALTA limpio con un aviso.
 *
 * FOTOS DE BORDADOS (~2,686 archivos):
 *  • Directorio configurado por env `ETL_FOTOS_BOR_DIR`.
 *  • Cada arte viejo tiene un campo `Foto` en `Bordados.csv`; el ETL de catálogos (E6) NO cargó
 *    las fotos.  Aquí se completan (mismo orden R2-primero que las de modelos).
 *  • IDEMPOTENTE: salta los artes que ya tienen foto (`idArchivoFoto` no null).
 *  • Si `ETL_FOTOS_BOR_DIR` NO está seteado, se SALTA limpio con un aviso.
 *
 * REGLA DURA: los tests de CI NO suben archivos reales a R2 ni a ningún directorio — las fotos
 * se verifican mediante unit tests (mocks de FS) y el int-test verifica que el ETL se SALTA
 * limpio cuando `ETL_FOTOS_MOD_DIR`/`ETL_FOTOS_BOR_DIR` no están seteadas.
 */
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import { crearClienteR2, configR2DesdeEnv, sanearNombreArchivo } from '../../src/comun/archivos.js';
import { datosModificacion, registrarBitacora } from '../../src/comun/auditoria.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv, type FilaCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Extensiones de imagen que el ETL acepta (case-insensitive). */
const EXTENSIONES_IMAGEN = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);

/**
 * Parsea el nombre de la foto del viejo (Foto1/Foto2) para buscar el archivo.
 * Devuelve el nombre-base a buscar (sin extensión) o `null` si está vacío.
 * Exportada para unit tests.
 */
export function parsearNombreFoto(crudo: string | undefined | null): string | null {
  const txt = parsearTexto(crudo);
  if (txt === null) {
    return null;
  }
  // Quitar extensión si ya la trae (raro en el viejo, pero por si acaso).
  const ext = extname(txt);
  if (EXTENSIONES_IMAGEN.has(ext.toLowerCase())) {
    return txt.slice(0, txt.length - ext.length);
  }
  return txt;
}

/** Índice del archivo de fotos: nombre-base en minúsculas → ruta absoluta del archivo. */
export type IndiceFotos = Map<string, string>;

/**
 * Recorre `directorio` **incluidas sus subcarpetas** y arma el índice
 * `nombre-base en minúsculas → ruta absoluta` de todo archivo con extensión de imagen.
 *
 * POR QUÉ UN ÍNDICE: antes cada búsqueda hacía su propio `readdirSync`. Con 4,987 modelos
 * × 2 fotos contra una carpeta de miles de archivos eran ~10,000 lecturas del directorio y
 * millones de comparaciones de texto. Ahora el directorio se lee UNA vez y cada foto se
 * resuelve en O(1).
 *
 * POR QUÉ RECURSIVO: el archivo real de fotos trae subcarpetas sueltas (p. ej. `vero/`) y
 * esas fotos son tan válidas como las de la raíz. Leyendo plano se perdían en silencio.
 *
 * COLISIONES: si dos archivos comparten nombre-base (`61299.jpg` en la raíz y otro dentro de
 * `vero/`), gana el primero en orden alfabético de ruta — estable entre corridas — y la
 * colisión se REPORTA (§7: nada se decide en silencio).
 */
export function indexarFotos(directorio: string, reporte?: Reporte): IndiceFotos {
  const indice: IndiceFotos = new Map();
  if (!existsSync(directorio)) {
    return indice;
  }
  const pendientes: string[] = [directorio];
  const encontrados: string[] = [];
  while (pendientes.length > 0) {
    const actual = pendientes.pop() as string;
    let entradas: Dirent[];
    try {
      entradas = readdirSync(actual, { withFileTypes: true });
    } catch {
      continue; // carpeta ilegible: se salta, no tumba la corrida
    }
    for (const entrada of entradas) {
      const ruta = join(actual, entrada.name);
      if (entrada.isDirectory()) {
        pendientes.push(ruta);
      } else if (EXTENSIONES_IMAGEN.has(extname(entrada.name).toLowerCase())) {
        encontrados.push(ruta);
      }
    }
  }
  // Precedencia de colisiones: primero por PROFUNDIDAD (lo que está en la raíz del archivo
  // gana sobre lo que está metido en una subcarpeta), y a igual profundidad, alfabético.
  //
  // El desempate alfabético a igual profundidad decide entre extensiones (`.bmp` antes que
  // `.jpg`, `.jpeg` antes que `.jpg`) y eso es ARBITRARIO: en la carpeta real hay ~49 casos
  // del mismo modelo guardado dos veces, y en uno (`61471`) gana el `.bmp`, que pesa mucho
  // más que su `.jpg` para la misma imagen. Se evaluó ordenar por preferencia de formato
  // (jpg → png → webp → gif → bmp) y **Gabriel decidió dejarlo así** (26-ago-2026): son
  // copias de la misma prenda, cuál gane no cambia lo que se ve, y él no puede afirmar que
  // el jpg sea siempre la buena. Las colisiones se REPORTAN una por una, así que si alguna
  // sale mal se corrige subiendo esa foto a mano. NO es un olvido: es una decisión tomada.
  // La raíz es el lugar canónico; las subcarpetas suelen traer material suelto o descartado
  // (p. ej. `vero/`), así que nunca deben pisar una foto de la raíz. El desempate alfabético
  // deja el resultado estable entre corridas.
  const profundidad = (ruta: string): number => relative(directorio, ruta).split(sep).length;
  encontrados.sort((a, b) => profundidad(a) - profundidad(b) || a.localeCompare(b));
  for (const ruta of encontrados) {
    const clave = basename(ruta, extname(ruta)).toLowerCase();
    const previo = indice.get(clave);
    if (previo === undefined) {
      indice.set(clave, ruta);
    } else {
      reporte?.agregar(
        'Fotos: nombre-base repetido en el archivo (gana el menos anidado)',
        `"${clave}" → se usa "${previo}", se ignora "${ruta}"`,
      );
    }
  }
  return indice;
}

/**
 * Busca en `directorio` un archivo cuyo nombre-base (sin extensión) coincida con `nombre`
 * (case-insensitive) y tenga extensión de imagen conocida.  Devuelve la ruta absoluta al
 * match, o `null` si no existe.  Exportada para unit tests.
 *
 * Conveniencia de UNA búsqueda: arma el índice y consulta. Los loaders NO la usan en su
 * ciclo — arman el índice una vez con {@link indexarFotos} y consultan el Map.
 */
export function buscarArchivoFoto(directorio: string, nombre: string): string | null {
  return indexarFotos(directorio).get(nombre.toLowerCase()) ?? null;
}

/** Tipo MIME por extensión (fallback seguro). */
function tipoMimePorExtension(ext: string): string {
  const mapa: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
  };
  return mapa[ext.toLowerCase()] ?? 'application/octet-stream';
}

// ── Fotos de MODELOS ─────────────────────────────────────────────────────────────

/** Resultado del loader de fotos de modelos. */
export interface ResultadoFotosModelos extends ResultadoLoader {
  totalSubidas: number;
}

/**
 * Modelos que tienen al menos UNA de sus dos fotos disponible en el índice, ordenados de
 * MÁS NUEVO a más viejo por `IdModelos` (el consecutivo del Access).
 *
 * Es la base de `--limite N`. El filtro "con foto disponible" no es un lujo: si se tomaran
 * los últimos N modelos a secas y ninguno tuviera su archivo en la carpeta, la corrida daría
 * cero subidas y parecería que el ETL está roto, cuando lo que faltan son los archivos.
 *
 * Exportada para unit tests.
 */
export function modelosConFotoDisponible(
  filas: readonly FilaCsv[],
  indice: IndiceFotos,
): FilaCsv[] {
  return filas
    .filter((fila) =>
      [fila.Foto1, fila.Foto2].some((campo) => {
        const nombre = parsearNombreFoto(campo);
        return nombre !== null && indice.has(nombre.toLowerCase());
      }),
    )
    .sort((a, b) => Number(b.IdModelos ?? 0) - Number(a.IdModelos ?? 0));
}

export async function cargarFotosModelos(
  sesion: SesionUsuario,
  clienteBd: ClienteMapeo,
  reporte: Reporte,
  r2Inyectado?: S3Client,
  r2BucketInyectado?: string,
  simular = false,
  limite?: number,
): Promise<ResultadoFotosModelos> {
  const dirFotos = process.env.ETL_FOTOS_MOD_DIR?.trim();
  if (!dirFotos) {
    reporte.nota(
      'ETL_FOTOS_MOD_DIR no configurada: carga de fotos de modelos OMITIDA. ' +
        'Ejecutar etl:fotos-modelos cuando la carpeta esté disponible.',
    );
    return { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0, totalSubidas: 0 };
  }
  if (!existsSync(dirFotos)) {
    reporte.nota(`ETL_FOTOS_MOD_DIR="${dirFotos}" no existe en disco: fotos de modelos OMITIDAS.`);
    return { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0, totalSubidas: 0 };
  }

  // En modo SIMULACIÓN no se toca R2 ni se escribe en la BD: solo se resuelve el cruce.
  let clienteR2: S3Client | undefined = r2Inyectado;
  let bucket: string | undefined = r2BucketInyectado;
  if (!simular && (clienteR2 === undefined || bucket === undefined)) {
    const config = configR2DesdeEnv();
    clienteR2 = crearClienteR2(config);
    bucket = config.bucket;
  }

  const filas = leerCsv('Modelos.csv');
  const bd: ContextoBd = { cliente: clienteBd as PrismaClient };

  // El directorio se lee UNA vez (recursivo). Antes era un readdirSync por cada foto.
  const indice = indexarFotos(dirFotos, reporte);
  reporte.nota(
    `Fotos de modelos: ${String(indice.size)} archivo(s) de imagen en "${dirFotos}" ` +
      `(incluidas subcarpetas)${simular ? ' — MODO SIMULACIÓN, no se sube ni se guarda nada' : ''}.`,
  );

  // Los mapeos de modelo se leen de un jalón: antes era una consulta a la BD remota POR
  // MODELO (~5,000 round-trips por el proxy público de Railway). `cargarFotosArte` ya lo
  // hacía así; esto solo empareja los dos loaders.
  const mapeos = await (clienteBd as PrismaClient).mapeoMigracion.findMany({
    where: { entidad: ENTIDAD_MAPEO.modelo },
    select: { claveVieja: true, idNuevo: true },
  });
  const idPorModeloViejo = new Map(mapeos.map((m) => [m.claveVieja, Number(m.idNuevo)]));

  // RECORTE OPCIONAL (`--limite N`): para una corrida de prueba, en vez de las ~5,000 filas
  // se procesan solo N modelos, LOS MÁS NUEVOS primero (`IdModelos` es el consecutivo del
  // Access). Se cuentan únicamente los modelos que YA tienen su archivo en la carpeta: si se
  // tomaran los últimos N a secas, un lote sin fotos disponibles daría cero subidas y
  // parecería que el ETL falló, cuando lo que falta son los archivos.
  let filasAProcesar = filas;
  if (limite !== undefined) {
    const conFotoDisponible = modelosConFotoDisponible(filas, indice);
    filasAProcesar = conFotoDisponible.slice(0, limite);
    reporte.nota(
      `LÍMITE ACTIVO: se procesan ${String(filasAProcesar.length)} modelo(s) de ` +
        `${String(conFotoDisponible.length)} con foto disponible (los más nuevos por IdModelos). ` +
        'El resto del catálogo NO se toca en esta corrida.',
    );
  }

  type ResultadoPar = { frente: EstadoFoto; espalda: EstadoFoto };

  const resultados = await enLotes(
    filasAProcesar,
    async (fila): Promise<ResultadoPar> => {
      const idViejo = fila.IdModelos?.trim() ?? '';
      const idModelo = idPorModeloViejo.get(idViejo);
      if (idModelo === undefined) {
        return { frente: 'omitido', espalda: 'omitido' };
      }

      const resultFrente = await procesarFotoModelo(
        sesion,
        bd,
        clienteBd,
        clienteR2,
        bucket,
        idModelo,
        fila.Foto1,
        'FRENTE',
        indice,
        reporte,
        simular,
      );
      const resultEspalda = await procesarFotoModelo(
        sesion,
        bd,
        clienteBd,
        clienteR2,
        bucket,
        idModelo,
        fila.Foto2,
        'ESPALDA',
        indice,
        reporte,
        simular,
      );
      return { frente: resultFrente, espalda: resultEspalda };
    },
    CONCURRENCIA_ETL,
  );

  // HUÉRFANAS: archivos que están en la carpeta y que NINGÚN modelo pide en Foto1/Foto2.
  // Es la mitad que faltaba del reporte — antes solo se decía "el modelo X pedía una foto
  // que no encontré", nunca "esta foto está ahí y nadie la reclama". Se calcula del CSV
  // completo (no de lo que se alcanzó a procesar), así que no depende de los mapeos.
  const reclamadas = new Set<string>();
  for (const fila of filas) {
    for (const campo of [fila.Foto1, fila.Foto2]) {
      const nombre = parsearNombreFoto(campo);
      if (nombre !== null) {
        reclamadas.add(nombre.toLowerCase());
      }
    }
  }
  for (const clave of [...indice.keys()].sort()) {
    if (!reclamadas.has(clave)) {
      reporte.agregar(
        'Fotos de modelos: archivo que ningún modelo reclama',
        `"${clave}" (${indice.get(clave) ?? ''}) — ningún renglón de Modelos.csv lo nombra en Foto1/Foto2`,
      );
    }
  }

  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  let totalSubidas = 0;

  for (const r of resultados) {
    if (!r.ok) {
      omitidosValidacion += 1;
      continue;
    }
    for (const estado of [r.valor.frente, r.valor.espalda]) {
      if (estado === 'creado') {
        creados += 1;
        totalSubidas += 1;
      } else if (estado === 'existente') {
        existentes += 1;
      } else if (estado === 'omitido') {
        omitidos += 1;
      } else {
        omitidosValidacion += 1;
      }
    }
  }

  return { creados, existentes, omitidos, omitidosValidacion, totalSubidas };
}

type EstadoFoto = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';

async function procesarFotoModelo(
  sesion: SesionUsuario,
  bd: ContextoBd,
  clienteBd: ClienteMapeo,
  clienteR2: S3Client | undefined,
  bucket: string | undefined,
  idModelo: number,
  nombreCampo: string | undefined,
  tipo: 'FRENTE' | 'ESPALDA',
  indice: IndiceFotos,
  reporte: Reporte,
  simular: boolean,
): Promise<EstadoFoto> {
  const nombreBase = parsearNombreFoto(nombreCampo);
  if (nombreBase === null) {
    return 'omitido'; // campo vacío → este tipo de foto no aplica
  }

  const rutaArchivo = indice.get(nombreBase.toLowerCase()) ?? null;
  if (rutaArchivo === null) {
    reporte.agregar(
      `Fotos modelos: archivo no encontrado (tipo ${tipo})`,
      `Modelo id=${String(idModelo)}, nombre buscado="${nombreBase}"`,
    );
    return 'omitido';
  }

  // Idempotencia: verificar si ya existe un ModeloFoto de este tipo con key etl-.
  const keyPrefix = `modelos/${String(idModelo)}/etl-`;
  const yaExiste = await (clienteBd as PrismaClient).modeloFoto.findFirst({
    where: {
      idModelo,
      tipo,
      archivo: { key: { startsWith: keyPrefix } },
    },
    select: { id: true },
  });
  if (yaExiste !== null) {
    return 'existente';
  }

  // SIMULACIÓN: hasta aquí llega. El archivo existe, el modelo está mapeado y la foto no
  // estaba cargada → en una corrida real ESTA se subiría. No se lee el archivo ni se toca R2.
  if (simular) {
    return 'creado';
  }

  if (clienteR2 === undefined || bucket === undefined) {
    throw new Error('Cliente R2 no inicializado fuera de modo simulación');
  }

  const ext = extname(rutaArchivo);
  const nombreOriginal = basename(rutaArchivo);
  const tipoMime = tipoMimePorExtension(ext);
  const contenido = readFileSync(rutaArchivo);
  const tamanoBytes = contenido.length;
  const key = `modelos/${String(idModelo)}/etl-${randomUUID()}/${sanearNombreArchivo(nombreOriginal)}`;

  try {
    // 1. Subir el objeto a R2 PRIMERO. Si la subida falla, NO se commitea nada en BD: el
    //    guard de idempotencia (`yaExiste`) no encontrará registro y re-correr reintenta limpio.
    //    Un objeto R2 huérfano de un intento previo (BD falló tras subir) es inofensivo: la key
    //    lleva `randomUUID`, así que un reintento sube a una key NUEVA, sin colisionar.
    await clienteR2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: contenido,
        ContentType: tipoMime,
        ContentLength: tamanoBytes,
      }),
    );

    // 2. Solo si la subida fue OK, registrar Archivo + ModeloFoto en BD (en una transacción A2).
    await enTransaccion(async (tx) => {
      const archivo = await tx.archivo.create({
        data: { bucket, key, nombreOriginal, tipoMime, tamanoBytes, subidoPorId: sesion.id },
      });
      await tx.modeloFoto.create({
        data: {
          idModelo,
          idArchivo: archivo.id,
          tipo,
          orden: tipo === 'FRENTE' ? 0 : 1,
          creadoPorId: sesion.id,
        },
      });
      await tx.modelo.update({
        where: { id: idModelo },
        data: { ...datosModificacion(sesion) },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { foto: 'etl-migración', tipo, archivo: nombreOriginal },
      });
    }, bd);

    return 'creado';
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    reporte.agregar(
      `Fotos modelos: error al subir (tipo ${tipo})`,
      `Modelo id=${String(idModelo)}, archivo="${nombreOriginal}" · ${detalle}`,
    );
    return 'omitidoValidacion';
  }
}

// ── Fotos del ARTE de los modelos (V1-E3d: ya no hay catálogo de arte) ──────────

/**
 * Sube la foto del arte viejo (`Bordados.csv`, columna `Foto`) y la liga a TODOS los artes que
 * salieron de él. Un arte compartido por varios modelos se duplicó al migrar (§Post-F9.35), y las
 * copias COMPARTEN el mismo `Archivo` (el objeto de R2 se sube UNA vez y `archivos.key` es único;
 * lo mismo hace la migración SQL). Idempotente: salta los artes que ya tienen foto y no vuelve a
 * subir si ya la tienen todos.
 */
export async function cargarFotosArte(
  sesion: SesionUsuario,
  clienteBd: ClienteMapeo,
  reporte: Reporte,
  r2Inyectado?: S3Client,
  r2BucketInyectado?: string,
): Promise<ResultadoLoader> {
  const dirFotos = process.env.ETL_FOTOS_BOR_DIR?.trim();
  if (!dirFotos) {
    reporte.nota(
      'ETL_FOTOS_BOR_DIR no configurada: carga de fotos de arte OMITIDA. ' +
        'Ejecutar etl:fotos-arte cuando la carpeta esté disponible.',
    );
    return { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  }
  if (!existsSync(dirFotos)) {
    reporte.nota(`ETL_FOTOS_BOR_DIR="${dirFotos}" no existe en disco: fotos de arte OMITIDAS.`);
    return { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  }

  let clienteR2 = r2Inyectado;
  let bucket = r2BucketInyectado;
  if (clienteR2 === undefined || bucket === undefined) {
    const config = configR2DesdeEnv();
    clienteR2 = crearClienteR2(config);
    bucket = config.bucket;
  }

  const filas = leerCsv('Bordados.csv');
  const bd: ContextoBd = { cliente: clienteBd as PrismaClient };

  // Igual que en las fotos de modelos: el directorio se lee UNA vez, recursivo.
  const indice = indexarFotos(dirFotos, reporte);
  reporte.nota(
    `Fotos de arte: ${String(indice.size)} archivo(s) de imagen en "${dirFotos}" (incluidas subcarpetas).`,
  );

  // Todos los artes migrados, indexados por el `IdBordados` viejo (clave `<IdBordados>:<IdModelos>`).
  const artesPorArteViejo = new Map<string, number[]>();
  const mapeos = await (clienteBd as PrismaClient).mapeoMigracion.findMany({
    where: { entidad: ENTIDAD_MAPEO.modeloArte },
    select: { claveVieja: true, idNuevo: true },
  });
  for (const m of mapeos) {
    const idArteViejo = m.claveVieja.split(':')[0] ?? '';
    const lista = artesPorArteViejo.get(idArteViejo);
    if (lista === undefined) {
      artesPorArteViejo.set(idArteViejo, [Number(m.idNuevo)]);
    } else {
      lista.push(Number(m.idNuevo));
    }
  }

  const resultados = await enLotes(
    filas,
    async (fila): Promise<EstadoFoto> => {
      const idViejo = fila.IdBordados?.trim() ?? '';
      const idsArte = artesPorArteViejo.get(idViejo) ?? [];
      if (idsArte.length === 0) {
        // Arte que ningún modelo usaba (no migrado, §Post-F9.35) o sin mapeo: nada que ligar.
        return 'omitido';
      }

      const nombreBase = parsearNombreFoto(fila.Foto);
      if (nombreBase === null) {
        return 'omitido';
      }

      // Idempotencia: solo se atienden los artes que TODAVÍA no tienen NINGUNA foto (V1-E3f: las
      // fotos del arte son plurales, `ModeloArteFoto`).
      const pendientes = await (clienteBd as PrismaClient).modeloArte.findMany({
        where: { id: { in: idsArte }, fotos: { none: {} } },
        select: { id: true },
      });
      if (pendientes.length === 0) {
        return 'existente';
      }

      const rutaArchivo = indice.get(nombreBase.toLowerCase()) ?? null;
      if (rutaArchivo === null) {
        reporte.agregar(
          'Fotos de arte: archivo no encontrado',
          `IdBordados=${idViejo}, nombre buscado="${nombreBase}"`,
        );
        return 'omitido';
      }

      const ext = extname(rutaArchivo);
      const nombreOriginal = basename(rutaArchivo);
      const tipoMime = tipoMimePorExtension(ext);
      const contenido = readFileSync(rutaArchivo);
      const tamanoBytes = contenido.length;
      const key = `modelo-arte/etl-${randomUUID()}/${sanearNombreArchivo(nombreOriginal)}`;

      try {
        // 1. Subir el objeto a R2 PRIMERO. Si la subida falla, no se commitea nada en BD y
        //    re-correr reintenta limpio (los artes siguen sin ninguna foto). Un objeto
        //    R2 huérfano de un intento previo es inofensivo: la key lleva `randomUUID`.
        await clienteR2.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: contenido,
            ContentType: tipoMime,
            ContentLength: tamanoBytes,
          }),
        );

        // 2. Solo si la subida fue OK, registrar UN `Archivo` y ligarlo a TODAS las copias (A2).
        await enTransaccion(async (tx) => {
          const archivo = await tx.archivo.create({
            data: {
              bucket: bucket,
              key,
              nombreOriginal,
              tipoMime,
              tamanoBytes,
              subidoPorId: sesion.id,
            },
          });
          // Un renglón de foto por cada copia del arte: TODAS comparten el mismo `Archivo` (el
          // objeto de R2 no se duplica; ver `dominio/modelos/arte-modelo.ts`).
          await tx.modeloArteFoto.createMany({
            data: pendientes.map((p) => ({
              idModeloArte: p.id,
              idArchivo: archivo.id,
              orden: 0,
              creadoPorId: sesion.id,
            })),
          });
          await tx.modeloArte.updateMany({
            where: { id: { in: pendientes.map((p) => p.id) } },
            data: { ...datosModificacion(sesion) },
          });
          for (const p of pendientes) {
            await registrarBitacora(tx, sesion, {
              entidad: 'ModeloArte',
              idEntidad: p.id,
              accion: 'MODIFICAR',
              datos: { foto: 'etl-migración', archivo: nombreOriginal },
            });
          }
        }, bd);

        return 'creado';
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        reporte.agregar(
          'Fotos de arte: error al subir',
          `IdBordados=${idViejo}, archivo="${nombreOriginal}" · ${detalle}`,
        );
        return 'omitidoValidacion';
      }
    },
    CONCURRENCIA_ETL,
  );

  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  for (const r of resultados) {
    const estado = r.ok ? r.valor : 'omitidoValidacion';
    if (estado === 'creado') creados += 1;
    else if (estado === 'existente') existentes += 1;
    else if (estado === 'omitido') omitidos += 1;
    else omitidosValidacion += 1;
  }
  return { creados, existentes, omitidos, omitidosValidacion };
}
