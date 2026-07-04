import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { usePagosSemanales } from '@/api/esma';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { finSemana, inicioSemana, moneda } from './comun';

/** Desplaza un `YYYY-MM-DD` en `dias` días (UTC). */
function desplazar(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * PAGOS SEMANALES (F6-E5, ex `EsMa_PagosSem`): los pagos de la semana con navegación semana
 * actual/anterior/siguiente y el total del periodo. Lectura de cuenta con `esma.ver-pagos`; importes
 * "—" sin `consultas.ver-importes`.
 */
export function PagosSemanalesPagina(): React.JSX.Element {
  const [semana, setSemana] = useState(() => inicioSemana(new Date()));
  const desde = semana;
  const hasta = finSemana(semana);
  const consulta = usePagosSemanales({ desde, hasta });
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="pagos-semanales">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <CalendarClock className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Pagos semanales</h1>
          <p className="text-sm text-muted-foreground">
            Los pagos a maquileros de la semana, con su total.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Semana</CardTitle>
              <CardDescription data-testid="pagsem-rango">
                {desde} a {hasta}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSemana((s) => desplazar(s, -7))}
                data-testid="pagsem-anterior"
              >
                <ChevronLeft aria-hidden /> Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSemana(inicioSemana(new Date()))}
                data-testid="pagsem-actual"
              >
                Semana actual
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSemana((s) => desplazar(s, 7))}
                data-testid="pagsem-siguiente"
              >
                Siguiente <ChevronRight aria-hidden />
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
              No hubo pagos en esta semana.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground" data-testid="pagsem-total">
                {filas.length} pago(s) · total{' '}
                <strong>{moneda(consulta.data?.total ?? null)}</strong>.
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Maquilero</TableHead>
                      <TableHead>Facturación</TableHead>
                      <TableHead className="text-right">Cargos</TableHead>
                      <TableHead>Revisión</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((p) => (
                      <TableRow key={p.id} data-testid="pagsem-fila">
                        <TableCell>{p.fecha}</TableCell>
                        <TableCell className="font-medium">{p.maquilero}</TableCell>
                        <TableCell>
                          {p.conFactura === null ? '—' : p.conFactura ? 'Con' : 'Sin'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.numAplicaciones}
                        </TableCell>
                        <TableCell>
                          {p.estadoRevision === 'revisado' ? 'Revisado' : 'Capturado'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{moneda(p.monto)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
