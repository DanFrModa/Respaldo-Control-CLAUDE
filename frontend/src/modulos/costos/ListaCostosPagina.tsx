import { ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useListaCostos } from '@/api/costos';
import type { ListaCostosQuery } from '@/api/tipos';
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
import { useDebounce } from '@/lib/useDebounce';

import { etiquetaBase, moneda } from './comun';

/**
 * LISTA DE COSTOS (F7-E1; ex `ListaCostos`): las órdenes ya costeadas de la empresa activa con su
 * costo total y unitario. Búsqueda (folio/modelo/cliente/referencia) y paginación de servidor. Al
 * tocar una fila salta al costeo de esa orden. Solo lectura (`costos.ver`); importes en "—" sin
 * `consultas.ver-importes`.
 */
export function ListaCostosPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState('');
  const debounced = useDebounce(busqueda, 300);
  const [pagina, setPagina] = useState(1);

  const query: ListaCostosQuery = {
    pagina,
    porPagina: 20,
    ...(debounced === '' ? {} : { busqueda: debounced }),
  };
  const consulta = useListaCostos(query);
  const filas = consulta.data?.datos ?? [];
  const totalPaginas = consulta.data?.totalPaginas ?? 1;

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="lista-costos">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <ListChecks className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Lista de costos</h1>
          <p className="text-sm text-muted-foreground">
            Órdenes con costo capturado: costo total y unitario por base de prorrateo.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Costos por orden</CardTitle>
              <CardDescription>Toca una orden para ver o ajustar su costo.</CardDescription>
            </div>
            <Field className="w-64">
              <FieldLabel htmlFor="lc-buscar">Buscar</FieldLabel>
              <Input
                id="lc-buscar"
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  setPagina(1);
                }}
                placeholder="Folio, modelo o cliente…"
                data-testid="lc-buscar"
              />
            </Field>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : filas.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay órdenes costeadas.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Orden</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Cortado</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead className="text-right">Costo total</TableHead>
                    <TableHead className="text-right">Costo unitario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((f) => (
                    <TableRow
                      key={f.idOrden}
                      className="cursor-pointer"
                      onClick={() => void navigate(`/costos/costeo?idOrden=${String(f.idOrden)}`)}
                      data-testid={`lc-fila-${f.idOrden}`}
                    >
                      <TableCell className="font-medium">#{f.folio}</TableCell>
                      <TableCell>{f.codigoModelo}</TableCell>
                      <TableCell>{f.cliente}</TableCell>
                      <TableCell className="text-right">{f.cortado}</TableCell>
                      <TableCell>{etiquetaBase(f.baseProrrateo)}</TableCell>
                      <TableCell className="text-right">{moneda(f.costoTotal)}</TableCell>
                      <TableCell className="text-right">{moneda(f.costoUnitario)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {totalPaginas > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pagina <= 1}
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </Button>
                  <span>
                    Página {pagina} de {totalPaginas}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pagina >= totalPaginas}
                    onClick={() => setPagina((p) => p + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
