/**
 * Piezas de presentación compartidas del módulo Indicadores (F7-E3).
 *
 * Los tableros exponen filtros Año/Mes, pero solo algunas tarjetas los honran: sus vistas
 * materializadas vienen PRE-AGREGADAS sin columna de periodo (histórico acumulado). Para que el
 * directivo no crea que TODA la página respeta el periodo elegido, esas tarjetas se ROTULAN con esta
 * leyenda (ADR-0015 §4). NO cambia el cálculo; solo hace VISIBLE la limitación.
 */
import { Info } from 'lucide-react';

/**
 * Leyenda discreta para las tarjetas cuyo dato es HISTÓRICO ACUMULADO e IGNORA los filtros
 * Año/Mes del tablero (las que corren sobre vistas pre-agregadas sin periodo).
 */
export function BadgeHistorico(): React.JSX.Element {
  return (
    <span
      className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md bg-info-soft px-2 py-0.5 text-xs font-medium text-info"
      data-testid="badge-historico"
    >
      <Info className="size-3.5 shrink-0" aria-hidden />
      Histórico acumulado — no filtra por Año/Mes
    </span>
  );
}
