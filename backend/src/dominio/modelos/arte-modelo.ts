/**
 * ARTE del modelo — bordados/estampados que van DENTRO del `Modelo` (V1-E3d, §Post-F9.35).
 *
 * Hasta V1-E3d el arte era un CATÁLOGO global (`Bordado`) que el BOM referenciaba. Daniel
 * (12-ago-2026): *"cada arte va pegado siempre a un solo modelo… sería más fácil manejar el arte
 * (o varios) dentro del modelo. Ahí mismo establecer su precio, el proveedor"*. Los datos del
 * viejo le dieron la razón: de 2,964 artes, 898 nunca se usaron y el 92 % de los usados vivía en
 * UN solo modelo (y los "compartidos" estaban nombrados con el número del modelo). **El catálogo
 * nunca funcionó como catálogo.**
 *
 * Qué vive aquí (todo bajo `modelos.ver` / `modelos.administrar` — SIN permisos nuevos):
 *  • CRUD del arte renglón por renglón (a diferencia de telas/avíos, que se guardan como SET
 *    completo: el arte tiene FOTO, y una foto no se puede mandar dentro de un PUT de conjunto).
 *  • «Copiar arte de otro modelo»: trae el arte ya lleno para ajustarlo — la conveniencia que
 *    daba el catálogo, sin reinventarlo.
 *  • La GALERÍA de arte, armada DESDE los modelos: cada foto dice de qué modelo es.
 *  • La FOTO en R2, con el mismo flujo presigned que tenía el catálogo.
 *
 * ⚠️ **El precio del arte es el que VIAJA a la OP** (`dominio/costos/costo-orden.ts`): entra UNA
 * vez por modelo, SIN multiplicar por cantidad. Al mover el arte al modelo desapareció el precio
 * del catálogo y quedó UNO solo; la migración resolvió la cascada vieja
 * (`ModeloBordado.precio ?? Bordado.precio`) al copiar, así que el costeo de los datos existentes
 * no se mueve ni un centavo.
 *
 * ⚠️ **Una foto puede estar compartida por VARIOS artes.** Al sacar el arte del catálogo, los
 * artes usados por varios modelos se DUPLICARON (cada modelo con su copia) y las copias apuntan al
 * MISMO `Archivo` — el objeto de R2 no se puede duplicar desde una migración SQL y `archivos.key`
 * es único. Lo mismo hace «copiar arte de otro modelo». Por eso, al quitar/reemplazar la foto, el
 * `Archivo` solo se borra cuando NINGÚN otro arte lo referencia (ver `borrarArchivoSiQuedoHuerfano`).
 */
import {
  esquemaArteCopiarCuerpo,
  esquemaArteCrear,
  esquemaArteEditar,
  esquemaArteFotoCrear,
  TIPOS_ARTE,
  type DatosArteFotoCrear,
} from '../../contrato/esquemas/arte.js';
import type { Prisma, TipoArte } from '../../datos/index.js';
import { z } from 'zod';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { armarPagina, rangoPrisma, type Pagina } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { recalcularEstadoOrdenesDeModelo } from '../produccion/requisitos-orden.js';

import { exigirModelo } from './modelos.js';
import { reordenarComoPrincipal } from './orden-principal.js';

/** Carpeta R2 de las fotos del arte (la key real se ordena por id, no por nombre, A5). */
const CARPETA_FOTOS = 'modelo-arte';

/** Alta de un arte tal como LLEGA (el `tipo` trae default en el esquema). */
export type EntradaCrearArte = z.input<typeof esquemaArteCrear>;

/** Edición de un arte: `id` + cambios parciales. */
export type EntradaActualizarArte = z.input<typeof esquemaArteEditar>;

/** Cuerpo de «copiar arte de otro modelo» tal como llega. */
export type EntradaCopiarArte = z.input<typeof esquemaArteCopiarCuerpo>;

/**
 * Parámetros de la GALERÍA del lado del dominio. Espejo de `esquemaGaleriaArteQuery` del contrato
 * pero con `soloConFoto` ya BOOLEANO: en la URL viaja como texto ("true"/"false") y la ruta lo
 * coacciona, así que el dominio recibe el valor resuelto (mismo patrón que tenían los listados de
 * catálogo).
 */
export const esquemaParametrosGaleria = z.object({
  pagina: z.number().int().min(1).default(1),
  porPagina: z.number().int().min(1).max(100).default(24),
  busqueda: z.string().trim().max(150).optional(),
  tipo: z.enum(TIPOS_ARTE).optional(),
  soloConFoto: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'modelo', 'tipo', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros de la galería tal como llegan al dominio. */
export type ParametrosGaleriaArte = z.input<typeof esquemaParametrosGaleria>;

/**
 * Un arte del modelo tal como sale al cliente. `keyFoto` es la key en R2 de la foto (campo
 * ADITIVO, interno del servidor: lo usa el IMPRESO de la orden para presignar y embeber las
 * imágenes del arte en el PDF; las rutas proyectan campo por campo, así que NUNCA sale a la API).
 */
export interface ModeloArteDetalle {
  id: number;
  idModelo: number;
  nombre: string;
  descripcion: string | null;
  puntadas: number | null;
  precio: number | null;
  tipo: TipoArte;
  idProveedor: number | null;
  proveedor: string | null;
  idArchivoFoto: string | null;
  orden: number;
  keyFoto: string | null;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

/** Celda de la galería de arte: el arte + DE QUÉ MODELO es. */
export interface GaleriaArteItem {
  id: number;
  nombre: string;
  tipo: TipoArte;
  precio: number | null;
  idArchivoFoto: string | null;
  idModelo: number;
  claveModelo: string;
  nombreModelo: string | null;
}

/**
 * Namespace del `pg_advisory_xact_lock` que serializa el REORDENAMIENTO del arte de UN modelo
 * (`marcarArtePrincipal`). Distinto del de las fotos (`fotos-modelo.ts`, 20_545): marcar foto
 * principal y arte principal del mismo modelo no tienen por qué esperarse entre sí. El inventario
 * completo de la familia 20_5xx (varios son `const` NO exportados, invisibles a un grep de
 * exports) está en el comentario de `NAMESPACE_LOCK_FOTOS` — consúltalo antes de estrenar otro.
 */
const NAMESPACE_LOCK_ARTE = 20_544;

/**
 * Orden de despliegue del ARTE (jul-2026): `orden` primero — el arte PRINCIPAL es el PRIMERO
 * (`marcarArtePrincipal`) — y como el histórico está todo en `orden` 0, el desempate por nombre
 * deja los modelos que nadie ha tocado exactamente como se listaban antes. `id` cierra el criterio
 * para que sea DETERMINISTA aun con nombres repetidos.
 */
const ORDEN_ARTES = [{ orden: 'asc' }, { nombre: 'asc' }, { id: 'asc' }] as const;

/** Lo que se lee de `ModeloArte` para armar un {@link ModeloArteDetalle}. */
const SELECT_ARTE = {
  id: true,
  idModelo: true,
  nombre: true,
  descripcion: true,
  puntadas: true,
  precio: true,
  tipo: true,
  idProveedor: true,
  idArchivoFoto: true,
  orden: true,
  creadoEn: true,
  creadoPorId: true,
  modificadoEn: true,
  modificadoPorId: true,
  proveedor: { select: { nombre: true } },
  archivoFoto: { select: { key: true } },
} as const;

/** Fila cruda de `ModeloArte` con las relaciones de {@link SELECT_ARTE}. */
type FilaArte = Prisma.ModeloArteGetPayload<{ select: typeof SELECT_ARTE }>;

/** Proyecta la fila de BD a la forma de salida del dominio. */
function aDetalle(f: FilaArte): ModeloArteDetalle {
  return {
    id: f.id,
    idModelo: f.idModelo,
    nombre: f.nombre,
    descripcion: f.descripcion,
    puntadas: f.puntadas,
    precio: f.precio === null ? null : f.precio.toNumber(),
    tipo: f.tipo,
    idProveedor: f.idProveedor,
    proveedor: f.proveedor?.nombre ?? null,
    idArchivoFoto: f.idArchivoFoto,
    orden: f.orden,
    keyFoto: f.archivoFoto?.key ?? null,
    creadoEn: f.creadoEn,
    creadoPorId: f.creadoPorId,
    modificadoEn: f.modificadoEn,
    modificadoPorId: f.modificadoPorId,
  };
}

/**
 * Lee el ARTE de un modelo, ORDENADO con el principal primero (ver {@link ORDEN_ARTES}). La usa la
 * ficha del modelo (`leerBom`), el impreso de la orden y los listados.
 */
export async function leerArtesModelo(tx: Tx, idModelo: number): Promise<ModeloArteDetalle[]> {
  const filas = await tx.modeloArte.findMany({
    where: { idModelo },
    select: SELECT_ARTE,
    orderBy: [...ORDEN_ARTES],
  });
  return filas.map(aDetalle);
}

/** Busca un arte DENTRO de un modelo o lanza `ErrorNoEncontrado` (A9 del sub-recurso). */
async function exigirArte(tx: Tx, idModelo: number, idArte: number): Promise<FilaArte> {
  const arte = await tx.modeloArte.findFirst({
    where: { id: idArte, idModelo },
    select: SELECT_ARTE,
  });
  if (arte === null) {
    throw new ErrorNoEncontrado('Arte del modelo', idArte);
  }
  return arte;
}

/** Valida que el proveedor (si viene) exista y esté ACTIVO. */
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
      `El proveedor "${proveedor.nombre}" está desactivado y no se puede asignar al arte.`,
    );
  }
}

/**
 * Unicidad de negocio del nombre DENTRO del modelo (ya no global: el mismo arte duplicado en dos
 * modelos es lo normal). La carrera residual la captura el unique de la base (P2002).
 */
async function exigirNombreLibre(
  tx: Tx,
  idModelo: number,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.modeloArte.findFirst({
    where: {
      idModelo,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(`Este modelo ya tiene un arte llamado "${nombre}".`);
  }
}

/** Marca la auditoría del modelo (modificadoPorId/En) cuando cambia su arte. */
async function tocarModelo(tx: Tx, sesion: SesionUsuario, idModelo: number): Promise<void> {
  await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
}

/** Siguiente posición libre del arte de un modelo (los nuevos entran AL FINAL). */
async function siguienteOrden(tx: Tx, idModelo: number): Promise<number> {
  const maximo = await tx.modeloArte.aggregate({ where: { idModelo }, _max: { orden: true } });
  return (maximo._max.orden ?? -1) + 1;
}

/** Traduce el choque del unique `(idModelo, nombre)` a un 409 con mensaje de negocio. */
function comoConflictoDeNombre(error: unknown, nombre: string): unknown {
  if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
    return new ErrorConflicto(`Este modelo ya tiene un arte llamado "${nombre}".`, {
      causa: error,
    });
  }
  return error;
}

// ── CRUD del arte (renglón por renglón; el permiso es el del BOM) ─────────────

/** Lista el ARTE de un modelo. Requiere `modelos.ver`. Exige que el modelo exista. */
export async function listarArtesModelo(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ModeloArteDetalle[]> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.modelo.findUnique({ where: { id: idModelo }, select: { id: true } });
  if (existe === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  return leerArtesModelo(cliente, idModelo);
}

/**
 * Agrega un ARTE a un modelo en UNA transacción (A2). Reglas: permiso `modelos.administrar`;
 * modelo existente; nombre único dentro del modelo; proveedor (si viene) existente y activo. El
 * arte nuevo entra AL FINAL (no desbanca al principal) y SIN foto (se sube aparte, presigned).
 *
 * Recalcula el estado de las órdenes del modelo: el arte es uno de los REQUISITOS de "orden
 * completa" (`requisitos-orden.ts`), y como el recálculo por catálogo solo ASCIENDE, agregar arte
 * solo puede completar órdenes, nunca degradarlas.
 *
 * @example
 * await crearArte(sesion, idModelo, { nombre: "Logo Marilyn", tipo: "ESTAMPADO", precio: 12.5 });
 */
export async function crearArte(
  sesion: SesionUsuario,
  idModelo: number,
  entrada: EntradaCrearArte,
  bd?: ContextoBd,
): Promise<ModeloArteDetalle> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaArteCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirModelo(tx, idModelo);
      await exigirNombreLibre(tx, idModelo, datos.nombre);
      if (datos.idProveedor !== undefined) {
        await exigirProveedorValido(tx, datos.idProveedor);
      }

      const creado = await tx.modeloArte.create({
        data: {
          idModelo,
          nombre: datos.nombre,
          tipo: datos.tipo,
          orden: await siguienteOrden(tx, idModelo),
          ...(datos.descripcion === undefined ? {} : { descripcion: datos.descripcion }),
          ...(datos.puntadas === undefined ? {} : { puntadas: datos.puntadas }),
          ...(datos.precio === undefined ? {} : { precio: datos.precio }),
          ...(datos.idProveedor === undefined ? {} : { idProveedor: datos.idProveedor }),
          ...datosCreacion(sesion),
        },
        select: SELECT_ARTE,
      });

      await tocarModelo(tx, sesion, idModelo);
      await recalcularEstadoOrdenesDeModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'ModeloArte',
        idEntidad: creado.id,
        accion: 'CREAR',
        datos: { idModelo, nombre: creado.nombre, tipo: creado.tipo },
      });

      return aDetalle(creado);
    }, bd);
  } catch (error) {
    throw comoConflictoDeNombre(error, datos.nombre);
  }
}

/** Detalle de un cambio de campo para la bitácora (de → a). */
type CambioCampo = { de: unknown; a: unknown };

/**
 * Compara el `precio`/`puntadas` capturado (number | null | undefined) con el guardado. Devuelve
 * `true` si el valor cambia. `undefined` = "no se tocó" (no cambia); `null` = borrar (cambia si
 * había valor).
 */
function cambiaDecimal(entrada: number | null | undefined, actual: Prisma.Decimal | null): boolean {
  if (entrada === undefined) {
    return false;
  }
  const anterior = actual === null ? null : actual.toNumber();
  return anterior !== entrada;
}

/**
 * Actualiza un ARTE del modelo (nombre/descripción/puntadas/precio/tipo/proveedor) en UNA
 * transacción (A2). Semántica del PATCH parcial (M1): omitir = no tocar; `null` = borrar. La FOTO
 * no se toca aquí (tiene sus propias operaciones). Bitácora con el detalle de campos (A7).
 */
export async function actualizarArte(
  sesion: SesionUsuario,
  idModelo: number,
  entrada: EntradaActualizarArte,
  bd?: ContextoBd,
): Promise<ModeloArteDetalle> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaArteEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirArte(tx, idModelo, datos.id);

      const cambios: Prisma.ModeloArteUpdateInput = { ...datosModificacion(sesion) };
      const detalle: Record<string, CambioCampo> = {};

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      if (cambiaNombre && datos.nombre !== undefined) {
        await exigirNombreLibre(tx, idModelo, datos.nombre, datos.id);
        cambios.nombre = datos.nombre;
        detalle.nombre = { de: actual.nombre, a: datos.nombre };
      }
      if (datos.tipo !== undefined && datos.tipo !== actual.tipo) {
        cambios.tipo = datos.tipo;
        detalle.tipo = { de: actual.tipo, a: datos.tipo };
      }
      if (datos.descripcion !== undefined) {
        const nuevo =
          datos.descripcion === null || datos.descripcion === '' ? null : datos.descripcion;
        if (nuevo !== actual.descripcion) {
          cambios.descripcion = nuevo;
          detalle.descripcion = { de: actual.descripcion, a: nuevo };
        }
      }
      if (datos.puntadas !== undefined && datos.puntadas !== actual.puntadas) {
        cambios.puntadas = datos.puntadas;
        detalle.puntadas = { de: actual.puntadas, a: datos.puntadas };
      }
      if (cambiaDecimal(datos.precio, actual.precio)) {
        cambios.precio = datos.precio ?? null;
        detalle.precio = {
          de: actual.precio === null ? null : actual.precio.toNumber(),
          a: datos.precio ?? null,
        };
      }
      if (datos.idProveedor !== undefined && datos.idProveedor !== actual.idProveedor) {
        if (datos.idProveedor !== null) {
          await exigirProveedorValido(tx, datos.idProveedor);
        }
        cambios.proveedor =
          datos.idProveedor === null
            ? { disconnect: true }
            : { connect: { id: datos.idProveedor } };
        detalle.idProveedor = { de: actual.idProveedor, a: datos.idProveedor };
      }

      if (Object.keys(detalle).length === 0) {
        return aDetalle(actual); // nada que guardar: idempotente, sin bitácora vacía
      }

      const arte = await tx.modeloArte.update({
        where: { id: datos.id },
        data: cambios,
        select: SELECT_ARTE,
      });
      await tocarModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'ModeloArte',
        idEntidad: arte.id,
        accion: 'MODIFICAR',
        datos: { idModelo, ...detalle },
      });

      return aDetalle(arte);
    }, bd);
  } catch (error) {
    throw comoConflictoDeNombre(error, datos.nombre ?? '');
  }
}

/**
 * Quita un ARTE del modelo en UNA transacción (A2). Es un renglón de la receta, no un catálogo:
 * se quita como se quita una tela o un avío (el borrado suave del catálogo viejo ya no aplica).
 * Queda constancia en la bitácora con TODO lo que decía el renglón (D3: nada se borra en
 * silencio). Su FOTO se desliga con el mismo cuidado que en `quitarFotoArte`: el `Archivo` solo se
 * borra si ningún otro arte lo comparte. La traza del precosto se pone en NULL sola (SetNull): el
 * precio usado ya vive en `PrecostoLinea.precioUnit`.
 */
export async function eliminarArte(
  sesion: SesionUsuario,
  idModelo: number,
  idArte: number,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirArte(tx, idModelo, idArte);

    await tx.modeloArte.delete({ where: { id: idArte } });
    if (actual.idArchivoFoto !== null) {
      await borrarArchivoSiQuedoHuerfano(tx, actual.idArchivoFoto);
    }

    await tocarModelo(tx, sesion, idModelo);
    // No hay acción `ELIMINAR` en el enum de bitácora (A7) y el arte no tiene borrado suave: se
    // registra como MODIFICAR con `operacion: 'quitar'` y TODO lo que decía el renglón, para que
    // el rastro conserve lo que se fue (D3: nada se borra en silencio).
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: idArte,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'quitar',
        idModelo,
        nombre: actual.nombre,
        tipo: actual.tipo,
        precio: actual.precio === null ? null : actual.precio.toNumber(),
        idProveedor: actual.idProveedor,
        puntadas: actual.puntadas,
      },
    });
  }, bd);
}

/**
 * Marca UN arte como el PRINCIPAL del modelo (jul-2026, petición de Daniel: *"y la primera del
 * arte también"*). Igual que la foto principal, "principal" NO es una bandera: es **el primero**,
 * así que marcarlo = moverlo a la posición 0 y reindexar los demás 0..N-1 conservando su orden
 * relativo, en UNA transacción (A2).
 *
 * Requiere `modelos.administrar`. Si el arte no es de ese modelo → `ErrorNoEncontrado`.
 * IDEMPOTENTE: si ya era el principal (y el orden ya estaba compacto) no escribe nada.
 *
 * CONCURRENCIA: el reindexado es leer-calcular-escribir y bajo READ COMMITTED dos marcados
 * simultáneos del MISMO modelo dejarían `orden` duplicado (y el desempate elegiría al arte
 * equivocado). Lo PRIMERO de la transacción es un `pg_advisory_xact_lock(NAMESPACE, idModelo)` —
 * el segundo espera, re-lee ya reordenado y calcula bien. Se libera al commit y solo serializa
 * marcados de arte del MISMO modelo.
 */
export async function marcarArtePrincipal(
  sesion: SesionUsuario,
  idModelo: number,
  idArte: number,
  bd?: ContextoBd,
): Promise<ModeloArteDetalle[]> {
  verificarPermiso(sesion, 'modelos.administrar');

  return enTransaccion(async (tx) => {
    // ANTES de leer: serializa el reordenamiento de ESTE modelo (ver nota de concurrencia arriba).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_ARTE}::int, ${idModelo}::int)`;
    await exigirModelo(tx, idModelo);

    // MISMO orden que la lectura: de ahí sale el orden relativo que se conserva.
    const actuales = await tx.modeloArte.findMany({
      where: { idModelo },
      orderBy: [...ORDEN_ARTES],
      select: { id: true, orden: true },
    });
    if (!actuales.some((f) => f.id === idArte)) {
      throw new ErrorNoEncontrado('Arte del modelo', idArte);
    }

    const { cambios } = reordenarComoPrincipal(
      actuales.map((f) => ({ clave: f.id, orden: f.orden })),
      idArte,
    );
    if (cambios.length > 0) {
      for (const cambio of cambios) {
        await tx.modeloArte.update({
          where: { id: cambio.clave },
          data: { orden: cambio.orden, ...datosModificacion(sesion) },
        });
      }
      await tocarModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { bom: 'arte-principal', idArte },
      });
    }

    return leerArtesModelo(tx, idModelo);
  }, bd);
}

/**
 * COPIA a este modelo un arte que ya existe en OTRO (§Post-F9.35 punto 2): trae el arte ya lleno
 * —nombre, descripción, puntadas, precio, tipo, proveedor **y foto**— para ajustarlo. Es la
 * conveniencia que daba el catálogo, sin reinventarlo.
 *
 * La copia COMPARTE el `Archivo` de la foto con el original (ver nota de cabecera): la imagen es
 * la misma y el objeto de R2 no se duplica. Si el nombre ya está ocupado en el modelo destino, se
 * puede mandar uno distinto en `nombre`; si no, el choque sale como 409 con mensaje claro (no se
 * inventa un sufijo a espaldas del usuario). Copiar de un arte del MISMO modelo se rechaza: sería
 * un duplicado sin sentido con nombre forzado.
 */
export async function copiarArteDeOtroModelo(
  sesion: SesionUsuario,
  idModelo: number,
  entrada: EntradaCopiarArte,
  bd?: ContextoBd,
): Promise<ModeloArteDetalle> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaArteCopiarCuerpo, entrada);

  let nombreFinal = '';
  try {
    return await enTransaccion(async (tx) => {
      await exigirModelo(tx, idModelo);
      const origen = await tx.modeloArte.findUnique({
        where: { id: datos.idArteOrigen },
        select: SELECT_ARTE,
      });
      if (origen === null) {
        throw new ErrorNoEncontrado('Arte del modelo', datos.idArteOrigen);
      }
      if (origen.idModelo === idModelo) {
        throw new ErrorValidacion('Ese arte ya es de este modelo: elige el arte de otro modelo.');
      }

      nombreFinal = datos.nombre ?? origen.nombre;
      await exigirNombreLibre(tx, idModelo, nombreFinal);

      const creado = await tx.modeloArte.create({
        data: {
          idModelo,
          nombre: nombreFinal,
          descripcion: origen.descripcion,
          puntadas: origen.puntadas,
          precio: origen.precio,
          tipo: origen.tipo,
          idProveedor: origen.idProveedor,
          idArchivoFoto: origen.idArchivoFoto,
          orden: await siguienteOrden(tx, idModelo),
          ...datosCreacion(sesion),
        },
        select: SELECT_ARTE,
      });

      await tocarModelo(tx, sesion, idModelo);
      await recalcularEstadoOrdenesDeModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'ModeloArte',
        idEntidad: creado.id,
        accion: 'CREAR',
        datos: {
          idModelo,
          nombre: creado.nombre,
          operacion: 'copiar-de-otro-modelo',
          idArteOrigen: origen.id,
          idModeloOrigen: origen.idModelo,
        },
      });

      return aDetalle(creado);
    }, bd);
  } catch (error) {
    throw comoConflictoDeNombre(error, nombreFinal);
  }
}

// ── Galería de arte (armada DESDE los modelos, §Post-F9.35 punto 4) ───────────

/**
 * GALERÍA visual del arte. Sobrevivió al retiro del catálogo, pero ahora se arma desde los
 * modelos: cada celda dice de qué modelo es el arte. Búsqueda por nombre del arte O por
 * clave/nombre del modelo, filtro por tipo y por "solo con foto", todo paginado EN SERVIDOR.
 * Requiere `modelos.ver` (el mismo permiso que la ficha del modelo — sin permisos nuevos).
 */
export async function galeriaArte(
  sesion: SesionUsuario,
  parametros: ParametrosGaleriaArte = {},
  bd?: ContextoBd,
): Promise<Pagina<GaleriaArteItem>> {
  verificarPermiso(sesion, 'modelos.ver');
  const filtros = validarEntrada(esquemaParametrosGaleria, parametros);

  const busqueda = filtros.busqueda ?? '';
  const where: Prisma.ModeloArteWhereInput = {
    ...(filtros.tipo === undefined ? {} : { tipo: filtros.tipo }),
    ...(filtros.soloConFoto ? { idArchivoFoto: { not: null } } : {}),
    ...(busqueda === ''
      ? {}
      : {
          OR: [
            { nombre: { contains: busqueda, mode: 'insensitive' } },
            { modelo: { codigo: { contains: busqueda, mode: 'insensitive' } } },
            { modelo: { descripcion: { contains: busqueda, mode: 'insensitive' } } },
          ],
        }),
  };

  const orden: Prisma.ModeloArteOrderByWithRelationInput =
    filtros.ordenarPor === 'modelo'
      ? { modelo: { codigo: filtros.direccion } }
      : { [filtros.ordenarPor]: filtros.direccion };

  const cliente = clienteLectura(bd);
  const [total, filas] = await Promise.all([
    cliente.modeloArte.count({ where }),
    cliente.modeloArte.findMany({
      where,
      orderBy: [orden, { id: 'asc' }],
      select: {
        id: true,
        nombre: true,
        tipo: true,
        precio: true,
        idArchivoFoto: true,
        idModelo: true,
        modelo: { select: { codigo: true, descripcion: true } },
      },
      ...rangoPrisma(filtros),
    }),
  ]);

  const datos: GaleriaArteItem[] = filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    tipo: f.tipo,
    precio: f.precio === null ? null : f.precio.toNumber(),
    idArchivoFoto: f.idArchivoFoto,
    idModelo: f.idModelo,
    claveModelo: f.modelo.codigo,
    nombreModelo: f.modelo.descripcion,
  }));

  return armarPagina(datos, total, filtros);
}

// ── Foto del arte en R2 (presigned, 1 arte → 0..1 foto) ──────────────────────

/** Resultado de preparar la subida de la foto (registro + URL PUT prefirmada). */
export interface SubidaFotoArte {
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Foto de un arte con su URL de descarga prefirmada (o vacía si no tiene). */
export interface FotoArteConUrl {
  idArchivo: string | null;
  nombreOriginal: string | null;
  tipoMime: string | null;
  tamanoBytes: number | null;
  urlDescarga: string | null;
}

/**
 * Borra el registro `Archivo` SOLO si ya nadie lo usa. Es la contrapartida de que varios artes
 * puedan COMPARTIR foto (migración de los artes duplicados + «copiar arte de otro modelo»):
 * borrarlo a ciegas dejaría a los demás artes sin su imagen. El objeto en R2 se queda (deuda ya
 * documentada en `comun/archivos.ts`: no hay DeleteObject).
 */
async function borrarArchivoSiQuedoHuerfano(tx: Tx, idArchivo: string): Promise<void> {
  const enUso = await tx.modeloArte.count({ where: { idArchivoFoto: idArchivo } });
  if (enUso === 0) {
    await tx.archivo.delete({ where: { id: idArchivo } });
  }
}

/**
 * Prepara la subida de la FOTO de un arte (R2) en UNA transacción (A2): exige el arte y el
 * permiso `modelos.administrar`, crea el registro `Archivo` vía el motor de R2 (carpeta
 * `modelo-arte/<id>` — llave ORDENADA por id, NO por nombre, A5), liga `idArchivoFoto` y devuelve
 * la URL PUT prefirmada para que el navegador suba DIRECTO a R2. Si el arte YA tenía foto, la
 * reemplaza: el `Archivo` anterior se borra en la misma transacción **si ningún otro arte lo
 * comparte**.
 *
 * CAS (compare-and-set) en el enlace: el `where` del `updateMany` incluye la foto que se LEYÓ, así
 * que el enlace solo aplica si esa sigue siendo la vigente. Sin él había carrera: dos reemplazos
 * simultáneos del mismo arte leen la misma foto previa, el segundo se forma detrás del lock de la
 * fila y luego intenta borrar un `Archivo` que el primero ya borró → P2025 → 500. Postgres
 * re-evalúa el `WHERE` después de tomar el lock (EPQ), de modo que el perdedor ve `count = 0` y
 * sale con un 409 claro ("vuelve a intentar") en vez de un error interno. Nada se pierde: la
 * subida ni siquiera había empezado y la transacción revierte el `Archivo` recién creado.
 *
 * El servicio de archivos se INYECTA (default `servicioArchivos()` lazy) para poder pasar un fake
 * en tests sin R2 real.
 */
export async function solicitarSubidaFotoArte(
  sesion: SesionUsuario,
  idModelo: number,
  idArte: number,
  entrada: DatosArteFotoCrear,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaFotoArte> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaArteFotoCrear, entrada);

  return enTransaccion(async (tx) => {
    const actual = await exigirArte(tx, idModelo, idArte);

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_FOTOS}/${idArte}`,
    });

    const { count } = await tx.modeloArte.updateMany({
      where: { id: idArte, idArchivoFoto: actual.idArchivoFoto },
      data: { idArchivoFoto: subida.archivo.id, ...datosModificacion(sesion) },
    });
    if (count === 0) {
      throw new ErrorConflicto(
        `Otro usuario acaba de cambiar la foto del arte "${actual.nombre}": vuelve a intentar.`,
      );
    }
    if (actual.idArchivoFoto !== null) {
      await borrarArchivoSiQuedoHuerfano(tx, actual.idArchivoFoto);
    }

    await tocarModelo(tx, sesion, idModelo);
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: idArte,
      accion: 'MODIFICAR',
      datos: {
        idModelo,
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
 * Devuelve la FOTO del arte con su URL GET prefirmada para verla. Si no tiene foto, devuelve todo
 * en `null` (la UI pinta el placeholder NoFoto). Requiere `modelos.ver`.
 */
export async function urlFotoArte(
  sesion: SesionUsuario,
  idModelo: number,
  idArte: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<FotoArteConUrl> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const arte = await cliente.modeloArte.findFirst({
    where: { id: idArte, idModelo },
    select: {
      id: true,
      archivoFoto: {
        select: { id: true, key: true, nombreOriginal: true, tipoMime: true, tamanoBytes: true },
      },
    },
  });
  if (arte === null) {
    throw new ErrorNoEncontrado('Arte del modelo', idArte);
  }

  const foto = arte.archivoFoto;
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
 * Quita la FOTO de un arte (R2) en UNA transacción (A2): desliga `idArchivoFoto` y borra el
 * `Archivo` **si ningún otro arte lo comparte**. Requiere `modelos.administrar`. Si el arte no
 * tiene foto → `ErrorConflicto` (pantalla desactualizada).
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
 * foto entre la lectura y la escritura deja `count = 0` y aborta el borrado — no hay ventana.
 */
export async function quitarFotoArte(
  sesion: SesionUsuario,
  idModelo: number,
  idArte: number,
  idArchivoEsperado?: string,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirArte(tx, idModelo, idArte);
    if (actual.idArchivoFoto === null) {
      throw new ErrorConflicto(`El arte "${actual.nombre}" no tiene foto.`);
    }
    const idAQuitar = idArchivoEsperado ?? actual.idArchivoFoto;

    // CAS: solo desliga si la foto vigente SIGUE siendo `idAQuitar` (ver nota de arriba).
    const { count } = await tx.modeloArte.updateMany({
      where: { id: idArte, idArchivoFoto: idAQuitar },
      data: { idArchivoFoto: null, ...datosModificacion(sesion) },
    });
    if (count === 0) {
      throw new ErrorConflicto(
        `La foto del arte "${actual.nombre}" ya no es la que se iba a quitar (alguien la ` +
          `reemplazó): no se quitó nada.`,
      );
    }

    await borrarArchivoSiQuedoHuerfano(tx, idAQuitar);

    await tocarModelo(tx, sesion, idModelo);
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: idArte,
      accion: 'MODIFICAR',
      datos: { idModelo, foto: 'quitar', archivo: idAQuitar },
    });
  }, bd);
}
