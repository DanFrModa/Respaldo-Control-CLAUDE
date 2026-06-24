import { Search } from 'lucide-react';
import { useState } from 'react';

import { useModelos, type Modelo } from '@/api/modelos';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE MODELO reutilizable (F3-E3): busca modelos por código o descripción y al elegir uno
 * emite el modelo completo. Lo usan las pantallas de movimientos, traspasos y kardex para fijar el
 * modelo sobre el que se opera. Presentación pura (A1): solo consulta y emite.
 */
export function SelectorModelo({
  idSeleccionado,
  alSeleccionar,
  testid = 'selector-modelo',
}: {
  idSeleccionado: number | undefined;
  alSeleccionar: (modelo: Modelo) => void;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useModelos({
    pagina: 1,
    porPagina: 8,
    ordenarPor: 'codigo',
    direccion: 'asc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const modelos = consulta.data?.datos ?? [];

  return (
    <div className="space-y-2" data-testid={testid}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Buscar modelo por código o descripción…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar modelo"
          data-testid={`${testid}-busqueda`}
        />
      </div>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : null}

      <ul className="divide-y rounded-md border">
        {modelos.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">
            {consulta.isPending ? 'Buscando…' : 'No hay modelos que coincidan.'}
          </li>
        ) : (
          modelos.map((modelo) => (
            <li key={modelo.id}>
              <button
                type="button"
                onClick={() => alSeleccionar(modelo)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                  idSeleccionado === modelo.id ? 'bg-sidebar-accent/40 font-medium' : ''
                }`}
                data-testid={`${testid}-opcion`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{modelo.codigo}</span>
                  {modelo.descripcion !== null ? (
                    <span className="text-xs text-muted-foreground">{modelo.descripcion}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
