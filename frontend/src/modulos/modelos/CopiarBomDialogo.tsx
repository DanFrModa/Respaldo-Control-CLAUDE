import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useCopiarBom, useModelos } from '@/api/modelos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';

/**
 * Diálogo "Copiar receta de…" (F1-E4): elige un modelo de ORIGEN (buscador por código/
 * descripción) y copia su BOM completo al modelo de destino. `reemplazar` decide si reemplaza
 * la receta actual (por defecto) o la fusiona conservando lo existente. La operación es atómica
 * en el backend (todo o nada, A2); el destino se excluye de la lista de orígenes.
 */
export function CopiarBomDialogo({
  abierto,
  alCambiarAbierto,
  idDestino,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idDestino: number;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const [idOrigen, setIdOrigen] = useState('');
  const [reemplazar, setReemplazar] = useState(true);

  const consulta = useModelos({
    pagina: 1,
    porPagina: 20,
    ordenarPor: 'codigo',
    direccion: 'asc',
    incluirInactivos: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });
  const copiar = useCopiarBom();

  // Candidatos a origen (excluye el propio destino).
  const candidatos = (consulta.data?.datos ?? []).filter((m) => m.id !== idDestino);

  function enviar(): void {
    const origen = Number(idOrigen);
    if (!Number.isFinite(origen) || origen <= 0) {
      toast.error('Elige un modelo de origen.');
      return;
    }
    copiar.mutate(
      { id: idDestino, cuerpo: { idOrigen: origen, reemplazar } },
      {
        onSuccess: () => {
          toast.success('Receta copiada.');
          alCambiarAbierto(false);
          setIdOrigen('');
          setTexto('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copiar receta de otro modelo</DialogTitle>
          <DialogDescription>
            Copia la receta (telas, avíos y arte) de otro modelo a éste.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field>
            <FieldLabel htmlFor="copiar-bom-buscar">Buscar modelo de origen</FieldLabel>
            <Input
              id="copiar-bom-buscar"
              type="search"
              placeholder="Código o descripción…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              data-testid="copiar-bom-buscar"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="copiar-bom-origen">Modelo de origen</FieldLabel>
            <SelectNativo
              id="copiar-bom-origen"
              value={idOrigen}
              onChange={(e) => setIdOrigen(e.target.value)}
              disabled={consulta.isPending || candidatos.length === 0}
              data-testid="copiar-bom-origen"
            >
              <option value="">
                {consulta.isPending
                  ? 'Cargando…'
                  : candidatos.length === 0
                    ? 'Sin resultados'
                    : 'Elige un modelo…'}
              </option>
              {candidatos.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.codigo}
                  {m.descripcion ? ` — ${m.descripcion}` : ''}
                </option>
              ))}
            </SelectNativo>
            <FieldDescription>Se excluye este mismo modelo de la lista.</FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <input
              id="copiar-bom-reemplazar"
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={reemplazar}
              onChange={(e) => setReemplazar(e.target.checked)}
              data-testid="copiar-bom-reemplazar"
            />
            <FieldLabel htmlFor="copiar-bom-reemplazar" className="font-normal">
              Reemplazar la receta actual (si se desmarca, se fusiona)
            </FieldLabel>
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={copiar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={enviar}
            disabled={copiar.isPending || idOrigen === ''}
            data-testid="confirmar-copiar-bom"
          >
            {copiar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Copiar receta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
