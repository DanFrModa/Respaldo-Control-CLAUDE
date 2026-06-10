/**
 * Resolución de la `SesionUsuario` de dominio a partir de la sesión de better-auth.
 *
 * Puente entre el proveedor de autenticación (better-auth) y el modelo de
 * autorización del dominio (`SesionUsuario` + RBAC, A4). Dado el usuario
 * autenticado, arma la sesión que reciben TODOS los servicios de dominio:
 * identidad + empresa activa + permisos efectivos (`cargarPermisosDeUsuario`,
 * de E2). Aquí NO hay reglas de negocio: solo se ensambla el contexto.
 *
 * La empresa activa (multi-empresa explícito, A9) se resuelve así:
 *  1. Si la petición indica una (header `x-empresa-activa`) y existe y está
 *     activa, se usa esa.
 *  2. Si no, la empresa favorita (sucesora de `Importancia = 1`, doc 00 §1.1).
 *  3. Si no hay favorita, la primera empresa activa por id.
 * Si no hay ninguna empresa activa, no se puede operar: se trata como no
 * autenticado para fines de las rutas protegidas.
 */
import { cargarPermisosDeUsuario, type SesionUsuario } from '../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../comun/transaccion.js';

/** Nombre del header con el que el cliente elige su empresa activa. */
export const HEADER_EMPRESA_ACTIVA = 'x-empresa-activa';

/** Datos mínimos del usuario autenticado que entrega better-auth. */
export interface UsuarioAutenticado {
  id: string;
  /** username normalizado (lo agrega el plugin username). */
  username: string;
  /** Nombre para mostrar (campo `nombre` del modelo Usuario). */
  nombre: string;
}

/**
 * Empresa activa preferida (id) que el cliente puede pedir por header.
 * Devuelve el id numérico si el header trae un entero positivo, o `undefined`.
 */
export function empresaSolicitada(valorHeader: string | undefined): number | undefined {
  if (valorHeader === undefined) {
    return undefined;
  }
  const id = Number(valorHeader);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** Empresa activa resuelta. */
interface EmpresaActiva {
  id: number;
  nombre: string;
}

/** Elige la empresa activa según la preferencia del cliente y los defaults (A9). */
async function resolverEmpresaActiva(
  idPreferida: number | undefined,
  bd?: ContextoBd,
): Promise<EmpresaActiva | null> {
  const cliente = clienteLectura(bd);

  if (idPreferida !== undefined) {
    const pedida = await cliente.empresa.findFirst({
      where: { id: idPreferida, activa: true },
      select: { id: true, nombre: true },
    });
    if (pedida !== null) {
      return pedida;
    }
  }

  // Sin preferencia válida: favorita primero, luego la primera activa por id.
  return cliente.empresa.findFirst({
    where: { activa: true },
    orderBy: [{ favorita: 'desc' }, { id: 'asc' }],
    select: { id: true, nombre: true },
  });
}

/**
 * Arma la `SesionUsuario` del dominio para el usuario autenticado.
 *
 * @returns la sesión lista para los servicios de dominio, o `null` si el usuario
 *   ya no puede operar — desactivado o bloqueado (aunque su cookie siga viva), o
 *   sin ninguna empresa activa disponible. Las rutas tratan `null` como 401, así
 *   una cuenta apagada a mitad de sesión queda expulsada de inmediato (no se
 *   queda con un 200 y permisos vacíos).
 */
export async function armarSesionUsuario(
  usuario: UsuarioAutenticado,
  idEmpresaPreferida?: number,
  bd?: ContextoBd,
): Promise<SesionUsuario | null> {
  // Gate explícito: una cuenta desactivada/bloqueada no tiene sesión válida,
  // aunque conserve la cookie. (cargarPermisosDeUsuario ya da set vacío para
  // ellas, pero aquí se corta antes para devolver 401, no un 200 sin permisos.)
  const estado = await clienteLectura(bd).usuario.findUnique({
    where: { id: usuario.id },
    select: { activo: true, bloqueado: true },
  });
  if (estado === null || !estado.activo || estado.bloqueado) {
    return null;
  }

  const empresa = await resolverEmpresaActiva(idEmpresaPreferida, bd);
  if (empresa === null) {
    return null;
  }

  const permisos = await cargarPermisosDeUsuario(usuario.id, bd);

  return {
    id: usuario.id,
    username: usuario.username,
    nombre: usuario.nombre,
    idEmpresaActiva: empresa.id,
    nombreEmpresaActiva: empresa.nombre,
    permisos,
  };
}
