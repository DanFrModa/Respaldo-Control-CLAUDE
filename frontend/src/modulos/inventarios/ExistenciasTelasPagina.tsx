import { Boxes, ChevronDown, ChevronRight, FileDown, Warehouse } from 'lucide-react';
import { useState } from 'react';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { urlImpresoInventarioTelas, useExistenciasTela } from '@/api/inventario-materiales';
import type { ExistenciaTelaFila } from '@/api/tipos';
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

/** Valor del filtro que significa "todos". */
const TODOS = 'TODOS';

/** Clave única de una fila de existencia (tela×lote×almacén). */
function claveFila(f: ExistenciaTelaFila): string {
  return `${f.idTela}-${f.idLote ?? 'sl'}-${f.idAlmacen}`;
}

/**
 * EXISTENCIAS de TELAS (F4-E1, doc 04-Inventarios §B; D5). Tabla con la existencia por
 * tela×lote×almacén (Σ de movimientos, D3), con filtros por color y almacén, y los COMPONENTES del
 * lote EXPANDIBLES (D5 — la fila despliega "Felpa 100", "Cardigan 40"…). Es una consulta MÓVIL:
 * tabla en escritorio, tarjetas apiladas en móvil. Sin importes (existencias muestran cantidades).
 * Botón para descargar el PDF (R9). `inventario-telas.ver` gobierna el acceso.
 */
export function ExistenciasTelasPagina(): React.JSX.Element {
  const [idColor, setIdColor] = useState<string>(TODOS);
  const [idAlmacen, setIdAlmacen] = useState<string>(TODOS);
  const [incluirCeros, setIncluirCeros] = useState(false);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const colores = useColores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const filtros = {
    ...(idColor !== TODOS ? { idColor: Number(idColor) } : {}),
    ...(idAlmacen !== TODOS ? { idAlmacen: Number(idAlmacen) } : {}),
    ...(incluirCeros ? { incluirCeros: 'true' as const } : {}),
  };
  const consulta = useExistenciasTela(filtros);
  const filas = consulta.data?.filas ?? [];

  function alternar(clave: string): void {
    setExpandidas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(clave)) {
        siguiente.delete(clave);
      } else {
        siguiente.add(clave);
      }
      return siguiente;
    });
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <Boxes className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Inventario de telas</h1>
            <p className="text-sm text-muted-foreground">
              Existencia por tela, lote y almacén (suma de movimientos). Expande para ver los
              componentes del lote.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" data-testid="telas-imprimir">
          <a href={urlImpresoInventarioTelas(filtros)} target="_blank" rel="noopener noreferrer">
            <FileDown className="mr-1.5 size-4" aria-hidden /> Imprimir PDF
          </a>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Acota por color del lote y almacén.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="color">Color</FieldLabel>
              <SelectNativo
                id="color"
                value={idColor}
                onChange={(e) => setIdColor(e.target.value)}
                data-testid="telas-color"
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
              <FieldLabel htmlFor="almacen">Almacén</FieldLabel>
              <SelectNativo
                id="almacen"
                value={idAlmacen}
                onChange={(e) => setIdAlmacen(e.target.value)}
                data-testid="telas-almacen"
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
                  data-testid="telas-ceros"
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
          No hay existencias de tela para el filtro seleccionado.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Total: <strong>{(consulta.data?.totalExistencia ?? 0).toLocaleString('es-MX')}</strong>{' '}
            en {filas.length} renglón(es).
          </p>

          {/* Móvil: tarjetas apiladas con componentes expandibles. */}
          <div className="space-y-3 md:hidden" data-testid="telas-tarjetas">
            {filas.map((f) => {
              const clave = claveFila(f);
              const abierta = expandidas.has(clave);
              return (
                <Card key={clave}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{f.tela}</p>
                        <p className="text-xs text-muted-foreground">
                          Lote {f.loteClave ?? '(sin lote)'} · {f.color ?? '—'}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Warehouse className="size-3.5" aria-hidden />
                          {f.almacen}
                        </p>
                      </div>
                      <span className="text-lg font-semibold tabular-nums">
                        {f.existencia.toLocaleString('es-MX')}
                      </span>
                    </div>
                    {f.componentes.length > 0 ? (
                      <BotonComponentes
                        abierta={abierta}
                        cantidad={f.componentes.length}
                        onToggle={() => alternar(clave)}
                        testid={`telas-componentes-toggle-${clave}`}
                      />
                    ) : null}
                    {abierta && f.componentes.length > 0 ? (
                      <ul
                        className="space-y-1 rounded-md bg-muted/40 p-2 text-xs"
                        data-testid={`telas-componentes-${clave}`}
                      >
                        {f.componentes.map((c) => (
                          <li key={c.idTela} className="flex justify-between">
                            <span>{c.tela}</span>
                            <span className="tabular-nums">
                              {c.cantidad.toLocaleString('es-MX')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Escritorio: tabla con fila de componentes expandible. */}
          <div
            className="hidden overflow-x-auto rounded-md border md:block"
            data-testid="telas-tabla"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Tela</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Almacén</TableHead>
                  <TableHead className="text-right">Existencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => {
                  const clave = claveFila(f);
                  const abierta = expandidas.has(clave);
                  const tieneComponentes = f.componentes.length > 0;
                  return (
                    <RenglonTela
                      key={clave}
                      fila={f}
                      clave={clave}
                      abierta={abierta}
                      tieneComponentes={tieneComponentes}
                      onToggle={() => alternar(clave)}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

/** Botón "ver/ocultar componentes" (D5) — solo cuando el lote tiene componentes. */
function BotonComponentes({
  abierta,
  cantidad,
  onToggle,
  testid,
}: {
  abierta: boolean;
  cantidad: number;
  onToggle: () => void;
  testid: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
      data-testid={testid}
      aria-expanded={abierta}
    >
      {abierta ? (
        <ChevronDown className="size-3.5" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5" aria-hidden />
      )}
      {abierta ? 'Ocultar' : 'Ver'} {cantidad} componente(s) del lote
    </button>
  );
}

/** Una fila de la tabla de escritorio + su fila expandible con los componentes del lote (D5). */
function RenglonTela({
  fila,
  clave,
  abierta,
  tieneComponentes,
  onToggle,
}: {
  fila: ExistenciaTelaFila;
  clave: string;
  abierta: boolean;
  tieneComponentes: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <>
      <TableRow>
        <TableCell className="p-0 pl-2">
          {tieneComponentes ? (
            <button
              type="button"
              onClick={onToggle}
              className="grid size-7 place-items-center rounded hover:bg-muted"
              aria-label={abierta ? 'Ocultar componentes' : 'Ver componentes'}
              aria-expanded={abierta}
              data-testid={`telas-fila-toggle-${clave}`}
            >
              {abierta ? (
                <ChevronDown className="size-4" aria-hidden />
              ) : (
                <ChevronRight className="size-4" aria-hidden />
              )}
            </button>
          ) : null}
        </TableCell>
        <TableCell className="font-medium">{fila.tela}</TableCell>
        <TableCell>{fila.loteClave ?? '(sin lote)'}</TableCell>
        <TableCell>{fila.color ?? '—'}</TableCell>
        <TableCell>{fila.proveedor ?? '—'}</TableCell>
        <TableCell>{fila.almacen}</TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          {fila.existencia.toLocaleString('es-MX')}
        </TableCell>
      </TableRow>
      {abierta && tieneComponentes ? (
        <TableRow className="bg-muted/30" data-testid={`telas-fila-componentes-${clave}`}>
          <TableCell />
          <TableCell colSpan={6} className="py-2">
            <div className="flex flex-wrap gap-2 text-xs">
              {fila.componentes.map((c) => (
                <span
                  key={c.idTela}
                  className="rounded-full border bg-background px-2.5 py-1 tabular-nums"
                >
                  {c.tela}: <strong>{c.cantidad.toLocaleString('es-MX')}</strong>
                  {c.peso !== null ? ` · ${c.peso.toLocaleString('es-MX')} kg` : ''}
                </span>
              ))}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
