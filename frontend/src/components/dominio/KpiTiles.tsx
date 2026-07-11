import { ArrowDown, ArrowUp } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * TARJETAS DE INDICADORES del rediseño (proto `.kpis`/`.kpi`): rejilla
 * responsive de tarjetas con etiqueta chica en MAYUSCULAS, numero grande
 * tabular y un pie opcional (delta/contexto). Las usan el Resumen y los
 * tableros para dar el "vistazo" antes de la tabla.
 *
 * Fidelidad R9: metricas EXACTAS del proto (padding 13/14, etiqueta 11.5px
 * tracking .04em, valor 26px tracking -.02em, sufijo 14px) y soporte OPCIONAL
 * de TENDENCIA (proto `.foot` + `.trend`): flecha ↑/↓ de 12px + delta en
 * semibold coloreado (ok/crit) + contexto atenuado. Sin `tendencia`, el tile
 * se ve como siempre (backwards-compatible; `pie`/`tonoPie` siguen igual).
 */

/** Tendencia opcional de un KPI (proto `.trend` dentro de `.kpi .foot`). */
export interface TendenciaKpi {
  /** Direccion de la flecha (proto `.trend.up` / `.trend.down`). */
  direccion: 'sube' | 'baja';
  /** El delta ya formateado por el llamador (p. ej. "+6", "+14%", "−1.2"). */
  delta: string;
  /**
   * Tono del delta. Por default sigue al proto: sube = `ok` (verde), baja =
   * `crit` (rojo). Se puede invertir/neutralizar cuando "bajar" es bueno
   * (p. ej. defectos a la baja → `ok`).
   */
  tono?: 'ok' | 'crit' | 'neutro';
  /** Contexto atenuado junto al delta (p. ej. "vs. sem. pasada"). */
  contexto?: string;
}

/** Un indicador de la rejilla. */
export interface Kpi {
  /** Clave estable (key de React y `data-testid`). */
  clave: string;
  /** Etiqueta corta en mayusculas (p. ej. "OP EN PROCESO"). */
  etiqueta: string;
  /** El numero (ya formateado por el llamador: es-MX, %, $, …). */
  valor: React.ReactNode;
  /** Sufijo chico junto al valor (p. ej. "pzas"). */
  sufijo?: string;
  /** Pie opcional: delta o contexto ("+3 esta semana", "al corte de hoy"). */
  pie?: React.ReactNode;
  /** Tono del pie (delta positivo/negativo); sin tono = atenuado. */
  tonoPie?: 'ok' | 'crit';
  /**
   * Tendencia opcional con flecha (proto `.trend`). Normalmente se usa ESTA o
   * `pie`, no ambas (si vienen las dos, se pintan las dos lineas).
   */
  tendencia?: TendenciaKpi;
}

const TONO_PIE: Record<NonNullable<Kpi['tonoPie']>, string> = {
  ok: 'text-ok',
  crit: 'text-crit',
};

const TONO_TENDENCIA: Record<NonNullable<TendenciaKpi['tono']>, string> = {
  ok: 'text-ok',
  crit: 'text-crit',
  neutro: 'text-muted-foreground',
};

/** Tendencia de un tile (proto `.foot`: trend + contexto atenuado). */
function TendenciaTile({ tendencia }: { tendencia: TendenciaKpi }): React.JSX.Element {
  // Default del proto: la flecha hacia arriba es "bien" y hacia abajo "mal".
  const tono = tendencia.tono ?? (tendencia.direccion === 'sube' ? 'ok' : 'crit');
  return (
    <span data-slot="kpi-tendencia" className="flex items-center gap-1.5 text-xs">
      <span
        className={cn('num inline-flex items-center gap-[3px] font-semibold', TONO_TENDENCIA[tono])}
      >
        {tendencia.direccion === 'sube' ? (
          <ArrowUp className="size-3 shrink-0" aria-hidden />
        ) : (
          <ArrowDown className="size-3 shrink-0" aria-hidden />
        )}
        {/* El sentido no puede vivir solo en el color/flecha (a11y). */}
        <span className="sr-only">{tendencia.direccion === 'sube' ? 'Subió' : 'Bajó'}</span>
        <span>{tendencia.delta}</span>
      </span>
      {tendencia.contexto === undefined ? null : (
        <span className="text-faint">{tendencia.contexto}</span>
      )}
    </span>
  );
}

/** Rejilla de tarjetas KPI (auto-ajustable al ancho). */
export function KpiTiles({
  kpis,
  className,
}: {
  kpis: readonly Kpi[];
  className?: string;
}): React.JSX.Element {
  return (
    <div
      data-slot="kpi-tiles"
      className={cn(
        // Móvil (<sm): rejilla FIJA de 2 columnas compactas — el auto-fit de 11rem cae a 1 sola
        // columna en teléfono y apila los tiles a lo alto (comían ~3 pantallas, feedback de Gabriel).
        // Desde sm se restaura el auto-fit EXACTO del proto (escritorio intacto).
        'grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] sm:gap-3',
        className,
      )}
    >
      {kpis.map((kpi) => (
        <div
          key={kpi.clave}
          data-testid={`kpi-${kpi.clave}`}
          className="relative flex flex-col gap-1 overflow-hidden rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-(--shadow) sm:gap-1.5 sm:px-3.5 sm:py-[13px]"
        >
          <span className="text-[10.5px] font-semibold tracking-[0.04em] text-muted-foreground uppercase sm:text-xs">
            {kpi.etiqueta}
          </span>
          <span className="num text-[19px] leading-tight font-bold tracking-[-0.02em] sm:text-[26px]">
            {kpi.valor}
            {kpi.sufijo === undefined ? null : (
              <small className="ml-1 text-[12px] font-semibold text-muted-foreground sm:text-[14px]">
                {kpi.sufijo}
              </small>
            )}
          </span>
          {kpi.tendencia === undefined ? null : <TendenciaTile tendencia={kpi.tendencia} />}
          {kpi.pie === undefined ? null : (
            <span
              className={cn(
                'text-xs font-medium',
                kpi.tonoPie === undefined ? 'text-muted-foreground' : TONO_PIE[kpi.tonoPie],
              )}
            >
              {kpi.pie}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
