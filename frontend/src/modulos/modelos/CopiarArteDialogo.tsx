import { Loader2Icon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useCopiarArte, useGaleriaArte, type GaleriaArteItem } from '@/api/artes';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';

/** Cuántos resultados se ofrecen a la vez (se afina con la búsqueda, no con paginación). */
const POR_PAGINA = 20;

/**
 * «Copiar arte de otro modelo» (V1-E3d, §Post-F9.35 punto 2).
 *
 * Al sacar el arte del catálogo se perdería la comodidad de reusar uno que ya existe; este diálogo
 * la devuelve SIN reinventar el catálogo: se busca entre el arte de TODOS los modelos (por nombre
 * del arte o por clave/nombre del modelo), se elige uno y el backend crea una COPIA propia de este
 * modelo —con su precio, su proveedor y su foto— lista para ajustarla.
 *
 * El arte del PROPIO modelo no se ofrece (sería un duplicado sin sentido; el backend también lo
 * rechaza).
 */
export function CopiarArteDialogo({
  abierto,
  alCambiarAbierto,
  idModelo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idModelo: number;
}): React.JSX.Element {
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const copiar = useCopiarArte();

  const consulta = useGaleriaArte({
    pagina: 1,
    porPagina: POR_PAGINA,
    ordenarPor: 'descripcion',
    direccion: 'asc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  // El arte de ESTE modelo no se puede copiar a sí mismo.
  const candidatos = (consulta.data?.datos ?? []).filter((a) => a.idModelo !== idModelo);

  function alElegir(item: GaleriaArteItem): void {
    copiar.mutate(
      { idModelo, cuerpo: { idArteOrigen: item.id } },
      {
        onSuccess: () => {
          toast.success(`Arte "${item.descripcion}" copiado a este modelo.`);
          alCambiarAbierto(false);
          setTextoBusqueda('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        data-testid="dialogo-copiar-arte"
      >
        <DialogHeader>
          <DialogTitle>Copiar arte de otro modelo</DialogTitle>
          <DialogDescription>
            Trae el arte ya lleno (precio, proveedor y sus fotos) como una copia de este modelo,
            para ajustarla.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar por arte o por modelo…"
            className="pl-8"
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            aria-label="Buscar arte de otro modelo"
            data-testid="buscar-arte-copiar"
          />
        </div>

        {consulta.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        ) : consulta.isError ? (
          <p className="py-6 text-center text-sm text-destructive">{consulta.error.message}</p>
        ) : candidatos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay arte de otros modelos que coincida.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="lista-arte-copiar">
            {candidatos.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-lg border p-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  onClick={() => alElegir(item)}
                  disabled={copiar.isPending}
                  data-testid={`copiar-arte-${item.id}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {item.descripcion}
                      {item.posicion === null ? '' : ` · ${item.posicion}`}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.claveModelo}
                      {item.nombreModelo === null ? '' : ` · ${item.nombreModelo}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.precio === null ? 'sin precio' : `$${item.precio.toFixed(2)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={copiar.isPending}
          >
            {copiar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
