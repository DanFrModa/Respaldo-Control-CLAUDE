/**
 * Saneo de la data legacy y robustez por-registro del ETL (F1-E6).
 *
 * La data del sistema viejo NO respeta las validaciones de v2 (longitudes, formatos…). Dos
 * mecanismos para que el ETL aguante la data sucia y COMPLETE en una pasada (§7: las
 * inconsistencias van a REPORTE, nunca crash, nunca pérdida silenciosa):
 *
 *  1. {@link truncarTexto} / {@link truncarYReportar}: recortan un texto libre a su `max` del
 *     Zod del esquema correspondiente ANTES de llamar al servicio de dominio, y reportan el
 *     recorte. Así un teléfono de 137 chars no aborta la fila: entra recortado a 100 y queda
 *     anotado para Gabriel/Daniel.
 *  2. {@link intentarCrear}: envuelve un create/update de UNA fila; si lanza `ErrorValidacion`
 *     (o cualquier error de fila), lo reporta con detalle y devuelve `null` para que el loader
 *     CONTINÚE con la siguiente — el ETL NUNCA aborta por una fila mala.
 *
 * Los `max` viven en {@link LIMITES}, calcados de `backend/src/contrato/esquemas/*` (si un
 * esquema cambia su tope, hay que actualizarlo aquí — son la MISMA regla de captura).
 */
import { ErrorConflicto, ErrorDominio } from '../../src/comun/errores.js';

import type { Reporte } from './reporte.js';

/**
 * Topes de longitud de los campos de TEXTO de cada entidad, calcados del Zod de
 * `src/contrato/esquemas/`. Solo los campos que el ETL escribe desde texto libre del viejo.
 */
export const LIMITES = {
  cliente: { nombre: 200, contacto: 150, telefono: 100, direccion: 300 },
  color: { nombre: 80 },
  etiquetaMarca: { nombre: 100 },
  empresa: { nombre: 100, razonSocial: 200, identificador: 20 },
  almacen: { nombre: 100 },
  telaCategoria: { nombre: 100 },
  tela: { nombre: 150, descripcion: 500, unidadMedida: 30 },
  avio: { clave: 50, descripcion: 300, condiciones: 500, unidad: 50, presentacion: 50 },
  arte: { nombre: 150, descripcion: 500 },
  proveedor: {
    nombre: 150,
    razonSocial: 200,
    telefono: 100,
    contacto: 150,
    condiciones: 500,
    direccion: 300,
    notas: 2000,
    nombreCorto: 50,
    obsPago: 2000,
  },
} as const;

/**
 * Recorta `valor` a `max` caracteres. Devuelve el texto recortado (o el original si cabía, o
 * `null` si era `null`). Función pura: el reporte lo hace {@link truncarYReportar}.
 */
export function truncarTexto(valor: string | null, max: number): string | null {
  if (valor === null) {
    return null;
  }
  return valor.length > max ? valor.slice(0, max) : valor;
}

/**
 * Recorta un texto a su `max` y, si hubo recorte, lo anota al reporte con el detalle
 * (entidad + clave vieja + campo + longitud original → max). Devuelve el texto resultante
 * (recortado o intacto), listo para pasar al servicio de dominio.
 *
 * @example
 * const tel = truncarYReportar(reporte, 'Proveedor', idViejo, 'telefono', tel, LIMITES.proveedor.telefono);
 */
export function truncarYReportar(
  reporte: Reporte,
  entidad: string,
  claveVieja: string | number | undefined,
  campo: string,
  valor: string | null,
  max: number,
): string | null {
  if (valor !== null && valor.length > max) {
    reporte.agregar(
      `${entidad}: texto truncado al máximo permitido`,
      `${campo} (clave=${String(claveVieja ?? '?')}): truncado de ${String(valor.length)} a ${String(max)} chars`,
    );
    return valor.slice(0, max);
  }
  return valor;
}

/**
 * Ejecuta `accion` (un create/update de UNA fila) de forma TOLERANTE: si lanza un
 * `ErrorDominio` (validación/conflicto/etc.) o cualquier otro error de fila, lo reporta con
 * detalle y devuelve `null` (el loader cuenta "omitido por validación" y sigue con la
 * siguiente fila). El ETL NUNCA aborta por una fila sucia.
 *
 * @returns el resultado de `accion`, o `null` si la fila falló (ya reportada).
 */
export async function intentarCrear<T>(
  reporte: Reporte,
  entidad: string,
  claveVieja: string | number | undefined,
  accion: () => Promise<T>,
): Promise<T | null> {
  try {
    return await accion();
  } catch (error) {
    const detalle =
      error instanceof ErrorDominio
        ? `${error.codigo}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    reporte.agregar(
      `${entidad}: fila OMITIDA por error (data sucia)`,
      `clave=${String(claveVieja ?? '?')} · ${detalle}`,
    );
    return null;
  }
}

/** Resultado de crear un registro con nombre @unique desambiguado. */
export interface CreadoConNombre {
  id: number;
  /** Nombre con el que finalmente se creó (puede llevar sufijo de desambiguación). */
  nombre: string;
}

/**
 * Crea un registro cuyo `nombre` es @unique, desambiguando duplicados con sufijo y
 * TOLERANDO carreras concurrentes. Pensado para los loaders paralelizados (telas/avíos):
 *
 *  1. `nombreLibre(base)` calcula un nombre libre (el `base`, o `base (n)` si ya existe).
 *  2. `crear(nombre)` lo crea vía el dominio.
 *  3. Si el dominio lanza `ErrorConflicto` (otra tarea concurrente creó ese mismo nombre
 *     entre el paso 1 y el 2), se REINTENTA recomputando un nombre libre, hasta `maxIntentos`.
 *
 * Devuelve el id + el nombre final. Si se agotan los intentos, relanza el último conflicto
 * (lo captura `intentarCrear` del loader → fila omitida y reportada).
 */
export async function crearConNombreUnico(
  base: string,
  nombreLibre: (base: string) => Promise<string>,
  crear: (nombre: string) => Promise<{ id: number }>,
  maxIntentos = 5,
): Promise<CreadoConNombre> {
  let ultimoError: unknown;
  for (let intento = 0; intento < maxIntentos; intento += 1) {
    const nombre = await nombreLibre(base);
    try {
      const creado = await crear(nombre);
      return { id: creado.id, nombre };
    } catch (error) {
      if (error instanceof ErrorConflicto) {
        ultimoError = error; // carrera: otro tomó ese nombre; recomputar y reintentar
        continue;
      }
      throw error; // otro error (validación, etc.): que lo maneje el llamador
    }
  }
  throw ultimoError instanceof Error
    ? ultimoError
    : new ErrorConflicto('No se pudo desambiguar el nombre tras varios intentos.');
}
