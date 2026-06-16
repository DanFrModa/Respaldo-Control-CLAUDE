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
 *  • Cada bordado tiene un campo `Foto` en `Bordados.csv`; el ETL de catálogos (E6) NO cargó
 *    las fotos.  Aquí se completan (mismo orden R2-primero que las de modelos).
 *  • IDEMPOTENTE: salta si el bordado ya tiene foto (`idArchivoFoto` no null).
 *  • Si `ETL_FOTOS_BOR_DIR` NO está seteado, se SALTA limpio con un aviso.
 *
 * REGLA DURA: los tests de CI NO suben archivos reales a R2 ni a ningún directorio — las fotos
 * se verifican mediante unit tests (mocks de FS) y el int-test verifica que el ETL se SALTA
 * limpio cuando `ETL_FOTOS_MOD_DIR`/`ETL_FOTOS_BOR_DIR` no están seteadas.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import { crearClienteR2, configR2DesdeEnv, sanearNombreArchivo } from '../../src/comun/archivos.js';
import { datosModificacion, registrarBitacora } from '../../src/comun/auditoria.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { ENTIDAD_MAPEO, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
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

/**
 * Busca en `directorio` un archivo cuyo nombre-base (sin extensión) coincida con `nombre`
 * (case-insensitive) y tenga extensión de imagen conocida.  Devuelve la ruta absoluta al
 * primer match, o `null` si no existe.  Exportada para unit tests.
 */
export function buscarArchivoFoto(directorio: string, nombre: string): string | null {
  if (!existsSync(directorio)) {
    return null;
  }
  const nombreLower = nombre.toLowerCase();
  let entradas: string[];
  try {
    entradas = readdirSync(directorio);
  } catch {
    return null;
  }
  for (const entrada of entradas) {
    const ext = extname(entrada);
    if (!EXTENSIONES_IMAGEN.has(ext.toLowerCase())) {
      continue;
    }
    const baseSinExt = basename(entrada, ext);
    if (baseSinExt.toLowerCase() === nombreLower) {
      return join(directorio, entrada);
    }
  }
  return null;
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

export async function cargarFotosModelos(
  sesion: SesionUsuario,
  clienteBd: ClienteMapeo,
  reporte: Reporte,
  r2Inyectado?: S3Client,
  r2BucketInyectado?: string,
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
    reporte.nota(
      `ETL_FOTOS_MOD_DIR="${dirFotos}" no existe en disco: fotos de modelos OMITIDAS.`,
    );
    return { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0, totalSubidas: 0 };
  }

  let clienteR2 = r2Inyectado;
  let bucket = r2BucketInyectado;
  if (clienteR2 === undefined || bucket === undefined) {
    const config = configR2DesdeEnv();
    clienteR2 = crearClienteR2(config);
    bucket = config.bucket;
  }

  const filas = leerCsv('Modelos.csv');
  const bd: ContextoBd = { cliente: clienteBd as PrismaClient };

  type ResultadoPar = { frente: EstadoFoto; espalda: EstadoFoto };

  const resultados = await enLotes(
    filas,
    async (fila): Promise<ResultadoPar> => {
      const idViejo = fila.IdModelos?.trim() ?? '';
      const idModeloStr = await leerMapeo(clienteBd, ENTIDAD_MAPEO.modelo, idViejo);
      if (idModeloStr === null) {
        return { frente: 'omitido', espalda: 'omitido' };
      }
      const idModelo = Number(idModeloStr);

      const resultFrente = await procesarFotoModelo(
        sesion, bd, clienteBd, clienteR2, bucket, idModelo, fila.Foto1, 'FRENTE', dirFotos, reporte,
      );
      const resultEspalda = await procesarFotoModelo(
        sesion, bd, clienteBd, clienteR2, bucket, idModelo, fila.Foto2, 'ESPALDA', dirFotos, reporte,
      );
      return { frente: resultFrente, espalda: resultEspalda };
    },
    CONCURRENCIA_ETL,
  );

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
      if (estado === 'creado') { creados += 1; totalSubidas += 1; }
      else if (estado === 'existente') { existentes += 1; }
      else if (estado === 'omitido') { omitidos += 1; }
      else { omitidosValidacion += 1; }
    }
  }

  return { creados, existentes, omitidos, omitidosValidacion, totalSubidas };
}

type EstadoFoto = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';

async function procesarFotoModelo(
  sesion: SesionUsuario,
  bd: ContextoBd,
  clienteBd: ClienteMapeo,
  clienteR2: S3Client,
  bucket: string,
  idModelo: number,
  nombreCampo: string | undefined,
  tipo: 'FRENTE' | 'ESPALDA',
  dirFotos: string,
  reporte: Reporte,
): Promise<EstadoFoto> {
  const nombreBase = parsearNombreFoto(nombreCampo);
  if (nombreBase === null) {
    return 'omitido'; // campo vacío → este tipo de foto no aplica
  }

  const rutaArchivo = buscarArchivoFoto(dirFotos, nombreBase);
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
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: contenido, ContentType: tipoMime, ContentLength: tamanoBytes }),
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

// ── Fotos de BORDADOS ────────────────────────────────────────────────────────────

export async function cargarFotosBordados(
  sesion: SesionUsuario,
  clienteBd: ClienteMapeo,
  reporte: Reporte,
  r2Inyectado?: S3Client,
  r2BucketInyectado?: string,
): Promise<ResultadoLoader> {
  const dirFotos = process.env.ETL_FOTOS_BOR_DIR?.trim();
  if (!dirFotos) {
    reporte.nota(
      'ETL_FOTOS_BOR_DIR no configurada: carga de fotos de bordados OMITIDA. ' +
        'Ejecutar etl:fotos-bordados cuando la carpeta esté disponible.',
    );
    return { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  }
  if (!existsSync(dirFotos)) {
    reporte.nota(
      `ETL_FOTOS_BOR_DIR="${dirFotos}" no existe en disco: fotos de bordados OMITIDAS.`,
    );
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

  const resultados = await enLotes(
    filas,
    async (fila): Promise<EstadoFoto> => {
      const idViejo = fila.IdBordados?.trim() ?? '';
      const idBordadoStr = await leerMapeo(clienteBd, ENTIDAD_MAPEO.bordado, idViejo);
      if (idBordadoStr === null) {
        return 'omitido';
      }
      const idBordado = Number(idBordadoStr);

      const nombreBase = parsearNombreFoto(fila.Foto);
      if (nombreBase === null) {
        return 'omitido';
      }

      // Idempotencia: ¿ya tiene foto?
      const bordadoActual = await (clienteBd as PrismaClient).bordado.findUnique({
        where: { id: idBordado },
        select: { idArchivoFoto: true },
      });
      if (bordadoActual?.idArchivoFoto !== null && bordadoActual?.idArchivoFoto !== undefined) {
        return 'existente';
      }

      const rutaArchivo = buscarArchivoFoto(dirFotos, nombreBase);
      if (rutaArchivo === null) {
        reporte.agregar(
          'Fotos bordados: archivo no encontrado',
          `IdBordados=${idViejo}, nombre buscado="${nombreBase}"`,
        );
        return 'omitido';
      }

      const ext = extname(rutaArchivo);
      const nombreOriginal = basename(rutaArchivo);
      const tipoMime = tipoMimePorExtension(ext);
      const contenido = readFileSync(rutaArchivo);
      const tamanoBytes = contenido.length;
      const key = `bordados/etl-${randomUUID()}/${sanearNombreArchivo(nombreOriginal)}`;

      try {
        // 1. Subir el objeto a R2 PRIMERO. Si la subida falla, no se commitea nada en BD y
        //    re-correr reintenta limpio (el guard `idArchivoFoto != null` sigue null). Un objeto
        //    R2 huérfano de un intento previo es inofensivo: la key lleva `randomUUID`.
        await clienteR2.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: contenido, ContentType: tipoMime, ContentLength: tamanoBytes }),
        );

        // 2. Solo si la subida fue OK, registrar Archivo + ligar la foto al Bordado (A2).
        await enTransaccion(async (tx) => {
          const archivo = await tx.archivo.create({
            data: { bucket: bucket, key, nombreOriginal, tipoMime, tamanoBytes, subidoPorId: sesion.id },
          });
          await tx.bordado.update({
            where: { id: idBordado },
            data: { idArchivoFoto: archivo.id, ...datosModificacion(sesion) },
          });
          await registrarBitacora(tx, sesion, {
            entidad: 'Bordado',
            idEntidad: idBordado,
            accion: 'MODIFICAR',
            datos: { foto: 'etl-migración', archivo: nombreOriginal },
          });
        }, bd);

        return 'creado';
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        reporte.agregar(
          'Fotos bordados: error al subir',
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
