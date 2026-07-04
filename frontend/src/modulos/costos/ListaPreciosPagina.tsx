import { FileText, Printer } from 'lucide-react';
import { useState } from 'react';

import { imprimirListaPrecios, useListaPrecios } from '@/api/costos';
import { useGeneros } from '@/api/modelos';
import type { ListaPreciosQuery } from '@/api/tipos';
import { Button } from '@/components/ui/button';
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

import { moneda } from './comun';

/**
 * LISTA DE PRECIOS (F7-E1; doc 06-Costos-y-EDR §5, ex `ListaPreciosEd`): cada modelo con su costo
 * estimado y su precio de venta sugerido (utilidad + regalías parametrizadas, redondeo al alza).
 * Filtrable por género y activos/inactivos, con impreso PDF (R9). `precostos.consultar`; importes en
 * "—" sin `consultas.ver-importes`.
 */
export function ListaPreciosPagina(): React.JSX.Element {
  const [idGenero, setIdGenero] = useState('');
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const generos = useGeneros();

  // `incluirInactivos` viaja como stringbool en la URL (el contrato lo tipa `string`).
  const query: ListaPreciosQuery = {
    ...(idGenero === '' ? {} : { idGenero: Number(idGenero) }),
    ...(incluirInactivos ? { incluirInactivos: 'true' } : {}),
  };
  const consulta = useListaPrecios(query);
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="lista-precios">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <FileText className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Lista de precios</h1>
          <p className="text-sm text-muted-foreground">
            Precio de venta sugerido por modelo (utilidad + regalías sobre la venta, redondeo al
            alza).
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Precios sugeridos</CardTitle>
              <CardDescription>
                {consulta.data?.utilidadSugerida !== null &&
                consulta.data?.utilidadSugerida !== undefined
                  ? `Utilidad ${consulta.data.utilidadSugerida}% · Regalías ${consulta.data.regaliasBase ?? 0}%`
                  : 'Configura utilidad y regalías en Administración.'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-48">
                <FieldLabel htmlFor="lp-genero">Género</FieldLabel>
                <SelectNativo
                  id="lp-genero"
                  value={idGenero}
                  onChange={(e) => setIdGenero(e.target.value)}
                  data-testid="lp-genero"
                >
                  <option value="">Todos</option>
                  {generos.data?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nombre}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={incluirInactivos}
                  onChange={(e) => setIncluirInactivos(e.target.checked)}
                  data-testid="lp-inactivos"
                />
                Incluir inactivos
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() => imprimirListaPrecios(query)}
                data-testid="lp-imprimir"
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
          ) : filas.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay modelos para los filtros elegidos.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Género</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Precio sugerido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={f.idModelo} className={f.activo ? '' : 'text-muted-foreground'}>
                    <TableCell className="font-medium">
                      {f.codigo}
                      {f.activo ? '' : ' (inactivo)'}
                    </TableCell>
                    <TableCell>{f.descripcion ?? ''}</TableCell>
                    <TableCell>{f.genero ?? '—'}</TableCell>
                    <TableCell className="text-right">{moneda(f.costo)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {moneda(f.precioSugerido)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
