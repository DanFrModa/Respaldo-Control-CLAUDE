import { Search } from 'lucide-react';
import { useState } from 'react';

import { useOrdenes } from '@/api/ordenes';
import type { Orden } from '@/api/tipos';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE ORDEN reutilizable (F3-E2): busca órdenes COMPLETAS (con matriz) por folio, modelo,
 * cliente o referencia, y al elegir una emite su id. Lo usan las pantallas de corte y envío para
 * fijar la orden sobre la que se captura. Presentación pura (A1): solo consulta y emite.
 */
export function SelectorOrden({
  idSeleccionada,
  alSeleccionar,
  testid = 'selector-orden',
}: {
  idSeleccionada: number | undefined;
  alSeleccionar: (orden: Orden) => void;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useOrdenes({
    pagina: 1,
    porPagina: 8,
    estado: 'completa',
    ordenarPor: 'folio',
    direccion: 'desc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const ordenes = consulta.data?.datos ?? [];

  return (
    <div className="space-y-2" data-testid={testid}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Buscar orden por folio, modelo, cliente o referencia…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar orden"
          data-testid={`${testid}-busqueda`}
        />
      </div>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : null}

      <ul className="divide-y rounded-md border">
        {ordenes.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">
            {consulta.isPending ? 'Buscando…' : 'No hay órdenes completas que coincidan.'}
          </li>
        ) : (
          ordenes.map((orden) => (
            <li key={orden.id}>
              <button
                type="button"
                onClick={() => alSeleccionar(orden)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                  idSeleccionada === orden.id ? 'bg-sidebar-accent/40 font-medium' : ''
                }`}
                data-testid={`${testid}-opcion`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">Orden #{orden.folio}</span>
                  <span className="text-xs text-muted-foreground">
                    {orden.codigoModelo} · {orden.cliente} · {orden.totalPiezas} pzas
                  </span>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
