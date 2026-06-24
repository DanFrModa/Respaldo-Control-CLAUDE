/**
 * Despachador MÍNIMO de eventos de dominio (F3-E1, ADR-0010 §6).
 *
 * El recibo de maquila es el "punto de integración central" (PLANMAESTRO §5): de un solo hecho
 * de negocio se derivan WIP, inventario, cargo EsMa y —en F5— el AUTO-AVANCE de la Ruta Crítica.
 * Para no acoplar el dominio de producción a la RC (que aún no existe), los servicios de F3
 * EMITEN eventos (`corte-registrado`, `envio-registrado`, `recibo-registrado`) y F5 SUSCRIBIRÁ
 * sus consumidores. En F3-E1 esto es SOLO el gancho: hay despachador y se puede suscribir, pero
 * NADIE escucha todavía.
 *
 * Reglas de diseño (ADR-0010 §6):
 *  • Los eventos se emiten DESPUÉS del commit de la transacción de dominio (un suscriptor que
 *    falle NO debe revertir el hecho de negocio ya consumado). Por eso `emitir` es best-effort:
 *    si un manejador lanza, se registra y se sigue con los demás (nunca propaga al llamador).
 *  • Liviano y en proceso (sin pg-boss aquí): F5 decidirá si los consumidores corren en línea o
 *    se encolan. La firma `Promise<void>` ya permite manejadores asíncronos sin cambiar el API.
 *  • El contrato de cada evento lleva lo mínimo para que un consumidor reaccione (ids + tipo de
 *    proceso); el consumidor relee de la BD lo que necesite.
 */
import type { TipoEtapaMovimiento } from '../datos/index.js';

/** Nombres de los eventos de dominio que F3 emite (gancho para la RC de F5). */
export const EVENTOS_PRODUCCION = {
  corteRegistrado: 'corte-registrado',
  envioRegistrado: 'envio-registrado',
  reciboRegistrado: 'recibo-registrado',
  entregaRegistrado: 'entrega-registrado',
} as const;

/** Nombre de evento válido. */
export type NombreEvento = (typeof EVENTOS_PRODUCCION)[keyof typeof EVENTOS_PRODUCCION];

/**
 * Carga de un evento de etapa de producción. Lleva lo MÍNIMO: qué etapa de qué orden se
 * registró y, en envíos/recibos, su tipo de proceso. El consumidor (F5) relee el resto.
 */
export interface EventoEtapaProduccion {
  /** Id de la `EtapaMovimiento` que se acaba de registrar. */
  idEtapaMovimiento: number;
  /** Orden a la que pertenece. */
  idOrden: number;
  /** Empresa (A9). */
  idEmpresa: number;
  /** Tipo de etapa (corte/envío/recibo/entrega). */
  tipo: TipoEtapaMovimiento;
  /** Tipo de proceso de maquila (solo envíos/recibos; null en corte/entrega). */
  idTipoProceso: number | null;
}

/** Un manejador de eventos: reacciona a la carga; puede ser asíncrono. */
export type ManejadorEvento = (carga: EventoEtapaProduccion) => void | Promise<void>;

/** Registro de suscriptores por nombre de evento. */
const suscriptores = new Map<NombreEvento, Set<ManejadorEvento>>();

/**
 * Suscribe un manejador a un evento de dominio. Devuelve una función para des-suscribir
 * (útil en tests). En F3-E1 no hay consumidores reales; F5 los registrará aquí.
 */
export function suscribir(evento: NombreEvento, manejador: ManejadorEvento): () => void {
  const conjunto = suscriptores.get(evento) ?? new Set<ManejadorEvento>();
  conjunto.add(manejador);
  suscriptores.set(evento, conjunto);
  return () => {
    conjunto.delete(manejador);
  };
}

/**
 * Emite un evento de dominio a todos sus suscriptores. BEST-EFFORT (ADR-0010 §6): se debe
 * llamar DESPUÉS del commit; si un manejador lanza, se registra el error y se continúa con los
 * demás — JAMÁS propaga al llamador (el hecho de negocio ya está consumado y no debe revertirse
 * por un consumidor). Los manejadores se ejecutan en serie (orden de suscripción).
 *
 * @param evento  nombre del evento (de {@link EVENTOS_PRODUCCION}).
 * @param carga   datos del evento.
 * @param registrarError  hook opcional para logear el fallo de un manejador (por defecto,
 *                        `console.error`); permite a los tests/servidor inyectar su logger.
 */
export async function emitir(
  evento: NombreEvento,
  carga: EventoEtapaProduccion,
  registrarError: (evento: NombreEvento, error: unknown) => void = (ev, err) => {
    console.error(`Manejador del evento "${ev}" falló (best-effort, no revierte el negocio):`, err);
  },
): Promise<void> {
  const conjunto = suscriptores.get(evento);
  if (conjunto === undefined || conjunto.size === 0) {
    return; // sin consumidores (el caso de F3-E1): no-op.
  }
  for (const manejador of conjunto) {
    try {
      await manejador(carga);
    } catch (error) {
      registrarError(evento, error);
    }
  }
}

/** Limpia TODOS los suscriptores (solo para tests — evita fugas entre casos). */
export function limpiarSuscriptores(): void {
  suscriptores.clear();
}
