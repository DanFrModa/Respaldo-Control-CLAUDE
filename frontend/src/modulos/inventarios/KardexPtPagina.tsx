import { Ban, Loader2Icon, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCancelarMovimientoPt, useKardexPt, useMovimientoPtPorFolio } from '@/api/inventarios';
import type { Modelo } from '@/api/modelos';
import type { MovimientoPt } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
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
import { useSesion } from '@/sesion/useSesion';

import { PestanasSegmentadas } from './PestanasSegmentadas';
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
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Kardex de producto terminado
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Movimientos con saldo corrido por modelo, o el detalle de un movimiento por folio
          </p>
        </div>
      </header>

      <PestanasSegmentadas<Modo>
        opciones={[
          { valor: 'modelo', etiqueta: 'Por modelo', testid: 'kardex-modo-modelo' },
          { valor: 'folio', etiqueta: 'Por folio', testid: 'kardex-modo-folio' },
        ]}
        valor={modo}
        alCambiar={setModo}
        etiqueta="Modo del kardex"
        className="w-fit"
      />

      {modo === 'modelo' ? <KardexPorModelo /> : <KardexPorFolio />}
    </div>
  );
}

/** Kardex por modelo: movimientos cronológicos con saldo corrido (card estándar + tabla densa). */
function KardexPorModelo(): React.JSX.Element {
  const [modelo, setModelo] = useState<Modelo | undefined>(undefined);
  const consulta = useKardexPt(
    modelo !== undefined ? { idModelo: modelo.id } : undefined,
    modelo !== undefined,
  );
  const renglones = consulta.data?.renglones ?? [];

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="w-64 [&_input]:h-8 [&_input]:text-sm">
          <SelectorModelo
            idSeleccionado={modelo?.id}
            alSeleccionar={setModelo}
            alLimpiar={() => setModelo(undefined)}
          />
        </div>
        {/* Identidad VISIBLE del modelo consultado: código + descripción (el value del input no
            es un nodo de texto; el kardex debe decir de QUÉ modelo es). */}
        {modelo !== undefined ? (
          <span className="truncate text-xs text-muted-foreground" data-testid="kardex-modelo-sel">
            <span className="num font-medium text-foreground">{modelo.codigo}</span>
            {modelo.descripcion !== null ? <> — {modelo.descripcion}</> : null}
          </span>
        ) : null}
        {/* Conteo a la derecha (proto `.count`: texto plano atenuado, sin pastilla). */}
        {modelo !== undefined ? (
          <span className="ml-auto text-xs text-faint">
            {renglones.length.toLocaleString('es-MX')} renglones
          </span>
        ) : null}
      </div>

      {modelo === undefined ? (
        <p className="p-6 text-sm text-muted-foreground">
          Busca un modelo para ver su kardex (movimientos en orden, con el saldo tras cada uno).
        </p>
      ) : consulta.isError ? (
        <p className="p-6 text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
      ) : renglones.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Este modelo no tiene movimientos.</p>
      ) : (
        <div className="overflow-x-auto" data-testid="kardex-tabla">
          <TablaDensa>
            <TablaDensaEncabezado>
              <TablaDensaFila>
                <TablaDensaHead>Folio</TablaDensaHead>
                <TablaDensaHead>Fecha</TablaDensaHead>
                <TablaDensaHead>Movimiento</TablaDensaHead>
                <TablaDensaHead>Almacén</TablaDensaHead>
                <TablaDensaHead>Orden</TablaDensaHead>
                <TablaDensaHead>Color</TablaDensaHead>
                <TablaDensaHead>Talla</TablaDensaHead>
                <TablaDensaHead numerica>Entrada</TablaDensaHead>
                <TablaDensaHead numerica>Salida</TablaDensaHead>
                <TablaDensaHead numerica>Saldo</TablaDensaHead>
              </TablaDensaFila>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo>
              {renglones.map((r, i) => (
                <TablaDensaFila
                  key={`${r.idMovimiento}-${r.idColor}-${r.idTalla}-${i}`}
                  className={r.cancelado ? 'opacity-60' : ''}
                >
                  <TablaDensaCelda className="num font-medium">{r.folio}</TablaDensaCelda>
                  <TablaDensaCelda>{r.fecha}</TablaDensaCelda>
                  <TablaDensaCelda>
                    <span className="flex items-center gap-1.5">
                      {r.tipoMov}
                      {r.cancelado ? <ChipEstado tono="neutro">Cancelado</ChipEstado> : null}
                    </span>
                  </TablaDensaCelda>
                  <TablaDensaCelda>{r.almacen}</TablaDensaCelda>
                  <TablaDensaCelda className="text-muted-foreground">
                    {/* La orden de v2 si existe; si no, el nº de Control viejo (§Post-F9.25), que es
                        lo que hay para el inventario de arranque. */}
                    {r.folioOrden !== null
                      ? `#${String(r.folioOrden)}`
                      : r.numOrdenV1 !== null && r.numOrdenV1 !== ''
                        ? `${r.numOrdenV1} (Control viejo)`
                        : 'Sin orden'}
                  </TablaDensaCelda>
                  <TablaDensaCelda>{r.color}</TablaDensaCelda>
                  <TablaDensaCelda>{r.etiquetaTalla}</TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    {r.entrada > 0 ? r.entrada.toLocaleString('es-MX') : '—'}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica>
                    {r.salida > 0 ? r.salida.toLocaleString('es-MX') : '—'}
                  </TablaDensaCelda>
                  <TablaDensaCelda numerica className="font-semibold">
                    {r.saldo.toLocaleString('es-MX')}
                  </TablaDensaCelda>
                </TablaDensaFila>
              ))}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>
      )}
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
                    <ChipEstado tono="neutro" className="ml-2">
                      Cancelado
                    </ChipEstado>
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
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Color</TablaDensaHead>
                      <TablaDensaHead>Talla</TablaDensaHead>
                      <TablaDensaHead numerica>Cantidad</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {movimiento.lineas.flatMap((linea) =>
                      linea.tallas.map((t) => (
                        <TablaDensaFila key={`${linea.idColor}-${t.idTalla}`}>
                          <TablaDensaCelda>{linea.color}</TablaDensaCelda>
                          <TablaDensaCelda>{t.etiquetaTalla}</TablaDensaCelda>
                          <TablaDensaCelda numerica>
                            {t.cantidad.toLocaleString('es-MX')}
                          </TablaDensaCelda>
                        </TablaDensaFila>
                      )),
                    )}
                  </TablaDensaCuerpo>
                </TablaDensa>
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
