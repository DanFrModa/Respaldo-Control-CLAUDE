import { Scissors } from 'lucide-react';
import { useState } from 'react';

import { useCorteSemanal } from '@/api/etapas';
import { useProveedores, useRolesProveedor } from '@/api/proveedores';
import type { CorteSemanalQuery } from '@/api/tipos';
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

/** Valor del filtro de cortador que significa "todos". */
const TODOS = 'TODOS';

/**
 * CONSULTA DE CORTE SEMANAL por cortador (F3-E2, ref. `CorteSemanal` del viejo). Consulta agrupada
 * por cortador y semana ISO. RESPONSIVE (regla del plan: las consultas también en móvil): tabla en
 * escritorio, tarjetas apiladas en móvil. Filtros por rango de fechas y por cortador.
 *
 * `produccion.wip-ver` gobierna el acceso a la pantalla.
 */
export function CorteSemanalPagina(): React.JSX.Element {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [idCortador, setIdCortador] = useState<string>(TODOS);

  // Cortadores: proveedores con el rol "corte".
  const roles = useRolesProveedor();
  const idRolCorte = roles.data?.find((r) => r.codigo === 'corte')?.id;
  const cortadores = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(idRolCorte === undefined ? {} : { rol: idRolCorte }),
  });

  const query: CorteSemanalQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
    ...(idCortador !== TODOS ? { idCortador: Number(idCortador) } : {}),
  };
  const consulta = useCorteSemanal(query);
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Corte semanal por cortador
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Piezas cortadas por cada cortador, agrupadas por semana.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Acota por rango de fechas y/o un cortador.</CardDescription>
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
              <FieldLabel htmlFor="cortador">Cortador</FieldLabel>
              <SelectNativo
                id="cortador"
                value={idCortador}
                onChange={(e) => setIdCortador(e.target.value)}
                data-testid="corte-semanal-cortador"
              >
                <option value={TODOS}>Todos</option>
                {(cortadores.data?.datos ?? []).map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
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
          No hay cortes en el periodo seleccionado.
        </p>
      ) : (
        <>
          {/* Móvil: tarjetas apiladas. */}
          <div className="space-y-3 md:hidden" data-testid="corte-semanal-tarjetas">
            {filas.map((f) => (
              <Card key={`${f.idCortador ?? 'sin'}-${f.anioSemana}`}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{f.cortador}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.anioSemana} · desde {f.inicioSemana} · {f.numCortes} corte(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-right">
                    <Scissors className="size-4 text-muted-foreground" aria-hidden />
                    <span className="text-lg font-semibold tabular-nums">
                      {f.totalCortado.toLocaleString('es-MX')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Escritorio: tabla. */}
          <div
            className="hidden overflow-x-auto rounded-md border md:block"
            data-testid="corte-semanal-tabla"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cortador</TableHead>
                  <TableHead>Semana</TableHead>
                  <TableHead>Inicia</TableHead>
                  <TableHead className="text-right">Cortes</TableHead>
                  <TableHead className="text-right">Piezas cortadas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={`${f.idCortador ?? 'sin'}-${f.anioSemana}`}>
                    <TableCell className="font-medium">{f.cortador}</TableCell>
                    <TableCell>{f.anioSemana}</TableCell>
                    <TableCell>{f.inicioSemana}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.numCortes}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {f.totalCortado.toLocaleString('es-MX')}
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
