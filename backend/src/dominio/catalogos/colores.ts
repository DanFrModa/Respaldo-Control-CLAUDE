/**
 * Colores — catálogo maestro GLOBAL (F1-E1).
 *
 * Replica el CRUD patrón de Almacenes (`dominio/admin/almacenes.ts`) SIN lógica de
 * empresa: catálogo global, sin `idEmpresa` (ADR-0007, decisión A9). Unicidad de
 * `nombre` global (`@unique`).
 *
 * Doc funcional: `Documentacion_MJD/04-Inventarios.md` §B.2 (`TelasColores.Color` era
 * texto libre en el viejo): este catálogo lo normaliza a una entidad única.
 *
 * REGLA propia — normalización LIGERA en el dominio ({@link normalizarNombreColor}):
 * `trim` + colapsar espacios internos a uno solo, antes de validar unicidad y guardar.
 * Así "NEGRO  AZUL" y "NEGRO AZUL" son el mismo color. La normalización/fusión PESADA
 * de duplicados (alias: "NEGRO A"/"NEGRO B" → un solo color preservando referencias)
 * llega en F1-E6, NO aquí: aquí solo se garantiza unicidad por nombre normalizado.
 *
 * Piezas del patrón conservadas: permiso primero (`colores.ver`/`.administrar`,
 * PLANMAESTRO §9.2); Zod compartido; transacción única (A2) con auditoría (A7) +
 * `Bitacora`; borrado SUAVE reversible; unicidad respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import {
  esquemaColorCrear,
  esquemaColorEditar,
  esquemaColorFusionar,
} from '../../contrato/index.js';
import type { Color, Prisma } from '../../datos/index.js';
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
import {
  contarUsosQueBloqueanFusion,
  mensajeFusionBloqueada,
} from './colores-fusion-referencias.js';

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearColor = z.input<typeof esquemaColorCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarColor = z.input<typeof esquemaColorEditar>;

/** Fusión de duplicados: color(es) origen → color destino canónico. */
export type EntradaFusionarColores = z.input<typeof esquemaColorFusionar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarColores = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(80).optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarColores = z.input<typeof esquemaListarColores>;

/**
 * Normalización LIGERA del nombre de color (F1-E1): recorta extremos y colapsa
 * cualquier secuencia de espacios internos a uno solo. NO toca mayúsculas/acentos ni
 * fusiona variantes (eso es F1-E6). El Zod compartido ya recortó; esto añade el
 * colapso de espacios internos, que es regla de dominio.
 *
 * @example normalizarNombreColor("  NEGRO   AZUL ") === "NEGRO AZUL"
 */
export function normalizarNombreColor(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ');
}

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos colores con el mismo
 * nombre normalizado, sin importar mayúsculas. Se valida en la transacción; la carrera
 * residual la captura el unique de la base (P2002 → `ErrorConflicto`). Recibe el nombre
 * YA normalizado.
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.color.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un color llamado "${nombre}".`
        : `Ya existe un color llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un color por id o lanza `ErrorNoEncontrado`. */
async function exigirColor(tx: Tx, id: number): Promise<Color> {
  const color = await tx.color.findUnique({ where: { id } });
  if (color === null) {
    throw new ErrorNoEncontrado('Color', id);
  }
  return color;
}

/**
 * Crea un color (catálogo global). Reglas: permiso `colores.administrar`; nombre
 * normalizado y único global → `ErrorConflicto`; nace activo; auditoría y bitácora en
 * la misma transacción (A2/A7).
 */
export async function crearColor(
  sesion: SesionUsuario,
  entrada: EntradaCrearColor,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  const datos = validarEntrada(esquemaColorCrear, entrada);
  const nombre = normalizarNombreColor(datos.nombre);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, nombre);

      const color = await tx.color.create({ data: { nombre, ...datosCreacion(sesion) } });

      await registrarBitacora(tx, sesion, {
        entidad: 'Color',
        idEntidad: color.id,
        accion: 'CREAR',
        datos: { nombre: color.nombre },
      });

      return color;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un color llamado "${nombre}".`, { causa: error });
    }
    throw error;
  }
}

/**
 * Actualiza un color: nombre (normalizado) y/o `activo` para desactivar (borrado suave)
 * o reactivar. Bitácora según lo que pasó: `MODIFICAR` con el detalle, y/o `DESACTIVAR`
 * si el cambio lo apagó.
 */
export async function actualizarColor(
  sesion: SesionUsuario,
  entrada: EntradaActualizarColor,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  const datos = validarEntrada(esquemaColorEditar, entrada);
  const nombreNuevo = datos.nombre === undefined ? undefined : normalizarNombreColor(datos.nombre);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirColor(tx, datos.id);

      const cambiaNombre = nombreNuevo !== undefined && nombreNuevo !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre && nombreNuevo !== undefined) {
        await exigirNombreLibre(tx, nombreNuevo, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const cambios: Prisma.ColorUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && nombreNuevo !== undefined) {
        cambios.nombre = nombreNuevo;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const color = await tx.color.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Color',
          idEntidad: color.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: color.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Color',
          idEntidad: color.id,
          accion: 'DESACTIVAR',
          datos: { nombre: color.nombre },
        });
      }

      return color;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un color con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un color. Desactivar dos veces es `ErrorConflicto`
 * (pantalla desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarColor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirColor(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El color "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarColor(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un color desactivado (operación inversa del borrado suave). */
export async function reactivarColor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirColor(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El color "${actual.nombre}" ya está activo.`);
    }
    return actualizarColor(sesion, { id, activo: true }, { tx });
  }, bd);
}

/**
 * Reasigna TODAS las referencias del color `idOrigen` al color `idDestino`, dentro de
 * la transacción `tx`. Hoy la ÚNICA tabla que referencia a `Color` es `TelaColor` — y
 * desde §Post-F9.11 esa referencia es la LIGA LEGACY `idColor` (nullable) de las filas
 * MIGRADAS: los colores de tela nuevos nacen sin liga y esta fusión no los toca.
 *
 * PUNTO CENTRAL DE EXTENSIÓN: cuando en el futuro otras tablas referencien a `Color`
 * (p. ej. colores de avíos, de modelos, de pedidos), agrega aquí su reasignación —
 * todas dentro de la MISMA transacción para que la fusión siga siendo todo-o-nada (A2).
 *
 * REGLA DE COLISIÓN (TelaColor): si el destino YA tiene una fila ligada en la MISMA
 * tela, no se mueve ciegamente (la tela quedaría con dos filas ligadas al mismo color
 * de prenda — el duplicado que la fusión existe para eliminar). Para esas telas:
 *   - GANA EL DESTINO (es el canónico), PERO cada dato que el destino tenga NULO y el
 *     origen SÍ traiga se RELLENA — `precio`, `pantone` y `precioComplemento` por igual
 *     (§Post-F9.11: no perder un dato que solo existía en el duplicado).
 *   - El renglón duplicado del origen se ELIMINA (ya no aporta nada).
 * Las telas SIN colisión simplemente re-ligan (`update` de `idColor`), conservando su
 * nombre propio.
 *
 * @returns cuántas referencias `TelaColor` se reasignaron o consolidaron (para bitácora).
 */
async function reasignarReferenciasColor(
  tx: Tx,
  idOrigen: number,
  idDestino: number,
): Promise<number> {
  const referenciasOrigen = await tx.telaColor.findMany({ where: { idColor: idOrigen } });
  if (referenciasOrigen.length === 0) {
    return 0;
  }

  // Telas donde el destino YA tiene fila ligada (para detectar colisiones).
  const referenciasDestino = await tx.telaColor.findMany({
    where: { idColor: idDestino },
    select: { id: true, idTela: true, precio: true, pantone: true, precioComplemento: true },
  });
  const destinoPorTela = new Map(referenciasDestino.map((r) => [r.idTela, r]));

  for (const ref of referenciasOrigen) {
    const destino = destinoPorTela.get(ref.idTela);
    if (destino === undefined) {
      // Sin colisión: la tela solo estaba ligada al origen → se re-liga al destino.
      await tx.telaColor.update({ where: { id: ref.id }, data: { idColor: idDestino } });
      continue;
    }

    // Colisión: el destino ya tiene fila en esta tela. Gana el destino; se rellena TODO
    // dato que tuviera nulo y el origen sí traiga (precio, pantone y precioComplemento).
    const relleno: {
      precio?: Prisma.Decimal;
      pantone?: string;
      precioComplemento?: Prisma.Decimal;
    } = {
      ...(destino.precio === null && ref.precio !== null ? { precio: ref.precio } : {}),
      ...(destino.pantone === null && ref.pantone !== null ? { pantone: ref.pantone } : {}),
      ...(destino.precioComplemento === null && ref.precioComplemento !== null
        ? { precioComplemento: ref.precioComplemento }
        : {}),
    };
    if (Object.keys(relleno).length > 0) {
      await tx.telaColor.update({ where: { id: destino.id }, data: relleno });
    }
    await tx.telaColor.delete({ where: { id: ref.id } });
  }

  return referenciasOrigen.length;
}

/**
 * Fusiona color(es) DUPLICADOS en un color DESTINO canónico (F1-E6). Reasigna las
 * referencias de TELA de cada origen al destino (resolviendo colisiones de PK en el puente
 * `TelaColor`, ver {@link reasignarReferenciasColor}), DESACTIVA cada origen (borrado
 * suave, no se borra físico) y registra bitácora de la fusión. Todo en UNA transacción
 * (A2): o se consolida entero o no se toca nada.
 *
 * ⚠️ **SE NIEGA si el origen ya se usa fuera de las telas** (§Post-F9.129): `Color` tiene
 * DOCE llaves foráneas entrantes y esta fusión sólo sabe mover UNA (`TelaColor`). Las otras
 * once quedarían apuntando a un color APAGADO — y una orden viva con color inactivo ya no se
 * puede editar (`sincronizarMatriz`). En vez de corromper en silencio, se RECHAZA con el
 * camino de salida dicho con letras. El porqué completo y la lista viven en
 * `colores-fusion-referencias.ts`. Rechazar no toca ni un dato: es la opción reversible.
 *
 * Reglas: permiso `colores.administrar`; el destino y cada origen deben existir; un
 * color no puede fusionarse consigo mismo (Zod ya excluye el destino de los orígenes).
 * El destino se REACTIVA si estaba desactivado (es el canónico que sobrevive).
 *
 * @returns el color DESTINO sobreviviente (ya consolidado).
 */
export async function fusionarColores(
  sesion: SesionUsuario,
  entrada: EntradaFusionarColores,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.administrar');
  const datos = validarEntrada(esquemaColorFusionar, entrada);

  return enTransaccion(async (tx) => {
    const destino = await exigirColor(tx, datos.idDestino);

    let referenciasMovidas = 0;
    const origenesFusionados: { id: number; nombre: string }[] = [];

    for (const idOrigen of datos.origenes) {
      const origen = await exigirColor(tx, idOrigen);

      // ⛔ §Post-F9.129 — el origen no puede estar en uso fuera de las telas. Se comprueba ANTES
      // de mover o desactivar nada: la tx entera se aborta (A2) y el catálogo queda intacto.
      const usos = await contarUsosQueBloqueanFusion(tx, idOrigen);
      if (usos.length > 0) {
        throw new ErrorConflicto(mensajeFusionBloqueada(origen.nombre, usos));
      }

      referenciasMovidas += await reasignarReferenciasColor(tx, idOrigen, datos.idDestino);

      // Borrado suave del origen (solo si seguía activo; idempotente si ya estaba apagado).
      if (origen.activo) {
        await tx.color.update({
          where: { id: idOrigen },
          data: { activo: false, ...datosModificacion(sesion) },
        });
      }
      origenesFusionados.push({ id: origen.id, nombre: origen.nombre });

      // Bitácora por cada origen absorbido (auditoría granular A7).
      await registrarBitacora(tx, sesion, {
        entidad: 'Color',
        idEntidad: origen.id,
        accion: 'OTRO',
        datos: {
          operacion: 'fusionar',
          fusionadoEn: { id: destino.id, nombre: destino.nombre },
        },
      });
    }

    // El destino sobrevive y queda activo (es el canónico). Toca `modificadoPor` y, si
    // estaba apagado, lo reactiva. Bitácora resumen de la consolidación en el destino.
    const destinoActualizado = await tx.color.update({
      where: { id: datos.idDestino },
      data: { activo: true, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Color',
      idEntidad: destino.id,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'fusionar',
        absorbio: origenesFusionados,
        referenciasReasignadas: referenciasMovidas,
      },
    });

    return destinoActualizado;
  }, bd);
}

/** Obtiene un color por id o lanza `ErrorNoEncontrado`. */
export async function obtenerColor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Color> {
  verificarPermiso(sesion, 'colores.ver');
  const color = await clienteLectura(bd).color.findUnique({ where: { id } });
  if (color === null) {
    throw new ErrorNoEncontrado('Color', id);
  }
  return color;
}

/**
 * Lista colores con búsqueda, orden y paginación EN SERVIDOR. Por defecto: solo
 * activos.
 */
export async function listarColores(
  sesion: SesionUsuario,
  parametros: ParametrosListarColores = {},
  bd?: ContextoBd,
): Promise<Pagina<Color>> {
  verificarPermiso(sesion, 'colores.ver');
  const filtros = validarEntrada(esquemaListarColores, parametros);

  const where: Prisma.ColorWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.color.count({ where }),
    cliente.color.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
