import { CalendarRange, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { imprimirEdrAnual, useEdrPorAnio } from '@/api/edr';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
  TablaDensaPie,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { MESES, moneda } from './comun';

function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/**
 * EDR POR AÑO (F7-E2; doc 06-Costos-y-EDR §4; proto `vEdr` — re-vestida R9 a TABLA-FIRST): comparativo
 * mensual del año (ventas/costo/gastos/resultado) con totales de SERVIDOR y corte por empresa, y descarga
 * PDF. page-head + KPIs de vistazo + TABLA DENSA con barra de totales al pie. Solo lectura (`edr.ver`).
 */
export function EdrPorAnioPagina(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const hoy = new Date();
  const anio = num(params.get('anio') ?? '') || hoy.getFullYear();

  const consulta = useEdrPorAnio(anio);
  const datos = consulta.data ?? null;

  const kpis: Kpi[] = datos
    ? [
        {
          clave: 'ventas',
          etiqueta: 'Ventas',
          valor: moneda(datos.totalVentas),
          pie: `${datos.meses.length} mes(es)`,
        },
        {
          clave: 'costo',
          etiqueta: 'Costo',
          valor: moneda(datos.totalCosto),
          pie: 'a costo actual',
        },
        {
          clave: 'resultado',
          etiqueta: 'Resultado',
          valor: moneda(datos.totalResultado),
          pie: `año ${anio}`,
          ...(datos.totalResultado >= 0
            ? { tonoPie: 'ok' as const }
            : { tonoPie: 'crit' as const }),
        },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto" data-testid="edr-por-anio">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
          >
            <CalendarRange className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">EDR por año</h1>
            <p className="truncate text-xs text-muted-foreground">
              Comparativo mensual del año {anio}, a costo actual
            </p>
          </div>
          <Input
            type="number"
            className="h-8 w-24 text-sm"
            value={anio}
            onChange={(e) => setParams({ anio: e.target.value })}
            placeholder="Año"
            aria-label="Año"
            data-testid="pa-anio"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => imprimirEdrAnual(anio)}
            data-testid="pa-pdf"
          >
            <Printer aria-hidden />
            PDF
          </Button>
        </header>

        {consulta.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : consulta.isError ? (
          <p className="p-6 text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : !datos || datos.meses.length === 0 ? (
          <p
            className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"
            data-testid="pa-vacio"
          >
            No hay meses con EDR generado en {anio}.
          </p>
        ) : (
          <>
            {/* ── KPIs ──────────────────────────────────────────────────────── */}
            <KpiTiles kpis={kpis} className="shrink-0" />

            {/* ── Comparativo mensual ───────────────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b px-3 py-2">
                <h3 className="text-sm font-semibold">Comparativo mensual</h3>
              </div>
              <div className="overflow-x-auto">
                <TablaDensa data-testid="pa-tabla">
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Mes</TablaDensaHead>
                      <TablaDensaHead numerica>Ventas</TablaDensaHead>
                      <TablaDensaHead numerica>Costo</TablaDensaHead>
                      <TablaDensaHead numerica>Gastos</TablaDensaHead>
                      <TablaDensaHead numerica>Resultado</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.meses.map((m) => (
                      <TablaDensaFila key={m.idEdr} data-testid={`pa-mes-${m.mes}`}>
                        <TablaDensaCelda className="font-medium">
                          {MESES[m.mes - 1] ?? m.mes}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(m.ventas)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(m.costo)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(m.gastos)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(m.resultado)}</TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                  <TablaDensaPie>
                    <TablaDensaFila>
                      <TablaDensaCelda>TOTAL</TablaDensaCelda>
                      <TablaDensaCelda numerica>{moneda(datos.totalVentas)}</TablaDensaCelda>
                      <TablaDensaCelda numerica>{moneda(datos.totalCosto)}</TablaDensaCelda>
                      <TablaDensaCelda numerica>—</TablaDensaCelda>
                      <TablaDensaCelda numerica>{moneda(datos.totalResultado)}</TablaDensaCelda>
                    </TablaDensaFila>
                  </TablaDensaPie>
                </TablaDensa>
              </div>
            </div>

            {/* ── Por empresa (año) ─────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b px-3 py-2">
                <h3 className="text-sm font-semibold">Por empresa (año)</h3>
              </div>
              {datos.porEmpresa.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Sin datos.</p>
              ) : (
                <div className="overflow-x-auto">
                  <TablaDensa>
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Empresa</TablaDensaHead>
                        <TablaDensaHead numerica>Ventas</TablaDensaHead>
                        <TablaDensaHead numerica>Costo</TablaDensaHead>
                        <TablaDensaHead numerica>Utilidad</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {datos.porEmpresa.map((e) => (
                        <TablaDensaFila key={e.idEmpresa}>
                          <TablaDensaCelda>{e.empresa}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{moneda(e.ventas)}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{moneda(e.costo)}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{moneda(e.utilidadBruta)}</TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
