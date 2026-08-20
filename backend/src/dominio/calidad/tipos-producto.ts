/**
 * Tipos de producto (F6-E1, decisión (d) — DECISIONES.md §F6; doc 09 §5.2). Catálogo CORTO y
 * editable que clasifica los modelos para FILTRAR los defectos aplicables a una auditoría (NO para
 * el plan AQL: hay un solo plan para todos, decisión (c)). CRUD patrón Almacenes con borrado SUAVE:
 * un tipo en uso por modelos/defectos NO se borra físico, solo se inactiva (las FK son Restrict).
 *
 * Lógica de negocio SOLO aquí (A1); transacción + auditoría + bitácora juntas (A2/A7); catálogo
 * GLOBAL como los de F1 (sin idEmpresa). Unicidad de `nombre` insensible a mayúsculas.
 *
 * ⚠️ Desde V1-E3n este catálogo lleva además el **`digitoConcepto`**: el 1er dígito de la
 * nomenclatura de producción (§Post-F9.34). No es un dato de Calidad —vive aquí porque aquí vive el
 * tipo de prenda— y es el que permite armarle código a un modelo. Es **único entre los tipos
 * activos**: dos conceptos con el mismo dígito partirían la misma serie de 999 en dos.
 */
import { esquemaTipoProductoCrear, esquemaTipoProductoEditar } from '../../contrato/index.js';
import type { Prisma, TipoProducto } from '../../datos/index.js';
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
import { CODIGO_PRISMA, codigoErrorPrisma, unicidadDeCampo } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Alta: campos del esquema compartido. */
export type EntradaCrearTipoProducto = z.input<typeof esquemaTipoProductoCrear>;
/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarTipoProducto = z.input<typeof esquemaTipoProductoEditar>;

/**
 * Filtros del listado con tipos NATIVOS (boolean ya coaccionado): la ruta recibe el querystring con
 * `stringbool` (contrato) y la coacción de Zod entrega aquí un boolean. Mismo patrón que Almacenes
 * y Tipos de proceso (el dominio re-valida con su propio esquema, sin `stringbool`/`coerce`).
 */
export const esquemaListarTiposProducto = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn', 'digitoConcepto']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export type ParametrosListarTiposProducto = z.input<typeof esquemaListarTiposProducto>;

/**
 * Unicidad de negocio: no puede haber dos tipos de producto con el mismo nombre, sin importar
 * mayúsculas. Se valida DENTRO de la transacción; la carrera residual la captura el unique de la
 * base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.tipoProducto.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un tipo de producto llamado "${nombre}".`
        : `Ya existe un tipo de producto llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/**
 * Unicidad del DÍGITO DE CONCEPTO entre los tipos ACTIVOS (§Post-F9.34): cada concepto es una serie
 * INDEPENDIENTE de 999 números, así que dos tipos con el mismo dígito se estarían repartiendo la
 * misma serie sin saberlo — y el generador propondría para «Chamarra» un número que «Chaleco» ya
 * usó. Se mira sólo entre los activos a propósito: un tipo desactivado ya no numera nada, y
 * bloquear por él obligaría a renombrar historia para reusar un concepto.
 */
async function exigirDigitoLibre(tx: Tx, digito: number, idActual?: number): Promise<void> {
  const existente = await tx.tipoProducto.findFirst({
    where: {
      digitoConcepto: digito,
      activo: true,
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { nombre: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      `El dígito ${String(digito)} ya es el concepto del tipo de producto "${existente.nombre}".`,
    );
  }
}

/**
 * Traduce un P2002 de esta tabla al mensaje del constraint QUE DE VERDAD chocó. Hay DOS únicos —el
 * `nombre` y el índice parcial del `digito_concepto` entre activos (V1-E3n)— y culpar siempre al
 * nombre manda a corregir el campo equivocado: pasa al REACTIVAR un tipo cuyo dígito ya se le dio a
 * otro, donde el dominio no puede adelantarse y la red es la base.
 */
function mensajeDeUnicidad(error: unknown, nombre?: string): string {
  if (unicidadDeCampo(error, 'digito_concepto')) {
    return 'Ese dígito de concepto ya es de otro tipo de producto activo.';
  }
  return nombre === undefined
    ? 'Ya existe un tipo de producto con ese nombre.'
    : `Ya existe un tipo de producto llamado "${nombre}".`;
}

/** Busca un tipo de producto por id o lanza `ErrorNoEncontrado`. */
async function exigirTipoProducto(tx: Tx, id: number): Promise<TipoProducto> {
  const tipo = await tx.tipoProducto.findUnique({ where: { id } });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoProducto', id);
  }
  return tipo;
}

/**
 * Crea un tipo de producto. Permiso `calidad.administrar-catalogo`; nombre único; nace activo;
 * auditoría y bitácora en la misma transacción (A2/A7).
 */
export async function crearTipoProducto(
  sesion: SesionUsuario,
  entrada: EntradaCrearTipoProducto,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaTipoProductoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);
      if (datos.digitoConcepto !== undefined) {
        await exigirDigitoLibre(tx, datos.digitoConcepto);
      }
      const tipo = await tx.tipoProducto.create({
        data: {
          nombre: datos.nombre,
          ...(datos.digitoConcepto === undefined ? {} : { digitoConcepto: datos.digitoConcepto }),
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'TipoProducto',
        idEntidad: tipo.id,
        accion: 'CREAR',
        datos: { nombre: tipo.nombre, digitoConcepto: tipo.digitoConcepto },
      });
      return tipo;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(mensajeDeUnicidad(error, datos.nombre), { causa: error });
    }
    throw error;
  }
}

/**
 * Actualiza un tipo de producto: nombre y/o `activo` (desactivar/reactivar). Bitácora según lo que
 * pasó (`MODIFICAR`/`DESACTIVAR`). Idempotente: si nada cambia, no escribe bitácora vacía.
 */
export async function actualizarTipoProducto(
  sesion: SesionUsuario,
  entrada: EntradaActualizarTipoProducto,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  const datos = validarEntrada(esquemaTipoProductoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirTipoProducto(tx, datos.id);
      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      // M1: omitir = no tocar; `null` = QUITAR el dígito; número = fijarlo.
      const nuevoDigito = datos.digitoConcepto === undefined ? undefined : datos.digitoConcepto;
      const cambiaDigito = nuevoDigito !== undefined && nuevoDigito !== actual.digitoConcepto;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !cambiaDigito && !reactiva && !desactiva) {
        return actual;
      }
      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }
      // El dígito se valida al fijarlo, y también al REACTIVAR: mientras estuvo apagado alguien
      // pudo darle ese concepto a otro tipo, y encenderlo partiría la serie en dos.
      if (cambiaDigito && nuevoDigito !== null) {
        await exigirDigitoLibre(tx, nuevoDigito, datos.id);
      } else if (reactiva && actual.digitoConcepto !== null) {
        await exigirDigitoLibre(tx, actual.digitoConcepto, datos.id);
      }

      const cambios: Prisma.TipoProductoUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaDigito) {
        cambios.digitoConcepto = nuevoDigito;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }
      const tipo = await tx.tipoProducto.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || cambiaDigito || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TipoProducto',
          idEntidad: tipo.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: tipo.nombre } } : {}),
            ...(cambiaDigito
              ? { digitoConcepto: { de: actual.digitoConcepto, a: tipo.digitoConcepto } }
              : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TipoProducto',
          idEntidad: tipo.id,
          accion: 'DESACTIVAR',
          datos: { nombre: tipo.nombre },
        });
      }
      return tipo;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(mensajeDeUnicidad(error), { causa: error });
    }
    throw error;
  }
}

/** Desactiva (borrado SUAVE) un tipo de producto. Desactivarlo dos veces es `ErrorConflicto`. */
export async function desactivarTipoProducto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirTipoProducto(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El tipo de producto "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarTipoProducto(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un tipo de producto desactivado (operación inversa del borrado suave). */
export async function reactivarTipoProducto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.administrar-catalogo');
  return enTransaccion(async (tx) => {
    const actual = await exigirTipoProducto(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El tipo de producto "${actual.nombre}" ya está activo.`);
    }
    return actualizarTipoProducto(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un tipo de producto por id o lanza `ErrorNoEncontrado`. */
export async function obtenerTipoProducto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TipoProducto> {
  verificarPermiso(sesion, 'calidad.ver');
  const tipo = await clienteLectura(bd).tipoProducto.findUnique({ where: { id } });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoProducto', id);
  }
  return tipo;
}

/** Lista tipos de producto con búsqueda, orden y paginación EN SERVIDOR. */
export async function listarTiposProducto(
  sesion: SesionUsuario,
  parametros: ParametrosListarTiposProducto = {},
  bd?: ContextoBd,
): Promise<Pagina<TipoProducto>> {
  verificarPermiso(sesion, 'calidad.ver');
  const filtros = validarEntrada(esquemaListarTiposProducto, parametros);

  const where: Prisma.TipoProductoWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.tipoProducto.count({ where }),
    cliente.tipoProducto.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);
  return armarPagina(datos, total, filtros);
}
