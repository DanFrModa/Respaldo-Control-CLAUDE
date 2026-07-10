import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useResumenOperativo } from '@/api/resumen';
import { useBandejaRc } from '@/api/ruta-critica-programacion';
import type { CorteSemanaResumen, OrdenPorVencer, TareaRc } from '@/api/tipos';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
import { type Kpi, KpiTiles } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { fechaRc } from '@/modulos/ruta-critica/piezas';
import { useSesion } from '@/sesion/useSesion';

/**
 * RESUMEN OPERATIVO (portada `/`, rediseño R9 — fidelidad al proto `vResumen`): encabezado con la
 * semana en curso + "Nueva orden", 5 KPIs de vistazo, la tabla "Órdenes por vencer" (semáforo de
 * Ruta Crítica, próximos 7 días), la gráfica "Cortes por semana" y la "Bandeja de Ruta Crítica".
 *
 * TODOS los números vienen del servidor (`GET /api/resumen` + `useBandejaRc`; A1 — cero agregación
 * en cliente). RBAC por BLOQUE (A4): cada bloque llega `null` sin el permiso de su dominio y su
 * tarjeta simplemente no se pinta; sin NINGÚN permiso de bloque, la portada no consulta y muestra
 * la guía de arranque (menú / Ctrl+K).
 *
 * Desviaciones honestas vs el proto (no se inventan datos): sin botón "Exportar" (no hay export
 * real de esta vista), sin tendencia en Órdenes abiertas / WIP / Existencia PT (no hay serie
 * histórica barata), el pie de "Cortado" compara vs semana pasada (no hay "meta") y la bandeja no
 * trae hora ("Vence hoy", sin "18:00").
 *
 * Scroll propio (`h-full overflow-y-auto`): el cascarón deja el `<main>` sin scroll.
 */
export function Inicio(): React.JSX.Element {
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();

  const puedeWip = tienePermiso('produccion.wip-ver');
  const puedeIndicadores = tienePermiso('indicadores.ver');
  const puedePt = tienePermiso('inventario-pt.ver');
  const puedeRc = tienePermiso('rc.ruta-ver');
  const puedeResumen = puedeWip || puedeIndicadores || puedePt || puedeRc;

  const resumen = useResumenOperativo({ habilitado: puedeResumen });
  const datos = resumen.data;

  // Re-render por minuto para que "actualizado hace X min" no se congele.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const hoy = new Date();
  // El rótulo de la semana sale del ÚLTIMO bucket de la serie del servidor (la misma fuente que
  // las barras "S##"): así jamás desfasa de la gráfica en la frontera de semana (UTC vs local).
  const serieCortes = datos?.cortesPorSemana ?? [];
  const semana = infoSemana(hoy, serieCortes[serieCortes.length - 1]?.anioSemana);

  // ── KPIs (solo los bloques que la sesión puede ver; el servidor manda null sin permiso) ────────
  const kpis: Kpi[] = [];
  if (datos?.ordenesAbiertas != null) {
    kpis.push({
      clave: 'ordenes-abiertas',
      etiqueta: 'Órdenes abiertas',
      valor: fmt(datos.ordenesAbiertas.total),
      pie: 'con algo pendiente',
    });
  }
  if (datos?.wipMaquila != null) {
    kpis.push({
      clave: 'wip',
      etiqueta: 'En producción (WIP)',
      valor: fmt(datos.wipMaquila.piezas),
      sufijo: 'pzas',
      pie: `en ${fmt(datos.wipMaquila.maquileros)} maquilero${datos.wipMaquila.maquileros === 1 ? '' : 's'}`,
    });
  }
  if (datos?.cortadoSemana != null) {
    kpis.push({
      clave: 'cortado-semana',
      etiqueta: 'Cortado esta semana',
      valor: fmt(datos.cortadoSemana.piezas),
      sufijo: 'pzas',
      pie: (
        <PieTendencia
          delta={datos.cortadoSemana.deltaPct}
          formato={(d) => `${d > 0 ? '+' : ''}${fmt1(d)}%`}
          contexto="vs. sem. pasada"
        />
      ),
    });
  }
  if (datos?.entregasATiempo != null) {
    kpis.push({
      clave: 'entregas-a-tiempo',
      etiqueta: 'Entregas a tiempo',
      valor:
        datos.entregasATiempo.porcentaje === null
          ? '—'
          : fmt1(datos.entregasATiempo.porcentaje * 100),
      sufijo: '%',
      pie: (
        <PieTendencia
          delta={datos.entregasATiempo.deltaPuntos}
          formato={(d) => `${d > 0 ? '+' : ''}${fmt1(d)}`}
          contexto="RC · últimos 30 d"
        />
      ),
    });
  }
  if (datos?.existenciaPt != null) {
    kpis.push({
      clave: 'existencia-pt',
      etiqueta: 'Existencia PT',
      valor: fmt(datos.existenciaPt.piezas),
      sufijo: 'pzas',
      pie: `${fmt(datos.existenciaPt.almacenes)} almac${datos.existenciaPt.almacenes === 1 ? 'én' : 'enes'}`,
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1500px] px-4 pt-5 pb-10 lg:px-6">
        {/* ── Encabezado (proto .page-head) ─────────────────────────────────── */}
        <header className="mb-4 flex flex-wrap items-end gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Resumen operativo</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Semana {semana.numero} · del {semana.rango} ·{' '}
              {textoActualizado(resumen.dataUpdatedAt, resumen.isFetching)}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            {tienePermiso('ordenes.administrar') ? (
              <Button
                size="sm"
                onClick={() => void navigate('/produccion/ordenes/captura')}
                data-testid="inicio-nueva-orden"
              >
                <Plus aria-hidden />
                Nueva orden
              </Button>
            ) : null}
          </div>
        </header>

        {resumen.isError ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {resumen.error.message}
          </p>
        ) : null}

        {!puedeResumen ? (
          // Sin ningún permiso de bloque no hay tableros que enseñar: guía de arranque.
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            Tu perfil aún no tiene indicadores en el resumen. Encuentra tus pantallas con el menú o
            con Ctrl+K.
          </div>
        ) : (
          <>
            {/* ── KPIs (proto .kpis) ──────────────────────────────────────────── */}
            {kpis.length > 0 ? <KpiTiles kpis={kpis} className="mb-4" /> : null}

            {/* ── Doble columna (proto .grid-2: 1.6fr / 1fr) ──────────────────── */}
            <div className="grid items-start gap-3.5 lg:grid-cols-[1.6fr_1fr]">
              {puedeRc ? (
                <OrdenesPorVencerCard filas={datos?.ordenesPorVencer ?? null} hoy={hoy} />
              ) : null}
              <div className="flex flex-col gap-3.5">
                {datos?.cortesPorSemana != null ? (
                  <CortesPorSemanaCard serie={datos.cortesPorSemana} />
                ) : null}
                {puedeRc ? <BandejaRcCard /> : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Formato (presentación pura; los números YA vienen derivados del servidor) ─────────────────────

/** Entero con separadores de miles (es-MX). */
function fmt(n: number): string {
  return n.toLocaleString('es-MX');
}

/** Número con 1 decimal (es-MX), sin decimal cuando es entero exacto ("96.4", "200"). */
function fmt1(n: number): string {
  return n.toLocaleString('es-MX', { maximumFractionDigits: 1 });
}

/** LUNES de una semana ISO "2026-W28" como fecha SIN zona (el 4-ene siempre cae en la semana 1). */
function lunesDeSemanaIso(anioSemana: string): { numero: number; lunes: Date } | null {
  const partes = /^(\d{4})-W(\d{2})$/.exec(anioSemana);
  const anio = Number(partes?.[1]);
  const numero = Number(partes?.[2]);
  if (Number.isNaN(anio) || Number.isNaN(numero)) return null;
  // Lunes de la semana 1 = el lunes de la semana que contiene el 4 de enero (definición ISO).
  const enero4 = new Date(anio, 0, 4);
  const diaIso = enero4.getDay() === 0 ? 7 : enero4.getDay();
  const lunes = new Date(anio, 0, 4 - (diaIso - 1) + (numero - 1) * 7);
  return { numero, lunes };
}

/**
 * Rótulo de la semana del encabezado: número + rango "6 jul al 12 jul 2026" (proto .page-head
 * .sub). La FUENTE es el último bucket de la serie del SERVIDOR (`cortesPorSemana`, semana ISO en
 * UTC) — la MISMA que las barras "S##", para que el rótulo jamás desfase de la gráfica en la
 * frontera de semana (domingo en la noche, México UTC-6). Mientras la serie no está (cargando o
 * sin permiso WIP, donde no hay barras que contradecir) cae al cálculo local equivalente.
 */
function infoSemana(
  hoy: Date,
  anioSemanaServidor: string | undefined,
): { numero: number; rango: string } {
  let numero: number;
  let lunes: Date;
  const delServidor =
    anioSemanaServidor === undefined ? null : lunesDeSemanaIso(anioSemanaServidor);
  if (delServidor !== null) {
    ({ numero, lunes } = delServidor);
  } else {
    // Fallback local (misma aritmética ISO, con la fecha del navegador).
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const diaIso = d.getDay() === 0 ? 7 : d.getDay();
    lunes = new Date(d);
    lunes.setDate(d.getDate() - (diaIso - 1));
    const jueves = new Date(d);
    jueves.setDate(d.getDate() + (4 - diaIso));
    const primerEnero = new Date(jueves.getFullYear(), 0, 1);
    numero = Math.ceil(((jueves.getTime() - primerEnero.getTime()) / 86_400_000 + 1) / 7);
  }
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  const corto = (f: Date, conAnio: boolean) =>
    f.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      ...(conAnio ? { year: 'numeric' } : {}),
    });
  return { numero, rango: `${corto(lunes, false)} al ${corto(domingo, true)}` };
}

/** "actualizado hace X min" a partir del sello de la consulta (TanStack Query). */
function textoActualizado(dataUpdatedAt: number, cargando: boolean): string {
  if (dataUpdatedAt === 0) return cargando ? 'actualizando…' : 'sin datos';
  const minutos = Math.floor((Date.now() - dataUpdatedAt) / 60_000);
  if (minutos < 1) return 'actualizado hace un momento';
  if (minutos < 60) return `actualizado hace ${String(minutos)} min`;
  return `actualizado hace ${String(Math.floor(minutos / 60))} h`;
}

/**
 * Pie de KPI con TENDENCIA (proto `.trend`): flecha + delta coloreados (verde sube / rojo baja) y
 * el contexto atenuado. Si el delta no es derivable (null) solo muestra el contexto — NUNCA se
 * inventa una cifra.
 */
function PieTendencia({
  delta,
  formato,
  contexto,
}: {
  delta: number | null;
  formato: (delta: number) => string;
  contexto: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      {delta === null ? null : (
        <span
          className={`inline-flex items-center gap-0.5 font-semibold ${delta >= 0 ? 'text-ok' : 'text-crit'}`}
        >
          {delta >= 0 ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )}
          {formato(delta)}
        </span>
      )}
      <span className="text-faint">{contexto}</span>
    </span>
  );
}

// ── Órdenes por vencer (tabla izquierda) ──────────────────────────────────────────────────────────

/** Tono del chip de estado por semáforo de la orden (ADR-0013 → tokens semánticos). */
const TONO_SEMAFORO: Record<OrdenPorVencer['semaforo'], TonoEstado> = {
  atrasado: 'crit',
  enRiesgo: 'warn',
  aTiempo: 'ok',
};

/** Texto del chip por semáforo ("Atrasada 1 etapa" / "En riesgo" / "En tiempo"). */
function textoEstado(orden: OrdenPorVencer): string {
  if (orden.semaforo === 'atrasado') {
    return `Atrasada ${fmt(orden.etapasAtrasadas)} etapa${orden.etapasAtrasadas === 1 ? '' : 's'}`;
  }
  return orden.semaforo === 'enRiesgo' ? 'En riesgo' : 'En tiempo';
}

/** Compromiso compacto: "Hoy", "Mañana" o la fecha corta ("3 jul"), sin desfase de zona. */
function textoCompromiso(iso: string, hoy: Date): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) return '—';
  const fecha = new Date(a, m - 1, d);
  const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dias = Math.round((fecha.getTime() - base.getTime()) / 86_400_000);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  return fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/**
 * Tabla "Órdenes por vencer" (proto: card + `table.data`): compromisos de la RC de los próximos 7
 * días con avance (% de procesos cumplidos, barra `.bar-mini`) y el chip del semáforo. Clic en el
 * renglón → la RC de esa orden.
 */
function OrdenesPorVencerCard({
  filas,
  hoy,
}: {
  filas: OrdenPorVencer[] | null;
  hoy: Date;
}): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-(--shadow)">
      <div className="flex items-center gap-2.5 border-b px-3.5 py-3">
        <h3 className="text-sm font-semibold">Órdenes por vencer</h3>
        <span className="ml-auto text-xs text-faint">semáforo de Ruta Crítica · próx. 7 días</span>
      </div>
      {filas === null ? (
        <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground" data-testid="por-vencer-vacio">
          Nada por vencer en los próximos 7 días. ✓
        </p>
      ) : (
        <div className="overflow-x-auto">
          <TablaDensa>
            <TablaDensaEncabezado>
              <TablaDensaFila>
                <TablaDensaHead>Orden</TablaDensaHead>
                <TablaDensaHead>Modelo</TablaDensaHead>
                <TablaDensaHead>Cliente</TablaDensaHead>
                <TablaDensaHead numerica>Pzas</TablaDensaHead>
                <TablaDensaHead>Avance</TablaDensaHead>
                <TablaDensaHead>Compromiso</TablaDensaHead>
                <TablaDensaHead>Estado</TablaDensaHead>
              </TablaDensaFila>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo data-testid="por-vencer-filas">
              {filas.map((f) => (
                <TablaDensaFila
                  key={f.idOrden}
                  className="cursor-pointer"
                  onClick={() => void navigate(`/ruta-critica/ordenes/${String(f.idOrden)}`)}
                >
                  <TablaDensaCelda className="mono text-xs text-muted-foreground">
                    OP-{f.folio}
                  </TablaDensaCelda>
                  <TablaDensaCelda className="font-semibold">
                    {f.descripcionModelo ?? f.codigoModelo}
                  </TablaDensaCelda>
                  <TablaDensaCelda>{f.cliente}</TablaDensaCelda>
                  <TablaDensaCelda numerica>{fmt(f.piezas)}</TablaDensaCelda>
                  <TablaDensaCelda>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-[62px] overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${String(f.avancePct)}%` }}
                        />
                      </span>
                      <span className="num text-[11.5px] text-muted-foreground">
                        {f.avancePct}%
                      </span>
                    </span>
                  </TablaDensaCelda>
                  <TablaDensaCelda className="num">
                    {textoCompromiso(f.compromiso, hoy)}
                  </TablaDensaCelda>
                  <TablaDensaCelda>
                    <ChipEstado tono={TONO_SEMAFORO[f.semaforo]}>{textoEstado(f)}</ChipEstado>
                  </TablaDensaCelda>
                </TablaDensaFila>
              ))}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>
      )}
    </section>
  );
}

// ── Cortes por semana (barras) ────────────────────────────────────────────────────────────────────

/**
 * Gráfica de BARRAS "Cortes por semana" (proto `.chartbars`): 7 semanas (vieja→actual), altura
 * relativa al máximo de la serie, degradado de marca y etiquetas S## atenuadas. Los buckets YA
 * vienen completos del servidor (una semana sin cortes es una barra en 0).
 */
function CortesPorSemanaCard({ serie }: { serie: CorteSemanaResumen[] }): React.JSX.Element {
  const maximo = Math.max(1, ...serie.map((s) => s.piezas));
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-(--shadow)">
      <div className="flex items-center gap-2.5 border-b px-3.5 py-3">
        <h3 className="text-sm font-semibold">Cortes por semana</h3>
        <span className="ml-auto text-xs text-faint">pzas</span>
      </div>
      <div
        className="flex h-[92px] items-end gap-[7px] px-3.5 pt-2.5 pb-1"
        data-testid="cortes-barras"
      >
        {serie.map((s) => (
          <div
            key={s.anioSemana}
            className="min-h-1 flex-1 rounded-t-[4px] rounded-b-[2px] bg-gradient-to-b from-primary-bright to-primary"
            style={{ height: `${String(Math.round((s.piezas / maximo) * 100))}%` }}
            title={`${s.etiqueta}: ${fmt(s.piezas)} pzas`}
          />
        ))}
      </div>
      <div className="flex gap-[7px] px-3.5 pb-3">
        {serie.map((s) => (
          <span key={s.anioSemana} className="flex-1 text-center text-[10.5px] text-faint">
            {s.etiqueta}
          </span>
        ))}
      </div>
    </section>
  );
}

// ── Bandeja de Ruta Crítica (proto .rc-list) ──────────────────────────────────────────────────────

/** Clases del punto y de la etiqueta derecha por semáforo (mismos tonos que el chip). */
const COLOR_PUNTO_RC: Record<TareaRc['semaforo'], string> = {
  atrasado: 'bg-crit',
  enRiesgo: 'bg-warn',
  aTiempo: 'bg-ok',
};
const COLOR_TEXTO_RC: Record<TareaRc['semaforo'], string> = {
  atrasado: 'text-crit',
  enRiesgo: 'text-warn',
  aTiempo: 'text-ok',
};

/** Etiqueta derecha de una tarea ("Atrasado" / "Vence hoy" / "Mañana" / fecha corta). */
function etiquetaTarea(t: TareaRc): string {
  if (t.urgencia === 'vencida') return 'Atrasado';
  if (t.urgencia === 'hoy') return 'Vence hoy';
  if (t.urgencia === 'sinFecha') return 'Sin fecha';
  if (t.diasRestantes === 1) return 'Mañana';
  return fechaRc(t.fechaPlaneadaVigente);
}

/**
 * BANDEJA DE RUTA CRÍTICA (proto `rcItem`): los primeros procesos a capturar (atrasados/hoy
 * primero, orden del SERVIDOR — `useBandejaRc`) con punto de semáforo, proceso + "OP-#### ·
 * modelo" y la etiqueta de urgencia a la derecha. Se monta SOLO con `rc.ruta-ver` (el padre lo
 * condiciona), así el hook no consulta sin permiso.
 */
function BandejaRcCard(): React.JSX.Element {
  const bandeja = useBandejaRc({ pagina: 1, porPagina: 4 });
  const tareas = bandeja.data?.datos ?? [];
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-(--shadow)">
      <div className="flex items-center gap-2.5 border-b px-3.5 py-3">
        <h3 className="text-sm font-semibold">Bandeja de Ruta Crítica</h3>
        <Link
          to="/ruta-critica/pendientes"
          className="ml-auto text-xs text-faint hover:text-primary hover:underline"
        >
          a capturar hoy
        </Link>
      </div>
      {bandeja.isPending ? (
        <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
      ) : tareas.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nada pendiente por capturar. ✓</p>
      ) : (
        <div className="p-1.5">
          {tareas.map((t) => (
            <Link
              key={t.idRutaOrden}
              to="/ruta-critica/pendientes"
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted"
            >
              <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-full ${COLOR_PUNTO_RC[t.semaforo]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold">
                  {t.nombreProceso}
                </span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  OP-{t.folioOrden} · {t.descripcionModelo ?? t.codigoModelo}
                </span>
              </span>
              <span
                className={`shrink-0 text-[11.5px] font-semibold whitespace-nowrap ${COLOR_TEXTO_RC[t.semaforo]}`}
              >
                {etiquetaTarea(t)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
