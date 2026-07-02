import { PackageCheck } from 'lucide-react';
import { useState } from 'react';

import { useRecibosSemanalesEsMa } from '@/api/esma';
import type { EsMaRecibosSemanalesQuery } from '@/api/tipos';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { SelectorMaquilero, type TipoMaquilero } from './SelectorMaquilero';
import { moneda } from './comun';

/** Formatea un entero con separadores de miles (es-MX). */
function fmt(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * RECIBOS SEMANALES DE MAQUILA (F6-E5, ex `RecibosSemanalesMaq`, menú 3.8): los recibos del periodo por
 * maquilero/modelo, valuados al precio pactado. Filtros: rango de fechas + maquilero (opcional). A
 * diferencia de la consulta de producción, aquí SÍ hay importes (visibles solo con
 * `consultas.ver-importes`). Lectura de cuenta con `esma.ver-pagos`.
 */
export function RecibosSemanalesEsMaPagina(): React.JSX.Element {
  const [tipo, setTipo] = useState<TipoMaquilero>('');
  const [idMaquilero, setIdMaquilero] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const query: EsMaRecibosSemanalesQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
    ...(idMaquilero !== '' ? { idMaquilero: Number(idMaquilero) } : {}),
  };
  const consulta = useRecibosSemanalesEsMa(query);
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="recibos-semanales-esma">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <PackageCheck className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Recibos semanales de maquila</h1>
          <p className="text-sm text-muted-foreground">
            Los recibos del periodo por maquilero y modelo, valuados al precio pactado.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Acota por maquilero (opcional) y rango de fechas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectorMaquilero
              tipo={tipo}
              onCambioTipo={(t) => {
                setTipo(t);
                setIdMaquilero('');
              }}
              idMaquilero={idMaquilero}
              onCambioMaquilero={setIdMaquilero}
              idPrefijo="recsem"
            />
            <Field>
              <FieldLabel htmlFor="recsem-desde">Desde</FieldLabel>
              <Input
                id="recsem-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                data-testid="recsem-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="recsem-hasta">Hasta</FieldLabel>
              <Input
                id="recsem-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                data-testid="recsem-hasta"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : filas.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay recibos que coincidan con el filtro.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="recsem-total">
            {filas.length} recibo(s) · {fmt(consulta.data?.totalCantidad ?? 0)} pzas · importe{' '}
            <strong>{moneda(consulta.data?.totalImporte ?? null)}</strong>.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table data-testid="recsem-tabla">
              <TableHeader>
                <TableRow>
                  <TableHead>Recibo</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Maquilero</TableHead>
                  <TableHead>Orden</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Proceso</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((r) => (
                  <TableRow key={r.idRecibo} data-testid="recsem-fila">
                    <TableCell>#{r.folioRecibo}</TableCell>
                    <TableCell>{r.fecha}</TableCell>
                    <TableCell className="font-medium">{r.maquilero}</TableCell>
                    <TableCell>#{r.folioOrden}</TableCell>
                    <TableCell>{r.codigoModelo}</TableCell>
                    <TableCell>{r.tipoProceso}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.cantidad)}</TableCell>
                    <TableCell className="text-right tabular-nums">{moneda(r.importe)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
