/**
 * Proveedores — catálogo maestro GLOBAL (F1-E1).
 *
 * Replica AL PIE DE LA LETRA el CRUD patrón de Almacenes
 * (`dominio/admin/almacenes.ts`), con UNA diferencia de diseño: los catálogos
 * maestros de F1 son **globales, sin `idEmpresa`** (ADR-0007, decisión A9 —
 * `Documentacion_MJD/MEJORAS.md` A9). Por eso aquí NO hay empresa activa,
 * `filtroEmpresaActiva` ni `todasLasEmpresas`: la unicidad de `nombre` es global
 * (`@unique`) y un proveedor se da de alta una sola vez para todas las empresas.
 *
 * Doc funcional: `Documentacion_MJD/03-Produccion.md` §Submódulo Órdenes de
 * Compra (tabla `Proveedores`, campo `TipoProv` H/T/S). El mapeo H/T/S → enum
 * `TipoProveedor` lo hace el ETL en F1-E6; aquí solo el catálogo nuevo.
 *
 * Piezas del patrón conservadas: permiso primero (`proveedores.ver` para leer,
 * `proveedores.administrar` para mutar, PLANMAESTRO §9.2); Zod compartido de
 * `src/contrato`; todo cambio en UNA transacción (A2) con auditoría (A7) +
 * `Bitacora` juntos o nada; borrado SUAVE reversible (`activo`); unicidad de
 * nombre validada en la transacción y respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import {
  esquemaProveedorCrear,
  esquemaProveedorEditar,
  TIPOS_PROVEEDOR,
} from '../../contrato/index.js';
import type { Prisma, Proveedor } from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
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

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearProveedor = z.input<typeof esquemaProveedorCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarProveedor = z.input<typeof esquemaProveedorEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarProveedores = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(150).optional(),
  /** Filtrar por tipo de proveedor. */
  tipo: z.enum(TIPOS_PROVEEDOR).optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'tipo', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarProveedores = z.input<typeof esquemaListarProveedores>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos proveedores con el
 * mismo nombre, sin importar mayúsculas ("Textiles SA" ≡ "textiles sa"). Se valida
 * DENTRO de la transacción; la carrera residual la captura el unique de la base
 * (P2002 → `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.proveedor.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un proveedor llamado "${nombre}".`
        : `Ya existe un proveedor llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un proveedor por id o lanza `ErrorNoEncontrado`. */
async function exigirProveedor(tx: Tx, id: number): Promise<Proveedor> {
  const proveedor = await tx.proveedor.findUnique({ where: { id } });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', id);
  }
  return proveedor;
}

/**
 * Crea un proveedor (catálogo global). Reglas: permiso `proveedores.administrar`;
 * nombre único global → `ErrorConflicto`; nace activo; auditoría y bitácora en la
 * misma transacción (A2/A7).
 *
 * @example
 * const p = await crearProveedor(sesion, { nombre: "Textiles SA", tipo: "TELAS" });
 */
export async function crearProveedor(
  sesion: SesionUsuario,
  entrada: EntradaCrearProveedor,
  bd?: ContextoBd,
): Promise<Proveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);

      const proveedor = await tx.proveedor.create({
        data: {
          nombre: datos.nombre,
          tipo: datos.tipo,
          ...(datos.razonSocial === undefined ? {} : { razonSocial: datos.razonSocial }),
          ...(datos.telefono === undefined ? {} : { telefono: datos.telefono }),
          ...(datos.contacto === undefined ? {} : { contacto: datos.contacto }),
          ...(datos.condiciones === undefined ? {} : { condiciones: datos.condiciones }),
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Proveedor',
        idEntidad: proveedor.id,
        accion: 'CREAR',
        datos: { nombre: proveedor.nombre, tipo: proveedor.tipo },
      });

      return proveedor;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un proveedor llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un proveedor: datos generales y/o `activo` para desactivar (borrado
 * suave) o reactivar — la forma exacta del esquema compartido `esquemaProveedorEditar`.
 *
 * Bitácora según lo que pasó: `MODIFICAR` con el detalle de campos, y/o `DESACTIVAR`
 * si el cambio apagó el proveedor.
 */
export async function actualizarProveedor(
  sesion: SesionUsuario,
  entrada: EntradaActualizarProveedor,
  bd?: ContextoBd,
): Promise<Proveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirProveedor(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaRazon =
        datos.razonSocial !== undefined && datos.razonSocial !== actual.razonSocial;
      const cambiaTipo = datos.tipo !== undefined && datos.tipo !== actual.tipo;
      const cambiaTelefono = datos.telefono !== undefined && datos.telefono !== actual.telefono;
      const cambiaContacto = datos.contacto !== undefined && datos.contacto !== actual.contacto;
      const cambiaCondiciones =
        datos.condiciones !== undefined && datos.condiciones !== actual.condiciones;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (
        !cambiaNombre &&
        !cambiaRazon &&
        !cambiaTipo &&
        !cambiaTelefono &&
        !cambiaContacto &&
        !cambiaCondiciones &&
        !reactiva &&
        !desactiva
      ) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      // Al cambiar nombre o al reactivar puede chocar con un nombre vigente.
      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.ProveedorUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaRazon && datos.razonSocial !== undefined) {
        cambios.razonSocial = datos.razonSocial;
      }
      if (cambiaTipo && datos.tipo !== undefined) {
        cambios.tipo = datos.tipo;
      }
      if (cambiaTelefono && datos.telefono !== undefined) {
        cambios.telefono = datos.telefono;
      }
      if (cambiaContacto && datos.contacto !== undefined) {
        cambios.contacto = datos.contacto;
      }
      if (cambiaCondiciones && datos.condiciones !== undefined) {
        cambios.condiciones = datos.condiciones;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const proveedor = await tx.proveedor.update({ where: { id: datos.id }, data: cambios });

      if (
        cambiaNombre ||
        cambiaRazon ||
        cambiaTipo ||
        cambiaTelefono ||
        cambiaContacto ||
        cambiaCondiciones ||
        reactiva
      ) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Proveedor',
          idEntidad: proveedor.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: proveedor.nombre } } : {}),
            ...(cambiaRazon
              ? { razonSocial: { de: actual.razonSocial, a: proveedor.razonSocial } }
              : {}),
            ...(cambiaTipo ? { tipo: { de: actual.tipo, a: proveedor.tipo } } : {}),
            ...(cambiaTelefono ? { telefono: { de: actual.telefono, a: proveedor.telefono } } : {}),
            ...(cambiaContacto ? { contacto: { de: actual.contacto, a: proveedor.contacto } } : {}),
            ...(cambiaCondiciones
              ? { condiciones: { de: actual.condiciones, a: proveedor.condiciones } }
              : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Proveedor',
          idEntidad: proveedor.id,
          accion: 'DESACTIVAR',
          datos: { nombre: proveedor.nombre },
        });
      }

      return proveedor;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un proveedor con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un proveedor: deja de aparecer en capturas pero su
 * historial queda intacto. Desactivar dos veces es `ErrorConflicto` (la pantalla
 * estaba desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarProveedor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Proveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirProveedor(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El proveedor "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarProveedor(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un proveedor desactivado (operación inversa del borrado suave). */
export async function reactivarProveedor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Proveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirProveedor(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El proveedor "${actual.nombre}" ya está activo.`);
    }
    return actualizarProveedor(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un proveedor por id o lanza `ErrorNoEncontrado`. */
export async function obtenerProveedor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Proveedor> {
  verificarPermiso(sesion, 'proveedores.ver');
  const proveedor = await clienteLectura(bd).proveedor.findUnique({ where: { id } });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', id);
  }
  return proveedor;
}

/**
 * Lista proveedores con búsqueda, orden y paginación EN SERVIDOR (la tabla de la UI
 * nunca trae todo para filtrar en memoria). Por defecto: solo activos. Permite
 * filtrar por `tipo`.
 *
 * @example
 * const pagina = await listarProveedores(sesion, { tipo: "TELAS", busqueda: "textil" });
 */
export async function listarProveedores(
  sesion: SesionUsuario,
  parametros: ParametrosListarProveedores = {},
  bd?: ContextoBd,
): Promise<Pagina<Proveedor>> {
  verificarPermiso(sesion, 'proveedores.ver');
  const filtros = validarEntrada(esquemaListarProveedores, parametros);

  const where: Prisma.ProveedorWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.tipo === undefined ? {} : { tipo: filtros.tipo }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.proveedor.count({ where }),
    cliente.proveedor.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
