import { Search } from 'lucide-react';
import { useState } from 'react';

import { useAvios, type Avio } from '@/api/avios';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE AVÍO reutilizable (F4-E1): busca avíos por clave/descripción y al elegir uno emite el
 * avío completo. Distingue los GENÉRICOS de stock (R4) con un badge. Lo usan el kardex de avíos y el
 * ajuste/traspaso de avíos. Presentación pura (A1).
 */
export function SelectorAvio({
  idSeleccionado,
  alSeleccionar,
  testid = 'selector-avio',
}: {
  idSeleccionado: number | undefined;
  alSeleccionar: (avio: Avio) => void;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useAvios({
    pagina: 1,
    porPagina: 8,
    ordenarPor: 'clave',
    direccion: 'asc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const avios = consulta.data?.datos ?? [];

  return (
    <div className="space-y-2" data-testid={testid}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Buscar avío por clave o descripción…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar avío"
          data-testid={`${testid}-busqueda`}
        />
      </div>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : null}

      <ul className="divide-y rounded-md border">
        {avios.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">
            {consulta.isPending ? 'Buscando…' : 'No hay avíos que coincidan.'}
          </li>
        ) : (
          avios.map((avio) => (
            <li key={avio.id}>
              <button
                type="button"
                onClick={() => alSeleccionar(avio)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                  idSeleccionado === avio.id ? 'bg-sidebar-accent/40 font-medium' : ''
                }`}
                data-testid={`${testid}-opcion`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{avio.clave}</span>
                  <span className="text-xs text-muted-foreground">{avio.descripcion}</span>
                </span>
                {avio.esGenerico ? (
                  <Badge variant="secondary" className="shrink-0">
                    Genérico
                  </Badge>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
