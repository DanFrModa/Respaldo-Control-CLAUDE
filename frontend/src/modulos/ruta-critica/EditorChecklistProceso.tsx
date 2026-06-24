import { Loader2Icon, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useFijarChecklistProcesoRc } from '@/api/ruta-critica';
import type { ProcesoRc } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Un ítem en edición local (id presente = ítem existente que se conserva). */
interface ItemLocal {
  id?: number;
  descripcion: string;
}

/**
 * Editor del CHECKLIST configurable de un proceso de la RC. El set se guarda COMPLETO con
 * `PUT .../{id}/checklist`: los ítems con `id` se conservan/actualizan, los nuevos se crean y los
 * quitados los desactiva el backend (borrado suave). El `orden` lo da la posición en la lista.
 */
export function EditorChecklistProceso({
  proceso,
  puedeAdministrar,
}: {
  proceso: ProcesoRc;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const fijar = useFijarChecklistProcesoRc();
  const [items, setItems] = useState<ItemLocal[]>(() =>
    proceso.checklist.map((c) => ({ id: c.id, descripcion: c.descripcion })),
  );

  useEffect(() => {
    setItems(proceso.checklist.map((c) => ({ id: c.id, descripcion: c.descripcion })));
  }, [proceso.id, proceso.checklist]);

  function cambiar(indice: number, descripcion: string): void {
    setItems((actual) => actual.map((it, i) => (i === indice ? { ...it, descripcion } : it)));
  }

  function quitar(indice: number): void {
    setItems((actual) => actual.filter((_, i) => i !== indice));
  }

  function agregar(): void {
    setItems((actual) => [...actual, { descripcion: '' }]);
  }

  function guardar(): void {
    const limpios = items
      .map((it) => ({ ...it, descripcion: it.descripcion.trim() }))
      .filter((it) => it.descripcion.length > 0);
    fijar.mutate(
      { id: proceso.id, cuerpo: { items: limpios } },
      {
        onSuccess: () => toast.success('Checklist actualizado.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (!puedeAdministrar) {
    // Solo lectura: la lista activa ya viene en el detalle; aquí solo se confirma si está vacía.
    return items.length === 0 ? (
      <p className="text-sm text-muted-foreground">Este proceso no tiene checklist.</p>
    ) : (
      <ol className="list-decimal pl-5 text-sm" data-testid="checklist-proceso-lectura">
        {items.map((it, i) => (
          <li key={it.id ?? `n-${String(i)}`}>{it.descripcion}</li>
        ))}
      </ol>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="editor-checklist-proceso">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay ítems. Agrega el primero.</p>
      ) : (
        items.map((it, indice) => (
          <div key={it.id ?? `nuevo-${String(indice)}`} className="flex items-center gap-2">
            <span className="w-5 text-right text-sm text-muted-foreground">{indice + 1}.</span>
            <Input
              value={it.descripcion}
              placeholder="Punto a verificar…"
              disabled={fijar.isPending}
              onChange={(e) => cambiar(indice, e.target.value)}
              data-testid={`checklist-item-${String(indice)}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Quitar ítem"
              disabled={fijar.isPending}
              onClick={() => quitar(indice)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={agregar}
          disabled={fijar.isPending}
          data-testid="agregar-item-checklist"
        >
          <Plus className="size-4" aria-hidden /> Agregar ítem
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={guardar}
          disabled={fijar.isPending}
          data-testid="guardar-checklist-proceso"
        >
          {fijar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          Guardar checklist
        </Button>
      </div>
    </div>
  );
}
