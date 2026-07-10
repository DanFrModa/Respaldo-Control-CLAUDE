import { AlertTriangle, FileSpreadsheet, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAnalisisRc, useDesempenoRc, urlEvaluacionSemanalExcel } from '@/api/analisis-rc';
import type {
  AnalisisSalud,
  CuelloProceso,
  DesempenoRc,
  EntregaCiclo,
  OrdenAlerta,
  OrdenAtencion,
  PersonaDesempeno,
  RiesgoCliente,
} from '@/api/tipos';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { useSesion } from '@/sesion/useSesion';

import { fechaRc } from '../ruta-critica/piezas';
import { BarraPeso, Sparkline } from './piezas';

/**
 * TABLERO DE GESTIÓN "ANÁLISIS RC" (rediseño R7; doc `REDISENO-FRONTEND.md` §4.10). De CAPTURAR a
 * ANALIZAR: salud de las órdenes (KPIs + triage), entrega al cliente + tiempo de ciclo, alertas
 * predictivas (CPM forward pass), riesgo por cliente, desempeño del equipo (scoring + bono, solo
 * management) y cuellos de botella por proceso. CERO lógica de negocio (A1): la salud, el semáforo, el
 * forward pass, el scoring y TODA la agregación los DERIVA el backend; aquí solo se pinta y se navega.
 * La gobierna `rc.ruta-ver`; la tarjeta de desempeño exige además `rc.programar`.
 */
export function AnalisisRcPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeGestion = tienePermiso('rc.programar');

  // "hoy 6 jul 2026" del proto: solo presentación (ancla temporal del tablero).
  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const consulta = useAnalisisRc();
  const desempeno = useDesempenoRc({ habilitado: puedeGestion });

  const abrirRuta = (idOrden: number): void => void navigate(`/ruta-critica/ordenes/${idOrden}`);

  const datos = consulta.data;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Análisis de Ruta Crítica
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Salud de las órdenes · desempeño del equipo · cuellos de botella · hoy <b>{hoy}</b>
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="analisis-cargando">
            Cargando análisis…
          </p>
        ) : consulta.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive" data-testid="analisis-error">
              {consulta.error.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : datos === undefined ? null : (
          <>
            <KpiTiles kpis={kpisSalud(datos.salud)} />

            <EntregaCicloCard entrega={datos.entregaCiclo} />

            <AtencionCard filas={datos.salud.atencion} alAbrir={abrirRuta} />

            <AlertasCard filas={datos.alertas} alAbrir={abrirRuta} />

            <RiesgoClienteCard filas={datos.riesgoCliente} />

            {puedeGestion ? (
              <DesempenoCard consulta={desempeno.data} cargando={desempeno.isPending} />
            ) : null}

            <CuellosCard filas={datos.cuellos} />
          </>
        )}
      </div>
    </div>
  );
}

// ── KPIs de salud ───────────────────────────────────────────────────────────

function kpisSalud(salud: AnalisisSalud): Kpi[] {
  const cumpl = salud.cumplimiento;
  return [
    { clave: 'activas', etiqueta: 'Órdenes activas', valor: salud.ordenesActivas, pie: 'en la RC' },
    {
      clave: 'a-tiempo',
      etiqueta: 'A tiempo',
      valor: salud.aTiempo,
      pie: 'sin atraso',
      tonoPie: 'ok',
    },
    {
      clave: 'en-riesgo',
      etiqueta: 'En riesgo',
      valor: salud.enRiesgo,
      pie: 'hoy · se juegan la fecha',
    },
    {
      clave: 'atrasadas',
      etiqueta: 'Atrasadas',
      valor: salud.atrasadas,
      pie: '⚠ acción urgente',
      ...(salud.atrasadas > 0 ? { tonoPie: 'crit' as const } : {}),
    },
    {
      clave: 'cumplimiento',
      etiqueta: 'Cumplimiento',
      valor: cumpl === null ? '—' : cumpl,
      ...(cumpl === null ? {} : { sufijo: '%' }),
      pie: 'órdenes a tiempo',
      tonoPie: cumpl !== null && cumpl < 80 ? ('crit' as const) : ('ok' as const),
    },
  ];
}

// ── Tarjeta contenedora ──────────────────────────────────────────────────────

function Tarjeta({
  titulo,
  icono,
  contador,
  meta,
  acciones,
  acento,
  children,
}: {
  titulo: React.ReactNode;
  icono?: React.ReactNode;
  /** Conteo junto al título (proto `.count`: texto faint, no pastilla). */
  contador?: number;
  meta?: React.ReactNode;
  acciones?: React.ReactNode;
  /** Barra de acento a la izquierda del encabezado (crit/warn). */
  acento?: 'crit' | 'warn';
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div
        className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
        style={acento ? { boxShadow: `inset 3px 0 0 var(--${acento})` } : undefined}
      >
        <div
          className={
            'flex items-center gap-2 text-sm font-semibold ' +
            (acento === 'crit' ? 'text-crit' : acento === 'warn' ? 'text-warn' : '')
          }
        >
          {icono}
          {titulo}
        </div>
        {contador === undefined ? null : (
          <span className="text-xs text-faint tabular-nums">{contador}</span>
        )}
        {meta === undefined ? null : (
          <span className="ml-auto text-xs text-muted-foreground">{meta}</span>
        )}
        {acciones === undefined ? null : (
          <div className={meta === undefined ? 'ml-auto' : ''}>{acciones}</div>
        )}
      </div>
      {children}
    </section>
  );
}

/** Envuelve una tabla densa con scroll horizontal en móvil. */
function TablaScroll({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="overflow-x-auto">{children}</div>;
}

/** Fila de "sin datos" para una tabla. */
function FilaVacia({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <TablaDensaFila>
      <TablaDensaCelda colSpan={colSpan} className="py-6 text-center text-muted-foreground">
        {children}
      </TablaDensaCelda>
    </TablaDensaFila>
  );
}

// ── Entrega al cliente + tiempo de ciclo ─────────────────────────────────────

function EntregaCicloCard({ entrega }: { entrega: EntregaCiclo }): React.JSX.Element {
  const delta =
    entrega.tendenciaSemanas.length >= 2
      ? (entrega.tendenciaSemanas[entrega.tendenciaSemanas.length - 1] ?? 0) -
        (entrega.tendenciaSemanas[0] ?? 0)
      : 0;
  const ciclo = entrega.cicloPromedioDias;
  const cicloTend = entrega.cicloTendenciaDias;
  return (
    <Tarjeta
      titulo="Entrega al cliente y tiempo de ciclo"
      meta="el resultado que de verdad importa"
    >
      <div className="flex flex-wrap gap-8 p-4">
        <div>
          <div className="text-xs text-muted-foreground">Entregas a tiempo (on-time delivery)</div>
          <div className="flex items-baseline gap-2">
            <span className="num text-3xl font-bold">
              {entrega.onTimePct === null ? '—' : `${entrega.onTimePct}%`}
            </span>
            {delta !== 0 ? (
              <span className={delta > 0 ? 'text-sm text-ok' : 'text-sm text-crit'}>
                {delta > 0 ? '▲ +' : '▼ '}
                {Math.abs(delta)} pts (3 sem)
              </span>
            ) : null}
          </div>
          <div className="mb-1.5 num text-xs text-faint">
            {entrega.onTimeATiempo} de {entrega.onTimeMedibles} órdenes entregadas (últimas 4
            semanas)
          </div>
          <Sparkline valores={entrega.tendenciaSemanas} sufijo="%" />
        </div>
        <div className="border-l pl-8">
          <div className="text-xs text-muted-foreground">
            Tiempo de ciclo promedio (OP → entrega)
          </div>
          <div className="flex items-baseline gap-2">
            <span className="num text-3xl font-bold">{ciclo === null ? '—' : ciclo}</span>
            <span className="text-muted-foreground">días</span>
            {cicloTend !== null && cicloTend !== 0 ? (
              <span className={cicloTend < 0 ? 'text-sm text-ok' : 'text-sm text-crit'}>
                {cicloTend < 0 ? '▼ ' : '▲ '}
                {Math.abs(cicloTend)} d vs 4 sem previas
              </span>
            ) : null}
          </div>
          <div className="text-xs text-faint">menos días = entregamos más rápido</div>
        </div>
      </div>
    </Tarjeta>
  );
}

// ── Órdenes que requieren atención (triage) ──────────────────────────────────

/** Badge de estado (semáforo de la orden) para el triage. */
function BadgeSemaforoOrden({ semaforo }: { semaforo: OrdenAtencion['semaforo'] }) {
  const mapa: Record<OrdenAtencion['semaforo'], { tono: TonoEstado; texto: string }> = {
    atrasado: { tono: 'crit', texto: 'Atrasada' },
    enRiesgo: { tono: 'warn', texto: 'En riesgo' },
    aTiempo: { tono: 'ok', texto: 'A tiempo' },
  };
  const { tono, texto } = mapa[semaforo];
  return <ChipEstado tono={tono}>{texto}</ChipEstado>;
}

/** Holgura en días con color por urgencia (proto: <0 crit, 0 warn "hoy", >0 muted). */
function Holgura({ dias }: { dias: number }): React.JSX.Element {
  const texto = dias < 0 ? `${dias} d` : dias === 0 ? 'hoy' : `+${dias} d`;
  const clase = dias < 0 ? 'text-crit' : dias === 0 ? 'text-warn' : 'text-muted-foreground';
  return <span className={clase}>{texto}</span>;
}

function AtencionCard({
  filas,
  alAbrir,
}: {
  filas: OrdenAtencion[];
  alAbrir: (idOrden: number) => void;
}): React.JSX.Element {
  return (
    <Tarjeta
      titulo="Órdenes que requieren atención"
      icono={<AlertTriangle className="size-4" aria-hidden />}
      acento="crit"
      contador={filas.length}
      meta="ordenadas por urgencia · clic para ver la ruta"
    >
      <TablaScroll>
        <TablaDensa>
          <TablaDensaEncabezado>
            <TablaDensaFila>
              <TablaDensaHead>Orden</TablaDensaHead>
              <TablaDensaHead>Modelo</TablaDensaHead>
              <TablaDensaHead>Cliente</TablaDensaHead>
              <TablaDensaHead>Etapa atorada</TablaDensaHead>
              <TablaDensaHead>Responsable</TablaDensaHead>
              <TablaDensaHead>Estado</TablaDensaHead>
              <TablaDensaHead numerica>Holgura</TablaDensaHead>
              <TablaDensaHead>Entrega</TablaDensaHead>
            </TablaDensaFila>
          </TablaDensaEncabezado>
          <TablaDensaCuerpo>
            {filas.length === 0 ? (
              <FilaVacia colSpan={8}>Ninguna orden en riesgo ni atrasada 🎉</FilaVacia>
            ) : (
              filas.map((f) => (
                <TablaDensaFila
                  key={f.idOrden}
                  className="cursor-pointer"
                  onClick={() => alAbrir(f.idOrden)}
                  data-testid="atencion-fila"
                >
                  <TablaDensaCelda className="num font-medium">{f.folioOrden}</TablaDensaCelda>
                  <TablaDensaCelda className="font-medium">{f.codigoModelo}</TablaDensaCelda>
                  <TablaDensaCelda>{f.cliente}</TablaDensaCelda>
                  <TablaDensaCelda>{f.etapaAtorada ?? '—'}</TablaDensaCelda>
                  <TablaDensaCelda>{f.responsable ?? '—'}</TablaDensaCelda>
                  <TablaDensaCelda>
                    <BadgeSemaforoOrden semaforo={f.semaforo} />
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    <Holgura dias={f.holguraDias} />
                  </TablaDensaCelda>
                  <TablaDensaCelda>{fechaRc(f.fechaEntregaRC)}</TablaDensaCelda>
                </TablaDensaFila>
              ))
            )}
          </TablaDensaCuerpo>
        </TablaDensa>
      </TablaScroll>
    </Tarjeta>
  );
}

// ── Alertas predictivas (forward pass) ───────────────────────────────────────

function AlertasCard({
  filas,
  alAbrir,
}: {
  filas: OrdenAlerta[];
  alAbrir: (idOrden: number) => void;
}): React.JSX.Element {
  return (
    <Tarjeta
      titulo="Alertas predictivas — van a atrasarse"
      icono={<Sparkles className="size-4" aria-hidden />}
      acento="warn"
      contador={filas.length}
      meta="hoy se ven bien, pero el colchón no alcanza"
    >
      <TablaScroll>
        <TablaDensa>
          <TablaDensaEncabezado>
            <TablaDensaFila>
              <TablaDensaHead>Orden</TablaDensaHead>
              <TablaDensaHead>Modelo</TablaDensaHead>
              <TablaDensaHead>Cliente</TablaDensaHead>
              <TablaDensaHead numerica>Procesos restantes</TablaDensaHead>
              <TablaDensaHead numerica>Colchón proyectado</TablaDensaHead>
              <TablaDensaHead>Entrega</TablaDensaHead>
            </TablaDensaFila>
          </TablaDensaEncabezado>
          <TablaDensaCuerpo>
            {filas.length === 0 ? (
              <FilaVacia colSpan={6}>
                Ninguna orden en riesgo de atrasarse por proyección 🎉
              </FilaVacia>
            ) : (
              filas.map((f) => (
                <TablaDensaFila
                  key={f.idOrden}
                  className="cursor-pointer"
                  onClick={() => alAbrir(f.idOrden)}
                  data-testid="alerta-fila"
                >
                  <TablaDensaCelda className="num font-medium">{f.folioOrden}</TablaDensaCelda>
                  <TablaDensaCelda className="font-medium">{f.codigoModelo}</TablaDensaCelda>
                  <TablaDensaCelda>{f.cliente}</TablaDensaCelda>
                  <TablaDensaCelda numerica>{f.procesosRestantes}</TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    <span className={f.colchonDias < 0 ? 'text-crit' : 'text-warn'}>
                      {f.colchonDias < 0 ? `${f.colchonDias} d` : `+${f.colchonDias} d`}
                    </span>
                  </TablaDensaCelda>
                  <TablaDensaCelda>{fechaRc(f.fechaEntregaRC)}</TablaDensaCelda>
                </TablaDensaFila>
              ))
            )}
          </TablaDensaCuerpo>
        </TablaDensa>
      </TablaScroll>
      <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
        El <b>colchón proyectado</b> = días hábiles hasta la entrega − trabajo que falta (CPM
        forward pass). Negativo = no alcanza el tiempo aunque hoy no esté atrasada.
      </p>
    </Tarjeta>
  );
}

// ── Riesgo por cliente ───────────────────────────────────────────────────────

function RiesgoClienteCard({ filas }: { filas: RiesgoCliente[] }): React.JSX.Element {
  const etiqueta: Record<RiesgoCliente['semaforo'], string> = {
    crit: 'Con atrasos',
    warn: 'En riesgo',
    ok: 'OK',
  };
  return (
    <Tarjeta titulo="Riesgo por cliente" contador={filas.length} meta="a quién avisar / priorizar">
      <TablaScroll>
        <TablaDensa>
          <TablaDensaEncabezado>
            <TablaDensaFila>
              <TablaDensaHead>Cliente</TablaDensaHead>
              <TablaDensaHead numerica>Órdenes activas</TablaDensaHead>
              <TablaDensaHead numerica>En riesgo</TablaDensaHead>
              <TablaDensaHead numerica>Atrasadas</TablaDensaHead>
              <TablaDensaHead>Semáforo</TablaDensaHead>
            </TablaDensaFila>
          </TablaDensaEncabezado>
          <TablaDensaCuerpo>
            {filas.length === 0 ? (
              <FilaVacia colSpan={5}>Sin órdenes activas.</FilaVacia>
            ) : (
              filas.map((c) => (
                <TablaDensaFila key={c.idCliente} data-testid="riesgo-cliente-fila">
                  <TablaDensaCelda className="font-medium">{c.cliente}</TablaDensaCelda>
                  <TablaDensaCelda numerica>{c.activas}</TablaDensaCelda>
                  <TablaDensaCelda numerica className={c.enRiesgo > 0 ? 'text-warn' : ''}>
                    {c.enRiesgo}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica className={c.atrasadas > 0 ? 'text-crit' : ''}>
                    {c.atrasadas}
                  </TablaDensaCelda>
                  <TablaDensaCelda>
                    <ChipEstado tono={c.semaforo}>{etiqueta[c.semaforo]}</ChipEstado>
                  </TablaDensaCelda>
                </TablaDensaFila>
              ))
            )}
          </TablaDensaCuerpo>
        </TablaDensa>
      </TablaScroll>
    </Tarjeta>
  );
}

// ── Desempeño del equipo (scoring + bono) ────────────────────────────────────

/** Badge cualitativo de la calificación. */
function BadgeCalificacion({ badge }: { badge: PersonaDesempeno['badge'] }) {
  if (badge === null) return <span className="text-xs text-faint">—</span>;
  const mapa: Record<
    NonNullable<PersonaDesempeno['badge']>,
    { tono: TonoEstado; texto: string }
  > = {
    excelente: { tono: 'ok', texto: 'Excelente' },
    bien: { tono: 'info', texto: 'Bien' },
    regular: { tono: 'warn', texto: 'Regular' },
    bajo: { tono: 'crit', texto: 'Bajo' },
  };
  const { tono, texto } = mapa[badge];
  return (
    <ChipEstado tono={tono} className="text-[10px]">
      {texto}
    </ChipEstado>
  );
}

function DesempenoCard({
  consulta,
  cargando,
}: {
  consulta: DesempenoRc | undefined;
  cargando: boolean;
}): React.JSX.Element {
  const personas = consulta?.personas ?? [];
  const conBono = consulta?.conBono ?? 0;
  return (
    <Tarjeta
      titulo="Desempeño del equipo (RC)"
      contador={personas.length}
      meta={`${conBono} con bono esta semana`}
      acciones={
        <Button
          size="sm"
          onClick={() => window.open(urlEvaluacionSemanalExcel(), '_blank', 'noopener')}
          data-testid="desempeno-excel"
        >
          <FileSpreadsheet className="mr-1.5 size-4" aria-hidden />
          Generar evaluación semanal
        </Button>
      }
    >
      <TablaScroll>
        <TablaDensa>
          <TablaDensaEncabezado>
            <TablaDensaFila>
              <TablaDensaHead>Persona</TablaDensaHead>
              <TablaDensaHead>Área</TablaDensaHead>
              <TablaDensaHead numerica>A cargo</TablaDensaHead>
              <TablaDensaHead numerica>Vencidos</TablaDensaHead>
              <TablaDensaHead numerica>% en tiempo</TablaDensaHead>
              <TablaDensaHead numerica>Reacción</TablaDensaHead>
              <TablaDensaHead>Tendencia</TablaDensaHead>
              <TablaDensaHead numerica>Calificación</TablaDensaHead>
              <TablaDensaHead>Bono</TablaDensaHead>
            </TablaDensaFila>
          </TablaDensaEncabezado>
          <TablaDensaCuerpo>
            {cargando ? (
              <FilaVacia colSpan={9}>Cargando desempeño…</FilaVacia>
            ) : personas.length === 0 ? (
              <FilaVacia colSpan={9}>Sin personas responsables de la RC.</FilaVacia>
            ) : (
              personas.map((p) => (
                <TablaDensaFila key={p.idUsuario} data-testid="desempeno-fila">
                  <TablaDensaCelda className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {p.nombre}
                      {p.sobrecarga ? (
                        <ChipEstado
                          tono="warn"
                          className="text-[10px]"
                          title="Trae mucha carga; su calificación se lee con contexto"
                        >
                          sobrecarga
                        </ChipEstado>
                      ) : null}
                    </span>
                  </TablaDensaCelda>
                  <TablaDensaCelda className="text-muted-foreground">{p.area}</TablaDensaCelda>
                  <TablaDensaCelda numerica>{p.activos}</TablaDensaCelda>
                  <TablaDensaCelda numerica className={p.vencidos > 0 ? 'text-crit' : ''}>
                    {p.vencidos}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    {p.onTimePct === null ? '—' : `${p.onTimePct}%`}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    {p.reaccionHoras === null ? '—' : `${p.reaccionHoras} h`}
                  </TablaDensaCelda>
                  <TablaDensaCelda>
                    {p.tendencia === null || p.tendencia === 0 ? (
                      <span className="text-faint">—</span>
                    ) : p.tendencia > 0 ? (
                      <span className="text-ok">▲ +{p.tendencia}%</span>
                    ) : (
                      <span className="text-crit">▼ {p.tendencia}%</span>
                    )}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    <span className="flex items-center justify-end gap-1.5">
                      <b className="num">{p.calificacion ?? '—'}</b>
                      <BadgeCalificacion badge={p.badge} />
                    </span>
                  </TablaDensaCelda>
                  <TablaDensaCelda>
                    {p.bono ? (
                      <ChipEstado tono="ok">Bono ✓</ChipEstado>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
                  </TablaDensaCelda>
                </TablaDensaFila>
              ))
            )}
          </TablaDensaCuerpo>
        </TablaDensa>
      </TablaScroll>
      <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
        La <b>calificación</b> = % de procesos entregados en tiempo, penalizado por los vencidos que
        trae hoy. <b>Bono semanal</b> = calificación ≥ 90 y <b>0 vencidos</b>. La <b>reacción</b> =
        tiempo promedio en atender un proceso desde que cae en su cancha. <b>Carga vs desempeño:</b>{' '}
        a quien trae mucha carga se le marca <b>sobrecarga</b> — un score bajo con carga alta puede
        ser sobrecarga y no descuido (para que el bono sea justo). Umbrales configurables.
      </p>
    </Tarjeta>
  );
}

// ── Cuellos de botella por proceso ───────────────────────────────────────────

function CuellosCard({ filas }: { filas: CuelloProceso[] }): React.JSX.Element {
  const maxTotal = filas.reduce((m, c) => Math.max(m, c.total), 0) || 1;
  return (
    <Tarjeta
      titulo="Cuellos de botella por proceso"
      contador={filas.length}
      meta="dónde se atoran más las órdenes (sistémico, no de personas)"
    >
      <TablaScroll>
        <TablaDensa>
          <TablaDensaEncabezado>
            <TablaDensaFila>
              <TablaDensaHead>Proceso</TablaDensaHead>
              <TablaDensaHead numerica>Vencidos</TablaDensaHead>
              <TablaDensaHead numerica>Para hoy</TablaDensaHead>
              <TablaDensaHead numerica>Total atorado</TablaDensaHead>
              <TablaDensaHead>Peso</TablaDensaHead>
            </TablaDensaFila>
          </TablaDensaEncabezado>
          <TablaDensaCuerpo>
            {filas.length === 0 ? (
              <FilaVacia colSpan={5}>Sin procesos atorados.</FilaVacia>
            ) : (
              filas.map((c) => (
                <TablaDensaFila key={c.idProcesoDef} data-testid="cuello-fila">
                  <TablaDensaCelda className="font-medium">{c.nombreProceso}</TablaDensaCelda>
                  <TablaDensaCelda numerica className={c.vencidos > 0 ? 'text-crit' : ''}>
                    {c.vencidos}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica>{c.hoy}</TablaDensaCelda>
                  <TablaDensaCelda numerica>{c.total}</TablaDensaCelda>
                  <TablaDensaCelda className="min-w-[120px]">
                    <BarraPeso pct={Math.round((c.total / maxTotal) * 100)} />
                  </TablaDensaCelda>
                </TablaDensaFila>
              ))
            )}
          </TablaDensaCuerpo>
        </TablaDensa>
      </TablaScroll>
    </Tarjeta>
  );
}
