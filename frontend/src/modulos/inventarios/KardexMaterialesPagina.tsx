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
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { useSesion } from '@/sesion/useSesion';

import { PestanasSegmentadas } from './PestanasSegmentadas';
import { SelectorAvio } from './SelectorAvio';
import { SelectorTela } from './SelectorTela';

type Dimension = 'tela' | 'avio';

/**
 * KARDEX de materiales (F4-E1, doc 04-Inventarios §B.4 — re-vestido R9 al estándar del grupo):
 * movimientos cronológicos con SALDO CORRIDO en card única (toolbar con combobox + conteo plano +
 * TABLA DENSA). Dos dimensiones en un riel segmentado (proto `.tabs`): TELAS (por tela; entradas,
 * salidas a orden visibles vía origen) y AVÍOS (por avío). Las salidas ligadas a orden muestran su
 * origen. Costos/importes solo si la sesión tiene `telas.ver-totales` (el backend ya los omite si
 * no — la UI no los asume). Consulta MÓVIL (tarjetas en móvil, tabla en escritorio).
 * `inventario-telas.ver`/`inventario-avios.ver` gobiernan el acceso. Permite CANCELAR un movimiento
 * (inverso auditado, D3) con `*.mover`.
 */
export function KardexMaterialesPagina(): React.JSX.Element {
  const [dimension, setDimension] = useState<Dimension>('tela');

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
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

      <PestanasSegmentadas<Dimension>
        opciones={[
          { valor: 'tela', etiqueta: 'Telas', testid: 'kardex-mat-dim-tela' },
          { valor: 'avio', etiqueta: 'Avíos', testid: 'kardex-mat-dim-avio' },
        ]}
        valor={dimension}
        alCambiar={setDimension}
        etiqueta="Tipo de material"
        className="w-fit"
      />

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

/** Kardex por TELA (card estándar: toolbar con combobox + tabla densa). */
function KardexTela(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');
  const [tela, setTela] = useState<Tela | undefined>(undefined);
  const [aCancelar, setACancelar] = useState<KardexTelaRenglon | null>(null);
  const consulta = useKardexTela(tela !== undefined ? { idTela: tela.id } : undefined);
  const renglones = consulta.data?.renglones ?? [];
  const cancelar = useCancelarTela();

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="w-64 [&_input]:h-8 [&_input]:text-sm">
          <SelectorTela
            idSeleccionado={tela?.id}
            alSeleccionar={setTela}
            alLimpiar={() => setTela(undefined)}
          />
        </div>
        {/* Identidad VISIBLE de la tela consultada: nombre + descripción (el value del input no
            es un nodo de texto; el kardex debe decir de QUÉ tela es). */}
        {tela !== undefined ? (
          <span className="truncate text-xs text-muted-foreground" data-testid="kardex-tela-sel">
            <span className="font-medium text-foreground">{tela.nombre}</span>
            {tela.descripcion !== null ? <> — {tela.descripcion}</> : null}
          </span>
        ) : null}
        {tela !== undefined ? (
          <span className="ml-auto text-xs text-faint">
            {renglones.length.toLocaleString('es-MX')} renglones
          </span>
        ) : null}
      </div>

      {tela === undefined ? (
        <p className="p-6 text-sm text-muted-foreground">
          Busca una tela para ver su kardex (movimientos en orden, con el saldo por lote tras cada
          uno).
        </p>
      ) : consulta.isError ? (
        <p className="p-6 text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
      ) : renglones.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Esta tela no tiene movimientos.</p>
      ) : (
        <>
          {/* Móvil: tarjetas. */}
          <div className="space-y-3 p-3 md:hidden" data-testid="kardex-tela-tarjetas">
            {renglones.map((r, i) => (
              <div
                key={`${r.idMovimiento}-${r.idLote ?? 'sl'}-${i}`}
                className="space-y-1 rounded-lg border bg-card p-3 text-sm"
              >
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
                  <span className="num">{efectoRenglon(r.entrada, r.salida)}</span>
                  <span className="num font-semibold">
                    Saldo: {r.saldo.toLocaleString('es-MX')}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Escritorio: tabla densa. */}
          <div className="hidden overflow-x-auto md:block" data-testid="kardex-tela-tabla">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Folio</TablaDensaHead>
                  <TablaDensaHead>Fecha</TablaDensaHead>
                  <TablaDensaHead>Movimiento</TablaDensaHead>
                  <TablaDensaHead>Almacén</TablaDensaHead>
                  <TablaDensaHead>Lote</TablaDensaHead>
                  <TablaDensaHead numerica>Entrada</TablaDensaHead>
                  <TablaDensaHead numerica>Salida</TablaDensaHead>
                  <TablaDensaHead numerica>Saldo</TablaDensaHead>
                  {puedeMover ? <TablaDensaHead /> : null}
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {renglones.map((r, i) => (
                  <TablaDensaFila
                    key={`${r.idMovimiento}-${r.idLote ?? 'sl'}-${i}`}
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
                    <TablaDensaCelda>{r.loteClave ?? '(sin lote)'}</TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {r.entrada > 0 ? r.entrada.toLocaleString('es-MX') : '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {r.salida > 0 ? r.salida.toLocaleString('es-MX') : '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="font-semibold">
                      {r.saldo.toLocaleString('es-MX')}
                    </TablaDensaCelda>
                    {puedeMover ? (
                      <TablaDensaCelda className="text-right">
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
                      </TablaDensaCelda>
                    ) : null}
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        </>
      )}

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

/** Kardex por AVÍO (card estándar: toolbar con combobox + tabla densa). */
function KardexAvio(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-avios.mover');
  const [avio, setAvio] = useState<Avio | undefined>(undefined);
  const [aCancelar, setACancelar] = useState<KardexAvioRenglon | null>(null);
  const consulta = useKardexAvio(avio !== undefined ? { idAvio: avio.id } : undefined);
  const renglones = consulta.data?.renglones ?? [];
  const cancelar = useCancelarAvio();

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="w-64 [&_input]:h-8 [&_input]:text-sm">
          <SelectorAvio
            idSeleccionado={avio?.id}
            alSeleccionar={setAvio}
            alLimpiar={() => setAvio(undefined)}
          />
        </div>
        {/* Identidad VISIBLE del avío consultado: clave + descripción (el value del input no
            es un nodo de texto; el kardex debe decir de QUÉ avío es). */}
        {avio !== undefined ? (
          <span className="truncate text-xs text-muted-foreground" data-testid="kardex-avio-sel">
            <span className="num font-medium text-foreground">{avio.clave}</span> —{' '}
            {avio.descripcion}
          </span>
        ) : null}
        {avio !== undefined ? (
          <span className="ml-auto text-xs text-faint">
            {renglones.length.toLocaleString('es-MX')} renglones
          </span>
        ) : null}
      </div>

      {avio === undefined ? (
        <p className="p-6 text-sm text-muted-foreground">
          Busca un avío para ver su kardex (movimientos en orden, con el saldo por almacén).
        </p>
      ) : consulta.isError ? (
        <p className="p-6 text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
      ) : renglones.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Este avío no tiene movimientos.</p>
      ) : (
        <>
          {/* Móvil: tarjetas. */}
          <div className="space-y-3 p-3 md:hidden" data-testid="kardex-avio-tarjetas">
            {renglones.map((r, i) => (
              <div
                key={`${r.idMovimiento}-${i}`}
                className="space-y-1 rounded-lg border bg-card p-3 text-sm"
              >
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
                  <span className="num">{efectoRenglon(r.entrada, r.salida)}</span>
                  <span className="num font-semibold">
                    Saldo: {r.saldo.toLocaleString('es-MX')}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Escritorio: tabla densa. */}
          <div className="hidden overflow-x-auto md:block" data-testid="kardex-avio-tabla">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Folio</TablaDensaHead>
                  <TablaDensaHead>Fecha</TablaDensaHead>
                  <TablaDensaHead>Movimiento</TablaDensaHead>
                  <TablaDensaHead>Almacén</TablaDensaHead>
                  <TablaDensaHead numerica>Entrada</TablaDensaHead>
                  <TablaDensaHead numerica>Salida</TablaDensaHead>
                  <TablaDensaHead numerica>Saldo</TablaDensaHead>
                  {puedeMover ? <TablaDensaHead /> : null}
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {renglones.map((r, i) => (
                  <TablaDensaFila
                    key={`${r.idMovimiento}-${i}`}
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
                    <TablaDensaCelda numerica>
                      {r.entrada > 0 ? r.entrada.toLocaleString('es-MX') : '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {r.salida > 0 ? r.salida.toLocaleString('es-MX') : '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica className="font-semibold">
                      {r.saldo.toLocaleString('es-MX')}
                    </TablaDensaCelda>
                    {puedeMover ? (
                      <TablaDensaCelda className="text-right">
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
                      </TablaDensaCelda>
                    ) : null}
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        </>
      )}

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
