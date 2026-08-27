import { Loader2Icon, MergeIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useColores, useFusionarColores } from '@/api/colores';
import type { Color } from '@/api/tipos';
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
import { Skeleton } from '@/components/ui/skeleton';

/** Tope de colores a traer para el selector de fusión (catálogo corto y conocido). */
const TOPE_COLORES_FUSION = 100;

/**
 * DIÁLOGO DE FUSIÓN DE COLORES DUPLICADOS (F1-E6).
 *
 * Resuelve la deuda de la normalización: en el viejo el color era texto libre, así que
 * la carga histórica deja alias ("NEGRO A"/"NEGRO B") que aquí se consolidan. El usuario:
 *   1. elige el color que se CONSERVA (canónico/destino);
 *   2. marca uno o varios DUPLICADOS (origen) a fusionar en él;
 *   3. confirma; las telas que usaban los duplicados pasan al canónico y los duplicados
 *      quedan desactivados.
 *
 * El backend resuelve la colisión de PK del puente Tela↔Color y es la autoridad (A1):
 * aquí solo se PRESENTA el impacto y se llama al endpoint. Carga su propio listado de
 * colores activos (independiente de la paginación de la pantalla) para que el destino y
 * los duplicados se puedan elegir aunque no estén en la página visible.
 */
export function DialogoFusionColores({
  abierto,
  alCambiarAbierto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
}): React.JSX.Element {
  const consulta = useColores({
    pagina: 1,
    porPagina: TOPE_COLORES_FUSION,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
  const fusionar = useFusionarColores();

  const colores = useMemo<readonly Color[]>(() => consulta.data?.datos ?? [], [consulta.data]);

  // Color canónico que se conserva (destino) y duplicados marcados (orígenes).
  const [idDestino, setIdDestino] = useState<number | null>(null);
  const [origenes, setOrigenes] = useState<number[]>([]);
  // Filtro de la lista de duplicados (catálogos de colores pueden ser largos).
  const [filtro, setFiltro] = useState('');

  // Al abrir/cerrar, limpia la selección para no arrastrar elecciones previas.
  useEffect(() => {
    if (abierto) {
      setIdDestino(null);
      setOrigenes([]);
      setFiltro('');
    }
  }, [abierto]);

  const destino = colores.find((c) => c.id === idDestino) ?? null;

  /** Candidatos a duplicado: todos menos el destino, filtrados por el texto. */
  const candidatos = useMemo(() => {
    const texto = filtro.trim().toLowerCase();
    return colores.filter(
      (c) => c.id !== idDestino && (texto === '' || c.nombre.toLowerCase().includes(texto)),
    );
  }, [colores, idDestino, filtro]);

  function alElegirDestino(valor: string): void {
    const id = Number(valor);
    const nuevoDestino = Number.isFinite(id) && id > 0 ? id : null;
    setIdDestino(nuevoDestino);
    // El destino no puede estar también entre los duplicados.
    if (nuevoDestino !== null) {
      setOrigenes((prev) => prev.filter((o) => o !== nuevoDestino));
    }
  }

  function alternarOrigen(id: number, marcado: boolean): void {
    setOrigenes((prev) => (marcado ? [...prev, id] : prev.filter((o) => o !== id)));
  }

  const puedeFusionar = idDestino !== null && origenes.length > 0 && !fusionar.isPending;

  function confirmar(): void {
    if (idDestino === null || origenes.length === 0) {
      return;
    }
    const nombreDestino = destino?.nombre ?? '';
    const cantidad = origenes.length;
    fusionar.mutate(
      { idDestino, origenes },
      {
        onSuccess: () => {
          toast.success(
            cantidad === 1
              ? `Color fusionado en "${nombreDestino}".`
              : `${cantidad} colores fusionados en "${nombreDestino}".`,
          );
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fusionar colores duplicados</DialogTitle>
          <DialogDescription>
            Elige el color que se conserva y marca los duplicados que se fusionarán en él. Las telas
            que usaban los duplicados pasarán al color conservado y los duplicados quedarán
            desactivados. No se puede deshacer automáticamente.
          </DialogDescription>
          {/* §Post-F9.129: la promesa de arriba habla SOLO de telas, y el servidor ahora RECHAZA
              fusionar un color usado en órdenes/movimientos. Se dice aquí para que el 409 no
              sorprenda — sobre todo ahora que el catálogo tiene "Negro A"/"Negro B" viejos que
              invitan justo a este atajo.

              ⚠️ Va como <p> normal y NO como un segundo <DialogDescription>: el primitivo de Radix
              toma su `id` del CONTEXTO del diálogo, no de cada instancia, así que dos descripciones
              nacen con el MISMO id — HTML inválido, y el `aria-describedby` del diálogo apunta sólo
              a la primera. O sea: este aviso, que es justo el que evita que el 409 sorprenda, sería
              invisible para un lector de pantalla. Las clases replican las del primitivo. */}
          <p className="text-sm text-muted-foreground" data-testid="fusion-colores-aviso-uso">
            Solo se pueden fusionar colores que <b>aún no se usan</b> en órdenes, cortes, inventario
            o compras. Si alguno ya se usa, el sistema lo rechaza y te dice cuál: unificar órdenes
            ya capturadas es otra tarea, no una fusión de catálogo.
          </p>
        </DialogHeader>

        {consulta.isPending ? (
          <div className="space-y-2 py-4" data-testid="fusion-colores-cargando">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : consulta.isError ? (
          <p className="py-4 text-sm text-destructive">{consulta.error.message}</p>
        ) : colores.length < 2 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Necesitas al menos dos colores activos para poder fusionar.
          </p>
        ) : (
          <div className="space-y-4 py-2">
            {/* Destino canónico */}
            <Field>
              <FieldLabel htmlFor="fusion-destino">Color que se conserva</FieldLabel>
              <FieldDescription>El color canónico que sobrevive (destino).</FieldDescription>
              <SelectNativo
                id="fusion-destino"
                data-testid="fusion-destino"
                value={idDestino === null ? '' : String(idDestino)}
                onChange={(e) => alElegirDestino(e.target.value)}
              >
                <option value="">Elige un color…</option>
                {colores.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            {/* Duplicados a fusionar */}
            <Field role="group" aria-labelledby="fusion-origenes-titulo">
              <FieldLabel id="fusion-origenes-titulo" asChild>
                <span>Duplicados a fusionar</span>
              </FieldLabel>
              <FieldDescription>
                Marca los colores que son el mismo que el conservado.
              </FieldDescription>

              {idDestino === null ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  Primero elige el color que se conserva.
                </p>
              ) : (
                <>
                  <div className="relative">
                    <SearchIcon
                      className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      type="search"
                      placeholder="Filtrar colores…"
                      className="pl-8"
                      value={filtro}
                      onChange={(e) => setFiltro(e.target.value)}
                      aria-label="Filtrar duplicados por nombre"
                      data-testid="fusion-filtro"
                    />
                  </div>
                  {candidatos.length === 0 ? (
                    <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                      No hay otros colores que coincidan.
                    </p>
                  ) : (
                    <div
                      className="max-h-56 overflow-y-auto rounded-lg border p-2"
                      data-testid="fusion-origenes"
                    >
                      <ul className="flex flex-col gap-1">
                        {candidatos.map((c) => {
                          const idCheckbox = `fusion-origen-${c.id}`;
                          const marcado = origenes.includes(c.id);
                          return (
                            <li key={c.id}>
                              <label
                                htmlFor={idCheckbox}
                                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm leading-snug hover:bg-muted"
                              >
                                <input
                                  id={idCheckbox}
                                  type="checkbox"
                                  className="size-4 rounded border-input accent-primary"
                                  checked={marcado}
                                  onChange={(e) => alternarOrigen(c.id, e.target.checked)}
                                  data-testid={`fusion-origen-opcion-${c.id}`}
                                />
                                <span className="truncate">{c.nombre}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </Field>

            {/* Impacto */}
            {destino !== null && origenes.length > 0 ? (
              <p
                className="rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-soft-foreground"
                data-testid="fusion-impacto"
              >
                Se fusionarán <strong>{origenes.length}</strong>{' '}
                {origenes.length === 1 ? 'color' : 'colores'} en <strong>{destino.nombre}</strong>.
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={fusionar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={!puedeFusionar}
            data-testid="confirmar-fusion"
          >
            {fusionar.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <MergeIcon aria-hidden />
            )}
            Fusionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
