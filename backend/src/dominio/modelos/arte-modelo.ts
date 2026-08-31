/**
 * ARTE del modelo — bordados/estampados/aplicaciones/lavados que van DENTRO del `Modelo`
 * (V1-E3d §Post-F9.35 + **V1-E3f §Post-F9.52/.58**).
 *
 * Hasta V1-E3d el arte era un CATÁLOGO global (`Bordado`) que el BOM referenciaba. Daniel
 * (12-ago-2026): *"cada arte va pegado siempre a un solo modelo… sería más fácil manejar el arte
 * (o varios) dentro del modelo. Ahí mismo establecer su precio, el proveedor"*. Los datos del
 * viejo le dieron la razón: de 2,964 artes, 898 nunca se usaron y el 92 % de los usados vivía en
 * UN solo modelo (y los "compartidos" estaban nombrados con el número del modelo). **El catálogo
 * nunca funcionó como catálogo.**
 *
 * ⭐ **V1-E3f cambió la FORMA del arte** (§Post-F9.52, siete observaciones de Daniel):
 *  1. **Se fue el `nombre`** — *"Es completamente irrelevante el nombre del estampado. Creo que
 *     con la descripción sería suficiente."* Era la LLAVE (`@@unique([idModelo, nombre])`) y el
 *     desempate del orden, así que se reemplazó: la identidad es el `id`, el orden lo da `orden`
 *     con desempate por `id`, y la `descripcion` pasó a REQUERIDA y visible. **Ya NO hay red que
 *     impida dos artes con la misma descripción en un modelo** (Daniel lo sabe; la pantalla
 *     AVISA, no bloquea).
 *  2. **`posicion`** (frente/espalda/manga…): texto LIBRE, no catálogo.
 *  3. El proveedor se acota por ROL (`bordado`/`estampado`/`aplicacion`…) — lo resuelve el
 *     catálogo de tipos (`dominio/produccion/tipos-proceso.ts`), no este módulo.
 *  4. **El tipo es el catálogo ÚNICO** `TipoProceso` con `esArte` (ex enum `TipoArte`).
 *  5. **Fotos en PLURAL** (`ModeloArteFoto`), como la galería del modelo.
 *  6. Las **puntadas** no se borran: se muestran solo si `TipoProceso.usaPuntadas`.
 *
 * Qué vive aquí (todo bajo `modelos.ver` / `modelos.administrar` — SIN permisos nuevos):
 *  • CRUD del arte renglón por renglón (a diferencia de telas/avíos, que se guardan como SET
 *    completo: el arte tiene FOTOS, y una foto no se puede mandar dentro de un PUT de conjunto).
 *  • «Copiar arte de otro modelo»: trae el arte ya lleno para ajustarlo — la conveniencia que
 *    daba el catálogo, sin reinventarlo.
 *  • La GALERÍA de arte, armada DESDE los modelos: cada foto dice de qué modelo es.
 *  • Las FOTOS en R2, con el mismo flujo presigned que tenía el catálogo.
 *
 * ⚠️ **El precio del arte es el que VIAJA a la OP** (`dominio/costos/costo-orden.ts`): entra UNA
 * vez por modelo, SIN multiplicar por cantidad.
 *
 * ⚠️ **Una foto puede estar compartida por VARIOS artes.** Al sacar el arte del catálogo, los
 * artes usados por varios modelos se DUPLICARON (cada modelo con su copia) y las copias apuntan al
 * MISMO `Archivo` — el objeto de R2 no se puede duplicar desde una migración SQL y `archivos.key`
 * es único. Lo mismo hace «copiar arte de otro modelo». Por eso, al quitar una foto, el `Archivo`
 * solo se borra cuando NINGUNA otra foto de arte lo referencia (`borrarArchivoSiQuedoHuerfano`).
 */
import {
  esquemaArteCopiarCuerpo,
  esquemaArteCrear,
  esquemaArteEditar,
  esquemaArteFotoCrear,
  type DatosArteFotoCrear,
} from '../../contrato/esquemas/arte.js';
import type { Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { armarPagina, rangoPrisma, type Pagina } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { exigirModelo } from './modelos.js';
import { reordenarComoPrincipal } from './orden-principal.js';
import { resolverIdRecetaDeModelo } from './receta-compartida.js';
import { tocarModeloPorCambioDeReceta } from './revision-modelo.js';

/** Carpeta R2 de las fotos del arte (la key real se ordena por id, no por nombre, A5). */
const CARPETA_FOTOS = 'modelo-arte';

/** Alta de un arte tal como LLEGA. */
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
  idTipoArte: z.number().int().positive().optional(),
  soloConFoto: z.boolean().default(false),
  ordenarPor: z.enum(['descripcion', 'modelo', 'tipo', 'creadoEn']).default('descripcion'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros de la galería tal como llegan al dominio. */
export type ParametrosGaleriaArte = z.input<typeof esquemaParametrosGaleria>;

/** Una foto del arte tal como viaja embebida en el arte (sin URL prefirmada). */
export interface ArteFotoResumen {
  idFoto: number;
  idArchivo: string;
  orden: number;
  /**
   * Key en R2 (campo ADITIVO, interno del servidor: lo usa el IMPRESO de la orden para presignar
   * y embeber las imágenes del arte en el PDF). Las rutas proyectan campo por campo, así que
   * NUNCA sale a la API.
   */
  key: string;
}

/** Un arte del modelo tal como sale al cliente. */
export interface ModeloArteDetalle {
  id: number;
  idModelo: number;
  descripcion: string;
  posicion: string | null;
  puntadas: number | null;
  precio: number | null;
  idTipoArte: number;
  tipoArte: string;
  codigoTipoArte: string;
  usaPuntadas: boolean;
  idProveedor: number | null;
  proveedor: string | null;
  fotos: ArteFotoResumen[];
  orden: number;
  creadoEn: Date;
  creadoPorId: string | null;
  modificadoEn: Date;
  modificadoPorId: string | null;
}

/**
 * Celda de la galería de arte: el arte + DE QUÉ MODELO es.
 *
 * El `precio` viaja aunque la REJILLA de la galería no lo pinte: este mismo endpoint alimenta el
 * diálogo «copiar arte de otro modelo» (`CopiarArteDialogo.tsx`), donde sí se muestra — copiar un
 * arte copia su precio, así que el usuario tiene que verlo ANTES de elegir cuál copia.
 */
export interface GaleriaArteItem {
  id: number;
  descripcion: string;
  posicion: string | null;
  idTipoArte: number;
  tipoArte: string;
  precio: number | null;
  /** Archivo de la PRIMERA foto del arte (la miniatura), o null si no tiene ninguna. */
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
 * Orden de despliegue del ARTE: `orden` primero — el arte PRINCIPAL es el PRIMERO
 * (`marcarArtePrincipal`) — y `id` como desempate DETERMINISTA.
 *
 * ⚠️ Antes el desempate era por `nombre`; al retirarse el nombre (V1-E3f, §Post-F9.52 punto 1) el
 * criterio pasa a `id`. Para el histórico —todo en `orden` 0— eso cambia el orden de listado de
 * "alfabético" a "por antigüedad de captura". Es el precio del punto 1 y es reversible con un
 * clic: marcar el arte principal reindexa el `orden` y manda.
 */
const ORDEN_ARTES = [{ orden: 'asc' }, { id: 'asc' }] as const;

/** Orden de las fotos DENTRO de un arte (espejo de `ModeloFoto`). */
const ORDEN_FOTOS = [{ orden: 'asc' }, { id: 'asc' }] as const;

/** Lo que se lee de `ModeloArte` para armar un {@link ModeloArteDetalle}. */
const SELECT_ARTE = {
  id: true,
  idModelo: true,
  descripcion: true,
  posicion: true,
  puntadas: true,
  precio: true,
  idTipoArte: true,
  idProveedor: true,
  orden: true,
  creadoEn: true,
  creadoPorId: true,
  modificadoEn: true,
  modificadoPorId: true,
  proveedor: { select: { nombre: true } },
  tipoArte: { select: { nombre: true, codigo: true, usaPuntadas: true } },
  fotos: {
    select: { id: true, idArchivo: true, orden: true, archivo: { select: { key: true } } },
    orderBy: [...ORDEN_FOTOS],
  },
} satisfies Prisma.ModeloArteSelect;

/** Fila cruda de `ModeloArte` con las relaciones de {@link SELECT_ARTE}. */
type FilaArte = Prisma.ModeloArteGetPayload<{ select: typeof SELECT_ARTE }>;

/** Proyecta la fila de BD a la forma de salida del dominio. */
function aDetalle(f: FilaArte): ModeloArteDetalle {
  return {
    id: f.id,
    idModelo: f.idModelo,
    descripcion: f.descripcion,
    posicion: f.posicion,
    puntadas: f.puntadas,
    precio: f.precio === null ? null : f.precio.toNumber(),
    idTipoArte: f.idTipoArte,
    tipoArte: f.tipoArte.nombre,
    codigoTipoArte: f.tipoArte.codigo,
    usaPuntadas: f.tipoArte.usaPuntadas,
    idProveedor: f.idProveedor,
    proveedor: f.proveedor?.nombre ?? null,
    fotos: f.fotos.map((foto) => ({
      idFoto: foto.id,
      idArchivo: foto.idArchivo,
      orden: foto.orden,
      key: foto.archivo.key,
    })),
    orden: f.orden,
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
  // ⭐ V1-E9b — LA RECETA COMPARTIDA: el arte de un modelo de producción derivado es el de su
  // modelo de DESARROLLO (tercera lectura canónica, misma razón que en `leerTelasBom`).
  const idReceta = await resolverIdRecetaDeModelo(tx, idModelo);
  const filas = await tx.modeloArte.findMany({
    where: { idModelo: idReceta },
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
 * Valida el TIPO del arte contra el catálogo ÚNICO (V1-E3f): tiene que existir, estar ACTIVO y
 * estar marcado como `esArte`. Sin esta última condición se podría capturar un arte "de costura",
 * que es justo lo que la bandera vino a evitar (§Post-F9.58: la costura es la única de las cinco
 * que NO es arte). El servidor es la autoridad aunque la pantalla ya filtre (A1).
 */
async function exigirTipoArteValido(tx: Tx, idTipoArte: number): Promise<void> {
  const tipo = await tx.tipoProceso.findUnique({
    where: { id: idTipoArte },
    select: { nombre: true, activo: true, esArte: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion('El tipo de arte seleccionado no existe.');
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo "${tipo.nombre}" está desactivado y no se puede usar.`);
  }
  if (!tipo.esArte) {
    throw new ErrorValidacion(`El proceso "${tipo.nombre}" no está marcado como tipo de arte.`);
  }
}

/** Siguiente posición libre del arte de un modelo (los nuevos entran AL FINAL). */
async function siguienteOrden(tx: Tx, idModelo: number): Promise<number> {
  const maximo = await tx.modeloArte.aggregate({ where: { idModelo }, _max: { orden: true } });
  return (maximo._max.orden ?? -1) + 1;
}

/**
 * Snapshot de **TODO** lo que decía un renglón de arte, para la bitácora de un borrado (D3: nada
 * se borra en silencio). Vive en un solo lugar porque el arte se borra desde DOS caminos —
 * {@link eliminarArte} y «copiar receta con reemplazo» (`bom-modelo.ts`)— y los dos deben dejar el
 * MISMO rastro. Al desaparecer el catálogo, esta fila ES el arte: si no se registra `precio`,
 * `idProveedor` ni sus fotos, no hay de dónde recuperarlos (y el precio entra al costo de la OP,
 * `costos/costo-orden.ts`).
 */
export function datosArteParaBitacora(a: {
  id: number;
  descripcion: string;
  posicion: string | null;
  idTipoArte: number;
  puntadas: number | null;
  precio: Prisma.Decimal | null;
  idProveedor: number | null;
  orden: number;
  fotos?: { idArchivo: string }[];
}): Prisma.InputJsonObject {
  return {
    id: a.id,
    descripcion: a.descripcion,
    posicion: a.posicion,
    idTipoArte: a.idTipoArte,
    puntadas: a.puntadas,
    precio: a.precio === null ? null : a.precio.toNumber(),
    idProveedor: a.idProveedor,
    orden: a.orden,
    fotos: (a.fotos ?? []).map((f) => f.idArchivo),
  };
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
 * modelo existente; tipo del catálogo único válido y marcado `esArte`; proveedor (si viene)
 * existente y activo. El arte nuevo entra AL FINAL (no desbanca al principal) y SIN fotos (se
 * suben aparte, presigned).
 *
 * ⚠️ **NO hay unicidad que validar** desde V1-E3f: al retirarse el `nombre` (§Post-F9.52 punto 1)
 * dos artes con la misma descripción en un modelo son LEGALES. Daniel lo aceptó; el aviso —no
 * bloqueo— vive en la pantalla.
 *
 * @example
 * await crearArte(sesion, idModelo, { descripcion: "Logo Marilyn", idTipoArte: 3, precio: 12.5 });
 */
export async function crearArte(
  sesion: SesionUsuario,
  idModelo: number,
  entrada: EntradaCrearArte,
  bd?: ContextoBd,
): Promise<ModeloArteDetalle> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaArteCrear, entrada);

  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);
    await exigirTipoArteValido(tx, datos.idTipoArte);
    if (datos.idProveedor !== undefined) {
      await exigirProveedorValido(tx, datos.idProveedor);
    }

    const creado = await tx.modeloArte.create({
      data: {
        idModelo,
        descripcion: datos.descripcion,
        idTipoArte: datos.idTipoArte,
        orden: await siguienteOrden(tx, idModelo),
        ...(datos.posicion === undefined || datos.posicion === ''
          ? {}
          : { posicion: datos.posicion }),
        ...(datos.puntadas === undefined ? {} : { puntadas: datos.puntadas }),
        ...(datos.precio === undefined ? {} : { precio: datos.precio }),
        ...(datos.idProveedor === undefined ? {} : { idProveedor: datos.idProveedor }),
        ...datosCreacion(sesion),
      },
      select: SELECT_ARTE,
    });

    await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'arte');
    // V1-E3d (§Post-F9.43): el arte del MODELO ya no decide el estado de sus órdenes — cada una
    // lleva su arte congelado en su receta. Se quitó el recálculo hacia atrás.
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: creado.id,
      accion: 'CREAR',
      datos: { idModelo, descripcion: creado.descripcion, idTipoArte: creado.idTipoArte },
    });

    return aDetalle(creado);
  }, bd);
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
 * Actualiza un ARTE del modelo (descripción/posición/puntadas/precio/tipo/proveedor) en UNA
 * transacción (A2). Semántica del PATCH parcial (M1): omitir = no tocar; `null` = borrar. Las
 * FOTOS no se tocan aquí (tienen sus propias operaciones). Bitácora con el detalle de campos (A7).
 */
export async function actualizarArte(
  sesion: SesionUsuario,
  idModelo: number,
  entrada: EntradaActualizarArte,
  bd?: ContextoBd,
): Promise<ModeloArteDetalle> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaArteEditar, entrada);

  return enTransaccion(async (tx) => {
    const actual = await exigirArte(tx, idModelo, datos.id);

    const cambios: Prisma.ModeloArteUpdateInput = { ...datosModificacion(sesion) };
    const detalle: Record<string, CambioCampo> = {};

    if (datos.descripcion !== undefined && datos.descripcion !== actual.descripcion) {
      cambios.descripcion = datos.descripcion;
      detalle.descripcion = { de: actual.descripcion, a: datos.descripcion };
    }
    if (datos.posicion !== undefined) {
      const nuevo = datos.posicion === null || datos.posicion === '' ? null : datos.posicion;
      if (nuevo !== actual.posicion) {
        cambios.posicion = nuevo;
        detalle.posicion = { de: actual.posicion, a: nuevo };
      }
    }
    if (datos.idTipoArte !== undefined && datos.idTipoArte !== actual.idTipoArte) {
      await exigirTipoArteValido(tx, datos.idTipoArte);
      cambios.tipoArte = { connect: { id: datos.idTipoArte } };
      detalle.idTipoArte = { de: actual.idTipoArte, a: datos.idTipoArte };
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
        datos.idProveedor === null ? { disconnect: true } : { connect: { id: datos.idProveedor } };
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
    await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'arte');
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: arte.id,
      accion: 'MODIFICAR',
      datos: { idModelo, ...detalle },
    });

    return aDetalle(arte);
  }, bd);
}

/**
 * Quita un ARTE del modelo en UNA transacción (A2). Es un renglón de la receta, no un catálogo:
 * se quita como se quita una tela o un avío (el borrado suave del catálogo viejo ya no aplica).
 * Queda constancia en la bitácora con TODO lo que decía el renglón (D3: nada se borra en
 * silencio). Sus FOTOS se van con él (Cascade) y sus `Archivo` se borran con el mismo cuidado que
 * en `quitarFotoArte`: solo si ningún otro arte los comparte. La traza del precosto se pone en
 * NULL sola (SetNull): el precio usado ya vive en `PrecostoLinea.precioUnit`.
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

    // Los renglones de foto se van por Cascade; los `Archivo` hay que evaluarlos DESPUÉS (si
    // quedan sin dueño). Se guardan antes de borrar porque el borrado se los lleva.
    const archivos = actual.fotos.map((f) => f.idArchivo);
    await tx.modeloArte.delete({ where: { id: idArte } });
    for (const idArchivo of new Set(archivos)) {
      await borrarArchivoSiQuedoHuerfano(tx, idArchivo);
    }

    await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'arte');
    // No hay acción `ELIMINAR` en el enum de bitácora (A7) y el arte no tiene borrado suave: se
    // registra como MODIFICAR con `operacion: 'quitar'` y TODO lo que decía el renglón
    // ({@link datosArteParaBitacora} — descripción, posición, orden y las FOTOS incluidas), para
    // que el rastro conserve lo que se fue (D3: nada se borra en silencio).
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: idArte,
      accion: 'MODIFICAR',
      datos: { operacion: 'quitar', idModelo, ...datosArteParaBitacora(actual) },
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
      await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'arte');
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
 * —descripción, posición, puntadas, precio, tipo, proveedor **y sus fotos**— para ajustarlo. Es la
 * conveniencia que daba el catálogo, sin reinventarlo.
 *
 * Las fotos de la copia COMPARTEN los `Archivo` del original (ver nota de cabecera): la imagen es
 * la misma y el objeto de R2 no se duplica. Copiar de un arte del MISMO modelo se rechaza: sería
 * un duplicado sin sentido. Desde V1-E3f ya no hay choque de nombre que resolver (el nombre se
 * retiró): se puede mandar otra `descripcion` para la copia, o se conserva la del origen.
 */
export async function copiarArteDeOtroModelo(
  sesion: SesionUsuario,
  idModelo: number,
  entrada: EntradaCopiarArte,
  bd?: ContextoBd,
): Promise<ModeloArteDetalle> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaArteCopiarCuerpo, entrada);

  return enTransaccion(async (tx) => {
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

    const creado = await tx.modeloArte.create({
      data: {
        idModelo,
        descripcion: datos.descripcion ?? origen.descripcion,
        posicion: origen.posicion,
        puntadas: origen.puntadas,
        precio: origen.precio,
        idTipoArte: origen.idTipoArte,
        idProveedor: origen.idProveedor,
        orden: await siguienteOrden(tx, idModelo),
        fotos: {
          create: origen.fotos.map((f) => ({
            idArchivo: f.idArchivo,
            orden: f.orden,
            creadoPorId: sesion.id,
          })),
        },
        ...datosCreacion(sesion),
      },
      select: SELECT_ARTE,
    });

    await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'arte');
    // V1-E3d (§Post-F9.43): el arte del MODELO ya no decide el estado de sus órdenes — cada una
    // lleva su arte congelado en su receta. Se quitó el recálculo hacia atrás.
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: creado.id,
      accion: 'CREAR',
      datos: {
        idModelo,
        descripcion: creado.descripcion,
        operacion: 'copiar-de-otro-modelo',
        idArteOrigen: origen.id,
        idModeloOrigen: origen.idModelo,
        fotosCopiadas: creado.fotos.length,
      },
    });

    return aDetalle(creado);
  }, bd);
}

// ── Galería de arte (armada DESDE los modelos, §Post-F9.35 punto 4) ───────────

/**
 * GALERÍA visual del arte. Sobrevivió al retiro del catálogo, pero ahora se arma desde los
 * modelos: cada celda dice de qué modelo es el arte. Búsqueda por descripción/posición del arte O
 * por clave/nombre del modelo, filtro por tipo y por "solo con foto", todo paginado EN SERVIDOR.
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
    ...(filtros.idTipoArte === undefined ? {} : { idTipoArte: filtros.idTipoArte }),
    ...(filtros.soloConFoto ? { fotos: { some: {} } } : {}),
    ...(busqueda === ''
      ? {}
      : {
          OR: [
            { descripcion: { contains: busqueda, mode: 'insensitive' } },
            { posicion: { contains: busqueda, mode: 'insensitive' } },
            { modelo: { codigo: { contains: busqueda, mode: 'insensitive' } } },
            { modelo: { descripcion: { contains: busqueda, mode: 'insensitive' } } },
          ],
        }),
  };

  const orden: Prisma.ModeloArteOrderByWithRelationInput =
    filtros.ordenarPor === 'modelo'
      ? { modelo: { codigo: filtros.direccion } }
      : filtros.ordenarPor === 'tipo'
        ? { tipoArte: { nombre: filtros.direccion } }
        : { [filtros.ordenarPor]: filtros.direccion };

  const cliente = clienteLectura(bd);
  const [total, filas] = await Promise.all([
    cliente.modeloArte.count({ where }),
    cliente.modeloArte.findMany({
      where,
      orderBy: [orden, { id: 'asc' }],
      select: {
        id: true,
        descripcion: true,
        posicion: true,
        idTipoArte: true,
        precio: true,
        idModelo: true,
        tipoArte: { select: { nombre: true } },
        modelo: { select: { codigo: true, descripcion: true } },
        // Solo la PRIMERA foto: la miniatura de la celda (el resto no se pinta en la rejilla).
        fotos: { select: { idArchivo: true }, orderBy: [...ORDEN_FOTOS], take: 1 },
      },
      ...rangoPrisma(filtros),
    }),
  ]);

  const datos: GaleriaArteItem[] = filas.map((f) => ({
    id: f.id,
    descripcion: f.descripcion,
    posicion: f.posicion,
    idTipoArte: f.idTipoArte,
    tipoArte: f.tipoArte.nombre,
    precio: f.precio === null ? null : f.precio.toNumber(),
    idArchivoFoto: f.fotos[0]?.idArchivo ?? null,
    idModelo: f.idModelo,
    claveModelo: f.modelo.codigo,
    nombreModelo: f.modelo.descripcion,
  }));

  return armarPagina(datos, total, filtros);
}

// ── Fotos del arte en R2 (presigned, 1 arte → N fotos) ───────────────────────

/** Resultado de preparar la subida de una foto (registro + URL PUT prefirmada). */
export interface SubidaFotoArte {
  idFoto: number;
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Una foto de un arte con su URL de descarga prefirmada. */
export interface FotoArteConUrl {
  idFoto: number;
  idArchivo: string;
  orden: number;
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
  urlDescarga: string;
}

/**
 * Borra el registro `Archivo` SOLO si ya nadie lo usa. Es la contrapartida de que varios artes
 * puedan COMPARTIR foto (migración de los artes duplicados + «copiar arte de otro modelo»):
 * borrarlo a ciegas dejaría a los demás artes sin su imagen. El objeto en R2 se queda (deuda ya
 * documentada en `comun/archivos.ts`: no hay DeleteObject).
 *
 * Se EXPORTA porque el arte se borra desde DOS caminos: {@link eliminarArte} y «copiar receta con
 * reemplazo» (`bom-modelo.ts`), que barre el arte del destino y debe cuidar sus fotos igual.
 *
 * ⚠️ **El `SELECT … FOR UPDATE` de la primera línea NO es decorativo: sin él la cuenta miente.**
 * Bajo READ COMMITTED, "contar y decidir" es un check-then-act y la foto compartida abre DOS
 * carreras, una de ellas con PÉRDIDA DE IMAGEN:
 *
 *  1. *Copia vs. quitado.* T1 copia el arte 10 a otro modelo (la copia comparte `arch_7`,
 *     {@link copiarArteDeOtroModelo}); T2 quita esa foto del arte 10. Si el `count` de T2 corre
 *     antes de que el INSERT de T1 sea visible, T2 ve 0 y borra `arch_7`. Ese DELETE se forma
 *     detrás del `FOR KEY SHARE` que el INSERT de T1 tomó sobre la fila de `archivos`, y al
 *     commit de T1 el `ON DELETE CASCADE` de la FK **se lleva la foto recién nacida**: la copia
 *     queda sin imagen, en silencio.
 *  2. *Dos quitados a la vez.* Dos artes que comparten `arch_7` se quitan en paralelo: los dos
 *     `count` ven al otro arte todavía apuntando → ninguno borra → la fila `Archivo` queda
 *     HUÉRFANA (sin objeto R2 recuperable por nombre).
 *
 * El candado de la fila de `archivos` cierra las dos: conflictúa con el `FOR KEY SHARE` del
 * INSERT (caso 1: el quitado espera al commit de la copia, re-cuenta con snapshot nuevo y ya la
 * ve) y serializa los quitados simultáneos (caso 2: el segundo cuenta 0 y borra). Si el candado
 * no devuelve fila, el `Archivo` ya lo borró otro camino y aquí no hay nada que hacer (evita un
 * P2025 → 500 por borrar dos veces).
 */
export async function borrarArchivoSiQuedoHuerfano(tx: Tx, idArchivo: string): Promise<void> {
  const bloqueado = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "archivos" WHERE "id" = ${idArchivo} FOR UPDATE`;
  if (bloqueado.length === 0) {
    return; // ya no existe: otro camino lo borró y su fila está commiteada
  }
  const enUso = await tx.modeloArteFoto.count({ where: { idArchivo } });
  if (enUso === 0) {
    await tx.archivo.delete({ where: { id: idArchivo } });
  }
}

/**
 * Prepara la subida de UNA foto de un arte (R2) en UNA transacción (A2): exige el arte y el
 * permiso `modelos.administrar`, crea el registro `Archivo` vía el motor de R2 (carpeta
 * `modelo-arte/<id>` — llave ORDENADA por id, NO por nombre, A5), crea el renglón
 * `ModeloArteFoto` AL FINAL de las que ya hay y devuelve la URL PUT prefirmada para que el
 * navegador suba DIRECTO a R2.
 *
 * ⚠️ **Ya no REEMPLAZA nada** (V1-E3f): las fotos son plurales, así que subir una segunda foto la
 * AGREGA. Con eso desaparece el CAS que protegía el reemplazo de la foto única y la carrera que
 * cerraba: dos subidas simultáneas al mismo arte ahora crean dos renglones distintos, que es
 * exactamente lo que ambos usuarios querían. Para quitar una foto está `quitarFotoArte`.
 *
 * Si el PUT del navegador fallara, el `Archivo`/`ModeloArteFoto` referencian una key sin objeto
 * (su `urlDescarga` daría 404): la limpieza del frontend borra ESE renglón por su `idFoto`.
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
    await exigirArte(tx, idModelo, idArte);

    const ultima = await tx.modeloArteFoto.aggregate({
      where: { idModeloArte: idArte },
      _max: { orden: true },
    });

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_FOTOS}/${idArte}`,
    });

    const foto = await tx.modeloArteFoto.create({
      data: {
        idModeloArte: idArte,
        idArchivo: subida.archivo.id,
        orden: (ultima._max.orden ?? -1) + 1,
        creadoPorId: sesion.id,
      },
    });

    await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'arte');
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: idArte,
      accion: 'MODIFICAR',
      datos: { idModelo, foto: 'agregar', idFoto: foto.id, archivo: datos.nombreOriginal },
    });

    return {
      idFoto: foto.id,
      idArchivo: subida.archivo.id,
      nombreOriginal: datos.nombreOriginal,
      urlSubida: subida.urlSubida,
      expiraEnSegundos: subida.expiraEnSegundos,
    };
  }, bd);
}

/**
 * Devuelve las FOTOS del arte con sus URL GET prefirmadas para verlas, ordenadas. Si el arte no
 * tiene ninguna devuelve `[]` (la UI pinta el placeholder NoFoto). Requiere `modelos.ver`.
 */
export async function listarFotosArte(
  sesion: SesionUsuario,
  idModelo: number,
  idArte: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<FotoArteConUrl[]> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  // ⭐ V1-E9b — el arte que la ficha del hijo enseña es el del PADRE, así que la pertenencia (A9
  // del sub-recurso) se comprueba contra el modelo de la RECETA. Sin esto, abrir las fotos de un
  // arte heredado daría 404 sobre un renglón que la pantalla acaba de listar.
  const idReceta = await resolverIdRecetaDeModelo(cliente, idModelo);
  const arte = await cliente.modeloArte.findFirst({
    where: { id: idArte, idModelo: idReceta },
    select: {
      id: true,
      fotos: {
        select: {
          id: true,
          orden: true,
          archivo: {
            select: {
              id: true,
              key: true,
              nombreOriginal: true,
              tipoMime: true,
              tamanoBytes: true,
            },
          },
        },
        orderBy: [...ORDEN_FOTOS],
      },
    },
  });
  if (arte === null) {
    throw new ErrorNoEncontrado('Arte del modelo', idArte);
  }

  return Promise.all(
    arte.fotos.map(async (foto) => ({
      idFoto: foto.id,
      idArchivo: foto.archivo.id,
      orden: foto.orden,
      nombreOriginal: foto.archivo.nombreOriginal,
      tipoMime: foto.archivo.tipoMime,
      tamanoBytes: foto.archivo.tamanoBytes,
      urlDescarga: await archivos.urlDescarga(foto.archivo.key),
    })),
  );
}

/**
 * Quita UNA foto de un arte (R2) en UNA transacción (A2): borra el renglón `ModeloArteFoto` y su
 * `Archivo` **si ninguna otra foto de arte lo comparte**. Requiere `modelos.administrar`. Si la
 * foto no pertenece a ese arte (o el arte no es de ese modelo) → `ErrorNoEncontrado`.
 *
 * El `idFoto` identifica exactamente la foto a quitar, así que ya no hace falta el acotamiento por
 * `idArchivo` que necesitaba la foto única (V1-E3d): la LIMPIEZA del flujo presigned del frontend
 * borra por el `idFoto` que su propia subida creó y nunca puede tocar la de otro usuario.
 */
export async function quitarFotoArte(
  sesion: SesionUsuario,
  idModelo: number,
  idArte: number,
  idFoto: number,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    // Un solo `findFirst` amarra las tres pertenencias (modelo → arte → foto): A9 del sub-recurso.
    const foto = await tx.modeloArteFoto.findFirst({
      where: { id: idFoto, idModeloArte: idArte, arte: { idModelo } },
      select: { id: true, idArchivo: true },
    });
    if (foto === null) {
      throw new ErrorNoEncontrado('Foto del arte', idFoto);
    }

    await tx.modeloArteFoto.delete({ where: { id: foto.id } });
    await borrarArchivoSiQuedoHuerfano(tx, foto.idArchivo);

    await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'arte');
    await registrarBitacora(tx, sesion, {
      entidad: 'ModeloArte',
      idEntidad: idArte,
      accion: 'MODIFICAR',
      datos: { idModelo, foto: 'quitar', idFoto, archivo: foto.idArchivo },
    });
  }, bd);
}
