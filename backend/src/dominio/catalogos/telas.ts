/**
 * Telas — catálogo de materiales GLOBAL (F1-E3, PIEZA A — Telas unificadas, D5 — ADR-0009).
 *
 * Tres servicios:
 *
 *  • **`ServicioTelasCategorias`**: CRUD simple de `TelaCategoria` (réplica del patrón de
 *    Cortadores), con `nombre` único global (ADR-0007, A9) y borrado suave. SIN permiso
 *    propio: se gobierna con `telas.ver`/`telas.administrar` (ADR-0009, mismo criterio de
 *    sub-catálogo sin permiso propio que `TelaColor`). En la UI se lee "Tipo de tela"
 *    (§Post-F9.11) — el nombre técnico no cambia.
 *  • **`ServicioComposicionesTela`**: CRUD simple de `ComposicionTela` ("50% Algodón, 50%
 *    Poliéster"), catálogo NUEVO de la reestructura A1 (§Post-F9.11). Espejo exacto de
 *    `TelaCategoria`: único global, borrado suave, sin permiso propio (mismos
 *    `telas.ver`/`telas.administrar`, cero permisos nuevos: el deploy no requiere re-seed).
 *  • **`ServicioTelas`**: CRUD de la `Tela` UNIFICADA con su grid de colores. Los colores
 *    son HIJOS de la tela (§Post-F9.11 punto 3: nombre LIBRE + `pantone` + `precio` +
 *    `precioComplemento`; el catálogo global `Color` es SOLO el color de la PRENDA y aquí
 *    no participa). La tela y su set de `colores` se crean/editan EN UNA transacción (A2):
 *    calca `sincronizarTipos` del Maquilero con el diff por NOMBRE normalizado. A
 *    diferencia del maquilero, el grid PUEDE quedar VACÍO (una tela sin colores es
 *    válida).
 *
 * REESTRUCTURA A1 (§Post-F9.11, Daniel 6-ago-2026): la identidad de la tela son 4 datos —
 * tipo (la categoría) · composición (catálogo nuevo) · proveedor DUEÑO · nombre del
 * proveedor ("Felpa Suiza") — y el COMPLEMENTO (cardigan) es parte de la MISMA tela
 * (`nombreCuerpo`/`nombreComplemento`; NULL en el complemento = no lleva). El proveedor es
 * OBLIGATORIO en altas nuevas (lo exige el contrato); las 877 migradas vienen sin él y al
 * editarlas no se exige (el ETL usa `crearTelaMigracion`, la variante tipada SOLO para la
 * migración).
 *
 * 🔑 **Regla de diseño (ADR-0009): la tela del BOM y la del inventario son LA MISMA
 * entidad.** Esta tabla `telas` sirve a la vez al BOM del modelo (doc `01-Modelos.md` §2,
 * `TelasDis`) y al inventario de telas (doc `04-Inventarios.md` §B.2, `Telas`) — corrige
 * la dualidad Telas/TelasDis del viejo. En F4, `Lote`/`LoteComponente` colgarán de esta
 * `Tela` SIN retocarla: por eso aquí no se modela existencia ni lote, solo el catálogo.
 *
 * Colores de tela vs colores de PRENDA (§Post-F9.11): dar de alta "Marino Alsa 3040" en
 * una tela NO lo mete al catálogo de prenda (ni aparece en la matriz de la OP). La liga
 * `TelaColor.idColor` es LEGACY de las filas migradas de F1-E6 (el MRP/precosto la siguen
 * resolviendo y la fusión de colores duplicados la reasigna); las filas nuevas nacen con
 * NULL y su unicidad es POR TELA (insensible a mayúsculas — dos telas sí pueden tener cada
 * una su "Negro").
 *
 * Piezas del patrón conservadas (PLANMAESTRO §9.2): permiso primero
 * (`telas.ver`/`.administrar`); Zod compartido de `src/contrato`; todo cambio en UNA
 * transacción (A2) con auditoría (A7) + `Bitacora` juntos o nada; borrado SUAVE reversible
 * (`activo`); unicidad validada en la transacción y respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import {
  esquemaComposicionTelaCrear,
  esquemaTelaColores,
  esquemaComposicionTelaEditar,
  esquemaTelaCategoriaCrear,
  esquemaTelaCategoriaEditar,
  esquemaTelaCrear,
  esquemaTelaCrearMigracion,
  esquemaTelaEditar,
} from '../../contrato/esquemas/tela.js';
import type { ComposicionTela, Prisma, Tela, TelaCategoria } from '../../datos/index.js';
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

// ════════════════════════════════════════════════════════════════════════════════
//  TELA CATEGORÍA — catálogo simple (CRUD patrón, sin permiso propio)
// ════════════════════════════════════════════════════════════════════════════════

/** Alta de categoría de tela (catálogo global, sin `idEmpresa`). */
export type EntradaCrearTelaCategoria = z.input<typeof esquemaTelaCategoriaCrear>;

/** Edición de categoría: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarTelaCategoria = z.input<typeof esquemaTelaCategoriaEditar>;

/** Parámetros del listado de categorías (forma nativa, no la de la URL). */
export const esquemaListarTelasCategorias = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(100).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros que acepta `listarTelasCategorias` (forma nativa, no la de la URL). */
export type ParametrosListarTelasCategorias = z.input<typeof esquemaListarTelasCategorias>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos categorías con el mismo
 * `nombre`, sin importar mayúsculas. Se valida en la transacción; la carrera residual la
 * captura el unique de la base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreCategoriaLibre(
  tx: Tx,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.telaCategoria.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe una categoría de tela llamada "${nombre}".`
        : `Ya existe una categoría de tela llamada "${nombre}" (está desactivada; puedes reactivarla).`,
    );
  }
}

/** Busca una categoría por id o lanza `ErrorNoEncontrado`. */
async function exigirTelaCategoria(tx: Tx, id: number): Promise<TelaCategoria> {
  const categoria = await tx.telaCategoria.findUnique({ where: { id } });
  if (categoria === null) {
    throw new ErrorNoEncontrado('TelaCategoria', id);
  }
  return categoria;
}

/**
 * Cuenta cuántas telas ACTIVAS usan la categoría. Impide el borrado suave de una categoría
 * en uso (mismo criterio que la talla usada por una curva activa): las telas desactivadas
 * no cuentan.
 */
async function contarTelasActivasConCategoria(tx: Tx, idCategoria: number): Promise<number> {
  return tx.tela.count({ where: { idCategoria, activo: true } });
}

/**
 * Impide desactivar una categoría usada por alguna tela ACTIVA: el `onDelete: Restrict`
 * cubre el borrado físico; esto cubre el suave, con mensaje claro de cuántas telas la usan.
 */
async function exigirCategoriaSinUsoActivo(tx: Tx, categoria: TelaCategoria): Promise<void> {
  const enUso = await contarTelasActivasConCategoria(tx, categoria.id);
  if (enUso > 0) {
    throw new ErrorConflicto(
      `No se puede desactivar la categoría "${categoria.nombre}": la usan ${String(enUso)} ` +
        `tela(s) activa(s). Cámbiales la categoría (o desactívalas) primero.`,
    );
  }
}

/**
 * Crea una categoría de tela. Reglas: permiso `telas.administrar`; `nombre` único global →
 * `ErrorConflicto`; nace activa; auditoría y bitácora en la misma transacción (A2/A7).
 */
export async function crearTelaCategoria(
  sesion: SesionUsuario,
  entrada: EntradaCrearTelaCategoria,
  bd?: ContextoBd,
): Promise<TelaCategoria> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaTelaCategoriaCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreCategoriaLibre(tx, datos.nombre);

      const categoria = await tx.telaCategoria.create({
        data: { nombre: datos.nombre, ...datosCreacion(sesion) },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'TelaCategoria',
        idEntidad: categoria.id,
        accion: 'CREAR',
        datos: { nombre: categoria.nombre },
      });

      return categoria;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una categoría de tela llamada "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza una categoría: `nombre` y/o `activo` para desactivar (borrado suave) o
 * reactivar. Si el cambio DESACTIVA la categoría, se exige que no esté en uso por ninguna
 * tela activa. Bitácora según lo que pasó.
 */
export async function actualizarTelaCategoria(
  sesion: SesionUsuario,
  entrada: EntradaActualizarTelaCategoria,
  bd?: ContextoBd,
): Promise<TelaCategoria> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaTelaCategoriaEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirTelaCategoria(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre) {
        await exigirNombreCategoriaLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreCategoriaLibre(tx, actual.nombre, datos.id);
      }

      if (desactiva) {
        await exigirCategoriaSinUsoActivo(tx, actual);
      }

      const cambios: Prisma.TelaCategoriaUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const categoria = await tx.telaCategoria.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TelaCategoria',
          idEntidad: categoria.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: categoria.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'TelaCategoria',
          idEntidad: categoria.id,
          accion: 'DESACTIVAR',
          datos: { nombre: categoria.nombre },
        });
      }

      return categoria;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una categoría de tela con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) una categoría. RECHAZA si la usa alguna tela ACTIVA.
 * Desactivar dos veces es `ErrorConflicto`. Atajo explícito del botón "Desactivar".
 */
export async function desactivarTelaCategoria(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TelaCategoria> {
  verificarPermiso(sesion, 'telas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTelaCategoria(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La categoría "${actual.nombre}" ya está desactivada.`);
    }
    await exigirCategoriaSinUsoActivo(tx, actual);
    return actualizarTelaCategoria(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva una categoría desactivada (operación inversa del borrado suave). */
export async function reactivarTelaCategoria(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TelaCategoria> {
  verificarPermiso(sesion, 'telas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTelaCategoria(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`La categoría "${actual.nombre}" ya está activa.`);
    }
    return actualizarTelaCategoria(sesion, { id, activo: true }, { tx });
  }, bd);
}

/**
 * Lista categorías de tela con búsqueda, orden y paginación EN SERVIDOR. Por defecto: solo
 * activas. Sirve al listado de administración y al selector de categoría del form de tela.
 */
export async function listarTelasCategorias(
  sesion: SesionUsuario,
  parametros: ParametrosListarTelasCategorias = {},
  bd?: ContextoBd,
): Promise<Pagina<TelaCategoria>> {
  verificarPermiso(sesion, 'telas.ver');
  const filtros = validarEntrada(esquemaListarTelasCategorias, parametros);

  const where: Prisma.TelaCategoriaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.telaCategoria.count({ where }),
    cliente.telaCategoria.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}

// ════════════════════════════════════════════════════════════════════════════════
//  COMPOSICIÓN DE TELA — catálogo simple (§Post-F9.11; espejo de TelaCategoria)
// ════════════════════════════════════════════════════════════════════════════════

/** Alta de composición de tela (catálogo global, sin `idEmpresa`). */
export type EntradaCrearComposicionTela = z.input<typeof esquemaComposicionTelaCrear>;

/** Edición de composición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarComposicionTela = z.input<typeof esquemaComposicionTelaEditar>;

/** Parámetros del listado de composiciones (forma nativa, no la de la URL). */
export const esquemaListarComposicionesTela = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(150).optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros que acepta `listarComposicionesTela` (forma nativa, no la de la URL). */
export type ParametrosListarComposicionesTela = z.input<typeof esquemaListarComposicionesTela>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos composiciones con el mismo
 * `nombre`, sin importar mayúsculas. Se valida en la transacción; la carrera residual la
 * captura el unique de la base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreComposicionLibre(
  tx: Tx,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.composicionTela.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe una composición de tela llamada "${nombre}".`
        : `Ya existe una composición de tela llamada "${nombre}" (está desactivada; puedes reactivarla).`,
    );
  }
}

/** Busca una composición por id o lanza `ErrorNoEncontrado`. */
async function exigirComposicionTela(tx: Tx, id: number): Promise<ComposicionTela> {
  const composicion = await tx.composicionTela.findUnique({ where: { id } });
  if (composicion === null) {
    throw new ErrorNoEncontrado('ComposicionTela', id);
  }
  return composicion;
}

/**
 * Impide desactivar una composición usada por alguna tela ACTIVA (mismo criterio que la
 * categoría): el `onDelete: Restrict` cubre el borrado físico; esto cubre el suave, con
 * mensaje claro de cuántas telas la usan. Las telas desactivadas no cuentan.
 */
async function exigirComposicionSinUsoActivo(tx: Tx, composicion: ComposicionTela): Promise<void> {
  const enUso = await tx.tela.count({ where: { idComposicion: composicion.id, activo: true } });
  if (enUso > 0) {
    throw new ErrorConflicto(
      `No se puede desactivar la composición "${composicion.nombre}": la usan ${String(enUso)} ` +
        `tela(s) activa(s). Cámbiales la composición (o desactívalas) primero.`,
    );
  }
}

/**
 * Crea una composición de tela. Reglas: permiso `telas.administrar`; `nombre` único global
 * → `ErrorConflicto`; nace activa; auditoría y bitácora en la misma transacción (A2/A7).
 */
export async function crearComposicionTela(
  sesion: SesionUsuario,
  entrada: EntradaCrearComposicionTela,
  bd?: ContextoBd,
): Promise<ComposicionTela> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaComposicionTelaCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreComposicionLibre(tx, datos.nombre);

      const composicion = await tx.composicionTela.create({
        data: { nombre: datos.nombre, ...datosCreacion(sesion) },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'ComposicionTela',
        idEntidad: composicion.id,
        accion: 'CREAR',
        datos: { nombre: composicion.nombre },
      });

      return composicion;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una composición de tela llamada "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza una composición: `nombre` y/o `activo` para desactivar (borrado suave) o
 * reactivar. Si el cambio DESACTIVA la composición, se exige que no esté en uso por
 * ninguna tela activa. Bitácora según lo que pasó.
 */
export async function actualizarComposicionTela(
  sesion: SesionUsuario,
  entrada: EntradaActualizarComposicionTela,
  bd?: ContextoBd,
): Promise<ComposicionTela> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaComposicionTelaEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirComposicionTela(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre) {
        await exigirNombreComposicionLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreComposicionLibre(tx, actual.nombre, datos.id);
      }

      if (desactiva) {
        await exigirComposicionSinUsoActivo(tx, actual);
      }

      const cambios: Prisma.ComposicionTelaUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const composicion = await tx.composicionTela.update({
        where: { id: datos.id },
        data: cambios,
      });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'ComposicionTela',
          idEntidad: composicion.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: composicion.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'ComposicionTela',
          idEntidad: composicion.id,
          accion: 'DESACTIVAR',
          datos: { nombre: composicion.nombre },
        });
      }

      return composicion;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una composición de tela con ese nombre.', {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) una composición. RECHAZA si la usa alguna tela ACTIVA.
 * Desactivar dos veces es `ErrorConflicto`. Atajo explícito del botón "Desactivar".
 */
export async function desactivarComposicionTela(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ComposicionTela> {
  verificarPermiso(sesion, 'telas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirComposicionTela(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La composición "${actual.nombre}" ya está desactivada.`);
    }
    await exigirComposicionSinUsoActivo(tx, actual);
    return actualizarComposicionTela(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva una composición desactivada (operación inversa del borrado suave). */
export async function reactivarComposicionTela(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ComposicionTela> {
  verificarPermiso(sesion, 'telas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirComposicionTela(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`La composición "${actual.nombre}" ya está activa.`);
    }
    return actualizarComposicionTela(sesion, { id, activo: true }, { tx });
  }, bd);
}

/**
 * Lista composiciones de tela con búsqueda, orden y paginación EN SERVIDOR. Por defecto:
 * solo activas. Sirve al listado de administración y al selector del form de tela.
 */
export async function listarComposicionesTela(
  sesion: SesionUsuario,
  parametros: ParametrosListarComposicionesTela = {},
  bd?: ContextoBd,
): Promise<Pagina<ComposicionTela>> {
  verificarPermiso(sesion, 'telas.ver');
  const filtros = validarEntrada(esquemaListarComposicionesTela, parametros);

  const where: Prisma.ComposicionTelaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.composicionTela.count({ where }),
    cliente.composicionTela.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}

// ════════════════════════════════════════════════════════════════════════════════
//  TELA — entidad unificada (BOM + inventario) con grid de colores con precio
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Alta de tela (datos + grid de colores inline). Tipo ESTRICTO: `idProveedor` es
 * obligatorio (§Post-F9.11) — el typecheck caza a un llamador sin proveedor. El ETL usa
 * {@link EntradaCrearTelaMigracion} vía `crearTelaMigracion`.
 */
export type EntradaCrearTela = z.input<typeof esquemaTelaCrear>;

/**
 * Alta de tela EN MODO MIGRACIÓN (SOLO el ETL de F1-E6/F10): `idProveedor` opcional,
 * porque el sistema viejo no lo traía como campo (lo embebía en el nombre, "FelpaAlsa").
 */
export type EntradaCrearTelaMigracion = z.input<typeof esquemaTelaCrearMigracion>;

/** Edición de tela: `id` + cambios parciales (incluye `activo` y, opcional, `colores`). */
export type EntradaActualizarTela = z.input<typeof esquemaTelaEditar>;

/** Renglón de color tal como llega validado (precio ya como `number | undefined`). */
type ColorEntrada = z.output<typeof esquemaTelaColores>[number];

/** Parámetros del listado de telas (forma nativa, no la de la URL). */
export const esquemaListarTelas = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(150).optional(),
  idCategoria: z.number().int().positive().optional(),
  idColor: z.number().int().positive().optional(),
  /**
   * Filtra por el proveedor DUEÑO de la tela (§Post-F9.15, petición de Daniel 7-ago-2026: *"cada
   * proveedor de telas tiene sus telas definidas. No puedo meter una felpa alsatex en el proveedor
   * bloom"*). La identidad de la tela YA incluye a su dueño desde A1 (§Post-F9.11); esto es lo que
   * permite que las capturas lo respeten en vez de ofrecer el catálogo entero.
   *
   * Filtro ESTRICTO: las telas migradas sin dueño (`idProveedor` NULL) NO aparecen. Es lo correcto
   * — el catálogo se captura desde cero y las migradas quedan como dato informativo del histórico
   * de consumos (acuerdo con Daniel, 7-ago-2026).
   */
  idProveedor: z.number().int().positive().optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros que acepta `listarTelas` (forma nativa, no la de la URL). */
export type ParametrosListarTelas = z.input<typeof esquemaListarTelas>;

/** Tela con su categoría, composición, proveedor y colores (forma que consume la ruta). */
export type TelaConColores = Tela & {
  categoria: Pick<TelaCategoria, 'nombre'> | null;
  composicion: Pick<ComposicionTela, 'nombre'> | null;
  /** Dueño del artículo: nombre + nombre CORTO (A1.1: la UI arma el nombre compuesto con él). */
  proveedor: { nombre: string; nombreCorto: string | null } | null;
  colores: {
    id: number;
    nombre: string;
    pantone: string | null;
    precio: Prisma.Decimal | null;
    precioComplemento: Prisma.Decimal | null;
    /** LEGACY: liga al color de PRENDA de las filas migradas (F1-E6); null en las nuevas. */
    idColor: number | null;
  }[];
};

/**
 * `include` estándar: categoría, composición, proveedor dueño y los colores HIJOS de la
 * tela (nombre libre + pantone + dos precios, ordenados por su propio nombre —
 * §Post-F9.11: ya no cuelgan del catálogo de prenda).
 */
const incluirCategoriaYColores = {
  categoria: { select: { nombre: true } },
  composicion: { select: { nombre: true } },
  // El nombre CORTO viaja junto al nombre (A1.1): la edición del diálogo arma el nombre
  // compuesto con el corto del proveedor dueño, no con su nombre largo.
  proveedor: { select: { nombre: true, nombreCorto: true } },
  colores: {
    select: {
      id: true,
      nombre: true,
      pantone: true,
      precio: true,
      precioComplemento: true,
      idColor: true,
    },
    orderBy: { nombre: 'asc' },
  },
} satisfies Prisma.TelaInclude;

/** Campos de TEXTO opcionales editables (clave del payload === clave del modelo). */
// `unidadMedida` NO va aquí: es un enum NOT NULL desde el 30-jul-2026 y este loop convierte
// ''/null en NULL — escribiría NULL en una columna que no lo admite (500). Se maneja abajo con
// los demás enums. Hoy el Zod del contrato lo filtraría antes, pero eso es una defensa en OTRO
// archivo: aflojar `esquemaTelaEditar` bastaría para reventarlo (hallazgo del reviewer).
const CAMPOS_TEXTO_EDITABLES = [
  'descripcion',
  'nombreProveedor',
  'nombreCuerpo',
  'nombreComplemento',
] as const;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos telas con el mismo `nombre`,
 * sin importar mayúsculas. Se valida DENTRO de la transacción; la carrera residual la
 * captura el unique de la base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreTelaLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.tela.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe una tela llamada "${nombre}".`
        : `Ya existe una tela llamada "${nombre}" (está desactivada; puedes reactivarla).`,
    );
  }
}

/** Busca una tela por id o lanza `ErrorNoEncontrado`. */
async function exigirTela(tx: Tx, id: number): Promise<Tela> {
  const tela = await tx.tela.findUnique({ where: { id } });
  if (tela === null) {
    throw new ErrorNoEncontrado('Tela', id);
  }
  return tela;
}

/**
 * Valida que la categoría (opcional) exista y esté ACTIVA. `null`/`undefined` = sin
 * categoría (válido). Lanza `ErrorValidacion` con mensaje claro si no existe o está
 * inactiva (no se asigna una tela a una categoría desactivada).
 */
async function exigirCategoriaValida(tx: Tx, idCategoria: number): Promise<void> {
  const categoria = await tx.telaCategoria.findUnique({
    where: { id: idCategoria },
    select: { nombre: true, activo: true },
  });
  if (categoria === null) {
    throw new ErrorValidacion('La categoría seleccionada no existe.');
  }
  if (!categoria.activo) {
    throw new ErrorValidacion(
      `La categoría "${categoria.nombre}" está desactivada y no se puede asignar.`,
    );
  }
}

/**
 * Valida que la composición (opcional) exista y esté ACTIVA. Mismo criterio que la
 * categoría: no se asigna una tela a una composición desactivada.
 */
async function exigirComposicionValida(tx: Tx, idComposicion: number): Promise<void> {
  const composicion = await tx.composicionTela.findUnique({
    where: { id: idComposicion },
    select: { nombre: true, activo: true },
  });
  if (composicion === null) {
    throw new ErrorValidacion('La composición seleccionada no existe.');
  }
  if (!composicion.activo) {
    throw new ErrorValidacion(
      `La composición "${composicion.nombre}" está desactivada y no se puede asignar.`,
    );
  }
}

/**
 * Valida que el proveedor dueño exista y esté ACTIVO (no se cuelga una tela de un
 * proveedor desactivado). El contrato ya exige que venga en el alta (§Post-F9.11).
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

/** Pantone capturado normalizado: ''/omitido = sin pantone (se guarda `null`, nunca ''). */
function pantoneONull(pantone: string | undefined): string | null {
  return pantone === undefined || pantone === '' ? null : pantone;
}

/** Llave de comparación del nombre de un color de tela (unicidad POR tela, insensible). */
function claveNombreColor(nombre: string): string {
  return nombre.trim().toLowerCase();
}

/**
 * Bloqueo POR TELA dentro de la transacción para las escrituras del grid de colores y del
 * complemento (patrón del kardex, `pg_advisory_xact_lock`): dos ediciones concurrentes de la
 * MISMA tela se serializan, cerrando el write-skew "uno desmarca el complemento mientras otro
 * captura precios de complemento" (H2/R2-6). La clave 1 es un namespace fijo ('TELA' en
 * ASCII); una colisión solo sobre-serializa, nunca afecta la correctitud.
 */
async function bloquearColoresTela(tx: Tx, idTela: number): Promise<void> {
  const claveNamespace = 0x54454c41 | 0; // 'TELA'
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${claveNamespace}::int, ${idTela}::int)`;
}

/**
 * INVARIANTE del complemento (A1, §Post-F9.11): el `precioComplemento` de un color SOLO
 * tiene sentido si la tela LLEVA complemento (`nombreComplemento` no nulo). Si no lleva,
 * capturarlo se RECHAZA con mensaje claro (no se ignora en silencio) — vale para el alta
 * y para la edición, cualquiera que sea el estado FINAL del complemento en esa operación.
 */
function exigirComplementoCoherente(
  llevaComplemento: boolean,
  deseados: readonly ColorEntrada[],
): void {
  if (llevaComplemento) {
    return;
  }
  const conPrecio = deseados.find((c) => c.precioComplemento !== undefined);
  if (conPrecio !== undefined) {
    throw new ErrorValidacion(
      `El color "${conPrecio.nombre}" trae precio de complemento, pero esta tela NO lleva ` +
        `complemento. Decláralo primero (nombre del complemento) o quita ese precio.`,
    );
  }
}

/**
 * Reemplaza el grid de colores de una tela DENTRO de la transacción (A2): borra los que
 * sobran, crea los que faltan y ACTUALIZA los datos de los que cambiaron (diff mínimo, sin
 * tocar lo que no varía — así se conserva la auditoría de cada renglón). Los colores son
 * HIJOS de la tela (§Post-F9.11); la llave del diff es el **`id` de la fila cuando viene**
 * (R3-1: un renombre real con `id` es update en sitio que conserva la liga legacy) y el
 * NOMBRE normalizado como respaldo (payloads sin id: UI vieja, ETL, cambios de casing; el
 * Zod ya rechazó nombres repetidos). Las filas nuevas nacen con `idColor` NULL; en las
 * migradas la liga legacy `idColor` NO se toca (sobrevive a renombres y ediciones de
 * pantone/precios). Devuelve true si hubo algún cambio (para la bitácora). Calca
 * `sincronizarTipos` del maquilero.
 */
async function sincronizarColores(
  tx: Tx,
  sesion: SesionUsuario,
  idTela: number,
  deseados: ColorEntrada[],
): Promise<boolean> {
  const actuales = await tx.telaColor.findMany({
    where: { idTela },
    select: { id: true, nombre: true, pantone: true, precio: true, precioComplemento: true },
  });
  type FilaActual = (typeof actuales)[number];
  const porId = new Map(actuales.map((c) => [c.id, c]));
  const porClave = new Map(actuales.map((c) => [claveNombreColor(c.nombre), c]));

  // EMPAREJAMIENTO (R3-1): primero por `id` (identidad de la fila — un RENOMBRE real con
  // `id` es update en sitio que conserva la liga legacy, pantone y auditoría); el nombre
  // normalizado queda como RESPALDO para payloads sin id (UI vieja, ETL, casing). Un `id`
  // que no pertenece a esta tela se RECHAZA (nunca en silencio).
  const reclamadas = new Set<number>();
  const emparejados: { fila: FilaActual; deseado: ColorEntrada }[] = [];
  const aAgregar: ColorEntrada[] = [];

  for (const deseado of deseados) {
    if (deseado.id === undefined) {
      continue;
    }
    const fila = porId.get(deseado.id);
    if (fila === undefined) {
      throw new ErrorValidacion(
        `El color de tela #${String(deseado.id)} no pertenece a esta tela.`,
      );
    }
    if (reclamadas.has(fila.id)) {
      throw new ErrorValidacion(
        `El color de tela #${String(deseado.id)} viene repetido en la captura.`,
      );
    }
    reclamadas.add(fila.id);
    emparejados.push({ fila, deseado });
  }
  for (const deseado of deseados) {
    if (deseado.id !== undefined) {
      continue;
    }
    const fila = porClave.get(claveNombreColor(deseado.nombre));
    if (fila !== undefined && !reclamadas.has(fila.id)) {
      reclamadas.add(fila.id);
      emparejados.push({ fila, deseado });
    } else {
      aAgregar.push(deseado);
    }
  }

  const aQuitar = actuales.filter((c) => !reclamadas.has(c.id));
  const aActualizar = emparejados.flatMap(({ fila, deseado }) => {
    const precioActual = fila.precio === null ? null : fila.precio.toNumber();
    const complementoActual =
      fila.precioComplemento === null ? null : fila.precioComplemento.toNumber();
    const cambia =
      fila.nombre !== deseado.nombre || // renombre (con id) o cambio de casing (sin id)
      precioActual !== (deseado.precio ?? null) ||
      complementoActual !== (deseado.precioComplemento ?? null) ||
      fila.pantone !== pantoneONull(deseado.pantone);
    return cambia ? [{ id: fila.id, deseado }] : [];
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return false;
  }

  // Orden: bajas → updates → altas, para que un renombre pueda tomar un nombre recién
  // liberado y una alta pueda usar el nombre que un renombre acaba de dejar libre.
  if (aQuitar.length > 0) {
    await tx.telaColor.deleteMany({ where: { id: { in: aQuitar.map((c) => c.id) } } });
  }
  for (const { id, deseado } of aActualizar) {
    await tx.telaColor.update({
      where: { id },
      data: {
        nombre: deseado.nombre,
        precio: deseado.precio ?? null,
        precioComplemento: deseado.precioComplemento ?? null,
        pantone: pantoneONull(deseado.pantone),
        ...datosModificacion(sesion),
      },
    });
  }
  if (aAgregar.length > 0) {
    await tx.telaColor.createMany({
      data: aAgregar.map((c) => ({
        idTela,
        nombre: c.nombre, // idColor queda NULL: el color de tela NO cuelga del catálogo de prenda
        ...(c.precio === undefined ? {} : { precio: c.precio }),
        ...(c.precioComplemento === undefined ? {} : { precioComplemento: c.precioComplemento }),
        ...(pantoneONull(c.pantone) === null ? {} : { pantone: pantoneONull(c.pantone) }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  return true;
}

/**
 * Construye el `data` de los campos opcionales presentes en el alta (solo los definidos).
 * Se tipa con `TelaUncheckedCreateInput` para poder fijar `idCategoria` como escalar
 * (la FK) en el `create` del llamador, en vez de via relación (`categoria.connect`).
 */
function datosOpcionalesCrear(
  datos: z.output<typeof esquemaTelaCrearMigracion>,
): Partial<Prisma.TelaUncheckedCreateInput> {
  const data: Partial<Prisma.TelaUncheckedCreateInput> = {};
  if (datos.descripcion !== undefined) data.descripcion = datos.descripcion;
  if (datos.unidadMedida !== undefined) data.unidadMedida = datos.unidadMedida;
  if (datos.precioSugerido !== undefined) data.precioSugerido = datos.precioSugerido;
  // Peso (gr/m²) y ancho (m) de la tela (A1.1): informativos, opcionales.
  if (datos.peso !== undefined) data.peso = datos.peso;
  if (datos.ancho !== undefined) data.ancho = datos.ancho;
  if (datos.idCategoria !== undefined) data.idCategoria = datos.idCategoria;
  // Identidad en 4 datos (§Post-F9.11). Los textos '' se normalizan a omitir (nunca se guarda '').
  if (datos.idComposicion !== undefined) data.idComposicion = datos.idComposicion;
  if (datos.idProveedor !== undefined) data.idProveedor = datos.idProveedor;
  if (datos.nombreProveedor !== undefined && datos.nombreProveedor !== '') {
    data.nombreProveedor = datos.nombreProveedor;
  }
  if (datos.nombreCuerpo !== undefined && datos.nombreCuerpo !== '') {
    data.nombreCuerpo = datos.nombreCuerpo;
  }
  if (datos.nombreComplemento !== undefined && datos.nombreComplemento !== '') {
    data.nombreComplemento = datos.nombreComplemento;
  }
  // Enums/banderas: el esquema de ALTA ya les aplicó su default (OTRO/false/true).
  data.tipoComponente = datos.tipoComponente;
  data.favorito = datos.favorito;
  data.paraProduccion = datos.paraProduccion;
  return data;
}

/**
 * Compara un decimal capturado (number | null | undefined) con el guardado
 * (Decimal | null). `undefined` = no se tocó (no cambia). Distingue `null` (vaciar) de un
 * número nuevo. Pareja del manejo de `precioReferencia` en Cortadores, ampliado a nullable.
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
 * (para la bitácora). Semántica del PATCH parcial (M1): texto omitido = no tocar;
 * `null`/'' = borrar (a `null`, nunca `''`); número/bandera/enum omitido = no tocar.
 * `idCategoria` `null` quita la categoría. Devuelve el detalle de cambios para la bitácora.
 */
function aplicarOpcionalesEditar(
  datos: z.output<typeof esquemaTelaEditar>,
  actual: Tela,
  cambios: Prisma.TelaUncheckedUpdateInput,
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

  // idCategoria: `null` quita la categoría; un id la fija; omitir = no tocar.
  if (datos.idCategoria !== undefined && datos.idCategoria !== actual.idCategoria) {
    cambios.idCategoria = datos.idCategoria;
    detalle.idCategoria = { de: actual.idCategoria, a: datos.idCategoria };
  }

  // idComposicion: mismo trato que la categoría (`null` la quita).
  if (datos.idComposicion !== undefined && datos.idComposicion !== actual.idComposicion) {
    cambios.idComposicion = datos.idComposicion;
    detalle.idComposicion = { de: actual.idComposicion, a: datos.idComposicion };
  }

  // idProveedor: solo se FIJA o se corrige (nunca `null`, el contrato no lo admite): el
  // proveedor dueño es identidad de la tela (§Post-F9.11); a las migradas se les va poniendo.
  if (datos.idProveedor !== undefined && datos.idProveedor !== actual.idProveedor) {
    cambios.idProveedor = datos.idProveedor;
    detalle.idProveedor = { de: actual.idProveedor, a: datos.idProveedor };
  }

  // precioSugerido (decimal nullable): omitir = no tocar; `null` = quitar; número = fijar.
  if (cambiaDecimal(datos.precioSugerido, actual.precioSugerido)) {
    const nuevo = datos.precioSugerido ?? null;
    cambios.precioSugerido = nuevo;
    detalle.precioSugerido = {
      de: actual.precioSugerido === null ? null : actual.precioSugerido.toNumber(),
      a: nuevo,
    };
  }

  // peso / ancho (A1.1, decimales nullable): misma semántica que precioSugerido.
  if (cambiaDecimal(datos.peso, actual.peso)) {
    const nuevo = datos.peso ?? null;
    cambios.peso = nuevo;
    detalle.peso = { de: actual.peso === null ? null : actual.peso.toNumber(), a: nuevo };
  }
  if (cambiaDecimal(datos.ancho, actual.ancho)) {
    const nuevo = datos.ancho ?? null;
    cambios.ancho = nuevo;
    detalle.ancho = { de: actual.ancho === null ? null : actual.ancho.toNumber(), a: nuevo };
  }

  // Enums/banderas: omitir = no tocar (el form las manda con valor).
  if (datos.unidadMedida !== undefined && datos.unidadMedida !== actual.unidadMedida) {
    cambios.unidadMedida = datos.unidadMedida;
    detalle.unidadMedida = { de: actual.unidadMedida, a: datos.unidadMedida };
  }
  if (datos.tipoComponente !== undefined && datos.tipoComponente !== actual.tipoComponente) {
    cambios.tipoComponente = datos.tipoComponente;
    detalle.tipoComponente = { de: actual.tipoComponente, a: datos.tipoComponente };
  }
  if (datos.favorito !== undefined && datos.favorito !== actual.favorito) {
    cambios.favorito = datos.favorito;
    detalle.favorito = { de: actual.favorito, a: datos.favorito };
  }
  if (datos.paraProduccion !== undefined && datos.paraProduccion !== actual.paraProduccion) {
    cambios.paraProduccion = datos.paraProduccion;
    detalle.paraProduccion = { de: actual.paraProduccion, a: datos.paraProduccion };
  }

  return detalle;
}

/**
 * Crea una tela (catálogo global) con su grid de colores en UNA transacción (A2). Reglas:
 * permiso `telas.administrar`; `nombre` único global → `ErrorConflicto`; `idCategoria`/
 * `idComposicion` opcionales (si vienen, existen y activas); `idProveedor` OBLIGATORIO
 * (§Post-F9.11) y activo; colores HIJOS de la tela con nombre único por tela (puede ir
 * vacío); nace activa; auditoría y bitácora en la misma transacción (A7).
 *
 * 🔑 La tela creada aquí es la MISMA que usarán el BOM (F4) y el inventario (F4): no se
 * duplica la entidad. (ADR-0009.)
 *
 * @example
 * const t = await crearTela(sesion, {
 *   nombre: "Felpa 280", idCategoria: idFelpa, idProveedor: idAlsatex,
 *   nombreProveedor: "Felpa Suiza", unidadMedida: "KG",
 *   colores: [{ nombre: "Marino Alsa 3040", precio: 95, pantone: "19-4005 TCX" }],
 * });
 */
export async function crearTela(
  sesion: SesionUsuario,
  entrada: EntradaCrearTela,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  verificarPermiso(sesion, 'telas.administrar'); // permiso PRIMERO (§9.2), antes del Zod
  return crearTelaValidada(sesion, validarEntrada(esquemaTelaCrear, entrada), bd);
}

/**
 * Alta de tela EN MODO MIGRACIÓN — SOLO el ETL de F1-E6/F10 (telas viejas sin proveedor
 * dueño; se depuran a mano después). Misma lógica que {@link crearTela}, pero valida con
 * `esquemaTelaCrearMigracion` (proveedor opcional). Función SEPARADA a propósito (no una
 * bandera): el typecheck caza a cualquier llamador normal que intente omitir el proveedor.
 * Ninguna ruta REST la expone.
 */
export async function crearTelaMigracion(
  sesion: SesionUsuario,
  entrada: EntradaCrearTelaMigracion,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  verificarPermiso(sesion, 'telas.administrar'); // permiso PRIMERO (§9.2), antes del Zod
  return crearTelaValidada(sesion, validarEntrada(esquemaTelaCrearMigracion, entrada), bd);
}

/** Implementación compartida del alta (permiso ya verificado; datos YA validados). */
async function crearTelaValidada(
  sesion: SesionUsuario,
  datos: z.output<typeof esquemaTelaCrearMigracion>,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreTelaLibre(tx, datos.nombre);
      if (datos.idCategoria !== undefined) {
        await exigirCategoriaValida(tx, datos.idCategoria);
      }
      if (datos.idComposicion !== undefined) {
        await exigirComposicionValida(tx, datos.idComposicion);
      }
      if (datos.idProveedor !== undefined) {
        await exigirProveedorValido(tx, datos.idProveedor);
      }

      // Invariante A1 (H2): precio del complemento SOLO si la tela lleva complemento.
      const llevaComplemento =
        datos.nombreComplemento !== undefined && datos.nombreComplemento !== '';
      exigirComplementoCoherente(llevaComplemento, datos.colores);

      const datosCrear: Prisma.TelaUncheckedCreateInput = {
        nombre: datos.nombre,
        ...datosOpcionalesCrear(datos), // incluye idCategoria si vino
        ...datosCreacion(sesion),
      };
      const tela = await tx.tela.create({ data: datosCrear });

      await sincronizarColores(tx, sesion, tela.id, datos.colores);

      await registrarBitacora(tx, sesion, {
        entidad: 'Tela',
        idEntidad: tela.id,
        accion: 'CREAR',
        datos: {
          nombre: tela.nombre,
          idCategoria: tela.idCategoria,
          idComposicion: tela.idComposicion,
          idProveedor: tela.idProveedor,
          colores: datos.colores.map((c) => ({
            nombre: c.nombre,
            precio: c.precio ?? null,
            precioComplemento: c.precioComplemento ?? null,
            pantone: pantoneONull(c.pantone),
          })),
        },
      });

      return tx.tela.findUniqueOrThrow({
        where: { id: tela.id },
        include: incluirCategoriaYColores,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una tela llamada "${datos.nombre}".`, { causa: error });
    }
    throw error;
  }
}

/**
 * Actualiza una tela: datos generales, grid de colores y/o `activo` para desactivar
 * (borrado suave) o reactivar. Todo en UNA transacción (A2).
 *
 * Colores: si `colores` NO viene, no se tocan; si viene (incluso `[]`), REEMPLAZA el grid
 * completo con diff (altas/bajas/cambios de precio). Bitácora según lo que pasó:
 * `MODIFICAR` con el detalle de campos y/o de colores, y/o `DESACTIVAR` si se apagó.
 */
export async function actualizarTela(
  sesion: SesionUsuario,
  entrada: EntradaActualizarTela,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaTelaEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      // R2-6: serializa las ediciones de la MISMA tela (grid de colores + complemento).
      await bloquearColoresTela(tx, datos.id);
      const actual = await exigirTela(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      // Unchecked para fijar `idCategoria` como escalar (la FK), no via relación.
      const cambios: Prisma.TelaUncheckedUpdateInput = { ...datosModificacion(sesion) };
      const detalleOpcionales = aplicarOpcionalesEditar(datos, actual, cambios);
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      if (cambiaNombre) {
        await exigirNombreTelaLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreTelaLibre(tx, actual.nombre, datos.id);
      }

      // Si se asigna una categoría nueva (no null), validarla. `aplicarOpcionalesEditar` ya
      // metió el cambio en `cambios`; aquí solo se valida que sea asignable.
      if (
        datos.idCategoria !== undefined &&
        datos.idCategoria !== null &&
        datos.idCategoria !== actual.idCategoria
      ) {
        await exigirCategoriaValida(tx, datos.idCategoria);
      }

      // Composición y proveedor nuevos: mismos criterios (existir y estar activos).
      if (
        datos.idComposicion !== undefined &&
        datos.idComposicion !== null &&
        datos.idComposicion !== actual.idComposicion
      ) {
        await exigirComposicionValida(tx, datos.idComposicion);
      }
      if (datos.idProveedor !== undefined && datos.idProveedor !== actual.idProveedor) {
        await exigirProveedorValido(tx, datos.idProveedor);
      }

      // COMPLEMENTO (H2, invariante A1): el estado FINAL de esta edición decide si los
      // colores pueden llevar precio de complemento. Y si la tela DEJA de llevarlo en esta
      // misma operación, se LIMPIA el `precioComplemento` de TODOS sus colores en la MISMA
      // transacción (un precio de un complemento que ya no existe es basura que confunde).
      const complementoCrudo = datos.nombreComplemento;
      const complementoFinal =
        complementoCrudo === undefined
          ? actual.nombreComplemento
          : complementoCrudo === null || complementoCrudo === ''
            ? null
            : complementoCrudo;
      const dejaDeLlevar = actual.nombreComplemento !== null && complementoFinal === null;
      if (datos.colores !== undefined) {
        exigirComplementoCoherente(complementoFinal !== null, datos.colores);
      }
      if (dejaDeLlevar) {
        await tx.telaColor.updateMany({
          where: { idTela: datos.id, precioComplemento: { not: null } },
          data: { precioComplemento: null, ...datosModificacion(sesion) },
        });
      }

      // Colores: solo se tocan si vienen en el payload (omitir = no tocar). El grid puede
      // quedar vacío (a diferencia de los tipos del maquilero).
      const cambiaColores =
        datos.colores !== undefined
          ? await sincronizarColores(tx, sesion, datos.id, datos.colores)
          : false;

      const huboCambioEscalar =
        cambiaNombre || Object.keys(detalleOpcionales).length > 0 || reactiva || desactiva;

      if (!huboCambioEscalar && !cambiaColores) {
        return tx.tela.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirCategoriaYColores,
        });
      }

      // Siempre deja constancia (al menos modificadoPorId/En), aunque solo cambien colores.
      await tx.tela.update({ where: { id: datos.id }, data: cambios });

      if (huboCambioEscalar || cambiaColores) {
        const noDesactivar = cambiaNombre || Object.keys(detalleOpcionales).length > 0 || reactiva;
        if (noDesactivar || cambiaColores) {
          await registrarBitacora(tx, sesion, {
            entidad: 'Tela',
            idEntidad: datos.id,
            accion: 'MODIFICAR',
            datos: {
              ...(cambiaNombre ? { nombre: { de: actual.nombre, a: datos.nombre } } : {}),
              ...detalleOpcionales,
              ...(cambiaColores
                ? {
                    colores: datos.colores?.map((c) => ({
                      nombre: c.nombre,
                      precio: c.precio ?? null,
                      precioComplemento: c.precioComplemento ?? null,
                      pantone: pantoneONull(c.pantone),
                    })),
                  }
                : {}),
              ...(reactiva ? { operacion: 'reactivar' } : {}),
            },
          });
        }
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Tela',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { nombre: actual.nombre },
        });
      }

      return tx.tela.findUniqueOrThrow({
        where: { id: datos.id },
        include: incluirCategoriaYColores,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una tela con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/** Entrada de la reconciliación de colores del ETL (id de la tela + renglones del CSV). */
const esquemaReconciliarColoresMigracion = z.object({
  id: z
    .number({ error: 'El id de la tela es obligatorio' })
    .int({ error: 'El id de la tela debe ser entero' })
    .positive({ error: 'El id de la tela debe ser positivo' }),
  colores: esquemaTelaColores,
});

/** Entrada que acepta {@link reconciliarColoresTelaMigracion}. */
export type EntradaReconciliarColoresMigracion = z.input<typeof esquemaReconciliarColoresMigracion>;

/**
 * RECONCILIA (merge ADITIVO) el grid de colores de una tela con lo que trae el CSV del ETL —
 * SOLO la migración (F1-E6/F10) la usa; ninguna ruta REST la expone. Es la lección del PR
 * #153 aplicada a los campos nuevos (R2-1): re-correr el ETL NO debe borrar la depuración
 * manual, y `sincronizarColores` (el reemplazo total del grid que usa la UI) haría
 * exactamente eso. La invariante vive AQUÍ, en el dominio — el loader solo arma renglones:
 *
 *  • Clave (nombre normalizado) que YA existe → se CONSERVAN su `nombre` (el casing actual,
 *    que puede ser el canónico copiado de `colores.nombre` o una corrección manual), su
 *    `pantone`, su `precioComplemento` y su liga legacy `idColor`; SOLO se actualiza el
 *    `precio` cuando el CSV lo trae y difiere (es el único dato que el CSV sí tiene).
 *  • Clave del CSV que no existe → se CREA (nombre + precio; `idColor` NULL — la liga
 *    legacy la pone el paso data-only del loader).
 *  • Filas de la tela que NO están en el CSV → NO SE TOCAN (colores agregados a mano).
 *
 * Idempotente: una 2ª corrida sin cambios no escribe nada ni deja bitácora. Todo en UNA
 * transacción (A2) bajo el lock por tela (R2-6), con bitácora A7 cuando algo cambió.
 */
export async function reconciliarColoresTelaMigracion(
  sesion: SesionUsuario,
  entrada: EntradaReconciliarColoresMigracion,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaReconciliarColoresMigracion, entrada);

  return enTransaccion(async (tx) => {
    await bloquearColoresTela(tx, datos.id);
    const actual = await exigirTela(tx, datos.id);
    // Misma invariante H2 que el resto del dominio (el CSV no trae precioComplemento, pero
    // si un renglón lo colara, se rechaza igual que en crear/editar).
    exigirComplementoCoherente(actual.nombreComplemento !== null, datos.colores);

    const actuales = await tx.telaColor.findMany({
      where: { idTela: datos.id },
      select: { id: true, nombre: true, precio: true },
    });
    const porClave = new Map(actuales.map((c) => [claveNombreColor(c.nombre), c]));

    const detalle: { nombre: string; operacion: string; de?: number | null; a?: number }[] = [];
    for (const renglon of datos.colores) {
      const existente = porClave.get(claveNombreColor(renglon.nombre));
      if (existente === undefined) {
        await tx.telaColor.create({
          data: {
            idTela: datos.id,
            nombre: renglon.nombre,
            ...(renglon.precio === undefined ? {} : { precio: renglon.precio }),
            ...(pantoneONull(renglon.pantone) === null
              ? {}
              : { pantone: pantoneONull(renglon.pantone) }),
            creadoPorId: sesion.id,
            modificadoPorId: sesion.id,
          },
        });
        detalle.push({ nombre: renglon.nombre, operacion: 'crear' });
        continue;
      }
      const precioActual = existente.precio === null ? null : existente.precio.toNumber();
      if (renglon.precio !== undefined && renglon.precio !== precioActual) {
        await tx.telaColor.update({
          where: { id: existente.id },
          data: { precio: renglon.precio, ...datosModificacion(sesion) },
        });
        detalle.push({
          nombre: existente.nombre,
          operacion: 'precio',
          de: precioActual,
          a: renglon.precio,
        });
      }
    }

    if (detalle.length > 0) {
      await tx.tela.update({
        where: { id: datos.id },
        data: { ...datosModificacion(sesion) },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'Tela',
        idEntidad: datos.id,
        accion: 'MODIFICAR',
        datos: { operacion: 'reconciliar-colores-migracion', colores: detalle },
      });
    }

    return tx.tela.findUniqueOrThrow({
      where: { id: datos.id },
      include: incluirCategoriaYColores,
    });
  }, bd);
}

/**
 * Desactiva (borrado SUAVE) una tela: deja de aparecer en capturas pero su historial y sus
 * colores quedan intactos. Desactivar dos veces es `ErrorConflicto`. Atajo del botón
 * "Desactivar".
 */
export async function desactivarTela(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTela(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La tela "${actual.nombre}" ya está desactivada.`);
    }
    return actualizarTela(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva una tela desactivada (operación inversa del borrado suave). */
export async function reactivarTela(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTela(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`La tela "${actual.nombre}" ya está activa.`);
    }
    return actualizarTela(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene una tela por id (con su categoría y colores) o lanza `ErrorNoEncontrado`. */
export async function obtenerTela(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  verificarPermiso(sesion, 'telas.ver');
  const tela = await clienteLectura(bd).tela.findUnique({
    where: { id },
    include: incluirCategoriaYColores,
  });
  if (tela === null) {
    throw new ErrorNoEncontrado('Tela', id);
  }
  return tela;
}

/** Renglón de color de una tela para la salida del endpoint `/telas/:id/colores`. */
export type TelaColorDetalle = {
  id: number;
  nombre: string;
  pantone: string | null;
  precio: Prisma.Decimal | null;
  precioComplemento: Prisma.Decimal | null;
  /** LEGACY: liga al color de PRENDA de las filas migradas; null en las nuevas. */
  idColor: number | null;
};

/**
 * Lista los colores de una tela (hijos de la tela: nombre libre + pantone + dos precios,
 * §Post-F9.11), ordenados por nombre. Lectura de solo `telas.ver`. Lanza
 * `ErrorNoEncontrado` si la tela no existe.
 */
export async function listarColoresDeTela(
  sesion: SesionUsuario,
  idTela: number,
  bd?: ContextoBd,
): Promise<TelaColorDetalle[]> {
  verificarPermiso(sesion, 'telas.ver');
  const cliente = clienteLectura(bd);
  const tela = await cliente.tela.findUnique({ where: { id: idTela }, select: { id: true } });
  if (tela === null) {
    throw new ErrorNoEncontrado('Tela', idTela);
  }
  return cliente.telaColor.findMany({
    where: { idTela },
    select: {
      id: true,
      nombre: true,
      pantone: true,
      precio: true,
      precioComplemento: true,
      idColor: true,
    },
    orderBy: { nombre: 'asc' },
  });
}

/**
 * Lista telas con búsqueda, orden y paginación EN SERVIDOR (la tabla de la UI nunca trae
 * todo para filtrar en memoria), cada una con su categoría y colores. Por defecto: solo
 * activas. Permite filtrar por `idCategoria`.
 *
 * @example
 * const pagina = await listarTelas(sesion, { idCategoria: idFelpa, busqueda: "algodón" });
 */
export async function listarTelas(
  sesion: SesionUsuario,
  parametros: ParametrosListarTelas = {},
  bd?: ContextoBd,
): Promise<Pagina<TelaConColores>> {
  verificarPermiso(sesion, 'telas.ver');
  const filtros = validarEntrada(esquemaListarTelas, parametros);

  // La búsqueda mira el nombre de la tela, el NOMBRE QUE LE DA SU PROVEEDOR, el nombre del
  // PROVEEDOR dueño, EL DE SUS COLORES y su PANTONE (Daniel, 30-jul-2026: *"me gustaría poder
  // buscar por color, por tipo de tela"*; ampliada en §Post-F9.11 con la identidad en 4 datos):
  // en el almacén se busca "negro" o "alsatex" mucho más seguido que el nombre exacto de la
  // tela. Todo va por relaciones `some`/`is` sobre la MISMA tela raíz: ni duplica filas ni
  // descuadra la paginación (igual que la búsqueda por color de siempre).
  const busqueda = filtros.busqueda;
  const where: Prisma.TelaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.idCategoria === undefined ? {} : { idCategoria: filtros.idCategoria }),
    // `idColor` es un filtro LEGACY (§Post-F9.11): pesca por la liga al color de PRENDA que
    // conservan las filas MIGRADAS; los colores nuevos (idColor NULL) no participan.
    ...(filtros.idColor === undefined ? {} : { colores: { some: { idColor: filtros.idColor } } }),
    ...(filtros.idProveedor === undefined ? {} : { idProveedor: filtros.idProveedor }),
    ...(busqueda === undefined || busqueda === ''
      ? {}
      : {
          OR: [
            { nombre: { contains: busqueda, mode: 'insensitive' } },
            { nombreProveedor: { contains: busqueda, mode: 'insensitive' } },
            { proveedor: { is: { nombre: { contains: busqueda, mode: 'insensitive' } } } },
            { colores: { some: { nombre: { contains: busqueda, mode: 'insensitive' } } } },
            { colores: { some: { pantone: { contains: busqueda, mode: 'insensitive' } } } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.tela.count({ where }),
    cliente.tela.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirCategoriaYColores,
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
