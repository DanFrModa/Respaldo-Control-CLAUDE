/**
 * CÓMO SE ABRE UNA CORRIDA: la reja de lectura y la consulta con sus renglones (fila 0.113).
 *
 * Vive aparte de `corrida.ts` desde la fila 0.118 por una razón muy concreta: **el documento para
 * facturar** necesita exactamente lo mismo —el mismo permiso y la misma corrida con sus renglones—
 * y el concentrado necesita, al revés, la facturabilidad de cada renglón. Dejar las dos piezas en
 * `corrida.ts` habría obligado a que los dos módulos se importaran mutuamente; duplicar la reja
 * habría dejado DOS versiones de quién puede ver una corrida, que es la clase de duplicado que un
 * día se corrige en un sitio y no en el otro.
 *
 * Aquí no hay negocio: sólo el permiso y la lectura. Toda la regla sigue en `corrida.ts`.
 */
import type { Prisma, PrismaClient } from '../../datos/index.js';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import type { Tx } from '../../comun/transaccion.js';

/**
 * Exige poder VER la corrida. Pasa con `pagos.corrida-ver` **o** con `pagos.corrida-armar`: quien
 * la arma obviamente la ve, y exigir los dos convertiría un rol a medio configurar en un 403 justo
 * después de crear la corrida (las mutaciones devuelven la pantalla). Sigue siendo deny-by-default
 * (A4): sin ninguno de los dos, 403.
 */
export function exigirVerCorrida(sesion: SesionUsuario): void {
  if (tienePermiso(sesion, 'pagos.corrida-armar')) {
    return;
  }
  verificarPermiso(sesion, 'pagos.corrida-ver');
}

/** `include` de una corrida con sus renglones (orden estable: por rubro y luego por id). */
export const incluirRenglones = {
  renglones: { orderBy: [{ rubro: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.CorridaPagoInclude;

/** Corrida con sus renglones, tal como la devuelve Prisma. */
export type CorridaConRenglones = Prisma.CorridaPagoGetPayload<{
  include: typeof incluirRenglones;
}>;

/** Un renglón tal como lo devuelve Prisma. */
export type RenglonFila = CorridaConRenglones['renglones'][number];

/**
 * Busca la corrida DE LA EMPRESA ACTIVA (A9) con sus renglones, o lanza `ErrorNoEncontrado`.
 *
 * El filtro por empresa va en el `where` y no en una comprobación posterior a propósito: así una
 * corrida de otra empresa es indistinguible de una que no existe, y el 404 no filtra que existe.
 */
export async function exigirCorrida(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  idCorrida: number,
): Promise<CorridaConRenglones> {
  const corrida = await cliente.corridaPago.findFirst({
    where: { id: idCorrida, idEmpresa },
    include: incluirRenglones,
  });
  if (corrida === null) {
    throw new ErrorNoEncontrado('CorridaPago', idCorrida);
  }
  return corrida;
}
