import { Boxes, Warehouse } from 'lucide-react';
import { useState } from 'react';

import { useAlmacenes } from '@/api/almacenes';
import { useExistenciasAvio } from '@/api/inventario-materiales';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Valor del filtro que significa "todos". */
const TODOS = 'TODOS';

/**
 * EXISTENCIAS de AVÍOS (F4-E1, doc 04-Inventarios §B; R4). Inventario MULTI-ALMACÉN: existencia por
 * avío×almacén (Σ de movimientos, D3). Distingue los avíos GENÉRICOS de stock (R4) con un badge y
 * permite filtrar "solo genéricos". Consulta MÓVIL: tabla en escritorio, tarjetas en móvil.
 * `inventario-avios.ver` gobierna el acceso.
 */
export function ExistenciasAviosPagina(): React.JSX.Element {
  const [idAlmacen, setIdAlmacen] = useState<string>(TODOS);
  const [soloGenericos, setSoloGenericos] = useState(false);
  const [incluirCeros, setIncluirCeros] = useState(false);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const consulta = useExistenciasAvio({
    ...(idAlmacen !== TODOS ? { idAlmacen: Number(idAlmacen) } : {}),
    ...(soloGenericos ? { soloGenericos: 'true' } : {}),
    ...(incluirCeros ? { incluirCeros: 'true' } : {}),
  });
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <Boxes className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Inventario de avíos</h1>
          <p className="text-sm text-muted-foreground">
            Existencia por avío y almacén (suma de movimientos). Los genéricos de stock se marcan.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Acota por almacén y tipo de avío.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="almacen">Almacén</FieldLabel>
              <SelectNativo
                id="almacen"
                value={idAlmacen}
                onChange={(e) => setIdAlmacen(e.target.value)}
                data-testid="avios-almacen"
              >
                <option value={TODOS}>Todos</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="genericos">Solo genéricos</FieldLabel>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input
                  id="genericos"
                  type="checkbox"
                  checked={soloGenericos}
                  onChange={(e) => setSoloGenericos(e.target.checked)}
                  data-testid="avios-genericos"
                />
                Solo avíos genéricos de stock
              </label>
            </Field>
            <Field>
              <FieldLabel htmlFor="ceros">Incluir existencias en 0</FieldLabel>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input
                  id="ceros"
                  type="checkbox"
                  checked={incluirCeros}
                  onChange={(e) => setIncluirCeros(e.target.checked)}
                  data-testid="avios-ceros"
                />
                Mostrar filas en cero
              </label>
            </Field>
          </div>
        </CardContent>
      </Card>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay existencias de avío para el filtro seleccionado.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Total: <strong>{(consulta.data?.totalExistencia ?? 0).toLocaleString('es-MX')}</strong>{' '}
            en {filas.length} renglón(es).
          </p>

          {/* Móvil: tarjetas apiladas. */}
          <div className="space-y-3 md:hidden" data-testid="avios-tarjetas">
            {filas.map((f) => (
              <Card key={`${f.idAvio}-${f.idAlmacen}`}>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div>
                    <p className="flex items-center gap-1.5 font-medium">
                      {f.avio}
                      {f.esGenerico ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Genérico
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{f.descripcion}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Warehouse className="size-3.5" aria-hidden />
                      {f.almacen}
                    </p>
                  </div>
                  <span className="text-lg font-semibold tabular-nums">
                    {f.existencia.toLocaleString('es-MX')}
                    {f.unidad !== null ? (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {f.unidad}
                      </span>
                    ) : null}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Escritorio: tabla. */}
          <div
            className="hidden overflow-x-auto rounded-md border md:block"
            data-testid="avios-tabla"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Avío</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Almacén</TableHead>
                  <TableHead className="text-right">Existencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={`${f.idAvio}-${f.idAlmacen}`}>
                    <TableCell className="font-medium">{f.avio}</TableCell>
                    <TableCell>{f.descripcion}</TableCell>
                    <TableCell>
                      {f.esGenerico ? (
                        <Badge variant="secondary">Genérico</Badge>
                      ) : (
                        <span className="text-muted-foreground">Por orden</span>
                      )}
                    </TableCell>
                    <TableCell>{f.almacen}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {f.existencia.toLocaleString('es-MX')}
                      {f.unidad !== null ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {f.unidad}
                        </span>
                      ) : null}
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
