import { CheckCircle2, CircleDashed, Loader2Icon, Plus, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCancelarHito, useHitosOrden, useRegistrarHito } from '@/api/hitos-orden';
import type { HitoOrden, Orden, TipoHitoOrden } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
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

/** Los 6 tipos de hito EN ORDEN, con su etiqueta para la UI. */
const TIPOS_HITO: { tipo: TipoHitoOrden; etiqueta: string }[] = [
  { tipo: 'revisionOp', etiqueta: 'Revisión de la orden' },
  { tipo: 'fit', etiqueta: 'Autorización de fit' },
  { tipo: 'tonoTela', etiqueta: 'Autorización de tono de tela' },
  { tipo: 'avios', etiqueta: 'Autorización de avíos' },
  { tipo: 'empaque', etiqueta: 'Empaque' },
  { tipo: 'arte', etiqueta: 'Autorización de arte' },
];

/** Formatea una fecha date-only `YYYY-MM-DD` como "13 jun 2026" sin desfase de zona. */
function fechaCorta(valor: string): string {
  const [a, m, d] = valor.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) {
    return valor;
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Bloque "Hitos de la orden" del detalle de una ORDEN (cierre del hueco de emisores, post-F9). Seis
 * actos puntuales (revisión de la OP, autorización de fit/tono/avíos, empaque, autorización de arte)
 * que Daniel dictó AUTOMÁTICOS pero que no nacen de un hecho estructurado: se capturan aquí y
 * auto-completan su proceso de la Ruta Crítica vía el auto-avance. Un renglón por tipo, con su estado
 * (quién/cuándo o "pendiente") y las acciones registrar / cancelar-con-motivo. Las acciones se ocultan
 * sin `rc.capturar` (gate `puedeCapturar`); el backend re-decide (A1).
 */
export function PanelHitosOrden({
  orden,
  puedeCapturar,
}: {
  orden: Orden;
  puedeCapturar: boolean;
}): React.JSX.Element {
  const hitos = useHitosOrden(orden.id);
  const registrar = useRegistrarHito();
  const cancelar = useCancelarHito();
  const [aCancelar, setACancelar] = useState<HitoOrden | null>(null);

  if (hitos.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando hitos…</p>;
  }
  if (hitos.isError) {
    return <p className="text-sm text-destructive">{hitos.error.message}</p>;
  }

  function alRegistrar(tipo: TipoHitoOrden, etiqueta: string): void {
    registrar.mutate(
      { idOrden: orden.id, cuerpo: { tipo } },
      {
        onSuccess: () => toast.success(`Hito "${etiqueta}" registrado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const vivoPorTipo = new Map(hitos.data.map((h) => [h.tipo, h]));

  return (
    <div className="space-y-2" data-testid="hitos-orden">
      <ul className="divide-y rounded-lg border">
        {TIPOS_HITO.map(({ tipo, etiqueta }) => {
          const vivo = vivoPorTipo.get(tipo) ?? null;
          return (
            <li
              key={tipo}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              data-testid={`hito-${tipo}`}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {vivo ? (
                    <CheckCircle2 className="size-4 text-primary" aria-hidden />
                  ) : (
                    <CircleDashed className="size-4 text-muted-foreground" aria-hidden />
                  )}
                  {etiqueta}
                </p>
                {vivo ? (
                  <p className="pl-6 text-xs text-muted-foreground">
                    {fechaCorta(vivo.fecha)}
                    {vivo.registradoPorId ? ` · por ${vivo.registradoPorId}` : ''}
                  </p>
                ) : (
                  <p className="pl-6 text-xs text-muted-foreground">Pendiente</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {vivo ? <Badge variant="default">Registrado</Badge> : null}
                {puedeCapturar && vivo === null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => alRegistrar(tipo, etiqueta)}
                    disabled={registrar.isPending}
                    data-testid={`registrar-hito-${tipo}`}
                  >
                    <Plus aria-hidden />
                    Registrar
                  </Button>
                ) : null}
                {puedeCapturar && vivo !== null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setACancelar(vivo)}
                    data-testid={`cancelar-hito-${tipo}`}
                  >
                    <XCircle aria-hidden />
                    Cancelar
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <DialogoCancelarHito
        hito={aCancelar}
        idOrden={orden.id}
        procesando={cancelar.isPending}
        alCerrar={() => setACancelar(null)}
        alConfirmar={(motivo) => {
          if (aCancelar === null) return;
          cancelar.mutate(
            { idOrden: orden.id, idHito: aCancelar.id, motivo },
            {
              onSuccess: () => {
                toast.success('Hito cancelado.');
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

/** Diálogo de cancelación de un hito (cancelación suave, motivo obligatorio). */
function DialogoCancelarHito({
  hito,
  idOrden,
  procesando,
  alCerrar,
  alConfirmar,
}: {
  hito: HitoOrden | null;
  idOrden: number;
  procesando: boolean;
  alCerrar: () => void;
  alConfirmar: (motivo: string) => void;
}): React.JSX.Element {
  const [motivo, setMotivo] = useState('');
  const abierto = hito !== null;

  useEffect(() => {
    if (abierto) {
      setMotivo('');
    }
  }, [abierto]);

  const sinMotivo = motivo.trim().length === 0;

  return (
    <Dialog open={abierto} onOpenChange={(v) => (v ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar hito</DialogTitle>
          <DialogDescription>
            El hito se conserva (cancelación suave) pero deja de contar; su proceso de la Ruta
            Crítica se des-completa si ya no queda otro hito vivo del tipo. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor={`hito-motivo-${idOrden}`}>Motivo</FieldLabel>
            <textarea
              id={`hito-motivo-${idOrden}`}
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela el hito"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="hito-motivo-cancelar"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={procesando}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => alConfirmar(motivo.trim())}
            disabled={procesando || sinMotivo}
            data-testid="confirmar-cancelar-hito"
          >
            {procesando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar hito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
