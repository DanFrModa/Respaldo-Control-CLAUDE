/**
 * TECH PACK / ADJUNTOS del DESARROLLO (rediseño R5, B16) — PDFs de referencia y fotos de muestra en
 * Cloudflare R2, ligados a UN desarrollo por la tabla puente `DesarrolloArchivo` (espejo EXACTO de
 * `adjuntos-orden.ts`). Toda la lógica AQUÍ (A1); las rutas sólo validan permiso + Zod y delegan.
 * Tres operaciones, con el flujo presigned del motor de F0 (A5):
 *
 *  1. `solicitarSubidaAdjunto` — exige el desarrollo (de la empresa activa, A9, vía proyecto→empresa) y
 *     `desarrollo.administrar`, crea el `Archivo` vía R2 (carpeta `desarrollos/<id>` — key ORDENADA por
 *     id, A5), liga `DesarrolloArchivo`, registra bitácora y devuelve la URL PUT prefirmada (UNA tx, A2).
 *  2. `listarAdjuntos` — `desarrollo.ver`, desarrollo de la empresa activa (A9); cada adjunto con su URL
 *     GET prefirmada (nombre de descarga = original), ordenados por antigüedad.
 *  3. `eliminarAdjunto` — `desarrollo.administrar`; borra el `Archivo` (Cascade arrastra el puente) +
 *     bitácora en UNA tx (A2) y, TRAS el commit, borra el OBJETO físico de R2 en modo BEST-EFFORT (ya
 *     no queda huérfano; misma garantía que `adjuntos-orden.ts`).
 *
 * El servicio de archivos se INYECTA (default `servicioArchivos()` lazy) para pasar un fake en tests
 * sin R2 real. Reusa el RBAC de desarrollo, sin permisos nuevos.
 */
import {
  esquemaDesarrolloAdjuntoCrear,
  type DatosDesarrolloAdjuntoCrear,
} from '../../contrato/index.js';

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

/** Carpeta R2 de los adjuntos de desarrollo (la key real se ordena por id, no por nombre, A5). */
const CARPETA_ADJUNTOS = 'desarrollos';

/** Resultado de preparar la subida de un adjunto (registro + URL PUT prefirmada). */
export interface SubidaAdjuntoDesarrollo {
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Un adjunto de un desarrollo con su URL de descarga prefirmada. */
export interface AdjuntoDesarrolloConUrl {
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

/** Exige que el desarrollo exista y sea de la empresa activa (A9, vía proyecto→empresa). */
async function exigirDesarrolloDeEmpresa(
  tx: Tx,
  idDesarrollo: number,
  idEmpresa: number,
): Promise<void> {
  const desarrollo = await tx.desarrollo.findFirst({
    where: { id: idDesarrollo, proyecto: { idEmpresa } },
    select: { id: true },
  });
  if (desarrollo === null) {
    throw new ErrorNoEncontrado('Desarrollo', idDesarrollo);
  }
}

/**
 * Prepara la subida de un adjunto del desarrollo (B16) en UNA transacción (A2): exige el desarrollo
 * (empresa activa, A9) y `desarrollo.administrar`, crea el `Archivo` vía el motor de R2 (carpeta
 * `desarrollos/<id>`, key ordenada por id — A5), liga `DesarrolloArchivo`, registra bitácora y
 * devuelve la URL PUT prefirmada. El servicio de archivos se inyecta (default lazy) para tests sin R2.
 */
export async function solicitarSubidaAdjunto(
  sesion: SesionUsuario,
  idDesarrollo: number,
  entrada: DatosDesarrolloAdjuntoCrear,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaAdjuntoDesarrollo> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const datos = validarEntrada(esquemaDesarrolloAdjuntoCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    await exigirDesarrolloDeEmpresa(tx, idDesarrollo, idEmpresa);

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_ADJUNTOS}/${idDesarrollo}`,
    });

    await tx.desarrolloArchivo.create({
      data: {
        idDesarrollo,
        idArchivo: subida.archivo.id,
        creadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Desarrollo',
      idEntidad: idDesarrollo,
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
 * Lista los adjuntos de un desarrollo (B16), cada uno con su URL GET prefirmada (nombre de descarga =
 * original). Requiere `desarrollo.ver`. Exige que el desarrollo exista y sea de la empresa activa (A9).
 */
export async function listarAdjuntos(
  sesion: SesionUsuario,
  idDesarrollo: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<AdjuntoDesarrolloConUrl[]> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const desarrollo = await cliente.desarrollo.findFirst({
    where: { id: idDesarrollo, proyecto: { idEmpresa } },
    select: { id: true },
  });
  if (desarrollo === null) {
    throw new ErrorNoEncontrado('Desarrollo', idDesarrollo);
  }

  const adjuntos = await cliente.desarrolloArchivo.findMany({
    where: { idDesarrollo },
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
 * Quita un adjunto del desarrollo (B16): borra el `Archivo` (Cascade arrastra el `DesarrolloArchivo`) +
 * bitácora en UNA transacción (A2) y, TRAS el commit, borra el OBJETO físico de R2 en modo BEST-EFFORT.
 * Si R2 falla NO revierte el borrado del registro. Requiere `desarrollo.administrar`. Si el adjunto no
 * pertenece a ese desarrollo (o el desarrollo no es de la empresa activa, A9) → `ErrorNoEncontrado`.
 *
 * ⚠️ Llamar SIEMPRE a NIVEL SUPERIOR (misma garantía best-effort que `adjuntos-orden.ts`): el borrado
 * físico de R2 corre DESPUÉS del commit; no anidar en una transacción externa.
 */
export async function eliminarAdjunto(
  sesion: SesionUsuario,
  idDesarrollo: number,
  idArchivo: string,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<void> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  const keyR2 = await enTransaccion(async (tx) => {
    await exigirDesarrolloDeEmpresa(tx, idDesarrollo, idEmpresa);

    const adjunto = await tx.desarrolloArchivo.findFirst({
      where: { idDesarrollo, idArchivo },
      include: { archivo: { select: { key: true, nombreOriginal: true } } },
    });
    if (adjunto === null) {
      throw new ErrorNoEncontrado('Adjunto del desarrollo', idArchivo);
    }

    // Borrar el Archivo arrastra el DesarrolloArchivo (onDelete Cascade); un solo paso.
    await tx.archivo.delete({ where: { id: idArchivo } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Desarrollo',
      idEntidad: idDesarrollo,
      accion: 'MODIFICAR',
      datos: { adjunto: 'quitar', archivo: adjunto.archivo.nombreOriginal },
    });

    return adjunto.archivo.key;
  }, bd);

  // Best-effort: el registro ya se borró; si R2 falla, a lo sumo el objeto queda huérfano.
  try {
    await archivos.eliminarObjeto(keyR2);
  } catch (error) {
    console.warn(
      `No se pudo borrar el objeto R2 "${keyR2}" del adjunto del desarrollo ${idDesarrollo}.`,
      error,
    );
  }
}
