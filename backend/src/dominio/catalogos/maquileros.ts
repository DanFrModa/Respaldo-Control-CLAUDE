/**
 * Maquileros — catálogo maestro GLOBAL (F1-E2, PIEZA A — Maquila unificada).
 *
 * UNIFICA los Maquileros (costura) y los Estampadores (estampado/aplicación) del
 * sistema viejo en un solo catálogo (doc `Documentacion_MJD/03-Produccion.md` §Paso 4
 * Entrega a maquilero y §Flujo paralelo Estampado/Aplicación). Las CAPACIDADES de cada
 * maquilero (costura, estampado, bordado, lavado, aplicación) se modelan N:N a
 * `TipoProceso` (maquila unificada, PLANMAESTRO §4) — NO como tablas separadas. Es el
 * cimiento de EsMa/CxP (F6/F8).
 *
 * Replica EXACTAMENTE el patrón N:N de `dominio/catalogos/proveedores.ts`
 * (Proveedor↔RolProveedor): el maquilero y su set de `tipos` se crean/editan en UNA
 * transacción (A2) sincronizando el puente con un diff mínimo; se exige ≥1 tipo (en
 * alta y al reemplazar el set en edición); solo se asignan tipos ACTIVOS. Como todo
 * catálogo F1 es GLOBAL (ADR-0007, A9), no hay empresa activa: la unicidad de `corto`
 * es global (`@unique`, insensible a mayúsculas).
 *
 * Piezas del patrón conservadas (PLANMAESTRO §9.2): permiso primero
 * (`maquileros.ver`/`.administrar`); Zod compartido de `src/contrato`; todo cambio en
 * UNA transacción (A2) con auditoría (A7) + `Bitacora` juntos o nada; borrado SUAVE
 * reversible (`activo`); unicidad validada en la transacción y respaldada por el unique
 * de la base (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import { esquemaMaquileroCrear, esquemaMaquileroEditar } from '../../contrato/index.js';
import type { Maquilero, Prisma, TipoProceso } from '../../datos/index.js';
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

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearMaquilero = z.input<typeof esquemaMaquileroCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarMaquilero = z.input<typeof esquemaMaquileroEditar>;

/**
 * Parámetros del listado a nivel DOMINIO. A diferencia del esquema de querystring del
 * contrato (`esquemaListarMaquileros`, que coacciona texto→número/boolean porque viene de
 * la URL), aquí los tipos ya son nativos: `incluirInactivos` es boolean y `tipoProceso`
 * un número. La ruta REST le pasa `request.query` ya coaccionado (output del contrato),
 * y los tests pasan valores nativos. Mismo patrón que `esquemaListarProveedores`.
 */
const esquemaListarMaquilerosDominio = esquemaPaginacion.extend({
  /** Texto a buscar en el código corto o el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(200).optional(),
  /** Filtra por id de tipo de proceso (una de sus capacidades). */
  tipoProceso: z.number().int().positive().optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['corto', 'nombre', 'creadoEn']).default('corto'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export type ParametrosListarMaquileros = z.input<typeof esquemaListarMaquilerosDominio>;

/** Maquilero con sus tipos de proceso cargados (forma que consume la ruta para la salida). */
export type MaquileroConTipos = Maquilero & {
  tipos: { tipoProceso: Pick<TipoProceso, 'id' | 'codigo' | 'nombre'> }[];
};

/** `include` estándar para traer los tipos de proceso junto al maquilero. */
const incluirTipos = {
  tipos: {
    select: { tipoProceso: { select: { id: true, codigo: true, nombre: true } } },
    orderBy: { tipoProceso: { nombre: 'asc' } },
  },
} satisfies Prisma.MaquileroInclude;

/** Campos de TEXTO opcionales editables (clave del payload === clave del modelo). */
const CAMPOS_TEXTO_EDITABLES = [
  'apellidos',
  'telefonos',
  'direccion',
  'observaciones',
  'obsPago',
] as const;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos maquileros con el mismo
 * `corto`, sin importar mayúsculas ("Intersew" ≡ "intersew"). Se valida DENTRO de la
 * transacción; la carrera residual la captura el unique de la base (P2002 →
 * `ErrorConflicto`). El mensaje distingue si el existente está activo o desactivado.
 */
async function exigirCortoLibre(tx: Tx, corto: string, idActual?: number): Promise<void> {
  const existente = await tx.maquilero.findFirst({
    where: {
      corto: { equals: corto, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un maquilero con el código "${corto}".`
        : `Ya existe un maquilero con el código "${corto}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un maquilero por id o lanza `ErrorNoEncontrado`. */
async function exigirMaquilero(tx: Tx, id: number): Promise<Maquilero> {
  const maquilero = await tx.maquilero.findUnique({ where: { id } });
  if (maquilero === null) {
    throw new ErrorNoEncontrado('Maquilero', id);
  }
  return maquilero;
}

/**
 * Valida que todos los `idsTipos` existan y estén ACTIVOS (no se puede asignar un tipo
 * desactivado). Lanza `ErrorValidacion` si alguno no existe o está inactivo (mensaje
 * claro para la UI). Mismo criterio que `exigirRolesValidos` del proveedor.
 */
async function exigirTiposValidos(tx: Tx, idsTipos: number[]): Promise<TipoProceso[]> {
  const unicos = [...new Set(idsTipos)];
  const tipos = await tx.tipoProceso.findMany({ where: { id: { in: unicos } } });
  if (tipos.length !== unicos.length) {
    throw new ErrorValidacion('Uno o más tipos de proceso seleccionados no existen.');
  }
  const inactivo = tipos.find((tipo) => !tipo.activo);
  if (inactivo !== undefined) {
    throw new ErrorValidacion(
      `El tipo de proceso "${inactivo.nombre}" está desactivado y no se puede asignar.`,
    );
  }
  return tipos;
}

/**
 * Reemplaza el conjunto de tipos de proceso de un maquilero DENTRO de la transacción
 * (A2): borra los que sobran y crea los que faltan (diff mínimo, sin duplicar). Exige
 * ≥1 tipo resultante. Devuelve true si hubo algún cambio (para la bitácora). Calca
 * `sincronizarRoles` del proveedor.
 */
async function sincronizarTipos(
  tx: Tx,
  sesion: SesionUsuario,
  idMaquilero: number,
  idsDeseados: number[],
): Promise<boolean> {
  const unicos = [...new Set(idsDeseados)];
  if (unicos.length === 0) {
    throw new ErrorValidacion('El maquilero debe tener al menos un tipo de proceso.');
  }
  await exigirTiposValidos(tx, unicos);

  const actuales = await tx.maquileroTipoProceso.findMany({
    where: { idMaquilero },
    select: { idTipoProceso: true },
  });
  const setActual = new Set(actuales.map((t) => t.idTipoProceso));
  const setDeseado = new Set(unicos);

  const aQuitar = [...setActual].filter((id) => !setDeseado.has(id));
  const aAgregar = [...setDeseado].filter((id) => !setActual.has(id));

  if (aQuitar.length === 0 && aAgregar.length === 0) {
    return false;
  }
  if (aQuitar.length > 0) {
    await tx.maquileroTipoProceso.deleteMany({
      where: { idMaquilero, idTipoProceso: { in: aQuitar } },
    });
  }
  if (aAgregar.length > 0) {
    await tx.maquileroTipoProceso.createMany({
      data: aAgregar.map((idTipoProceso) => ({
        idMaquilero,
        idTipoProceso,
        creadoPorId: sesion.id,
      })),
    });
  }
  return true;
}

/** Construye el `data` de los campos opcionales presentes en el alta (solo los definidos). */
function datosOpcionalesCrear(
  datos: z.output<typeof esquemaMaquileroCrear>,
): Partial<Prisma.MaquileroCreateInput> {
  const data: Partial<Prisma.MaquileroCreateInput> = {};
  if (datos.apellidos !== undefined) data.apellidos = datos.apellidos;
  if (datos.telefonos !== undefined) data.telefonos = datos.telefonos;
  if (datos.direccion !== undefined) data.direccion = datos.direccion;
  if (datos.observaciones !== undefined) data.observaciones = datos.observaciones;
  if (datos.obsPago !== undefined) data.obsPago = datos.obsPago;
  if (datos.asegurado !== undefined) data.asegurado = datos.asegurado;
  return data;
}

/**
 * Aplica los campos opcionales que VENGAN en la edición al `update` y registra qué
 * cambió (para la bitácora). Semántica del PATCH parcial (M1):
 *   - campo OMITIDO (`undefined`) → no se toca.
 *   - texto en `null` (o que queda vacío) → se BORRA (a `null`); NUNCA se escribe `''`.
 *   - campo con valor → se guarda si difiere del actual.
 *   - `asegurado` (bandera) → omitir = no tocar; el formulario la manda como boolean.
 * Devuelve el detalle de cambios para la bitácora.
 */
function aplicarOpcionalesEditar(
  datos: z.output<typeof esquemaMaquileroEditar>,
  actual: Maquilero,
  cambios: Prisma.MaquileroUpdateInput,
): Record<string, unknown> {
  const detalle: Record<string, unknown> = {};

  // Textos: omitir = no tocar; vacío/`null` = borrar (normalizado a null, nunca '').
  for (const campo of CAMPOS_TEXTO_EDITABLES) {
    const crudo = datos[campo];
    if (crudo === undefined) {
      continue;
    }
    const nuevo = crudo === null || crudo === '' ? null : crudo;
    const anterior = actual[campo];
    if (nuevo !== anterior) {
      (cambios as Record<string, unknown>)[campo] = nuevo;
      detalle[campo] = { de: anterior, a: nuevo };
    }
  }

  // `asegurado` (bandera): omitir = no tocar (no es nullable; el formulario manda boolean).
  if (datos.asegurado !== undefined && datos.asegurado !== actual.asegurado) {
    cambios.asegurado = datos.asegurado;
    detalle.asegurado = { de: actual.asegurado, a: datos.asegurado };
  }

  return detalle;
}

/**
 * Crea un maquilero (catálogo global) con sus tipos de proceso en UNA transacción (A2).
 * Reglas: permiso `maquileros.administrar`; `corto` único global → `ErrorConflicto`;
 * **≥1 tipo** de proceso (capacidades), todos ACTIVOS; nace activo; auditoría y bitácora
 * en la misma transacción (A7).
 *
 * @example
 * const m = await crearMaquilero(sesion, {
 *   corto: "Intersew", nombre: "Intersew", apellidos: "A", tipos: [idCostura],
 * });
 */
export async function crearMaquilero(
  sesion: SesionUsuario,
  entrada: EntradaCrearMaquilero,
  bd?: ContextoBd,
): Promise<MaquileroConTipos> {
  verificarPermiso(sesion, 'maquileros.administrar');
  const datos = validarEntrada(esquemaMaquileroCrear, entrada);
  if (datos.tipos.length === 0) {
    throw new ErrorValidacion('El maquilero debe tener al menos un tipo de proceso.');
  }

  try {
    return await enTransaccion(async (tx) => {
      await exigirCortoLibre(tx, datos.corto);

      const maquilero = await tx.maquilero.create({
        data: {
          corto: datos.corto,
          nombre: datos.nombre,
          ...datosOpcionalesCrear(datos),
          ...datosCreacion(sesion),
        },
      });

      await sincronizarTipos(tx, sesion, maquilero.id, datos.tipos);

      await registrarBitacora(tx, sesion, {
        entidad: 'Maquilero',
        idEntidad: maquilero.id,
        accion: 'CREAR',
        datos: { corto: maquilero.corto, nombre: maquilero.nombre, tipos: datos.tipos },
      });

      return tx.maquilero.findUniqueOrThrow({
        where: { id: maquilero.id },
        include: incluirTipos,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un maquilero con el código "${datos.corto}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un maquilero: datos generales, tipos de proceso y/o `activo` para desactivar
 * (borrado suave) o reactivar — la forma exacta del esquema compartido
 * `esquemaMaquileroEditar`. Todo en UNA transacción (A2).
 *
 * Tipos: si `tipos` NO viene, no se tocan; si viene (cualquier arreglo), reemplaza el
 * set y exige ≥1 (no puede quedar en 0). Bitácora según lo que pasó: `MODIFICAR` con el
 * detalle de campos, y/o `DESACTIVAR` si el cambio apagó el maquilero.
 */
export async function actualizarMaquilero(
  sesion: SesionUsuario,
  entrada: EntradaActualizarMaquilero,
  bd?: ContextoBd,
): Promise<MaquileroConTipos> {
  verificarPermiso(sesion, 'maquileros.administrar');
  const datos = validarEntrada(esquemaMaquileroEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirMaquilero(tx, datos.id);

      const cambiaCorto = datos.corto !== undefined && datos.corto !== actual.corto;
      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      const cambios: Prisma.MaquileroUpdateInput = { ...datosModificacion(sesion) };
      const detalleOpcionales = aplicarOpcionalesEditar(datos, actual, cambios);
      if (cambiaCorto && datos.corto !== undefined) {
        cambios.corto = datos.corto;
      }
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      // Al cambiar el corto o al reactivar puede chocar con un corto vigente.
      if (cambiaCorto) {
        await exigirCortoLibre(tx, datos.corto ?? actual.corto, datos.id);
      } else if (reactiva) {
        await exigirCortoLibre(tx, actual.corto, datos.id);
      }

      // Tipos: solo se tocan si vienen en el payload (omitir = no tocar). El set
      // resultante debe tener ≥1 (lo exige `sincronizarTipos`).
      const cambiaTipos =
        datos.tipos !== undefined
          ? await sincronizarTipos(tx, sesion, datos.id, datos.tipos)
          : false;

      const huboCambioEscalar =
        cambiaCorto ||
        cambiaNombre ||
        Object.keys(detalleOpcionales).length > 0 ||
        reactiva ||
        desactiva;

      if (!huboCambioEscalar && !cambiaTipos) {
        return tx.maquilero.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirTipos,
        });
      }

      if (huboCambioEscalar) {
        // `cambios` ya trae corto/nombre/opcionales/activo + auditoría según corresponda.
        await tx.maquilero.update({ where: { id: datos.id }, data: cambios });
      } else if (cambiaTipos) {
        // Solo cambiaron tipos: deja constancia de la modificación (modificadoPorId/En).
        await tx.maquilero.update({
          where: { id: datos.id },
          data: { ...datosModificacion(sesion) },
        });
      }

      if (
        cambiaCorto ||
        cambiaNombre ||
        Object.keys(detalleOpcionales).length > 0 ||
        reactiva ||
        cambiaTipos
      ) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Maquilero',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaCorto ? { corto: { de: actual.corto, a: datos.corto } } : {}),
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: datos.nombre } } : {}),
            ...detalleOpcionales,
            ...(cambiaTipos ? { tipos: datos.tipos } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Maquilero',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { corto: actual.corto, nombre: actual.nombre },
        });
      }

      return tx.maquilero.findUniqueOrThrow({
        where: { id: datos.id },
        include: incluirTipos,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un maquilero con ese código.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un maquilero: deja de aparecer en capturas pero su historial
 * queda intacto. Desactivar dos veces es `ErrorConflicto` (la pantalla estaba
 * desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarMaquilero(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<MaquileroConTipos> {
  verificarPermiso(sesion, 'maquileros.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirMaquilero(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El maquilero "${actual.corto}" ya está desactivado.`);
    }
    return actualizarMaquilero(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un maquilero desactivado (operación inversa del borrado suave). */
export async function reactivarMaquilero(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<MaquileroConTipos> {
  verificarPermiso(sesion, 'maquileros.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirMaquilero(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El maquilero "${actual.corto}" ya está activo.`);
    }
    return actualizarMaquilero(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un maquilero por id (con sus tipos) o lanza `ErrorNoEncontrado`. */
export async function obtenerMaquilero(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<MaquileroConTipos> {
  verificarPermiso(sesion, 'maquileros.ver');
  const maquilero = await clienteLectura(bd).maquilero.findUnique({
    where: { id },
    include: incluirTipos,
  });
  if (maquilero === null) {
    throw new ErrorNoEncontrado('Maquilero', id);
  }
  return maquilero;
}

/**
 * Lista maquileros con búsqueda, orden y paginación EN SERVIDOR (la tabla de la UI nunca
 * trae todo para filtrar en memoria). Por defecto: solo activos. Permite filtrar por
 * `tipoProceso` (una de sus capacidades). La búsqueda cubre `corto` O `nombre`.
 *
 * @example
 * const pagina = await listarMaquileros(sesion, { tipoProceso: idCostura, busqueda: "inter" });
 */
export async function listarMaquileros(
  sesion: SesionUsuario,
  parametros: ParametrosListarMaquileros = {},
  bd?: ContextoBd,
): Promise<Pagina<MaquileroConTipos>> {
  verificarPermiso(sesion, 'maquileros.ver');
  const filtros = validarEntrada(esquemaListarMaquilerosDominio, parametros);

  const where: Prisma.MaquileroWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.tipoProceso === undefined
      ? {}
      : { tipos: { some: { idTipoProceso: filtros.tipoProceso } } }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { corto: { contains: filtros.busqueda, mode: 'insensitive' } },
            { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.maquilero.count({ where }),
    cliente.maquilero.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirTipos,
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}

// ── Tipos de proceso (catálogo selector, maquila unificada PLANMAESTRO §4) ─────

/**
 * Lista los tipos de proceso para el selector de capacidades de la ficha. Por defecto
 * solo los activos (los inactivos no se pueden asignar). Requiere `maquileros.ver`
 * (mismo criterio que `roles-proveedor` con `proveedores.ver` en E1B: `tipos-proceso`
 * no lleva permiso propio; su ABM fino queda diferido).
 */
export async function listarTiposProceso(
  sesion: SesionUsuario,
  opciones: { incluirInactivos?: boolean } = {},
  bd?: ContextoBd,
): Promise<TipoProceso[]> {
  verificarPermiso(sesion, 'maquileros.ver');
  return clienteLectura(bd).tipoProceso.findMany({
    where: opciones.incluirInactivos === true ? {} : { activo: true },
    orderBy: { nombre: 'asc' },
  });
}
