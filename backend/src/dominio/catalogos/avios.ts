/**
 * Avíos — catálogo maestro GLOBAL (F1-E3, PIEZA B — R1).
 *
 * Equivale a `Habilitacion` del sistema viejo (doc `Documentacion_MJD/01-Modelos.md` §2,
 * con Favorito/CantFav). Cada avío puede surtirse por VARIOS proveedores a precios
 * distintos (insight del dueño, R1): la relación es N:N a `Proveedor` vía `AvioProveedor`,
 * y —a diferencia del N:N puro del maquilero (Maquilero↔TipoProceso)— cada renglón del
 * puente lleva DATOS propios (`precio`, `condiciones`). Es insumo de R3/R7 (MRP) en F4 y
 * del costeo en F7.
 *
 * Replica el patrón N:N en transacción (A2) de `dominio/catalogos/maquileros.ts` y
 * `proveedores.ts`, con estas particularidades de diseño:
 *  • El avío y su set de `proveedores` se crean/editan en UNA transacción (A2),
 *    sincronizando el puente con un diff que además ACTUALIZA los renglones cuyo precio o
 *    condiciones cambiaron (no solo agrega/quita, como el maquilero).
 *  • A diferencia del maquilero (≥1 tipo), un avío PUEDE no tener proveedores (≥0): puede
 *    ser genérico (R4) o costearse por su `precioReferencia` de fallback (ADR-0009).
 *  • `unidad`/`presentacion` son NULLABLE en BD (ADR-0009): el dominio NO truena si vienen
 *    `null`/ausentes, para que el ETL de E6 cargue los 629 avíos históricos sin esos
 *    datos. La obligatoriedad en altas NUEVAS la pone el Zod del FORMULARIO del frontend,
 *    no este dominio.
 *  • Regla de negocio (A1): favorito ⇒ `cantFav` obligatoria (> 0). Se valida en el
 *    esquema compartido y se REVALIDA aquí contra el estado resultante (en edición parcial
 *    el payload puede traer solo `favorito` o solo `cantFav`).
 *
 * Piezas del patrón conservadas (PLANMAESTRO §9.2): permiso primero (`avios.ver`/
 * `.administrar`); Zod compartido de `src/contrato`; todo cambio en UNA transacción (A2)
 * con auditoría (A7) + `Bitacora` juntos o nada; borrado SUAVE reversible (`activo`);
 * unicidad de `clave` validada en la transacción y respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
// NOTA (integración): estos esquemas aún NO están re-exportados desde `contrato/index.ts`
// (barrel que cablea la integración); se importan directo del archivo para no tocar el
// barril. Cuando integración los agregue al index, este import puede migrar allá.
import { esquemaAvioCrear, esquemaAvioEditar } from '../../contrato/esquemas/avio.js';
import type { Avio, AvioProveedor, Prisma } from '../../datos/index.js';
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
export type EntradaCrearAvio = z.input<typeof esquemaAvioCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarAvio = z.input<typeof esquemaAvioEditar>;

/** Un proveedor del avío tal como viene en el payload (con su precio/condiciones). */
type ProveedorEntrada = z.output<typeof esquemaAvioCrear>['proveedores'] extends
  | readonly (infer T)[]
  | undefined
  ? T
  : never;

/**
 * Avío con sus proveedores cargados (forma que consume la ruta para la salida).
 * Trae el nombre del proveedor embebido para que la ruta no cruce con el catálogo.
 */
export type AvioConProveedores = Avio & {
  proveedores: (Pick<AvioProveedor, 'idProveedor' | 'precio' | 'condiciones' | 'habitual'> & {
    proveedor: { nombre: string };
  })[];
};

/** `include` estándar para traer los proveedores junto al avío (con su nombre). */
const incluirProveedores = {
  proveedores: {
    select: {
      idProveedor: true,
      precio: true,
      condiciones: true,
      // ⭐ §Post-F9.82: quién es el HABITUAL viaja en el listado — es lo que la explosión va a
      // proponer, así que el catálogo tiene que poder enseñarlo sin un viaje extra.
      habitual: true,
      proveedor: { select: { nombre: true } },
    },
    orderBy: { proveedor: { nombre: 'asc' } },
  },
} satisfies Prisma.AvioInclude;

/**
 * Parámetros del listado a nivel DOMINIO. A diferencia del esquema de querystring del
 * contrato (`esquemaListarAvios`, que coacciona texto→número/boolean porque viene de la
 * URL), aquí los tipos ya son nativos. La ruta REST le pasa `request.query` ya coaccionado
 * (output del contrato), y los tests pasan valores nativos. Mismo patrón que el maquilero.
 */
const esquemaListarAviosDominio = esquemaPaginacion.extend({
  /** Texto a buscar en la clave o la descripción (insensible a mayúsculas). */
  busqueda: z.string().trim().max(200).optional(),
  /** Filtra por avíos genéricos (R4). Omitir = todos. */
  esGenerico: z.boolean().optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['clave', 'descripcion', 'creadoEn']).default('clave'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export type ParametrosListarAvios = z.input<typeof esquemaListarAviosDominio>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos avíos con la misma `clave`,
 * sin importar mayúsculas ("BTN-01" ≡ "btn-01"). Se valida DENTRO de la transacción; la
 * carrera residual la captura el unique de la base (P2002 → `ErrorConflicto`). El mensaje
 * distingue si el existente está activo o desactivado (invita a reactivar).
 */
async function exigirClaveLibre(tx: Tx, clave: string, idActual?: number): Promise<void> {
  const existente = await tx.avio.findFirst({
    where: {
      clave: { equals: clave, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un avío con la clave "${clave}".`
        : `Ya existe un avío con la clave "${clave}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un avío por id o lanza `ErrorNoEncontrado`. */
async function exigirAvio(tx: Tx, id: number): Promise<Avio> {
  const avio = await tx.avio.findUnique({ where: { id } });
  if (avio === null) {
    throw new ErrorNoEncontrado('Avio', id);
  }
  return avio;
}

/**
 * Coherencia favorito ⇒ cantFav (A1) sobre el ESTADO RESULTANTE. El esquema ya cubre el
 * payload, pero en edición parcial puede llegar solo `favorito` (sin `cantFav`) o solo
 * `cantFav`; aquí se valida lo que QUEDARÁ tras aplicar el cambio. `cantFavResultante` ya
 * viene resuelta por el llamador (el valor nuevo, o el actual si se omitió).
 */
function validarFavorito(favoritoResultante: boolean, cantFavResultante: number | null): void {
  if (favoritoResultante && (cantFavResultante === null || cantFavResultante <= 0)) {
    throw new ErrorValidacion(
      'Si el avío es favorito, captura la cantidad preestablecida (mayor a 0).',
    );
  }
}

/**
 * Valida que todos los `idsProveedores` existan y estén ACTIVOS (no se puede asignar un
 * proveedor desactivado). Lanza `ErrorValidacion` si alguno no existe o está inactivo
 * (mensaje claro para la UI). Mismo criterio que `exigirRolesValidos`/`exigirTiposValidos`.
 */
async function exigirProveedoresValidos(tx: Tx, idsProveedores: number[]): Promise<void> {
  const unicos = [...new Set(idsProveedores)];
  if (unicos.length === 0) {
    return;
  }
  const proveedores = await tx.proveedor.findMany({
    where: { id: { in: unicos } },
    select: { id: true, nombre: true, activo: true },
  });
  if (proveedores.length !== unicos.length) {
    throw new ErrorValidacion('Uno o más proveedores seleccionados no existen.');
  }
  const inactivo = proveedores.find((proveedor) => !proveedor.activo);
  if (inactivo !== undefined) {
    throw new ErrorValidacion(
      `El proveedor "${inactivo.nombre}" está desactivado y no se puede asignar.`,
    );
  }
}

/** ¿Cambió el precio del renglón? Compara por valor numérico (Prisma devuelve Decimal). */
function precioCambia(actual: AvioProveedor['precio'], nuevo: number | undefined): boolean {
  const anterior = actual === null ? null : Number(actual);
  const propuesto = nuevo ?? null;
  return anterior !== propuesto;
}

/** ¿Cambió la bandera de HABITUAL del renglón? (omitido = false: la lista siempre viaja completa). */
function habitualCambia(actual: boolean, nuevo: boolean | undefined): boolean {
  return actual !== (nuevo ?? false);
}

/** ¿Cambiaron las condiciones del renglón? (normaliza '' y omitido a null). */
function condicionesCambian(actual: string | null, nuevo: string | undefined): boolean {
  const propuesto = nuevo === undefined || nuevo === '' ? null : nuevo;
  return actual !== propuesto;
}

/**
 * Reemplaza el conjunto de proveedores de un avío DENTRO de la transacción (A2): a
 * diferencia del N:N puro del maquilero, cada renglón lleva datos propios, así que el diff
 * tiene TRES caras:
 *   - AGREGAR los proveedores nuevos (con su precio/condiciones).
 *   - QUITAR los que ya no vienen (borrado físico del renglón puente — el avío es el dueño,
 *     Cascade; un proveedor que deja de surtir el avío sale de la lista).
 *   - ACTUALIZAR los que siguen pero cambió su precio o condiciones.
 * Exige que todos los proveedores existan y estén activos. Devuelve true si hubo algún
 * cambio (para la bitácora). Un avío PUEDE quedar sin proveedores (≥0).
 */
async function sincronizarProveedores(
  tx: Tx,
  sesion: SesionUsuario,
  idAvio: number,
  deseados: readonly ProveedorEntrada[],
): Promise<boolean> {
  // Sin repetidos (el esquema ya lo valida; defensa en profundidad).
  const porId = new Map<number, ProveedorEntrada>();
  for (const item of deseados) {
    porId.set(item.idProveedor, item);
  }
  await exigirProveedoresValidos(tx, [...porId.keys()]);

  // ⭐ §Post-F9.82 — EL HABITUAL ES UNO. El contrato ya lo valida, pero el dominio es la autoridad
  // (A1) y esta función también la llama el ETL/las pruebas: dos habituales dejarían "a quién le
  // compramos siempre" a merced del orden de las filas.
  const habituales = [...porId.values()].filter((item) => item.habitual === true);
  if (habituales.length > 1) {
    throw new ErrorValidacion('Solo un proveedor puede ser el habitual del avío.');
  }
  const idHabitual = habituales[0]?.idProveedor ?? null;

  const actuales = await tx.avioProveedor.findMany({ where: { idAvio } });
  const actualPorId = new Map(actuales.map((fila) => [fila.idProveedor, fila]));

  const idsActuales = new Set(actualPorId.keys());
  const idsDeseados = new Set(porId.keys());

  const aQuitar = [...idsActuales].filter((id) => !idsDeseados.has(id));
  const aAgregar = [...idsDeseados].filter((id) => !idsActuales.has(id));
  const aRevisar = [...idsDeseados].filter((id) => idsActuales.has(id));

  let huboCambio = false;

  if (aQuitar.length > 0) {
    await tx.avioProveedor.deleteMany({
      where: { idAvio, idProveedor: { in: aQuitar } },
    });
    huboCambio = true;
  }

  // ⚠️ ORDEN OBLIGATORIO: primero se APAGA el habitual anterior y solo después se enciende el
  // nuevo. El índice único parcial de la base (`avio_proveedor_habitual_unico`) se verifica por
  // sentencia, así que encender antes de apagar reventaría al mover el habitual de A a B — un
  // error de escritura donde el usuario solo cambió de proveedor.
  await tx.avioProveedor.updateMany({
    where: {
      idAvio,
      habitual: true,
      ...(idHabitual === null ? {} : { idProveedor: { not: idHabitual } }),
    },
    data: { habitual: false, ...datosModificacion(sesion) },
  });

  for (const id of aAgregar) {
    const item = porId.get(id);
    if (item === undefined) {
      continue;
    }
    await tx.avioProveedor.create({
      data: {
        idAvio,
        idProveedor: id,
        habitual: item.habitual === true,
        ...(item.precio === undefined ? {} : { precio: item.precio }),
        ...(item.condiciones === undefined || item.condiciones === ''
          ? {}
          : { condiciones: item.condiciones }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });
    huboCambio = true;
  }

  for (const id of aRevisar) {
    const item = porId.get(id);
    const actual = actualPorId.get(id);
    if (item === undefined || actual === undefined) {
      continue;
    }
    const cambiaPrecio = precioCambia(actual.precio, item.precio);
    const cambiaCondiciones = condicionesCambian(actual.condiciones, item.condiciones);
    const cambiaHabitual = habitualCambia(actual.habitual, item.habitual);
    if (!cambiaPrecio && !cambiaCondiciones && !cambiaHabitual) {
      continue;
    }
    await tx.avioProveedor.update({
      where: { idAvio_idProveedor: { idAvio, idProveedor: id } },
      data: {
        ...(cambiaHabitual ? { habitual: item.habitual === true } : {}),
        ...(cambiaPrecio ? { precio: item.precio ?? null } : {}),
        ...(cambiaCondiciones
          ? {
              condiciones:
                item.condiciones === undefined || item.condiciones === '' ? null : item.condiciones,
            }
          : {}),
        ...datosModificacion(sesion),
      },
    });
    huboCambio = true;
  }

  return huboCambio;
}

/** Construye el `data` de los campos opcionales presentes en el alta (solo los definidos). */
function datosOpcionalesCrear(
  datos: z.output<typeof esquemaAvioCrear>,
): Partial<Prisma.AvioCreateInput> {
  const data: Partial<Prisma.AvioCreateInput> = {};
  if (datos.unidad !== undefined) data.unidad = datos.unidad;
  if (datos.presentacion !== undefined) data.presentacion = datos.presentacion;
  if (datos.favorito !== undefined) data.favorito = datos.favorito;
  if (datos.cantFav !== undefined) data.cantFav = datos.cantFav;
  if (datos.esGenerico !== undefined) data.esGenerico = datos.esGenerico;
  if (datos.precioReferencia !== undefined) data.precioReferencia = datos.precioReferencia;
  return data;
}

/** Campos de TEXTO opcionales editables (clave del payload === clave del modelo). */
const CAMPOS_TEXTO_EDITABLES = ['unidad', 'presentacion'] as const;

/**
 * Aplica los campos que VENGAN en la edición al `update` y registra qué cambió (para la
 * bitácora). Semántica del PATCH parcial (M1): campo OMITIDO (`undefined`) → no se toca;
 * texto/decimal en `null` (o texto vacío) → se BORRA (a `null`); con valor → se guarda si
 * difiere del actual. `favorito`/`esGenerico` (banderas): omitir = no tocar. Devuelve el
 * detalle de cambios para la bitácora.
 */
function aplicarEditar(
  datos: z.output<typeof esquemaAvioEditar>,
  actual: Avio,
  cambios: Prisma.AvioUpdateInput,
): Record<string, unknown> {
  const detalle: Record<string, unknown> = {};

  // Textos opcionales (unidad/presentacion): omitir = no tocar; vacío/`null` = borrar.
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

  // Banderas: omitir = no tocar (no son nullables; el formulario manda boolean).
  if (datos.favorito !== undefined && datos.favorito !== actual.favorito) {
    cambios.favorito = datos.favorito;
    detalle.favorito = { de: actual.favorito, a: datos.favorito };
  }
  if (datos.esGenerico !== undefined && datos.esGenerico !== actual.esGenerico) {
    cambios.esGenerico = datos.esGenerico;
    detalle.esGenerico = { de: actual.esGenerico, a: datos.esGenerico };
  }

  // Decimales (cantFav/precioReferencia): comparar por valor numérico. Omitir = no tocar;
  // `null` = borrar.
  if (datos.cantFav !== undefined) {
    const anterior = actual.cantFav === null ? null : Number(actual.cantFav);
    const nuevo = datos.cantFav === null ? null : datos.cantFav;
    if (nuevo !== anterior) {
      cambios.cantFav = nuevo;
      detalle.cantFav = { de: anterior, a: nuevo };
    }
  }
  if (datos.precioReferencia !== undefined) {
    const anterior = actual.precioReferencia === null ? null : Number(actual.precioReferencia);
    const nuevo = datos.precioReferencia === null ? null : datos.precioReferencia;
    if (nuevo !== anterior) {
      cambios.precioReferencia = nuevo;
      detalle.precioReferencia = { de: anterior, a: nuevo };
    }
  }

  return detalle;
}

/**
 * Crea un avío (catálogo global) con sus proveedores en UNA transacción (A2). Reglas:
 * permiso `avios.administrar`; `clave` única global → `ErrorConflicto`; favorito ⇒
 * `cantFav` (>0); proveedores (≥0) válidos y activos, con su precio/condiciones; nace
 * activo; auditoría y bitácora en la misma transacción (A7). `unidad`/`presentacion` NO
 * son obligatorias aquí (ADR-0009: el form las exige en altas nuevas; el ETL de E6 carga
 * sin ellas).
 *
 * @example
 * const a = await crearAvio(sesion, {
 *   clave: "BTN-01", descripcion: "Botón 2 cm", unidad: "pza", presentacion: "caja",
 *   favorito: true, cantFav: 12, proveedores: [{ idProveedor: 1, precio: 0.5 }],
 * });
 */
export async function crearAvio(
  sesion: SesionUsuario,
  entrada: EntradaCrearAvio,
  bd?: ContextoBd,
): Promise<AvioConProveedores> {
  verificarPermiso(sesion, 'avios.administrar');
  const datos = validarEntrada(esquemaAvioCrear, entrada);
  validarFavorito(datos.favorito, datos.cantFav ?? null);

  try {
    return await enTransaccion(async (tx) => {
      await exigirClaveLibre(tx, datos.clave);

      const avio = await tx.avio.create({
        data: {
          clave: datos.clave,
          descripcion: datos.descripcion,
          ...datosOpcionalesCrear(datos),
          ...datosCreacion(sesion),
        },
      });

      await sincronizarProveedores(tx, sesion, avio.id, datos.proveedores ?? []);

      await registrarBitacora(tx, sesion, {
        entidad: 'Avio',
        idEntidad: avio.id,
        accion: 'CREAR',
        datos: {
          clave: avio.clave,
          descripcion: avio.descripcion,
          proveedores: (datos.proveedores ?? []).map((p) => p.idProveedor),
        },
      });

      return tx.avio.findUniqueOrThrow({
        where: { id: avio.id },
        include: incluirProveedores,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un avío con la clave "${datos.clave}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un avío: datos generales, proveedores (con su precio/condiciones) y/o `activo`
 * para desactivar (borrado suave) o reactivar — la forma exacta del esquema compartido
 * `esquemaAvioEditar`. Todo en UNA transacción (A2).
 *
 * Proveedores: si `proveedores` NO viene, no se tocan; si viene (cualquier arreglo, incluso
 * []), REEMPLAZA el set (agrega/quita/actualiza renglones; puede quedar en 0). favorito ⇒
 * cantFav se revalida sobre el estado resultante. Bitácora según lo que pasó: `MODIFICAR`
 * con el detalle, y/o `DESACTIVAR` si el cambio apagó el avío.
 */
export async function actualizarAvio(
  sesion: SesionUsuario,
  entrada: EntradaActualizarAvio,
  bd?: ContextoBd,
): Promise<AvioConProveedores> {
  verificarPermiso(sesion, 'avios.administrar');
  const datos = validarEntrada(esquemaAvioEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirAvio(tx, datos.id);

      const cambiaClave = datos.clave !== undefined && datos.clave !== actual.clave;
      const cambiaDescripcion =
        datos.descripcion !== undefined && datos.descripcion !== actual.descripcion;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      // Coherencia favorito ⇒ cantFav sobre el estado RESULTANTE (edición parcial).
      const favoritoResultante = datos.favorito ?? actual.favorito;
      const cantFavResultante =
        datos.cantFav === undefined
          ? actual.cantFav === null
            ? null
            : Number(actual.cantFav)
          : datos.cantFav;
      validarFavorito(favoritoResultante, cantFavResultante);

      const cambios: Prisma.AvioUpdateInput = { ...datosModificacion(sesion) };
      const detalleCampos = aplicarEditar(datos, actual, cambios);
      if (cambiaClave && datos.clave !== undefined) {
        cambios.clave = datos.clave;
      }
      if (cambiaDescripcion && datos.descripcion !== undefined) {
        cambios.descripcion = datos.descripcion;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      // Al cambiar la clave o al reactivar puede chocar con una clave vigente.
      if (cambiaClave) {
        await exigirClaveLibre(tx, datos.clave ?? actual.clave, datos.id);
      } else if (reactiva) {
        await exigirClaveLibre(tx, actual.clave, datos.id);
      }

      // Proveedores: solo se tocan si vienen en el payload (omitir = no tocar). El set
      // resultante PUEDE quedar en 0 (≥0).
      const cambiaProveedores =
        datos.proveedores !== undefined
          ? await sincronizarProveedores(tx, sesion, datos.id, datos.proveedores)
          : false;

      const huboCambioEscalar =
        cambiaClave ||
        cambiaDescripcion ||
        Object.keys(detalleCampos).length > 0 ||
        reactiva ||
        desactiva;

      if (!huboCambioEscalar && !cambiaProveedores) {
        return tx.avio.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirProveedores,
        });
      }

      if (huboCambioEscalar) {
        await tx.avio.update({ where: { id: datos.id }, data: cambios });
      } else if (cambiaProveedores) {
        // Solo cambiaron proveedores: deja constancia de la modificación (modificadoPorId/En).
        await tx.avio.update({
          where: { id: datos.id },
          data: { ...datosModificacion(sesion) },
        });
      }

      if (
        cambiaClave ||
        cambiaDescripcion ||
        Object.keys(detalleCampos).length > 0 ||
        reactiva ||
        cambiaProveedores
      ) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Avio',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaClave ? { clave: { de: actual.clave, a: datos.clave } } : {}),
            ...(cambiaDescripcion
              ? { descripcion: { de: actual.descripcion, a: datos.descripcion } }
              : {}),
            ...detalleCampos,
            ...(cambiaProveedores
              ? { proveedores: datos.proveedores?.map((p) => p.idProveedor) }
              : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Avio',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { clave: actual.clave, descripcion: actual.descripcion },
        });
      }

      return tx.avio.findUniqueOrThrow({
        where: { id: datos.id },
        include: incluirProveedores,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un avío con esa clave.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un avío: deja de aparecer en capturas pero su historial queda
 * intacto. Desactivar dos veces es `ErrorConflicto` (la pantalla estaba desactualizada).
 * Atajo explícito del botón "Desactivar".
 */
export async function desactivarAvio(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AvioConProveedores> {
  verificarPermiso(sesion, 'avios.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirAvio(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El avío "${actual.clave}" ya está desactivado.`);
    }
    return actualizarAvio(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un avío desactivado (operación inversa del borrado suave). */
export async function reactivarAvio(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AvioConProveedores> {
  verificarPermiso(sesion, 'avios.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirAvio(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El avío "${actual.clave}" ya está activo.`);
    }
    return actualizarAvio(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un avío por id (con sus proveedores activos) o lanza `ErrorNoEncontrado`. */
export async function obtenerAvio(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<AvioConProveedores> {
  verificarPermiso(sesion, 'avios.ver');
  const avio = await clienteLectura(bd).avio.findUnique({
    where: { id },
    include: incluirProveedores,
  });
  if (avio === null) {
    throw new ErrorNoEncontrado('Avio', id);
  }
  return avio;
}

/**
 * Lista avíos con búsqueda, orden y paginación EN SERVIDOR (la tabla de la UI nunca trae
 * todo para filtrar en memoria). Por defecto: solo activos. Permite filtrar por
 * `esGenerico` (R4). La búsqueda cubre `clave` O `descripcion`. Cada avío trae sus
 * proveedores activos (para mostrar precios sin un viaje extra).
 *
 * @example
 * const pagina = await listarAvios(sesion, { esGenerico: true, busqueda: "boton" });
 */
export async function listarAvios(
  sesion: SesionUsuario,
  parametros: ParametrosListarAvios = {},
  bd?: ContextoBd,
): Promise<Pagina<AvioConProveedores>> {
  verificarPermiso(sesion, 'avios.ver');
  const filtros = validarEntrada(esquemaListarAviosDominio, parametros);

  const where: Prisma.AvioWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.esGenerico === undefined ? {} : { esGenerico: filtros.esGenerico }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { clave: { contains: filtros.busqueda, mode: 'insensitive' } },
            { descripcion: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.avio.count({ where }),
    cliente.avio.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirProveedores,
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}

/**
 * Proveedor de un avío con su precio de compra. ⭐ Ese precio está POR UNIDAD DE CONSUMO — metro,
 * pieza, kilo—, que es la única unidad del sistema (§Post-F9.97) y con la que costean el precosto y
 * el BOM. Hasta V1-E8a viajaba junto un `precioUnidadConsumo` = `precio` ÷ factor de conversión;
 * se retiró con el factor, porque ya no hay dos unidades que traducir.
 */
export type ProveedorDeAvio = AvioConProveedores['proveedores'][number];

/**
 * Lista los proveedores de un avío con su precio/condiciones. El precio por proveedor vive aquí.
 * Requiere `avios.ver`. Exige que el avío exista.
 */
export async function listarProveedoresDeAvio(
  sesion: SesionUsuario,
  idAvio: number,
  bd?: ContextoBd,
): Promise<ProveedorDeAvio[]> {
  verificarPermiso(sesion, 'avios.ver');
  const cliente = clienteLectura(bd);
  const avio = await cliente.avio.findUnique({ where: { id: idAvio }, select: { id: true } });
  if (avio === null) {
    throw new ErrorNoEncontrado('Avio', idAvio);
  }
  return cliente.avioProveedor.findMany({
    where: { idAvio },
    select: {
      idProveedor: true,
      precio: true,
      condiciones: true,
      habitual: true,
      proveedor: { select: { nombre: true } },
    },
    orderBy: { proveedor: { nombre: 'asc' } },
  });
}
