import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  useActualizarConceptoCosto,
  useCrearConceptoCosto,
  type ConceptoCosto,
  type ConceptoCostoCrear,
  type ConceptoCostoEditar,
} from '@/api/conceptos-costo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** Esquema de captura de un concepto de costo (solo UX; el backend re-valida, A1). */
const esquemaConceptoFormulario = z.object({
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
  // `orden` se captura como texto (el `<input type=number>` entrega string). Vacío = default 0.
  orden: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), { error: 'El orden debe ser un número entero' }),
});

/** Datos del formulario. */
type DatosConceptoFormulario = z.infer<typeof esquemaConceptoFormulario>;

/**
 * Diálogo de alta/edición de un concepto de costo (react-hook-form + Zod). Si recibe un
 * `concepto` edita (PATCH); si no, da de alta (POST). El error del servidor (validación,
 * código repetido, permiso) se muestra como toast en español.
 *
 * La bandera `fijo` la pone SOLO el seed (tela/avíos/maquila): no se captura aquí. El backend
 * es la autoridad (rechaza desactivar un concepto fijo), A1.
 */
export function DialogoConceptoCosto({
  abierto,
  alCambiarAbierto,
  concepto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Concepto a editar; `undefined` -> alta. */
  concepto: ConceptoCosto | undefined;
}): React.JSX.Element {
  const esEdicion = concepto !== undefined;
  const crear = useCrearConceptoCosto();
  const actualizar = useActualizarConceptoCosto();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosConceptoFormulario>({
    resolver: zodResolver(esquemaConceptoFormulario),
    defaultValues: { codigo: '', nombre: '', orden: '' },
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      concepto
        ? { codigo: concepto.codigo, nombre: concepto.nombre, orden: String(concepto.orden) }
        : { codigo: '', nombre: '', orden: '' },
    );
  }, [abierto, concepto, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const orden = datos.orden === '' ? undefined : Number(datos.orden);

    if (esEdicion) {
      const cuerpo: ConceptoCostoEditar = {
        codigo: datos.codigo,
        nombre: datos.nombre,
        ...(orden === undefined ? {} : { orden }),
      };
      actualizar.mutate(
        { id: concepto.id, cuerpo },
        {
          onSuccess: (r) => {
            toast.success(`Concepto de costo "${r.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    const cuerpo: ConceptoCostoCrear = {
      codigo: datos.codigo,
      nombre: datos.nombre,
      ...(orden === undefined ? {} : { orden }),
    };
    crear.mutate(cuerpo, {
      onSuccess: (r) => {
        toast.success(`Concepto de costo "${r.nombre}" creado.`);
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
              {esEdicion ? 'Editar concepto de costo' : 'Nuevo concepto de costo'}
            </DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el código, el nombre o el orden de este concepto.'
                : 'Captura un concepto de costo abierto del pre-costeo (además de tela/avíos/maquila).'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.codigo)}>
              <FieldLabel htmlFor="cc-codigo">Código</FieldLabel>
              <Input
                id="cc-codigo"
                autoFocus
                placeholder="flete"
                aria-invalid={Boolean(errors.codigo)}
                disabled={guardando}
                {...formulario.register('codigo')}
              />
              <FieldDescription>Clave estable en minúsculas (ej. "flete").</FieldDescription>
              <FieldError errors={[errors.codigo]} />
            </Field>

            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="cc-nombre">Nombre</FieldLabel>
              <Input
                id="cc-nombre"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.orden)}>
              <FieldLabel htmlFor="cc-orden">Orden</FieldLabel>
              <Input
                id="cc-orden"
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
            <Button type="submit" disabled={guardando} data-testid="guardar-concepto-costo">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear concepto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
