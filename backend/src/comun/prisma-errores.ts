/**
 * Lectura estructural de errores conocidos de Prisma.
 *
 * Los servicios validan unicidad ANTES de escribir (mensaje claro al
 * usuario), pero la garantía final es el constraint de la base: si una
 * carrera concurrente lo dispara, el `PrismaClientKnownRequestError` se
 * traduce al `ErrorDominio` correspondiente. Se inspecciona por `code`
 * (estructural) y no por `instanceof` para no acoplar cada servicio a las
 * clases runtime del cliente generado.
 */

/** Códigos de error de Prisma que los servicios traducen a errores de dominio. */
export const CODIGO_PRISMA = {
  /** Violación de constraint único (P2002). */
  unicidad: 'P2002',
  /** Violación de llave foránea (P2003). */
  llaveForanea: 'P2003',
  /** Registro requerido no encontrado en update/delete (P2025). */
  noEncontrado: 'P2025',
} as const;

/**
 * Devuelve el código `P…` si `error` tiene forma de error conocido de Prisma;
 * `undefined` en cualquier otro caso.
 */
export function codigoErrorPrisma(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const codigo: unknown = error.code;
    if (typeof codigo === 'string' && /^P\d{4}$/.test(codigo)) {
      return codigo;
    }
  }
  return undefined;
}
