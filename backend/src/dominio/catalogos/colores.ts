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
import type { Prisma } from '../../datos/index.js';
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
import { contarUsosConRastro, repuntarReferenciasDeColor } from './colores-fusion-referencias.js';

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
 * ⭐ Lo que TODA salida de color arrastra además de sus columnas: **a dónde se fue si una fusión se
 * lo llevó**, con el NOMBRE del canónico.
 *
 * Va en un `include` COMPARTIDO por todos los productores (crear, actualizar, obtener, listar,
 * fusionar) y no sólo en las lecturas a propósito: el contrato declara el campo en UNA sola forma de
 * salida, así que un productor que no lo trajera tendría que rellenarlo con `null` — y ese `null`
 * sería MENTIRA justo en el caso que esta etapa vino a hacer visible.
 */
const INCLUIR_FUSIONADO_EN = { fusionadoEn: { select: { id: true, nombre: true } } } as const;

/** Un color con el rastro de la fusión que se lo llevó (null si no se lo llevó nadie). */
export type ColorConFusion = Prisma.ColorGetPayload<{ include: typeof INCLUIR_FUSIONADO_EN }>;

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
async function exigirColor(tx: Tx, id: number): Promise<ColorConFusion> {
  const color = await tx.color.findUnique({ where: { id }, include: INCLUIR_FUSIONADO_EN });
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
): Promise<ColorConFusion> {
  verificarPermiso(sesion, 'colores.administrar');
  const datos = validarEntrada(esquemaColorCrear, entrada);
  const nombre = normalizarNombreColor(datos.nombre);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, nombre);

      const color = await tx.color.create({
        data: { nombre, ...datosCreacion(sesion) },
        include: INCLUIR_FUSIONADO_EN,
      });

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
): Promise<ColorConFusion> {
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
      // ⭐ V1-E8s — REACTIVAR A MANO ES DESHACER LA FUSIÓN, así que se BORRA el rastro
      // (`idFusionadoEn`). Si no se borrara, el color quedaría activo pero seguiría diciendo "a mí me
      // absorbió aquél", y el importador de OC (que sigue ese rastro) mandaría al canónico un color
      // que su dueño acaba de resucitar a propósito. El rastro sólo vale mientras el color esté
      // apagado. `deshaceFusion` deja en la bitácora de quién se lo desamarró (A7).
      const deshaceFusion = reactiva && actual.idFusionadoEn !== null ? actual.idFusionadoEn : null;
      if (reactiva) {
        cambios.fusionadoEn = { disconnect: true };
      }

      const color = await tx.color.update({
        where: { id: datos.id },
        data: cambios,
        include: INCLUIR_FUSIONADO_EN,
      });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Color',
          idEntidad: color.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: color.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
            ...(deshaceFusion !== null ? { deshaceFusionDe: deshaceFusion } : {}),
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
): Promise<ColorConFusion> {
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
): Promise<ColorConFusion> {
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
 * ⭐⭐ **FUSIONA COLORES DUPLICADOS EN UNO CANÓNICO — y desde la fila 0.159 ya no se niega a hacerlo
 * porque el duplicado esté en uso** (§Post-F9.222).
 *
 * Qué hace, en orden, dentro de UNA transacción (A2: o se consolida entero o no se toca nada):
 *  1. **REPUNTA** al destino lo que es catálogo o amarre derivado —los colores de tela ligados, los
 *     precios por color de proveedor, los modelos nacidos del color y los amarres color-de-tela de
 *     las órdenes—, resolviendo las colisiones de llave única a favor del destino
 *     (`colores-fusion-referencias.ts`).
 *  2. **DEJA QUIETO** todo lo que es documento o movimiento asentado —la matriz de la orden (D7), el
 *     corte, el recibo, el kardex de PT, los faltantes saldados, las líneas de OC— y lo **anota en la
 *     bitácora**: son las filas que se quedan apuntando al color absorbido, y que quien las compara
 *     resuelve por el CANÓNICO (`colores-canonicos.ts`).
 *  3. **APAGA** cada origen (borrado suave, D3: nunca se borra físico) sellando el RASTRO
 *     `idFusionadoEn` de quién se lo llevó.
 *
 * ⚠️ **Por qué dejó de bloquear.** §Post-F9.129 la hizo negarse en cuanto el origen se usaba fuera de
 * las telas, y la primera referencia de esa lista era `OrdenLinea` ⇒ un color que hubiera entrado a
 * UNA orden ya no se podía unificar **nunca**, y el problema empeoraba solo. La negativa protegía algo
 * real (una orden con color inactivo no se podía editar); eso se arregló donde tocaba —en
 * `sincronizarMatriz`, que ya no exige que un color YA PRESENTE en la matriz esté activo— en vez de
 * dejar los duplicados atrapados para siempre.
 *
 * Reglas: permiso `colores.administrar`; el destino y cada origen deben existir; un color no puede
 * fusionarse consigo mismo (Zod ya excluye el destino de los orígenes). El destino se REACTIVA si
 * estaba desactivado (es el canónico que sobrevive).
 *
 * @returns el color DESTINO sobreviviente (ya consolidado).
 */
export async function fusionarColores(
  sesion: SesionUsuario,
  entrada: EntradaFusionarColores,
  bd?: ContextoBd,
): Promise<ColorConFusion> {
  verificarPermiso(sesion, 'colores.administrar');
  const datos = validarEntrada(esquemaColorFusionar, entrada);

  return enTransaccion(async (tx) => {
    const destino = await exigirColor(tx, datos.idDestino);

    let referenciasMovidas = 0;
    const origenesFusionados: { id: number; nombre: string }[] = [];

    for (const idOrigen of datos.origenes) {
      const origen = await exigirColor(tx, idOrigen);

      // Lo que NO se mueve se cuenta ANTES de apagar el origen: después seguiría dando el mismo
      // número (nada se borra), pero contarlo aquí deja claro que es una FOTO del momento de la
      // fusión, que es lo que la bitácora tiene que poder contestar dentro de un año.
      const conRastro = await contarUsosConRastro(tx, idOrigen);
      const repunte = await repuntarReferenciasDeColor(tx, {
        idOrigen,
        idDestino: datos.idDestino,
      });
      referenciasMovidas += repunte.movidos;

      // Borrado suave del origen + ⭐ V1-E8s: el RASTRO de quién se lo llevó (`idFusionadoEn`).
      // Se escribe SIEMPRE, aunque el origen ya estuviera apagado: el dato nuevo es a DÓNDE se fue,
      // y sin él nadie aguas abajo puede distinguir "lo apagó su dueño" de "lo absorbió una fusión".
      // De esa distinción vive `resolverOCrearColor` del importador de OC: al primero lo reactiva,
      // al segundo lo REDIRIGE al canónico en vez de resucitarlo (y dejarlo infusionable).
      await tx.color.update({
        where: { id: idOrigen },
        data: {
          activo: false,
          fusionadoEn: { connect: { id: datos.idDestino } },
          ...datosModificacion(sesion),
        },
      });
      origenesFusionados.push({ id: origen.id, nombre: origen.nombre });

      // Bitácora por cada origen absorbido (auditoría granular A7): a dónde se fue, cuántas
      // referencias se movieron, QUÉ SE QUEDÓ colgando de él y qué se descartó por colisión.
      await registrarBitacora(tx, sesion, {
        entidad: 'Color',
        idEntidad: origen.id,
        accion: 'OTRO',
        datos: {
          operacion: 'fusionar',
          fusionadoEn: { id: destino.id, nombre: destino.nombre },
          referenciasRepuntadas: repunte.movidos,
          // Lo que se queda apuntando a este color (documentos y movimientos, D3/D7). No es un
          // error: es la parte de la fusión que se resuelve leyendo el rastro, y queda dicha.
          quedanConRastro: conRastro.map((u) => ({ que: u.etiqueta, cuantos: u.cuenta })),
          ...(repunte.descartados.length > 0 ? { descartados: repunte.descartados } : {}),
        },
      });
    }

    // El destino sobrevive y queda activo (es el canónico). Toca `modificadoPor` y, si
    // estaba apagado, lo reactiva. Bitácora resumen de la consolidación en el destino.
    //
    // ⭐ V1-E8s — y se le LIMPIA su propio rastro: al canónico no lo absorbe nadie. Con eso **el
    // DOMINIO no puede cerrar un círculo** (A→B y luego B→A deja `B→A` con `A` terminal).
    // ⚠️ Ojo con el absoluto: eso vale para lo que escribe ESTE código. El **backfill** de la
    // migración `20260829120000_a_donde_se_fue_el_color` lee la BITÁCORA —que guarda también fusiones
    // ya deshechas— y sí puede sembrar un anillo, por eso esa migración lo rompe explícitamente.
    const destinoActualizado = await tx.color.update({
      where: { id: datos.idDestino },
      data: { activo: true, fusionadoEn: { disconnect: true }, ...datosModificacion(sesion) },
      include: INCLUIR_FUSIONADO_EN,
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

/**
 * ⭐ El **CANÓNICO** de un color (el que sobrevivió a la fusión) vive en su propio módulo desde la
 * fila 0.159, junto a la versión de LOTE que necesita la explosión de materiales. Se re-exporta
 * aquí porque `colores.ts` era su casa y media docena de módulos lo importan por este nombre:
 * mover el archivo sin dejar la puerta habría sido un renombre disfrazado de refactor.
 */
export { colorCanonico, type ColorCanonico } from './colores-canonicos.js';

/** Obtiene un color por id o lanza `ErrorNoEncontrado`. */
export async function obtenerColor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ColorConFusion> {
  verificarPermiso(sesion, 'colores.ver');
  const color = await clienteLectura(bd).color.findUnique({
    where: { id },
    include: INCLUIR_FUSIONADO_EN,
  });
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
): Promise<Pagina<ColorConFusion>> {
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
      include: INCLUIR_FUSIONADO_EN,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
