/**
 * Precios de TELA POR PROVEEDOR (F8-E1, D13/R17) — el hueco grande del costeo: hoy solo
 * hay `Tela.precioSugerido` genérico y `TelaColor.precio` sin proveedor. Este servicio
 * gestiona `TelaProveedor` (precio de una tela a un proveedor) con su grid opcional de
 * precio POR COLOR (`TelaProveedorColor`), como SUB-RECURSO de la Tela: se cuelga de una
 * tela y el mismo proveedor aparece UNA vez por tela (`[idTela, idProveedor]`).
 *
 * Es el ESPEJO de `dominio/catalogos/avios.ts` (proveedores de un avío con precio propio)
 * y del grid de colores con precio de `dominio/catalogos/telas.ts`, con estas notas de
 * diseño:
 *  • `TelaProveedor` lleva surrogate `id` (lo referencian el BOM de F8 y el precosto), así
 *    que la CRUD apunta por ese `id` (no por la pareja como el puente del avío), y toda
 *    operación exige que el renglón PERTENEZCA a la tela de la URL (si no,
 *    `ErrorNoEncontrado`).
 *  • El grid `colores` (idColor + precio) viaja inline y se sincroniza (diff agregar/quitar/
 *    actualizar precio) EN LA MISMA transacción (A2), igual que `sincronizarColores` de la
 *    Tela. Solo tiene sentido cuando `manejaPrecioPorColor`, pero NO se acopla: si viene con
 *    la bandera en false, los colores quedan (no se usan); si el llamador manda `colores:
 *    []`, se vacía.
 *  • Borrado SUAVE (`activo`) reversible; auditoría (A7) + `Bitacora` (entidad
 *    `'TelaProveedor'`) en la transacción; unicidad `[idTela, idProveedor]` validada en la
 *    transacción y respaldada por el unique de la base (P2002 → `ErrorConflicto`).
 *
 * Permisos (se gobierna con los de la Tela, sin permiso propio): `telas.ver` para leer,
 * `telas.administrar` para mutar. Los precios de compra los ve/edita quien administra el
 * catálogo, así que no se ocultan por permiso aquí.
 */
import type { esquemaTelaProveedorColorEntrada } from '../../contrato/esquemas/tela-proveedor.js';
import {
  esquemaTelaProveedorCrear,
  esquemaTelaProveedorEditar,
} from '../../contrato/esquemas/tela-proveedor.js';
import type { Prisma, TelaProveedor, TelaProveedorColor } from '../../datos/index.js';
import type { z } from 'zod';

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

/** Alta de un proveedor de tela (el `idTela` lo pone la ruta desde la URL). */
export type EntradaCrearTelaProveedor = z.input<typeof esquemaTelaProveedorCrear>;

/** Edición: `id` del renglón + cambios parciales (incluye `activo` y, opcional, `colores`). */
export type EntradaActualizarTelaProveedor = z.input<typeof esquemaTelaProveedorEditar>;

/** Un renglón de precio por color tal como llega validado (precio ya `number | undefined`). */
type ColorEntrada = z.output<typeof esquemaTelaProveedorColorEntrada>;

/**
 * `TelaProveedor` con su proveedor (nombre) y su grid de colores (con nombre) embebidos —
 * la forma que consume la ruta para armar la salida sin cruzar con los catálogos.
 */
export type TelaProveedorConColores = TelaProveedor & {
  proveedor: { nombre: string };
  colores: (Pick<TelaProveedorColor, 'idColor' | 'precio'> & { color: { nombre: string } })[];
};

/** `include` estándar para traer el proveedor y el grid de colores (ordenado por color). */
const incluirProveedorYColores = {
  proveedor: { select: { nombre: true } },
  colores: {
    select: { idColor: true, precio: true, color: { select: { nombre: true } } },
    orderBy: { color: { nombre: 'asc' } },
  },
} satisfies Prisma.TelaProveedorInclude;

/** Exige que la tela padre exista (o `ErrorNoEncontrado`). */
async function exigirTelaExiste(tx: Tx, idTela: number): Promise<void> {
  const tela = await tx.tela.findUnique({ where: { id: idTela }, select: { id: true } });
  if (tela === null) {
    throw new ErrorNoEncontrado('Tela', idTela);
  }
}

/**
 * Busca el renglón `TelaProveedor` por `id` y exige que PERTENEZCA a la tela de la URL: si
 * no existe o es de otra tela, `ErrorNoEncontrado` (no se filtra que exista bajo otra tela).
 */
async function exigirTelaProveedorDeTela(
  tx: Tx,
  idTela: number,
  idTelaProveedor: number,
): Promise<TelaProveedor> {
  const fila = await tx.telaProveedor.findUnique({ where: { id: idTelaProveedor } });
  if (fila === null || fila.idTela !== idTela) {
    throw new ErrorNoEncontrado('TelaProveedor', idTelaProveedor);
  }
  return fila;
}

/**
 * Valida que el proveedor exista y esté ACTIVO (no se asigna un proveedor desactivado).
 * Lanza `ErrorValidacion` con mensaje claro para la UI. Pareja singular de
 * `exigirProveedoresValidos` del avío.
 */
async function exigirProveedorValido(tx: Tx, idProveedor: number): Promise<void> {
  const proveedor = await tx.proveedor.findUnique({
    where: { id: idProveedor },
    select: { nombre: true, activo: true },
  });
  if (proveedor === null) {
    throw new ErrorValidacion('El proveedor seleccionado no existe.');
  }
  if (!proveedor.activo) {
    throw new ErrorValidacion(
      `El proveedor "${proveedor.nombre}" está desactivado y no se puede asignar.`,
    );
  }
}

/**
 * Unicidad de negocio `[idTela, idProveedor]`: un proveedor aparece UNA vez por tela. Se
 * valida DENTRO de la transacción; la carrera residual la captura el unique de la base
 * (P2002 → `ErrorConflicto`). El mensaje distingue si el existente está desactivado (invita
 * a reactivarlo en vez de crear otro).
 */
async function exigirProveedorLibre(
  tx: Tx,
  idTela: number,
  idProveedor: number,
  idActual?: number,
): Promise<void> {
  const existente = await tx.telaProveedor.findFirst({
    where: {
      idTela,
      idProveedor,
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { activo: true, proveedor: { select: { nombre: true } } },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `El proveedor "${existente.proveedor.nombre}" ya está asignado a esta tela.`
        : `El proveedor "${existente.proveedor.nombre}" ya está asignado a esta tela (está desactivado; puedes reactivarlo).`,
    );
  }
}

/**
 * Valida que todos los colores existan y estén ACTIVOS (no se asigna un color desactivado).
 * Lanza `ErrorValidacion` con mensaje claro. (El arreglo ya viene sin repetidos por el
 * esquema Zod.) Mismo criterio que `exigirColoresValidos` de la Tela.
 */
async function exigirColoresValidos(tx: Tx, idsColores: number[]): Promise<void> {
  if (idsColores.length === 0) {
    return;
  }
  const colores = await tx.color.findMany({
    where: { id: { in: idsColores } },
    select: { id: true, nombre: true, activo: true },
  });
  if (colores.length !== idsColores.length) {
    throw new ErrorValidacion('Uno o más colores seleccionados no existen.');
  }
  const inactivo = colores.find((color) => !color.activo);
  if (inactivo !== undefined) {
    throw new ErrorValidacion(
      `El color "${inactivo.nombre}" está desactivado y no se puede asignar.`,
    );
  }
}

/**
 * Compara un decimal capturado (number | null | undefined) con el guardado
 * (Decimal | null). `undefined` = no se tocó (no cambia). Distingue `null` (vaciar) de un
 * número nuevo. Copia del helper de la Tela.
 */
function cambiaDecimal(entrada: number | null | undefined, actual: Prisma.Decimal | null): boolean {
  if (entrada === undefined) {
    return false;
  }
  const actualNum = actual === null ? null : actual.toNumber();
  return actualNum !== entrada;
}

/**
 * Reemplaza el grid de precio por color de un renglón proveedor DENTRO de la transacción
 * (A2): borra los que sobran, crea los que faltan y ACTUALIZA el precio de los que
 * cambiaron (diff mínimo, sin tocar lo que no varía — se conserva la auditoría de cada
 * renglón). Exige colores válidos y activos. Devuelve true si hubo algún cambio (para la
 * bitácora). Calca `sincronizarColores` de la Tela.
 */
async function sincronizarColores(
  tx: Tx,
  sesion: SesionUsuario,
  idTelaProveedor: number,
  deseados: ColorEntrada[],
): Promise<boolean> {
  await exigirColoresValidos(
    tx,
    deseados.map((c) => c.idColor),
  );

  const actuales = await tx.telaProveedorColor.findMany({
    where: { idTelaProveedor },
    select: { idColor: true, precio: true },
  });
  const mapaActual = new Map(actuales.map((c) => [c.idColor, c.precio]));
  const mapaDeseado = new Map(deseados.map((c) => [c.idColor, c.precio ?? null]));

  const aQuitar = [...mapaActual.keys()].filter((idColor) => !mapaDeseado.has(idColor));
  const aAgregar = deseados.filter((c) => !mapaActual.has(c.idColor));
  const aActualizar = deseados.filter((c) => {
    if (!mapaActual.has(c.idColor)) {
      return false;
    }
    const precioActual = mapaActual.get(c.idColor) ?? null;
    const precioActualNum = precioActual === null ? null : precioActual.toNumber();
    return precioActualNum !== (c.precio ?? null);
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return false;
  }

  if (aQuitar.length > 0) {
    await tx.telaProveedorColor.deleteMany({
      where: { idTelaProveedor, idColor: { in: aQuitar } },
    });
  }
  if (aAgregar.length > 0) {
    await tx.telaProveedorColor.createMany({
      data: aAgregar.map((c) => ({
        idTelaProveedor,
        idColor: c.idColor,
        ...(c.precio === undefined ? {} : { precio: c.precio }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const c of aActualizar) {
    await tx.telaProveedorColor.update({
      where: { idTelaProveedor_idColor: { idTelaProveedor, idColor: c.idColor } },
      data: { precio: c.precio ?? null, ...datosModificacion(sesion) },
    });
  }
  return true;
}

/**
 * Lista los proveedores de una tela con su precio y su grid de precio por color (R17).
 * Requiere `telas.ver`. Exige que la tela exista. Devuelve activos e inactivos (la UI de
 * administración decide si muestra los desactivados), ordenados por nombre de proveedor.
 */
export async function listarProveedoresDeTela(
  sesion: SesionUsuario,
  idTela: number,
  bd?: ContextoBd,
): Promise<TelaProveedorConColores[]> {
  verificarPermiso(sesion, 'telas.ver');
  const cliente = clienteLectura(bd);
  const tela = await cliente.tela.findUnique({ where: { id: idTela }, select: { id: true } });
  if (tela === null) {
    throw new ErrorNoEncontrado('Tela', idTela);
  }
  return cliente.telaProveedor.findMany({
    where: { idTela },
    include: incluirProveedorYColores,
    orderBy: { proveedor: { nombre: 'asc' } },
  });
}

/**
 * Obtiene un proveedor de tela por su `id` (con proveedor y grid de colores) exigiendo que
 * PERTENEZCA a la tela de la URL. Requiere `telas.ver`. Lanza `ErrorNoEncontrado` si no
 * existe o es de otra tela.
 */
export async function obtenerTelaProveedor(
  sesion: SesionUsuario,
  idTela: number,
  idTelaProveedor: number,
  bd?: ContextoBd,
): Promise<TelaProveedorConColores> {
  verificarPermiso(sesion, 'telas.ver');
  const fila = await clienteLectura(bd).telaProveedor.findUnique({
    where: { id: idTelaProveedor },
    include: incluirProveedorYColores,
  });
  if (fila === null || fila.idTela !== idTela) {
    throw new ErrorNoEncontrado('TelaProveedor', idTelaProveedor);
  }
  return fila;
}

/**
 * Crea un proveedor de tela con su grid de precio por color en UNA transacción (A2).
 * Reglas: permiso `telas.administrar`; la tela existe; el proveedor existe y está ACTIVO;
 * único por tela → `ErrorConflicto`; colores existentes y ACTIVOS, sin repetir (grid ≥0);
 * nace activo; auditoría y bitácora en la misma transacción (A7).
 *
 * @example
 * const tp = await crearTelaProveedor(sesion, idTela, {
 *   idProveedor: 3, precio: 95, manejaPrecioPorColor: true,
 *   colores: [{ idColor: idNegro, precio: 98 }, { idColor: idBlanco, precio: 92 }],
 * });
 */
export async function crearTelaProveedor(
  sesion: SesionUsuario,
  idTela: number,
  entrada: EntradaCrearTelaProveedor,
  bd?: ContextoBd,
): Promise<TelaProveedorConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaTelaProveedorCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirTelaExiste(tx, idTela);
      await exigirProveedorValido(tx, datos.idProveedor);
      await exigirProveedorLibre(tx, idTela, datos.idProveedor);

      const creado = await tx.telaProveedor.create({
        data: {
          idTela,
          idProveedor: datos.idProveedor,
          manejaPrecioPorColor: datos.manejaPrecioPorColor,
          ...(datos.precio === undefined ? {} : { precio: datos.precio }),
          ...(datos.condiciones === undefined || datos.condiciones === ''
            ? {}
            : { condiciones: datos.condiciones }),
          ...datosCreacion(sesion),
        },
      });

      await sincronizarColores(tx, sesion, creado.id, datos.colores ?? []);

      await registrarBitacora(tx, sesion, {
        entidad: 'TelaProveedor',
        idEntidad: creado.id,
        accion: 'CREAR',
        datos: {
          idTela,
          idProveedor: datos.idProveedor,
          manejaPrecioPorColor: datos.manejaPrecioPorColor,
          colores: (datos.colores ?? []).map((c) => ({
            idColor: c.idColor,
            precio: c.precio ?? null,
          })),
        },
      });

      return tx.telaProveedor.findUniqueOrThrow({
        where: { id: creado.id },
        include: incluirProveedorYColores,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Este proveedor ya está asignado a la tela.', { causa: error });
    }
    throw error;
  }
}

/**
 * Actualiza un proveedor de tela: proveedor, precio, `manejaPrecioPorColor`, condiciones,
 * grid de colores y/o `activo` para desactivar (borrado suave) o reactivar. Todo en UNA
 * transacción (A2). El renglón debe PERTENECER a la tela de la URL (`ErrorNoEncontrado`).
 *
 * Semántica del PATCH parcial (M1): campo omitido = no tocar; `precio`/`condiciones` en
 * `null` (o texto vacío) = vaciar. `colores`: si NO viene, no se toca; si viene (incluso
 * `[]`), REEMPLAZA el grid con diff. Si cambia `idProveedor` o se reactiva, se revalida la
 * unicidad `[idTela, idProveedor]`. Bitácora según lo que pasó (`MODIFICAR` y/o
 * `DESACTIVAR`).
 */
export async function actualizarTelaProveedor(
  sesion: SesionUsuario,
  idTela: number,
  entrada: EntradaActualizarTelaProveedor,
  bd?: ContextoBd,
): Promise<TelaProveedorConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaTelaProveedorEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirTelaProveedorDeTela(tx, idTela, datos.id);

      const cambiaProveedor =
        datos.idProveedor !== undefined && datos.idProveedor !== actual.idProveedor;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      const cambios: Prisma.TelaProveedorUpdateInput = { ...datosModificacion(sesion) };
      const detalle: Record<string, unknown> = {};

      // Proveedor: si cambia, revalida existencia/activo y unicidad de la nueva pareja.
      if (cambiaProveedor && datos.idProveedor !== undefined) {
        await exigirProveedorValido(tx, datos.idProveedor);
        await exigirProveedorLibre(tx, idTela, datos.idProveedor, datos.id);
        cambios.proveedor = { connect: { id: datos.idProveedor } };
        detalle.idProveedor = { de: actual.idProveedor, a: datos.idProveedor };
      } else if (reactiva) {
        // Reactivar puede chocar con otro renglón vigente de la misma pareja.
        await exigirProveedorLibre(tx, idTela, actual.idProveedor, datos.id);
      }

      // precio (decimal nullable): omitir = no tocar; `null` = vaciar; número = fijar.
      if (cambiaDecimal(datos.precio, actual.precio)) {
        const nuevo = datos.precio ?? null;
        cambios.precio = nuevo;
        detalle.precio = { de: actual.precio === null ? null : actual.precio.toNumber(), a: nuevo };
      }

      // manejaPrecioPorColor (bandera): omitir = no tocar.
      if (
        datos.manejaPrecioPorColor !== undefined &&
        datos.manejaPrecioPorColor !== actual.manejaPrecioPorColor
      ) {
        cambios.manejaPrecioPorColor = datos.manejaPrecioPorColor;
        detalle.manejaPrecioPorColor = {
          de: actual.manejaPrecioPorColor,
          a: datos.manejaPrecioPorColor,
        };
      }

      // condiciones (texto nullable): omitir = no tocar; `null`/'' = vaciar (a null).
      if (datos.condiciones !== undefined) {
        const crudo = datos.condiciones;
        const nuevo = crudo === null || crudo === '' ? null : crudo;
        if (nuevo !== actual.condiciones) {
          cambios.condiciones = nuevo;
          detalle.condiciones = { de: actual.condiciones, a: nuevo };
        }
      }

      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      // Colores: solo se tocan si vienen en el payload (omitir = no tocar). Grid ≥0.
      const cambiaColores =
        datos.colores !== undefined
          ? await sincronizarColores(tx, sesion, datos.id, datos.colores)
          : false;

      const huboCambioEscalar =
        cambiaProveedor || Object.keys(detalle).length > 0 || reactiva || desactiva;

      if (!huboCambioEscalar && !cambiaColores) {
        return tx.telaProveedor.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirProveedorYColores,
        });
      }

      // Siempre deja constancia (al menos modificadoPorId/En), aunque solo cambien colores.
      await tx.telaProveedor.update({ where: { id: datos.id }, data: cambios });

      const registraModificar =
        cambiaProveedor || Object.keys(detalle).length > 0 || reactiva || cambiaColores;
      if (registraModificar) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TelaProveedor',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...detalle,
            ...(cambiaColores
              ? {
                  colores: datos.colores?.map((c) => ({
                    idColor: c.idColor,
                    precio: c.precio ?? null,
                  })),
                }
              : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TelaProveedor',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { idTela, idProveedor: actual.idProveedor },
        });
      }

      return tx.telaProveedor.findUniqueOrThrow({
        where: { id: datos.id },
        include: incluirProveedorYColores,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Este proveedor ya está asignado a la tela.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un proveedor de tela: deja de contar pero su historial y su
 * grid quedan intactos. Desactivar dos veces es `ErrorConflicto`. Atajo del botón
 * "Desactivar". Exige que el renglón pertenezca a la tela de la URL.
 */
export async function desactivarTelaProveedor(
  sesion: SesionUsuario,
  idTela: number,
  idTelaProveedor: number,
  bd?: ContextoBd,
): Promise<TelaProveedorConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTelaProveedorDeTela(tx, idTela, idTelaProveedor);
    if (!actual.activo) {
      throw new ErrorConflicto('Este proveedor de la tela ya está desactivado.');
    }
    return actualizarTelaProveedor(sesion, idTela, { id: idTelaProveedor, activo: false }, { tx });
  }, bd);
}

/** Reactiva un proveedor de tela desactivado (operación inversa del borrado suave). */
export async function reactivarTelaProveedor(
  sesion: SesionUsuario,
  idTela: number,
  idTelaProveedor: number,
  bd?: ContextoBd,
): Promise<TelaProveedorConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTelaProveedorDeTela(tx, idTela, idTelaProveedor);
    if (actual.activo) {
      throw new ErrorConflicto('Este proveedor de la tela ya está activo.');
    }
    return actualizarTelaProveedor(sesion, idTela, { id: idTelaProveedor, activo: true }, { tx });
  }, bd);
}
