import { CheckCircle2, ChevronRight, Loader2, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  useBandejaRc,
  useCapturarCumplimientoRc,
  useResponsablesRc,
  useResumenPendientesRc,
} from '@/api/ruta-critica-programacion';
import type { ResumenPendientesRc, TareaRc } from '@/api/tipos';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { PanelRutaOrden, type EncabezadoRutaOrden } from './PanelRutaOrden';
import { EVENTO_RC_DESCRIPCION, PANTALLA_EVENTO, esProcesoAutomatico, fechaRc } from './piezas';

/**
 * MIS PENDIENTES (rediseño R4 — proto §4.9, la pantalla que pidió Daniel): la GUÍA DIARIA de la
 * Ruta Crítica por persona. Deriva de las rutas vivas filtrando por responsable (la bandeja F5) y
 * agrupa por URGENCIA (⚠ Vencidas / Para hoy / Próximas · esta semana, + "+N más adelante") o por
 * PROCESO (para resolver en tanda). KPIs, tag ⟳ auto / ✋ manual con su evento, botón "Registrar"
 * (navega a la pantalla del evento) o "Marcar hecho" (captura manual, `rc.capturar` — el backend
 * re-verifica el rol), y clic en el renglón → panel "Ruta de la orden". El selector "Viendo
 * pendientes de:" (solo supervisores, `rc.programar`) revisa la lista de cualquiera.
 *
 * CERO lógica de negocio (A1): urgencia, holgura, conteos y grupos vienen AGREGADOS del servidor
 * (`/bandeja` + `/bandeja/resumen`); aquí solo se acomodan y pintan.
 */

/** Tareas que la pantalla trae de un jalón (tope del API; el resumen SIEMPRE cubre el total). */
const TOPE_TAREAS = 100;

/** Texto del badge de fecha/holgura de un renglón (proto `rcDtxt`). */
function textoFecha(t: TareaRc): string {
  const fecha = fechaRc(t.fechaPlaneadaVigente);
  if (t.urgencia === 'vencida') return `venció ${fecha} · -${String(t.diasAtraso)} d`;
  if (t.urgencia === 'hoy') return `para hoy · ${fecha}`;
  if (t.urgencia === 'sinFecha') return 'sin fecha (calculando)';
  return `${fecha} · +${String(t.diasRestantes ?? 0)} d`;
}

const VARIANTE_URGENCIA: Record<TareaRc['urgencia'], 'destructive' | 'outline' | 'secondary'> = {
  vencida: 'destructive',
  hoy: 'outline',
  semana: 'secondary',
  despues: 'secondary',
  sinFecha: 'secondary',
};

/** Clase extra del badge por urgencia (S2 del review: "para hoy" en ÁMBAR, como el proto). */
const CLASE_URGENCIA: Partial<Record<TareaRc['urgencia'], string>> = {
  hoy: 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
};

export function MisPendientesPagina(): React.JSX.Element {
  const { tienePermiso, sesion } = useSesion();
  const puedeCapturar = tienePermiso('rc.capturar');
  const esSupervisor = tienePermiso('rc.programar');

  // "hoy 6 jul 2026" del proto: solo presentación (ancla temporal de la guía diaria).
  const ahora = new Date();
  const hoyLargo = ahora.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const hoyCorto = ahora.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  // "Viendo pendientes de:" — null = los míos. El Combobox trabaja con ids numéricos, así que se
  // mapea por índice sobre la lista de responsables (presentación, no negocio).
  const [indiceUsuario, setIndiceUsuario] = useState<number | null>(null);
  const responsables = useResponsablesRc({ habilitado: esSupervisor });
  const deUsuario = indiceUsuario === null ? undefined : responsables.data?.[indiceUsuario]?.id;

  // Búsqueda por cliente EN SERVIDOR (parámetro existente de la bandeja): sin ella, un admin —
  // que ve TODO — puede tener a su orden fuera del tope de la página (la bandeja vieja la tenía
  // y Mis pendientes la había perdido). Los KPIs siguen siendo el total a cargo (sin filtrar).
  const [textoCliente, setTextoCliente] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 300);

  const resumen = useResumenPendientesRc(deUsuario === undefined ? {} : { deUsuario });
  const bandeja = useBandejaRc({
    pagina: 1,
    porPagina: TOPE_TAREAS,
    ...(deUsuario === undefined ? {} : { deUsuario }),
    ...(busquedaCliente.length > 0 ? { busquedaCliente } : {}),
  });

  const [agruparPor, setAgruparPor] = useState<'urgencia' | 'proceso'>('urgencia');
  const [panel, setPanel] = useState<{ idOrden: number; encabezado: EncabezadoRutaOrden } | null>(
    null,
  );

  const tareas = useMemo(() => bandeja.data?.datos ?? [], [bandeja.data]);
  const r: ResumenPendientesRc | undefined = resumen.data;

  const kpis: Kpi[] = [
    {
      clave: 'vencidas',
      etiqueta: 'Vencidas',
      valor: r?.vencidas ?? '—',
      pie: (r?.vencidas ?? 0) > 0 ? '⚠ requieren acción ya' : 'nada vencido',
      ...((r?.vencidas ?? 0) > 0 ? { tonoPie: 'crit' as const } : {}),
    },
    { clave: 'hoy', etiqueta: 'Para hoy', valor: r?.paraHoy ?? '—', pie: `foco · ${hoyCorto}` },
    {
      clave: 'semana',
      etiqueta: 'Esta semana',
      valor: r?.estaSemana ?? '—',
      pie: 'próximos 4 días',
    },
    {
      clave: 'total',
      etiqueta: 'Total a tu cargo',
      valor: r?.total ?? '—',
      pie: 'procesos activos',
    },
  ];

  function abrirRuta(t: TareaRc): void {
    setPanel({
      idOrden: t.idOrden,
      encabezado: {
        folio: t.folioOrden,
        modelo: t.descripcionModelo ?? t.codigoModelo,
        cliente: t.cliente,
        fechaEntrega: t.fechaEntrega,
      },
    });
  }

  const porUrgencia = {
    vencida: tareas.filter((t) => t.urgencia === 'vencida'),
    hoy: tareas.filter((t) => t.urgencia === 'hoy'),
    semana: tareas.filter((t) => t.urgencia === 'semana'),
    sinFecha: tareas.filter((t) => t.urgencia === 'sinFecha'),
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Mis pendientes
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Tu guía diaria de Ruta Crítica · hoy <b>{hoyLargo}</b> · una orden pasa por varios
              procesos; aquí ves los que te tocan a ti
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
              onChange={(e) => setTextoCliente(e.target.value)}
              data-testid="pendientes-buscar-cliente"
            />
          </div>
        </div>

        {esSupervisor ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/50 px-3 py-2 text-sm"
            data-testid="pendientes-selector-persona"
          >
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">Viendo pendientes de:</span>
            <div className="w-56">
              <ComboboxBuscable
                opciones={(responsables.data ?? []).map((u, i) => ({ id: i, nombre: u.nombre }))}
                valor={indiceUsuario}
                onChange={setIndiceUsuario}
                placeholder={sesion?.nombre ?? 'Yo (mis pendientes)'}
                etiqueta="Viendo pendientes de"
                testid="pendientes-persona"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              — cada quien ve solo los suyos; como admin puedes revisar los de cualquiera. Una
              persona puede ser responsable de <b>varios procesos</b>.
            </span>
          </div>
        ) : null}
      </div>

      <div className="p-4 md:p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <KpiTiles kpis={kpis} className="mb-4" />

        {bandeja.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="pendientes-cargando">
            Cargando pendientes…
          </p>
        ) : bandeja.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive">{bandeja.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void bandeja.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : tareas.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            data-testid="pendientes-vacio"
          >
            {busquedaCliente.length > 0
              ? 'Sin pendientes que coincidan con la búsqueda.'
              : 'Sin pendientes 🎉 — nada vencido ni para hoy.'}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Agrupar por:</span>
              <Button
                variant={agruparPor === 'urgencia' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAgruparPor('urgencia')}
                data-testid="pendientes-agrupar-urgencia"
              >
                Urgencia
              </Button>
              <Button
                variant={agruparPor === 'proceso' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAgruparPor('proceso')}
                data-testid="pendientes-agrupar-proceso"
              >
                Proceso
              </Button>
              <span className="text-xs text-muted-foreground">
                {agruparPor === 'proceso'
                  ? 'enfócate en un proceso a la vez'
                  : 'lo más urgente primero'}
              </span>
            </div>

            {agruparPor === 'urgencia' ? (
              <div className="space-y-4">
                <Seccion
                  titulo="⚠ Vencidas"
                  nota="atrasadas contra su fecha compromiso"
                  acento="border-l-red-600"
                  tareas={porUrgencia.vencida}
                  puedeCapturar={puedeCapturar}
                  alAbrir={abrirRuta}
                />
                <Seccion
                  titulo="Para hoy"
                  nota="lo que te toca hoy"
                  acento="border-l-amber-500"
                  tareas={porUrgencia.hoy}
                  puedeCapturar={puedeCapturar}
                  alAbrir={abrirRuta}
                />
                <Seccion
                  titulo="Próximas · esta semana"
                  nota={
                    (r?.masAdelante ?? 0) > 0
                      ? `+${String(r?.masAdelante ?? 0)} programadas más adelante`
                      : undefined
                  }
                  acento="border-l-primary"
                  tareas={porUrgencia.semana}
                  puedeCapturar={puedeCapturar}
                  alAbrir={abrirRuta}
                />
                <Seccion
                  titulo="Sin fecha (calculando)"
                  nota="el CPM aún no fecha estos procesos"
                  acento="border-l-border"
                  tareas={porUrgencia.sinFecha}
                  puedeCapturar={puedeCapturar}
                  alAbrir={abrirRuta}
                />
              </div>
            ) : (
              <div className="space-y-4" data-testid="pendientes-grupos-proceso">
                {(r?.porProceso ?? []).map((g) => {
                  const delProceso = tareas.filter((t) => t.idProcesoDef === g.idProcesoDef);
                  if (delProceso.length === 0) return null;
                  const partes = [
                    g.vencidas > 0
                      ? `${String(g.vencidas)} vencido${g.vencidas > 1 ? 's' : ''}`
                      : null,
                    g.paraHoy > 0 ? `${String(g.paraHoy)} para hoy` : null,
                    `${String(g.total)} pendiente${g.total > 1 ? 's' : ''}`,
                  ].filter((x): x is string => x !== null);
                  return (
                    <Seccion
                      key={g.idProcesoDef}
                      titulo={g.nombreProceso}
                      nota={partes.join(' · ')}
                      acento={
                        g.vencidas > 0
                          ? 'border-l-red-600'
                          : g.paraHoy > 0
                            ? 'border-l-amber-500'
                            : 'border-l-primary'
                      }
                      tareas={delProceso}
                      puedeCapturar={puedeCapturar}
                      alAbrir={abrirRuta}
                    />
                  );
                })}
              </div>
            )}

            {(bandeja.data?.total ?? 0) > TOPE_TAREAS ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Mostrando {TOPE_TAREAS} de {bandeja.data?.total} pendientes (los más urgentes
                primero); los conteos de arriba cubren el total.
              </p>
            ) : null}
          </>
        )}
      </div>

      <PanelRutaOrden
        idOrden={panel?.idOrden}
        abierto={panel !== null}
        alCerrar={() => setPanel(null)}
        {...(panel !== null ? { encabezado: panel.encabezado } : {})}
      />
    </div>
  );
}

/** Una sección de pendientes (por urgencia o por proceso), con su acento de color. */
function Seccion({
  titulo,
  nota,
  acento,
  tareas,
  puedeCapturar,
  alAbrir,
}: {
  titulo: string;
  nota?: string | undefined;
  acento: string;
  tareas: readonly TareaRc[];
  puedeCapturar: boolean;
  alAbrir: (t: TareaRc) => void;
}): React.JSX.Element | null {
  if (tareas.length === 0) return null;
  return (
    <section
      className={`overflow-hidden rounded-lg border border-l-4 bg-card ${acento}`}
      data-testid="pendientes-seccion"
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        <span className="text-xs text-faint tabular-nums">{tareas.length}</span>
        {nota === undefined ? null : (
          <span className="ml-auto text-xs text-muted-foreground">{nota}</span>
        )}
      </header>
      <ul>
        {tareas.map((t) => (
          <FilaPendiente
            key={t.idRutaOrden}
            tarea={t}
            puedeCapturar={puedeCapturar}
            alAbrir={() => alAbrir(t)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Un renglón de pendiente: proceso + orden·modelo·cliente·entrega + holgura + auto/manual + acción. */
function FilaPendiente({
  tarea,
  puedeCapturar,
  alAbrir,
}: {
  tarea: TareaRc;
  puedeCapturar: boolean;
  alAbrir: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const capturar = useCapturarCumplimientoRc();
  const esAuto = esProcesoAutomatico(tarea.tipoEvento);
  // A dónde lleva «Registrar» y con qué contexto (ruta + orden + etapa del avance). La ruta se
  // extrae a su propia const para que el tipo se estreche dentro del `onClick` (`To` no admite null).
  const destino = PANTALLA_EVENTO[tarea.tipoEvento];
  const rutaEvento = destino.ruta;

  function marcarHecho(): void {
    capturar.mutate(
      { idRuta: tarea.idRutaOrden, cumplido: true },
      {
        onSuccess: () =>
          toast.success(
            `"${tarea.nombreProceso}" de la orden ${tarea.folioOrden} marcado como hecho.`,
          ),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <li
      className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 last:border-b-0 hover:bg-secondary/50"
      onClick={alAbrir}
      data-testid="pendientes-fila"
      data-urgencia={tarea.urgencia}
      data-id-ruta={tarea.idRutaOrden}
    >
      <div className="min-w-0 flex-1 basis-52">
        <p className="truncate text-sm font-semibold">
          {tarea.nombreProceso}{' '}
          <span className="font-normal text-muted-foreground">· Orden {tarea.folioOrden}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {tarea.descripcionModelo ?? tarea.codigoModelo} · {tarea.cliente}
          {tarea.fechaEntrega !== null ? ` · entrega ${fechaRc(tarea.fechaEntrega)}` : ''}
        </p>
      </div>
      <Badge
        variant={VARIANTE_URGENCIA[tarea.urgencia]}
        className={`whitespace-nowrap tabular-nums ${CLASE_URGENCIA[tarea.urgencia] ?? ''}`}
      >
        {textoFecha(tarea)}
      </Badge>
      <span
        className={`whitespace-nowrap text-[11px] ${esAuto ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}`}
        title={
          esAuto
            ? `Se marca SOLA al registrar: ${EVENTO_RC_DESCRIPCION[tarea.tipoEvento]}`
            : 'No tiene evento del sistema: se marca a mano'
        }
        data-testid="pendientes-tag-evento"
      >
        {esAuto ? '⟳ auto' : '✋ manual'}
      </span>
      {esAuto && rutaEvento !== null ? (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            // Las pantallas de producción entienden `state.idOrden`; el Centro de Órdenes abre
            // además el panel de avance EN LA ETAPA del pendiente. Así se llega al paso exacto de
            // LA orden, no a una lista de cientos ni a la etapa equivocada.
            void navigate(
              rutaEvento,
              destino.conOrden === true
                ? {
                    state: {
                      idOrden: tarea.idOrden,
                      ...(destino.etapaAvance === undefined
                        ? {}
                        : { abrirAvance: true, etapaAvance: destino.etapaAvance }),
                    },
                  }
                : {},
            );
          }}
          title={`Se marca sola al registrar ${EVENTO_RC_DESCRIPCION[tarea.tipoEvento]}; aquí vas a la pantalla`}
          data-testid="pendientes-registrar"
        >
          Registrar
        </Button>
      ) : puedeCapturar ? (
        <Button
          variant="outline"
          size="sm"
          disabled={capturar.isPending}
          onClick={(e) => {
            e.stopPropagation();
            marcarHecho();
          }}
          data-testid="pendientes-marcar-hecho"
        >
          {capturar.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4" aria-hidden />
          )}
          Marcar hecho
        </Button>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </li>
  );
}
