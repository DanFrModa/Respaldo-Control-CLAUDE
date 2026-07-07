/**
 * CANDIDATOS DE DESARROLLO para el constructor de pedido interno (rediseño R3, B6 — proto §4.1:
 * el renglón del pedido se elige de un SELECTOR de modelos de desarrollo, ya no texto libre).
 *
 * Búsqueda SERVER-SIDE sin acentos ni mayúsculas (patrón R2 de `comun/busqueda.ts`, extensión
 * `unaccent`): teclear "playera cherry", el nº del cliente ("CA-KM-114"), el proyecto o el cliente
 * encuentra el desarrollo aunque el texto tenga acentos. El pre-filtro de IDS va por SQL crudo
 * PARAMETRIZADO (identificadores fijos, texto escapado — jamás interpolado) y la proyección por
 * Prisma. Solo desarrollos NO apagados de la EMPRESA ACTIVA (A9, vía su proyecto).
 *
 * `precioSugerido` = precio del renglón de lista más reciente del desarrollo
 * (`precioAprobado ?? precioCalculado`, mismo criterio que `sugerenciaLigaOrden` F8-E6) — el
 * precio del renglón del pedido se PROPONE desde la lista (editable). Va en `null` sin
 * `pedidos.importes` (el precio del pedido se rige por ese permiso, doc 02 §3).
 *
 * Permiso `pedidos.administrar`: el selector existe para CAPTURAR pedidos (la acción que ese
 * permiso gobierna); no se crean permisos nuevos.
 */
import { z } from 'zod';

import type { CandidatoDesarrollo } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { escaparLike } from '../../comun/busqueda.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, numOrNull } from '../costos/decimales.js';

/**
 * Parámetros EN DOMINIO (tipos nativos; la ruta coacciona la querystring — mismo patrón que
 * `esquemaConsultaMesDominio`).
 */
const esquemaCandidatosDominio = z.object({
  busqueda: z.string().trim().max(200).optional(),
  idCliente: z.number().int().positive().optional(),
  limite: z.number().int().min(1).max(50).default(20),
});

/** Parámetros que acepta `candidatosDesarrollo` (forma nativa, no la de la URL). */
export type ParametrosCandidatosDesarrollo = z.input<typeof esquemaCandidatosDominio>;

/**
 * Busca los desarrollos candidatos para un renglón del pedido. Devuelve a lo más `limite`
 * (typeahead), los más recientes primero.
 */
export async function candidatosDesarrollo(
  sesion: SesionUsuario,
  parametros: ParametrosCandidatosDesarrollo = {},
  bd?: ContextoBd,
): Promise<CandidatoDesarrollo[]> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const filtros = validarEntrada(esquemaCandidatosDominio, parametros);
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);
  const verImportes = tienePermiso(sesion, 'pedidos.importes');

  // Pre-filtro de ids por SQL crudo (unaccent en AMBOS lados; texto parametrizado y escapado).
  const condiciones = [Prisma.sql`d.apagado = false`, Prisma.sql`p.id_empresa = ${idEmpresa}`];
  if (filtros.idCliente !== undefined) {
    condiciones.push(Prisma.sql`p.id_cliente = ${filtros.idCliente}`);
  }
  if (filtros.busqueda !== undefined && filtros.busqueda !== '') {
    const patron = `%${escaparLike(filtros.busqueda)}%`;
    condiciones.push(
      Prisma.sql`(
        unaccent(lower(m.codigo)) LIKE unaccent(lower(${patron}))
        OR unaccent(lower(COALESCE(m.descripcion, ''))) LIKE unaccent(lower(${patron}))
        OR unaccent(lower(COALESCE(d.numero_cliente, ''))) LIKE unaccent(lower(${patron}))
        OR unaccent(lower(p.nombre)) LIKE unaccent(lower(${patron}))
        OR unaccent(lower(c.nombre)) LIKE unaccent(lower(${patron}))
      )`,
    );
  }
  const filas = await cliente.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT d.id
               FROM desarrollos d
               JOIN modelos m ON m.id = d.id_modelo
               JOIN proyectos p ON p.id = d.id_proyecto
               JOIN clientes c ON c.id = p.id_cliente
               WHERE ${Prisma.join(condiciones, ' AND ')}
               ORDER BY d.id DESC
               LIMIT ${filtros.limite}`,
  );
  const ids = filas.map((f) => f.id);
  if (ids.length === 0) {
    return [];
  }

  const desarrollos = await cliente.desarrollo.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      idModelo: true,
      numeroCliente: true,
      idProyecto: true,
      modelo: { select: { codigo: true, descripcion: true, numeroProduccion: true } },
      proyecto: {
        select: {
          folio: true,
          nombre: true,
          idCliente: true,
          cliente: { select: { nombre: true } },
          clienteDepartamento: { select: { nombre: true } },
        },
      },
      // Renglón de lista más reciente DE LA EMPRESA ACTIVA (A9): propone el precio del pedido.
      listaLineas: {
        where: { lista: { idEmpresa } },
        orderBy: { id: 'desc' },
        take: 1,
        select: { precioAprobado: true, precioCalculado: true },
      },
    },
  });

  // Conserva el orden del pre-filtro (más recientes primero).
  const porId = new Map(desarrollos.map((d) => [d.id, d]));
  const candidatos: CandidatoDesarrollo[] = [];
  for (const id of ids) {
    const des = porId.get(id);
    if (des === undefined) continue;
    const linea = des.listaLineas[0] ?? null;
    const precio =
      linea === null ? null : (numOrNull(linea.precioAprobado) ?? num(linea.precioCalculado));
    candidatos.push({
      idDesarrollo: des.id,
      idModelo: des.idModelo,
      codigoModelo: des.modelo.codigo,
      descripcionModelo: des.modelo.descripcion,
      numeroCliente: des.numeroCliente,
      numeroProduccion: des.modelo.numeroProduccion,
      idProyecto: des.idProyecto,
      folioProyecto: Number(des.proyecto.folio),
      nombreProyecto: des.proyecto.nombre,
      idCliente: des.proyecto.idCliente,
      nombreCliente: des.proyecto.cliente.nombre,
      nombreDepartamento: des.proyecto.clienteDepartamento.nombre,
      precioSugerido: verImportes ? precio : null,
    });
  }
  return candidatos;
}
