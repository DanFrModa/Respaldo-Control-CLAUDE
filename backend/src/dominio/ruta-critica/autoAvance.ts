/**
 * AUTO-AVANCE de la RUTA CRÍTICA por eventos de dominio (F5-E6; doc `08-Ruta-Critica.md` §4;
 * DECISIONES.md §F5 (d)/(e)/(f); A1/A2/A7). "Que las fechas se llenen solas donde aplica":
 *
 * Los servicios de Producción (F3) y Compras (F4) escriben, en la MISMA transacción de su hecho, un
 * evento en el OUTBOX durable (`comun/eventos-dominio.ts`). El relay (`comun/cola-eventos.ts`) los
 * publica a pg-boss; este consumidor los recibe y AUTO-COMPLETA (o des-completa) el proceso
 * correspondiente de la RC de la orden.
 *
 * Reglas de negocio (LEY — no cambiar):
 *  • (d) PARCIALES: el proceso se marca `completado` SOLO al cubrirse la cantidad COMPLETA pedida
 *    (color×talla, D4). Desde el primer evento que cubre PARTE, lleva la marca visible
 *    `parcialEnCurso = true` (sobre cantidades). Al completarse, `parcialEnCurso = false`.
 *  • (e) EVENTO vs CAPTURA MANUAL: GANA el automático. Si el proceso tenía fecha capturada A MANO y
 *    llega el evento que lo cubre, el evento PISA la fecha manual (`origenCaptura = 'evento'`); la
 *    `Bitacora` guarda que estaba manual (no se pierde el rastro).
 *  • (f) CANCELACIÓN del movimiento origen: el proceso SÍ se des-completa. Si se cancela el corte/
 *    recibo/etc. que lo auto-completó y, re-evaluado, ya no está cubierto, el proceso se des-completa
 *    (`fechaReal = null`, estado recalculado por antecesores), se REVISAN los sucesores ya activados
 *    (los que quedaron `activo` sin todos sus antecesores completados vuelven a `pendiente`), se
 *    reabre la RC si era terminal, queda rastro en `Bitacora` y se ENCOLA el recálculo del CPM.
 *
 * IDEMPOTENCIA: el handler NO confía en el evento como "delta"; RE-EVALÚA el estado físico ACTUAL
 * (suma de etapas vivas vs lo pedido) cada vez. Un evento DUPLICADO produce el MISMO efecto (re-marcar
 * lo ya marcado = no-op). Por eso NO se persiste el id del evento de origen.
 *
 * Es un proceso de SISTEMA (sin `SesionUsuario`): la bitácora va con `registrarBitacora(tx, null, …)`
 * (mismo patrón que `cpm-job.ts`). El RBAC ya se aplicó cuando el usuario disparó el hecho de F3/F4.
 * El evento es AUTORITATIVO (decisión (e)): NO se valida rol responsable (no hay sesión).
 *
 * Innegociables: A1 (lógica aquí), A2 (cada efecto en UNA transacción), A7 (bitácora de sistema).
 */
import { registrarBitacora } from '../../comun/auditoria.js';
import { registrarConsumidorEventos, type MensajeEventoDominio } from '../../comun/cola-eventos.js';
import { EVENTOS_OUTBOX, type EventoOrdenCreada } from '../../comun/eventos-dominio.js';
import { procesarOrdenCreada, registrarFalloRcAutomatica } from './rcAutomatica.js';
import { tipoEventoDeHito } from './hitosOrden.js';
import { COLAS_JOBS, encolarJob, type PayloadRecalcularRuta } from '../../comun/jobs/index.js';
import {
  EstatusNotaSalida,
  EstatusOrdenCompra,
  ResultadoAuditoria,
  TipoAuditoria,
  TipoEventoProceso,
  type TipoHitoOrden,
} from '../../datos/index.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';

/** Fecha de hoy a medianoche UTC (sin hora). Misma convención que el resto de la RC. */
function hoyUtc(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/** Clave estable de una celda color×talla (para los mapas de cantidades). */
function claveCelda(idColor: number, idTalla: number): string {
  return `${idColor}:${idTalla}`;
}

/**
 * Bloqueo de las CAPTURAS de una orden (advisory lock transaccional por empresa+orden). MISMA
 * fórmula/llave que `cumplimiento.ts` (`bloquearCapturasDeOrden`) y que las etapas de producción
 * (`etapas.ts`): así una captura manual concurrente y el auto-avance de la MISMA orden se serializan
 * (no se pisan al activar sucesores / des-completar). Órdenes distintas NO se bloquean entre sí.
 */
async function bloquearCapturasDeOrden(tx: Tx, idEmpresa: number, idOrden: number): Promise<void> {
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x4f000000) | 0;
  const clave2 = idOrden | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

// ── Mapeo evento → tipoEvento del proceso (ProcesoDef) ──────────────────────────────────────────

/** Etapa de producción tal como viaja en el evento (espejo de `TipoEtapaMovimiento`). */
type TipoEtapaEvento = 'corte' | 'envio_maquila' | 'recibo_maquila' | 'entrega_cliente';

/**
 * Traduce una ETAPA de producción (+ si su proceso de maquila es de costura) al `TipoEventoProceso`
 * del catálogo `ProcesoDef` que debe reaccionar. PURO (sin BD): unit-testeable.
 *
 *  • corte                       → corte
 *  • envio_maquila (costura)     → envioCostura      | (no costura) → envioEstampado
 *  • recibo_maquila (costura)    → reciboCostura     | (no costura) → reciboEstampado
 *  • entrega_cliente             → entregaCliente
 *
 * "Costura" = el `TipoProceso.generaEntradaPt` es true (es el que mete a PT; estampado/aplicación/
 * bordado/lavado = false). Verificado contra `seed-ruta-critica.ts` (envio-confeccion→envioCostura,
 * recepcion-confeccion→reciboCostura; envio-procesos→envioEstampado, recepcion-procesos→
 * reciboEstampado) y el modelo `TipoProceso`. Devuelve `null` para combinaciones sin proceso RC
 * (defensivo; hoy todas las etapas mapean).
 */
export function tipoEventoDeEtapa(
  tipoEtapa: TipoEtapaEvento,
  generaEntradaPt: boolean,
): TipoEventoProceso | null {
  switch (tipoEtapa) {
    case 'corte':
      return TipoEventoProceso.corte;
    case 'envio_maquila':
      return generaEntradaPt ? TipoEventoProceso.envioCostura : TipoEventoProceso.envioEstampado;
    case 'recibo_maquila':
      return generaEntradaPt ? TipoEventoProceso.reciboCostura : TipoEventoProceso.reciboEstampado;
    case 'entrega_cliente':
      return TipoEventoProceso.entregaCliente;
    default:
      return null;
  }
}

// ── Cálculo de completitud color×talla (puro) ───────────────────────────────────────────────────

/** Una celda con su cantidad (pedida o pasada por una etapa). */
export interface CeldaCantidad {
  idColor: number;
  idTalla: number;
  cantidad: number;
}

/** Resultado de comparar lo pasado por una etapa contra lo pedido. */
export interface ResultadoCompletitud {
  /** ¿Se cubrieron TODAS las celdas pedidas (pasado ≥ pedido en cada una)? */
  completo: boolean;
  /** ¿Pasó ALGO (> 0) por la etapa? (para distinguir "sin avance" de "parcial"). */
  hayAvance: boolean;
}

/**
 * Compara lo que PASÓ por una etapa (suma de etapas vivas) contra lo PEDIDO (matriz color×talla de la
 * orden). PURO: unit-testeable. Reglas (decisión (d)):
 *  • `completo` = TODA celda pedida tiene `pasado ≥ pedido` (sobre-cantidad NO rompe: ≥, no =). Las
 *    celdas pedidas con cantidad 0 se consideran cubiertas (no exigen avance). Si NO hay nada pedido
 *    (orden sin matriz), NO se considera completo (no hay nada que cubrir → evita falsos positivos).
 *  • `hayAvance` = pasó al menos 1 pieza por alguna celda.
 */
export function calcularCompletitud(
  pedido: readonly CeldaCantidad[],
  pasado: readonly CeldaCantidad[],
): ResultadoCompletitud {
  const mapaPasado = new Map<string, number>();
  for (const c of pasado) {
    mapaPasado.set(
      claveCelda(c.idColor, c.idTalla),
      (mapaPasado.get(claveCelda(c.idColor, c.idTalla)) ?? 0) + c.cantidad,
    );
  }
  const hayAvance = [...mapaPasado.values()].some((v) => v > 0);

  const celdasConCantidad = pedido.filter((c) => c.cantidad > 0);
  if (celdasConCantidad.length === 0) {
    // Orden sin nada pedido (>0): no hay nada que cubrir → no se auto-completa por evento.
    return { completo: false, hayAvance };
  }
  const completo = celdasConCantidad.every(
    (c) => (mapaPasado.get(claveCelda(c.idColor, c.idTalla)) ?? 0) >= c.cantidad,
  );
  return { completo, hayAvance };
}

// ── Lectura del estado físico de la orden (BD) ──────────────────────────────────────────────────

/** Matriz PEDIDA de la orden (Σ color×talla de `OrdenLinea`/`OrdenLineaTalla`). */
async function pedidoDeOrden(tx: Tx, idOrden: number): Promise<CeldaCantidad[]> {
  const tallas = await tx.ordenLineaTalla.findMany({
    where: { ordenLinea: { idOrden } },
    select: { idTalla: true, cantidad: true, ordenLinea: { select: { idColor: true } } },
  });
  return tallas.map((t) => ({
    idColor: t.ordenLinea.idColor,
    idTalla: t.idTalla,
    cantidad: t.cantidad,
  }));
}

/**
 * Suma color×talla de las ETAPAS VIVAS (no canceladas) de una orden de un `tipo` dado (y, si se da,
 * un `idTipoProceso`), leyendo `EtapaMovimientoDet` DIRECTO (sin acumuladores; ADR-0010 §3). Es la
 * base de "qué pasó físicamente" por corte/envío/recibo/entrega.
 */
async function sumarEtapas(
  tx: Tx,
  idOrden: number,
  tipo: TipoEtapaEvento,
  idTipoProceso: number | null,
): Promise<CeldaCantidad[]> {
  const filas = await tx.etapaMovimientoDet.findMany({
    where: {
      etapaMov: {
        idOrden,
        tipo,
        canceladoEn: null,
        ...(idTipoProceso === null ? {} : { idTipoProceso }),
      },
    },
    select: { idColor: true, idTalla: true, cantidad: true },
  });
  return filas.map((f) => ({ idColor: f.idColor, idTalla: f.idTalla, cantidad: f.cantidad }));
}

// ── Selección del renglón de RutaOrden por tipoEvento ───────────────────────────────────────────

/** Renglón de ruta mínimo para re-evaluar un proceso. */
interface RenglonRuta {
  id: number;
  idOrden: number;
  ultimoProceso: boolean;
  fechaReal: Date | null;
  estado: 'pendiente' | 'activo' | 'completado';
  origenCaptura: 'manual' | 'evento' | null;
  parcialEnCurso: boolean;
}

/**
 * Renglones VIVOS de la ruta de una orden cuyo `ProcesoDef.tipoEvento` = `tipoEvento`. `RutaOrden` NO
 * guarda snapshot de `tipoEvento`: se lee por FK a `ProcesoDef`. Puede haber 0, 1 o varios (p. ej.
 * dos procesos de costura en la ruta); el efecto se aplica a TODOS los que matcheen.
 */
async function renglonesPorTipoEvento(
  tx: Tx,
  idOrden: number,
  tipoEvento: TipoEventoProceso,
): Promise<RenglonRuta[]> {
  const filas = await tx.rutaOrden.findMany({
    where: { idOrden, procesoDef: { tipoEvento } },
    select: {
      id: true,
      idOrden: true,
      ultimoProceso: true,
      fechaReal: true,
      estado: true,
      origenCaptura: true,
      parcialEnCurso: true,
    },
  });
  return filas;
}

// ── Activación de sucesores / des-activación (decisión (f)) ─────────────────────────────────────

/**
 * Activa los SUCESORES del renglón recién completado cuyos antecesores estén TODOS completados
 * (pendiente → activo). COPIA local del de `cumplimiento.ts` (no se exporta allí); misma semántica.
 */
async function activarSucesoresListos(tx: Tx, idRutaCompletado: number): Promise<number[]> {
  const aristas = await tx.rutaOrdenDep.findMany({
    where: { idAntecesor: idRutaCompletado },
    select: { idRutaOrden: true },
  });
  const activados: number[] = [];
  for (const { idRutaOrden: idSuc } of aristas) {
    const sucesor = await tx.rutaOrden.findUnique({
      where: { id: idSuc },
      select: { id: true, estado: true },
    });
    if (sucesor === null || sucesor.estado !== 'pendiente') continue;
    const antecesores = await tx.rutaOrdenDep.findMany({
      where: { idRutaOrden: idSuc },
      select: { antecesor: { select: { estado: true } } },
    });
    const todosCompletos = antecesores.every((a) => a.antecesor.estado === 'completado');
    if (todosCompletos) {
      await tx.rutaOrden.update({ where: { id: idSuc }, data: { estado: 'activo' } });
      activados.push(idSuc);
    }
  }
  return activados;
}

/** Estado que corresponde a un renglón SIN cumplir según sus antecesores (activo si todos listos). */
async function estadoSegunAntecesores(
  tx: Tx,
  idRutaOrden: number,
): Promise<'pendiente' | 'activo'> {
  const antecesores = await tx.rutaOrdenDep.findMany({
    where: { idRutaOrden },
    select: { antecesor: { select: { estado: true } } },
  });
  if (antecesores.length === 0) return 'activo';
  return antecesores.every((a) => a.antecesor.estado === 'completado') ? 'activo' : 'pendiente';
}

/**
 * REVISA los SUCESORES ya activados de un renglón que se acaba de des-completar (decisión (f)): un
 * sucesor `activo` que ahora NO tiene todos sus antecesores completados vuelve a `pendiente`. NO toca
 * los `completado` (su cumplimiento ya capturado se conserva; revertir eso es un acto manual). Solo
 * baja 'activo'→'pendiente'. Devuelve los ids regresados a pendiente.
 */
async function revisarSucesoresTrasDescompletar(
  tx: Tx,
  idRutaDescompletado: number,
): Promise<number[]> {
  const aristas = await tx.rutaOrdenDep.findMany({
    where: { idAntecesor: idRutaDescompletado },
    select: { idRutaOrden: true },
  });
  const regresados: number[] = [];
  for (const { idRutaOrden: idSuc } of aristas) {
    const sucesor = await tx.rutaOrden.findUnique({
      where: { id: idSuc },
      select: { id: true, estado: true },
    });
    if (sucesor === null || sucesor.estado !== 'activo') continue; // no tocar completados/pendientes.
    const antecesores = await tx.rutaOrdenDep.findMany({
      where: { idRutaOrden: idSuc },
      select: { antecesor: { select: { estado: true } } },
    });
    const todosCompletos = antecesores.every((a) => a.antecesor.estado === 'completado');
    if (!todosCompletos) {
      await tx.rutaOrden.update({ where: { id: idSuc }, data: { estado: 'pendiente' } });
      regresados.push(idSuc);
    }
  }
  return regresados;
}

// ── Aplicación del efecto a un renglón (completar / parcial / des-completar) ─────────────────────

/**
 * Aplica el resultado de la RE-EVALUACIÓN a UN renglón de ruta, dentro de la tx (ya bloqueada la
 * orden). IDEMPOTENTE: el efecto depende SOLO del estado actual (completo/hayAvance), no del evento.
 *
 *  • completo  → marca `completado` con `origenCaptura='evento'` (PISA fecha manual, decisión (e)),
 *    `parcialEnCurso=false`, activa sucesores listos y cierra la RC si es terminal. Si ya estaba
 *    completado-por-evento y sin parcial, no reescribe (no-op idempotente).
 *  • parcial (hayAvance, no completo) → `parcialEnCurso=true` y NO completa. Si estaba completado por
 *    EVENTO, se des-completa (ahora hay menos: una etapa se canceló). Una completación MANUAL NO se
 *    pisa al pasar a parcial salvo que el evento la cubra del todo (decisión (e) solo pisa al COMPLETAR).
 *  • sin avance → `parcialEnCurso=false`; si estaba completado por EVENTO, se des-completa.
 *
 * `fechaFisica` = la fecha del HECHO FÍSICO que llevó la cantidad al tope (la `fecha` de la etapa /
 * recepción que disparó el evento), que es lo que se escribe como `fechaReal` al COMPLETAR (KPI D11
 * "cuándo": la fecha real del corte/recibo/recepción, NO el reloj del servidor). `capturadoEn` SÍ es
 * el sello de cuándo el sistema lo registró (`new Date()`).
 *
 * Registra Bitácora (A7) en cada cambio efectivo y devuelve si hubo un cambio que exija recalcular CPM.
 */
async function aplicarAProceso(
  tx: Tx,
  renglon: RenglonRuta,
  comp: ResultadoCompletitud,
  contexto: { evento: string; tipoEvento: TipoEventoProceso; fechaFisica: Date },
): Promise<boolean> {
  const eraCompletado = renglon.estado === 'completado';
  const eraManual = renglon.origenCaptura === 'manual';

  if (comp.completo) {
    // Ya completado por EVENTO y sin parcial pendiente: nada que cambiar (idempotente).
    if (eraCompletado && renglon.origenCaptura === 'evento' && !renglon.parcialEnCurso) {
      return false;
    }
    await tx.rutaOrden.update({
      where: { id: renglon.id },
      data: {
        // fechaReal = la fecha FÍSICA del hecho que completó el proceso (no hoyUtc): KPI D11 + "el
        // dato físico manda". `capturadoEn` sí es el sello de registro del sistema.
        fechaReal: contexto.fechaFisica,
        estado: 'completado',
        origenCaptura: 'evento', // el evento es autoritativo: PISA lo manual (decisión (e)).
        parcialEnCurso: false,
        capturadoEn: new Date(),
        // capturadoPorId queda intacto: si era manual conserva quién había capturado (traza); si no,
        // null (proceso de sistema, sin usuario). No se sobreescribe a null para no perder el rastro.
      },
    });
    const activados = await activarSucesoresListos(tx, renglon.id);
    if (renglon.ultimoProceso) {
      await tx.orden.update({ where: { id: renglon.idOrden }, data: { rcActiva: false } });
    }
    await registrarBitacora(tx, null, {
      entidad: 'RutaOrden',
      idEntidad: renglon.id,
      accion: 'OTRO',
      datos: {
        operacion: 'auto-avance-completar',
        evento: contexto.evento,
        tipoEvento: contexto.tipoEvento,
        idOrden: renglon.idOrden,
        fechaReal: contexto.fechaFisica.toISOString(), // fecha física escrita (traza).
        pisoCapturaManual: eraManual, // (e): rastro de que había una fecha manual y la pisó el evento.
        activados,
        cerroRc: renglon.ultimoProceso,
      },
    });
    return true;
  }

  // NO completo. ¿Hay avance? → parcial en curso. ¿Nada? → sin parcial.
  const parcialDeseado = comp.hayAvance;

  // Si estaba COMPLETADO por EVENTO y ahora no está cubierto (típico de una cancelación, decisión (f)):
  // des-completar. Una completación MANUAL no se des-completa por el auto-avance (la maneja el usuario).
  const debeDescompletar = eraCompletado && renglon.origenCaptura === 'evento';

  // Si no hay que des-completar y la marca de parcial ya está como se desea, no hay cambio (idempotente).
  if (!debeDescompletar && renglon.parcialEnCurso === parcialDeseado) {
    return false;
  }

  if (debeDescompletar) {
    const nuevoEstado = await estadoSegunAntecesores(tx, renglon.id);
    await tx.rutaOrden.update({
      where: { id: renglon.id },
      data: {
        fechaReal: null,
        estado: nuevoEstado,
        capturadoEn: null,
        capturadoPorId: null,
        origenCaptura: null,
        parcialEnCurso: parcialDeseado,
      },
    });
    const regresados = await revisarSucesoresTrasDescompletar(tx, renglon.id);
    if (renglon.ultimoProceso) {
      await tx.orden.update({ where: { id: renglon.idOrden }, data: { rcActiva: true } });
    }
    await registrarBitacora(tx, null, {
      entidad: 'RutaOrden',
      idEntidad: renglon.id,
      accion: 'OTRO',
      datos: {
        operacion: 'auto-avance-descompletar',
        evento: contexto.evento,
        tipoEvento: contexto.tipoEvento,
        idOrden: renglon.idOrden,
        nuevoEstado,
        parcialEnCurso: parcialDeseado,
        sucesoresRegresados: regresados,
        reabrioRc: renglon.ultimoProceso,
      },
    });
    return true;
  }

  // Solo cambia la marca de parcial (no estaba completado o estaba completado-manual: no se toca el
  // cumplimiento; solo se enciende/apaga la marca visible).
  await tx.rutaOrden.update({
    where: { id: renglon.id },
    data: { parcialEnCurso: parcialDeseado },
  });
  await registrarBitacora(tx, null, {
    entidad: 'RutaOrden',
    idEntidad: renglon.id,
    accion: 'OTRO',
    datos: {
      operacion: 'auto-avance-parcial',
      evento: contexto.evento,
      tipoEvento: contexto.tipoEvento,
      idOrden: renglon.idOrden,
      parcialEnCurso: parcialDeseado,
    },
  });
  return true;
}

// ── Re-evaluación por tipo de evento (orquestación dentro de la tx) ──────────────────────────────

/**
 * Re-evalúa todos los renglones de la ruta de `idOrden` cuyo proceso sea `tipoEvento`, comparando lo
 * pasado por la etapa física (`sumarEtapas` del `tipoEtapa`/`idTipoProceso`) contra lo pedido. Aplica
 * el efecto a cada uno. Devuelve si hubo algún cambio (para encolar el CPM). Bajo el lock de la orden.
 */
async function reevaluarEtapa(
  tx: Tx,
  params: {
    idOrden: number;
    tipoEvento: TipoEventoProceso;
    tipoEtapa: TipoEtapaEvento;
    idTipoProceso: number | null;
    idEtapaMovimiento: number;
    evento: string;
  },
): Promise<boolean> {
  const renglones = await renglonesPorTipoEvento(tx, params.idOrden, params.tipoEvento);
  if (renglones.length === 0) return false; // la ruta de la orden no tiene ese proceso: nada que hacer.

  const pedido = await pedidoDeOrden(tx, params.idOrden);
  const pasado = await sumarEtapas(tx, params.idOrden, params.tipoEtapa, params.idTipoProceso);
  const comp = calcularCompletitud(pedido, pasado);
  // Fecha FÍSICA = la de la etapa que disparó el evento (la que llevó la cantidad al tope, "cuándo se
  // completó"). Fallback a hoy si la etapa no existiera (defensivo).
  const fechaFisica = await fechaDeEtapa(tx, params.idEtapaMovimiento);

  let cambio = false;
  for (const renglon of renglones) {
    const c = await aplicarAProceso(tx, renglon, comp, {
      evento: params.evento,
      tipoEvento: params.tipoEvento,
      fechaFisica,
    });
    cambio = cambio || c;
  }
  return cambio;
}

/** Fecha (`@db.Date`, medianoche UTC) de una `EtapaMovimiento`; hoy UTC si no existe (defensivo). */
async function fechaDeEtapa(tx: Tx, idEtapaMovimiento: number): Promise<Date> {
  const etapa = await tx.etapaMovimiento.findUnique({
    where: { id: idEtapaMovimiento },
    select: { fecha: true },
  });
  return etapa?.fecha ?? hoyUtc();
}

/**
 * Re-evalúa `recepcionTela` de una orden (F5-E6). El denominador NO es color×talla (la tela no se mide
 * por la matriz de la prenda): se mide contra el SALDO de las líneas de TELA de las OCs ligadas a la
 * orden (R7). Criterio elegido: el proceso está COMPLETO cuando TODA línea de tela de una OC ligada a
 * la orden está recibida en su totalidad (Σ recibido en recepciones ACTIVAS ≥ cantidad pedida de la
 * línea); está en PARCIAL mientras se recibió algo pero no todo; sin avance si no se recibió nada. Si
 * la orden no tiene ninguna línea de tela ligada, NO se auto-completa (no hay denominador). Bajo el
 * lock de la orden. Devuelve si hubo cambio.
 *
 * (Se eligió el saldo de OC y no la entrada al kardex de tela porque la RC habla de "recepción de tela
 * contra la compra"; el kardex agrega lotes/colores que no mapean 1:1 a lo pedido en la OC.)
 */
async function reevaluarRecepcionTela(
  tx: Tx,
  idOrden: number,
  evento: string,
  fechaFisica: Date,
): Promise<boolean> {
  const renglones = await renglonesPorTipoEvento(tx, idOrden, TipoEventoProceso.recepcionTela);
  if (renglones.length === 0) return false;

  // Líneas de TELA de OCs ligadas a esta orden (R7), con lo pedido y lo recibido (recepciones activas).
  const lineas = await tx.ordenCompraLinea.findMany({
    where: { idOrden, idTela: { not: null } },
    select: {
      id: true,
      cantidad: true,
      recepcionLineas: {
        where: { recepcionCompra: { reversadaEn: null } },
        select: { cantidadRecibida: true },
      },
    },
  });

  const comp = completitudRecepcionTela(
    lineas.map((l) => ({
      pedido: Number(l.cantidad),
      recibido: l.recepcionLineas.reduce((s, r) => s + Number(r.cantidadRecibida), 0),
    })),
  );

  let cambio = false;
  for (const renglon of renglones) {
    const c = await aplicarAProceso(tx, renglon, comp, {
      evento,
      tipoEvento: TipoEventoProceso.recepcionTela,
      fechaFisica,
    });
    cambio = cambio || c;
  }
  return cambio;
}

/**
 * Completitud de `recepcionTela` a partir de (pedido, recibido) por línea de tela de OC. PURO:
 * unit-testeable. `completo` = hay al menos una línea Y todas tienen recibido ≥ pedido (tolerancia de
 * redondeo decimal). `hayAvance` = se recibió algo en alguna línea. Sin líneas → no completo.
 */
export function completitudRecepcionTela(
  lineas: readonly { pedido: number; recibido: number }[],
): ResultadoCompletitud {
  const TOLERANCIA = 1e-6;
  if (lineas.length === 0) return { completo: false, hayAvance: false };
  const hayAvance = lineas.some((l) => l.recibido > TOLERANCIA);
  const completo = lineas.every((l) => l.recibido + TOLERANCIA >= l.pedido);
  return { completo, hayAvance };
}

// ── Handler del consumidor (despacho por tipo) ──────────────────────────────────────────────────

/** Payload tipado de los eventos de ETAPA de producción (espejo de `EventoEtapaRc`). */
interface PayloadEtapa {
  idEmpresa: number;
  idOrden: number;
  idEtapaMovimiento: number;
  tipoEtapa: TipoEtapaEvento;
  idTipoProceso: number | null;
}

/** Payload tipado del evento de cancelación de recepción de tela (espejo de `…Cancelado`). */
interface PayloadMaterialCancelado {
  idEmpresa: number;
  idOrdenCompra: number;
  idRecepcion: number;
  idsOrden: number[];
}

/** Payload tipado del evento de auditoría de calidad resuelta (espejo de `EventoAuditoriaCalidad`). */
interface PayloadAuditoriaCalidad {
  idEmpresa: number;
  idOrden: number;
}

/** Payload tipado de los eventos `oc-tela-resuelta`/`surtido-avios-resuelto` (espejo de `EventoRcOrden`). */
interface PayloadRcOrden {
  idEmpresa: number;
  idOrden: number;
}

/** Payload tipado del evento `hito-orden-resuelto` (espejo de `EventoHitoOrden`). */
interface PayloadHitoOrden {
  idEmpresa: number;
  idOrden: number;
  tipo: TipoHitoOrden;
}

/**
 * Resuelve si el `idTipoProceso` de un envío/recibo es de COSTURA (`generaEntradaPt`). Lectura suelta
 * (no necesita la tx de escritura). `null` (corte/entrega) → false (no aplica).
 */
async function esProcesoCostura(tx: Tx, idTipoProceso: number | null): Promise<boolean> {
  if (idTipoProceso === null) return false;
  const tp = await tx.tipoProceso.findUnique({
    where: { id: idTipoProceso },
    select: { generaEntradaPt: true },
  });
  return tp?.generaEntradaPt ?? false;
}

/**
 * Procesa UN mensaje de la cola de eventos de dominio (F5-E6). Despacha por `tipo`, re-evalúa el/los
 * proceso(s) afectado(s) en UNA transacción (A2) bajo el lock de la orden, y —si hubo cambio— ENCOLA
 * el recálculo del CPM (fire-and-forget tras el commit, §11). IDEMPOTENTE.
 *
 * Maneja: etapas de producción (alta/cancelación), recepción de tela (alta y cancelación), auditoría
 * de calidad y las OC de tela/avíos resueltas (ver los bloques abajo). Cualquier tipo DESCONOCIDO se
 * ignora en silencio (idempotencia ante versiones nuevas o reintentos).
 *
 * Separado del wiring de pg-boss para invocarlo directo desde tests (sin cola viva), igual que el CPM.
 */
export async function procesarEventoAutoAvance(
  mensaje: MensajeEventoDominio,
  bd?: ContextoBd,
): Promise<void> {
  const { tipo, payload } = mensaje;

  // ── Eventos de ETAPA de producción (alta) ──────────────────────────────────────────────────
  if (
    tipo === EVENTOS_OUTBOX.corteRegistrado ||
    tipo === EVENTOS_OUTBOX.envioMaquilaRegistrado ||
    tipo === EVENTOS_OUTBOX.reciboMaquilaRegistrado ||
    tipo === EVENTOS_OUTBOX.entregaClienteRegistrada ||
    tipo === EVENTOS_OUTBOX.etapaCancelada ||
    tipo === EVENTOS_OUTBOX.reciboMaquilaCancelado ||
    tipo === EVENTOS_OUTBOX.entregaClienteCancelada
  ) {
    const p = payload as PayloadEtapa;
    await procesarEtapa(p, tipo, bd);
    return;
  }

  // ── Recepción de tela (alta) y su cancelación ──────────────────────────────────────────────
  if (tipo === EVENTOS_OUTBOX.materialRecibido) {
    // El alta de recepción re-evalúa `recepcionTela` de las órdenes ligadas a la recepción. El payload
    // de `material-recibido` (F4-E3) trae los materiales con su `idOrden`; reusamos esos.
    await procesarMaterialRecibido(payload, tipo, bd);
    return;
  }
  if (tipo === EVENTOS_OUTBOX.materialRecibidoCancelado) {
    const p = payload as PayloadMaterialCancelado;
    await procesarMaterialCancelado(p, tipo, bd);
    return;
  }

  // ── Auditoría de calidad capturada/cambiada (F6-E2 + auditoriaCorte post-F9) ────────────────
  if (tipo === EVENTOS_OUTBOX.auditoriaCalidadResuelta) {
    const p = payload as PayloadAuditoriaCalidad;
    await procesarAuditoriaCalidad(p, tipo, bd);
    return;
  }

  // ── OC de tela autorizada/cancelada → proceso `compraTela` (post-F9) ────────────────────────
  if (tipo === EVENTOS_OUTBOX.ocTelaResuelta) {
    const p = payload as PayloadRcOrden;
    await procesarOrdenSimple(p, tipo, reevaluarCompraTela, bd);
    return;
  }

  // ── Nota de avíos confirmada/cancelada → proceso `surtidoAvios` (post-F9) ───────────────────
  if (tipo === EVENTOS_OUTBOX.surtidoAviosResuelto) {
    const p = payload as PayloadRcOrden;
    await procesarOrdenSimple(p, tipo, reevaluarSurtidoAvios, bd);
    return;
  }

  // ── Hito de orden registrado/cancelado → proceso ligado al tipo (post-F9) ───────────────────
  if (tipo === EVENTOS_OUTBOX.hitoOrdenResuelto) {
    const p = payload as PayloadHitoOrden;
    await procesarHitoOrden(p, tipo, bd);
    return;
  }

  // ── Orden creada (rediseño R3, B5): la RC se programa SOLA ─────────────────────────────────
  if (tipo === EVENTOS_OUTBOX.ordenCreada) {
    const p = payload as EventoOrdenCreada;
    await procesarOrdenCreada(p, bd);
    return;
  }

  // Tipo desconocido: se ignora silenciosamente (otro consumidor podría manejarlo en el futuro).
}

/** Re-evalúa el/los proceso(s) RC afectado(s) por un evento de etapa de producción (alta o cancelación). */
async function procesarEtapa(p: PayloadEtapa, evento: string, bd?: ContextoBd): Promise<void> {
  const cambio = await enTransaccion(async (tx) => {
    await bloquearCapturasDeOrden(tx, p.idEmpresa, p.idOrden);
    const costura = await esProcesoCostura(tx, p.idTipoProceso);
    const tipoEvento = tipoEventoDeEtapa(p.tipoEtapa, costura);
    if (tipoEvento === null) return false;
    return reevaluarEtapa(tx, {
      idOrden: p.idOrden,
      tipoEvento,
      tipoEtapa: p.tipoEtapa,
      idTipoProceso: p.idTipoProceso,
      idEtapaMovimiento: p.idEtapaMovimiento,
      evento,
    });
  }, bd);

  if (cambio) await encolarRecalculo(p.idOrden, p.idEmpresa);
}

/** Re-evalúa `recepcionTela` de las órdenes ligadas a una recepción de tela recién registrada. */
async function procesarMaterialRecibido(
  payload: unknown,
  evento: string,
  bd?: ContextoBd,
): Promise<void> {
  // El payload de `material-recibido` (F4-E3) trae empresa + fecha de la recepción + materiales con su
  // idOrden. Reusamos su forma sin re-importar el tipo (es JSON opaco aquí). La `fecha` (YYYY-MM-DD) es
  // la fecha FÍSICA de la recepción → la que se escribe como fechaReal si completa `recepcionTela`.
  const p = payload as {
    idEmpresa: number;
    fecha?: string;
    materiales?: { idOrden: number | null }[];
  };
  const fechaFisica = fechaDeRecepcionPayload(p.fecha);
  const idsOrden = [
    ...new Set((p.materiales ?? []).map((m) => m.idOrden).filter((x): x is number => x !== null)),
  ];
  for (const idOrden of idsOrden) {
    const cambio = await enTransaccion(async (tx) => {
      await bloquearCapturasDeOrden(tx, p.idEmpresa, idOrden);
      return reevaluarRecepcionTela(tx, idOrden, evento, fechaFisica);
    }, bd);
    if (cambio) await encolarRecalculo(idOrden, p.idEmpresa);
  }
}

/** Convierte el `fecha` (YYYY-MM-DD) del payload de recepción a `Date` UTC; hoy si falta (defensivo). */
function fechaDeRecepcionPayload(fecha: string | undefined): Date {
  if (fecha === undefined || fecha === '') return hoyUtc();
  const d = new Date(`${fecha}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? hoyUtc() : d;
}

/** Re-evalúa `recepcionTela` de las órdenes de una recepción reversada (decisión (f)). */
async function procesarMaterialCancelado(
  p: PayloadMaterialCancelado,
  evento: string,
  bd?: ContextoBd,
): Promise<void> {
  for (const idOrden of p.idsOrden) {
    const cambio = await enTransaccion(async (tx) => {
      await bloquearCapturasDeOrden(tx, p.idEmpresa, idOrden);
      // Fecha física de respaldo (solo se usa en el caso raro de que el reverso deje el proceso AÚN
      // completo por OTRAS recepciones vivas): la fecha de la recepción reversada. El caso normal del
      // reverso es des-completar (fechaReal=null), que no usa esta fecha.
      const fechaFisica = await fechaDeRecepcion(tx, p.idRecepcion);
      return reevaluarRecepcionTela(tx, idOrden, evento, fechaFisica);
    }, bd);
    if (cambio) await encolarRecalculo(idOrden, p.idEmpresa);
  }
}

/**
 * Re-evalúa el proceso `auditoria` de una orden tras capturar/cambiar una auditoría (F6-E2). El estado
 * FÍSICO es: ¿la orden tiene una auditoría FINAL aprobada VIVA? Si sí → el proceso se auto-completa con
 * la fecha de esa auditoría; si no → se des-completa (decisión (f)). Idempotente (re-lee la BD, no
 * confía en el evento como delta). Las auditorías de PISO no completan el proceso (control intermedio).
 * Bajo el lock de la orden. Devuelve si hubo cambio.
 */
async function reevaluarAuditoria(tx: Tx, idOrden: number, evento: string): Promise<boolean> {
  const renglones = await renglonesPorTipoEvento(tx, idOrden, TipoEventoProceso.auditoria);
  if (renglones.length === 0) return false;

  const aprobada = await tx.auditoria.findFirst({
    where: {
      idOrden,
      cancelada: false,
      tipoAuditoria: TipoAuditoria.final,
      resultado: ResultadoAuditoria.aprobado,
    },
    orderBy: { fechaAuditoria: 'desc' },
    select: { fechaAuditoria: true },
  });
  const completo = aprobada !== null;
  const comp: ResultadoCompletitud = { completo, hayAvance: completo };
  const fechaFisica = aprobada?.fechaAuditoria ?? hoyUtc();

  let cambio = false;
  for (const renglon of renglones) {
    const c = await aplicarAProceso(tx, renglon, comp, {
      evento,
      tipoEvento: TipoEventoProceso.auditoria,
      fechaFisica,
    });
    cambio = cambio || c;
  }
  return cambio;
}

/**
 * Re-evalúa los procesos de auditoría de la orden de un evento de auditoría de calidad: `auditoria`
 * (F6-E2, la FINAL aprobada) y `auditoriaCorte` (post-F9, la de CORTE aprobada). El evento
 * `auditoria-calidad-resuelta` se emite en TODA captura/modificación/cancelación sin filtrar por tipo,
 * así que un solo consumidor cubre ambos procesos (cada re-lector filtra su `tipoAuditoria`). Los dos
 * van en la MISMA tx bajo el lock de la orden; si cualquiera cambió, se recalcula el CPM.
 */
async function procesarAuditoriaCalidad(
  p: PayloadAuditoriaCalidad,
  evento: string,
  bd?: ContextoBd,
): Promise<void> {
  const cambio = await enTransaccion(async (tx) => {
    await bloquearCapturasDeOrden(tx, p.idEmpresa, p.idOrden);
    const cambioFinal = await reevaluarAuditoria(tx, p.idOrden, evento);
    const cambioCorte = await reevaluarAuditoriaCorte(tx, p.idOrden, evento);
    return cambioFinal || cambioCorte;
  }, bd);
  if (cambio) await encolarRecalculo(p.idOrden, p.idEmpresa);
}

/**
 * Re-evalúa el proceso `auditoriaCorte` de una orden (post-F9). Espejo de `reevaluarAuditoria`, pero la
 * completa una auditoría de tipo `corte` APROBADA viva (control de calidad ANTES de coser). Idempotente
 * (relee el estado físico). Bajo el lock de la orden. Devuelve si hubo cambio.
 */
async function reevaluarAuditoriaCorte(tx: Tx, idOrden: number, evento: string): Promise<boolean> {
  const renglones = await renglonesPorTipoEvento(tx, idOrden, TipoEventoProceso.auditoriaCorte);
  if (renglones.length === 0) return false;

  const aprobada = await tx.auditoria.findFirst({
    where: {
      idOrden,
      cancelada: false,
      tipoAuditoria: TipoAuditoria.corte,
      resultado: ResultadoAuditoria.aprobado,
    },
    orderBy: { fechaAuditoria: 'desc' },
    select: { fechaAuditoria: true },
  });
  const completo = aprobada !== null;
  const comp: ResultadoCompletitud = { completo, hayAvance: completo };
  const fechaFisica = aprobada?.fechaAuditoria ?? hoyUtc();

  return aplicarCompATodos(tx, renglones, comp, {
    evento,
    tipoEvento: TipoEventoProceso.auditoriaCorte,
    fechaFisica,
  });
}

/**
 * Aplica un `ResultadoCompletitud` BINARIO (existe/no existe el hecho) a TODOS los renglones de un
 * tipoEvento (post-F9). Extrae el loop que comparten los re-lectores binarios (OC de tela, surtido de
 * avíos, auditoría de corte, hito). Devuelve si hubo algún cambio.
 */
async function aplicarCompATodos(
  tx: Tx,
  renglones: RenglonRuta[],
  comp: ResultadoCompletitud,
  contexto: { evento: string; tipoEvento: TipoEventoProceso; fechaFisica: Date },
): Promise<boolean> {
  let cambio = false;
  for (const renglon of renglones) {
    const c = await aplicarAProceso(tx, renglon, comp, contexto);
    cambio = cambio || c;
  }
  return cambio;
}

/**
 * Consume un evento SIMPLE de orden (`oc-tela-resuelta`/`surtido-avios-resuelto`, post-F9): re-evalúa el
 * proceso correspondiente con su re-lector físico bajo el lock de la orden, en UNA tx (A2). Si hubo
 * cambio, encola el recálculo del CPM. Idempotente (el re-lector relee el estado físico, no el evento).
 */
async function procesarOrdenSimple(
  p: PayloadRcOrden,
  evento: string,
  reevaluar: (tx: Tx, idEmpresa: number, idOrden: number, evento: string) => Promise<boolean>,
  bd?: ContextoBd,
): Promise<void> {
  const cambio = await enTransaccion(async (tx) => {
    await bloquearCapturasDeOrden(tx, p.idEmpresa, p.idOrden);
    return reevaluar(tx, p.idEmpresa, p.idOrden, evento);
  }, bd);
  if (cambio) await encolarRecalculo(p.idOrden, p.idEmpresa);
}

/**
 * Re-evalúa el proceso `compraTela` de una orden (post-F9). Está COMPLETO cuando existe una OC VIVA
 * (estatus autorizada / recibida_parcial / recibida_total, no cancelada) de la empresa con una línea de
 * TELA ligada a la orden. La fecha física = la de autorización de esa OC (`fechaAutorizado`). Si no hay
 * ninguna, se des-completa (decisión (f), típico de cancelar la OC). Bajo el lock. Devuelve si cambió.
 */
async function reevaluarCompraTela(
  tx: Tx,
  idEmpresa: number,
  idOrden: number,
  evento: string,
): Promise<boolean> {
  const renglones = await renglonesPorTipoEvento(tx, idOrden, TipoEventoProceso.compraTela);
  if (renglones.length === 0) return false;

  const oc = await tx.ordenCompra.findFirst({
    where: {
      idEmpresa,
      estatus: {
        in: [
          EstatusOrdenCompra.autorizada,
          EstatusOrdenCompra.recibida_parcial,
          EstatusOrdenCompra.recibida_total,
        ],
      },
      lineas: { some: { idOrden, idTela: { not: null } } },
    },
    orderBy: { fechaAutorizado: 'desc' },
    select: { fechaAutorizado: true },
  });
  const completo = oc !== null;
  const comp: ResultadoCompletitud = { completo, hayAvance: completo };
  const fechaFisica = oc?.fechaAutorizado ?? hoyUtc();

  return aplicarCompATodos(tx, renglones, comp, {
    evento,
    tipoEvento: TipoEventoProceso.compraTela,
    fechaFisica,
  });
}

/**
 * Re-evalúa el proceso `surtidoAvios` de una orden (post-F9). Está COMPLETO cuando existe una nota de
 * salida CONFIRMADA viva de la empresa con una línea de AVÍO para la orden. La fecha física = la
 * `fechaElaboracion` de esa nota (la que usa el descuento de kardex). Si no hay ninguna, se des-completa
 * (decisión (f), típico de cancelar la nota). Bajo el lock. Devuelve si cambió.
 */
async function reevaluarSurtidoAvios(
  tx: Tx,
  idEmpresa: number,
  idOrden: number,
  evento: string,
): Promise<boolean> {
  const renglones = await renglonesPorTipoEvento(tx, idOrden, TipoEventoProceso.surtidoAvios);
  if (renglones.length === 0) return false;

  const nota = await tx.notaSalida.findFirst({
    where: {
      idEmpresa,
      estatus: EstatusNotaSalida.confirmada,
      lineas: { some: { idOrden, idAvio: { not: null } } },
    },
    orderBy: { confirmadaEn: 'desc' },
    select: { fechaElaboracion: true },
  });
  const completo = nota !== null;
  const comp: ResultadoCompletitud = { completo, hayAvance: completo };
  const fechaFisica = nota?.fechaElaboracion ?? hoyUtc();

  return aplicarCompATodos(tx, renglones, comp, {
    evento,
    tipoEvento: TipoEventoProceso.surtidoAvios,
    fechaFisica,
  });
}

/**
 * Re-evalúa el proceso RC ligado a un HITO de la orden (post-F9). Mapea el tipo de hito a su
 * `TipoEventoProceso` (`tipoEventoDeHito`) y lo re-evalúa: está COMPLETO si existe un hito VIVO de ese
 * tipo en la orden; la fecha física = la `fecha` del hito. Si el hito se canceló y no queda otro vivo,
 * se des-completa (decisión (f)). Bajo el lock de la orden. Devuelve si hubo cambio.
 */
async function reevaluarHito(
  tx: Tx,
  idOrden: number,
  tipoHito: TipoHitoOrden,
  evento: string,
): Promise<boolean> {
  const tipoEvento = tipoEventoDeHito(tipoHito);
  const renglones = await renglonesPorTipoEvento(tx, idOrden, tipoEvento);
  if (renglones.length === 0) return false;

  const hito = await tx.hitoOrden.findFirst({
    where: { idOrden, tipo: tipoHito, canceladoEn: null },
    orderBy: { fecha: 'desc' },
    select: { fecha: true },
  });
  const completo = hito !== null;
  const comp: ResultadoCompletitud = { completo, hayAvance: completo };
  const fechaFisica = hito?.fecha ?? hoyUtc();

  return aplicarCompATodos(tx, renglones, comp, { evento, tipoEvento, fechaFisica });
}

/** Re-evalúa el proceso RC ligado al hito de un evento `hito-orden-resuelto` (post-F9). */
async function procesarHitoOrden(
  p: PayloadHitoOrden,
  evento: string,
  bd?: ContextoBd,
): Promise<void> {
  const cambio = await enTransaccion(async (tx) => {
    await bloquearCapturasDeOrden(tx, p.idEmpresa, p.idOrden);
    return reevaluarHito(tx, p.idOrden, p.tipo, evento);
  }, bd);
  if (cambio) await encolarRecalculo(p.idOrden, p.idEmpresa);
}

/** Fecha (`@db.Date`) de una `RecepcionCompra`; hoy UTC si no existe (defensivo). */
async function fechaDeRecepcion(tx: Tx, idRecepcion: number): Promise<Date> {
  const rec = await tx.recepcionCompra.findUnique({
    where: { id: idRecepcion },
    select: { fecha: true },
  });
  return rec?.fecha ?? hoyUtc();
}

/**
 * Encola (fire-and-forget) el recálculo del CPM de una orden tras un cambio del auto-avance (la ficha
 * lo pide: completar/des-completar puede mover las fechas planeadas). NO-OP si el motor de jobs está
 * inactivo (tests/CI). Nunca lanza al llamador.
 */
async function encolarRecalculo(idOrden: number, idEmpresa: number): Promise<void> {
  const payload: PayloadRecalcularRuta = { idOrden, idEmpresa, motivo: 'ajustar' };
  try {
    await encolarJob(COLAS_JOBS.recalcularRutaOrden, idOrden, payload);
  } catch {
    // El recálculo se puede re-disparar; no rompe el efecto ya consumado.
  }
}

/**
 * MANEJA un mensaje de la cola con la política de errores POR TIPO de evento (separado del wiring
 * de pg-boss para probarlo directo, sin cola viva):
 *
 *  • Eventos del AUTO-AVANCE F3→F5 (corte/envío/recibo/entrega/material/auditoría): atrapa y
 *    loguea SIN propagar — comportamiento preexistente de F5-E6 (evitar acumular reintentos por un
 *    error de datos puntual). NO cambiar.
 *  • `orden-creada` (R3-B5, hallazgo H2 del reviewer): un error INESPERADO deja bitácora AUDITABLE
 *    `rc-automatica-fallida` (best-effort: si la BD está caída, la bitácora no debe enmascarar el
 *    error original) y SE PROPAGA para que pg-boss REINTENTE — el consumidor es idempotente
 *    (`rcActiva` → no-op) y la ruta está blindada por sus uniques, así que reintentar es seguro.
 *    Sin esto, un parpadeo de BD dejaba la orden sin RC EN SILENCIO. Las omisiones CONTROLADAS
 *    (sin fecha de entrega, catálogos RC vacíos) NO lanzan: las resuelve `procesarOrdenCreada`
 *    con su propia bitácora `rc-automatica-omitida`.
 */
export async function manejarEventoAutoAvance(
  mensaje: MensajeEventoDominio,
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
  bd?: ContextoBd,
): Promise<void> {
  try {
    await procesarEventoAutoAvance(mensaje, bd);
  } catch (error) {
    if (mensaje.tipo === EVENTOS_OUTBOX.ordenCreada) {
      await registrarFalloRcAutomatica(mensaje, error, bd);
      registrarError(
        `RC automática: falló el evento "orden-creada" (fila ${String(mensaje.id)}); pg-boss reintenta.`,
        error,
      );
      throw error; // pg-boss reintenta (idempotente); si agota reintentos, queda la bitácora.
    }
    registrarError(
      `Auto-avance RC: falló el evento "${mensaje.tipo}" (fila ${String(mensaje.id)}).`,
      error,
    );
  }
}

/**
 * Registra el CONSUMIDOR del auto-avance en la cola de eventos de dominio (F5-E6). Lo llama el
 * bootstrap del servidor DESPUÉS de `iniciarColaEventos`. NO-OP si la cola está inactiva (tests/CI).
 * La política de errores vive en {@link manejarEventoAutoAvance}: los eventos F3→F5 se atrapan y
 * loguean (no propagan); `orden-creada` (RC automática, R3-B5) deja bitácora del fallo y PROPAGA
 * para que pg-boss reintente.
 *
 * @param registrarError hook para logear (por defecto `console.error`); el servidor inyecta el suyo.
 */
export async function registrarAutoAvanceRc(
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
): Promise<void> {
  await registrarConsumidorEventos((mensaje) => manejarEventoAutoAvance(mensaje, registrarError));
}

// Re-exporta el tipo para que el wiring/tests no dependan de `comun/cola-eventos` directamente.
export type { MensajeEventoDominio };
