/**
 * Precios de la orden con RASTRO INMUTABLE — rediseño R2 (requisito de Daniel §4.4.3, brecha B1).
 * Cierra el hueco de F2/F3: `Orden.maquilaOrd`/`aplicacionOrd` eran DATO del ETL sin motor; aquí
 * nace su captura real. El modelo trae el precio de REFERENCIA (`Modelo.maquilaBase`, heredado al
 * costeo D1/D2); en la orden se captura el precio REAL negociado, y CADA cambio inserta un
 * `OrdenPrecioEvento` (quién · cuándo · con qué proveedor se negoció · anterior→nuevo) que JAMÁS
 * se edita ni borra (D3/A7, estilo `NegociacionEvento` de F8-E5).
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive aquí; las rutas validan permiso + Zod y delegan.
 *  • A2 — update de la orden + inserción del evento + bitácora en UNA transacción.
 *  • A4 — permisos LEGADOS de Accesos.csv, ya sembrados: `ordenes.precio-maquila` (capturar,
 *    acceso 4 del viejo) y `ordenes.ver-precio-real-maquila` (ver montos reales, acceso 36).
 *  • A7 — bitácora uniforme + el evento como historial inmutable.
 *  • A9 — todo por la empresa activa (una orden de otra empresa no existe para la sesión).
 *
 * Lectura gateada: el RESUMEN (`obtenerPreciosOrden`) es `ordenes.ver` pero DEVUELVE null en los
 * montos reales sin `ordenes.ver-precio-real-maquila` (mismo patrón que `pedidos.importes` para
 * `precioVenta`); el HISTORIAL (`listarEventosPrecioOrden`) exige el permiso de ver montos.
 */
import type {
  DatosOrdenPreciosPatch,
  OrdenPrecioEventosLista,
  OrdenPrecioUltimoEvento,
  OrdenPreciosSalida,
} from '../../contrato/index.js';
import { esquemaOrdenPreciosPatchCuerpo } from '../../contrato/index.js';

import { registrarBitacora, datosModificacion } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../comun/nombres-usuario.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Fila cruda de un evento con sus nombres (proveedor incluido). */
interface EventoCrudo {
  id: number;
  campo: 'maquila' | 'aplicacion';
  precioAnterior: { toNumber(): number } | null;
  precioNuevo: { toNumber(): number };
  idProveedor: number | null;
  proveedor: { nombre: string } | null;
  nota: string | null;
  capturadoPorId: string | null;
  capturadoEn: Date;
}

/** `select` de un evento con su proveedor (lo comparten el resumen y el historial). */
const seleccionEvento = {
  id: true,
  campo: true,
  precioAnterior: true,
  precioNuevo: true,
  idProveedor: true,
  proveedor: { select: { nombre: true } },
  nota: true,
  capturadoPorId: true,
  capturadoEn: true,
} as const;

/**
 * Bloqueo de los PRECIOS de una orden dentro de la transacción (concurrencia): advisory lock
 * transaccional por empresa+orden, PRIMERA instrucción de la tx — dos capturas simultáneas del
 * mismo campo se serializan y el `precioAnterior` del segundo evento encadena de verdad con el
 * `precioNuevo` del primero (sin el lock, ambos leerían el MISMO anterior bajo READ COMMITTED y
 * el historial mentiría: A→B, A→C en vez de A→B→C — rompería D3/A7). Mismo criterio que
 * `bloquearEtapasDeOrden` de etapas.ts, con NAMESPACE PROPIO (0x50 = 'P' de Precios) para no
 * chocar con la familia de locks de etapas (0x4F). El lock se libera al terminar la transacción.
 */
async function bloquearPreciosDeOrden(tx: Tx, idEmpresa: number, idOrden: number): Promise<void> {
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x50000000) | 0;
  const clave2 = idOrden | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/** Proyecta un evento al resumen "quién · cuándo · proveedor" (sin montos). */
function aUltimoEvento(
  evento: EventoCrudo | undefined,
  nombres: ReadonlyMap<string, string>,
): OrdenPrecioUltimoEvento | null {
  if (evento === undefined) return null;
  return {
    capturadoPorId: evento.capturadoPorId,
    capturadoPor: nombreDeUsuario(nombres, evento.capturadoPorId),
    capturadoEn: evento.capturadoEn.toISOString(),
    idProveedor: evento.idProveedor,
    proveedor: evento.proveedor?.nombre ?? null,
  };
}

/**
 * RESUMEN de precios de una orden para el panel de detalle (R2 §4.2): venta (del renglón del
 * pedido, null sin `pedidos.importes`), maquila referencia (del modelo) y los REALES capturados
 * (null sin `ordenes.ver-precio-real-maquila`), cada uno con el resumen de su último evento.
 */
export async function obtenerPreciosOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<OrdenPreciosSalida> {
  verificarPermiso(sesion, 'ordenes.ver');
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: {
      id: true,
      folio: true,
      maquilaOrd: true,
      aplicacionOrd: true,
      modelo: { select: { maquilaBase: true } },
      pedidoLinea: { select: { precio: true } },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const puedeVerReales = tienePermiso(sesion, 'ordenes.ver-precio-real-maquila');
  const puedeVerImportes = tienePermiso(sesion, 'pedidos.importes');

  // Solo el ÚLTIMO evento por campo (acotado a ≤2 filas con distinct + orden desc), NO todo el
  // historial: el resumen no debe crecer con la vida de la orden.
  const eventos = (await cliente.ordenPrecioEvento.findMany({
    where: { idOrden },
    orderBy: { id: 'desc' },
    distinct: ['campo'],
    select: seleccionEvento,
  })) as EventoCrudo[];
  const ultimoMaquila = eventos.find((e) => e.campo === 'maquila');
  const ultimoAplicacion = eventos.find((e) => e.campo === 'aplicacion');
  const nombres = await nombresDeUsuarios(cliente, [
    ultimoMaquila?.capturadoPorId ?? null,
    ultimoAplicacion?.capturadoPorId ?? null,
  ]);

  return {
    idOrden: orden.id,
    folioOrden: Number(orden.folio),
    precioVenta: puedeVerImportes ? (orden.pedidoLinea?.precio.toNumber() ?? null) : null,
    maquilaReferencia: orden.modelo.maquilaBase?.toNumber() ?? null,
    maquilaReal: puedeVerReales ? (orden.maquilaOrd?.toNumber() ?? null) : null,
    aplicacionReal: puedeVerReales ? (orden.aplicacionOrd?.toNumber() ?? null) : null,
    puedeVerReales,
    ultimoEventoMaquila: aUltimoEvento(ultimoMaquila, nombres),
    ultimoEventoAplicacion: aUltimoEvento(ultimoAplicacion, nombres),
  };
}

/**
 * Captura el precio REAL negociado de maquila o aplicación de una orden (PATCH). En UNA
 * transacción (A2): valida la orden (empresa activa A9, no cancelada) y el proveedor (si viene),
 * actualiza `Orden.maquilaOrd`/`aplicacionOrd`, INSERTA el `OrdenPrecioEvento` (historial
 * inmutable D3/A7) y registra bitácora. Devuelve el resumen actualizado (quien captura acaba de
 * teclear el monto: el PATCH sí lo regresa aunque no tenga el permiso de ver).
 */
export async function actualizarPreciosOrden(
  sesion: SesionUsuario,
  idOrden: number,
  entrada: DatosOrdenPreciosPatch,
  bd?: ContextoBd,
): Promise<OrdenPreciosSalida> {
  verificarPermiso(sesion, 'ordenes.precio-maquila');
  const datos = validarEntrada(esquemaOrdenPreciosPatchCuerpo, entrada);

  await enTransaccion(async (tx) => {
    // PRIMERO el lock (antes de leer el anterior): serializa capturas concurrentes de la misma
    // orden para que el encadenado anterior→nuevo del historial sea real (ver el TSDoc del lock).
    await bloquearPreciosDeOrden(tx, sesion.idEmpresaActiva, idOrden);

    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
      select: { id: true, folio: true, estado: true, maquilaOrd: true, aplicacionOrd: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }
    if (orden.estado === 'cancelada') {
      throw new ErrorConflicto('La orden está cancelada; no se le pueden capturar precios.');
    }
    if (datos.idProveedor != null) {
      await exigirProveedorActivo(tx, datos.idProveedor);
    }

    const anterior = datos.campo === 'maquila' ? orden.maquilaOrd : orden.aplicacionOrd;

    await tx.orden.update({
      where: { id: idOrden },
      data: {
        ...(datos.campo === 'maquila'
          ? { maquilaOrd: datos.precio }
          : { aplicacionOrd: datos.precio }),
        ...datosModificacion(sesion),
      },
    });

    // Historial INMUTABLE: solo se inserta; nunca update/delete (D3/A7).
    await tx.ordenPrecioEvento.create({
      data: {
        idOrden,
        campo: datos.campo,
        precioAnterior: anterior,
        precioNuevo: datos.precio,
        idProveedor: datos.idProveedor ?? null,
        nota: datos.nota == null || datos.nota === '' ? null : datos.nota,
        capturadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'MODIFICAR',
      datos: {
        precio: datos.campo,
        anterior: anterior === null ? null : anterior.toNumber(),
        nuevo: datos.precio,
        idProveedor: datos.idProveedor ?? null,
      },
    });
  }, bd);

  const resumen = await obtenerPreciosOrden(sesion, idOrden, bd);
  if (resumen.puedeVerReales) {
    return resumen;
  }
  // Quien capturó ve LO QUE ACABA DE TECLEAR (no es fuga: él lo escribió); los montos que no
  // capturó siguen ocultos sin `ordenes.ver-precio-real-maquila`.
  return {
    ...resumen,
    ...(datos.campo === 'maquila'
      ? { maquilaReal: datos.precio }
      : { aplicacionReal: datos.precio }),
  };
}

/** Exige que el proveedor exista y esté activo (con quien se negoció el precio). */
async function exigirProveedorActivo(tx: Tx, idProveedor: number): Promise<void> {
  const prov = await tx.proveedor.findUnique({
    where: { id: idProveedor },
    select: { activo: true, nombre: true },
  });
  if (prov === null) {
    throw new ErrorNoEncontrado('Proveedor', idProveedor);
  }
  if (!prov.activo) {
    throw new ErrorConflicto(`El proveedor "${prov.nombre}" está desactivado.`);
  }
}

/**
 * HISTORIAL completo de eventos de precio de una orden (más reciente primero), con montos —
 * por eso exige `ordenes.ver-precio-real-maquila` (paridad con el acceso 36 del viejo).
 */
export async function listarEventosPrecioOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<OrdenPrecioEventosLista> {
  verificarPermiso(sesion, 'ordenes.ver-precio-real-maquila');
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: {
      id: true,
      folio: true,
      precioEventos: {
        orderBy: { id: 'desc' },
        select: seleccionEvento,
      },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const eventos = orden.precioEventos as EventoCrudo[];
  const nombres = await nombresDeUsuarios(
    cliente,
    eventos.map((e) => e.capturadoPorId),
  );

  return {
    idOrden: orden.id,
    folioOrden: Number(orden.folio),
    eventos: eventos.map((e) => ({
      id: e.id,
      campo: e.campo,
      precioAnterior: e.precioAnterior === null ? null : e.precioAnterior.toNumber(),
      precioNuevo: e.precioNuevo.toNumber(),
      idProveedor: e.idProveedor,
      proveedor: e.proveedor?.nombre ?? null,
      nota: e.nota,
      capturadoPorId: e.capturadoPorId,
      capturadoPor: nombreDeUsuario(nombres, e.capturadoPorId),
      capturadoEn: e.capturadoEn.toISOString(),
    })),
  };
}
