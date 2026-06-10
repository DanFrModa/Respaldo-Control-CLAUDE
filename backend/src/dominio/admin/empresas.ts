/**
 * Administración de empresas y su configuración (doc funcional 10 §5;
 * MEJORAS A9: multi-empresa explícito).
 *
 * `Empresa` equivale a la tabla `Empresas` del viejo (multi-empresa para
 * facturación/IPT/EDR); `ConfiguracionEmpresa` absorbe la tabla
 * `Propiedades` (un solo registro GLOBAL en el viejo) convertida en
 * parámetros POR EMPRESA (doc 10 §6.4): utilidad sugerida, regalías,
 * colchón de costura de la RC, fechas de inventario físico y almacén PT por
 * defecto.
 *
 * Regla heredada: la empresa FAVORITA (viejo: `Importancia = 1`) es la
 * propuesta al iniciar sesión; aquí se garantiza que sea ÚNICA: marcar una
 * desmarca la anterior en la misma transacción.
 */
import type { ConfiguracionEmpresa, Empresa } from '../../datos/index.js';
import * as z from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

const esquemaCrearEmpresa = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  razonSocial: z.string().trim().max(200).optional(),
  /** Identificador corto para folios e impresos (viejo: `Identificador`). */
  identificador: z.string().trim().max(20).optional(),
  /** Prefijo UPC de la empresa (viejo: `UPCEmp`). */
  upc: z.string().trim().max(20).optional(),
  favorita: z.boolean().default(false),
  paraIpt: z.boolean().default(false),
  paraEdr: z.boolean().default(false),
});

export type EntradaCrearEmpresa = z.input<typeof esquemaCrearEmpresa>;

const esquemaActualizarEmpresa = esquemaCrearEmpresa
  .partial()
  .refine((cambios) => Object.values(cambios).some((valor) => valor !== undefined), {
    message: 'No hay ningún cambio que guardar.',
  });

export type EntradaActualizarEmpresa = z.input<typeof esquemaActualizarEmpresa>;

/** Parámetros por empresa (ex-`Propiedades`, doc 10 §5). Todos opcionales. */
const esquemaConfiguracion = z
  .object({
    /** Utilidad sugerida para costeo, como porcentaje (viejo: `UtilidadSujerida`). */
    utilidadSugerida: z.number().min(0).max(1000).nullable().optional(),
    /** Porcentaje base de regalías (viejo: `Regalias`). */
    regaliasBase: z.number().min(0).max(1000).nullable().optional(),
    /** Días de colchón que la Ruta Crítica suma a la costura (viejo: `ColchonCostura`). */
    colchonCostura: z.number().int().min(0).max(365).nullable().optional(),
    /** Fecha del último inventario físico de telas (viejo: `InvFisico`). */
    fechaInventarioTelas: z.date().nullable().optional(),
    /** Fecha del último inventario físico de PT (viejo: `InvFisicoPT`). */
    fechaInventarioPt: z.date().nullable().optional(),
    /** Almacén PT por defecto (viejo: `IPT_Almacen_Default`); debe ser tipo PT. */
    idAlmacenPtDefault: z.number().int().positive().nullable().optional(),
  })
  .refine((cambios) => Object.values(cambios).some((valor) => valor !== undefined), {
    message: 'No hay ningún cambio que guardar.',
  });

export type EntradaConfiguracionEmpresa = z.input<typeof esquemaConfiguracion>;

/** Busca la empresa o lanza `ErrorNoEncontrado`. */
async function exigirEmpresa(tx: Tx, id: number): Promise<Empresa> {
  const empresa = await tx.empresa.findUnique({ where: { id } });
  if (empresa === null) {
    throw new ErrorNoEncontrado('Empresa', id);
  }
  return empresa;
}

/** La favorita es ÚNICA: desmarcar cualquier otra dentro de la misma transacción. */
async function desmarcarOtrasFavoritas(tx: Tx, idExcepto: number): Promise<void> {
  await tx.empresa.updateMany({
    where: { favorita: true, id: { not: idExcepto } },
    data: { favorita: false },
  });
}

/**
 * Crea una empresa CON su registro de configuración vacío (1:1, en la misma
 * transacción): así `obtenerConfiguracion` siempre encuentra registro.
 *
 * Reglas: permiso `empresas.administrar`; nombre único → `ErrorConflicto`;
 * si nace favorita, desmarca la anterior (favorita única).
 */
export async function crearEmpresa(
  sesion: SesionUsuario,
  entrada: EntradaCrearEmpresa,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const datos = validarEntrada(esquemaCrearEmpresa, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const existente = await tx.empresa.findFirst({
        where: { nombre: { equals: datos.nombre, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existente !== null) {
        throw new ErrorConflicto(`Ya existe una empresa llamada "${datos.nombre}".`);
      }

      const empresa = await tx.empresa.create({
        data: {
          nombre: datos.nombre,
          razonSocial: datos.razonSocial ?? null,
          identificador: datos.identificador ?? null,
          upc: datos.upc ?? null,
          favorita: datos.favorita,
          paraIpt: datos.paraIpt,
          paraEdr: datos.paraEdr,
          configuracion: { create: { ...datosCreacion(sesion) } },
          ...datosCreacion(sesion),
        },
      });

      if (empresa.favorita) {
        await desmarcarOtrasFavoritas(tx, empresa.id);
      }

      await registrarBitacora(tx, sesion, {
        entidad: 'Empresa',
        idEntidad: empresa.id,
        accion: 'CREAR',
        datos: { nombre: empresa.nombre, favorita: empresa.favorita },
      });

      return empresa;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una empresa llamada "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza los datos generales de una empresa. Marcar `favorita: true`
 * desmarca a la anterior (única); quitar la bandera deja al sistema sin
 * favorita (permitido: el login cae a elegir empresa).
 */
export async function actualizarEmpresa(
  sesion: SesionUsuario,
  id: number,
  cambios: EntradaActualizarEmpresa,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const datos = validarEntrada(esquemaActualizarEmpresa, cambios);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirEmpresa(tx, id);

      if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
        const repetido = await tx.empresa.findFirst({
          where: { nombre: { equals: datos.nombre, mode: 'insensitive' }, id: { not: id } },
          select: { id: true },
        });
        if (repetido !== null) {
          throw new ErrorConflicto(`Ya existe una empresa llamada "${datos.nombre}".`);
        }
      }

      const empresa = await tx.empresa.update({
        where: { id },
        data: {
          ...(datos.nombre === undefined ? {} : { nombre: datos.nombre }),
          ...(datos.razonSocial === undefined ? {} : { razonSocial: datos.razonSocial }),
          ...(datos.identificador === undefined ? {} : { identificador: datos.identificador }),
          ...(datos.upc === undefined ? {} : { upc: datos.upc }),
          ...(datos.favorita === undefined ? {} : { favorita: datos.favorita }),
          ...(datos.paraIpt === undefined ? {} : { paraIpt: datos.paraIpt }),
          ...(datos.paraEdr === undefined ? {} : { paraEdr: datos.paraEdr }),
          ...datosModificacion(sesion),
        },
      });

      if (datos.favorita === true) {
        await desmarcarOtrasFavoritas(tx, id);
      }

      await registrarBitacora(tx, sesion, {
        entidad: 'Empresa',
        idEntidad: id,
        accion: 'MODIFICAR',
        datos: Object.fromEntries(Object.entries(datos).filter(([, valor]) => valor !== undefined)),
      });

      return empresa;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una empresa con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva una empresa (borrado suave). No se puede desactivar la FAVORITA
 * (primero marca otra como favorita) ni la empresa activa de tu propia
 * sesión.
 */
export async function desactivarEmpresa(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');

  return enTransaccion(async (tx) => {
    const actual = await exigirEmpresa(tx, id);
    if (!actual.activa) {
      throw new ErrorConflicto(`La empresa "${actual.nombre}" ya está desactivada.`);
    }
    if (actual.favorita) {
      throw new ErrorValidacion(
        `"${actual.nombre}" es la empresa favorita; marca otra como favorita antes de desactivarla.`,
      );
    }
    if (id === sesion.idEmpresaActiva) {
      throw new ErrorValidacion('No puedes desactivar la empresa activa de tu sesión.');
    }

    const empresa = await tx.empresa.update({
      where: { id },
      data: { activa: false, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Empresa',
      idEntidad: id,
      accion: 'DESACTIVAR',
      datos: { nombre: empresa.nombre },
    });

    return empresa;
  }, bd);
}

/** Reactiva una empresa desactivada. */
export async function reactivarEmpresa(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');

  return enTransaccion(async (tx) => {
    const actual = await exigirEmpresa(tx, id);
    if (actual.activa) {
      throw new ErrorConflicto(`La empresa "${actual.nombre}" ya está activa.`);
    }

    const empresa = await tx.empresa.update({
      where: { id },
      data: { activa: true, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Empresa',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { operacion: 'reactivar', nombre: empresa.nombre },
    });

    return empresa;
  }, bd);
}

/** Obtiene una empresa o lanza `ErrorNoEncontrado`. */
export async function obtenerEmpresa(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const empresa = await clienteLectura(bd).empresa.findUnique({ where: { id } });
  if (empresa === null) {
    throw new ErrorNoEncontrado('Empresa', id);
  }
  return empresa;
}

/**
 * Lista TODAS las empresas (son pocas) ordenadas con la favorita primero.
 * Requiere `empresas.administrar`: es la vista de administración. (El
 * selector de empresa del header usa `listarEmpresasActivas`.)
 */
export async function listarEmpresas(sesion: SesionUsuario, bd?: ContextoBd): Promise<Empresa[]> {
  verificarPermiso(sesion, 'empresas.administrar');
  return clienteLectura(bd).empresa.findMany({
    orderBy: [{ favorita: 'desc' }, { nombre: 'asc' }],
  });
}

/**
 * Empresas ACTIVAS para el selector de empresa de la sesión (header del
 * frontend, A9). No exige permiso de administración: cualquier usuario
 * autenticado necesita ver los nombres de empresa para elegir la activa;
 * no expone configuración.
 */
export async function listarEmpresasActivas(
  bd?: ContextoBd,
): Promise<Pick<Empresa, 'id' | 'nombre' | 'favorita'>[]> {
  return clienteLectura(bd).empresa.findMany({
    where: { activa: true },
    select: { id: true, nombre: true, favorita: true },
    orderBy: [{ favorita: 'desc' }, { nombre: 'asc' }],
  });
}

/** Obtiene la configuración de una empresa (existe desde `crearEmpresa`/seed). */
export async function obtenerConfiguracion(
  sesion: SesionUsuario,
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<ConfiguracionEmpresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const configuracion = await clienteLectura(bd).configuracionEmpresa.findUnique({
    where: { idEmpresa },
  });
  if (configuracion === null) {
    throw new ErrorNoEncontrado('ConfiguracionEmpresa', idEmpresa);
  }
  return configuracion;
}

/**
 * Actualiza la configuración de la empresa (upsert: si la empresa viene del
 * seed sin configuración, se crea). El almacén PT por defecto debe existir,
 * ser de la empresa (o global) y de tipo PT — `ErrorValidacion` si no.
 */
export async function actualizarConfiguracion(
  sesion: SesionUsuario,
  idEmpresa: number,
  cambios: EntradaConfiguracionEmpresa,
  bd?: ContextoBd,
): Promise<ConfiguracionEmpresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const datos = validarEntrada(esquemaConfiguracion, cambios);

  return enTransaccion(async (tx) => {
    await exigirEmpresa(tx, idEmpresa);

    if (datos.idAlmacenPtDefault !== undefined && datos.idAlmacenPtDefault !== null) {
      const almacen = await tx.almacen.findFirst({
        where: {
          id: datos.idAlmacenPtDefault,
          tipo: 'PT',
          activo: true,
          OR: [{ idEmpresa }, { idEmpresa: null }],
        },
        select: { id: true },
      });
      if (almacen === null) {
        throw new ErrorValidacion(
          'El almacén PT por defecto debe ser un almacén ACTIVO de tipo PT de esta empresa.',
        );
      }
    }

    const cambiosPrisma = {
      ...(datos.utilidadSugerida === undefined ? {} : { utilidadSugerida: datos.utilidadSugerida }),
      ...(datos.regaliasBase === undefined ? {} : { regaliasBase: datos.regaliasBase }),
      ...(datos.colchonCostura === undefined ? {} : { colchonCostura: datos.colchonCostura }),
      ...(datos.fechaInventarioTelas === undefined
        ? {}
        : { fechaInventarioTelas: datos.fechaInventarioTelas }),
      ...(datos.fechaInventarioPt === undefined
        ? {}
        : { fechaInventarioPt: datos.fechaInventarioPt }),
      ...(datos.idAlmacenPtDefault === undefined
        ? {}
        : { idAlmacenPtDefault: datos.idAlmacenPtDefault }),
    };

    const configuracion = await tx.configuracionEmpresa.upsert({
      where: { idEmpresa },
      create: { idEmpresa, ...cambiosPrisma, ...datosCreacion(sesion) },
      update: { ...cambiosPrisma, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ConfiguracionEmpresa',
      idEntidad: idEmpresa,
      accion: 'MODIFICAR',
      datos: Object.fromEntries(
        Object.entries(datos)
          .filter(([, valor]) => valor !== undefined)
          .map(([campo, valor]) => [campo, valor instanceof Date ? valor.toISOString() : valor]),
      ),
    });

    return configuracion;
  }, bd);
}
