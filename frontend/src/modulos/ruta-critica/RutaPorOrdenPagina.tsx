import { CalendarClock, Loader2, Printer, User } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { urlPlanImpresoRc, useRutaOrden } from '@/api/ruta-critica-programacion';
import type { RutaOrden, RutaOrdenProceso } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatearFechaHora } from '@/lib/formato';
import { useSesion } from '@/sesion/useSesion';

import { Semaforo, fechaRc } from './piezas';

/** Etiqueta legible del estado de un proceso de la ruta. */
const ETIQUETA_ESTADO: Record<RutaOrdenProceso['estado'], string> = {
  pendiente: 'Pendiente',
  activo: 'Activo',
  completado: 'Completado',
};

/** Variante del badge del estado del proceso. */
const VARIANTE_ESTADO: Record<RutaOrdenProceso['estado'], 'secondary' | 'default'> = {
  pendiente: 'secondary',
  activo: 'default',
  completado: 'default',
};

/** Etiqueta legible del estado del cálculo de fechas (CPM). */
const ETIQUETA_RECALCULO: Record<RutaOrden['estadoRecalculo'], string> = {
  calculado: 'Fechas listas',
  recalculando: 'Recalculando…',
  'sin-ruta': 'Sin ruta',
};

/**
 * RC POR ORDEN (F5-E5) — vista de CONSULTA de la ruta viva de una orden: timeline de procesos con su
 * estado, semáforo, fecha planeada (vigente y original), fecha real, quién capturó y cuándo, y el
 * origen (manual/evento). Encabezado con el semáforo de la orden, la fecha de entrega y el estado
 * del recálculo. Aquí NO se captura (eso vive en la Bandeja); solo se lee. Responsive: cada proceso
 * es una card en móvil y una fila en PC. La gobierna `rc.ruta-ver`.
 */
export function RutaPorOrdenPagina(): React.JSX.Element {
  const { idOrden: idOrdenParam } = useParams<{ idOrden: string }>();
  const idOrden = idOrdenParam !== undefined ? Number(idOrdenParam) : undefined;
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeProgramar = tienePermiso('rc.programar');

  // Sondea mientras el CPM recalcula, para que las fechas aparezcan solas al terminar.
  const consulta = useRutaOrden(idOrden, { pollearMientrasRecalcula: true });
  const ruta = consulta.data;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
                Ruta Crítica de la orden
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                Avance de los procesos: plan vs real, con quién y cuándo capturó cada uno.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Impreso del plan: solo si la orden YA tiene una RC generada (PDF server-side). */}
            {idOrden !== undefined && ruta?.rcActiva ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(urlPlanImpresoRc(idOrden), '_blank', 'noopener')}
                data-testid="imprimir-plan-rc"
              >
                <Printer className="mr-1.5 size-4" aria-hidden />
                Imprimir plan
              </Button>
            ) : null}
            {puedeProgramar && idOrden !== undefined ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate(`/ruta-critica/ordenes/${idOrden}/programar`)}
                data-testid="ir-programar-rc"
              >
                Programar / ajustar
              </Button>
            ) : null}
          </div>
        </header>

        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="rc-cargando">
            Cargando ruta…
          </p>
        ) : consulta.isError ? (
          <p className="text-sm text-destructive" role="alert" data-testid="rc-error">
            {consulta.error.message}
          </p>
        ) : ruta === undefined || !ruta.rcActiva ? (
          <div
            className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
            data-testid="rc-sin-ruta"
          >
            Esta orden todavía no tiene una Ruta Crítica programada.
            {puedeProgramar && idOrden !== undefined ? (
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => void navigate(`/ruta-critica/ordenes/${idOrden}/programar`)}
                  data-testid="rc-programar-ahora"
                >
                  Programar ahora
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {/* Encabezado de la ruta: semáforo de la orden + fechas + recálculo. */}
            <div
              className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card p-4"
              data-testid="rc-encabezado"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Estado general</span>
                <Semaforo semaforo={ruta.semaforo} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Inicio</span>
                <span className="text-sm">{fechaRc(ruta.fechaInicioRC)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Entrega</span>
                <span className="text-sm font-medium">{fechaRc(ruta.fechaEntregaRC)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Cálculo</span>
                <span className="inline-flex items-center gap-1.5 text-sm">
                  {ruta.estadoRecalculo === 'recalculando' ? (
                    <Loader2 className="size-3.5 animate-spin text-amber-600" aria-hidden />
                  ) : null}
                  {ETIQUETA_RECALCULO[ruta.estadoRecalculo]}
                </span>
              </div>
              {ruta.esResurtido ? <Badge variant="secondary">Resurtido</Badge> : null}
            </div>

            {ruta.advertencias.length > 0 ? (
              <ul
                className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                data-testid="rc-advertencias"
              >
                {ruta.advertencias.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : null}

            {/* Timeline de procesos: card por proceso (legible en móvil y PC). */}
            <ol className="space-y-3" data-testid="rc-procesos">
              {ruta.procesos.map((p) => (
                <ProcesoRenglon key={p.id} proceso={p} />
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

/** Un proceso de la ruta como card: nombre, estado, semáforo, plan vs real y captura. */
function ProcesoRenglon({ proceso }: { proceso: RutaOrdenProceso }): React.JSX.Element {
  return (
    <li
      className="rounded-lg border bg-card p-4"
      data-testid="rc-proceso"
      data-estado={proceso.estado}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">{proceso.secuencia}.</span>
          <span className="truncate font-medium">{proceso.nombreProceso}</span>
          {proceso.critico ? (
            <Badge variant="destructive" className="shrink-0">
              Crítico
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {proceso.parcialEnCurso ? (
            <Badge
              variant="outline"
              className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300"
              data-testid="rc-proceso-parcial"
            >
              Parcial en curso
            </Badge>
          ) : null}
          <Badge variant={VARIANTE_ESTADO[proceso.estado]}>{ETIQUETA_ESTADO[proceso.estado]}</Badge>
          <Semaforo semaforo={proceso.semaforo} />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Planeada vigente</dt>
          <dd className="mt-0.5 font-medium">{fechaRc(proceso.fechaPlaneadaVigente)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Planeada original</dt>
          <dd className="mt-0.5">{fechaRc(proceso.fechaPlaneadaOriginal)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Real</dt>
          <dd className="mt-0.5">{fechaRc(proceso.fechaReal)}</dd>
        </div>
      </dl>

      {proceso.capturadoPorNombre !== null || proceso.capturadoEn !== null ? (
        <p
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
          data-testid="rc-proceso-captura"
        >
          <span className="inline-flex items-center gap-1">
            <User className="size-3.5" aria-hidden />
            {proceso.capturadoPorNombre ?? 'Sistema'}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden />
            {formatearFechaHora(proceso.capturadoEn)}
          </span>
          {proceso.origenCaptura !== null ? (
            <Badge variant="secondary" className="font-normal">
              {proceso.origenCaptura === 'evento' ? 'Automático' : 'Manual'}
            </Badge>
          ) : null}
        </p>
      ) : null}

      {proceso.checklist.length > 0 ? (
        <ul className="mt-3 space-y-1" data-testid="rc-proceso-checklist">
          {proceso.checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className={`inline-block size-2 rounded-full ${
                  item.hecho ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                }`}
              />
              <span className={item.hecho ? 'text-muted-foreground line-through' : ''}>
                {item.descripcion}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
