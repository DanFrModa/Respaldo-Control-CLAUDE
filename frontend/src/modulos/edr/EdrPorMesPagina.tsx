import { Download, FileBarChart, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { descargarExcelEdr, imprimirEdrMensual, useEdrPorMes } from '@/api/edr';
import type { EdrCorte } from '@/api/tipos';
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

import { etiquetaMes, MESES, moneda } from './comun';

function num(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

/**
 * EDR POR MES (F7-E2; doc 06-Costos-y-EDR §4): el resultado del mes (Ventas − Costo − Gastos −
 * Intereses + Bonif ± Otros = Resultado) con corte por empresa y por cliente, y descarga PDF/Excel.
 * Solo lectura (`edr.ver`). El costo es ACTUAL (D1).
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

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="edr-por-mes">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <FileBarChart className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">EDR por mes</h1>
          <p className="text-sm text-muted-foreground">
            Resultado consolidado de {etiquetaMes(mes, anio)}, valuado a costo actual.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Resultado del mes</CardTitle>
              <CardDescription>Ventas menos costo, gastos e intereses.</CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-24">
                <FieldLabel htmlFor="pm-anio">Año</FieldLabel>
                <Input
                  id="pm-anio"
                  type="number"
                  value={anio}
                  onChange={(e) => cambiar(num(e.target.value), mes)}
                  data-testid="pm-anio"
                />
              </Field>
              <Field className="w-36">
                <FieldLabel htmlFor="pm-mes">Mes</FieldLabel>
                <SelectNativo
                  id="pm-mes"
                  value={mes}
                  onChange={(e) => cambiar(anio, num(e.target.value))}
                  data-testid="pm-mes"
                >
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
              {edr && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => imprimirEdrMensual(edr.encabezado.id)}
                    data-testid="pm-pdf"
                  >
                    <Printer className="mr-2 size-4" aria-hidden />
                    PDF
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => descargarExcelEdr(edr.encabezado.id)}
                    data-testid="pm-excel"
                  >
                    <Download className="mr-2 size-4" aria-hidden />
                    Excel
                  </Button>
                </>
              )}
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
          ) : !consulta.data?.existe || !edr ? (
            <p
              className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              data-testid="pm-no-generado"
            >
              El EDR de {etiquetaMes(mes, anio)} aún no se ha generado.
            </p>
          ) : (
            <div className="space-y-6">
              <dl className="mx-auto max-w-md space-y-1 text-sm" data-testid="pm-resumen">
                <Renglon etiqueta="Ventas" valor={moneda(edr.ventas)} />
                <Renglon etiqueta="(−) Costo (actual)" valor={moneda(edr.costo)} />
                <Renglon
                  etiqueta="(=) Utilidad bruta"
                  valor={moneda(Math.round((edr.ventas - edr.costo) * 100) / 100)}
                />
                <Renglon etiqueta="(−) Gastos" valor={moneda(edr.gastos)} />
                <Renglon etiqueta="(−) Intereses" valor={moneda(edr.intereses)} />
                <Renglon etiqueta="(+) Bonificaciones" valor={moneda(edr.bonificaciones)} />
                <Renglon etiqueta="(±) Otros" valor={moneda(edr.otros)} />
                <div className="flex items-center justify-between border-t border-primary pt-2 text-base font-semibold">
                  <dt>Resultado</dt>
                  <dd className="text-primary" data-testid="pm-resultado">
                    {moneda(edr.resultado)}
                  </dd>
                </div>
              </dl>

              {edr.lineasSinCosto > 0 && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Renglon(props: { etiqueta: string; valor: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{props.etiqueta}</dt>
      <dd>{props.valor}</dd>
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
    <div>
      <h3 className="mb-2 text-sm font-medium">{props.titulo}</h3>
      {props.cortes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin datos.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid={props.testid}>
            <TableHeader>
              <TableRow>
                <TableHead>{props.cabecera}</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-right">Utilidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.cortes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.nombre}</TableCell>
                  <TableCell className="text-right">{moneda(c.ventas)}</TableCell>
                  <TableCell className="text-right">{moneda(c.costo)}</TableCell>
                  <TableCell className="text-right">{moneda(c.utilidadBruta)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
