import { Loader2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useProcesosRc } from '@/api/ruta-critica';
import {
  useActualizarPlantillaRc,
  useArticulosRc,
  useCrearPlantillaRc,
  useFamiliasRc,
} from '@/api/ruta-critica-plantillas';
import type { PlantillaRc } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

/** Estado de captura de un proceso dentro de la plantilla. */
interface RenglonEstado {
  incluido: boolean;
  tiempo: string;
  antecesores: number[];
}

/**
 * Diálogo de alta/edición de una PLANTILLA DE RUTA (F5-E2). Captura nombre, familia/artículo y el
 * SET de procesos: por cada proceso del catálogo, si va en la plantilla, su tiempo estándar y sus
 * antecesores (entre los procesos incluidos). El RECHAZO DE CICLOS lo hace el backend: el error en
 * español se muestra como toast. Todo se envía como set completo (crea o reemplaza).
 */
export function DialogoPlantillaRc({
  abierto,
  alCambiarAbierto,
  plantilla,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Plantilla a editar; `undefined` -> alta. */
  plantilla: PlantillaRc | undefined;
}): React.JSX.Element {
  const esEdicion = plantilla !== undefined;
  const crear = useCrearPlantillaRc();
  const actualizar = useActualizarPlantillaRc();
  const guardando = crear.isPending || actualizar.isPending;

  const familias = useFamiliasRc();
  const articulos = useArticulosRc();
  const procesosCat = useProcesosRc({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const [nombre, setNombre] = useState('');
  const [idFamilia, setIdFamilia] = useState('');
  const [idArticulo, setIdArticulo] = useState('');
  const [estado, setEstado] = useState<Map<number, RenglonEstado>>(new Map());

  const procesos = useMemo(() => procesosCat.data?.datos ?? [], [procesosCat.data]);

  // Al abrir, sincroniza el formulario con la plantilla (o lo limpia para el alta).
  useEffect(() => {
    if (!abierto) return;
    setNombre(plantilla?.nombre ?? '');
    setIdFamilia(plantilla?.idFamiliaArticulo != null ? String(plantilla.idFamiliaArticulo) : '');
    setIdArticulo(plantilla?.idArticuloRC != null ? String(plantilla.idArticuloRC) : '');
    const mapa = new Map<number, RenglonEstado>();
    for (const r of plantilla?.procesos ?? []) {
      mapa.set(r.idProcesoDef, {
        incluido: true,
        tiempo: String(r.tiempoEstandar),
        antecesores: r.idsAntecesores,
      });
    }
    setEstado(mapa);
  }, [abierto, plantilla]);

  function obtener(id: number): RenglonEstado {
    return estado.get(id) ?? { incluido: false, tiempo: '0', antecesores: [] };
  }
  function fijar(id: number, parche: Partial<RenglonEstado>): void {
    setEstado((prev) => {
      const copia = new Map(prev);
      copia.set(id, { ...obtener(id), ...parche });
      return copia;
    });
  }

  const incluidos = procesos.filter((p) => obtener(p.id).incluido);

  function guardar(): void {
    const cuerpoProcesos = incluidos.map((p) => {
      const e = obtener(p.id);
      // Solo se conservan antecesores que siguen incluidos.
      const antecesores = e.antecesores.filter((idAnt) => obtener(idAnt).incluido);
      return { idProcesoDef: p.id, tiempoEstandar: Number(e.tiempo), idsAntecesores: antecesores };
    });
    const base = {
      nombre,
      idFamiliaArticulo: idFamilia === '' ? null : Number(idFamilia),
      idArticuloRC: idArticulo === '' ? null : Number(idArticulo),
      procesos: cuerpoProcesos,
    };
    const opciones = {
      onSuccess: () => {
        toast.success(esEdicion ? 'Plantilla actualizada.' : 'Plantilla creada.');
        alCambiarAbierto(false);
      },
      onError: (e: Error) => toast.error(e.message),
    };
    if (esEdicion && plantilla) {
      actualizar.mutate({ id: plantilla.id, cuerpo: base }, opciones);
    } else {
      crear.mutate(base, opciones);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{esEdicion ? 'Editar plantilla' : 'Nueva plantilla'}</DialogTitle>
          <DialogDescription>
            Marca los procesos de la plantilla, su tiempo estándar (días) y sus antecesores. No se
            admiten ciclos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="pl-nombre">Nombre</FieldLabel>
            <Input
              id="pl-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              data-testid="plantilla-nombre"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="pl-familia">Familia (opcional)</FieldLabel>
              <SelectNativo
                id="pl-familia"
                value={idFamilia}
                onChange={(e) => setIdFamilia(e.target.value)}
              >
                <option value="">— Todas —</option>
                {(familias.data ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="pl-articulo">Artículo (opcional)</FieldLabel>
              <SelectNativo
                id="pl-articulo"
                value={idArticulo}
                onChange={(e) => setIdArticulo(e.target.value)}
              >
                <option value="">— Ninguno —</option>
                {(articulos.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
          </div>

          <div className="rounded-lg border" data-testid="editor-procesos-plantilla">
            <div className="border-b bg-muted/50 px-3 py-2 text-sm font-medium">Procesos</div>
            <div className="max-h-[40vh] overflow-y-auto p-3">
              {procesos.map((p) => {
                const e = obtener(p.id);
                return (
                  <div key={p.id} className="border-b py-2 last:border-b-0">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input accent-primary"
                        checked={e.incluido}
                        onChange={(ev) => fijar(p.id, { incluido: ev.target.checked })}
                        data-testid={`incluir-${p.id}`}
                      />
                      {p.nombre}
                    </label>
                    {e.incluido ? (
                      <div className="mt-2 flex flex-col gap-2 pl-6">
                        <label className="flex items-center gap-2 text-sm">
                          Días:
                          <Input
                            type="number"
                            className="h-8 w-24"
                            value={e.tiempo}
                            onChange={(ev) => fijar(p.id, { tiempo: ev.target.value })}
                            data-testid={`tiempo-${p.id}`}
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <span className="text-xs text-muted-foreground">Antecesores:</span>
                          {incluidos
                            .filter((otro) => otro.id !== p.id)
                            .map((otro) => (
                              <label key={otro.id} className="flex items-center gap-1 text-xs">
                                <input
                                  type="checkbox"
                                  className="size-3.5 rounded border-input accent-primary"
                                  checked={e.antecesores.includes(otro.id)}
                                  onChange={(ev) =>
                                    fijar(p.id, {
                                      antecesores: ev.target.checked
                                        ? [...e.antecesores, otro.id]
                                        : e.antecesores.filter((x) => x !== otro.id),
                                    })
                                  }
                                />
                                {otro.nombre}
                              </label>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => alCambiarAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={guardando || nombre.trim() === ''}
            data-testid="guardar-plantilla"
          >
            {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
