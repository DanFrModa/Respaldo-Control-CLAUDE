/**
 * ADJUNTOS del documento de ENTRADA de tela (etapa B1) — típicamente el **PDF de la factura** o de
 * la remisión del proveedor (Daniel lo pidió explícitamente), en Cloudflare R2, ligados al
 * documento por la tabla puente `EntradaTelaArchivo`. Espejo EXACTO de `adjuntos-orden.ts` (F8-E6)
 * y `adjuntos-pedido.ts`: toda la lógica AQUÍ (A1); las rutas sólo validan permiso + Zod y delegan.
 * Tres operaciones, con el flujo presigned del motor de F0 (A5):
 *
 *  1. `solicitarSubidaAdjuntoEntradaTela` — exige el documento (de la empresa activa, A9) y
 *     `inventario-telas.mover`, crea el `Archivo` vía R2 (carpeta `entradas-tela/<id>` — key
 *     ORDENADA por id, NO por nombre, A5), liga `EntradaTelaArchivo`, registra bitácora y devuelve
 *     la URL PUT prefirmada (todo en UNA transacción, A2).
 *  2. `listarAdjuntosEntradaTela` — `inventario-telas.ver`; cada adjunto con su URL GET prefirmada
 *     (nombre de descarga = original), ordenados por antigüedad.
 *  3. `eliminarAdjuntoEntradaTela` — `inventario-telas.mover`; borra el `Archivo` (Cascade arrastra
 *     el `EntradaTelaArchivo`) + bitácora en UNA transacción (A2) y, TRAS el commit, borra el
 *     OBJETO físico de R2 en modo BEST-EFFORT (mismo criterio que órdenes/pedidos: si R2 falla NO
 *     revierte el borrado del registro; a lo sumo queda un objeto huérfano).
 *
 * El adjunto se puede subir/quitar en CUALQUIER estado del documento: la factura escaneada suele
 * llegar después de que la tela ya entró, y quitar un PDF equivocado no altera el inventario (que
 * es Σ de movimientos, D3). El servicio de archivos se INYECTA (default `servicioArchivos()` lazy)
 * para pasar un fake en tests sin R2 real. CERO permisos nuevos (reusa los `inventario-telas.*`).
 */
import {
  esquemaEntradaTelaAdjuntoCrear,
  type DatosEntradaTelaAdjuntoCrear,
} from '../../contrato/index.js';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Carpeta R2 de los adjuntos de entradas de tela (la key real se ordena por id, A5). */
const CARPETA_ADJUNTOS = 'entradas-tela';

/** Resultado de preparar la subida de un adjunto (registro + URL PUT prefirmada). */
export interface SubidaAdjuntoEntradaTela {
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Un adjunto de una entrada de tela con su URL de descarga prefirmada. */
export interface AdjuntoEntradaTelaConUrl {
  idArchivo: string;
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
  urlDescarga: string;
  subidoPorId: string | null;
  creadoEn: Date;
}

/** Exige que el documento exista y sea de la empresa activa (A9), o lanza `ErrorNoEncontrado`. */
async function exigirEntradaDeEmpresa(
  tx: Tx,
  idEntradaTela: number,
  idEmpresa: number,
): Promise<void> {
  const entrada = await tx.entradaTela.findFirst({
    where: { id: idEntradaTela, idEmpresa },
    select: { id: true },
  });
  if (entrada === null) {
    throw new ErrorNoEncontrado('EntradaTela', idEntradaTela);
  }
}

/**
 * Prepara la subida de un adjunto del documento (el PDF de la factura) en UNA transacción (A2):
 * exige el documento (empresa activa, A9) y `inventario-telas.mover`, crea el `Archivo` vía el
 * motor de R2 (carpeta `entradas-tela/<id>`, key ordenada por id — A5), liga `EntradaTelaArchivo`,
 * registra bitácora y devuelve la URL PUT prefirmada.
 */
export async function solicitarSubidaAdjuntoEntradaTela(
  sesion: SesionUsuario,
  idEntradaTela: number,
  entrada: DatosEntradaTelaAdjuntoCrear,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaAdjuntoEntradaTela> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaEntradaTelaAdjuntoCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    await exigirEntradaDeEmpresa(tx, idEntradaTela, idEmpresa);

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_ADJUNTOS}/${idEntradaTela}`,
    });

    await tx.entradaTelaArchivo.create({
      data: { idEntradaTela, idArchivo: subida.archivo.id, creadoPorId: sesion.id },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EntradaTela',
      idEntidad: idEntradaTela,
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
 * Lista los adjuntos del documento, cada uno con su URL GET prefirmada para verlo/descargarlo
 * (nombre de descarga = original). Requiere `inventario-telas.ver` y que el documento sea de la
 * empresa activa (A9).
 */
export async function listarAdjuntosEntradaTela(
  sesion: SesionUsuario,
  idEntradaTela: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<AdjuntoEntradaTelaConUrl[]> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const entrada = await cliente.entradaTela.findFirst({
    where: { id: idEntradaTela, idEmpresa },
    select: { id: true },
  });
  if (entrada === null) {
    throw new ErrorNoEncontrado('EntradaTela', idEntradaTela);
  }

  const adjuntos = await cliente.entradaTelaArchivo.findMany({
    where: { idEntradaTela },
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
      creadoEn: adjunto.creadoEn,
    })),
  );
}

/**
 * Quita un adjunto del documento: borra el `Archivo` (Cascade arrastra el `EntradaTelaArchivo`) +
 * bitácora en UNA transacción (A2) y, TRAS el commit, borra el OBJETO físico de R2 en modo
 * BEST-EFFORT. Si R2 falla NO revierte el borrado del registro: se loguea y sigue. Requiere
 * `inventario-telas.mover`. Si el adjunto no pertenece a ese documento (o el documento no es de la
 * empresa activa, A9) → `ErrorNoEncontrado`.
 *
 * ⚠️ Llamar SIEMPRE a NIVEL SUPERIOR (sin pasar un `bd.tx` ya abierto): el borrado físico de R2
 * corre DESPUÉS del commit de esta función (mismo aviso que en los adjuntos de orden/pedido).
 */
export async function eliminarAdjuntoEntradaTela(
  sesion: SesionUsuario,
  idEntradaTela: number,
  idArchivo: string,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<void> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const idEmpresa = sesion.idEmpresaActiva;

  const keyR2 = await enTransaccion(async (tx) => {
    await exigirEntradaDeEmpresa(tx, idEntradaTela, idEmpresa);

    const adjunto = await tx.entradaTelaArchivo.findFirst({
      where: { idEntradaTela, idArchivo },
      include: { archivo: { select: { key: true, nombreOriginal: true } } },
    });
    if (adjunto === null) {
      throw new ErrorNoEncontrado('Adjunto de la entrada de tela', idArchivo);
    }

    await tx.archivo.delete({ where: { id: idArchivo } });

    await registrarBitacora(tx, sesion, {
      entidad: 'EntradaTela',
      idEntidad: idEntradaTela,
      accion: 'MODIFICAR',
      datos: { adjunto: 'quitar', archivo: adjunto.archivo.nombreOriginal },
    });

    return adjunto.archivo.key;
  }, bd);

  try {
    await archivos.eliminarObjeto(keyR2);
  } catch (error) {
    console.warn(
      `No se pudo borrar el objeto R2 "${keyR2}" del adjunto de la entrada de tela ${idEntradaTela}.`,
      error,
    );
  }
}
