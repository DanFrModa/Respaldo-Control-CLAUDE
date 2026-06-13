import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { type DatosContrasena, esquemaContrasena } from '@/api/esquemas';
import type { Usuario } from '@/api/tipos';
import { useCambiarContrasena } from '@/api/usuarios';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * Dialogo APARTE para cambiar la contraseña de un usuario (`POST .../contrasena`,
 * ≥8). Se separa del alta/edicion porque es una accion sensible y puntual: no
 * forma parte de los datos del usuario. Al exito cierra y avisa con un toast; el
 * error del backend se muestra como toast. Validacion solo UX (A1).
 */
export function DialogoContrasena({
  usuario,
  alCerrar,
}: {
  /** Usuario al que se le cambia la contraseña; `null` -> dialogo cerrado. */
  usuario: Usuario | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const cambiar = useCambiarContrasena();

  const formulario = useForm<DatosContrasena>({
    resolver: zodResolver(esquemaContrasena),
    defaultValues: { password: '' },
  });

  // Al abrir (cambia el usuario objetivo) limpia el campo.
  useEffect(() => {
    if (usuario !== null) {
      formulario.reset({ password: '' });
    }
  }, [usuario, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (usuario === null) {
      return;
    }
    cambiar.mutate(
      { id: usuario.id, password: datos.password },
      {
        onSuccess: () => {
          toast.success(`Contraseña de "${usuario.username}" actualizada.`);
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  });

  const { errors } = formulario.formState;

  return (
    <Dialog
      open={usuario !== null}
      onOpenChange={(abierto) => {
        if (!abierto) {
          alCerrar();
        }
      }}
    >
      <DialogContent>
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>
              Define una nueva contraseña para{' '}
              <span className="font-medium text-foreground">{usuario?.username}</span>. Deberá
              usarla en su próximo inicio de sesión.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.password)}>
              <FieldLabel htmlFor="nueva-contrasena">Nueva contraseña</FieldLabel>
              <Input
                id="nueva-contrasena"
                type="password"
                autoFocus
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                disabled={cambiar.isPending}
                {...formulario.register('password')}
              />
              <FieldError errors={[errors.password]} />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={alCerrar} disabled={cambiar.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={cambiar.isPending} data-testid="guardar-contrasena">
              {cambiar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Cambiar contraseña
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
