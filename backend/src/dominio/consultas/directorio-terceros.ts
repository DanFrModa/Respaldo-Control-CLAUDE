/**
 * DIRECTORIO HISTÓRICO DE TERCEROS del sistema viejo — consulta (§Post-F9.28).
 *
 * Daniel (10-ago-2026): *"Al no pasar la información de los maquileros, ¿qué hacemos con la
 * información de ellos si quisiera encontrar algún teléfono o nombre? ¿Habrá manera de mantener la
 * información acá, sin tener toda la información basura en el catálogo? ¿Podríamos guardarlo en
 * algún otro repositorio que no sea el catálogo de proveedores?"*
 *
 * La respuesta es esta libreta: los terceros del Access con su teléfono y su dirección (1,046 de las
 * 1,052 fichas; las 6 que quedan fuera están vacías y el ETL las reporta),
 * **fuera** del catálogo `Proveedor`. La depuración (§Post-F9.23) sigue valiendo —esos ~897 no
 * estorban al capturar— pero su dato de contacto no se pierde.
 *
 * SOLO LECTURA, y eso es una decisión de diseño, no una funcionalidad pendiente: **no hay
 * "convertir en proveedor"**. Si un taller vuelve, se da de alta LIMPIO en el catálogo copiando de
 * aquí lo que sirva. Un botón de "pasar al catálogo" reabriría la puerta por la que entró la basura
 * que se acaba de depurar.
 *
 * PERMISO: se REUSA `proveedores.ver` — quien ve el catálogo ve la libreta. Cero permisos nuevos.
 *
 * NO lleva empresa (A9 no aplica): es el dump del Access, que no distinguía terceros por empresa.
 */
import {
  esquemaDirectorioTercerosQuery,
  type DatosDirectorioTercerosQuery,
  type DirectorioTercero,
  type DirectorioTercerosPagina,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';

import { idsSiHayBusqueda } from '../../comun/busqueda.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

type FilaDirectorio = Prisma.DirectorioTerceroV1GetPayload<Record<string, never>>;

function aSalida(d: FilaDirectorio): DirectorioTercero {
  return {
    id: d.id,
    fuente: d.fuente,
    nombre: d.nombre,
    corto: d.corto,
    razonSocial: d.razonSocial,
    telefono: d.telefono,
    contacto: d.contacto,
    direccion: d.direccion,
    notas: d.notas,
    servicios: d.servicios,
    ultimaActividad:
      d.ultimaActividad === null ? null : d.ultimaActividad.toISOString().slice(0, 10),
    documentos: d.documentos,
    enCatalogo: d.enCatalogo,
  };
}

/** Busca en la libreta. Permiso `proveedores.ver`. */
export async function listarDirectorioTerceros(
  sesion: SesionUsuario,
  filtros: unknown,
  bd?: ContextoBd,
): Promise<DirectorioTercerosPagina> {
  verificarPermiso(sesion, 'proveedores.ver');
  const f: DatosDirectorioTercerosQuery = validarEntrada(esquemaDirectorioTercerosQuery, filtros);
  const cliente = clienteLectura(bd);

  // Las dos cajas de texto, SIN acentos ni mayúsculas (fila 0.214): cada una es un pre-filtro de
  // ids de `comun/busqueda.ts`, y se cruzan con `AND` (las dos tienen que casar).
  // Se busca también por TELÉFONO: la pregunta de Daniel era literalmente "encontrar algún
  // teléfono", y a veces se llega al revés (tengo el número, ¿de quién es?).
  const [idsBusqueda, idsServicio] = await Promise.all([
    idsSiHayBusqueda(cliente, 'directorio-tercero', f.busqueda),
    idsSiHayBusqueda(cliente, 'directorio-tercero-servicio', f.servicio),
  ]);
  const porTexto: Prisma.DirectorioTerceroV1WhereInput[] = [];
  if (idsBusqueda !== undefined) porTexto.push({ id: { in: idsBusqueda } });
  if (idsServicio !== undefined) porTexto.push({ id: { in: idsServicio } });
  const where: Prisma.DirectorioTerceroV1WhereInput =
    porTexto.length === 0 ? {} : { AND: porTexto };
  if (f.enCatalogo === 'solo-catalogo') where.enCatalogo = true;
  if (f.enCatalogo === 'solo-fuera') where.enCatalogo = false;

  // Desempate por id para que la paginación sea estable (muchos comparten fecha nula).
  const orderBy: Prisma.DirectorioTerceroV1OrderByWithRelationInput[] = [
    // `ultimaActividad` es NULLABLE y en Postgres `DESC` implica `NULLS FIRST`: ordenar por
    // "¿con quién trabajamos más recientemente?" —la consulta natural de esta libreta— llenaba la
    // primera página con los que nunca movieron nada. Los nulos van SIEMPRE al final.
    f.ordenarPor === 'ultimaActividad'
      ? { ultimaActividad: { sort: f.direccion, nulls: 'last' } }
      : { [f.ordenarPor]: f.direccion },
    { id: 'asc' },
  ];

  const [total, filas] = await Promise.all([
    cliente.directorioTerceroV1.count({ where }),
    cliente.directorioTerceroV1.findMany({
      where,
      orderBy,
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
    }),
  ]);

  return { datos: filas.map(aSalida), total, pagina: f.pagina, porPagina: f.porPagina };
}
