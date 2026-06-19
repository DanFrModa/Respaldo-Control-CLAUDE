import { Ban, Loader2Icon, Scissors, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCancelarCorte, useCancelarEnvio, useEtapasOrden } from '@/api/etapas';
import type { EtapaHistorial } from '@/api/tipos';
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
import { useSesion } from '@/sesion/useSesion';

/**
 * HISTORIAL de etapas (cortes y envíos) de la orden seleccionada (F3-E2). Muestra cada captura —
 * VIVA o CANCELADA (las canceladas se conservan, marcadas con un badge "Cancelada") — con su folio,
 * tercero, proceso, total y fecha. En cada etapa VIVA, un botón **Cancelar** abre un diálogo de
 * MOTIVO (mismo patrón que `DialogoCancelarOrden`) y llama a `useCancelarCorte`/`useCancelarEnvio`.
 * Al cancelar, las claves de `produccion-etapas` se invalidan (la mutación lo hace), así regresan
 * los pendientes y la etapa aparece como cancelada sin recargar.
 *
 * `produccion.wip-ver` gobierna ver el historial; `produccion.cancelar`, los botones de cancelar.
 */
export function HistorialEtapasOrden({
  idOrden,
}: {
  idOrden: number | undefined;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeCancelar = tienePermiso('produccion.cancelar');

  const consulta = useEtapasOrden(idOrden, idOrden !== undefined);
  const [aCancelar, setACancelar] = useState<EtapaHistorial | null>(null);

  const etapas = consulta.data?.etapas ?? [];

  return (
    <>
      <Card data-testid="historial-etapas">
        <CardHeader>
          <CardTitle>Historial de la orden</CardTitle>
          <CardDescription>
            Cortes y envíos capturados (las canceladas se conservan).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {idOrden === undefined ? (
            <p className="text-sm text-muted-foreground">
              Selecciona una orden para ver su historial.
            </p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : etapas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta orden aún no tiene cortes ni envíos.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {etapas.map((etapa) => (
                <li
                  key={etapa.id}
                  className={`flex items-center justify-between gap-3 p-3 ${etapa.cancelado ? 'opacity-60' : ''}`}
                  data-testid="historial-etapa"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {etapa.tipo === 'corte' ? (
                      <Scissors className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <Send className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {etapa.tipo === 'corte' ? 'Corte' : 'Envío'} #{etapa.folio}
                        {etapa.tipoProceso ? (
                          <span className="text-muted-foreground">· {etapa.tipoProceso}</span>
                        ) : null}
                        {etapa.cancelado ? (
                          <Badge variant="secondary" data-testid="historial-cancelado">
                            Cancelada
                          </Badge>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {etapa.tercero ?? 'Sin asignar'} · {etapa.totalPiezas} pzas · {etapa.fecha}
                        {etapa.cancelado && etapa.motivoCancelacion
                          ? ` · Motivo: ${etapa.motivoCancelacion}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  {puedeCancelar && !etapa.cancelado ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setACancelar(etapa)}
                      data-testid="historial-cancelar"
                    >
                      <Ban className="mr-1.5 size-4" aria-hidden /> Cancelar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DialogoCancelarEtapa etapa={aCancelar} alCerrar={() => setACancelar(null)} />
    </>
  );
}

/**
 * Diálogo de CANCELACIÓN de una etapa (corte o envío). Cancelación SUAVE que EXIGE un motivo (lo
 * re-valida el backend). Despacha al hook correcto según el tipo de la etapa. Mismo patrón que
 * `DialogoCancelarOrden`.
 */
function DialogoCancelarEtapa({
  etapa,
  alCerrar,
}: {
  etapa: EtapaHistorial | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const cancelarCorte = useCancelarCorte();
  const cancelarEnvio = useCancelarEnvio();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (etapa !== null) {
      setMotivo('');
    }
  }, [etapa]);

  const esCorte = etapa?.tipo === 'corte';
  const mutacion = esCorte ? cancelarCorte : cancelarEnvio;
  const sinMotivo = motivo.trim().length === 0;

  function confirmar(): void {
    if (etapa === null) {
      return;
    }
    const limpio = motivo.trim();
    if (limpio.length === 0) {
      return;
    }
    mutacion.mutate(
      { id: etapa.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(`${esCorte ? 'Corte' : 'Envío'} #${etapa.folio} cancelado.`);
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={etapa !== null} onOpenChange={(abierto) => (abierto ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Cancelar {esCorte ? 'corte' : 'envío'} {etapa ? `#${etapa.folio}` : ''}
          </DialogTitle>
          <DialogDescription>
            La etapa se conserva como historial (cancelación suave) pero deja de contar en los
            pendientes. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="etapa-motivo-cancelar">Motivo</FieldLabel>
            <textarea
              id="etapa-motivo-cancelar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela esta etapa"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="etapa-motivo-cancelar"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={mutacion.isPending}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={mutacion.isPending || sinMotivo}
            data-testid="confirmar-cancelar-etapa"
          >
            {mutacion.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar {esCorte ? 'corte' : 'envío'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
