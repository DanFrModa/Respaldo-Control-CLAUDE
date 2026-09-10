import { LockIcon, Loader2Icon } from 'lucide-react';

import { useSimularNegociacion } from '@/api/negociacion';
import { useSesion } from '@/sesion/useSesion';
import { Badge } from '@/components/ui/badge';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';

/** Formatea un porcentaje con un decimal (ej. 44.4%), o "—" si el servidor lo ocultó. */
function pct(valor: number | null): string {
  return valor === null ? '—' : `${valor.toFixed(1)}%`;
}

/**
 * CALCULADORA de negociación EN VIVO (rediseño R5, §4.8) — el corazón de la mesa. El usuario captura un
 * PRECIO OBJETIVO y ve en tiempo real, contra el costo del renglón (o el de una versión de precosto si
 * se está armando una ronda), el **precio neto**, el **% de margen bruto** y si CUMPLE el margen
 * objetivo del cliente (verde/rojo). Toda la aritmética la hace el backend (A1: la fórmula NO se
 * duplica aquí); este componente sólo captura, debouncea y pinta. El precio objetivo es un input
 * CONTROLADO para que el flujo de la ronda lo reutilice como su "precio acordado".
 *
 * ⭐ **V1-E8b (§Post-F9.125(b)) — sin `listas.aprobar` los NÚMEROS no se piden ni se pintan.** Los
 * cuatro salían del margen del cliente y lo delataban: `obj. 44.4%` **es** el factor, y el resto se
 * despeja de ahí. El servidor ya los manda en `null`; aquí además **no se hace la consulta** y se dice
 * POR QUÉ, en vez de dejar cuatro guiones que parecen un error de carga. Daniel: *"puede hacer sus
 * cálculos, pero el sistema no le muestra información digerida"*.
 *
 * ⚠️ **El INPUT del precio se queda para todos**, y no es un descuido: lo posee el diálogo de la
 * ronda, que reutiliza su valor como «precio acordado». Quitarlo rompería registrar una ronda —que sí
 * es trabajo de quien negocia—; lo que se retira es el veredicto del sistema, no la captura.
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
  const { tienePermiso } = useSesion();
  // §Post-F9.125(b): el margen es del dueño. Sin el permiso no se consulta siquiera — el backend lo
  // devolvería todo en null, y pedirlo sólo para pintar guiones sería ruido.
  const verMargen = tienePermiso('listas.aprobar');
  const sim = useSimularNegociacion(idLinea, objetivoDebounced, {
    ...(idPrecosto === undefined ? {} : { idPrecosto }),
    habilitado: objetivoValido && verMargen,
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

      {!verMargen ? (
        <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {/* Se dice a QUIÉN le toca, no cómo se llama el permiso por dentro (§Post-F9.68). */}
          <span>
            El <b>margen</b> y los factores del precio son facultad del <b>dueño</b>: aquí sólo se
            captura el precio que se acuerde en la mesa.
          </span>
        </p>
      ) : !objetivoValido ? (
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
          <Dato
            etiqueta="Precio neto"
            valor={datos.precioNeto === null ? '—' : formatearMoneda(datos.precioNeto)}
          />
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
