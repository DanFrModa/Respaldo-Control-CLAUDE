import { Ban, Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { Avio } from '@/api/avios';
import {
  useCancelarAvio,
  useCancelarTela,
  useKardexAvio,
  useKardexTela,
} from '@/api/inventario-materiales';
import type { Tela } from '@/api/telas';
import type { KardexAvioRenglon, KardexTelaRenglon } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSesion } from '@/sesion/useSesion';

import { SelectorAvio } from './SelectorAvio';
import { SelectorTela } from './SelectorTela';

type Dimension = 'tela' | 'avio';

/**
 * KARDEX de materiales (F4-E1, doc 04-Inventarios §B.4): movimientos cronológicos con SALDO CORRIDO.
 * Dos dimensiones en una pantalla (toggle): TELAS (por tela; entradas, salidas a orden visibles vía
 * origen) y AVÍOS (por avío). Las salidas ligadas a orden muestran su origen. Costos/importes solo si
 * la sesión tiene `telas.ver-totales` (el backend ya los omite si no — la UI no los asume). Consulta
 * MÓVIL (tarjetas en móvil, tabla en escritorio). `inventario-telas.ver`/`inventario-avios.ver`
 * gobiernan el acceso. Permite CANCELAR un movimiento (inverso auditado, D3) con `*.mover`.
 */
export function KardexMaterialesPagina(): React.JSX.Element {
  const [dimension, setDimension] = useState<Dimension>('tela');

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Kardex de materiales
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Movimientos con saldo corrido por tela (lote) o por avío
          </p>
        </div>
      </header>

      <div
        className="flex w-fit overflow-hidden rounded-md border text-xs"
        role="group"
        aria-label="Tipo de material"
      >
        <button
          type="button"
          onClick={() => setDimension('tela')}
          className={`cursor-pointer px-3 py-1 font-medium transition-colors ${
            dimension === 'tela'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
          data-testid="kardex-mat-dim-tela"
        >
          Telas
        </button>
        <button
          type="button"
          onClick={() => setDimension('avio')}
          className={`cursor-pointer px-3 py-1 font-medium transition-colors ${
            dimension === 'avio'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
          data-testid="kardex-mat-dim-avio"
        >
          Avíos
        </button>
      </div>

      {dimension === 'tela' ? <KardexTela /> : <KardexAvio />}
    </div>
  );
}

/** Resumen "entrada/salida" de un renglón para móvil. */
function efectoRenglon(entrada: number, salida: number): string {
  if (entrada > 0) return `+${entrada.toLocaleString('es-MX')}`;
  if (salida > 0) return `−${salida.toLocaleString('es-MX')}`;
  return '0';
}

/** Kardex por TELA. */
function KardexTela(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');
  const [tela, setTela] = useState<Tela | undefined>(undefined);
  const [aCancelar, setACancelar] = useState<KardexTelaRenglon | null>(null);
  const consulta = useKardexTela(tela !== undefined ? { idTela: tela.id } : undefined);
  const renglones = consulta.data?.renglones ?? [];
  const cancelar = useCancelarTela();

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Tela</CardTitle>
          <CardDescription>Elige la tela del kardex.</CardDescription>
        </CardHeader>
        <CardContent>
          <SelectorTela idSeleccionado={tela?.id} alSeleccionar={setTela} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tela ? `Kardex de ${tela.nombre}` : 'Kardex'}</CardTitle>
          <CardDescription>
            Movimientos en orden, con el saldo por lote tras cada uno.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tela === undefined ? (
            <p className="text-sm text-muted-foreground">Selecciona una tela.</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : renglones.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Esta tela no tiene movimientos.
            </p>
          ) : (
            <>
              {/* Móvil: tarjetas. */}
              <div className="space-y-3 md:hidden" data-testid="kardex-tela-tarjetas">
                {renglones.map((r, i) => (
                  <Card key={`${r.idMovimiento}-${r.idLote ?? 'sl'}-${i}`}>
                    <CardContent className="space-y-1 p-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          #{r.folio} · {r.tipoMov}
                        </span>
                        {r.cancelado ? <ChipEstado tono="neutro">Cancelado</ChipEstado> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.fecha} · {r.almacen} · Lote {r.loteClave ?? '(sin lote)'}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="tabular-nums">{efectoRenglon(r.entrada, r.salida)}</span>
                        <span className="font-semibold tabular-nums">
                          Saldo: {r.saldo.toLocaleString('es-MX')}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Escritorio: tabla. */}
              <div
                className="hidden overflow-x-auto rounded-md border md:block"
                data-testid="kardex-tela-tabla"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Folio</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Movimiento</TableHead>
                      <TableHead>Almacén</TableHead>
                      <TableHead>Lote</TableHead>
                      <TableHead className="text-right">Entrada</TableHead>
                      <TableHead className="text-right">Salida</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      {puedeMover ? <TableHead /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renglones.map((r, i) => (
                      <TableRow
                        key={`${r.idMovimiento}-${r.idLote ?? 'sl'}-${i}`}
                        className={r.cancelado ? 'opacity-60' : ''}
                      >
                        <TableCell className="font-medium tabular-nums">{r.folio}</TableCell>
                        <TableCell>{r.fecha}</TableCell>
                        <TableCell className="flex items-center gap-1.5">
                          {r.tipoMov}
                          {r.cancelado ? <ChipEstado tono="neutro">Cancelado</ChipEstado> : null}
                        </TableCell>
                        <TableCell>{r.almacen}</TableCell>
                        <TableCell>{r.loteClave ?? '(sin lote)'}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.entrada > 0 ? r.entrada.toLocaleString('es-MX') : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.salida > 0 ? r.salida.toLocaleString('es-MX') : '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {r.saldo.toLocaleString('es-MX')}
                        </TableCell>
                        {puedeMover ? (
                          <TableCell className="text-right">
                            {!r.cancelado ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setACancelar(r)}
                                data-testid={`kardex-tela-cancelar-${r.idMovimiento}`}
                              >
                                <Ban className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <DialogoCancelarMaterial
        abierto={aCancelar !== null}
        folio={aCancelar?.folio ?? null}
        cargando={cancelar.isPending}
        alCerrar={() => setACancelar(null)}
        alConfirmar={(motivo) => {
          if (aCancelar === null) return;
          cancelar.mutate(
            { id: aCancelar.idMovimiento, cuerpo: { motivo } },
            {
              onSuccess: () => {
                toast.success(`Movimiento #${aCancelar.folio} cancelado (inverso registrado).`);
                setACancelar(null);
              },
              onError: (error) => toast.error(error.message),
            },
          );
        }}
      />
    </div>
  );
}

/** Kardex por AVÍO. */
function KardexAvio(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-avios.mover');
  const [avio, setAvio] = useState<Avio | undefined>(undefined);
  const [aCancelar, setACancelar] = useState<KardexAvioRenglon | null>(null);
  const consulta = useKardexAvio(avio !== undefined ? { idAvio: avio.id } : undefined);
  const renglones = consulta.data?.renglones ?? [];
  const cancelar = useCancelarAvio();

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Avío</CardTitle>
          <CardDescription>Elige el avío del kardex.</CardDescription>
        </CardHeader>
        <CardContent>
          <SelectorAvio idSeleccionado={avio?.id} alSeleccionar={setAvio} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{avio ? `Kardex de ${avio.clave}` : 'Kardex'}</CardTitle>
          <CardDescription>Movimientos en orden, con el saldo por almacén.</CardDescription>
        </CardHeader>
        <CardContent>
          {avio === undefined ? (
            <p className="text-sm text-muted-foreground">Selecciona un avío.</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : renglones.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Este avío no tiene movimientos.
            </p>
          ) : (
            <>
              {/* Móvil: tarjetas. */}
              <div className="space-y-3 md:hidden" data-testid="kardex-avio-tarjetas">
                {renglones.map((r, i) => (
                  <Card key={`${r.idMovimiento}-${i}`}>
                    <CardContent className="space-y-1 p-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          #{r.folio} · {r.tipoMov}
                        </span>
                        {r.cancelado ? <ChipEstado tono="neutro">Cancelado</ChipEstado> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.fecha} · {r.almacen}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="tabular-nums">{efectoRenglon(r.entrada, r.salida)}</span>
                        <span className="font-semibold tabular-nums">
                          Saldo: {r.saldo.toLocaleString('es-MX')}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Escritorio: tabla. */}
              <div
                className="hidden overflow-x-auto rounded-md border md:block"
                data-testid="kardex-avio-tabla"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Folio</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Movimiento</TableHead>
                      <TableHead>Almacén</TableHead>
                      <TableHead className="text-right">Entrada</TableHead>
                      <TableHead className="text-right">Salida</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      {puedeMover ? <TableHead /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renglones.map((r, i) => (
                      <TableRow
                        key={`${r.idMovimiento}-${i}`}
                        className={r.cancelado ? 'opacity-60' : ''}
                      >
                        <TableCell className="font-medium tabular-nums">{r.folio}</TableCell>
                        <TableCell>{r.fecha}</TableCell>
                        <TableCell className="flex items-center gap-1.5">
                          {r.tipoMov}
                          {r.cancelado ? <ChipEstado tono="neutro">Cancelado</ChipEstado> : null}
                        </TableCell>
                        <TableCell>{r.almacen}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.entrada > 0 ? r.entrada.toLocaleString('es-MX') : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.salida > 0 ? r.salida.toLocaleString('es-MX') : '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {r.saldo.toLocaleString('es-MX')}
                        </TableCell>
                        {puedeMover ? (
                          <TableCell className="text-right">
                            {!r.cancelado ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setACancelar(r)}
                                data-testid={`kardex-avio-cancelar-${r.idMovimiento}`}
                              >
                                <Ban className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <DialogoCancelarMaterial
        abierto={aCancelar !== null}
        folio={aCancelar?.folio ?? null}
        cargando={cancelar.isPending}
        alCerrar={() => setACancelar(null)}
        alConfirmar={(motivo) => {
          if (aCancelar === null) return;
          cancelar.mutate(
            { id: aCancelar.idMovimiento, cuerpo: { motivo } },
            {
              onSuccess: () => {
                toast.success(`Movimiento #${aCancelar.folio} cancelado (inverso registrado).`);
                setACancelar(null);
              },
              onError: (error) => toast.error(error.message),
            },
          );
        }}
      />
    </div>
  );
}

/** Diálogo de cancelación (inverso auditado, D3) — motivo obligatorio. Compartido tela/avío. */
function DialogoCancelarMaterial({
  abierto,
  folio,
  cargando,
  alCerrar,
  alConfirmar,
}: {
  abierto: boolean;
  folio: number | null;
  cargando: boolean;
  alCerrar: () => void;
  alConfirmar: (motivo: string) => void;
}): React.JSX.Element {
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (abierto) setMotivo('');
  }, [abierto]);

  const sinMotivo = motivo.trim().length < 3;

  return (
    <Dialog open={abierto} onOpenChange={(o) => (o ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar movimiento {folio !== null ? `#${folio}` : ''}</DialogTitle>
          <DialogDescription>
            La cancelación NO borra el movimiento: registra un movimiento INVERSO auditado que
            neutraliza su efecto en la existencia. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="mat-motivo-cancelar">Motivo</FieldLabel>
            <textarea
              id="mat-motivo-cancelar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela este movimiento (mínimo 3 caracteres)"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="mat-motivo-cancelar"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={cargando}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => alConfirmar(motivo.trim())}
            disabled={cargando || sinMotivo}
            data-testid="confirmar-cancelar-material"
          >
            {cargando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar movimiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
