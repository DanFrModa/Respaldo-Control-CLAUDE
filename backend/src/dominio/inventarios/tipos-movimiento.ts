/**
 * Tipos de movimiento de inventario — consulta de SOLO LECTURA (F3-E1; ex `IPT_TiposMov`,
 * doc 04-Inventarios §A.2).
 *
 * Catálogo administrable por seed (los 19 tipos con su dirección); en F3-E1 solo se EXPONE para
 * que las pantallas de movimientos de E3 lo listen. No hay alta/edición por API todavía (el ABM
 * fino se difiere, mismo criterio que otros catálogos selector).
 *
 * Permiso: `inventario-pt.ver` **O** `inventario-telas.ver` **O** `inventario-avios.ver`
 * (ver {@link exigirVerTiposMovimiento}).
 */
import { DIRECCIONES_MOVIMIENTO } from '../../contrato/index.js';
import type { Prisma, TipoMovimientoInventario } from '../../datos/index.js';
import { z } from 'zod';

import { ErrorPermiso } from '../../comun/errores.js';
import { tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { tipoEsCapturableAMano } from './tipos-reservados.js';

/**
 * Un tipo de movimiento con la bandera que dice si se puede ELEGIR en una captura manual.
 *
 * 🔑 La decide el DOMINIO (A1), no la pantalla ni el mapper de la ruta: es la MISMA fuente que usa
 * el rechazo de los escritores genéricos (`tipos-reservados.ts`), leída UNA vez. Así la pantalla no
 * tiene que repetir los códigos —el defecto que CLAUDE.md llama «un dato repetido en N sitios»— y
 * cualquier pantalla futura que liste tipos hereda la regla gratis.
 *
 * Falso por DOS razones distintas (fila 0.171): los rótulos que se reserva la DIRECCIÓN (los
 * captura Daniel, por su pantalla) y los que escribe SÓLO el sistema (no los captura nadie, nunca).
 * La bandera no distingue cuál —a la pantalla le da igual, no los ofrece— pero el rechazo del
 * servidor sí, y lo dice en el mensaje.
 */
export type TipoMovimientoConCaptura = TipoMovimientoInventario & { capturaManual: boolean };

/**
 * Parámetros del listado de tipos de movimiento (ya coaccionados): la ruta REST coacciona el
 * querystring con `esquemaTiposMovimientoQuery` (stringbool) y entrega banderas booleanas; este
 * esquema re-valida la forma de DOMINIO (igual patrón que `esquemaListarAlmacenes`).
 */
export const esquemaListarTiposMovimiento = z.object({
  incluirInactivos: z.boolean().default(false),
  direccion: z.enum(DIRECCIONES_MOVIMIENTO).optional(),
});

/** Parámetros del listado de tipos de movimiento. */
export type ParametrosListarTiposMovimiento = z.input<typeof esquemaListarTiposMovimiento>;

/**
 * ⭐ Fila 0.193 — LA REJA DEL CATÁLOGO ACEPTA LAS **TRES** LLAVES DE INVENTARIO, igual que su ruta.
 *
 * `TipoMovimientoInventario` es un catálogo **GLOBAL**: uno solo para PT, telas y avíos (lo dice
 * `tipos-reservados.ts` en su encabezado, y el modelo no tiene columna que lo parta por tipo de
 * inventario). Sus tres pantallas consumidoras lo necesitan entero: «Movimientos de PT» lo pinta en
 * el desplegable, y los dos AJUSTES de material (`AjusteTelaColorPagina`, `AjusteMaterialesPagina`)
 * lo leen para resolver `ajuste-entrada`/`ajuste-salida` **por código**. O sea que no hay «lo suyo»
 * que devolverle a cada quien: el conjunto correcto es el mismo para los tres.
 *
 * El defecto que cierra esta fila: la ruta abría con `conAlgunPermiso` de las tres claves y el
 * dominio reaplicaba **sólo** `inventario-pt.ver` ⇒ quien llevara únicamente la de telas o la de
 * avíos **pasaba la puerta y chocaba con un 403 adentro**, y sus pantallas de ajuste se quedaban sin
 * poder resolver el tipo. Es la fila 0.190 al revés y en el mismo sitio (allí la reja pedía de más);
 * las dos sólo muerden el día que los permisos se repartan de verdad — hoy los perfiles del seed
 * llevan las tres.
 *
 * Misma forma que `exigirVerOpcionesRoles` (`dominio/admin/roles.ts`, fila 0.190): se acepta
 * por cualquiera de las claves y, si no hay ninguna, se niega nombrando **una** —deny-by-default de
 * A4, con el 403 saliendo del DOMINIO (A1), no del `preHandler`.
 */
export function exigirVerTiposMovimiento(sesion: SesionUsuario): void {
  if (
    tienePermiso(sesion, 'inventario-pt.ver') ||
    tienePermiso(sesion, 'inventario-telas.ver') ||
    tienePermiso(sesion, 'inventario-avios.ver')
  ) {
    return;
  }
  throw new ErrorPermiso(undefined, 'inventario-pt.ver');
}

/**
 * Lista los tipos de movimiento de inventario (lista simple ordenada por id, como el viejo
 * IPT_TiposMov). Por defecto solo activos; opcionalmente filtra por dirección.
 */
export async function listarTiposMovimiento(
  sesion: SesionUsuario,
  parametros: ParametrosListarTiposMovimiento = {},
  bd?: ContextoBd,
): Promise<TipoMovimientoConCaptura[]> {
  exigirVerTiposMovimiento(sesion);
  const filtros = validarEntrada(esquemaListarTiposMovimiento, parametros);

  const where: Prisma.TipoMovimientoInventarioWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.direccion === undefined ? {} : { direccion: filtros.direccion }),
  };

  const tipos = await clienteLectura(bd).tipoMovimientoInventario.findMany({
    where,
    orderBy: { id: 'asc' },
  });
  return tipos.map((tipo) => ({
    ...tipo,
    capturaManual: tipoEsCapturableAMano(tipo.codigo),
  }));
}
