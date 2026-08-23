import type { SemaforoRc, TipoEventoProceso } from '@/api/tipos';
import type { ClaveEtapaAvance } from '@/modulos/produccion/etapas-avance';

/**
 * Piezas compartidas (COMPONENTES) de las vistas del MOTOR de la Ruta Crítica (F5-E5; R4): el
 * SEMÁFORO tri-estado (`aTiempo` / `enRiesgo` / `atrasado`) que pintan la bandeja, la RC por orden
 * y el badge del header, y los mapas de PRESENTACIÓN del tipo de evento (auto vs manual). CERO
 * lógica de negocio (A1): el valor lo DERIVA el backend; aquí solo se PRESENTA.
 */

/** Color del punto del semáforo por estado (emerald / amber / red). */
const COLOR_SEMAFORO_RC: Record<SemaforoRc, string> = {
  aTiempo: 'bg-emerald-500',
  enRiesgo: 'bg-amber-500',
  atrasado: 'bg-red-600',
};

/** Etiqueta legible del semáforo (para el texto/aria). */
const ETIQUETA_SEMAFORO_RC: Record<SemaforoRc, string> = {
  aTiempo: 'A tiempo',
  enRiesgo: 'En riesgo',
  atrasado: 'Atrasado',
};

/**
 * Indicador de SEMÁFORO de cumplimiento de un proceso/orden de la RC: un punto de color + la
 * etiqueta. El valor lo DERIVA el backend (HOY vs fecha planeada vigente); aquí solo se pinta.
 * Con `soloPunto` se omite el texto (para listas muy densas).
 */
export function Semaforo({
  semaforo,
  soloPunto = false,
}: {
  semaforo: SemaforoRc;
  soloPunto?: boolean;
}): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      data-testid="semaforo-rc"
      data-semaforo={semaforo}
      title={ETIQUETA_SEMAFORO_RC[semaforo]}
    >
      <span
        aria-hidden
        className={`inline-block size-2.5 shrink-0 rounded-full ${COLOR_SEMAFORO_RC[semaforo]}`}
      />
      {soloPunto ? (
        <span className="sr-only">{ETIQUETA_SEMAFORO_RC[semaforo]}</span>
      ) : (
        ETIQUETA_SEMAFORO_RC[semaforo]
      )}
    </span>
  );
}

/**
 * Formatea una fecha de la RC como "13 jun 2026" SIN desfase de zona (no usa `new Date(iso)`, que
 * interpreta el datetime como UTC y puede correr el día). Acepta tanto date-only `YYYY-MM-DD` como
 * datetime ISO completo `YYYY-MM-DDTHH:mm:ss.sssZ` (el contrato serializa las fechas con
 * `z.iso.datetime()`): toma solo los primeros 10 caracteres (la parte de fecha) antes de parsear.
 * `null` / vacío / fecha inválida -> "—".
 */
export function fechaRc(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') {
    return '—';
  }
  const soloFecha = valor.slice(0, 10);
  const [a, m, d] = soloFecha.split('-').map(Number);
  if (
    a === undefined ||
    m === undefined ||
    d === undefined ||
    Number.isNaN(a) ||
    Number.isNaN(m) ||
    Number.isNaN(d)
  ) {
    return '—';
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ── Auto-completado por evento (R4): mapas de PRESENTACIÓN del tipoEvento ─────

/** ¿El proceso se completa SOLO (por un evento del sistema)? `manual` = a mano. */
export function esProcesoAutomatico(tipoEvento: TipoEventoProceso): boolean {
  return tipoEvento !== 'manual';
}

/**
 * Descripción del EVENTO que auto-completa cada proceso (proto: "⟳ auto — al registrar: …").
 * Solo texto de presentación; el mapeo real evento→proceso vive en el auto-avance del backend.
 */
export const EVENTO_RC_DESCRIPCION: Record<TipoEventoProceso, string> = {
  recepcionTela: 'la recepción de material (Compras)',
  corte: 'el corte (Avance de producción)',
  envioCostura: 'el envío a maquila (Avance)',
  reciboCostura: 'el recibo de maquila (Avance)',
  envioEstampado: 'el envío a arte (Avance)',
  reciboEstampado: 'el recibo de arte (Avance)',
  auditoria: 'la auditoría AQL (Calidad)',
  autorizacionArte: 'el arte autorizado (hito de la orden)',
  entregaCliente: 'la entrega a cliente (Almacén)',
  manual: 'se marca a mano',
  revisionOp: 'la revisión de la orden (hito de la orden)',
  autorizacionFit: 'la autorización de fit (hito de la orden)',
  autorizacionTono: 'la autorización de tono de tela (hito de la orden)',
  autorizacionAvios: 'la autorización de avíos (hito de la orden)',
  compraTela: 'la orden de compra de tela autorizada (Compras)',
  surtidoAvios: 'la nota de salida de avíos confirmada (Producción)',
  auditoriaCorte: 'la auditoría de corte aprobada (Calidad)',
  empaque: 'el empaque (hito de la orden)',
};

/**
 * A DÓNDE lleva el botón "Registrar" de Mis pendientes para cada evento, en UNA sola tabla (V1-E3a:
 * antes eran dos —ruta y extras del deep-link— y podían desincronizarse).
 *
 *  • `ruta: null`  → no hay pantalla donde registrarlo: la UI ofrece "Marcar hecho".
 *  • `conOrden`    → esa pantalla ENTIENDE `state.idOrden`, así que se llega a LA orden del
 *                    pendiente y no a una lista de cientos (Centro de Órdenes y entrega a cliente).
 *  • `etapaAvance` → además abre el PANEL DE AVANCE de esa orden EN SU ETAPA. El corte, el envío y
 *                    el recibo se capturan ahí desde que se retiraron las tres pantallas sueltas
 *                    (una sola pantalla por acto, §Post-F9.36 punto 2); sin la etapa, un pendiente
 *                    de "recibo de estampado" aterrizaba en «Corte» y había que buscar el paso.
 *                    El tipo se DERIVA de `ClaveEtapaAvance` (menos «entrega-cliente», que tiene su
 *                    propia pantalla y no se captura en el panel): si alguien renombra una clave en
 *                    `etapas-avance.ts`, esto deja de compilar en vez de caer en silencio a «Corte»
 *                    (que es lo que haría `esClaveEtapaAvance` al rechazar la clave vieja).
 */
export const PANTALLA_EVENTO: Record<
  TipoEventoProceso,
  {
    readonly ruta: string | null;
    readonly conOrden?: true;
    readonly etapaAvance?: Exclude<ClaveEtapaAvance, 'entrega-cliente'>;
  }
> = {
  recepcionTela: { ruta: '/compras/recepcion' },
  corte: { ruta: '/produccion/ordenes', conOrden: true, etapaAvance: 'corte' },
  envioCostura: { ruta: '/produccion/ordenes', conOrden: true, etapaAvance: 'entrega-maquila' },
  reciboCostura: { ruta: '/produccion/ordenes', conOrden: true, etapaAvance: 'recibo-maquila' },
  envioEstampado: {
    ruta: '/produccion/ordenes',
    conOrden: true,
    etapaAvance: 'entrega-aplicacion',
  },
  reciboEstampado: {
    ruta: '/produccion/ordenes',
    conOrden: true,
    etapaAvance: 'recibo-aplicacion',
  },
  auditoria: { ruta: '/calidad/auditorias/nueva' },
  autorizacionArte: { ruta: null },
  entregaCliente: { ruta: '/produccion/entregas', conOrden: true },
  manual: { ruta: null },
  // Hitos de la orden (post-F9): se registran en el detalle de la orden (sin pantalla propia estática
  // → "Marcar hecho"); compra de tela / surtido de avíos / auditoría de corte sí tienen su pantalla.
  revisionOp: { ruta: null },
  autorizacionFit: { ruta: null },
  autorizacionTono: { ruta: null },
  autorizacionAvios: { ruta: null },
  compraTela: { ruta: '/compras/autorizacion' },
  surtidoAvios: { ruta: '/produccion/notas-salida' },
  auditoriaCorte: { ruta: '/calidad/auditorias/nueva' },
  empaque: { ruta: null },
};
