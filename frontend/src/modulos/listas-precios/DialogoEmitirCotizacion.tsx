import { CheckIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useEmitirCotizacion } from '@/api/cotizaciones';
import type { ListaDetalle } from '@/api/listas-precios';
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
import { Input } from '@/components/ui/input';
import { formatearMoneda } from '@/lib/formato';
import { useSesion } from '@/sesion/useSesion';

/**
 * Diálogo de **EMITIR COTIZACIÓN** (V1-E7c) — el papel que sale de la mesa.
 *
 * Muestra los renglones que van, **TODOS preseleccionados y sin poder quitarse**: es la regla que
 * dictó Daniel (*"o sea una cotización con los 5 modelos"*) — si en esta vuelta sólo cambiaron 3 de
 * los 5, la cotización nueva lleva los cinco igual, porque el cliente la lee sola, sin la anterior al
 * lado. Por eso las palomas van fijas: dejarlas desmarcables invitaría justo al error que la regla
 * evita (mandar el delta y obligar al cliente a reconstruir el paquete de memoria).
 *
 * Si algún renglón todavía no tiene precio APROBADO, el botón se bloquea aquí y se nombra cuál — el
 * backend lo rechaza de todos modos (es él quien manda, A1); esto sólo evita el viaje.
 */
export function DialogoEmitirCotizacion({
  abierto,
  alCambiarAbierto,
  lista,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  lista: ListaDetalle;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const verImportes = tienePermiso('consultas.ver-importes');
  const emitir = useEmitirCotizacion();
  const [notas, setNotas] = useState('');

  useEffect(() => {
    if (abierto) {
      setNotas('');
    }
  }, [abierto]);

  const sinAprobar = lista.lineas.filter((l) => !l.aprobado);
  const listoParaEmitir = lista.lineas.length > 0 && sinAprobar.length === 0;
  // 🔴 La suma sólo tiene sentido si esta sesión PUEDE ver importes. Con `listas.negociar` pero sin
  // `consultas.ver-importes`, el backend manda `precioAprobado: null` en todos los renglones y el
  // `?? 0` hacía que la línea anunciara «$0.00» mientras cada renglón mostraba «—»: un total
  // inventado, y encima uno que invita a pensar que se está cotizando gratis. Sin permiso se muestra
  // «—», igual que los renglones.
  const total = verImportes
    ? lista.lineas.reduce((suma, l) => suma + (l.precioAprobado ?? 0), 0)
    : null;

  function enviar(): void {
    emitir.mutate(
      {
        idLista: lista.id,
        ...(notas.trim() === '' ? {} : { notas: notas.trim() }),
      },
      {
        onSuccess: (cotizacion) => {
          toast.success(
            `Cotización #${String(cotizacion.folio)} emitida con ${String(cotizacion.lineas.length)} modelos.`,
          );
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Emitir cotización de la lista #{lista.folio}</DialogTitle>
          <DialogDescription>
            El documento se le manda al cliente tal como queda aquí: se congelan los precios, los
            modelos y la versión de la receta. Una cotización emitida no se edita — si algo cambia,
            se emite otra.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-[12.5px] text-muted-foreground">
            Van <strong>los {lista.lineas.length} modelos</strong> de la lista. Una cotización dice
            lo que se ofrece ahora, completo: el cliente la lee sola, sin la anterior al lado.
          </p>

          <ul className="divide-y rounded-lg border" data-testid="renglones-cotizacion">
            {lista.lineas.map((linea) => (
              <li key={linea.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                <CheckIcon
                  className={
                    linea.aprobado ? 'size-3.5 shrink-0 text-ok' : 'size-3.5 shrink-0 text-faint'
                  }
                  aria-hidden
                />
                <span className="font-medium">{linea.codigoModelo}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {linea.descripcionModelo ?? '—'}
                </span>
                {linea.aprobado ? (
                  <span className="tabular-nums">{formatearMoneda(linea.precioAprobado)}</span>
                ) : (
                  <span className="text-[12px] text-destructive">sin aprobar</span>
                )}
              </li>
            ))}
          </ul>

          {listoParaEmitir ? (
            <p className="text-right text-[12.5px] text-muted-foreground">
              Suma de precios: <strong className="tabular-nums">{formatearMoneda(total)}</strong>
            </p>
          ) : (
            <p className="text-[12.5px] text-destructive" role="alert">
              {lista.lineas.length === 0
                ? 'La lista no tiene modelos: no hay nada que cotizar.'
                : `Falta aprobar el precio de: ${sinAprobar.map((l) => l.codigoModelo).join(', ')}. No se le manda al cliente un precio que el dueño no aprobó.`}
            </p>
          )}

          <Field>
            <FieldLabel htmlFor="cotizacion-notas">Notas (se imprimen en el documento)</FieldLabel>
            <Input
              id="cotizacion-notas"
              value={notas}
              maxLength={1000}
              placeholder="Ej. Vigencia 30 días"
              disabled={emitir.isPending}
              onChange={(e) => setNotas(e.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={emitir.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={enviar}
            disabled={emitir.isPending || !listoParaEmitir}
            data-testid="confirmar-emitir-cotizacion"
          >
            {emitir.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Emitir cotización
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
