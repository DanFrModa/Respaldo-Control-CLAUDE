/**
 * Lectura de los CSV del sistema viejo (F1-E6, ETL de catálogos).
 *
 * Reglas DURAS (PLANMAESTRO §7, ficha F1-E6):
 *  • **latin-1 OBLIGATORIO** (`ISO-8859-1`): los .csv de `Respaldo CLAUDE/TABLAS/` están en
 *    latin-1, NO utf-8. Leerlos como utf-8 corrompe acentos/eñes en silencio. Aquí se
 *    decodifican SIEMPRE con `latin1`.
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

/** Una fila del CSV como objeto `columna → valor` (todo texto, tal cual del viejo). */
export type FilaCsv = Record<string, string>;

/**
 * Carpeta de los CSV del sistema viejo. Por defecto, `Respaldo CLAUDE/TABLAS/` en la raíz
 * del repo (este archivo vive en `backend/migracion/comun/`, así que la raíz son cuatro
 * niveles arriba). `TABLAS_DIR` la sobreescribe (ruta absoluta).
 */
export function carpetaTablas(): string {
  const env = process.env.TABLAS_DIR;
  if (env !== undefined && env.trim() !== '') {
    return env;
  }
  const raizRepo = fileURLToPath(new URL('../../../..', import.meta.url));
  return join(raizRepo, 'Respaldo CLAUDE', 'TABLAS');
}

/**
 * Lee un CSV del sistema viejo y devuelve sus filas como objetos `columna → valor`.
 *
 * - Decodifica el archivo en **latin-1** (regla dura) y lo pasa por **csv-parse** con
 *   `columns: true` (usa la primera fila como cabecera) y `relax_column_count: true` (no
 *   truena si alguna fila trae columnas de más/menos — se reporta aparte si hace falta).
 * - `bom: true` por si algún dump trae BOM al inicio.
 *
 * @param nombreArchivo nombre del archivo (p. ej. `"Clientes.csv"`).
 * @param dir carpeta donde buscarlo (por defecto {@link carpetaTablas}).
 */
export function leerCsv(nombreArchivo: string, dir: string = carpetaTablas()): FilaCsv[] {
  const ruta = join(dir, nombreArchivo);
  const buffer = readFileSync(ruta);
  const texto = buffer.toString('latin1');
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
