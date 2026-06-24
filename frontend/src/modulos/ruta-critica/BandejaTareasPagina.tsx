import { CheckCircle2, Inbox, Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  useBandejaRc,
  useCapturarCumplimientoRc,
  useMarcarChecklistRc,
} from '@/api/ruta-critica-programacion';
import type { TareaRc } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { Semaforo, fechaRc } from './piezas';

/** Renglones por página de la bandeja. */
const POR_PAGINA = 20;

/**
 * Devuelve una fecha date-only `YYYY-MM-DD` desplazada `dias` respecto a HOY, en hora LOCAL (sin el
 * desfase de `toISOString()`, que usa UTC). `dias = 0` -> hoy; `dias = -1` -> ayer.
 */
function fechaLocal(dias: number): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  const a = f.getFullYear();
  const m = String(f.getMonth() + 1).padStart(2, '0');
  const d = String(f.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}

/**
 * BANDEJA DE TAREAS (F5-E5) — "mis tareas activas" de la Ruta Crítica, ya ordenadas por urgencia por
 * el backend. Por cada tarea: semáforo, folio/cliente/modelo, proceso, fecha planeada y días de
 * atraso, con CAPTURA RÁPIDA ("Hoy"/"Ayer") y su checklist. CERO lógica de negocio (A1): el orden, el
 * semáforo, el estado y los días de atraso los DERIVA el backend; aquí solo se pinta y se disparan
 * mutaciones (al éxito, la tarea desaparece y se activan sus sucesores). Responsive: card por tarea
 * en móvil, fila densa en PC. La gobierna `rc.ruta-ver`; capturar exige `rc.capturar`.
 */
export function BandejaTareasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const navigate = useNavigate();
  const puedeCapturar = tienePermiso('rc.capturar');
  const puedeSupervisar = tienePermiso('rc.programar');

  const [textoCliente, setTextoCliente] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 300);
  const [verTodas, setVerTodas] = useState(false);
  const [pagina, setPagina] = useState(1);

  const consulta = useBandejaRc({
    pagina,
    porPagina: POR_PAGINA,
    ...(busquedaCliente.length > 0 ? { busquedaCliente } : {}),
    ...(puedeSupervisar && verTodas ? { todas: 'true' } : {}),
  });

  const datos = consulta.data;
  const tareas = datos?.datos ?? [];
  const totalPaginas = datos?.totalPaginas ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <Inbox className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Bandeja de tareas</h1>
            <p className="text-sm text-muted-foreground">
              Tus procesos pendientes de la Ruta Crítica, ordenados por urgencia.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-8"
              placeholder="Buscar por cliente…"
              value={textoCliente}
              onChange={(e) => {
                setTextoCliente(e.target.value);
                setPagina(1);
              }}
              data-testid="bandeja-buscar-cliente"
            />
          </div>
          {puedeSupervisar ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={verTodas}
                onChange={(e) => {
                  setVerTodas(e.target.checked);
                  setPagina(1);
                }}
                data-testid="bandeja-ver-todas"
              />
              Ver todas (supervisión)
            </label>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="bandeja-cargando">
            Cargando tareas…
          </p>
        ) : consulta.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive" data-testid="bandeja-error">
              {consulta.error.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : tareas.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            data-testid="bandeja-vacia"
          >
            No tienes tareas pendientes. ¡Todo al día!
          </div>
        ) : (
          <ul className="space-y-3" data-testid="bandeja-tareas">
            {tareas.map((t) => (
              <TareaCard
                key={t.idRutaOrden}
                tarea={t}
                puedeCapturar={puedeCapturar}
                alAbrirRuta={() => void navigate(`/ruta-critica/ordenes/${t.idOrden}`)}
              />
            ))}
          </ul>
        )}

        {datos !== undefined && totalPaginas > 1 ? (
          <div className="mt-4 flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground" data-testid="bandeja-total">
              {datos.total} {datos.total === 1 ? 'tarea' : 'tareas'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <span className="tabular-nums text-muted-foreground">
                {pagina} / {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagina >= totalPaginas || consulta.isFetching}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Una tarea como card (móvil-primero): datos, semáforo, captura rápida y checklist. */
function TareaCard({
  tarea,
  puedeCapturar,
  alAbrirRuta,
}: {
  tarea: TareaRc;
  puedeCapturar: boolean;
  alAbrirRuta: () => void;
}): React.JSX.Element {
  const capturar = useCapturarCumplimientoRc();
  const marcarChecklist = useMarcarChecklistRc();

  function completar(fechaReal: string): void {
    capturar.mutate(
      { idRuta: tarea.idRutaOrden, cumplido: true, fechaReal },
      {
        onSuccess: () =>
          toast.success(`"${tarea.nombreProceso}" de la orden ${tarea.folioOrden} completado.`),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <li
      className="rounded-lg border bg-card p-4"
      data-testid="bandeja-tarea"
      data-semaforo={tarea.semaforo}
      data-id-ruta={tarea.idRutaOrden}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={alAbrirRuta}
          data-testid="bandeja-abrir-ruta"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Orden {tarea.folioOrden}</span>
            {tarea.critico ? (
              <Badge variant="destructive" className="shrink-0">
                Crítico
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {tarea.cliente} · {tarea.codigoModelo}
            {tarea.descripcionModelo ? ` · ${tarea.descripcionModelo}` : ''}
          </p>
        </button>
        <Semaforo semaforo={tarea.semaforo} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{tarea.nombreProceso}</span>
        {tarea.parcialEnCurso ? (
          <Badge
            variant="outline"
            className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300"
            data-testid="bandeja-parcial"
          >
            Parcial en curso
          </Badge>
        ) : null}
        <span className="text-muted-foreground">Plan: {fechaRc(tarea.fechaPlaneadaVigente)}</span>
        {tarea.diasAtraso > 0 ? (
          <span className="font-medium text-red-600" data-testid="bandeja-atraso">
            {tarea.diasAtraso} {tarea.diasAtraso === 1 ? 'día' : 'días'} de atraso
          </span>
        ) : null}
      </div>

      {tarea.checklist.length > 0 ? (
        <ul className="mt-3 space-y-1" data-testid="bandeja-checklist">
          {tarea.checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={item.hecho}
                disabled={!puedeCapturar || marcarChecklist.isPending}
                onChange={(e) =>
                  marcarChecklist.mutate(
                    { idItem: item.id, hecho: e.target.checked },
                    { onError: (err) => toast.error(err.message) },
                  )
                }
                data-testid={`bandeja-check-${item.id}`}
              />
              <span className={item.hecho ? 'text-muted-foreground line-through' : ''}>
                {item.descripcion}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {puedeCapturar ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            className="flex-1 sm:flex-none"
            disabled={capturar.isPending}
            onClick={() => completar(fechaLocal(0))}
            data-testid="bandeja-completar-hoy"
          >
            {capturar.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden />
            )}
            Hoy
          </Button>
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={capturar.isPending}
            onClick={() => completar(fechaLocal(-1))}
            data-testid="bandeja-completar-ayer"
          >
            Ayer
          </Button>
        </div>
      ) : null}
    </li>
  );
}
