import { GitBranch, Loader2Icon, Route } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useFijarDependenciasProcesoRc, useProcesosRc } from '@/api/ruta-critica';
import type { ProcesoRc } from '@/api/tipos';
import { TipoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSesion } from '@/sesion/useSesion';

/**
 * Pantalla de DEPENDENCIAS de la Ruta Crítica (Módulo 8, F5-E1): editor del DAG. Se elige un
 * proceso, se ven sus ANTECESORES y SUCESORES (vista simple del grafo) y se editan sus antecesores
 * con checkboxes. El RECHAZO DE CICLOS lo hace el backend: si el set propuesto cerraría un ciclo,
 * el error (en español, claro) se muestra en vivo. `rc.catalogo-administrar` habilita la edición.
 */
export function DependenciasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('rc.catalogo-administrar');

  // Trae todos los procesos activos (catálogo corto: 26 reales). Página grande basta.
  const consulta = useProcesosRc({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const fijar = useFijarDependenciasProcesoRc();

  const procesos = useMemo(() => consulta.data?.datos ?? [], [consulta.data]);
  const [idSeleccionado, setIdSeleccionado] = useState<number | null>(null);
  const [seleccionados, setSeleccionados] = useState<number[]>([]);

  const procesoActual = procesos.find((p) => p.id === idSeleccionado) ?? null;

  // Al cambiar de proceso (o recargar), sincroniza el set local con sus antecesores actuales.
  useEffect(() => {
    if (procesoActual) {
      setSeleccionados(procesoActual.antecesores.map((a) => a.idProceso));
    }
  }, [procesoActual]);

  // Sucesores del proceso seleccionado (quién lo tiene como antecesor): vista simple del grafo.
  const sucesores = useMemo(() => {
    if (idSeleccionado === null) return [] as ProcesoRc[];
    return procesos.filter((p) => p.antecesores.some((a) => a.idProceso === idSeleccionado));
  }, [procesos, idSeleccionado]);

  function alternar(id: number, marcado: boolean): void {
    setSeleccionados((actual) => (marcado ? [...actual, id] : actual.filter((x) => x !== id)));
  }

  function guardar(): void {
    if (procesoActual === null) return;
    fijar.mutate(
      { id: procesoActual.id, cuerpo: { idsAntecesores: seleccionados } },
      {
        onSuccess: () => toast.success('Dependencias actualizadas.'),
        // El backend rechaza ciclos con un mensaje claro en español: se muestra tal cual.
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (consulta.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="dependencias-cargando">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (consulta.isError) {
    return (
      <div className="p-4">
        <p className="text-sm text-destructive">{consulta.error.message}</p>
        <Button className="mt-2" size="sm" onClick={() => void consulta.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="dependencias-pagina">
      <header className="flex items-center gap-3">
        <GitBranch className="size-6 text-primary" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold">Dependencias de la Ruta Crítica</h1>
          <p className="text-sm text-muted-foreground">
            Define qué procesos deben ocurrir ANTES de cada proceso. No se admiten ciclos.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        {/* Lista de procesos para elegir */}
        <nav className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-lg border p-2">
          {procesos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIdSeleccionado(p.id)}
              data-testid={`dep-proceso-${p.id}`}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                p.id === idSeleccionado ? 'bg-primary/10 font-medium' : 'hover:bg-muted'
              }`}
            >
              <Route className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{p.nombre}</span>
            </button>
          ))}
        </nav>

        {/* Editor del proceso seleccionado */}
        {procesoActual === null ? (
          <p className="text-sm text-muted-foreground">
            Elige un proceso de la izquierda para ver y editar sus dependencias.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold">{procesoActual.nombre}</h2>
              <p className="text-sm text-muted-foreground">{procesoActual.codigo}</p>
            </div>

            {/* Vista simple del grafo: sucesores (quién va después) */}
            <section>
              <h3 className="mb-1 text-sm font-medium">Va antes de (sucesores)</h3>
              {sucesores.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tiene sucesores.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5" data-testid="sucesores-lista">
                  {sucesores.map((s) => (
                    <TipoBadge key={s.id} tono="neutro">
                      {s.nombre}
                    </TipoBadge>
                  ))}
                </ul>
              )}
            </section>

            {/* Editor de antecesores */}
            <section>
              <h3 className="mb-1 text-sm font-medium">Antecesores (deben ocurrir antes)</h3>
              <div
                className="grid grid-cols-1 gap-1.5 rounded-lg border p-3 sm:grid-cols-2"
                data-testid="editor-antecesores"
              >
                {procesos
                  .filter((p) => p.id !== procesoActual.id)
                  .map((p) => {
                    const idCheckbox = `antecesor-${p.id}`;
                    const marcado = seleccionados.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        htmlFor={idCheckbox}
                        className="flex items-center gap-2 text-sm leading-snug"
                      >
                        <input
                          id={idCheckbox}
                          type="checkbox"
                          className="size-4 rounded border-input accent-primary disabled:opacity-50"
                          checked={marcado}
                          disabled={!puedeAdministrar || fijar.isPending}
                          onChange={(e) => alternar(p.id, e.target.checked)}
                          data-testid={`antecesor-opcion-${p.id}`}
                        />
                        <span className="truncate">{p.nombre}</span>
                      </label>
                    );
                  })}
              </div>
            </section>

            {puedeAdministrar ? (
              <div>
                <Button
                  type="button"
                  size="sm"
                  onClick={guardar}
                  disabled={fijar.isPending}
                  data-testid="guardar-dependencias"
                >
                  {fijar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                  Guardar dependencias
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
