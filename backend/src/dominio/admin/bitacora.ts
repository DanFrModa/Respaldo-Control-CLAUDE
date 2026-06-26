/**
 * Consulta de la BITÁCORA del sistema (F6-E1, transversal; A7). F0 entregó el motor de auditoría
 * SOLO como escritura (`comun/auditoria.ts` → tabla `Bitacora`); aquí vive la LECTURA: el listado
 * paginado de los registros con filtros por entidad, folio (idEntidad), usuario, acción y rango de
 * fechas, para que la administración audite los cambios sin SQL (Gabriel no consulta la BD).
 *
 * Solo lectura (no muta nada). Permiso `admin.ver-bitacora` (A4). La bitácora es GLOBAL al sistema
 * (no por empresa): registra QUIÉN tocó QUÉ. Resuelve el NOMBRE del usuario para mostrarlo (los
 * registros guardan solo `idUsuario`, sin FK física: es un log inmutable).
 */
import { esquemaBitacoraQuery, type BitacoraSalida } from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { armarPagina, rangoPrisma, type Pagina } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Parámetros del listado de bitácora (los reutiliza la ruta REST en su entrada). */
export type ParametrosListarBitacora = z.input<typeof esquemaBitacoraQuery>;

/**
 * Lista los registros de bitácora con filtros, orden por fecha y paginación EN SERVIDOR. Devuelve
 * cada registro ya proyectado a la forma de salida del contrato (id BigInt → texto, fecha ISO,
 * datos JSON tal cual) con el NOMBRE del usuario resuelto. Solo lo ve quien tenga
 * `admin.ver-bitacora`.
 *
 * @example
 * // Cambios sobre almacenes en enero, del más reciente al más viejo:
 * await listarBitacora(sesion, { entidad: 'Almacen', desde: '2026-01-01T00:00:00.000Z' });
 */
export async function listarBitacora(
  sesion: SesionUsuario,
  parametros: ParametrosListarBitacora = {},
  bd?: ContextoBd,
): Promise<Pagina<BitacoraSalida>> {
  verificarPermiso(sesion, 'admin.ver-bitacora');
  const filtros = validarEntrada(esquemaBitacoraQuery, parametros);
  const cliente = clienteLectura(bd);

  const fecha: Prisma.DateTimeFilter = {};
  if (filtros.desde !== undefined) {
    fecha.gte = new Date(filtros.desde);
  }
  if (filtros.hasta !== undefined) {
    fecha.lte = new Date(filtros.hasta);
  }

  const where: Prisma.BitacoraWhereInput = {
    ...(filtros.entidad === undefined || filtros.entidad === ''
      ? {}
      : { entidad: { equals: filtros.entidad, mode: 'insensitive' } }),
    ...(filtros.idEntidad === undefined || filtros.idEntidad === ''
      ? {}
      : { idEntidad: filtros.idEntidad }),
    ...(filtros.idUsuario === undefined || filtros.idUsuario === ''
      ? {}
      : { idUsuario: filtros.idUsuario }),
    ...(filtros.accion === undefined ? {} : { accion: filtros.accion }),
    ...(filtros.desde === undefined && filtros.hasta === undefined ? {} : { fecha }),
  };

  const [total, registros] = await Promise.all([
    cliente.bitacora.count({ where }),
    cliente.bitacora.findMany({
      where,
      orderBy: { fecha: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  // Resuelve los nombres de usuario de la página de una sola consulta (sin FK física en Bitacora).
  const idsUsuario = [
    ...new Set(registros.map((r) => r.idUsuario).filter((id): id is string => id !== null)),
  ];
  const usuarios =
    idsUsuario.length === 0
      ? []
      : await cliente.usuario.findMany({
          where: { id: { in: idsUsuario } },
          select: { id: true, nombre: true },
        });
  const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre]));

  const datos: BitacoraSalida[] = registros.map((r) => ({
    id: r.id.toString(),
    entidad: r.entidad,
    idEntidad: r.idEntidad,
    accion: r.accion,
    datos: r.datos ?? null,
    idUsuario: r.idUsuario,
    nombreUsuario: r.idUsuario === null ? null : (nombrePorId.get(r.idUsuario) ?? null),
    fecha: r.fecha.toISOString(),
  }));

  return armarPagina(datos, total, filtros);
}
