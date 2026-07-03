import { Download, Printer, RefreshCw, Route } from 'lucide-react';
import { useState } from 'react';

import {
  descargarExcelKpisRc,
  imprimirKpisRc,
  useKpisRc,
  useRefrescarKpis,
} from '@/api/indicadores';
import type { KpisRcQuery } from '@/api/tipos';
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

import { MESES, dias, entero, etiquetaMes, porcentaje, selloDatosAl } from './comun';
import { BadgeHistorico } from './piezas';

/**
 * TABLERO de KPIs de RUTA CRÍTICA (F7-E3, D11): % de entregas a tiempo (último proceso), lead time
 * por proceso, cuellos de botella, desempeño por responsable y tendencia mensual del % a tiempo. Los
 * números se calculan en segundo plano (vistas materializadas); el sello "datos al:" indica su
 * frescura y el botón Refrescar encola el recálculo. Solo lectura (`indicadores.ver`).
 */
export function TableroRcPagina(): React.JSX.Element {
  const [anio, setAnio] = useState('');
  const [mes, setMes] = useState('');

  const query: KpisRcQuery = {
    ...(anio === '' ? {} : { anio: Number(anio) }),
    ...(mes === '' ? {} : { mes: Number(mes) }),
  };
  const consulta = useKpisRc(query);
  const refrescar = useRefrescarKpis();
  const datos = consulta.data;

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="tablero-rc">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <Route className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">KPIs de Ruta Crítica</h1>
            <p className="text-sm text-muted-foreground" data-testid="rc-datos-al">
              {selloDatosAl(datos?.datosAl)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-24">
            <FieldLabel htmlFor="rc-anio">Año</FieldLabel>
            <Input
              id="rc-anio"
              type="number"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              placeholder="2026"
              data-testid="rc-anio"
            />
          </Field>
          <Field className="w-36">
            <FieldLabel htmlFor="rc-mes">Mes</FieldLabel>
            <SelectNativo
              id="rc-mes"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              data-testid="rc-mes"
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
            onClick={() => refrescar.mutate()}
            disabled={refrescar.isPending}
            data-testid="rc-refrescar"
          >
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Refrescar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => imprimirKpisRc(query)}
            data-testid="rc-pdf"
          >
            <Printer className="mr-2 size-4" aria-hidden />
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => descargarExcelKpisRc(query)}
            data-testid="rc-excel"
          >
            <Download className="mr-2 size-4" aria-hidden />
            Excel
          </Button>
        </div>
      </header>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : datos === undefined ? null : (
        <>
          <Card data-testid="rc-entregas">
            <CardHeader>
              <CardTitle>Entregas a tiempo</CardTitle>
              <CardDescription>
                % sobre órdenes MEDIBLES: último proceso cumplido en o antes de su fecha planeada.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="text-4xl font-semibold text-primary" data-testid="rc-pct">
                  {porcentaje(datos.entregasATiempo.porcentaje)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {entero(datos.entregasATiempo.aTiempo)} a tiempo de{' '}
                  {entero(datos.entregasATiempo.medibles)} medibles
                </span>
              </div>
              {datos.entregasATiempo.completadasSinPlan > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground" data-testid="rc-sin-plan">
                  {entero(datos.entregasATiempo.completadasSinPlan)} completada(s) sin plan — no
                  medibles, fuera del %
                </p>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Lead time por proceso</CardTitle>
                <CardDescription>Días reales promedio vs. estimado.</CardDescription>
                <BadgeHistorico />
              </CardHeader>
              <CardContent>
                {datos.leadTime.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Proceso</TableHead>
                        <TableHead className="text-right">n</TableHead>
                        <TableHead className="text-right">Real</TableHead>
                        <TableHead className="text-right">Estimado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {datos.leadTime.map((l) => (
                        <TableRow key={l.idProcesoDef}>
                          <TableCell>{l.nombreProceso}</TableCell>
                          <TableCell className="text-right">{l.numProcesos}</TableCell>
                          <TableCell className="text-right">{dias(l.diasRealesProm)}</TableCell>
                          <TableCell className="text-right">{dias(l.diasEstimadoProm)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cuellos de botella</CardTitle>
                <CardDescription>Atraso medio (días) por proceso, mayor primero.</CardDescription>
                <BadgeHistorico />
              </CardHeader>
              <CardContent>
                {datos.cuellosBotella.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Proceso</TableHead>
                        <TableHead className="text-right">n</TableHead>
                        <TableHead className="text-right">Atraso medio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {datos.cuellosBotella.map((c) => (
                        <TableRow key={c.idProcesoDef}>
                          <TableCell>{c.nombreProceso}</TableCell>
                          <TableCell className="text-right">{c.numProcesos}</TableCell>
                          <TableCell className="text-right">{dias(c.atrasoMedioDias)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Desempeño por responsable</CardTitle>
                <CardDescription>Quién capturó el cumplimiento y su % a tiempo.</CardDescription>
                <BadgeHistorico />
              </CardHeader>
              <CardContent>
                {datos.desempeno.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Responsable</TableHead>
                        <TableHead className="text-right">Procesos</TableHead>
                        <TableHead className="text-right">A tiempo</TableHead>
                        <TableHead className="text-right">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {datos.desempeno.map((d) => (
                        <TableRow key={d.responsableId}>
                          <TableCell>{d.responsable}</TableCell>
                          <TableCell className="text-right">{d.numProcesos}</TableCell>
                          <TableCell className="text-right">{d.aTiempo}</TableCell>
                          <TableCell className="text-right">{porcentaje(d.porcentaje)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tendencia mensual del % a tiempo</CardTitle>
                <CardDescription>Ciclo de cumplimiento por mes.</CardDescription>
              </CardHeader>
              <CardContent>
                {datos.tendencia.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mes</TableHead>
                        <TableHead className="text-right">Completadas</TableHead>
                        <TableHead className="text-right">A tiempo</TableHead>
                        <TableHead className="text-right">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {datos.tendencia.map((t) => (
                        <TableRow key={`${t.anio}-${t.mes}`}>
                          <TableCell>{etiquetaMes(t.mes, t.anio)}</TableCell>
                          <TableCell className="text-right">{t.completadas}</TableCell>
                          <TableCell className="text-right">{t.aTiempo}</TableCell>
                          <TableCell className="text-right">{porcentaje(t.porcentaje)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
