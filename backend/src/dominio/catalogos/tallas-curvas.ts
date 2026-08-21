/**
 * Tallas y Curvas — catálogo estructurado GLOBAL (F1-E2, PIEZA B — D4).
 *
 * Dos entidades relacionadas en maestro-detalle ORDENADO:
 *
 *  • **Talla**: catálogo simple (réplica del CRUD patrón de Cortadores), con `etiqueta`
 *    como clave de negocio única global (ADR-0007, A9) y un `orden` canónico de
 *    despliegue (no único; lo gestiona el dominio). Tallas ilimitadas (D4 —
 *    PLANMAESTRO §4; MEJORAS A6: anchos fijos `T1..T8` → catálogo).
 *  • **Curva**: conjunto ORDENADO de tallas (p. ej. "Caballero básica"). Es un
 *    maestro-detalle análogo a Proveedor↔roles (F1-E1B), pero con ORDEN: la `posicion`
 *    de cada talla se asigna por el ORDEN del arreglo `items`, y todo el conjunto se
 *    crea/edita EN UNA transacción A2. Solo se pueden incluir tallas ACTIVAS, sin
 *    repetir (lo respalda la PK compuesta `[idCurva, idTalla]`).
 *
 * **Regla clave (verificación de Gabriel): una talla EN USO por una curva ACTIVA no se
 * puede desactivar ni borrar.** El `onDelete: Restrict` de la base cubre el borrado
 * FÍSICO; aquí se cubre el borrado SUAVE: `desactivarTalla` (y `actualizarTalla` con
 * `activo:false`) RECHAZA con `ErrorConflicto` y mensaje claro si la talla está
 * referenciada por alguna curva activa. Las curvas DESACTIVADAS no bloquean (su receta
 * ya no se usa); reactivar una curva exige que sus tallas sigan activas.
 *
 * Doc funcional: `Documentacion_MJD/DECISIONES.md` D4; `MEJORAS.md` A6. Piezas del
 * patrón conservadas: permiso primero (`tallas.ver`/`.administrar`); Zod compartido de
 * `src/contrato`; todo cambio en UNA transacción (A2) con auditoría (A7) + `Bitacora`
 * juntos o nada; borrado SUAVE reversible (`activo`); unicidad validada en la
 * transacción y respaldada por el unique de la base (P2002 → `ErrorConflicto`); listado
 * paginado/ordenado/buscado en servidor.
 */
import {
  esquemaCurvaCrear,
  esquemaCurvaEditar,
  esquemaTallaCrear,
  esquemaTallaEditar,
} from '../../contrato/index.js';
import type { CurvaTalla, Prisma, Talla } from '../../datos/index.js';
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

import { deducirOrdenTalla, ORDEN_SIN_ASIGNAR } from './orden-de-tallas.js';

// ════════════════════════════════════════════════════════════════════════════════
//  TALLA — catálogo simple (CRUD patrón)
// ════════════════════════════════════════════════════════════════════════════════

/** Alta de talla (catálogo global, sin `idEmpresa`). */
export type EntradaCrearTalla = z.input<typeof esquemaTallaCrear>;

/** Edición de talla: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarTalla = z.input<typeof esquemaTallaEditar>;

/**
 * Parámetros del listado de tallas EN DOMINIO (tipos ya nativos: `boolean`/`number`),
 * distinto del esquema de la URL del contrato (`esquemaListarTallas`, con coerción de
 * texto). La ruta valida/coacciona la querystring y pasa el resultado nativo aquí —
 * mismo patrón que `listarCortadores`.
 */
export const esquemaListarTallas = esquemaPaginacion.extend({
  /** Texto a buscar en la etiqueta (insensible a mayúsculas). */
  busqueda: z.string().trim().max(50).optional(),
  /** Por omisión solo activas; `true` muestra también las desactivadas. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['etiqueta', 'orden', 'creadoEn']).default('orden'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros que acepta `listarTallas` (forma nativa, no la de la URL). */
export type ParametrosListarTallas = z.input<typeof esquemaListarTallas>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos tallas con la misma
 * `etiqueta`, sin importar mayúsculas ("CH" ≡ "ch"). Se valida DENTRO de la
 * transacción; la carrera residual la captura el unique de la base (P2002).
 */
async function exigirEtiquetaLibre(tx: Tx, etiqueta: string, idActual?: number): Promise<void> {
  const existente = await tx.talla.findFirst({
    where: {
      etiqueta: { equals: etiqueta, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe una talla con la etiqueta "${etiqueta}".`
        : `Ya existe una talla con la etiqueta "${etiqueta}" (está desactivada; puedes reactivarla).`,
    );
  }
}

/** Busca una talla por id o lanza `ErrorNoEncontrado`. */
async function exigirTalla(tx: Tx, id: number): Promise<Talla> {
  const talla = await tx.talla.findUnique({ where: { id } });
  if (talla === null) {
    throw new ErrorNoEncontrado('Talla', id);
  }
  return talla;
}

/**
 * Cuenta cuántas curvas ACTIVAS usan la talla. Sirve para impedir el borrado suave de
 * una talla en uso (la regla de Gabriel): las curvas desactivadas no cuentan, su receta
 * ya no se aplica.
 */
async function contarCurvasActivasConTalla(tx: Tx, idTalla: number): Promise<number> {
  return tx.curvaTallaItem.count({
    where: { idTalla, curva: { activo: true } },
  });
}

/**
 * Impide desactivar una talla referenciada por alguna curva ACTIVA (regla de Gabriel):
 * el `onDelete: Restrict` cubre el borrado físico; esto cubre el suave. Mensaje claro
 * con cuántas curvas la usan para que el usuario sepa qué hacer.
 */
async function exigirTallaSinUsoActivo(tx: Tx, talla: Talla): Promise<void> {
  const enUso = await contarCurvasActivasConTalla(tx, talla.id);
  if (enUso > 0) {
    throw new ErrorConflicto(
      `No se puede desactivar la talla "${talla.etiqueta}": la usan ${String(enUso)} ` +
        `curva(s) activa(s). Quítala de esas curvas (o desactívalas) primero.`,
    );
  }
}

/**
 * Crea una talla (catálogo global). Reglas: permiso `tallas.administrar`; `etiqueta`
 * única global → `ErrorConflicto`; nace activa; auditoría y bitácora en la misma
 * transacción (A2/A7).
 *
 * ⭐ **V1-E3r (§Post-F9.81) — el `orden` se DEDUCE cuando nadie lo da.** Antes se quedaba en el
 * `@default(0)` de la base y el desempate caía en la etiqueta: *CH, G, M, XG*. Éste es EL hueco
 * por el que se colaron las 94 tallas del Access —el ETL llama aquí con sólo `{ etiqueta }`—, así
 * que taparlo aquí lo tapa para el ETL, para la pantalla y para cualquier llamador futuro.
 *
 * ⚠️ Se distingue "no vino" de "vino un número": `orden === undefined` deduce; cualquier valor
 * dado MANDA (el contrato ya lo obliga a ser ≥1, así que el 0 no puede llegar por aquí y sigue
 * significando lo único que significa: *nadie le puso orden*). Si la escala no reconoce la
 * etiqueta, se deja el 0 del `@default` — no se inventa una posición.
 */
export async function crearTalla(
  sesion: SesionUsuario,
  entrada: EntradaCrearTalla,
  bd?: ContextoBd,
): Promise<Talla> {
  verificarPermiso(sesion, 'tallas.administrar');
  const datos = validarEntrada(esquemaTallaCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirEtiquetaLibre(tx, datos.etiqueta);

      const ordenDeducido = deducirOrdenTalla(datos.etiqueta);
      const orden = datos.orden === undefined ? ordenDeducido : datos.orden;

      const talla = await tx.talla.create({
        data: {
          etiqueta: datos.etiqueta,
          ...(orden === null ? {} : { orden }),
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Talla',
        idEntidad: talla.id,
        accion: 'CREAR',
        datos: { etiqueta: talla.etiqueta, orden: talla.orden },
      });

      return talla;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una talla con la etiqueta "${datos.etiqueta}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza una talla: `etiqueta`, `orden` y/o `activo` para desactivar (borrado suave)
 * o reactivar. Si el cambio DESACTIVA la talla, se exige que no esté en uso por ninguna
 * curva activa (regla de Gabriel). Bitácora según lo que pasó: `MODIFICAR` con el
 * detalle, y/o `DESACTIVAR` si el cambio la apagó.
 *
 * ⭐ **RENOMBRAR RE-DEDUCE el orden** (§Post-F9.81) — pero sólo cuando el orden vigente es el que
 * puso la escala, no una persona. {@link crearTalla} deduce el orden de la etiqueta; si el
 * renombrado no hiciera lo mismo, el defecto que la etapa vino a matar entraría por otra puerta:
 * dar de alta `CH` (orden 1040, zona de las letras) y renombrarla a `3M` la dejaría **para siempre**
 * ordenándose después de toda talla numérica, y el **seed jamás la repararía** porque su orden ya
 * no es el sentinela 0.
 *
 * La condición para re-deducir es que **nadie haya puesto el orden a mano**, y eso se sabe con
 * certeza en dos casos y sólo en dos:
 *
 *  • `orden === 0` — el sentinela: nadie le puso nada.
 *  • `orden === deducirOrdenTalla(etiquetaVieja)` — el valor vigente es EXACTAMENTE el que la
 *    escala produjo para la etiqueta que se está cambiando, así que lo puso la escala.
 *
 * Cualquier otro valor es una decisión humana y **no se toca**. Y si en la MISMA llamada viene un
 * `orden` explícito, ése MANDA (misma regla que en el alta): la persona gana siempre.
 *
 * ⚠️ Si la etiqueta NUEVA no la reconoce la escala, el orden vuelve al **sentinela 0**, no se queda
 * con el de la etiqueta vieja: quedarse sería afirmar que `UT` va donde iba `CH`, que es justo lo
 * que este módulo se niega a inventar. Con 0 desempata por etiqueta y el seed puede repararla el
 * día que la escala aprenda esa etiqueta.
 */
export async function actualizarTalla(
  sesion: SesionUsuario,
  entrada: EntradaActualizarTalla,
  bd?: ContextoBd,
): Promise<Talla> {
  verificarPermiso(sesion, 'tallas.administrar');
  const datos = validarEntrada(esquemaTallaEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirTalla(tx, datos.id);

      const cambiaEtiqueta = datos.etiqueta !== undefined && datos.etiqueta !== actual.etiqueta;
      const cambiaOrden = datos.orden !== undefined && datos.orden !== actual.orden;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaEtiqueta && !cambiaOrden && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaEtiqueta) {
        await exigirEtiquetaLibre(tx, datos.etiqueta ?? actual.etiqueta, datos.id);
      } else if (reactiva) {
        await exigirEtiquetaLibre(tx, actual.etiqueta, datos.id);
      }

      // Regla de Gabriel: una talla usada por una curva ACTIVA no se puede desactivar.
      if (desactiva) {
        await exigirTallaSinUsoActivo(tx, actual);
      }

      // ⭐ El orden SIGUE a la etiqueta mientras sea la escala quien lo puso (ver TSDoc).
      const loPusoLaEscala =
        actual.orden === ORDEN_SIN_ASIGNAR || actual.orden === deducirOrdenTalla(actual.etiqueta);
      const ordenRededucido =
        cambiaEtiqueta && datos.orden === undefined && loPusoLaEscala
          ? (deducirOrdenTalla(datos.etiqueta ?? actual.etiqueta) ?? ORDEN_SIN_ASIGNAR)
          : null;
      const cambiaOrdenDeducido = ordenRededucido !== null && ordenRededucido !== actual.orden;

      const cambios: Prisma.TallaUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaEtiqueta && datos.etiqueta !== undefined) {
        cambios.etiqueta = datos.etiqueta;
      }
      if (cambiaOrden && datos.orden !== undefined) {
        cambios.orden = datos.orden;
      } else if (cambiaOrdenDeducido && ordenRededucido !== null) {
        cambios.orden = ordenRededucido;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const talla = await tx.talla.update({ where: { id: datos.id }, data: cambios });

      if (cambiaEtiqueta || cambiaOrden || cambiaOrdenDeducido || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Talla',
          idEntidad: talla.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaEtiqueta ? { etiqueta: { de: actual.etiqueta, a: talla.etiqueta } } : {}),
            // El orden re-deducido también se audita (A7): el cambio no lo pidió nadie, así que
            // sin bitácora sería un movimiento invisible en la fila.
            ...(cambiaOrden || cambiaOrdenDeducido
              ? { orden: { de: actual.orden, a: talla.orden } }
              : {}),
            ...(cambiaOrdenDeducido ? { ordenRededucidoDeLaEtiqueta: true } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Talla',
          idEntidad: talla.id,
          accion: 'DESACTIVAR',
          datos: { etiqueta: talla.etiqueta },
        });
      }

      return talla;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una talla con esa etiqueta.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) una talla. RECHAZA si la usa alguna curva ACTIVA (regla de
 * Gabriel). Desactivar dos veces es `ErrorConflicto` (pantalla desactualizada). Atajo
 * explícito del botón "Desactivar".
 */
export async function desactivarTalla(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Talla> {
  verificarPermiso(sesion, 'tallas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTalla(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La talla "${actual.etiqueta}" ya está desactivada.`);
    }
    await exigirTallaSinUsoActivo(tx, actual);
    return actualizarTalla(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva una talla desactivada (operación inversa del borrado suave). */
export async function reactivarTalla(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Talla> {
  verificarPermiso(sesion, 'tallas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirTalla(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`La talla "${actual.etiqueta}" ya está activa.`);
    }
    return actualizarTalla(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene una talla por id o lanza `ErrorNoEncontrado`. */
export async function obtenerTalla(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Talla> {
  verificarPermiso(sesion, 'tallas.ver');
  const talla = await clienteLectura(bd).talla.findUnique({ where: { id } });
  if (talla === null) {
    throw new ErrorNoEncontrado('Talla', id);
  }
  return talla;
}

/**
 * Lista tallas con búsqueda, orden y paginación EN SERVIDOR. Por defecto: solo activas.
 * El orden por defecto es `orden` (el canónico de despliegue), luego por id para que el
 * resultado sea estable cuando varias tallas comparten `orden`.
 */
export async function listarTallas(
  sesion: SesionUsuario,
  parametros: ParametrosListarTallas = {},
  bd?: ContextoBd,
): Promise<Pagina<Talla>> {
  verificarPermiso(sesion, 'tallas.ver');
  const filtros = validarEntrada(esquemaListarTallas, parametros);

  const where: Prisma.TallaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { etiqueta: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  // Orden secundario por id: estabiliza el resultado cuando `orden` empata.
  const orderBy: Prisma.TallaOrderByWithRelationInput[] = [
    { [filtros.ordenarPor]: filtros.direccion },
    { id: 'asc' },
  ];

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.talla.count({ where }),
    cliente.talla.findMany({ where, orderBy, ...rangoPrisma(filtros) }),
  ]);

  return armarPagina(datos, total, filtros);
}

// ════════════════════════════════════════════════════════════════════════════════
//  CURVA — maestro-detalle ORDENADO (items por orden del arreglo)
// ════════════════════════════════════════════════════════════════════════════════

/** Alta de curva (nombre + items ordenados). */
export type EntradaCrearCurva = z.input<typeof esquemaCurvaCrear>;

/** Edición de curva: `id` + cambios parciales (incluye `activo` y, opcional, `items`). */
export type EntradaActualizarCurva = z.input<typeof esquemaCurvaEditar>;

/**
 * Parámetros del listado de curvas EN DOMINIO (tipos nativos), distinto del esquema de
 * la URL del contrato (`esquemaListarCurvas`). La ruta coacciona la querystring y pasa
 * el resultado nativo aquí.
 */
export const esquemaListarCurvas = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(150).optional(),
  /** Por omisión solo activas; `true` muestra también las desactivadas. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros que acepta `listarCurvas` (forma nativa, no la de la URL). */
export type ParametrosListarCurvas = z.input<typeof esquemaListarCurvas>;

/**
 * Curva con sus items ordenados por posición y la etiqueta de cada talla cargada (forma
 * que consume la ruta para la salida).
 */
export type CurvaConItems = CurvaTalla & {
  items: { idTalla: number; posicion: number; talla: Pick<Talla, 'etiqueta'> }[];
};

/** `include` estándar para traer los items de la curva ORDENADOS por posición. */
const incluirItemsOrdenados = {
  items: {
    select: { idTalla: true, posicion: true, talla: { select: { etiqueta: true } } },
    orderBy: { posicion: 'asc' },
  },
} satisfies Prisma.CurvaTallaInclude;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos curvas con el mismo
 * `nombre`, sin importar mayúsculas. Se valida en la transacción; la carrera residual la
 * captura el unique de la base (P2002).
 */
async function exigirNombreCurvaLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.curvaTalla.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe una curva llamada "${nombre}".`
        : `Ya existe una curva llamada "${nombre}" (está desactivada; puedes reactivarla).`,
    );
  }
}

/** Busca una curva por id o lanza `ErrorNoEncontrado`. */
async function exigirCurva(tx: Tx, id: number): Promise<CurvaTalla> {
  const curva = await tx.curvaTalla.findUnique({ where: { id } });
  if (curva === null) {
    throw new ErrorNoEncontrado('Curva', id);
  }
  return curva;
}

/**
 * Valida que todas las tallas de `idsTallas` existan y estén ACTIVAS (no se puede armar
 * una curva con tallas desactivadas). Lanza `ErrorValidacion` con mensaje claro si
 * alguna no existe o está inactiva. (El arreglo ya viene sin repetidos por el esquema Zod.)
 */
async function exigirTallasValidas(tx: Tx, idsTallas: number[]): Promise<void> {
  const tallas = await tx.talla.findMany({
    where: { id: { in: idsTallas } },
    select: { id: true, etiqueta: true, activo: true },
  });
  if (tallas.length !== idsTallas.length) {
    throw new ErrorValidacion('Una o más tallas seleccionadas no existen.');
  }
  const inactiva = tallas.find((talla) => !talla.activo);
  if (inactiva !== undefined) {
    throw new ErrorValidacion(
      `La talla "${inactiva.etiqueta}" está desactivada y no se puede incluir en una curva.`,
    );
  }
}

/**
 * Reescribe el conjunto ORDENADO de items de la curva DENTRO de la transacción (A2): la
 * `posicion` de cada talla se asigna por el ORDEN del arreglo `items` (0-based). Por
 * simplicidad y robustez (reordenar + altas/bajas a la vez) se borra el set anterior y se
 * recrea completo; la curva es un detalle pequeño (decenas de tallas como mucho). Exige
 * tallas válidas y activas. NO escribe bitácora aquí (lo hace el llamador).
 */
async function reescribirItemsCurva(
  tx: Tx,
  sesion: SesionUsuario,
  idCurva: number,
  itemsOrdenados: number[],
): Promise<void> {
  await exigirTallasValidas(tx, itemsOrdenados);
  await tx.curvaTallaItem.deleteMany({ where: { idCurva } });
  await tx.curvaTallaItem.createMany({
    data: itemsOrdenados.map((idTalla, posicion) => ({
      idCurva,
      idTalla,
      posicion,
      creadoPorId: sesion.id,
    })),
  });
}

/** Lee los ids de talla de una curva en su ORDEN de posición (para comparar en la edición). */
async function itemsActualesDeCurva(tx: Tx, idCurva: number): Promise<number[]> {
  const items = await tx.curvaTallaItem.findMany({
    where: { idCurva },
    orderBy: { posicion: 'asc' },
    select: { idTalla: true },
  });
  return items.map((item) => item.idTalla);
}

/**
 * Crea una curva con su conjunto ORDENADO de tallas en UNA transacción (A2). Reglas:
 * permiso `tallas.administrar`; `nombre` único global → `ErrorConflicto`; ≥1 talla
 * (esquema Zod); las tallas deben existir y estar ACTIVAS; nace activa; auditoría y
 * bitácora en la misma transacción (A7).
 *
 * La `posicion` de cada talla se asigna por el ORDEN del arreglo `items`.
 *
 * @example
 * const c = await crearCurva(sesion, { nombre: "Dama básica", items: [tCH, tM, tG] });
 */
export async function crearCurva(
  sesion: SesionUsuario,
  entrada: EntradaCrearCurva,
  bd?: ContextoBd,
): Promise<CurvaConItems> {
  verificarPermiso(sesion, 'tallas.administrar');
  const datos = validarEntrada(esquemaCurvaCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreCurvaLibre(tx, datos.nombre);

      const curva = await tx.curvaTalla.create({
        data: { nombre: datos.nombre, ...datosCreacion(sesion) },
      });

      await reescribirItemsCurva(tx, sesion, curva.id, datos.items);

      await registrarBitacora(tx, sesion, {
        entidad: 'Curva',
        idEntidad: curva.id,
        accion: 'CREAR',
        datos: { nombre: curva.nombre, items: datos.items },
      });

      return tx.curvaTalla.findUniqueOrThrow({
        where: { id: curva.id },
        include: incluirItemsOrdenados,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una curva llamada "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza una curva: `nombre`, sus `items` (conjunto ORDENADO) y/o `activo` para
 * desactivar (borrado suave) o reactivar. Todo en UNA transacción (A2).
 *
 * Items: si `items` NO viene, no se tocan; si viene, REEMPLAZA el conjunto completo
 * (≥1, tallas activas) reasignando posiciones por el orden del arreglo. Bitácora según
 * lo que pasó: `MODIFICAR` con el detalle, y/o `DESACTIVAR` si el cambio la apagó.
 */
export async function actualizarCurva(
  sesion: SesionUsuario,
  entrada: EntradaActualizarCurva,
  bd?: ContextoBd,
): Promise<CurvaConItems> {
  verificarPermiso(sesion, 'tallas.administrar');
  const datos = validarEntrada(esquemaCurvaEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirCurva(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (cambiaNombre) {
        await exigirNombreCurvaLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreCurvaLibre(tx, actual.nombre, datos.id);
      }

      // Items: solo se tocan si vienen en el payload (omitir = no tocar). Se considera
      // cambio solo si el conjunto ORDENADO difiere del actual (idempotencia).
      let cambiaItems = false;
      if (datos.items !== undefined) {
        const previos = await itemsActualesDeCurva(tx, datos.id);
        const iguales =
          previos.length === datos.items.length &&
          previos.every((idTalla, indice) => idTalla === datos.items?.[indice]);
        if (!iguales) {
          await reescribirItemsCurva(tx, sesion, datos.id, datos.items);
          cambiaItems = true;
        }
      }

      // Reactivar una curva exige que sus tallas sigan ACTIVAS (no resucitar una receta
      // con tallas apagadas). Si además se reescriben items, ya se validó arriba.
      if (reactiva && !cambiaItems) {
        const previos = await itemsActualesDeCurva(tx, datos.id);
        if (previos.length > 0) {
          await exigirTallasValidas(tx, previos);
        }
      }

      const huboCambioEscalar = cambiaNombre || reactiva || desactiva;

      if (!huboCambioEscalar && !cambiaItems) {
        return tx.curvaTalla.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirItemsOrdenados,
        });
      }

      const cambios: Prisma.CurvaTallaUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }
      // Siempre se actualiza al menos `modificadoPorId` (deja constancia aunque solo
      // hayan cambiado los items).
      await tx.curvaTalla.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || cambiaItems || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Curva',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: datos.nombre } } : {}),
            ...(cambiaItems ? { items: datos.items } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Curva',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { nombre: actual.nombre },
        });
      }

      return tx.curvaTalla.findUniqueOrThrow({
        where: { id: datos.id },
        include: incluirItemsOrdenados,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una curva con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) una curva. Desactivar dos veces es `ErrorConflicto`
 * (pantalla desactualizada). Al desactivarse, sus tallas quedan liberadas (ya no
 * bloquean su desactivación). Atajo explícito del botón "Desactivar".
 */
export async function desactivarCurva(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<CurvaConItems> {
  verificarPermiso(sesion, 'tallas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirCurva(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`La curva "${actual.nombre}" ya está desactivada.`);
    }
    return actualizarCurva(sesion, { id, activo: false }, { tx });
  }, bd);
}

/**
 * Reactiva una curva desactivada (operación inversa del borrado suave). Exige que las
 * tallas de la curva sigan ACTIVAS (no resucitar una receta con tallas apagadas).
 */
export async function reactivarCurva(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<CurvaConItems> {
  verificarPermiso(sesion, 'tallas.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirCurva(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`La curva "${actual.nombre}" ya está activa.`);
    }
    return actualizarCurva(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene una curva por id (con sus items ordenados) o lanza `ErrorNoEncontrado`. */
export async function obtenerCurva(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<CurvaConItems> {
  verificarPermiso(sesion, 'tallas.ver');
  const curva = await clienteLectura(bd).curvaTalla.findUnique({
    where: { id },
    include: incluirItemsOrdenados,
  });
  if (curva === null) {
    throw new ErrorNoEncontrado('Curva', id);
  }
  return curva;
}

/**
 * Lista curvas con búsqueda, orden y paginación EN SERVIDOR, cada una con sus items
 * ordenados. Por defecto: solo activas.
 */
export async function listarCurvas(
  sesion: SesionUsuario,
  parametros: ParametrosListarCurvas = {},
  bd?: ContextoBd,
): Promise<Pagina<CurvaConItems>> {
  verificarPermiso(sesion, 'tallas.ver');
  const filtros = validarEntrada(esquemaListarCurvas, parametros);

  const where: Prisma.CurvaTallaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.curvaTalla.count({ where }),
    cliente.curvaTalla.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirItemsOrdenados,
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}
