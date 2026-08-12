/**
 * Desarrollos — un modelo dentro de un proyecto de desarrollo (F8-E2, D13/R16).
 *
 * Un `Desarrollo` tiene DOS números: el nuestro (`Modelo.codigo`) y el del cliente (`numeroCliente`,
 * que se captura). Su ESTADO es DERIVADO (como `EstadoOrden`): no se guarda ni se edita — lo calcula
 * `calcularEstadoDesarrollo` leyendo las relaciones (precostos congelados, renglones de lista,
 * órdenes ligadas) + el borrado suave (`apagado`). En E2 esas relaciones están vacías (llegan en
 * E3/E4/E6), pero la función se implementa COMPLETA para que ya sea correcta cuando se poblen.
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas sólo validan permiso + Zod y delegan.
 *  • A2 — cada operación multi-tabla (create + bitácora) va en UNA transacción.
 *  • A7 — auditoría uniforme (`creadoPorId`/`modificadoPorId`) + `Bitacora` en la misma tx.
 *  • Apagar/reactivar = borrado SUAVE con motivo (NUNCA se borra físico). Al apagar: `apagado=true`,
 *    `apagadoEn`, `apagadoPorId`, `motivoApagado`. Al reactivar: `apagado=false` y limpia los tres.
 *  • Unicidad `@@unique([idProyecto, idModelo])` la respalda la BD (P2002 → ErrorConflicto claro).
 */
import {
  esquemaDesarrolloCrear,
  esquemaDesarrolloEditar,
  type DesarrolloSalida,
  type EstadoDesarrolloClave,
} from '../../contrato/esquemas/desarrollo.js';
import type { Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Alta: campos del esquema compartido. */
export type EntradaCrearDesarrollo = z.input<typeof esquemaDesarrolloCrear>;
/** Edición: cambios parciales (numeroCliente/notas). */
export type EntradaActualizarDesarrollo = z.input<typeof esquemaDesarrolloEditar>;

/** Motivo obligatorio para apagar un desarrollo (borrado suave). */
const esquemaMotivoApagar = z.object({
  motivo: z
    .string()
    .trim()
    .min(1, { error: 'El motivo es obligatorio' })
    .max(500, { error: 'El motivo no puede tener más de 500 caracteres' }),
});

// ── Estado DERIVADO ────────────────────────────────────────────────────────────────

/**
 * `include` mínimo con las relaciones que gobiernan el estado derivado. Se selecciona lo justo:
 * el estado de cada precosto (para detectar ≥1 congelado) y la existencia de renglones de lista /
 * órdenes ligadas. En E2 estas relaciones vienen vacías.
 */
export const incluirEstadoDesarrollo = {
  precostos: { select: { estado: true } },
  ordenLigadas: { select: { id: true } },
  listaLineas: { select: { id: true } },
} satisfies Prisma.DesarrolloInclude;

/** Forma mínima que necesita el cálculo del estado derivado (compatible con `incluirEstadoDesarrollo`). */
export interface DesarrolloParaEstado {
  apagado: boolean;
  precostos: { estado: string }[];
  ordenLigadas: { id: number }[];
  listaLineas: { id: number }[];
}

/**
 * Calcula el ESTADO DERIVADO de un desarrollo por precedencia (gana el más avanzado; `apagado`
 * manda sobre todo):
 *   apagado → ligado-produccion (≥1 orden) → en-lista (≥1 renglón de lista) →
 *   cotizado (≥1 precosto congelado) → en-desarrollo (default).
 * Reusable: recibe el desarrollo con sus relaciones (ver `incluirEstadoDesarrollo`).
 */
export function calcularEstadoDesarrollo(desarrollo: DesarrolloParaEstado): EstadoDesarrolloClave {
  if (desarrollo.apagado) {
    return 'apagado';
  }
  if (desarrollo.ordenLigadas.length > 0) {
    return 'ligado-produccion';
  }
  if (desarrollo.listaLineas.length > 0) {
    return 'en-lista';
  }
  if (desarrollo.precostos.some((p) => p.estado === 'congelado')) {
    return 'cotizado';
  }
  return 'en-desarrollo';
}

// ── Include + proyección ───────────────────────────────────────────────────────────

/**
 * `include` del CLIENTE + DEPARTAMENTO del desarrollo, leídos de su PROYECTO (su dueño natural: el
 * desarrollo NO guarda cliente propio). Se exporta para que cualquier lectura que proyecte con
 * {@link aDesarrolloSalida} (p. ej. el detalle del proyecto) traiga los mismos campos.
 */
export const incluirClienteDeProyecto = {
  proyecto: {
    select: {
      idCliente: true,
      idClienteDepartamento: true,
      cliente: { select: { nombre: true } },
      clienteDepartamento: { select: { nombre: true } },
    },
  },
} satisfies Prisma.DesarrolloInclude;

/** `include` para traer un desarrollo con su modelo, su cliente y las relaciones del estado derivado. */
const incluirDesarrollo = {
  modelo: { select: { codigo: true, descripcion: true } },
  ...incluirClienteDeProyecto,
  ...incluirEstadoDesarrollo,
} satisfies Prisma.DesarrolloInclude;

/** Desarrollo con su modelo + relaciones del estado (forma que arma el dominio antes de proyectar). */
export type DesarrolloConDetalle = Prisma.DesarrolloGetPayload<{
  include: typeof incluirDesarrollo;
}>;

/** Proyecta un desarrollo (con detalle) a la forma JSON del contrato, calculando su estado derivado. */
export function aDesarrolloSalida(desarrollo: DesarrolloConDetalle): DesarrolloSalida {
  return {
    id: desarrollo.id,
    idProyecto: desarrollo.idProyecto,
    // Cliente/departamento HEREDADOS del proyecto (no se duplican en la tabla `Desarrollo`).
    idCliente: desarrollo.proyecto.idCliente,
    cliente: desarrollo.proyecto.cliente.nombre,
    idClienteDepartamento: desarrollo.proyecto.idClienteDepartamento,
    departamento: desarrollo.proyecto.clienteDepartamento.nombre,
    idModelo: desarrollo.idModelo,
    codigoModelo: desarrollo.modelo.codigo,
    descripcionModelo: desarrollo.modelo.descripcion,
    numeroCliente: desarrollo.numeroCliente,
    notas: desarrollo.notas,
    estado: calcularEstadoDesarrollo(desarrollo),
    apagado: desarrollo.apagado,
    apagadoEn: desarrollo.apagadoEn === null ? null : desarrollo.apagadoEn.toISOString(),
    apagadoPorId: desarrollo.apagadoPorId,
    motivoApagado: desarrollo.motivoApagado,
    creadoEn: desarrollo.creadoEn.toISOString(),
    creadoPorId: desarrollo.creadoPorId,
    modificadoEn: desarrollo.modificadoEn.toISOString(),
    modificadoPorId: desarrollo.modificadoPorId,
  };
}

// ── Helpers de existencia/validación ───────────────────────────────────────────────

/**
 * Busca un desarrollo cuyo proyecto sea de la EMPRESA ACTIVA (A9), con su modelo + relaciones del
 * estado. Un desarrollo de otra empresa, para esta sesión, no existe.
 */
async function exigirDesarrollo(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<DesarrolloConDetalle> {
  const desarrollo = await tx.desarrollo.findFirst({
    where: { id, proyecto: { idEmpresa } },
    include: incluirDesarrollo,
  });
  if (desarrollo === null) {
    throw new ErrorNoEncontrado('Desarrollo', id);
  }
  return desarrollo;
}

/** Exige que el proyecto exista, sea de la empresa activa y NO esté archivado (no se le agregan desarrollos). */
async function exigirProyectoActivo(tx: Tx, idProyecto: number, idEmpresa: number): Promise<void> {
  const proyecto = await tx.proyecto.findFirst({
    where: { id: idProyecto, idEmpresa },
    select: { archivado: true, folio: true },
  });
  if (proyecto === null) {
    throw new ErrorNoEncontrado('Proyecto', idProyecto);
  }
  if (proyecto.archivado) {
    throw new ErrorConflicto(
      `El proyecto ${Number(proyecto.folio)} está archivado; desarchívalo para agregarle desarrollos.`,
    );
  }
}

/** Exige que el modelo exista y esté ACTIVO (no se desarrolla un modelo descontinuado). */
async function exigirModeloActivo(tx: Tx, idModelo: number): Promise<void> {
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: { activo: true, codigo: true },
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  if (!modelo.activo) {
    throw new ErrorConflicto(
      `El modelo "${modelo.codigo}" está descontinuado; no se puede desarrollar.`,
    );
  }
}

// ── Operaciones ─────────────────────────────────────────────────────────────────────

/**
 * Crea un desarrollo en un proyecto (D13/R16) en UNA transacción (A2). Requiere
 * `desarrollo.administrar`. Valida que el proyecto exista/no archivado (empresa activa, A9) y que el
 * modelo exista/esté activo. Un modelo no se repite dentro de un proyecto (unique proyecto+modelo →
 * `ErrorConflicto`). Auditoría + bitácora en la tx. El flujo "modelo nuevo" lo orquesta el frontend.
 */
export async function crearDesarrollo(
  sesion: SesionUsuario,
  idProyecto: number,
  entrada: EntradaCrearDesarrollo,
  bd?: ContextoBd,
): Promise<DesarrolloSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const datos = validarEntrada(esquemaDesarrolloCrear, entrada);

  const idNuevo = await enTransaccion(async (tx) => {
    await exigirProyectoActivo(tx, idProyecto, sesion.idEmpresaActiva);
    await exigirModeloActivo(tx, datos.idModelo);

    let desarrolloId: number;
    try {
      const creado = await tx.desarrollo.create({
        data: {
          idProyecto,
          idModelo: datos.idModelo,
          ...(datos.numeroCliente === undefined ? {} : { numeroCliente: datos.numeroCliente }),
          ...(datos.notas === undefined ? {} : { notas: datos.notas }),
          ...datosCreacion(sesion),
        },
        select: { id: true },
      });
      desarrolloId = creado.id;
    } catch (error) {
      if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
        throw new ErrorConflicto('Este proyecto ya tiene un desarrollo para ese modelo.', {
          causa: error,
        });
      }
      throw error;
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Desarrollo',
      idEntidad: desarrolloId,
      accion: 'CREAR',
      datos: { idProyecto, idModelo: datos.idModelo },
    });

    return desarrolloId;
  }, bd);

  return obtenerDesarrollo(sesion, idNuevo, bd);
}

/**
 * Actualiza un desarrollo: sólo `numeroCliente` y `notas` (el modelo/proyecto/estado no se editan).
 * PATCH parcial (M1). UNA transacción (A2) con auditoría + bitácora. Requiere `desarrollo.administrar`.
 */
export async function actualizarDesarrollo(
  sesion: SesionUsuario,
  id: number,
  entrada: EntradaActualizarDesarrollo,
  bd?: ContextoBd,
): Promise<DesarrolloSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const datos = validarEntrada(esquemaDesarrolloEditar, entrada);

  await enTransaccion(async (tx) => {
    const actual = await exigirDesarrollo(tx, id, sesion.idEmpresaActiva);

    const cambiaNumero =
      datos.numeroCliente !== undefined && datos.numeroCliente !== actual.numeroCliente;
    const cambiaNotas = datos.notas !== undefined && datos.notas !== actual.notas;
    if (!cambiaNumero && !cambiaNotas) {
      return; // idempotente: nada que guardar, sin bitácora vacía
    }

    const cambios: Prisma.DesarrolloUpdateInput = { ...datosModificacion(sesion) };
    if (cambiaNumero && datos.numeroCliente !== undefined) {
      cambios.numeroCliente = datos.numeroCliente;
    }
    if (cambiaNotas && datos.notas !== undefined) {
      cambios.notas = datos.notas;
    }
    await tx.desarrollo.update({ where: { id }, data: cambios });

    await registrarBitacora(tx, sesion, {
      entidad: 'Desarrollo',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: {
        ...(cambiaNumero ? { numeroCliente: datos.numeroCliente } : {}),
        ...(cambiaNotas ? { notas: datos.notas === null ? null : 'actualizadas' } : {}),
      },
    });
  }, bd);

  return obtenerDesarrollo(sesion, id, bd);
}

/**
 * Apaga un desarrollo (borrado SUAVE con motivo obligatorio, reversible; NUNCA se borra). Pone
 * `apagado=true`, `apagadoEn=now`, `apagadoPorId`, `motivoApagado` + bitácora. Apagar dos veces es
 * `ErrorConflicto`. Requiere `desarrollo.administrar`.
 */
export async function apagarDesarrollo(
  sesion: SesionUsuario,
  id: number,
  entrada: { motivo: string },
  bd?: ContextoBd,
): Promise<DesarrolloSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const { motivo } = validarEntrada(esquemaMotivoApagar, entrada);

  await enTransaccion(async (tx) => {
    const actual = await exigirDesarrollo(tx, id, sesion.idEmpresaActiva);
    if (actual.apagado) {
      throw new ErrorConflicto(`El desarrollo "${actual.modelo.codigo}" ya está apagado.`);
    }
    await tx.desarrollo.update({
      where: { id },
      data: {
        apagado: true,
        apagadoEn: new Date(),
        apagadoPorId: sesion.id,
        motivoApagado: motivo,
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Desarrollo',
      idEntidad: id,
      accion: 'DESACTIVAR',
      datos: { codigoModelo: actual.modelo.codigo, motivo },
    });
  }, bd);

  return obtenerDesarrollo(sesion, id, bd);
}

/**
 * Reactiva un desarrollo apagado (operación inversa del borrado suave): `apagado=false` y limpia
 * `apagadoEn`/`apagadoPorId`/`motivoApagado` + bitácora. Reactivar uno activo es `ErrorConflicto`.
 * Requiere `desarrollo.administrar`.
 */
export async function reactivarDesarrollo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DesarrolloSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');

  await enTransaccion(async (tx) => {
    const actual = await exigirDesarrollo(tx, id, sesion.idEmpresaActiva);
    if (!actual.apagado) {
      throw new ErrorConflicto(`El desarrollo "${actual.modelo.codigo}" ya está activo.`);
    }
    await tx.desarrollo.update({
      where: { id },
      data: {
        apagado: false,
        apagadoEn: null,
        apagadoPorId: null,
        motivoApagado: null,
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Desarrollo',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { codigoModelo: actual.modelo.codigo, operacion: 'reactivar' },
    });
  }, bd);

  return obtenerDesarrollo(sesion, id, bd);
}

/** Obtiene un desarrollo (con su modelo + estado derivado) de la empresa activa, o lanza `ErrorNoEncontrado`. */
export async function obtenerDesarrollo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<DesarrolloSalida> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const desarrollo = await clienteLectura(bd).desarrollo.findFirst({
    where: { id, proyecto: { idEmpresa: sesion.idEmpresaActiva } },
    include: incluirDesarrollo,
  });
  if (desarrollo === null) {
    throw new ErrorNoEncontrado('Desarrollo', id);
  }
  return aDesarrolloSalida(desarrollo);
}
