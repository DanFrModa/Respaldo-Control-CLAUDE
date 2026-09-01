import { Loader2Icon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAgregarComentario } from '@/api/ordenes';
import type { Orden } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { formatearFechaHora, nombreDeAutor } from '@/lib/formato';

/**
 * Panel de COMENTARIOS de una orden (F2-E3): lista cronológica (usuario + fecha + texto) y una caja
 * para agregar uno. Los comentarios son INMUTABLES (no se editan ni se borran). Se puede agregar si
 * hay `ordenes.administrar` y la orden no está cancelada; el backend re-valida (A1).
 */
export function PanelComentarios({
  orden,
  puedeAdministrar,
}: {
  orden: Orden;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const agregar = useAgregarComentario();
  const [texto, setTexto] = useState('');
  const puedeComentar = puedeAdministrar && orden.estado !== 'cancelada';

  function enviar(): void {
    const limpio = texto.trim();
    if (limpio.length === 0) {
      return;
    }
    agregar.mutate(
      { id: orden.id, cuerpo: { comentario: limpio } },
      {
        onSuccess: () => {
          toast.success('Comentario agregado.');
          setTexto('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-4">
      {orden.comentarios.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esta orden no tiene comentarios.</p>
      ) : (
        <ul className="space-y-2" data-testid="lista-comentarios">
          {orden.comentarios.map((comentario) => (
            <li key={comentario.id} className="rounded-lg border p-3" data-testid="comentario">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                {/* El NOMBRE de quien lo escribió, no su id (V1). El renglón se ve siempre:
                    dar de baja a alguien no borra su comentario (D3). */}
                <span data-testid="autor-comentario">
                  {nombreDeAutor(comentario.idUsuario, comentario.nombreUsuario) ?? 'Sistema'}
                </span>
                <span>{formatearFechaHora(comentario.fecha)}</span>
              </div>
              <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                {comentario.comentario}
              </p>
            </li>
          ))}
        </ul>
      )}

      {puedeComentar ? (
        <div className="space-y-2">
          <textarea
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe un comentario…"
            aria-label="Nuevo comentario"
            className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
            data-testid="nuevo-comentario"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={enviar}
              disabled={agregar.isPending || texto.trim().length === 0}
              data-testid="agregar-comentario"
            >
              {agregar.isPending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <SendIcon aria-hidden />
              )}
              Agregar comentario
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
