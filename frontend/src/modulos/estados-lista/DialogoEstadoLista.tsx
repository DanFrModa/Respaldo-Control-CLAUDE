import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  useActualizarEstadoLista,
  useCrearEstadoLista,
  type EstadoLista,
  type EstadoListaCrear,
  type EstadoListaEditar,
} from '@/api/estados-lista';
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

/** Esquema de captura de un estado de lista (solo UX; el backend re-valida, A1). */
const esquemaEstadoFormulario = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, { error: 'El código es obligatorio' })
    .max(50, { error: 'El código no puede tener más de 50 caracteres' }),
  nombre: z
    .string()
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  orden: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), { error: 'El orden debe ser un número entero' }),
  esCierre: z.boolean(),
});

/** Datos del formulario. */
type DatosEstadoFormulario = z.infer<typeof esquemaEstadoFormulario>;

/**
 * Diálogo de alta/edición de un estado de lista de precios (react-hook-form + Zod). Si recibe un
 * `estado` edita (PATCH); si no, da de alta (POST). El error del servidor (validación, código
 * repetido, permiso) se muestra como toast en español.
 *
 * La bandera `esCierre` marca los estados que bloquean nuevas rondas/ediciones de renglón (la usa
 * el flujo de negociación de E2+). El backend es la autoridad (A1).
 */
export function DialogoEstadoLista({
  abierto,
  alCambiarAbierto,
  estado,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Estado a editar; `undefined` -> alta. */
  estado: EstadoLista | undefined;
}): React.JSX.Element {
  const esEdicion = estado !== undefined;
  const crear = useCrearEstadoLista();
  const actualizar = useActualizarEstadoLista();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosEstadoFormulario>({
    resolver: zodResolver(esquemaEstadoFormulario),
    defaultValues: { codigo: '', nombre: '', orden: '', esCierre: false },
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      estado
        ? {
            codigo: estado.codigo,
            nombre: estado.nombre,
            orden: String(estado.orden),
            esCierre: estado.esCierre,
          }
        : { codigo: '', nombre: '', orden: '', esCierre: false },
    );
  }, [abierto, estado, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const orden = datos.orden === '' ? undefined : Number(datos.orden);

    if (esEdicion) {
      const cuerpo: EstadoListaEditar = {
        codigo: datos.codigo,
        nombre: datos.nombre,
        esCierre: datos.esCierre,
        ...(orden === undefined ? {} : { orden }),
      };
      actualizar.mutate(
        { id: estado.id, cuerpo },
        {
          onSuccess: (r) => {
            toast.success(`Estado de lista "${r.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    const cuerpo: EstadoListaCrear = {
      codigo: datos.codigo,
      nombre: datos.nombre,
      esCierre: datos.esCierre,
      ...(orden === undefined ? {} : { orden }),
    };
    crear.mutate(cuerpo, {
      onSuccess: (r) => {
        toast.success(`Estado de lista "${r.nombre}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent>
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>
              {esEdicion ? 'Editar estado de lista' : 'Nuevo estado de lista'}
            </DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el código, el nombre, el orden o si es un estado de cierre.'
                : 'Captura un estado del ciclo de vida de una lista de precios.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.codigo)}>
              <FieldLabel htmlFor="el-codigo" required>
                Código
              </FieldLabel>
              <Input
                id="el-codigo"
                autoFocus
                placeholder="abierta"
                aria-invalid={Boolean(errors.codigo)}
                disabled={guardando}
                {...formulario.register('codigo')}
              />
              <FieldDescription>Clave estable en minúsculas (ej. "abierta").</FieldDescription>
              <FieldError errors={[errors.codigo]} />
            </Field>

            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="el-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="el-nombre"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.orden)}>
              <FieldLabel htmlFor="el-orden">Orden</FieldLabel>
              <Input
                id="el-orden"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="0"
                aria-invalid={Boolean(errors.orden)}
                disabled={guardando}
                {...formulario.register('orden')}
              />
              <FieldDescription>Menor primero. Vacío = 0.</FieldDescription>
              <FieldError errors={[errors.orden]} />
            </Field>

            <Field orientation="horizontal">
              <input
                id="el-es-cierre"
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                disabled={guardando}
                data-testid="el-es-cierre"
                {...formulario.register('esCierre')}
              />
              <FieldLabel htmlFor="el-es-cierre" className="font-normal">
                ¿Es un estado de cierre? (bloquea nuevas rondas/ediciones de renglón)
              </FieldLabel>
            </Field>
          </FieldGroup>

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
              data-testid="guardar-estado-lista"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear estado'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
