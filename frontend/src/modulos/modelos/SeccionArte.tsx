import { Loader2Icon, PencilIcon, StarIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useEliminarArte, useMarcarArtePrincipal, type Arte } from '@/api/artes';
import { Button } from '@/components/ui/button';
import { MiniaturaArte } from '@/modulos/arte/MiniaturaArte';

import { CopiarArteDialogo } from './CopiarArteDialogo';
import { DialogoArte } from './DialogoArte';

/**
 * Sección ARTE de la receta del modelo (V1-E3d, §Post-F9.35).
 *
 * A diferencia de telas y avíos —que se guardan como SET completo— el arte se administra RENGLÓN
 * POR RENGLÓN: cada arte tiene su ficha (descripción, posición, tipo, puntadas, precio, proveedor)
 * y sus FOTOS, y una foto no cabe dentro de un PUT de conjunto. Por eso aquí hay «Agregar arte»,
 * editar, quitar y «Copiar arte de otro modelo» (la conveniencia que daba el catálogo, sin
 * reinventarlo).
 *
 * El ORDEN importa: el PRIMER renglón es el arte PRINCIPAL del modelo (jul-2026, Daniel) — lleva
 * estrella + rótulo "Principal" y los demás una acción para tomar su lugar.
 */
export function SeccionArte({
  idModelo,
  artes,
  puedeAdministrar,
}: {
  idModelo: number;
  /** El arte del modelo, YA ordenado por el servidor (el principal primero). */
  artes: readonly Arte[];
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [copiarAbierto, setCopiarAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<Arte | undefined>(undefined);

  const eliminar = useEliminarArte();
  const marcarPrincipal = useMarcarArtePrincipal();

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(arte: Arte): void {
    setEnEdicion(arte);
    setDialogoAbierto(true);
  }

  function quitar(arte: Arte): void {
    eliminar.mutate(
      { idModelo, idArte: arte.id },
      {
        onSuccess: () => toast.success(`Arte "${arte.descripcion}" quitado del modelo.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function marcar(arte: Arte): void {
    marcarPrincipal.mutate(
      { idModelo, idArte: arte.id },
      {
        onSuccess: () => toast.success('Arte principal actualizado.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const ocupado = eliminar.isPending || marcarPrincipal.isPending;

  return (
    <div className="space-y-3" data-testid="seccion-bom-artes">
      {puedeAdministrar ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={abrirAlta} data-testid="agregar-arte">
            Agregar arte
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setCopiarAbierto(true)}
            data-testid="abrir-copiar-arte"
          >
            Copiar arte de otro modelo…
          </Button>
        </div>
      ) : null}

      {artes.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          El modelo no tiene arte.
        </p>
      ) : (
        <ul className="space-y-2">
          {artes.map((arte, indice) => (
            <li
              key={arte.id}
              className="flex items-center gap-3 rounded-lg border p-3"
              data-testid={`renglon-arte-${arte.id}`}
              // El PRIMER arte es el principal del modelo (el servidor lo devuelve ordenado).
              data-principal={indice === 0 ? 'si' : 'no'}
            >
              <MiniaturaArte
                idModelo={idModelo}
                idArte={arte.id}
                nombre={arte.descripcion}
                tieneFoto={arte.fotos.length > 0}
                tamano="lg"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{arte.descripcion}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {arte.tipoArte}
                  {arte.posicion === null ? '' : ` · ${arte.posicion}`}
                  {arte.precio === null ? ' · sin precio' : ` · $${arte.precio.toFixed(2)}`}
                  {arte.proveedor === null ? '' : ` · ${arte.proveedor}`}
                  {arte.fotos.length > 1 ? ` · ${String(arte.fotos.length)} fotos` : ''}
                </p>
              </div>

              {indice === 0 ? (
                <span
                  className="flex shrink-0 items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[11px] font-semibold text-primary-foreground"
                  data-testid={`arte-principal-${arte.id}`}
                >
                  <StarIcon className="size-3 fill-current" aria-hidden />
                  Principal
                </span>
              ) : puedeAdministrar ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-[11px]"
                  onClick={() => marcar(arte)}
                  disabled={ocupado}
                  aria-label={`Marcar ${arte.descripcion} como arte principal`}
                  data-testid={`marcar-principal-arte-${arte.id}`}
                >
                  {marcarPrincipal.isPending ? (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  ) : (
                    <StarIcon aria-hidden />
                  )}
                  Marcar como principal
                </Button>
              ) : null}

              {puedeAdministrar ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => abrirEdicion(arte)}
                    disabled={ocupado}
                    aria-label={`Editar ${arte.descripcion}`}
                    data-testid={`editar-arte-${arte.id}`}
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive"
                    onClick={() => quitar(arte)}
                    disabled={ocupado}
                    aria-label={`Quitar ${arte.descripcion} del modelo`}
                    data-testid={`quitar-arte-${arte.id}`}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        El precio del arte es el que viaja a la orden de producción.
      </p>

      <DialogoArte
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        idModelo={idModelo}
        {...(enEdicion === undefined ? {} : { arte: enEdicion })}
      />
      <CopiarArteDialogo
        abierto={copiarAbierto}
        alCambiarAbierto={setCopiarAbierto}
        idModelo={idModelo}
      />
    </div>
  );
}
