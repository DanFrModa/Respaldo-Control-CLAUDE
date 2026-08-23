import { ImageIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useModelos, type Modelo, type ModelosQuery } from '@/api/modelos';
import { useTemporadas } from '@/api/temporadas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';

/** Renglones por página de la galería (rejilla; volumen ~4,987: SIEMPRE modo servidor). */
const POR_PAGINA = 24;

/** Valor del filtro de temporada que significa "todas" (sin filtrar). */
const TEMPORADA_TODAS = 'TODAS';

/** Valor del filtro de estado: activos (default), inactivos o todos. */
type FiltroEstado = 'ACTIVOS' | 'INACTIVOS' | 'TODOS';

/**
 * Galería visual de fotos de modelos (rediseño "Teal fresco"), pensada MÓVIL-PRIMERO: una
 * rejilla de tarjetas paginada EN SERVIDOR con búsqueda (debounce, por código/descripción),
 * filtro por temporada y por estado (activo/inactivo). Cada tarjeta muestra la FOTO PRINCIPAL
 * del modelo (la trae el listado en `urlFotoPrincipal`, sin una petición por celda — sin N+1)
 * o el placeholder NoFoto, y el código/descripción; al tocarla abre la ficha del modelo
 * (pantalla de Modelos). Replica la consulta `ModelosFotos` del sistema viejo para enseñar
 * producto fuera de la oficina.
 *
 * Solo lectura: `modelos.ver` gobierna el acceso (mismo permiso que el CRUD); el alta/edición
 * vive en la pantalla principal. La decisión real de acceso la toma el backend en cada ruta (A1).
 */
export function GaleriaModelos(): React.JSX.Element {
  const navigate = useNavigate();

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [temporadaFiltro, setTemporadaFiltro] = useState<string>(TEMPORADA_TODAS);
  const [estadoFiltro, setEstadoFiltro] = useState<FiltroEstado>('ACTIVOS');
  // Mismo default que el catálogo (§Post-F9.34 punto 2): la galería es de PRODUCCIÓN salvo que se
  // pida ver desarrollo. Sin esto, las muestras que nunca salieron llenarían la vitrina.
  const [origen, setOrigen] = useState<'produccion' | 'desarrollo' | 'todos'>('produccion');
  const [pagina, setPagina] = useState(1);

  const query: ModelosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'codigo',
    direccion: 'asc',
    origen,
    incluirInactivos: estadoFiltro === 'ACTIVOS' ? 'false' : 'true',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(temporadaFiltro !== TEMPORADA_TODAS ? { idTemporada: Number(temporadaFiltro) } : {}),
  };

  const consulta = useModelos(query);
  const temporadas = useTemporadas({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });

  const datos = consulta.data;
  const totalPaginas = datos?.totalPaginas ?? 0;

  // "Solo inactivos" se filtra en cliente (el backend solo distingue incluir/excluir inactivos);
  // mantiene el dataset paginado de servidor y solo refina la página visible.
  const visibles = (datos?.datos ?? []).filter((m) =>
    estadoFiltro === 'INACTIVOS' ? !m.activo : true,
  );

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarTemporada(valor: string): void {
    setTemporadaFiltro(valor);
    setPagina(1);
  }

  function alCambiarEstado(valor: string): void {
    setEstadoFiltro(valor as FiltroEstado);
    setPagina(1);
  }

  /** Abre la ficha del modelo en la pantalla principal (lleva el id en el estado de navegación). */
  function abrirFicha(modelo: Modelo): void {
    // navigate() es asíncrono en React Router 7; no necesitamos esperarlo.
    void navigate('/modelos', { state: { idModelo: modelo.id } });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3 border-b p-4 lg:px-6">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Galería de modelos
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Vista visual de los modelos con su foto, para enseñar producto.
          </p>
        </div>
      </div>

      {/* Controles: búsqueda + filtro por temporada + estado (móvil: apilados) */}
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar por código o nombre…"
            className="pl-8"
            value={textoBusqueda}
            onChange={(e) => alBuscar(e.target.value)}
            aria-label="Buscar modelos por código o nombre"
            data-testid="buscar-galeria-modelo"
          />
        </div>
        <SelectNativo
          value={temporadaFiltro}
          onChange={(e) => alCambiarTemporada(e.target.value)}
          aria-label="Filtrar modelos por temporada"
          data-testid="filtro-temporada-galeria-modelo"
          className="sm:w-48"
        >
          <option value={TEMPORADA_TODAS}>Todas las temporadas</option>
          {(temporadas.data?.datos ?? []).map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.nombre}
            </option>
          ))}
        </SelectNativo>
        <SelectNativo
          value={origen}
          onChange={(e) => {
            setOrigen(e.target.value as 'produccion' | 'desarrollo' | 'todos');
            setPagina(1);
          }}
          aria-label="Filtrar modelos por origen"
          data-testid="filtro-origen-galeria-modelo"
          className="sm:w-44"
        >
          <option value="produccion">Producción</option>
          <option value="desarrollo">Desarrollo</option>
          <option value="todos">Todos</option>
        </SelectNativo>
        <SelectNativo
          value={estadoFiltro}
          onChange={(e) => alCambiarEstado(e.target.value)}
          aria-label="Filtrar modelos por estado"
          data-testid="filtro-estado-galeria-modelo"
          className="sm:w-40"
        >
          <option value="ACTIVOS">Activos</option>
          <option value="INACTIVOS">Descontinuados</option>
          <option value="TODOS">Todos</option>
        </SelectNativo>
      </div>

      {/* Rejilla (móvil: 2 columnas; escala en pantallas grandes) */}
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
        ) : visibles.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            No hay modelos que coincidan con la búsqueda.
          </p>
        ) : (
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
            data-testid="galeria-modelos-grid"
          >
            {visibles.map((modelo) => (
              <li key={modelo.id}>
                <button
                  type="button"
                  onClick={() => abrirFicha(modelo)}
                  className="group flex w-full flex-col items-center gap-2 rounded-xl border bg-card p-2 text-center transition-all hover:ring-2 hover:ring-primary/40 hover:shadow-sm"
                  data-testid="celda-galeria-modelo"
                >
                  <MiniaturaModelo url={modelo.urlFotoPrincipal} codigo={modelo.codigo} />
                  <span className="line-clamp-1 w-full text-xs font-semibold" title={modelo.codigo}>
                    {modelo.codigo}
                  </span>
                  {modelo.descripcion !== null && modelo.descripcion.trim() !== '' ? (
                    <span
                      className="line-clamp-2 w-full text-[11px] text-muted-foreground"
                      title={modelo.descripcion}
                    >
                      {modelo.descripcion}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Paginación (servidor) */}
      {datos && datos.total > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t p-3 text-xs">
          <span className="text-muted-foreground" data-testid="resumen-galeria-modelo">
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

/**
 * Miniatura de SOLO LECTURA de la foto principal de un modelo: muestra la imagen si el listado
 * trajo su URL (`urlFotoPrincipal`), o el placeholder NoFoto si el modelo no tiene fotos. NO
 * hace una petición propia (la URL viene del listado: sin N+1).
 */
function MiniaturaModelo({
  url,
  codigo,
}: {
  url: string | null;
  codigo: string;
}): React.JSX.Element {
  if (url !== null) {
    return (
      <img
        src={url}
        alt={`Foto de ${codigo}`}
        className="aspect-square w-full shrink-0 rounded-xl border object-cover"
        data-testid="miniatura-modelo-foto"
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex aspect-square w-full shrink-0 items-center justify-center rounded-xl border bg-muted text-muted-foreground"
      data-testid="miniatura-modelo-sin-foto"
    >
      <ImageIcon className="size-10" aria-hidden />
    </span>
  );
}

/** Rejilla de carga (skeleton) mientras llega la primera página. */
function GaleriaEsqueleto(): React.JSX.Element {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <li key={i} className="flex flex-col items-center gap-2 rounded-xl border p-2">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <Skeleton className="h-3 w-3/4" />
        </li>
      ))}
    </ul>
  );
}
