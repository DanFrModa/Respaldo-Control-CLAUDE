import { Loader2Icon } from 'lucide-react';

import { useSimularNegociacion } from '@/api/negociacion';
import { Badge } from '@/components/ui/badge';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';

/** Formatea un porcentaje con un decimal (ej. 44.4%). */
function pct(valor: number): string {
  return `${valor.toFixed(1)}%`;
}

/**
 * CALCULADORA de negociación EN VIVO (rediseño R5, §4.8) — el corazón de la mesa. El usuario captura un
 * PRECIO OBJETIVO y ve en tiempo real, contra el costo del renglón (o el de una versión de precosto si
 * se está armando una ronda), el **precio neto**, el **% de margen bruto** y si CUMPLE el margen
 * objetivo del cliente (verde/rojo). Toda la aritmética la hace el backend (A1: la fórmula NO se
 * duplica aquí); este componente sólo captura, debouncea y pinta. El precio objetivo es un input
 * CONTROLADO para que el flujo de la ronda lo reutilice como su "precio acordado".
 */
export function CalculadoraNegociacion({
  idLinea,
  idPrecosto,
  precioObjetivo,
  alCambiarPrecioObjetivo,
  etiqueta = 'Precio objetivo',
}: {
  idLinea: number;
  /** Versión de precosto cuyo costo simular (para previsualizar una ronda); omitido = costo vigente. */
  idPrecosto?: number;
  /** Valor del input (texto, controlado por el contenedor). */
  precioObjetivo: string;
  alCambiarPrecioObjetivo: (valor: string) => void;
  etiqueta?: string;
}): React.JSX.Element {
  const objetivoNum = Number(precioObjetivo);
  const objetivoValido =
    precioObjetivo.trim() !== '' && Number.isFinite(objetivoNum) && objetivoNum > 0;
  // Debounce del valor numérico: no golpea el backend en cada tecla (se espera a que el usuario pare).
  const objetivoDebounced = useDebounce(objetivoValido ? objetivoNum : 0, 350);
  const sim = useSimularNegociacion(idLinea, objetivoDebounced, {
    ...(idPrecosto === undefined ? {} : { idPrecosto }),
    habilitado: objetivoValido,
  });

  const datos = sim.data;
  const cumple = datos?.cumpleObjetivo ?? false;
  const claseMargen = cumple
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-destructive dark:text-destructive';

  return (
    <div
      className="space-y-3 rounded-lg border bg-muted/30 p-3"
      data-testid="calculadora-negociacion"
    >
      <Field>
        <FieldLabel htmlFor={`objetivo-${String(idLinea)}`}>{etiqueta}</FieldLabel>
        <Input
          id={`objetivo-${String(idLinea)}`}
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={precioObjetivo}
          onChange={(e) => alCambiarPrecioObjetivo(e.target.value)}
          placeholder="Captura el precio de venta propuesto"
          data-testid="calculadora-precio-objetivo"
        />
      </Field>

      {!objetivoValido ? (
        <p className="text-sm text-muted-foreground">
          Captura un precio objetivo para ver el margen en vivo.
        </p>
      ) : sim.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
          Calculando margen…
        </p>
      ) : sim.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {sim.error.message}
        </p>
      ) : datos ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Dato etiqueta="Costo" valor={formatearMoneda(datos.costo)} />
          <Dato etiqueta="Precio neto" valor={formatearMoneda(datos.precioNeto)} />
          <div>
            <span className="block text-xs text-muted-foreground">Margen bruto</span>
            <span
              className={`font-semibold tabular-nums ${claseMargen}`}
              data-testid="margen-bruto"
            >
              {pct(datos.margenBrutoPct)}
            </span>
          </div>
          <div className="flex items-end">
            <Badge
              variant={cumple ? 'default' : 'destructive'}
              data-testid="badge-cumple-objetivo"
              data-cumple={cumple}
            >
              {cumple ? 'Cumple' : 'Debajo'} · obj. {pct(datos.margenObjetivoPct)}
            </Badge>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Un dato numérico con etiqueta chica (costo / neto). */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }): React.JSX.Element {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{etiqueta}</span>
      <span className="font-medium tabular-nums">{valor}</span>
    </div>
  );
}
