import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * TARJETAS DE INDICADORES del rediseño (proto `.kpis`/`.kpi`): rejilla
 * responsive de tarjetas con etiqueta chica en MAYUSCULAS, numero grande
 * tabular y un pie opcional (delta/contexto). Las usan el Resumen y los
 * tableros para dar el "vistazo" antes de la tabla.
 */

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
}

const TONO_PIE: Record<NonNullable<Kpi['tonoPie']>, string> = {
  ok: 'text-ok',
  crit: 'text-crit',
};

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
      className={cn('grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3', className)}
    >
      {kpis.map((kpi) => (
        <div
          key={kpi.clave}
          data-testid={`kpi-${kpi.clave}`}
          className="flex flex-col gap-1.5 rounded-lg border bg-card p-3.5 text-card-foreground shadow-(--shadow)"
        >
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {kpi.etiqueta}
          </span>
          <span className="num text-2xl font-bold tracking-tight">
            {kpi.valor}
            {kpi.sufijo === undefined ? null : (
              <small className="ml-1 text-sm font-semibold text-muted-foreground">
                {kpi.sufijo}
              </small>
            )}
          </span>
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
