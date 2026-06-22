/**
 * CRUD de PLANTILLAS DE RUTA de la Ruta Crítica (Módulo 8, F5-E2; doc 08-Ruta-Critica §2.1; D10).
 * Una plantilla (ex `CP_Tiempos`) define, para una familia/artículo, QUÉ procesos lleva, con qué
 * TIEMPO ESTÁNDAR y con qué ENCADENAMIENTO PROPIO. El encadenamiento de la plantilla puede DIFERIR
 * del DAG genérico de `ProcesoDep` (E1), porque el viejo capturaba `CP_Tiempos.Antecesor` por
 * artículo; por eso se modela aparte (`PlantillaRutaDep`). El RECHAZO DE CICLOS reusa `grafo.ts`.
 *
 * Innegociables: A1 (lógica aquí), A2/A7 (todo en una transacción + bitácora), A4 (RBAC:
 * `rc.catalogo-ver` lee, `rc.catalogo-administrar` muta), borrado SUAVE, A6 (ciclos = lógica pura).
 */
import {
  esquemaPlantillaCrear,
  esquemaPlantillaPatchCuerpo,
  type DatosPlantillaCrear,
  type DatosPlantillaPatchCuerpo,
  type DatosPlantillaProcesoEntrada,
} from '../../contrato/index.js';
import type { Prisma, PrismaClient } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { validarDependencias } from './grafo.js';

/** Un renglón de plantilla tal como lo devuelve el dominio. */
export interface PlantillaProcesoDto {
  id: number;
  idProcesoDef: number;
  codigoProceso: string;
  nombreProceso: string;
  tiempoEstandar: number;
  orden: number;
  idsAntecesores: number[];
}

/** Plantilla COMPLETA tal como la devuelve el dominio (con sus procesos y encadenamiento). */
export interface PlantillaDto {
  id: number;
  nombre: string;
  idFamiliaArticulo: number | null;
  familia: string | null;
  idArticuloRC: number | null;
  articulo: string | null;
  activo: boolean;
  procesos: PlantillaProcesoDto[];
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

const INCLUDE_PLANTILLA = {
  familia: { select: { nombre: true } },
  articulo: { select: { nombre: true } },
  procesos: {
    orderBy: { orden: 'asc' },
    include: {
      procesoDef: { select: { codigo: true, nombre: true } },
      antecesores: { select: { idAntecesor: true } },
    },
  },
} as const satisfies Prisma.PlantillaRutaInclude;

type PlantillaConRelaciones = Prisma.PlantillaRutaGetPayload<{ include: typeof INCLUDE_PLANTILLA }>;

/**
 * Proyecta el payload de Prisma al DTO. Los `idsAntecesores` de cada renglón vienen como ids de
 * `PlantillaRutaProceso` (la FK de `PlantillaRutaDep`); se traducen al `idProcesoDef` del renglón
 * antecesor para que la API hable siempre en términos de procesos del catálogo.
 */
function aDto(p: PlantillaConRelaciones): PlantillaDto {
  const idProcesoDefPorRenglon = new Map(p.procesos.map((r) => [r.id, r.idProcesoDef]));
  return {
    id: p.id,
    nombre: p.nombre,
    idFamiliaArticulo: p.idFamiliaArticulo,
    familia: p.familia?.nombre ?? null,
    idArticuloRC: p.idArticuloRC,
    articulo: p.articulo?.nombre ?? null,
    activo: p.activo,
    procesos: p.procesos.map((r) => ({
      id: r.id,
      idProcesoDef: r.idProcesoDef,
      codigoProceso: r.procesoDef.codigo,
      nombreProceso: r.procesoDef.nombre,
      tiempoEstandar: r.tiempoEstandar,
      orden: r.orden,
      idsAntecesores: r.antecesores
        .map((a) => idProcesoDefPorRenglon.get(a.idAntecesor))
        .filter((x): x is number => x !== undefined),
    })),
    creadoEn: p.creadoEn,
    creadoPorId: p.creadoPorId,
    modificadoEn: p.modificadoEn,
    modificadoPorId: p.modificadoPorId,
  };
}

async function cargarPlantilla(cliente: Tx | PrismaClient, id: number): Promise<PlantillaDto> {
  const p = await cliente.plantillaRuta.findUnique({ where: { id }, include: INCLUDE_PLANTILLA });
  if (p === null) {
    throw new ErrorNoEncontrado('PlantillaRuta', id);
  }
  return aDto(p);
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Lista TODAS las plantillas (catálogo corto), opcionalmente con inactivas. */
export async function listarPlantillas(
  sesion: SesionUsuario,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<PlantillaDto[]> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const filas = await clienteLectura(bd).plantillaRuta.findMany({
    where: incluirInactivos ? {} : { activo: true },
    include: INCLUDE_PLANTILLA,
    orderBy: { nombre: 'asc' },
  });
  return filas.map(aDto);
}

/** Obtiene una plantilla COMPLETA por id. */
export async function obtenerPlantilla(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<PlantillaDto> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  return cargarPlantilla(clienteLectura(bd), id);
}

// ── Validaciones del set de procesos ──────────────────────────────────────────

/**
 * Valida el set de procesos de una plantilla:
 *  1. Sin `idProcesoDef` repetido (un proceso no puede ir dos veces en la misma plantilla).
 *  2. Cada `idProcesoDef` existe y está ACTIVO en el catálogo.
 *  3. Cada antecesor pertenece al mismo set (no se puede depender de un proceso fuera de la plantilla).
 *  4. El encadenamiento es ACÍCLICO (reusa `grafo.ts` aplicado sobre los ids de proceso del set).
 */
async function validarProcesos(tx: Tx, procesos: DatosPlantillaProcesoEntrada[]): Promise<void> {
  const idsProceso = procesos.map((p) => p.idProcesoDef);
  const idsUnicos = new Set(idsProceso);
  if (idsUnicos.size !== idsProceso.length) {
    throw new ErrorValidacion('Un proceso no puede aparecer dos veces en la misma plantilla.');
  }
  if (idsProceso.length === 0) {
    return;
  }

  const existentes = await tx.procesoDef.findMany({
    where: { id: { in: idsProceso } },
    select: { id: true, activo: true },
  });
  const activosPorId = new Map(existentes.map((p) => [p.id, p.activo]));
  for (const id of idsProceso) {
    const activo = activosPorId.get(id);
    if (activo === undefined) {
      throw new ErrorValidacion('Alguno de los procesos indicados no existe.');
    }
    if (!activo) {
      throw new ErrorValidacion('Alguno de los procesos indicados está desactivado.');
    }
  }

  // Antecesores deben pertenecer al set y no auto-referenciarse; el grafo se valida acíclico.
  // Se trabaja en términos de `idProcesoDef` (la API habla de procesos del catálogo).
  const aristas: { idProceso: number; idAntecesor: number }[] = [];
  for (const renglon of procesos) {
    const antecesoresUnicos = new Set(renglon.idsAntecesores);
    for (const idAntecesor of antecesoresUnicos) {
      if (idAntecesor === renglon.idProcesoDef) {
        throw new ErrorValidacion('Un proceso no puede ser su propio antecesor en la plantilla.');
      }
      if (!idsUnicos.has(idAntecesor)) {
        throw new ErrorValidacion(
          'Un antecesor del encadenamiento no pertenece a los procesos de la plantilla.',
        );
      }
      aristas.push({ idProceso: renglon.idProcesoDef, idAntecesor });
    }
  }

  // Validación de ciclos: para cada renglón, sus antecesores no deben cerrar un ciclo con el resto.
  for (const renglon of procesos) {
    const idsAntecesores = [...new Set(renglon.idsAntecesores)];
    if (idsAntecesores.length === 0) continue;
    const resultado = validarDependencias(renglon.idProcesoDef, idsAntecesores, aristas);
    if (!resultado.ok) {
      throw new ErrorValidacion(
        'El encadenamiento de la plantilla forma un ciclo. La Ruta Crítica no admite ciclos.',
      );
    }
  }
}

/** Verifica que la familia y/o el artículo (si vienen) existan. */
async function validarReferencias(
  tx: Tx,
  idFamiliaArticulo: number | null | undefined,
  idArticuloRC: number | null | undefined,
): Promise<void> {
  if (idFamiliaArticulo != null) {
    const f = await tx.familiaArticulo.findUnique({
      where: { id: idFamiliaArticulo },
      select: { id: true },
    });
    if (f === null) {
      throw new ErrorValidacion('La familia indicada no existe.');
    }
  }
  if (idArticuloRC != null) {
    const a = await tx.articuloRC.findUnique({
      where: { id: idArticuloRC },
      select: { id: true },
    });
    if (a === null) {
      throw new ErrorValidacion('El artículo indicado no existe.');
    }
  }
}

/**
 * Reemplaza el set COMPLETO de procesos de una plantilla (borra los renglones actuales y crea los
 * nuevos con su encadenamiento). Se asume el set ya validado. El `orden` se asigna por la posición
 * en el arreglo. Las aristas se crean en términos de `PlantillaRutaProceso.id` (la FK real).
 */
async function reemplazarProcesos(
  tx: Tx,
  idPlantilla: number,
  procesos: DatosPlantillaProcesoEntrada[],
): Promise<void> {
  // Cascade en `PlantillaRutaDep` desde `PlantillaRutaProceso`: al borrar los renglones caen sus
  // aristas. Borramos todo y recreamos (set completo).
  await tx.plantillaRutaProceso.deleteMany({ where: { idPlantillaRuta: idPlantilla } });

  // Crea cada renglón uno por uno para conocer su id (necesario para las aristas).
  const idRenglonPorProceso = new Map<number, number>();
  for (const [indice, renglon] of procesos.entries()) {
    const creado = await tx.plantillaRutaProceso.create({
      data: {
        idPlantillaRuta: idPlantilla,
        idProcesoDef: renglon.idProcesoDef,
        tiempoEstandar: renglon.tiempoEstandar,
        orden: indice,
        creadoPorId: null,
        modificadoPorId: null,
      },
      select: { id: true },
    });
    idRenglonPorProceso.set(renglon.idProcesoDef, creado.id);
  }

  // Aristas del encadenamiento propio (en términos de renglones de la plantilla).
  const aristas: { idPlantillaRutaProceso: number; idAntecesor: number }[] = [];
  for (const renglon of procesos) {
    const idRenglon = idRenglonPorProceso.get(renglon.idProcesoDef);
    if (idRenglon === undefined) continue;
    for (const idAntecesorProceso of new Set(renglon.idsAntecesores)) {
      const idRenglonAntecesor = idRenglonPorProceso.get(idAntecesorProceso);
      if (idRenglonAntecesor !== undefined) {
        aristas.push({ idPlantillaRutaProceso: idRenglon, idAntecesor: idRenglonAntecesor });
      }
    }
  }
  if (aristas.length > 0) {
    await tx.plantillaRutaDep.createMany({ data: aristas, skipDuplicates: true });
  }
}

// ── Alta / edición / borrado suave ────────────────────────────────────────────

/** Crea una plantilla de ruta con su set de procesos y encadenamiento propio. */
export async function crearPlantilla(
  sesion: SesionUsuario,
  entrada: DatosPlantillaCrear,
  bd?: ContextoBd,
): Promise<PlantillaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaPlantillaCrear, entrada);
  return enTransaccion(async (tx) => {
    await validarReferencias(tx, datos.idFamiliaArticulo, datos.idArticuloRC);
    await validarProcesos(tx, datos.procesos);
    const plantilla = await tx.plantillaRuta.create({
      data: {
        nombre: datos.nombre,
        idFamiliaArticulo: datos.idFamiliaArticulo ?? null,
        idArticuloRC: datos.idArticuloRC ?? null,
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });
    await reemplazarProcesos(tx, plantilla.id, datos.procesos);
    await registrarBitacora(tx, sesion, {
      entidad: 'PlantillaRuta',
      idEntidad: plantilla.id,
      accion: 'CREAR',
      datos: { nombre: datos.nombre, totalProcesos: datos.procesos.length },
    });
    return cargarPlantilla(tx, plantilla.id);
  }, bd);
}

/** Actualiza una plantilla (encabezado, set de procesos si viene, y/o `activo`). */
export async function actualizarPlantilla(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosPlantillaPatchCuerpo,
  bd?: ContextoBd,
): Promise<PlantillaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaPlantillaPatchCuerpo, entrada);
  return enTransaccion(async (tx) => {
    const actual = await tx.plantillaRuta.findUnique({ where: { id } });
    if (actual === null) {
      throw new ErrorNoEncontrado('PlantillaRuta', id);
    }

    const cambios: Prisma.PlantillaRutaUpdateInput = {};
    const detalle: Record<string, unknown> = {};
    if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
      cambios.nombre = datos.nombre;
      detalle.nombre = { de: actual.nombre, a: datos.nombre };
    }
    if (datos.idFamiliaArticulo !== undefined) {
      await validarReferencias(tx, datos.idFamiliaArticulo, undefined);
      cambios.familia =
        datos.idFamiliaArticulo === null
          ? { disconnect: true }
          : { connect: { id: datos.idFamiliaArticulo } };
      detalle.idFamiliaArticulo = datos.idFamiliaArticulo;
    }
    if (datos.idArticuloRC !== undefined) {
      await validarReferencias(tx, undefined, datos.idArticuloRC);
      cambios.articulo =
        datos.idArticuloRC === null
          ? { disconnect: true }
          : { connect: { id: datos.idArticuloRC } };
      detalle.idArticuloRC = datos.idArticuloRC;
    }
    if (datos.activo !== undefined && datos.activo !== actual.activo) {
      cambios.activo = datos.activo;
      detalle.activo = datos.activo;
    }

    const tocaProcesos = datos.procesos !== undefined;
    if (Object.keys(cambios).length > 0) {
      Object.assign(cambios, datosModificacion(sesion));
      await tx.plantillaRuta.update({ where: { id }, data: cambios });
    }
    if (tocaProcesos) {
      await validarProcesos(tx, datos.procesos ?? []);
      await reemplazarProcesos(tx, id, datos.procesos ?? []);
    }

    if (Object.keys(detalle).length > 0 || tocaProcesos) {
      await registrarBitacora(tx, sesion, {
        entidad: 'PlantillaRuta',
        idEntidad: id,
        accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
        datos: { ...detalle, ...(tocaProcesos ? { totalProcesos: datos.procesos?.length } : {}) },
      });
    }
    return cargarPlantilla(tx, id);
  }, bd);
}

/** Desactiva (borrado suave) una plantilla. */
export async function desactivarPlantilla(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<PlantillaDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await tx.plantillaRuta.findUnique({ where: { id }, select: { activo: true } });
    if (actual === null) {
      throw new ErrorNoEncontrado('PlantillaRuta', id);
    }
    if (!actual.activo) {
      throw new ErrorConflicto('La plantilla ya está desactivada.');
    }
    return actualizarPlantilla(sesion, id, { activo: false }, { tx });
  }, bd);
}
