/**
 * ADJUNTOS de la orden de producción (F8-E6, R6) — archivos de apoyo (Excel/PDF/imágenes) en
 * Cloudflare R2, ligados a UNA orden por la tabla puente `OrdenArchivo` (espejo de `ProveedorArchivo`,
 * sin `tipo`). Toda la lógica AQUÍ (A1); las rutas sólo validan permiso + Zod y delegan. Tres
 * operaciones, con el flujo presigned del motor de F0 (A5):
 *
 *  1. `solicitarSubidaAdjunto` — exige la orden (de la empresa activa, A9) y `ordenes.administrar`,
 *     crea el `Archivo` vía R2 (carpeta `ordenes/<id>` — key ORDENADA por id, NO por nombre, A5),
 *     liga `OrdenArchivo`, registra bitácora y devuelve la URL PUT prefirmada (todo en UNA
 *     transacción, A2). Si el PUT del navegador fallara, el registro apunta a una key sin objeto
 *     (su `urlDescarga` daría 404; inofensivo, el usuario reintenta o lo quita).
 *  2. `listarAdjuntos` — `ordenes.ver`, orden de la empresa activa (A9); cada adjunto con su URL GET
 *     prefirmada (nombre de descarga = original), ordenados por antigüedad.
 *  3. `eliminarAdjunto` — `ordenes.administrar`; borra el `Archivo` (Cascade arrastra el
 *     `OrdenArchivo`) + bitácora en UNA transacción (A2) y, TRAS el commit, borra el OBJETO físico de
 *     R2 en modo BEST-EFFORT (salda la deuda técnica §8: ya no queda huérfano). Si R2 falla NO
 *     revierte el borrado del registro (a lo sumo el objeto queda huérfano, el estado anterior): se
 *     loguea y sigue.
 *
 * El servicio de archivos se INYECTA (default `servicioArchivos()` lazy) para pasar un fake en tests
 * sin R2 real (igual que fotos-modelo/proveedores). Permiso `ordenes.ver` para leer, `ordenes.administrar`
 * para mutar (reusa el RBAC de órdenes, sin permisos nuevos).
 */
import { esquemaOrdenAdjuntoCrear, type DatosOrdenAdjuntoCrear } from '../../contrato/index.js';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../comun/nombres-usuario.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Carpeta R2 de los adjuntos de órdenes (la key real se ordena por id, no por nombre, A5). */
const CARPETA_ADJUNTOS = 'ordenes';

/** Resultado de preparar la subida de un adjunto (registro + URL PUT prefirmada). */
export interface SubidaAdjuntoOrden {
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Un adjunto de una orden con su URL de descarga prefirmada. */
export interface AdjuntoOrdenConUrl {
  idArchivo: string;
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
  urlDescarga: string;
  subidoPorId: string | null;
  /** Nombre de quien lo subió; null si el id no resuelve (el adjunto se sigue viendo). */
  nombreSubidoPor: string | null;
  creadoEn: Date;
}

/** Exige que la orden exista y sea de la empresa activa (A9), o lanza `ErrorNoEncontrado`. */
async function exigirOrdenDeEmpresa(tx: Tx, idOrden: number, idEmpresa: number): Promise<void> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { id: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
}

/**
 * Prepara la subida de un adjunto de la orden (R6) en UNA transacción (A2): exige la orden (empresa
 * activa, A9) y `ordenes.administrar`, crea el `Archivo` vía el motor de R2 (carpeta `ordenes/<id>`,
 * key ordenada por id — A5), liga `OrdenArchivo`, registra bitácora y devuelve la URL PUT prefirmada.
 * El servicio de archivos se inyecta (default `servicioArchivos()` lazy) para tests sin R2.
 */
export async function solicitarSubidaAdjunto(
  sesion: SesionUsuario,
  idOrden: number,
  entrada: DatosOrdenAdjuntoCrear,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaAdjuntoOrden> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaOrdenAdjuntoCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    await exigirOrdenDeEmpresa(tx, idOrden, idEmpresa);

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_ADJUNTOS}/${idOrden}`,
    });

    await tx.ordenArchivo.create({
      data: {
        idOrden,
        idArchivo: subida.archivo.id,
        creadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'MODIFICAR',
      datos: { adjunto: 'agregar', archivo: datos.nombreOriginal },
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
 * Lista los adjuntos de una orden (R6), cada uno con su URL GET prefirmada para verlo/descargarlo
 * (nombre de descarga = original). Requiere `ordenes.ver`. Exige que la orden exista y sea de la
 * empresa activa (A9).
 */
export async function listarAdjuntos(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<AdjuntoOrdenConUrl[]> {
  verificarPermiso(sesion, 'ordenes.ver');
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { id: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const adjuntos = await cliente.ordenArchivo.findMany({
    where: { idOrden },
    orderBy: { creadoEn: 'asc' },
    include: {
      archivo: {
        select: {
          id: true,
          key: true,
          nombreOriginal: true,
          tipoMime: true,
          tamanoBytes: true,
          subidoPorId: true,
        },
      },
    },
  });

  // Los nombres de quienes subieron, en UNA consulta para todos los adjuntos (nunca uno por fila).
  const nombrePorId = await nombresDeUsuarios(
    cliente,
    adjuntos.map((a) => a.archivo.subidoPorId),
  );

  return Promise.all(
    adjuntos.map(async (adjunto) => ({
      idArchivo: adjunto.archivo.id,
      nombreOriginal: adjunto.archivo.nombreOriginal,
      tipoMime: adjunto.archivo.tipoMime,
      tamanoBytes: adjunto.archivo.tamanoBytes,
      urlDescarga: await archivos.urlDescarga(adjunto.archivo.key, {
        nombreDescarga: adjunto.archivo.nombreOriginal,
      }),
      subidoPorId: adjunto.archivo.subidoPorId,
      nombreSubidoPor: nombreDeUsuario(nombrePorId, adjunto.archivo.subidoPorId),
      creadoEn: adjunto.creadoEn,
    })),
  );
}

/**
 * Quita un adjunto de la orden (R6): borra el `Archivo` (Cascade arrastra el `OrdenArchivo`) +
 * bitácora en UNA transacción (A2) y, TRAS el commit, borra el OBJETO físico de R2 en modo
 * BEST-EFFORT (ya no queda huérfano; salda la deuda técnica §8). Si R2 falla NO revierte el borrado
 * del registro: se loguea y sigue. Requiere `ordenes.administrar`. Si el adjunto no pertenece a esa
 * orden (o la orden no es de la empresa activa, A9) → `ErrorNoEncontrado`.
 *
 * ⚠️ Llamar SIEMPRE a NIVEL SUPERIOR (sin pasar un `bd.tx` ya abierto): el borrado físico de R2 corre
 * DESPUÉS del commit de esta función. Si se compusiera dentro de una transacción externa, el
 * `eliminarObjeto` se ejecutaría antes del commit real y un rollback del llamador dejaría el objeto de
 * R2 borrado pero el registro vivo. Hoy no hay llamadores anidados (solo la ruta); no introducir uno
 * sin repensar esta garantía best-effort.
 */
export async function eliminarAdjunto(
  sesion: SesionUsuario,
  idOrden: number,
  idArchivo: string,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<void> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  // La key del objeto R2 se captura DENTRO de la tx para borrarlo best-effort tras el commit.
  const keyR2 = await enTransaccion(async (tx) => {
    await exigirOrdenDeEmpresa(tx, idOrden, idEmpresa);

    const adjunto = await tx.ordenArchivo.findFirst({
      where: { idOrden, idArchivo },
      include: { archivo: { select: { key: true, nombreOriginal: true } } },
    });
    if (adjunto === null) {
      throw new ErrorNoEncontrado('Adjunto de la orden', idArchivo);
    }

    // Borrar el Archivo arrastra el OrdenArchivo (onDelete Cascade); un solo paso evita un huérfano
    // de registro si algo fallara entre ambos borrados.
    await tx.archivo.delete({ where: { id: idArchivo } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'MODIFICAR',
      datos: { adjunto: 'quitar', archivo: adjunto.archivo.nombreOriginal },
    });

    return adjunto.archivo.key;
  }, bd);

  // Best-effort: el registro ya se borró; si R2 falla, a lo sumo el objeto queda huérfano (el estado
  // anterior a este fix). NUNCA propaga el error ni revierte el borrado del registro.
  try {
    await archivos.eliminarObjeto(keyR2);
  } catch (error) {
    console.warn(
      `No se pudo borrar el objeto R2 "${keyR2}" del adjunto de la orden ${idOrden}.`,
      error,
    );
  }
}
