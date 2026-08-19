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

/**
 * ¿La violación de unicidad (P2002) fue de ESTE campo? Sirve para dar el mensaje correcto cuando una
 * tabla tiene VARIOS únicos —el catálogo de proveedores tiene `nombre` y `nombre_corto`— en vez de
 * culpar siempre al primero.
 *
 * ⚠️ HAY QUE MIRAR EN DOS LUGARES, y el segundo es el que aplica hoy. La documentación de Prisma
 * habla de `meta.target`, pero con el **driver adapter** (`@prisma/adapter-pg`, Prisma 7) el P2002
 * **NO trae esa llave**: las columnas viajan en `meta.driverAdapterError.cause.constraint.fields`.
 * Mirar solo `meta.target` hacía que esta función devolviera **SIEMPRE `false`** — el catch entraba
 * (409 y no 500) pero con el mensaje equivocado, culpando al `nombre` cuando lo que chocó era el
 * campo corto. Lo destapó el reviewer de V1-E3f pieza B imprimiendo el error real.
 *
 * El nombre del índice funcional llega **recortado y sin cerrar** — `"lower(nombre_corto"` — así que
 * el emparejamiento es por `includes`, no por igualdad: `lower(nombre_corto` contiene `nombre_corto`.
 *
 * ⚠️ La MISMA suposición sigue viva en `dominio/ruta-critica/hitosOrden.ts`
 * (`esViolacionHitoVivoUnico`), que por eso tampoco puede devolver `true` nunca. Anotado en
 * `HOJA-DE-RUTA.md` §4; no muerde en la v1 porque la RC está apagada.
 *
 * Devuelve `false` si no viene ninguna de las dos formas: el llamador debe dejar un mensaje genérico
 * como último caso, **nunca uno específico equivocado**.
 */
export function unicidadDeCampo(error: unknown, ...columnas: string[]): boolean {
  if (typeof error !== 'object' || error === null || !('meta' in error)) return false;
  const meta: unknown = error.meta;
  if (typeof meta !== 'object' || meta === null) return false;

  const campos: string[] = [];

  // Forma documentada: `meta.target` (conectores sin driver adapter).
  if ('target' in meta) {
    const target: unknown = meta.target;
    if (typeof target === 'string') campos.push(target);
    else if (Array.isArray(target)) campos.push(...target.filter((t) => typeof t === 'string'));
  }

  // Forma REAL con `@prisma/adapter-pg`: meta.driverAdapterError.cause.constraint.fields
  const conAdaptador = meta as {
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
  };
  const fields: unknown = conAdaptador.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(fields)) campos.push(...fields.filter((f) => typeof f === 'string'));

  return campos.some((t) => columnas.some((c) => t.includes(c)));
}
