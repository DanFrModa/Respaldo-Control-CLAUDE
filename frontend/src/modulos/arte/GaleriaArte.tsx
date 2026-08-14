import { SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useGaleriaArte, type GaleriaArteItem, type GaleriaArteQuery } from '@/api/artes';
import { ETIQUETAS_TIPO_ARTE, TIPOS_ARTE, type TipoArteClave } from '@/modulos/arte/esquemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';

import { MiniaturaArte } from './MiniaturaArte';

/** Renglones por página de la galería (grid). */
const POR_PAGINA = 24;

/** Valor del filtro de tipo que significa "todos" (sin filtrar). */
const TIPO_TODOS = 'TODOS';

/**
 * Galería visual del ARTE, armada DESDE los modelos (V1-E3d, §Post-F9.35 punto 4).
 *
 * La galería SOBREVIVIÓ al retiro del catálogo de arte: sigue sirviendo para buscar visualmente
 * *"ese bordado que hicimos"*, pero ahora cada foto dice **de qué modelo** es y al tocarla lleva a
 * ese modelo. Rejilla paginada EN SERVIDOR con búsqueda (debounce, por nombre del arte o por
 * clave/nombre del modelo) y filtro por tipo.
 *
 * `modelos.ver` gobierna el acceso. La decisión real la toma el backend en cada ruta (A1).
 */
export function GaleriaArte(): React.JSX.Element {
  const navigate = useNavigate();

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [tipoFiltro, setTipoFiltro] = useState<TipoArteClave | typeof TIPO_TODOS>(TIPO_TODOS);
  const [pagina, setPagina] = useState(1);

  const query: GaleriaArteQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(tipoFiltro !== TIPO_TODOS ? { tipo: tipoFiltro } : {}),
  };

  const consulta = useGaleriaArte(query);
  const datos = consulta.data;
  const totalPaginas = datos?.totalPaginas ?? 0;

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarTipo(valor: string): void {
    setTipoFiltro(valor as TipoArteClave | typeof TIPO_TODOS);
    setPagina(1);
  }

  /** Abre el MODELO dueño del arte (ahí se edita: el arte ya no tiene pantalla propia). */
  function abrirModelo(item: GaleriaArteItem): void {
    // navigate() es asíncrono en React Router 7; no necesitamos esperarlo.
    void navigate('/modelos', { state: { idModelo: item.idModelo } });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3 border-b p-4 lg:px-6">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Galería de arte
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Vista visual del arte (bordado y estampado) con el modelo al que pertenece.
          </p>
        </div>
      </div>

      {/* Controles: búsqueda + filtro por tipo */}
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar por arte o por modelo…"
            className="pl-8"
            value={textoBusqueda}
            onChange={(e) => alBuscar(e.target.value)}
            aria-label="Buscar arte por nombre o por modelo"
            data-testid="buscar-galeria"
          />
        </div>
        <SelectNativo
          value={tipoFiltro}
          onChange={(e) => alCambiarTipo(e.target.value)}
          aria-label="Filtrar arte por tipo"
          data-testid="filtro-tipo-galeria"
          className="sm:w-56"
        >
          <option value={TIPO_TODOS}>Todos los tipos</option>
          {TIPOS_ARTE.map((tipo) => (
            <option key={tipo} value={tipo}>
              {ETIQUETAS_TIPO_ARTE[tipo]}
            </option>
          ))}
        </SelectNativo>
      </div>

      {/* Rejilla */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {consulta.isPending ? (
          <GaleriaEsqueleto />
        ) : consulta.isError ? (
          <div className="px-2 py-10 text-center">
            <p className="text-sm font-medium text-destructive">{consulta.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void consulta.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : (datos?.datos ?? []).length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            No hay arte que coincida con la búsqueda.
          </p>
        ) : (
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
            data-testid="galeria-grid"
          >
            {(datos?.datos ?? []).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => abrirModelo(item)}
                  className="group flex w-full flex-col items-center gap-2 rounded-xl border bg-card p-2 text-center transition-all hover:ring-2 hover:ring-primary/40 hover:shadow-sm"
                  data-testid="celda-galeria"
                >
                  <MiniaturaArte
                    idModelo={item.idModelo}
                    idArte={item.id}
                    nombre={item.nombre}
                    tieneFoto={item.idArchivoFoto !== null}
                    tamano="grande"
                  />
                  <span className="line-clamp-2 w-full text-xs font-medium" title={item.nombre}>
                    {item.nombre}
                  </span>
                  {/* De qué MODELO es (§Post-F9.35: "cada foto dice de qué modelo es"). */}
                  <span
                    className="line-clamp-1 w-full text-[11px] text-muted-foreground"
                    title={item.nombreModelo ?? item.claveModelo}
                    data-testid="celda-galeria-modelo"
                  >
                    {item.claveModelo}
                    {item.nombreModelo === null ? '' : ` · ${item.nombreModelo}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Paginación (servidor) */}
      {datos && datos.total > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t p-3 text-xs">
          <span className="text-muted-foreground" data-testid="resumen-galeria">
            {datos.total} · pág. {datos.pagina}/{totalPaginas}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={datos.pagina <= 1 || consulta.isFetching}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={datos.pagina >= totalPaginas || consulta.isFetching}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Rejilla de carga (skeleton) mientras llega la primera página. */
function GaleriaEsqueleto(): React.JSX.Element {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <li key={i} className="flex flex-col items-center gap-2 rounded-xl border p-2">
          <Skeleton className="size-40 rounded-xl" />
          <Skeleton className="h-3 w-3/4" />
        </li>
      ))}
    </ul>
  );
}
