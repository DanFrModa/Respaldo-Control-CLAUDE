import { AlertTriangleIcon, BanIcon, CheckIcon, Loader2Icon } from 'lucide-react';
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

import { diagnosticarPapel } from './estados-renglon';

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
 *
 * ⭐⭐ **V1-E8x (§Post-F9.155) — «todos» son los VIGENTES.** Los modelos DROPEADOS no entran al
 * documento ni cuentan para la firma: uno dropeado nunca se va a aprobar, y exigírsela dejaba la
 * lista sin cotización para siempre. Se listan aparte para que quien emite vea que se cayeron y no
 * los busque en el papel.
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

  // ⭐⭐ V1-E8x (§Post-F9.155): la cotización lleva los modelos **VIGENTES** — los NO dropeados.
  // Daniel: *«Después de la negociación solo hay que mandar los que están vigentes. Quitar los
  // dropeados»*. El diagnóstico es el MISMO que usa la pantalla de la lista y espeja el guard del
  // servidor; aquí decide a la vez qué se enseña en la palomera y si el botón se enciende.
  const papel = diagnosticarPapel(lista.lineas);
  const sinAprobar = papel.sinAprobar;
  // ⭐ V1-E8d (§Post-F9.127): renglones cuyo costo congelado quedó viejo porque la receta del modelo
  // se movió después. Aquí AVISA, no bloquea — Daniel pidió *"que me avise"*, y este documento es
  // justo por donde un precio sobre un costo viejo sale hacia el cliente. Sólo de los que van.
  const conCostoViejo = papel.vigentes.filter((l) => l.avisoCostoViejo !== null);
  const listoParaEmitir = papel.puedeSalir;
  // 🔴 La suma sólo tiene sentido si esta sesión PUEDE ver importes. Con `listas.negociar` pero sin
  // `consultas.ver-importes`, el backend manda `precioAprobado: null` en todos los renglones y el
  // `?? 0` hacía que la línea anunciara «$0.00» mientras cada renglón mostraba «—»: un total
  // inventado, y encima uno que invita a pensar que se está cotizando gratis. Sin permiso se muestra
  // «—», igual que los renglones.
  const total = verImportes
    ? papel.vigentes.reduce((suma, l) => suma + (l.precioAprobado ?? 0), 0)
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
            Van <strong>los {papel.vigentes.length} modelos vigentes</strong> de la lista. Una
            cotización dice lo que se ofrece ahora, completo: el cliente la lee sola, sin la
            anterior al lado.
          </p>

          {/* ⭐⭐ V1-E8x (§Post-F9.155): los DROPEADOS no van, y se dice CUÁLES — antes de negociar
              no hay ninguno (la «cotización previa» sale completa) y después salen los vigentes.
              Una sola regla para los dos momentos. */}
          {papel.dropeados.length > 0 ? (
            <p
              className="flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-muted-foreground"
              data-testid="dropeados-fuera-cotizacion"
            >
              <BanIcon className="mt-0.5 size-3.5 shrink-0 text-crit" aria-hidden />
              <span>
                <b>No van los dropeados:</b> {papel.dropeados.map((l) => l.codigoModelo).join(', ')}
                . El cliente ya dijo que no los compra; si se arrepiente, revívelos en la lista y
                vuelve a emitir.
              </span>
            </p>
          ) : null}

          <ul className="divide-y rounded-lg border" data-testid="renglones-cotizacion">
            {papel.vigentes.map((linea) => (
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

          {conCostoViejo.length > 0 ? (
            <p
              className="flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-2.5 py-1.5 text-[12px]"
              role="status"
              data-testid="aviso-costo-viejo-cotizacion"
            >
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              <span>
                <b>Ojo con el costo:</b> a {conCostoViejo.map((l) => l.codigoModelo).join(', ')} le
                cambiaron la receta DESPUÉS de congelarse el costo con el que está calculado su
                precio. La cotización sale igual — pero si el cambio mueve el costo, conviene
                recostear antes de mandarla.
              </span>
            </p>
          ) : null}

          {listoParaEmitir ? (
            <p className="text-right text-[12.5px] text-muted-foreground">
              Suma de precios: <strong className="tabular-nums">{formatearMoneda(total)}</strong>
            </p>
          ) : (
            <p className="text-[12.5px] text-destructive" role="alert">
              {lista.lineas.length === 0
                ? 'La lista no tiene modelos: no hay nada que cotizar.'
                : papel.vigentes.length === 0
                  ? 'Todos los modelos de la lista están DROPEADOS: no queda ninguno vigente que cotizar. Revive al menos uno en la lista.'
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
