/**
 * Bordados / estampados — catálogo maestro GLOBAL (F1-E3, R2 — ADR-0009).
 *
 * Replica el CRUD patrón de Almacenes/Cortadores (`dominio/admin/almacenes.ts`,
 * `dominio/catalogos/cortadores.ts`) SIN lógica de empresa: catálogo global, sin
 * `idEmpresa` (ADR-0007, decisión A9). Unicidad de `nombre` global (`@unique`).
 *
 * Doc funcional: `Documentacion_MJD/01-Modelos.md` §2 (tabla del viejo con `BorEst` y
 * `Foto`). Diferencia de diseño frente a los catálogos planos de E1: el bordado tiene
 * una FOTO en R2. A diferencia de los adjuntos del proveedor (N PDFs vía tabla puente),
 * el bordado tiene UNA sola foto = **FK directa** `idArchivoFoto` al `Archivo` de F0
 * (1 bordado → 0..1 foto, `onDelete SetNull`). La foto se gestiona con el motor de
 * archivos de F0 (presigned PUT/GET):
 *  • `solicitarSubidaFoto` crea el registro `Archivo` (key ORDENADA por id —
 *    `bordados/<id>/...`, NUNCA por el nombre del bordado, A5), liga `idArchivoFoto`
 *    y devuelve la URL PUT prefirmada para que el navegador suba DIRECTO a R2 (todo en
 *    UNA transacción, A2; si ya había foto, la reemplaza borrando la anterior).
 *  • `urlFoto` devuelve la URL GET prefirmada para verla (o `null` si no hay foto).
 *  • `quitarFoto` pone `idArchivoFoto=null` y borra el `Archivo` en UNA transacción (A2);
 *    admite acotar el borrado a UNA foto concreta (`idArchivoEsperado`) para que la limpieza
 *    de una subida fallida nunca se lleve la foto que otro usuario subió mientras tanto.
 * El servicio de archivos se INYECTA (default `servicioArchivos()` lazy) para poder
 * pasar un fake en tests sin R2 real (igual que `ProveedorArchivo` en F1-E1B).
 *
 * Piezas del patrón conservadas: permiso primero (`bordados.ver`/`.administrar`,
 * PLANMAESTRO §9.2); Zod compartido; transacción única (A2) con auditoría (A7) +
 * `Bitacora`; borrado SUAVE reversible; unicidad respaldada por el unique de la base
 * (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en servidor.
 */
import {
  esquemaBordadoCrear,
  esquemaBordadoEditar,
  esquemaBordadoFotoCrear,
  type DatosBordadoFotoCrear,
} from '../../contrato/esquemas/bordado.js';
import type { Bordado, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
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

/** Carpeta R2 de las fotos de bordados (la key real se ordena por id, no por nombre, A5). */
const CARPETA_FOTOS = 'bordados';

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearBordado = z.input<typeof esquemaBordadoCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarBordado = z.input<typeof esquemaBordadoEditar>;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarBordados = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(150).optional(),
  /** Filtrar por tipo (BORDADO/ESTAMPADO). */
  tipo: z.enum(['BORDADO', 'ESTAMPADO']).optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'tipo', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarBordados = z.input<typeof esquemaListarBordados>;

/**
 * Compara el `precio` capturado (number | null | undefined) con el guardado
 * (Decimal | null). Devuelve `true` si el valor cambia. `undefined` = "no se tocó"
 * (no cambia); `null` = borrar (cambia si había valor).
 */
function cambiaPrecio(entrada: number | null | undefined, actual: Prisma.Decimal | null): boolean {
  if (entrada === undefined) {
    return false;
  }
  if (entrada === null) {
    return actual !== null;
  }
  if (actual === null) {
    return true;
  }
  return actual.toNumber() !== entrada;
}

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos bordados con el mismo
 * nombre, sin importar mayúsculas. Se valida en la transacción; la carrera residual
 * la captura el unique de la base (P2002 → `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.bordado.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un arte llamado "${nombre}".`
        : `Ya existe un arte llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un bordado por id o lanza `ErrorNoEncontrado`. */
async function exigirBordado(tx: Tx, id: number): Promise<Bordado> {
  const bordado = await tx.bordado.findUnique({ where: { id } });
  if (bordado === null) {
    throw new ErrorNoEncontrado('Arte', id);
  }
  return bordado;
}

/**
 * Crea un bordado (catálogo global). Reglas: permiso `bordados.administrar`; nombre
 * único global → `ErrorConflicto`; tipo BORDADO/ESTAMPADO (default BORDADO); nace
 * activo y SIN foto (se sube aparte); auditoría y bitácora en la misma transacción
 * (A2/A7).
 *
 * @example
 * const b = await crearBordado(sesion, { nombre: "Logo Marilyn", tipo: "ESTAMPADO", puntadas: 12000 });
 */
export async function crearBordado(
  sesion: SesionUsuario,
  entrada: EntradaCrearBordado,
  bd?: ContextoBd,
): Promise<Bordado> {
  verificarPermiso(sesion, 'bordados.administrar');
  const datos = validarEntrada(esquemaBordadoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);

      const bordado = await tx.bordado.create({
        data: {
          nombre: datos.nombre,
          tipo: datos.tipo,
          ...(datos.descripcion === undefined ? {} : { descripcion: datos.descripcion }),
          ...(datos.puntadas === undefined ? {} : { puntadas: datos.puntadas }),
          ...(datos.precio === undefined ? {} : { precio: datos.precio }),
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Bordado',
        idEntidad: bordado.id,
        accion: 'CREAR',
        datos: { nombre: bordado.nombre, tipo: bordado.tipo },
      });

      return bordado;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un arte llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/** Detalle de un cambio de campo para la bitácora (de → a). */
type CambioCampo = { de: unknown; a: unknown };

/**
 * Aplica al `update` los campos enriquecidos (descripcion/puntadas/precio) que VENGAN
 * en la edición y arma el detalle para la bitácora. Semántica del PATCH parcial (M1):
 * omitir (`undefined`) = no tocar; `null` (o texto vacío en descripción) = borrar.
 * Devuelve el detalle de los cambios.
 */
function aplicarEnriquecidosEditar(
  datos: z.output<typeof esquemaBordadoEditar>,
  actual: Bordado,
  cambios: Prisma.BordadoUpdateInput,
): Record<string, CambioCampo> {
  const detalle: Record<string, CambioCampo> = {};

  // Descripción (texto): omitir = no tocar; vacío/`null` = borrar (null, nunca '').
  if (datos.descripcion !== undefined) {
    const nuevo = datos.descripcion === null || datos.descripcion === '' ? null : datos.descripcion;
    if (nuevo !== actual.descripcion) {
      cambios.descripcion = nuevo;
      detalle.descripcion = { de: actual.descripcion, a: nuevo };
    }
  }

  // Puntadas (entero): omitir = no tocar; `null` = borrar.
  if (datos.puntadas !== undefined) {
    if (datos.puntadas !== actual.puntadas) {
      cambios.puntadas = datos.puntadas;
      detalle.puntadas = { de: actual.puntadas, a: datos.puntadas };
    }
  }

  // Precio (Decimal): comparar por valor numérico. Omitir = no tocar; `null` = borrar.
  if (cambiaPrecio(datos.precio, actual.precio)) {
    cambios.precio = datos.precio ?? null;
    detalle.precio = {
      de: actual.precio === null ? null : actual.precio.toNumber(),
      a: datos.precio ?? null,
    };
  }

  return detalle;
}

/**
 * Actualiza un bordado: datos generales (nombre/tipo/descripcion/puntadas/precio) y/o
 * `activo` para desactivar (borrado suave) o reactivar. Todo en UNA transacción (A2).
 * La FOTO no se toca aquí (tiene sus propias operaciones). Bitácora según lo que pasó:
 * `MODIFICAR` con el detalle de campos, y/o `DESACTIVAR` si el cambio lo apagó.
 */
export async function actualizarBordado(
  sesion: SesionUsuario,
  entrada: EntradaActualizarBordado,
  bd?: ContextoBd,
): Promise<Bordado> {
  verificarPermiso(sesion, 'bordados.administrar');
  const datos = validarEntrada(esquemaBordadoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirBordado(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaTipo = datos.tipo !== undefined && datos.tipo !== actual.tipo;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      const cambios: Prisma.BordadoUpdateInput = { ...datosModificacion(sesion) };
      const detalleEnriquecidos = aplicarEnriquecidosEditar(datos, actual, cambios);
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaTipo && datos.tipo !== undefined) {
        cambios.tipo = datos.tipo;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const huboCambio =
        cambiaNombre ||
        cambiaTipo ||
        Object.keys(detalleEnriquecidos).length > 0 ||
        reactiva ||
        desactiva;

      if (!huboCambio) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      // Al cambiar nombre o al reactivar puede chocar con un nombre vigente.
      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const bordado = await tx.bordado.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || cambiaTipo || Object.keys(detalleEnriquecidos).length > 0 || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Bordado',
          idEntidad: bordado.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: bordado.nombre } } : {}),
            ...(cambiaTipo ? { tipo: { de: actual.tipo, a: bordado.tipo } } : {}),
            ...detalleEnriquecidos,
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Bordado',
          idEntidad: bordado.id,
          accion: 'DESACTIVAR',
          datos: { nombre: bordado.nombre },
        });
      }

      return bordado;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un arte con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un bordado. Desactivar dos veces es `ErrorConflicto`
 * (pantalla desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarBordado(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Bordado> {
  verificarPermiso(sesion, 'bordados.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirBordado(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El arte "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarBordado(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un bordado desactivado (operación inversa del borrado suave). */
export async function reactivarBordado(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Bordado> {
  verificarPermiso(sesion, 'bordados.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirBordado(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El arte "${actual.nombre}" ya está activo.`);
    }
    return actualizarBordado(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un bordado por id o lanza `ErrorNoEncontrado`. */
export async function obtenerBordado(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Bordado> {
  verificarPermiso(sesion, 'bordados.ver');
  const bordado = await clienteLectura(bd).bordado.findUnique({ where: { id } });
  if (bordado === null) {
    throw new ErrorNoEncontrado('Arte', id);
  }
  return bordado;
}

/**
 * Lista bordados con búsqueda, orden y paginación EN SERVIDOR (volumen ~2,964: la tabla
 * de la UI nunca trae todo para filtrar en memoria). Por defecto: solo activos. Permite
 * filtrar por `tipo` (BORDADO/ESTAMPADO).
 *
 * @example
 * const pagina = await listarBordados(sesion, { tipo: "ESTAMPADO", busqueda: "logo" });
 */
export async function listarBordados(
  sesion: SesionUsuario,
  parametros: ParametrosListarBordados = {},
  bd?: ContextoBd,
): Promise<Pagina<Bordado>> {
  verificarPermiso(sesion, 'bordados.ver');
  const filtros = validarEntrada(esquemaListarBordados, parametros);

  const where: Prisma.BordadoWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.tipo === undefined ? {} : { tipo: filtros.tipo }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.bordado.count({ where }),
    cliente.bordado.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}

// ── Foto del bordado en R2 (R2 §, 1 bordado → 0..1 foto vía presigned) ────────

/** Resultado de preparar la subida de la foto (registro + URL PUT prefirmada). */
export interface SubidaFotoBordado {
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Foto de un bordado con su URL de descarga prefirmada (o vacía si no tiene). */
export interface FotoBordadoConUrl {
  idArchivo: string | null;
  nombreOriginal: string | null;
  tipoMime: string | null;
  tamanoBytes: number | null;
  urlDescarga: string | null;
}

/**
 * Prepara la subida de la FOTO de un bordado (R2) en UNA transacción (A2): exige el
 * bordado y el permiso `bordados.administrar`, crea el registro `Archivo` vía el motor
 * de R2 (carpeta `bordados/<id>` — llave ORDENADA por id, NO por nombre, A5), liga
 * `idArchivoFoto` y devuelve la URL PUT prefirmada para que el navegador suba DIRECTO a
 * R2. Si el bordado YA tenía foto, la reemplaza: borra el `Archivo` anterior (el objeto
 * R2 huérfano es inofensivo — lo documenta `comun/archivos.ts`) en la misma transacción.
 *
 * Tras esto, `idArchivoFoto` ya apunta a la foto nueva: si el PUT del navegador a R2
 * fallara, el `Archivo` referencia una key sin objeto y `urlFoto` daría una URL que
 * 404 (inofensivo; el usuario reintenta). `confirmarFotoBordado` permite además
 * re-asegurar el enlace de forma idempotente tras una subida exitosa.
 *
 * El servicio de archivos se inyecta (default `servicioArchivos()` lazy) para poder
 * pasar un fake en tests sin R2 real (igual que los adjuntos del proveedor en F1-E1B).
 */
export async function solicitarSubidaFoto(
  sesion: SesionUsuario,
  idBordado: number,
  entrada: DatosBordadoFotoCrear,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaFotoBordado> {
  verificarPermiso(sesion, 'bordados.administrar');
  const datos = validarEntrada(esquemaBordadoFotoCrear, entrada);

  return enTransaccion(async (tx) => {
    const actual = await exigirBordado(tx, idBordado);

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_FOTOS}/${idBordado}`,
    });

    // Liga la foto nueva al bordado y deja constancia de quién/cuándo (A7).
    await tx.bordado.update({
      where: { id: idBordado },
      data: { idArchivoFoto: subida.archivo.id, ...datosModificacion(sesion) },
    });

    // Si había una foto previa, su Archivo queda huérfano: bórralo en la MISMA
    // transacción (la FK ya apunta a la nueva, así que SetNull no afecta a la nueva).
    if (actual.idArchivoFoto !== null) {
      await tx.archivo.delete({ where: { id: actual.idArchivoFoto } });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Bordado',
      idEntidad: idBordado,
      accion: 'MODIFICAR',
      datos: {
        foto: actual.idArchivoFoto === null ? 'agregar' : 'reemplazar',
        archivo: datos.nombreOriginal,
      },
    });

    return {
      idArchivo: subida.archivo.id,
      nombreOriginal: datos.nombreOriginal,
      urlSubida: subida.urlSubida,
      expiraEnSegundos: subida.expiraEnSegundos,
    };
  }, bd);
}

/**
 * Re-asegura, de forma IDEMPOTENTE, que `idArchivoFoto` del bordado apunte al
 * `Archivo` indicado tras una subida exitosa (paso "confirmar" opcional del flujo
 * presigned). Si ya apunta ahí, no hace nada. Útil si la subida se desacopla del
 * `solicitarSubidaFoto`; con el enlace ya hecho en la solicitud, normalmente es un
 * no-op. Requiere `bordados.administrar`. Falla si el archivo no existe o no es de
 * este bordado.
 */
export async function confirmarFotoBordado(
  sesion: SesionUsuario,
  idBordado: number,
  idArchivo: string,
  bd?: ContextoBd,
): Promise<Bordado> {
  verificarPermiso(sesion, 'bordados.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirBordado(tx, idBordado);

    if (actual.idArchivoFoto === idArchivo) {
      return actual; // ya enlazada: idempotente
    }
    const archivo = await tx.archivo.findUnique({ where: { id: idArchivo }, select: { id: true } });
    if (archivo === null) {
      throw new ErrorNoEncontrado('Archivo de la foto', idArchivo);
    }

    const anterior = actual.idArchivoFoto;
    const bordado = await tx.bordado.update({
      where: { id: idBordado },
      data: { idArchivoFoto: idArchivo, ...datosModificacion(sesion) },
    });
    if (anterior !== null) {
      await tx.archivo.delete({ where: { id: anterior } });
    }
    return bordado;
  }, bd);
}

/**
 * Devuelve la FOTO del bordado con su URL GET prefirmada para verla. Si el bordado no
 * tiene foto, devuelve todo en `null` (la UI pinta el placeholder NoFoto). Requiere
 * `bordados.ver`. Exige que el bordado exista.
 */
export async function urlFoto(
  sesion: SesionUsuario,
  idBordado: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<FotoBordadoConUrl> {
  verificarPermiso(sesion, 'bordados.ver');
  const cliente = clienteLectura(bd);
  const bordado = await cliente.bordado.findUnique({
    where: { id: idBordado },
    select: {
      id: true,
      archivoFoto: {
        select: { id: true, key: true, nombreOriginal: true, tipoMime: true, tamanoBytes: true },
      },
    },
  });
  if (bordado === null) {
    throw new ErrorNoEncontrado('Arte', idBordado);
  }

  const foto = bordado.archivoFoto;
  if (foto === null) {
    return {
      idArchivo: null,
      nombreOriginal: null,
      tipoMime: null,
      tamanoBytes: null,
      urlDescarga: null,
    };
  }

  return {
    idArchivo: foto.id,
    nombreOriginal: foto.nombreOriginal,
    tipoMime: foto.tipoMime,
    tamanoBytes: foto.tamanoBytes,
    urlDescarga: await archivos.urlDescarga(foto.key),
  };
}

/**
 * Quita la FOTO de un bordado (R2) en UNA transacción (A2): desliga `idArchivoFoto` y borra el
 * `Archivo`. El objeto R2 huérfano es inofensivo (lo documenta `comun/archivos.ts`). Requiere
 * `bordados.administrar`. Si el bordado no tiene foto → `ErrorConflicto` (pantalla desactualizada).
 *
 * **`idArchivoEsperado` acota el borrado a UNA foto concreta.** Sin él se quita la vigente, sea
 * cual sea (el botón "quitar foto" de la pantalla quiere justo eso). Con él, si la foto vigente ya
 * es otra, NO se borra nada y sale `ErrorConflicto` → el llamador distingue "la quité" de "ya no
 * era la tuya". Lo necesita la LIMPIEZA del flujo presigned del frontend: si el `PUT` a R2 falla y
 * mientras tanto otro usuario subió una foto buena al mismo arte, un borrado sin acotar destruiría
 * ESA (pérdida silenciosa de datos).
 *
 * El acotamiento NO es un `if` de check-then-act: el desligue se hace con un `updateMany` cuyo
 * `where` incluye `idArchivoFoto`, o sea un compare-and-set. Postgres re-evalúa ese `WHERE`
 * después de tomar el lock de la fila (EPQ), así que una transacción concurrente que reemplace la
 * foto entre la lectura y la escritura deja `count = 0` y aborta el borrado — no hay ventana. El
 * `Archivo` que se borra es siempre el que quedó desligado por ese CAS, nunca "el que hubiera".
 */
export async function quitarFoto(
  sesion: SesionUsuario,
  idBordado: number,
  idArchivoEsperado?: string,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'bordados.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirBordado(tx, idBordado);
    if (actual.idArchivoFoto === null) {
      throw new ErrorConflicto(`El arte "${actual.nombre}" no tiene foto.`);
    }
    const idAQuitar = idArchivoEsperado ?? actual.idArchivoFoto;

    // CAS: solo desliga si la foto vigente SIGUE siendo `idAQuitar` (ver nota de arriba).
    const { count } = await tx.bordado.updateMany({
      where: { id: idBordado, idArchivoFoto: idAQuitar },
      data: { idArchivoFoto: null, ...datosModificacion(sesion) },
    });
    if (count === 0) {
      throw new ErrorConflicto(
        `La foto del arte "${actual.nombre}" ya no es la que se iba a quitar (alguien la ` +
          `reemplazó): no se quitó nada.`,
      );
    }

    // Ya desligada: el Archivo queda huérfano y se borra en la MISMA transacción.
    await tx.archivo.delete({ where: { id: idAQuitar } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Bordado',
      idEntidad: idBordado,
      accion: 'MODIFICAR',
      datos: { foto: 'quitar', archivo: idAQuitar },
    });
  }, bd);
}
