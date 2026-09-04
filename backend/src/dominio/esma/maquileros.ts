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
 * Roles de proveedor que corresponden a un MAQUILERO de EsMa: quien presta uno de estos servicios
 * cobra CONTRA UNA ORDEN, sale en el estado de cuenta de maquila y su rubro en la corrida semanal
 * es `maquila` (`pagos/beneficiarios.ts::rubroDeProveedor`, que lee ESTA lista).
 *
 * ⭐ 0.114 — `corte` y `empaque` ENTRAN. Es la frontera que corrigió Daniel: *«corte es parte de
 * maquilas, no de proveedores. Tengo proveedores de corte que el monto a pagar sale de una orden,
 * lo mismo que un maquilero. Y una maquila de empaque también»*. Hasta la 0.113 el cortador caía en
 * el rubro «proveedores» justamente porque este arreglo no tenía su rol (§Post-F9.189(j)).
 *
 * ⚠️ NO es lo mismo que `MAPEO_PROCESO_A_ROL` de `produccion/etapas.ts`: aquél mapea un
 * `TipoProceso` (maquila de ida y vuelta) a su rol, y corte/empaque NO son tipos de proceso — son
 * servicios sobre la orden (`EsMaCargo.servicio`). Los dos arreglos coinciden en cinco roles y esta
 * lista tiene dos más; esa diferencia es deliberada.
 */
export const ROLES_MAQUILA_ESMA = [
  'maquila-costura',
  'estampado',
  'bordado',
  'lavado',
  'aplicacion',
  'corte',
  'empaque',
] as const;

/** Los códigos de rol para un `tipo` del selector (o todos los de maquila si no se filtra). */
function rolesDeTipo(tipo: TipoMaquileroEsMaClave | undefined): readonly string[] {
  if (tipo === 'costura') {
    return ['maquila-costura'];
  }
  if (tipo === 'estampado') {
    return ['estampado'];
  }
  // 0.114: los dos servicios sobre la orden. El código del rol ES la clave del tipo (identidad).
  if (tipo === 'corte') {
    return ['corte'];
  }
  if (tipo === 'empaque') {
    return ['empaque'];
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
