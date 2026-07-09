import { Download, FileBarChart, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { descargarExcelEdr, imprimirEdrMensual, useEdrPorMes } from '@/api/edr';
import type { EdrCorte } from '@/api/tipos';
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
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { etiquetaMes, MESES, moneda } from './comun';

function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/**
 * EDR POR MES (F7-E2; doc 06-Costos-y-EDR §4; proto `vEdr` — re-vestida R9 a TABLA-FIRST): el resultado
 * del mes (Ventas − Costo − Gastos − Intereses + Bonif ± Otros = Resultado) con corte por empresa y por
 * cliente, y descarga PDF/Excel. page-head + KPIs de vistazo (Σ de SERVIDOR) + waterfall del P&L +
 * TABLAS DENSAS de corte. Solo lectura (`edr.ver`). El costo es ACTUAL (D1).
 */
export function EdrPorMesPagina(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const hoy = new Date();
  const anio = num(params.get('anio') ?? '') || hoy.getFullYear();
  const mes = num(params.get('mes') ?? '') || hoy.getMonth() + 1;

  const consulta = useEdrPorMes(anio, mes);
  const edr = consulta.data?.edr ?? null;

  function cambiar(a: number, m: number): void {
    setParams({ anio: String(a), mes: String(m) });
  }

  // Utilidad bruta = ventas − costo, YA calculada EN SERVIDOR (mismo criterio que los cortes; A1).
  const utilidadBruta = edr?.utilidadBruta ?? 0;
  const kpis: Kpi[] = edr
    ? [
        { clave: 'ventas', etiqueta: 'Ventas', valor: moneda(edr.ventas), pie: 'del periodo' },
        { clave: 'costo', etiqueta: 'Costo (actual)', valor: moneda(edr.costo), pie: 'D1' },
        {
          clave: 'utilidad',
          etiqueta: 'Utilidad bruta',
          valor: moneda(utilidadBruta),
          pie: 'ventas − costo',
        },
        {
          clave: 'resultado',
          etiqueta: 'Resultado',
          valor: moneda(edr.resultado),
          pie: 'neto del mes',
          ...(edr.resultado >= 0 ? { tonoPie: 'ok' as const } : { tonoPie: 'crit' as const }),
        },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto" data-testid="edr-por-mes">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
          >
            <FileBarChart className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">EDR por mes</h1>
            <p className="truncate text-xs text-muted-foreground">
              Resultado consolidado de {etiquetaMes(mes, anio)}, valuado a costo actual
            </p>
          </div>
          <Input
            type="number"
            className="h-8 w-24 text-sm"
            value={anio}
            onChange={(e) => cambiar(num(e.target.value), mes)}
            placeholder="Año"
            aria-label="Año"
            data-testid="pm-anio"
          />
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={mes}
            onChange={(e) => cambiar(anio, num(e.target.value))}
            aria-label="Mes"
            data-testid="pm-mes"
          >
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </SelectNativo>
          {edr && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => imprimirEdrMensual(edr.encabezado.id)}
                data-testid="pm-pdf"
              >
                <Printer aria-hidden />
                PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => descargarExcelEdr(edr.encabezado.id)}
                data-testid="pm-excel"
              >
                <Download aria-hidden />
                Excel
              </Button>
            </>
          )}
        </header>

        {consulta.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : consulta.isError ? (
          <p className="p-6 text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : !consulta.data?.existe || !edr ? (
          <p
            className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"
            data-testid="pm-no-generado"
          >
            El EDR de {etiquetaMes(mes, anio)} aún no se ha generado.
          </p>
        ) : (
          <>
            {/* ── KPIs ──────────────────────────────────────────────────────── */}
            <KpiTiles kpis={kpis} className="shrink-0" />

            {/* ── Waterfall del P&L ─────────────────────────────────────────── */}
            <div className="rounded-xl border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold">Resultado del mes</h3>
              <dl className="mx-auto max-w-md space-y-1 text-sm" data-testid="pm-resumen">
                <Renglon etiqueta="Ventas" valor={moneda(edr.ventas)} />
                <Renglon etiqueta="(−) Costo (actual)" valor={moneda(edr.costo)} />
                <Renglon etiqueta="(=) Utilidad bruta" valor={moneda(utilidadBruta)} />
                <Renglon etiqueta="(−) Gastos" valor={moneda(edr.gastos)} />
                <Renglon etiqueta="(−) Intereses" valor={moneda(edr.intereses)} />
                <Renglon etiqueta="(+) Bonificaciones" valor={moneda(edr.bonificaciones)} />
                <Renglon etiqueta="(±) Otros" valor={moneda(edr.otros)} />
                <div className="flex items-center justify-between border-t border-primary pt-2 text-base font-semibold">
                  <dt>Resultado</dt>
                  <dd className="num text-primary" data-testid="pm-resultado">
                    {moneda(edr.resultado)}
                  </dd>
                </div>
              </dl>
            </div>

            {edr.lineasSinCosto > 0 && (
              <p className="rounded-lg border border-crit/40 bg-crit-soft p-3 text-sm text-crit">
                {edr.lineasSinCosto} línea(s) sin costo (no valuadas). Revisa el costeo de sus
                órdenes en Costos.
              </p>
            )}

            <CorteTabla
              titulo="Por empresa"
              cabecera="Empresa"
              cortes={edr.cortesEmpresa}
              testid="pm-empresa"
            />
            <CorteTabla
              titulo="Por cliente"
              cabecera="Cliente"
              cortes={edr.cortesCliente}
              testid="pm-cliente"
            />
          </>
        )}
      </div>
    </div>
  );
}

function Renglon(props: { etiqueta: string; valor: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{props.etiqueta}</dt>
      <dd className="num">{props.valor}</dd>
    </div>
  );
}

function CorteTabla(props: {
  titulo: string;
  cabecera: string;
  cortes: EdrCorte[];
  testid: string;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-3 py-2">
        <h3 className="text-sm font-semibold">{props.titulo}</h3>
      </div>
      {props.cortes.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Sin datos.</p>
      ) : (
        <div className="overflow-x-auto">
          <TablaDensa data-testid={props.testid}>
            <TablaDensaEncabezado>
              <TablaDensaFila>
                <TablaDensaHead>{props.cabecera}</TablaDensaHead>
                <TablaDensaHead numerica>Ventas</TablaDensaHead>
                <TablaDensaHead numerica>Costo</TablaDensaHead>
                <TablaDensaHead numerica>Utilidad</TablaDensaHead>
              </TablaDensaFila>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo>
              {props.cortes.map((c) => (
                <TablaDensaFila key={c.id}>
                  <TablaDensaCelda>{c.nombre}</TablaDensaCelda>
                  <TablaDensaCelda numerica>{moneda(c.ventas)}</TablaDensaCelda>
                  <TablaDensaCelda numerica>{moneda(c.costo)}</TablaDensaCelda>
                  <TablaDensaCelda numerica>{moneda(c.utilidadBruta)}</TablaDensaCelda>
                </TablaDensaFila>
              ))}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>
      )}
    </div>
  );
}
