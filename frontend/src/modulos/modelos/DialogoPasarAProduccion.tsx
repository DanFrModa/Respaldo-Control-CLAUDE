import { ArrowRightLeftIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { usePasarAProduccion, usePropuestaProduccion, type Modelo } from '@/api/modelos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * PASAR UN MODELO DE DESARROLLO A PRODUCCIÓN (§Post-F9.34 punto 4 + §Post-F9.46).
 *
 * El campo llega **YA LLENO** con el siguiente número libre de la serie del modelo: Daniel lo
 * acepta de un clic, o lo borra y teclea el suyo — *"el sistema precarga el siguiente número libre,
 * y Daniel lo puede cambiar"*. El backend es el que decide (A1): aquí sólo se valida la FORMA (5
 * dígitos) para no mandar basura; los avisos de congruencia y de cercanía al tope los redacta el
 * dominio y se enseñan tal cual, y **no bloquean**. Lo único que sí bloquea es el número repetido,
 * y eso lo dice el backend con su conflicto.
 *
 * Lo que NO pasa aquí, y por eso se dice en el diálogo: el nº de DESARROLLO no se pierde (D3), y
 * la receta, el arte, las fotos, el precosteo y las órdenes del modelo siguen intactos (cuelgan
 * del id del modelo, no de su código).
 */
export function DialogoPasarAProduccion({
  abierto,
  alCambiarAbierto,
  modelo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  modelo: Modelo | null;
}): React.JSX.Element {
  const propuesta = usePropuestaProduccion(abierto && modelo !== null ? modelo.id : undefined);
  const promover = usePasarAProduccion();
  const [numero, setNumero] = useState('');
  const [tocado, setTocado] = useState(false);

  // El campo se PRECARGA con la propuesta en cuanto llega, salvo que el usuario ya haya escrito
  // (no se le pisa lo tecleado si la consulta re-valida).
  const propuestoCodigo = propuesta.data?.codigo ?? null;
  useEffect(() => {
    if (!abierto) {
      setNumero('');
      setTocado(false);
      return;
    }
    if (!tocado && propuestoCodigo !== null) {
      setNumero(propuestoCodigo);
    }
  }, [abierto, propuestoCodigo, tocado]);

  const formaValida = /^\d{5}$/.test(numero.trim());
  const errorForma =
    numero.trim() === '' || formaValida
      ? undefined
      : { message: 'El número debe tener 5 dígitos.' };

  function confirmar(): void {
    if (modelo === null || !formaValida) {
      return;
    }
    promover.mutate(
      { id: modelo.id, cuerpo: { numeroProduccion: Number(numero.trim()) } },
      {
        onSuccess: (resultado) => {
          toast.success(
            `Modelo ${String(resultado.numeroProduccion)} en producción` +
              (modelo.codigoDesarrollo !== null
                ? ` (conserva su nº de desarrollo ${modelo.codigoDesarrollo})`
                : ''),
          );
          for (const aviso of resultado.avisos) {
            toast.warning(aviso);
          }
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md" data-testid="dialogo-pasar-a-produccion">
        <DialogHeader>
          <DialogTitle>Pasar a producción</DialogTitle>
          <DialogDescription>
            {modelo === null
              ? ''
              : `El modelo ${modelo.codigo} entra al catálogo de producción con su número de 5 dígitos.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {propuesta.isPending ? (
            <p className="text-sm text-muted-foreground">Calculando el siguiente número libre…</p>
          ) : propuesta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {propuesta.error.message}
            </p>
          ) : null}

          <Field data-invalid={Boolean(errorForma)}>
            <FieldLabel htmlFor="numero-produccion" required>
              Número de producción
            </FieldLabel>
            <Input
              id="numero-produccion"
              inputMode="numeric"
              maxLength={5}
              className="mono"
              value={numero}
              onChange={(e) => {
                setTocado(true);
                setNumero(e.target.value.replace(/\D/g, ''));
              }}
              aria-invalid={Boolean(errorForma)}
              disabled={promover.isPending}
              data-testid="numero-produccion"
            />
            <FieldDescription>
              {propuesta.data?.serie !== undefined ? (
                <>
                  Los dos primeros dígitos ({propuesta.data.serie.par}) son el tipo de prenda y el
                  género; los otros tres, el consecutivo. A la serie {propuesta.data.serie.par} le
                  quedan {propuesta.data.serie.libres.toLocaleString('es-MX')} números de 999.
                </>
              ) : (
                'Cinco dígitos: tipo de prenda + género + consecutivo.'
              )}
            </FieldDescription>
            <FieldError errors={[errorForma]} />
          </Field>

          {(propuesta.data?.avisos ?? []).map((aviso) => (
            <p
              key={aviso}
              className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground"
              data-testid="aviso-produccion"
            >
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
              <span>{aviso}</span>
            </p>
          ))}

          {modelo?.codigoDesarrollo !== null && modelo !== null ? (
            <p className="rounded-md bg-panel-2 px-3 py-2 text-xs text-muted-foreground">
              Su nº de desarrollo <b className="mono">{modelo.codigoDesarrollo}</b> se conserva y
              sigue siendo buscable. La receta, el arte, las fotos, el precosteo y sus órdenes no se
              tocan.
            </p>
          ) : null}

          {/* ⭐⭐ V1-E3 (§Post-F9.172(b)): pulsar esto es lo CONTRARIO del camino normal, y no tiene
              vuelta atrás. Se dice aquí, antes del clic, porque el daño era silencioso: el modelo
              quedaba con UN número para todos sus colores y sus OP ya no hacían nacer ninguno. */}
          <p
            className="rounded-md border border-amber-400/50 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="aviso-un-numero-para-todos-los-colores"
          >
            <b>Esto le da UN número a todo el modelo, no uno por color.</b> Lo normal es dejar que
            el número se lo dé su <b>OP</b>: al generar la orden de cada color nace su propio modelo
            de producción, con su número y compartiendo esta receta. <b>No hay vuelta atrás:</b> un
            modelo ya pasado a producción no vuelve a desarrollo y sus OP no harán nacer modelos por
            color.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={promover.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={!formaValida || promover.isPending}
            data-testid="confirmar-pasar-a-produccion"
          >
            {promover.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <ArrowRightLeftIcon aria-hidden />
            )}
            Pasar a producción
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
