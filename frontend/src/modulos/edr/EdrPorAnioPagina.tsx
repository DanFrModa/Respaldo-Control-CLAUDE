import { CalendarRange, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { imprimirEdrAnual, useEdrPorAnio } from '@/api/edr';
import { Button } from '@/components/ui/button';
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

import { MESES, moneda } from './comun';

function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/**
 * EDR POR AÑO (F7-E2; doc 06-Costos-y-EDR §4 "EDR por año"): comparativo mensual del año (ventas/costo/
 * gastos/resultado) con totales y corte por empresa, y descarga PDF. Solo lectura (`edr.ver`).
 */
export function EdrPorAnioPagina(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const hoy = new Date();
  const anio = num(params.get('anio') ?? '') || hoy.getFullYear();

  const consulta = useEdrPorAnio(anio);
  const datos = consulta.data ?? null;

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="edr-por-anio">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <CalendarRange className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">EDR por año</h1>
          <p className="text-sm text-muted-foreground">
            Comparativo mensual del año {anio}, a costo actual.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Comparativo mensual</CardTitle>
              <CardDescription>
                {datos
                  ? `${datos.meses.length} mes(es) · Ventas ${moneda(datos.totalVentas)} · Resultado ${moneda(datos.totalResultado)}`
                  : ''}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-28">
                <FieldLabel htmlFor="pa-anio">Año</FieldLabel>
                <Input
                  id="pa-anio"
                  type="number"
                  value={anio}
                  onChange={(e) => setParams({ anio: e.target.value })}
                  data-testid="pa-anio"
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                onClick={() => imprimirEdrAnual(anio)}
                data-testid="pa-pdf"
              >
                <Printer className="mr-2 size-4" aria-hidden />
                PDF
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
          ) : !datos || datos.meses.length === 0 ? (
            <p
              className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              data-testid="pa-vacio"
            >
              No hay meses con EDR generado en {anio}.
            </p>
          ) : (
            <div className="space-y-6">
              <div className="overflow-x-auto">
                <Table data-testid="pa-tabla">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead className="text-right">Ventas</TableHead>
                      <TableHead className="text-right">Costo</TableHead>
                      <TableHead className="text-right">Gastos</TableHead>
                      <TableHead className="text-right">Resultado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {datos.meses.map((m) => (
                      <TableRow key={m.idEdr} data-testid={`pa-mes-${m.mes}`}>
                        <TableCell className="font-medium">{MESES[m.mes - 1] ?? m.mes}</TableCell>
                        <TableCell className="text-right">{moneda(m.ventas)}</TableCell>
                        <TableCell className="text-right">{moneda(m.costo)}</TableCell>
                        <TableCell className="text-right">{moneda(m.gastos)}</TableCell>
                        <TableCell className="text-right">{moneda(m.resultado)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell>TOTAL</TableCell>
                      <TableCell className="text-right">{moneda(datos.totalVentas)}</TableCell>
                      <TableCell className="text-right">{moneda(datos.totalCosto)}</TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right">{moneda(datos.totalResultado)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Por empresa (año)</h3>
                {datos.porEmpresa.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Empresa</TableHead>
                          <TableHead className="text-right">Ventas</TableHead>
                          <TableHead className="text-right">Costo</TableHead>
                          <TableHead className="text-right">Utilidad</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {datos.porEmpresa.map((e) => (
                          <TableRow key={e.idEmpresa}>
                            <TableCell>{e.empresa}</TableCell>
                            <TableCell className="text-right">{moneda(e.ventas)}</TableCell>
                            <TableCell className="text-right">{moneda(e.costo)}</TableCell>
                            <TableCell className="text-right">{moneda(e.utilidadBruta)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
