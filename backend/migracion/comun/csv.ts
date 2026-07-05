/**
 * Lectura de los CSV del sistema viejo (F1-E6, ETL de catálogos).
 *
 * Reglas DURAS (PLANMAESTRO §7, ficha F1-E6):
 *  • **Encoding = CP850 (codepage DOS)**: los .csv de `Respaldo CLAUDE/TABLAS/` NO están en
 *    latin-1 (aunque CLAUDE.md §4 lo dijera) — fueron exportados desde Access en CP850.
 *    Verificado con bytes crudos: el byte de la `ñ` es `0xA4` (latin-1 daría `¤` → "Monta¤o";
 *    CP850 da `ñ` → "Montaño"); la `ó` es `0xA2` (latin-1 daría `¢` → "Algod¢n"; CP850 da `ó`
 *    → "Algodón"). Afecta ñ/á/é/í/ó/ú en TODO el dump. Node no trae cp850 nativo
 *    (Buffer/TextDecoder no lo soportan) → se decodifica con `iconv-lite`.
 *    NOTA: este encoding aplica a TODO el ETL (E7, F10); corregir la nota de "latin-1" de
 *    CLAUDE.md §4 al cierre de la etapa.
 *  • **Parser CSV REAL** (`csv-parse`): varios CSV tienen campos multilínea entre comillas
 *    (p. ej. `Maquileros.Telefonos`, `Estampadores.Direccion`). JAMÁS contar líneas con
 *    `split('\n')`: rompería esos registros. El parser respeta comillas y saltos internos.
 *
 * La carpeta fuente es `Respaldo CLAUDE/TABLAS/` en la RAÍZ del repo (dos niveles arriba de
 * `backend/`). Se puede sobreescribir con la variable de entorno `TABLAS_DIR` (útil en CI o
 * para apuntar a un dump alterno).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';

/** Codepage de los CSV del sistema viejo (DOS/Access). Ver TSDoc del módulo. */
export const ENCODING_TABLAS = 'cp850';

/** Una fila del CSV como objeto `columna → valor` (todo texto, tal cual del viejo). */
export type FilaCsv = Record<string, string>;

/**
 * Carpeta de los CSV del sistema viejo. Por defecto, `Respaldo CLAUDE/TABLAS/` en la raíz
 * del repo. Se resuelve relativo a la UBICACIÓN de este archivo (no al cwd), así el comando
 * `npm run etl:catalogos` corre igual desde cualquier directorio: este archivo vive en
 * `backend/migracion/comun/csv.ts`, así que la raíz del repo son TRES niveles arriba
 * (`comun` → `migracion` → `backend` → raíz). `TABLAS_DIR` la sobreescribe (ruta absoluta).
 */
export function carpetaTablas(): string {
  const env = process.env.TABLAS_DIR;
  if (env !== undefined && env.trim() !== '') {
    return env;
  }
  const raizRepo = fileURLToPath(new URL('../../..', import.meta.url));
  return join(raizRepo, 'Respaldo CLAUDE', 'TABLAS');
}

/**
 * Lee un CSV del sistema viejo y devuelve sus filas como objetos `columna → valor`.
 *
 * - Decodifica el archivo en **CP850** vía `iconv-lite` (regla dura, ver TSDoc del módulo) y
 *   lo pasa por **csv-parse** con `columns: true` (usa la primera fila como cabecera) y
 *   `relax_column_count: true` (no truena si alguna fila trae columnas de más/menos — se
 *   reporta aparte si hace falta).
 * - `bom: true` por si algún dump trae BOM al inicio.
 *
 * @param nombreArchivo nombre del archivo (p. ej. `"Clientes.csv"`).
 * @param dir carpeta donde buscarlo (por defecto {@link carpetaTablas}).
 */
export function leerCsv(nombreArchivo: string, dir: string = carpetaTablas()): FilaCsv[] {
  const ruta = join(dir, nombreArchivo);
  const buffer = readFileSync(ruta);
  const texto = iconv.decode(buffer, ENCODING_TABLAS);
  return parse(texto, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false, // el trimming de cada campo lo decide cada loader (algunos conservan formato)
  }) as FilaCsv[];
}

/**
 * Cuenta las filas de DATOS de un CSV (sin la cabecera), con el parser REAL. Es el conteo
 * "v1" del reporte de cuadre: NUNCA un número a mano ni un `split('\n')`. Si el archivo no
 * existe o está vacío, devuelve 0.
 */
export function contarFilasCsv(nombreArchivo: string, dir: string = carpetaTablas()): number {
  try {
    return leerCsv(nombreArchivo, dir).length;
  } catch {
    return 0;
  }
}
