/**
 * Planes de muestreo AQL (F6-E1 — doc 09 §5.2; ISO 2859 nivel general II, AQL 1.0/2.5/10). El plan
 * es la tabla de muestreo COMO DATOS (no motor estadístico). Servicios:
 *
 *  • CRUD del plan con sus renglones (rango de lote → muestra + límites por nivel), borrado SUAVE.
 *    Al editar, los renglones REEMPLAZAN el set completo en una transacción (patrón "rewrite del
 *    BOM"): se borra y se recrea, con sus límites en cascada (A2).
 *  • `resolverPlan(tamañoLote, nivelAQL)` — el "resolver" es simplemente el PLAN DEFAULT ACTIVO
 *    (sin cascada por cliente/tipo: decisión (c)): localiza el renglón cuyo rango cubre el lote y
 *    devuelve `tamanoMuestra` (lo VINCULANTE, decisión (b)) + el `aceptar`/`rechazar` de ESE nivel
 *    (REFERENCIA — el veredicto es manual en E2, decisión (a)).
 *
 * Lógica SOLO aquí (A1); auditoría + bitácora (A7); catálogo GLOBAL. Unicidad de `nombre`.
 */
import {
  esquemaPlanAqlCrear,
  esquemaPlanAqlEditar,
  esquemaResolverPlanQuery,
  type ResolverPlanSalida,
} from '../../contrato/index.js';
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
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Plan con sus renglones y límites (lo que devuelven los servicios y proyecta la ruta). */
export type PlanConRenglones = Prisma.PlanMuestreoAQLGetPayload<{
  include: { renglones: { include: { limites: true } } };
}>;

const INCLUIR_RENGLONES = {
  renglones: {
    orderBy: { loteMin: 'asc' },
    include: { limites: { orderBy: { nivelAQL: 'asc' } } },
  },
} satisfies Prisma.PlanMuestreoAQLInclude;

/** Alta de plan AQL. */
export type EntradaCrearPlanAql = z.input<typeof esquemaPlanAqlCrear>;
/** Edición de plan AQL. */
export type EntradaActualizarPlanAql = z.input<typeof esquemaPlanAqlEditar>;

/**
 * Filtros del listado con tipos NATIVOS (boolean ya coaccionado): la ruta recibe el querystring
 * con `stringbool` (contrato) y aquí re-valida con tipos nativos (patrón Almacenes).
 */
export const esquemaListarPlanesAql = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado. */
export type ParametrosListarPlanesAql = z.input<typeof esquemaListarPlanesAql>;
/** Renglón validado del plan (forma de entrada). */
type RenglonEntrada = z.output<typeof esquemaPlanAqlCrear>['renglones'][number];

/** Unicidad de negocio: no puede haber dos planes con el mismo nombre (insensible a mayúsculas). */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.planMuestreoAQL.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un plan AQL llamado "${nombre}".`
        : `Ya existe un plan AQL llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/**
 * Valida la coherencia de los renglones de un plan ANTES de escribir (A1): rangos no invertidos
 * (loteMax ≥ loteMin cuando hay tope); rangos sin solaparse; un único nivel AQL por renglón; y
 * `rechazar > aceptar` en cada límite. Lanza `ErrorValidacion` con un mensaje claro.
 */
function validarRenglones(renglones: readonly RenglonEntrada[]): void {
  // Ordena por loteMin para detectar solapes y huecos de forma determinista.
  const ordenados = [...renglones].sort((a, b) => a.loteMin - b.loteMin);
  let topeAnterior = 0;
  for (const renglon of ordenados) {
    if (renglon.loteMax !== null && renglon.loteMax < renglon.loteMin) {
      throw new ErrorValidacion(
        `El renglón con lote desde ${String(renglon.loteMin)} tiene un máximo menor que el mínimo.`,
      );
    }
    if (renglon.loteMin <= topeAnterior) {
      throw new ErrorValidacion(
        `Los rangos de lote se solapan o están desordenados cerca de ${String(renglon.loteMin)}.`,
      );
    }
    topeAnterior = renglon.loteMax ?? Number.MAX_SAFE_INTEGER;

    const niveles = new Set<number>();
    for (const limite of renglon.limites) {
      if (niveles.has(limite.nivelAQL)) {
        throw new ErrorValidacion(
          `El renglón con lote desde ${String(renglon.loteMin)} repite el nivel AQL ${String(limite.nivelAQL)}.`,
        );
      }
      niveles.add(limite.nivelAQL);
      if (limite.rechazar <= limite.aceptar) {
        throw new ErrorValidacion(
          `En el nivel AQL ${String(limite.nivelAQL)}, el número de rechazo debe ser mayor que el de aceptación.`,
        );
      }
    }
  }
}

/** Inserta los renglones (con sus límites) de un plan dentro de la transacción. */
async function crearRenglones(
  tx: Tx,
  idPlan: number,
  sesion: SesionUsuario,
  renglones: readonly RenglonEntrada[],
): Promise<void> {
  for (const renglon of renglones) {
    await tx.planMuestreoRenglon.create({
      data: {
        idPlan,
        loteMin: renglon.loteMin,
        loteMax: renglon.loteMax,
        tamanoMuestra: renglon.tamanoMuestra,
        limites: {
          create: renglon.limites.map((limite) => ({
            nivelAQL: limite.nivelAQL,
            aceptar: limite.aceptar,
            rechazar: limite.rechazar,
            ...datosCreacion(sesion),
          })),
        },
        ...datosCreacion(sesion),
      },
    });
  }
}

/** Busca un plan (con renglones) por id o lanza `ErrorNoEncontrado`. */
async function exigirPlan(tx: Tx, id: number): Promise<PlanConRenglones> {
  const plan = await tx.planMuestreoAQL.findUnique({ where: { id }, include: INCLUIR_RENGLONES });
  if (plan === null) {
    throw new ErrorNoEncontrado('PlanMuestreoAQL', id);
  }
  return plan;
}

/**
 * Crea un plan AQL con sus renglones y límites. Permiso `calidad.administrar-catalogo`; nombre
 * único; renglones coherentes; nace activo; auditoría + bitácora en la transacción (A2/A7).
 */
export async function crearPlanAql(
  sesion: SesionUsuario,
  entrada: EntradaCrearPlanAql,
  bd?: ContextoBd,
): Promise<PlanConRenglones> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaPlanAqlCrear, entrada);
  validarRenglones(datos.renglones);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);
      const plan = await tx.planMuestreoAQL.create({
        data: { nombre: datos.nombre, ...datosCreacion(sesion) },
      });
      await crearRenglones(tx, plan.id, sesion, datos.renglones);
      await registrarBitacora(tx, sesion, {
        entidad: 'PlanMuestreoAQL',
        idEntidad: plan.id,
        accion: 'CREAR',
        datos: { nombre: plan.nombre, renglones: datos.renglones.length },
      });
      return exigirPlan(tx, plan.id);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un plan AQL llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un plan AQL: nombre, `activo` (des/reactivar) y/o sus renglones. Si vienen
 * `renglones`, REEMPLAZAN el set completo (borra y recrea con sus límites en cascada, A2).
 */
export async function actualizarPlanAql(
  sesion: SesionUsuario,
  entrada: EntradaActualizarPlanAql,
  bd?: ContextoBd,
): Promise<PlanConRenglones> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaPlanAqlEditar, entrada);
  if (datos.renglones !== undefined) {
    validarRenglones(datos.renglones);
  }

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirPlan(tx, datos.id);
      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;
      const reescribeRenglones = datos.renglones !== undefined;

      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.PlanMuestreoAQLUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }
      await tx.planMuestreoAQL.update({ where: { id: datos.id }, data: cambios });

      if (reescribeRenglones && datos.renglones !== undefined) {
        // Cascade borra los límites de cada renglón eliminado.
        await tx.planMuestreoRenglon.deleteMany({ where: { idPlan: datos.id } });
        await crearRenglones(tx, datos.id, sesion, datos.renglones);
      }

      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'PlanMuestreoAQL',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { nombre: actual.nombre },
        });
      } else if (cambiaNombre || reactiva || reescribeRenglones) {
        await registrarBitacora(tx, sesion, {
          entidad: 'PlanMuestreoAQL',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: datos.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
            ...(reescribeRenglones ? { renglonesReescritos: datos.renglones?.length ?? 0 } : {}),
          },
        });
      }
      return exigirPlan(tx, datos.id);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un plan AQL con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) un plan AQL. Desactivarlo dos veces es `ErrorConflicto`. */
export async function desactivarPlanAql(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<PlanConRenglones> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirPlan(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El plan AQL "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarPlanAql(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un plan AQL desactivado (operación inversa del borrado suave). */
export async function reactivarPlanAql(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<PlanConRenglones> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirPlan(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El plan AQL "${actual.nombre}" ya está activo.`);
    }
    return actualizarPlanAql(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un plan (con renglones) por id o lanza `ErrorNoEncontrado`. */
export async function obtenerPlanAql(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<PlanConRenglones> {
  verificarPermiso(sesion, 'calidad.ver');
  const plan = await clienteLectura(bd).planMuestreoAQL.findUnique({
    where: { id },
    include: INCLUIR_RENGLONES,
  });
  if (plan === null) {
    throw new ErrorNoEncontrado('PlanMuestreoAQL', id);
  }
  return plan;
}

/** Lista planes AQL con búsqueda, orden y paginación EN SERVIDOR. */
export async function listarPlanesAql(
  sesion: SesionUsuario,
  parametros: ParametrosListarPlanesAql = {},
  bd?: ContextoBd,
): Promise<Pagina<PlanConRenglones>> {
  verificarPermiso(sesion, 'calidad.ver');
  const filtros = validarEntrada(esquemaListarPlanesAql, parametros);

  const where: Prisma.PlanMuestreoAQLWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.planMuestreoAQL.count({ where }),
    cliente.planMuestreoAQL.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: INCLUIR_RENGLONES,
      ...rangoPrisma(filtros),
    }),
  ]);
  return armarPagina(datos, total, filtros);
}

/**
 * Resuelve el plan default activo para un (tamaño de lote, nivel AQL): el "resolver" es el PLAN
 * DEFAULT ACTIVO (sin cascada por cliente/tipo — decisión (c)). Localiza el renglón cuyo rango
 * [loteMin, loteMax] cubre el lote y devuelve su `tamanoMuestra` + el `aceptar`/`rechazar` del
 * nivel pedido. Lanza `ErrorNoEncontrado` si no hay plan default activo, o `ErrorValidacion` si el
 * lote/nivel cae fuera de la tabla configurada (la tabla es DATOS: si falta el rango, se avisa).
 */
export async function resolverPlan(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaResolverPlanQuery>,
  bd?: ContextoBd,
): Promise<ResolverPlanSalida> {
  verificarPermiso(sesion, 'calidad.ver');
  const { tamanoLote, nivelAQL } = validarEntrada(esquemaResolverPlanQuery, parametros);
  const cliente = clienteLectura(bd);

  // El plan default activo: hay UN solo plan activo (decisión (c)). Si hubiera más de uno, se toma
  // el más reciente como default (criterio determinista) — el seed mantiene uno solo.
  const plan = await cliente.planMuestreoAQL.findFirst({
    where: { activo: true },
    orderBy: { creadoEn: 'desc' },
    include: INCLUIR_RENGLONES,
  });
  if (plan === null) {
    throw new ErrorNoEncontrado('PlanMuestreoAQL', 'default-activo');
  }

  const renglon = plan.renglones.find(
    (r) => tamanoLote >= r.loteMin && (r.loteMax === null || tamanoLote <= r.loteMax),
  );
  if (renglon === undefined) {
    throw new ErrorValidacion(
      `El plan "${plan.nombre}" no tiene un rango configurado para un lote de ${String(tamanoLote)}.`,
    );
  }
  const limite = renglon.limites.find((l) => l.nivelAQL.toNumber() === nivelAQL);
  if (limite === undefined) {
    throw new ErrorValidacion(
      `El renglón del lote ${String(tamanoLote)} no tiene límites para el nivel AQL ${String(nivelAQL)}.`,
    );
  }

  return {
    idPlan: plan.id,
    nombrePlan: plan.nombre,
    tamanoLote,
    nivelAQL,
    tamanoMuestra: renglon.tamanoMuestra,
    aceptar: limite.aceptar,
    rechazar: limite.rechazar,
  };
}
