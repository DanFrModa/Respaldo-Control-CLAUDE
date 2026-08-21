/**
 * RC AUTOMÁTICA al nacer la OP (rediseño R3, B5 — proto §4.1: "su Ruta Crítica se programa sola").
 *
 * `crearOrden` (el punto ÚNICO de nacimiento por captura: lo usan la salida a producción del
 * constructor Y el alta directa de /captura) escribe el evento outbox `orden-creada` en la MISMA
 * transacción del alta. El relay lo publica a pg-boss y ESTE consumidor lo procesa: resuelve
 * parámetros de programación razonables y GENERA la ruta invocando el MISMO dominio del endpoint
 * manual (`generarRutaOrden`, F5-E3). La captura NUNCA espera al CPM (patrón del auto-avance
 * F3→F5). Si el consumidor falla con un error INESPERADO, el manejador de la cola
 * (`manejarEventoAutoAvance`, autoAvance.ts) deja bitácora `rc-automatica-fallida` y PROPAGA para
 * que pg-boss REINTENTE (H2 del reviewer: un parpadeo de BD no puede dejar la orden sin RC en
 * silencio; reintentar es seguro — este consumidor es idempotente). El endpoint manual sigue
 * disponible como red final.
 *
 * El endpoint `POST /ruta-critica/ordenes/:id/programar` queda como *RE*-programar: la vía manual
 * para corregir los parámetros que la automática eligió por defecto (mismo permiso `rc.programar`).
 *
 * RESOLUCIÓN DE PARÁMETROS (la generación exige artículo RC + tipo de tela + aplicación + fecha
 * de entrega; la captura del constructor no los pide — decisión de esta fase, documentada):
 *  1. Si el MISMO modelo ya tiene una orden PROGRAMADA (misma empresa), se REUSAN sus parámetros
 *     (la señal más fiel: los resurtidos repiten artículo/tela/aplicación). `esResurtido` NO se
 *     asume (duración 0 en procesos de resurtido es una decisión humana; el re-programar la toma).
 *  2. Si no, defaults del catálogo: la primera PLANTILLA activa define el artículo (directo o el
 *     primero activo de su familia); tela = "Programar Tela Basica" (factor 1.0 del seed) o la
 *     primera activa; aplicación = si el modelo tiene bordados/estampados en su BOM, la activa más
 *     corta con días > 0, si no "Sin Aplicación" (días 0) o la primera activa.
 *  • Fecha de entrega de la RC = `Orden.fechaEntrega` (la salida a producción la hereda de la
 *    ventana del pedido). SIN fecha NO se puede planear hacia atrás: se OMITE la generación y
 *    queda bitácora de sistema (`rc-automatica-omitida`) — el re-programar manual la cubre.
 *
 * IDEMPOTENTE: si la orden ya tiene `rcActiva`, el evento (duplicado/reintento) es un no-op — la
 * automática JAMÁS pisa una ruta existente (re-generar es exclusivo del endpoint manual).
 *
 * Proceso de SISTEMA: no hay usuario. Se usa una sesión sentinela (`rc-automatica`) con solo
 * `rc.programar`, mismo criterio que la sesión del ETL (`sesion-etl.ts`): las columnas de
 * auditoría no tienen FK física y el origen queda identificable en bitácora.
 */
import { moduloApagado, type ClavePermiso } from '../../contrato/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { MensajeEventoDominio } from '../../comun/cola-eventos.js';
import type { EventoOrdenCreada } from '../../comun/eventos-dominio.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

import { generarRutaOrden } from './rutaOrden.js';

/** Cliente de solo lectura (tx del llamador, cliente de tests o el singleton). */
type ClienteBd = ReturnType<typeof clienteLectura>;

/** Id sentinela del "usuario" de la RC automática (queda en auditoría/bitácora, sin FK física). */
export const ID_USUARIO_RC_AUTOMATICA = 'rc-automatica';

/** Nombre del tipo de tela default del seed (factor 1.0) cuando el modelo no tiene historia. */
const TELA_DEFAULT = 'Programar Tela Basica';

/** Nombre de la aplicación "sin aplicación" del seed (días 0). */
const APLICACION_CERO = 'Sin Aplicación';

/** Sesión de SISTEMA del consumidor: solo el permiso que `generarRutaOrden` exige. */
function sesionSistema(idEmpresa: number): SesionUsuario {
  return {
    id: ID_USUARIO_RC_AUTOMATICA,
    username: 'rc-automatica',
    nombre: 'RC automática (orden creada)',
    idEmpresaActiva: idEmpresa,
    nombreEmpresaActiva: '',
    permisos: new Set<ClavePermiso>(['rc.programar']),
  };
}

/** Parámetros de programación resueltos, o el motivo por el que no se pudo. */
type ResolucionParametros =
  | { ok: true; idArticuloRC: number; idTipoTela: number; idAplicacion: number }
  | { ok: false; motivo: string };

/**
 * Resuelve artículo/tela/aplicación para la generación automática (ver el encabezado del módulo).
 * Lecturas sueltas (sin tx): el consumidor corre fuera de la transacción del alta.
 */
async function resolverParametros(
  cliente: ClienteBd,
  idEmpresa: number,
  idModelo: number,
  idOrden: number,
): Promise<ResolucionParametros> {
  // 1) La última orden PROGRAMADA del mismo modelo manda (resurtidos repiten parámetros).
  const previa = await cliente.orden.findFirst({
    where: {
      idEmpresa,
      idModelo,
      idArticuloRcProg: { not: null },
      idDuracionTela: { not: null },
      idDuracionAplicacion: { not: null },
    },
    orderBy: [{ fechaProgramada: 'desc' }, { id: 'desc' }],
    select: { idArticuloRcProg: true, idDuracionTela: true, idDuracionAplicacion: true },
  });
  if (
    previa !== null &&
    previa.idArticuloRcProg !== null &&
    previa.idDuracionTela !== null &&
    previa.idDuracionAplicacion !== null
  ) {
    return {
      ok: true,
      idArticuloRC: previa.idArticuloRcProg,
      idTipoTela: previa.idDuracionTela,
      idAplicacion: previa.idDuracionAplicacion,
    };
  }

  // 2) Defaults del catálogo. El artículo sale de la primera PLANTILLA activa (garantiza que la
  //    generación encuentre plantilla): directa a un artículo ACTIVO, o el primer artículo activo
  //    de su familia. El artículo directo también se verifica ACTIVO (nota del reviewer: una
  //    plantilla activa apuntando a un artículo desactivado es MALA CONFIGURACIÓN de catálogo →
  //    omisión controlada auditada, no un fallo que pg-boss reintente en vano).
  const plantilla = await cliente.plantillaRuta.findFirst({
    where: { activo: true },
    orderBy: { id: 'asc' },
    select: { idArticuloRC: true, idFamiliaArticulo: true },
  });
  if (plantilla === null) {
    return { ok: false, motivo: 'No hay ninguna plantilla de ruta activa.' };
  }
  let idArticuloRC: number | null = null;
  if (plantilla.idArticuloRC !== null) {
    const directo = await cliente.articuloRC.findFirst({
      where: { id: plantilla.idArticuloRC, activo: true },
      select: { id: true },
    });
    idArticuloRC = directo?.id ?? null;
  }
  if (idArticuloRC === null && plantilla.idFamiliaArticulo !== null) {
    const articulo = await cliente.articuloRC.findFirst({
      where: { activo: true, idFamiliaArticulo: plantilla.idFamiliaArticulo },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    idArticuloRC = articulo?.id ?? null;
  }
  if (idArticuloRC === null) {
    return {
      ok: false,
      motivo:
        'La plantilla activa no resuelve a ningún artículo RC ACTIVO (revisa el catálogo: su artículo directo o los de su familia están desactivados).',
    };
  }

  const tela =
    (await cliente.duracionPorTipoTela.findFirst({
      where: { activo: true, nombre: TELA_DEFAULT },
      select: { id: true },
    })) ??
    (await cliente.duracionPorTipoTela.findFirst({
      where: { activo: true },
      orderBy: { id: 'asc' },
      select: { id: true },
    }));
  if (tela === null) {
    return { ok: false, motivo: 'No hay tipos de tela activos en el catálogo de duraciones.' };
  }

  // Aplicación: si ESTA ORDEN lleva arte (bordado/estampado), LLEVA aplicación — se elige la activa
  // más corta con días > 0 (conservador; el re-programar afina). Sin arte, "Sin Aplicación" (días 0)
  // omite los procesos condicionales.
  //
  // ⭐ V1-E3d (§Post-F9.43, hallazgo del reviewer): la pregunta se le hace a la **receta congelada
  // de la orden**, no al modelo. Preguntándole al modelo, dos órdenes hermanas —una con el arte
  // excluido— recibían la misma plantilla y los mismos procesos condicionales de estampado, que es
  // exactamente la familia de defectos que esta etapa vino a cerrar. Los renglones EXCLUIDOS no
  // cuentan: esa orden no lleva ese arte.
  const tieneAplicacion =
    (await cliente.ordenArte.count({ where: { idOrden, excluido: false } })) > 0;
  const aplicacion = tieneAplicacion
    ? await cliente.duracionPorAplicacion.findFirst({
        where: { activo: true, dias: { gt: 0 } },
        orderBy: [{ dias: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })
    : ((await cliente.duracionPorAplicacion.findFirst({
        where: { activo: true, nombre: APLICACION_CERO },
        select: { id: true },
      })) ??
      (await cliente.duracionPorAplicacion.findFirst({
        where: { activo: true },
        orderBy: [{ dias: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })));
  if (aplicacion === null) {
    return { ok: false, motivo: 'No hay aplicaciones activas en el catálogo de duraciones.' };
  }

  return { ok: true, idArticuloRC, idTipoTela: tela.id, idAplicacion: aplicacion.id };
}

/** Deja rastro auditable de que la RC automática se OMITIÓ (y por qué). Transacción mínima. */
async function registrarOmision(idOrden: number, motivo: string, bd?: ContextoBd): Promise<void> {
  await enTransaccion(async (tx) => {
    await registrarBitacora(tx, null, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: { operacion: 'rc-automatica-omitida', motivo },
    });
  }, bd);
}

/**
 * Procesa un evento `orden-creada` (B5): genera la RC automática de la orden si aún no tiene y
 * hay datos suficientes. IDEMPOTENTE (rcActiva = no-op) y tolerante: los casos "no programable"
 * (orden cancelada, sin fecha de entrega, catálogos RC vacíos) NO lanzan — reintentar no los
 * arregla; dejan bitácora y el re-programar manual los cubre. Los errores INESPERADOS sí
 * propagan: `manejarEventoAutoAvance` (autoAvance.ts) les deja bitácora `rc-automatica-fallida`
 * y los re-lanza para que pg-boss REINTENTE (H2 del reviewer).
 *
 * Exportado aparte del wiring de pg-boss para invocarlo directo desde tests (patrón F5-E6).
 */
export async function procesarOrdenCreada(
  payload: EventoOrdenCreada,
  bd?: ContextoBd,
): Promise<void> {
  // ⭐ V1-E3t — LA RUTA CRÍTICA ESTÁ APAGADA (`DECISIONES.md §Post-F9.36 punto 1`).
  //
  // Sin esta guarda, cada OP nueva paría ~26 procesos que nadie va a capturar: basura de arranque
  // que después habría que distinguir de lo real. Se OMITE la generación y se deja bitácora, para
  // que el día que RC se encienda quede claro cuáles órdenes nacieron sin ruta y por qué.
  //
  // ⚠️ La guarda va AQUÍ y no en el registro del consumidor a propósito: el consumidor de la cola
  // (`manejarEventoAutoAvance`) sigue vivo y DRENANDO. Si se hubiera apagado el consumidor entero,
  // los emisores de F3/F4 (corte, envío, recibo, entrega, recepción de material, auditoría, OC de
  // tela, surtido de avíos, hitos) seguirían escribiendo al outbox, el relay seguiría publicando a
  // pg-boss y NADIE consumiría: la tabla `pgboss.job` crecería sin drenar nunca. Apagar una pieza
  // no puede tumbar otra que sí se usa.
  //
  // Las rutas YA generadas no se tocan (D3) y su auto-avance sigue corriendo: las órdenes nuevas
  // simplemente no tienen ruta que avanzar, así que para ellas el auto-avance es un no-op natural.
  if (moduloApagado('rc')) {
    await registrarOmision(
      payload.idOrden,
      'La Ruta Crítica está apagada en esta versión (§Post-F9.36 punto 1): la orden nace SIN ruta. Se genera al encender el módulo.',
      bd,
    );
    return;
  }

  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findUnique({
    where: { id: payload.idOrden },
    select: {
      id: true,
      idEmpresa: true,
      idModelo: true,
      estado: true,
      rcActiva: true,
      fechaEntrega: true,
    },
  });
  if (orden === null || orden.idEmpresa !== payload.idEmpresa) {
    return; // La orden ya no existe (o el payload no cuadra): nada que programar.
  }
  if (orden.estado === 'cancelada') {
    return; // Una orden cancelada no se programa.
  }
  if (orden.rcActiva === true) {
    return; // Ya tiene RC (evento duplicado o programación manual previa): no-op idempotente.
  }
  if (orden.fechaEntrega === null) {
    await registrarOmision(
      orden.id,
      'La orden no tiene fecha de entrega; la RC se planea hacia atrás desde ella. Prográmala a mano.',
      bd,
    );
    return;
  }

  const parametros = await resolverParametros(cliente, orden.idEmpresa, orden.idModelo, orden.id);
  if (!parametros.ok) {
    await registrarOmision(orden.id, parametros.motivo, bd);
    return;
  }

  await generarRutaOrden(
    sesionSistema(orden.idEmpresa),
    {
      idOrden: orden.id,
      idArticuloRC: parametros.idArticuloRC,
      fechaEntregaRC: orden.fechaEntrega,
      idTipoTela: parametros.idTipoTela,
      idAplicacion: parametros.idAplicacion,
      esResurtido: false,
    },
    bd,
  );
}

/**
 * Deja rastro AUDITABLE de que la RC automática FALLÓ con un error inesperado (H2 del reviewer):
 * bitácora de sistema `rc-automatica-fallida` con el error y la fila outbox de origen. BEST-EFFORT
 * a conciencia: si la propia bitácora falla (típico: la BD caída que causó el error original), se
 * TRAGA — jamás debe enmascarar el error ORIGINAL, que el llamador (`manejarEventoAutoAvance`)
 * PROPAGA para que pg-boss reintente. Con `rcActiva` intacta, el reintento re-procesa completo;
 * si los reintentos se agotan, la bitácora queda como evidencia y el re-programar manual cubre.
 */
export async function registrarFalloRcAutomatica(
  mensaje: MensajeEventoDominio,
  error: unknown,
  bd?: ContextoBd,
): Promise<void> {
  try {
    const payload = mensaje.payload as Partial<EventoOrdenCreada> | null;
    const idOrden = typeof payload?.idOrden === 'number' ? payload.idOrden : null;
    if (idOrden === null) {
      return; // Payload malformado: no hay orden a la que colgarle la bitácora.
    }
    await enTransaccion(async (tx) => {
      await registrarBitacora(tx, null, {
        entidad: 'Orden',
        idEntidad: idOrden,
        accion: 'OTRO',
        datos: {
          operacion: 'rc-automatica-fallida',
          error: String(error),
          filaOutbox: mensaje.id,
        },
      });
    }, bd);
  } catch {
    // La bitácora es best-effort: el error ORIGINAL (que el llamador propaga) es el que manda.
  }
}
