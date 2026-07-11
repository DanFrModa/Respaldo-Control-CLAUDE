import { Download, Printer } from 'lucide-react';
import { useState } from 'react';

import { descargarExcelMargenes, imprimirMargenes, useMargenes } from '@/api/costos';
import type { MargenesQuery } from '@/api/tipos';
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

import { fechaCorta, moneda, porcentaje } from './comun';

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/**
 * COSTOS Y MÁRGENES POR PEDIDO (F7-E1; doc 06-Costos-y-EDR §5; proto `vCostos` — re-vestida R9 a
 * TABLA-FIRST): importe, margen promedio, margen ponderado y margen $ por pieza de cada pedido (fórmula
 * D2: 1 − costo/precio). page-head + KPIs de vistazo (Σ de SERVIDOR: pedidos · piezas · importe) +
 * toolbar (año/mes) + TABLA DENSA + barra de totales al pie. Impreso PDF (R9) y export Excel. Solo
 * lectura (`costos.ver`); importes/márgenes en "—" sin `consultas.ver-importes`.
 *
 * A1: los totales (piezas/importe) los agrega el SERVIDOR (`totalPiezas`/`totalImporte`); el margen
 * promedio del periodo NO se pivotea en cliente (sería mezclar márgenes ponderados) → no va como KPI.
 */
export function MargenesPagina(): React.JSX.Element {
  const [anio, setAnio] = useState('');
  const [mes, setMes] = useState('');

  const query: MargenesQuery = {
    ...(anio === '' ? {} : { anio: Number(anio) }),
    ...(mes === '' ? {} : { mes: Number(mes) }),
  };
  const consulta = useMargenes(query);
  const datos = consulta.data;
  const filas = datos?.filas ?? [];

  const kpis: Kpi[] = [
    {
      clave: 'pedidos',
      etiqueta: 'Pedidos',
      valor: filas.length.toLocaleString('es-MX'),
      pie: 'con órdenes costeadas',
    },
    {
      clave: 'piezas',
      etiqueta: 'Piezas',
      valor: (datos?.totalPiezas ?? 0).toLocaleString('es-MX'),
      pie: 'del periodo',
    },
    {
      clave: 'importe',
      etiqueta: 'Importe',
      valor: moneda(datos?.totalImporte ?? 0),
      pie: 'ventas del periodo',
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5" data-testid="margenes">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Costos y márgenes por pedido
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Margen = 1 − (costo unitario ÷ precio de venta) · solo pedidos con órdenes costeadas
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => imprimirMargenes(query)}
          data-testid="mg-pdf"
        >
          <Printer aria-hidden />
          PDF
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => descargarExcelMargenes(query)}
          data-testid="mg-excel"
        >
          <Download aria-hidden />
          Excel
        </Button>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <KpiTiles kpis={kpis} className="shrink-0" />

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <Input
            type="number"
            className="h-8 w-24 text-sm"
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            placeholder="Año"
            aria-label="Filtrar por año"
            data-testid="mg-anio"
          />
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            aria-label="Filtrar por mes"
            data-testid="mg-mes"
          >
            <option value="">Todos los meses</option>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </SelectNativo>
          <div className="ml-auto">
            <span className="text-[12px] text-faint">
              {filas.length.toLocaleString('es-MX')} pedidos
            </span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : filas.length === 0 ? (
            <p className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No hay pedidos con órdenes costeadas para los filtros elegidos.
            </p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Pedido</TablaDensaHead>
                  <TablaDensaHead>Cliente</TablaDensaHead>
                  <TablaDensaHead>Fecha</TablaDensaHead>
                  <TablaDensaHead numerica>Piezas</TablaDensaHead>
                  <TablaDensaHead numerica>Importe</TablaDensaHead>
                  <TablaDensaHead numerica>Margen prom.</TablaDensaHead>
                  <TablaDensaHead numerica>Margen pond.</TablaDensaHead>
                  <TablaDensaHead numerica>Margen $/pza</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((f) => (
                  <TablaDensaFila key={f.idPedido} data-testid={`mg-fila-${f.idPedido}`}>
                    <TablaDensaCelda className="font-medium">#{f.folio}</TablaDensaCelda>
                    <TablaDensaCelda>{f.cliente}</TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {fechaCorta(f.fechaHasta)}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>{f.cantidad.toLocaleString('es-MX')}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(f.importe)}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{porcentaje(f.margenPromedio)}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{porcentaje(f.margenPonderado)}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(f.margenPesosPorPieza)}</TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Pedidos</span>
            <b className="num">{filas.length.toLocaleString('es-MX')}</b>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Piezas</span>
            <b className="num">{(datos?.totalPiezas ?? 0).toLocaleString('es-MX')}</b>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Importe</span>
            <b className="num">{moneda(datos?.totalImporte ?? 0)}</b>
          </span>
        </div>
      </div>
    </div>
  );
}
