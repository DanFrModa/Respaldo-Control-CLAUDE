import { Loader2, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useBuscarOrdenes } from '@/api/ordenes-consulta';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * BUSCADOR GLOBAL de órdenes para el layout (F2-E4): una barra en el encabezado que busca por
 * folio, código de modelo, cliente o CUALQUIER valor de referencia (D7). Al elegir un hit, navega
 * al detalle de la orden (módulo Órdenes de captura). Solo visible con `ordenes.ver` (A4); el
 * backend decide en última instancia. Sin lógica de negocio: solo presenta los hits del servidor.
 *
 * UX: panel de sugerencias bajo el input, navegación con teclado (↑/↓/Enter/Esc), cierre al hacer
 * clic fuera. Búsqueda con debounce; el backend tope a 20 hits.
 */
export function BuscadorGlobal(): React.JSX.Element | null {
  const { tienePermiso } = useSesion();
  const navigate = useNavigate();
  const contenedorRef = useRef<HTMLDivElement>(null);
  const idLista = useId();

  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const consultaTexto = useDebounce(texto.trim(), 250);

  const consulta = useBuscarOrdenes(consultaTexto);
  const hits = consulta.data?.datos ?? [];
  // `activo` puede quedar fuera de rango cuando la lista de hits encoge (entre un onChange y el
  // siguiente). Se clampea AL USARLO para no resaltar/seleccionar un índice inexistente.
  const activoSeguro = hits.length === 0 ? 0 : Math.min(activo, hits.length - 1);

  // Cierra el panel al hacer clic fuera del buscador.
  useEffect(() => {
    function alClicFuera(evento: MouseEvent): void {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', alClicFuera);
    return () => document.removeEventListener('mousedown', alClicFuera);
  }, []);

  // El buscador solo aparece para quien puede ver órdenes (A4; el servidor reverifica).
  if (!tienePermiso('ordenes.ver')) {
    return null;
  }

  function irAOrden(id: number): void {
    setAbierto(false);
    setTexto('');
    void navigate('/produccion/ordenes', { state: { idOrden: id } });
  }

  function alTeclado(evento: React.KeyboardEvent<HTMLInputElement>): void {
    if (hits.length === 0) {
      if (evento.key === 'Escape') setAbierto(false);
      return;
    }
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setActivo((i) => (i + 1) % hits.length);
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setActivo((i) => (i - 1 + hits.length) % hits.length);
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      const hit = hits[activoSeguro];
      if (hit) irAOrden(hit.id);
    } else if (evento.key === 'Escape') {
      setAbierto(false);
    }
  }

  const mostrarPanel = abierto && consultaTexto.length > 0;

  return (
    <div ref={contenedorRef} className="relative hidden w-full max-w-xs sm:block" role="search">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
          setActivo(0);
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={alTeclado}
        placeholder="Buscar orden (folio, modelo, cliente…)"
        className="pl-8"
        aria-label="Buscar órdenes"
        aria-expanded={mostrarPanel}
        aria-controls={idLista}
        autoComplete="off"
        data-testid="buscador-global"
      />
      {consulta.isFetching && consultaTexto.length > 0 ? (
        <Loader2
          className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
        />
      ) : null}

      {mostrarPanel ? (
        <div
          id={idLista}
          role="listbox"
          className="absolute top-full left-0 z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
          data-testid="buscador-resultados"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {consulta.isFetching ? 'Buscando…' : 'Sin coincidencias.'}
            </p>
          ) : (
            hits.map((hit, indice) => (
              <button
                key={hit.id}
                type="button"
                role="option"
                aria-selected={indice === activoSeguro}
                onMouseEnter={() => setActivo(indice)}
                onClick={() => irAOrden(hit.id)}
                data-testid="buscador-hit"
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm',
                  indice === activoSeguro
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/60',
                )}
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">#{hit.folio}</span>
                  <span className="text-muted-foreground"> · {hit.codigoModelo}</span>
                </span>
                <span className="shrink-0 truncate text-xs text-muted-foreground">
                  {hit.cliente}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
