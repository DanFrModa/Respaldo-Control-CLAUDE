import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useActualizarDefecto, useCrearDefecto, useTiposProductoActivos } from '@/api/calidad';
import {
  ETIQUETAS_SEVERIDAD_DEFECTO,
  SEVERIDADES_DEFECTO,
  esquemaDefectoFormulario,
  type DatosDefectoFormulario,
} from '@/api/esquemas';
import type { Defecto } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

/** Convierte el nivelAQL numerico del API a string para el <select>. */
function nivelAqlATexto(nivel: number): '1' | '2.5' | '10' {
  if (nivel === 1) return '1';
  if (nivel === 2.5) return '2.5';
  return '10';
}

/**
 * Dialogo de alta y edicion de defecto. Incluye checkboxes de tipos de producto y
 * la casilla "Aplica a todos (general)". Si `aplicaGeneral` es true, los tipos
 * quedan deshabilitados. Validacion solo de UX: el backend re-valida (A1).
 */
export function DialogoDefecto({
  abierto,
  alCambiarAbierto,
  defecto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  defecto: Defecto | undefined;
}): React.JSX.Element {
  const esEdicion = defecto !== undefined;
  const crear = useCrearDefecto();
  const actualizar = useActualizarDefecto();
  const guardando = crear.isPending || actualizar.isPending;
  const tiposProducto = useTiposProductoActivos();

  const formulario = useForm<DatosDefectoFormulario>({
    resolver: zodResolver(esquemaDefectoFormulario),
    defaultValues: {
      clave: '',
      descripcion: '',
      pag: '',
      nivelAQL: '2.5',
      favorito: false,
      categoria: '',
      severidad: 'mayor',
      aplicaGeneral: true,
      tiposProducto: [],
    },
  });

  const aplicaGeneral = formulario.watch('aplicaGeneral');
  const tiposSeleccionados = formulario.watch('tiposProducto');
  const favorito = formulario.watch('favorito');

  useEffect(() => {
    if (abierto) {
      if (defecto) {
        formulario.reset({
          clave: defecto.clave,
          descripcion: defecto.descripcion,
          pag: defecto.pag ?? '',
          nivelAQL: nivelAqlATexto(defecto.nivelAQL),
          favorito: defecto.favorito,
          categoria: defecto.categoria ?? '',
          severidad: defecto.severidad,
          aplicaGeneral: defecto.aplicaGeneral,
          tiposProducto: defecto.tiposProducto.map((t) => t.id),
        });
      } else {
        formulario.reset({
          clave: '',
          descripcion: '',
          pag: '',
          nivelAQL: '2.5',
          favorito: false,
          categoria: '',
          severidad: 'mayor',
          aplicaGeneral: true,
          tiposProducto: [],
        });
      }
    }
  }, [abierto, defecto, formulario]);

  function toggleTipo(idTipo: number): void {
    const actuales = formulario.getValues('tiposProducto');
    if (actuales.includes(idTipo)) {
      formulario.setValue(
        'tiposProducto',
        actuales.filter((id) => id !== idTipo),
      );
    } else {
      formulario.setValue('tiposProducto', [...actuales, idTipo]);
    }
  }

  const enviar = formulario.handleSubmit((datos) => {
    const cuerpo = {
      clave: datos.clave,
      descripcion: datos.descripcion,
      nivelAQL: Number(datos.nivelAQL),
      favorito: datos.favorito,
      severidad: datos.severidad,
      aplicaGeneral: datos.aplicaGeneral,
      tiposProducto: datos.aplicaGeneral ? [] : datos.tiposProducto,
      ...(datos.pag.trim().length > 0 ? { pag: datos.pag.trim() } : {}),
      ...(datos.categoria.trim().length > 0 ? { categoria: datos.categoria.trim() } : {}),
    };

    if (esEdicion) {
      actualizar.mutate(
        { id: defecto.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Defecto "${resultado.clave}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Defecto "${resultado.clave}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const listaTipos = tiposProducto.data?.datos ?? [];

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar defecto' : 'Nuevo defecto'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Modifica los datos del defecto del catálogo de calidad.'
                : 'Agrega un defecto al catálogo del sistema de calidad AQL.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto py-4 pr-1">
            <FieldGroup>
              <LeyendaObligatorios />
              <Field data-invalid={Boolean(errors.clave)}>
                <FieldLabel htmlFor="defecto-clave" required>
                  Clave
                </FieldLabel>
                <Input
                  id="defecto-clave"
                  autoFocus
                  placeholder="Ej. COS-03"
                  aria-invalid={Boolean(errors.clave)}
                  disabled={guardando}
                  {...formulario.register('clave')}
                />
                <FieldError errors={[errors.clave]} />
              </Field>

              <Field data-invalid={Boolean(errors.descripcion)}>
                <FieldLabel htmlFor="defecto-descripcion" required>
                  Descripción
                </FieldLabel>
                <Input
                  id="defecto-descripcion"
                  placeholder="Ej. Costura abierta en entrepierna"
                  aria-invalid={Boolean(errors.descripcion)}
                  disabled={guardando}
                  {...formulario.register('descripcion')}
                />
                <FieldError errors={[errors.descripcion]} />
              </Field>

              <Field data-invalid={Boolean(errors.nivelAQL)}>
                <FieldLabel htmlFor="defecto-nivel-aql">Nivel AQL</FieldLabel>
                <SelectNativo
                  id="defecto-nivel-aql"
                  disabled={guardando}
                  {...formulario.register('nivelAQL')}
                >
                  <option value="1">1.0</option>
                  <option value="2.5">2.5</option>
                  <option value="10">10</option>
                </SelectNativo>
                <FieldDescription>
                  Qué tan tolerante es el muestreo: 1.0 estricto · 2.5 estándar · 10 laxo.
                </FieldDescription>
                <FieldError errors={[errors.nivelAQL]} />
              </Field>

              <Field data-invalid={Boolean(errors.severidad)}>
                <FieldLabel htmlFor="defecto-severidad">Severidad</FieldLabel>
                <SelectNativo
                  id="defecto-severidad"
                  disabled={guardando}
                  {...formulario.register('severidad')}
                >
                  {SEVERIDADES_DEFECTO.map((s) => (
                    <option key={s} value={s}>
                      {ETIQUETAS_SEVERIDAD_DEFECTO[s]}
                    </option>
                  ))}
                </SelectNativo>
                <FieldDescription>
                  Mayor y Crítico afectan el resultado de la auditoría; Menor no.
                </FieldDescription>
                <FieldError errors={[errors.severidad]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="defecto-categoria">Categoría</FieldLabel>
                <Input
                  id="defecto-categoria"
                  placeholder="Opcional"
                  disabled={guardando}
                  {...formulario.register('categoria')}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="defecto-pag">Página / referencia</FieldLabel>
                <Input
                  id="defecto-pag"
                  placeholder="Opcional"
                  disabled={guardando}
                  {...formulario.register('pag')}
                />
                <FieldDescription>Referencia del manual de calidad (opcional).</FieldDescription>
              </Field>

              {/* Banderas */}
              <div className="flex items-center gap-2">
                <input
                  id="defecto-favorito"
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={favorito}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    formulario.setValue('favorito', e.target.checked)
                  }
                  disabled={guardando}
                />
                <FieldLabel htmlFor="defecto-favorito" className="cursor-pointer font-normal">
                  Pre-cargar en toda auditoría nueva (favorito)
                </FieldLabel>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="defecto-aplica-general"
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={aplicaGeneral}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    formulario.setValue('aplicaGeneral', e.target.checked)
                  }
                  disabled={guardando}
                />
                <FieldLabel htmlFor="defecto-aplica-general" className="cursor-pointer font-normal">
                  Aplica a todos los tipos de producto (general)
                </FieldLabel>
              </div>

              {/* Tipos de producto (solo si NO es general) */}
              {!aplicaGeneral && (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">Tipos de producto aplicables</legend>
                  {listaTipos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No hay tipos de producto activos.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {listaTipos.map((tipo) => (
                        <div key={tipo.id} className="flex items-center gap-2">
                          <input
                            id={`tipo-${tipo.id}`}
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={tiposSeleccionados.includes(tipo.id)}
                            onChange={() => toggleTipo(tipo.id)}
                            disabled={guardando}
                          />
                          <label
                            htmlFor={`tipo-${tipo.id}`}
                            className="cursor-pointer text-sm font-normal"
                          >
                            {tipo.nombre}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </fieldset>
              )}
            </FieldGroup>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={guardando}
              data-testid="guardar-defecto"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear defecto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
