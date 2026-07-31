import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { useActualizarRol, useCrearRol, type RolCrear, type RolEditar } from '@/api/roles';
import type { Rol } from '@/api/tipos';
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

/** Esquema de captura de un rol (solo UX; el backend re-valida, A1). */
const esquemaRolFormulario = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(60, { error: 'El nombre no puede tener más de 60 caracteres' }),
  descripcion: z
    .string()
    .trim()
    .max(200, { error: 'La descripción no puede tener más de 200 caracteres' }),
});

/** Datos del formulario. */
type DatosRolFormulario = z.infer<typeof esquemaRolFormulario>;

/**
 * Diálogo de alta/edición de un rol (react-hook-form + Zod). Si recibe un `rol`
 * edita (PATCH); si no, da de alta (POST) un rol SIN permisos (se asignan luego
 * en el árbol del detalle). El error del servidor (nombre repetido, permiso) se
 * muestra como toast en español.
 *
 * Un rol de SISTEMA no se renombra (lo rechaza el backend, A1): al editarlo, el
 * campo nombre se deshabilita con su razón; su descripción sí es editable.
 */
export function DialogoRol({
  abierto,
  alCambiarAbierto,
  rol,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Rol a editar; `undefined` -> alta. */
  rol: Rol | undefined;
}): React.JSX.Element {
  const esEdicion = rol !== undefined;
  const esSistema = rol?.esSistema ?? false;
  const crear = useCrearRol();
  const actualizar = useActualizarRol();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosRolFormulario>({
    resolver: zodResolver(esquemaRolFormulario),
    defaultValues: { nombre: '', descripcion: '' },
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      rol ? { nombre: rol.nombre, descripcion: rol.descripcion } : { nombre: '', descripcion: '' },
    );
  }, [abierto, rol, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      // Un rol de sistema no se renombra: solo se manda la descripción.
      const cuerpo: RolEditar = esSistema
        ? { descripcion: datos.descripcion }
        : { nombre: datos.nombre, descripcion: datos.descripcion };
      actualizar.mutate(
        { id: rol.id, cuerpo },
        {
          onSuccess: (r) => {
            toast.success(`Rol "${r.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    // Alta: el rol nace SIN permisos; se asignan después en el árbol del detalle.
    const cuerpo: RolCrear = { nombre: datos.nombre, descripcion: datos.descripcion };
    crear.mutate(cuerpo, {
      onSuccess: (r) => {
        toast.success(`Rol "${r.nombre}" creado. Asígnale permisos en su detalle.`);
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
            <DialogTitle>{esEdicion ? 'Editar rol' : 'Nuevo rol'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre o la descripción de este rol. Sus permisos se editan en el detalle.'
                : 'Captura un rol nuevo. Después podrás asignarle permisos desde su detalle.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="rol-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="rol-nombre"
                autoFocus
                placeholder="Almacenista"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando || esSistema}
                {...formulario.register('nombre')}
              />
              {esSistema ? (
                <FieldDescription>
                  Es un rol de sistema: su nombre no se puede cambiar.
                </FieldDescription>
              ) : null}
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.descripcion)}>
              <FieldLabel htmlFor="rol-descripcion">Descripción</FieldLabel>
              <Input
                id="rol-descripcion"
                placeholder="Para qué sirve este rol"
                aria-invalid={Boolean(errors.descripcion)}
                disabled={guardando}
                {...formulario.register('descripcion')}
              />
              <FieldDescription>Opcional (máx. 200 caracteres).</FieldDescription>
              <FieldError errors={[errors.descripcion]} />
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
              data-testid="guardar-rol"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear rol'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
