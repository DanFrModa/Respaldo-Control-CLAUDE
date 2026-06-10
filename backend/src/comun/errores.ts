/**
 * Errores de dominio de CONTROL v2.
 *
 * Jerarquía ÚNICA de errores que lanzan todos los servicios de `src/dominio`.
 * Cada error lleva un `codigo` estable (no cambia entre versiones) y un mensaje
 * en español listo para mostrarse al usuario. Las rutas REST (E3) traducen
 * `codigo` → status HTTP sin inspeccionar mensajes:
 *
 * | `codigo`        | HTTP sugerido |
 * |-----------------|---------------|
 * | `VALIDACION`    | 400           |
 * | `NO_ENCONTRADO` | 404           |
 * | `PERMISO`       | 403           |
 * | `CONFLICTO`     | 409           |
 * | `BLOQUEADO`     | 403           |
 *
 * Implementa el estándar de manejo de errores de PLANMAESTRO §8.5 (convenciones
 * únicas definidas en F0): la lógica vive en dominio (A1) y la UI solo presenta.
 */

/** Códigos estables de error de dominio. El front mapea por código, nunca por mensaje. */
export type CodigoErrorDominio =
  | 'VALIDACION'
  | 'NO_ENCONTRADO'
  | 'PERMISO'
  | 'CONFLICTO'
  | 'BLOQUEADO';

/** Opciones comunes al construir un error de dominio. */
export interface OpcionesErrorDominio {
  /** Detalle estructurado para el cliente (p. ej. issues de Zod aplanadas). Debe ser serializable. */
  detalles?: unknown;
  /** Error original que provocó este (se conserva para diagnóstico, no se muestra al usuario). */
  causa?: unknown;
}

/**
 * Base de todos los errores de negocio de CONTROL v2.
 *
 * Los servicios de dominio lanzan SOLO subclases de `ErrorDominio` para condiciones
 * de negocio esperables; cualquier otro error que escape de un servicio se trata
 * como falla interna (500) y NO debe mostrar su mensaje al usuario.
 */
export abstract class ErrorDominio extends Error {
  /** Código estable para mapear a HTTP y para asserts en tests. */
  abstract readonly codigo: CodigoErrorDominio;

  /** Detalle estructurado opcional (serializable) que el front puede usar para pintar campos. */
  readonly detalles?: unknown;

  constructor(mensaje: string, opciones?: OpcionesErrorDominio) {
    super(mensaje, opciones?.causa === undefined ? undefined : { cause: opciones.causa });
    this.name = new.target.name;
    this.detalles = opciones?.detalles;
  }
}

/**
 * La entrada no cumple una regla de captura o de negocio (datos mal formados,
 * cantidades imposibles, estado que no permite la operación solicitada).
 *
 * `detalles` suele llevar las issues de Zod aplanadas para que la pantalla
 * marque el campo exacto.
 */
export class ErrorValidacion extends ErrorDominio {
  override readonly codigo = 'VALIDACION';
}

/**
 * La entidad solicitada no existe (o no es visible para la empresa activa de la
 * sesión, lo que para el usuario es lo mismo: no existe).
 */
export class ErrorNoEncontrado extends ErrorDominio {
  override readonly codigo = 'NO_ENCONTRADO';

  /** Nombre de la entidad buscada (p. ej. `"Almacen"`). */
  readonly entidad: string;
  /** Identificador con el que se buscó. */
  readonly id: string;

  constructor(entidad: string, id: string | number | bigint, opciones?: OpcionesErrorDominio) {
    super(`No se encontró ${entidad} con id ${String(id)}.`, opciones);
    this.entidad = entidad;
    this.id = String(id);
  }
}

/**
 * La sesión no tiene el permiso requerido para la operación (RBAC, MEJORAS A4).
 * Lo lanza `verificarPermiso` de `comun/permisos.ts`; los servicios no inventan
 * sus propios mensajes de permiso.
 */
export class ErrorPermiso extends ErrorDominio {
  override readonly codigo = 'PERMISO';

  /** Clave del permiso que faltó (del catálogo de `src/contrato`). */
  readonly permiso?: string;

  constructor(mensaje?: string, permiso?: string, opciones?: OpcionesErrorDominio) {
    super(mensaje ?? 'No tienes permiso para realizar esta operación.', opciones);
    // Solo se asigna si vino (exactOptionalPropertyTypes: la propiedad opcional
    // no admite el valor `undefined` explícito).
    if (permiso !== undefined) {
      this.permiso = permiso;
    }
  }
}

/**
 * La operación choca con el estado actual de los datos: unicidad violada
 * (p. ej. nombre de almacén repetido en la empresa), registro ya desactivado,
 * o un cambio concurrente que dejó obsoleta la pantalla.
 */
export class ErrorConflicto extends ErrorDominio {
  override readonly codigo = 'CONFLICTO';
}

/**
 * La cuenta no puede usarse: bloqueada por intentos fallidos (paridad con el
 * sistema viejo, doc funcional 00 §1.1: `CantBloq >= 5`) o desactivada.
 * El login la muestra tal cual; el desbloqueo es manual por un administrador
 * (`desbloquearUsuario` en `dominio/admin/usuarios.ts`).
 */
export class ErrorBloqueado extends ErrorDominio {
  override readonly codigo = 'BLOQUEADO';
}

/** Type guard para distinguir errores de negocio de fallas internas en rutas y tests. */
export function esErrorDominio(error: unknown): error is ErrorDominio {
  return error instanceof ErrorDominio;
}
