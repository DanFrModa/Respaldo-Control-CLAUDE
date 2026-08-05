/**
 * Telas — catálogo de materiales GLOBAL (F1-E3, PIEZA A — Telas unificadas, D5 — ADR-0009).
 *
 * Dos servicios:
 *
 *  • **`ServicioTelasCategorias`**: CRUD simple de `TelaCategoria` (réplica del patrón de
 *    Cortadores), con `nombre` único global (ADR-0007, A9) y borrado suave. SIN permiso
 *    propio: se gobierna con `telas.ver`/`telas.administrar` (ADR-0009, mismo criterio de
 *    sub-catálogo sin permiso propio que `TelaColor`).
 *  • **`ServicioTelas`**: CRUD de la `Tela` UNIFICADA con su grid de colores con precio.
 *    La tela y su set de `colores` (N:N a `Color` de F1-E1, cada renglón con `precio`) se
 *    crean/editan EN UNA transacción (A2): calca `sincronizarTipos` del Maquilero, pero el
 *    diff además compara y actualiza el `precio` de cada color. A diferencia del maquilero,
 *    el grid PUEDE quedar VACÍO (una tela sin colores es válida).
 *
 * 🔑 **Regla de diseño (ADR-0009): la tela del BOM y la del inventario son LA MISMA
 * entidad.** Esta tabla `telas` sirve a la vez al BOM del modelo (doc `01-Modelos.md` §2,
 * `TelasDis`) y al inventario de telas (doc `04-Inventarios.md` §B.2, `Telas`) — corrige
 * la dualidad Telas/TelasDis del viejo. En F4, `Lote`/`LoteComponente` colgarán de esta
 * `Tela` SIN retocarla: por eso aquí no se modela existencia ni lote, solo el catálogo.
 *
 * Reglas (verificación de Gabriel): un COLOR usado por una tela ACTIVA no se puede
 * desactivar ni borrar — eso lo cubre el `onDelete: Restrict` (físico) y el dominio de
 * Colores (suave), NO este archivo. Aquí solo se exige que los colores asignados a una
 * tela EXISTAN y estén ACTIVOS al capturarlos (igual que las tallas de una curva).
 *
 * Piezas del patrón conservadas (PLANMAESTRO §9.2): permiso primero
 * (`telas.ver`/`.administrar`); Zod compartido de `src/contrato`; todo cambio en UNA
 * transacción (A2) con auditoría (A7) + `Bitacora` juntos o nada; borrado SUAVE reversible
 * (`activo`); unicidad validada en la transacción y respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import type { esquemaTelaColores } from '../../contrato/esquemas/tela.js';
import {
  esquemaTelaCategoriaCrear,
  esquemaTelaCategoriaEditar,
  esquemaTelaCrear,
  esquemaTelaEditar,
} from '../../contrato/esquemas/tela.js';
import type { Prisma, Tela, TelaCategoria } from '../../datos/index.js';
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
//  TELA — entidad unificada (BOM + inventario) con grid de colores con precio
// ════════════════════════════════════════════════════════════════════════════════

/** Alta de tela (datos + grid de colores inline). */
export type EntradaCrearTela = z.input<typeof esquemaTelaCrear>;

/** Edición de tela: `id` + cambios parciales (incluye `activo` y, opcional, `colores`). */
export type EntradaActualizarTela = z.input<typeof esquemaTelaEditar>;

/** Renglón de color tal como llega validado (precio ya como `number | undefined`). */
type ColorEntrada = z.output<typeof esquemaTelaColores>[number];

/** Parámetros del listado de telas (forma nativa, no la de la URL). */
export const esquemaListarTelas = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(150).optional(),
  idCategoria: z.number().int().positive().optional(),
  idColor: z.number().int().positive().optional(),
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros que acepta `listarTelas` (forma nativa, no la de la URL). */
export type ParametrosListarTelas = z.input<typeof esquemaListarTelas>;

/** Tela con su categoría y sus colores cargados (forma que consume la ruta para la salida). */
export type TelaConColores = Tela & {
  categoria: Pick<TelaCategoria, 'nombre'> | null;
  colores: { idColor: number; precio: Prisma.Decimal | null; color: { nombre: string } }[];
};

/** `include` estándar para traer la categoría y los colores (ordenados por nombre de color). */
const incluirCategoriaYColores = {
  categoria: { select: { nombre: true } },
  colores: {
    select: { idColor: true, precio: true, color: { select: { nombre: true } } },
    orderBy: { color: { nombre: 'asc' } },
  },
} satisfies Prisma.TelaInclude;

/** Campos de TEXTO opcionales editables (clave del payload === clave del modelo). */
// `unidadMedida` NO va aquí: es un enum NOT NULL desde el 30-jul-2026 y este loop convierte
// ''/null en NULL — escribiría NULL en una columna que no lo admite (500). Se maneja abajo con
// los demás enums. Hoy el Zod del contrato lo filtraría antes, pero eso es una defensa en OTRO
// archivo: aflojar `esquemaTelaEditar` bastaría para reventarlo (hallazgo del reviewer).
const CAMPOS_TEXTO_EDITABLES = ['descripcion'] as const;

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
 * Valida que todos los colores de `idsColores` existan y estén ACTIVOS (no se asigna un
 * color desactivado a una tela). Lanza `ErrorValidacion` con mensaje claro. (El arreglo ya
 * viene sin repetidos por el esquema Zod.) Mismo criterio que `exigirTallasValidas`.
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
      `El color "${inactivo.nombre}" está desactivado y no se puede asignar a la tela.`,
    );
  }
}

/**
 * Reemplaza el grid de colores de una tela DENTRO de la transacción (A2): borra los que
 * sobran, crea los que faltan y ACTUALIZA el precio de los que cambiaron (diff mínimo, sin
 * tocar lo que no varía — así se conserva la auditoría de cada renglón). Exige colores
 * válidos y activos. Devuelve true si hubo algún cambio (para la bitácora). Calca
 * `sincronizarTipos` del maquilero, sumando la comparación de `precio`.
 */
async function sincronizarColores(
  tx: Tx,
  sesion: SesionUsuario,
  idTela: number,
  deseados: ColorEntrada[],
): Promise<boolean> {
  await exigirColoresValidos(
    tx,
    deseados.map((c) => c.idColor),
  );

  const actuales = await tx.telaColor.findMany({
    where: { idTela },
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
    await tx.telaColor.deleteMany({ where: { idTela, idColor: { in: aQuitar } } });
  }
  if (aAgregar.length > 0) {
    await tx.telaColor.createMany({
      data: aAgregar.map((c) => ({
        idTela,
        idColor: c.idColor,
        ...(c.precio === undefined ? {} : { precio: c.precio }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const c of aActualizar) {
    await tx.telaColor.update({
      where: { idTela_idColor: { idTela, idColor: c.idColor } },
      data: { precio: c.precio ?? null, ...datosModificacion(sesion) },
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
  datos: z.output<typeof esquemaTelaCrear>,
): Partial<Prisma.TelaUncheckedCreateInput> {
  const data: Partial<Prisma.TelaUncheckedCreateInput> = {};
  if (datos.descripcion !== undefined) data.descripcion = datos.descripcion;
  if (datos.unidadMedida !== undefined) data.unidadMedida = datos.unidadMedida;
  if (datos.precioSugerido !== undefined) data.precioSugerido = datos.precioSugerido;
  if (datos.idCategoria !== undefined) data.idCategoria = datos.idCategoria;
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

  // precioSugerido (decimal nullable): omitir = no tocar; `null` = quitar; número = fijar.
  if (cambiaDecimal(datos.precioSugerido, actual.precioSugerido)) {
    const nuevo = datos.precioSugerido ?? null;
    cambios.precioSugerido = nuevo;
    detalle.precioSugerido = {
      de: actual.precioSugerido === null ? null : actual.precioSugerido.toNumber(),
      a: nuevo,
    };
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
 * permiso `telas.administrar`; `nombre` único global → `ErrorConflicto`; `idCategoria`
 * opcional (si viene, existe y activa); colores existentes y ACTIVOS, sin repetir (puede
 * ir vacío); nace activa; auditoría y bitácora en la misma transacción (A7).
 *
 * 🔑 La tela creada aquí es la MISMA que usarán el BOM (F4) y el inventario (F4): no se
 * duplica la entidad. (ADR-0009.)
 *
 * @example
 * const t = await crearTela(sesion, {
 *   nombre: "Felpa 100% algodón", idCategoria: idFelpa, unidadMedida: "KG",
 *   colores: [{ idColor: idNegro, precio: 95 }, { idColor: idBlanco }],
 * });
 */
export async function crearTela(
  sesion: SesionUsuario,
  entrada: EntradaCrearTela,
  bd?: ContextoBd,
): Promise<TelaConColores> {
  verificarPermiso(sesion, 'telas.administrar');
  const datos = validarEntrada(esquemaTelaCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreTelaLibre(tx, datos.nombre);
      if (datos.idCategoria !== undefined) {
        await exigirCategoriaValida(tx, datos.idCategoria);
      }

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
          colores: datos.colores.map((c) => ({ idColor: c.idColor, precio: c.precio ?? null })),
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
                      idColor: c.idColor,
                      precio: c.precio ?? null,
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
export type TelaColorDetalle = { idColor: number; nombre: string; precio: Prisma.Decimal | null };

/**
 * Lista los colores de una tela (con su precio), ordenados por nombre de color. Lectura de
 * solo `telas.ver`. Lanza `ErrorNoEncontrado` si la tela no existe.
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
  const colores = await cliente.telaColor.findMany({
    where: { idTela },
    select: { idColor: true, precio: true, color: { select: { nombre: true } } },
    orderBy: { color: { nombre: 'asc' } },
  });
  return colores.map((c) => ({ idColor: c.idColor, nombre: c.color.nombre, precio: c.precio }));
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

  // La búsqueda mira el nombre de la tela Y EL DE SUS COLORES (petición de Daniel, 30-jul-2026:
  // *"me gustaría poder buscar por color, por tipo de tela"*): en el almacén se busca "negro" mucho
  // más seguido que el nombre exacto de la tela, y cada tela trae sus colores adentro.
  const where: Prisma.TelaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.idCategoria === undefined ? {} : { idCategoria: filtros.idCategoria }),
    ...(filtros.idColor === undefined ? {} : { colores: { some: { idColor: filtros.idColor } } }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
            {
              colores: {
                some: { color: { nombre: { contains: filtros.busqueda, mode: 'insensitive' } } },
              },
            },
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
