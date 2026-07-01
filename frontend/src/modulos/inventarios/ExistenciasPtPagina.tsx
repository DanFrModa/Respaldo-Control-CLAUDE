import { Boxes, Warehouse } from 'lucide-react';
import { useState } from 'react';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { useExistenciasPt } from '@/api/inventarios';
import { useTallas } from '@/api/tallas';
import type { Modelo } from '@/api/modelos';
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

import { SelectorModelo } from './SelectorModelo';

/** Valor del filtro que significa "todos". */
const TODOS = 'TODOS';

/** Etiqueta de la orden de un renglón de existencia (F6-E2: PT por orden). null = bucket sin orden. */
function etiquetaOrden(folioOrden: number | null): string {
  return folioOrden === null ? 'Sin orden (hist./ajuste)' : `Orden #${String(folioOrden)}`;
}

/**
 * EXISTENCIAS de producto terminado (F3-E3, doc 04-Inventarios — IPT). Tabla con la existencia por
 * modelo×color×talla×almacén (Σ de movimientos, D3) con filtros por modelo, color, talla y almacén.
 * Es la consulta MÓVIL del módulo (regla del plan): tabla en escritorio, tarjetas apiladas en móvil
 * (mismo patrón que CorteSemanalPagina). Por defecto omite las filas en 0.
 *
 * `inventario-pt.ver` gobierna el acceso a la pantalla.
 */
export function ExistenciasPtPagina(): React.JSX.Element {
  const [modelo, setModelo] = useState<Modelo | undefined>(undefined);
  const [idColor, setIdColor] = useState<string>(TODOS);
  const [idTalla, setIdTalla] = useState<string>(TODOS);
  const [idAlmacen, setIdAlmacen] = useState<string>(TODOS);
  const [incluirCeros, setIncluirCeros] = useState(false);

  const colores = useColores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
  const tallasCat = useTallas({ pagina: 1, porPagina: 100, ordenarPor: 'orden', direccion: 'asc' });
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const consulta = useExistenciasPt({
    ...(modelo !== undefined ? { idModelo: modelo.id } : {}),
    ...(idColor !== TODOS ? { idColor: Number(idColor) } : {}),
    ...(idTalla !== TODOS ? { idTalla: Number(idTalla) } : {}),
    ...(idAlmacen !== TODOS ? { idAlmacen: Number(idAlmacen) } : {}),
    // El querystring espera stringbool ("true"/"false"); solo se manda cuando se piden los ceros.
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
          <h1 className="text-xl font-semibold">Existencias de producto terminado</h1>
          <p className="text-sm text-muted-foreground">
            Existencia por modelo, color, talla y almacén (suma de movimientos).
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Modelo</CardTitle>
            <CardDescription>Filtra por un modelo (opcional).</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorModelo idSeleccionado={modelo?.id} alSeleccionar={setModelo} />
            {modelo !== undefined ? (
              <button
                type="button"
                className="mt-2 text-xs text-muted-foreground underline"
                onClick={() => setModelo(undefined)}
              >
                Quitar el filtro de modelo
              </button>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Filtros</CardTitle>
              <CardDescription>Acota por color, talla y almacén.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field>
                  <FieldLabel htmlFor="color">Color</FieldLabel>
                  <SelectNativo
                    id="color"
                    value={idColor}
                    onChange={(e) => setIdColor(e.target.value)}
                    data-testid="exist-color"
                  >
                    <option value={TODOS}>Todos</option>
                    {(colores.data?.datos ?? []).map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.nombre}
                      </option>
                    ))}
                  </SelectNativo>
                </Field>
                <Field>
                  <FieldLabel htmlFor="talla">Talla</FieldLabel>
                  <SelectNativo
                    id="talla"
                    value={idTalla}
                    onChange={(e) => setIdTalla(e.target.value)}
                    data-testid="exist-talla"
                  >
                    <option value={TODOS}>Todas</option>
                    {(tallasCat.data?.datos ?? []).map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.etiqueta}
                      </option>
                    ))}
                  </SelectNativo>
                </Field>
                <Field>
                  <FieldLabel htmlFor="almacen">Almacén</FieldLabel>
                  <SelectNativo
                    id="almacen"
                    value={idAlmacen}
                    onChange={(e) => setIdAlmacen(e.target.value)}
                    data-testid="exist-almacen"
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
                  <FieldLabel htmlFor="ceros">Incluir existencias en 0</FieldLabel>
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input
                      id="ceros"
                      type="checkbox"
                      checked={incluirCeros}
                      onChange={(e) => setIncluirCeros(e.target.checked)}
                      data-testid="exist-ceros"
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
              No hay existencias para el filtro seleccionado.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Total:{' '}
                <strong>{(consulta.data?.totalExistencia ?? 0).toLocaleString('es-MX')}</strong>{' '}
                pzas en {filas.length} renglón(es).
              </p>

              {/* Móvil: tarjetas apiladas. */}
              <div className="space-y-3 md:hidden" data-testid="exist-tarjetas">
                {filas.map((f) => (
                  <Card
                    key={`${f.idModelo}-${f.idColor}-${f.idTalla}-${f.idAlmacen}-${f.idOrden ?? 'sin'}`}
                  >
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">
                          {f.modelo} · {f.color} · {f.etiquetaTalla}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Warehouse className="size-3.5" aria-hidden />
                          {f.almacen}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {etiquetaOrden(f.folioOrden)}
                        </p>
                      </div>
                      <span className="text-lg font-semibold tabular-nums">
                        {f.existencia.toLocaleString('es-MX')}
                      </span>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Escritorio: tabla. */}
              <div
                className="hidden overflow-x-auto rounded-md border md:block"
                data-testid="exist-tabla"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Color</TableHead>
                      <TableHead>Talla</TableHead>
                      <TableHead>Almacén</TableHead>
                      <TableHead>Orden</TableHead>
                      <TableHead className="text-right">Existencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((f) => (
                      <TableRow
                        key={`${f.idModelo}-${f.idColor}-${f.idTalla}-${f.idAlmacen}-${f.idOrden ?? 'sin'}`}
                      >
                        <TableCell className="font-medium">{f.modelo}</TableCell>
                        <TableCell>{f.color}</TableCell>
                        <TableCell>{f.etiquetaTalla}</TableCell>
                        <TableCell>{f.almacen}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {etiquetaOrden(f.folioOrden)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {f.existencia.toLocaleString('es-MX')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
