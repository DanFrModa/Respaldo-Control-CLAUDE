import { useState } from 'react';
import { toast } from 'sonner';

import { useEstadosLista } from '@/api/estados-lista';
import type { ListaDetalle } from '@/api/listas-precios';
import { useCambiarEstadoLista } from '@/api/negociacion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';

/** Estados activos ordenados por su `orden` (para el selector). */
const QUERY_ESTADOS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'orden',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/**
 * Control de CAMBIO DE ESTADO de una lista (F8-E5), con permiso `listas.negociar`. Permite mover la
 * lista a cualquier estado activo — incluida la REAPERTURA de una lista cerrada (queda auditado en el
 * backend). El backend re-verifica el permiso (A1).
 */
export function SelectorEstadoLista({ lista }: { lista: ListaDetalle }): React.JSX.Element {
  const estados = useEstadosLista(QUERY_ESTADOS);
  const cambiar = useCambiarEstadoLista();
  const [idDestino, setIdDestino] = useState('');

  const opciones = (estados.data?.datos ?? []).filter((e) => e.activo);
  const destino = opciones.find((e) => String(e.id) === idDestino);

  function confirmar(): void {
    if (idDestino === '' || Number(idDestino) === lista.idEstadoLista) {
      toast.error('Elige un estado distinto al actual.');
      return;
    }
    cambiar.mutate(
      { id: lista.id, cuerpo: { idEstadoLista: Number(idDestino) } },
      {
        onSuccess: (actualizada) => {
          toast.success(`Estado cambiado a "${actualizada.nombreEstado}".`);
          setIdDestino('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="selector-estado-lista">
      {/* ⭐ V1-E8x: se dice «de la LISTA». Desde esta versión cada MODELO tiene su propio estado
          en la tabla de abajo, y tres de los cuatro nombres se parecen (uno, «En negociación», es
          idéntico): sin el rótulo, este control parecería mover el renglón seleccionado. */}
      <span className="text-sm text-muted-foreground">Estado de la lista:</span>
      <Badge variant="outline">{lista.nombreEstado}</Badge>
      <SelectNativo
        aria-label="Nuevo estado de la lista"
        className="w-auto"
        value={idDestino}
        onChange={(e) => setIdDestino(e.target.value)}
        data-testid="nuevo-estado-lista"
      >
        <option value="">Cambiar a…</option>
        {opciones
          .filter((e) => e.id !== lista.idEstadoLista)
          .map((e) => (
            <option key={e.id} value={String(e.id)}>
              {e.nombre}
              {e.esCierre ? ' (cierre)' : ''}
            </option>
          ))}
      </SelectNativo>
      <Button
        type="button"
        size="sm"
        onClick={confirmar}
        disabled={cambiar.isPending || idDestino === ''}
        data-testid="confirmar-estado-lista"
      >
        {destino?.esCierre ? 'Cerrar lista' : 'Cambiar estado'}
      </Button>
    </div>
  );
}
