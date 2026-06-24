import { Ban, BookOpenText, Loader2Icon, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCancelarMovimientoPt, useKardexPt, useMovimientoPtPorFolio } from '@/api/inventarios';
import type { MovimientoPt } from '@/api/tipos';
import type { Modelo } from '@/api/modelos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useSesion } from '@/sesion/useSesion';

import { SelectorModelo } from './SelectorModelo';

type Modo = 'modelo' | 'folio';

/**
 * KARDEX de producto terminado (F3-E3, doc 04-Inventarios — IPT_Kardex). Dos modos en una pantalla:
 *  • POR MODELO: los movimientos del modelo en orden cronológico con su SALDO CORRIDO.
 *  • POR FOLIO: el detalle de UN movimiento (su matriz color×talla), con botón para CANCELARLO (genera
 *    un inverso auditado — D3) si el usuario tiene `inventario-pt.mover`.
 * Pensada para escritorio (densa). `inventario-pt.ver` gobierna el acceso.
 */
export function KardexPtPagina(): React.JSX.Element {
  const [modo, setModo] = useState<Modo>('modelo');

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <BookOpenText className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Kardex de producto terminado</h1>
          <p className="text-sm text-muted-foreground">
            Movimientos con saldo corrido por modelo, o el detalle de un movimiento por folio.
          </p>
        </div>
      </header>

      <div className="inline-flex rounded-md border p-0.5">
        <button
          type="button"
          onClick={() => setModo('modelo')}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            modo === 'modelo' ? 'bg-sidebar-accent/50 font-medium' : 'text-muted-foreground'
          }`}
          data-testid="kardex-modo-modelo"
        >
          Por modelo
        </button>
        <button
          type="button"
          onClick={() => setModo('folio')}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            modo === 'folio' ? 'bg-sidebar-accent/50 font-medium' : 'text-muted-foreground'
          }`}
          data-testid="kardex-modo-folio"
        >
          Por folio
        </button>
      </div>

      {modo === 'modelo' ? <KardexPorModelo /> : <KardexPorFolio />}
    </div>
  );
}

/** Kardex por modelo: movimientos cronológicos con saldo corrido. */
function KardexPorModelo(): React.JSX.Element {
  const [modelo, setModelo] = useState<Modelo | undefined>(undefined);
  const consulta = useKardexPt(
    modelo !== undefined ? { idModelo: modelo.id } : undefined,
    modelo !== undefined,
  );
  const renglones = consulta.data?.renglones ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Modelo</CardTitle>
          <CardDescription>Elige el modelo del kardex.</CardDescription>
        </CardHeader>
        <CardContent>
          <SelectorModelo idSeleccionado={modelo?.id} alSeleccionar={setModelo} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{modelo ? `Kardex de ${modelo.codigo}` : 'Kardex'}</CardTitle>
          <CardDescription>Movimientos en orden, con el saldo tras cada uno.</CardDescription>
        </CardHeader>
        <CardContent>
          {modelo === undefined ? (
            <p className="text-sm text-muted-foreground">Selecciona un modelo.</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : renglones.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Este modelo no tiene movimientos.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border" data-testid="kardex-tabla">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Folio</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Movimiento</TableHead>
                    <TableHead>Almacén</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>Talla</TableHead>
                    <TableHead className="text-right">Entrada</TableHead>
                    <TableHead className="text-right">Salida</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renglones.map((r, i) => (
                    <TableRow
                      key={`${r.idMovimiento}-${r.idColor}-${r.idTalla}-${i}`}
                      className={r.cancelado ? 'opacity-60' : ''}
                    >
                      <TableCell className="font-medium tabular-nums">{r.folio}</TableCell>
                      <TableCell>{r.fecha}</TableCell>
                      <TableCell className="flex items-center gap-1.5">
                        {r.tipoMov}
                        {r.cancelado ? <Badge variant="secondary">Cancelado</Badge> : null}
                      </TableCell>
                      <TableCell>{r.almacen}</TableCell>
                      <TableCell>{r.color}</TableCell>
                      <TableCell>{r.etiquetaTalla}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.entrada > 0 ? r.entrada.toLocaleString('es-MX') : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.salida > 0 ? r.salida.toLocaleString('es-MX') : '—'}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {r.saldo.toLocaleString('es-MX')}
                      </TableCell>
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

/** Kardex por folio: el detalle de un movimiento + botón de cancelar (inverso auditado). */
function KardexPorFolio(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-pt.mover');

  const [texto, setTexto] = useState('');
  const [folioBuscado, setFolioBuscado] = useState<number | undefined>(undefined);
  const [aCancelar, setACancelar] = useState<MovimientoPt | null>(null);

  const consulta = useMovimientoPtPorFolio(folioBuscado);
  const movimiento = consulta.data;

  function buscar(): void {
    const valor = Number(texto.trim());
    setFolioBuscado(Number.isInteger(valor) && valor > 0 ? valor : undefined);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Buscar por folio</CardTitle>
          <CardDescription>Escribe el folio del movimiento de la empresa activa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <Field className="max-w-40">
              <FieldLabel htmlFor="folio">Folio</FieldLabel>
              <Input
                id="folio"
                type="number"
                min={1}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => (e.key === 'Enter' ? buscar() : undefined)}
                data-testid="kardex-folio-input"
              />
            </Field>
            <Button onClick={buscar} data-testid="kardex-folio-buscar">
              <Search className="mr-1.5 size-4" aria-hidden /> Buscar
            </Button>
          </div>

          {folioBuscado === undefined ? (
            <p className="text-sm text-muted-foreground">Escribe un folio y busca.</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Buscando…</p>
          ) : movimiento === undefined ? (
            <p className="text-sm text-muted-foreground">No se encontró ese folio.</p>
          ) : (
            <div className="space-y-4" data-testid="kardex-folio-detalle">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">Folio:</span>{' '}
                  <strong>{movimiento.folio}</strong>
                  {movimiento.cancelado ? (
                    <Badge variant="secondary" className="ml-2">
                      Cancelado
                    </Badge>
                  ) : null}
                </p>
                <p>
                  <span className="text-muted-foreground">Movimiento:</span> {movimiento.tipoMov} (
                  {movimiento.direccion})
                </p>
                <p>
                  <span className="text-muted-foreground">Modelo:</span> {movimiento.modelo}
                </p>
                <p>
                  <span className="text-muted-foreground">Almacén:</span> {movimiento.almacen}
                </p>
                <p>
                  <span className="text-muted-foreground">Fecha:</span> {movimiento.fecha}
                </p>
                <p>
                  <span className="text-muted-foreground">Total:</span>{' '}
                  {movimiento.totalPiezas.toLocaleString('es-MX')} pzas
                </p>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Color</TableHead>
                      <TableHead>Talla</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movimiento.lineas.flatMap((linea) =>
                      linea.tallas.map((t) => (
                        <TableRow key={`${linea.idColor}-${t.idTalla}`}>
                          <TableCell>{linea.color}</TableCell>
                          <TableCell>{t.etiquetaTalla}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {t.cantidad.toLocaleString('es-MX')}
                          </TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </div>

              {movimiento.observaciones !== null ? (
                <p className="text-sm text-muted-foreground">
                  Observaciones: {movimiento.observaciones}
                </p>
              ) : null}

              {puedeMover && !movimiento.cancelado ? (
                <Button
                  variant="outline"
                  onClick={() => setACancelar(movimiento)}
                  data-testid="kardex-folio-cancelar"
                >
                  <Ban className="mr-1.5 size-4" aria-hidden /> Cancelar movimiento
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <DialogoCancelarMovimiento
        movimiento={aCancelar}
        alCerrar={() => setACancelar(null)}
        alCancelado={() => setACancelar(null)}
      />
    </>
  );
}

/**
 * Diálogo de CANCELACIÓN de un movimiento PT. Genera un inverso auditado (D3) que neutraliza el saldo;
 * EXIGE un motivo (lo re-valida el backend). Tras cancelar, invalida la caché (la mutación lo hace) y
 * cierra.
 */
function DialogoCancelarMovimiento({
  movimiento,
  alCerrar,
  alCancelado,
}: {
  movimiento: MovimientoPt | null;
  alCerrar: () => void;
  alCancelado: () => void;
}): React.JSX.Element {
  const cancelar = useCancelarMovimientoPt();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (movimiento !== null) {
      setMotivo('');
    }
  }, [movimiento]);

  const sinMotivo = motivo.trim().length === 0;

  function confirmar(): void {
    if (movimiento === null) {
      return;
    }
    const limpio = motivo.trim();
    if (limpio.length === 0) {
      return;
    }
    cancelar.mutate(
      { id: movimiento.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          // La respuesta es el movimiento ORIGINAL ya marcado como cancelado (no el inverso); no se
          // necesita aquí, así que no se desestructura.
          toast.success(
            `Movimiento #${movimiento.folio} cancelado (inverso registrado, total neutralizado).`,
          );
          alCancelado();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog
      open={movimiento !== null}
      onOpenChange={(abierto) => (abierto ? undefined : alCerrar())}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar movimiento {movimiento ? `#${movimiento.folio}` : ''}</DialogTitle>
          <DialogDescription>
            La cancelación NO borra el movimiento: registra un movimiento INVERSO auditado que
            neutraliza su efecto en la existencia. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="mov-motivo-cancelar">Motivo</FieldLabel>
            <textarea
              id="mov-motivo-cancelar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela este movimiento"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="mov-motivo-cancelar"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={cancelar.isPending}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={cancelar.isPending || sinMotivo}
            data-testid="confirmar-cancelar-movimiento"
          >
            {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar movimiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
