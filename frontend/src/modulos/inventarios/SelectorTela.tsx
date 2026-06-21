import { Search } from 'lucide-react';
import { useState } from 'react';

import { useTelas, type Tela } from '@/api/telas';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE TELA reutilizable (F4-E1): busca telas por nombre y al elegir una emite la tela
 * completa. Lo usan el kardex de telas y las capturas (salida a orden, traspaso, ajuste).
 * Presentación pura (A1): solo consulta y emite.
 */
export function SelectorTela({
  idSeleccionado,
  alSeleccionar,
  testid = 'selector-tela',
}: {
  idSeleccionado: number | undefined;
  alSeleccionar: (tela: Tela) => void;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useTelas({
    pagina: 1,
    porPagina: 8,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const telas = consulta.data?.datos ?? [];

  return (
    <div className="space-y-2" data-testid={testid}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Buscar tela por nombre…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar tela"
          data-testid={`${testid}-busqueda`}
        />
      </div>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : null}

      <ul className="divide-y rounded-md border">
        {telas.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">
            {consulta.isPending ? 'Buscando…' : 'No hay telas que coincidan.'}
          </li>
        ) : (
          telas.map((tela) => (
            <li key={tela.id}>
              <button
                type="button"
                onClick={() => alSeleccionar(tela)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                  idSeleccionado === tela.id ? 'bg-sidebar-accent/40 font-medium' : ''
                }`}
                data-testid={`${testid}-opcion`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{tela.nombre}</span>
                  {tela.descripcion !== null ? (
                    <span className="text-xs text-muted-foreground">{tela.descripcion}</span>
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
