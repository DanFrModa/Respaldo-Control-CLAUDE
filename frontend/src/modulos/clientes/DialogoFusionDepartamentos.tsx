import { Loader2Icon, MergeIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useFusionarDepartamentos, usePreviaFusionDepartamentos } from '@/api/clientes';
import type { ClienteDepartamento } from '@/api/tipos';
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

/**
 * DIALOGO DE FUSION DE DEPARTAMENTOS DUPLICADOS (§Post-F9.122a).
 *
 * **El problema, en palabras de Daniel:** *"los departamentos estan revueltos... hay mujer, dama,
 * caballero, hombre"*. El importador de OC da de alta un departamento cada vez que la OC trae un
 * texto nuevo (`"2-HOMBRE"` en una OC, `"Caballeros"` en el catalogo), y como la LISTA DE PRECIOS
 * cuelga de cliente + departamento, dos nombres para lo mismo parten el trabajo en dos mundos que no
 * se ven entre si. El usuario:
 *   1. elige el departamento que SE QUEDA (canonico);
 *   2. marca uno o varios DUPLICADOS a fusionar en el;
 *   3. **lee QUE VA A PASAR** (cuantos proyectos, listas y cotizaciones se mueven, y que pasa con
 *      los factores si chocan);
 *   4. confirma.
 *
 * 🔴 **El impacto NO se calcula aqui.** Lo pide al servidor (`usePreviaFusionDepartamentos`), que lo
 * cuenta con las MISMAS funciones con las que despues lo mueve. Una cuenta escrita "para la pantalla"
 * se desincroniza en la primera correccion y le promete al usuario algo distinto de lo que pasa — y
 * este es justo el boton que se aprieta CREYENDOLE al aviso.
 *
 * Es el espejo de `modulos/colores/DialogoFusionColores.tsx`, con una diferencia de fondo: aquella se
 * NIEGA a fusionar un color en uso; esta REPUNTA todo lo que colgaba, porque los departamentos que
 * hay que juntar son justamente los que ya tienen trabajo encima.
 */
export function DialogoFusionDepartamentos({
  abierto,
  alCambiarAbierto,
  idCliente,
  departamentos,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idCliente: number;
  /** Departamentos del cliente (activos e inactivos), tal como los tiene el editor. */
  departamentos: readonly ClienteDepartamento[];
}): React.JSX.Element {
  const fusionar = useFusionarDepartamentos();

  // Departamento canonico que se conserva (destino) y duplicados marcados (origenes).
  const [idDestino, setIdDestino] = useState<number | null>(null);
  const [origenes, setOrigenes] = useState<number[]>([]);
  const [filtro, setFiltro] = useState('');

  // Al abrir, limpia la seleccion para no arrastrar elecciones previas.
  useEffect(() => {
    if (abierto) {
      setIdDestino(null);
      setOrigenes([]);
      setFiltro('');
    }
  }, [abierto]);

  const previa = usePreviaFusionDepartamentos(idCliente, idDestino, origenes);

  /** Solo los ACTIVOS pueden ser el canonico: el que sobrevive no debe nacer apagado. */
  const candidatosDestino = useMemo(() => departamentos.filter((d) => d.activo), [departamentos]);

  const destino = departamentos.find((d) => d.id === idDestino) ?? null;

  /** Candidatos a duplicado: todos los ACTIVOS menos el destino, filtrados por el texto. */
  const candidatos = useMemo(() => {
    const texto = filtro.trim().toLowerCase();
    return departamentos.filter(
      (d) =>
        d.activo && d.id !== idDestino && (texto === '' || d.nombre.toLowerCase().includes(texto)),
    );
  }, [departamentos, idDestino, filtro]);

  function alElegirDestino(valor: string): void {
    const id = Number(valor);
    const nuevoDestino = Number.isFinite(id) && id > 0 ? id : null;
    setIdDestino(nuevoDestino);
    // El canonico no puede estar tambien entre los duplicados.
    if (nuevoDestino !== null) {
      setOrigenes((prev) => prev.filter((o) => o !== nuevoDestino));
    }
  }

  function alternarOrigen(id: number, marcado: boolean): void {
    setOrigenes((prev) => (marcado ? [...prev, id] : prev.filter((o) => o !== id)));
  }

  const puedeFusionar = idDestino !== null && origenes.length > 0 && !fusionar.isPending;

  /** Cuantos absorbidos tienen factores propios que se van a descartar (aviso del dialogo). */
  const conFactoresQueSeDescartan =
    previa.data?.origenes.filter((o) => o.factoresSeDescartan).length ?? 0;

  function confirmar(): void {
    if (idDestino === null || origenes.length === 0) {
      return;
    }
    const nombreDestino = destino?.nombre ?? '';
    const cantidad = origenes.length;
    fusionar.mutate(
      { idCliente, cuerpo: { idDestino, origenes } },
      {
        onSuccess: () => {
          toast.success(
            cantidad === 1
              ? `Departamento fusionado en "${nombreDestino}".`
              : `${String(cantidad)} departamentos fusionados en "${nombreDestino}".`,
          );
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Juntar departamentos duplicados</DialogTitle>
          <DialogDescription>
            Elige el departamento que se conserva y marca los que son el mismo escrito de otra forma
            (por ejemplo &quot;2-HOMBRE&quot; y &quot;Caballeros&quot;). Todo lo que colgaba de los
            duplicados —proyectos, listas de precios y cotizaciones— pasa al que se conserva, y los
            duplicados quedan desactivados. Nada se borra, pero no se deshace solo.
          </DialogDescription>
        </DialogHeader>

        {departamentos.filter((d) => d.activo).length < 2 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Necesitas al menos dos departamentos activos para poder juntarlos.
          </p>
        ) : (
          <div className="space-y-4 py-2">
            {/* Canonico que se conserva */}
            <Field>
              <FieldLabel htmlFor="fusion-depto-destino">Departamento que se conserva</FieldLabel>
              <FieldDescription>El nombre bueno, el que sobrevive.</FieldDescription>
              <SelectNativo
                id="fusion-depto-destino"
                data-testid="fusion-depto-destino"
                value={idDestino === null ? '' : String(idDestino)}
                onChange={(e) => alElegirDestino(e.target.value)}
              >
                <option value="">Elige un departamento…</option>
                {candidatosDestino.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            {/* Duplicados a absorber */}
            <Field role="group" aria-labelledby="fusion-depto-origenes-titulo">
              <FieldLabel id="fusion-depto-origenes-titulo" asChild>
                <span>Duplicados a juntar</span>
              </FieldLabel>
              <FieldDescription>
                Marca los departamentos que son el mismo que el conservado.
              </FieldDescription>

              {idDestino === null ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  Primero elige el departamento que se conserva.
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
                      placeholder="Filtrar departamentos…"
                      className="pl-8"
                      value={filtro}
                      onChange={(e) => setFiltro(e.target.value)}
                      aria-label="Filtrar duplicados por nombre"
                      data-testid="fusion-depto-filtro"
                    />
                  </div>
                  {candidatos.length === 0 ? (
                    <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                      No hay otros departamentos que coincidan.
                    </p>
                  ) : (
                    <div
                      className="max-h-48 overflow-y-auto rounded-lg border p-2"
                      data-testid="fusion-depto-origenes"
                    >
                      <ul className="flex flex-col gap-1">
                        {candidatos.map((d) => {
                          const idCheckbox = `fusion-depto-origen-${String(d.id)}`;
                          return (
                            <li key={d.id}>
                              <label
                                htmlFor={idCheckbox}
                                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm leading-snug hover:bg-muted"
                              >
                                <input
                                  id={idCheckbox}
                                  type="checkbox"
                                  className="size-4 rounded border-input accent-primary"
                                  checked={origenes.includes(d.id)}
                                  onChange={(e) => alternarOrigen(d.id, e.target.checked)}
                                  data-testid={`fusion-depto-origen-opcion-${String(d.id)}`}
                                />
                                <span className="truncate">{d.nombre}</span>
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

            {/* ⭐ QUE VA A PASAR — contado por el servidor con las mismas funciones que lo mueven. */}
            {idDestino !== null && origenes.length > 0 ? (
              previa.isPending ? (
                <Skeleton className="h-20 w-full" data-testid="fusion-depto-previa-cargando" />
              ) : previa.isError ? (
                <p className="text-sm text-destructive">{previa.error.message}</p>
              ) : previa.data === undefined ? null : (
                <div
                  className="space-y-2 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-soft-foreground"
                  data-testid="fusion-depto-impacto"
                >
                  <p>
                    Se juntarán <strong>{origenes.length}</strong>{' '}
                    {origenes.length === 1 ? 'departamento' : 'departamentos'} en{' '}
                    <strong>{previa.data.destino.nombre}</strong>. Pasarán a él:
                  </p>
                  <ul className="list-disc pl-5">
                    {previa.data.totales.map((t) => (
                      <li key={t.relacion}>
                        <strong>{t.cuenta}</strong> {t.etiqueta}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : null}

            {/* ⚖️ El aviso de la colision de factores: se dice ANTES de apretar, no despues. */}
            {conFactoresQueSeDescartan > 0 ? (
              <p
                className="flex gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm"
                data-testid="fusion-depto-aviso-factores"
              >
                <TriangleAlertIcon
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden
                />
                <span>
                  {conFactoresQueSeDescartan === 1
                    ? 'Uno de los departamentos que se juntan tiene'
                    : `${String(conFactoresQueSeDescartan)} de los departamentos que se juntan tienen`}{' '}
                  <b>factores de precio propios</b>, y{' '}
                  <b>{previa.data?.destino.nombre ?? 'el que se conserva'}</b> también. Se conservan
                  los del que se queda; los otros se descartan (quedan anotados en la bitácora por
                  si hay que recuperarlos).
                </span>
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
            data-testid="fusion-depto-confirmar"
          >
            {fusionar.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <MergeIcon aria-hidden />
            )}
            Juntar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
