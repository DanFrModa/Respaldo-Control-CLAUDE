/**
 * Proyectos de desarrollo — 1 cliente + 1 departamento, con nombre/tema (F8-E2, D13/R16).
 *
 * El `Proyecto` es la capa PREVIA a la cotización: agrupa `Desarrollo`s (cada uno un modelo). Es el
 * padre del flujo Desarrollo → precosto (E3) → lista (E4) → orden (E6).
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas sólo validan permiso + Zod y delegan.
 *  • A2 — encabezado + folio + bitácora en UNA transacción (`enTransaccion`).
 *  • A3/A9 — el `folio` sale de la secuencia atómica `"proyecto"` POR EMPRESA (`siguienteFolio`),
 *    NUNCA `Max()+1`. Es por la empresa de la sesión activa.
 *  • A7 — auditoría uniforme (`creadoPorId`/`modificadoPorId`) + `Bitacora` en la misma tx.
 *  • Validación de dominio (A1): el departamento debe PERTENECER al cliente del proyecto → error
 *    claro si no. Unicidad `@@unique([idEmpresa, folio])` la respalda la BD.
 *  • Archivar = borrado SUAVE reversible (`archivado`).
 *
 * Varios proyectos del MISMO cliente+departamento+temporada con tema distinto SE PERMITEN (no hay
 * unique sobre eso; sólo el folio es único por empresa).
 */
import {
  esquemaProyectoCrear,
  esquemaProyectoEditar,
  type ConteosDesarrollo,
  type ProyectoDetalleSalida,
  type ProyectoSalida,
} from '../../contrato/esquemas/proyecto.js';
import type { Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
} from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import {
  aDesarrolloSalida,
  calcularEstadoDesarrollo,
  incluirEstadoDesarrollo,
} from './desarrollos.js';

/** Clave de la secuencia de folios de proyectos (A3 — por empresa). */
export const CLAVE_SECUENCIA_PROYECTO = 'proyecto';

/** Alta: campos del esquema compartido (la empresa la pone el dominio desde la sesión). */
export type EntradaCrearProyecto = z.input<typeof esquemaProyectoCrear>;
/** Edición: `id` + cambios parciales. */
export type EntradaActualizarProyecto = z.input<typeof esquemaProyectoEditar>;

/**
 * Parámetros del listado con tipos NATIVOS (la ruta ya coaccionó la querystring; el dominio
 * re-valida con tipos nativos). Mismo patrón que `pedidos.ts`/`conceptos-costo.ts`.
 */
const esquemaListarProyectosDominio = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(200).optional(),
  idCliente: z.number().int().positive().optional(),
  idClienteDepartamento: z.number().int().positive().optional(),
  idTemporada: z.number().int().positive().optional(),
  incluirArchivados: z.boolean().default(false),
  ordenarPor: z.enum(['folio', 'nombre', 'creadoEn']).default('folio'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

/** Parámetros del listado (los reutiliza la ruta REST). */
export type ParametrosListarProyectos = z.input<typeof esquemaListarProyectosDominio>;

// ── Includes + proyecciones ─────────────────────────────────────────────────────────

/** Selección del nombre de cliente/departamento/temporada (para la UI). */
const seleccionNombres = {
  cliente: { select: { nombre: true } },
  clienteDepartamento: { select: { nombre: true } },
  temporada: { select: { nombre: true } },
} satisfies Prisma.ProyectoInclude;

/**
 * `include` para la LISTA: nombres + los desarrollos con SÓLO las relaciones del estado (para los
 * conteos; sin el modelo, que la tarjeta de la lista no necesita).
 */
const incluirProyectoLista = {
  ...seleccionNombres,
  desarrollos: { select: { apagado: true, ...incluirEstadoDesarrollo } },
} satisfies Prisma.ProyectoInclude;

/**
 * `include` para el DETALLE: nombres + los desarrollos completos (con su modelo + relaciones del
 * estado), ordenados por id.
 */
const incluirProyectoDetalle = {
  ...seleccionNombres,
  desarrollos: {
    orderBy: { id: 'asc' },
    include: {
      modelo: { select: { codigo: true, descripcion: true } },
      ...incluirEstadoDesarrollo,
    },
  },
} satisfies Prisma.ProyectoInclude;

type ProyectoLista = Prisma.ProyectoGetPayload<{ include: typeof incluirProyectoLista }>;
type ProyectoDetalle = Prisma.ProyectoGetPayload<{ include: typeof incluirProyectoDetalle }>;

/** Agrega los conteos de desarrollos por estado derivado. `total` incluye los apagados. */
function conteosDesarrollos(
  desarrollos: {
    apagado: boolean;
    precostos: { estado: string }[];
    ordenLigadas: { id: number }[];
    listaLineas: { id: number }[];
  }[],
): ConteosDesarrollo {
  const conteos: ConteosDesarrollo = {
    total: desarrollos.length,
    enDesarrollo: 0,
    cotizado: 0,
    enLista: 0,
    ligadoProduccion: 0,
    apagado: 0,
  };
  for (const desarrollo of desarrollos) {
    switch (calcularEstadoDesarrollo(desarrollo)) {
      case 'apagado':
        conteos.apagado += 1;
        break;
      case 'ligado-produccion':
        conteos.ligadoProduccion += 1;
        break;
      case 'en-lista':
        conteos.enLista += 1;
        break;
      case 'cotizado':
        conteos.cotizado += 1;
        break;
      default:
        conteos.enDesarrollo += 1;
    }
  }
  return conteos;
}

/** Proyecta el encabezado común del proyecto (sin desarrollos). */
function aProyectoBase(
  proyecto: Prisma.ProyectoGetPayload<{ include: typeof seleccionNombres }>,
  conteos: ConteosDesarrollo,
): ProyectoSalida {
  return {
    id: proyecto.id,
    folio: Number(proyecto.folio),
    idEmpresa: proyecto.idEmpresa,
    idCliente: proyecto.idCliente,
    cliente: proyecto.cliente.nombre,
    idClienteDepartamento: proyecto.idClienteDepartamento,
    departamento: proyecto.clienteDepartamento.nombre,
    nombre: proyecto.nombre,
    idTemporada: proyecto.idTemporada,
    temporada: proyecto.temporada?.nombre ?? null,
    notas: proyecto.notas,
    archivado: proyecto.archivado,
    conteos,
    creadoEn: proyecto.creadoEn.toISOString(),
    creadoPorId: proyecto.creadoPorId,
    modificadoEn: proyecto.modificadoEn.toISOString(),
    modificadoPorId: proyecto.modificadoPorId,
  };
}

/** Proyecta un proyecto de la LISTA (con conteos, sin el arreglo de desarrollos). */
function aProyectoSalida(proyecto: ProyectoLista): ProyectoSalida {
  return aProyectoBase(proyecto, conteosDesarrollos(proyecto.desarrollos));
}

/** Proyecta el DETALLE de un proyecto (conteos + el arreglo de desarrollos con su estado). */
function aProyectoDetalleSalida(proyecto: ProyectoDetalle): ProyectoDetalleSalida {
  return {
    ...aProyectoBase(proyecto, conteosDesarrollos(proyecto.desarrollos)),
    desarrollos: proyecto.desarrollos.map(aDesarrolloSalida),
  };
}

// ── Helpers de existencia/validación ───────────────────────────────────────────────

/** Busca un proyecto de la EMPRESA ACTIVA por id (A9), o lanza `ErrorNoEncontrado`. */
async function exigirProyecto(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{
  id: number;
  idCliente: number;
  idClienteDepartamento: number;
  nombre: string;
  idTemporada: number | null;
  notas: string | null;
  archivado: boolean;
  folio: bigint;
}> {
  const proyecto = await tx.proyecto.findFirst({
    where: { id, idEmpresa },
    select: {
      id: true,
      idCliente: true,
      idClienteDepartamento: true,
      nombre: true,
      idTemporada: true,
      notas: true,
      archivado: true,
      folio: true,
    },
  });
  if (proyecto === null) {
    throw new ErrorNoEncontrado('Proyecto', id);
  }
  return proyecto;
}

/** Exige que el cliente exista y esté ACTIVO (no se abren proyectos a un cliente desactivado). */
async function exigirClienteActivo(tx: Tx, idCliente: number): Promise<void> {
  const cliente = await tx.cliente.findUnique({
    where: { id: idCliente },
    select: { activo: true, nombre: true },
  });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  if (!cliente.activo) {
    throw new ErrorConflicto(
      `El cliente "${cliente.nombre}" está desactivado; reactívalo para abrirle proyectos.`,
    );
  }
}

/**
 * Exige que el departamento PERTENEZCA al cliente del proyecto (A1). Un departamento de otro cliente
 * es una combinación inválida → `ErrorValidacion` claro. También rechaza uno inexistente.
 */
async function exigirDepartamentoDeCliente(
  tx: Tx,
  idCliente: number,
  idClienteDepartamento: number,
): Promise<void> {
  const departamento = await tx.clienteDepartamento.findUnique({
    where: { id: idClienteDepartamento },
    select: { idCliente: true },
  });
  if (departamento === null) {
    throw new ErrorNoEncontrado('Departamento del cliente', idClienteDepartamento);
  }
  if (departamento.idCliente !== idCliente) {
    throw new ErrorValidacion('El departamento no pertenece al cliente del proyecto.');
  }
}

/** Exige que la temporada exista (sólo si se especifica), para dar un error claro antes del FK. */
async function exigirTemporada(tx: Tx, idTemporada: number): Promise<void> {
  const temporada = await tx.temporada.findUnique({
    where: { id: idTemporada },
    select: { id: true },
  });
  if (temporada === null) {
    throw new ErrorNoEncontrado('Temporada', idTemporada);
  }
}

// ── Operaciones ─────────────────────────────────────────────────────────────────────

/**
 * Crea un proyecto de desarrollo (D13/R16) en UNA transacción (A2). Toma el folio de la secuencia
 * atómica `"proyecto"` de la empresa activa (A3/A9). Valida cliente activo, departamento del cliente
 * y (si viene) temporada. Auditoría + bitácora en la tx. Requiere `desarrollo.administrar`.
 */
export async function crearProyecto(
  sesion: SesionUsuario,
  entrada: EntradaCrearProyecto,
  bd?: ContextoBd,
): Promise<ProyectoDetalleSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const datos = validarEntrada(esquemaProyectoCrear, entrada);

  const idNuevo = await enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, datos.idCliente);
    await exigirDepartamentoDeCliente(tx, datos.idCliente, datos.idClienteDepartamento);
    if (datos.idTemporada !== undefined) {
      await exigirTemporada(tx, datos.idTemporada);
    }
    const folio = await siguienteFolio(tx, sesion.idEmpresaActiva, CLAVE_SECUENCIA_PROYECTO);

    const proyecto = await tx.proyecto.create({
      data: {
        folio,
        idEmpresa: sesion.idEmpresaActiva,
        idCliente: datos.idCliente,
        idClienteDepartamento: datos.idClienteDepartamento,
        nombre: datos.nombre,
        ...(datos.idTemporada === undefined ? {} : { idTemporada: datos.idTemporada }),
        ...(datos.notas === undefined ? {} : { notas: datos.notas }),
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Proyecto',
      idEntidad: proyecto.id,
      accion: 'CREAR',
      datos: {
        folio: Number(folio),
        idCliente: datos.idCliente,
        idClienteDepartamento: datos.idClienteDepartamento,
        nombre: datos.nombre,
      },
    });

    return proyecto.id;
  }, bd);

  return obtenerProyecto(sesion, idNuevo, bd);
}

/**
 * Actualiza un proyecto: nombre/departamento/temporada/notas (el cliente NO se cambia). Si cambia el
 * departamento, valida que el nuevo pertenezca al MISMO cliente del proyecto. PATCH parcial (M1).
 * UNA transacción (A2) con auditoría + bitácora. Requiere `desarrollo.administrar`.
 */
export async function actualizarProyecto(
  sesion: SesionUsuario,
  id: number,
  entrada: EntradaActualizarProyecto,
  bd?: ContextoBd,
): Promise<ProyectoDetalleSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const datos = validarEntrada(esquemaProyectoEditar, entrada);

  await enTransaccion(async (tx) => {
    const actual = await exigirProyecto(tx, id, sesion.idEmpresaActiva);

    // Cambios REALES respecto al valor actual (idempotencia, igual que `actualizarDesarrollo`):
    // un PATCH que no mueve ningún campo no debe bumpear `modificadoEn` ni dejar bitácora fantasma.
    const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
    const cambiaDepartamento =
      datos.idClienteDepartamento !== undefined &&
      datos.idClienteDepartamento !== actual.idClienteDepartamento;
    const cambiaTemporada =
      datos.idTemporada !== undefined && datos.idTemporada !== actual.idTemporada;
    const cambiaNotas = datos.notas !== undefined && datos.notas !== actual.notas;

    if (!cambiaNombre && !cambiaDepartamento && !cambiaTemporada && !cambiaNotas) {
      return; // idempotente: nada que guardar, sin bitácora vacía
    }

    if (cambiaDepartamento && datos.idClienteDepartamento !== undefined) {
      await exigirDepartamentoDeCliente(tx, actual.idCliente, datos.idClienteDepartamento);
    }
    if (cambiaTemporada && datos.idTemporada !== undefined && datos.idTemporada !== null) {
      await exigirTemporada(tx, datos.idTemporada);
    }

    const cambios: Prisma.ProyectoUpdateInput = { ...datosModificacion(sesion) };
    if (cambiaNombre && datos.nombre !== undefined) {
      cambios.nombre = datos.nombre;
    }
    if (cambiaDepartamento && datos.idClienteDepartamento !== undefined) {
      cambios.clienteDepartamento = { connect: { id: datos.idClienteDepartamento } };
    }
    if (cambiaTemporada && datos.idTemporada !== undefined) {
      cambios.temporada =
        datos.idTemporada === null ? { disconnect: true } : { connect: { id: datos.idTemporada } };
    }
    if (cambiaNotas && datos.notas !== undefined) {
      cambios.notas = datos.notas;
    }

    await tx.proyecto.update({ where: { id }, data: cambios });

    await registrarBitacora(tx, sesion, {
      entidad: 'Proyecto',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: {
        ...(cambiaNombre ? { nombre: datos.nombre } : {}),
        ...(cambiaDepartamento ? { idClienteDepartamento: datos.idClienteDepartamento } : {}),
        ...(cambiaTemporada ? { idTemporada: datos.idTemporada ?? null } : {}),
      },
    });
  }, bd);

  return obtenerProyecto(sesion, id, bd);
}

/**
 * Archiva un proyecto (borrado SUAVE reversible): `archivado=true` + bitácora. Archivar dos veces es
 * `ErrorConflicto`. Requiere `desarrollo.administrar`.
 */
export async function archivarProyecto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProyectoDetalleSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  await enTransaccion(async (tx) => {
    const actual = await exigirProyecto(tx, id, sesion.idEmpresaActiva);
    if (actual.archivado) {
      throw new ErrorConflicto(`El proyecto ${Number(actual.folio)} ya está archivado.`);
    }
    await tx.proyecto.update({
      where: { id },
      data: { archivado: true, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Proyecto',
      idEntidad: id,
      accion: 'DESACTIVAR',
      datos: { folio: Number(actual.folio) },
    });
  }, bd);

  return obtenerProyecto(sesion, id, bd);
}

/** Desarchiva un proyecto (operación inversa): `archivado=false` + bitácora. Requiere `desarrollo.administrar`. */
export async function desarchivarProyecto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProyectoDetalleSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  await enTransaccion(async (tx) => {
    const actual = await exigirProyecto(tx, id, sesion.idEmpresaActiva);
    if (!actual.archivado) {
      throw new ErrorConflicto(`El proyecto ${Number(actual.folio)} ya está activo.`);
    }
    await tx.proyecto.update({
      where: { id },
      data: { archivado: false, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Proyecto',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { folio: Number(actual.folio), operacion: 'desarchivar' },
    });
  }, bd);

  return obtenerProyecto(sesion, id, bd);
}

/** Obtiene un proyecto (con sus desarrollos y estado derivado) de la empresa activa, o lanza. */
export async function obtenerProyecto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProyectoDetalleSalida> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const proyecto = await clienteLectura(bd).proyecto.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: incluirProyectoDetalle,
  });
  if (proyecto === null) {
    throw new ErrorNoEncontrado('Proyecto', id);
  }
  return aProyectoDetalleSalida(proyecto);
}

/**
 * Lista proyectos de la empresa activa (A9) con búsqueda (folio o nombre), filtros (cliente,
 * departamento, temporada), toggle de archivados, orden y paginación EN SERVIDOR. Cada proyecto trae
 * sus conteos de desarrollos por estado (para la tarjeta). Requiere `desarrollo.ver`.
 */
export async function listarProyectos(
  sesion: SesionUsuario,
  parametros: ParametrosListarProyectos = {},
  bd?: ContextoBd,
): Promise<Pagina<ProyectoSalida>> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const filtros = validarEntrada(esquemaListarProyectosDominio, parametros);

  const busquedaFolio = aFolioBusqueda(filtros.busqueda);
  const where: Prisma.ProyectoWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.incluirArchivados ? {} : { archivado: false }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(filtros.idClienteDepartamento === undefined
      ? {}
      : { idClienteDepartamento: filtros.idClienteDepartamento }),
    ...(filtros.idTemporada === undefined ? {} : { idTemporada: filtros.idTemporada }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
            ...(busquedaFolio === null ? [] : [{ folio: busquedaFolio }]),
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.proyecto.count({ where }),
    cliente.proyecto.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirProyectoLista,
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos.map(aProyectoSalida), total, filtros);
}

/** Si la búsqueda es un entero, devuelve el `bigint` para filtrar por folio; si no, `null`. */
function aFolioBusqueda(busqueda: string | undefined): bigint | null {
  if (busqueda === undefined || !/^\d+$/.test(busqueda.trim())) {
    return null;
  }
  try {
    return BigInt(busqueda.trim());
  } catch {
    return null;
  }
}
