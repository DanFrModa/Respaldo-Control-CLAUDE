import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useActualizarPlanAql, useCrearPlanAql, useResolverPlan } from '@/api/calidad';
import { esquemaPlanAqlFormulario, NIVELES_AQL, type DatosPlanAqlFormulario } from '@/api/esquemas';
import type { PlanAql } from '@/api/tipos';
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
  FieldError,
  FieldGroup,
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

/** Convierte el numero de nivelAQL a string para el formulario. */
function nivelATexto(n: number): '1' | '2.5' | '10' {
  if (n === 1) return '1';
  if (n === 2.5) return '2.5';
  return '10';
}

/**
 * Dialogo de alta y edicion de plan AQL (react-hook-form + Zod + useFieldArray).
 * Incluye un preview en vivo (useResolverPlan) con inputs de tamano de lote y
 * nivel AQL. Validacion solo de UX: el backend re-valida (A1).
 */
export function DialogoPlanAql({
  abierto,
  alCambiarAbierto,
  plan,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  plan: PlanAql | undefined;
}): React.JSX.Element {
  const esEdicion = plan !== undefined;
  const crear = useCrearPlanAql();
  const actualizar = useActualizarPlanAql();
  const guardando = crear.isPending || actualizar.isPending;

  // Preview en vivo
  const [previewLote, setPreviewLote] = useState('');
  const [previewNivel, setPreviewNivel] = useState('2.5');
  const preview = useResolverPlan({
    ...(previewLote !== '' ? { tamanoLote: Number(previewLote) } : {}),
    ...(previewNivel !== '' ? { nivelAQL: Number(previewNivel) } : {}),
  });

  const formulario = useForm<DatosPlanAqlFormulario>({
    resolver: zodResolver(esquemaPlanAqlFormulario),
    defaultValues: { nombre: '', renglones: [] },
  });

  const { fields, append, remove } = useFieldArray({
    control: formulario.control,
    name: 'renglones',
  });

  useEffect(() => {
    if (abierto) {
      setPreviewLote('');
      setPreviewNivel('2.5');
      if (plan) {
        formulario.reset({
          nombre: plan.nombre,
          renglones: plan.renglones.map((r) => ({
            loteMin: String(r.loteMin),
            loteMax: r.loteMax !== null ? String(r.loteMax) : '',
            tamanoMuestra: String(r.tamanoMuestra),
            limites: r.limites.map((l) => ({
              nivelAQL: nivelATexto(l.nivelAQL),
              aceptar: String(l.aceptar),
              rechazar: String(l.rechazar),
            })),
          })),
        });
      } else {
        formulario.reset({ nombre: '', renglones: [] });
      }
    }
  }, [abierto, plan, formulario]);

  function agregarRenglon(): void {
    append({
      loteMin: '',
      loteMax: '',
      tamanoMuestra: '',
      limites: NIVELES_AQL.map((n) => ({
        nivelAQL: String(n) as '1' | '2.5' | '10',
        aceptar: '',
        rechazar: '',
      })),
    });
  }

  const enviar = formulario.handleSubmit((datos) => {
    const cuerpo = {
      nombre: datos.nombre,
      renglones: datos.renglones.map((r) => ({
        loteMin: Number(r.loteMin),
        loteMax: r.loteMax.trim() !== '' ? Number(r.loteMax) : null,
        tamanoMuestra: Number(r.tamanoMuestra),
        limites: r.limites.map((l) => ({
          nivelAQL: Number(l.nivelAQL),
          aceptar: Number(l.aceptar),
          rechazar: Number(l.rechazar),
        })),
      })),
    };

    if (esEdicion) {
      actualizar.mutate(
        { id: plan.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Plan "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Plan "${resultado.nombre}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar plan AQL' : 'Nuevo plan AQL'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Modifica el nombre y los renglones del plan de muestreo AQL.'
                : 'Captura el nombre y los renglones del plan de muestreo AQL.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] overflow-y-auto py-4 pr-1">
            <FieldGroup>
              <LeyendaObligatorios />
              <Field data-invalid={Boolean(errors.nombre)}>
                <FieldLabel htmlFor="plan-nombre" required>
                  Nombre
                </FieldLabel>
                <Input
                  id="plan-nombre"
                  autoFocus
                  placeholder="Ej. Plan AQL general"
                  aria-invalid={Boolean(errors.nombre)}
                  disabled={guardando}
                  {...formulario.register('nombre')}
                />
                <FieldError errors={[errors.nombre]} />
              </Field>
            </FieldGroup>

            {/* Renglones */}
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Renglones del plan</p>
                  <p className="text-sm text-muted-foreground">
                    Cada renglón es un rango de tamaño de lote con su muestra y sus límites Ac/Re.
                    Agrega al menos uno.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={agregarRenglon}
                  disabled={guardando}
                  data-testid="agregar-renglon-aql"
                >
                  <PlusIcon className="mr-1 size-3.5" aria-hidden />
                  Agregar renglón
                </Button>
              </div>

              {fields.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Sin renglones. Agrega los rangos del plan.
                </p>
              ) : (
                <ul className="space-y-4" data-testid="renglones-plan-aql">
                  {fields.map((field, idx) => {
                    const errRenglon = errors.renglones?.[idx];
                    return (
                      <li
                        key={field.id}
                        className="rounded-md border p-3"
                        data-testid="renglon-aql"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            Renglón {idx + 1}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => remove(idx)}
                            disabled={guardando}
                            aria-label="Eliminar renglón"
                          >
                            <Trash2Icon className="size-3.5" aria-hidden />
                          </Button>
                        </div>

                        {/* Rango y muestra */}
                        <div className="grid grid-cols-3 gap-2">
                          <Field data-invalid={Boolean(errRenglon?.loteMin)}>
                            <FieldLabel htmlFor={`renglon-${idx}-min`} className="text-xs">
                              Lote mín.
                            </FieldLabel>
                            <Input
                              id={`renglon-${idx}-min`}
                              type="number"
                              min={1}
                              disabled={guardando}
                              {...formulario.register(`renglones.${idx}.loteMin`)}
                            />
                            <FieldError errors={[errRenglon?.loteMin]} />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`renglon-${idx}-max`} className="text-xs">
                              Lote máx. (vacío = sin tope)
                            </FieldLabel>
                            <Input
                              id={`renglon-${idx}-max`}
                              type="number"
                              min={1}
                              placeholder="Sin tope"
                              disabled={guardando}
                              {...formulario.register(`renglones.${idx}.loteMax`)}
                            />
                          </Field>
                          <Field data-invalid={Boolean(errRenglon?.tamanoMuestra)}>
                            <FieldLabel htmlFor={`renglon-${idx}-muestra`} className="text-xs">
                              Muestra
                            </FieldLabel>
                            <Input
                              id={`renglon-${idx}-muestra`}
                              type="number"
                              min={1}
                              disabled={guardando}
                              {...formulario.register(`renglones.${idx}.tamanoMuestra`)}
                            />
                            <FieldError errors={[errRenglon?.tamanoMuestra]} />
                          </Field>
                        </div>

                        {/* Limites por nivel AQL */}
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {NIVELES_AQL.map((nivel, limIdx) => (
                            <div key={nivel} className="rounded border p-2">
                              <p className="mb-1 text-xs font-medium">AQL {nivel}</p>
                              <div className="grid grid-cols-2 gap-1">
                                <Field>
                                  <FieldLabel
                                    htmlFor={`lim-${idx}-${limIdx}-ac`}
                                    className="text-xs"
                                  >
                                    Ac
                                  </FieldLabel>
                                  <Input
                                    id={`lim-${idx}-${limIdx}-ac`}
                                    type="number"
                                    min={0}
                                    disabled={guardando}
                                    {...formulario.register(
                                      `renglones.${idx}.limites.${limIdx}.aceptar`,
                                    )}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel
                                    htmlFor={`lim-${idx}-${limIdx}-re`}
                                    className="text-xs"
                                  >
                                    Re
                                  </FieldLabel>
                                  <Input
                                    id={`lim-${idx}-${limIdx}-re`}
                                    type="number"
                                    min={1}
                                    disabled={guardando}
                                    {...formulario.register(
                                      `renglones.${idx}.limites.${limIdx}.rechazar`,
                                    )}
                                  />
                                </Field>
                              </div>
                            </div>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Preview en vivo */}
            <div className="mt-4 rounded-md border bg-muted/40 p-3" data-testid="preview-aql">
              <p className="mb-2 text-sm font-medium">Vista previa (plan default activo)</p>
              <div className="flex flex-wrap items-end gap-2">
                <Field>
                  <FieldLabel htmlFor="preview-lote" className="text-xs">
                    Tamaño de lote
                  </FieldLabel>
                  <Input
                    id="preview-lote"
                    type="number"
                    min={1}
                    className="w-28"
                    placeholder="Ej. 500"
                    value={previewLote}
                    onChange={(e) => setPreviewLote(e.target.value)}
                    data-testid="preview-lote-input"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="preview-nivel" className="text-xs">
                    Nivel AQL
                  </FieldLabel>
                  <SelectNativo
                    id="preview-nivel"
                    className="w-24"
                    value={previewNivel}
                    onChange={(e) => setPreviewNivel(e.target.value)}
                    data-testid="preview-nivel-select"
                  >
                    {NIVELES_AQL.map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </SelectNativo>
                </Field>
              </div>
              {preview.isPending && previewLote !== '' ? (
                <p className="mt-2 text-xs text-muted-foreground">Calculando…</p>
              ) : preview.data ? (
                <p className="mt-2 text-sm" data-testid="preview-resultado">
                  <span className="font-medium">Plan:</span> {preview.data.nombrePlan} —{' '}
                  <span className="font-medium">Muestra:</span> {preview.data.tamanoMuestra} piezas
                  — <span className="font-medium">Ac:</span> {preview.data.aceptar} /{' '}
                  <span className="font-medium">Re:</span> {preview.data.rechazar}
                </p>
              ) : preview.isError ? (
                <p className="mt-2 text-xs text-destructive">{preview.error.message}</p>
              ) : null}
            </div>
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
              data-testid="guardar-plan-aql"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
