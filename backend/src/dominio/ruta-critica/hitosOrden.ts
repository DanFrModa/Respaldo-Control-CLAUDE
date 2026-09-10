/**
 * HITOS de una orden (cierre del hueco de EMISORES de la RC, post-F9). Varios procesos que Daniel
 * dictó AUTOMÁTICOS (§4.9 "auto-completado por evento") no nacen de un hecho estructurado de v2
 * (recepción de tela, corte, recibo, auditoría…): la revisión de la OP, la autorización de fit, de
 * tono de tela, de avíos, el empaque y la autorización de arte. Un HITO es ese hecho: un acto puntual
 * que se captura A MANO en el detalle de la orden y que —vía el evento `hito-orden-resuelto`—
 * auto-completa el proceso RC ligado (mismo motor de auto-avance que corte/recibo, `autoAvance.ts`).
 *
 * Toda la lógica vive AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan. Innegociables:
 *  • A2 — alta/cancelación (hito + bitácora + evento outbox) en UNA transacción (`enTransaccion`).
 *  • A7 — bitácora uniforme en cada escritura (registro/cancelación).
 *  • A9 — todo se filtra/sella por la empresa ACTIVA de la sesión (un hito de otra empresa no existe).
 *  • D3 — cancelación SUAVE: nunca se borra ni se edita destructivo. Un hito cancelado deja de contar
 *    y se puede re-registrar. El índice UNIQUE PARCIAL `hito_orden_vivo_unico` (en la migración) es la
 *    defensa en profundidad del `ErrorConflicto` de "un hito vivo por orden+tipo".
 *  • RBAC (A4) — `rc.capturar` para registrar/cancelar (es una captura de avance de RC);
 *    `rc.ruta-ver` para listar (es ver el estado de la RC de la orden, como la vista de su ruta).
 *
 * Integración RC: al registrar/cancelar se publica `hito-orden-resuelto` al OUTBOX (misma tx); el
 * auto-avance re-evalúa el proceso ligado al tipo de hito y lo auto-completa o des-completa
 * (idempotente: relee el estado físico "¿hay un hito vivo de ese tipo?", decisión (f) de F5-E6).
 */
import { TipoEventoProceso, type Prisma, type TipoHitoOrden } from '../../datos/index.js';
import {
  esquemaCancelarHitoCuerpo,
  esquemaRegistrarHitoCuerpo,
  type DatosCancelarHito,
  type DatosRegistrarHito,
  type HitoOrdenSalida,
  type HitosOrdenSalida,
} from '../../contrato/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import {
  EVENTOS_OUTBOX,
  VERSION_HITO_ORDEN,
  registrarEventoOutbox,
  type EventoHitoOrden,
} from '../../comun/eventos-dominio.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../comun/nombres-usuario.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Nombre del índice UNIQUE PARCIAL "un hito vivo por orden+tipo" (creado a mano en la migración). */
const INDICE_HITO_VIVO_UNICO = 'hito_orden_vivo_unico';

/**
 * Mapea un tipo de HITO al `TipoEventoProceso` del proceso RC que auto-completa. PURO (sin BD):
 * unit-testeable. `arte` → `autorizacionArte` cierra el proceso `autorizacion-arte`, que YA era
 * automático pero NADIE emitía su evento (este mapeo lo cierra).
 */
export function tipoEventoDeHito(tipo: TipoHitoOrden): TipoEventoProceso {
  switch (tipo) {
    case 'revisionOp':
      return TipoEventoProceso.revisionOp;
    case 'fit':
      return TipoEventoProceso.autorizacionFit;
    case 'tonoTela':
      return TipoEventoProceso.autorizacionTono;
    case 'avios':
      return TipoEventoProceso.autorizacionAvios;
    case 'empaque':
      return TipoEventoProceso.empaque;
    case 'arte':
      return TipoEventoProceso.autorizacionArte;
  }
}

/** Convierte un `@db.Date` a `YYYY-MM-DD`. */
function aFechaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Convierte un `YYYY-MM-DD` (o undefined → hoy) al `Date` que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string | undefined): Date {
  const iso = valor ?? new Date().toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00.000Z`);
}

/** `select` de un hito para proyectar a la salida del contrato. */
const seleccionHito = {
  id: true,
  idOrden: true,
  tipo: true,
  registradoPorId: true,
  fecha: true,
  creadoEn: true,
} satisfies Prisma.HitoOrdenSelect;

type HitoBd = Prisma.HitoOrdenGetPayload<{ select: typeof seleccionHito }>;

/**
 * Proyecta un hito (con detalle) a la forma JSON del contrato.
 *
 * `nombrePorId` llega YA RESUELTO del llamador: `HitoOrden.registradoPorId` no tiene FK física (es
 * un registro inmutable), así que el nombre se busca en bloque una sola vez para todos los hitos de
 * la orden. Un id que no resuelve sale con `nombreRegistradoPor: null` y el hito se sigue viendo.
 */
function aHitoSalida(h: HitoBd, nombrePorId: ReadonlyMap<string, string>): HitoOrdenSalida {
  return {
    id: h.id,
    idOrden: h.idOrden,
    tipo: h.tipo,
    registradoPorId: h.registradoPorId,
    nombreRegistradoPor: nombreDeUsuario(nombrePorId, h.registradoPorId),
    fecha: aFechaIso(h.fecha),
    creadoEn: h.creadoEn.toISOString(),
  };
}

/**
 * Exige que la orden exista y sea de la empresa activa (A9), o lanza `ErrorNoEncontrado` (una orden de
 * otra empresa, para esta sesión, no existe). Devuelve su id (confirmado).
 */
async function exigirOrden(tx: Tx, idOrden: number, idEmpresa: number): Promise<void> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { id: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
}

/**
 * Lista los hitos VIVOS (no cancelados) de una orden (`rc.ruta-ver`), en orden estable (por tipo,
 * luego id). A9: verifica que la orden sea de la empresa activa. La UI muestra un renglón por tipo de
 * hito, con su hito vivo (si existe) o "pendiente".
 */
export async function listarHitosOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<HitosOrdenSalida> {
  verificarPermiso(sesion, 'rc.ruta-ver');
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { id: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  const hitos = await cliente.hitoOrden.findMany({
    where: { idOrden, idEmpresa, canceladoEn: null },
    select: seleccionHito,
    orderBy: [{ tipo: 'asc' }, { id: 'asc' }],
  });
  const nombrePorId = await nombresDeUsuarios(
    cliente,
    hitos.map((h) => h.registradoPorId),
  );
  return hitos.map((h) => aHitoSalida(h, nombrePorId));
}

/** Mensaje único de "ya hay un hito vivo de este tipo" (lo comparten el check y el backstop del índice). */
function mensajeHitoDuplicado(tipo: string): string {
  return `La orden ya tiene un hito vivo del tipo "${tipo}".`;
}

/**
 * ¿El error es la violación del índice UNIQUE PARCIAL `hito_orden_vivo_unico` ("un hito vivo por
 * orden+tipo")? Chequeo ESPECÍFICO (no un catch-all): exige el código P2002 Y que el `meta.target`
 * del error apunte a ESE índice. Así, otra violación de unicidad (si algún día se agrega otro unique a
 * la tabla) NO se traga como si fuera un hito duplicado. El `target` del índice parcial —creado en SQL
 * crudo, no modelado por Prisma— viaja como el NOMBRE del índice (string o arreglo, según versión).
 */
function esViolacionHitoVivoUnico(error: unknown): boolean {
  if (codigoErrorPrisma(error) !== CODIGO_PRISMA.unicidad) return false;
  const objetivo = (error as { meta?: { target?: unknown } }).meta?.target;
  if (typeof objetivo === 'string') {
    return objetivo.includes(INDICE_HITO_VIVO_UNICO);
  }
  if (Array.isArray(objetivo)) {
    return objetivo.some((t) => typeof t === 'string' && t.includes(INDICE_HITO_VIVO_UNICO));
  }
  return false;
}

/**
 * Registra un HITO en una orden (`rc.capturar`) en UNA transacción (A2). Valida la orden (A9) y que no
 * haya YA un hito vivo del mismo tipo (`ErrorConflicto`). El check secuencial cubre el caso normal; una
 * CARRERA real (dos registros del mismo tipo a la vez) la ataja el índice parcial `hito_orden_vivo_unico`
 * (P2002), que se traduce al MISMO `ErrorConflicto` (409, no 500). Bitácora A7 + evento
 * `hito-orden-resuelto` al outbox (misma tx) para que el auto-avance complete el proceso RC.
 */
export async function registrarHito(
  sesion: SesionUsuario,
  idOrden: number,
  entrada: DatosRegistrarHito,
  bd?: ContextoBd,
): Promise<HitosOrdenSalida> {
  verificarPermiso(sesion, 'rc.capturar');
  const datos = validarEntrada(esquemaRegistrarHitoCuerpo, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  try {
    await enTransaccion(async (tx) => {
      await exigirOrden(tx, idOrden, idEmpresa);

      const vivo = await tx.hitoOrden.findFirst({
        where: { idOrden, idEmpresa, tipo: datos.tipo, canceladoEn: null },
        select: { id: true },
      });
      if (vivo !== null) {
        throw new ErrorConflicto(mensajeHitoDuplicado(datos.tipo));
      }

      const hito = await tx.hitoOrden.create({
        data: {
          idEmpresa,
          idOrden,
          tipo: datos.tipo,
          registradoPorId: sesion.id,
          fecha: aDateColumna(datos.fecha),
          ...datosCreacion(sesion),
        },
        select: { id: true },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'HitoOrden',
        idEntidad: hito.id,
        accion: 'CREAR',
        datos: { idOrden, tipo: datos.tipo, fecha: aFechaIso(aDateColumna(datos.fecha)) },
      });

      const payload: EventoHitoOrden = { idEmpresa, idOrden, tipo: datos.tipo };
      await registrarEventoOutbox(
        tx,
        EVENTOS_OUTBOX.hitoOrdenResuelto,
        VERSION_HITO_ORDEN,
        idEmpresa,
        payload,
      );
    }, bd);
  } catch (error) {
    // Carrera concurrente: el índice parcial disparó P2002 → mismo conflicto que el check secuencial.
    if (esViolacionHitoVivoUnico(error)) {
      throw new ErrorConflicto(mensajeHitoDuplicado(datos.tipo));
    }
    throw error;
  }

  dispararPublicacion();
  return listarHitosOrden(sesion, idOrden, bd);
}

/**
 * Cancela un HITO (cancelación SUAVE, D3 — `rc.capturar`) en UNA transacción (A2). El hito debe ser de
 * la orden `idOrden` y de la empresa activa (A9). Cancelar dos veces es conflicto. Sella
 * `canceladoEn`/`canceladoPorId`/`motivoCancelacion` (motivo obligatorio) + bitácora A7 + evento
 * `hito-orden-resuelto` (misma tx) para que el auto-avance DES-complete el proceso RC (decisión (f)).
 */
export async function cancelarHito(
  sesion: SesionUsuario,
  idOrden: number,
  idHito: number,
  cuerpo: DatosCancelarHito,
  bd?: ContextoBd,
): Promise<HitosOrdenSalida> {
  verificarPermiso(sesion, 'rc.capturar');
  const datos = validarEntrada(esquemaCancelarHitoCuerpo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const hito = await tx.hitoOrden.findFirst({
      where: { id: idHito, idOrden, idEmpresa },
      select: { id: true, tipo: true, canceladoEn: true },
    });
    if (hito === null) {
      throw new ErrorNoEncontrado('HitoOrden', idHito);
    }
    if (hito.canceladoEn !== null) {
      throw new ErrorConflicto('El hito ya está cancelado.');
    }

    await tx.hitoOrden.update({
      where: { id: idHito },
      data: {
        canceladoEn: new Date(),
        canceladoPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'HitoOrden',
      idEntidad: idHito,
      accion: 'CANCELAR',
      datos: { idOrden, tipo: hito.tipo, motivo: datos.motivo },
    });

    const payload: EventoHitoOrden = { idEmpresa, idOrden, tipo: hito.tipo };
    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.hitoOrdenResuelto,
      VERSION_HITO_ORDEN,
      idEmpresa,
      payload,
    );
  }, bd);

  dispararPublicacion();
  return listarHitosOrden(sesion, idOrden, bd);
}
