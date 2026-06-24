/**
 * Catálogo CONFIGURABLE de la Ruta Crítica — CRUD de procesos + roles responsables (N:M) +
 * dependencias (DAG, con rechazo de ciclos) + checklists (Módulo 8, F5-E1; doc 08-Ruta-Critica;
 * D10/D11). Es el "corazón configurable" del motor de workflow: todo lo demás de la fase
 * (instancias por orden, fechas/semáforos, plantillas) referenciará estas tablas en E2+.
 *
 * Innegociables del proyecto que respeta este servicio:
 *  • A1 — TODA la lógica de negocio vive aquí (las rutas solo validan/autorizan/mapean).
 *  • A2/A7 — cada cambio crítico ocurre en UNA transacción con `registrarBitacora` adentro (la RC
 *    es tabla crítica: sus cambios se auditan).
 *  • A4 — RBAC server-side: lectura exige `rc.catalogo-ver`; mutación, `rc.catalogo-administrar`.
 *  • Borrado SUAVE (`activo`), nunca DELETE físico (los procesos/ítems quitados se desactivan).
 *  • A6 — el RECHAZO DE CICLOS del DAG se valida con lógica pura testeable (`grafo.ts`).
 */
import {
  esquemaProcesoChecklistCuerpo,
  esquemaProcesoCrear,
  esquemaProcesoDependenciasCuerpo,
  esquemaProcesoEditar,
  esquemaProcesoRolesCuerpo,
  type DatosProcesoChecklist,
  type DatosProcesoCrear,
  type DatosProcesoDependencias,
  type DatosProcesoEditar,
  type DatosProcesoRoles,
} from '../../contrato/index.js';
import type { Prisma, PrismaClient } from '../../datos/index.js';
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

import { validarDependencias } from './grafo.js';

/** Alta: campos del esquema compartido. */
export type EntradaCrearProceso = z.input<typeof esquemaProcesoCrear>;
/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarProceso = z.input<typeof esquemaProcesoEditar>;

/**
 * Parámetros del listado en el DOMINIO. La querystring del contrato usa `z.stringbool()` para
 * `incluirInactivos` (coacciona la cadena de la URL a booleano); aquí, en cambio, ya recibimos el
 * valor parseado, así que `incluirInactivos` es `z.boolean()` (mismo patrón que tipos-proceso).
 */
export const esquemaListarProcesos = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['codigo', 'nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});
/** Parámetros de listado de procesos. */
export type ParametrosListarProcesos = z.input<typeof esquemaListarProcesos>;

/**
 * Proceso COMPLETO tal como lo devuelve el dominio (modelo + roles + antecesores + checklist
 * activo, en orden). La ruta lo proyecta a JSON (fechas ISO). Los antecesores se devuelven con su
 * código/nombre para que la UI los muestre sin un segundo viaje.
 */
export interface ProcesoCompletoDto {
  id: number;
  codigo: string;
  nombre: string;
  critico: boolean;
  ultimoProceso: boolean;
  esResurtido: boolean;
  condicionAplicabilidad: 'ninguna' | 'soloSiLlevaAplicacion';
  tipoEvento:
    | 'recepcionTela'
    | 'corte'
    | 'envioCostura'
    | 'reciboCostura'
    | 'envioEstampado'
    | 'reciboEstampado'
    | 'auditoria'
    | 'autorizacionArte'
    | 'entregaCliente'
    | 'manual';
  tipoDuracion: 'fija' | 'porCantidad' | 'porTipoTela' | 'porAplicacion';
  activo: boolean;
  roles: { idRol: number; nombre: string }[];
  antecesores: { idProceso: number; codigo: string; nombre: string }[];
  checklist: { id: number; descripcion: string; orden: number }[];
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

/** `include` reusable para traer un proceso con sus relaciones. */
const INCLUDE_PROCESO = {
  roles: { include: { rol: { select: { id: true, nombre: true } } } },
  antecesores: {
    include: { antecesor: { select: { id: true, codigo: true, nombre: true } } },
  },
  checklist: { where: { activo: true }, orderBy: { orden: 'asc' } },
} as const satisfies Prisma.ProcesoDefInclude;

type ProcesoConRelaciones = Prisma.ProcesoDefGetPayload<{ include: typeof INCLUDE_PROCESO }>;

/** Proyecta el payload de Prisma (con relaciones) al DTO de dominio. */
function aDto(p: ProcesoConRelaciones): ProcesoCompletoDto {
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    critico: p.critico,
    ultimoProceso: p.ultimoProceso,
    esResurtido: p.esResurtido,
    condicionAplicabilidad: p.condicionAplicabilidad,
    tipoEvento: p.tipoEvento,
    tipoDuracion: p.tipoDuracion,
    activo: p.activo,
    roles: p.roles.map((r) => ({ idRol: r.rol.id, nombre: r.rol.nombre })),
    antecesores: p.antecesores.map((a) => ({
      idProceso: a.antecesor.id,
      codigo: a.antecesor.codigo,
      nombre: a.antecesor.nombre,
    })),
    checklist: p.checklist.map((c) => ({ id: c.id, descripcion: c.descripcion, orden: c.orden })),
    creadoEn: p.creadoEn,
    creadoPorId: p.creadoPorId,
    modificadoEn: p.modificadoEn,
    modificadoPorId: p.modificadoPorId,
  };
}

/** Carga un proceso COMPLETO por id (con relaciones) o lanza `ErrorNoEncontrado`. */
async function cargarProcesoCompleto(
  cliente: Tx | PrismaClient,
  id: number,
): Promise<ProcesoCompletoDto> {
  const p = await cliente.procesoDef.findUnique({ where: { id }, include: INCLUDE_PROCESO });
  if (p === null) {
    throw new ErrorNoEncontrado('ProcesoDef', id);
  }
  return aDto(p);
}

/** Unicidad del código (insensible a mayúsculas). La carrera residual la cubre el unique de BD. */
async function exigirCodigoLibre(tx: Tx, codigo: string, idActual?: number): Promise<void> {
  const existente = await tx.procesoDef.findFirst({
    where: {
      codigo: { equals: codigo, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un proceso con el código "${codigo}".`
        : `Ya existe un proceso con el código "${codigo}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un proceso por id (sin relaciones) o lanza `ErrorNoEncontrado`. */
async function exigirProceso(
  tx: Tx,
  id: number,
): Promise<{ id: number; codigo: string; nombre: string; activo: boolean }> {
  const proceso = await tx.procesoDef.findUnique({
    where: { id },
    select: { id: true, codigo: true, nombre: true, activo: true },
  });
  if (proceso === null) {
    throw new ErrorNoEncontrado('ProcesoDef', id);
  }
  return proceso;
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Lista procesos con búsqueda, orden y paginación EN SERVIDOR (con sus relaciones). */
export async function listarProcesos(
  sesion: SesionUsuario,
  parametros: ParametrosListarProcesos = {},
  bd?: ContextoBd,
): Promise<Pagina<ProcesoCompletoDto>> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  const filtros = validarEntrada(esquemaListarProcesos, parametros);

  const where: Prisma.ProcesoDefWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { codigo: { contains: filtros.busqueda, mode: 'insensitive' } },
            { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.procesoDef.count({ where }),
    cliente.procesoDef.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: INCLUDE_PROCESO,
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos.map(aDto), total, filtros);
}

/** Obtiene un proceso COMPLETO por id (con roles, antecesores y checklist). */
export async function obtenerProceso(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProcesoCompletoDto> {
  verificarPermiso(sesion, 'rc.catalogo-ver');
  return cargarProcesoCompleto(clienteLectura(bd), id);
}

// ── Alta / edición / borrado suave del proceso ────────────────────────────────

/** Crea un proceso de la RC (sin relaciones; estas se fijan por sus sub-recursos). */
export async function crearProceso(
  sesion: SesionUsuario,
  entrada: EntradaCrearProceso,
  bd?: ContextoBd,
): Promise<ProcesoCompletoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos: DatosProcesoCrear = validarEntrada(esquemaProcesoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirCodigoLibre(tx, datos.codigo);
      const proceso = await tx.procesoDef.create({
        data: {
          codigo: datos.codigo,
          nombre: datos.nombre,
          ...(datos.critico === undefined ? {} : { critico: datos.critico }),
          ...(datos.ultimoProceso === undefined ? {} : { ultimoProceso: datos.ultimoProceso }),
          ...(datos.esResurtido === undefined ? {} : { esResurtido: datos.esResurtido }),
          ...(datos.condicionAplicabilidad === undefined
            ? {}
            : { condicionAplicabilidad: datos.condicionAplicabilidad }),
          ...(datos.tipoEvento === undefined ? {} : { tipoEvento: datos.tipoEvento }),
          ...(datos.tipoDuracion === undefined ? {} : { tipoDuracion: datos.tipoDuracion }),
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'ProcesoDef',
        idEntidad: proceso.id,
        accion: 'CREAR',
        datos: { codigo: proceso.codigo, nombre: proceso.nombre },
      });
      return cargarProcesoCompleto(tx, proceso.id);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un proceso con el código "${datos.codigo}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/** Actualiza un proceso (banderas, tipos, código/nombre y `activo`). Bitácora según lo que pasó. */
export async function actualizarProceso(
  sesion: SesionUsuario,
  entrada: EntradaActualizarProceso,
  bd?: ContextoBd,
): Promise<ProcesoCompletoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos: DatosProcesoEditar = validarEntrada(esquemaProcesoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await tx.procesoDef.findUnique({ where: { id: datos.id } });
      if (actual === null) {
        throw new ErrorNoEncontrado('ProcesoDef', datos.id);
      }

      const cambios: Prisma.ProcesoDefUpdateInput = {};
      const detalle: Record<string, unknown> = {};

      if (datos.codigo !== undefined && datos.codigo !== actual.codigo) {
        await exigirCodigoLibre(tx, datos.codigo, datos.id);
        cambios.codigo = datos.codigo;
        detalle.codigo = { de: actual.codigo, a: datos.codigo };
      }
      if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
        cambios.nombre = datos.nombre;
        detalle.nombre = { de: actual.nombre, a: datos.nombre };
      }
      if (datos.critico !== undefined && datos.critico !== actual.critico) {
        cambios.critico = datos.critico;
        detalle.critico = { de: actual.critico, a: datos.critico };
      }
      if (datos.ultimoProceso !== undefined && datos.ultimoProceso !== actual.ultimoProceso) {
        cambios.ultimoProceso = datos.ultimoProceso;
        detalle.ultimoProceso = { de: actual.ultimoProceso, a: datos.ultimoProceso };
      }
      if (datos.esResurtido !== undefined && datos.esResurtido !== actual.esResurtido) {
        cambios.esResurtido = datos.esResurtido;
        detalle.esResurtido = { de: actual.esResurtido, a: datos.esResurtido };
      }
      if (
        datos.condicionAplicabilidad !== undefined &&
        datos.condicionAplicabilidad !== actual.condicionAplicabilidad
      ) {
        cambios.condicionAplicabilidad = datos.condicionAplicabilidad;
        detalle.condicionAplicabilidad = {
          de: actual.condicionAplicabilidad,
          a: datos.condicionAplicabilidad,
        };
      }
      if (datos.tipoEvento !== undefined && datos.tipoEvento !== actual.tipoEvento) {
        cambios.tipoEvento = datos.tipoEvento;
        detalle.tipoEvento = { de: actual.tipoEvento, a: datos.tipoEvento };
      }
      if (datos.tipoDuracion !== undefined && datos.tipoDuracion !== actual.tipoDuracion) {
        cambios.tipoDuracion = datos.tipoDuracion;
        detalle.tipoDuracion = { de: actual.tipoDuracion, a: datos.tipoDuracion };
      }

      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;
      if (reactiva) {
        await exigirCodigoLibre(tx, actual.codigo, datos.id);
        cambios.activo = true;
      } else if (desactiva) {
        cambios.activo = false;
      }

      if (Object.keys(cambios).length === 0) {
        return cargarProcesoCompleto(tx, datos.id); // idempotente: nada que guardar
      }

      Object.assign(cambios, datosModificacion(sesion));
      await tx.procesoDef.update({ where: { id: datos.id }, data: cambios });

      if (Object.keys(detalle).length > 0 || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'ProcesoDef',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: { ...detalle, ...(reactiva ? { operacion: 'reactivar' } : {}) },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'ProcesoDef',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { codigo: actual.codigo },
        });
      }

      return cargarProcesoCompleto(tx, datos.id);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un proceso con ese código.', { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) un proceso. Desactivar dos veces es `ErrorConflicto`. */
export async function desactivarProceso(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProcesoCompletoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirProceso(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El proceso "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarProceso(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un proceso desactivado. */
export async function reactivarProceso(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProcesoCompletoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirProceso(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El proceso "${actual.nombre}" ya está activo.`);
    }
    return actualizarProceso(sesion, { id, activo: true }, { tx });
  }, bd);
}

// ── Roles responsables (N:M sobre el RBAC único, A4) ──────────────────────────

/**
 * Fija el set COMPLETO de roles responsables del proceso (reemplaza el actual). Valida que los
 * roles existan. Idempotente: agrega los que falten, quita los que sobren, sin duplicar. Bitácora.
 */
export async function asignarRolesResponsables(
  sesion: SesionUsuario,
  idProceso: number,
  entrada: DatosProcesoRoles,
  bd?: ContextoBd,
): Promise<ProcesoCompletoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaProcesoRolesCuerpo, entrada);
  const idsRoles = [...new Set(datos.idsRoles)];

  return enTransaccion(async (tx) => {
    await exigirProceso(tx, idProceso);

    if (idsRoles.length > 0) {
      const existentes = await tx.rol.count({ where: { id: { in: idsRoles } } });
      if (existentes !== idsRoles.length) {
        throw new ErrorValidacion('Alguno de los roles indicados no existe.');
      }
    }

    // Quita los que ya no están y agrega los que faltan (set conocido).
    await tx.procesoDefRol.deleteMany({
      where: { idProcesoDef: idProceso, idRol: { notIn: idsRoles.length > 0 ? idsRoles : [-1] } },
    });
    if (idsRoles.length > 0) {
      await tx.procesoDefRol.createMany({
        data: idsRoles.map((idRol) => ({
          idProcesoDef: idProceso,
          idRol,
          creadoPorId: sesion.id,
        })),
        skipDuplicates: true,
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'ProcesoDef',
      idEntidad: idProceso,
      accion: 'MODIFICAR',
      datos: { operacion: 'asignar-roles', idsRoles },
    });

    return cargarProcesoCompleto(tx, idProceso);
  }, bd);
}

// ── Dependencias (DAG, con RECHAZO DE CICLOS) ─────────────────────────────────

/**
 * Fija el set COMPLETO de antecesores de un proceso (reemplaza el actual). **CLAVE: RECHAZA
 * CICLOS** (directos `A↔B` y transitivos) y que un proceso sea su propio antecesor. La validación
 * usa la lógica pura de `grafo.ts` sobre TODAS las aristas vivas (menos las del propio proceso, que
 * se reemplazan): si el set propuesto cerraría un ciclo, lanza `ErrorValidacion` con un mensaje
 * claro en español. Idempotente y auditado (A7).
 */
export async function definirDependencias(
  sesion: SesionUsuario,
  idProceso: number,
  entrada: DatosProcesoDependencias,
  bd?: ContextoBd,
): Promise<ProcesoCompletoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaProcesoDependenciasCuerpo, entrada);
  const idsAntecesores = [...new Set(datos.idsAntecesores)];

  return enTransaccion(async (tx) => {
    await exigirProceso(tx, idProceso);

    // Auto-antecedencia: mensaje específico y temprano.
    if (idsAntecesores.includes(idProceso)) {
      throw new ErrorValidacion('Un proceso no puede ser su propio antecesor.');
    }

    if (idsAntecesores.length > 0) {
      const procesosAntecesores = await tx.procesoDef.findMany({
        where: { id: { in: idsAntecesores } },
        select: { id: true, codigo: true, nombre: true },
      });
      if (procesosAntecesores.length !== idsAntecesores.length) {
        throw new ErrorValidacion('Alguno de los procesos antecesores indicados no existe.');
      }

      // Carga TODAS las aristas vivas para evaluar ciclos sobre el grafo resultante.
      const aristas = await tx.procesoDep.findMany({
        select: { idProceso: true, idAntecesor: true },
      });
      const resultado = validarDependencias(idProceso, idsAntecesores, aristas);
      if (!resultado.ok && resultado.conflicto) {
        const { idAntecesor, razon } = resultado.conflicto;
        const conflictivo = procesosAntecesores.find((p) => p.id === idAntecesor);
        const etiqueta = conflictivo ? `"${conflictivo.nombre}"` : `id ${String(idAntecesor)}`;
        if (razon === 'auto') {
          throw new ErrorValidacion('Un proceso no puede ser su propio antecesor.');
        }
        throw new ErrorValidacion(
          `Crear esta dependencia formaría un ciclo: el proceso ${etiqueta} ya depende, directa o ` +
            `indirectamente, de este proceso. La Ruta Crítica no admite ciclos.`,
        );
      }
    }

    // Set conocido: quita las aristas que ya no están y agrega las que faltan.
    await tx.procesoDep.deleteMany({
      where: {
        idProceso,
        idAntecesor: { notIn: idsAntecesores.length > 0 ? idsAntecesores : [-1] },
      },
    });
    if (idsAntecesores.length > 0) {
      await tx.procesoDep.createMany({
        data: idsAntecesores.map((idAntecesor) => ({
          idProceso,
          idAntecesor,
          creadoPorId: sesion.id,
        })),
        skipDuplicates: true,
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'ProcesoDef',
      idEntidad: idProceso,
      accion: 'MODIFICAR',
      datos: { operacion: 'definir-dependencias', idsAntecesores },
    });

    return cargarProcesoCompleto(tx, idProceso);
  }, bd);
}

// ── Checklist configurable ────────────────────────────────────────────────────

/**
 * Fija el set COMPLETO del checklist del proceso (reemplaza el actual). El `orden` se asigna por la
 * posición en el arreglo. Los ítems que vienen con `id` se ACTUALIZAN (texto/orden); los ítems
 * activos que YA NO vienen se DESACTIVAN (borrado suave, conservan historial); los sin `id` se
 * crean. Todo en una transacción con bitácora (A7).
 */
export async function editarChecklist(
  sesion: SesionUsuario,
  idProceso: number,
  entrada: DatosProcesoChecklist,
  bd?: ContextoBd,
): Promise<ProcesoCompletoDto> {
  verificarPermiso(sesion, 'rc.catalogo-administrar');
  const datos = validarEntrada(esquemaProcesoChecklistCuerpo, entrada);

  return enTransaccion(async (tx) => {
    await exigirProceso(tx, idProceso);

    // Ítems vivos actuales del proceso (para distinguir update / desactivar).
    const actuales = await tx.procesoChecklist.findMany({
      where: { idProcesoDef: idProceso, activo: true },
      select: { id: true },
    });
    const idsActuales = new Set(actuales.map((c) => c.id));
    const idsConservados = new Set<number>();

    // Aplica el set EN ORDEN: cada posición fija el `orden`.
    for (const [indice, item] of datos.items.entries()) {
      if (item.id !== undefined) {
        if (!idsActuales.has(item.id)) {
          throw new ErrorValidacion('Alguno de los ítems del checklist no pertenece al proceso.');
        }
        idsConservados.add(item.id);
        await tx.procesoChecklist.update({
          where: { id: item.id },
          data: {
            descripcion: item.descripcion,
            orden: indice,
            ...datosModificacion(sesion),
          },
        });
      } else {
        await tx.procesoChecklist.create({
          data: {
            idProcesoDef: idProceso,
            descripcion: item.descripcion,
            orden: indice,
            ...datosCreacion(sesion),
          },
        });
      }
    }

    // Desactiva (borrado suave) los ítems activos que ya no vienen en el set.
    const idsADesactivar = [...idsActuales].filter((id) => !idsConservados.has(id));
    if (idsADesactivar.length > 0) {
      await tx.procesoChecklist.updateMany({
        where: { id: { in: idsADesactivar } },
        data: { activo: false, ...datosModificacion(sesion) },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'ProcesoDef',
      idEntidad: idProceso,
      accion: 'MODIFICAR',
      datos: { operacion: 'editar-checklist', total: datos.items.length },
    });

    return cargarProcesoCompleto(tx, idProceso);
  }, bd);
}
