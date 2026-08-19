/**
 * SELECTOR de maquileros de EsMa (F6-E5; ex `QueTipoMaq` sobre `Maquileros.Costura/Proceso`, hoy
 * roles del proveedor — fusión de terceros D12/R15). Resuelve la deuda de E4: los selectores traían
 * TODOS los proveedores con tope 100; aquí solo salen los ACTIVOS con un rol de MAQUILA, filtrables
 * por tipo (costura/estampado). Toda la lógica vive aquí (A1); las rutas delegan.
 *
 * Innegociables: A1 (lógica aquí), A4 (`esma.ver-pagos`: consulta del estado de cuenta), A9 (el
 * catálogo de proveedores es GLOBAL — ADR-0007 — así que NO se filtra por empresa; la empresa acota
 * los movimientos, no el catálogo).
 */
import {
  esquemaMaquilerosEsMaQuery,
  type MaquilerosEsMaLista,
  type TipoMaquileroEsMaClave,
} from '../../contrato/index.js';
import type { z } from 'zod';

import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/**
 * Roles de proveedor que corresponden a un MAQUILERO de EsMa (los procesos que generan un cargo de
 * maquila; espejo de `MAPEO_PROCESO_A_ROL` de `produccion/etapas.ts`, sin el rol `corte` que no genera
 * cargo EsMa). El `corte` mapea a `maquila-costura`; el resto son identidad.
 */
export const ROLES_MAQUILA_ESMA = [
  'maquila-costura',
  'estampado',
  'bordado',
  'lavado',
  'aplicacion',
] as const;

/** Los códigos de rol para un `tipo` del selector (o todos los de maquila si no se filtra). */
function rolesDeTipo(tipo: TipoMaquileroEsMaClave | undefined): readonly string[] {
  if (tipo === 'costura') {
    return ['maquila-costura'];
  }
  if (tipo === 'estampado') {
    return ['estampado'];
  }
  return ROLES_MAQUILA_ESMA;
}

/**
 * Lista los maquileros ACTIVOS del `tipo` pedido (proveedores con un rol de maquila). `tipo` opcional:
 * `costura` (rol `maquila-costura`) o `estampado` (rol `estampado`); omitirlo trae cualquier rol de
 * maquila. Devuelve id + nombre + clave corta, ordenados por nombre. Permiso `esma.ver-pagos`.
 */
export async function listarMaquilerosEsMa(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaMaquilerosEsMaQuery> = {},
  bd?: ContextoBd,
): Promise<MaquilerosEsMaLista> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const filtros = validarEntrada(esquemaMaquilerosEsMaQuery, parametros);
  const cliente = clienteLectura(bd);

  const proveedores = await cliente.proveedor.findMany({
    where: {
      activo: true,
      roles: { some: { rol: { codigo: { in: [...rolesDeTipo(filtros.tipo)] }, activo: true } } },
    },
    select: { id: true, nombre: true, nombreCorto: true },
    orderBy: { nombre: 'asc' },
  });

  return { filas: proveedores };
}
