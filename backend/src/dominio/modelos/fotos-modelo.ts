/**
 * Fotos del modelo (F1-E4, R2) — N fotos por modelo en Cloudflare R2 (doc
 * `Documentacion_MJD/01-Modelos.md` §6: corrige las fotos por convención de nombre en `S:\`
 * del viejo). Cada foto es un `Archivo` (motor de F0) ligado al modelo por `ModeloFoto` con su
 * `tipo` (FRENTE/ESPALDA/OTRO) y `orden` de despliegue.
 *
 * A diferencia del bordado (UNA foto = FK directa), aquí son VARIAS, así que es una tabla
 * puente (como los adjuntos del proveedor en E1B). El flujo es presigned (A5):
 *  • `solicitarSubidaFoto` crea el `Archivo` (key ORDENADA por id del modelo —
 *    `modelos/<id>/...`, NUNCA por nombre, A5), crea el `ModeloFoto` y devuelve la URL PUT
 *    prefirmada para que el navegador suba DIRECTO a R2 (todo en UNA transacción, A2).
 *  • `listarFotos` devuelve cada foto con su URL GET prefirmada (ordenadas por `orden`, luego id).
 *  • `actualizarFoto` cambia tipo/orden de una foto (sin tocar la imagen).
 *  • `quitarFoto` borra el `Archivo` (Cascade arrastra el `ModeloFoto`) en UNA transacción (A2).
 * El servicio de archivos se INYECTA (default `servicioArchivos()` lazy) para poder pasar un
 * fake en tests sin R2 real (igual que bordados/proveedores). Permiso `modelos.ver` para leer,
 * `modelos.administrar` para mutar (A4).
 */
import {
  esquemaModeloFotoCrear,
  esquemaModeloFotoEditarCuerpo,
} from '../../contrato/esquemas/modelo.js';
import type { ModeloFoto } from '../../datos/index.js';
import type { z } from 'zod';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { exigirModelo } from './modelos.js';

/** Carpeta R2 de las fotos de modelos (la key real se ordena por id, no por nombre, A5). */
const CARPETA_FOTOS = 'modelos';

/** Solicitud de subida tal como LLEGA (tipo opcional; el dominio aplica el default OTRO). */
export type EntradaSubirFoto = z.input<typeof esquemaModeloFotoCrear>;
/** Edición de metadatos de foto tal como llega (tipo/orden opcionales). */
export type EntradaEditarFoto = z.input<typeof esquemaModeloFotoEditarCuerpo>;

/** Resultado de preparar la subida de una foto (registro + URL PUT prefirmada). */
export interface SubidaFotoModelo {
  idFoto: number;
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Una foto de un modelo con su URL de descarga prefirmada. */
export interface FotoModeloConUrl {
  idFoto: number;
  idArchivo: string;
  tipo: ModeloFoto['tipo'];
  orden: number;
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
  urlDescarga: string;
}

/** Busca una foto por id Y que pertenezca al modelo, o lanza `ErrorNoEncontrado`. */
async function exigirFotoDelModelo(tx: Tx, idModelo: number, idFoto: number): Promise<ModeloFoto> {
  const foto = await tx.modeloFoto.findFirst({ where: { id: idFoto, idModelo } });
  if (foto === null) {
    throw new ErrorNoEncontrado('Foto del modelo', idFoto);
  }
  return foto;
}

/**
 * Prepara la subida de UNA foto de un modelo (R2) en UNA transacción (A2): exige el modelo y
 * el permiso `modelos.administrar`, crea el `Archivo` vía el motor de R2 (carpeta
 * `modelos/<id>` — key ORDENADA por id, NO por nombre, A5), crea el `ModeloFoto` (con tipo y
 * `orden` al final por defecto) y devuelve la URL PUT prefirmada para que el navegador suba
 * DIRECTO a R2. Si el PUT del navegador fallara, el `Archivo`/`ModeloFoto` referencian una key
 * sin objeto y su `urlDescarga` daría 404 (inofensivo; el usuario reintenta o la quita).
 *
 * El servicio de archivos se inyecta (default `servicioArchivos()` lazy) para tests sin R2.
 */
export async function solicitarSubidaFoto(
  sesion: SesionUsuario,
  idModelo: number,
  entrada: EntradaSubirFoto,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaFotoModelo> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloFotoCrear, entrada);

  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);

    // `orden` por defecto: al final (máximo actual + 1).
    const ultima = await tx.modeloFoto.findFirst({
      where: { idModelo },
      orderBy: { orden: 'desc' },
      select: { orden: true },
    });
    const orden = (ultima?.orden ?? -1) + 1;

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_FOTOS}/${idModelo}`,
    });

    const foto = await tx.modeloFoto.create({
      data: {
        idModelo,
        idArchivo: subida.archivo.id,
        tipo: datos.tipo,
        orden,
        creadoPorId: sesion.id,
      },
    });

    // Deja constancia de quién/cuándo en el modelo (A7) y en la bitácora.
    await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idModelo,
      accion: 'MODIFICAR',
      datos: { foto: 'agregar', tipo: datos.tipo, archivo: datos.nombreOriginal },
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
 * Lectura de BAJO NIVEL de las fotos de un modelo (findMany + URLs GET prefirmadas), ordenadas por
 * `orden` (luego por id). NO verifica permiso ni sesión: el llamador es responsable de autorizar.
 * Exige que el modelo exista. La usan `listarFotos` (tras `modelos.ver`) y el IMPRESO de la orden
 * (autorizado por `ordenes.ver`, ver `dominio/produccion/impresos/impreso-orden.ts`).
 */
export async function leerFotosModelo(
  idModelo: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<FotoModeloConUrl[]> {
  const cliente = clienteLectura(bd);
  const modelo = await cliente.modelo.findUnique({ where: { id: idModelo }, select: { id: true } });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }

  const fotos = await cliente.modeloFoto.findMany({
    where: { idModelo },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    include: {
      archivo: {
        select: { id: true, key: true, nombreOriginal: true, tipoMime: true, tamanoBytes: true },
      },
    },
  });

  return Promise.all(
    fotos.map(async (foto) => ({
      idFoto: foto.id,
      idArchivo: foto.archivo.id,
      tipo: foto.tipo,
      orden: foto.orden,
      nombreOriginal: foto.archivo.nombreOriginal,
      tipoMime: foto.archivo.tipoMime,
      tamanoBytes: foto.archivo.tamanoBytes,
      urlDescarga: await archivos.urlDescarga(foto.archivo.key),
    })),
  );
}

/**
 * Lista las fotos de un modelo, cada una con su URL GET prefirmada para verla, ordenadas por
 * `orden` (luego por id). Requiere `modelos.ver`. Exige que el modelo exista.
 */
export async function listarFotos(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<FotoModeloConUrl[]> {
  verificarPermiso(sesion, 'modelos.ver');
  return leerFotosModelo(idModelo, bd, archivos);
}

/**
 * Actualiza los metadatos de UNA foto (tipo y/o orden) en UNA transacción (A2). No reemplaza la
 * imagen (eso es subir una foto nueva y quitar la vieja). Requiere `modelos.administrar`. Si la
 * foto no pertenece al modelo → `ErrorNoEncontrado`. Si no cambia nada, es idempotente.
 */
export async function actualizarFoto(
  sesion: SesionUsuario,
  idModelo: number,
  idFoto: number,
  entrada: EntradaEditarFoto,
  bd?: ContextoBd,
): Promise<ModeloFoto> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloFotoEditarCuerpo, entrada);

  return enTransaccion(async (tx) => {
    const actual = await exigirFotoDelModelo(tx, idModelo, idFoto);

    const cambiaTipo = datos.tipo !== undefined && datos.tipo !== actual.tipo;
    const cambiaOrden = datos.orden !== undefined && datos.orden !== actual.orden;
    if (!cambiaTipo && !cambiaOrden) {
      return actual; // idempotente, sin bitácora vacía
    }

    const foto = await tx.modeloFoto.update({
      where: { id: idFoto },
      data: {
        ...(cambiaTipo && datos.tipo !== undefined ? { tipo: datos.tipo } : {}),
        ...(cambiaOrden && datos.orden !== undefined ? { orden: datos.orden } : {}),
      },
    });
    await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idModelo,
      accion: 'MODIFICAR',
      datos: {
        foto: 'editar',
        idFoto,
        ...(cambiaTipo ? { tipo: { de: actual.tipo, a: foto.tipo } } : {}),
        ...(cambiaOrden ? { orden: { de: actual.orden, a: foto.orden } } : {}),
      },
    });

    return foto;
  }, bd);
}

/**
 * Quita UNA foto del modelo (R2) en UNA transacción (A2): borra el `Archivo` (el `onDelete
 * Cascade` arrastra el `ModeloFoto`); hacerlo en un solo paso evita un huérfano. El objeto R2
 * huérfano es inofensivo (lo documenta `comun/archivos.ts`). Requiere `modelos.administrar`. Si
 * la foto no pertenece al modelo → `ErrorNoEncontrado`.
 */
export async function quitarFoto(
  sesion: SesionUsuario,
  idModelo: number,
  idFoto: number,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    const foto = await exigirFotoDelModelo(tx, idModelo, idFoto);

    // Borrar el Archivo arrastra el ModeloFoto (onDelete Cascade).
    await tx.archivo.delete({ where: { id: foto.idArchivo } });
    await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idModelo,
      accion: 'MODIFICAR',
      datos: { foto: 'quitar', idFoto },
    });
  }, bd);
}
