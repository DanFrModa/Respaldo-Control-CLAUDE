/**
 * Almacenes — CRUD PATRÓN de CONTROL v2.
 *
 * Este servicio fija el estándar que replica todo catálogo del sistema
 * (PLANMAESTRO §6 F0: "un CRUD patrón completo (p. ej. Almacenes) que fija el
 * estándar"; doc funcional 04-Inventarios: los almacenes separan PT y telas
 * por ubicación; aquí se unifican como base del kardex único D3). Las piezas
 * del patrón:
 *
 * 1. **Permiso primero** (`verificarPermiso`): el servidor decide, la
 *    pantalla solo esconde (PLANMAESTRO §9.2). `almacenes.ver` para leer,
 *    `almacenes.administrar` para mutar.
 * 2. **Zod en toda entrada** con el esquema COMPARTIDO de `src/contrato`
 *    (`esquemaAlmacenCrear`/`esquemaAlmacenEditar`): la misma validación en
 *    el formulario y en el servidor, mensajes en español.
 * 3. **Todo cambio en UNA transacción** (`enTransaccion`, A2): regla de
 *    unicidad + escritura + auditoría de la fila + `Bitacora` (A7), juntos o
 *    nada.
 * 4. **Borrado SUAVE** (`activo=false`, PLANMAESTRO §4): el historial de
 *    movimientos del almacén es intocable.
 * 5. **Multi-empresa explícito** (A9): por defecto se opera sobre la empresa
 *    activa de la sesión; los almacenes globales (heredados, `idEmpresa`
 *    null) se ven junto a los propios.
 * 6. **Errores de dominio**: la ruta REST mapea por `codigo`, jamás por
 *    mensaje.
 * 7. **Listado paginado estándar** (`Pagina<T>`): búsqueda + orden +
 *    paginación EN SERVIDOR.
 */
import { esquemaAlmacenCrear, esquemaAlmacenEditar, TIPOS_ALMACEN } from '../../contrato/index.js';
import type { Almacen, Prisma } from '../../datos/index.js';
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

/**
 * CÓDIGO del rol de proveedor que habilita a un tercero como cortador (§Post-F9.13). Es la clave
 * estable que siembra el seed (`ROLES_PROVEEDOR_BASE`), no el nombre —que se puede editar—.
 */
const COD_ROL_CORTE = 'corte';

/**
 * Lo que devuelve el servicio: la fila de `Almacen` más el CORTADOR ligado ya resuelto
 * (§Post-F9.13). Se incluye el nombre para que la UI lo pinte sin una segunda consulta.
 */
export type AlmacenConCortador = Almacen & { cortador: { id: number; nombre: string } | null };

/** `include` compartido por todas las lecturas/escrituras del servicio. */
const INCLUIR_CORTADOR = { cortador: { select: { id: true, nombre: true } } } as const;

/** Alta: campos del esquema compartido (`idEmpresa` ausente = empresa activa). */
export type EntradaCrearAlmacen = z.input<typeof esquemaAlmacenCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarAlmacen = z.input<typeof esquemaAlmacenEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarAlmacenes = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(100).optional(),
  /** Filtrar por tipo de almacén. */
  tipo: z.enum(TIPOS_ALMACEN).optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  /** `true` lista los almacenes de TODAS las empresas (vista de administración). */
  todasLasEmpresas: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'tipo', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarAlmacenes = z.input<typeof esquemaListarAlmacenes>;

/** Visibilidad estándar (A9): lo de la empresa activa + lo global heredado. */
function filtroEmpresaActiva(sesion: SesionUsuario): Prisma.AlmacenWhereInput {
  return { OR: [{ idEmpresa: sesion.idEmpresaActiva }, { idEmpresa: null }] };
}

/**
 * Unicidad de negocio: no puede haber dos almacenes con el mismo nombre
 * visibles a la vez (misma empresa o globales), sin importar mayúsculas
 * ("Bodega PT" ≡ "bodega pt"). Se valida DENTRO de la transacción; la carrera
 * residual la captura el unique de la base (P2002 → `ErrorConflicto`), que
 * cubre el caso exacto por empresa.
 */
async function exigirNombreLibre(
  tx: Tx,
  idEmpresa: number | null,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.almacen.findFirst({
    where: {
      OR: [{ idEmpresa }, { idEmpresa: null }],
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un almacén llamado "${nombre}" en esta empresa.`
        : `Ya existe un almacén llamado "${nombre}" en esta empresa (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un almacén VISIBLE para la sesión (A9) o lanza `ErrorNoEncontrado`. */
async function exigirAlmacen(
  tx: Tx,
  sesion: SesionUsuario,
  id: number,
): Promise<AlmacenConCortador> {
  const almacen = await tx.almacen.findFirst({
    where: { id, ...filtroEmpresaActiva(sesion) },
    include: INCLUIR_CORTADOR,
  });
  if (almacen === null) {
    throw new ErrorNoEncontrado('Almacen', id);
  }
  return almacen;
}

/**
 * Valida la liga almacén → CORTADOR (§Post-F9.13). Tres reglas, todas server-side (A4: la
 * pantalla solo esconde) y con mensajes que dicen QUÉ hacer, no solo que algo falló:
 *
 *  1. **Solo almacenes de TELA.** El cortador existe para que la descarga de tela salga de su
 *     bodega; en un almacén de PT o de avíos la liga no significaría nada.
 *  2. **El tercero debe ser un cortador de verdad** (activo y con el rol `corte`). Si no, el
 *     mensaje dice dónde marcarle la casilla en vez de dejar al usuario adivinando.
 *  3. **Un cortador, un almacén.** La unicidad también vive en la BD (índice único), pero aquí se
 *     detecta antes para poder NOMBRAR el almacén que ya lo tiene — el P2002 pelado no puede.
 */
async function exigirCortadorValido(
  tx: Tx,
  idCortador: number,
  tipoEfectivo: string,
  idAlmacenActual?: number,
): Promise<void> {
  if (tipoEfectivo !== 'TELA') {
    throw new ErrorValidacion(
      'Solo un almacén de TELAS puede ligarse a un cortador: la liga sirve para descargar la tela de su bodega.',
    );
  }

  const proveedor = await tx.proveedor.findUnique({
    where: { id: idCortador },
    select: {
      nombre: true,
      activo: true,
      roles: { select: { rol: { select: { codigo: true } } } },
    },
  });
  if (proveedor === null) {
    throw new ErrorValidacion(`El cortador ${String(idCortador)} no existe.`);
  }
  if (!proveedor.activo) {
    throw new ErrorValidacion(`El proveedor "${proveedor.nombre}" está desactivado.`);
  }
  if (!proveedor.roles.some((r) => r.rol.codigo === COD_ROL_CORTE)) {
    throw new ErrorValidacion(
      `"${proveedor.nombre}" no está marcado como cortador. Márcale el rol "Corte" en su ficha de proveedor y vuelve a intentarlo.`,
    );
  }

  const ocupado = await tx.almacen.findFirst({
    where: {
      idCortador,
      ...(idAlmacenActual === undefined ? {} : { id: { not: idAlmacenActual } }),
    },
    select: { nombre: true },
  });
  if (ocupado !== null) {
    throw new ErrorConflicto(
      `El cortador "${proveedor.nombre}" ya está ligado al almacén "${ocupado.nombre}". Un cortador solo puede tener un almacén: quítaselo a ese primero.`,
    );
  }
}

/**
 * Crea un almacén. Si la entrada no trae `idEmpresa`, nace en la empresa
 * activa de la sesión (A9); con `idEmpresa` explícito (vista de
 * administración) se valida que esa empresa exista y esté activa.
 *
 * Reglas: permiso `almacenes.administrar`; nombre único entre los almacenes
 * visibles de la empresa → `ErrorConflicto`; nace activo; auditoría y
 * bitácora en la misma transacción (A2/A7).
 *
 * @example
 * const almacen = await crearAlmacen(sesion, { nombre: "Bodega PT", tipo: "PT" });
 */
export async function crearAlmacen(
  sesion: SesionUsuario,
  entrada: EntradaCrearAlmacen,
  bd?: ContextoBd,
): Promise<AlmacenConCortador> {
  verificarPermiso(sesion, 'almacenes.administrar');
  const datos = validarEntrada(esquemaAlmacenCrear, entrada);
  const idEmpresa = datos.idEmpresa ?? sesion.idEmpresaActiva;
  const idCortador = datos.idCortador ?? null;

  try {
    return await enTransaccion(async (tx) => {
      const empresa = await tx.empresa.findUnique({
        where: { id: idEmpresa },
        select: { activa: true },
      });
      if (empresa?.activa !== true) {
        throw new ErrorValidacion(`La empresa ${String(idEmpresa)} no existe o está desactivada.`);
      }
      await exigirNombreLibre(tx, idEmpresa, datos.nombre);
      if (idCortador !== null) {
        await exigirCortadorValido(tx, idCortador, datos.tipo);
      }

      const almacen = await tx.almacen.create({
        data: {
          nombre: datos.nombre,
          tipo: datos.tipo,
          idEmpresa,
          idCortador,
          ...datosCreacion(sesion),
        },
        include: INCLUIR_CORTADOR,
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Almacen',
        idEntidad: almacen.id,
        accion: 'CREAR',
        datos: {
          nombre: almacen.nombre,
          tipo: almacen.tipo,
          idEmpresa,
          ...(idCortador === null ? {} : { cortador: almacen.cortador?.nombre ?? idCortador }),
        },
      });

      return almacen;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un almacén llamado "${datos.nombre}" en esta empresa.`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un almacén de la empresa activa: nombre y/o tipo, y `activo` para
 * desactivar (borrado suave) o reactivar — la forma exacta del esquema
 * compartido `esquemaAlmacenEditar`. Un almacén NO se mueve de empresa: si la
 * entrada trae `idEmpresa` distinto del actual es `ErrorValidacion` (sus
 * movimientos de kardex son de esa empresa, D3/A9).
 *
 * Bitácora según lo que pasó: `MODIFICAR` con el detalle de campos, y/o
 * `DESACTIVAR` si el cambio apagó el almacén.
 */
export async function actualizarAlmacen(
  sesion: SesionUsuario,
  entrada: EntradaActualizarAlmacen,
  bd?: ContextoBd,
): Promise<AlmacenConCortador> {
  verificarPermiso(sesion, 'almacenes.administrar');
  const datos = validarEntrada(esquemaAlmacenEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirAlmacen(tx, sesion, datos.id);

      if (datos.idEmpresa !== undefined && datos.idEmpresa !== actual.idEmpresa) {
        throw new ErrorValidacion(
          'Un almacén no se puede mover de empresa: su historial de movimientos pertenece a ella.',
        );
      }

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaTipo = datos.tipo !== undefined && datos.tipo !== actual.tipo;
      const cambiaCortador =
        datos.idCortador !== undefined && datos.idCortador !== actual.idCortador;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !cambiaTipo && !cambiaCortador && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      // El cortador se valida contra el tipo QUE VA A QUEDAR, no contra el de antes.
      const tipoEfectivo = datos.tipo ?? actual.tipo;
      const cortadorEfectivo = cambiaCortador ? (datos.idCortador ?? null) : actual.idCortador;
      if (cortadorEfectivo !== null && (cambiaCortador || cambiaTipo)) {
        // Se revalida también cuando SOLO cambia el tipo: mover a PT/AVIO un almacén que ya tenía
        // cortador dejaría una liga sin sentido. El usuario debe quitarla primero (el mensaje de
        // `exigirCortadorValido` lo dice).
        await exigirCortadorValido(tx, cortadorEfectivo, tipoEfectivo, datos.id);
      }

      // Al cambiar nombre o al reactivar puede chocar con un nombre vigente.
      if (cambiaNombre) {
        await exigirNombreLibre(tx, actual.idEmpresa, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.idEmpresa, actual.nombre, datos.id);
      }

      // Cada bandera ya garantizó que su campo está definido; se arma el update
      // solo con lo que cambió (exactOptionalPropertyTypes: nada de `undefined`).
      const cambios: Prisma.AlmacenUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaTipo && datos.tipo !== undefined) {
        cambios.tipo = datos.tipo;
      }
      if (cambiaCortador) {
        // `null` DESLIGA (Prisma exige `disconnect` en una relación, no `{ connect: null }`).
        cambios.cortador =
          datos.idCortador === null || datos.idCortador === undefined
            ? { disconnect: true }
            : { connect: { id: datos.idCortador } };
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const almacen = await tx.almacen.update({
        where: { id: datos.id },
        data: cambios,
        include: INCLUIR_CORTADOR,
      });

      if (cambiaNombre || cambiaTipo || cambiaCortador || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Almacen',
          idEntidad: almacen.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: almacen.nombre } } : {}),
            ...(cambiaTipo ? { tipo: { de: actual.tipo, a: almacen.tipo } } : {}),
            ...(cambiaCortador
              ? {
                  cortador: {
                    de: actual.cortador?.nombre ?? null,
                    a: almacen.cortador?.nombre ?? null,
                  },
                }
              : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Almacen',
          idEntidad: almacen.id,
          accion: 'DESACTIVAR',
          datos: { nombre: almacen.nombre },
        });
      }

      return almacen;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un almacén con ese nombre en esta empresa.', {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un almacén: deja de aparecer en capturas pero su
 * historial queda intacto. Desactivar dos veces es `ErrorConflicto` (la
 * pantalla estaba desactualizada). Es el atajo explícito del botón
 * "Desactivar" sobre `actualizarAlmacen`.
 */
export async function desactivarAlmacen(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AlmacenConCortador> {
  verificarPermiso(sesion, 'almacenes.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirAlmacen(tx, sesion, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El almacén "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarAlmacen(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un almacén desactivado (operación inversa del borrado suave). */
export async function reactivarAlmacen(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AlmacenConCortador> {
  verificarPermiso(sesion, 'almacenes.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirAlmacen(tx, sesion, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El almacén "${actual.nombre}" ya está activo.`);
    }
    return actualizarAlmacen(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un almacén visible para la sesión o lanza `ErrorNoEncontrado`. */
export async function obtenerAlmacen(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AlmacenConCortador> {
  verificarPermiso(sesion, 'almacenes.ver');
  const almacen = await clienteLectura(bd).almacen.findFirst({
    where: { id, ...filtroEmpresaActiva(sesion) },
    include: INCLUIR_CORTADOR,
  });
  if (almacen === null) {
    throw new ErrorNoEncontrado('Almacen', id);
  }
  return almacen;
}

/**
 * Lista almacenes con búsqueda, orden y paginación EN SERVIDOR (la tabla de
 * la UI nunca trae todo para filtrar en memoria). Por defecto: los de la
 * empresa activa + globales, solo activos.
 *
 * @example
 * const pagina = await listarAlmacenes(sesion, { busqueda: "bodega", pagina: 1 });
 */
export async function listarAlmacenes(
  sesion: SesionUsuario,
  parametros: ParametrosListarAlmacenes = {},
  bd?: ContextoBd,
): Promise<Pagina<AlmacenConCortador>> {
  verificarPermiso(sesion, 'almacenes.ver');
  const filtros = validarEntrada(esquemaListarAlmacenes, parametros);

  const where: Prisma.AlmacenWhereInput = {
    ...(filtros.todasLasEmpresas ? {} : filtroEmpresaActiva(sesion)),
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.tipo === undefined ? {} : { tipo: filtros.tipo }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.almacen.count({ where }),
    cliente.almacen.findMany({
      where,
      include: INCLUIR_CORTADOR,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
