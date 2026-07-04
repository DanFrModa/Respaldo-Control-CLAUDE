import { BarChart3 } from 'lucide-react';
import { useState } from 'react';

import { useTableroProductividad } from '@/api/productividad';
import type { TableroProductividadQuery } from '@/api/tipos';
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

import { numero, porcentaje } from './comun';

type Area = 'ip' | 'almacen';
type Agrupacion = 'dia' | 'semana' | 'mes';

/**
 * TABLERO de productividad vs estándar (F7-E4; doc 05 §A.1/§B.1). Agrega en el SERVIDOR los registros
 * diarios reales por periodo (día/semana ISO/mes) × actividad × persona — la variante limpia (Σ +
 * promedio), no las heurísticas /5 y /30 del viejo. Solo lectura; el permiso lo re-verifica el backend.
 */
export function TableroProductividadPagina(): React.JSX.Element {
  const [area, setArea] = useState<Area>('ip');
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('semana');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const query: TableroProductividadQuery = {
    area,
    agrupacion,
    ...(desde === '' ? {} : { desde }),
    ...(hasta === '' ? {} : { hasta }),
  };
  const consulta = useTableroProductividad(query);
  const filas = consulta.data?.filas ?? [];
  const etiquetaEstandar = area === 'ip' ? 'Peso (%D)' : 'Pz/pers/día';

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="tablero-productividad">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <BarChart3 className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Productividad vs estándar</h1>
            <p className="text-sm text-muted-foreground">
              Índices agregados por periodo, actividad y persona.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-48">
            <FieldLabel htmlFor="tp-area">Área</FieldLabel>
            <SelectNativo
              id="tp-area"
              value={area}
              onChange={(e) => setArea(e.target.value as Area)}
              data-testid="tp-area"
            >
              <option value="ip">Ingeniería del Producto</option>
              <option value="almacen">Almacén</option>
            </SelectNativo>
          </Field>
          <Field className="w-36">
            <FieldLabel htmlFor="tp-agrupacion">Agrupación</FieldLabel>
            <SelectNativo
              id="tp-agrupacion"
              value={agrupacion}
              onChange={(e) => setAgrupacion(e.target.value as Agrupacion)}
              data-testid="tp-agrupacion"
            >
              <option value="dia">Día</option>
              <option value="semana">Semana</option>
              <option value="mes">Mes</option>
            </SelectNativo>
          </Field>
          <Field className="w-40">
            <FieldLabel htmlFor="tp-desde">Desde</FieldLabel>
            <Input
              id="tp-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </Field>
          <Field className="w-40">
            <FieldLabel htmlFor="tp-hasta">Hasta</FieldLabel>
            <Input
              id="tp-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </Field>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Índice por periodo</CardTitle>
          <CardDescription>
            {area === 'ip'
              ? 'Índice IP = (horas base ÷ horas trabajadas) × peso × cantidad, sumado y promediado por periodo.'
              : 'Índice almacén = eficiencia vs estándar (jornada base configurable), sumado y promediado por periodo.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin registros en el periodo.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Actividad</TableHead>
                    {area === 'ip' && <TableHead>Persona</TableHead>}
                    <TableHead className="text-right">Reg.</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Índice total</TableHead>
                    <TableHead className="text-right">Índice prom.</TableHead>
                    <TableHead className="text-right">% trab.</TableHead>
                    <TableHead className="text-right">{etiquetaEstandar}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((f, i) => (
                    <TableRow
                      key={`${f.periodo}-${f.idActividad}-${f.idPersona ?? 0}-${i}`}
                      data-testid="tp-fila"
                    >
                      <TableCell>{f.periodo}</TableCell>
                      <TableCell>{f.actividad}</TableCell>
                      {area === 'ip' && <TableCell>{f.persona ?? '—'}</TableCell>}
                      <TableCell className="text-right">{f.numRegistros}</TableCell>
                      <TableCell className="text-right">{numero(f.cantidad)}</TableCell>
                      <TableCell className="text-right">{numero(f.horasTrabajadas)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {numero(f.indiceTotal)}
                      </TableCell>
                      <TableCell className="text-right">{numero(f.indicePromedio)}</TableCell>
                      <TableCell className="text-right">
                        {porcentaje(f.porcentajeTrabajado)}
                      </TableCell>
                      <TableCell className="text-right">{numero(f.estandar)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
