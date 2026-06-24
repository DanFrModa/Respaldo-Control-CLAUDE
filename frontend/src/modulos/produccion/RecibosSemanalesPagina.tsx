import { CalendarRange, PackageCheck } from 'lucide-react';
import { useState } from 'react';

import { useProveedores } from '@/api/proveedores';
import { useRecibosSemanales } from '@/api/recibos';
import type { RecibosSemanalesQuery } from '@/api/tipos';
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

/** Valor del filtro de maquilero que significa "todos". */
const TODOS = 'TODOS';

/**
 * CONSULTA DE RECIBOS SEMANALES por maquilero (F3-E4, espejo de la consulta de corte semanal).
 * Consulta agrupada por maquilero y semana ISO, con el desglose primeras/segundas. RESPONSIVE
 * (regla del plan: las consultas también en móvil): tabla en escritorio, tarjetas apiladas en móvil.
 * Filtros por rango de fechas y por maquilero (cualquier rol de maquila).
 *
 * `produccion.wip-ver` gobierna el acceso a la pantalla.
 */
export function RecibosSemanalesPagina(): React.JSX.Element {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [idMaquilero, setIdMaquilero] = useState<string>(TODOS);

  // Maquileros: todos los proveedores (un maquilero puede tener cualquier rol de maquila).
  const maquileros = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const query: RecibosSemanalesQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
    ...(idMaquilero !== TODOS ? { idMaquilero: Number(idMaquilero) } : {}),
  };
  const consulta = useRecibosSemanales(query);
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <CalendarRange className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Recibos semanales por maquilero</h1>
          <p className="text-sm text-muted-foreground">
            Piezas recibidas por cada maquilero, agrupadas por semana.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Acota por rango de fechas y/o un maquilero.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="desde">Desde</FieldLabel>
              <Input
                id="desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="hasta">Hasta</FieldLabel>
              <Input
                id="hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="maquilero">Maquilero</FieldLabel>
              <SelectNativo
                id="maquilero"
                value={idMaquilero}
                onChange={(e) => setIdMaquilero(e.target.value)}
                data-testid="recibos-semanales-maquilero"
              >
                <option value={TODOS}>Todos</option>
                {(maquileros.data?.datos ?? []).map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
          </div>
        </CardContent>
      </Card>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : null}

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay recibos en el periodo seleccionado.
        </p>
      ) : (
        <>
          {/* Móvil: tarjetas apiladas. */}
          <div className="space-y-3 md:hidden" data-testid="recibos-semanales-tarjetas">
            {filas.map((f) => (
              <Card key={`${f.idMaquilero ?? 'sin'}-${f.anioSemana}`}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{f.maquilero}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.anioSemana} · desde {f.inicioSemana} · {f.numRecibos} recibo(s)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {f.totalPrimeras.toLocaleString('es-MX')} primeras ·{' '}
                      {f.totalSegundas.toLocaleString('es-MX')} segundas
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-right">
                    <PackageCheck className="size-4 text-muted-foreground" aria-hidden />
                    <span className="text-lg font-semibold tabular-nums">
                      {f.totalRecibido.toLocaleString('es-MX')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Escritorio: tabla. */}
          <div
            className="hidden overflow-x-auto rounded-md border md:block"
            data-testid="recibos-semanales-tabla"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Maquilero</TableHead>
                  <TableHead>Semana</TableHead>
                  <TableHead>Inicia</TableHead>
                  <TableHead className="text-right">Recibos</TableHead>
                  <TableHead className="text-right">Total recibido</TableHead>
                  <TableHead className="text-right">Primeras</TableHead>
                  <TableHead className="text-right">Segundas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={`${f.idMaquilero ?? 'sin'}-${f.anioSemana}`}>
                    <TableCell className="font-medium">{f.maquilero}</TableCell>
                    <TableCell>{f.anioSemana}</TableCell>
                    <TableCell>{f.inicioSemana}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.numRecibos}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {f.totalRecibido.toLocaleString('es-MX')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.totalPrimeras.toLocaleString('es-MX')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.totalSegundas.toLocaleString('es-MX')}
                    </TableCell>
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
