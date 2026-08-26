/**
 * ⭐ COTIZACIÓN (V1-E7c, §Post-F9.109) — **el papel que se le manda al cliente**.
 *
 * Daniel (25-ago-2026): *"nos falta desarrollar toda la parte de las cotizaciones"*. Tenía razón: el
 * flujo llegaba hasta la LISTA de precios —que es la MESA donde se convierte costo en precio, se
 * aprueba y se negocia en vivo— y ahí se cortaba. Faltaba el DOCUMENTO que sale de esa mesa, para
 * poder contestar siempre *"¿qué le mandé al cliente el 12 de marzo, y con qué receta?"*.
 *
 * Forma que él dictó: **UNA cotización con VARIOS modelos** (*"es un documento con las 5
 * cotizaciones… o sea una cotización con los 5 modelos"*) ⇒ cuelga de la LISTA (cliente +
 * departamento), no de un desarrollo suelto.
 *
 * 🔴 **Su regla, la que es fácil equivocar:** si en la segunda vuelta sólo cambian **3 de los 5**
 * modelos, **la cotización nueva lleva LOS CINCO**. El cliente la lee sola, sin la anterior al lado;
 * mandarle sólo el delta lo obligaría a reconstruir el paquete de memoria. *Una cotización dice lo
 * que se ofrece AHORA, completo.* Por eso `emitirCotizacion` NO recibe una selección de renglones:
 * toma los de la lista, todos.
 *
 * Decisiones de diseño del lead (marcadas para que Daniel pueda objetarlas):
 *  1. **La cotización es INMUTABLE** — nace ya `emitida` (es la foto de un momento) y no se edita
 *     jamás. Otra vuelta = OTRA cotización. Lo único posterior es **cancelarla con motivo**, que sólo
 *     escribe el sello de cancelación y nunca toca el contenido (D3: ni se edita ni se borra).
 *  2. **Cada renglón CONGELA valores, no sólo referencias.** Guarda el precio, el código, la
 *     descripción y el número del cliente COPIADOS, además del `idListaLinea`/`idPrecosto` como
 *     procedencia. La lista sigue moviéndose después de emitir: con punteros, reimprimir la
 *     cotización de marzo enseñaría los precios de mayo. Mismo patrón de copia congelada que la
 *     receta modelo→OP (§Post-F9.34).
 *  3. 🔴 **No se emite con un precio SIN APROBAR.** Mandarle al cliente un precio que el dueño no
 *     aprobó es exactamente el compromiso que nadie firmó (*"el precio lo apruebo solo yo"*). Si
 *     algún renglón no tiene `precioAprobado`, se rechaza NOMBRANDO cuáles.
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas sólo validan permiso + Zod y delegan.
 *  • A2 — emitir (folio + cotización + N renglones + bitácora) va en UNA transacción.
 *  • A3 — el FOLIO sale de `siguienteFolio(...,'cotizacion')` (secuencia atómica, NUNCA Max()+1).
 *  • A7 — auditoría uniforme + `Bitacora` en la misma tx.
 *  • A9 — scope por empresa activa en TODA lectura/mutación (una cotización de otra empresa, para
 *    esta sesión, NO EXISTE: 404, nunca 409).
 *  • Importes ocultos (null) sin `consultas.ver-importes` — lo aplica la proyección server-side.
 *
 * Permisos (SIN inventar ninguno nuevo): **emitir/cancelar = `listas.negociar`** (dueño + gerente
 * comercial, que es quien está en la mesa) y **ver = `listas.ver`**.
 */
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import {
  esquemaCotizacionCancelar,
  esquemaCotizacionEmitir,
  type CotizacionDetalle,
  type CotizacionLineaSalida,
  type CotizacionResumen,
  type CotizacionesQuery,
  type DatosCotizacionCancelar,
  type DatosCotizacionEmitir,
} from '../../contrato/esquemas/cotizacion.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, redondear2 } from '../costos/decimales.js';
import { NAMESPACE_LOCK_LISTA } from './listas-precios.js';

/** Entradas tipadas de las mutaciones (forma del esquema compartido). */
export type EntradaEmitirCotizacion = z.input<typeof esquemaCotizacionEmitir>;
export type EntradaCancelarCotizacion = z.input<typeof esquemaCotizacionCancelar>;

/** Parámetros del listado = el querystring del contrato (reutilizado por la ruta REST). */
export type FiltrosCotizaciones = CotizacionesQuery;

/** Clave de la secuencia atómica del folio de cotización (A3, por empresa). */
const CLAVE_SECUENCIA = 'cotizacion';

/** Estado de un documento recién emitido. No hay borrador: el papel nace ya mandado. */
export const ESTADO_EMITIDA = 'emitida';
/** Estado de un documento cancelado (con motivo sellado). El contenido NUNCA cambia. */
export const ESTADO_CANCELADA = 'cancelada';

// ── Congelado: la foto del momento ─────────────────────────────────────────────────

/**
 * Lo que un renglón de la LISTA aporta al congelado. Se declara aparte (y no como el tipo de Prisma)
 * para que {@link congelarRenglones} y {@link exigirRenglonesAprobados} sean funciones PURAS,
 * probables sin base de datos.
 */
export interface RenglonListaParaCongelar {
  id: number;
  idPrecosto: number;
  versionPrecosto: number;
  codigoModelo: string;
  descripcionModelo: string | null;
  numeroCliente: string | null;
  /** El precio APROBADO por el dueño. `null` = todavía no lo aprueba nadie ⇒ no se puede cotizar. */
  precioAprobado: number | null;
}

/**
 * 🔴 GUARD: **no se emite una cotización con un precio SIN APROBAR** (decisión 3 del encabezado).
 *
 * Mandarle al cliente un precio que el dueño no aprobó es el compromiso que nadie firmó — y Daniel
 * fue explícito en que *"el precio lo apruebo solo yo"*. Se rechaza NOMBRANDO los modelos que faltan
 * (no un "faltan 3": el que va a aprobar necesita saber cuáles abrir), en el orden de la lista.
 *
 * También rechaza la lista VACÍA: un documento sin modelos no es una oferta, es una hoja en blanco.
 */
export function exigirRenglonesAprobados(renglones: RenglonListaParaCongelar[]): void {
  if (renglones.length === 0) {
    throw new ErrorConflicto(
      'La lista no tiene renglones; no hay nada que cotizarle al cliente. Agrega modelos a la lista primero.',
    );
  }
  const sinAprobar = renglones.filter((r) => r.precioAprobado === null).map((r) => r.codigoModelo);
  if (sinAprobar.length > 0) {
    throw new ErrorConflicto(
      `No se puede emitir la cotización: estos modelos aún no tienen precio APROBADO por el dueño: ${sinAprobar.join(', ')}. ` +
        'Apruébalos (o teclea su precio) en la lista y vuelve a emitir.',
    );
  }
}

/**
 * CONGELA los renglones de la lista en renglones de cotización: **copia los valores**, no los apunta.
 *
 * Por qué esto es el corazón de la etapa: la lista sigue negociándose después de emitir (se recalculan
 * factores, se teclea otro precio, entra otra ronda). Si el papel guardara sólo `idListaLinea`,
 * reimprimir la cotización de marzo enseñaría los precios de mayo — o sea, MENTIRÍA sobre lo que se le
 * mandó al cliente. Las FK que sí se guardan (`idListaLinea`, `idPrecosto`) son PROCEDENCIA: contestan
 * *"de qué renglón salió y con qué versión de la receta"*, no de dónde leer el precio.
 *
 * Se asume {@link exigirRenglonesAprobados} ya corrido (por eso el `precioAprobado` no puede ser null;
 * si lo fuera, es una invariante rota y truena claro en vez de escribir un 0 silencioso).
 */
export function congelarRenglones(
  renglones: RenglonListaParaCongelar[],
  idCotizacion: number,
  auditoria: { creadoPorId: string; modificadoPorId: string },
): Prisma.CotizacionLineaCreateManyInput[] {
  return renglones.map((r) => {
    if (r.precioAprobado === null) {
      throw new Error(
        `El renglón ${r.codigoModelo} quedó sin precio aprobado tras la validación (invariante rota).`,
      );
    }
    return {
      idCotizacion,
      idListaLinea: r.id,
      idPrecosto: r.idPrecosto,
      versionPrecosto: r.versionPrecosto,
      codigoModelo: r.codigoModelo,
      descripcionModelo: r.descripcionModelo,
      numeroCliente: r.numeroCliente,
      precioUnit: r.precioAprobado,
      ...auditoria,
    };
  });
}

// ── Include + proyección ────────────────────────────────────────────────────────────

/** `include` para leer una cotización con sus renglones y el encabezado de su lista. */
const incluirCotizacion = {
  // 🔴 NINGÚN join a la lista, el cliente o el modelo: TODO lo que el documento dice vive en sus
  // propias columnas congeladas. Ése es el punto entero de la etapa — y también lo que permite que
  // `idLista` sea nullable, o sea que la lista NO quede atrapada por haber producido un papel.
  lineas: { orderBy: { id: 'asc' } },
} satisfies Prisma.CotizacionInclude;

type CotizacionConDetalle = Prisma.CotizacionGetPayload<{ include: typeof incluirCotizacion }>;

/** `YYYY-MM-DD` de un `Date` (columna @db.Date). Sólo el día calendario importa. */
function aFechaCorta(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Proyecta un renglón CONGELADO a la salida del contrato.
 *
 * 🔴 Lee **exclusivamente** las columnas propias del renglón de cotización (`codigoModelo`,
 * `precioUnit`, …). Jamás la lista ni el desarrollo: ahí está el punto entero del documento. Si esta
 * función algún día "mejorara" resolviendo el modelo por FK para traer su nombre actual, el papel
 * empezaría a cambiar solo — y ésa es precisamente la mentira que la etapa existe para impedir.
 */
export function aLineaCotizacionSalida(
  linea: CotizacionConDetalle['lineas'][number],
  verImportes: boolean,
): CotizacionLineaSalida {
  return {
    id: linea.id,
    idListaLinea: linea.idListaLinea,
    idPrecosto: linea.idPrecosto,
    versionPrecosto: linea.versionPrecosto,
    codigoModelo: linea.codigoModelo,
    descripcionModelo: linea.descripcionModelo,
    numeroCliente: linea.numeroCliente,
    precioUnit: verImportes ? num(linea.precioUnit) : null,
  };
}

/** Proyecta una cotización COMPLETA (con renglones congelados) a la salida del contrato. */
export function aCotizacionSalida(
  cotizacion: CotizacionConDetalle,
  verImportes: boolean,
): CotizacionDetalle {
  const lineas = cotizacion.lineas.map((l) => aLineaCotizacionSalida(l, verImportes));
  return {
    id: cotizacion.id,
    folio: Number(cotizacion.folio),
    idLista: cotizacion.idLista,
    // 🔴 El encabezado sale de las columnas CONGELADAS del documento, no de la lista: la lista puede
    // haberse borrado (`idLista` en null) o el cliente haberse renombrado, y el papel de marzo debe
    // seguir diciendo lo que decía en marzo.
    folioLista: Number(cotizacion.folioLista),
    idCliente: cotizacion.idCliente,
    nombreCliente: cotizacion.nombreCliente,
    idClienteDepartamento: cotizacion.idClienteDepartamento,
    nombreDepartamento: cotizacion.nombreDepartamento,
    fecha: aFechaCorta(cotizacion.fecha),
    estado: cotizacion.estado,
    notas: cotizacion.notas,
    motivoCancelacion: cotizacion.motivoCancelacion,
    canceladaPorId: cotizacion.canceladaPorId,
    canceladaEn: cotizacion.canceladaEn === null ? null : cotizacion.canceladaEn.toISOString(),
    lineas,
    // El total suma los precios CONGELADOS (server-side, A1: nunca se pivotea en el cliente).
    total: verImportes
      ? redondear2(cotizacion.lineas.reduce((acc, l) => acc + num(l.precioUnit), 0))
      : null,
    creadoEn: cotizacion.creadoEn.toISOString(),
    creadoPorId: cotizacion.creadoPorId,
  };
}

// ── Emitir ──────────────────────────────────────────────────────────────────────────

/**
 * ⭐ EMITE la cotización de una lista (A2/A3): el papel que sale de la mesa.
 *
 * Toma **TODOS** los renglones de la lista (regla de Daniel: aunque sólo hayan cambiado 3 de 5, la
 * cotización nueva lleva los cinco), exige que TODOS tengan precio aprobado, congela sus valores y
 * sella el documento con folio propio.
 *
 * Se serializa con el MISMO advisory lock por lista que usa toda mutación de la lista
 * (`NAMESPACE_LOCK_LISTA`): así la foto que se congela es COHERENTE — nadie aprueba, recalcula
 * factores ni registra una ronda a media emisión, y el papel no puede salir con tres renglones de
 * antes y dos de después.
 *
 * Requiere `listas.negociar`.
 */
export async function emitirCotizacion(
  sesion: SesionUsuario,
  entrada: EntradaEmitirCotizacion,
  bd?: ContextoBd,
): Promise<CotizacionDetalle> {
  verificarPermiso(sesion, 'listas.negociar');
  const datos: DatosCotizacionEmitir = validarEntrada(esquemaCotizacionEmitir, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const idNueva = await enTransaccion(async (tx) => {
    // Mismo namespace que `listas-precios.ts`/`negociacion.ts`: la lista queda quieta mientras se
    // congela la foto (sin TOCTOU entre "leí los precios" y "los copié al documento").
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_LISTA}::int, ${datos.idLista}::int)`;

    // A9: una lista de otra empresa NO EXISTE para esta sesión (404, nunca 409).
    const lista = await tx.listaPrecios.findFirst({
      where: { id: datos.idLista, idEmpresa },
      // El encabezado se lee AQUÍ, UNA vez, para copiarlo al documento (ver abajo). Después de este
      // momento la cotización nunca vuelve a preguntarle nada a la lista.
      select: {
        id: true,
        folio: true,
        idCliente: true,
        idClienteDepartamento: true,
        cliente: { select: { nombre: true } },
        clienteDepartamento: { select: { nombre: true } },
      },
    });
    if (lista === null) {
      throw new ErrorNoEncontrado('Lista de precios', datos.idLista);
    }

    // TODOS los renglones de la lista, en su orden (la cotización va completa, siempre).
    const lineas = await tx.listaPreciosLinea.findMany({
      where: { idLista: datos.idLista },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        idPrecosto: true,
        precioAprobado: true,
        precosto: { select: { version: true } },
        desarrollo: {
          select: {
            numeroCliente: true,
            modelo: { select: { codigo: true, descripcion: true } },
          },
        },
      },
    });

    const renglones: RenglonListaParaCongelar[] = lineas.map((l) => ({
      id: l.id,
      idPrecosto: l.idPrecosto,
      versionPrecosto: l.precosto.version,
      codigoModelo: l.desarrollo.modelo.codigo,
      descripcionModelo: l.desarrollo.modelo.descripcion,
      numeroCliente: l.desarrollo.numeroCliente,
      precioAprobado: l.precioAprobado === null ? null : num(l.precioAprobado),
    }));

    // 🔴 El guard va ANTES del folio: si falta una aprobación no se quema un consecutivo.
    exigirRenglonesAprobados(renglones);

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA);
    const fecha = datos.fecha === undefined ? new Date() : new Date(datos.fecha);

    const cotizacion = await tx.cotizacion.create({
      data: {
        folio,
        idEmpresa,
        idLista: datos.idLista,
        // 🔴 ENCABEZADO CONGELADO: a quién se le mandó y desde qué lista, copiado como TEXTO. Con
        // esto el papel es AUTOSUFICIENTE — se imprime igual aunque después borren la lista (la FK
        // se va a null) o renombren al cliente. Y como ya no hay nada que leer por la FK, tampoco
        // hay que blindarla: la lista no queda atrapada por haber producido una cotización.
        idCliente: lista.idCliente,
        idClienteDepartamento: lista.idClienteDepartamento,
        nombreCliente: lista.cliente.nombre,
        nombreDepartamento: lista.clienteDepartamento.nombre,
        folioLista: lista.folio,
        fecha,
        estado: ESTADO_EMITIDA,
        ...(datos.notas === undefined || datos.notas === null ? {} : { notas: datos.notas }),
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });

    const congelados = congelarRenglones(renglones, cotizacion.id, datosCreacion(sesion));
    await tx.cotizacionLinea.createMany({ data: congelados });

    await registrarBitacora(tx, sesion, {
      entidad: 'Cotizacion',
      idEntidad: cotizacion.id,
      accion: 'CREAR',
      datos: {
        operacion: 'emitir',
        folio: Number(folio),
        idLista: datos.idLista,
        // Qué se le ofreció, congelado, en la bitácora también: la respuesta a "¿qué le mandé?"
        // no debe depender de que nadie toque la tabla del documento.
        renglones: renglones.map((r) => ({
          codigoModelo: r.codigoModelo,
          versionPrecosto: r.versionPrecosto,
          precioUnit: r.precioAprobado ?? 0,
        })),
      },
    });

    return cotizacion.id;
  }, bd);

  return obtenerCotizacion(sesion, idNueva, bd);
}

// ── Cancelar (nunca borrar, nunca editar) ──────────────────────────────────────────

/**
 * CANCELA una cotización con motivo (D3): jamás se borra ni se edita su contenido — se le pone un
 * SELLO (motivo + quién + cuándo) y el documento queda ahí, legible, marcado como cancelado. Lo que
 * se mandó al cliente el 12 de marzo se mandó; cancelar dice que ya no está vigente, no que no pasó.
 *
 * Re-cancelar se rechaza (el sello de la primera vez es el bueno: el segundo motivo pisaría al que
 * de verdad explicó la cancelación). Requiere `listas.negociar`.
 */
export async function cancelarCotizacion(
  sesion: SesionUsuario,
  id: number,
  entrada: EntradaCancelarCotizacion,
  bd?: ContextoBd,
): Promise<CotizacionDetalle> {
  verificarPermiso(sesion, 'listas.negociar');
  const datos: DatosCotizacionCancelar = validarEntrada(esquemaCotizacionCancelar, entrada);

  await enTransaccion(async (tx) => {
    const actual = await exigirCotizacion(tx, id, sesion.idEmpresaActiva);
    if (actual.estado === ESTADO_CANCELADA) {
      throw new ErrorConflicto(
        `La cotización ${String(actual.folio)} ya estaba cancelada; el motivo original se conserva.`,
      );
    }
    await tx.cotizacion.update({
      where: { id },
      data: {
        estado: ESTADO_CANCELADA,
        motivoCancelacion: datos.motivo,
        canceladaPorId: sesion.id,
        canceladaEn: new Date(),
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Cotizacion',
      idEntidad: id,
      accion: 'CANCELAR',
      datos: { operacion: 'cancelar', folio: Number(actual.folio), motivo: datos.motivo },
    });
  }, bd);

  return obtenerCotizacion(sesion, id, bd);
}

/** Cotización de la EMPRESA ACTIVA (A9) con su estado y folio, o `ErrorNoEncontrado`. */
async function exigirCotizacion(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{ id: number; folio: bigint; estado: string }> {
  const cotizacion = await tx.cotizacion.findFirst({
    where: { id, idEmpresa },
    select: { id: true, folio: true, estado: true },
  });
  if (cotizacion === null) {
    throw new ErrorNoEncontrado('Cotización', id);
  }
  return cotizacion;
}

// ── Lecturas ────────────────────────────────────────────────────────────────────────

/** `include` del LISTADO: sólo los precios congelados (para el total). El encabezado ya es propio. */
const incluirResumen = {
  lineas: { select: { precioUnit: true } },
} satisfies Prisma.CotizacionInclude;

type CotizacionResumenPayload = Prisma.CotizacionGetPayload<{ include: typeof incluirResumen }>;

/** Proyecta una cotización a su resumen de listado (sin renglones; con conteo y total). */
function aResumen(cotizacion: CotizacionResumenPayload, verImportes: boolean): CotizacionResumen {
  return {
    id: cotizacion.id,
    folio: Number(cotizacion.folio),
    idLista: cotizacion.idLista,
    // Mismo criterio que el detalle: columnas congeladas, nunca la lista (que pudo desaparecer).
    folioLista: Number(cotizacion.folioLista),
    idCliente: cotizacion.idCliente,
    nombreCliente: cotizacion.nombreCliente,
    nombreDepartamento: cotizacion.nombreDepartamento,
    fecha: aFechaCorta(cotizacion.fecha),
    estado: cotizacion.estado,
    totalRenglones: cotizacion.lineas.length,
    total: verImportes
      ? redondear2(cotizacion.lineas.reduce((acc, l) => acc + num(l.precioUnit), 0))
      : null,
    creadoEn: cotizacion.creadoEn.toISOString(),
  };
}

/**
 * LISTA las cotizaciones de la empresa activa (A9), más nueva primero, con filtros opcionales por
 * lista/cliente/estado y rango de fechas. Requiere `listas.ver`.
 */
export async function listarCotizaciones(
  sesion: SesionUsuario,
  filtros: FiltrosCotizaciones = {},
  bd?: ContextoBd,
): Promise<CotizacionResumen[]> {
  verificarPermiso(sesion, 'listas.ver');
  const fecha: Prisma.DateTimeFilter = {};
  if (filtros.desde !== undefined) {
    fecha.gte = new Date(filtros.desde);
  }
  if (filtros.hasta !== undefined) {
    fecha.lte = new Date(filtros.hasta);
  }
  const cotizaciones = await clienteLectura(bd).cotizacion.findMany({
    where: {
      idEmpresa: sesion.idEmpresaActiva,
      ...(filtros.idLista === undefined ? {} : { idLista: filtros.idLista }),
      ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
      ...(filtros.estado === undefined ? {} : { estado: filtros.estado }),
      ...(filtros.desde === undefined && filtros.hasta === undefined ? {} : { fecha }),
    },
    orderBy: { folio: 'desc' },
    include: incluirResumen,
  });
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  return cotizaciones.map((c) => aResumen(c, verImportes));
}

/** Obtiene una cotización completa (con sus renglones congelados) de la empresa activa (A9). */
export async function obtenerCotizacion(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<CotizacionDetalle> {
  verificarPermiso(sesion, 'listas.ver');
  const cotizacion = await clienteLectura(bd).cotizacion.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: incluirCotizacion,
  });
  if (cotizacion === null) {
    throw new ErrorNoEncontrado('Cotización', id);
  }
  return aCotizacionSalida(cotizacion, tienePermiso(sesion, 'consultas.ver-importes'));
}
