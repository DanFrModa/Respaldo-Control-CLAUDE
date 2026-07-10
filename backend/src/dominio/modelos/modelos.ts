/**
 * Modelos — Módulo 2 (F1-E4): el catálogo de productos. CRUD del `Modelo` (ex tabla
 * `Modelos`, doc `Documentacion_MJD/01-Modelos.md` §2) y el selector de `Genero`.
 *
 * La RECETA/BOM (telas/avíos/bordados) y las FOTOS viven en archivos hermanos
 * (`bom-modelo.ts`, `fotos-modelo.ts`) para no inflar éste: el `Modelo` se da de alta primero
 * y luego se le agregan el BOM y las fotos (igual que la foto del bordado en E3). Catálogo
 * GLOBAL (ADR-0007, A9): la unicidad de `codigo` es global.
 *
 * Piezas del patrón conservadas (PLANMAESTRO §9.2): permiso primero (`modelos.ver`/
 * `.administrar`); Zod compartido de `src/contrato`; todo cambio en UNA transacción (A2) con
 * auditoría (A7) + `Bitacora` juntos o nada; borrado SUAVE reversible (`activo` =
 * descontinuar); unicidad de `codigo` validada en la transacción y respaldada por el unique de
 * la base (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en SERVIDOR (volumen
 * ~4,987 modelos: la tabla nunca trae todo para filtrar en memoria — cubre la consulta
 * `TodosModelos` del viejo, doc 01-Modelos §3).
 */
import {
  esquemaModeloCrear,
  esquemaModeloEditar,
  type DatosModeloCrear,
  type DatosModeloEditar,
} from '../../contrato/esquemas/modelo.js';
import { Prisma, type Genero, type Modelo } from '../../datos/index.js';
import { z } from 'zod';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
} from '../../comun/paginacion.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { cantidadDeBase, cantidadesDeOrdenes } from '../costos/cantidades.js';
import { redondear2 } from '../costos/decimales.js';

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearModelo = z.input<typeof esquemaModeloCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para descontinuar/reactivar). */
export type EntradaActualizarModelo = z.input<typeof esquemaModeloEditar>;

/** Modelo con su temporada/curva/género/tipo de producto y el conteo de fotos (forma del listado). */
export type ModeloConRelaciones = Modelo & {
  temporada: { nombre: string } | null;
  curvaTalla: { nombre: string } | null;
  genero: { nombre: string } | null;
  tipoProducto: { nombre: string } | null;
  /** Maquilero (costura) cotizado en el desarrollo (R5/B9), o null. */
  maquileroCotizado: { nombre: string } | null;
  _count: { fotos: number };
  /**
   * URL prefirmada de la foto principal (la primera por orden, luego id), o `null` si no tiene
   * fotos. La resuelve el LISTADO en una sola consulta (sin N+1) para la galería; en las demás
   * salidas (alta/edición/ficha) viene `null` (no aplica) y la proyección la serializa como tal.
   */
  urlFotoPrincipal?: string | null;
  /**
   * Tela PRINCIPAL = nombre de la tela del PRIMER renglón del BOM (mismo orden que la ficha: por
   * nombre de tela). Solo el LISTADO la resuelve (columna del proto `vModelos`, sin N+1); en las
   * demás salidas viene `null` (mismo criterio que `urlFotoPrincipal`).
   */
  telaPrincipal?: string | null;
  /**
   * Existencia total de PT del modelo en la empresa activa (Σ de movimientos vía la vista
   * `existencia_pt`, D3 — la vista es solo CONSULTA, ADR-0010 §3). Solo el LISTADO la resuelve.
   */
  stockPt?: number | null;
  /**
   * Costo UNITARIO del último costeo (F7) del modelo (criterio de la Lista de costos:
   * `costoTotal / cantidadDeBase`). Solo el LISTADO, y solo con `consultas.ver-importes`.
   */
  costoActual?: number | null;
};

/** `include` estándar para traer nombres de relaciones + conteo de fotos. */
export const incluirRelacionesModelo = {
  temporada: { select: { nombre: true } },
  curvaTalla: { select: { nombre: true } },
  genero: { select: { nombre: true } },
  tipoProducto: { select: { nombre: true } },
  maquileroCotizado: { select: { nombre: true } },
  _count: { select: { fotos: true } },
} satisfies Prisma.ModeloInclude;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada; tipos nativos). */
const esquemaListarModelosDominio = esquemaPaginacion.extend({
  /** Texto a buscar en el código o la descripción (insensible a mayúsculas). */
  busqueda: z.string().trim().max(200).optional(),
  /** Filtra por temporada. */
  idTemporada: z.number().int().positive().optional(),
  /** Por omisión solo activos; `true` muestra también los descontinuados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['codigo', 'descripcion', 'creadoEn']).default('codigo'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export type ParametrosListarModelos = z.input<typeof esquemaListarModelosDominio>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos modelos con el mismo `codigo`,
 * sin importar mayúsculas. Se valida DENTRO de la transacción; la carrera residual la captura
 * el unique de la base (P2002 → `ErrorConflicto`). El mensaje distingue si el existente está
 * activo o descontinuado (invita a reactivar).
 */
async function exigirCodigoLibre(tx: Tx, codigo: string, idActual?: number): Promise<void> {
  const existente = await tx.modelo.findFirst({
    where: {
      codigo: { equals: codigo, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un modelo con el código "${codigo}".`
        : `Ya existe un modelo con el código "${codigo}" (está descontinuado; puedes reactivarlo).`,
    );
  }
}

/** Busca un modelo por id o lanza `ErrorNoEncontrado`. */
export async function exigirModelo(tx: Tx, id: number): Promise<Modelo> {
  const modelo = await tx.modelo.findUnique({ where: { id } });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', id);
  }
  return modelo;
}

/** Valida que una temporada (si viene) exista y esté ACTIVA. Lanza `ErrorValidacion` si no. */
async function exigirTemporadaValida(tx: Tx, idTemporada: number): Promise<void> {
  const temporada = await tx.temporada.findUnique({
    where: { id: idTemporada },
    select: { nombre: true, activo: true },
  });
  if (temporada === null) {
    throw new ErrorValidacion('La temporada seleccionada no existe.');
  }
  if (!temporada.activo) {
    throw new ErrorValidacion(
      `La temporada "${temporada.nombre}" está desactivada y no se puede asignar.`,
    );
  }
}

/** Valida que una curva de tallas (si viene) exista y esté ACTIVA. */
async function exigirCurvaValida(tx: Tx, idCurva: number): Promise<void> {
  const curva = await tx.curvaTalla.findUnique({
    where: { id: idCurva },
    select: { nombre: true, activo: true },
  });
  if (curva === null) {
    throw new ErrorValidacion('La curva de tallas seleccionada no existe.');
  }
  if (!curva.activo) {
    throw new ErrorValidacion(
      `La curva de tallas "${curva.nombre}" está desactivada y no se puede asignar.`,
    );
  }
}

/** Valida que un género (si viene) exista y esté ACTIVO. */
async function exigirGeneroValido(tx: Tx, idGenero: number): Promise<void> {
  const genero = await tx.genero.findUnique({
    where: { id: idGenero },
    select: { nombre: true, activo: true },
  });
  if (genero === null) {
    throw new ErrorValidacion('El género seleccionado no existe.');
  }
  if (!genero.activo) {
    throw new ErrorValidacion(
      `El género "${genero.nombre}" está desactivado y no se puede asignar.`,
    );
  }
}

/** Valida que un tipo de producto (si viene) exista y esté ACTIVO (F6-E1). */
async function exigirTipoProductoValido(tx: Tx, idTipoProducto: number): Promise<void> {
  const tipo = await tx.tipoProducto.findUnique({
    where: { id: idTipoProducto },
    select: { nombre: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion('El tipo de producto seleccionado no existe.');
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(
      `El tipo de producto "${tipo.nombre}" está desactivado y no se puede asignar.`,
    );
  }
}

/** Construye el `data` de los campos opcionales presentes en el alta (solo los definidos). */
function datosOpcionalesCrear(datos: DatosModeloCrear): Partial<Prisma.ModeloUncheckedCreateInput> {
  const data: Partial<Prisma.ModeloUncheckedCreateInput> = {};
  if (datos.descripcion !== undefined) data.descripcion = datos.descripcion;
  if (datos.maquilaBase !== undefined) data.maquilaBase = datos.maquilaBase;
  if (datos.idTemporada !== undefined) data.idTemporada = datos.idTemporada;
  if (datos.idCurvaTalla !== undefined) data.idCurvaTalla = datos.idCurvaTalla;
  if (datos.idGenero !== undefined) data.idGenero = datos.idGenero;
  if (datos.idTipoProducto !== undefined) data.idTipoProducto = datos.idTipoProducto;
  // R5, B7/B8/B9/B10: campos del editor de desarrollo.
  if (datos.numOperaciones !== undefined) data.numOperaciones = datos.numOperaciones;
  if (datos.corteBase !== undefined) data.corteBase = datos.corteBase;
  if (datos.idMaquileroCotizado !== undefined) data.idMaquileroCotizado = datos.idMaquileroCotizado;
  if (datos.secuenciaEstampado !== undefined) data.secuenciaEstampado = datos.secuenciaEstampado;
  return data;
}

/**
 * Código estable del rol de proveedor "Maquila (costura)" (seed `ROLES_PROVEEDOR_BASE`). El maquilero
 * cotizado es, por definición, de costura → se valida contra ESTE rol (no cualquier proveedor).
 */
const ROL_MAQUILA_COSTURA = 'maquila-costura';

/**
 * Valida que un maquilero cotizado (Proveedor, si viene) exista, esté ACTIVO y tenga el rol
 * "Maquila (costura)" (R5/B9). El front ya filtra por ese rol, pero vía API cualquiera podría fijar
 * un proveedor arbitrario → la autoridad es el servidor (A1).
 */
async function exigirMaquileroValido(tx: Tx, idProveedor: number): Promise<void> {
  const proveedor = await tx.proveedor.findUnique({
    where: { id: idProveedor },
    select: {
      nombre: true,
      activo: true,
      roles: { where: { rol: { codigo: ROL_MAQUILA_COSTURA } }, select: { idProveedor: true } },
    },
  });
  if (proveedor === null) {
    throw new ErrorValidacion('El maquilero cotizado seleccionado no existe.');
  }
  if (!proveedor.activo) {
    throw new ErrorValidacion(
      `El maquilero "${proveedor.nombre}" está desactivado y no se puede asignar.`,
    );
  }
  if (proveedor.roles.length === 0) {
    throw new ErrorValidacion(
      `El proveedor "${proveedor.nombre}" no es maquilero de costura; el maquilero cotizado debe tener el rol "Maquila (costura)".`,
    );
  }
}

/**
 * Compara un decimal capturado (number | null | undefined) con el guardado (Decimal | null).
 * `undefined` = no se tocó. Distingue `null` (vaciar) de un número nuevo. Mismo helper que
 * Tela/Bordado en E3.
 */
function cambiaDecimal(entrada: number | null | undefined, actual: Prisma.Decimal | null): boolean {
  if (entrada === undefined) {
    return false;
  }
  const actualNum = actual === null ? null : actual.toNumber();
  return actualNum !== entrada;
}

/**
 * Aplica los campos opcionales que VENGAN en la edición al `update` y registra qué cambió
 * (para la bitácora). Semántica del PATCH parcial (M1): texto omitido = no tocar; `null`/'' =
 * borrar; número/FK omitido = no tocar; `null` en una FK la quita. Devuelve el detalle de
 * cambios. Mismo patrón que `aplicarOpcionalesEditar` de la tela.
 */
function aplicarOpcionalesEditar(
  datos: DatosModeloEditar,
  actual: Modelo,
  cambios: Prisma.ModeloUncheckedUpdateInput,
): Record<string, unknown> {
  const detalle: Record<string, unknown> = {};

  // descripcion (texto): omitir = no tocar; vacío/`null` = borrar (a null, nunca '').
  if (datos.descripcion !== undefined) {
    const nuevo = datos.descripcion === null || datos.descripcion === '' ? null : datos.descripcion;
    if (nuevo !== actual.descripcion) {
      cambios.descripcion = nuevo;
      detalle.descripcion = { de: actual.descripcion, a: nuevo };
    }
  }

  // maquilaBase (decimal nullable): omitir = no tocar; `null` = quitar; número = fijar.
  if (cambiaDecimal(datos.maquilaBase, actual.maquilaBase)) {
    const nuevo = datos.maquilaBase ?? null;
    cambios.maquilaBase = nuevo;
    detalle.maquilaBase = {
      de: actual.maquilaBase === null ? null : actual.maquilaBase.toNumber(),
      a: nuevo,
    };
  }

  // FKs (idTemporada/idCurvaTalla/idGenero): `null` quita; un id fija; omitir = no tocar.
  if (datos.idTemporada !== undefined && datos.idTemporada !== actual.idTemporada) {
    cambios.idTemporada = datos.idTemporada;
    detalle.idTemporada = { de: actual.idTemporada, a: datos.idTemporada };
  }
  if (datos.idCurvaTalla !== undefined && datos.idCurvaTalla !== actual.idCurvaTalla) {
    cambios.idCurvaTalla = datos.idCurvaTalla;
    detalle.idCurvaTalla = { de: actual.idCurvaTalla, a: datos.idCurvaTalla };
  }
  if (datos.idGenero !== undefined && datos.idGenero !== actual.idGenero) {
    cambios.idGenero = datos.idGenero;
    detalle.idGenero = { de: actual.idGenero, a: datos.idGenero };
  }
  if (datos.idTipoProducto !== undefined && datos.idTipoProducto !== actual.idTipoProducto) {
    cambios.idTipoProducto = datos.idTipoProducto;
    detalle.idTipoProducto = { de: actual.idTipoProducto, a: datos.idTipoProducto };
  }

  // R5, B7: # de operaciones (int nullable): omitir = no tocar; `null` = quitar; número = fijar.
  if (datos.numOperaciones !== undefined && datos.numOperaciones !== actual.numOperaciones) {
    cambios.numOperaciones = datos.numOperaciones;
    detalle.numOperaciones = { de: actual.numOperaciones, a: datos.numOperaciones };
  }
  // R5, B8: corte (decimal nullable): omitir = no tocar; `null` = quitar; número = fijar.
  if (cambiaDecimal(datos.corteBase, actual.corteBase)) {
    const nuevo = datos.corteBase ?? null;
    cambios.corteBase = nuevo;
    detalle.corteBase = {
      de: actual.corteBase === null ? null : actual.corteBase.toNumber(),
      a: nuevo,
    };
  }
  // R5, B9: maquilero cotizado (FK nullable): `null` lo quita; un id lo fija; omitir = no tocar.
  if (
    datos.idMaquileroCotizado !== undefined &&
    datos.idMaquileroCotizado !== actual.idMaquileroCotizado
  ) {
    cambios.idMaquileroCotizado = datos.idMaquileroCotizado;
    detalle.idMaquileroCotizado = {
      de: actual.idMaquileroCotizado,
      a: datos.idMaquileroCotizado,
    };
  }
  // R5, B10: secuencia de estampado (enum, no nullable): omitir = no tocar.
  if (
    datos.secuenciaEstampado !== undefined &&
    datos.secuenciaEstampado !== actual.secuenciaEstampado
  ) {
    cambios.secuenciaEstampado = datos.secuenciaEstampado;
    detalle.secuenciaEstampado = { de: actual.secuenciaEstampado, a: datos.secuenciaEstampado };
  }

  return detalle;
}

/**
 * Crea un modelo (catálogo global) en UNA transacción (A2). Reglas: permiso
 * `modelos.administrar`; `codigo` único global → `ErrorConflicto`; temporada/curva/género
 * (si vienen) existentes y ACTIVAS; nace activo y SIN BOM ni fotos (se capturan aparte);
 * auditoría y bitácora en la misma transacción (A7).
 *
 * @example
 * const m = await crearModelo(sesion, {
 *   codigo: "501", descripcion: "Sudadera", maquilaBase: 35, idTemporada: 2,
 * });
 */
export async function crearModelo(
  sesion: SesionUsuario,
  entrada: EntradaCrearModelo,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirCodigoLibre(tx, datos.codigo);
      if (datos.idTemporada !== undefined) await exigirTemporadaValida(tx, datos.idTemporada);
      if (datos.idCurvaTalla !== undefined) await exigirCurvaValida(tx, datos.idCurvaTalla);
      if (datos.idGenero !== undefined) await exigirGeneroValido(tx, datos.idGenero);
      if (datos.idTipoProducto !== undefined)
        await exigirTipoProductoValido(tx, datos.idTipoProducto);
      if (datos.idMaquileroCotizado !== undefined)
        await exigirMaquileroValido(tx, datos.idMaquileroCotizado);

      const modelo = await tx.modelo.create({
        data: {
          codigo: datos.codigo,
          ...datosOpcionalesCrear(datos),
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: modelo.id,
        accion: 'CREAR',
        datos: { codigo: modelo.codigo, idTemporada: modelo.idTemporada },
      });

      return tx.modelo.findUniqueOrThrow({
        where: { id: modelo.id },
        include: incluirRelacionesModelo,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un modelo con el código "${datos.codigo}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un modelo: datos generales y/o `activo` para descontinuar (borrado suave) o
 * reactivar. Todo en UNA transacción (A2). El BOM NO se toca aquí (tiene sus propios
 * endpoints). Bitácora según lo que pasó: `MODIFICAR` con el detalle, y/o `DESACTIVAR` si se
 * descontinuó.
 */
export async function actualizarModelo(
  sesion: SesionUsuario,
  entrada: EntradaActualizarModelo,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirModelo(tx, datos.id);

      const cambiaCodigo = datos.codigo !== undefined && datos.codigo !== actual.codigo;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      const cambios: Prisma.ModeloUncheckedUpdateInput = { ...datosModificacion(sesion) };
      const detalleOpcionales = aplicarOpcionalesEditar(datos, actual, cambios);
      if (cambiaCodigo && datos.codigo !== undefined) {
        cambios.codigo = datos.codigo;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      if (cambiaCodigo) {
        await exigirCodigoLibre(tx, datos.codigo ?? actual.codigo, datos.id);
      } else if (reactiva) {
        await exigirCodigoLibre(tx, actual.codigo, datos.id);
      }

      // Si se asignan FKs nuevas (no null), validarlas (existen y activas).
      if (
        datos.idTemporada !== undefined &&
        datos.idTemporada !== null &&
        datos.idTemporada !== actual.idTemporada
      ) {
        await exigirTemporadaValida(tx, datos.idTemporada);
      }
      if (
        datos.idCurvaTalla !== undefined &&
        datos.idCurvaTalla !== null &&
        datos.idCurvaTalla !== actual.idCurvaTalla
      ) {
        await exigirCurvaValida(tx, datos.idCurvaTalla);
      }
      if (
        datos.idGenero !== undefined &&
        datos.idGenero !== null &&
        datos.idGenero !== actual.idGenero
      ) {
        await exigirGeneroValido(tx, datos.idGenero);
      }
      if (
        datos.idTipoProducto !== undefined &&
        datos.idTipoProducto !== null &&
        datos.idTipoProducto !== actual.idTipoProducto
      ) {
        await exigirTipoProductoValido(tx, datos.idTipoProducto);
      }
      if (
        datos.idMaquileroCotizado !== undefined &&
        datos.idMaquileroCotizado !== null &&
        datos.idMaquileroCotizado !== actual.idMaquileroCotizado
      ) {
        await exigirMaquileroValido(tx, datos.idMaquileroCotizado);
      }

      const huboCambio =
        cambiaCodigo || Object.keys(detalleOpcionales).length > 0 || reactiva || desactiva;

      if (!huboCambio) {
        return tx.modelo.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirRelacionesModelo,
        });
      }

      await tx.modelo.update({ where: { id: datos.id }, data: cambios });

      if (cambiaCodigo || Object.keys(detalleOpcionales).length > 0 || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Modelo',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaCodigo ? { codigo: { de: actual.codigo, a: datos.codigo } } : {}),
            ...detalleOpcionales,
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Modelo',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { codigo: actual.codigo },
        });
      }

      return tx.modelo.findUniqueOrThrow({
        where: { id: datos.id },
        include: incluirRelacionesModelo,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un modelo con ese código.', { causa: error });
    }
    throw error;
  }
}

/**
 * Descontinúa (borrado SUAVE) un modelo: deja de aparecer en capturas pero su historial, BOM
 * y fotos quedan intactos. Descontinuar dos veces es `ErrorConflicto`. Atajo del botón
 * "Descontinuar".
 */
export async function descontinuarModelo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirModelo(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El modelo "${actual.codigo}" ya está descontinuado.`);
    }
    return actualizarModelo(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un modelo descontinuado (operación inversa del borrado suave). */
export async function reactivarModelo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirModelo(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El modelo "${actual.codigo}" ya está activo.`);
    }
    return actualizarModelo(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un modelo por id (datos generales + relaciones + conteo de fotos), o lanza `ErrorNoEncontrado`. */
export async function obtenerModelo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.ver');
  const modelo = await clienteLectura(bd).modelo.findUnique({
    where: { id },
    include: incluirRelacionesModelo,
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', id);
  }
  return modelo;
}

/**
 * Lista modelos con búsqueda, orden y paginación EN SERVIDOR (volumen ~4,987: la tabla de la
 * UI nunca trae todo para filtrar en memoria — cubre `TodosModelos` del viejo). Por defecto:
 * solo activos. La búsqueda cubre `codigo` O `descripcion`; filtro opcional `idTemporada`.
 *
 * @example
 * const pagina = await listarModelos(sesion, { idTemporada: 2, busqueda: "sudadera" });
 */
export async function listarModelos(
  sesion: SesionUsuario,
  parametros: ParametrosListarModelos = {},
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<Pagina<ModeloConRelaciones>> {
  verificarPermiso(sesion, 'modelos.ver');
  const filtros = validarEntrada(esquemaListarModelosDominio, parametros);

  const where: Prisma.ModeloWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.idTemporada === undefined ? {} : { idTemporada: filtros.idTemporada }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { codigo: { contains: filtros.busqueda, mode: 'insensitive' } },
            { descripcion: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.modelo.count({ where }),
    cliente.modelo.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirRelacionesModelo,
      ...rangoPrisma(filtros),
    }),
  ]);

  const conFoto = await adjuntarFotoPrincipal(cliente, datos, archivos);
  const conAgregados = await adjuntarAgregadosListado(cliente, sesion, conFoto, bd);
  return armarPagina(conAgregados, total, filtros);
}

/**
 * Resuelve la FOTO PRINCIPAL de cada modelo de la página en UNA sola consulta (sin N+1) y
 * adjunta su URL de descarga prefirmada (`urlFotoPrincipal`), para que la galería pinte la
 * miniatura sin pedir una foto por celda. La "principal" es la primera por `orden` (luego `id`)
 * — la misma que encabeza el carrusel del modelo. Modelos sin fotos quedan con `null`.
 *
 * Detalle de la consulta única: se traen TODAS las fotos de los modelos de la página de un
 * golpe (`idModelo in [...]`), ordenadas; al recorrerlas, la PRIMERA de cada modelo es su
 * principal (el resto se ignora). Las URLs prefirmadas se generan en paralelo.
 */
async function adjuntarFotoPrincipal(
  cliente: ReturnType<typeof clienteLectura>,
  modelos: ModeloConRelaciones[],
  archivos: ServicioArchivos,
): Promise<ModeloConRelaciones[]> {
  const conFotos = modelos.filter((m) => m._count.fotos > 0).map((m) => m.id);
  if (conFotos.length === 0) {
    return modelos.map((m) => ({ ...m, urlFotoPrincipal: null }));
  }

  const fotos = await cliente.modeloFoto.findMany({
    where: { idModelo: { in: conFotos } },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    select: { idModelo: true, archivo: { select: { key: true } } },
  });

  // La primera foto de cada modelo (por el orden de la consulta) es su principal.
  const keyPrincipalPorModelo = new Map<number, string>();
  for (const foto of fotos) {
    if (!keyPrincipalPorModelo.has(foto.idModelo)) {
      keyPrincipalPorModelo.set(foto.idModelo, foto.archivo.key);
    }
  }

  // Genera las URLs prefirmadas (una por modelo CON foto) en paralelo.
  const urlPorModelo = new Map<number, string>(
    await Promise.all(
      [...keyPrincipalPorModelo.entries()].map(
        async ([idModelo, key]): Promise<[number, string]> => [
          idModelo,
          await archivos.urlDescarga(key),
        ],
      ),
    ),
  );

  return modelos.map((m) => ({ ...m, urlFotoPrincipal: urlPorModelo.get(m.id) ?? null }));
}

/**
 * Adjunta a cada modelo de la PÁGINA los agregados del listado del proto `vModelos` (rediseño R9),
 * en consultas ACOTADAS a la página (sin N+1 — mismo criterio que `adjuntarFotoPrincipal`):
 *
 *  • `telaPrincipal` — el PRIMER renglón del BOM de telas por nombre de tela (el MISMO orden con
 *    que la ficha lista el BOM, así la columna coincide con lo que el cajón muestra); una sola
 *    consulta por página, la primera tela de cada modelo gana.
 *  • `stockPt` — Σ de la existencia PT del modelo en la EMPRESA ACTIVA (A9), leyendo la vista
 *    `existencia_pt` agrupada por modelo (la vista es solo CONSULTA — ADR-0010 §3; la existencia
 *    es SIEMPRE Σ de movimientos, D3). Modelos sin movimientos quedan en 0.
 *  • `costoActual` — costo UNITARIO del ÚLTIMO costeo (F7) de una orden del modelo en la empresa
 *    activa: el `CostoOrden` con `costoTotal` guardado más recientemente MODIFICADO (DISTINCT ON
 *    por modelo), dividido entre su base de prorrateo (`cantidadDeBase`, D2) — EXACTAMENTE el
 *    criterio de la Lista de costos (`listarCostos`). `null` si nunca se costeó o la base es 0.
 *    Mismo candado de importes que Costos: sin `consultas.ver-importes` viene `null` (ni se
 *    consulta).
 */
async function adjuntarAgregadosListado(
  cliente: ReturnType<typeof clienteLectura>,
  sesion: SesionUsuario,
  modelos: ModeloConRelaciones[],
  bd?: ContextoBd,
): Promise<ModeloConRelaciones[]> {
  const ids = modelos.map((m) => m.id);
  if (ids.length === 0) {
    return modelos;
  }
  const idEmpresa = sesion.idEmpresaActiva;

  // Tela principal: todas las telas del BOM de los modelos de la página, en el orden de la ficha
  // (nombre asc); al recorrer, la PRIMERA de cada modelo es su principal (igual que la foto).
  const telas = await cliente.modeloTela.findMany({
    where: { idModelo: { in: ids } },
    select: { idModelo: true, tela: { select: { nombre: true } } },
    orderBy: [{ tela: { nombre: 'asc' } }, { idTela: 'asc' }],
  });
  const telaPorModelo = new Map<number, string>();
  for (const t of telas) {
    if (!telaPorModelo.has(t.idModelo)) {
      telaPorModelo.set(t.idModelo, t.tela.nombre);
    }
  }

  // Stock PT: la vista `existencia_pt` agrupada por modelo (una consulta por página, A9).
  const stock = await cliente.$queryRaw<{ idModelo: number; existencia: bigint }[]>(Prisma.sql`
    SELECT e."id_modelo" AS "idModelo", COALESCE(SUM(e."existencia"), 0)::bigint AS "existencia"
    FROM "existencia_pt" e
    WHERE e."id_empresa" = ${idEmpresa} AND e."id_modelo" IN (${Prisma.join(ids)})
    GROUP BY e."id_modelo"
  `);
  const stockPorModelo = new Map(stock.map((f) => [f.idModelo, Number(f.existencia)]));

  // Costo actual: solo con el permiso de importes (mismo candado que la Lista de costos).
  const costoPorModelo = tienePermiso(sesion, 'consultas.ver-importes')
    ? await costoUnitarioUltimoCosteo(cliente, idEmpresa, ids, bd)
    : new Map<number, number>();

  return modelos.map((m) => ({
    ...m,
    telaPrincipal: telaPorModelo.get(m.id) ?? null,
    stockPt: stockPorModelo.get(m.id) ?? 0,
    costoActual: costoPorModelo.get(m.id) ?? null,
  }));
}

/**
 * Resuelve el costo UNITARIO del ÚLTIMO costeo (F7) de cada modelo: DISTINCT ON por modelo del
 * `CostoOrden` con `costoTotal` guardado (el modificado más recientemente gana; desempate por id),
 * y `costoTotal / cantidadDeBase(baseProrrateo)` con las cantidades derivadas de esas órdenes
 * (`cantidadesDeOrdenes` — el MISMO helper de la Lista de costos, no una derivación distinta).
 * Los modelos sin costeo o con base 0 no entran al mapa (→ `null` en la salida).
 */
async function costoUnitarioUltimoCosteo(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  idsModelo: number[],
  bd?: ContextoBd,
): Promise<Map<number, number>> {
  const ultimos = await cliente.$queryRaw<
    {
      idModelo: number;
      idOrden: number;
      costoTotal: Prisma.Decimal;
      baseProrrateo: 'cortado' | 'recibido' | 'vendido';
    }[]
  >(Prisma.sql`
    SELECT DISTINCT ON (o."id_modelo")
      o."id_modelo"       AS "idModelo",
      co."id_orden"       AS "idOrden",
      co."costo_total"    AS "costoTotal",
      co."base_prorrateo" AS "baseProrrateo"
    FROM "costo_orden" co
    JOIN "ordenes" o ON o."id" = co."id_orden"
    WHERE co."id_empresa" = ${idEmpresa}
      AND co."costo_total" IS NOT NULL
      AND o."id_modelo" IN (${Prisma.join(idsModelo)})
    ORDER BY o."id_modelo", co."modificado_en" DESC, co."id" DESC
  `);
  if (ultimos.length === 0) {
    return new Map();
  }

  const cantidades = await cantidadesDeOrdenes(
    ultimos.map((u) => u.idOrden),
    bd,
  );
  const resultado = new Map<number, number>();
  for (const u of ultimos) {
    const c = cantidades.get(u.idOrden);
    const cantidadBase = c === undefined ? 0 : cantidadDeBase(c, u.baseProrrateo);
    if (cantidadBase > 0) {
      resultado.set(u.idModelo, redondear2(Number(u.costoTotal) / cantidadBase));
    }
  }
  return resultado;
}

// ── Género (catálogo selector, R bajo `modelos.ver`) ──────────────────────────

/**
 * Lista los géneros para el selector de la ficha. Por defecto solo los activos (los inactivos
 * no se pueden asignar). Requiere `modelos.ver` (sin permiso propio: mismo criterio de
 * sub-catálogo selector que `RolProveedor`). El ABM fino se DIFIERE.
 */
export async function listarGeneros(
  sesion: SesionUsuario,
  opciones: { incluirInactivos?: boolean } = {},
  bd?: ContextoBd,
): Promise<Genero[]> {
  verificarPermiso(sesion, 'modelos.ver');
  return clienteLectura(bd).genero.findMany({
    where: opciones.incluirInactivos === true ? {} : { activo: true },
    orderBy: { nombre: 'asc' },
  });
}
