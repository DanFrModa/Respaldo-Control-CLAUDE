/**
 * SECUENCIA DE ESTAMPADO por orden — reprogramación EN VIVO (rediseño R4, B10; spec §4.9,
 * decisión Daniel 6-jul): los modelos FLEXIBLES deciden en producción, incluso con el ciclo ya
 * empezado, si el estampado va ANTES o DESPUÉS de coser. La elección se guarda en
 * `Orden.secEstampadoElegido` y se refleja en la RUTA VIVA como la dependencia condicional
 * "recibo de estampado → envío a costura" (`RutaOrdenDep`):
 *
 *  • `antes`   → se AGREGA la arista (la confección espera al estampado). Si el envío a costura
 *                estaba `activo` y el estampado no ha llegado, vuelve a `pendiente`.
 *  • `despues` → se QUITA la arista (la confección deja de esperar); los procesos que quedaron
 *                listos se activan (`activarProcesosListos`).
 *
 * REGLAS (409 si no aplica):
 *  • Solo órdenes cuyo MODELO es `flexible` (las forzadas las fija el modelo, no producción).
 *  • La orden debe tener ruta generada y con procesos de estampado (lleva aplicación).
 *  • El estampado (recibo) NO debe estar ya completado — la elección ya no cambia nada.
 *  • Elegir `antes` con el envío a costura ya completado tampoco aplica (ya se cosió sin esperar).
 *
 * NUNCA revive procesos hechos (solo mueve `pendiente`↔`activo`), valida que la arista no forme
 * ciclo (grafo.ts), audita en bitácora (A7) y RE-ENCOLA el recálculo del CPM (las fechas se
 * re-fechan en segundo plano, patrón F5-E4). Exige `rc.programar` (A4). Transaccional (A2).
 */
import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';

import { activarProcesosListos } from './cumplimiento.js';
import { construirGrafoSucesores, esAlcanzable } from './grafo.js';
import { encolarRecalculo, obtenerRutaOrden, type RutaOrdenDto } from './rutaOrden.js';

/** Datos para elegir la secuencia de estampado de una orden FLEXIBLE. */
export interface DatosElegirSecuenciaEstampado {
  idOrden: number;
  secuencia: 'antes' | 'despues';
}

/**
 * Bloqueo de las CAPTURAS de una orden (advisory lock transaccional por empresa+orden). MISMA
 * fórmula/llave que `cumplimiento.ts`/`autoAvance.ts`: la reprogramación en vivo se serializa con
 * las capturas y el auto-avance de la MISMA orden (no se pisan al mover estados).
 */
async function bloquearCapturasDeOrden(tx: Tx, idEmpresa: number, idOrden: number): Promise<void> {
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x4f000000) | 0;
  const clave2 = idOrden | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * Elige (o cambia) la secuencia de estampado de una orden FLEXIBLE y reprograma la ruta viva en
 * el momento. Ver las reglas en el encabezado del módulo. Devuelve la ruta actualizada.
 */
export async function elegirSecuenciaEstampado(
  sesion: SesionUsuario,
  datos: DatosElegirSecuenciaEstampado,
  bd?: ContextoBd,
): Promise<RutaOrdenDto> {
  verificarPermiso(sesion, 'rc.programar');

  const idEmpresa = await enTransaccion(async (tx) => {
    // Scope por empresa activa (A9): una orden de otra empresa "no existe" → 404 (no se reprograma).
    const orden = await tx.orden.findFirst({
      where: { id: datos.idOrden, idEmpresa: sesion.idEmpresaActiva },
      select: {
        id: true,
        idEmpresa: true,
        rcActiva: true,
        secEstampadoElegido: true,
        modelo: { select: { secuenciaEstampado: true } },
      },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', datos.idOrden);
    }
    if (orden.modelo.secuenciaEstampado !== 'flexible') {
      throw new ErrorConflicto(
        'La secuencia de estampado de esta orden la fija el modelo ' +
          `(${orden.modelo.secuenciaEstampado === 'antes' ? 'ANTES' : 'DESPUÉS'} de coser); ` +
          'solo los modelos flexibles se reprograman en producción.',
      );
    }
    if (orden.rcActiva !== true) {
      throw new ErrorConflicto(
        'La orden no tiene una Ruta Crítica viva; prográmala antes de elegir la secuencia.',
      );
    }

    // Serializa con capturas/auto-avance de la MISMA orden.
    await bloquearCapturasDeOrden(tx, orden.idEmpresa, orden.id);

    // Renglones involucrados: recibo(s) de estampado y envío(s) a costura de la ruta VIVA.
    const filas = await tx.rutaOrden.findMany({
      where: { idOrden: datos.idOrden },
      select: {
        id: true,
        estado: true,
        procesoDef: { select: { tipoEvento: true, nombre: true } },
      },
    });
    const recibos = filas.filter((f) => f.procesoDef.tipoEvento === 'reciboEstampado');
    const envios = filas.filter((f) => f.procesoDef.tipoEvento === 'envioCostura');
    if (recibos.length === 0 || envios.length === 0) {
      throw new ErrorConflicto(
        'La ruta de esta orden no tiene procesos de estampado que reprogramar ' +
          '(la orden no lleva aplicación, o su ruta no incluye el envío a costura).',
      );
    }
    if (recibos.some((r) => r.estado === 'completado')) {
      throw new ErrorConflicto(
        'El estampado de esta orden ya está completado; la secuencia ya no se puede cambiar.',
      );
    }
    if (datos.secuencia === 'antes' && envios.some((e) => e.estado === 'completado')) {
      throw new ErrorConflicto(
        'El envío a costura ya está completado: la confección arrancó sin esperar al estampado, ' +
          'así que ya solo puede ir DESPUÉS.',
      );
    }

    // Aristas vivas de la ruta (en ids de RutaOrden) para editar/validar ciclos.
    const aristas = await tx.rutaOrdenDep.findMany({
      where: { rutaOrden: { idOrden: datos.idOrden } },
      select: { idRutaOrden: true, idAntecesor: true },
    });

    if (datos.secuencia === 'antes') {
      const grafo = construirGrafoSucesores(
        aristas.map((a) => ({ idProceso: a.idRutaOrden, idAntecesor: a.idAntecesor })),
      );
      for (const envio of envios) {
        for (const recibo of recibos) {
          const yaExiste = aristas.some(
            (a) => a.idRutaOrden === envio.id && a.idAntecesor === recibo.id,
          );
          if (yaExiste) continue;
          if (esAlcanzable(grafo, envio.id, recibo.id)) {
            throw new ErrorConflicto(
              'Amarrar el estampado antes de coser formaría un ciclo en la ruta de esta orden; ' +
                'revisa sus dependencias.',
            );
          }
          await tx.rutaOrdenDep.create({
            data: { idRutaOrden: envio.id, idAntecesor: recibo.id, creadoPorId: sesion.id },
          });
        }
        // El envío ya no está listo si su nuevo antecesor no está completado: activo → pendiente
        // (NUNCA toca completados — "no revive procesos hechos").
        if (envio.estado === 'activo') {
          await tx.rutaOrden.update({
            where: { id: envio.id },
            data: { estado: 'pendiente', ...datosModificacion(sesion) },
          });
        }
      }
    } else {
      // 'despues': quita la(s) arista(s) recibo→envío; lo que quedó listo se activa.
      const idsEnvio = envios.map((e) => e.id);
      const idsRecibo = recibos.map((r) => r.id);
      await tx.rutaOrdenDep.deleteMany({
        where: { idRutaOrden: { in: idsEnvio }, idAntecesor: { in: idsRecibo } },
      });
      await activarProcesosListos(tx, datos.idOrden);
    }

    await tx.orden.update({
      where: { id: datos.idOrden },
      data: { secEstampadoElegido: datos.secuencia, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: datos.idOrden,
      accion: 'OTRO',
      datos: {
        operacion: 'elegir-secuencia-estampado',
        secuencia: datos.secuencia,
        previa: orden.secEstampadoElegido,
      },
    });

    return orden.idEmpresa;
  }, bd);

  // Tras el commit: re-fecha la ruta en segundo plano (mismo patrón que generar/ajustar; la
  // respuesta NO espera al CPM — el panel mostrará "recalculando" hasta que el job termine).
  await encolarRecalculo(datos.idOrden, idEmpresa, 'ajustar');
  return obtenerRutaOrden(sesion, datos.idOrden, bd);
}
