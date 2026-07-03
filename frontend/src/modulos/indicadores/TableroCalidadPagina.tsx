import { Download, Medal, Printer, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  descargarExcelKpisCalidad,
  imprimirKpisCalidad,
  useKpisCalidad,
  useRefrescarKpis,
} from '@/api/indicadores';
import type { KpisCalidadQuery } from '@/api/tipos';
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

import { MESES, entero, etiquetaMes, porcentaje, selloDatosAl } from './comun';
import { BadgeHistorico } from './piezas';

/**
 * TABLERO de CALIDAD por maquilero (F7-E3, F6): % de aprobación por maquilero, defectos más frecuentes
 * y tendencia mensual de aprobación. Desde las auditorías vivas, calculado en segundo plano. Solo
 * lectura (`indicadores.ver`).
 */
export function TableroCalidadPagina(): React.JSX.Element {
  const [anio, setAnio] = useState('');
  const [mes, setMes] = useState('');

  const query: KpisCalidadQuery = {
    ...(anio === '' ? {} : { anio: Number(anio) }),
    ...(mes === '' ? {} : { mes: Number(mes) }),
  };
  const consulta = useKpisCalidad(query);
  const refrescar = useRefrescarKpis();
  const datos = consulta.data;

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="tablero-calidad">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <Medal className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Calidad por maquilero</h1>
            <p className="text-sm text-muted-foreground" data-testid="cal-datos-al">
              {selloDatosAl(datos?.datosAl)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-24">
            <FieldLabel htmlFor="cal-anio">Año</FieldLabel>
            <Input
              id="cal-anio"
              type="number"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              placeholder="2026"
              data-testid="cal-anio"
            />
          </Field>
          <Field className="w-36">
            <FieldLabel htmlFor="cal-mes">Mes</FieldLabel>
            <SelectNativo
              id="cal-mes"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              data-testid="cal-mes"
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
            data-testid="cal-refrescar"
          >
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Refrescar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => imprimirKpisCalidad(query)}
            data-testid="cal-pdf"
          >
            <Printer className="mr-2 size-4" aria-hidden />
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => descargarExcelKpisCalidad(query)}
            data-testid="cal-excel"
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Aprobación por maquilero</CardTitle>
              <CardDescription>
                % aprobación = aprobadas ÷ auditorías con veredicto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {datos.maquileros.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin auditorías registradas.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Maquilero</TableHead>
                      <TableHead className="text-right">Auditorías</TableHead>
                      <TableHead className="text-right">Aprobadas</TableHead>
                      <TableHead className="text-right">Calificadas</TableHead>
                      <TableHead className="text-right">% aprob.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {datos.maquileros.map((m) => (
                      <TableRow key={m.idMaquilero} data-testid={`cal-maq-${m.idMaquilero}`}>
                        <TableCell>{m.maquilero}</TableCell>
                        <TableCell className="text-right">{m.numAuditorias}</TableCell>
                        <TableCell className="text-right">{m.aprobadas}</TableCell>
                        <TableCell className="text-right">{m.calificadas}</TableCell>
                        <TableCell className="text-right">{porcentaje(m.porcentaje)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Defectos más frecuentes</CardTitle>
              <CardDescription>Suma de fallas contadas (top 10).</CardDescription>
              <BadgeHistorico />
            </CardHeader>
            <CardContent>
              {datos.defectosTop.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin defectos registrados.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Clave</TableHead>
                      <TableHead>Defecto</TableHead>
                      <TableHead className="text-right">Fallas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {datos.defectosTop.map((d) => (
                      <TableRow key={d.idDefecto}>
                        <TableCell className="font-medium">{d.clave}</TableCell>
                        <TableCell>{d.descripcion}</TableCell>
                        <TableCell className="text-right">{entero(d.totalFallas)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tendencia mensual</CardTitle>
              <CardDescription>% de aprobación por mes.</CardDescription>
            </CardHeader>
            <CardContent>
              {datos.tendencia.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead className="text-right">Auditorías</TableHead>
                      <TableHead className="text-right">Aprobadas</TableHead>
                      <TableHead className="text-right">% aprob.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {datos.tendencia.map((t) => (
                      <TableRow key={`${t.anio}-${t.mes}`}>
                        <TableCell>{etiquetaMes(t.mes, t.anio)}</TableCell>
                        <TableCell className="text-right">{t.numAuditorias}</TableCell>
                        <TableCell className="text-right">{t.aprobadas}</TableCell>
                        <TableCell className="text-right">{porcentaje(t.porcentaje)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
