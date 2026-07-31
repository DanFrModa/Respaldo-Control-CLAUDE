/**
 * ADJUNTOS del pedido interno (rediseño R3, B3) — archivos de apoyo del pedido, típicamente el
 * documento ORIGINAL de la OC del cliente (Excel/PDF/imágenes), en Cloudflare R2, ligados a UN
 * pedido por la tabla puente `PedidoArchivo` (espejo EXACTO de `OrdenArchivo`/`adjuntos-orden.ts`,
 * F8-E6). Toda la lógica AQUÍ (A1); las rutas sólo validan permiso + Zod y delegan. Tres
 * operaciones, con el flujo presigned del motor de F0 (A5):
 *
 *  1. `solicitarSubidaAdjuntoPedido` — exige el pedido (de la empresa activa, A9) y
 *     `pedidos.administrar`, crea el `Archivo` vía R2 (carpeta `pedidos/<id>` — key ORDENADA por
 *     id, NO por nombre, A5), liga `PedidoArchivo`, registra bitácora y devuelve la URL PUT
 *     prefirmada (todo en UNA transacción, A2).
 *  2. `listarAdjuntosPedido` — `pedidos.ver`, pedido de la empresa activa (A9); cada adjunto con su
 *     URL GET prefirmada (nombre de descarga = original), ordenados por antigüedad.
 *  3. `eliminarAdjuntoPedido` — `pedidos.administrar`; borra el `Archivo` (Cascade arrastra el
 *     `PedidoArchivo`) + bitácora en UNA transacción (A2) y, TRAS el commit, borra el OBJETO físico
 *     de R2 en modo BEST-EFFORT (mismo criterio que órdenes: no queda huérfano; si R2 falla NO
 *     revierte el borrado del registro).
 *
 * El servicio de archivos se INYECTA (default `servicioArchivos()` lazy) para pasar un fake en
 * tests sin R2 real. Permiso `pedidos.ver` para leer, `pedidos.administrar` para mutar (reusa el
 * RBAC de pedidos, sin permisos nuevos — mismo patrón que `ordenes.*` en los adjuntos de orden).
 */
import { esquemaPedidoAdjuntoCrear, type DatosPedidoAdjuntoCrear } from '../../contrato/index.js';

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

/** Carpeta R2 de los adjuntos de pedidos (la key real se ordena por id, no por nombre, A5). */
const CARPETA_ADJUNTOS = 'pedidos';

/** Resultado de preparar la subida de un adjunto (registro + URL PUT prefirmada). */
export interface SubidaAdjuntoPedido {
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Un adjunto de un pedido con su URL de descarga prefirmada. */
export interface AdjuntoPedidoConUrl {
  idArchivo: string;
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
  urlDescarga: string;
  subidoPorId: string | null;
  creadoEn: Date;
}

/** Exige que el pedido exista y sea de la empresa activa (A9), o lanza `ErrorNoEncontrado`. */
async function exigirPedidoDeEmpresa(tx: Tx, idPedido: number, idEmpresa: number): Promise<void> {
  const pedido = await tx.pedido.findFirst({
    where: { id: idPedido, idEmpresa },
    select: { id: true },
  });
  if (pedido === null) {
    throw new ErrorNoEncontrado('Pedido', idPedido);
  }
}

/**
 * Prepara la subida de un adjunto del pedido (B3) en UNA transacción (A2): exige el pedido
 * (empresa activa, A9) y `pedidos.administrar`, crea el `Archivo` vía el motor de R2 (carpeta
 * `pedidos/<id>`, key ordenada por id — A5), liga `PedidoArchivo`, registra bitácora y devuelve la
 * URL PUT prefirmada. El servicio de archivos se inyecta (default lazy) para tests sin R2.
 */
export async function solicitarSubidaAdjuntoPedido(
  sesion: SesionUsuario,
  idPedido: number,
  entrada: DatosPedidoAdjuntoCrear,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaAdjuntoPedido> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const datos = validarEntrada(esquemaPedidoAdjuntoCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    await exigirPedidoDeEmpresa(tx, idPedido, idEmpresa);

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_ADJUNTOS}/${idPedido}`,
    });

    await tx.pedidoArchivo.create({
      data: {
        idPedido,
        idArchivo: subida.archivo.id,
        creadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: idPedido,
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
 * Lista los adjuntos de un pedido (B3), cada uno con su URL GET prefirmada para verlo/descargarlo
 * (nombre de descarga = original). Requiere `pedidos.ver`. Exige que el pedido exista y sea de la
 * empresa activa (A9).
 */
export async function listarAdjuntosPedido(
  sesion: SesionUsuario,
  idPedido: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<AdjuntoPedidoConUrl[]> {
  verificarPermiso(sesion, 'pedidos.ver');
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const pedido = await cliente.pedido.findFirst({
    where: { id: idPedido, idEmpresa },
    select: { id: true },
  });
  if (pedido === null) {
    throw new ErrorNoEncontrado('Pedido', idPedido);
  }

  const adjuntos = await cliente.pedidoArchivo.findMany({
    where: { idPedido },
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
 * Quita un adjunto del pedido (B3): borra el `Archivo` (Cascade arrastra el `PedidoArchivo`) +
 * bitácora en UNA transacción (A2) y, TRAS el commit, borra el OBJETO físico de R2 en modo
 * BEST-EFFORT. Si R2 falla NO revierte el borrado del registro: se loguea y sigue. Requiere
 * `pedidos.administrar`. Si el adjunto no pertenece a ese pedido (o el pedido no es de la empresa
 * activa, A9) → `ErrorNoEncontrado`.
 *
 * ⚠️ Llamar SIEMPRE a NIVEL SUPERIOR (sin pasar un `bd.tx` ya abierto): el borrado físico de R2
 * corre DESPUÉS del commit de esta función (misma garantía que `eliminarAdjunto` de órdenes).
 */
export async function eliminarAdjuntoPedido(
  sesion: SesionUsuario,
  idPedido: number,
  idArchivo: string,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<void> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  // La key del objeto R2 se captura DENTRO de la tx para borrarlo best-effort tras el commit.
  const keyR2 = await enTransaccion(async (tx) => {
    await exigirPedidoDeEmpresa(tx, idPedido, idEmpresa);

    const adjunto = await tx.pedidoArchivo.findFirst({
      where: { idPedido, idArchivo },
      include: { archivo: { select: { key: true, nombreOriginal: true } } },
    });
    if (adjunto === null) {
      throw new ErrorNoEncontrado('Adjunto del pedido', idArchivo);
    }

    // Borrar el Archivo arrastra el PedidoArchivo (onDelete Cascade); un solo paso evita un
    // huérfano de registro si algo fallara entre ambos borrados.
    await tx.archivo.delete({ where: { id: idArchivo } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: idPedido,
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
      `No se pudo borrar el objeto R2 "${keyR2}" del adjunto del pedido ${idPedido}.`,
      error,
    );
  }
}
