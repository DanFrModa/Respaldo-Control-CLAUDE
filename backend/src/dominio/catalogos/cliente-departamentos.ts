/**
 * Departamentos del cliente (F8-E1a, D13/R16 — Desarrollo y Cotización).
 *
 * Un cliente puede dividir su operación en DEPARTAMENTOS (p. ej. C&A → "NIÑOS",
 * "DAMAS"). Es el ESPEJO, más simple, de los campos de referencia del cliente
 * (`ClienteCampo`, D7 — ver `clientes.ts` §"Campos de referencia del cliente"): un
 * sub-recurso del Cliente cuya clave de negocio es el `nombre`, único DENTRO del
 * cliente (insensible a mayúsculas). NO tiene `tipo` ni `orden`.
 *
 * Reglas (mismas que los campos):
 *  • `nombre` es ÚNICO DENTRO del cliente (índice `@@unique([idCliente, nombre])`),
 *    insensible a mayúsculas; el mensaje al duplicar es claro.
 *  • Cada operación de departamento exige que el cliente exista y esté ACTIVO (no se
 *    editan departamentos de un cliente desactivado).
 *  • Borrado SUAVE (`activo`) reversible con desactivar/reactivar.
 *  • Cada operación va en UNA transacción (A2) con auditoría (A7) + `Bitacora` juntos
 *    o nada; la carrera residual la captura el unique de la base (P2002 →
 *    `ErrorConflicto`). La bitácora usa la entidad `'Cliente'` (el departamento es un
 *    sub-recurso), igual que hacen los campos.
 */
import type { ClienteDepartamento, Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import {
  esquemaClienteDepartamentoCrear,
  esquemaClienteDepartamentoEditar,
} from '../../contrato/esquemas/cliente-departamento.js';
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

/** Alta de un departamento: forma del esquema compartido. */
export type EntradaCrearDepartamentoCliente = z.input<typeof esquemaClienteDepartamentoCrear>;

/** Edición de un departamento: `id` + cambios parciales (incluye `activo`). */
export type EntradaActualizarDepartamentoCliente = z.input<typeof esquemaClienteDepartamentoEditar>;

/**
 * Unicidad del `nombre` DENTRO del cliente (D13/R16): un cliente no puede tener dos
 * departamentos con el mismo nombre, sin importar mayúsculas. Se valida en la
 * transacción; la carrera residual la captura el unique `@@unique([idCliente, nombre])`.
 */
async function exigirNombreDepartamentoLibre(
  tx: Tx,
  idCliente: number,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.clienteDepartamento.findFirst({
    where: {
      idCliente,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Este cliente ya tiene un departamento llamado "${nombre}".`
        : `Este cliente ya tiene un departamento llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/**
 * Busca un cliente ACTIVO por id (para operar sus departamentos): no se editan
 * departamentos de un cliente desactivado. Lanza `ErrorNoEncontrado` si no existe,
 * `ErrorConflicto` si está desactivado.
 */
async function exigirClienteActivo(tx: Tx, idCliente: number): Promise<void> {
  const cliente = await tx.cliente.findUnique({
    where: { id: idCliente },
    select: { nombre: true, activo: true },
  });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  if (!cliente.activo) {
    throw new ErrorConflicto(
      `El cliente "${cliente.nombre}" está desactivado; reactívalo para editar sus departamentos.`,
    );
  }
}

/**
 * Busca un departamento que PERTENEZCA al cliente o lanza `ErrorNoEncontrado` (un
 * departamento de otro cliente, para este cliente, no existe).
 */
async function exigirDepartamentoDeCliente(
  tx: Tx,
  idCliente: number,
  idDepartamento: number,
): Promise<ClienteDepartamento> {
  const departamento = await tx.clienteDepartamento.findFirst({
    where: { id: idDepartamento, idCliente },
  });
  if (departamento === null) {
    throw new ErrorNoEncontrado('Departamento del cliente', idDepartamento);
  }
  return departamento;
}

/**
 * Lista los departamentos de un cliente (D13/R16), ordenados por `nombre`. Por defecto
 * solo los activos; `incluirInactivos` trae también los desactivados. Requiere
 * `clientes.ver`. Exige que el cliente exista (no su estado activo: ver los
 * departamentos de un cliente desactivado es lícito).
 */
export async function listarDepartamentosCliente(
  sesion: SesionUsuario,
  idCliente: number,
  opciones: { incluirInactivos?: boolean } = {},
  bd?: ContextoBd,
): Promise<ClienteDepartamento[]> {
  verificarPermiso(sesion, 'clientes.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.cliente.findUnique({
    where: { id: idCliente },
    select: { id: true },
  });
  if (existe === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  return cliente.clienteDepartamento.findMany({
    where: { idCliente, ...(opciones.incluirInactivos === true ? {} : { activo: true }) },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Agrega un departamento a un cliente (D13/R16) en UNA transacción (A2). Reglas:
 * permiso `clientes.administrar`; el cliente debe existir y estar ACTIVO; `nombre`
 * único dentro del cliente → `ErrorConflicto`. Auditoría/bitácora en la misma
 * transacción.
 */
export async function agregarDepartamentoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: EntradaCrearDepartamentoCliente,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteDepartamentoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirClienteActivo(tx, idCliente);
      await exigirNombreDepartamentoLibre(tx, idCliente, datos.nombre);

      const departamento = await tx.clienteDepartamento.create({
        data: {
          idCliente,
          nombre: datos.nombre,
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Cliente',
        idEntidad: idCliente,
        accion: 'MODIFICAR',
        datos: {
          departamento: 'agregar',
          idDepartamento: departamento.id,
          nombre: departamento.nombre,
        },
      });

      return departamento;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Este cliente ya tiene un departamento llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un departamento de un cliente (D13/R16): `nombre` y/o `activo`
 * (des/reactivar) — la forma de `esquemaClienteDepartamentoEditar`. UNA transacción
 * (A2). El cliente debe estar ACTIVO. Si cambia el nombre, se exige que el nuevo esté
 * libre dentro del cliente. Bitácora con el detalle.
 */
export async function actualizarDepartamentoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: EntradaActualizarDepartamentoCliente,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteDepartamentoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirClienteActivo(tx, idCliente);
      const actual = await exigirDepartamentoDeCliente(tx, idCliente, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre && datos.nombre !== undefined) {
        await exigirNombreDepartamentoLibre(tx, idCliente, datos.nombre, datos.id);
      }

      const cambios: Prisma.ClienteDepartamentoUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const departamento = await tx.clienteDepartamento.update({
        where: { id: datos.id },
        data: cambios,
      });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cliente',
          idEntidad: idCliente,
          accion: 'MODIFICAR',
          datos: {
            departamento: 'modificar',
            idDepartamento: departamento.id,
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: departamento.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cliente',
          idEntidad: idCliente,
          accion: 'MODIFICAR',
          datos: {
            departamento: 'desactivar',
            idDepartamento: departamento.id,
            nombre: departamento.nombre,
          },
        });
      }

      return departamento;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Este cliente ya tiene un departamento con ese nombre.', {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un departamento de un cliente (D13/R16). Desactivar dos
 * veces es `ErrorConflicto`. El cliente debe estar ACTIVO.
 */
export async function desactivarDepartamentoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  idDepartamento: number,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  return enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    const actual = await exigirDepartamentoDeCliente(tx, idCliente, idDepartamento);
    if (!actual.activo) {
      throw new ErrorConflicto(`El departamento "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarDepartamentoCliente(
      sesion,
      idCliente,
      { id: idDepartamento, activo: false },
      { tx },
    );
  }, bd);
}

/** Reactiva un departamento desactivado (operación inversa del borrado suave). */
export async function reactivarDepartamentoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  idDepartamento: number,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  return enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    const actual = await exigirDepartamentoDeCliente(tx, idCliente, idDepartamento);
    if (actual.activo) {
      throw new ErrorConflicto(`El departamento "${actual.nombre}" ya está activo.`);
    }
    // No hace falta re-checar el nombre: el unique `@@unique([idCliente, nombre])` cubre
    // activos e inactivos, así que mientras estuvo apagado nadie pudo reusarlo.
    return actualizarDepartamentoCliente(
      sesion,
      idCliente,
      { id: idDepartamento, activo: true },
      { tx },
    );
  }, bd);
}
