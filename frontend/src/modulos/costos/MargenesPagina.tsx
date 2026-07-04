import { Download, Printer, TrendingUp } from 'lucide-react';
import { useState } from 'react';

import { descargarExcelMargenes, imprimirMargenes, useMargenes } from '@/api/costos';
import type { MargenesQuery } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { moneda, porcentaje } from './comun';

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
 * COSTOS Y MÁRGENES POR PEDIDO (F7-E1; doc 06-Costos-y-EDR §5): importe, margen promedio, margen
 * ponderado y margen $ por pieza de cada pedido (fórmula D2: 1 − costo/precio). Filtrable por año/mes
 * y cliente, con impreso PDF (R9) y export a Excel. Solo lectura (`costos.ver`); importes/márgenes en
 * "—" sin `consultas.ver-importes`.
 */
export function MargenesPagina(): React.JSX.Element {
  const [anio, setAnio] = useState('');
  const [mes, setMes] = useState('');

  const query: MargenesQuery = {
    ...(anio === '' ? {} : { anio: Number(anio) }),
    ...(mes === '' ? {} : { mes: Number(mes) }),
  };
  const consulta = useMargenes(query);
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="margenes">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <TrendingUp className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Costos y márgenes por pedido</h1>
          <p className="text-sm text-muted-foreground">
            Margen = 1 − (costo unitario ÷ precio de venta). Solo pedidos con órdenes costeadas.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Márgenes</CardTitle>
              <CardDescription>
                {consulta.data
                  ? `${filas.length} pedido(s) · ${consulta.data.totalPiezas} piezas · Importe ${moneda(consulta.data.totalImporte)}`
                  : ''}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-28">
                <FieldLabel htmlFor="mg-anio">Año</FieldLabel>
                <Input
                  id="mg-anio"
                  type="number"
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                  placeholder="2026"
                  data-testid="mg-anio"
                />
              </Field>
              <Field className="w-40">
                <FieldLabel htmlFor="mg-mes">Mes</FieldLabel>
                <SelectNativo
                  id="mg-mes"
                  value={mes}
                  onChange={(e) => setMes(e.target.value)}
                  data-testid="mg-mes"
                >
                  <option value="">Todos</option>
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
              <Button
                type="button"
                variant="outline"
                onClick={() => imprimirMargenes(query)}
                data-testid="mg-pdf"
              >
                <Printer className="mr-2 size-4" aria-hidden />
                PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => descargarExcelMargenes(query)}
                data-testid="mg-excel"
              >
                <Download className="mr-2 size-4" aria-hidden />
                Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : filas.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay pedidos con órdenes costeadas para los filtros elegidos.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Piezas</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead className="text-right">Margen prom.</TableHead>
                  <TableHead className="text-right">Margen pond.</TableHead>
                  <TableHead className="text-right">Margen $/pza</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={f.idPedido} data-testid={`mg-fila-${f.idPedido}`}>
                    <TableCell className="font-medium">#{f.folio}</TableCell>
                    <TableCell>{f.cliente}</TableCell>
                    <TableCell>{f.fechaHasta ?? '—'}</TableCell>
                    <TableCell className="text-right">{f.cantidad}</TableCell>
                    <TableCell className="text-right">{moneda(f.importe)}</TableCell>
                    <TableCell className="text-right">{porcentaje(f.margenPromedio)}</TableCell>
                    <TableCell className="text-right">{porcentaje(f.margenPonderado)}</TableCell>
                    <TableCell className="text-right">{moneda(f.margenPesosPorPieza)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
