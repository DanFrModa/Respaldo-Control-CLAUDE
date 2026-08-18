import { CalendarClock, Info, Printer, Route } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  urlPlanImpresoRc,
  useElegirSecuenciaEstampado,
  useRutaOrden,
} from '@/api/ruta-critica-programacion';
import type { RutaOrden, RutaOrdenProceso } from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSesion } from '@/sesion/useSesion';

import { EVENTO_RC_DESCRIPCION, esProcesoAutomatico, fechaRc } from './piezas';

/**
 * PANEL "Ruta de la orden" (rediseño R4 — proto §4.9): cajón deslizante con la línea de tiempo
 * vertical de la RC de UNA orden — semáforo por proceso (Hecho ✓ / Vencido / Hoy / Programado),
 * responsable (roles) con badge "tú", fecha compromiso y el renglón "⟳ Automático — al registrar…"
 * / "✋ Manual". Para las órdenes FLEXIBLES trae el control [Estampar ANTES]/[Estampar DESPUÉS]
 * que reprograma la ruta EN VIVO (B10). Si la orden NO tiene ruta, muestra el MOTIVO que dejó la
 * RC automática de R3 (bitácora) con el CTA "Programar ahora" (gated `rc.programar`).
 *
 * Se abre desde MIS PENDIENTES y desde el mosaico "Ruta crítica" del centro de Órdenes (R2): el
 * encabezado (folio/modelo/cliente/entrega) lo pasa el llamador porque el endpoint de la ruta no
 * repite esos datos. CERO lógica de negocio (A1): estados/holguras/secuencia los deriva el backend.
 */

/** Encabezado que el llamador ya tiene (la ruta no repite folio/modelo/cliente). */
export interface EncabezadoRutaOrden {
  folio?: number | string;
  modelo?: string;
  cliente?: string;
  /** Fecha de entrega comprometida (ISO), para el subtítulo. */
  fechaEntrega?: string | null;
}

/** Estado VISUAL de un renglón de la línea de tiempo (derivado de datos del backend). */
function estadoRenglon(p: RutaOrdenProceso): 'hecho' | 'vencido' | 'hoy' | 'programado' {
  if (p.estado === 'completado') return 'hecho';
  if (p.diasRestantes !== null && p.diasRestantes < 0) return 'vencido';
  if (p.diasRestantes === 0) return 'hoy';
  return 'programado';
}

const PUNTO: Record<ReturnType<typeof estadoRenglon>, string> = {
  hecho: 'bg-emerald-500',
  vencido: 'bg-red-600',
  hoy: 'bg-amber-500',
  programado: 'bg-border',
};

const ETIQUETA_ESTADO: Record<ReturnType<typeof estadoRenglon>, string> = {
  hecho: 'Hecho',
  vencido: 'Vencido',
  hoy: 'Hoy',
  programado: 'Programado',
};

const VARIANTE_BADGE: Record<
  ReturnType<typeof estadoRenglon>,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  hecho: 'secondary',
  vencido: 'destructive',
  hoy: 'outline',
  programado: 'outline',
};

/** Clase extra del badge por estado (S2 del review: "Hoy" en ÁMBAR, como el proto). */
const CLASE_BADGE: Partial<Record<ReturnType<typeof estadoRenglon>, string>> = {
  hoy: 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
};

/** ¿La ruta incluye la rama de estampado? (si no, el control de secuencia no aplica). */
function llevaEstampado(ruta: RutaOrden): boolean {
  return ruta.procesos.some(
    (p) => p.tipoEvento === 'reciboEstampado' || p.tipoEvento === 'envioEstampado',
  );
}

/** Panel deslizante con la ruta viva de una orden. Controlado por el llamador. */
export function PanelRutaOrden({
  idOrden,
  abierto,
  alCerrar,
  encabezado,
}: {
  idOrden: number | undefined;
  abierto: boolean;
  alCerrar: () => void;
  encabezado?: EncabezadoRutaOrden;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeProgramar = tienePermiso('rc.programar');
  // §Post-F9.68: el enlace al detalle completo solo para quien puede abrirlo.
  const puedeVerRuta = tienePermiso('rc.ruta-ver');

  const consulta = useRutaOrden(idOrden, {
    habilitado: abierto && idOrden !== undefined,
    pollearMientrasRecalcula: true,
  });
  const elegir = useElegirSecuenciaEstampado();
  const ruta = consulta.data;

  function elegirSecuencia(secuencia: 'antes' | 'despues'): void {
    if (idOrden === undefined) return;
    elegir.mutate(
      { idOrden, secuencia },
      {
        onSuccess: () =>
          toast.success(
            `Ruta reprogramada · arte ${secuencia === 'antes' ? 'ANTES' : 'DESPUÉS'} de coser.`,
          ),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const hechos = ruta?.procesos.filter((p) => p.estado === 'completado').length ?? 0;
  const titulo =
    encabezado?.folio !== undefined
      ? `Ruta de la orden ${String(encabezado.folio)}`
      : 'Ruta de la orden';
  const subtitulo = [
    encabezado?.modelo,
    encabezado?.cliente,
    encabezado?.fechaEntrega != null ? `entrega ${fechaRc(encabezado.fechaEntrega)}` : undefined,
  ]
    .filter((x): x is string => x !== undefined && x !== '')
    .join(' · ');

  return (
    <CajonDetalle
      abierto={abierto}
      alCambiarAbierto={(a) => {
        if (!a) alCerrar();
      }}
      titulo={
        <span className="inline-flex items-center gap-2">
          <Route className="size-4 text-primary" aria-hidden />
          {titulo}
        </span>
      }
      subtitulo={subtitulo === '' ? undefined : subtitulo}
      acciones={
        ruta !== undefined && ruta.estadoRecalculo !== 'sin-ruta' && idOrden !== undefined ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(urlPlanImpresoRc(idOrden), '_blank', 'noopener')}
              data-testid="panel-ruta-pdf"
            >
              <Printer className="size-4" aria-hidden />
              Plan (PDF)
            </Button>
            {puedeVerRuta ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void navigate(`/ruta-critica/ordenes/${idOrden}`)}
                data-testid="panel-ruta-detalle"
              >
                Ver detalle completo
              </Button>
            ) : null}
          </>
        ) : undefined
      }
      ancho="amplio"
    >
      {consulta.isPending && abierto ? (
        <p className="text-sm text-muted-foreground" data-testid="panel-ruta-cargando">
          Cargando la ruta…
        </p>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : ruta === undefined ? null : ruta.estadoRecalculo === 'sin-ruta' ? (
        <div className="space-y-3" data-testid="panel-ruta-sin-ruta">
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Esta orden no tiene Ruta Crítica generada.</p>
              <p className="mt-1" data-testid="panel-ruta-motivo">
                {ruta.motivoSinRuta ??
                  'No hay rastro de la programación automática; genera la ruta a mano.'}
              </p>
            </div>
          </div>
          {puedeProgramar && idOrden !== undefined ? (
            <Button
              onClick={() => void navigate(`/ruta-critica/ordenes/${idOrden}/programar`)}
              data-testid="panel-ruta-programar"
            >
              <CalendarClock className="size-4" aria-hidden />
              Programar ahora
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Ruta generada <b>hacia atrás</b> desde la entrega (CPM): cada proceso tiene su fecha
            compromiso y su responsable. La mayoría se marca <b>sola</b> al registrar su acción en
            el sistema. Avance {hechos}/{ruta.procesos.length}
            {ruta.estadoRecalculo === 'recalculando' ? ' · recalculando fechas…' : ''}.
          </p>

          {llevaEstampado(ruta) ? (
            <div
              className="rounded-lg border bg-secondary/60 p-3 text-sm"
              data-testid="panel-ruta-estampado"
            >
              <p>
                <b>Arte en esta orden:</b>{' '}
                {ruta.secuenciaEstampadoModelo === 'flexible' ? (
                  <>
                    <b>FLEXIBLE</b> — decídelo aquí en producción según la carga
                    {ruta.secEstampadoElegido !== null
                      ? ` (hoy: ${ruta.secEstampadoElegido === 'antes' ? 'ANTES' : 'DESPUÉS'} de coser)`
                      : ` (planeado: ${ruta.secuenciaEstampadoEfectiva === 'antes' ? 'ANTES' : 'DESPUÉS'} de coser)`}
                    :
                  </>
                ) : ruta.secuenciaEstampadoModelo === 'antes' ? (
                  <>
                    <b>ANTES de coser</b> — la confección espera al arte.
                  </>
                ) : (
                  <>
                    <b>DESPUÉS de coser.</b>
                  </>
                )}
              </p>
              {ruta.secuenciaEstampadoModelo === 'flexible' && puedeProgramar ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant={ruta.secuenciaEstampadoEfectiva === 'antes' ? 'default' : 'outline'}
                    size="sm"
                    disabled={elegir.isPending}
                    onClick={() => elegirSecuencia('antes')}
                    data-testid="panel-ruta-estampar-antes"
                  >
                    Estampar ANTES
                  </Button>
                  <Button
                    variant={ruta.secuenciaEstampadoEfectiva === 'despues' ? 'default' : 'outline'}
                    size="sm"
                    disabled={elegir.isPending}
                    onClick={() => elegirSecuencia('despues')}
                    data-testid="panel-ruta-estampar-despues"
                  >
                    Estampar DESPUÉS
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <ol className="space-y-2" data-testid="panel-ruta-procesos">
            {ruta.procesos.map((p) => {
              const estado = estadoRenglon(p);
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${
                    p.esResponsableActual ? 'bg-primary/5' : 'bg-card'
                  }`}
                  data-testid="panel-ruta-proceso"
                  data-estado={estado}
                >
                  <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${PUNTO[estado]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {p.nombreProceso}{' '}
                      {p.esResponsableActual ? (
                        <Badge variant="outline" className="ml-1 align-middle text-[10px]">
                          tú
                        </Badge>
                      ) : null}
                      {p.parcialEnCurso ? (
                        <Badge
                          variant="outline"
                          className="ml-1 border-amber-400 align-middle text-[10px] text-amber-700 dark:border-amber-600 dark:text-amber-300"
                        >
                          Parcial en curso
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Responsable:{' '}
                      <b>{p.rolesResponsables.length > 0 ? p.rolesResponsables.join(', ') : '—'}</b>
                    </p>
                    <p className="text-[11px] text-muted-foreground/80">
                      {esProcesoAutomatico(p.tipoEvento)
                        ? `⟳ Automático — al registrar: ${EVENTO_RC_DESCRIPCION[p.tipoEvento]}`
                        : '✋ Manual — se marca a mano'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs tabular-nums">
                      {fechaRc(p.fechaReal ?? p.fechaPlaneadaVigente)}
                    </p>
                    <Badge
                      variant={VARIANTE_BADGE[estado]}
                      className={`mt-0.5 text-[10px] ${CLASE_BADGE[estado] ?? ''}`}
                    >
                      {ETIQUETA_ESTADO[estado]}
                      {estado === 'programado' && p.diasRestantes !== null
                        ? ` · +${String(p.diasRestantes)} d`
                        : ''}
                      {estado === 'vencido' && p.diasRestantes !== null
                        ? ` · ${String(p.diasRestantes)} d`
                        : ''}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </CajonDetalle>
  );
}
